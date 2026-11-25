/**
 * Implementations of every method in ./spec.ts.
 *
 * Handlers receive params that the host (./host.ts) has already checked against
 * the method's schema, with defaults filled in. They talk to the app through
 * the zustand store, the editor bridge and the Go service — never the DOM.
 */
import { Clipboard } from "@wailsio/runtime";
import { api, errorMessage } from "../lib/api";
import type { Manifest, PageMeta } from "../lib/api";
import { commandRegistry } from "../lib/commands";
import { saveOptions } from "../lib/pluginOptions";
import {
  COMPONENTS,
  TOKEN_NAMES,
  checkTokenValue,
  cleanCss,
  customizations,
  tokenInfo,
} from "../lib/customizations";
import type { Customizations } from "../lib/customizations";
import type { ContributionSet } from "../lib/contributions";
import {
  OPTION_COLORS,
  TITLE_ID,
  defaultStatusOptions,
  hasOptions,
  isComputed,
  nextOptionColor,
  parseRowValues,
  parseSchema,
  rowsOf,
  serializeRowValues,
  serializeSchema,
  uid,
  uniquePropertyName,
} from "../lib/database";
import type { DatabaseRow, DatabaseSchema, Property, PropertyType, RowValues, SelectOption } from "../lib/database";
import { dialogs } from "../lib/dialogs";
import { editorBridge } from "../lib/editorBridge";
import type { EditorHandle } from "../lib/editorBridge";
import { appendMarkdown, docJsonToMarkdown, docJsonToText, markdownToDocJson } from "../lib/markdownDoc";
import { databaseMarkerIds } from "../lib/markdownEmbeds";
import { withFormulas } from "../lib/databaseFormulas";
import type { FormulaResult } from "../lib/databaseFormulas";
import { compileFormula } from "../lib/formula";
import { paneList } from "../lib/panes";
import { applyEdits } from "./textEdits";
import type { TextEdit } from "./textEdits";
import type { LayoutNode } from "../lib/panes";
import { isHomeTab, useAppStore } from "../store";
import type { Caller } from "./spec";
import type {
  ActivePage,
  AppInfo,
  CommandInfo,
  DatabaseInfo,
  DatabaseRowInfo,
  DatabaseSchemaInfo,
  EditorSnapshot,
  HttpResponse,
  LayoutInfo,
  PageContent,
  PageInfo,
  PanelAction,
  PluginInfo,
  PluginSourceInfo,
  Preferences,
  SearchHitInfo,
  TabInfo,
  WebPage,
  WebSearchResult,
  WorkspaceInfo,
} from "./types";

export const SDK_VERSION = "2.0.0";

/** Things only a running plugin frame can do (status items, panels, styles). */
export interface PluginSurface {
  setStatus(itemId: string, text: string, title?: string): void;
  setPanel(panelId: string, panel: { title?: string; markdown: string; actions: PanelAction[] }): void;
  addStyles(css: string): void;
  /** The frame's UI contributions (sidebar tabs, status widgets, block and node types). */
  contributions(): ContributionSet;
  editContributions(change: (current: ContributionSet) => ContributionSet): ContributionSet;
  log(level: "info" | "warn" | "error", message: string): void;
}

export interface CallContext {
  caller: Caller;
  pluginId?: string;
  pluginName?: string;
  /** Permissions the user approved (plugins only). */
  permissions?: readonly string[];
  surface?: PluginSurface;
  /** Runtime frame key ("<pluginId>" or "trial:<pluginId>"). */
  frameKey?: string;
  /**
   * Where assistant changes go: each chat writes into its own customization layer so the
   * user can switch it off, inspect it or remove it from Plugins → Created.
   */
  layer?: { id: string; name: string; chatId?: string };
}

// Params arrive validated against the method schema, so handlers read them loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = Record<string, any>;
type Handler = (params: Params, ctx: CallContext) => unknown;

// ── shared helpers ─────────────────────────────────────────────────────────

export const store = () => useAppStore.getState();

export function requireWorkspace() {
  const workspace = store().workspace;
  if (!workspace) throw new Error("No workspace is open.");
  return workspace;
}

export function findMeta(pageId: string): PageMeta | undefined {
  return store().pages.find((page) => page.id === pageId) ?? store().trash.find((page) => page.id === pageId);
}

export function requireMeta(pageId: string, what = "Page"): PageMeta {
  const meta = findMeta(pageId);
  if (!meta) throw new Error(`${what} "${pageId}" was not found. Use pages.list or search.query to find ids.`);
  return meta;
}

function titleOf(pageId: string): string {
  const state = store();
  return state.documents[pageId]?.title ?? findMeta(pageId)?.title ?? "";
}

export function displayTitle(pageId: string): string {
  return titleOf(pageId) || "Untitled";
}

function isDatabase(meta: PageMeta | undefined): boolean {
  return meta?.kind === "database";
}

function kindOfMeta(meta: PageMeta): PageInfo["kind"] {
  if (meta.kind === "database") return "database";
  if (meta.kind === "folder") return "folder";
  if (meta.kind === "custom") return "custom";
  if (meta.parentId && isDatabase(findMeta(meta.parentId))) return "row";
  return "page";
}

function toPageInfo(meta: PageMeta): PageInfo {
  const kind = kindOfMeta(meta);
  const info: PageInfo = {
    id: meta.id,
    title: titleOf(meta.id) || meta.title,
    icon: meta.icon ?? "",
    cover: meta.cover ?? "",
    kind,
    parentId: meta.parentId ?? "",
    createdAt: meta.createdAt ?? "",
    updatedAt: meta.updatedAt ?? "",
  };
  if (kind === "row") info.databaseId = meta.parentId;
  if (kind === "custom") {
    try {
      const type = (JSON.parse(meta.data || "{}") as { type?: unknown }).type;
      if (typeof type === "string") info.nodeType = type;
    } catch {
      // unreadable data: leave nodeType out
    }
  }
  if (meta.deletedAt) info.deleted = true;
  return info;
}

function pageInfoById(pageId: string): PageInfo {
  return toPageInfo(requireMeta(pageId));
}

export function activePageId(): string {
  const state = store();
  return state.activePageId && !isHomeTab(state.activePageId) ? state.activePageId : "";
}

function focusedPaneId(): string {
  const state = store();
  return state.focusedPaneId || paneList(state.layout)[0]?.id || "";
}

export function editorFor(pageId?: string): { pageId: string; handle: EditorHandle } {
  const id = pageId || activePageId();
  if (!id) throw new Error("No page is open. Open one with navigation.openPage first.");
  const handle = editorBridge.get(id);
  if (!handle) {
    const meta = findMeta(id);
    if (!meta) throw new Error(`Page "${id}" was not found.`);
    if (meta.kind !== "page") throw new Error(`"${displayTitle(id)}" is a ${meta.kind}, not an editable page.`);
    throw new Error(`"${displayTitle(id)}" is not open in an editor. Open it with navigation.openPage, or use pages.read / pages.write.`);
  }
  return { pageId: id, handle };
}

function need<T>(value: T | undefined, method: string): T {
  if (value === undefined) throw new Error(`${method} is not supported by this editor.`);
  return value;
}

