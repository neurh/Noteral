/**
 * Status bar layout: which items show, where (left / center / right), in what order, how
 * wide, and what goes between them. Stored in customizations.statusBar; the status bar's
 * right-click menu and the SDK (statusBar.configure / statusBar.setItem) edit it.
 *
 * Item keys: built-ins are "builtin:<id>" (save, stats, plugins, local, page, clock);
 * custom widgets use their contribution key (see statusBar.list).
 * Pure module: no store or customizations imports.
 */

export type StatusSide = "left" | "center" | "right";
/** px, "auto" (fit content), "fill" (take the free space) or a percentage like "30%". */
export type StatusWidth = number | "auto" | "fill" | `${number}%`;
export type StatusSeparator = "none" | "line" | "dot" | "space" | "slash";

export interface StatusItemLayout {
  hidden?: boolean;
  side?: StatusSide;
  order?: number;
  width?: StatusWidth;
  /** Content alignment inside a fixed or fill width. */
  align?: "start" | "center" | "end";
}

export interface StatusBarLayout {
  /** Hide the whole status bar. */
  hidden?: boolean;
  separator?: StatusSeparator;
  /** Space between items in px (default 10). */
  gap?: number;
  /** Bar height in px (default from the --status-h token). */
  height?: number;
  /** Side padding in px (default 12). */
  padding?: number;
  /** Text size in px (default 10.5). */
  fontSize?: number;
  items?: Record<string, StatusItemLayout>;
}

export const STATUS_SEPARATORS: readonly StatusSeparator[] = ["none", "line", "dot", "space", "slash"];
const SIDES: readonly StatusSide[] = ["left", "center", "right"];
const KEY = /^[A-Za-z0-9:._-]{1,200}$/;
const MAX_ITEMS = 80;

/** What the app does before anyone customizes it. */
export const DEFAULT_STATUS_ITEMS: Record<string, StatusItemLayout> = {
  "builtin:local": { hidden: true },
  "builtin:page": { hidden: true },
  "builtin:clock": { hidden: true },
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeStatusWidth(value: unknown): StatusWidth | undefined {
  if (finite(value)) return Math.max(16, Math.min(1200, Math.round(value)));
  if (value === "auto" || value === "fill") return value;
  if (typeof value === "string") {
    const match = /^\s*(\d{1,3}(?:\.\d+)?)\s*%\s*$/.exec(value);
    if (match) return `${Math.max(1, Math.min(100, Number(match[1])))}%` as StatusWidth;
    const px = /^\s*(\d{1,4})\s*(?:px)?\s*$/.exec(value);
    if (px) return Math.max(16, Math.min(1200, Number(px[1])));
  }
  return undefined;
}

export function normalizeStatusItem(value: unknown): StatusItemLayout | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const item: StatusItemLayout = {};
  if (typeof raw.hidden === "boolean") item.hidden = raw.hidden;
  if (SIDES.includes(raw.side as StatusSide)) item.side = raw.side as StatusSide;
  if (finite(raw.order)) item.order = Math.max(-1000, Math.min(1000, Math.round(raw.order)));
  const width = normalizeStatusWidth(raw.width);
  if (width !== undefined) item.width = width;
  if (raw.align === "start" || raw.align === "center" || raw.align === "end") item.align = raw.align;
  return Object.keys(item).length ? item : undefined;
}

export function normalizeStatusBar(value: unknown): StatusBarLayout | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const out: StatusBarLayout = {};
  if (typeof raw.hidden === "boolean") out.hidden = raw.hidden;
  if (STATUS_SEPARATORS.includes(raw.separator as StatusSeparator)) out.separator = raw.separator as StatusSeparator;
  if (finite(raw.gap)) out.gap = Math.max(0, Math.min(48, Math.round(raw.gap)));
  if (finite(raw.height)) out.height = Math.max(16, Math.min(48, Math.round(raw.height)));
  if (finite(raw.padding)) out.padding = Math.max(0, Math.min(48, Math.round(raw.padding)));
  if (finite(raw.fontSize)) out.fontSize = Math.max(8, Math.min(16, Math.round(raw.fontSize * 2) / 2));
  if (raw.items && typeof raw.items === "object" && !Array.isArray(raw.items)) {
    const items: Record<string, StatusItemLayout> = {};
    let count = 0;
    for (const [key, item] of Object.entries(raw.items as Record<string, unknown>)) {
      if (!KEY.test(key) || count >= MAX_ITEMS) continue;
      const clean = normalizeStatusItem(item);
      if (clean) {
        items[key] = clean;
        count += 1;
      }
    }
    if (count) out.items = items;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A built-in id ("save") or a full key ("builtin:save", "plugin:x:widget") → the item key. */
export function statusItemKey(id: string, known: readonly string[]): string {
  if (known.includes(id)) return id;
  if (known.includes(`builtin:${id}`)) return `builtin:${id}`;
  const suffix = known.filter((key) => key.endsWith(`:${id}`));
  return suffix.length === 1 ? suffix[0] : id;
}

export interface StatusSlotInput {
  key: string;
  side: StatusSide;
  order: number;
  width?: StatusWidth;
}

export interface ResolvedStatusSlot extends StatusSlotInput {
  align?: StatusItemLayout["align"];
}

/** Apply the layout to the slots: drop hidden ones, move, reorder and size the rest. */
export function resolveStatusSlots<T extends StatusSlotInput>(slots: T[], layout: StatusBarLayout | undefined): (T & ResolvedStatusSlot)[] {
  const items = layout?.items ?? {};
  const out: (T & ResolvedStatusSlot)[] = [];
  for (const slot of slots) {
    const custom = { ...DEFAULT_STATUS_ITEMS[slot.key], ...items[slot.key] };
    if (custom.hidden) continue;
    out.push({
      ...slot,
      side: custom.side ?? slot.side,
      order: custom.order ?? slot.order,
      ...(custom.width !== undefined ? { width: custom.width } : {}),
      ...(custom.align ? { align: custom.align } : {}),
    });
  }
  return out.sort((a, b) => a.order - b.order);
}

/** Whether an item is hidden by the layout (or by default). */
export function isStatusItemHidden(key: string, layout: StatusBarLayout | undefined): boolean {
  return Boolean({ ...DEFAULT_STATUS_ITEMS[key], ...layout?.items?.[key] }.hidden);
}

/** CSS width for a slot. */
export function statusWidthStyle(width: StatusWidth | undefined): { width?: number | string; flex?: string; minWidth?: number } {
  if (width === undefined || width === "auto") return {};
  if (width === "fill") return { flex: "1 1 0", minWidth: 0 };
  if (typeof width === "number") return { width, flex: "0 0 auto" };
  return { width, flex: "0 0 auto" };
}

/** `over` wins; item settings merge per key. */
export function mergeStatusBar(base: StatusBarLayout | undefined, over: StatusBarLayout | undefined): StatusBarLayout | undefined {
  if (!base) return over;
  if (!over) return base;
  const items: Record<string, StatusItemLayout> = { ...base.items };
  for (const [key, item] of Object.entries(over.items ?? {})) items[key] = { ...items[key], ...item };
  const out: StatusBarLayout = { ...base, ...over };
  if (Object.keys(items).length) out.items = items;
  else delete out.items;
  return out;
}
