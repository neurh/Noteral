import { describe, expect, it } from "vitest";
import { buildBody } from "./protocol";
import { canContinue, NOT_RUN, retryReason, trimToLastStep } from "./retry";
import type { ChatMessage, Part, ToolPart } from "./types";

const tool = (id: string, status: ToolPart["status"], extra: Partial<ToolPart> = {}): ToolPart => ({ type: "tool", id, name: "pages.get", args: { id: "p1" }, status, ...extra });

describe("retryReason", () => {
  it("retries rate limits, overloaded and 5xx providers", () => {
    expect(retryReason({ status: 429, error: "rate limit exceeded" })).toBe("busy");
    expect(retryReason({ status: 503, error: "Service Unavailable" })).toBe("busy");
    expect(retryReason({ status: 529, error: "Overloaded" })).toBe("busy");
    expect(retryReason({ status: 500, error: "invalid something internal" })).toBe("busy");
    // In-stream error events arrive on a 200 response.
    expect(retryReason({ status: 200, error: "Overloaded" })).toBe("busy");
    expect(retryReason({ status: 200, error: "Internal server error" })).toBe("busy");
  });

  it("retries network failures, timeouts and empty streams", () => {
    expect(retryReason({ error: "network error: read tcp: connection reset by peer" })).toBe("network");
    expect(retryReason({ status: 200, error: "stream interrupted: unexpected EOF" })).toBe("network");
    expect(retryReason({ status: 408, error: "Request Timeout" })).toBe("network");
    expect(retryReason({ error: "could not connect to Ollama at http://localhost:11434 — is it running?" })).toBe("network");
    expect(retryReason({ status: 200, parts: [] })).toBe("empty");
  });

  it("doesn't retry stops, bad requests, auth or output limits", () => {
    expect(retryReason({ cancelled: true, error: "network error: x" })).toBeNull();
    expect(retryReason({ status: 400, error: "messages: roles must alternate" })).toBeNull();
    expect(retryReason({ status: 401, error: "invalid x-api-key" })).toBeNull();
    expect(retryReason({ status: 403, error: "forbidden" })).toBeNull();
    expect(retryReason({ status: 404, error: "model not found" })).toBeNull();
    expect(retryReason({ finish: "length", parts: [] })).toBeNull();
    expect(retryReason({ finish: "max_tokens", error: "Overloaded" })).toBeNull();
    expect(retryReason({ fatal: true, error: "conversation is too large to send" })).toBeNull();
    expect(retryReason({ status: 200, error: "prompt is too long: 210000 tokens" })).toBeNull();
    expect(retryReason({ status: 200, error: "Blocked by the provider (SAFETY)." })).toBeNull();
    // A finished reply, even a short one, is fine.
    expect(retryReason({ status: 200, finish: "stop", parts: [] })).toBeNull();
    expect(retryReason({ status: 200, parts: [{ type: "text", text: "Hi" }] })).toBeNull();
  });
});

describe("trimToLastStep", () => {
  it("keeps finished steps and drops the failed one", () => {
    const parts: Part[] = [
      { type: "thinking", text: "plan", signature: "sig" },
      { type: "text", text: "Looking it up." },
      tool("a", "done", { result: "{}" }),
      tool("b", "error", { error: "Page not found" }),
      { type: "text", text: "Now the next pa" },
      tool("c", "error", { error: NOT_RUN }),
    ];
    expect(trimToLastStep(parts)).toEqual(parts.slice(0, 4));
  });

  it("drops calls that never ran even inside the kept step", () => {
    const parts: Part[] = [tool("a", "error", { error: NOT_RUN }), tool("b", "done", { result: "1" }), tool("c", "declined")];
    expect(trimToLastStep(parts)).toEqual([parts[1], parts[2]]);
  });

  it("drops sub-agents that were stopped so they run again", () => {
    const parts: Part[] = [tool("a", "done", { result: "1" }), tool("b", "error", { error: "Stopped." })];
    expect(trimToLastStep(parts)).toEqual([parts[0]]);
  });

  it("returns null when no step finished", () => {
    expect(trimToLastStep([])).toBeNull();
    expect(trimToLastStep([{ type: "text", text: "Half an ans" }])).toBeNull();
    expect(trimToLastStep([{ type: "text", text: "x" }, tool("a", "error", { error: NOT_RUN })])).toBeNull();
  });

  it("only offers to continue failed or stopped replies with progress", () => {
    const base: ChatMessage = { id: "m", role: "assistant", createdAt: 0, parts: [tool("a", "done", { result: "1" }), { type: "text", text: "Done." }] };
    expect(canContinue(base)).toBe(false);
    expect(canContinue({ ...base, error: "Overloaded" })).toBe(true);
    expect(canContinue({ ...base, stopped: true })).toBe(true);
    expect(canContinue({ ...base, error: "Overloaded", parts: [{ type: "text", text: "Hal" }] })).toBe(false);
  });
});

describe("resuming a trimmed reply", () => {
  const user: ChatMessage = { id: "u", role: "user", createdAt: 0, parts: [{ type: "text", text: "Summarize my page" }] };
  const failed: ChatMessage = {
    id: "r",
    role: "assistant",
    createdAt: 0,
    error: "Overloaded",
    parts: [{ type: "text", text: "Reading it." }, tool("a", "done", { result: '{"title":"T"}', signature: "gsig" }), { type: "text", text: "The page is ab" }],
  };
  const resumed: ChatMessage = { ...failed, error: undefined, parts: trimToLastStep(failed.parts)! };
  const input = { model: "m", system: "s", messages: [user, resumed], tools: [], maxTokens: 1000, temperature: null };

  it("ends with the tool results for OpenAI", () => {
    const body = buildBody({ ...input, kind: "openai" }) as { messages: { role: string; tool_calls?: unknown[] }[] };
    expect(body.messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(body.messages[2].tool_calls).toHaveLength(1);
  });

  it("alternates roles and ends on the user's tool_result for Anthropic", () => {
    const body = buildBody({ ...input, kind: "anthropic" }) as { messages: { role: string; content: { type: string }[] }[] };
    expect(body.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(body.messages[2].content.map((block) => block.type)).toEqual(["tool_result"]);
  });

  it("ends on a user functionResponse for Gemini and keeps the thought signature", () => {
    const body = buildBody({ ...input, kind: "gemini" }) as { contents: { role: string; parts: Record<string, unknown>[] }[] };
    expect(body.contents.map((content) => content.role)).toEqual(["user", "model", "user"]);
    expect(body.contents[1].parts[1].thoughtSignature).toBe("gsig");
    expect(Object.keys(body.contents[2].parts[0])).toEqual(["functionResponse"]);
  });
});
