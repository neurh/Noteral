/**
 * User customizations: design-token overrides, per-component styles and CSS
 * snippets. Written by the Appearance API (plugins with the "appearance"
 * permission and the assistant in Creator mode), stored in
 * `<data dir>/customizations.json` and applied through one <style> element.
 */
import { useSyncExternalStore } from "react";
import { api } from "./api";
import { contributions, emptySet, normalizeSet } from "./contributions";
import type { ContributionSet } from "./contributions";

export interface CssSnippet {
  id: string;
  label: string;
  css: string;
  enabled: boolean;
}

export interface ComponentStyle {
  /** Declarations applied to the component's root element, e.g. "border-radius: 0". */
  css?: string;
  /** Full rules where `&` stands for the component's root selector. */
  rules?: string;
  hidden?: boolean;
}

/** Tokens, component styles and CSS: the "look" part of the base document and of every layer. */
export interface Look {
  tokens: { light: Record<string, string>; dark: Record<string, string> };
  components: Record<string, ComponentStyle>;
  css: CssSnippet[];
}

/**
 * A layer is a named, switchable bundle of customizations: a look plus UI contributions
 * (sidebar tabs, status widgets, block and node types). The assistant writes each chat's
 * changes into its own layer so they can be reviewed, turned off, removed or exported as a
 * plugin from Plugins → Created.
 */
export interface Layer extends Look, ContributionSet {
  id: string;
  name: string;
  description?: string;
  source: "assistant" | "user" | "plugin";
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  /** Permissions the layer's HTML views run with. */
  permissions: string[];
  /** The assistant chat that made it. */
  chatId?: string;
  /** The plugin that made it (appearance changes made through the SDK). */
  pluginId?: string;
}

export interface SidebarGroup {
  id: string;
  /** Tab ids: "outline", "backlinks", "info", "assistant" or a contribution key. */
  tabs: string[];
  active: string;
  /** Share of the sidebar height (flex-grow). */
  size: number;
}

export interface SidebarLayout {
  groups: SidebarGroup[];
}

export interface Customizations extends Look {
  version: 2;
  layers: Layer[];
  sidebar?: SidebarLayout;
}

export const LAYER_ID = /^[a-z0-9][a-z0-9:._-]{0,79}$/;
export const MAX_LAYERS = 40;
export const BUILTIN_SIDEBAR_TABS = ["outline", "backlinks", "info", "assistant"] as const;
/** What a layer's HTML views may do when the layer sets no permissions of its own. */
export const DEFAULT_LAYER_PERMISSIONS = ["editor.read", "pages.read", "databases.read", "navigation", "search.read", "workspaces.read", "ui.notify", "ui.modal"];

export interface TokenInfo {
  name: string;
  group: "color" | "font" | "shape" | "layout";
  description: string;
  light: string;
  dark: string;
}

export interface ComponentInfo {
  id: string;
  label: string;
  selector: string;
  description: string;
}

const TOKEN_GROUPS: Array<[TokenInfo["group"], string, string]> = [
  ["font", "font-ui", "Interface font stack"],
  ["font", "font-reading", "Font used for page text when the serif editor font is chosen"],
  ["font", "font-mono", "Monospace font for code"],
  ["color", "bg", "App background"],
  ["color", "bg-raised", "Raised surfaces: panels, menus, dialogs"],
  ["color", "bg-sunken", "Sunken surfaces: inputs, wells"],
  ["color", "bg-hover", "Hovered rows and buttons"],
  ["color", "bg-active", "Selected rows and pressed buttons"],
  ["color", "bg-inverse", "Inverse surfaces such as tooltips"],
  ["color", "text", "Primary text"],
  ["color", "text-soft", "Secondary text"],
  ["color", "text-muted", "Muted labels"],
  ["color", "text-faint", "Placeholders and hints"],
  ["color", "border", "Hairline borders"],
  ["color", "border-strong", "Stronger borders and dividers"],
  ["color", "accent", "Accent colour (buttons, links, focus)"],
  ["color", "accent-deep", "Accent for pressed states and text on accent-soft"],
  ["color", "accent-soft", "Tinted accent background"],
  ["color", "accent-softer", "Faint accent background"],
  ["color", "danger", "Destructive actions"],
  ["color", "danger-soft", "Destructive tint"],
  ["color", "success", "Success"],
  ["color", "success-soft", "Success tint"],
  ["color", "warning", "Warning"],
  ["color", "selection", "Text selection"],
  ["color", "block-selected", "Selected editor blocks"],
  ["color", "focus", "Focus ring"],
  ["shape", "shadow-sm", "Small shadow"],
  ["shape", "shadow-md", "Medium shadow"],
  ["shape", "shadow-lg", "Large shadow (dialogs)"],
  ["shape", "radius-sm", "Small corner radius"],
  ["shape", "radius-md", "Medium corner radius"],
  ["shape", "radius-lg", "Large corner radius"],
  ["layout", "panel-head-h", "Height of panel headers"],
  ["layout", "topbar-h", "Height of the top bar"],
  ["layout", "panel-gap", "Gap between panels"],
  ["layout", "status-h", "Height of the status bar"],
  ["layout", "rail-w", "Width of the left rail"],
];

