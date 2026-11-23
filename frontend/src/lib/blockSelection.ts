import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

/**
 * Block selection for the page editor: a range of sibling blocks selected as
 * whole blocks (by the marquee or the drag handle) rather than as text.
 *
 * It rides on BlockNote's own `MultipleNodeSelection` ("multiple-node"), so
 * dragging a selection by any of its handles moves every selected block, and
 * copy/cut carry whole blocks. That class isn't exported, but it registers a
 * JSON id, which is how these helpers create and recognise it.
 */

const BLOCK = "blockContainer";
const SELECTED_CLASS = "bn-block-selected";

export const blockSelectionKey = new PluginKey("noteral-block-selection");

export type BlockRange = { from: number; to: number };

export function isBlockSelection(selection: Selection): boolean {
  return selection.toJSON().type === "multiple-node";
}

/** Top-level nodes of a block selection (each a blockContainer). */
export function selectedBlockNodes(selection: Selection): PMNode[] {
  if (!isBlockSelection(selection)) return [];
  return ((selection as Selection & { nodes?: PMNode[] }).nodes ?? []).filter((node) => node.type.name === BLOCK);
}

export function selectedBlockIds(selection: Selection): string[] {
  return selectedBlockNodes(selection).map((node) => String(node.attrs.id));
}

export function createBlockSelection(doc: PMNode, range: BlockRange): Selection {
  return Selection.fromJSON(doc, { type: "multiple-node", anchor: range.from, head: range.to });
}

/** Position before every block in the document, keyed by block id. */
export function blockPositions(doc: PMNode): Map<string, number> {
  const positions = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (node.type.name === BLOCK && node.attrs.id) positions.set(String(node.attrs.id), pos);
    return true;
  });
  return positions;
}

/** Positions of `pos`'s block and every block it is nested in, outermost first. */
function blockChain(doc: PMNode, pos: number): number[] {
  const $pos = doc.resolve(pos);
  const chain = [pos];
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === BLOCK) chain.unshift($pos.before(depth));
  }
  return chain;
}

/**
 * The sibling range covering the given blocks. A selection is always a run of
 * siblings, so blocks at different depths are lifted to the level they share:
 * a parent and its child select the parent; a child and its parent's next
 * sibling select the parent and that sibling.
 */
export function rangeForBlocks(doc: PMNode, ids: readonly string[]): BlockRange | null {
  const positions = blockPositions(doc);
  const chains = ids.flatMap((id) => {
    const pos = positions.get(id);
    return pos === undefined ? [] : [blockChain(doc, pos)];
  });
  if (!chains.length) return null;
  const shortest = Math.min(...chains.map((chain) => chain.length));
  let level = 0;
  while (level < shortest - 1 && chains.every((chain) => chain[level] === chains[0][level])) level++;
  const picked = chains.map((chain) => chain[level]);
  const from = Math.min(...picked);
  const last = Math.max(...picked);
  const node = doc.nodeAt(last);
  if (!node) return null;
  return { from, to: last + node.nodeSize };
}

/** Every block in reading order (parents before their children). */
function blocksInOrder(doc: PMNode): { pos: number; node: PMNode }[] {
  const blocks: { pos: number; node: PMNode }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === BLOCK) blocks.push({ pos, node });
    return true;
  });
  return blocks;
}

export function selectBlockRange(view: EditorView, range: BlockRange | null): void {
  const { state } = view;
  if (!range) {
    if (isBlockSelection(state.selection)) view.dispatch(state.tr.setSelection(collapsedNear(state, state.selection.from)));
    return;
  }
  const current = state.selection;
  if (isBlockSelection(current) && current.from === range.from && current.to === range.to) return;
  view.dispatch(state.tr.setSelection(createBlockSelection(state.doc, range)));
}

export function selectBlocks(view: EditorView, ids: readonly string[]): void {
  selectBlockRange(view, rangeForBlocks(view.state.doc, ids));
}

function collapsedNear(state: EditorState, pos: number): Selection {
  return Selection.near(state.doc.resolve(Math.min(pos + 1, state.doc.content.size)));
}

/** Drop a block selection, leaving no caret behind (like Notion's Escape). */
export function clearBlockSelection(view: EditorView): void {
  if (!isBlockSelection(view.state.selection)) return;
  view.dispatch(view.state.tr.setSelection(collapsedNear(view.state, view.state.selection.from)));
  (view.dom as HTMLElement).blur();
}

