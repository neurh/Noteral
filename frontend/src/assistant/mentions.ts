/**
 * Mentions: things the user points the assistant at, by typing `@` or dragging them
 * onto the panel. Each mention's content is read when the message is sent and kept
 * with the message, so later turns see the same snapshot.
 */
import { callMethod } from "../sdk-host/host";
import type { ActivePage, EditorSelection, PageContent } from "../sdk-host/types";
import { kindOf, useAppStore } from "../store";

export type MentionKind = "page" | "folder" | "database" | "custom" | "row" | "block" | "selection" | "home" | "sidebar" | "text";

export interface Mention {
  kind: MentionKind;
  /** Page id, block id, tab key… whatever identifies it for tools. */
  id: string;
  label: string;
  /** Page the block or row belongs to. */
  pageId?: string;
  /** Snapshot taken when the message was sent (or when it was dropped, for blocks and text). */
  content?: string;
}

export const MENTION_KIND_LABEL: Record<MentionKind, string> = {
  page: "Page",
  folder: "Folder",
  database: "Database",
  custom: "Page",
  row: "Row",
  block: "Blocks",
  selection: "Selection",
  home: "Home",
  sidebar: "Sidebar tab",
  text: "Text",
};

const PER_MENTION = 8000;
const TOTAL = 32_000;

export const sameMention = (a: Mention, b: Mention) => a.kind === b.kind && a.id === b.id && a.pageId === b.pageId;

function pageMention(pageId: string): Mention | null {
  const state = useAppStore.getState();
  const page = state.pages.find((item) => item.id === pageId) ?? state.recent.find((item) => item.id === pageId);
  if (!page) return null;
  const parent = page.parentId ? state.pages.find((item) => item.id === page.parentId) : undefined;
  const kind = kindOf(page);
  const isRow = parent ? kindOf(parent) === "database" : false;
  return {
    kind: isRow ? "row" : kind === "page" ? "page" : kind,
    id: page.id,
    label: page.title || "Untitled",
    ...(isRow && parent ? { pageId: parent.id } : {}),
  };
}

export interface MentionCandidate extends Mention {
  /** Short grey text after the label. */
  hint?: string;
}

/** What the `@` menu offers for a query: the open page and selection first, then open tabs, recent and all pages. */
export function mentionCandidates(query: string, hasSelection: boolean): MentionCandidate[] {
  const state = useAppStore.getState();
  const needle = query.trim().toLowerCase();
  const out: MentionCandidate[] = [];
  const seen = new Set<string>();
  const add = (item: MentionCandidate | null) => {
    if (!item) return;
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return;
    if (needle && !`${item.label} ${MENTION_KIND_LABEL[item.kind]}`.toLowerCase().includes(needle)) return;
    seen.add(key);
    out.push(item);
  };
  if (state.activePageId) {
    const active = pageMention(state.activePageId);
    if (active) add({ ...active, hint: "Open page" });
  }
  if (hasSelection && state.activePageId) add({ kind: "selection", id: "selection", label: "Selection", pageId: state.activePageId, hint: "In the open page" });
  for (const tab of state.tabs) {
    const item = pageMention(tab);
    if (item) add({ ...item, hint: "Open tab" });
  }
  for (const page of state.recent) {
    const item = pageMention(page.id);
    if (item) add({ ...item, hint: "Recent" });
  }
  for (const page of state.pages) {
    if (out.length >= 40) break;
    const item = pageMention(page.id);
    if (item) add({ ...item, hint: item.kind === "row" ? "Row" : MENTION_KIND_LABEL[item.kind] });
  }
  return out.slice(0, needle ? 12 : 8);
}

