import { Fragment, useRef, useState } from "react";
import type {
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { hasTabDrag, readTabDrag } from "../lib/dragTab";
import {
  paneList,
  type LayoutNode,
  type PaneDropZone,
  type PaneNode,
  type SplitNode,
} from "../lib/panes";
import { isHomeTab, useAppStore } from "../store";
import { EditorStack } from "./EditorStack";
import { PageHeader } from "./PageHeader";
import { TabStrip } from "./TabStrip";

/** How close to an edge a tab has to be dropped to split instead of move. */
const EDGE_ZONE = 0.32;

/**
 * The pane tree of the main panel. Every leaf is a real editor pane with its
 * own tab bar; split nodes lay panes out in rows/columns with draggable
 * splitters between them.
 */
export function Panes() {
  const layout = useAppStore((state) => state.layout);
  const maximizedPaneId = useAppStore((state) => state.maximizedPaneId);

  if (maximizedPaneId) {
    const pane = paneList(layout).find((item) => item.id === maximizedPaneId);
    if (pane) {
      return (
        <div className="panes-root">
          <PaneView pane={pane} />
        </div>
      );
    }
  }

  return <div className="panes-root">{renderNode(layout)}</div>;
}

function renderNode(node: LayoutNode) {
  if (node.type === "pane") return <PaneView key={node.id} pane={node} />;
  return <SplitView key={node.id} split={node} />;
}

function SplitView({ split }: { split: SplitNode }) {
  const resizeSplit = useAppStore((state) => state.resizeSplit);
  const resetSplit = useAppStore((state) => state.resetSplit);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragIndex = useRef<number | null>(null);
  const lastPosition = useRef(0);
  const [dragging, setDragging] = useState(false);

  const axis = split.dir === "row" ? "clientX" : "clientY";

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragIndex.current = index;
    lastPosition.current = event[axis];
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const index = dragIndex.current;
    if (index === null) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const total = split.dir === "row" ? rect.width : rect.height;
    if (!total) return;
    const current = event[axis];
    const delta = (current - lastPosition.current) / total;
    lastPosition.current = current;
    if (delta) resizeSplit(split.id, index, delta);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragIndex.current === null) return;
    dragIndex.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`pane-split is-${split.dir}${dragging ? " is-dragging" : ""}`}
    >
      {split.children.map((child, index) => (
        <Fragment key={child.id}>
          {index > 0 ? (
            <div
              className="pane-splitter"
              role="separator"
              aria-orientation={split.dir === "row" ? "vertical" : "horizontal"}
              title="Drag to resize · double-click to reset"
              onPointerDown={(event) => onPointerDown(event, index - 1)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
              onDoubleClick={() => resetSplit(split.id)}
            />
          ) : null}
          <div className="pane-split-cell" style={{ flexGrow: split.sizes[index] }}>
            {renderNode(child)}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function PaneView({ pane }: { pane: PaneNode }) {
  const focused = useAppStore((state) => state.focusedPaneId === pane.id);
  const paneCount = useAppStore((state) => paneList(state.layout).length);
  const focusPane = useAppStore((state) => state.focusPane);
  const dropTabInPane = useAppStore((state) => state.dropTabInPane);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [zone, setZone] = useState<PaneDropZone | null>(null);
  // Every pane with a page shows its own header, focused or not, so the page
  // chrome does not jump around when focus moves between panes.
  const showHeader = Boolean(pane.activeTabId) && !isHomeTab(pane.activeTabId);

  const zoneFor = (event: ReactDragEvent): PaneDropZone => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return "center";
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const candidates: Array<[PaneDropZone, number]> = [
      ["left", x],
      ["right", 1 - x],
      ["top", y],
      ["bottom", 1 - y],
    ];
    let best: PaneDropZone = "center";
    let bestDistance = EDGE_ZONE;
    for (const [side, distance] of candidates) {
      if (distance < bestDistance) {
        best = side;
        bestDistance = distance;
      }
    }
    return best;
  };

  const onDragOver = (event: ReactDragEvent) => {
    if (!hasTabDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setZone(zoneFor(event));
  };

  const onDragLeave = (event: ReactDragEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setZone(null);
  };

  const onDrop = (event: ReactDragEvent) => {
    if (!hasTabDrag(event.dataTransfer)) return;
    event.preventDefault();
    const tabId = readTabDrag(event.dataTransfer);
    const target = zone ?? zoneFor(event);
    setZone(null);
    if (tabId) dropTabInPane(tabId, pane.id, target);
  };

  return (
    <section
      className={[
        "pane",
        focused ? "is-focused" : "",
        zone ? `drop-${zone}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={paneCount > 1 ? "Pane" : "Editor"}
      onMouseDownCapture={() => {
        if (!focused) focusPane(pane.id);
      }}
    >
      <TabStrip pane={pane} />
      {showHeader ? <PageHeader pageId={pane.activeTabId} /> : null}
      <div
        className="pane-body"
        ref={bodyRef}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <EditorStack pane={pane} />
        {zone ? (
          <div className={`pane-drop-hint is-${zone}`} aria-hidden="true">
            {zone === "center" ? <div className="pane-drop-center" /> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
