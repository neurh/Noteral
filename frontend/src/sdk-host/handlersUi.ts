/**
 * Handlers for the UI surfaces plugins and the assistant can extend: customization layers
 * and appearance, sidebar tabs and layout, status bar widgets, custom block and node types,
 * HTML view messaging, questions (ui.ask) and the plugin test/install loop.
 *
 * Where writes go
 *   - Plugins: contributions (tabs, widgets, block/node types) live on the running plugin
 *     frame and disappear when it stops; appearance goes to the layer "plugin:<id>", which
 *     only applies while the plugin runs. Plugins cannot write to other layers.
 *   - Layer views (HTML that a layer added) act on their own layer.
 *   - The assistant writes into the chat's layer (ctx.layer), a named layer (`layer`), or
 *     with layer "base" into the user's own customizations.
 */
import { api, errorMessage } from "../lib/api";
import type { Manifest } from "../lib/api";
import {
  BUILTIN_SIDEBAR_TAB_INFO,
  BUILTIN_STATUS_WIDGETS,
  LIMITS,
  TYPE_ID,
  contributions,
  jsonClone,
  normalizeBlockType,
  normalizeMenuItem,
  normalizeNodeType,
  normalizeSettingField,
  normalizeSidebarTab,
  normalizeStatusWidget,
  upsert,
} from "../lib/contributions";
import type { ContributionOwner, ContributionSet, NodeTypeDef } from "../lib/contributions";
import {
  BUILTIN_SIDEBAR_TABS,
  COMPONENTS,
  LAYER_ID,
  cleanCss,
  customizations,
  ensureLayer,
  lookOf,
} from "../lib/customizations";
import type { Customizations, Layer, Look } from "../lib/customizations";
import { devlog } from "../lib/devlog";
import { dialogs } from "../lib/dialogs";
import { activateSidebarTab, availableTabs, moveSidebarTab, resolveSidebar, setSidebarGroups } from "../lib/sidebarLayout";
import { viewHub } from "../lib/viewFrame";
import { pluginRuntime } from "../plugins/runtime";
import { loadOptions } from "../lib/pluginOptions";
import { PERMISSIONS } from "./spec";
import { SNIPPET_ID, applyTokens, displayTitle, editCustomizations, editorFor, pluginInfo, requireMeta, store } from "./handlers";
import type { CallContext } from "./handlers";
import type {
  AskResult,
  BlockTypeInfo,
  ContributionOwnerInfo,
  LayerInfo,
  LogEntryInfo,
  MenuItemInfo,
  NodeTypeInfo,
  PluginInstallResult,
  PluginTestResult,
  SettingFieldInfo,
  SidebarInfo,
  SidebarTabInfo,
  StatusWidgetInfo,
} from "./types";
import { SDK_VERSION } from "./handlers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = Record<string, any>;
type Handler = (params: Params, ctx: CallContext) => unknown;

// ── targets ────────────────────────────────────────────────────────────────

interface LayerTarget {
  kind: "layer";
  id: string;
  init: Partial<Layer> & { name: string };
  /** The layer must already exist (layer views acting on their own layer). */
  existing?: boolean;
}

interface PluginTarget {
  kind: "plugin";
  pluginId: string;
  pluginName: string;
}

type Target = LayerTarget | PluginTarget;

const USER_LAYER: LayerTarget = { kind: "layer", id: "user", init: { name: "My customizations", source: "user", description: "Changes you asked for without a chat layer." } };

/** The layer a layer-view is acting for, from its caller id "layer:<id>". */
function viewLayerId(ctx: CallContext): string | undefined {
  return ctx.caller === "plugin" && ctx.pluginId?.startsWith("layer:") ? ctx.pluginId.slice("layer:".length) : undefined;
}

function rejectAppViews(ctx: CallContext) {
  if (ctx.caller === "plugin" && ctx.pluginId?.startsWith("app:")) throw new Error("Views made on the Home page cannot change the app's UI.");
}

function assistantLayer(ctx: CallContext, layer: unknown): LayerTarget {
  if (layer === "base") return USER_LAYER;
  if (typeof layer === "string" && layer) {
    if (!LAYER_ID.test(layer)) throw new Error("Layer ids are lowercase letters, digits, dots, dashes, colons or underscores.");
    return { kind: "layer", id: layer, init: { name: layer, source: "assistant", ...(ctx.layer?.chatId ? { chatId: ctx.layer.chatId } : {}) } };
  }
  if (ctx.layer) return { kind: "layer", id: ctx.layer.id, init: { name: ctx.layer.name, source: "assistant", ...(ctx.layer.chatId ? { chatId: ctx.layer.chatId } : {}) } };
  return { kind: "layer", id: "assistant", init: { name: "Assistant", source: "assistant" } };
}