/** The editor's current selection, if it has any text. */
export async function readSelection(): Promise<string> {
  try {
    const active = (await callMethod("editor.getActive", {}, { caller: "assistant" })) as ActivePage | null;
    if (!active?.editable) return "";
    const picked = (await callMethod("editor.getSelection", {}, { caller: "assistant" })) as EditorSelection;
    return picked.text.trim();
  } catch {
    return "";
  }
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n…(truncated — read the rest with tools)` : text);

async function readPage(pageId: string): Promise<string> {
  try {
    const page = (await callMethod("pages.read", { pageId, format: "markdown" }, { caller: "assistant" })) as PageContent;
    const children = page.children.length ? `\n\nChildren: ${page.children.slice(0, 30).map((child) => `"${child.title}" (${child.id})`).join(", ")}` : "";
    return `${page.content}${children}`;
  } catch {
    return "";
  }
}

async function readDatabase(databaseId: string): Promise<string> {
  try {
    const schema = await callMethod("databases.getSchema", { databaseId }, { caller: "assistant" });
    const rows = await callMethod("databases.queryRows", { databaseId, limit: 25 }, { caller: "assistant" });
    return `Schema: ${JSON.stringify(schema)}\nFirst rows: ${JSON.stringify(rows)}`;
  } catch {
    return "";
  }
}

/** Reads the content of every mention that doesn't carry a snapshot yet. */
export async function resolveMentions(mentions: Mention[]): Promise<Mention[]> {
  let budget = TOTAL;
  const out: Mention[] = [];
  for (const mention of mentions) {
    let content = mention.content;
    if (content === undefined) {
      if (mention.kind === "selection") content = await readSelection();
      else if (mention.kind === "database") content = await readDatabase(mention.id);
      else if (mention.kind === "page" || mention.kind === "row" || mention.kind === "custom" || mention.kind === "folder") content = await readPage(mention.id);
      else content = "";
    }
    const room = Math.max(0, Math.min(PER_MENTION, budget));
    const clipped = clip(content ?? "", room);
    budget -= clipped.length;
    out.push({ ...mention, content: clipped });
  }
  return out;
}

/** Turns mentions into the context block put before the user's text. */
export function mentionContext(mentions: Mention[]): string {
  if (!mentions.length) return "";
  const lines = ["<mentions>"];
  for (const mention of mentions) {
    const where = mention.pageId ? ` in page ${mention.pageId}` : "";
    const head = `<mention kind="${mention.kind}" id="${mention.id}"${where ? ` page="${mention.pageId}"` : ""} title=${JSON.stringify(mention.label)}>`;
    lines.push(head, mention.content?.trim() || "(no content captured — use tools to read it)", "</mention>");
  }
  lines.push("</mentions>");
  return lines.join("\n");
}

// ── drag and drop ─────────────────────────────────────────────────────────

const PAGE_MIME = "application/x-noteral-page";
const ROW_MIME = "application/x-noteral-row";
const TAB_MIME = "application/x-noteral-tab";
const SIDEBAR_MIME = "application/x-noteral-sidebar-tab";
const BLOCK_MIME = "blocknote/html";

const DROPPABLE = [PAGE_MIME, ROW_MIME, TAB_MIME, SIDEBAR_MIME, BLOCK_MIME];

/** True when a drag carries something the assistant can mention (plain text is left to the textarea). */
export function canMention(transfer: DataTransfer): boolean {
  return Array.from(transfer.types).some((type) => DROPPABLE.includes(type));
}

function htmlText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.innerText || doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Mentions for whatever was dropped on the panel. */
export function mentionsFromDrop(transfer: DataTransfer, tabFallback = ""): Mention[] {
  const state = useAppStore.getState();
  const types = Array.from(transfer.types);
  const page = transfer.getData(PAGE_MIME) || transfer.getData(ROW_MIME);
  if (page) {
    const item = pageMention(page);
    return item ? [item] : [];
  }
  if (types.includes(TAB_MIME)) {
    const tabId = transfer.getData(TAB_MIME) || tabFallback;
    const item = pageMention(tabId);
    if (item) return [item];
    if (tabId) return [{ kind: "home", id: tabId, label: "Home", content: "A Home tab. Use the home.* tools to read or change its view." }];
    return [];
  }
  if (types.includes(SIDEBAR_MIME)) {
    const key = transfer.getData(SIDEBAR_MIME);
    return key ? [{ kind: "sidebar", id: key, label: key.split(":").pop() || key, content: `Right sidebar tab "${key}". Use the sidebar.* tools to change it.` }] : [];
  }
  if (types.includes(BLOCK_MIME)) {
    const text = htmlText(transfer.getData(BLOCK_MIME)) || transfer.getData("text/plain").trim();
    if (!text) return [];
    const first = text.split("\n")[0].slice(0, 48);
    const pageTitle = state.pages.find((item) => item.id === state.activePageId)?.title;
    return [{ kind: "block", id: `blocks:${Date.now().toString(36)}`, label: first || "Blocks", pageId: state.activePageId || undefined, content: `${pageTitle ? `From "${pageTitle}":\n` : ""}${text}` }];
  }
  return [];
}
