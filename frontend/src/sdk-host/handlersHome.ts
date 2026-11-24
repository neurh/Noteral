/**
 * Home handlers: custom views (layout, style, scoped CSS), widgets (including fully custom
 * HTML widgets), backgrounds and the default view.
 */
import {
  HOME_BACKGROUNDS,
  HOME_TEMPLATES,
  HOME_TEMPLATE_INFO,
  HOME_WIDGET_INFO,
  HOME_WIDGET_TYPES,
  MAX_CUSTOM_VIEWS,
  MAX_WIDGETS,
  backgroundForView,
  clampBox,
  findFreeSpot,
  isHexColor,
  newWidget,
  normalizeCustomView,
} from "../lib/home";
import type { HomeCustomView, HomeTemplate, HomeWidget, HomeWidgetType } from "../lib/home";
import { isHomeTab } from "../store";
import { store } from "./handlers";
import type { HomeViewInfo, HomeViewSummary, HomeWidgetInfo, HomeWidgetTypeInfo } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = Record<string, any>;

const WIDGET_FIELDS = ["title", "hideTitle", "style", "tint", "variant", "text", "limit", "pageId", "pageIds", "url", "date", "html", "css", "data"] as const;
const VIEW_FIELDS = ["name", "title", "width", "gap", "cards", "radius", "shadow", "font", "valign", "css"] as const;

function isTemplate(id: string): id is HomeTemplate {
  return (HOME_TEMPLATES as readonly string[]).includes(id) && id !== "custom";
}

function requireView(viewId: string): HomeCustomView {
  const view = store().homeViews.find((item) => item.id === viewId || item.name === viewId);
  if (view) return view;
  if (isTemplate(viewId)) throw new Error(`"${viewId}" is a built-in template and can't be edited. Create a custom view with home.createView.`);
  const known = store().homeViews.map((item) => `${item.id} (${item.name})`).join(", ") || "none";
  throw new Error(`No custom Home view "${viewId}". Custom views: ${known}.`);
}

/** A template id or a custom view id/name → the key Home uses for it. */
function viewKey(viewId: string): string {
  if (isTemplate(viewId)) return viewId;
  return requireView(viewId).id;
}

function widgetInfo(widget: HomeWidget): HomeWidgetInfo {
  return structuredClone(widget) as unknown as HomeWidgetInfo;
}

function viewInfo(view: HomeCustomView): HomeViewInfo {
  return {
    id: view.id,
    name: view.name,
    title: view.title,
    width: view.width,
    gap: view.gap,
    cards: view.cards,
    radius: view.radius,
    shadow: view.shadow,
    font: view.font,
    valign: view.valign,
    ...(view.accent ? { accent: view.accent } : {}),
    ...(view.css ? { css: view.css } : {}),
    widgets: view.widgets.map(widgetInfo),
    backgrounds: [...HOME_BACKGROUNDS, "custom-color", "custom-gradient"],
  };
}

/** Save a view and return what normalization kept. */
function saveView(view: HomeCustomView, patch: Partial<HomeCustomView>): HomeViewInfo {
  if (!normalizeCustomView({ ...view, ...patch, id: view.id })) throw new Error("That change would make the view invalid.");
  store().updateHomeView(view.id, patch);
  return viewInfo(requireView(view.id));
}

function widgetPatch(p: Params): Partial<HomeWidget> {
  const patch: Record<string, unknown> = {};
  for (const key of WIDGET_FIELDS) if (p[key] !== undefined) patch[key] = p[key];
  if (typeof p.tint === "string" && p.tint && !isHexColor(p.tint)) throw new Error("tint must be #rrggbb.");
  if (p.date !== undefined && p.date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.date))) throw new Error("date must be YYYY-MM-DD.");
  return patch as Partial<HomeWidget>;
}

function openView(key: string) {
  const state = store();
  const settings = isTemplate(key) ? { template: key } : { template: "custom" as const, view: key };
  const active = state.activeTabId;
  if (active && isHomeTab(active)) state.updateHomeTab(active, settings);
  else state.openHomeTab({ ...(state.homeTabs[active] ?? {}), ...settings } as never);
}

