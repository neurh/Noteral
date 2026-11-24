import { describe, expect, it } from "vitest";
import { parseBlocks } from "./markdownView";

describe("parseBlocks", () => {
  it("parses headings, paragraphs, code and rules", () => {
    const blocks = parseBlocks("# Title\n\nSome *text*\nmore\n\n```ts\nconst a = 1;\n```\n\n---");
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "code", "rule"]);
    expect(blocks[2]).toMatchObject({ lang: "ts", code: "const a = 1;", open: false });
  });

  it("keeps an unterminated fence open while streaming", () => {
    expect(parseBlocks("```js\nlet x")[0]).toMatchObject({ kind: "code", open: true, code: "let x" });
  });

  it("parses nested and task lists", () => {
    const [list] = parseBlocks("- [x] done\n- [ ] todo\n  - child\n- plain");
    expect(list).toMatchObject({ kind: "list", ordered: false });
    if (list.kind !== "list") throw new Error();
    expect(list.items.map((item) => item.checked)).toEqual([true, false, null]);
    expect(list.items[1].body).toContain("- child");
  });

  it("parses ordered lists with a start number", () => {
    expect(parseBlocks("3. a\n4. b")[0]).toMatchObject({ kind: "list", ordered: true, start: 3 });
  });

  it("parses tables with alignment", () => {
    const [table] = parseBlocks("| A | B |\n|:--|--:|\n| 1 | 2 |");
    expect(table).toMatchObject({ kind: "table", header: ["A", "B"], align: ["left", "right"], rows: [["1", "2"]] });
  });

  it("parses quotes", () => {
    expect(parseBlocks("> quoted\n> line")[0]).toMatchObject({ kind: "quote", body: "quoted\nline" });
  });
});
