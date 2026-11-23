import { describe, expect, it } from "vitest";
import {
  addTab,
  applySplitDelta,
  createPane,
  findPane,
  firstPane,
  flatTabs,
  moveTab,
  normalizeLayout,
  paneList,
  paneOfTab,
  parseLayout,
  removePane,
  removeTab,
  resetSplit,
  restoreLayout,
  serializeLayout,
  splitPaneWith,
  splitWithTab,
  updatePane,
} from "./panes";
import type { PaneNode, SplitNode } from "./panes";

function tabsOf(node: Parameters<typeof paneList>[0]) {
  return paneList(node).map((pane) => pane.tabs.join(","));
}

describe("layout basics", () => {
  it("derives the flat tab list in pane order", () => {
    const pane = createPane(["a", "b"], "b");
    expect(flatTabs(pane)).toEqual(["a", "b"]);
    expect(paneList(pane)).toHaveLength(1);
    expect(pane.activeTabId).toBe("b");
  });

  it("falls back to the first tab for an unknown active tab", () => {
    expect(createPane(["a", "b"], "missing").activeTabId).toBe("a");
  });

  it("finds panes and the pane of a tab", () => {
    const left = createPane(["a"], "a");
    const right = createPane(["b"], "b");
    const layout = splitPaneWith(left, left.id, "right", right);
    expect(findPane(layout, right.id)?.tabs).toEqual(["b"]);
    expect(paneOfTab(layout, "b")?.id).toBe(right.id);
    expect(paneOfTab(layout, "zz")).toBeNull();
  });

  it("adds a tab to a pane and activates it", () => {
    const pane = createPane(["a"], "a");
    const next = addTab(pane, pane.id, "b");
    expect(flatTabs(next)).toEqual(["a", "b"]);
    expect(paneOfTab(next, "b")?.activeTabId).toBe("b");
  });

  it("appends the tab when the pane is missing", () => {
    const pane = createPane(["a"], "a");
    const next = addTab(pane, "nope", "b");
    expect(tabsOf(next)).toEqual(["a,b"]);
  });
});

describe("moving tabs", () => {
  it("reorders within a pane in front of a reference tab", () => {
    const pane = createPane(["a", "b", "c"], "a");
    const next = moveTab(pane, "c", pane.id, "a");
    expect(flatTabs(next)).toEqual(["c", "a", "b"]);
    expect(paneOfTab(next, "c")?.activeTabId).toBe("c");
  });

  it("appends when the reference tab is null", () => {
    const pane = createPane(["a", "b", "c"], "a");
    expect(flatTabs(moveTab(pane, "a", pane.id, null))).toEqual(["b", "c", "a"]);
  });

  it("ignores an unknown reference tab", () => {
    const pane = createPane(["a", "b"], "a");
    expect(flatTabs(moveTab(pane, "a", pane.id, "nope"))).toEqual(["b", "a"]);
  });

  it("moves a tab to another pane and keeps both active tabs valid", () => {
    const left = createPane(["a", "b"], "a");
    const right = createPane(["c"], "c");
    const layout = splitPaneWith(left, left.id, "right", right);
    const next = moveTab(layout, "a", right.id, "c");
    expect(tabsOf(next)).toEqual(["b", "a,c"]);
    expect(paneOfTab(next, "a")?.activeTabId).toBe("a");
    expect(paneOfTab(next, "b")?.activeTabId).toBe("b");
  });

  it("collapses the source pane when its last tab leaves", () => {
    const left = createPane(["a"], "a");
    const right = createPane(["b"], "b");
    const layout = splitPaneWith(left, left.id, "right", right);
    const next = moveTab(layout, "a", right.id, null);
    expect(next.type).toBe("pane");
    expect(flatTabs(next)).toEqual(["b", "a"]);
  });

  it("is a no-op for a tab that is not open", () => {
    const pane = createPane(["a"], "a");
    expect(moveTab(pane, "b", pane.id, null)).toBe(pane);
  });
});

describe("removing tabs", () => {
  it("activates the left neighbor when the active tab closes", () => {
    const pane = createPane(["a", "b", "c"], "c");
    const next = removeTab(pane, "c");
    expect(flatTabs(next!)).toEqual(["a", "b"]);
    expect(firstPane(next!)?.activeTabId).toBe("b");
  });

  it("activates the first remaining tab when the first tab closes", () => {
    const pane = createPane(["a", "b"], "a");
    expect(firstPane(removeTab(pane, "a")!)?.activeTabId).toBe("b");
  });

  it("collapses a split when a pane empties", () => {
    const left = createPane(["a"], "a");
    const right = createPane(["b"], "b");
    const layout = splitPaneWith(left, left.id, "right", right);
    const next = removeTab(layout, "b");
    expect(next?.type).toBe("pane");
    expect(flatTabs(next!)).toEqual(["a"]);
  });

  it("returns null when the last tab goes away", () => {
    expect(removeTab(createPane(["a"], "a"), "a")).toBeNull();
  });
});