export const TOKEN_NAMES = TOKEN_GROUPS.map(([, name]) => name);

export const COMPONENTS: ComponentInfo[] = [
  { id: "app", label: "App shell", selector: ".app-shell", description: "The whole window" },
  { id: "topbar", label: "Top bar", selector: ".topbar", description: "Brand, search and window actions" },
  { id: "topbar-search", label: "Top bar search", selector: ".topbar-search", description: "The search field in the top bar" },
  { id: "rail", label: "Rail", selector: ".rail", description: "Narrow icon column on the far left" },
  { id: "left-sidebar", label: "Left sidebar", selector: ".left-sidebar", description: "Page tree, favorites, recent and trash" },
  { id: "page-tree", label: "Page tree rows", selector: ".tree-page", description: "Each row of the page tree" },
  { id: "tabs", label: "Tab strip", selector: ".tab-strip", description: "Tabs above each pane" },
  { id: "panes", label: "Panes", selector: ".panes-root", description: "Editor area with split panes" },
  { id: "page", label: "Page", selector: ".page-scroll", description: "A page's scroll area" },
  { id: "page-document", label: "Page body", selector: ".page-document", description: "The column holding the title and blocks" },
  { id: "page-header", label: "Page header", selector: ".page-header", description: "Breadcrumbs and page actions" },
  { id: "editor", label: "Editor", selector: ".bn-editor", description: "Block editor content" },
  { id: "right-sidebar", label: "Right sidebar", selector: ".right-sidebar", description: "Outline, backlinks, info and assistant" },
  { id: "status-bar", label: "Status bar", selector: ".status-bar", description: "Bottom status line" },
  { id: "palette", label: "Command palette", selector: ".palette", description: "Ctrl+K command palette" },
  { id: "modal", label: "Dialogs", selector: ".modal", description: "Settings, plugins and other dialogs" },
  { id: "toasts", label: "Notifications", selector: ".toast-stack", description: "Toast notifications" },
  { id: "assistant", label: "Assistant", selector: ".assistant", description: "The AI assistant panel" },
];

const COMPONENT_MAP = new Map(COMPONENTS.map((component) => [component.id, component]));

export const MAX_CSS = 200_000;

export function emptyLook(): Look {
  return { tokens: { light: {}, dark: {} }, components: {}, css: [] };
}

export function emptyCustomizations(): Customizations {
  return { version: 2, ...emptyLook(), layers: [] };
}

export function newLayer(id: string, name: string, patch: Partial<Layer> = {}): Layer {
  const now = Date.now();
  return { ...emptyLook(), ...emptySet(), id, name: name.slice(0, 80), source: "user", enabled: true, createdAt: now, updatedAt: now, permissions: [], ...patch };
}

function strings(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && TOKEN_NAMES.includes(key)) out[key] = raw;
  }
  return out;
}

function normalizeLook(raw: unknown): Look {
  const doc = emptyLook();
  if (!raw || typeof raw !== "object") return doc;
  const value = raw as Partial<Look>;
  doc.tokens.light = strings(value.tokens?.light);
  doc.tokens.dark = strings(value.tokens?.dark);
  if (value.components && typeof value.components === "object") {
    for (const [id, style] of Object.entries(value.components)) {
      if (!COMPONENT_MAP.has(id) || !style || typeof style !== "object") continue;
      const next: ComponentStyle = {};
      if (typeof style.css === "string" && style.css.trim()) next.css = style.css;
      if (typeof style.rules === "string" && style.rules.trim()) next.rules = style.rules;
      if (style.hidden === true) next.hidden = true;
      if (Object.keys(next).length) doc.components[id] = next;
    }
  }
  if (Array.isArray(value.css)) {
    for (const snippet of value.css) {
      if (!snippet || typeof snippet.id !== "string" || typeof snippet.css !== "string") continue;
      doc.css.push({ id: snippet.id, label: typeof snippet.label === "string" ? snippet.label : snippet.id, css: snippet.css, enabled: snippet.enabled !== false });
    }
  }
  return doc;
}

