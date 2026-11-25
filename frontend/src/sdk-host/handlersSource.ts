/**
 * Source tools: read and patch the text behind anything the assistant (or the user) built —
 * HTML of sidebar tabs, status widgets, block and page types, Home widgets, CSS snippets,
 * component styles and plugin code — with find-and-replace edits instead of resending it.
 */
import { api } from "../lib/api";
import { contributions, normalizeBlockType, normalizeNodeType, normalizeSidebarTab, normalizeStatusWidget } from "../lib/contributions";
import { cleanCss, customizations } from "../lib/customizations";
import type { Customizations, Layer, Look } from "../lib/customizations";
import { editCustomizations, store } from "./handlers";
import type { CallContext } from "./handlers";
import { HOME_HANDLERS } from "./handlersHome";
import { applyEdits } from "./textEdits";
import type { TextEdit } from "./textEdits";
import type { SourceEntry } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = Record<string, any>;

export type SourceKind = SourceEntry["kind"];


const KINDS: SourceKind[] = ["sidebar", "status", "block", "node", "css", "component", "home", "homeview", "plugin"];

function fieldsOf(record: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) if (typeof value === "string" && value) out[key] = value.length;
  return out;
}

function lookEntries(look: Look, owner: string): SourceEntry[] {
  const out: SourceEntry[] = [];
  for (const snippet of look.css) out.push({ target: `css:${snippet.id}`, kind: "css", title: snippet.label || snippet.id, owner, fields: fieldsOf({ css: snippet.css }), editable: true });
  for (const [name, style] of Object.entries(look.components)) {
    const fields = fieldsOf({ css: style.css, rules: style.rules });
    if (Object.keys(fields).length) out.push({ target: `component:${name}`, kind: "component", title: name, owner, fields, editable: true });
  }
  return out;
}

function layerEntries(layer: Layer): SourceEntry[] {
  const owner = layer.id;
  return [
    ...layer.sidebarTabs.map((tab): SourceEntry => ({ target: `sidebar:${tab.id}`, kind: "sidebar", title: tab.title, owner, fields: fieldsOf({ html: tab.view.html, markdown: tab.view.markdown }), editable: true })),
    ...layer.statusWidgets.map((widget): SourceEntry => ({ target: `status:${widget.id}`, kind: "status", title: widget.tooltip || widget.text || widget.id, owner, fields: fieldsOf({ html: widget.html, text: widget.text }), editable: true })),
    ...layer.blockTypes.map((def): SourceEntry => ({ target: `block:${def.type}`, kind: "block", title: def.title, owner, fields: fieldsOf({ html: def.html }), editable: true })),
    ...layer.nodeTypes.map((def): SourceEntry => ({ target: `node:${def.type}`, kind: "node", title: def.title, owner, fields: fieldsOf({ html: def.html }), editable: true })),
    ...lookEntries(layer, owner),
  ];
}

function pluginEntries(): SourceEntry[] {
  const snap = contributions.current();
  const entries: SourceEntry[] = [];
  const add = (kind: SourceKind, id: string, title: string, owner: { kind: string; id: string }, fields: Record<string, unknown>) => {
    if (owner.kind === "plugin") entries.push({ target: `${kind}:${id}`, kind, title, owner: owner.id, fields: fieldsOf(fields), editable: false });
  };
  for (const tab of snap.sidebarTabs) add("sidebar", tab.id, tab.title, tab.owner, { html: tab.view.html, markdown: tab.view.markdown });
  for (const widget of snap.statusWidgets) add("status", widget.id, widget.tooltip || widget.text || widget.id, widget.owner, { html: widget.html, text: widget.text });
  for (const def of snap.blockTypes) add("block", def.type, def.title, def.owner, { html: def.html });
  for (const def of snap.nodeTypes) add("node", def.type, def.title, def.owner, { html: def.html });
  return entries;
}