/** Where tabs, widgets and block/node types from this caller go. */
function contributionTarget(ctx: CallContext, layer: unknown): Target {
  rejectAppViews(ctx);
  const own = viewLayerId(ctx);
  if (own) return { kind: "layer", id: own, init: { name: own }, existing: true };
  if (ctx.caller === "plugin") {
    if (layer !== undefined && layer !== "") throw new Error("Plugins add UI to themselves; the layer parameter is for the assistant.");
    if (!ctx.pluginId) throw new Error("Unknown plugin.");
    return { kind: "plugin", pluginId: ctx.pluginId, pluginName: ctx.pluginName ?? ctx.pluginId };
  }
  return assistantLayer(ctx, layer);
}

function pluginLayerId(pluginId: string): string {
  return `plugin:${pluginId.toLowerCase().replace(/[^a-z0-9:._-]/g, "-")}`.slice(0, 80);
}

/** Where tokens, component styles and CSS from this caller go. Undefined = the base document. */
function appearanceTarget(ctx: CallContext, layer: unknown): LayerTarget | undefined {
  rejectAppViews(ctx);
  const own = viewLayerId(ctx);
  if (own) return { kind: "layer", id: own, init: { name: own }, existing: true };
  if (ctx.caller === "plugin") {
    if (layer !== undefined && layer !== "") throw new Error("Plugin appearance changes go to the plugin's own layer; the layer parameter is for the assistant.");
    if (!ctx.pluginId) throw new Error("Unknown plugin.");
    return {
      kind: "layer",
      id: pluginLayerId(ctx.pluginId),
      init: { name: ctx.pluginName ?? ctx.pluginId, source: "plugin", pluginId: ctx.pluginId, description: "Appearance changes made by this plugin. They apply while it runs." },
    };
  }
  if (layer === "base") return undefined;
  return assistantLayer(ctx, layer);
}

function layerFor(doc: Customizations, target: LayerTarget): Layer {
  if (target.existing) {
    const layer = doc.layers.find((item) => item.id === target.id);
    if (!layer) throw new Error(`The layer "${target.id}" no longer exists.`);
    layer.updatedAt = Date.now();
    return layer;
  }
  return ensureLayer(doc, target.id, target.init);
}

function ownerOf(target: Target): ContributionOwner {
  if (target.kind === "plugin") return { kind: "plugin", id: target.pluginId, name: target.pluginName };
  const layer = customizations.get().layers.find((item) => item.id === target.id);
  return { kind: "layer", id: target.id, name: layer?.name ?? target.init.name };
}

function keyOf(owner: Pick<ContributionOwner, "kind" | "id">, localId: string): string {
  return `${owner.kind}:${owner.id}:${localId}`;
}

/** Apply a change to the target's contribution set. */
async function editSet(target: Target, ctx: CallContext, change: (set: ContributionSet) => void): Promise<void> {
  if (target.kind === "layer") {
    await editCustomizations((draft) => change(layerFor(draft, target)));
    return;
  }
  const apply = (current: ContributionSet) => {
    const next = jsonClone(current);
    change(next);
    return next;
  };
  if (ctx.surface) ctx.surface.editContributions(apply);
  else pluginRuntime.editContributions(target.pluginId, apply);
}

async function editLook(target: LayerTarget | undefined, change: (look: Look) => void): Promise<Customizations> {
  return editCustomizations((draft) => change(target ? layerFor(draft, target) : draft));
}

function ownerInfo(owner: ContributionOwner): ContributionOwnerInfo {
  return { kind: owner.kind, id: owner.id, name: owner.name };
}

// ── layers ────────────────────────────────────────────────────────────────

function layerInfo(layer: Layer): LayerInfo {
  return jsonClone(layer) as unknown as LayerInfo;
}

function requireLayer(doc: Customizations, id: string): Layer {
  const layer = doc.layers.find((item) => item.id === id);
  if (!layer) {
    const known = doc.layers.map((item) => `"${item.id}"`).join(", ") || "none";
    throw new Error(`No customization layer "${id}". Layers: ${known}.`);
  }
  return layer;
}

/** Plugins may only manage their own layer; layer views only theirs. */
function checkLayerAccess(ctx: CallContext, id: string) {
  rejectAppViews(ctx);
  const own = viewLayerId(ctx);
  if (own && own !== id) throw new Error("A layer's views can only change that layer.");
  if (ctx.caller === "plugin" && !own && ctx.pluginId && id !== pluginLayerId(ctx.pluginId)) {
    throw new Error(`Plugins can only manage their own layer ("${pluginLayerId(ctx.pluginId)}").`);
  }
}

async function loadedDoc(): Promise<Customizations> {
  if (!customizations.isLoaded()) await customizations.load();
  return customizations.get();
}