/** Put a caret at the start or end of a block's text, when it has any. */
export function caretInBlock(view: EditorView, blockPos: number, side: "start" | "end"): boolean {
  const { doc } = view.state;
  const block = doc.nodeAt(blockPos);
  const content = block?.firstChild;
  if (!block || !content || !content.isTextblock) return false;
  const contentPos = blockPos + 1;
  const pos = side === "start" ? contentPos + 1 : contentPos + content.nodeSize - 1;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, pos)).scrollIntoView());
  return true;
}

/** Move the selected run past its previous (-1) or next (1) sibling. */
export function moveBlockRange(state: EditorState, range: BlockRange, direction: -1 | 1): Transaction | null {
  const tr = state.tr;
  if (direction < 0) {
    const before = state.doc.resolve(range.from).nodeBefore;
    if (!before || before.type.name !== BLOCK) return null;
    tr.delete(range.from - before.nodeSize, range.from);
    tr.insert(range.to - before.nodeSize, before);
    const next = { from: range.from - before.nodeSize, to: range.to - before.nodeSize };
    return tr.setSelection(createBlockSelection(tr.doc, next)).scrollIntoView();
  }
  const after = state.doc.resolve(range.to).nodeAfter;
  if (!after || after.type.name !== BLOCK) return null;
  tr.delete(range.to, range.to + after.nodeSize);
  tr.insert(range.from, after);
  const next = { from: range.from + after.nodeSize, to: range.to + after.nodeSize };
  return tr.setSelection(createBlockSelection(tr.doc, next)).scrollIntoView();
}

export type BlockSelectionActions = {
  remove: (ids: string[]) => void;
  duplicate: (ids: string[]) => void;
};

/** Which end of the selection Shift+Arrow last grew, so the other way shrinks it. */
const extendSide = new WeakMap<EditorView, "up" | "down">();

/**
 * Shift+Up/Down from a caret or text selection: once the text can't extend any
 * further in that direction (top or bottom line of the block), it turns into a
 * block selection of the block and the one above or below. A text selection that
 * already spans several blocks turns into a selection of those blocks.
 */
function extendTextIntoBlocks(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
  if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
  const { state } = view;
  const { selection } = state;
  if (isBlockSelection(selection)) return false;
  const up = event.key === "ArrowUp";
  const headBlock = innermostBlock(state.doc, selection.head);
  const anchorBlock = innermostBlock(state.doc, selection.anchor);
  if (headBlock === null || anchorBlock === null) return false;
  // Inside one block the browser extends the text line by line first.
  if (headBlock === anchorBlock && selection instanceof TextSelection && !view.endOfTextblock(up ? "up" : "down")) return false;
  const ids = [anchorBlock, headBlock].map((pos) => String(state.doc.nodeAt(pos)!.attrs.id));
  const range = rangeForBlocks(state.doc, ids);
  if (!range) return false;
  const $edge = state.doc.resolve(up ? range.from : range.to);
  const neighbor = up ? $edge.nodeBefore : $edge.nodeAfter;
  // Spanning blocks already, or nothing further that way: select what's covered.
  if (headBlock === anchorBlock && neighbor?.type.name === BLOCK) {
    if (up) range.from -= neighbor.nodeSize;
    else range.to += neighbor.nodeSize;
  }
  extendSide.set(view, up ? "up" : "down");
  view.dispatch(state.tr.setSelection(createBlockSelection(state.doc, range)).scrollIntoView());
  return true;
}

/** Position before the innermost block containing `pos`. */
function innermostBlock(doc: PMNode, pos: number): number | null {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === BLOCK) return $pos.before(depth);
  }
  return null;
}

