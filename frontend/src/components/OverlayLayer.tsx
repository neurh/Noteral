/**
 * Floating overlays from plugins and layers (ui.setOverlay): HTML views above the whole
 * app that take no space — timers, HUDs, sticky notes, focus vignettes, effects.
 *
 * Two stacks: "app" sits above the app but below menus, popovers and dialogs; "top" sits
 * above everything. A non-interactive overlay lets every click through to the app.
 * Draggable overlays get a grip; where the user drops one is remembered on this device.
 */
import { GripHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useContributions } from "../lib/contributions";
import type { OverlayContribution, OverlaySize } from "../lib/contributions";
import { ViewFrame } from "./ViewFrame";

const POSITIONS_KEY = "noteral.overlays.positions";
type Spot = { left: number; top: number };

function loadSpots(): Record<string, Spot> {
  try {
    const value = JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function saveSpot(key: string, spot: Spot | null) {
  try {
    const all = loadSpots();
    if (spot) all[key] = spot;
    else delete all[key];
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(all));
  } catch {
    // Private mode or storage full: the position just isn't remembered.
  }
}

function size(value: OverlaySize | undefined): string | number | undefined {
  if (value === undefined || value === "auto") return undefined;
  return typeof value === "number" ? value : `${parseFloat(value)}${value.endsWith("%") ? "vw" : "px"}`;
}

function heightSize(value: OverlaySize | undefined): string | number | undefined {
  if (value === undefined || value === "auto") return undefined;
  return typeof value === "number" ? value : `${parseFloat(value)}vh`;
}

/** CSS placement for an overlay: an edge/corner/centre of the window plus x/y insets. */
export function overlayStyle(overlay: Pick<OverlayContribution, "position" | "x" | "y" | "width" | "height">): CSSProperties {
  if (overlay.position === "full") {
    const inset = overlay.x ?? 0;
    const insetY = overlay.y ?? inset;
    return { left: inset, right: inset, top: insetY, bottom: insetY };
  }
  const x = overlay.x ?? 16;
  const y = overlay.y ?? 16;
  const style: CSSProperties = {};
  const [vertical, horizontal] = overlay.position.includes("-")
    ? (overlay.position.split("-") as [string, string])
    : overlay.position === "left" || overlay.position === "right"
      ? ["middle", overlay.position]
      : overlay.position === "center"
        ? ["middle", "center"]
        : [overlay.position, "center"];
  const transforms: string[] = [];
  if (vertical === "top") style.top = y;
  else if (vertical === "bottom") style.bottom = y;
  else {
    style.top = `calc(50% + ${y === 16 ? 0 : y}px)`;
    transforms.push("translateY(-50%)");
  }
  if (horizontal === "left") style.left = x;
  else if (horizontal === "right") style.right = x;
  else {
    style.left = `calc(50% + ${x === 16 ? 0 : x}px)`;
    transforms.push("translateX(-50%)");
  }
  if (transforms.length) style.transform = transforms.join(" ");
  const width = size(overlay.width);
  if (width !== undefined) style.width = width;
  const height = heightSize(overlay.height);
  if (height !== undefined) style.height = height;
  return style;
}

function OverlayItem({ overlay, onDismiss }: { overlay: OverlayContribution; onDismiss: () => void }) {
  const [spot, setSpot] = useState<Spot | undefined>(() => (overlay.draggable ? loadSpots()[overlay.key] : undefined));
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const props = useMemo(() => ({ data: overlay.data ?? null, overlay: overlay.id }), [overlay.data, overlay.id]);
  const interactive = overlay.interactive !== false;
  const fill = overlay.position === "full" || (overlay.height !== undefined && overlay.height !== "auto");

  // Keep a dropped overlay inside the window when it shrinks.
  useEffect(() => {
    if (!spot) return;
    const clamp = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.max(0, Math.min(window.innerWidth - Math.min(r.width, 60), spot.left));
      const top = Math.max(0, Math.min(window.innerHeight - 24, spot.top));
      if (left !== spot.left || top !== spot.top) setSpot({ left, top });
    };
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [spot]);

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const r = box.current?.getBoundingClientRect();
      if (!r || event.button !== 0) return;
      event.preventDefault();
      const dx = event.clientX - r.left;
      const dy = event.clientY - r.top;
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      setDragging(true);
      let last: Spot = { left: r.left, top: r.top };
      const move = (e: PointerEvent) => {
        last = {
          left: Math.round(Math.max(0, Math.min(window.innerWidth - Math.min(r.width, 60), e.clientX - dx))),
          top: Math.round(Math.max(0, Math.min(window.innerHeight - 24, e.clientY - dy))),
        };
        setSpot(last);
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        setDragging(false);
        saveSpot(overlay.key, last);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    },
    [overlay.key],
  );

  const style: CSSProperties = { ...overlayStyle(overlay), zIndex: overlay.order };
  if (spot && overlay.position !== "full") {
    delete style.right;
    delete style.bottom;
    style.left = spot.left;
    style.top = spot.top;
    style.transform = undefined;
  }
  if (overlay.opacity !== undefined) style.opacity = overlay.opacity;
  if (!style.width && overlay.position !== "full") style.width = 280;

  const className = [
    "overlay-item",
    interactive ? "is-interactive" : "is-passive",
    overlay.chrome ? "has-chrome" : "",
    overlay.position === "full" ? "is-full" : "",
    dragging ? "is-dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={box} className={className} style={style} data-overlay-key={overlay.key}>
      {overlay.draggable && interactive ? (
        <div className="overlay-grip" onPointerDown={startDrag} onDoubleClick={() => (setSpot(undefined), saveSpot(overlay.key, null))} title="Drag to move · double-click to reset">
          <GripHorizontal size={12} aria-hidden />
          <span className="overlay-grip-title">{overlay.title ?? overlay.owner.name}</span>
          <button type="button" className="overlay-close" aria-label={`Hide ${overlay.title ?? overlay.owner.name}`} onPointerDown={(e) => e.stopPropagation()} onClick={onDismiss}>
            <X size={11} />
          </button>
        </div>
      ) : null}
      <ViewFrame
        viewKey={overlay.key}
        html={overlay.html}
        owner={overlay.owner}
        permissions={overlay.permissions}
        props={props}
        surface="overlay"
        fill={fill}
        initialHeight={40}
        maxHeight={Math.round(window.innerHeight * 0.9)}
        className="overlay-frame"
        title={overlay.title ?? overlay.owner.name}
        onClose={onDismiss}
      />
    </div>
  );
}

export function OverlayLayer() {
  const { overlays } = useContributions();
  // Closed by the user (or noteral.close()) for this session, until the overlay's html changes.
  const [dismissed, setDismissed] = useState<ReadonlyMap<string, string>>(new Map());
  const visible = overlays.filter((overlay) => !overlay.hidden && dismissed.get(overlay.key) !== overlay.html);
  if (!visible.length) return null;
  const dismiss = (overlay: OverlayContribution) => setDismissed((current) => new Map(current).set(overlay.key, overlay.html));
  const stack = (layer: "app" | "top") => {
    const items = visible.filter((overlay) => (overlay.stack ?? "app") === layer).sort((a, b) => a.order - b.order);
    if (!items.length) return null;
    return (
      <div className={`overlay-layer is-${layer}`} aria-label="Overlays">
        {items.map((overlay) => (
          <OverlayItem key={overlay.key} overlay={overlay} onDismiss={() => dismiss(overlay)} />
        ))}
      </div>
    );
  };
  return createPortal(
    <>
      {stack("app")}
      {stack("top")}
    </>,
    document.body,
  );
}