const APPEARANCE_HANDLERS: Record<string, Handler> = {
  "appearance.get": async () => jsonClone(await loadedDoc()),
  "appearance.setTokens": (p, ctx) =>
    editLook(appearanceTarget(ctx, p.layer), (look) => {
      applyTokens(look.tokens.light, p.both);
      applyTokens(look.tokens.dark, p.both);
      applyTokens(look.tokens.light, p.light);
      applyTokens(look.tokens.dark, p.dark);
    }),
  "appearance.styleComponent": (p, ctx) => {
    if (!COMPONENTS.some((component) => component.id === p.component)) {
      throw new Error(`Unknown component "${p.component}". Known: ${COMPONENTS.map((component) => component.id).join(", ")}.`);
    }
    return editLook(appearanceTarget(ctx, p.layer), (look) => {
      const current = { ...(look.components[p.component] ?? {}) };
      if (p.css !== undefined) current.css = cleanCss(p.css) || undefined;
      if (p.rules !== undefined) current.rules = cleanCss(p.rules) || undefined;
      if (p.hidden !== undefined) current.hidden = p.hidden || undefined;
      if (!current.css && !current.rules && !current.hidden) delete look.components[p.component];
      else look.components[p.component] = current;
    });
  },
  "appearance.addCss": (p, ctx) => {
    if (!SNIPPET_ID.test(p.id)) throw new Error("Snippet id must be lowercase letters, digits and dashes (max 48).");
    return editLook(appearanceTarget(ctx, p.layer), (look) => {
      const snippet = { id: p.id, label: p.label || p.id, css: cleanCss(p.css), enabled: p.enabled !== false };
      const index = look.css.findIndex((item) => item.id === p.id);
      if (index >= 0) look.css[index] = snippet;
      else look.css.push(snippet);
    });
  },
  "appearance.removeCss": (p, ctx) =>
    editLook(appearanceTarget(ctx, p.layer), (look) => {
      const before = look.css.length;
      look.css = look.css.filter((item) => item.id !== p.id);
      if (look.css.length === before) throw new Error(`No CSS snippet "${p.id}" here. appearance.get shows the base snippets and each layer's.`);
    }),
  "appearance.reset": (p, ctx) =>
    editLook(appearanceTarget(ctx, p.layer), (look) => {
      const scope = p.scope ?? "all";
      if (scope === "all" || scope === "tokens") look.tokens = { light: {}, dark: {} };
      if (scope === "all" || scope === "css") look.css = [];
      if (scope === "all" || scope === "components") look.components = {};
    }),
  "appearance.listLayers": async () => (await loadedDoc()).layers.map(layerInfo),
  "appearance.setLayer": async (p, ctx) => {
    checkLayerAccess(ctx, p.id);
    let result: Layer | undefined;
    await editCustomizations((draft) => {
      const existing = draft.layers.find((item) => item.id === p.id);
      let layer: Layer;
      if (existing) {
        layer = existing;
        layer.updatedAt = Date.now();
      } else {
        const name = typeof p.name === "string" && p.name.trim() ? p.name.trim() : p.id;
        const init: Partial<Layer> & { name: string } = ctx.caller === "plugin" && ctx.pluginId
          ? { name, source: "plugin", pluginId: ctx.pluginId }
          : { name, source: "assistant", ...(ctx.layer?.chatId ? { chatId: ctx.layer.chatId } : {}) };
        layer = ensureLayer(draft, p.id, init);
      }
      if (typeof p.name === "string" && p.name.trim()) layer.name = p.name.trim().slice(0, 80);
      if (typeof p.description === "string") layer.description = p.description.trim().slice(0, 400) || undefined;
      if (typeof p.enabled === "boolean") layer.enabled = p.enabled;
      result = layer;
    });
    return layerInfo(requireLayer(customizations.get(), result!.id));
  },
  "appearance.setLayerPermissions": async (p, ctx) => {
    if (ctx.caller === "plugin") throw new Error("Only you or the assistant (with your confirmation) can grant permissions to a layer.");
    const known = new Set<string>(PERMISSIONS.map((permission) => permission.id));
    const unknown = (p.permissions as string[]).filter((id) => !known.has(id));
    if (unknown.length) throw new Error(`Unknown permissions: ${unknown.join(", ")}.`);
    await editCustomizations((draft) => {
      const layer = requireLayer(draft, p.id);
      layer.permissions = [...new Set(p.permissions as string[])];
      layer.updatedAt = Date.now();
    });
    return layerInfo(requireLayer(customizations.get(), p.id));
  },
  "appearance.removeLayer": async (p, ctx) => {
    checkLayerAccess(ctx, p.id);
    await editCustomizations((draft) => {
      requireLayer(draft, p.id);
      draft.layers = draft.layers.filter((item) => item.id !== p.id);
    });
  },
};

// ── ui.ask ────────────────────────────────────────────────────────────────

