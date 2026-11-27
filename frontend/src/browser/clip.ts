/**
 * Web clips: save what the browser shows into a page. A clip is Markdown with
 * a source line on top, written into a new page (in the clip folder) or
 * appended to an existing one.
 */
import { api } from "../lib/api";
import { editorBridge } from "../lib/editorBridge";
import { appendMarkdown, markdownToDocJson } from "../lib/markdownDoc";
import { useAppStore } from "../store";
import { hostOf } from "./model";
import { useBrowserStore } from "./store";

export type ClipKind = "article" | "selection" | "bookmark";

export interface ClipInput {
  kind: ClipKind;
  url: string;
  title: string;
  description?: string;
  /** Markdown body: the article or the selection. Empty for a bookmark. */
  body?: string;
}

export const CLIP_FOLDER_TITLE = "Web clips";

function clipDate(now: Date): string {
  return now.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function escapeLabel(text: string): string {
  return text.replace(/[[\]]/g, "\\$&");
}

/** The Markdown a clip writes. Exported for tests. */
export function clipMarkdown(input: ClipInput, now = new Date(), withTitle = false): string {
  const title = input.title.trim() || hostOf(input.url) || input.url;
  const source = `*Clipped from [${escapeLabel(hostOf(input.url) || input.url)}](${input.url}) on ${clipDate(now)}*`;
  const parts: string[] = [];
  if (withTitle) parts.push(`## ${title}`);
  if (input.kind === "bookmark") {
    parts.push(`[${escapeLabel(title)}](${input.url})`);
    if (input.description?.trim()) parts.push(input.description.trim());
    parts.push(source);
    return parts.join("\n\n");
  }
  parts.push(source);
  const body = (input.body ?? "").trim();
  if (input.kind === "selection") parts.push(body.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n"));
  else {
    if (input.description?.trim() && !body.startsWith(input.description.trim().slice(0, 40))) parts.push(`> ${input.description.trim()}`);
    parts.push(body);
  }
  return parts.filter(Boolean).join("\n\n");
}

/** The folder clips go into: the chosen one, or a "Web clips" folder at the top level. */
export async function clipFolder(): Promise<string> {
  const app = useAppStore.getState();
  const prefs = useBrowserStore.getState().data.prefs;
  const live = (id: string) => app.pages.some((page) => page.id === id && page.kind === "folder" && !page.deletedAt);
  if (prefs.clipFolderId && live(prefs.clipFolderId)) return prefs.clipFolderId;
  const existing = app.pages.find((page) => page.kind === "folder" && !page.parentId && !page.deletedAt && page.title === CLIP_FOLDER_TITLE);
  if (existing) return existing.id;
  const folder = await app.createItem("folder", "", { open: false, title: CLIP_FOLDER_TITLE });
  if (!folder) throw new Error("Could not create the Web clips folder.");
  return folder.id;
}

async function writeMarkdown(pageId: string, markdown: string, mode: "replace" | "append") {
  const handle = editorBridge.get(pageId);
  if (handle?.setMarkdown && handle.insertMarkdown) {
    if (mode === "replace") await handle.setMarkdown(markdown);
    else await handle.insertMarkdown(markdown, "end");
    return;
  }
  const state = useAppStore.getState();
  const workspaceId = state.workspace?.id;
  if (!workspaceId) throw new Error("No workspace is open.");
  const doc = await state.ensurePageLoaded(pageId);
  if (!doc) throw new Error("Could not load the page.");
  const next = mode === "replace" ? markdownToDocJson(markdown, doc.docJson) : appendMarkdown(doc.docJson, markdown);
  await api.savePage(workspaceId, pageId, next, doc.revision);
  await useAppStore.getState().reloadPage(pageId);
}

/** Save a clip as a new page. Returns the page id. */
export async function clipToNewPage(input: ClipInput, options: { open?: boolean; parentId?: string } = {}): Promise<string> {
  const parentId = options.parentId ?? (await clipFolder());
  const title = (input.kind === "selection" ? `${input.title.trim() || hostOf(input.url)} (excerpt)` : input.title.trim() || hostOf(input.url) || "Web clip").slice(0, 200);
  const app = useAppStore.getState();
  const page = await app.createItem("page", parentId, { open: false, title });
  if (!page) throw new Error("Could not create the page.");
  await writeMarkdown(page.id, clipMarkdown(input), "replace");
  if (options.open) void useAppStore.getState().selectPage(page.id);
  return page.id;
}

/** Append a clip to the end of an existing page. */
export async function clipToPage(pageId: string, input: ClipInput): Promise<void> {
  await writeMarkdown(pageId, clipMarkdown(input, new Date(), true), "append");
}

// ── selection to Markdown ──────────────────────────────────────────────────

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ");
  if (!(node instanceof HTMLElement)) return "";
  const inner = () => Array.from(node.childNodes).map(inline).join("");
  switch (node.tagName) {
    case "STRONG":
    case "B": {
      const text = inner().trim();
      return text ? `**${text}**` : "";
    }
    case "EM":
    case "I": {
      const text = inner().trim();
      return text ? `*${text}*` : "";
    }
    case "DEL":
    case "S":
      return `~~${inner()}~~`;
    case "CODE":
      return `\`${node.textContent ?? ""}\``;
    case "BR":
      return "\n";
    case "IMG": {
      const src = (node as HTMLImageElement).src;
      return /^https?:/i.test(src) ? `![${(node as HTMLImageElement).alt ?? ""}](${src})` : "";
    }
    case "A": {
      const href = (node as HTMLAnchorElement).href;
      const text = inner().trim();
      return /^https?:/i.test(href) && text ? `[${text}](${href})` : text;
    }
    default:
      return inner();
  }
}

const BLOCKS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "TABLE", "HR", "FIGURE", "SECTION", "ARTICLE"]);

