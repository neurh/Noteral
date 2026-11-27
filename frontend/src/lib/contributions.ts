/**
 * Contributions: the things plugins and customization layers add to the app's UI —
 * right-sidebar tabs, status-bar widgets, custom block types and custom node types.
 *
 * Two kinds of sources feed one registry:
 *  - running plugins (registered at runtime through the SDK; gone when the plugin stops),
 *  - customization layers (stored in customizations.json; made by the assistant or the user,
 *    toggled in Plugins → Created).
 *
 * Anything that renders HTML runs in a sandboxed <ViewFrame> with the owner's permissions.
 */
import { normalizeStatusWidth } from "./statusLayout";
import type { StatusSide, StatusWidth } from "./statusLayout";
import { useSyncExternalStore } from "react";
import type { PanelAction } from "../sdk-host/types";
import { setCustomValueTypeResolver } from "./database";
import type { FormulaResultType } from "./database";
import { POPUP_PLACEMENTS } from "./popups";
import type { PopupPlacement } from "./popups";

export type OwnerKind = "plugin" | "layer";

export interface ContributionOwner {
  kind: OwnerKind;
  id: string;
  name: string;
}

/** What a sidebar tab or similar surface shows: Markdown with buttons, or a full HTML view. */
export interface ViewDef {
  markdown?: string;
  actions?: PanelAction[];
  /** A complete HTML document or fragment. Inline <style> and <script> are allowed. */
  html?: string;
}

export interface SidebarTabDef {
  id: string;
  title: string;
  /** An emoji or one of the icon names in ICON_NAMES. */
  icon?: string;
  view: ViewDef;
}

/** A popover a status widget opens on click, anchored to the widget. */
export interface StatusPopupDef {
  html: string;
  width?: number;
  height?: number;
  placement?: PopupPlacement;
  /** No panel chrome (background, border, shadow): the view paints everything. */
  bare?: boolean;
  /** Keep it open on outside clicks (Escape or a second click on the widget closes it). */
  persistent?: boolean;
  data?: unknown;
}

export const STATUS_TONES = ["default", "muted", "accent", "success", "warning", "danger"] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

export interface StatusWidgetDef {
  id: string;
  text?: string;
  tooltip?: string;
  icon?: string;
  /** HTML widget, rendered in a small sandboxed frame (the bar's height). */
  html?: string;
  /** Width: px (HTML widgets default to 120), "auto", "fill" (free space) or "NN%" of the bar. */
  width?: StatusWidth;
  /** Bounds in px, applied on top of `width` (useful with "fill", "auto" and percentages). */
  minWidth?: number;
  maxWidth?: number;
  side: StatusSide;
  /** Lower comes first. */
  order: number;
  /** A command id to run on click (see commands.list). Plugin commands get { source: "status", widget, anchor }. */
  command?: string;
  /** Click opens this popover next to the widget (a second click closes it). */
  popup?: StatusPopupDef;
  /** Small pill after the text, e.g. an unread count. */
  badge?: string;
  /** Colour preset for text widgets. */
  tone?: StatusTone;
  /** CSS colours (hex, rgb(), hsl(), var(--token) or a name). */
  color?: string;
  background?: string;
  /** 0–1: a thin progress bar along the widget's bottom edge. */
  progress?: number;
  /** JSON given to HTML widgets as noteral.props.data; changing it updates the view without reloading. */
  data?: unknown;
}

/** Where an overlay sits in the window. "full" covers the whole window. */
export const OVERLAY_POSITIONS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right", "full"] as const;
export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number];
export type OverlaySize = number | `${number}%` | "auto";

/**
 * A floating HTML view above the whole app (it doesn't take space or move anything):
 * timers, HUDs, sticky notes, focus vignettes, confetti, mini players.
 */
