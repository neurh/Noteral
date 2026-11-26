/**
 * Keeps Noteral's non-Markdown blocks alive through a Markdown round-trip.
 *
 * Pages are read and edited as Markdown (the AI assistant, plugins, pages.edit), but an
 * embedded database or a plugin's custom block has no Markdown form. Each one is written
 * as a marker line that converts back into the same block:
 *
 *   <!-- database:DATABASE_ID Title -->   an inline or linked database (Title is a label only)
 *   <!-- block:BLOCK_ID kind -->           a custom block, or a database block with its own views
 *                                          (kind "database …"), restored from the current document
 *
 * Markers are only recognised on a line of their own, outside fenced code.
 */

export type EmbedBlock = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: EmbedBlock[] };

type TitleOf = (pageId: string) => string | undefined;

const MARKER = /^\s*<!--\s*(database|block):([^\s>]+)(?:\s+([\s\S]*?))?\s*-->\s*$/;
const MARKER_ANYWHERE = /<!--\s*database:([^\s>]+)/g;

/** Comment-safe label: no "--", angle brackets or line breaks. */
function label(text: string): string {
  return text.replace(/-{2,}/g, "–").replace(/[<>\r\n]+/g, " ").trim();
}

export function databaseMarker(databaseId: string, title?: string): string {
  const name = title ? label(title) : "";
  return `<!-- database:${databaseId}${name ? ` ${name}` : ""} -->`;
}

export function blockMarker(blockId: string, kind: string): string {
  const name = label(kind);
  return `<!-- block:${blockId}${name ? ` ${name}` : ""} -->`;
}

function markerFor(block: EmbedBlock, titleOf: TitleOf): string | undefined {
  if (block.type === "database") {
    const id = String(block.props?.databaseId ?? block.props?.pageId ?? "");
    // A block with its own views (several sources) keeps its identity, so the
    // views survive a Markdown round trip.
    if (block.id && block.props?.views) return blockMarker(block.id, `database ${titleOf(id) || "Untitled"}`);
    return id ? databaseMarker(id, titleOf(id) || "Untitled") : undefined;
  }
  if (block.type === "custom" && block.id) return blockMarker(block.id, String(block.props?.kind ?? "custom"));
  return undefined;
}

/**
 * Top-level blocks → Markdown, with database and custom blocks as marker lines.
 * `toMarkdown` converts each run of ordinary blocks.
 */
export function embedsToMarkdown(blocks: EmbedBlock[], toMarkdown: (blocks: EmbedBlock[]) => string, titleOf: TitleOf): string {
  const out: string[] = [];
  let run: EmbedBlock[] = [];
  const flush = () => {
    if (!run.length) return;
    const markdown = toMarkdown(run).trim();
    if (markdown) out.push(markdown);
    run = [];
  };
  for (const block of blocks) {
    const marker = markerFor(block, titleOf);
    if (marker) {
      flush();
      out.push(marker);
    } else run.push(block);
  }
  flush();
  return out.join("\n\n");
}

export interface EmbedParseOptions {
  /** The current block for a `<!-- block:ID -->` marker (unknown ids are dropped). */
  lookup?: (blockId: string) => EmbedBlock | undefined;
  /** Ids for restored blocks; without it they carry no id and the editor assigns one. */
  newId?: () => string;
}

function fenceOf(line: string): string | undefined {
  return /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
}

/** Markdown (with marker lines) → blocks. `parse` converts each run of ordinary Markdown. */
export function markdownToEmbedBlocks(markdown: string, parse: (markdown: string) => EmbedBlock[], options: EmbedParseOptions = {}): EmbedBlock[] {
  const out: EmbedBlock[] = [];
  let buffer: string[] = [];
  let fence: string | undefined;
  const flush = () => {
    const text = buffer.join("\n");
    buffer = [];
    if (text.trim()) out.push(...parse(text));
  };
  const withId = (block: EmbedBlock): EmbedBlock => {
    const { id: _id, ...rest } = block;
    return options.newId ? { id: options.newId(), ...rest } : rest;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const marks = fenceOf(line);
    if (fence) {
      if (marks && marks[0] === fence[0] && marks.length >= fence.length && line.trim() === marks) fence = undefined;
      buffer.push(line);
      continue;
    }
    if (marks) {
      fence = marks;
      buffer.push(line);
      continue;
    }
    const match = MARKER.exec(line);
    if (!match) {
      buffer.push(line);
      continue;
    }
    flush();
    const [, kind, id] = match;
    if (kind === "database") out.push(withId({ type: "database", props: { databaseId: id }, children: [] }));
    else {
      const found = options.lookup?.(id);
      if (found?.type === "custom" || found?.type === "database") out.push(withId({ type: found.type, props: { ...(found.props ?? {}) }, children: found.children ?? [] }));
    }
  }
  flush();
  return out;
}

/** Database ids referenced by marker lines (for validation). */
export function databaseMarkerIds(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(MARKER_ANYWHERE)].map((match) => match[1]))];
}

/** Every block in a document by id, nested ones included. */
export function blocksById(blocks: EmbedBlock[]): Map<string, EmbedBlock> {
  const map = new Map<string, EmbedBlock>();
  const walk = (list: EmbedBlock[]) => {
    for (const block of list) {
      if (block.id) map.set(block.id, block);
      walk(block.children ?? []);
    }
  };
  walk(blocks);
  return map;
}
