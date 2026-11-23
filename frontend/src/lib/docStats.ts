import type { EditorStats, OutlineItem } from "./editorBridge";

/**
 * Word count, block count and outline read straight from the ProseMirror
 * document.
 *
 * `editor.document` converts the whole document into BlockNote blocks, which
 * gets expensive on long pages. ProseMirror nodes are immutable and an edit
 * only replaces the nodes on the path to the change. So the per-block results
 * are cached by node identity, and a keystroke recomputes one block, not the
 * whole page.
 */

/** The subset of a ProseMirror node this module reads. */
export interface DocNode {
  type: { name: string };
  attrs: Record<string, unknown>;
  isText: boolean;
  isTextblock: boolean;
  text?: string;
  childCount: number;
  child(index: number): DocNode;
}

interface BlockText {
  text: string;
  words: number;
}

const textCache = new WeakMap<DocNode, BlockText>();

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/g;
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function countWords(text: string): number {
  if (!text) return 0;
  const cjk = text.match(CJK)?.length ?? 0;
  const latin = (cjk ? text.replace(CJK, " ") : text).match(WORD)?.length ?? 0;
  return cjk + latin;
}

type TitleOf = (pageId: string) => string | undefined;

/** Whether a node (or anything inside it) shows another page's title. */
function hasPageLink(node: DocNode): boolean {
  if (node.type.name === "pageLink") return true;
  for (let i = 0; i < node.childCount; i += 1) if (hasPageLink(node.child(i))) return true;
  return false;
}

function collectText(node: DocNode, titleOf: TitleOf, out: string[]) {
  if (node.isText) {
    out.push(node.text ?? "");
    return;
  }
  const name = node.type.name;
  if (name === "pageLink") {
    out.push(titleOf(String(node.attrs.pageId ?? "")) ?? "page");
    return;
  }
  if (name === "hardBreak") {
    out.push("\n");
    return;
  }
  const separate = !node.isTextblock && node.childCount > 1;
  for (let i = 0; i < node.childCount; i += 1) {
    if (separate && i > 0) out.push(" ");
    collectText(node.child(i), titleOf, out);
  }
}

/** The visible text of one block's content node (paragraph, heading, table…). */
function blockText(node: DocNode, titleOf: TitleOf): BlockText {
  const cached = textCache.get(node);
  if (cached) return cached;
  const parts: string[] = [];
  collectText(node, titleOf, parts);
  const text = parts.join("").trim();
  const result = { text, words: countWords(text) };
  // A page link shows a title that can change without the node changing.
  if (!hasPageLink(node)) textCache.set(node, result);
  return result;
}

export function statsOfDoc(doc: DocNode, titleOf: TitleOf, withText = false): EditorStats {
  let wordCount = 0;
  let blockCount = 0;
  const outline: OutlineItem[] = [];
  const chunks: string[] = [];

  const walk = (node: DocNode) => {
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      const name = child.type.name;
      if (name === "blockContainer") {
        blockCount += 1;
        for (let j = 0; j < child.childCount; j += 1) {
          const part = child.child(j);
          if (part.type.name === "blockGroup") {
            walk(part);
            continue;
          }
          const { text, words } = blockText(part, titleOf);
          wordCount += words;
          if (withText && text) chunks.push(text);
          if (part.type.name === "heading" && text) {
            outline.push({ id: String(child.attrs.id ?? ""), text, level: Number(part.attrs.level ?? 1) });
          }
        }
      } else if (name === "blockGroup" || name === "column" || name === "columnList") {
        walk(child);
      }
    }
  };
  walk(doc);
  return { wordCount, blockCount, outline, text: chunks.join("\n") };
}

export function sameOutline(a: OutlineItem[], b: OutlineItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id || a[i].text !== b[i].text || a[i].level !== b[i].level) return false;
  }
  return true;
}
