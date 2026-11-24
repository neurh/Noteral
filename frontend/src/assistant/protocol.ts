/**
 * Wire formats. The conversation is stored provider-neutral (./types.ts) and turned
 * into a request body per provider kind here; streamed chunks are parsed back into
 * parts. The Go side only forwards bytes, so everything provider-specific lives here.
 */
import { mentionContext } from "./mentions";
import { thinkingPatch } from "./models";
import type { ThinkingLevel } from "./models";
import type { ProviderKind } from "./providers";
import type { ChatMessage, Part, StepResult, ThinkingPart, ToolDef, ToolPart, Usage } from "./types";

export interface BuildInput {
  kind: ProviderKind;
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  maxTokens: number;
  temperature: number | null;
  /** Provider preset, for small per-service tweaks. */
  preset?: string;
  /** Thinking level to request, or null when the model has no thinking control. */
  thinking?: ThinkingLevel | null;
}

export const toWireName = (method: string) => method.replace(/\./g, "__");
export const fromWireName = (name: string) => name.replace(/__/g, ".");

/** One request/response round inside an assistant message. */
interface Round {
  text: string;
  tools: ToolPart[];
  /** Signed reasoning that came before this round's text and tool calls (Claude). */
  thinking: ThinkingPart[];
}

/** Splits an assistant message into rounds: text, then the tool calls it made, then (after results) more text… */
function roundsOf(message: ChatMessage): Round[] {
  const rounds: Round[] = [];
  let current: Round = { text: "", tools: [], thinking: [] };
  for (const part of message.parts) {
    if (part.type === "thinking") {
      if (!part.signature && !part.redacted) continue;
      if (current.tools.length || current.text) {
        rounds.push(current);
        current = { text: "", tools: [], thinking: [] };
      }
      current.thinking.push(part);
      continue;
    }
    if (part.type === "text") {
      if (current.tools.length) {
        rounds.push(current);
        current = { text: "", tools: [], thinking: [] };
      }
      current.text += part.text;
    } else {
      current.tools.push(part);
    }
  }
  if (current.text || current.tools.length) rounds.push(current);
  return rounds;
}

function toolResultText(tool: ToolPart): { text: string; isError: boolean } {
  if (tool.status === "done") return { text: tool.result ?? "null", isError: false };
  if (tool.status === "declined") return { text: "The user declined this action. Don't retry it unless they ask.", isError: true };
  if (tool.status === "error") return { text: `Error: ${tool.error ?? "failed"}`, isError: true };
  return { text: "Not run: the user stopped the response.", isError: true };
}

export function userText(message: ChatMessage): string {
  const text = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
  const blocks: string[] = [];
  const ctx = message.context;
  if (ctx && (ctx.pageTitle || ctx.selection)) {
    const lines = ["<context>"];
    if (ctx.pageTitle) lines.push(`Open page: "${ctx.pageTitle}" (id ${ctx.pageId})`);
    if (ctx.selection) lines.push(`Selected text:\n${ctx.selection}`);
    lines.push("</context>");
    blocks.push(lines.join("\n"));
  }
  if (message.mentions?.length) blocks.push(mentionContext(message.mentions));
  return blocks.length ? `${blocks.join("\n")}\n\n${text}` : text;
}

// ── OpenAI-compatible ──────────────────────────────────────────────────────

function openaiBody(input: BuildInput) {
  const messages: Record<string, unknown>[] = [{ role: "system", content: input.system }];
  for (const message of input.messages) {
    if (message.role === "user") {
      messages.push({ role: "user", content: userText(message) });
      continue;
    }
    for (const round of roundsOf(message)) {
      const entry: Record<string, unknown> = { role: "assistant", content: round.text || (round.tools.length ? null : "") };
      if (round.tools.length) {
        entry.tool_calls = round.tools.map((tool) => ({
          id: tool.id,
          type: "function",
          function: { name: toWireName(tool.name), arguments: JSON.stringify(tool.args ?? {}) },
        }));
      }
      messages.push(entry);
      for (const tool of round.tools) messages.push({ role: "tool", tool_call_id: tool.id, content: toolResultText(tool).text });
    }
  }
  const body: Record<string, unknown> = { model: input.model, messages };
  if (input.tools.length) {
    body.tools = input.tools.map((tool) => ({ type: "function", function: { name: tool.wireName, description: tool.description, parameters: tool.parameters } }));
  }
  const thinking = thinkingPatch("openai", input.model, input.thinking ?? null, input.maxTokens, input.preset);
  Object.assign(body, thinking.body);
  if (input.temperature !== null && !("reasoning_effort" in body)) body.temperature = input.temperature;
  return body;
}

// ── Anthropic ──────────────────────────────────────────────────────────────

type AnthropicMessage = { role: "user" | "assistant"; content: Record<string, unknown>[] };

