import { describe, expect, it } from "vitest";
import { findInDoc, matchIndexFrom, type FindNode } from "./findInDoc";

// Minimal stand-ins for ProseMirror nodes: a doc of textblocks whose inline
// children are text runs or atoms. Positions follow ProseMirror's rules (a
// block opens with one token, so its first character sits at pos + 1).
type Inline = string | { atom: true };

function textNode(text: string): FindNode {
  return { isText: true, text, nodeSize: text.length, descendants: () => undefined };
}

function atomNode(): FindNode {
  return { isAtom: true, isLeaf: true, nodeSize: 1, descendants: () => undefined };
}

function block(children: Inline[]): FindNode {
  const nodes = children.map((child) => (typeof child === "string" ? textNode(child) : atomNode()));
  const size = nodes.reduce((sum, node) => sum + node.nodeSize, 0) + 2;
  return {
    isTextblock: true,
    nodeSize: size,
    forEach(callback) {
      let offset = 0;
      for (const node of nodes) {
        callback(node, offset);
        offset += node.nodeSize;
      }
    },
    descendants: () => undefined,
  };
}

function doc(blocks: FindNode[]): FindNode {
  return {
    nodeSize: blocks.reduce((sum, item) => sum + item.nodeSize, 0) + 2,
    descendants(callback) {
      let pos = 0;
      for (const item of blocks) {
        callback(item, pos);
        pos += item.nodeSize;
      }
    },
  };
}

describe("findInDoc", () => {
  it("finds every match case-insensitively with document positions", () => {
    const d = doc([block(["Alpha beta ALPHA"]), block(["alphabet"])]);
    expect(findInDoc(d, "alpha")).toEqual([
      { from: 1, to: 6 },
      { from: 12, to: 17 },
      // Second block starts at 18 (first block is 16 chars + 2 tokens).
      { from: 19, to: 24 },
    ]);
  });

  it("honours case sensitivity", () => {
    const d = doc([block(["Alpha alpha"])]);
    expect(findInDoc(d, "alpha", { caseSensitive: true })).toEqual([{ from: 7, to: 12 }]);
  });

  it("maps across adjacent text runs (marks) but not across atoms", () => {
    const d = doc([block(["bo", "ld", { atom: true }, "x", "bold"])]);
    // "bo"+"ld" spans two runs; after the atom, "bold" sits at 1 + 2 + 2 + 1 + 1.
    expect(findInDoc(d, "bold")).toEqual([
      { from: 1, to: 5 },
      { from: 7, to: 11 },
    ]);
    expect(findInDoc(d, "ldx")).toEqual([]);
  });

  it("does not overlap matches and respects the limit", () => {
    const d = doc([block(["aaaa"])]);
    expect(findInDoc(d, "aa")).toEqual([
      { from: 1, to: 3 },
      { from: 3, to: 5 },
    ]);
    expect(findInDoc(d, "a", { limit: 3 })).toHaveLength(3);
  });

  it("returns nothing for an empty query", () => {
    expect(findInDoc(doc([block(["text"])]), "")).toEqual([]);
  });
});

describe("matchIndexFrom", () => {
  const matches = [{ from: 5, to: 8 }, { from: 20, to: 23 }];
  it("picks the first match at or after the position and wraps", () => {
    expect(matchIndexFrom(matches, 0)).toBe(0);
    expect(matchIndexFrom(matches, 6)).toBe(1);
    expect(matchIndexFrom(matches, 30)).toBe(0);
    expect(matchIndexFrom([], 3)).toBe(-1);
  });
});