function homeEntries(): SourceEntry[] {
  const out: SourceEntry[] = [];
  for (const view of store().homeViews) {
    if (view.css) out.push({ target: `homeview:${view.id}`, kind: "homeview", title: view.name, owner: "home", fields: fieldsOf({ css: view.css }), editable: true });
    for (const widget of view.widgets) {
      const fields = fieldsOf({ html: widget.html, css: widget.css, text: widget.text });
      if (Object.keys(fields).length) out.push({ target: `home:${view.id}/${widget.id}`, kind: "home", title: `${view.name} · ${widget.title || widget.type}`, owner: "home", fields, editable: true });
    }
  }
  return out;
}

async function loaded(): Promise<Customizations> {
  if (!customizations.isLoaded()) await customizations.load();
  return customizations.get();
}

async function allEntries(withPlugins: boolean): Promise<SourceEntry[]> {
  const doc = await loaded();
  const entries = [...lookEntries(doc, "base"), ...doc.layers.flatMap(layerEntries), ...pluginEntries(), ...homeEntries()];
  if (withPlugins) {
    const plugins = (await api.listPlugins().catch(() => [])) ?? [];
    for (const plugin of plugins) {
      entries.push({ target: `plugin:${plugin.manifest.id}`, kind: "plugin", title: plugin.manifest.name, owner: plugin.manifest.id, fields: {}, editable: false });
    }
  }
  return entries;
}

function parseTarget(target: unknown): { kind: SourceKind; id: string } {
  const text = String(target ?? "");
  const at = text.indexOf(":");
  const kind = text.slice(0, at) as SourceKind;
  const id = text.slice(at + 1);
  if (at < 1 || !id || !KINDS.includes(kind)) throw new Error(`Unknown target "${text}". Targets look like sidebar:<id>, status:<id>, block:<type>, node:<type>, css:<id>, component:<name>, home:<viewId>/<widgetId>, homeview:<viewId> or plugin:<id>; source.list shows them.`);
  return { kind, id };
}

/** Text fields each kind has, the first being the default. */
const FIELDS: Record<SourceKind, string[]> = {
  sidebar: ["html", "markdown"],
  status: ["html", "text"],
  block: ["html"],
  node: ["html"],
  css: ["css"],
  component: ["css", "rules"],
  home: ["html", "css", "text"],
  homeview: ["css"],
  plugin: ["code", "styles"],
};

/** Pick a layer: the explicit one, else the chat's own layer, else the only one that has it. */
function pickLayer(doc: Customizations, kind: SourceKind, id: string, layer: unknown, ctx: CallContext): Look & Partial<Layer> {
  const has = (look: Look & Partial<Layer>) => {
    switch (kind) {
      case "sidebar":
        return Boolean(look.sidebarTabs?.some((tab) => tab.id === id));
      case "status":
        return Boolean(look.statusWidgets?.some((widget) => widget.id === id));
      case "block":
        return Boolean(look.blockTypes?.some((def) => def.type === id));
      case "node":
        return Boolean(look.nodeTypes?.some((def) => def.type === id));
      case "css":
        return look.css.some((snippet) => snippet.id === id);
      case "component":
        return Boolean(look.components[id]);
      default:
        return false;
    }
  };
  if (typeof layer === "string" && layer) {
    const look = layer === "base" ? doc : doc.layers.find((item) => item.id === layer);
    if (!look) throw new Error(`No layer "${layer}". source.list shows where each item lives.`);
    if (!has(look)) throw new Error(`Layer "${layer}" has no ${kind}:${id}.`);
    return look;
  }
  const candidates: (Look & Partial<Layer>)[] = [doc, ...doc.layers].filter(has);
  if (!candidates.length) {
    const plugin = pluginEntries().find((entry) => entry.target === `${kind}:${id}`);
    if (plugin) throw new Error(`${kind}:${id} belongs to the plugin "${plugin.owner}". Change it with plugins.edit (target plugin:${plugin.owner}).`);
    throw new Error(`Nothing called ${kind}:${id}. source.list shows every editable item.`);
  }
  if (candidates.length === 1) return candidates[0];
  const own = ctx.layer ? candidates.find((look) => look.id === ctx.layer!.id) : undefined;
  if (own) return own;
  const enabled = candidates.filter((look) => look.enabled !== false);
  if (enabled.length === 1) return enabled[0];
  throw new Error(`${kind}:${id} exists in several layers (${candidates.map((look) => look.id ?? "base").join(", ")}). Pass layer.`);
}

