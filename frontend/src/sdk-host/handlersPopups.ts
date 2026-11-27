/**
 * ui.menu / ui.showModal / ui.popover / ui.closePopups: menus and HTML popups that plugins,
 * layer views and Home widgets can open anywhere in the window (rendered by <HostPopups />).
 *
 * Views call these through `noteral.menu(items, event)`, `noteral.modal({...})` and
 * `noteral.popover({...}, element)`; ViewFrame turns frame coordinates into window ones.
 * A modal or popover view runs with its opener's owner and permissions and finishes with
 * `noteral.close(value)`, which resolves the call that opened it.
 */
import { POPUP_PLACEMENTS, lastPointerPosition, normalizeMenuItems, normalizeRect, popups } from "../lib/popups";
import type { PopoverRequest, PopupOwner, PopupPlacement, PopupRect } from "../lib/popups";
import type { CallContext } from "./handlers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = Record<string, any>;
type Handler = (params: Params, ctx: CallContext) => unknown;

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

function rectOf(element: Element | null | undefined): PopupRect | undefined {
  if (!element) return undefined;
  const r = element.getBoundingClientRect();
  return r.width || r.height ? { x: r.left, y: r.top, width: r.width, height: r.height } : undefined;
}

/**
 * Named anchors, so plugin code without a DOM can place popups next to app things:
 * "status:<widget id>" (the caller's own status widget), "block:<id>", "selection" and "pointer".
 */
function namedAnchor(name: string, ctx: CallContext): PopupRect | undefined {
  if (typeof document === "undefined") return undefined;
  if (name === "pointer") {
    const at = lastPointerPosition();
    return { x: at.x, y: at.y, width: 0, height: 0 };
  }
  if (name === "selection") {
    const selection = window.getSelection();
    if (selection && selection.rangeCount) {
      const r = selection.getRangeAt(0).getBoundingClientRect();
      if (r.width || r.height) return { x: r.left, y: r.top, width: r.width, height: r.height };
    }
    return undefined;
  }
  const [kind, ...rest] = name.split(":");
  const id = rest.join(":");
  if (!id) return undefined;
  if (kind === "status") {
    const owner = popupOwner(ctx);
    const key = `${owner.kind}:${owner.id}:${id}`;
    return rectOf(document.querySelector(`[data-status-key="${CSS.escape(key)}"]`) ?? document.querySelector(`[data-status-key="${CSS.escape(id)}"]`));
  }
  if (kind === "block") return rectOf(document.querySelector(`.bn-block-outer[data-id="${CSS.escape(id)}"] .bn-block-content`) ?? document.querySelector(`[data-id="${CSS.escape(id)}"]`));
  return undefined;
}

function position(params: Params, ctx?: CallContext) {
  const placement = POPUP_PLACEMENTS.includes(params.placement) ? (params.placement as PopupPlacement) : undefined;
  const anchor = typeof params.anchor === "string" && ctx ? namedAnchor(params.anchor, ctx) : normalizeRect(params.anchor);
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
  "ui.popover": async (p, ctx) => {
    const parent = ctx.viewKey?.startsWith("popup:") ? Number(ctx.viewKey.slice(6)) : undefined;
    const request: Omit<PopoverRequest, "kind"> = {
      owner: popupOwner(ctx),
      permissions: ctx.permissions ?? [],
      html: html(p),
      data: jsonData(p.data),
      ...position(p, ctx),
      ...(num(p.width) ? { width: p.width } : {}),
      ...(num(p.height) ? { height: p.height } : {}),
      ...(num(p.maxHeight) ? { maxHeight: p.maxHeight } : {}),
      ...(num(p.offset) !== undefined ? { offset: Math.max(-40, Math.min(80, p.offset)) } : {}),
      ...(typeof p.name === "string" && p.name.trim() ? { name: p.name.trim().slice(0, 64) } : {}),
      ...(p.bare === true ? { bare: true } : {}),
      ...(p.persistent === true ? { persistent: true } : {}),
      ...(p.escape === false ? { escape: false } : {}),
      ...(parent !== undefined && Number.isFinite(parent) ? { parent } : {}),
    };
    // A status widget toggling its own popover: clicks on the widget shouldn't count as "outside".
    if (typeof p.anchor === "string" && p.anchor.startsWith("status:")) {
      const owner = request.owner;
      request.ignore = `[data-status-key="${`${owner.kind}:${owner.id}:${p.anchor.slice(7)}`.replace(/["\\]/g, "")}"]`;
    }
    return popups.popover(request, { toggle: p.toggle === true });
  },
  "ui.updatePopover": (p, ctx) => {
    const name = typeof p.name === "string" ? p.name.trim() : "";
    const open = name ? popups.findPopover(popupOwner(ctx), name) : undefined;
    if (!open) return false;
    const patch: Parameters<typeof popups.updatePopover>[1] = {};
    if (p.data !== undefined) patch.data = jsonData(p.data);
    if (typeof p.html === "string" && p.html.trim()) patch.html = p.html;
    if (num(p.width)) patch.width = p.width;
    if (num(p.height)) patch.height = p.height;
    Object.assign(patch, position(p, ctx));
    return popups.updatePopover(open.id, patch);
  },
  "ui.closePopups": (p, ctx) => {
    const name = typeof p.name === "string" && p.name.trim() ? p.name.trim() : undefined;
    popups.closeOwnedBy(popupOwner(ctx), name);
  },
};
