import { useEffect, useRef, type RefObject } from "react";
import { Selection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { clearBlockSelection, isBlockSelection, rangeForBlocks, selectBlockRange } from "../lib/blockSelection";

/**
 * Marquee (rubber-band) block selection for the page editor.
 *
 * A press on empty page space — the margins beside the text, the gaps between
 * blocks, the space below the last block — and a drag draws a box. Every block
 * whose own row the box touches is selected as a whole block; nothing the box
 * doesn't touch is. A press without a drag behaves like a click on that space.
 */

type Options = {
  scrollRef: RefObject<HTMLElement | null>;
  /** The editor's ProseMirror view, once mounted. */
  getView: () => EditorView | null;
  isEditable: () => boolean;
  /** A plain click on the space below the last block. */
  onClickBelow: () => void;
};

/** Elements that are page space, not content. A press on anything else is left alone. */
const BLANK_TARGETS = [
  ".page-scroll",
  ".page-document",
  ".page-editor",
  ".page-body",
  ".page-below",
  ".bn-container",
  ".ProseMirror",
  ".bn-block-group",
  ".bn-block-outer",
  ".bn-block",
].join(",");

/** Block types whose row is their line of text (their box also holds padding). */
const TEXT_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
  "quote",
]);

const DRAG_THRESHOLD = 4;
const EDGE = 48;
const MAX_SPEED = 18;

/** A block's own row (not its children) in scroll-content coordinates. */
type BlockBox = { id: string; left: number; right: number; top: number; bottom: number };

type Drag = {
  view: EditorView;
  scroller: HTMLElement;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  active: boolean;
  boxes: BlockBox[];
  overlay: HTMLDivElement | null;
  lastKey: string;
  frame: number;
  target: Element;
};