const ASK_HANDLERS: Record<string, Handler> = {
  "ui.ask": async (p, ctx): Promise<AskResult> => {
    const options = ((p.options ?? []) as { label: string; description?: string }[])
      .filter((option) => option && typeof option.label === "string" && option.label.trim())
      .slice(0, 12)
      .map((option, index) => ({ id: String(index), label: option.label.trim().slice(0, 120), ...(option.description ? { description: String(option.description).slice(0, 300) } : {}) }));
    const allowText = p.allowText !== false;
    if (!options.length && !allowText) throw new Error("ui.ask needs options, or allowText.");
    const answer = await dialogs.ask({
      question: String(p.question).slice(0, 600),
      options,
      multiple: Boolean(p.multiple),
      allowText,
      placeholder: typeof p.placeholder === "string" ? p.placeholder.slice(0, 120) : undefined,
      source: ctx.caller === "plugin" ? ctx.pluginName : undefined,
    });
    return { answer: answer.answer, choices: answer.choices, cancelled: answer.cancelled };
  },
};

// ── sidebar ───────────────────────────────────────────────────────────────

function sidebarKeys(): string[] {
  return availableTabs(contributions.current().sidebarTabs.map((tab) => tab.key));
}

function sidebarTabInfos(): SidebarTabInfo[] {
  const builtins: SidebarTabInfo[] = BUILTIN_SIDEBAR_TABS.map((id) => ({ key: id, id, title: BUILTIN_SIDEBAR_TAB_INFO[id].title, icon: BUILTIN_SIDEBAR_TAB_INFO[id].icon, builtin: true, kind: "builtin" }));
  const contributed: SidebarTabInfo[] = contributions.current().sidebarTabs.map((tab) => ({
    key: tab.key,
    id: tab.id,
    title: tab.title,
    ...(tab.icon ? { icon: tab.icon } : {}),
    builtin: false,
    owner: ownerInfo(tab.owner),
    kind: tab.view.html ? "html" : "markdown",
  }));
  return [...builtins, ...contributed];
}

function sidebarInfo(): SidebarInfo {
  const settings = store().settings;
  return {
    open: settings.rightOpen,
    width: settings.rightWidth,
    groups: resolveSidebar(customizations.get().sidebar, sidebarKeys()).map((group) => ({ tabs: group.tabs, active: group.active, size: group.size })),
    tabs: sidebarTabInfos(),
  };
}

/** Accepts a full key, a built-in id, or a tab id (the caller's own tabs win). */
function resolveTabKey(ref: string, ctx: CallContext): string {
  const keys = sidebarKeys();
  if (keys.includes(ref)) return ref;
  const tabs = contributions.current().sidebarTabs.filter((tab) => tab.id === ref);
  if (tabs.length) {
    const own = viewLayerId(ctx);
    const mine = tabs.find((tab) =>
      ctx.caller === "plugin"
        ? own ? tab.owner.kind === "layer" && tab.owner.id === own : tab.owner.kind === "plugin" && tab.owner.id === ctx.pluginId
        : tab.owner.kind === "layer" && tab.owner.id === (ctx.layer?.id ?? "assistant"),
    );
    return (mine ?? tabs[0]).key;
  }
  throw new Error(`No sidebar tab "${ref}". Tabs: ${keys.join(", ")}.`);
}

function showTab(key: string, split: boolean) {
  const keys = sidebarKeys();
  if (split) moveSidebarTab(key, -1, undefined, keys);
  activateSidebarTab(key, keys);
  const state = store();
  if (!state.settings.rightOpen) state.updateSettings({ rightOpen: true });
  state.setRightTab(key);
}