export interface OverlayDef {
  id: string;
  html: string;
  title?: string;
  position: OverlayPosition;
  /** Distance from the window edge in px (default 16; 0 for "full"). */
  x?: number;
  y?: number;
  /** px, "NN%" of the window, or "auto" (height only: grows with the content). */
  width?: OverlaySize;
  height?: OverlaySize;
  /** false: clicks pass through to the app underneath (pure decoration). Default true. */
  interactive?: boolean;
  /** Show a drag grip so the user can move it (the position is remembered on this device). */
  draggable?: boolean;
  /** Panel chrome (background, border, radius, shadow). Default false: fully transparent. */
  chrome?: boolean;
  opacity?: number;
  /** "app" (default): above the app, below menus and dialogs. "top": above everything. */
  stack?: "app" | "top";
  /** Stacking among overlays; higher is on top. */
  order: number;
  hidden?: boolean;
  /** JSON given to the view as noteral.props.data; changes arrive without reloading. */
  data?: unknown;
}

/**
 * A database property type contributed by a plugin or layer. Properties of this type are
 * stored as `{ type: "custom", customType, config }`; their cell values are any JSON (a
 * primitive, or `{ value, text, ... }` where `value` sorts and filters and `text` searches).
 */
export interface PropertyTypeDef {
  type: string;
  title: string;
  icon?: string;
  description?: string;
  /** How values sort, filter, group and calculate. */
  valueType: FormulaResultType;
  /**
   * Cell HTML template: {{value}}, {{text}}, {{config.key}}, {{value.key}}, {{#if x}}…{{else}}…{{/if}},
   * {{#each list}}…{{this}}…{{/each}}, {{#repeat n}}…{{/repeat}}. Values are escaped; markup is sanitized
   * and rendered in a shadow root with `css`. Elements with data-value="json" set the cell value
   * when clicked (stars, toggles, steppers) without opening the editor.
   */
  render?: string;
  css?: string;
  /** HTML view opened to edit a cell: props { value, config, property, row }; noteral.setData(v) saves, noteral.close() closes. */
  editor?: string;
  editorWidth?: number;
  editorHeight?: number;
  /** Per-property options, edited in the property menu and passed to templates as config. */
  config?: SettingFieldDef[];
  defaultValue?: unknown;
  /** The owning plugin renders cells in its worker (SDK registerPropertyType({ render })). */
  renderer?: boolean;
  align?: "start" | "center" | "end";
}

export interface BlockTypeDef {
  /** Stored in documents, so keep it stable: lowercase letters, digits, dashes, dots. */
  type: string;
  title: string;
  description?: string;
  icon?: string;
  keywords?: string[];
  html: string;
  defaultData?: unknown;
  /** Initial height in px before the view reports its own (auto-resizes after). */
  height?: number;
}

export interface NodeTypeDef {
  type: string;
  title: string;
  description?: string;
  icon?: string;
  html: string;
  defaultData?: unknown;
  /**
   * "full" (default): the view is the whole page, edge to edge, and owns its scrolling.
   * "page": a normal page head (icon, cover, title) with the view below it, growing with
   * its content so the page scrolls once.
   */
  layout?: "full" | "page";
}

/**
 * App menus a plugin or layer can add items to: page (page actions ⋯), tree (page tree row),
 * block (block handle), tab (pane tab options ⌄), tabItem (right-click a tab), status
 * (right-click the status bar), assistant (the AI button's ⌄ menu), treeSelection (several
 * pages selected in the tree).
 */
export const MENU_SLOTS = ["page", "tree", "block", "tab", "tabItem", "status", "assistant", "treeSelection"] as const;
export type MenuSlot = (typeof MENU_SLOTS)[number];
export const MENU_ITEM_KINDS = ["page", "folder", "database", "custom"] as const;

/**
 * An item in one of the app's menus. Choosing it runs `command`: for plugins a command id of
 * the plugin itself (its handler gets the menu context), for layers any app command id.
 */
export interface MenuItemDef {
  id: string;
  menu: MenuSlot;
  title: string;
  icon?: string;
  command: string;
  /** Only show for these item kinds (page, tree menus). Empty = all. */
  kinds?: (typeof MENU_ITEM_KINDS)[number][];
  /** Only show for these custom page types (tree/page menus on custom items). */
  nodeTypes?: string[];
  /** Only show for these block types (block menu). Empty = all. */
  blockTypes?: string[];
  danger?: boolean;
}