function handleBlockSelectionKey(view: EditorView, event: KeyboardEvent, actions: BlockSelectionActions): boolean {
  const { state } = view;
  const selection = state.selection;
  const ids = selectedBlockIds(selection);
  if (event.isComposing) return false;
  if (!ids.length) return extendTextIntoBlocks(view, event);
  const mod = event.metaKey || event.ctrlKey;
  const range = { from: selection.from, to: selection.to };

  switch (event.key) {
    case "Backspace":
    case "Delete":
      if (mod || event.altKey) return false;
      actions.remove(ids);
      return true;
    case "Escape":
      clearBlockSelection(view);
      return true;
    case "Enter":
      // Enter goes back to editing the last selected block.
      if (!mod && !event.altKey && !event.shiftKey) caretInBlock(view, selectedEdge(state, "end"), "end");
      return true;
    case "ArrowUp":
    case "ArrowDown": {
      const up = event.key === "ArrowUp";
      if (mod && event.shiftKey) {
        const tr = moveBlockRange(state, range, up ? -1 : 1);
        if (tr) view.dispatch(tr);
        return true;
      }
      if (mod || event.altKey) return false;
      if (event.shiftKey) {
        extendRange(view, up);
        return true;
      }
      extendSide.delete(view);
      stepSelection(view, up);
      return true;
    }
    case "ArrowLeft":
    case "ArrowRight":
      if (mod || event.altKey || event.shiftKey) return false;
      if (!caretInBlock(view, selectedEdge(state, event.key === "ArrowLeft" ? "start" : "end"), event.key === "ArrowLeft" ? "start" : "end")) {
        clearBlockSelection(view);
      }
      return true;
    case "Tab":
      return true;
  }

  if (mod && !event.altKey && !event.shiftKey) {
    const key = event.key.toLowerCase();
    if (key === "d") {
      actions.duplicate(ids);
      return true;
    }
    if (key === "a") {
      const first = state.doc.firstChild;
      if (first) {
        const top = { from: 1, to: 1 + first.content.size };
        view.dispatch(state.tr.setSelection(createBlockSelection(state.doc, top)));
      }
      return true;
    }
    // Copy, cut, undo and the rest stay with the editor.
    return false;
  }

  // Typing over a block selection would scatter text across blocks; ignore it.
  return event.key.length === 1 && !event.altKey;
}

/** Position before the first or last selected block. */
function selectedEdge(state: EditorState, side: "start" | "end"): number {
  const nodes = selectedBlockNodes(state.selection);
  if (side === "start" || !nodes.length) return state.selection.from;
  return state.selection.to - nodes[nodes.length - 1].nodeSize;
}

/** Arrow keys move a block selection to the block above or below. */
function stepSelection(view: EditorView, up: boolean): void {
  const { state } = view;
  const blocks = blocksInOrder(state.doc);
  const target = up
    ? [...blocks].reverse().find((block) => block.pos < state.selection.from)
    : blocks.find((block) => block.pos >= state.selection.to);
  if (!target) return;
  view.dispatch(
    state.tr.setSelection(createBlockSelection(state.doc, { from: target.pos, to: target.pos + target.node.nodeSize })).scrollIntoView(),
  );
}

/** Shift+Arrow grows the selection by a sibling, or shrinks it from the end last grown. */
function extendRange(view: EditorView, up: boolean): void {
  const { state } = view;
  const nodes = selectedBlockNodes(state.selection);
  let { from, to } = state.selection;
  const side = extendSide.get(view);
  if (up && side === "down" && nodes.length > 1) {
    to -= nodes[nodes.length - 1].nodeSize;
  } else if (!up && side === "up" && nodes.length > 1) {
    from += nodes[0].nodeSize;
  } else if (up) {
    const before = state.doc.resolve(from).nodeBefore;
    if (!before || before.type.name !== BLOCK) return;
    from -= before.nodeSize;
    extendSide.set(view, "up");
  } else {
    const after = state.doc.resolve(to).nodeAfter;
    if (!after || after.type.name !== BLOCK) return;
    to += after.nodeSize;
    extendSide.set(view, "down");
  }
  if (from >= to) return;
  view.dispatch(state.tr.setSelection(createBlockSelection(state.doc, { from, to })).scrollIntoView());
}

/**
 * Highlights every block in a block selection, hides the text highlight the
 * browser would otherwise paint across it, and gives the selection its keys.
 */
export function blockSelectionPlugin(actions: BlockSelectionActions): Plugin {
  return new Plugin({
    key: blockSelectionKey,
    props: {
      decorations(state) {
        const { selection } = state;
        if (!isBlockSelection(selection)) return null;
        const decorations: Decoration[] = [];
        let pos = selection.from;
        for (const node of selectedBlockNodes(selection)) {
          decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: SELECTED_CLASS }));
          pos += node.nodeSize;
        }
        return DecorationSet.create(state.doc, decorations);
      },
      attributes(state): Record<string, string> {
        return isBlockSelection(state.selection) ? { class: "has-block-selection" } : {};
      },
      handleKeyDown(view, event) {
        return handleBlockSelectionKey(view, event, actions);
      },
      handleTextInput(view) {
        return isBlockSelection(view.state.selection);
      },
      handleDOMEvents: {
        // The marquee claims a press by preventing its default; keep the
        // editor from also starting a text selection from it.
        mousedown(_view, event) {
          return event.defaultPrevented;
        },
      },
    },
  });
}
