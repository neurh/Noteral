/**
 * Assistant tools are the App API itself: every method in sdk-host/spec.ts that the
 * assistant may call becomes a tool, filtered by mode (tier). Calls go through the
 * same callMethod gate plugins use, so validation and behaviour are identical.
 */
import { callMethod } from "../sdk-host/host";
import { METHODS, callersOf } from "../sdk-host/spec";
import type { MethodSpec, Tier } from "../sdk-host/spec";
import { toWireName } from "./protocol";
import type { AssistantMode, AssistantSettings, ToolDef } from "./types";

export const MODE_TIERS: Record<AssistantMode, readonly Tier[]> = {
  ask: ["read"],
  edit: ["read", "content"],
  creator: ["read", "content", "app"],
};

export interface ModeInfo {
  id: AssistantMode;
  label: string;
  summary: string;
}

export const MODES: ModeInfo[] = [
  { id: "ask", label: "Ask", summary: "Reads your notes and the web. Changes nothing." },
  { id: "edit", label: "Edit", summary: "Writes and reorganizes pages and databases." },
  { id: "creator", label: "Creator", summary: "Also changes the app: appearance, layout, settings and plugins." },
];

/** Methods that only navigate or display; never worth an approval prompt. */
const HARMLESS = new Set(["ui.notify", "navigation.openPage", "navigation.openHome", "navigation.back", "navigation.forward", "editor.scrollToBlock", "editor.openFind", "layout.openOverlay"]);

export function methodsFor(mode: AssistantMode, settings: Pick<AssistantSettings, "webAccess">): MethodSpec[] {
  const tiers = MODE_TIERS[mode];
  return METHODS.filter((method) => {
    if (!callersOf(method).includes("assistant")) return false;
    if (!tiers.includes(method.tier)) return false;
    if (!settings.webAccess && method.name.startsWith("web.")) return false;
    return true;
  });
}

/** Every tool of a mode (sub-agents, tests, "send all tools" mode). */
export function toolDefs(mode: AssistantMode, settings: Pick<AssistantSettings, "webAccess">): ToolDef[] {
  return chatToolDefs(mode, settings, "all");
}

// ── on-demand tools ──────────────────────────────────────────────────────
// Sending every method's schema with every request costs ~5k (Ask) to ~22k (Creator)
// tokens per step. Instead each mode starts with a small core set, the system prompt
// lists every other tool by name, and the model loads a namespace when it needs it.

export const LOAD_TOOL = "tools.load";

const CORE_READ = [
  "search.query", "pages.list", "pages.get", "pages.read", "editor.getActive", "editor.getMarkdown", "editor.getSelection",
  "databases.list", "databases.getSchema", "databases.queryRows", "web.search", "web.fetch", "ui.ask", "source.list", "source.get",
];
const CORE_CONTENT = [
  "pages.create", "pages.edit", "pages.write", "pages.append", "pages.rename", "editor.insertMarkdown", "editor.replaceBlocks",
  "databases.create", "databases.embed", "databases.addProperty", "databases.addRows", "databases.updateRows", "navigation.openPage",
];
const CORE_APP = ["source.edit", "appearance.get", "appearance.setTokens", "appearance.addCss", "plugins.list", "plugins.getSource", "plugins.edit", "plugins.docs"];

export const CORE_TOOLS: Record<AssistantMode, readonly string[]> = {
  ask: CORE_READ,
  edit: [...CORE_READ, ...CORE_CONTENT],
  creator: [...CORE_READ, ...CORE_CONTENT, ...CORE_APP],
};

const GROUP_INFO: Record<string, string> = {
  app: "app info",
  editor: "block-level editing of the open page, undo/redo",
  pages: "tree: move, duplicate, icons, covers, favorites, trash, backlinks",
  databases: "properties, formulas, rows, views (table/board/calendar/gallery/list/chart/custom), filters, sorts, grouping, custom property types (registerPropertyType: own cell look, editor, options)",
  workspaces: "switch/create workspaces",
  navigation: "open pages, back/forward",
  tabs: "open tabs",
  layout: "split panes, panels, overlays",
  search: "full-text search",
  assets: "pick images/files",
  settings: "app settings, plugin options",
  preferences: "editor/app preferences",
  appearance: "theme tokens, component styles, CSS, layers",
  commands: "list/run app commands",
  ui: "notify, confirm, prompt, pick, status, panels, floating overlays above the app (setOverlay: HUDs, timers, sticky notes, full-window effects)",
  clipboard: "read/write clipboard",
  web: "web search and fetch",
  network: "HTTP requests",
  sidebar: "right-sidebar tabs (HTML/Markdown views), groups",
  statusBar: "status bar widgets: text/icon/badge/progress/HTML, width auto/fill/%, a popup on click, live updateWidget",
  menus: "items in page/tree/block/tab/status menus",
  blocks: "custom block types (HTML) and inserting them",
  nodes: "custom page types (full-page HTML views)",
  home: "Home views, widgets (incl. HTML), backgrounds",
  views: "messages to HTML views",
  plugins: "install, test, edit, logs, enable/disable plugins; plugins.docs = plugin guide + full API reference",
  source: "read/patch the text of anything built",
};