/** Reads one text field of a layer-held item; `set` writes it back (inside a draft). */
function layerField(look: Look & Partial<Layer>, kind: SourceKind, id: string, field: string): { get: () => string; set: (value: string) => void } {
  switch (kind) {
    case "sidebar": {
      const index = look.sidebarTabs!.findIndex((tab) => tab.id === id);
      const tab = look.sidebarTabs![index];
      return {
        get: () => (field === "markdown" ? tab.view.markdown : tab.view.html) ?? "",
        set: (value) => {
          const next = normalizeSidebarTab({ ...tab, view: { ...tab.view, [field]: value } });
          if (!next) throw new Error("That edit made the tab invalid.");
          look.sidebarTabs![index] = next;
        },
      };
    }
    case "status": {
      const index = look.statusWidgets!.findIndex((widget) => widget.id === id);
      const widget = look.statusWidgets![index];
      return {
        get: () => (field === "text" ? widget.text : widget.html) ?? "",
        set: (value) => {
          const next = normalizeStatusWidget({ ...widget, [field]: value });
          if (!next) throw new Error("That edit made the widget invalid.");
          look.statusWidgets![index] = next;
        },
      };
    }
    case "block": {
      const index = look.blockTypes!.findIndex((def) => def.type === id);
      const def = look.blockTypes![index];
      return {
        get: () => def.html ?? "",
        set: (value) => {
          const next = normalizeBlockType({ ...def, html: value });
          if (!next) throw new Error("That edit made the block type invalid (html can't be empty).");
          look.blockTypes![index] = next;
        },
      };
    }
    case "node": {
      const index = look.nodeTypes!.findIndex((def) => def.type === id);
      const def = look.nodeTypes![index];
      return {
        get: () => def.html ?? "",
        set: (value) => {
          const next = normalizeNodeType({ ...def, html: value });
          if (!next) throw new Error("That edit made the page type invalid (html can't be empty).");
          look.nodeTypes![index] = next;
        },
      };
    }
    case "css": {
      const snippet = look.css.find((item) => item.id === id)!;
      return { get: () => snippet.css, set: (value) => void (snippet.css = cleanCss(value)) };
    }
    case "component": {
      const style = look.components[id];
      return {
        get: () => (field === "rules" ? style.rules : style.css) ?? "",
        set: (value) => {
          if (field === "rules") style.rules = cleanCss(value);
          else style.css = cleanCss(value);
        },
      };
    }
    default:
      throw new Error(`${kind} is not stored in a layer.`);
  }
}

function homeTarget(id: string): { viewId: string; widgetId?: string } {
  const [viewId, widgetId] = id.split("/");
  return { viewId, widgetId };
}

function chooseField(kind: SourceKind, field: unknown, available?: Record<string, number>): string {
  const allowed = FIELDS[kind];
  if (typeof field === "string" && field) {
    if (!allowed.includes(field)) throw new Error(`${kind} items have the fields ${allowed.join(", ")}.`);
    return field;
  }
  if (available) return allowed.find((name) => available[name]) ?? allowed[0];
  return allowed[0];
}

interface Located {
  owner: string;
  field: string;
  text: string;
}