function anthropicBody(input: BuildInput) {
  const messages: AnthropicMessage[] = [];
  const push = (role: AnthropicMessage["role"], blocks: Record<string, unknown>[]) => {
    if (!blocks.length) return;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks });
  };
  for (const message of input.messages) {
    if (message.role === "user") {
      push("user", [{ type: "text", text: userText(message) || "…" }]);
      continue;
    }
    for (const round of roundsOf(message)) {
      const blocks: Record<string, unknown>[] = [];
      for (const thought of round.thinking) {
        if (thought.redacted) blocks.push({ type: "redacted_thinking", data: thought.redacted });
        else blocks.push({ type: "thinking", thinking: thought.text, signature: thought.signature });
      }
      if (round.text.trim()) blocks.push({ type: "text", text: round.text });
      for (const tool of round.tools) blocks.push({ type: "tool_use", id: tool.id, name: toWireName(tool.name), input: tool.args ?? {} });
      push("assistant", blocks);
      push(
        "user",
        round.tools.map((tool) => {
          const result = toolResultText(tool);
          return { type: "tool_result", tool_use_id: tool.id, content: result.text, ...(result.isError ? { is_error: true } : {}) };
        }),
      );
    }
  }
  const thinking = thinkingPatch("anthropic", input.model, input.thinking ?? null, input.maxTokens, input.preset);
  // Cache the long, stable prefix (system prompt + tools) across turns.
  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: thinking.maxTokens,
    system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
    messages,
  };
  if (input.tools.length) {
    body.tools = input.tools.map((tool, index) => ({
      name: tool.wireName,
      description: tool.description,
      input_schema: tool.parameters,
      ...(index === input.tools.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
    }));
  }
  Object.assign(body, thinking.body);
  if (input.temperature !== null && !thinking.dropTemperature) body.temperature = input.temperature;
  return body;
}

// ── Gemini ─────────────────────────────────────────────────────────────────

function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "default") continue;
    out[key] = geminiSchema(value);
  }
  return out;
}

function geminiBody(input: BuildInput) {
  type Content = { role: "user" | "model"; parts: Record<string, unknown>[] };
  const contents: Content[] = [];
  const push = (role: Content["role"], parts: Record<string, unknown>[]) => {
    if (!parts.length) return;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  };
  for (const message of input.messages) {
    if (message.role === "user") {
      push("user", [{ text: userText(message) || "…" }]);
      continue;
    }
    for (const round of roundsOf(message)) {
      const parts: Record<string, unknown>[] = [];
      if (round.text.trim()) parts.push({ text: round.text });
      for (const tool of round.tools) {
        parts.push({ functionCall: { name: toWireName(tool.name), args: tool.args ?? {} }, ...(tool.signature ? { thoughtSignature: tool.signature } : {}) });
      }
      push("model", parts);
      push(
        "user",
        round.tools.map((tool) => {
          const result = toolResultText(tool);
          let response: unknown = result.text;
          try {
            response = JSON.parse(result.text);
          } catch {
            // plain text
          }
          const wrapped = response && typeof response === "object" && !Array.isArray(response) ? response : { result: response };
          return { functionResponse: { name: toWireName(tool.name), response: result.isError ? { error: result.text } : wrapped } };
        }),
      );
    }
  }
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: input.system }] },
    contents,
    generationConfig: {
      maxOutputTokens: input.maxTokens,
      ...(input.temperature !== null ? { temperature: input.temperature } : {}),
      ...thinkingPatch("gemini", input.model, input.thinking ?? null, input.maxTokens, input.preset).body,
    },
  };
  if (input.tools.length) {
    body.tools = [
      {
        functionDeclarations: input.tools.map((tool) => {
          const params = tool.parameters as { properties?: Record<string, unknown> };
          const empty = !params.properties || Object.keys(params.properties).length === 0;
          return { name: tool.wireName, description: tool.description, ...(empty ? {} : { parametersJsonSchema: geminiSchema(tool.parameters) }) };
        }),
      },
    ];
  }
  return body;
}

export function buildBody(input: BuildInput): Record<string, unknown> {
  if (input.kind === "anthropic") return anthropicBody(input);
  if (input.kind === "gemini") return geminiBody(input);
  return openaiBody(input);
}

// ── streaming ──────────────────────────────────────────────────────────────

let counter = 0;
export const newId = (prefix = "id") => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : { value };
  } catch {
    return { __invalid: raw };
  }
}

export class StreamParser {
  readonly parts: Part[] = [];
  usage: Usage | undefined;
  finish: string | undefined;
  error: string | undefined;
  private openaiTools = new Map<number, { part: ToolPart; raw: string; name: string; generatedId: boolean }>();
  private anthropicBlocks = new Map<number, { part: Part; raw: string }>();

  constructor(private readonly kind: ProviderKind) {}

  private appendText(type: "text" | "thinking", text: string) {
    if (!text) return;
    const last = this.parts[this.parts.length - 1];
    if (last && last.type === type) last.text += text;
    else this.parts.push({ type, text });
  }