/** Rewrites a page's document whether or not it is open in an editor. */
async function writeDocument(pageId: string, markdown: string, mode: "replace" | "append", previous = ""): Promise<void> {
  const meta = requireMeta(pageId);
  checkEmbeds(markdown, previous);
  if (meta.deletedAt) throw new Error(`"${displayTitle(pageId)}" is in the trash. Restore it first.`);
  if (meta.kind !== "page") throw new Error(`"${displayTitle(pageId)}" is a ${meta.kind}; only pages have a document.`);
  const handle = editorBridge.get(pageId);
  if (handle?.setMarkdown && handle.insertMarkdown) {
    if (mode === "replace") await handle.setMarkdown(markdown);
    else await handle.insertMarkdown(markdown, "end");
    return;
  }
  const state = store();
  const workspace = requireWorkspace();
  const doc = await state.ensurePageLoaded(pageId);
  if (!doc) throw new Error(`Could not load "${displayTitle(pageId)}".`);
  const next = mode === "replace" ? markdownToDocJson(markdown, doc.docJson) : appendMarkdown(doc.docJson, markdown);
  await api.savePage(workspace.id, pageId, next, doc.revision);
  await store().reloadPage(pageId);
}

type StoredBlock = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: StoredBlock[] };

function storedText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.map((item) => (item && typeof item === "object" ? String((item as { text?: string }).text ?? storedText((item as { content?: unknown }).content)) : "")).join("");
}

/**
 * Inserts a block into a page's stored document (for pages not open in an editor).
 * The anchor is a block id or text from a block; nested anchors insert beside them.
 */
export async function insertStoredBlock(pageId: string, block: StoredBlock, position: "start" | "end" | "before" | "after", anchor?: { blockId?: string; text?: string }): Promise<string> {
  const workspace = requireWorkspace();
  const doc = await store().ensurePageLoaded(pageId);
  if (!doc) throw new Error(`Could not load "${displayTitle(pageId)}".`);
  let blocks: StoredBlock[] = [];
  try {
    const parsed = JSON.parse(doc.docJson || "[]");
    blocks = Array.isArray(parsed) ? parsed : [];
  } catch {
    blocks = [];
  }
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : uid("blk");
  const added = { ...block, id };
  const isEmpty = (item: StoredBlock | undefined) => !!item && item.type === "paragraph" && !storedText(item.content).trim() && !(item.children ?? []).length;
  if (position === "start" || position === "end") {
    if (position === "start") blocks.unshift(added);
    else if (isEmpty(blocks[blocks.length - 1])) blocks.splice(blocks.length - 1, 1, added);
    else blocks.push(added);
  } else {
    const wanted = anchor?.text?.trim().toLowerCase();
    const find = (list: StoredBlock[]): boolean => {
      const index = list.findIndex((item) => (anchor?.blockId ? item.id === anchor.blockId : !!wanted && storedText(item.content).toLowerCase().includes(wanted)));
      if (index >= 0) {
        list.splice(position === "before" ? index : index + 1, 0, added);
        return true;
      }
      return list.some((item) => find(item.children ?? []));
    };
    if (!find(blocks)) throw new Error(anchor?.blockId ? `No block ${anchor.blockId} on "${displayTitle(pageId)}". Use editor.getBlocks or pages.read.` : `No block on "${displayTitle(pageId)}" contains "${anchor?.text ?? ""}".`);
  }
  // Content-less blocks need a paragraph after them for the caret.
  if (blocks[blocks.length - 1] === added) blocks.push({ type: "paragraph", content: [], children: [] });
  await api.savePage(workspace.id, pageId, JSON.stringify(blocks), doc.revision);
  await store().reloadPage(pageId);
  return id;
}

async function readDocument(pageId: string, format: "markdown" | "text"): Promise<string> {
  const handle = editorBridge.get(pageId);
  if (handle) {
    if (format === "text") return handle.getStats().text;
    if (handle.getMarkdown) return handle.getMarkdown();
  }
  const doc = await store().ensurePageLoaded(pageId);
  if (!doc) throw new Error(`Could not load "${displayTitle(pageId)}".`);
  return format === "text" ? docJsonToText(doc.docJson, displayTitle) : docJsonToMarkdown(doc.docJson, displayTitle);
}

/**
 * Marker lines (`<!-- database:ID -->`) must name a database that exists; ones already in
 * `previous` (the page's current Markdown) are kept as they are.
 */
export function checkEmbeds(markdown: string, previous = ""): void {
  const known = new Set(databaseMarkerIds(previous));
  for (const id of databaseMarkerIds(markdown)) {
    if (known.has(id)) continue;
    const meta = findMeta(id);
    if (!meta) throw new Error(`<!-- database:${id} --> names no database. Use databases.list for ids, or databases.embed to add one.`);
    if (meta.kind !== "database") throw new Error(`<!-- database:${id} --> points at "${displayTitle(id)}", a ${meta.kind}, not a database. Link pages with [[Title]] instead.`);
  }
}

/**
 * Block types Markdown round-trips safely; an edit that would rewrite anything else is refused.
 * Databases and custom blocks round-trip as marker lines (lib/markdownEmbeds).
 */
const MARKDOWN_BLOCKS = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "quote", "codeBlock", "table", "image", "divider", "database", "custom"]);

/**
 * Which blocks an edit touched: the longest runs of unchanged blocks at each end of the
 * page, and the new Markdown that goes between them. Exported for tests.
 */
export function splitChange(parts: string[], after: string, sep: string): { head: number; tail: number; middle: string } {
  let head = 0;
  let headEnd = 0;
  while (head < parts.length) {
    const run = parts.slice(0, head + 1).join(sep);
    if (after !== run && !after.startsWith(run + sep)) break;
    head += 1;
    headEnd = run.length;
  }
  let tail = 0;
  let tailStart = after.length;
  while (head + tail < parts.length) {
    const run = parts.slice(parts.length - tail - 1).join(sep);
    const start = after.length - run.length;
    if (!after.endsWith(run) || start < headEnd || (start > 0 && !after.slice(0, start).endsWith(sep) && start !== headEnd)) break;
    tail += 1;
    tailStart = start;
  }
  return { head, tail, middle: after.slice(headEnd, tailStart).trim() };
}

/**
 * Find-and-replace inside a page. With the page open, only the blocks the edits touch are
 * replaced (the rest keep their ids, and it is one undo step per changed run); closed pages
 * are rewritten through their Markdown.
 */
