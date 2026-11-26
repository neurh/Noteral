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

export interface StatusWidgetDef {
  id: string;
  text?: string;
  tooltip?: string;
  icon?: string;
  /** HTML widget, rendered in a small sandboxed frame (height 22px). */
  html?: string;
  /** Width: px (HTML widgets default to 120), "auto", "fill" (free space) or "NN%" of the bar. */
  width?: StatusWidth;
  side: StatusSide;
  /** Lower comes first. */
  order: number;
  /** A command id to run on click (see commands.list). */
  command?: string;
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

export interface ContributionSnapshot {
  sidebarTabs: SidebarTabContribution[];
  statusWidgets: StatusWidgetContribution[];
  blockTypes: BlockTypeContribution[];
  nodeTypes: NodeTypeContribution[];
  menuItems: MenuItemContribution[];
  blockTypeMap: ReadonlyMap<string, BlockTypeContribution>;
  nodeTypeMap: ReadonlyMap<string, NodeTypeContribution>;
}

export const LIMITS = {
  sidebarTabs: 12,
  statusWidgets: 12,
  blockTypes: 40,
  nodeTypes: 20,
  menuItems: 24,
  settings: 40,
  html: 400_000,
  markdown: 40_000,
} as const;

export const TYPE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const LOCAL_ID = /^[a-zA-Z0-9][\w.-]{0,63}$/;

export function emptySet(): ContributionSet {
  return { sidebarTabs: [], statusWidgets: [], blockTypes: [], nodeTypes: [], menuItems: [], settings: [] };
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
  const command = optStr(value.command, 160);
  if (command) widget.command = command;
  return widget;
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
  for (const [key, source] of sources) {
    const owned = { owner: source.owner, permissions: source.permissions };
    for (const tab of source.sidebarTabs) sidebarTabs.push({ ...tab, ...owned, key: `${key}:${tab.id}` });
    for (const widget of source.statusWidgets) statusWidgets.push({ ...widget, ...owned, key: `${key}:${widget.id}` });
    // First registration of a type wins; later duplicates are ignored.
    for (const block of source.blockTypes) if (!blockTypeMap.has(block.type)) blockTypeMap.set(block.type, { ...block, ...owned, key: `${key}:${block.type}` });
    for (const item of source.menuItems ?? []) menuItems.push({ ...item, ...owned, key: `${key}:${item.id}` });
    for (const node of source.nodeTypes) if (!nodeTypeMap.has(node.type)) nodeTypeMap.set(node.type, { ...node, ...owned, key: `${key}:${node.type}` });
  }
  statusWidgets.sort((a, b) => a.order - b.order);
  return {
    sidebarTabs,
    statusWidgets,
    blockTypes: [...blockTypeMap.values()],
    nodeTypes: [...nodeTypeMap.values()],
    menuItems,
    blockTypeMap,
    nodeTypeMap,
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
