import { describe, expect, it } from "vitest";
import { METHODS } from "../sdk-host/spec";
import { allHandlers } from "../sdk-host/registry";
const HANDLERS = allHandlers();
import { buildBody, fromWireName, StreamParser, toWireName } from "./protocol";
import { methodsFor, toolDefs } from "./tools";
import type { ChatMessage } from "./types";

const conversation: ChatMessage[] = [
  { id: "u1", role: "user", createdAt: 1, parts: [{ type: "text", text: "Rename this page" }] },
  {
    id: "a1",
    role: "assistant",
    createdAt: 2,
    parts: [
      { type: "text", text: "Renaming." },
      { type: "tool", id: "call_1", name: "pages.rename", args: { id: "p1", title: "New" }, status: "done", result: '{"ok":true}' },
    ],
  },
];

describe("assistant wire protocol", () => {
  it("round-trips tool names", () => {
    expect(toWireName("pages.create")).toBe("pages__create");
    expect(fromWireName("pages__create")).toBe("pages.create");
  });

  it("parses OpenAI tool-call deltas across chunks", () => {
    const parser = new StreamParser("openai");
    parser.push(JSON.stringify({ choices: [{ delta: { content: "Hi " } }] }));
    parser.push(JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "pages__", arguments: '{"ti' } }] } }] }));
    parser.push(JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "create", arguments: 'tle":"A"}' } }] }, finish_reason: "tool_calls" }] }));
    parser.push(JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    parser.push("[DONE]");
    expect(parser.parts[0]).toEqual({ type: "text", text: "Hi " });
    expect(parser.parts[1]).toMatchObject({ type: "tool", id: "c1", name: "pages.create", args: { title: "A" } });
    expect(parser.finish).toBe("tool_calls");
    expect(parser.usage).toEqual({ input: 10, output: 5 });
  });

  it("parses Anthropic content blocks", () => {
    const parser = new StreamParser("anthropic");
    parser.push(JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 7, output_tokens: 1 } } }));
    parser.push(JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    parser.push(JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done" } }));
    parser.push(JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "editor__insertMarkdown" } }));
    parser.push(JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"markdown":"# Hi"}' } }));
    parser.push(JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 12 } }));
    expect(parser.parts[0]).toEqual({ type: "text", text: "Done" });
    expect(parser.parts[1]).toMatchObject({ type: "tool", id: "toolu_1", name: "editor.insertMarkdown", args: { markdown: "# Hi" } });
  });

  it("parses Gemini function calls", () => {
    const parser = new StreamParser("gemini");
    parser.push(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Looking" }, { functionCall: { name: "search__pages", args: { query: "x" } } }] } }] }));
    expect(parser.parts[0]).toEqual({ type: "text", text: "Looking" });
    expect(parser.parts[1]).toMatchObject({ type: "tool", name: "search.pages", args: { query: "x" } });
  });

  it("captures stream errors", () => {
    const parser = new StreamParser("openai");
    parser.push(JSON.stringify({ error: { message: "Invalid API key" } }));
    expect(parser.error).toBe("Invalid API key");
  });

  for (const kind of ["openai", "anthropic", "gemini"] as const) {
    it(`builds a ${kind} body with tool results paired to calls`, () => {
      const tools = toolDefs("edit", { webAccess: false }).slice(0, 3);
      const body = buildBody({ kind, model: "m", system: "sys", messages: conversation, tools, maxTokens: 1000, temperature: null });
      const text = JSON.stringify(body);
      expect(text).toContain("pages__rename");
      // Gemini pairs results with calls by name and order rather than by id.
      expect(text).toContain(kind === "gemini" ? "functionResponse" : "call_1");
      expect(text).toContain("Rename this page");
      expect(text).not.toContain("pages.rename\"");
    });
  }
});

describe("assistant tools", () => {
  it("scopes tools by mode", () => {
    const ask = methodsFor("ask", { webAccess: true });
    const edit = methodsFor("edit", { webAccess: true });
    const creator = methodsFor("creator", { webAccess: true });
    expect(ask.every((method) => method.tier === "read")).toBe(true);
    expect(edit.some((method) => method.tier === "content")).toBe(true);
    expect(edit.some((method) => method.tier === "app")).toBe(false);
    expect(creator.length).toBeGreaterThan(edit.length);
    expect(ask.some((method) => method.name.startsWith("web."))).toBe(true);
    expect(methodsFor("ask", { webAccess: false }).some((method) => method.name.startsWith("web."))).toBe(false);
  });

  it("only exposes tool names providers accept", () => {
    for (const tool of toolDefs("creator", { webAccess: true })) expect(tool.wireName).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });
});

describe("sdk parity", () => {
  it("every spec method has a handler and every handler is specified", () => {
    const specified = METHODS.map((method) => method.name).sort();
    const handled = Object.keys(HANDLERS).sort();
    expect(specified.filter((name) => !HANDLERS[name])).toEqual([]);
    expect(handled.filter((name) => !specified.includes(name))).toEqual([]);
  });
});
