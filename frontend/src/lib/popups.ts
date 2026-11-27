/**
 * Popups the app, plugins and HTML views can open: context menus (with submenus,
 * checkboxes, headers and separators), modal views and anchored popovers.
 *
 * Everything is rendered by <HostPopups /> at the app root, so a menu opened from a
 * 22px status-bar widget or a sandboxed block can still use the whole window.
 * Positions are viewport coordinates; ViewFrame translates coordinates that come from
 * inside an iframe.
 */
import { useSyncExternalStore } from "react";

export interface PopupRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PopupMenuItem {
  id?: string;
  label?: string;
  /** Emoji, Lucide icon name or image URL. */
  icon?: string;
  /** Faint text on the right (a shortcut or a count). */
  hint?: string;
  /** Second line under the label. */
  description?: string;
  type?: "item" | "separator" | "header";
  danger?: boolean;
  disabled?: boolean;
  /** Shows a check mark (true) or an empty check slot (false). Undefined = no slot. */
  checked?: boolean;
  children?: PopupMenuItem[];
  /** In-app callers only: run instead of resolving the menu with the id. */
  run?: () => void;
  /** Keep the menu open after choosing (toggles). In-app callers only. */
  keepOpen?: boolean;
}

export type PopupPlacement =
  | "bottom-start"
  | "bottom-end"
  | "bottom-center"
  | "top-start"
  | "top-end"
  | "top-center"
  | "right-start"
  | "right-end"
  | "right-center"
  | "left-start"
  | "left-end"
  | "left-center"
  /** The middle of the window (ignores the anchor). */
  | "center";

export const POPUP_PLACEMENTS: readonly PopupPlacement[] = [
  "bottom-start",
  "bottom-end",
  "bottom-center",
  "top-start",
  "top-end",
  "top-center",
  "right-start",
  "right-end",
  "right-center",
  "left-start",
  "left-end",
  "left-center",
  "center",
];

export interface MenuRequest {
  kind: "menu";
  items: PopupMenuItem[];
  /** Open at a point… */
  x?: number;
  y?: number;
  /** …or next to an element's rect. */
  anchor?: PopupRect;
  placement?: PopupPlacement;
  width?: number;
  /** Search box above the items (long menus). */
  filter?: boolean;
  className?: string;
}

/** Who opened a view popup: its frame runs with this owner's permissions. */
export interface PopupOwner {
  kind: "plugin" | "layer" | "app";
  id: string;
  name: string;
}

export interface ViewOwner {
  owner: PopupOwner;
  permissions: readonly string[];
}

export interface ModalRequest extends ViewOwner {
  kind: "modal";
  title?: string;
  subtitle?: string;
  html: string;
  data?: unknown;
  width?: number;
  height?: number;
  /** Clicking the backdrop or pressing Escape closes it (default true). */
  dismissible?: boolean;
  /** Draw no header/padding around the view. */
  bare?: boolean;
}

export interface PopoverRequest extends ViewOwner {
  kind: "popover";
  html: string;
  data?: unknown;
  x?: number;
  y?: number;
  anchor?: PopupRect;
  placement?: PopupPlacement;
  /** Gap between the anchor and the popover in px (default 4). */
  offset?: number;
  width?: number;
  height?: number;
  /** Cap for a popover that grows with its content (default 70% of the window). */
  maxHeight?: number;
  /** A name the opener picks, so it can update, toggle or close this popover later. */
  name?: string;
  /** No background, border, radius or shadow: the view paints everything. */
  bare?: boolean;
  /** Outside clicks don't close it (Escape still does, unless escape is false). */
  persistent?: boolean;
  /** Escape closes it (default true). */
  escape?: boolean;
  /** In-app: pointer-downs inside elements matching this selector don't close it (its toggle button). */
  ignore?: string;
  /** The popup this one was opened from (kept open while this one is). */
  parent?: number;
}

export type PopupRequest = MenuRequest | ModalRequest | PopoverRequest;

export interface OpenPopup {
  id: number;
  request: PopupRequest;
  resolve: (value: unknown) => void;
}

let open: OpenPopup[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const MAX_OPEN = 8;

function emit() {
  for (const listener of listeners) listener();
}

/** Last pointer position, so menus opened by code without a position appear by the cursor. */
let lastPointer = { x: 0, y: 0, at: 0 };
if (typeof window !== "undefined") {
  const track = (event: MouseEvent) => {
    lastPointer = { x: event.clientX, y: event.clientY, at: Date.now() };
  };
  window.addEventListener("pointerdown", track, true);
  window.addEventListener("contextmenu", track, true);
}

export function lastPointerPosition(): { x: number; y: number } {
  if (Date.now() - lastPointer.at < 10_000) return { x: lastPointer.x, y: lastPointer.y };
  return { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 3) };
}

/** The popup ids `id` was opened from, nearest first. */
function ancestors(id: number | undefined): Set<number> {
  const out = new Set<number>();
  while (id !== undefined && !out.has(id)) {
    out.add(id);
    const popup = open.find((item) => item.id === id);
    id = popup?.request.kind === "popover" ? popup.request.parent : undefined;
  }
  return out;
}