export function groupOf(method: string): string {
  return method.slice(0, method.indexOf("."));
}

/** Resolves what the model asked to load (namespaces or single methods) to method names. */
export function resolveLoad(mode: AssistantMode, settings: Pick<AssistantSettings, "webAccess">, requested: unknown): { methods: string[]; unknown: string[] } {
  const available = methodsFor(mode, settings).map((method) => method.name);
  const names = (Array.isArray(requested) ? requested : [requested]).map((item) => String(item ?? "").trim()).filter(Boolean);
  const methods = new Set<string>();
  const unknown: string[] = [];
  for (const name of names) {
    const hits = name.includes(".") ? available.filter((method) => method === name) : available.filter((method) => groupOf(method) === name);
    if (hits.length) hits.forEach((method) => methods.add(method));
    else unknown.push(name);
  }
  return { methods: [...methods], unknown };
}

function loadToolDef(): ToolDef {
  return {
    wireName: toWireName(LOAD_TOOL),
    method: LOAD_TOOL,
    description: "Load more tools before using them: pass namespaces (e.g. \"home\", \"databases\") or exact method names from the tool catalog in the instructions. Loaded tools stay available for the rest of the chat.",
    parameters: {
      type: "object",
      properties: { tools: { type: "array", description: "Namespaces or method names.", items: { type: "string" }, maxItems: 20 } },
      required: ["tools"],
      additionalProperties: false,
    },
  };
}

function toDef(method: MethodSpec): ToolDef {
  return {
    wireName: toWireName(method.name),
    method: method.name,
    description: [method.summary, method.details, method.returns === "void" ? "" : `Returns ${method.returns}.`].filter(Boolean).join(" "),
    parameters: method.params as unknown as Record<string, unknown>,
  };
}

/**
 * The tools sent for one step of a chat: the mode's core set plus whatever the chat has
 * loaded, and tools.load while anything is left to load. `loaded: "all"` sends everything.
 */
export function chatToolDefs(mode: AssistantMode, settings: Pick<AssistantSettings, "webAccess">, loaded: readonly string[] | "all"): ToolDef[] {
  const all = methodsFor(mode, settings);
  if (loaded === "all") return all.map(toDef);
  const keep = new Set([...CORE_TOOLS[mode], ...loaded]);
  const defs = all.filter((method) => keep.has(method.name)).map(toDef);
  if (defs.length < all.length) defs.push(loadToolDef());
  return defs;
}

/** Compact catalog of the tools not yet loaded, for the system prompt. */
export function toolCatalog(mode: AssistantMode, settings: Pick<AssistantSettings, "webAccess">, loaded: readonly string[]): string {
  const keep = new Set([...CORE_TOOLS[mode], ...loaded]);
  const groups = new Map<string, string[]>();
  for (const method of methodsFor(mode, settings)) {
    if (keep.has(method.name)) continue;
    const group = groupOf(method.name);
    groups.set(group, [...(groups.get(group) ?? []), method.name.slice(group.length + 1)]);
  }
  if (!groups.size) return "";
  return [...groups].map(([group, names]) => `- ${group} (${GROUP_INFO[group] ?? ""}): ${names.join(", ")}`).join("\n");
}

/** Whether a call needs the user's go-ahead before it runs. */
export function needsApproval(name: string, settings: Pick<AssistantSettings, "approval">): boolean {
  const spec = METHODS.find((method) => method.name === name);
  if (!spec) return false;
  if (spec.confirm) return true;
  if (settings.approval === "writes") return spec.tier !== "read" && !HARMLESS.has(name);
  return false;
}

const RESULT_LIMIT = 30_000;

/** The customization layer a chat's changes go into. */
export function chatLayerId(chatId: string): string {
  return `chat:${chatId.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 60) || "default"}`;
}

/** Runs a tool and returns the text sent back to the model. */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  mode: AssistantMode,
  chat?: { id: string; title: string },
): Promise<string> {
  if ("__invalid" in args) throw new Error("The arguments were not valid JSON. Send a JSON object that matches the tool's schema.");
  // Each chat writes its look and UI changes into its own layer (Plugins → Created),
  // so they can be inspected, switched off or removed as one unit.
  const layer = chat ? { id: chatLayerId(chat.id), name: chat.title.trim() || "Assistant changes", chatId: chat.id } : undefined;
  const result = await callMethod(name, args, { caller: "assistant", ...(layer ? { layer } : {}) }, { tiers: MODE_TIERS[mode] });
  const text = typeof result === "string" ? result : JSON.stringify(result ?? null);
  return text.length > RESULT_LIMIT ? `${text.slice(0, RESULT_LIMIT)}\n…[truncated ${text.length - RESULT_LIMIT} characters]` : text;
}