export const SETTING_TYPES = ["toggle", "text", "textarea", "number", "slider", "select", "color"] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

/** One user-editable option, shown on the plugin's Options screen. */
export interface SettingFieldDef {
  key: string;
  type: SettingType;
  label: string;
  description?: string;
  default?: unknown;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  /** Group heading the field appears under. */
  section?: string;
}

export interface ContributionSet {
  sidebarTabs: SidebarTabDef[];
  statusWidgets: StatusWidgetDef[];
  blockTypes: BlockTypeDef[];
  nodeTypes: NodeTypeDef[];
  menuItems: MenuItemDef[];
  /** Options a plugin lets the user edit (plugins only). */
  settings: SettingFieldDef[];
  overlays: OverlayDef[];
  propertyTypes: PropertyTypeDef[];
}

export interface Source extends ContributionSet {
  owner: ContributionOwner;
  /** Permissions HTML views from this source run with. */
  permissions: readonly string[];
}

export interface Owned {
  owner: ContributionOwner;
  permissions: readonly string[];
  /** Unique across the app, e.g. "plugin:com.acme.stats:summary". */
  key: string;
}

export type SidebarTabContribution = SidebarTabDef & Owned;
export type StatusWidgetContribution = StatusWidgetDef & Owned;
export type BlockTypeContribution = BlockTypeDef & Owned;
export type NodeTypeContribution = NodeTypeDef & Owned;
export type MenuItemContribution = MenuItemDef & Owned;
export type OverlayContribution = OverlayDef & Owned;
export type PropertyTypeContribution = PropertyTypeDef & Owned;

export interface ContributionSnapshot {
  sidebarTabs: SidebarTabContribution[];
  statusWidgets: StatusWidgetContribution[];
  blockTypes: BlockTypeContribution[];
  nodeTypes: NodeTypeContribution[];
  menuItems: MenuItemContribution[];
  overlays: OverlayContribution[];
  propertyTypes: PropertyTypeContribution[];
  blockTypeMap: ReadonlyMap<string, BlockTypeContribution>;
  nodeTypeMap: ReadonlyMap<string, NodeTypeContribution>;
  propertyTypeMap: ReadonlyMap<string, PropertyTypeContribution>;
}

export const LIMITS = {
  sidebarTabs: 12,
  statusWidgets: 12,
  blockTypes: 40,
  nodeTypes: 20,
  menuItems: 24,
  settings: 40,
  overlays: 12,
  propertyTypes: 20,
  html: 400_000,
  markdown: 40_000,
} as const;

export const TYPE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const LOCAL_ID = /^[a-zA-Z0-9][\w.-]{0,63}$/;

export function emptySet(): ContributionSet {
  return { sidebarTabs: [], statusWidgets: [], blockTypes: [], nodeTypes: [], menuItems: [], settings: [], overlays: [], propertyTypes: [] };
}

// ── normalization (stored data and SDK input both go through here) ──────────

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function optStr(value: unknown, max: number): string | undefined {
  const out = str(value, max).trim();
  return out ? out : undefined;
}

function cleanActions(value: unknown): PanelAction[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter(isObject)
    .slice(0, 8)
    .map((action) => ({ id: str(action.id, 64), label: str(action.label, 40) }))
    .filter((action) => action.id && action.label);
  return out.length ? out : undefined;
}

export function normalizeView(value: unknown): ViewDef {
  const v = isObject(value) ? value : {};
  const view: ViewDef = {};
  const html = str(v.html, LIMITS.html);
  if (html.trim()) view.html = html;
  const markdown = str(v.markdown, LIMITS.markdown);
  if (markdown) view.markdown = markdown;
  const actions = cleanActions(v.actions);
  if (actions) view.actions = actions;
  return view;
}

