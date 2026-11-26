import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Pointer-driven reordering for a row (tabs) or a column (menu items) of
 * elements marked with `data-reorder-id`. Works inside editor node views,
 * where native HTML drag and drop belongs to the editor.
 *
 * The drag starts after the pointer moves a few pixels, so a plain click
 * still selects. Returns true from `consumeClick()` right after a drag so the
 * caller can ignore the click that ends it.
 */
export interface ReorderOptions {
  axis: "x" | "y";
  /** The element that holds the items. */
  container: HTMLElement;
  id: string;
  onDrop: (id: string, targetId: string, after: boolean) => void;
}

let justDragged = 0;

export function consumeDragClick(): boolean {
  if (Date.now() - justDragged < 250) {
    justDragged = 0;
    return true;
  }
  return false;
}

export function startReorder(event: ReactPointerEvent<HTMLElement>, options: ReorderOptions) {
  if (event.button !== 0 || event.pointerType === "touch") return;
  const { axis, container, id, onDrop } = options;
  const source = event.currentTarget;
  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;
  let target: { el: HTMLElement; id: string; after: boolean } | null = null;
  const pointerId = event.pointerId;

  const items = () => Array.from(container.querySelectorAll<HTMLElement>("[data-reorder-id]"));
  const clearMarks = () => {
    for (const item of items()) item.classList.remove("is-drop-before", "is-drop-after");
  };

  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging) {
      if (Math.hypot(dx, dy) < 5) return;
      dragging = true;
      source.classList.add("is-dragging");
      container.classList.add("is-reordering");
      document.body.classList.add("db-reordering");
    }
    e.preventDefault();
    source.style.transform = axis === "x" ? `translateX(${dx}px)` : `translateY(${dy}px)`;
    // Find the item under the pointer along the axis.
    let next: typeof target = null;
    const point = axis === "x" ? e.clientX : e.clientY;
    for (const item of items()) {
      if (item === source) continue;
      const rect = item.getBoundingClientRect();
      const start = axis === "x" ? rect.left : rect.top;
      const end = axis === "x" ? rect.right : rect.bottom;
      if (point >= start && point <= end) {
        next = { el: item, id: item.dataset.reorderId ?? "", after: point > (start + end) / 2 };
        break;
      }
    }
    clearMarks();
    target = next;
    if (target) target.el.classList.add(target.after ? "is-drop-after" : "is-drop-before");
  };

  const finish = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", finish, true);
    window.removeEventListener("pointercancel", finish, true);
    source.style.transform = "";
    source.classList.remove("is-dragging");
    container.classList.remove("is-reordering");
    document.body.classList.remove("db-reordering");
    clearMarks();
    if (!dragging) return;
    justDragged = Date.now();
    if (e.type === "pointerup" && target && target.id && target.id !== id) onDrop(id, target.id, target.after);
  };

  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", finish, true);
  window.addEventListener("pointercancel", finish, true);
}