function show<T>(request: PopupRequest, closeMenus = true): Promise<T | null> {
  // A new menu replaces any menu already open (menus are transient) but leaves popovers alone,
  // so a popover can open menus. A new popover closes menus and other popovers, except the ones
  // it was opened from and persistent ones. Modals stack.
  if (closeMenus && request.kind !== "modal") {
    const keep = request.kind === "popover" ? ancestors(request.parent) : new Set<number>();
    const closes = (popup: OpenPopup) =>
      popup.request.kind === "menu" || (request.kind === "popover" && popup.request.kind === "popover" && !popup.request.persistent && !keep.has(popup.id));
    for (const item of open.filter(closes)) item.resolve(null);
    open = open.filter((popup) => !closes(popup));
  }
  if (open.length >= MAX_OPEN) return Promise.reject(new Error("Too many popups are open."));
  return new Promise<T | null>((resolve) => {
    const id = nextId++;
    open = [...open, { id, request, resolve: resolve as (value: unknown) => void }];
    emit();
  });
}

export const popups = {
  /** Open a menu; resolves to the chosen item id, or null when dismissed. Items with `run` run instead. */
  menu(request: Omit<MenuRequest, "kind">): Promise<string | null> {
    const at = request.anchor || (request.x !== undefined && request.y !== undefined) ? {} : lastPointerPosition();
    return show<string>({ kind: "menu", ...at, ...request });
  },
  /** Open a context menu at a mouse event (preventing the native menu). */
  contextMenu(event: { clientX: number; clientY: number; preventDefault: () => void }, items: PopupMenuItem[], extra: Partial<MenuRequest> = {}) {
    event.preventDefault();
    return popups.menu({ ...extra, items, x: event.clientX, y: event.clientY });
  },
  /** Open a menu below an element. */
  menuAt(element: Element, items: PopupMenuItem[], extra: Partial<MenuRequest> = {}) {
    const rect = element.getBoundingClientRect();
    return popups.menu({ placement: "bottom-start", ...extra, items, anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } });
  },
  modal(request: Omit<ModalRequest, "kind">): Promise<unknown> {
    return show({ kind: "modal", ...request });
  },
  /** Open a popover. With a `name` already open for the same owner it is replaced, or closed when `toggle`. */
  popover(request: Omit<PopoverRequest, "kind">, options: { toggle?: boolean } = {}): Promise<unknown> {
    if (request.name) {
      const existing = popups.findPopover(request.owner, request.name);
      if (existing) {
        popups.close(existing.id, null);
        if (options.toggle) return Promise.resolve(null);
      }
    }
    const at = request.anchor || (request.x !== undefined && request.y !== undefined) || request.placement === "center" ? {} : lastPointerPosition();
    return show({ kind: "popover", ...at, ...request });
  },
  /** The open popover an owner named `name`. */
  findPopover(owner: Pick<PopupOwner, "kind" | "id">, name: string): OpenPopup | undefined {
    return open.find((popup) => popup.request.kind === "popover" && popup.request.name === name && popup.request.owner.kind === owner.kind && popup.request.owner.id === owner.id);
  },
  /** Change an open popover in place (data reaches the view as props, without reloading). */
  updatePopover(id: number, patch: Partial<Pick<PopoverRequest, "data" | "html" | "width" | "height" | "anchor" | "x" | "y" | "placement">>): boolean {
    const popup = open.find((item) => item.id === id);
    if (!popup || popup.request.kind !== "popover") return false;
    open = open.map((item) => (item.id === id ? { ...item, request: { ...(item.request as PopoverRequest), ...patch } } : item));
    emit();
    return true;
  },
  /** Close one popup with a result. */
  close(id: number, value: unknown = null) {
    const popup = open.find((item) => item.id === id);
    if (!popup) return;
    open = open.filter((item) => item.id !== id);
    popup.resolve(value ?? null);
    emit();
  },
  /** Close every popup a plugin or layer opened (when it stops), or only the popover with `name`. */
  closeOwnedBy(owner: Pick<PopupOwner, "kind" | "id">, name?: string) {
    const mine = open.filter(
      (popup) =>
        popup.request.kind !== "menu" &&
        popup.request.owner.kind === owner.kind &&
        popup.request.owner.id === owner.id &&
        (name === undefined || (popup.request.kind === "popover" && popup.request.name === name)),
    );
    if (!mine.length) return;
    for (const popup of mine) popup.resolve(null);
    open = open.filter((popup) => !mine.includes(popup));
    emit();
  },
  closeAll() {
    const all = open;
    open = [];
    for (const popup of all) popup.resolve(null);
    if (all.length) emit();
  },
  current: () => open,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useOpenPopups(): OpenPopup[] {
  return useSyncExternalStore(popups.subscribe, popups.current, popups.current);
}