function normalizeLayer(raw: unknown): Layer | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Partial<Layer>;
  if (typeof value.id !== "string" || !LAYER_ID.test(value.id)) return undefined;
  const layer: Layer = {
    ...normalizeLook(value),
    ...normalizeSet(value),
    id: value.id,
    name: typeof value.name === "string" && value.name.trim() ? value.name.slice(0, 80) : value.id,
    source: value.source === "assistant" || value.source === "plugin" ? value.source : "user",
    enabled: value.enabled !== false,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
    permissions: Array.isArray(value.permissions) ? value.permissions.filter((p): p is string => typeof p === "string").slice(0, 40) : [],
  };
  if (typeof value.description === "string" && value.description.trim()) layer.description = value.description.slice(0, 400);
  if (typeof value.chatId === "string") layer.chatId = value.chatId.slice(0, 80);
  if (typeof value.pluginId === "string") layer.pluginId = value.pluginId.slice(0, 120);
  return layer;
}

function normalizeSidebar(raw: unknown): SidebarLayout | undefined {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as SidebarLayout).groups)) return undefined;
  const seenTabs = new Set<string>();
  const groups: SidebarGroup[] = [];
  for (const item of (raw as SidebarLayout).groups.slice(0, 6)) {
    if (!item || typeof item !== "object" || typeof item.id !== "string") continue;
    const tabs = (Array.isArray(item.tabs) ? item.tabs : []).filter((tab): tab is string => typeof tab === "string" && tab.length <= 200 && !seenTabs.has(tab));
    tabs.forEach((tab) => seenTabs.add(tab));
    if (!tabs.length) continue;
    const size = typeof item.size === "number" && Number.isFinite(item.size) ? Math.max(0.1, Math.min(10, item.size)) : 1;
    groups.push({ id: item.id.slice(0, 40), tabs, active: tabs.includes(item.active) ? item.active : tabs[0], size });
  }
  return groups.length ? { groups } : undefined;
}

export function normalizeCustomizations(raw: unknown): Customizations {
  const doc: Customizations = { version: 2, ...normalizeLook(raw), layers: [] };
  if (!raw || typeof raw !== "object") return doc;
  const value = raw as Partial<Customizations>;
  const seen = new Set<string>();
  for (const item of Array.isArray(value.layers) ? value.layers : []) {
    const layer = normalizeLayer(item);
    if (!layer || seen.has(layer.id)) continue;
    seen.add(layer.id);
    doc.layers.push(layer);
    if (doc.layers.length >= MAX_LAYERS) break;
  }
  const sidebar = normalizeSidebar(value.sidebar);
  if (sidebar) doc.sidebar = sidebar;
  return doc;
}

/** Token value check: one CSS value, no blocks, no escapes out of the declaration. */
export function checkTokenValue(value: string): string {
  if (value.length > 400) return "is too long";
  if (/[{};<>]/.test(value)) return "must be a single CSS value";
  return "";
}

/** Strip things that could load remote content or break out of the style element. */
export function cleanCss(css: string): string {
  return css
    .replace(/<\/?style/gi, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)\s*(https?:|\/\/)[^)]*\)/gi, "none");
}

export function componentSelector(id: string): string {
  return COMPONENT_MAP.get(id)?.selector ?? "";
}

/** Plugin ids whose frames are running; a plugin's look layer only applies while it runs. */
let runningPlugins: ReadonlySet<string> | null = null;

/** Whether a layer currently applies: switched on and, for plugin layers, its plugin running. */
export function layerIsLive(layer: Layer): boolean {
  if (!layer.enabled) return false;
  if (layer.source === "plugin" && layer.pluginId && runningPlugins) return runningPlugins.has(layer.pluginId);
  return true;
}

export function renderCustomizations(doc: Customizations): string {
  const parts = [renderLook(doc)];
  for (const layer of doc.layers) {
    if (!layerIsLive(layer)) continue;
    const css = renderLook(layer);
    if (css) parts.push(`/* layer: ${layer.id.replace(/\*\//g, "")} */\n${css}`);
  }
  return parts.filter(Boolean).join("\n\n");
}

export function renderLook(doc: Look): string {
  const parts: string[] = [];
  const declarations = (tokens: Record<string, string>) =>
    Object.entries(tokens)
      .filter(([, value]) => !checkTokenValue(value))
      .map(([name, value]) => `  --${name}: ${value};`)
      .join("\n");
  const light = declarations(doc.tokens.light);
  const dark = declarations(doc.tokens.dark);
  if (light) parts.push(`:root:not([data-theme="dark"]) {\n${light}\n}`);
  if (dark) parts.push(`:root[data-theme="dark"] {\n${dark}\n}`);
  for (const [id, style] of Object.entries(doc.components)) {
    const selector = componentSelector(id);
    if (!selector) continue;
    if (style.hidden) parts.push(`${selector} { display: none !important; }`);
    if (style.css) parts.push(`${selector} { ${cleanCss(style.css).replace(/[{}]/g, "")} }`);
    if (style.rules) parts.push(cleanCss(style.rules).replace(/&/g, selector));
  }
  for (const snippet of doc.css) {
    if (snippet.enabled) parts.push(`/* ${snippet.id.replace(/\*\//g, "")} */\n${cleanCss(snippet.css)}`);
  }
  return parts.join("\n\n");
}