const SIDEBAR_HANDLERS: Record<string, Handler> = {
  "sidebar.list": () => sidebarInfo(),
  "sidebar.setTab": async (p, ctx) => {
    if (!p.html && !p.markdown) throw new Error("A sidebar tab needs html or markdown.");
    const def = normalizeSidebarTab({ id: p.id, title: p.title, icon: p.icon, view: { html: p.html, markdown: p.markdown, actions: p.actions } });
    if (!def) throw new Error("Tab ids are letters, digits, dots, dashes and underscores (max 64), starting with a letter or digit.");
    const target = contributionTarget(ctx, p.layer);
    await editSet(target, ctx, (set) => {
      set.sidebarTabs = upsert(set.sidebarTabs, def, (tab) => tab.id, LIMITS.sidebarTabs, "sidebar tabs");
    });
    const owner = ownerOf(target);
    const key = keyOf(owner, def.id);
    if (p.open || p.split) {
      if (!sidebarKeys().includes(key)) throw new Error("The tab was saved but is not showing — its layer may be switched off.");
      showTab(key, Boolean(p.split));
    }
    return { key, id: def.id, title: def.title, ...(def.icon ? { icon: def.icon } : {}), builtin: false, owner: ownerInfo(owner), kind: def.view.html ? "html" : "markdown" } satisfies SidebarTabInfo;
  },
  "sidebar.removeTab": async (p, ctx) => {
    const target = contributionTarget(ctx, p.layer);
    let found = false;
    await editSet(target, ctx, (set) => {
      found = set.sidebarTabs.some((tab) => tab.id === p.id);
      set.sidebarTabs = set.sidebarTabs.filter((tab) => tab.id !== p.id);
    });
    if (!found) throw new Error(`No sidebar tab "${p.id}" here. sidebar.list shows every tab and its owner.`);
    const key = keyOf(ownerOf(target), p.id);
    if (store().rightTab === key) store().setRightTab("outline");
  },
  "sidebar.openTab": (p, ctx) => {
    showTab(resolveTabKey(p.id, ctx), Boolean(p.split));
  },
  "sidebar.setLayout": (p, ctx) => {
    const keys = sidebarKeys();
    const groups = (p.groups as { tabs: string[]; active?: string; size?: number }[]).map((group) => {
      const tabs = group.tabs.map((ref) => resolveTabKey(ref, ctx));
      return { tabs, active: group.active ? resolveTabKey(group.active, ctx) : tabs[0], size: group.size };
    });
    setSidebarGroups(groups, keys);
    if (typeof p.width === "number") store().updateSettings({ rightWidth: Math.max(240, Math.min(900, Math.round(p.width))) });
    return sidebarInfo();
  },
  "sidebar.moveTab": (p, ctx) => {
    moveSidebarTab(resolveTabKey(p.id, ctx), p.group, p.index, sidebarKeys());
    return sidebarInfo();
  },
};

// ── status bar ────────────────────────────────────────────────────────────

function statusInfos(): StatusWidgetInfo[] {
  const builtins: StatusWidgetInfo[] = BUILTIN_STATUS_WIDGETS.map((widget) => ({ key: widget.id, id: widget.id, side: widget.side, order: widget.order, builtin: true, text: widget.title, kind: "builtin" }));
  const contributed: StatusWidgetInfo[] = contributions.current().statusWidgets.map((widget) => ({
    key: widget.key,
    id: widget.id,
    side: widget.side,
    order: widget.order,
    builtin: false,
    ...(widget.text ? { text: widget.text } : {}),
    kind: widget.html ? "html" : "text",
    owner: ownerInfo(widget.owner),
  }));
  return [...builtins, ...contributed].sort((a, b) => (a.side === b.side ? a.order - b.order : a.side === "left" ? -1 : 1));
}

const STATUS_HANDLERS: Record<string, Handler> = {
  "statusBar.list": () => statusInfos(),
  "statusBar.setWidget": async (p, ctx) => {
    if (!p.text && !p.html && !p.icon) throw new Error("A status widget needs text, an icon or html.");
    const def = normalizeStatusWidget(p);
    if (!def) throw new Error("Widget ids are letters, digits, dots, dashes and underscores (max 64).");
    const target = contributionTarget(ctx, p.layer);
    await editSet(target, ctx, (set) => {
      set.statusWidgets = upsert(set.statusWidgets, def, (widget) => widget.id, LIMITS.statusWidgets, "status widgets");
    });
    const owner = ownerOf(target);
    return {
      key: keyOf(owner, def.id),
      id: def.id,
      side: def.side,
      order: def.order,
      builtin: false,
      ...(def.text ? { text: def.text } : {}),
      kind: def.html ? "html" : "text",
      owner: ownerInfo(owner),
    } satisfies StatusWidgetInfo;
  },
  "statusBar.removeWidget": async (p, ctx) => {
    const target = contributionTarget(ctx, p.layer);
    let found = false;
    await editSet(target, ctx, (set) => {
      found = set.statusWidgets.some((widget) => widget.id === p.id);
      set.statusWidgets = set.statusWidgets.filter((widget) => widget.id !== p.id);
    });
    if (!found) throw new Error(`No status widget "${p.id}" here. statusBar.list shows every widget and its owner.`);
  },
};

// ── menus and plugin options ──────────────────────────────────────────────

function menuItemInfo(item: { id: string; key: string; menu: string; title: string; icon?: string; command: string; owner: ContributionOwner; danger?: boolean }): MenuItemInfo {
  return {
    key: item.key,
    id: item.id,
    menu: item.menu as MenuItemInfo["menu"],
    title: item.title,
    ...(item.icon ? { icon: item.icon } : {}),
    command: item.command,
    ...(item.danger ? { danger: true } : {}),
    owner: ownerInfo(item.owner),
  };
}

/** The fields a plugin declared: what it published at runtime, else its manifest. */
function settingFieldsOf(pluginId: string): SettingFieldInfo[] {
  return (contributions.get({ kind: "plugin", id: pluginId })?.settings ?? []) as SettingFieldInfo[];
}

