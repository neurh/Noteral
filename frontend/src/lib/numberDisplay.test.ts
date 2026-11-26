import { describe, expect, it } from "vitest";
import { displayMax, displayStyle, displayTone, normalizeNumberDisplay, progressRatio, ratingFill, showsNumber } from "./numberDisplay";

describe("number display helpers", () => {
  it("falls back to a plain number", () => {
    expect(displayStyle(undefined)).toBe("number");
    expect(displayStyle({ style: "nope" as never })).toBe("number");
    expect(displayStyle({ style: "ring" })).toBe("ring");
  });

  it("picks the full value", () => {
    expect(displayMax(undefined)).toBe(100);
    expect(displayMax({ style: "bar" }, "percent")).toBe(1);
    expect(displayMax({ style: "bar", max: 250 }, "percent")).toBe(250);
    expect(displayMax({ style: "bar", max: -3 })).toBe(100);
    expect(displayMax({ style: "rating" })).toBe(5);
    expect(displayMax({ style: "rating", max: 99 })).toBe(10);
    expect(displayMax({ style: "rating", max: 3.4 })).toBe(3);
  });

  it("clamps the progress ratio", () => {
    expect(progressRatio(50, 100)).toBe(0.5);
    expect(progressRatio(150, 100)).toBe(1);
    expect(progressRatio(-5, 100)).toBe(0);
    expect(progressRatio("25", 100)).toBe(0.25);
    expect(progressRatio("", 100)).toBeNull();
    expect(progressRatio(null, 100)).toBeNull();
    expect(progressRatio(Number.NaN, 100)).toBeNull();
    expect(progressRatio(5, 0)).toBeNull();
  });

  it("rounds ratings to half stars", () => {
    expect(ratingFill(3.2, 5)).toBe(3);
    expect(ratingFill(3.3, 5)).toBe(3.5);
    expect(ratingFill(9, 5)).toBe(5);
    expect(ratingFill("x", 5)).toBeNull();
    expect(ratingFill(0.6, 5, "percent")).toBe(3);
    expect(ratingFill(1, 5, "percent")).toBe(5);
  });

  it("reads tone and number visibility", () => {
    expect(displayTone(undefined)).toBe("default");
    expect(displayTone({ style: "bar", color: "green" })).toBe("green");
    expect(displayTone({ style: "bar", color: "mauve" as never })).toBe("default");
    expect(showsNumber({ style: "bar" })).toBe(true);
    expect(showsNumber({ style: "bar", showNumber: false })).toBe(false);
  });
});

describe("normalizeNumberDisplay", () => {
  it("accepts a style name or an object", () => {
    expect(normalizeNumberDisplay("ring", "Done")).toEqual({ style: "ring" });
    expect(normalizeNumberDisplay({ style: "bar", color: "blue", max: 10, showNumber: false }, "Done")).toEqual({ style: "bar", color: "blue", max: 10, showNumber: false });
  });

  it("drops defaults", () => {
    expect(normalizeNumberDisplay({ style: "bar", color: "default", showNumber: true }, "Done")).toEqual({ style: "bar" });
  });

  it("clears with null or the number style", () => {
    expect(normalizeNumberDisplay(null, "Done", { style: "bar" })).toBeUndefined();
    expect(normalizeNumberDisplay({ style: "number", color: "red" }, "Done", { style: "bar", color: "red" })).toBeUndefined();
  });

  it("merges over the current display", () => {
    expect(normalizeNumberDisplay({ color: "green" }, "Done", { style: "ring", max: 8 })).toEqual({ style: "ring", color: "green", max: 8 });
    expect(normalizeNumberDisplay({ style: "bar" }, "Done", { style: "ring", max: 8, showNumber: false })).toEqual({ style: "bar", max: 8, showNumber: false });
  });

  it("does not carry a divisor into a rating", () => {
    expect(normalizeNumberDisplay({ style: "rating" }, "Score", { style: "bar", max: 500 })).toEqual({ style: "rating" });
    expect(normalizeNumberDisplay({ style: "bar" }, "Score", { style: "rating", max: 4 })).toEqual({ style: "bar" });
  });

  it("explains bad input", () => {
    expect(() => normalizeNumberDisplay({ style: "pie" }, "Done")).toThrow(/Unknown display style "pie"\. Use one of: number, bar, ring, rating, heat\./);
    expect(() => normalizeNumberDisplay({ style: "bar", color: "mauve" }, "Done")).toThrow(/Unknown display color/);
    expect(() => normalizeNumberDisplay({ style: "bar", max: 0 }, "Done")).toThrow(/positive number/);
    expect(() => normalizeNumberDisplay({ style: "rating", max: 12 }, "Done")).toThrow(/1 to 10 whole stars/);
    expect(() => normalizeNumberDisplay({ style: "rating", max: 2.5 }, "Done")).toThrow(/whole stars/);
    expect(() => normalizeNumberDisplay({ style: "bar", showNumber: "yes" }, "Done")).toThrow(/true or false/);
    expect(() => normalizeNumberDisplay(42, "Done")).toThrow(/must be an object/);
  });
});