describe("splitting", () => {
  it("places a dragged tab alone in a new pane on the requested side", () => {
    const pane = createPane(["a", "b"], "b");
    const right = splitWithTab(pane, "a", pane.id, "right");
    expect(tabsOf(right)).toEqual(["b", "a"]);
    const left = splitWithTab(pane, "a", pane.id, "left");
    expect(tabsOf(left)).toEqual(["a", "b"]);
    const bottom = splitWithTab(pane, "a", pane.id, "bottom");
    expect(bottom.type === "split" && bottom.dir).toBe("column");
  });

  it("refuses to split a pane's only tab away from itself", () => {
    const pane = createPane(["a"], "a");
    expect(splitWithTab(pane, "a", pane.id, "right")).toBe(pane);
  });

  it("splits a tab out of one pane onto the edge of another", () => {
    const left = createPane(["a"], "a");
    const right = createPane(["b"], "b");
    const layout = splitPaneWith(left, left.id, "right", right);
    const next = splitWithTab(layout, "a", right.id, "top");
    // The emptied left pane collapses while its tab moves to the new top pane.
    expect(paneList(next)).toHaveLength(2);
    expect(next.type === "split" && next.dir).toBe("column");
    expect(paneList(next)[0].tabs).toEqual(["a"]);
    expect(paneOfTab(next, "b")?.tabs).toEqual(["b"]);
    expect(flatTabs(next).sort()).toEqual(["a", "b"]);
  });
});

