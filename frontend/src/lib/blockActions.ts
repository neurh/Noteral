import type { Block, BlockNoteEditor, ExtensionFactoryInstance, PartialBlock } from "@blocknote/core";
import { blockSelectionPlugin, moveBlockRange, rangeForBlocks, selectBlocks, selectedBlockIds } from "./blockSelection";

// The page schema carries custom blocks; these helpers only touch the shared shape.
type AnyEditor = BlockNoteEditor<any, any, any>;
type AnyBlock = Block<any, any, any>;

/**
 * The blocks an action on `blockId` applies to: the whole block selection when
 * the block is part of it, otherwise just that block.
 */
export function targetBlockIds(editor: AnyEditor, blockId: string): string[] {
  const selected = selectedBlockIds(editor.prosemirrorView.state.selection);
  return selected.includes(blockId) ? selected : [blockId];
}

export function existingBlocks(editor: AnyEditor, ids: readonly string[]): AnyBlock[] {
  return ids.flatMap((id) => {
    const block = editor.getBlock(id);
    return block ? [block] : [];
  });
}

function placeCaret(editor: AnyEditor, block: AnyBlock | undefined, side: "start" | "end") {
  if (!block) return;
  try {
    editor.setTextCursorPosition(block, side);
  } catch {
    // Blocks without text (images, databases) can't hold a caret; leave the selection be.
  }
}

export function removeBlocks(editor: AnyEditor, ids: readonly string[]): void {
  const blocks = existingBlocks(editor, ids);
  if (!blocks.length) return;
  const removed = new Set(blocks.map((block) => block.id));
  const previous = editor.getPrevBlock(blocks[0]);
  const next = editor.getNextBlock(blocks[blocks.length - 1]);
  const parent = editor.getParentBlock(blocks[0]);
  const removesEverything = editor.document.every((block) => removed.has(block.id));
  let fallback: AnyBlock | undefined;
  editor.transact(() => {
    if (removesEverything) {
      // A page always keeps one empty line to type into.
      fallback = editor.replaceBlocks(blocks, [{ type: "paragraph" }]).insertedBlocks[0];
    } else {
      editor.removeBlocks(blocks);
    }
  });
  if (fallback) placeCaret(editor, fallback, "start");
  else if (previous) placeCaret(editor, editor.getBlock(previous.id), "end");
  else if (next) placeCaret(editor, editor.getBlock(next.id), "start");
  else if (parent) placeCaret(editor, editor.getBlock(parent.id), "end");
  editor.focus();
}

/** A block as a fresh insert: same content, new ids all the way down. */
function copyOf(block: AnyBlock): PartialBlock<any, any, any> {
  const { id: _id, children, ...rest } = block;
  return { ...rest, children: children.map(copyOf) } as PartialBlock<any, any, any>;
}

/** Duplicates the blocks below the last of them and selects the copies. */
export function duplicateBlocks(editor: AnyEditor, ids: readonly string[]): void {
  const blocks = existingBlocks(editor, ids);
  if (!blocks.length) return;
  const inserted = editor.insertBlocks(blocks.map(copyOf), blocks[blocks.length - 1], "after");
  selectBlocks(editor.prosemirrorView, inserted.map((block) => block.id));
}

/** Moves the blocks past their previous (-1) or next (1) sibling, keeping them selected. */
export function moveBlocks(editor: AnyEditor, ids: readonly string[], direction: -1 | 1): boolean {
  const view = editor.prosemirrorView;
  const range = rangeForBlocks(view.state.doc, ids);
  if (!range) return false;
  const tr = moveBlockRange(view.state, range, direction);
  if (!tr) return false;
  view.dispatch(tr);
  return true;
}

export function canMoveBlocks(editor: AnyEditor, ids: readonly string[], direction: -1 | 1): boolean {
  const blocks = existingBlocks(editor, ids);
  if (!blocks.length) return false;
  return direction < 0 ? Boolean(editor.getPrevBlock(blocks[0])) : Boolean(editor.getNextBlock(blocks[blocks.length - 1]));
}

export function hasInlineContent(block: AnyBlock): boolean {
  return Array.isArray(block.content);
}

export type BlockTypeChoice = { type: string; props?: Record<string, boolean | number | string> };

/** Turns every text block among `ids` into the given type, as one undo step. */
export function turnBlocksInto(editor: AnyEditor, ids: readonly string[], choice: BlockTypeChoice): void {
  const blocks = existingBlocks(editor, ids).filter(hasInlineContent);
  if (!blocks.length) return;
  editor.transact(() => {
    for (const block of blocks) editor.updateBlock(block, { type: choice.type, props: choice.props ?? {} } as never);
  });
  reselect(editor, ids);
}

export type ColorKind = "textColor" | "backgroundColor";

export function setBlocksColor(editor: AnyEditor, ids: readonly string[], kind: ColorKind, color: string): void {
  const blocks = existingBlocks(editor, ids).filter((block) => kind in (block.props as object));
  if (!blocks.length) return;
  editor.transact(() => {
    for (const block of blocks) editor.updateBlock(block, { props: { [kind]: color } } as never);
  });
  reselect(editor, ids);
}

/** Updates can rebuild nodes; keep a multi-block selection on the same blocks. */
function reselect(editor: AnyEditor, ids: readonly string[]) {
  if (ids.length > 1 || selectedBlockIds(editor.prosemirrorView.state.selection).length) {
    selectBlocks(editor.prosemirrorView, ids);
  }
}

/** Block selection (highlight + keys) for an editor, as a BlockNote extension. */
export const blockSelectionExtension: ExtensionFactoryInstance = ({ editor }) => ({
  key: "noteralBlockSelection",
  prosemirrorPlugins: [
    blockSelectionPlugin({
      remove: (ids) => removeBlocks(editor, ids),
      duplicate: (ids) => duplicateBlocks(editor, ids),
    }),
  ],
});