const MENU_HANDLERS: Record<string, Handler> = {
  "menus.list": (p) => contributions.current().menuItems.filter((item) => !p.menu || item.menu === p.menu).map(menuItemInfo),
  "menus.addItem": async (p, ctx) => {
    const def = normalizeMenuItem(p);
    if (!def) throw new Error("Menu items need an id (letters, digits, . - _), a menu (page, tree, block, tab, status), a title and a command.");
    const target = contributionTarget(ctx, p.layer);
    if (target.kind === "layer" && !def.command.includes(":") && !def.command.includes(".")) {
      throw new Error(`"${def.command}" is not an app command id. Use commands.list to find one.`);
    }
    await editSet(target, ctx, (set) => {
      set.menuItems = upsert(set.menuItems, def, (item) => item.id, LIMITS.menuItems, "menu items");
    });
    const owner = ownerOf(target);
    return menuItemInfo({ ...def, key: keyOf(owner, def.id), owner });
  },
  "menus.removeItem": async (p, ctx) => {
    const target = contributionTarget(ctx, p.layer);
    let found = false;
    await editSet(target, ctx, (set) => {
      found = set.menuItems.some((item) => item.id === p.id);
      set.menuItems = set.menuItems.filter((item) => item.id !== p.id);
    });
    if (!found) throw new Error(`No menu item "${p.id}" here. menus.list shows every item and its owner.`);
  },
  "settings.define": async (p, ctx) => {
    if (!ctx.pluginId || ctx.caller !== "plugin") throw new Error("settings.define is only available to plugins.");
    const fields = (Array.isArray(p.fields) ? p.fields : []).map(normalizeSettingField);
    const bad = fields.findIndex((field) => !field);
    if (bad >= 0) throw new Error(`Field ${bad + 1} is invalid: keys are letters, digits, . - _ and select fields need options.`);
    const clean = fields.filter((field): field is NonNullable<typeof field> => Boolean(field)).slice(0, LIMITS.settings);
    await editSet(contributionTarget(ctx, undefined), ctx, (set) => {
      set.settings = clean;
    });
    return clean as SettingFieldInfo[];
  },
  "settings.options": async (_p, ctx) => {
    if (!ctx.pluginId) throw new Error("settings.* is only available to plugins.");
    return loadOptions(ctx.pluginId, settingFieldsOf(ctx.pluginId));
  },
};

// ── blocks and nodes ──────────────────────────────────────────────────────

function typeClash(kind: "blockTypes" | "nodeTypes", type: string, owner: ContributionOwner) {
  const other = contributions.current()[kind].find((item) => item.type === type);
  if (other && (other.owner.kind !== owner.kind || other.owner.id !== owner.id)) {
    throw new Error(`The type "${type}" is already added by ${other.owner.name}. Pick another type id.`);
  }
}

function blockTypeInfo(def: { type: string; title: string; description?: string; icon?: string }, owner: ContributionOwner): BlockTypeInfo {
  return { type: def.type, title: def.title, ...(def.description ? { description: def.description } : {}), ...(def.icon ? { icon: def.icon } : {}), owner: ownerInfo(owner) };
}

function nodeTypeInfo(def: NodeTypeDef, owner: ContributionOwner): NodeTypeInfo {
  return { ...blockTypeInfo(def, owner), layout: def.layout ?? "full" };
}

interface NodeData {
  type: string;
  data: unknown;
}

function nodeDataOf(pageId: string): NodeData {
  const meta = requireMeta(pageId, "Page");
  if (meta.kind !== "custom") throw new Error(`"${displayTitle(pageId)}" is a ${meta.kind || "page"}, not a custom node.`);
  try {
    const parsed = JSON.parse(meta.data || "{}") as Partial<NodeData>;
    return { type: String(parsed.type ?? ""), data: parsed.data ?? null };
  } catch {
    return { type: "", data: null };
  }
}

function serializeNode(value: NodeData): string {
  const text = JSON.stringify(value);
  if (text.length > 1_000_000) throw new Error("Node data is larger than 1 MB.");
  return text;
}