describe("resizing", () => {
  function makeSplit() {
    const left = createPane(["a"], "a");
    const right = createPane(["b"], "b");
    const layout = splitPaneWith(left, left.id, "right", right);
    if (layout.type !== "split") throw new Error("expected split");
    return { layout, split: layout };
  }

  it("grows the first child and shrinks the neighbor by the same amount", () => {
    const { layout, split } = makeSplit();
    const next = applySplitDelta(layout, split.id, 0, 0.2);
    expect(next.type === "split" && next.sizes).toEqual([0.7, 0.3]);
  });

  it("clamps both children to the minimum share", () => {
    const { layout, split } = makeSplit();
    const next = applySplitDelta(layout, split.id, 0, -10);
    expect(next.type === "split" && next.sizes).toEqual([0.12, 0.88]);
    expect(next.type === "split" && next.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("ignores deltas for other splits", () => {
    const { layout } = makeSplit();
    expect(applySplitDelta(layout, "split-other", 0, 0.2)).toEqual(layout);
  });

  it("resets a split to equal sizes", () => {
    const { layout, split } = makeSplit();
    const grown = applySplitDelta(layout, split.id, 0, 0.2);
    const reset = resetSplit(grown, split.id);
    expect(reset.type === "split" && reset.sizes).toEqual([0.5, 0.5]);
  });
});

describe("normalizeLayout", () => {
  it("prunes unknown and duplicate tabs and appends missing ones to the hint pane", () => {
    const pane = createPane(["a", "b", "gone", "a"], "a");
    const right = createPane(["c"], "c");
    const layout = splitPaneWith(pane, pane.id, "right", right);
    const raw = (JSON.parse(serializeLayout(layout, pane.id, "")) as { root: unknown }).root;
    const next = normalizeLayout(raw, ["a", "b", "c", "d"], pane.id);
    expect(tabsOf(next!)).toEqual(["a,b,d", "c"]);
  });

  it("collapses empty panes and single-child splits", () => {
    const left = createPane([], "");
    const right = createPane(["a"], "a");
    const raw = { type: "split", id: "s1", dir: "row", sizes: [0.5, 0.5], children: [left, right] };
    const next = normalizeLayout(raw, ["a"]);
    expect(next?.type).toBe("pane");
    expect(flatTabs(next!)).toEqual(["a"]);
  });

  it("rejects malformed input", () => {
    expect(normalizeLayout(null, ["a"])).toBeNull();
    expect(normalizeLayout({ type: "nope" }, ["a"])).toBeNull();
    expect(normalizeLayout({ type: "pane", tabs: "a" }, ["a"])).toBeNull();
  });

  it("regenerates duplicate pane ids", () => {
    const raw = {
      type: "split",
      id: "s1",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [
        { type: "pane", id: "dup", tabs: ["a"], activeTabId: "a" },
        { type: "pane", id: "dup", tabs: ["b"], activeTabId: "b" },
      ],
    };
    const next = normalizeLayout(raw, ["a", "b"]);
    const ids = paneList(next!).map((item) => item.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("persistence", () => {
  it("round-trips layout, focus and maximize", () => {
    const left = createPane(["a"], "a");
    const right = createPane(["b"], "b");
    const layout = splitPaneWith(left, left.id, "right", right);
    const raw = serializeLayout(layout, right.id, right.id);
    const restored = restoreLayout(raw, ["a", "b"], "b");
    expect(flatTabs(restored.layout)).toEqual(["a", "b"]);
    expect(restored.focusedPaneId).toBe(right.id);
    expect(restored.maximizedPaneId).toBe(right.id);
    expect(restored.activeTabId).toBe("b");
  });

  it("focuses the pane that owns the active tab", () => {
    const left = createPane(["a"], "a");
    const right = createPane(["b"], "b");
    const layout = splitPaneWith(left, left.id, "right", right);
    const restored = restoreLayout(serializeLayout(layout, right.id, ""), ["a", "b"], "a");
    expect(restored.focusedPaneId).toBe(left.id);
    expect(restored.activeTabId).toBe("a");
  });

  it("falls back to a single pane for bad json or missing tabs", () => {
    const restored = restoreLayout("{not json", ["a", "b"], "b");
    expect(paneList(restored.layout)).toHaveLength(1);
    expect(flatTabs(restored.layout)).toEqual(["a", "b"]);
    expect(restored.activeTabId).toBe("b");
    expect(parseLayout("{not json")).toBeNull();
  });

  it("drops maximize when only one pane survives", () => {
    const pane = createPane(["a"], "a");
    const raw = serializeLayout(pane, pane.id, "pane-missing");
    const restored = restoreLayout(raw, ["a"], "a");
    expect(restored.maximizedPaneId).toBe("");
  });

  it("appends tabs that the persisted layout never saw", () => {
    const pane = createPane(["a"], "a");
    const restored = restoreLayout(serializeLayout(pane, pane.id, ""), ["a", "b", "c"], "a");
    expect(flatTabs(restored.layout)).toEqual(["a", "b", "c"]);
    expect(restored.activeTabId).toBe("a");
  });

  it("reassigns the active tab when persisted focus is stale", () => {
    const left = createPane(["a"], "a");
    const right = createPane(["b"], "b");
    const layout = splitPaneWith(left, left.id, "right", right);
    const restored = restoreLayout(serializeLayout(layout, right.id, ""), ["a", "b"], "b");
    expect(restored.focusedPaneId).toBe(right.id);
  });

  it("appends to the first pane when the hint pane is gone", () => {
    const raw = { type: "pane", id: "p1", tabs: ["a"], activeTabId: "a" };
    const next = normalizeLayout(raw, ["a", "b"], "p2");
    const panes = paneList(next!);
    expect(panes).toHaveLength(1);
    expect(panes[0].tabs).toEqual(["a", "b"]);
  });

  it("updates a pane in place without touching siblings", () => {
    const left = createPane(["a"], "a");
    const right = createPane(["b"], "b");
    const layout = splitPaneWith(left, left.id, "right", right);
    const next = updatePane(layout, right.id, (pane: PaneNode) => ({ ...pane, activeTabId: "b" }));
    expect(findPane(next, left.id)).toBe(findPane(layout, left.id));
  });
});

describe("removePane", () => {
  it("removes a pane and collapses the split", () => {
    const left = createPane(["a"], "a");
    const right = createPane(["b"], "b");
    const layout = splitPaneWith(left, left.id, "right", right);
    const next = removePane(layout, right.id);
    expect(next).not.toBeNull();
    expect(paneList(next!).map((pane) => pane.id)).toEqual([left.id]);
    expect(flatTabs(next!)).toEqual(["a"]);
  });

  it("renormalizes the remaining sizes to one", () => {
    const a = createPane(["a"], "a");
    const b = createPane(["b"], "b");
    const c = createPane(["c"], "c");
    const layout: SplitNode = { type: "split", id: "s1", dir: "row", sizes: [0.5, 0.3, 0.2], children: [a, b, c] };
    const next = removePane(layout, b.id) as SplitNode;
    expect(next.children.map((child) => child.id)).toEqual([a.id, c.id]);
    expect(next.sizes).toHaveLength(2);
    expect(next.sizes[0]).toBeCloseTo(0.5 / 0.7, 5);
    expect(next.sizes[1]).toBeCloseTo(0.2 / 0.7, 5);
  });

  it("removes a nested pane and keeps the outer split", () => {
    const a = createPane(["a"], "a");
    const b = createPane(["b"], "b");
    const c = createPane(["c"], "c");
    const inner = splitPaneWith(a, a.id, "right", b);
    const outer: SplitNode = { type: "split", id: "s2", dir: "column", sizes: [0.4, 0.6], children: [inner, c] };
    const next = removePane(outer, b.id);
    expect(paneList(next!).map((pane) => pane.id)).toEqual([a.id, c.id]);
    expect(next!.type).toBe("split");
  });

  it("returns the node unchanged when the pane is missing", () => {
    const layout = createPane(["a"], "a");
    expect(removePane(layout, "nope")).toBe(layout);
  });
});
