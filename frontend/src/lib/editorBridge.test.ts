import { describe, expect, it } from "vitest";
import { editorBridge, type EditorHandle } from "./editorBridge";

const stats = { wordCount: 2, blockCount: 1, text: "hello world", outline: [] };

function handle(): EditorHandle {
  return {
    getJSON: () => "[]",
    getStats: () => stats,
    insertBlocks: async () => undefined,
    insertPageLink: async () => undefined,
    openPagePicker: () => undefined,
    scrollToBlock: () => undefined,
    focus: () => undefined,
    focusTitle: () => undefined,
  };
}

describe("editor bridge", () => {
  it("registers and disposes handles", () => {
    const first = handle();
    const dispose = editorBridge.register("pg_test", first);
    expect(editorBridge.has("pg_test")).toBe(true);
    expect(editorBridge.get("pg_test")?.getStats()).toBe(stats);
    dispose();
    expect(editorBridge.has("pg_test")).toBe(false);
  });

  it("does not let an old dispose remove a newer handle", () => {
    const oldHandle = handle();
    const newHandle = handle();
    const disposeOld = editorBridge.register("pg_replace", oldHandle);
    const disposeNew = editorBridge.register("pg_replace", newHandle);
    expect(editorBridge.get("pg_replace")).toBe(newHandle);
    disposeOld();
    expect(editorBridge.get("pg_replace")).toBe(newHandle);
    disposeNew();
  });
});
