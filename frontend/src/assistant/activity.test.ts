import { describe, expect, it } from "vitest";
import { canRunInParallel, runLimited } from "./tools";
import { changesOf, ledgerOf } from "./ledger";
import { hostOf, sourcesOf } from "./sources";
import { agentTitle } from "./agents";
import { formatDuration, layoutReply } from "./Activity";
import type { Chat, ChatMessage, Part, ToolPart } from "./types";

const tool = (id: string, name: string, args: Record<string, unknown> = {}, extra: Partial<ToolPart> = {}): ToolPart => ({
  type: "tool",
  id,
  name,
  args,
  status: "done",
  result: "{}",
  ...extra,
});

const reply = (parts: Part[]): ChatMessage => ({ id: "m1", role: "assistant", parts, createdAt: 1000, endedAt: 9000 });

describe("layoutReply", () => {
  it("folds runs of the same tool and keeps the final text as the answer", () => {
    const layout = layoutReply([
      { type: "thinking", text: "Let me look.", startedAt: 1000, endedAt: 2000 },
      tool("a", "pages.read", { pageId: "p1" }),
      tool("b", "pages.read", { pageId: "p2" }),
      { type: "text", text: "Checking the web too." },
      tool("c", "web.search", { query: "x" }),
      { type: "text", text: "Here is the answer." },
    ]);
    expect(layout.steps.map((step) => step.kind)).toEqual(["thinking", "tools", "note", "tools"]);
    const reads = layout.steps[1];
    expect(reads.kind === "tools" && reads.tools.length).toBe(2);
    expect(layout.answer).toBe("Here is the answer.");
    expect(layout.pending).toEqual([]);
  });

  it("puts approvals and questions in pending, and agents in their own step", () => {
    const layout = layoutReply([
      tool("a", "agents.run", { title: "Look", task: "t" }, { status: "running" }),
      tool("b", "pages.moveToTrash", {}, { status: "awaiting" }),
      tool("c", "ui.ask", { question: "?" }, { status: "asking" }),
    ]);
    expect(layout.steps.map((step) => step.kind)).toEqual(["agent"]);
    expect(layout.pending.map((part) => part.id)).toEqual(["b", "c"]);
  });

  it("treats a plain text reply as just an answer", () => {
    const layout = layoutReply([{ type: "text", text: "Hi" }]);
    expect(layout.steps).toEqual([]);
    expect(layout.answer).toBe("Hi");
  });
});

describe("sources and changes", () => {
  it("collects search hits and fetched pages, read wins", () => {
    const search = JSON.stringify({ results: [{ title: "Doc", url: "https://www.example.com/a" }, { title: "Other", url: "https://b.org/x" }] });
    const message = reply([
      tool("s", "web.search", { query: "q" }, { result: search }),
      tool("f", "web.fetch", { url: "https://www.example.com/a" }, { result: JSON.stringify({ title: "Doc page", text: "…" }) }),
    ]);
    const sources = sourcesOf(message);
    expect(sources.map((item) => item.url)).toContain("https://www.example.com/a");
    expect(sources.find((item) => item.url === "https://www.example.com/a")?.read).toBe(true);
    expect(hostOf("https://www.example.com/a")).toBe("example.com");
  });

  it("lists completed writes, not reads or declined calls", () => {
    const message = reply([
      tool("r", "pages.read", { pageId: "p" }),
      tool("w", "pages.create", { title: "New" }),
      tool("d", "pages.moveToTrash", { pageId: "p" }, { status: "declined" }),
    ]);
    expect(changesOf(message).map((change) => change.method)).toEqual(["pages.create"]);
  });

  it("summarizes a chat", () => {
    const chat: Chat = {
      id: "c",
      title: "T",
      mode: "edit",
      createdAt: 0,
      updatedAt: 0,
      messages: [
        reply([
          tool("w", "pages.create", { title: "New" }),
          tool("a", "agents.run", { title: "Research", task: "t" }, { startedAt: 1000, endedAt: 4000, agent: { title: "Research", task: "t", status: "done", steps: [], text: "r", startedAt: 1000, endedAt: 4000 } }),
        ]),
      ],
    };
    const ledger = ledgerOf(chat, 10_000);
    expect(ledger.changes).toHaveLength(1);
    expect(ledger.agents).toHaveLength(1);
    expect(ledger.agents[0].title).toBe("Research");
  });
});

describe("parallel work", () => {
  it("only runs safe calls in parallel", () => {
    expect(canRunInParallel("agents.run")).toBe(true);
    expect(canRunInParallel("pages.read")).toBe(true);
    expect(canRunInParallel("pages.create")).toBe(false);
    expect(canRunInParallel("navigation.openPage")).toBe(false);
  });

  it("respects the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const jobs = [0, 1, 2, 3, 4].map((index) => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(index);
      active -= 1;
    });
    await runLimited(jobs, 2);
    expect(peak).toBe(2);
    expect(order.sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("names agents and formats durations", () => {
    expect(agentTitle({ title: "Find prices" })).toBe("Find prices");
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatDuration(4_200)).toBe("4s");
  });
});