// ── presentation ─────────────────────────────────────────────────────────

const VERBS: Record<string, [string, string]> = {
  "agents.run": ["Running an agent", "Ran an agent"],
  "tools.load": ["Loading tools", "Loaded tools"],
  "pages.edit": ["Editing a page", "Edited a page"],
  "source.list": ["Looking at what's built", "Looked at what's built"],
  "source.get": ["Reading source", "Read source"],
  "source.edit": ["Editing source", "Edited source"],
  "plugins.edit": ["Editing a plugin", "Edited a plugin"],
  "databases.addRows": ["Adding rows", "Added rows"],
  "databases.updateRows": ["Updating rows", "Updated rows"],
  "web.search": ["Searching the web", "Searched the web"],
  "web.fetch": ["Reading", "Read"],
  "editor.getMarkdown": ["Reading the page", "Read the page"],
  "editor.getBlocks": ["Reading blocks", "Read blocks"],
  "editor.getSelection": ["Reading the selection", "Read the selection"],
  "editor.snapshot": ["Looking at the page", "Looked at the page"],
  "editor.insertMarkdown": ["Writing", "Wrote"],
  "editor.replaceBlocks": ["Rewriting blocks", "Rewrote blocks"],
  "editor.updateBlock": ["Editing a block", "Edited a block"],
  "editor.removeBlocks": ["Removing blocks", "Removed blocks"],
  "editor.setMarkdown": ["Rewriting the page", "Rewrote the page"],
  "pages.list": ["Listing pages", "Listed pages"],
  "pages.read": ["Reading a page", "Read a page"],
  "pages.create": ["Creating a page", "Created a page"],
  "pages.write": ["Writing a page", "Wrote a page"],
  "pages.append": ["Appending to a page", "Appended to a page"],
  "pages.moveToTrash": ["Moving to trash", "Moved to trash"],
  "search.query": ["Searching notes", "Searched notes"],
  "databases.queryRows": ["Querying a database", "Queried a database"],
  "databases.create": ["Creating a database", "Created a database"],
  "databases.addRow": ["Adding a row", "Added a row"],
  "databases.updateRow": ["Updating a row", "Updated a row"],
  "appearance.setTokens": ["Changing colors", "Changed colors"],
  "appearance.styleComponent": ["Styling a component", "Styled a component"],
  "appearance.addCss": ["Adding styles", "Added styles"],
  "appearance.reset": ["Resetting appearance", "Reset appearance"],
  "preferences.update": ["Updating preferences", "Updated preferences"],
  "layout.split": ["Splitting the view", "Split the view"],
  "layout.setPanels": ["Changing the layout", "Changed the layout"],
  "plugins.create": ["Building a plugin", "Built a plugin"],
  "plugins.getSource": ["Reading plugin code", "Read plugin code"],
  "plugins.docs": ["Reading the plugin docs", "Read the plugin docs"],
  "commands.execute": ["Running a command", "Ran a command"],
};

export function toolLabel(name: string, done: boolean): string {
  const verbs = VERBS[name];
  if (verbs) return done ? verbs[1] : verbs[0];
  const spec = METHODS.find((method) => method.name === name);
  return spec ? spec.summary.replace(/\.$/, "") : name;
}

/** A short human hint for the call ("“rust async”", a URL host, a page title). */
export function toolHint(name: string, args: Record<string, unknown>): string {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  if (name === "web.fetch") {
    const url = pick("url");
    try {
      const parsed = new URL(url);
      return parsed.host.replace(/^www\./, "") + (parsed.pathname.length > 1 ? parsed.pathname : "");
    } catch {
      return url;
    }
  }
  if (name === LOAD_TOOL && Array.isArray(args.tools)) return args.tools.join(", ");
  if (name === "databases.addRows" && Array.isArray(args.rows)) return `${args.rows.length} row${args.rows.length === 1 ? "" : "s"}`;
  if (name === "databases.updateRows" && Array.isArray(args.updates)) return `${args.updates.length} row${args.updates.length === 1 ? "" : "s"}`;
  const text = pick("query", "target", "title", "name", "text", "id", "pageId", "commandId", "component");
  return text.length > 80 ? `${text.slice(0, 78)}…` : text;
}

export function toolSpec(name: string): MethodSpec | undefined {
  return METHODS.find((method) => method.name === name);
}

/** Read-only lookups that can safely run at the same time as others in the same turn. */
export function canRunInParallel(name: string): boolean {
  if (name === "agents.run" || name === LOAD_TOOL) return true;
  if (name.startsWith("ui.") || name.startsWith("navigation.") || name.startsWith("tabs.")) return false;
  const spec = METHODS.find((method) => method.name === name);
  return spec?.tier === "read" && !spec.confirm;
}

/** Runs `jobs` with at most `limit` in flight; resolves when all settle. */
export async function runLimited(jobs: (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      await job();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, jobs.length)) }, worker));
}
