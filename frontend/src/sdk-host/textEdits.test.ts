import { describe, expect, it } from "vitest";
import { applyEdits } from "./textEdits";
import { splitChange } from "./handlers";

describe("applyEdits", () => {
  it("replaces a unique exact match", () => {
    expect(applyEdits("a b c", [{ find: "b", replace: "B" }])).toEqual({ text: "a B c", replaced: 1, loose: 0 });
  });
  it("refuses ambiguous matches unless all is set", () => {
    expect(() => applyEdits("x x", [{ find: "x", replace: "y" }])).toThrow(/appears 2 times/);
    expect(applyEdits("x x", [{ find: "x", replace: "y", all: true }]).text).toBe("y y");
  });
  it("tolerates whitespace differences", () => {
    const out = applyEdits("<div>\n    <b>Hi</b>\n</div>", [{ find: "<div> <b>Hi</b>", replace: "<div><i>Yo</i>" }]);
    expect(out.text).toBe("<div><i>Yo</i>\n</div>");
    expect(out.loose).toBe(1);
  });
  it("points at the nearest line when nothing matches", () => {
    expect(() => applyEdits("one\ncolor: red;\nthree", [{ find: "color: blue;", replace: "x" }])).toThrow(/line 2/);
  });
  it("applies edits in order and is all-or-nothing", () => {
    expect(applyEdits("a", [{ find: "a", replace: "b" }, { find: "b", replace: "c" }]).text).toBe("c");
    expect(() => applyEdits("a", [{ find: "a", replace: "b" }, { find: "zzz", replace: "c" }])).toThrow(/Edit 2/);
  });
  it("does not expand $ patterns in replacements", () => {
    expect(applyEdits("price", [{ find: "price", replace: "$& $1" }]).text).toBe("$& $1");
  });
});

describe("splitChange", () => {
  const S = "\n\n";
  const parts = ["A", "B", "C"];
  it("finds a single changed block", () => {
    expect(splitChange(parts, "A\n\nX\n\nC", S)).toEqual({ head: 1, tail: 1, middle: "X" });
  });
  it("detects a removal", () => {
    expect(splitChange(parts, "A\n\nC", S)).toEqual({ head: 1, tail: 1, middle: "" });
    expect(splitChange(["A", "B"], "A", S)).toEqual({ head: 1, tail: 0, middle: "" });
  });
  it("detects an insertion", () => {
    expect(splitChange(["A", "C"], "A\n\nB\n\nC", S)).toEqual({ head: 1, tail: 1, middle: "B" });
    expect(splitChange(["A"], "A\n\nB", S)).toEqual({ head: 1, tail: 0, middle: "B" });
    expect(splitChange(["B"], "A\n\nB", S)).toEqual({ head: 0, tail: 1, middle: "A" });
  });
  it("handles edits in the first and last blocks", () => {
    expect(splitChange(parts, "Z\n\nB\n\nC", S)).toEqual({ head: 0, tail: 2, middle: "Z" });
    expect(splitChange(parts, "A\n\nB\n\nZ", S)).toEqual({ head: 2, tail: 0, middle: "Z" });
  });
  it("handles a change spanning blocks", () => {
    expect(splitChange(parts, "A\n\nBC merged", S)).toEqual({ head: 1, tail: 0, middle: "BC merged" });
  });
});