async function editDocument(pageId: string, edits: TextEdit[]): Promise<{ replaced: number; blocksChanged?: number }> {
  const meta = requireMeta(pageId);
  if (meta.deletedAt) throw new Error(`"${displayTitle(pageId)}" is in the trash. Restore it first.`);
  if (meta.kind !== "page") throw new Error(`"${displayTitle(pageId)}" is a ${meta.kind}; only pages have a document.`);
  const what = `"${displayTitle(pageId)}"`;
  const handle = editorBridge.get(pageId);
  if (handle?.getBlocks && handle.getMarkdown && handle.replaceBlocks && handle.removeBlocks && handle.insertMarkdown) {
    const blocks = handle.getBlocks();
    const parts = blocks.map((block) => handle.getMarkdown!([block.id]).trim());
    const SEP = "\n\n";
    const before = parts.join(SEP);
    const outcome = applyEdits(before, edits, what);
    const after = outcome.text;
    if (after === before) return { replaced: outcome.replaced, blocksChanged: 0 };
    checkEmbeds(after, before);
    const { head, tail, middle } = splitChange(parts, after, SEP);
    const changed = blocks.slice(head, blocks.length - tail);
    const unsafe = changed.find((block) => !MARKDOWN_BLOCKS.has(block.type));
    if (unsafe) throw new Error(`That edit would rewrite a ${unsafe.type} block, which Markdown can't hold. Use editor.updateBlock or blocks.setData for it.`);
    if (changed.length && middle) await handle.replaceBlocks(changed.map((block) => block.id), middle);
    else if (changed.length) await handle.removeBlocks(changed.map((block) => block.id));
    else if (middle) {
      if (head > 0) await handle.insertMarkdown(middle, "after", blocks[head - 1].id);
      else if (blocks.length) await handle.insertMarkdown(middle, "before", blocks[0].id);
      else await handle.insertMarkdown(middle, "end");
    }
    return { replaced: outcome.replaced, blocksChanged: changed.length };
  }
  const source = await readDocument(pageId, "markdown");
  const outcome = applyEdits(source, edits, what);
  if (outcome.text !== source) await writeDocument(pageId, outcome.text, "replace", source);
  return { replaced: outcome.replaced };
}

function childrenOf(parentId: string): PageMeta[] {
  return store()
    .pages.filter((page) => (page.parentId ?? "") === parentId)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export function wordsMatch(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.trim().toLowerCase());
}

// ── databases ──────────────────────────────────────────────────────────────

export function requireDatabase(databaseId: string): { meta: PageMeta; schema: DatabaseSchema } {
  const meta = requireMeta(databaseId, "Database");
  if (meta.kind !== "database") throw new Error(`"${displayTitle(databaseId)}" is not a database. Use databases.list to find databases.`);
  return { meta, schema: parseSchema(meta.data) };
}

export function propertyByName(schema: DatabaseSchema, name: string): Property | undefined {
  const key = name.trim().toLowerCase();
  return schema.properties.find((property) => property.name.toLowerCase() === key) ?? schema.properties.find((property) => property.id === name);
}

export function isTitleKey(schema: DatabaseSchema, name: string): boolean {
  const key = name.trim().toLowerCase();
  return key === "title" || key === schema.titleName.toLowerCase();
}

/** Rows with formula values filled in, plus the schema with each formula's result type. */
export function formulaRows(databaseId: string, schema: DatabaseSchema): FormulaResult {
  return withFormulas(rowsOf(store().pages, databaseId), schema);
}

export function schemaInfo(meta: PageMeta, schema: DatabaseSchema): DatabaseSchemaInfo {
  const hasFormulas = schema.properties.some((property) => property.type === "formula");
  const typed = hasFormulas ? formulaRows(meta.id, schema) : undefined;
  return {
    databaseId: meta.id,
    title: displayTitle(meta.id),
    titleName: schema.titleName,
    properties: schema.properties.map((property) => {
      const resultType = typed?.schema.properties.find((item) => item.id === property.id)?.resultType;
      const error = typed?.issues.find((issue) => issue.propertyId === property.id)?.message;
      return {
        id: property.id,
        name: property.name,
        type: property.type,
        ...(property.options ? { options: property.options.map((option) => ({ id: option.id, name: option.name, color: option.color })) } : {}),
        ...(property.format ? { format: property.format } : {}),
        ...(property.type === "formula" ? { formula: property.formula ?? "", ...(resultType ? { resultType } : {}), ...(error ? { error } : {}) } : {}),
        ...(property.dateFormat ? { dateFormat: property.dateFormat } : {}),
      };
    }),
    views: schema.views.map((view) => ({ id: view.id, name: view.name, type: view.type })),
  };
}

function optionName(property: Property, id: unknown): string | null {
  return property.options?.find((option) => option.id === id)?.name ?? null;
}

/** A row's values keyed by property name, with options resolved to names. */
function readableValues(row: DatabaseRow, schema: DatabaseSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const property of schema.properties) {
    const raw = row.values[property.id];
    switch (property.type) {
      case "createdTime":
        out[property.name] = row.meta.createdAt ?? null;
        break;
      case "lastEdited":
        out[property.name] = row.meta.updatedAt ?? null;
        break;
      case "select":
      case "status":
        out[property.name] = optionName(property, raw);
        break;
      case "multiSelect":
        out[property.name] = Array.isArray(raw) ? raw.map((id) => optionName(property, id)).filter(Boolean) : [];
        break;
      default:
        out[property.name] = raw ?? null;
    }
  }
  return out;
}

/** A row for callers. Pass `errors` (formulaRows().rowErrors.get(row.id)) to report formula failures. */
export function rowInfo(row: DatabaseRow, schema: DatabaseSchema, errors?: Record<string, string>): DatabaseRowInfo {
  const info: DatabaseRowInfo = { id: row.id, title: displayTitle(row.id), values: readableValues(row, schema), updatedAt: row.meta.updatedAt ?? "" };
  if (errors && Object.keys(errors).length) {
    info.errors = Object.fromEntries(Object.entries(errors).map(([id, message]) => [schema.properties.find((property) => property.id === id)?.name ?? id, message]));
  }
  return info;
}

/** Formula rows → row infos (formula values and errors included). */
export function rowInfos(result: FormulaResult, rows: DatabaseRow[] = result.rows): DatabaseRowInfo[] {
  return rows.map((row) => rowInfo(row, result.schema, result.rowErrors.get(row.id)));
}

function statusGroupFor(index: number, total: number): SelectOption["group"] {
  if (index === 0) return "todo";
  if (index === total - 1 && total > 1) return "complete";
  return "inProgress";
}

export function buildProperty(name: string, type: PropertyType, options?: string[]): Property {
  const property: Property = { id: uid("prop"), name, type };
  if (hasOptions(type)) {
    if (type === "status" && !options?.length) {
      property.options = defaultStatusOptions();
    } else {
      const names = Array.from(new Set((options ?? []).map((option) => option.trim()).filter(Boolean)));
      property.options = names.map((option, index) => ({
        id: uid("opt"),
        name: option,
        color: OPTION_COLORS[(index + 1) % OPTION_COLORS.length],
        ...(type === "status" ? { group: statusGroupFor(index, names.length) } : {}),
      }));
    }
  }
  return property;
}

/** The friendly property settings beyond name/type/options. */
export interface PropertyExtras {
  formula?: string;
  format?: string;
  dateFormat?: string;
}

/**
 * Checks a formula against the schema: it must compile, refer only to existing properties
 * (by name, the title included) and not loop back to itself. Returns the trimmed source.
 */