export function tokenInfo(): TokenInfo[] {
  const style = typeof document !== "undefined" ? getComputedStyle(document.documentElement) : null;
  const theme = typeof document !== "undefined" ? document.documentElement.dataset.theme : "light";
  return TOKEN_GROUPS.map(([group, name, description]) => {
    const current = style?.getPropertyValue(`--${name}`).trim() ?? "";
    return {
      name,
      group,
      description,
      light: state.tokens.light[name] ?? (theme !== "dark" ? current : ""),
      dark: state.tokens.dark[name] ?? (theme === "dark" ? current : ""),
    };
  });
}

/* ---------------------------------------------------------------- state */

let state: Customizations = emptyCustomizations();
let loaded = false;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function apply() {
  if (typeof document === "undefined") return;
  let element = document.getElementById("noteral-customizations") as HTMLStyleElement | null;
  if (!element) {
    element = document.createElement("style");
    element.id = "noteral-customizations";
    document.head.appendChild(element);
  }
  element.textContent = renderCustomizations(state);
}

function emit() {
  syncContributions();
  for (const listener of listeners) listener();
}

/** Enabled layers feed the contributions registry (sidebar tabs, widgets, block and node types). */
function syncContributions() {
  const keep = new Set<string>();
  for (const layer of state.layers) {
    if (!layerIsLive(layer)) continue;
    const empty = !layer.sidebarTabs.length && !layer.statusWidgets.length && !layer.blockTypes.length && !layer.nodeTypes.length;
    if (empty) continue;
    keep.add(layer.id);
    contributions.set({
      owner: { kind: "layer", id: layer.id, name: layer.name },
      permissions: layer.permissions.length ? layer.permissions : DEFAULT_LAYER_PERMISSIONS,
      sidebarTabs: layer.sidebarTabs,
      statusWidgets: layer.statusWidgets,
      blockTypes: layer.blockTypes,
      nodeTypes: layer.nodeTypes,
    });
  }
  contributions.retain("layer", keep);
}

/** Which tokens/components/css a write goes to: the base document or a layer. */
export function lookOf(doc: Customizations, layerId?: string): Look {
  if (!layerId) return doc;
  const layer = doc.layers.find((item) => item.id === layerId);
  if (!layer) throw new Error(`No customization layer "${layerId}".`);
  return layer;
}

export function ensureLayer(doc: Customizations, id: string, init: Partial<Layer> & { name: string }): Layer {
  let layer = doc.layers.find((item) => item.id === id);
  if (!layer) {
    if (!LAYER_ID.test(id)) throw new Error("Layer ids are lowercase letters, digits, dots, dashes, colons or underscores.");
    if (doc.layers.length >= MAX_LAYERS) throw new Error(`At most ${MAX_LAYERS} customization layers. Remove some in Plugins → Created.`);
    layer = newLayer(id, init.name, init);
    doc.layers.push(layer);
  }
  layer.updatedAt = Date.now();
  return layer;
}

export const customizations = {
  async load(): Promise<Customizations> {
    try {
      const raw = await api.getCustomizations();
      state = normalizeCustomizations(JSON.parse(raw || "{}"));
    } catch {
      state = emptyCustomizations();
    }
    loaded = true;
    apply();
    emit();
    return state;
  },
  get(): Customizations {
    return state;
  },
  isLoaded: () => loaded,
  /** Replace the document, apply it at once and save shortly after. */
  set(next: Customizations): Customizations {
    const serialized = JSON.stringify(next);
    if (serialized.length > 4_000_000) throw new Error("Customizations are larger than 4 MB");
    state = normalizeCustomizations(next);
    apply();
    emit();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void api.saveCustomizations(JSON.stringify(state)).catch(() => undefined);
    }, 250);
    return state;
  },
  update(change: (draft: Customizations) => void): Customizations {
    const draft = normalizeCustomizations(JSON.parse(JSON.stringify(state)));
    change(draft);
    return customizations.set(draft);
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Called by the plugin runtime when the set of running plugins changes. */
  setRunningPlugins(ids: Iterable<string>) {
    const next = new Set(ids);
    if (runningPlugins && next.size === runningPlugins.size && [...next].every((id) => runningPlugins!.has(id))) return;
    runningPlugins = next;
    if (!loaded) return;
    apply();
    emit();
  },
};

export function useCustomizations(): Customizations {
  return useSyncExternalStore(customizations.subscribe, customizations.get, customizations.get);
}
