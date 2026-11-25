import { describe, expect, it } from "vitest";
import { activeHistory, contextUsage, transcriptOf } from "./context";
import { buildBody, leanHistory, userText } from "./protocol";
import { CORE_TOOLS, LOAD_TOOL, chatToolDefs, methodsFor, resolveLoad, toolCatalog } from "./tools";
import type { ChatMessage, ToolPart } from "./types";

const settings = { webAccess: true };
let n = 0;
const user = (text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: `u${n++}`, role: "user", createdAt: 0, parts: [{ type: "text", text }], ...extra });
const tool = (result: string): ToolPart => ({ type: "tool", id: `t${n++}`, name: "pages.read", args: { pageId: "p" }, status: "done", result });
const reply = (...parts: ChatMessage["parts"]): ChatMessage => ({ id: `a${n++}`, role: "assistant", createdAt: 0, parts });

describe("lazy tool loading", () => {
  it("sends only the core set plus tools.load", () => {
    for (const mode of ["ask", "edit", "creator"] as const) {
      const all = methodsFor(mode, settings);
      const defs = chatToolDefs(mode, settings, []);
      expect(defs.length).toBeLessThan(all.length);
      expect(defs.map((def) => def.method)).toContain(LOAD_TOOL);
      // Every core tool exists in the spec for its mode.
      const names = new Set(all.map((method) => method.name));
      for (const name of CORE_TOOLS[mode]) expect(names.has(name), `${mode}: ${name}`).toBe(true);
    }
  });
  it("is at least 2x smaller than sending everything in Creator mode", () => {
    const size = (defs: unknown) => JSON.stringify(defs).length;
    expect(size(chatToolDefs("creator", settings, [])) * 2).toBeLessThan(size(chatToolDefs("creator", settings, "all")));
  });
  it("resolves namespaces and exact names, reporting unknowns", () => {
    const { methods, unknown } = resolveLoad("creator", settings, ["home", "databases.addView", "nope", "pages.fly"]);
    expect(methods.every((name) => name.startsWith("home.") || name === "databases.addView")).toBe(true);
    expect(methods).toContain("databases.addView");
    expect(methods.some((name) => name.startsWith("home."))).toBe(true);
    expect(unknown).toEqual(["nope", "pages.fly"]);
  });
  it("never loads tools above the mode's tier", () => {
    const { methods } = resolveLoad("ask", settings, ["appearance", "pages.create"]);
    expect(methods).not.toContain("pages.create");
    expect(methods.some((name) => name === "appearance.setTokens")).toBe(false);
  });
  it("adds loaded tools and drops them from the catalog", () => {
    const loaded = resolveLoad("creator", settings, ["home"]).methods;
    const defs = chatToolDefs("creator", settings, loaded).map((def) => def.method);
    for (const name of loaded) expect(defs).toContain(name);
    expect(toolCatalog("creator", settings, [])).toMatch(/^- home /m);
    expect(toolCatalog("creator", settings, loaded)).not.toMatch(/^- home /m);
  });
  it("drops tools.load once everything is loaded", () => {
    const every = methodsFor("ask", settings).map((method) => method.name);
    expect(chatToolDefs("ask", settings, every).map((def) => def.method)).not.toContain(LOAD_TOOL);
  });
});

describe("leanHistory", () => {
  const big = "x".repeat(5000);
  it("trims earlier tool results and keeps the current turn whole", () => {
    const history = [user("first"), reply(tool(big), { type: "text", text: "done" }), user("second"), reply(tool(big))];
    const lean = leanHistory(history);
    const old = (lean[1].parts[0] as ToolPart).result!;
    expect(old.length).toBeLessThan(1600);
    expect(old).toMatch(/left out to save context/);
    expect((lean[3].parts[0] as ToolPart).result).toBe(big);
    // The stored history is untouched.
    expect((history[1].parts[0] as ToolPart).result).toBe(big);
  });
  it("keeps short results as they are", () => {
    const history = [user("a"), reply(tool("short")), user("b")];
    expect(leanHistory(history)[1]).toBe(history[1]);
  });
  it("drops image data from older user messages only", () => {
    const file = { id: "f", name: "a.png", mime: "image/png", size: 10, kind: "image" as const, data: "AAAA" };
    const history = [user("1", { attachments: [file] }), user("2"), user("3"), user("4", { attachments: [file] })];
    const lean = leanHistory(history, 2);
    expect(lean[0].attachments![0].data).toBe("");
    expect(lean[3].attachments![0].data).toBe("AAAA");
  });
});

describe("attachments in requests", () => {
  const image = { id: "f", name: "chart.png", mime: "image/png", size: 10, kind: "image" as const, data: "AAAA" };
  const text = { id: "g", name: "notes.md", mime: "text/markdown", size: 5, kind: "text" as const, data: "# hi" };
  it("inlines text files and names binary files for text-only models", () => {
    const out = userText(user("look", { attachments: [image, text] }), false);
    expect(out).toContain("# hi");
    expect(out).toContain("chart.png");
    expect(out).toContain("look");
  });
  it("sends images as provider-native parts", () => {
    const messages = [user("what is this?", { attachments: [image] })];
    const openai = JSON.stringify(buildBody({ kind: "openai", model: "gpt-4o", system: "s", messages, tools: [], maxTokens: 100, temperature: null, vision: true }));
    expect(openai).toContain("data:image/png;base64,AAAA");
    const anthropic = JSON.stringify(buildBody({ kind: "anthropic", model: "claude-x", system: "s", messages, tools: [], maxTokens: 100, temperature: null, vision: true }));
    expect(anthropic).toContain('"type":"image"');
    const gemini = JSON.stringify(buildBody({ kind: "gemini", model: "gemini-x", system: "s", messages, tools: [], maxTokens: 100, temperature: null, vision: true }));
    expect(gemini).toContain("inlineData");
  });
});

describe("compaction", () => {
  it("only sends messages from the latest summary on", () => {
    const summary = user("Summary…", { summary: { messages: 3, at: 0, auto: true } });
    const history = [user("a"), reply({ type: "text", text: "b" }), summary, user("c")];
    expect(activeHistory(history)).toEqual([summary, history[3]]);
    expect(contextUsage(history, 0).used).toBeLessThanOrEqual(contextUsage([history[0], history[1], ...history.slice(2)], 0).used);
  });
  it("writes a compact transcript with cut tool results", () => {
    const out = transcriptOf([user("hello"), reply(tool("y".repeat(3000)), { type: "text", text: "ok" })], 100);
    expect(out).toContain("hello");
    expect(out).toContain("pages.read");
    expect(out.length).toBeLessThan(600);
  });
});
