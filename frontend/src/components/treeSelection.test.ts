import { describe, expect, it } from "vitest";
import { rangeBetween, topLevelOnly, visibleOrder } from "./treeSelection";

const children = new Map([
  ["", [{ id: "a" }, { id: "b" }, { id: "c" }]],
  ["a", [{ id: "a1" }, { id: "a2" }]],
  ["b", [{ id: "b1" }]],
]);
const parents: Record<string, string> = { a1: "a", a2: "a", b1: "b" };

describe("page tree selection", () => {
  it("lists only rows under expanded parents", () => {
    expect(visibleOrder(children, new Set())).toEqual(["a", "b", "c"]);
    expect(visibleOrder(children, new Set(["a"]))).toEqual(["a", "a1", "a2", "b", "c"]);
  });

  it("selects a range in either direction", () => {
    const order = visibleOrder(children, new Set(["a"]));
    expect(rangeBetween(order, "a1", "b")).toEqual(["a1", "a2", "b"]);
    expect(rangeBetween(order, "c", "a2")).toEqual(["a2", "b", "c"]);
  });

  it("falls back to the clicked row without a visible anchor", () => {
    expect(rangeBetween(["a", "b"], null, "b")).toEqual(["b"]);
    expect(rangeBetween(["a", "b"], "gone", "a")).toEqual(["a"]);
    expect(rangeBetween(["a", "b"], "a", "gone")).toEqual([]);
  });

  it("drops pages already covered by a selected parent", () => {
    const order = visibleOrder(children, new Set(["a", "b"]));
    expect(topLevelOnly(["b1", "a2", "a", "c"], (id) => parents[id], order)).toEqual(["a", "b1", "c"]);
  });
});