export function useBlockMarquee({ scrollRef, getView, isEditable, onClickBelow }: Options) {
  const latest = useRef({ getView, isEditable, onClickBelow });
  latest.current = { getView, isEditable, onClickBelow };

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let drag: Drag | null = null;

    const toContent = (clientX: number, clientY: number) => {
      const rect = scroller.getBoundingClientRect();
      return { x: clientX - rect.left + scroller.scrollLeft, y: clientY - rect.top + scroller.scrollTop };
    };

    const measure = (view: EditorView): BlockBox[] => {
      const rect = scroller.getBoundingClientRect();
      const dx = scroller.scrollLeft - rect.left;
      const dy = scroller.scrollTop - rect.top;
      const boxes: BlockBox[] = [];
      view.dom.querySelectorAll<HTMLElement>(".bn-block-outer[data-id]").forEach((outer) => {
        if (outer.closest(".ProseMirror") !== view.dom) return;
        // React-rendered blocks (databases) wrap their content in a node-view div.
        const content = outer.querySelector<HTMLElement>(
          ":scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content",
        );
        if (!content) return;
        const box = content.getBoundingClientRect();
        if (!box.width || !box.height) return;
        let { top, bottom } = box;
        if (TEXT_TYPES.has(content.dataset.contentType ?? "")) {
          const line = content.querySelector<HTMLElement>(".bn-inline-content")?.getBoundingClientRect();
          if (line && line.height) ({ top, bottom } = line);
        }
        boxes.push({ id: outer.dataset.id!, left: box.left + dx, right: box.right + dx, top: top + dy, bottom: bottom + dy });
      });
      return boxes;
    };

    const marquee = (d: Drag) => {
      const end = toContent(d.clientX, d.clientY);
      return {
        left: Math.min(d.startX, end.x),
        right: Math.max(d.startX, end.x),
        top: Math.min(d.startY, end.y),
        bottom: Math.max(d.startY, end.y),
      };
    };

    const paint = (d: Drag) => {
      const box = marquee(d);
      const rect = scroller.getBoundingClientRect();
      // Clip to the visible scroller so the box never spills over the chrome.
      const left = Math.max(box.left - scroller.scrollLeft + rect.left, rect.left);
      const right = Math.min(box.right - scroller.scrollLeft + rect.left, rect.left + scroller.clientWidth);
      const top = Math.max(box.top - scroller.scrollTop + rect.top, rect.top);
      const bottom = Math.min(box.bottom - scroller.scrollTop + rect.top, rect.top + scroller.clientHeight);
      if (!d.overlay) {
        d.overlay = document.createElement("div");
        d.overlay.className = "block-marquee";
        d.overlay.setAttribute("aria-hidden", "true");
        document.body.appendChild(d.overlay);
      }
      Object.assign(d.overlay.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${Math.max(0, right - left)}px`,
        height: `${Math.max(0, bottom - top)}px`,
      });

      const touched = d.boxes
        .filter((b) => b.left < box.right && b.right > box.left && b.top < box.bottom && b.bottom > box.top)
        .map((b) => b.id);
      const key = touched.join(",");
      if (key === d.lastKey) return;
      d.lastKey = key;
      const range = touched.length ? rangeForBlocks(d.view.state.doc, touched) : null;
      selectBlockRange(d.view, range);
    };

    const autoscroll = () => {
      const d = drag;
      if (!d?.active) return;
      const rect = scroller.getBoundingClientRect();
      let speed = 0;
      if (d.clientY < rect.top + EDGE) speed = -Math.min(MAX_SPEED, ((rect.top + EDGE - d.clientY) / EDGE) * MAX_SPEED);
      else if (d.clientY > rect.bottom - EDGE) speed = Math.min(MAX_SPEED, ((d.clientY - (rect.bottom - EDGE)) / EDGE) * MAX_SPEED);
      if (speed) {
        const before = scroller.scrollTop;
        scroller.scrollTop += speed;
        if (scroller.scrollTop !== before) paint(d);
      }
      d.frame = requestAnimationFrame(autoscroll);
    };

    const start = (d: Drag) => {
      d.active = true;
      d.boxes = measure(d.view);
      // Smooth scrolling would make autoscroll lag behind the pointer.
      scroller.style.scrollBehavior = "auto";
      document.body.classList.add("is-block-marquee");
      window.getSelection()?.removeAllRanges();
      paint(d);
      d.frame = requestAnimationFrame(autoscroll);
    };

    const click = (d: Drag) => {
      const { view, target } = d;
      if (target.closest(".page-below")) {
        latest.current.onClickBelow();
        return;
      }
      const dom = view.dom.getBoundingClientRect();
      const inRows = d.clientY >= dom.top && d.clientY <= dom.bottom;
      if (!inRows || !scroller.contains(target) || !target.closest(".page-editor")) {
        clearBlockSelection(view);
        return;
      }
      // A click beside or between blocks puts the caret on the nearest line.
      const coords = {
        left: Math.min(Math.max(d.clientX, dom.left + 2), dom.right - 2),
        top: Math.min(Math.max(d.clientY, dom.top + 2), dom.bottom - 2),
      };
      const hit = view.posAtCoords(coords);
      if (!hit) return;
      const selection = Selection.near(view.state.doc.resolve(hit.pos));
      view.dispatch(view.state.tr.setSelection(selection));
      view.focus();
    };

    const onMove = (event: MouseEvent) => {
      const d = drag;
      if (!d) return;
      d.clientX = event.clientX;
      d.clientY = event.clientY;
      if (!d.active) {
        const origin = toContent(event.clientX, event.clientY);
        if (Math.hypot(origin.x - d.startX, origin.y - d.startY) < DRAG_THRESHOLD) return;
        start(d);
        return;
      }
      event.preventDefault();
      paint(d);
    };

    const finish = (commit: boolean) => {
      const d = drag;
      drag = null;
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
      scroller.removeEventListener("scroll", onScroll);
      if (!d) return;
      cancelAnimationFrame(d.frame);
      d.overlay?.remove();
      scroller.style.scrollBehavior = "";
      document.body.classList.remove("is-block-marquee");
      if (!commit) return;
      if (!d.active) click(d);
      else if (isBlockSelection(d.view.state.selection)) d.view.focus();
    };

    const onUp = () => finish(true);
    const onBlur = () => finish(false);
    const onScroll = () => {
      if (drag?.active) paint(drag);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drag) return;
      event.preventDefault();
      event.stopPropagation();
      const view = drag.view;
      finish(false);
      clearBlockSelection(view);
    };

    const onDown = (event: MouseEvent) => {
      if (event.button !== 0 || event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (!target?.matches(BLANK_TARGETS)) return;
      // Leave presses on the scrollbar to the browser.
      const rect = scroller.getBoundingClientRect();
      if (event.clientX >= rect.left + scroller.clientWidth || event.clientY >= rect.top + scroller.clientHeight) return;
      const view = latest.current.getView();
      if (!view || !latest.current.isEditable()) return;
      // Only claim the press; outside-click handlers (open menus) still see it.
      event.preventDefault();
      const origin = toContent(event.clientX, event.clientY);
      drag = {
        view,
        scroller,
        startX: origin.x,
        startY: origin.y,
        clientX: event.clientX,
        clientY: event.clientY,
        active: false,
        boxes: [],
        overlay: null,
        // Never a real key, so the first paint always applies (and clears a stale selection).
        lastKey: "\u0000",
        frame: 0,
        target,
      };
      window.addEventListener("mousemove", onMove, true);
      window.addEventListener("mouseup", onUp, true);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("blur", onBlur);
      scroller.addEventListener("scroll", onScroll);
    };

    scroller.addEventListener("mousedown", onDown, true);
    return () => {
      scroller.removeEventListener("mousedown", onDown, true);
      finish(false);
    };
  }, [scrollRef]);
}