  push(line: string) {
    const data = line.trim();
    if (!data || data === "[DONE]") return;
    let event: Record<string, any>;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (this.kind === "anthropic") this.anthropic(event);
    else if (this.kind === "gemini") this.gemini(event);
    else this.openai(event);
  }

  private openai(event: Record<string, any>) {
    if (event.error) {
      this.error = typeof event.error === "string" ? event.error : event.error.message ?? JSON.stringify(event.error);
      return;
    }
    if (event.usage) this.usage = { input: event.usage.prompt_tokens ?? 0, output: event.usage.completion_tokens ?? 0 };
    const choice = event.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? choice.message ?? {};
    this.appendText("thinking", delta.reasoning_content ?? delta.reasoning ?? "");
    if (typeof delta.content === "string") this.appendText("text", delta.content);
    for (const call of delta.tool_calls ?? []) {
      const index = typeof call.index === "number" ? call.index : this.openaiTools.size;
      let entry = this.openaiTools.get(index);
      if (!entry) {
        const part: ToolPart = { type: "tool", id: call.id || newId("call"), name: "", args: {}, status: "pending" };
        entry = { part, raw: "", name: "", generatedId: !call.id };
        this.openaiTools.set(index, entry);
        this.parts.push(part);
      }
      if (call.id && entry.generatedId) {
        entry.part.id = call.id;
        entry.generatedId = false;
      }
      if (call.function?.name) {
        entry.name += call.function.name;
        entry.part.name = fromWireName(entry.name);
      }
      if (call.function?.arguments) {
        entry.raw += call.function.arguments;
        entry.part.args = parseArgs(entry.raw);
      }
    }
    if (choice.finish_reason) this.finish = choice.finish_reason;
  }

  private anthropic(event: Record<string, any>) {
    switch (event.type) {
      case "message_start": {
        const usage = event.message?.usage;
        if (usage) this.usage = { input: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0), output: usage.output_tokens ?? 0 };
        break;
      }
      case "content_block_start": {
        const block = event.content_block ?? {};
        let part: Part;
        if (block.type === "tool_use") part = { type: "tool", id: block.id || newId("toolu"), name: fromWireName(block.name ?? ""), args: {}, status: "pending" };
        else if (block.type === "thinking") part = { type: "thinking", text: block.thinking ?? "", ...(block.signature ? { signature: block.signature } : {}) };
        else if (block.type === "redacted_thinking") part = { type: "thinking", text: "", redacted: block.data ?? "" };
        else part = { type: "text", text: block.text ?? "" };
        this.anthropicBlocks.set(event.index, { part, raw: "" });
        this.parts.push(part);
        break;
      }
      case "content_block_delta": {
        const entry = this.anthropicBlocks.get(event.index);
        const delta = event.delta ?? {};
        if (!entry) break;
        if (delta.type === "text_delta" && entry.part.type === "text") entry.part.text += delta.text ?? "";
        else if (delta.type === "thinking_delta" && entry.part.type === "thinking") entry.part.text += delta.thinking ?? "";
        else if (delta.type === "signature_delta" && entry.part.type === "thinking") entry.part.signature = (entry.part.signature ?? "") + (delta.signature ?? "");
        else if (delta.type === "input_json_delta" && entry.part.type === "tool") {
          entry.raw += delta.partial_json ?? "";
          entry.part.args = parseArgs(entry.raw);
        }
        break;
      }
      case "message_delta":
        if (event.delta?.stop_reason) this.finish = event.delta.stop_reason;
        if (event.usage) this.usage = { input: this.usage?.input ?? event.usage.input_tokens ?? 0, output: event.usage.output_tokens ?? 0 };
        break;
      case "error":
        this.error = event.error?.message ?? "The provider reported an error.";
        break;
    }
  }

  private gemini(event: Record<string, any>) {
    if (event.error) {
      this.error = event.error.message ?? JSON.stringify(event.error);
      return;
    }
    if (event.usageMetadata) this.usage = { input: event.usageMetadata.promptTokenCount ?? 0, output: event.usageMetadata.candidatesTokenCount ?? 0 };
    const candidate = event.candidates?.[0];
    if (!candidate) {
      if (event.promptFeedback?.blockReason) this.error = `Blocked by the provider (${event.promptFeedback.blockReason}).`;
      return;
    }
    for (const part of candidate.content?.parts ?? []) {
      if (part.functionCall) {
        this.parts.push({
          type: "tool",
          id: part.functionCall.id || newId("call"),
          name: fromWireName(part.functionCall.name ?? ""),
          args: part.functionCall.args ?? {},
          status: "pending",
          ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {}),
        });
      } else if (typeof part.text === "string") {
        this.appendText(part.thought ? "thinking" : "text", part.text);
      }
    }
    if (candidate.finishReason) this.finish = candidate.finishReason;
  }

  result(): StepResult {
    return { parts: this.parts, usage: this.usage, finish: this.finish };
  }
}