export function normalizeSidebarTab(value: unknown): SidebarTabDef | undefined {
  if (!isObject(value)) return undefined;
  const id = str(value.id, 64);
  if (!LOCAL_ID.test(id)) return undefined;
  const view = normalizeView(isObject(value.view) ? value.view : value);
  return { id, title: optStr(value.title, 60) ?? id, icon: optStr(value.icon, 32), view };
}

export function normalizeStatusWidget(value: unknown): StatusWidgetDef | undefined {
  if (!isObject(value)) return undefined;
  const id = str(value.id, 64);
  if (!LOCAL_ID.test(id)) return undefined;
  const widget: StatusWidgetDef = {
    id,
    side: value.side === "left" ? "left" : value.side === "center" ? "center" : "right",
    order: typeof value.order === "number" && Number.isFinite(value.order) ? Math.round(value.order) : 0,
  };
  const text = optStr(value.text, 160);
  if (text) widget.text = text;
  const tooltip = optStr(value.tooltip, 300);
  if (tooltip) widget.tooltip = tooltip;
  const icon = optStr(value.icon, 32);
  if (icon) widget.icon = icon;
  const html = str(value.html, 60_000);
  if (html.trim()) widget.html = html;
  const width = normalizeStatusWidth(value.width);
  if (width !== undefined) widget.width = width;
  const minWidth = px(value.minWidth, 0, 2000);
  if (minWidth !== undefined) widget.minWidth = minWidth;
  const maxWidth = px(value.maxWidth, 16, 4000);
  if (maxWidth !== undefined) widget.maxWidth = maxWidth;
  const command = optStr(value.command, 160);
  if (command) widget.command = command;
  const popup = normalizeStatusPopup(value.popup);
  if (popup) widget.popup = popup;
  const badge = value.badge === 0 || typeof value.badge === "number" ? String(value.badge) : optStr(value.badge, 24);
  if (badge) widget.badge = badge;
  const tone = STATUS_TONES.find((item) => item === value.tone);
  if (tone && tone !== "default") widget.tone = tone;
  const color = cssColor(value.color);
  if (color) widget.color = color;
  const background = cssColor(value.background);
  if (background) widget.background = background;
  const progress = num(value.progress);
  if (progress !== undefined) widget.progress = Math.max(0, Math.min(1, progress));
  if (value.data !== undefined && value.data !== null) widget.data = jsonClone(value.data);
  return widget;
}


function normalizeStatusPopup(value: unknown): StatusPopupDef | undefined {
  if (typeof value === "string") value = { html: value };
  if (!isObject(value)) return undefined;
  const html = str(value.html, LIMITS.html);
  if (!html.trim()) return undefined;
  const popup: StatusPopupDef = { html };
  const width = px(value.width, 120, 900);
  if (width !== undefined) popup.width = width;
  const height = px(value.height, 40, 900);
  if (height !== undefined) popup.height = height;
  const placement = POPUP_PLACEMENTS.find((item) => item === value.placement);
  if (placement) popup.placement = placement;
  if (value.bare === true) popup.bare = true;
  if (value.persistent === true) popup.persistent = true;
  if (value.data !== undefined && value.data !== null) popup.data = jsonClone(value.data);
  return popup;
}

function px(value: unknown, min: number, max: number): number | undefined {
  const n = num(value);
  return n === undefined ? undefined : Math.max(min, Math.min(max, Math.round(n)));
}