const BLOCK_HANDLERS: Record<string, Handler> = {
  "blocks.registerType": async (p, ctx) => {
    if (!TYPE_ID.test(String(p.type ?? ""))) throw new Error("Block type ids are lowercase letters, digits, dots, dashes and underscores (max 64), e.g. \"acme.chart\".");
    const def = normalizeBlockType(p);
    if (!def) throw new Error("A block type needs a type, a title and html.");
    const target = contributionTarget(ctx, p.layer);
    const owner = ownerOf(target);
    typeClash("blockTypes", def.type, owner);
    await editSet(target, ctx, (set) => {
      set.blockTypes = upsert(set.blockTypes, def, (item) => item.type, LIMITS.blockTypes, "block types");
    });
    return blockTypeInfo(def, owner);
  },
  "blocks.unregisterType": async (p, ctx) => {
    const target = contributionTarget(ctx, p.layer);
    let found = false;
    await editSet(target, ctx, (set) => {
      found = set.blockTypes.some((item) => item.type === p.type);
      set.blockTypes = set.blockTypes.filter((item) => item.type !== p.type);
    });
    if (!found) throw new Error(`No block type "${p.type}" here. blocks.listTypes shows every type and its owner.`);
  },
  "blocks.listTypes": (): BlockTypeInfo[] => contributions.current().blockTypes.map((def) => blockTypeInfo(def, def.owner)),
  "blocks.insert": async (p) => {
    const def = contributions.current().blockTypeMap.get(p.type);
    if (!def) {
      const known = contributions.current().blockTypes.map((item) => item.type).join(", ") || "none";
      throw new Error(`No block type "${p.type}". Registered: ${known}. Add one with blocks.registerType.`);
    }
    const { handle } = editorFor();
    if (!handle.insertCustomBlock) throw new Error("This editor cannot insert custom blocks.");
    const blockId = await handle.insertCustomBlock(def.type, p.data === undefined ? def.defaultData : p.data, p.after || undefined);
    return { blockId };
  },
  "blocks.setData": async (p) => {
    const { handle } = editorFor();
    if (!handle.setCustomBlockData) throw new Error("This editor cannot change custom blocks.");
    await handle.setCustomBlockData(p.blockId, p.data);
  },
  "nodes.registerType": async (p, ctx) => {
    if (!TYPE_ID.test(String(p.type ?? ""))) throw new Error("Node type ids are lowercase letters, digits, dots, dashes and underscores (max 64), e.g. \"acme.kanban\".");
    const def = normalizeNodeType(p);
    if (!def) throw new Error("A node type needs a type, a title and html.");
    const target = contributionTarget(ctx, p.layer);
    const owner = ownerOf(target);
    typeClash("nodeTypes", def.type, owner);
    await editSet(target, ctx, (set) => {
      set.nodeTypes = upsert(set.nodeTypes, def, (item) => item.type, LIMITS.nodeTypes, "node types");
    });
    return nodeTypeInfo(def, owner);
  },
  "nodes.unregisterType": async (p, ctx) => {
    const target = contributionTarget(ctx, p.layer);
    let found = false;
    await editSet(target, ctx, (set) => {
      found = set.nodeTypes.some((item) => item.type === p.type);
      set.nodeTypes = set.nodeTypes.filter((item) => item.type !== p.type);
    });
    if (!found) throw new Error(`No node type "${p.type}" here. nodes.listTypes shows every type and its owner.`);
  },
  "nodes.listTypes": (): NodeTypeInfo[] => contributions.current().nodeTypes.map((def) => nodeTypeInfo(def, def.owner)),
  "nodes.create": async (p) => {
    const def = contributions.current().nodeTypeMap.get(p.type);
    if (!def) {
      const known = contributions.current().nodeTypes.map((item) => item.type).join(", ") || "none";
      throw new Error(`No node type "${p.type}". Registered: ${known}. Add one with nodes.registerType.`);
    }
    if (p.parentId) requireMeta(p.parentId, "Parent");
    const data = serializeNode({ type: def.type, data: p.data === undefined ? (def.defaultData ?? null) : p.data });
    const meta = await store().createItem("custom", p.parentId ?? "", { open: p.open !== false, title: typeof p.title === "string" && p.title.trim() ? p.title.trim() : def.title, data });
    if (!meta) throw new Error("The node was not created (no workspace is open).");
    return { pageId: meta.id };
  },
  "nodes.getData": (p) => nodeDataOf(p.pageId),
  "nodes.setData": async (p) => {
    const current = nodeDataOf(p.pageId);
    await store().setPageData(p.pageId, serializeNode({ type: current.type, data: p.data }));
  },
};

// ── views ─────────────────────────────────────────────────────────────────

const VIEW_HANDLERS: Record<string, Handler> = {
  "views.post": (p, ctx) => {
    if (ctx.caller !== "plugin" || !ctx.pluginId) throw new Error("views.post is for plugins.");
    const own = viewLayerId(ctx);
    const kind = own ? "layer" : "plugin";
    const id = own ?? ctx.pluginId;
    const key = typeof p.view === "string" && p.view ? keyOf({ kind, id }, p.view) : undefined;
    return { delivered: viewHub.message(kind, id, String(p.name), p.payload, key) };
  },
};

// ── plugins: test, install, logs ──────────────────────────────────────────

interface ManifestInput {
  id: string;
  name: string;
  version?: string;
  description?: string;
  permissions?: string[];
  commands?: { id: string; title: string }[];
  statusItems?: { id: string; label: string }[];
  panels?: { id: string; title: string }[];
}

