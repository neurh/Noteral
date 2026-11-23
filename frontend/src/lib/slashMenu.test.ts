import { describe, expect, it } from "vitest";
import { rankSlashItems } from "./slashMenu";

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
