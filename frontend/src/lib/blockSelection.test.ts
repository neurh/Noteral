import { describe, expect, it } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { EditorState } from "prosemirror-state";
import {
  createBlockSelection,
  isBlockSelection,
  moveBlockRange,
  rangeForBlocks,
  selectedBlockIds,
} from "./blockSelection";

function setup() {
  const editor = BlockNoteEditor.create({
    initialContent: [
      { id: "a", type: "paragraph", content: "A" },
      {
        id: "b",
        type: "bulletListItem",
        content: "B",
        children: [
          { id: "b1", type: "paragraph", content: "B1" },
          { id: "b2", type: "paragraph", content: "B2" },
        ],
      },
      { id: "c", type: "paragraph", content: "C" },
    ],
  });
  return EditorState.create({ doc: editor.prosemirrorState.doc, plugins: editor.prosemirrorState.plugins });
}

function idsOf(state: EditorState, ids: string[]) {
  const range = rangeForBlocks(state.doc, ids);
  if (!range) return null;
  return selectedBlockIds(createBlockSelection(state.doc, range));
}

describe("block selection ranges", () => {
  it("selects a run of siblings", () => {
    const state = setup();
    expect(idsOf(state, ["a", "c"])).toEqual(["a", "b", "c"]);
    expect(idsOf(state, ["b1", "b2"])).toEqual(["b1", "b2"]);
  });

  it("lifts mixed depths to the level they share", () => {
    const state = setup();
    // A parent and its child select the parent.
    expect(idsOf(state, ["b", "b2"])).toEqual(["b"]);
    // A child and its parent's next sibling select the parent and that sibling.
    expect(idsOf(state, ["b2", "c"])).toEqual(["b", "c"]);
  });

  it("recognises its own selections", () => {
    const state = setup();
    const range = rangeForBlocks(state.doc, ["a"])!;
    expect(isBlockSelection(createBlockSelection(state.doc, range))).toBe(true);
    expect(isBlockSelection(state.selection)).toBe(false);
  });

  it("moves a selected run past its sibling and keeps it selected", () => {
    let state = setup();
    const range = rangeForBlocks(state.doc, ["a", "b"])!;
    state = state.apply(state.tr.setSelection(createBlockSelection(state.doc, range)));
    const tr = moveBlockRange(state, { from: state.selection.from, to: state.selection.to }, 1)!;
    state = state.apply(tr);
    const order: string[] = [];
    state.doc.firstChild!.forEach((node) => order.push(String(node.attrs.id)));
    expect(order).toEqual(["c", "a", "b"]);
    expect(selectedBlockIds(state.selection)).toEqual(["a", "b"]);
    // Nothing above the top block to move past.
    expect(moveBlockRange(state, rangeForBlocks(state.doc, ["c"])!, -1)).toBeNull();
  });
});
