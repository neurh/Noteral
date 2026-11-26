/**
 * Content statistics of a page from its BlockNote JSON: words, characters, block types,
 * headings, to-dos, links, embedded databases, media and more. Used by the SDK
 * (pages.stats / workspaces.stats) so plugins and widgets can show page facts without
 * parsing documents themselves. Pure: no store access.
 */
import { countWords } from "./docStats";

export interface PageContentStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  /** Top-level and nested blocks. */
  blocks: number;
  /** Blocks with text (paragraphs, headings, list items, quotes, …). */
  paragraphs: number;
  lines: number;
  /** Block type → count, e.g. { paragraph: 12, heading: 3 }. */
  blockTypes: Record<string, number>;
  headings: { level: number; text: string; blockId: string }[];
  todos: { total: number; done: number; open: number };
  links: { url: string; text: string }[];
  pageLinks: { pageId: string; title: string }[];
  databases: { id: string; title: string; blockId: string }[];
  customBlocks: { kind: string; count: number }[];
  images: number;
  media: number;
  files: number;
  tables: number;
  codeBlocks: number;
  quotes: number;
  /** At 230 words a minute, rounded up (0 for an empty page). */
  readingMinutes: number;
  /** At 130 words a minute. */
  speakingMinutes: number;
}

interface Block {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: Block[];
}

const MAX_LIST = 500;

function inlineText(content: unknown, onLink: (url: string, text: string) => void, onPage: (pageId: string) => void): string {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const node of content) {
    if (!node || typeof node !== "object") continue;
    const item = node as { type?: string; text?: unknown; href?: unknown; content?: unknown; props?: Record<string, unknown> };
    if (item.type === "text" && typeof item.text === "string") out += item.text;
    else if (item.type === "link") {
      const text = inlineText(item.content, onLink, onPage);
      if (typeof item.href === "string") onLink(item.href, text);
      out += text;
    } else if (item.type === "pageLink") {
      const id = String(item.props?.pageId ?? "");
      if (id) onPage(id);
    } else if (typeof item.text === "string") out += item.text;
  }
  return out;
}

function tableText(content: unknown, onLink: (url: string, text: string) => void, onPage: (pageId: string) => void): string[] {
  if (!content || typeof content !== "object" || Array.isArray(content)) return [];
  const rows = (content as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  const out: string[] = [];
  for (const row of rows) {
    const cells = (row as { cells?: unknown })?.cells;
    if (!Array.isArray(cells)) continue;
    for (const cell of cells) {
      // Cells are inline arrays, or { type: "tableCell", content: [...] } in newer BlockNote.
      const inline = Array.isArray(cell) ? cell : (cell as { content?: unknown })?.content;
      const text = inlineText(inline, onLink, onPage);
      if (text) out.push(text);
    }
  }
  return out;
}

const TEXT_BLOCKS = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "quote", "codeBlock"]);

export function pageContentStats(blocks: unknown, titleOf: (pageId: string) => string = () => ""): PageContentStats {
  const stats: PageContentStats = {
    words: 0,
    characters: 0,
    charactersNoSpaces: 0,
    blocks: 0,
    paragraphs: 0,
    lines: 0,
    blockTypes: {},
    headings: [],
    todos: { total: 0, done: 0, open: 0 },
    links: [],
    pageLinks: [],
    databases: [],
    customBlocks: [],
    images: 0,
    media: 0,
    files: 0,
    tables: 0,
    codeBlocks: 0,
    quotes: 0,
    readingMinutes: 0,
    speakingMinutes: 0,
  };
  const custom = new Map<string, number>();
  const seenPages = new Set<string>();
  const texts: string[] = [];
  const onLink = (url: string, text: string) => {
    if (stats.links.length < MAX_LIST) stats.links.push({ url, text });
  };
  const onPage = (pageId: string) => {
    if (seenPages.has(pageId) || stats.pageLinks.length >= MAX_LIST) return;
    seenPages.add(pageId);
    stats.pageLinks.push({ pageId, title: titleOf(pageId) || "Untitled" });
  };

  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const block = raw as Block;
      const type = typeof block.type === "string" ? block.type : "unknown";
      stats.blocks += 1;
      stats.blockTypes[type] = (stats.blockTypes[type] ?? 0) + 1;
      const props = block.props ?? {};
      if (type === "table") {
        stats.tables += 1;
        texts.push(...tableText(block.content, onLink, onPage));
      } else {
        const text = inlineText(block.content, onLink, onPage);
        if (text.trim()) {
          texts.push(text);
          if (TEXT_BLOCKS.has(type)) stats.paragraphs += 1;
        }
        if (type === "heading" && stats.headings.length < MAX_LIST) stats.headings.push({ level: Number(props.level) || 1, text: text.trim(), blockId: block.id ?? "" });
      }
      if (type === "checkListItem") {
        stats.todos.total += 1;
        if (props.checked === true) stats.todos.done += 1;
      }
      if (type === "image") stats.images += 1;
      else if (type === "video" || type === "audio") stats.media += 1;
      else if (type === "file") stats.files += 1;
      else if (type === "codeBlock") stats.codeBlocks += 1;
      else if (type === "quote") stats.quotes += 1;
      else if (type === "database") {
        const id = String(props.databaseId ?? props.pageId ?? "");
        if (id && stats.databases.length < MAX_LIST) stats.databases.push({ id, title: titleOf(id) || "Untitled", blockId: block.id ?? "" });
      } else if (type === "custom") {
        const kind = String(props.kind ?? "unknown");
        custom.set(kind, (custom.get(kind) ?? 0) + 1);
      }
      walk(block.children);
    }
  };
  walk(blocks);

  stats.todos.open = stats.todos.total - stats.todos.done;
  stats.customBlocks = [...custom].map(([kind, count]) => ({ kind, count }));
  for (const text of texts) {
    stats.words += countWords(text);
    stats.characters += text.length;
    stats.charactersNoSpaces += text.replace(/\s+/g, "").length;
    stats.lines += text.split("\n").length;
  }
  stats.readingMinutes = stats.words ? Math.max(1, Math.ceil(stats.words / 230)) : 0;
  stats.speakingMinutes = stats.words ? Math.max(1, Math.ceil(stats.words / 130)) : 0;
  return stats;
}

/** Parse stored page JSON (a BlockNote block array); bad input gives no blocks. */
export function parseBlocks(docJson: string | undefined): unknown[] {
  if (!docJson?.trim()) return [];
  try {
    const parsed = JSON.parse(docJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