export function checkFormula(schema: DatabaseSchema, source: string, self: Property): string {
  const text = source.trim();
  if (!text) throw new Error(`Formula "${self.name}" is empty. Example: {Price} * {Quantity} (see databases.formulaFunctions).`);
  const compiled = compileFormula(text);
  if (!compiled.ok) {
    const { message, start, end } = compiled.error;
    const stop = Math.max(end, start + 1);
    const snippet = text.slice(start, stop);
    const where = snippet ? ` at "${snippet}" (characters ${start}–${stop})` : " at the end";
    throw new Error(`Formula error in "${self.name}": ${message}${where}. Formula: ${text}`);
  }
  const named = new Map<string, Property>();
  named.set(schema.titleName.trim().toLowerCase(), { id: TITLE_ID, name: schema.titleName, type: "text" });
  for (const property of [...schema.properties.filter((item) => item.id !== self.id), self]) {
    const key = property.name.trim().toLowerCase();
    if (!named.has(key)) named.set(key, property);
  }
  const target = (name: string) => named.get(name.trim().toLowerCase());
  for (const ref of compiled.refs) {
    const property = target(ref);
    if (!property) {
      const names = [schema.titleName, ...schema.properties.map((item) => item.name)].map((name) => `"${name}"`).join(", ");
      throw new Error(`Formula "${self.name}" refers to unknown property "${ref}". Properties: ${names}.`);
    }
    if (property.id === self.id) throw new Error(`Formula "${self.name}" cannot refer to itself.`);
  }
  // Formulas may use other formulas, but never in a loop.
  const refsOf = (property: Property): string[] => {
    if (property.id === self.id) return compiled.refs;
    if (property.type !== "formula") return [];
    const other = compileFormula(property.formula ?? "");
    return other.ok ? other.refs : [];
  };
  const visit = (property: Property, path: string[]): void => {
    for (const ref of refsOf(property)) {
      const next = target(ref);
      if (!next || next.type !== "formula") continue;
      if (next.id === self.id) throw new Error(`Formula "${self.name}" would loop: ${[...path, next.name].join(" → ")}.`);
      if (!path.includes(next.name)) visit(next, [...path, next.name]);
    }
  };
  visit(self, [self.name]);
  return text;
}

const NUMBER_FORMAT_IDS = ["number", "commas", "percent", "dollar", "euro", "pound", "yen"];
const DATE_FORMAT_IDS = ["relative", "short", "long", "iso"];

/** Applies formula / number format / date format settings to a property (validated). */
export function applyPropertyExtras(schema: DatabaseSchema, property: Property, extras: PropertyExtras): void {
  if (extras.format !== undefined) {
    if (property.type !== "number" && property.type !== "formula") throw new Error(`format applies to number and formula properties, not "${property.name}" (${property.type}).`);
    if (extras.format && !NUMBER_FORMAT_IDS.includes(extras.format)) throw new Error(`Unknown format "${extras.format}". Use one of: ${NUMBER_FORMAT_IDS.join(", ")}.`);
    if (extras.format) property.format = extras.format as Property["format"];
    else delete property.format;
  }
  if (extras.dateFormat !== undefined) {
    if (property.type !== "formula") throw new Error(`dateFormat applies to formula properties (date results), not "${property.name}" (${property.type}).`);
    if (extras.dateFormat && !DATE_FORMAT_IDS.includes(extras.dateFormat)) throw new Error(`Unknown dateFormat "${extras.dateFormat}". Use one of: ${DATE_FORMAT_IDS.join(", ")}.`);
    if (extras.dateFormat) property.dateFormat = extras.dateFormat as Property["dateFormat"];
    else delete property.dateFormat;
  }
  if (property.type === "formula") {
    if (extras.formula !== undefined) property.formula = checkFormula(schema, extras.formula, property);
    else if (!property.formula) throw new Error(`Formula property "${property.name}" needs a formula, e.g. {Price} * {Quantity}.`);
  } else if (extras.formula !== undefined) {
    throw new Error(`formula needs type "formula" ("${property.name}" is ${property.type}).`);
  }
}

export function ensureOption(property: Property, name: string): { id: string; created: boolean } {
  const key = name.trim();
  if (!key) throw new Error(`Empty option for "${property.name}".`);
  const options = property.options ?? (property.options = []);
  const found = options.find((option) => option.name.toLowerCase() === key.toLowerCase() || option.id === key);
  if (found) return { id: found.id, created: false };
  const option: SelectOption = { id: uid("opt"), name: key, color: nextOptionColor(options) };
  if (property.type === "status") option.group = "todo";
  options.push(option);
  return { id: option.id, created: true };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function checkDate(value: string, property: Property): string {
  const text = value.trim();
  if (!DATE_RE.test(text)) throw new Error(`"${property.name}" needs a date like 2026-03-14, got "${value}".`);
  return text;
}

/** Converts a friendly value into the stored form. Returns `undefined` to clear. */
export function convertValue(property: Property, value: unknown): { value: unknown; schemaChanged: boolean } {
  if (value === null || value === undefined || value === "") return { value: undefined, schemaChanged: false };
  if (property.type === "formula") throw new Error(`"${property.name}" is a formula (${property.formula || "empty"}); its value is computed and cannot be set. Change the formula with databases.updateProperty.`);
  if (isComputed(property.type)) throw new Error(`"${property.name}" is computed automatically and cannot be set.`);
  switch (property.type) {
    case "number": {
      const number = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
      if (!Number.isFinite(number)) throw new Error(`"${property.name}" needs a number, got ${JSON.stringify(value)}.`);
      return { value: number, schemaChanged: false };
    }
    case "checkbox": {
      if (typeof value === "boolean") return { value, schemaChanged: false };
      const text = String(value).trim().toLowerCase();
      if (["true", "yes", "1", "done", "x"].includes(text)) return { value: true, schemaChanged: false };
      if (["false", "no", "0", ""].includes(text)) return { value: false, schemaChanged: false };
      throw new Error(`"${property.name}" needs true or false.`);
    }
    case "date": {
      if (typeof value === "string") return { value: { start: checkDate(value, property) }, schemaChanged: false };
      if (typeof value === "object" && value && "start" in value) {
        const range = value as { start: unknown; end?: unknown };
        const start = checkDate(String(range.start ?? ""), property);
        const end = range.end ? checkDate(String(range.end), property) : undefined;
        return { value: end ? { start, end } : { start }, schemaChanged: false };
      }
      throw new Error(`"${property.name}" needs a date string or { start, end }.`);
    }
    case "select":
    case "status": {
      const { id, created } = ensureOption(property, String(Array.isArray(value) ? value[0] : value));
      return { value: id, schemaChanged: created };
    }
    case "multiSelect": {
      const names = Array.isArray(value) ? value.map(String) : String(value).split(",");
      let changed = false;
      const ids: string[] = [];
      for (const name of names) {
        if (!name.trim()) continue;
        const { id, created } = ensureOption(property, name);
        changed ||= created;
        if (!ids.includes(id)) ids.push(id);
      }
      return { value: ids.length ? ids : undefined, schemaChanged: changed };
    }
    default:
      return { value: typeof value === "string" ? value : JSON.stringify(value), schemaChanged: false };
  }
}

/** Applies name-keyed values onto stored values; returns whether options were added. */
export function applyValues(schema: DatabaseSchema, target: RowValues, values: Record<string, unknown> | undefined): { schemaChanged: boolean; title?: string } {
  let schemaChanged = false;
  let title: string | undefined;
  for (const [name, value] of Object.entries(values ?? {})) {
    if (isTitleKey(schema, name) && !propertyByName(schema, name)) {
      title = value === null || value === undefined ? "" : String(value);
      continue;
    }
    const property = propertyByName(schema, name);
    if (!property) {
      const known = schema.properties.map((item) => `"${item.name}"`).join(", ") || "none";
      throw new Error(`Unknown property "${name}". Properties: ${known}. Add one with databases.addProperty.`);
    }
    const converted = convertValue(property, value);
    schemaChanged ||= converted.schemaChanged;
    if (converted.value === undefined) delete target[property.id];
    else target[property.id] = converted.value;
  }
  return { schemaChanged, title };
}

function matchesWhere(info: DatabaseRowInfo, schema: DatabaseSchema, where: Record<string, unknown> | undefined): boolean {
  for (const [name, expected] of Object.entries(where ?? {})) {
    let actual: unknown;
    if (isTitleKey(schema, name) && !propertyByName(schema, name)) actual = info.title;
    else {
      const property = propertyByName(schema, name);
      if (!property) throw new Error(`Unknown property "${name}" in where.`);
      actual = info.values[property.name];
    }
    const want = expected === null || expected === undefined ? "" : String(expected).toLowerCase();
    if (Array.isArray(actual)) {
      if (want === "" ? actual.length > 0 : !actual.some((item) => String(item).toLowerCase() === want)) return false;
    } else if (actual && typeof actual === "object" && "start" in actual) {
      if (!String((actual as { start: unknown }).start).startsWith(want)) return false;
    } else {
      const text = actual === null || actual === undefined ? "" : String(actual).toLowerCase();
      if (text !== want) return false;
    }
  }
  return true;
}

function cellMarkdown(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object" && "start" in value) {
    const range = value as { start: string; end?: string };
    return range.end ? `${range.start} → ${range.end}` : range.start;
  }
  if (typeof value === "boolean") return value ? "✓" : "";
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function databaseMarkdown(meta: PageMeta, schema: DatabaseSchema): string {
  const rows = rowInfos(formulaRows(meta.id, schema));
  const head = [schema.titleName, ...schema.properties.map((property) => property.name)];
  const lines = [
    `| ${head.map(cellMarkdown).join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${[row.title, ...schema.properties.map((property) => row.values[property.name])].map(cellMarkdown).join(" | ")} |`),
  ];
  return `${lines.join("\n")}\n\n${rows.length} row${rows.length === 1 ? "" : "s"}.`;
}

