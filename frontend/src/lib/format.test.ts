import { describe, expect, it } from "vitest";
import { plainSnippet, relativeTime, splitSnippet } from "./format";

describe("search snippet formatting", () => {
  it("splits FTS highlight markers", () => {
    expect(splitSnippet("before \uE000match\uE001 after")).toEqual([
      { text: "before ", mark: false },
      { text: "match", mark: true },
      { text: " after", mark: false },
    ]);
  });

  it("handles multiple and unbalanced markers", () => {
    expect(splitSnippet("\uE000one\uE001 two \uE000three")).toEqual([
      { text: "one", mark: true },
      { text: " two ", mark: false },
      { text: "three", mark: true },
    ]);
    expect(plainSnippet("\uE000one\uE001 two")).toBe("one two");
  });
});

describe("relative time", () => {
  it("formats recent timestamps and missing values", () => {
    expect(relativeTime(new Date().toISOString())).toBe("just now");
    expect(relativeTime(undefined)).toBe("");
    expect(relativeTime("not a date")).toBe("");
  });
});
