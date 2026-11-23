import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type Anchor = HTMLElement | DOMRect | { x: number; y: number } | null;
export type Placement = "bottom-start" | "bottom-end" | "right-start" | "cover";

interface PopoverProps {
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
  placement?: Placement;
  width?: number;
  className?: string;
  /** Matching the anchor's width (cell editors). */
  matchWidth?: boolean;
  label?: string;
}

// Open popovers, oldest first. A click inside a newer popover (a submenu) must
// not close the older one that opened it.
const stack: HTMLElement[] = [];

function rectOf(anchor: Anchor): DOMRect | null {
  if (!anchor) return null;
  if (anchor instanceof HTMLElement) return anchor.getBoundingClientRect();
  if (anchor instanceof DOMRect) return anchor;
  return new DOMRect(anchor.x, anchor.y, 0, 0);
}

/**
 * A floating panel anchored to an element or point, portalled to the body so
 * table overflow and editor node views never clip it.
 */
export function Popover({ anchor, onClose, children, placement = "bottom-start", width, className = "", matchWidth, label }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", left: 0, top: 0, opacity: 0, pointerEvents: "none" });
  const closeRef = useRef(onClose);
  const placeRef = useRef<(() => void) | null>(null);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    stack.push(node);
    return () => {
      const index = stack.indexOf(node);
      if (index >= 0) stack.splice(index, 1);
    };
  }, []);

  useLayoutEffect(() => {
    const node = ref.current;
    const rect = rectOf(anchor);
    if (!node || !rect) return;
    const place = () => {
      const current = rectOf(anchor) ?? rect;
      const box = node.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = box.width;
      const h = box.height;
      let left = current.left;
      let top = current.bottom + 4;
      if (placement === "bottom-end") left = current.right - w;
      if (placement === "right-start") {
        left = current.right + 4;
        top = current.top - 5;
        if (left + w > vw - 8) left = current.left - w - 4;
      }
      if (placement === "cover") {
        left = current.left;
        top = current.top;
      }
      if (placement !== "right-start" && placement !== "cover" && top + h > vh - 8 && current.top - h - 4 > 8) top = current.top - h - 4;
      left = Math.max(8, Math.min(left, vw - w - 8));
      top = Math.max(8, Math.min(top, vh - h - 8));
      setStyle({
        position: "fixed",
        left,
        top,
        ...(width ? { width } : {}),
        ...(matchWidth ? { minWidth: Math.max(current.width, width ?? 0) } : {}),
      });
    };
    place();
    placeRef.current = place;
    const observer = new ResizeObserver(place);
    observer.observe(node);
    return () => observer.disconnect();
  }, [anchor, placement, width, matchWidth]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const index = stack.indexOf(node);
      if (!target || index < 0) return;
      if (stack.slice(index).some((item) => item.contains(target))) return;
      // A trigger that toggles this popover handles the click itself.
      if (anchor instanceof HTMLElement && anchor.contains(target)) return;
      closeRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (stack[stack.length - 1] !== node) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    const onScroll = (event: Event) => {
      // Scrolling the page under a popover detaches it from its anchor.
      const target = event.target as Node | null;
      if (target && stack.some((item) => item.contains(target))) return;
      // Follow the anchor when something under it scrolls (a cell scrolled
      // into view on click, the page scrolled by the wheel).
      placeRef.current?.();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, placement]);

  return createPortal(
    <div
      ref={ref}
      className={`db-popover ${className}`}
      style={style}
      role="dialog"
      aria-label={label}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Small helper for anchored menus driven by a button. */
export function useAnchor<T extends HTMLElement = HTMLElement>() {
  const [anchor, setAnchor] = useState<T | null>(null);
  return {
    anchor,
    open: (element: T) => setAnchor(element),
    toggle: (element: T) => setAnchor((current) => (current ? null : element)),
    close: () => setAnchor(null),
  };
}