async function locate(p: Params, ctx: CallContext): Promise<Located> {
  const { kind, id } = parseTarget(p.target);
  if (kind === "plugin") {
    const source = await api.getPluginSource(id);
    const field = chooseField(kind, p.field);
    return { owner: id, field, text: field === "styles" ? source.styles ?? "" : source.code };
  }
  if (kind === "home" || kind === "homeview") {
    const { viewId, widgetId } = homeTarget(id);
    const view = store().homeViews.find((item) => item.id === viewId || item.name === viewId);
    if (!view) throw new Error(`No custom Home view "${viewId}".`);
    if (kind === "homeview") return { owner: "home", field: "css", text: view.css ?? "" };
    const widget = view.widgets.find((item) => item.id === widgetId);
    if (!widget) throw new Error(`No widget "${widgetId}" in "${view.name}". home.getView lists its widgets.`);
    const field = chooseField(kind, p.field, fieldsOf({ html: widget.html, css: widget.css, text: widget.text }));
    return { owner: "home", field, text: String((widget as unknown as Record<string, unknown>)[field] ?? "") };
  }
  const doc = await loaded();
  const look = pickLayer(doc, kind, id, p.layer, ctx);
  const available: Record<string, number> = {};
  for (const name of FIELDS[kind]) available[name] = layerField(look, kind, id, name).get().length;
  const field = chooseField(kind, p.field, available);
  return { owner: look.id ?? "base", field, text: layerField(look, kind, id, field).get() };
}

function numbered(text: string, start: number, end: number): { text: string; lines: number } {
  const lines = text.split("\n");
  const from = Math.max(1, start);
  const to = Math.min(lines.length, end);
  return { text: lines.slice(from - 1, to).join("\n"), lines: lines.length };
}

export const SOURCE_HANDLERS: Record<string, (p: Params, ctx: CallContext) => unknown> = {
  "source.list": async (p) => {
    const kind = typeof p.kind === "string" && p.kind ? (p.kind as SourceKind) : undefined;
    const entries = await allEntries(!kind || kind === "plugin");
    return kind ? entries.filter((entry) => entry.kind === kind) : entries;
  },
  "source.get": async (p, ctx) => {
    const found = await locate(p, ctx);
    const start = Number(p.startLine ?? 1);
    const end = Number(p.endLine ?? Number.MAX_SAFE_INTEGER);
    const slice = numbered(found.text, start, end);
    return { target: String(p.target), owner: found.owner, field: found.field, lines: slice.lines, length: found.text.length, text: slice.text };
  },
  "source.edit": async (p, ctx) => {
    const { kind, id } = parseTarget(p.target);
    if (kind === "plugin") throw new Error("Plugin code changes need the user's review: use plugins.edit.");
    const edits = (p.edits ?? []) as TextEdit[];
    if (kind === "home" || kind === "homeview") {
      const found = await locate(p, ctx);
      const outcome = applyEdits(found.text, edits, String(p.target));
      const { viewId, widgetId } = homeTarget(id);
      if (kind === "homeview") await HOME_HANDLERS["home.updateView"]({ viewId, css: outcome.text });
      else await HOME_HANDLERS["home.updateWidget"]({ viewId, widgetId, [found.field]: outcome.text });
      return { target: String(p.target), field: found.field, replaced: outcome.replaced, length: outcome.text.length };
    }
    let result: { field: string; replaced: number; length: number; owner: string } | undefined;
    await editCustomizations((draft) => {
      const look = pickLayer(draft, kind, id, p.layer, ctx);
      const available: Record<string, number> = {};
      for (const name of FIELDS[kind]) available[name] = layerField(look, kind, id, name).get().length;
      const field = chooseField(kind, p.field, available);
      const slot = layerField(look, kind, id, field);
      const outcome = applyEdits(slot.get(), edits, String(p.target));
      slot.set(outcome.text);
      if (look.id) look.updatedAt = Date.now();
      result = { field, replaced: outcome.replaced, length: outcome.text.length, owner: look.id ?? "base" };
    });
    return { target: String(p.target), ...result! };
  },
};