const CSS_COLOR = /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%/+-]{1,60}\)|var\(--[a-z0-9-]{1,48}\)|color-mix\([a-z0-9\s,%#().-]{1,120}\)|[a-z]{3,24})$/i;

/** A CSS colour value, or undefined if it isn't one of the safe forms. */
export function cssColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return CSS_COLOR.test(text) && !/url|expression/i.test(text) ? text : undefined;
}

function overlaySize(value: unknown, allowAuto: boolean): OverlaySize | undefined {
  if (allowAuto && value === "auto") return "auto";
  if (typeof value === "string") {
    const match = /^\s*(\d{1,3}(?:\.\d+)?)\s*%\s*$/.exec(value);
    if (match) return `${Math.max(1, Math.min(100, Number(match[1])))}%` as OverlaySize;
    const pxMatch = /^\s*(\d{1,4})\s*(?:px)?\s*$/.exec(value);
    if (pxMatch) value = Number(pxMatch[1]);
  }
  return px(value, 8, 8000);
}

export function normalizeOverlay(value: unknown): OverlayDef | undefined {
  if (!isObject(value)) return undefined;
  const id = str(value.id, 64);
  const html = str(value.html, LIMITS.html);
  if (!LOCAL_ID.test(id) || !html.trim()) return undefined;
  const position = OVERLAY_POSITIONS.find((item) => item === value.position) ?? "bottom-right";
  const overlay: OverlayDef = { id, html, position, order: typeof value.order === "number" && Number.isFinite(value.order) ? Math.round(value.order) : 0 };
  const title = optStr(value.title, 80);
  if (title) overlay.title = title;
  const x = px(value.x, -4000, 4000);
  if (x !== undefined) overlay.x = x;
  const y = px(value.y, -4000, 4000);
  if (y !== undefined) overlay.y = y;
  const width = overlaySize(value.width, false);
  if (width !== undefined) overlay.width = width;
  const height = overlaySize(value.height, true);
  if (height !== undefined) overlay.height = height;
  if (value.interactive === false) overlay.interactive = false;
  if (value.draggable === true) overlay.draggable = true;
  if (value.chrome === true) overlay.chrome = true;
  const opacity = num(value.opacity);
  if (opacity !== undefined) overlay.opacity = Math.max(0.05, Math.min(1, opacity));
  if (value.stack === "top") overlay.stack = "top";
  if (value.hidden === true) overlay.hidden = true;
  if (value.data !== undefined && value.data !== null) overlay.data = jsonClone(value.data);
  return overlay;
}

const VALUE_TYPES: readonly FormulaResultType[] = ["text", "number", "checkbox", "date"];

export function normalizePropertyType(value: unknown): PropertyTypeDef | undefined {
  if (!isObject(value)) return undefined;
  const type = str(value.type, 64);
  if (!TYPE_ID.test(type)) return undefined;
  const def: PropertyTypeDef = {
    type,
    title: optStr(value.title, 60) ?? type,
    valueType: VALUE_TYPES.find((item) => item === value.valueType) ?? "text",
  };
  const icon = optStr(value.icon, 32);
  if (icon) def.icon = icon;
  const description = optStr(value.description, 200);
  if (description) def.description = description;
  const render = str(value.render, 40_000);
  if (render.trim()) def.render = render;
  const css = str(value.css, 40_000);
  if (css.trim()) def.css = css;
  const editor = str(value.editor, LIMITS.html);
  if (editor.trim()) def.editor = editor;
  const editorWidth = px(value.editorWidth, 120, 900);
  if (editorWidth !== undefined) def.editorWidth = editorWidth;
  const editorHeight = px(value.editorHeight, 40, 900);
  if (editorHeight !== undefined) def.editorHeight = editorHeight;
  if (Array.isArray(value.config)) {
    const fields = uniqueBy(
      value.config.map(normalizeSettingField).filter((field): field is SettingFieldDef => Boolean(field)),
      (field) => field.key,
      20,
    );
    if (fields.length) def.config = fields;
  }
  if (value.defaultValue !== undefined && value.defaultValue !== null) def.defaultValue = jsonClone(value.defaultValue);
  if (value.renderer === true) def.renderer = true;
  if (value.align === "start" || value.align === "center" || value.align === "end") def.align = value.align;
  return def;
}

export function normalizeBlockType(value: unknown): BlockTypeDef | undefined {
  if (!isObject(value)) return undefined;
  const type = str(value.type, 64);
  const html = str(value.html, LIMITS.html);
  if (!TYPE_ID.test(type) || !html.trim()) return undefined;
  const def: BlockTypeDef = { type, title: optStr(value.title, 60) ?? type, html };
  const description = optStr(value.description, 200);
  if (description) def.description = description;
  const icon = optStr(value.icon, 32);
  if (icon) def.icon = icon;
  if (Array.isArray(value.keywords)) def.keywords = value.keywords.filter((k): k is string => typeof k === "string").slice(0, 12).map((k) => k.slice(0, 32));
  if (value.defaultData !== undefined) def.defaultData = jsonClone(value.defaultData);
  if (typeof value.height === "number" && Number.isFinite(value.height)) def.height = Math.max(24, Math.min(1600, Math.round(value.height)));
  return def;
}

export function normalizeNodeType(value: unknown): NodeTypeDef | undefined {
  if (!isObject(value)) return undefined;
  const type = str(value.type, 64);
  const html = str(value.html, LIMITS.html);
  if (!TYPE_ID.test(type) || !html.trim()) return undefined;
  const def: NodeTypeDef = { type, title: optStr(value.title, 60) ?? type, html };
  const description = optStr(value.description, 200);
  if (description) def.description = description;
  const icon = optStr(value.icon, 32);
  if (icon) def.icon = icon;
  if (value.defaultData !== undefined) def.defaultData = jsonClone(value.defaultData);
  if (value.layout === "page") def.layout = "page";
  return def;
}

const SETTING_KEY = /^[a-zA-Z][\w.-]{0,63}$/;

function strList(value: unknown, max: number, re: RegExp): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === "string" && re.test(item)).slice(0, max);
  return out.length ? out : undefined;
}