// ── layout / preferences / customizations ─────────────────────────────────

function treeOf(node: LayoutNode): unknown {
  if (node.type === "pane") return { type: "pane", id: node.id, tabs: node.tabs, activeTabId: node.activeTabId };
  return { type: "split", id: node.id, dir: node.dir, sizes: node.sizes, children: node.children.map(treeOf) };
}

function layoutInfo(): LayoutInfo {
  const state = store();
  const focused = focusedPaneId();
  return {
    panes: paneList(state.layout).map((pane) => ({
      id: pane.id,
      tabs: pane.tabs,
      activeTabId: pane.activeTabId,
      focused: pane.id === focused,
      maximized: pane.id === state.maximizedPaneId,
    })),
    tree: treeOf(state.layout),
    leftOpen: state.settings.leftOpen,
    rightOpen: state.settings.rightOpen,
    railOpen: state.settings.railOpen,
    leftWidth: state.settings.leftWidth,
    rightWidth: state.settings.rightWidth,
    leftTab: state.leftTab,
    rightTab: state.rightTab,
  };
}

function requirePane(paneId: string | undefined): string {
  const id = paneId || focusedPaneId();
  if (!paneList(store().layout).some((pane) => pane.id === id)) throw new Error(`Pane "${id}" was not found. Use layout.get to list panes.`);
  return id;
}

const PREFERENCE_KEYS = ["theme", "editorFont", "fontSize", "lineHeight", "pageWidth", "fullWidth", "autosaveDelay", "spellcheck", "reduceMotion", "showStats"] as const;

function preferences(): Preferences {
  const settings = store().settings as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of PREFERENCE_KEYS) out[key] = settings[key];
  return out as unknown as Preferences;
}

export async function editCustomizations(change: (draft: Customizations) => void): Promise<Customizations> {
  if (!customizations.isLoaded()) await customizations.load();
  return customizations.update(change);
}

export function tokenKey(name: string): string {
  const key = name.trim().replace(/^--/, "");
  if (!TOKEN_NAMES.includes(key)) {
    throw new Error(`Unknown token "${name}". Use appearance.listTokens to see the ${TOKEN_NAMES.length} tokens.`);
  }
  return key;
}

export function applyTokens(target: Record<string, string>, tokens: Record<string, unknown> | undefined) {
  for (const [name, raw] of Object.entries(tokens ?? {})) {
    const key = tokenKey(name);
    if (raw === null || raw === undefined || raw === "") {
      delete target[key];
      continue;
    }
    const value = String(raw).trim();
    const problem = checkTokenValue(value);
    if (problem) throw new Error(`--${key}: ${problem}`);
    target[key] = value;
  }
}

export const SNIPPET_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

// ── plugins ────────────────────────────────────────────────────────────────

export function pluginInfo(info: { manifest: Manifest; enabled: boolean; source: string; problem?: string }): PluginInfo {
  return {
    id: info.manifest.id,
    name: info.manifest.name,
    version: info.manifest.version,
    author: info.manifest.author ?? "",
    description: info.manifest.description ?? "",
    enabled: info.enabled,
    source: info.source,
    permissions: info.manifest.permissions ?? [],
    ...(info.problem ? { problem: info.problem } : {}),
  };
}

// ── handlers ───────────────────────────────────────────────────────────────

