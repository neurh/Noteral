import { describe, expect, it } from "vitest";
import { countWords, sameOutline, statsOfDoc, type DocNode } from "./docStats";

function node(name: string, children: DocNode[] = [], attrs: Record<string, unknown> = {}, textblock = false): DocNode {
  return {
    type: { name },
    attrs,
    isText: false,
    isTextblock: textblock,
    childCount: children.length,
    child: (index) => children[index],
  };
}

function text(value: string): DocNode {
  return { type: { name: "text" }, attrs: {}, isText: true, isTextblock: false, text: value, childCount: 0, child: () => { throw new Error("leaf"); } };
}

function block(id: string, content: DocNode, nested: DocNode[] = []): DocNode {
  const parts = [content];
  if (nested.length) parts.push(node("blockGroup", nested));
  return node("blockContainer", parts, { id });
}

const para = (...inline: DocNode[]) => node("paragraph", inline, {}, true);
const heading = (level: number, value: string) => node("heading", [text(value)], { level }, true);

describe("countWords", () => {
  it("counts latin words, contractions and CJK characters", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("Hello, world — it's fine")).toBe(4);
    expect(countWords("well-known 42 items")).toBe(3);
    expect(countWords("你好 world")).toBe(3);
  });
});

describe("statsOfDoc", () => {
  it("walks nested blocks, counts words and builds the outline", () => {
    const doc = node("doc", [
      node("blockGroup", [
        block("h1", heading(1, "Plan")),
        block("p1", para(text("Ship the "), text("database")), [block("p2", para(text("nested child")))]),
        block("h2", heading(2, "Notes")),
        block("empty", heading(3, "")),
      ]),
    ]);
    const stats = statsOfDoc(doc, () => undefined, true);
    expect(stats.blockCount).toBe(5);
    expect(stats.wordCount).toBe(1 + 3 + 2 + 1);
    expect(stats.outline).toEqual([
      { id: "h1", text: "Plan", level: 1 },
      { id: "h2", text: "Notes", level: 2 },
    ]);
    expect(stats.text).toBe("Plan\nShip the database\nnested child\nNotes");
  });

  it("reads page link titles fresh instead of caching them", () => {
    const link = node("pageLink", [], { pageId: "a" });
    const doc = node("doc", [node("blockGroup", [block("p", para(text("See "), link))])]);
    let title = "Alpha";
    expect(statsOfDoc(doc, () => title, true).text).toBe("See Alpha");
    title = "Beta release";
    const again = statsOfDoc(doc, () => title, true);
    expect(again.text).toBe("See Beta release");
    expect(again.wordCount).toBe(3);
  });
});

describe("sameOutline", () => {
  it("compares items by value", () => {
    const a = [{ id: "x", text: "One", level: 1 }];
    expect(sameOutline(a, [{ id: "x", text: "One", level: 1 }])).toBe(true);
    expect(sameOutline(a, [{ id: "x", text: "One", level: 2 }])).toBe(false);
    expect(sameOutline(a, [])).toBe(false);
  });
});