export function normalizeMenuItem(value: unknown): MenuItemDef | undefined {
  if (!isObject(value)) return undefined;
  const id = str(value.id, 64).trim();
  const command = str(value.command, 160).trim();
  const title = optStr(value.title, 80);
  const menu = MENU_SLOTS.find((slot) => slot === value.menu);
  if (!LOCAL_ID.test(id) || !command || !title || !menu) return undefined;
  const item: MenuItemDef = { id, menu, title, command };
  const icon = optStr(value.icon, 32);
  if (icon) item.icon = icon;
  const kinds = Array.isArray(value.kinds) ? MENU_ITEM_KINDS.filter((kind) => (value.kinds as unknown[]).includes(kind)) : [];
  if (kinds.length) item.kinds = kinds;
  const nodeTypes = strList(value.nodeTypes, 20, TYPE_ID);
  if (nodeTypes) item.nodeTypes = nodeTypes;
  const blockTypes = strList(value.blockTypes, 40, /^[a-zA-Z0-9][\w.:-]{0,63}$/);
  if (blockTypes) item.blockTypes = blockTypes;
  if (value.danger === true) item.danger = true;
  return item;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeSettingField(value: unknown): SettingFieldDef | undefined {
  if (!isObject(value)) return undefined;
  const key = str(value.key, 64).trim();
  const type = SETTING_TYPES.find((item) => item === value.type);
  if (!SETTING_KEY.test(key) || !type) return undefined;
  const field: SettingFieldDef = { key, type, label: optStr(value.label, 80) ?? key };
  const description = optStr(value.description, 300);
  if (description) field.description = description;
  const section = optStr(value.section, 60);
  if (section) field.section = section;
  const placeholder = optStr(value.placeholder, 120);
  if (placeholder) field.placeholder = placeholder;
  for (const name of ["min", "max", "step"] as const) {
    const n = num(value[name]);
    if (n !== undefined) field[name] = n;
  }
  if (type === "select") {
    const options = (Array.isArray(value.options) ? value.options : [])
      .map((option) => {
        if (typeof option === "string") return { value: option.slice(0, 120), label: option.slice(0, 80) };
        if (!isObject(option)) return undefined;
        const v = str(option.value, 120);
        return v ? { value: v, label: optStr(option.label, 80) ?? v } : undefined;
      })
      .filter((option): option is { value: string; label: string } => Boolean(option))
      .slice(0, 50);
    if (!options.length) return undefined;
    field.options = options;
  }
  if (value.default !== undefined) {
    const d = value.default;
    const ok =
      type === "toggle" ? typeof d === "boolean" : type === "number" || type === "slider" ? num(d) !== undefined : typeof d === "string" && d.length <= 20_000;
    if (ok) field.default = d;
  }
  return field;
}

/** Each field's default, for fields that have one. */
export function settingDefaults(fields: readonly SettingFieldDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.default !== undefined) out[field.key] = field.default;
    else if (field.type === "toggle") out[field.key] = false;
  }
  return out;
}

