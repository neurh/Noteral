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

export function toolDefs(mode: AssistantMode, settings: Pick<AssistantSettings, "webAccess">): ToolDef[] {
  return methodsFor(mode, settings).map((method) => ({
    wireName: toWireName(method.name),
    method: method.name,
    description: [method.summary, method.details, `Returns ${method.returns}.`].filter(Boolean).join(" "),
    parameters: method.params as unknown as Record<string, unknown>,
  }));
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
  const text = pick("query", "title", "name", "text", "id", "pageId", "commandId", "component");
  return text.length > 80 ? `${text.slice(0, 78)}…` : text;
}

export function toolSpec(name: string): MethodSpec | undefined {
  return METHODS.find((method) => method.name === name);
}
