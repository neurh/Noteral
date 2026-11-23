// Split-pane layout model.
//
// A workspace layout is a tree of panes. Splits are n-ary rows/columns with
// fractional sizes (summing to 1) so a pane can be divided repeatedly without
// nesting artifacts. The store keeps `tabs` as a derived flat list in
// `paneList` order, which keeps the rest of the app (plugins, history,
// persistence) working against a flat tab list.
//
// Every function here is pure: it takes a layout and returns a new one.

export type SplitDirection = "row" | "column";
export type SplitSide = "left" | "right" | "top" | "bottom";
export type PaneDropZone = SplitSide | "center";

export interface PaneNode {
  type: "pane";
  id: string;
  tabs: string[];
  activeTabId: string;
}

export interface SplitNode {
  type: "split";
  id: string;
  dir: SplitDirection;
  sizes: number[];
  children: LayoutNode[];
}

export type LayoutNode = PaneNode | SplitNode;

export interface RestoredLayout {
  layout: LayoutNode;
  focusedPaneId: string;
  maximizedPaneId: string;
  activeTabId: string;
}

/** Hit area of a pane-resize divider, in px. Keep in sync with styles.css. */
export const SPLITTER_SIZE = 7;

/** A pane may never shrink below this share of the pair being resized. */
export const MIN_PANE_FRACTION = 0.12;

let sequence = 0;

