import { describe, expect, it } from "vitest";
import { arrangeSlashItems, rankSlashItems } from "./slashMenu";

const items = [
  { title: "Heading 1", aliases: ["h1", "title"], group: "Headings" },
  { title: "Bullet List", aliases: ["ul", "list"], group: "Basic blocks" },
  { title: "Table", aliases: ["grid"], group: "Advanced" },
  { title: "Database", aliases: ["table", "board"], group: "Noteral" },
  { title: "Linked database", aliases: ["embed"], group: "Noteral" },
];

describe("rankSlashItems", () => {
  it("keeps grouped order with no query", () => {
    expect(rankSlashItems(items, "  ")).toBe(items);
  });

  it("ranks title prefixes above aliases and drops groups", () => {
    const ranked = rankSlashItems(items, "table");
    expect(ranked.map((item) => item.title)).toEqual(["Table", "Database"]);
    expect(ranked.every((item) => item.group === undefined)).toBe(true);
  });

  it("matches word starts and substrings", () => {
    expect(rankSlashItems(items, "data").map((item) => item.title)).toEqual(["Database", "Linked database"]);
    expect(rankSlashItems(items, "list").map((item) => item.title)).toEqual(["Bullet List"]);
    expect(rankSlashItems(items, "h1").map((item) => item.title)).toEqual(["Heading 1"]);
    expect(rankSlashItems(items, "zzz")).toEqual([]);
  });
});

describe("arrangeSlashItems", () => {
  it("moves known keys into Noteral's groups and keeps other groups after them", () => {
    const arranged = arrangeSlashItems([
      { key: "heading_4", title: "Heading 4", group: "Subheadings" },
      { key: "image", title: "Image", group: "Media" },
      { title: "Focus", group: "Plugins" },
      { key: "callout", title: "Callout", group: "Noteral" },
      { key: "paragraph", title: "Paragraph", group: "Basic blocks" },
      { title: "Kanban card", group: "Custom blocks" },
      { key: "database", title: "Database", group: "Noteral" },
    ]);
    expect(arranged.map((item) => `${item.group}:${item.title}`)).toEqual([
      "Basic blocks:Paragraph",
      "Basic blocks:Callout",
      "Insert:Database",
      "Media:Image",
      "More headings:Heading 4",
      "Plugins:Focus",
      "Custom blocks:Kanban card",
    ]);
  });
});