function uniqueBy<T>(items: T[], key: (item: T) => string, max: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeSet(value: unknown): ContributionSet {
  const v = isObject(value) ? value : {};
  const list = <T>(raw: unknown, fn: (item: unknown) => T | undefined): T[] =>
    (Array.isArray(raw) ? raw : []).map(fn).filter((item): item is T => item !== undefined);
  return {
    sidebarTabs: uniqueBy(list(v.sidebarTabs, normalizeSidebarTab), (t) => t.id, LIMITS.sidebarTabs),
    statusWidgets: uniqueBy(list(v.statusWidgets, normalizeStatusWidget), (t) => t.id, LIMITS.statusWidgets),
    blockTypes: uniqueBy(list(v.blockTypes, normalizeBlockType), (t) => t.type, LIMITS.blockTypes),
    nodeTypes: uniqueBy(list(v.nodeTypes, normalizeNodeType), (t) => t.type, LIMITS.nodeTypes),
    menuItems: uniqueBy(list(v.menuItems, normalizeMenuItem), (t) => t.id, LIMITS.menuItems),
    settings: uniqueBy(list(v.settings, normalizeSettingField), (t) => t.key, LIMITS.settings),
    overlays: uniqueBy(list(v.overlays, normalizeOverlay), (t) => t.id, LIMITS.overlays),
    propertyTypes: uniqueBy(list(v.propertyTypes, normalizePropertyType), (t) => t.type, LIMITS.propertyTypes),
  };
}

export function jsonClone<T>(value: T): T {
  if (value === undefined) return value;
  const text = JSON.stringify(value);
  if (text === undefined) return undefined as T;
  if (text.length > 200_000) throw new Error("Data is larger than 200 KB.");
  return JSON.parse(text) as T;
}

/** Replace or add an item by id inside a list (returns a new list). */
export function upsert<T>(items: T[], item: T, key: (item: T) => string, max: number, what: string): T[] {
  const index = items.findIndex((other) => key(other) === key(item));
  if (index >= 0) return items.map((other, i) => (i === index ? item : other));
  if (items.length >= max) throw new Error(`At most ${max} ${what} per plugin or layer.`);
  return [...items, item];
}

// ── registry ───────────────────────────────────────────────────────────────

export function sourceKey(owner: Pick<ContributionOwner, "kind" | "id">): string {
  return `${owner.kind}:${owner.id}`;
}

const sources = new Map<string, Source>();
const listeners = new Set<() => void>();
let snapshot: ContributionSnapshot = build();

function build(): ContributionSnapshot {
  const sidebarTabs: SidebarTabContribution[] = [];
  const statusWidgets: StatusWidgetContribution[] = [];
  const blockTypeMap = new Map<string, BlockTypeContribution>();
  const nodeTypeMap = new Map<string, NodeTypeContribution>();
  const menuItems: MenuItemContribution[] = [];
  const overlays: OverlayContribution[] = [];
  const propertyTypeMap = new Map<string, PropertyTypeContribution>();
  for (const [key, source] of sources) {
    const owned = { owner: source.owner, permissions: source.permissions };
    for (const tab of source.sidebarTabs) sidebarTabs.push({ ...tab, ...owned, key: `${key}:${tab.id}` });
    for (const widget of source.statusWidgets) statusWidgets.push({ ...widget, ...owned, key: `${key}:${widget.id}` });
    // First registration of a type wins; later duplicates are ignored.
    for (const block of source.blockTypes) if (!blockTypeMap.has(block.type)) blockTypeMap.set(block.type, { ...block, ...owned, key: `${key}:${block.type}` });
    for (const item of source.menuItems ?? []) menuItems.push({ ...item, ...owned, key: `${key}:${item.id}` });
    for (const node of source.nodeTypes) if (!nodeTypeMap.has(node.type)) nodeTypeMap.set(node.type, { ...node, ...owned, key: `${key}:${node.type}` });
    for (const overlay of source.overlays ?? []) overlays.push({ ...overlay, ...owned, key: `${key}:${overlay.id}` });
    for (const def of source.propertyTypes ?? []) if (!propertyTypeMap.has(def.type)) propertyTypeMap.set(def.type, { ...def, ...owned, key: `${key}:${def.type}` });
  }
  statusWidgets.sort((a, b) => a.order - b.order);
  overlays.sort((a, b) => a.order - b.order);
  return {
    sidebarTabs,
    statusWidgets,
    blockTypes: [...blockTypeMap.values()],
    nodeTypes: [...nodeTypeMap.values()],
    menuItems,
    overlays,
    propertyTypes: [...propertyTypeMap.values()],
    blockTypeMap,
    nodeTypeMap,
    propertyTypeMap,
  };
}

let scheduled = false;
function changed() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    snapshot = build();
    for (const listener of listeners) listener();
  });
}