export const HANDLERS: Record<string, Handler> = {
  "app.info": (): AppInfo => {
    const state = store();
    return {
      appName: state.bootstrap?.appName ?? "Noteral",
      appVersion: state.bootstrap?.version ?? "",
      sdkVersion: SDK_VERSION,
      platform: state.bootstrap?.platform ?? "",
      theme: state.resolvedTheme,
      workspaceId: state.workspace?.id ?? null,
    };
  },

  // editor
  "editor.getActive": (): ActivePage | null => {
    const id = activePageId();
    const meta = id ? findMeta(id) : undefined;
    if (!meta) return null;
    return { id, title: displayTitle(id), kind: kindOfMeta(meta), paneId: focusedPaneId(), editable: editorBridge.has(id) };
  },
  "editor.getMarkdown": (p) => {
    const { handle } = editorFor(p.pageId);
    return need(handle.getMarkdown, "editor.getMarkdown")(p.blockIds?.length ? p.blockIds : undefined);
  },
  "editor.getBlocks": (p) => need(editorFor(p.pageId).handle.getBlocks, "editor.getBlocks")(),
  "editor.getSelection": (p) => need(editorFor(p.pageId).handle.getSelection, "editor.getSelection")(),
  "editor.snapshot": (): EditorSnapshot | null => {
    const id = activePageId();
    const handle = id ? editorBridge.get(id) : undefined;
    if (!handle) return null;
    const stats = handle.getStats();
    return { pageId: id, title: displayTitle(id), ...stats };
  },
  "editor.insertMarkdown": async (p) => {
    const { handle } = editorFor(p.pageId);
    const position = p.position ?? "end";
    if ((position === "before" || position === "after") && !p.blockId) throw new Error(`position "${position}" needs blockId.`);
    checkEmbeds(p.markdown);
    const blockIds = await need(handle.insertMarkdown, "editor.insertMarkdown")(p.markdown, position, p.blockId);
    return { blockIds };
  },
  "editor.replaceBlocks": async (p) => {
    checkEmbeds(p.markdown);
    const blockIds = await need(editorFor(p.pageId).handle.replaceBlocks, "editor.replaceBlocks")(p.blockIds, p.markdown);
    return { blockIds };
  },
  "editor.updateBlock": async (p) => {
    await need(editorFor(p.pageId).handle.updateBlock, "editor.updateBlock")(p.blockId, { type: p.type, text: p.text, props: p.props });
  },
  "editor.removeBlocks": async (p) => {
    await need(editorFor(p.pageId).handle.removeBlocks, "editor.removeBlocks")(p.blockIds);
  },
  "editor.setMarkdown": async (p) => {
    checkEmbeds(p.markdown);
    await need(editorFor(p.pageId).handle.setMarkdown, "editor.setMarkdown")(p.markdown);
  },
  "editor.insertBlocks": async (p) => {
    await editorFor().handle.insertBlocks(p.blocks);
  },
  "editor.undo": (p) => need(editorFor(p.pageId).handle.undo, "editor.undo")(),
  "editor.redo": (p) => need(editorFor(p.pageId).handle.redo, "editor.redo")(),
  "editor.scrollToBlock": (p) => {
    editorFor(p.pageId).handle.scrollToBlock(p.blockId);
  },
  "editor.openFind": (p) => {
    need(editorFor().handle.openFind, "editor.openFind")(Boolean(p.replace));
  },

  // pages
  "pages.list": (p) => {
    let items = store().pages.filter((page) => !page.deletedAt);
    if (!p.includeRows) items = items.filter((page) => kindOfMeta(page) !== "row");
    if (p.parentId !== undefined) items = items.filter((page) => (page.parentId ?? "") === p.parentId);
    if (p.kind) items = items.filter((page) => page.kind === p.kind);
    if (p.query) items = items.filter((page) => wordsMatch(titleOf(page.id) || page.title, p.query));
    return items.slice(0, p.limit ?? 500).map(toPageInfo);
  },
  "pages.get": (p) => pageInfoById(p.pageId),
  "pages.read": async (p): Promise<PageContent> => {
    const meta = requireMeta(p.pageId);
    const format = p.format === "text" ? "text" : "markdown";
    let content = "";
    if (meta.kind === "database") content = databaseMarkdown(meta, parseSchema(meta.data));
    else if (meta.kind === "page") content = await readDocument(meta.id, format);
    const children = childrenOf(meta.id).filter((child) => meta.kind === "database" || kindOfMeta(child) !== "row");
    return { page: toPageInfo(meta), format, content, children: children.slice(0, 500).map(toPageInfo) };
  },
  "pages.path": (p) => {
    const path: PageInfo[] = [];
    const seen = new Set<string>();
    let meta: PageMeta | undefined = requireMeta(p.pageId);
    while (meta && !seen.has(meta.id)) {
      seen.add(meta.id);
      path.unshift(toPageInfo(meta));
      meta = meta.parentId ? findMeta(meta.parentId) : undefined;
    }
    return path;
  },
  "pages.favorites": () =>
    store()
      .favorites.map((id) => findMeta(id))
      .filter((meta): meta is PageMeta => Boolean(meta && !meta.deletedAt))
      .map(toPageInfo),
  "pages.recent": () => store().recent.map((meta) => toPageInfo(findMeta(meta.id) ?? meta)),
  "pages.backlinks": async (p) => {
    const workspace = requireWorkspace();
    requireMeta(p.pageId);
    const result = (await api.getBacklinks(workspace.id, p.pageId)) as unknown;
    const items = Array.isArray(result) ? (result as { id?: string; pageId?: string }[]) : [];
    return items
      .map((item) => findMeta(item.id ?? item.pageId ?? ""))
      .filter((meta): meta is PageMeta => Boolean(meta))
      .map(toPageInfo);
  },
  "pages.trash": () => store().trash.map(toPageInfo),
  "pages.create": async (p) => {
    requireWorkspace();
    const parentId = p.parentId ?? "";
    if (parentId) {
      const parent = requireMeta(parentId, "Parent");
      if (parent.kind === "database") throw new Error("Use databases.addRow to add a row to a database.");
    }
    const kind = p.kind === "folder" ? "folder" : "page";
    const meta = await store().createItem(kind, parentId, { open: false, title: p.title ?? "" });
    if (!meta) throw new Error("The page could not be created.");
    if (kind === "page" && p.markdown) await writeDocument(meta.id, p.markdown, "replace");
    if (p.icon) await store().setPageAppearance(meta.id, p.icon, "");
    if (kind === "page" && p.open !== false) await store().selectPage(meta.id);
    return pageInfoById(meta.id);
  },
  "pages.write": async (p) => {
    await writeDocument(p.pageId, p.markdown, "replace");
  },
  "pages.edit": async (p) => editDocument(p.pageId || activePageId(), p.edits),
  "pages.append": async (p) => {
    await writeDocument(p.pageId, p.markdown, "append");
  },
  "pages.rename": async (p) => {
    requireMeta(p.pageId);
    await store().renamePage(p.pageId, p.title);
  },
  "pages.setIcon": async (p) => {
    const meta = requireMeta(p.pageId);
    await store().setPageAppearance(meta.id, p.icon, meta.cover ?? "");
  },
  "pages.setCover": async (p) => {
    const meta = requireMeta(p.pageId);
    await store().setPageAppearance(meta.id, meta.icon ?? "", p.cover);
  },
  "pages.move": async (p) => {
    const meta = requireMeta(p.pageId);
    if (p.parentId) {
      const parent = requireMeta(p.parentId, "Parent");
      if (parent.kind === "database" && meta.kind !== "page") throw new Error("Only pages can become database rows.");
      let cursor: PageMeta | undefined = parent;
      while (cursor) {
        if (cursor.id === meta.id) throw new Error("A page cannot be moved inside itself.");
        cursor = cursor.parentId ? findMeta(cursor.parentId) : undefined;
      }
    }
    await store().movePage(meta.id, p.parentId, p.beforeId ?? "");
  },
  "pages.duplicate": async (p) => {
    requireMeta(p.pageId);
    await store().duplicatePage(p.pageId, { open: p.open !== false });
  },
  "pages.moveToTrash": async (p) => {
    requireMeta(p.pageId);
    await store().trashPage(p.pageId, { quiet: true });
  },
  "pages.restore": async (p) => {
    requireMeta(p.pageId);
    await store().restorePage(p.pageId);
  },
  "pages.setFavorite": async (p) => {
    requireMeta(p.pageId);
    if (store().favorites.includes(p.pageId) !== Boolean(p.favorite)) await store().toggleFavorite(p.pageId);
  },

  // databases
  "databases.list": (): DatabaseInfo[] =>
    store()
      .pages.filter((page) => page.kind === "database" && !page.deletedAt)
      .map((meta) => {
        const schema = parseSchema(meta.data);
        return {
          id: meta.id,
          title: displayTitle(meta.id),
          parentId: meta.parentId ?? "",
          rowCount: rowsOf(store().pages, meta.id).length,
          properties: schema.properties.map((property) => property.name),
        };
      }),
  "databases.getSchema": (p) => {
    const { meta, schema } = requireDatabase(p.databaseId);
    return schemaInfo(meta, schema);
  },
  "databases.queryRows": (p) => {
    const { schema } = requireDatabase(p.databaseId);
    return rowInfos(formulaRows(p.databaseId, schema))
      .filter((row) => matchesWhere(row, schema, p.where))
      .slice(0, p.limit ?? 200);
  },
  "databases.addProperty": async (p) => {
    const { meta, schema } = requireDatabase(p.databaseId);
    const property = buildProperty(uniquePropertyName(schema, p.name.trim() || "Property"), p.type, p.options);
    applyPropertyExtras(schema, property, p);
    schema.properties.push(property);
    await store().setPageData(meta.id, serializeSchema(schema));
    return { propertyId: property.id };
  },
  "databases.addRow": async (p) => {
    const { meta, schema } = requireDatabase(p.databaseId);
    const values: RowValues = {};
    const applied = applyValues(schema, values, p.values);
    if (applied.schemaChanged) await store().setPageData(meta.id, serializeSchema(schema));
    const title = p.title ?? applied.title ?? "";
    const row = await store().createItem("page", meta.id, { open: false, title, data: serializeRowValues(values) });
    if (!row) throw new Error("The row could not be created.");
    return { rowId: row.id };
  },
  "databases.addRows": async (p) => {
    const { meta, schema } = requireDatabase(p.databaseId);
    const input = (p.rows ?? []) as { title?: string; values?: Record<string, unknown> }[];
    if (!input.length) throw new Error("rows is empty.");
    let schemaChanged = false;
    const items = input.map((row, index) => {
      const values: RowValues = {};
      try {
        const applied = applyValues(schema, values, row.values);
        schemaChanged ||= applied.schemaChanged;
        return { title: row.title ?? applied.title ?? "", data: serializeRowValues(values) };
      } catch (error) {
        throw new Error(`Row ${index + 1}: ${errorMessage(error)}`);
      }
    });
    // New select options must exist before the rows that use them.
    if (schemaChanged) await store().setPageData(meta.id, serializeSchema(schema));
    const rows = await store().createItems("page", meta.id, items);
    return { rowIds: rows.map((row) => row.id), count: rows.length };
  },
  "databases.updateRows": async (p) => {
    const updates = (p.updates ?? []) as { rowId: string; title?: string; values?: Record<string, unknown> }[];
    if (!updates.length) throw new Error("updates is empty.");
    // One schema per database, shared by its rows, so option creation is saved once.
    const schemas = new Map<string, { schema: DatabaseSchema; changed: boolean }>();
    const plans = updates.map((update, index) => {
      const row = requireMeta(update.rowId, `Row ${index + 1}`);
      const database = row.parentId ? findMeta(row.parentId) : undefined;
      if (!database || database.kind !== "database") throw new Error(`Row ${index + 1}: "${displayTitle(row.id)}" is not a database row.`);
      let entry = schemas.get(database.id);
      if (!entry) schemas.set(database.id, (entry = { schema: parseSchema(database.data), changed: false }));
      const values = parseRowValues(row.data);
      let title = update.title;
      if (update.values) {
        try {
          const applied = applyValues(entry.schema, values, update.values);
          entry.changed ||= applied.schemaChanged;
          title ??= applied.title;
        } catch (error) {
          throw new Error(`Row ${index + 1}: ${errorMessage(error)}`);
        }
      }
      return { row, values, title, hasValues: Boolean(update.values) };
    });
    for (const [databaseId, entry] of schemas) if (entry.changed) await store().setPageData(databaseId, serializeSchema(entry.schema));
    await Promise.all(
      plans.map(async (plan) => {
        if (plan.hasValues) await store().setPageData(plan.row.id, serializeRowValues(plan.values));
        if (plan.title !== undefined && plan.title !== plan.row.title) await store().renamePage(plan.row.id, plan.title);
      }),
    );
    return { count: plans.length };
  },
  "databases.updateRow": async (p) => {
    const row = requireMeta(p.rowId, "Row");
    const database = row.parentId ? findMeta(row.parentId) : undefined;
    if (!database || database.kind !== "database") throw new Error(`"${displayTitle(row.id)}" is not a database row.`);
    const schema = parseSchema(database.data);
    const values = parseRowValues(row.data);
    const applied = applyValues(schema, values, p.values);
    if (applied.schemaChanged) await store().setPageData(database.id, serializeSchema(schema));
    if (p.values) await store().setPageData(row.id, serializeRowValues(values));
    const title = p.title ?? applied.title;
    if (title !== undefined) await store().renamePage(row.id, title);
  },

  // workspaces
  "workspaces.list": (): WorkspaceInfo[] => {
    const state = store();
    return state.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      pageCount: workspace.pageCount,
      current: workspace.id === state.workspace?.id,
    }));
  },
  "workspaces.current": (): WorkspaceInfo | null => {
    const workspace = store().workspace;
    if (!workspace) return null;
    return { id: workspace.id, name: workspace.name, pageCount: store().pages.length, current: true };
  },
  "workspaces.open": async (p) => {
    if (!store().workspaces.some((workspace) => workspace.id === p.workspaceId)) throw new Error(`Workspace "${p.workspaceId}" was not found.`);
    await store().openWorkspace(p.workspaceId);
  },
  "workspaces.create": async (p) => {
    await store().createWorkspace(p.name);
  },
  "workspaces.rename": async (p) => {
    if (!store().workspaces.some((workspace) => workspace.id === p.workspaceId)) throw new Error(`Workspace "${p.workspaceId}" was not found.`);
    await store().renameWorkspace(p.workspaceId, p.name);
  },

  // navigation & tabs
  "navigation.openPage": async (p) => {
    const meta = requireMeta(p.pageId);
    if (meta.deletedAt) throw new Error(`"${displayTitle(meta.id)}" is in the trash. Restore it first.`);
    await store().selectPage(meta.id);
  },
  "navigation.openHome": () => {
    store().openHomeTab();
  },
  "navigation.back": () => {
    store().goBack();
  },
  "navigation.forward": () => {
    store().goForward();
  },
  "tabs.list": (): TabInfo[] =>
    paneList(store().layout).flatMap((pane) =>
      pane.tabs.map((tabId) => ({
        id: tabId,
        title: isHomeTab(tabId) ? "Home" : displayTitle(tabId),
        kind: isHomeTab(tabId) ? ("home" as const) : ("page" as const),
        paneId: pane.id,
        active: pane.activeTabId === tabId,
      })),
    ),
  "tabs.close": async (p) => {
    if (!paneList(store().layout).some((pane) => pane.tabs.includes(p.tabId))) throw new Error(`Tab "${p.tabId}" is not open. Use tabs.list.`);
    await store().closeTab(p.tabId);
  },

  // layout
  "layout.get": () => layoutInfo(),
  "layout.split": (p) => {
    store().splitPane(requirePane(p.paneId), p.side);
  },
  "layout.closePane": (p) => {
    store().closePane(requirePane(p.paneId));
  },
  "layout.toggleMaximize": (p) => {
    store().toggleMaximize(requirePane(p.paneId));
  },
  "layout.setPanels": (p) => {
    const state = store();
    const patch: Record<string, unknown> = {};
    for (const key of ["leftOpen", "rightOpen", "railOpen", "leftWidth", "rightWidth"] as const) {
      if (p[key] !== undefined) patch[key] = p[key];
    }
    if (p.rightTab && p.rightOpen === undefined) patch.rightOpen = true;
    if (p.leftTab && p.leftOpen === undefined) patch.leftOpen = true;
    if (Object.keys(patch).length) state.updateSettings(patch);
    if (p.leftTab) state.setLeftTab(p.leftTab);
    if (p.rightTab) state.setRightTab(p.rightTab);
  },
  "layout.openOverlay": (p) => {
    store().setOverlay(p.overlay === "none" ? null : p.overlay);
  },

  // search
  "search.query": async (p): Promise<SearchHitInfo[]> => {
    const workspace = requireWorkspace();
    const hits = await api.search(workspace.id, p.query, p.limit ?? 20);
    return (hits ?? []).map((hit) => ({ pageId: hit.pageId, title: hit.title, snippet: hit.snippet, updatedAt: hit.updatedAt }));
  },

  // assets (plugins)
  "assets.pickImage": async () => {
    const state = store();
    const pageId = activePageId();
    if (!state.workspace || !pageId) throw new Error("Open a page before attaching a file.");
    const asset = await api.importAsset(state.workspace.id, pageId, true);
    return asset?.url ?? null;
  },
  "assets.pickFile": async () => {
    const state = store();
    const pageId = activePageId();
    if (!state.workspace || !pageId) throw new Error("Open a page before attaching a file.");
    const asset = await api.importAsset(state.workspace.id, pageId, false);
    return asset?.url ?? null;
  },

  // plugin settings
  "settings.get": async (_p, ctx) => {
    if (!ctx.pluginId) throw new Error("settings.* is only available to plugins.");
    return ((await api.getPluginSettings(ctx.pluginId)) ?? {}) as Record<string, unknown>;
  },
  "settings.set": async (p, ctx) => {
    if (!ctx.pluginId) throw new Error("settings.* is only available to plugins.");
    return saveOptions(ctx.pluginId, p.patch as Record<string, unknown>);
  },

  // preferences
  "preferences.get": () => preferences(),
  "preferences.update": (p) => {
    const state = store();
    const { theme, ...rest } = p;
    if (theme) state.setTheme(theme);
    const patch: Record<string, unknown> = {};
    for (const key of PREFERENCE_KEYS) if (key !== "theme" && rest[key] !== undefined) patch[key] = rest[key];
    if (Object.keys(patch).length) state.updateSettings(patch);
    return preferences();
  },

  // appearance
  "appearance.get": async () => {
    if (!customizations.isLoaded()) await customizations.load();
    return customizations.get();
  },
  "appearance.listTokens": () => tokenInfo(),
  "appearance.listComponents": () => COMPONENTS,

  // commands
  "commands.list": (p): CommandInfo[] =>
    commandRegistry
      .getSnapshot()
      .filter((command) => !p.query || wordsMatch(`${command.title} ${command.category} ${command.id} ${command.keywords ?? ""}`, p.query))
      .map((command) => ({
        id: command.id,
        title: command.title,
        category: command.category,
        ...(command.description ? { description: command.description } : {}),
        ...(command.shortcut ? { shortcut: command.shortcut } : {}),
      })),
  "commands.execute": async (p, ctx) => {
    const command = commandRegistry.get(p.id);
    if (!command) throw new Error(`No command "${p.id}". Use commands.list.`);
    if (ctx.pluginId && command.id.startsWith(`plugin:${ctx.pluginId}:`)) throw new Error("A plugin cannot run its own commands through commands.execute.");
    await command.run();
  },

  // ui
  "ui.notify": (p, ctx) => {
    const kind = p.kind === "success" || p.kind === "error" ? p.kind : "info";
    const prefix = ctx.caller === "plugin" && ctx.pluginName ? `${ctx.pluginName}: ` : "";
    store().notify(`${prefix}${p.message}`, kind);
  },
  "ui.confirm": (p, ctx) =>
    dialogs.confirm({ title: p.title, message: p.message, confirmLabel: p.confirmLabel, danger: p.danger, source: ctx.pluginName }),
  "ui.prompt": (p, ctx) =>
    dialogs.prompt({ title: p.title, message: p.message, placeholder: p.placeholder, value: p.value, multiline: p.multiline, source: ctx.pluginName }),
  "ui.pick": (p, ctx) => dialogs.pick({ title: p.title, items: p.items, source: ctx.pluginName }),
  "ui.setStatus": (p, ctx) => {
    if (!ctx.surface) throw new Error("ui.setStatus is only available to plugins.");
    ctx.surface.setStatus(p.itemId, p.text, p.title);
  },
  "ui.setPanel": (p, ctx) => {
    if (!ctx.surface) throw new Error("ui.setPanel is only available to plugins.");
    ctx.surface.setPanel(p.panelId, { title: p.title, markdown: p.markdown, actions: p.actions ?? [] });
  },
  "ui.addStyles": (p, ctx) => {
    if (!ctx.surface) throw new Error("ui.addStyles is only available to plugins.");
    ctx.surface.addStyles(cleanCss(p.css));
  },

  // clipboard
  "clipboard.readText": async () => {
    try {
      if (navigator.clipboard?.readText) return await navigator.clipboard.readText();
    } catch {
      // Fall through to the native clipboard.
    }
    return await Clipboard.Text();
  },
  "clipboard.writeText": async (p) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(p.text);
        return;
      }
    } catch {
      // Fall through to the native clipboard.
    }
    await Clipboard.SetText(p.text);
  },

  // web
  "web.search": async (p): Promise<WebSearchResult> => {
    const result = await api.webSearch(p.query, p.limit ?? 8);
    return {
      query: result.query,
      engine: result.engine,
      results: (result.results ?? []).map((item) => ({ title: item.title, url: item.url, snippet: item.snippet })),
    };
  },
  "web.fetch": async (p): Promise<WebPage> => {
    const page = await api.webFetch(p.url, p.maxChars ?? 20000);
    return {
      url: page.url,
      finalUrl: page.finalUrl,
      title: page.title,
      contentType: page.contentType,
      content: page.text,
      truncated: page.truncated,
      links: (page.links ?? []).slice(0, 60).map((link) => ({ text: link.text, url: link.url })),
    };
  },
  "network.request": async (p, ctx): Promise<HttpResponse> => {
    if (!ctx.pluginId) throw new Error("network.request is only available to plugins.");
    const response = await api.pluginHTTP(ctx.pluginId, {
      method: p.method ?? "GET",
      url: p.url,
      headers: p.headers ?? {},
      body: p.body ?? "",
      timeoutMs: 30_000,
    });
    const headers: Record<string, string> = {};
    let encoding: HttpResponse["encoding"] = "text";
    for (const [key, value] of Object.entries(response.headers ?? {})) {
      const name = key.toLowerCase();
      if (name === "x-noteral-body-encoding") {
        if (String(value) === "base64") encoding = "base64";
        continue;
      }
      headers[name] = String(value);
    }
    return { status: response.status, statusText: response.statusText, headers, body: response.body, encoding, url: response.finalUrl || p.url };
  },

  // plugins (assistant)
  "plugins.list": async () => {
    const plugins = (await api.listPlugins()) ?? [];
    return plugins.map(pluginInfo);
  },
  "plugins.getSource": async (p): Promise<PluginSourceInfo> => {
    const source = await api.getPluginSource(p.id);
    return { manifest: source.manifest as unknown as Record<string, unknown>, code: source.code, styles: source.styles ?? "" };
  },
  "plugins.setEnabled": async (p) => {
    await api.togglePlugin(p.id, Boolean(p.enabled));
    await store().loadPlugins();
  },
};

/** Used by tests and the docs build: ids with an implementation. */
export const IMPLEMENTED = Object.keys(HANDLERS);