export const HOME_HANDLERS: Record<string, (p: Params) => unknown> = {
  "home.listViews": (): HomeViewSummary[] => {
    const state = store();
    const defaultView = state.homePrefs.defaultView ?? "desk";
    const templates: HomeViewSummary[] = HOME_TEMPLATES.filter((id) => id !== "custom").map((id) => ({
      id,
      name: HOME_TEMPLATE_INFO[id].label,
      kind: "template",
      isDefault: defaultView === id,
      background: backgroundForView(state.homePrefs, id).background,
    }));
    const custom: HomeViewSummary[] = state.homeViews.map((view) => ({
      id: view.id,
      name: view.name,
      kind: "custom",
      isDefault: defaultView === view.id,
      widgets: view.widgets.length,
      background: backgroundForView(state.homePrefs, view.id).background,
    }));
    return [...templates, ...custom];
  },
  "home.widgetTypes": (): HomeWidgetTypeInfo[] =>
    HOME_WIDGET_TYPES.map((type) => ({ type, label: HOME_WIDGET_INFO[type].label, description: HOME_WIDGET_INFO[type].description, w: HOME_WIDGET_INFO[type].span * 2, h: HOME_WIDGET_INFO[type].rows })),
  "home.getView": (p) => viewInfo(requireView(p.viewId)),
  "home.createView": (p) => {
    const state = store();
    if (state.homeViews.length >= MAX_CUSTOM_VIEWS) throw new Error(`There are already ${MAX_CUSTOM_VIEWS} custom Home views. Remove one first.`);
    let id: string | undefined;
    const name = typeof p.name === "string" ? p.name.trim().slice(0, 40) : undefined;
    if (p.from) {
      const source = requireView(p.from);
      id = state.duplicateHomeView(source.id);
      if (id && name) state.updateHomeView(id, { name });
    } else {
      id = state.createHomeView(undefined, name);
      if (p.empty) state.updateHomeView(id, { widgets: [] });
    }
    if (!id) throw new Error("The view was not created.");
    if (p.open !== false) openView(id);
    return viewInfo(requireView(id));
  },
  "home.updateView": (p) => {
    const view = requireView(p.viewId);
    const patch: Record<string, unknown> = {};
    for (const key of VIEW_FIELDS) if (p[key] !== undefined) patch[key] = p[key];
    if (p.accent !== undefined) {
      if (p.accent && !isHexColor(p.accent)) throw new Error("accent must be #rrggbb, or \"\" to reset.");
      patch.accent = p.accent || undefined;
    }
    if (typeof patch.name === "string" && !patch.name.trim()) throw new Error("name can't be empty.");
    if (patch.css === "") patch.css = undefined;
    return saveView(view, patch as Partial<HomeCustomView>);
  },
  "home.removeView": (p) => {
    store().removeHomeView(requireView(p.viewId).id);
  },
  "home.setDefault": (p) => {
    store().setDefaultHomeView(viewKey(p.viewId));
  },
  "home.open": (p) => {
    openView(viewKey(p.viewId));
  },
  "home.setBackground": (p) => {
    const key = viewKey(p.viewId);
    const background = String(p.background);
    if (background === "custom-color") {
      if (!isHexColor(p.color)) throw new Error("custom-color needs color as #rrggbb.");
      store().setHomeBackground(key, { background: "custom-color" as never, color: p.color });
      return;
    }
    if (background === "custom-gradient") {
      const g = p.gradient;
      if (!g || !isHexColor(g.from) || !isHexColor(g.to)) throw new Error("custom-gradient needs gradient { from, to } as #rrggbb.");
      store().setHomeBackground(key, { background: "custom-gradient" as never, gradient: { from: g.from, to: g.to, angle: g.angle ?? 135, kind: g.kind === "radial" ? "radial" : "linear" } });
      return;
    }
    if (!(HOME_BACKGROUNDS as readonly string[]).includes(background)) {
      throw new Error(`Unknown background "${background}". Presets: ${HOME_BACKGROUNDS.join(", ")}, custom-color, custom-gradient.`);
    }
    store().setHomeBackground(key, { background: background as never });
  },
  "home.addWidget": (p) => {
    const view = requireView(p.viewId);
    const type = String(p.type) as HomeWidgetType;
    if (!(HOME_WIDGET_TYPES as readonly string[]).includes(type)) throw new Error(`Unknown widget type "${type}". Types: ${HOME_WIDGET_TYPES.join(", ")}.`);
    if (type === "html" && !p.html) throw new Error("An html widget needs html.");
    if (view.widgets.length >= MAX_WIDGETS) throw new Error(`A view holds at most ${MAX_WIDGETS} widgets.`);
    const widget = newWidget(type, widgetPatch(p));
    const box = clampBox({ x: Math.max(0, p.x ?? 0), y: Math.max(0, p.y ?? 0), w: p.w ?? widget.w, h: p.h ?? widget.h });
    if (p.x === undefined || p.y === undefined) {
      const spot = findFreeSpot(view.widgets, box.w, box.h);
      box.x = spot.x;
      box.y = spot.y;
    }
    Object.assign(widget, box);
    const info = saveView(view, { widgets: [...view.widgets, widget] });
    const saved = info.widgets.find((item) => item.id === widget.id);
    if (!saved) throw new Error("The widget was not kept (check its fields).");
    return saved;
  },
  "home.updateWidget": (p) => {
    const view = requireView(p.viewId);
    const current = view.widgets.find((item) => item.id === p.widgetId);
    if (!current) throw new Error(`No widget "${p.widgetId}" in this view. home.getView lists its widgets.`);
    const next: HomeWidget = { ...current, ...widgetPatch(p) };
    if (p.type !== undefined) {
      if (!(HOME_WIDGET_TYPES as readonly string[]).includes(p.type)) throw new Error(`Unknown widget type "${p.type}".`);
      next.type = p.type;
    }
    if (p.x !== undefined || p.y !== undefined || p.w !== undefined || p.h !== undefined) {
      Object.assign(next, clampBox({ x: p.x ?? current.x, y: p.y ?? current.y, w: p.w ?? current.w, h: p.h ?? current.h }));
    }
    const info = saveView(view, { widgets: view.widgets.map((item) => (item.id === current.id ? next : item)) });
    return info.widgets.find((item) => item.id === current.id)!;
  },
  "home.removeWidget": (p) => {
    const view = requireView(p.viewId);
    if (!view.widgets.some((item) => item.id === p.widgetId)) throw new Error(`No widget "${p.widgetId}" in this view.`);
    saveView(view, { widgets: view.widgets.filter((item) => item.id !== p.widgetId) });
  },
};
