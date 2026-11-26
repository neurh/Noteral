import { describe, expect, it } from "vitest";
import { COALESCE_MS, HISTORY_LIMIT, canRedo, canUndo, createHistory, editKind, record, redo, undo } from "./editHistory";

describe("editHistory", () => {
  it("classifies edits", () => {
    expect(editKind("ab", "abc")).toBe("type");
    expect(editKind("ac", "abc")).toBe("type");
    expect(editKind("abc", "ab")).toBe("delete");
    expect(editKind("ab", "ab\n")).toBe("replace");
    expect(editKind("ab", "abcdef")).toBe("replace");
    expect(editKind("abc", "xyz")).toBe("replace");
  });

  it("merges quick typing into one step and splits after a pause", () => {
    let h = createHistory("");
    h = record(h, { text: "a", caret: 1 }, undefined, 1000);
    h = record(h, { text: "ab", caret: 2 }, undefined, 1100);
    h = record(h, { text: "abc", caret: 3 }, undefined, 1200);
    expect(h.past.map((s) => s.text)).toEqual([""]);
    h = record(h, { text: "abcd", caret: 4 }, undefined, 1200 + COALESCE_MS + 1);
    expect(h.past.map((s) => s.text)).toEqual(["", "abc"]);
  });

  it("never merges replacements, and a delete after typing is a new step", () => {
    let h = createHistory("x");
    h = record(h, { text: "x(", caret: 2 }, "replace", 10);
    h = record(h, { text: "x()", caret: 3 }, "replace", 20);
    expect(h.past.length).toBe(2);
    h = record(h, { text: "x()a", caret: 4 }, undefined, 30);
    h = record(h, { text: "x()", caret: 3 }, undefined, 40);
    expect(h.past.map((s) => s.text)).toEqual(["x", "x(", "x()", "x()a"]);
  });

  it("undoes and redoes with carets, and a new edit clears redo", () => {
    let h = createHistory("one", 3);
    h = record(h, { text: "one two", caret: 7 }, "replace", 0);
    h = record(h, { text: "one two three", caret: 13 }, "replace", 0);
    h = undo(h);
    expect(h.present).toEqual({ text: "one two", caret: 7 });
    h = undo(h);
    expect(h.present).toEqual({ text: "one", caret: 3 });
    expect(canUndo(h)).toBe(false);
    h = undo(h);
    expect(h.present.text).toBe("one");
    h = redo(h);
    expect(h.present.text).toBe("one two");
    expect(canRedo(h)).toBe(true);
    h = record(h, { text: "one!", caret: 4 }, "replace", 0);
    expect(canRedo(h)).toBe(false);
  });

  it("typing right after an undo starts a new step", () => {
    let h = createHistory("");
    h = record(h, { text: "a", caret: 1 }, undefined, 0);
    h = record(h, { text: "ab", caret: 2 }, undefined, 0);
    h = undo(h);
    h = record(h, { text: "x", caret: 1 }, undefined, 1);
    expect(h.past.map((s) => s.text)).toEqual([""]);
    expect(undo(h).present.text).toBe("");
  });

  it("ignores caret-only changes and caps its length", () => {
    let h = createHistory("a");
    h = record(h, { text: "a", caret: 0 });
    expect(h.past.length).toBe(0);
    expect(h.present.caret).toBe(0);
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = record(h, { text: `a${i}`, caret: 0 }, "replace", i);
    expect(h.past.length).toBe(HISTORY_LIMIT);
  });
});
