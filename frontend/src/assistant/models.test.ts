import { describe, expect, it } from "vitest";
import { fillPrompt, matchCommands, slashQuery, SLASH_COMMANDS } from "./commands";
import type { SlashContext } from "./commands";
import { mentionContext } from "./mentions";
import { claudeAdaptive, defaultContextWindow, defaultThinkingLevels, displayModel, effectiveThinking, resolveModel, thinkingPatch } from "./models";
import { buildBody, StreamParser, userText } from "./protocol";
import type { ChatMessage } from "./types";

describe("models", () => {
  it("strips routing prefixes from model ids", () => {
    expect(displayModel("models/gemini-2.5-pro")).toBe("gemini-2.5-pro");
    expect(displayModel("anthropic/claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(displayModel("gpt-5")).toBe("gpt-5");
  });

  it("knows which Claude models take adaptive thinking", () => {
    expect(claudeAdaptive("claude-opus-5-5")).toBe(true);
    expect(claudeAdaptive("claude-sonnet-4-6")).toBe(true);
    expect(claudeAdaptive("claude-sonnet-4-5")).toBe(false);
    expect(claudeAdaptive("claude-3-7-sonnet-20250219")).toBe(false);
  });

  it("guesses context windows and lets settings win", () => {
    expect(defaultContextWindow("gemini", "gemini-2.5-flash")).toBe(1_048_576);
    expect(defaultContextWindow("anthropic", "claude-haiku-5-5")).toBe(200_000);
    expect(defaultContextWindow("openai", "some-local-model")).toBe(200_000);
    const resolved = resolveModel({ "p/m": { contextWindow: 32_000 } }, { "p/m": 64_000 }, "p", "openai", "m");
    expect(resolved).toMatchObject({ contextWindow: 32_000, knownWindow: true });
    expect(resolveModel({}, { "p/m": 64_000 }, "p", "openai", "m").contextWindow).toBe(64_000);
  });

  it("offers thinking levels only for models that reason", () => {
    expect(defaultThinkingLevels("anthropic", "claude-opus-5-5")).toContain("max");
    expect(defaultThinkingLevels("openai", "gpt-4o")).toEqual([]);
    expect(defaultThinkingLevels("openai", "o3-mini")).toContain("high");
    expect(effectiveThinking("max", ["auto", "low"])).toBe("auto");
    expect(effectiveThinking("low", [])).toBeNull();
  });

  it("builds provider-specific thinking fields", () => {
    expect(thinkingPatch("anthropic", "claude-sonnet-5-5", "high", 8192).body).toEqual({ thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "high" } });
    const legacy = thinkingPatch("anthropic", "claude-sonnet-4-5", "medium", 4096);
    expect(legacy.body).toEqual({ thinking: { type: "enabled", budget_tokens: 8192 } });
    expect(legacy.maxTokens).toBeGreaterThan(8192);
    expect(thinkingPatch("openai", "o3", "high", 4096).body).toEqual({ reasoning_effort: "high" });
    expect(thinkingPatch("openai", "o3", "high", 4096, "openrouter").body).toEqual({ reasoning: { effort: "high" } });
    expect(thinkingPatch("gemini", "gemini-2.5-pro", "off", 4096).body).toEqual({ thinkingConfig: { includeThoughts: false, thinkingBudget: 0 } });
  });
});

describe("thinking on the wire", () => {
  const messages: ChatMessage[] = [
    { id: "u", role: "user", createdAt: 1, parts: [{ type: "text", text: "hi" }] },
    {
      id: "a",
      role: "assistant",
      createdAt: 2,
      parts: [
        { type: "thinking", text: "let me look", signature: "sig-1" },
        { type: "tool", id: "t1", name: "pages.list", args: {}, status: "done", result: "[]" },
      ],
    },
  ];

  it("sends signed thinking back to Claude before tool use and drops temperature", () => {
    const body = buildBody({ kind: "anthropic", model: "claude-sonnet-5-5", system: "s", messages, tools: [], maxTokens: 4096, temperature: 0.5, thinking: "high" }) as {
      messages: { role: string; content: { type: string; signature?: string }[] }[];
      temperature?: number;
      thinking?: unknown;
    };
    const assistant = body.messages.find((message) => message.role === "assistant")!;
    expect(assistant.content[0]).toMatchObject({ type: "thinking", signature: "sig-1" });
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
  });

  it("keeps signatures from the stream", () => {
    const parser = new StreamParser("anthropic");
    parser.push(JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    parser.push(JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } }));
    parser.push(JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "abc" } }));
    const thinking = parser.parts.find((part) => part.type === "thinking");
    expect(thinking).toMatchObject({ text: "hmm", signature: "abc" });
  });
});

describe("mentions", () => {
  it("puts mentioned content before the user's text", () => {
    const message: ChatMessage = {
      id: "u",
      role: "user",
      createdAt: 1,
      parts: [{ type: "text", text: "What's missing?" }],
      mentions: [{ kind: "page", id: "p1", label: "Plan", content: "# Plan\n- ship" }],
    };
    const text = userText(message);
    expect(text).toContain('<mention kind="page" id="p1" title="Plan">');
    expect(text.indexOf("# Plan")).toBeLessThan(text.indexOf("What's missing?"));
    expect(mentionContext([])).toBe("");
  });
});

describe("slash commands", () => {
  const ctx: SlashContext = {
    newChat() {},
    setMode() {},
    setView() {},
    toggleWeb() {},
    openModels() {},
    setThinking() {},
    thinkingLevels: [],
    regenerate() {},
    compact() {},
    canRetry: false,
    canCompact: false,
  };

  it("parses the command being typed", () => {
    expect(slashQuery("/tr")).toEqual({ name: "tr", arg: "" });
    expect(slashQuery("/translate French")).toEqual({ name: "translate", arg: "French" });
    expect(slashQuery("hello /x")).toBeNull();
  });

  it("hides commands that can't run now", () => {
    const names = matchCommands("", ctx).map((command) => command.name);
    expect(names).not.toContain("retry");
    expect(names).not.toContain("think");
    expect(names).toContain("new");
  });

  it("fills prompt templates", () => {
    const translate = SLASH_COMMANDS.find((command) => command.name === "translate")!;
    expect(fillPrompt(translate, "French")).toContain("into French");
    const summarize = SLASH_COMMANDS.find((command) => command.name === "summarize")!;
    expect(fillPrompt(summarize, "")).toBe("Summarize the open page in a few short bullet points.");
  });

  it("has unique names", () => {
    const names = SLASH_COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
