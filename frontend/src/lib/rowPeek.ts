import { create } from "zustand";
import { useAppStore } from "../store";
import type { OpenMode } from "./database";

export interface RowPeekState {
  /** Row page shown in a peek, or "" when closed. */
  rowId: string;
  mode: "modal" | "side";
  /** Rows of the view it was opened from, in order, for previous/next. */
  siblings: string[];
  open: (rowId: string, mode: "modal" | "side", siblings?: string[]) => void;
  setMode: (mode: "modal" | "side") => void;
  close: () => void;
}

export const useRowPeek = create<RowPeekState>((set, get) => ({
  rowId: "",
  mode: "modal",
  siblings: [],
  open: (rowId, mode, siblings) => {
    const previous = get().rowId;
    if (previous && previous !== rowId) void useAppStore.getState().saveNow(previous);
    set({ rowId, mode, siblings: siblings ?? get().siblings });
  },
  setMode: (mode) => set({ mode }),
  close: () => {
    const previous = get().rowId;
    if (previous) void useAppStore.getState().saveNow(previous);
    set({ rowId: "", siblings: [] });
  },
}));

/**
 * Opens a row page the way a view asks: a peek over the app, a new tab, or
 * in place of the current tab. A page that is already open in a tab is
 * focused there instead, so one page never has two live editors.
 */
export async function openRowIn(mode: OpenMode, rowId: string, siblings?: string[]): Promise<void> {
  const app = useAppStore.getState();
  if (!app.pages.some((page) => page.id === rowId)) return;
  const peek = useRowPeek.getState();
  if (mode === "modal" || mode === "side") {
    if (app.tabs.includes(rowId)) {
      peek.close();
      await app.selectPage(rowId);
      return;
    }
    const loaded = await app.ensurePageLoaded(rowId);
    if (loaded) peek.open(rowId, mode, siblings);
    return;
  }
  if (peek.rowId) peek.close();
  await app.selectPage(rowId, { replace: mode === "current" });
}
