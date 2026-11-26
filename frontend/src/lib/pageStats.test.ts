import { describe, expect, it } from "vitest";
import { pageContentStats } from "./pageStats";

describe("pageContentStats", () => {
  it("counts words, todos, headings, links and databases", () => {
    const blocks = [
      { id: "h", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Plan for today" }], children: [] },
      { id: "p", type: "paragraph", content: [{ type: "text", text: "Read the " }, { type: "link", href: "https://example.com", content: [{ type: "text", text: "docs" }] }], children: [] },
      { id: "t1", type: "checkListItem", props: { checked: true }, content: [{ type: "text", text: "Done thing" }], children: [] },
      { id: "t2", type: "checkListItem", props: { checked: false }, content: [{ type: "text", text: "Open thing" }], children: [] },
      { id: "d", type: "database", props: { databaseId: "db1" }, children: [] },
    ];
    const stats = pageContentStats(blocks, (id) => (id === "db1" ? "Tasks" : ""));
    expect(stats.blocks).toBe(5);
    expect(stats.words).toBe(10);
    expect(stats.todos).toEqual({ total: 2, done: 1, open: 1 });
    expect(stats.headings).toEqual([{ level: 2, text: "Plan for today", blockId: "h" }]);
    expect(stats.links.map((link) => link.url)).toEqual(["https://example.com"]);
    expect(stats.databases).toEqual([{ id: "db1", title: "Tasks", blockId: "d" }]);
  });
});
