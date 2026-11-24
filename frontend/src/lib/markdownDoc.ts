/**
 * Markdown ⇄ stored page JSON for pages that are not open in an editor.
 *
 * Open pages go through their live editor (editorBridge) so undo and the cursor keep working.
 * Closed pages are converted with one headless BlockNote editor using the default schema;
 * Noteral's custom content (embedded databases, page links) becomes readable placeholders.
 */
import { BlockNoteEditor } from "@blocknote/core";

type JsonBlock = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: JsonBlock[] };

let headless: BlockNoteEditor | null = null;

function editor(): BlockNoteEditor {
  if (!headless) headless = BlockNoteEditor.create();
  return headless;
}

type TitleOf = (pageId: string) => string;

function sanitizeInline(content: unknown, titleOf: TitleOf): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((item) => {
    if (item && typeof item === "object" && (item as { type?: string }).type === "pageLink") {
      const id = String((item as { props?: { pageId?: string } }).props?.pageId ?? "");
      return { type: "text", text: `[[${titleOf(id) || "Untitled"}]]`, styles: {} };
    }
    return item;
  });
}

function sanitize(blocks: JsonBlock[], titleOf: TitleOf): JsonBlock[] {
  return blocks.map((block) => {
    if (block.type === "database") {
      const id = String(block.props?.databaseId ?? block.props?.pageId ?? "");
      return { type: "paragraph", content: [{ type: "text", text: `[Database: ${titleOf(id) || "Untitled"}]`, styles: {} }], children: [] };
    }
    if (block.type === "custom") {
      return { type: "paragraph", content: [{ type: "text", text: `[Custom block: ${String(block.props?.kind ?? "unknown")}]`, styles: {} }], children: [] };
    }
    const content = block.content && typeof block.content === "object" && !Array.isArray(block.content)
      ? block.content // tables keep their own structure
      : sanitizeInline(block.content, titleOf);
    return { ...block, content, children: sanitize(block.children ?? [], titleOf) };
  });
}

export function parseDocJson(docJson: string): JsonBlock[] {
  if (!docJson.trim()) return [];
  try {
    const parsed = JSON.parse(docJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Stored page JSON → Markdown. */
export function docJsonToMarkdown(docJson: string, titleOf: TitleOf = () => ""): string {
  const blocks = sanitize(parseDocJson(docJson), titleOf);
  if (!blocks.length) return "";
  try {
    return editor().blocksToMarkdownLossy(blocks as never).trim();
  } catch {
    return docJsonToText(docJson, titleOf);
  }
}

function inlineText(content: unknown, titleOf: TitleOf): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const node = item as { type?: string; text?: string; content?: unknown; props?: { pageId?: string } };
      if (node.type === "text") return node.text ?? "";
      if (node.type === "link") return inlineText(node.content, titleOf);
      if (node.type === "pageLink") return titleOf(node.props?.pageId ?? "") || "Untitled";
      return "";
    })
    .join("");
}

/** Stored page JSON → plain text, one block per line. */
export function docJsonToText(docJson: string, titleOf: TitleOf = () => ""): string {
  const lines: string[] = [];
  const walk = (blocks: JsonBlock[], depth: number) => {
    for (const block of blocks) {
      const text = inlineText(block.content, titleOf);
      if (text.trim()) lines.push("  ".repeat(depth) + text);
      walk(block.children ?? [], depth + 1);
    }
  };
  walk(parseDocJson(docJson), 0);
  return lines.join("\n");
}

/** Markdown → page JSON ready to store. */
export function markdownToDocJson(markdown: string): string {
  const blocks = markdown.trim() ? editor().tryParseMarkdownToBlocks(markdown) : [];
  return JSON.stringify(blocks.length ? blocks : [{ type: "paragraph", content: [], children: [] }]);
}

/** Append Markdown to stored page JSON. */
export function appendMarkdown(docJson: string, markdown: string): string {
  const existing = parseDocJson(docJson);
  const last = existing[existing.length - 1];
  const lastEmpty = last && last.type === "paragraph" && !inlineText(last.content, () => "").trim() && !(last.children ?? []).length;
  const kept = lastEmpty ? existing.slice(0, -1) : existing;
  const added = markdown.trim() ? editor().tryParseMarkdownToBlocks(markdown) : [];
  return JSON.stringify([...kept, ...added]);
}