// ── input from plugins and views ─────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const out = value.trim().slice(0, max);
  return out || undefined;
}

const MAX_ITEMS = 200;

/** Validate untrusted menu items (from the SDK): drops `run`, caps sizes and depth. */
export function normalizeMenuItems(value: unknown, depth = 0, budget = { left: MAX_ITEMS }): PopupMenuItem[] {
  if (!Array.isArray(value)) return [];
  const out: PopupMenuItem[] = [];
  for (const raw of value) {
    if (budget.left <= 0) break;
    if (raw === "-" || raw === "separator") {
      out.push({ type: "separator" });
      budget.left -= 1;
      continue;
    }
    if (!isObject(raw)) continue;
    const type = raw.type === "separator" || raw.separator === true ? "separator" : raw.type === "header" || raw.header === true ? "header" : "item";
    budget.left -= 1;
    if (type === "separator") {
      out.push({ type });
      continue;
    }
    const label = text(raw.label ?? raw.title, 120);
    if (!label) continue;
    const item: PopupMenuItem = { type, label };
    if (type === "item") {
      const id = text(raw.id, 120);
      const children = depth < 3 ? normalizeMenuItems(raw.children ?? raw.items, depth + 1, budget) : [];
      if (children.length) item.children = children;
      else if (id) item.id = id;
      else continue;
    }
    const icon = text(raw.icon, 300);
    if (icon) item.icon = icon;
    const hint = text(raw.hint ?? raw.shortcut, 40);
    if (hint) item.hint = hint;
    const description = text(raw.description, 200);
    if (description) item.description = description;
    if (raw.danger === true) item.danger = true;
    if (raw.disabled === true) item.disabled = true;
    if (typeof raw.checked === "boolean") item.checked = raw.checked;
    out.push(item);
  }
  // Trim leading, trailing and doubled separators.
  return out.filter((item, index, list) => item.type !== "separator" || (index > 0 && index < list.length - 1 && list[index - 1].type !== "separator"));
}

export function normalizeRect(value: unknown): PopupRect | undefined {
  if (!isObject(value)) return undefined;
  const nums = ["x", "y", "width", "height"].map((key) => (typeof value[key] === "number" && Number.isFinite(value[key]) ? (value[key] as number) : key === "x" ? Number(value.left) : key === "y" ? Number(value.top) : 0));
  if (!Number.isFinite(nums[0]) || !Number.isFinite(nums[1])) return undefined;
  return { x: nums[0], y: nums[1], width: Math.max(0, nums[2] || 0), height: Math.max(0, nums[3] || 0) };
}

// ── positioning ─────────────────────────────────────────────────────────────

/** Place a box of `size` at a point or next to a rect, flipped and clamped inside the window. */
export function placePopup(
  size: { width: number; height: number },
  at: { x?: number; y?: number; anchor?: PopupRect; placement?: PopupPlacement; offset?: number },
  viewport = { width: window.innerWidth, height: window.innerHeight },
  margin = 8,
): { left: number; top: number } {
  const { width, height } = size;
  let left: number;
  let top: number;
  const placement = at.placement ?? "bottom-start";
  if (placement === "center") {
    left = (viewport.width - width) / 2;
    top = (viewport.height - height) / 2;
  } else if (at.anchor) {
    const a = at.anchor;
    if (placement.startsWith("right") || placement.startsWith("left")) {
      const gap = at.offset ?? 2;
      const rightFits = a.x + a.width + gap + width <= viewport.width - margin;
      const leftFits = a.x - width - gap >= margin;
      top = placement.endsWith("end") ? a.y + a.height - height + 5 : placement.endsWith("center") ? a.y + (a.height - height) / 2 : a.y - 5;
      if (placement.startsWith("right")) left = rightFits || !leftFits ? a.x + a.width + gap : a.x - width - gap;
      else left = leftFits || !rightFits ? a.x - width - gap : a.x + a.width + gap;
      if (!rightFits && !leftFits) {
        // Narrow windows: drop below the item, indented, so the parent item stays visible.
        left = a.x + 24;
        top = a.y + a.height + 2;
      }
    } else {
      const gap = at.offset ?? 4;
      const below = a.y + a.height + gap;
      const above = a.y - height - gap;
      const wantsTop = placement.startsWith("top");
      top = wantsTop ? (above >= margin ? above : below) : below + height <= viewport.height - margin || above < margin ? below : above;
      left = placement.endsWith("end") ? a.x + a.width - width : placement.endsWith("center") ? a.x + (a.width - width) / 2 : a.x;
    }
  } else {
    left = at.x ?? 0;
    top = at.y ?? 0;
    if (left + width > viewport.width - margin) left = Math.max(margin, left - width);
    if (top + height > viewport.height - margin) top = Math.max(margin, top - height);
  }
  left = Math.max(margin, Math.min(left, viewport.width - width - margin));
  top = Math.max(margin, Math.min(top, viewport.height - height - margin));
  return { left: Math.round(left), top: Math.round(top) };
}