function nextId(kind: "pane" | "split"): string {
  sequence += 1;
  return `${kind}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeSizes(sizes: number[]): number[] {
  const clean = sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 1));
  const sum = clean.reduce((total, size) => total + size, 0);
  return sum > 0 ? clean.map((size) => size / sum) : clean.map(() => 1 / clean.length);
}

export function createPane(tabs: string[] = [], activeTabId = ""): PaneNode {
  const clean = [...tabs];
  return {
    type: "pane",
    id: nextId("pane"),
    tabs: clean,
    activeTabId: clean.includes(activeTabId) ? activeTabId : clean[0] ?? "",
  };
}

export function layoutFromTabs(tabs: string[], activeTabId: string): LayoutNode {
  return createPane(tabs, activeTabId);
}

export function paneList(node: LayoutNode): PaneNode[] {
  if (node.type === "pane") return [node];
  return node.children.flatMap(paneList);
}

export function flatTabs(node: LayoutNode): string[] {
  return paneList(node).flatMap((pane) => pane.tabs);
}

export function findPane(node: LayoutNode, paneId: string): PaneNode | null {
  if (node.type === "pane") return node.id === paneId ? node : null;
  for (const child of node.children) {
    const found = findPane(child, paneId);
    if (found) return found;
  }
  return null;
}

export function paneOfTab(node: LayoutNode, tabId: string): PaneNode | null {
  return paneList(node).find((pane) => pane.tabs.includes(tabId)) ?? null;
}

export function firstPane(node: LayoutNode): PaneNode | null {
  return paneList(node)[0] ?? null;
}

export function updatePane(node: LayoutNode, paneId: string, update: (pane: PaneNode) => PaneNode): LayoutNode {
  if (node.type === "pane") return node.id === paneId ? update(node) : node;
  return { ...node, children: node.children.map((child) => updatePane(child, paneId, update)) };
}

export function splicePane(node: LayoutNode, paneId: string, replacement: LayoutNode): LayoutNode {
  if (node.type === "pane") return node.id === paneId ? replacement : node;
  return { ...node, children: node.children.map((child) => splicePane(child, paneId, replacement)) };
}

/** Drop empty panes and merge splits that end up with a single child. */
export function collapse(node: LayoutNode): LayoutNode | null {
  if (node.type === "pane") return node.tabs.length > 0 ? node : null;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, index) => {
    const next = collapse(child);
    if (!next) return;
    children.push(next);
    sizes.push(node.sizes[index] ?? 1);
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, sizes: normalizeSizes(sizes), children };
}

/**
 * Remove a tab and return the collapsed layout, or null when no pane is left.
 * Removing a pane's active tab activates its left neighbor (then the right).
 */
export function removeTab(node: LayoutNode, tabId: string): LayoutNode | null {
  const pane = paneOfTab(node, tabId);
  if (!pane) return node;
  const next = updatePane(node, pane.id, (current) => {
    const index = current.tabs.indexOf(tabId);
    const tabs = current.tabs.filter((id) => id !== tabId);
    const activeTabId =
      current.activeTabId === tabId ? tabs[Math.max(0, index - 1)] ?? tabs[0] ?? "" : current.activeTabId;
    return { ...current, tabs, activeTabId };
  });
  return collapse(next);
}

/**
 * Remove an entire pane (closing the tabs it holds) and return the collapsed
 * layout, or null when no pane is left. Sibling sizes are renormalized so the
 * remaining panes keep their relative proportions.
 */
export function removePane(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === "pane") return node.id === paneId ? null : node;
  const kept: Array<{ child: LayoutNode; size: number }> = [];
  let removed = false;
  node.children.forEach((child, index) => {
    const size = node.sizes[index] ?? 1 / node.children.length;
    const isTarget = child.type === "pane" ? child.id === paneId : Boolean(findPane(child, paneId));
    if (!removed && isTarget) {
      removed = true;
      if (child.type === "pane") return;
      const next = removePane(child, paneId);
      if (next) kept.push({ child: next, size });
      return;
    }
    kept.push({ child, size });
  });
  if (!removed) return node;
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0].child;
  return {
    ...node,
    sizes: normalizeSizes(kept.map((item) => item.size)),
    children: kept.map((item) => item.child),
  };
}

/** Insert a tab into a pane and make it active; the tab must not be open elsewhere. */
export function addTab(node: LayoutNode, paneId: string, tabId: string, beforeTabId: string | null = null): LayoutNode {
  const target = findPane(node, paneId) ?? firstPane(node);
  if (!target) return layoutFromTabs([tabId], tabId);
  return updatePane(node, target.id, (pane) => {
    const tabs = [...pane.tabs];
    if (!tabs.includes(tabId)) {
      const before = beforeTabId ? tabs.indexOf(beforeTabId) : -1;
      if (before >= 0) tabs.splice(before, 0, tabId);
      else tabs.push(tabId);
    }
    return { ...pane, tabs, activeTabId: tabId };
  });
}

/**
 * Move a tab within or across panes. `beforeTabId` is the tab the dragged tab
 * should land in front of, or null to append at the end. The moved tab becomes
 * the target pane's active tab.
 */
export function moveTab(node: LayoutNode, tabId: string, targetPaneId: string, beforeTabId: string | null): LayoutNode {
  const source = paneOfTab(node, tabId);
  if (!source) return node;
  if (source.id === targetPaneId) {
    return updatePane(node, targetPaneId, (pane) => {
      const tabs = pane.tabs.filter((id) => id !== tabId);
      const before = beforeTabId ? tabs.indexOf(beforeTabId) : -1;
      if (before >= 0) tabs.splice(before, 0, tabId);
      else tabs.push(tabId);
      return { ...pane, tabs, activeTabId: tabId };
    });
  }
  const pruned = removeTab(node, tabId);
  if (!pruned || !findPane(pruned, targetPaneId)) return node;
  return updatePane(pruned, targetPaneId, (pane) => {
    const tabs = [...pane.tabs];
    const before = beforeTabId ? tabs.indexOf(beforeTabId) : -1;
    if (before >= 0) tabs.splice(before, 0, tabId);
    else tabs.push(tabId);
    return { ...pane, tabs, activeTabId: tabId };
  });
}

/** Divide a pane in two, placing `newPane` on the given side. */
export function splitPaneWith(node: LayoutNode, paneId: string, side: SplitSide, newPane: PaneNode): LayoutNode {
  const target = findPane(node, paneId);
  if (!target) return node;
  const dir: SplitDirection = side === "left" || side === "right" ? "row" : "column";
  const children = side === "left" || side === "top" ? [newPane, target] : [target, newPane];
  return splicePane(node, paneId, { type: "split", id: nextId("split"), dir, sizes: [0.5, 0.5], children });
}

/**
 * Drag a tab onto a pane edge: remove it from its pane and put it alone in a
 * new pane on that side. Dropping a pane's only tab on its own edge is a no-op
 * (the pane would otherwise vanish under the drag).
 */
export function splitWithTab(node: LayoutNode, tabId: string, targetPaneId: string, side: SplitSide): LayoutNode {
  const source = paneOfTab(node, tabId);
  if (!source) return node;
  if (source.id === targetPaneId && source.tabs.length === 1) return node;
  const pruned = removeTab(node, tabId);
  if (!pruned || !findPane(pruned, targetPaneId)) return node;
  return splitPaneWith(pruned, targetPaneId, side, createPane([tabId], tabId));
}

/** Grow child `index` of a split by `delta` (fraction of the split's size). */
export function applySplitDelta(node: LayoutNode, splitId: string, index: number, delta: number): LayoutNode {
  if (node.type === "pane") return node;
  const children = node.children.map((child) => applySplitDelta(child, splitId, index, delta));
  if (node.id !== splitId || index < 0 || index + 1 >= node.sizes.length) return { ...node, children };
  const sizes = [...node.sizes];
  const pair = sizes[index] + sizes[index + 1];
  const first = Math.min(pair - MIN_PANE_FRACTION, Math.max(MIN_PANE_FRACTION, sizes[index] + delta));
  sizes[index] = roundShare(first);
  sizes[index + 1] = roundShare(pair - first);
  return { ...node, sizes, children };
}

/** Double-clicking a divider returns every child of that split to equal size. */
export function resetSplit(node: LayoutNode, splitId: string): LayoutNode {
  if (node.type === "pane") return node;
  const children = node.children.map((child) => resetSplit(child, splitId));
  if (node.id !== splitId) return { ...node, children };
  return { ...node, sizes: node.sizes.map(() => roundShare(1 / node.sizes.length)), children };
}

/** Keeps persisted sizes tidy and avoids float drift while dragging. */
function roundShare(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function serializeLayout(layout: LayoutNode, focusedPaneId: string, maximizedPaneId: string): string {
  return JSON.stringify({ version: 1, root: layout, focusedPaneId, maximizedPaneId });
}

export function parseLayout(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function uniqueId(kind: "pane" | "split", raw: unknown, seen: Set<string>): string {
  if (typeof raw === "string" && raw && !seen.has(raw)) {
    seen.add(raw);
    return raw;
  }
  const id = nextId(kind);
  seen.add(id);
  return id;
}

/**
 * Validate a persisted layout against the current tab list: unknown or
 * duplicate tabs are dropped, panes that are identical after pruning merge,
 * empty panes disappear and missing tabs are appended to `hintPaneId` (the
 * previously focused pane) or the first pane.
 */
export function normalizeLayout(raw: unknown, allowed: string[], hintPaneId = ""): LayoutNode | null {
  if (!isRecord(raw)) return null;
  const allowedSet = new Set(allowed);
  const seenTabs = new Set<string>();
  const seenIds = new Set<string>();

  const sanitize = (value: unknown): LayoutNode | null => {
    if (!isRecord(value)) return null;
    if (value.type === "pane") {
      const tabs: string[] = [];
      for (const tab of Array.isArray(value.tabs) ? value.tabs : []) {
        if (typeof tab !== "string" || seenTabs.has(tab) || !allowedSet.has(tab)) continue;
        seenTabs.add(tab);
        tabs.push(tab);
      }
      const active = typeof value.activeTabId === "string" && tabs.includes(value.activeTabId) ? value.activeTabId : tabs[0] ?? "";
      return { type: "pane", id: uniqueId("pane", value.id, seenIds), tabs, activeTabId: active };
    }
    if (value.type === "split") {
      const children: LayoutNode[] = [];
      const sizes: number[] = [];
      const list = Array.isArray(value.children) ? value.children : [];
      const rawSizes = Array.isArray(value.sizes) ? value.sizes : [];
      list.forEach((child, index) => {
        const next = sanitize(child);
        if (!next) return;
        children.push(next);
        sizes.push(typeof rawSizes[index] === "number" ? (rawSizes[index] as number) : 1);
      });
      if (children.length === 0) return null;
      if (children.length === 1) return children[0];
      return {
        type: "split",
        id: uniqueId("split", value.id, seenIds),
        dir: value.dir === "column" ? "column" : "row",
        sizes: normalizeSizes(sizes),
        children,
      };
    }
    return null;
  };

  const root = sanitize(raw);
  if (!root) return null;
  const collapsed = collapse(root);
  if (!collapsed) return null;
  const missing = allowed.filter((tab) => !seenTabs.has(tab));
  if (missing.length === 0) return collapsed;
  const hint = findPane(collapsed, hintPaneId) ?? firstPane(collapsed);
  if (!hint) return null;
  return updatePane(collapsed, hint.id, (pane) => {
    const tabs = [...pane.tabs, ...missing.filter((tab) => !pane.tabs.includes(tab))];
    return { ...pane, tabs, activeTabId: pane.activeTabId || tabs[0] || "" };
  });
}

/**
 * Rehydrate the persisted layout, falling back to a single pane when there is
 * nothing usable. `raw` is the serialized wrapper (see serializeLayout), which
 * also carries the persisted focused and maximized pane ids. The pane holding
 * `activeTabId` becomes focused so the global active tab and the focused pane
 * always agree.
 */
export function restoreLayout(
  raw: string | null | undefined,
  tabs: string[],
  activeTabId: string,
): RestoredLayout {
  const parsed = parseLayout(raw);
  let root: unknown = parsed;
  let focusedPaneId = "";
  let maximizedPaneId = "";
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const wrapper = parsed as Record<string, unknown>;
    if (wrapper.root !== undefined) {
      root = wrapper.root;
      if (typeof wrapper.focusedPaneId === "string") focusedPaneId = wrapper.focusedPaneId;
      if (typeof wrapper.maximizedPaneId === "string") maximizedPaneId = wrapper.maximizedPaneId;
    }
  }
  let layout: LayoutNode | null = root === null ? null : normalizeLayout(root, tabs, focusedPaneId);
  if (!layout) layout = layoutFromTabs(tabs, activeTabId);
  const pane = (activeTabId ? paneOfTab(layout, activeTabId) : null) ?? findPane(layout, focusedPaneId) ?? firstPane(layout);
  if (!pane) return { layout, focusedPaneId: "", maximizedPaneId: "", activeTabId: "" };
  layout = updatePane(layout, pane.id, (current) => ({
    ...current,
    activeTabId: activeTabId && current.tabs.includes(activeTabId) ? activeTabId : current.activeTabId || current.tabs[0] || "",
  }));
  const focused = findPane(layout, pane.id);
  const max = maximizedPaneId && paneList(layout).length > 1 && findPane(layout, maximizedPaneId) ? maximizedPaneId : "";
  return { layout, focusedPaneId: pane.id, maximizedPaneId: max, activeTabId: focused?.activeTabId ?? "" };
}
