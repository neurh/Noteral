/**
 * How full the context window is, and what's in it. Shared by the composer's context
 * ring and the store's auto-compact check.
 */
import type { ChatMessage } from "./types";

/**
 * The messages a request actually sends: everything from the latest compaction summary
 * on (earlier messages stay in the chat for reading but aren't sent).
 */
export function activeHistory(messages: ChatMessage[]): ChatMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) if (messages[index].summary) return messages.slice(index);
  return messages;
}

export function partTokens(message: ChatMessage): number {
  let chars = 0;
  for (const part of message.parts) {
    if (part.type === "text" || part.type === "thinking") chars += part.text.length;
    else chars += JSON.stringify(part.args ?? {}).length + (part.result?.length ?? 0) + (part.error?.length ?? 0);
  }
  for (const mention of message.mentions ?? []) chars += (mention.content?.length ?? 0) + 60;
  for (const file of message.attachments ?? []) chars += file.kind === "text" ? file.data.length : file.kind === "image" ? 6000 : Math.min(file.data.length, 400_000) / 3;
  return Math.ceil(chars / 4);
}

/** Tokens the next request will send: the provider's last count plus anything newer, or an estimate. */
export function contextUsage(all: ChatMessage[], draftTokens: number): { used: number; exact: boolean } {
  const messages = activeHistory(all);
  let lastIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant" && messages[index].usage?.input) {
      lastIndex = index;
      break;
    }
  }
  // System prompt + tool schemas aren't in the messages; ~6k is typical.
  const overhead = 6000;
  if (lastIndex < 0) return { used: overhead + messages.reduce((sum, message) => sum + partTokens(message), 0) + draftTokens, exact: false };
  const usage = messages[lastIndex].usage!;
  const after = messages.slice(lastIndex + 1).reduce((sum, message) => sum + partTokens(message), 0);
  return { used: usage.input + usage.output + after + draftTokens, exact: true };
}

export interface ContextSlice {
  key: string;
  label: string;
  tokens: number;
  color: string;
}

/** Roughly where the context goes, scaled to the measured total. */
export function contextBreakdown(all: ChatMessage[], draftTokens: number, used: number): ContextSlice[] {
  const messages = activeHistory(all);
  const sums = { system: 6000, you: 0, replies: 0, tools: 0, mentions: 0, draft: draftTokens };
  for (const message of messages) {
    for (const mention of message.mentions ?? []) sums.mentions += Math.ceil(((mention.content?.length ?? 0) + 60) / 4);
    for (const part of message.parts) {
      if (part.type === "tool") sums.tools += Math.ceil((JSON.stringify(part.args ?? {}).length + (part.result?.length ?? 0) + (part.error?.length ?? 0)) / 4);
      else if (message.role === "user") sums.you += Math.ceil(part.text.length / 4);
      else sums.replies += Math.ceil(part.text.length / 4);
    }
  }
  const raw = Object.values(sums).reduce((a, b) => a + b, 0) || 1;
  const scale = used / raw;
  const slices: ContextSlice[] = [
    { key: "system", label: "Instructions & tools", tokens: sums.system, color: "var(--text-faint)" },
    { key: "you", label: "Your messages", tokens: sums.you, color: "var(--accent)" },
    { key: "replies", label: "Replies & thinking", tokens: sums.replies, color: "color-mix(in srgb, var(--accent) 50%, var(--bg-sunken))" },
    { key: "tools", label: "Tool calls & results", tokens: sums.tools, color: "var(--warning)" },
    { key: "mentions", label: "Attached pages", tokens: sums.mentions, color: "var(--success)" },
    { key: "draft", label: "Draft", tokens: sums.draft, color: "var(--border-strong)" },
  ];
  return slices.map((slice) => ({ ...slice, tokens: Math.round(slice.tokens * scale) })).filter((slice) => slice.tokens > 0);
}


/**
 * A plain-text transcript for summarizing: no tool schemas needed, long tool results cut.
 * Sending this instead of the raw history keeps the summary request small and valid for
 * every provider (some refuse tool blocks in a request without tools).
 */
export function transcriptOf(messages: ChatMessage[], resultChars = 600): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.summary) {
      lines.push(`[Earlier summary]\n${message.parts.map((part) => (part.type === "text" ? part.text : "")).join("")}`);
      continue;
    }
    if (message.role === "user") {
      const text = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
      const extras = [
        ...(message.mentions ?? []).map((mention) => `@${mention.label}`),
        ...(message.attachments ?? []).map((file) => `file ${file.name}`),
      ];
      lines.push(`User: ${text}${extras.length ? ` (attached: ${extras.join(", ")})` : ""}`);
      continue;
    }
    for (const part of message.parts) {
      if (part.type === "text" && part.text.trim()) lines.push(`Assistant: ${part.text.trim()}`);
      else if (part.type === "tool") {
        const args = JSON.stringify(part.args ?? {});
        const out = part.status === "done" ? part.result ?? "" : part.status === "error" ? `Error: ${part.error ?? ""}` : part.status;
        const cut = out.length > resultChars ? `${out.slice(0, resultChars)}… (${out.length - resultChars} more chars)` : out;
        lines.push(`Tool ${part.name}(${args.length > 400 ? `${args.slice(0, 400)}…` : args}) → ${cut}`);
      }
    }
    if (message.error) lines.push(`(Error: ${message.error})`);
  }
  return lines.join("\n\n");
}

export const SUMMARY_PROMPT =
  "Summarize the conversation below so the assistant can continue it without the original. Keep: the user's goal and instructions, decisions, everything that was created or changed (with exact page, database, widget and plugin ids and names), facts found (with source URLs), open questions and next steps. Be complete but brief; use short Markdown bullets. Reply with the summary only.";