export const contributions = {
  set(source: Source) {
    sources.set(sourceKey(source.owner), source);
    changed();
  },
  remove(owner: Pick<ContributionOwner, "kind" | "id">) {
    if (sources.delete(sourceKey(owner))) changed();
  },
  /** Drop every source of one kind except the given ids (used when layers reload). */
  retain(kind: OwnerKind, keep: Set<string>) {
    let dirty = false;
    for (const [key, source] of sources) {
      if (source.owner.kind === kind && !keep.has(source.owner.id)) {
        sources.delete(key);
        dirty = true;
      }
    }
    if (dirty) changed();
  },
  get(owner: Pick<ContributionOwner, "kind" | "id">): Source | undefined {
    return sources.get(sourceKey(owner));
  },
  snapshot: () => snapshot,
  /** Synchronous view (skips the microtask batching), for code that just changed a source. */
  current(): ContributionSnapshot {
    if (scheduled) snapshot = build();
    return snapshot;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

// Custom database property types sort and filter as the type they declare.
setCustomValueTypeResolver((type) => contributions.current().propertyTypeMap.get(type)?.valueType);

export function useContributions(): ContributionSnapshot {
  return useSyncExternalStore(contributions.subscribe, contributions.snapshot, contributions.snapshot);
}

// ── built-ins ─────────────────────────────────────────────────────────────

/**
 * Status bar items built into the app. Each can be hidden, moved and sized with the status
 * bar layout (lib/statusLayout: right-click the status bar, or statusBar.configure);
 * "local", "page" and "clock" start hidden.
 */
export const BUILTIN_STATUS_WIDGETS: readonly { id: "save" | "stats" | "plugins" | "local" | "page" | "clock"; side: StatusSide; order: number; title: string }[] = [
  { id: "page", side: "left", order: -110, title: "Open page title" },
  { id: "stats", side: "left", order: -90, title: "Word and block count" },
  { id: "plugins", side: "right", order: -50, title: "Plugin status items" },
  { id: "clock", side: "right", order: 80, title: "Clock" },
  { id: "local", side: "right", order: 90, title: "Local-first badge" },
  { id: "save", side: "right", order: 100, title: "Save state" },
];

/** Titles of the built-in sidebar tabs. */
export const BUILTIN_SIDEBAR_TAB_INFO: Record<string, { title: string; icon: string }> = {
  outline: { title: "Outline", icon: "list" },
  backlinks: { title: "Backlinks", icon: "link-2" },
  info: { title: "Page info", icon: "info" },
  assistant: { title: "Assistant", icon: "messages-square" },
};
