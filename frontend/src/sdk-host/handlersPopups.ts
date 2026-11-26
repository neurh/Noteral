/**
 * ui.menu / ui.showModal / ui.popover / ui.closePopups: menus and HTML popups that plugins,
 * layer views and Home widgets can open anywhere in the window (rendered by <HostPopups />).
 *
 * Views call these through `noteral.menu(items, event)`, `noteral.modal({...})` and
 * `noteral.popover({...}, element)`; ViewFrame turns frame coordinates into window ones.
 * A modal or popover view runs with its opener's owner and permissions and finishes with
 * `noteral.close(value)`, which resolves the call that opened it.
 */
import { normalizeMenuItems, normalizeRect, popups } from "../lib/popups";
import type { PopupOwner, PopupPlacement } from "../lib/popups";
import type { CallContext } from "./handlers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = Record<string, any>;
type Handler = (params: Params, ctx: CallContext) => unknown;

const PLACEMENTS: readonly PopupPlacement[] = ["bottom-start", "bottom-end", "top-start", "top-end", "right-start", "left-start"];

/** Who a popup view belongs to, from the calling context. */
export function popupOwner(ctx: CallContext): PopupOwner {
  const id = ctx.pluginId ?? "";
  if (ctx.caller !== "plugin" || !id) return { kind: "app", id: "assistant", name: "Assistant" };
  if (id.startsWith("layer:")) return { kind: "layer", id: id.slice(6), name: ctx.pluginName ?? id.slice(6) };
  if (id.startsWith("app:")) return { kind: "app", id: id.slice(4), name: ctx.pluginName ?? "Widget" };
  return { kind: "plugin", id, name: ctx.pluginName ?? id };
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function position(params: Params) {
  const placement = PLACEMENTS.includes(params.placement) ? (params.placement as PopupPlacement) : undefined;
  const anchor = normalizeRect(params.anchor);
  const x = num(params.x);
  const y = num(params.y);
  return { ...(anchor ? { anchor } : {}), ...(x !== undefined && y !== undefined ? { x, y } : {}), ...(placement ? { placement } : {}) };
}

function html(params: Params): string {
  const value = typeof params.html === "string" ? params.html : "";
  if (!value.trim()) throw new Error("html is required.");
  return value;
}

/** Keep `data` JSON-shaped (it is posted into the frame). */
function jsonData(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new Error("data must be JSON.");
  }
}

export const POPUP_HANDLERS: Record<string, Handler> = {
  "ui.menu": async (p) => {
    const items = normalizeMenuItems(p.items);
    if (!items.some((item) => (item.type ?? "item") === "item")) throw new Error("A menu needs at least one item with an id and a label.");
    return popups.menu({
      items,
      ...position(p),
      ...(num(p.width) ? { width: Math.max(140, Math.min(480, Math.round(p.width))) } : {}),
      ...(p.filter === true ? { filter: true } : {}),
    });
  },
  "ui.showModal": async (p, ctx) =>
    popups.modal({
      owner: popupOwner(ctx),
      permissions: ctx.permissions ?? [],
      html: html(p),
      data: jsonData(p.data),
      ...(typeof p.title === "string" ? { title: p.title.slice(0, 120) } : {}),
      ...(typeof p.subtitle === "string" ? { subtitle: p.subtitle.slice(0, 240) } : {}),
      ...(num(p.width) ? { width: p.width } : {}),
      ...(num(p.height) ? { height: p.height } : {}),
      ...(p.dismissible === false ? { dismissible: false } : {}),
      ...(p.bare === true ? { bare: true } : {}),
    }),
  "ui.popover": async (p, ctx) =>
    popups.popover({
      owner: popupOwner(ctx),
      permissions: ctx.permissions ?? [],
      html: html(p),
      data: jsonData(p.data),
      ...position(p),
      ...(num(p.width) ? { width: p.width } : {}),
      ...(num(p.height) ? { height: p.height } : {}),
    }),
  "ui.closePopups": (_p, ctx) => {
    popups.closeOwnedBy(popupOwner(ctx));
  },
};