function blocks(node: Node, out: string[], depth = 0) {
  if (!(node instanceof HTMLElement)) {
    const text = inline(node).trim();
    if (text) out.push(text);
    return;
  }
  const tag = node.tagName;
  if (/^H[1-6]$/.test(tag)) {
    const text = inline(node).trim();
    if (text) out.push(`${"#".repeat(Math.min(3, Number(tag[1])))} ${text}`);
    return;
  }
  switch (tag) {
    case "P":
    case "FIGURE": {
      const text = inline(node).trim();
      if (text) out.push(text);
      return;
    }
    case "UL":
    case "OL": {
      let n = 1;
      const lines: string[] = [];
      for (const child of Array.from(node.children)) {
        if (child.tagName !== "LI") continue;
        const marker = tag === "OL" ? `${n++}.` : "-";
        const nested: string[] = [];
        let own = "";
        for (const part of Array.from(child.childNodes)) {
          if (part instanceof HTMLElement && (part.tagName === "UL" || part.tagName === "OL")) blocks(part, nested, depth + 1);
          else own += inline(part);
        }
        lines.push(`${"  ".repeat(depth)}${marker} ${own.trim()}`);
        lines.push(...nested);
      }
      if (lines.length) out.push(lines.join("\n"));
      return;
    }
    case "BLOCKQUOTE": {
      const inner: string[] = [];
      for (const child of Array.from(node.childNodes)) blocks(child, inner, depth);
      if (inner.length) out.push(inner.join("\n\n").split("\n").map((line) => `> ${line}`).join("\n"));
      return;
    }
    case "PRE":
      out.push(`\`\`\`\n${(node.textContent ?? "").replace(/\n$/, "")}\n\`\`\``);
      return;
    case "HR":
      out.push("---");
      return;
    case "LI": {
      const text = inline(node).trim();
      if (text) out.push(`- ${text}`);
      return;
    }
    default:
      break;
  }
  if (Array.from(node.childNodes).some((child) => child instanceof HTMLElement && BLOCKS.has(child.tagName))) {
    let run = "";
    const flush = () => {
      if (run.trim()) out.push(run.trim());
      run = "";
    };
    for (const child of Array.from(node.childNodes)) {
      if (child instanceof HTMLElement && BLOCKS.has(child.tagName)) {
        flush();
        blocks(child, out, depth);
      } else run += inline(child);
    }
    flush();
    return;
  }
  const text = inline(node).trim();
  if (text) out.push(text);
}

/** Markdown for a DOM fragment, e.g. the reader selection. */
export function fragmentMarkdown(fragment: DocumentFragment | HTMLElement): string {
  const out: string[] = [];
  const holder = document.createElement("div");
  holder.appendChild(fragment instanceof DocumentFragment ? fragment : fragment.cloneNode(true));
  blocks(holder, out);
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The current selection inside `root`, as Markdown ("" when nothing is selected there). */
export function selectionMarkdown(root: HTMLElement | null): string {
  if (!root) return "";
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return "";
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return "";
  return fragmentMarkdown(range.cloneContents());
}