const PLUGIN_ID = /^[a-z0-9][a-z0-9.-]{1,63}$/;

function buildManifest(input: ManifestInput): Manifest {
  if (!input || typeof input !== "object") throw new Error("manifest is required.");
  if (!PLUGIN_ID.test(String(input.id ?? ""))) throw new Error("Plugin ids are lowercase letters, digits, dots and dashes, e.g. \"assistant.word-goals\".");
  if (!String(input.name ?? "").trim()) throw new Error("The manifest needs a name.");
  const known = new Set<string>(PERMISSIONS.map((permission) => permission.id));
  const permissions = Array.from(new Set(input.permissions ?? []));
  const unknown = permissions.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`Unknown permissions: ${unknown.join(", ")}. Known: ${[...known].join(", ")}.`);
  return {
    id: input.id,
    name: input.name.trim(),
    version: input.version || "1.0.0",
    sdkVersion: SDK_VERSION,
    description: input.description ?? "",
    author: "Noteral Assistant",
    entry: "main.js",
    permissions,
    contributes: {
      commands: input.commands ?? [],
      statusItems: input.statusItems ?? [],
      panels: input.panels ?? [],
    },
  } as Manifest;
}

function summarizeTest(result: PluginTestResult): string {
  const lines = [`Status: ${result.status}${result.error ? ` — ${result.error}` : ""}`];
  const errors = result.logs.filter((entry) => entry.level !== "info").slice(-8);
  if (errors.length) lines.push("Log:", ...errors.map((entry) => `  [${entry.level}] ${entry.message}`));
  if (result.skipped.length) lines.push(`Skipped write calls: ${[...new Set(result.skipped)].join(", ")}`);
  return lines.join("\n");
}

const PLUGIN_HANDLERS: Record<string, Handler> = {
  "plugins.test": async (p): Promise<PluginTestResult> => {
    const manifest = buildManifest(p.manifest);
    const waitMs = Math.max(0, Math.min(10_000, Number(p.waitMs ?? 1500)));
    return (await pluginRuntime.trial(manifest, String(p.code ?? ""), p.styles ?? "", waitMs)) as PluginTestResult;
  },
  "plugins.create": async (p): Promise<PluginInstallResult> => {
    const manifest = buildManifest(p.manifest);
    const code = String(p.code ?? "");
    if (!code.trim()) throw new Error("code is required.");
    let test: PluginTestResult | undefined;
    if (!p.skipTest) {
      test = (await pluginRuntime.trial(manifest, code, p.styles ?? "", 1500)) as PluginTestResult;
      if (!test.ok) throw new Error(`The plugin failed its test run, so nothing was installed. Fix it and call plugins.create again.\n${summarizeTest(test)}`);
    }
    let info;
    try {
      info = await api.installGeneratedPlugin(manifest, code, p.styles ?? "", manifest.permissions ?? []);
      await store().loadPlugins();
    } catch (error) {
      throw new Error(`The plugin was not installed: ${errorMessage(error)}`);
    }
    const health = await pluginRuntime.health(manifest.id);
    if (health.status === "failed") {
      // Don't leave a broken plugin running; the assistant can fix it and install again.
      await api.togglePlugin(manifest.id, false).catch(() => undefined);
      await store().loadPlugins();
      health.error = `Turned off because it failed to start: ${health.error ?? "unknown error"}`;
      info = { ...info, enabled: false };
    }
    return { ...pluginInfo(info), ...(test ? { test } : {}), health };
  },
  "plugins.logs": (p): LogEntryInfo[] => {
    const limit = Math.max(1, Math.min(400, Number(p.limit ?? 50)));
    const entries = [...devlog.read(`plugin:${p.id}`, 0, 400), ...devlog.read(`trial:${p.id}`, 0, 400)];
    return entries
      .sort((a, b) => a.at - b.at)
      .slice(-limit)
      .map((entry) => ({ at: entry.at, level: entry.level, message: entry.message }));
  },
  "plugins.uninstall": async (p) => {
    await api.uninstallPlugin(p.id);
    await store().loadPlugins();
    const layerId = pluginLayerId(p.id);
    if (customizations.get().layers.some((layer) => layer.id === layerId)) {
      await editCustomizations((draft) => {
        draft.layers = draft.layers.filter((layer) => layer.id !== layerId);
      });
    }
    devlog.clear(`plugin:${p.id}`);
  },
};

export const UI_HANDLERS: Record<string, Handler> = {
  ...APPEARANCE_HANDLERS,
  ...ASK_HANDLERS,
  ...SIDEBAR_HANDLERS,
  ...STATUS_HANDLERS,
  ...MENU_HANDLERS,
  ...BLOCK_HANDLERS,
  ...VIEW_HANDLERS,
  ...PLUGIN_HANDLERS,
};

/** Exposed for the Created tab and tests. */
export { lookOf, pluginLayerId };
