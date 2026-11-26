export interface OutlineItem {
  id: string;
  text: string;
  level: number;
}

export interface EditorStats {
  wordCount: number;
  blockCount: number;
  text: string;
  outline: OutlineItem[];
}

/** A block as seen by plugins and the assistant: stable id, type, plain text. */
export interface BlockSummary {
  id: string;
  type: string;
  text: string;
  props?: Record<string, unknown>;
  children?: BlockSummary[];
}

export type InsertPosition = "cursor" | "start" | "end" | "before" | "after";

export interface EditorSelection {
  text: string;
  blockIds: string[];
  cursorBlockId: string;
}

/** Inline styles plugins can apply with editor.formatText. */
export interface TextStyles {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  textColor?: string;
  backgroundColor?: string;
}

export interface TextFormat {
  styles?: TextStyles;
  /** "toggle" (default) flips on/off styles; "add" and "remove" set them. */
  mode?: "toggle" | "add" | "remove";
  /** Turn the selection into a link to this URL ("" removes nothing; use the link toolbar). */
  link?: string;
  /** Format these whole blocks instead of the current selection. */
  blockIds?: string[];
}

export interface EditorHandle {
  getJSON: () => string;
  /** Whole document (or the given blocks) as Markdown. Lossy for custom blocks. */
  getMarkdown?: (blockIds?: string[]) => string;
  getBlocks?: () => BlockSummary[];
  getSelection?: () => EditorSelection;
  /** One block, with its children, parent and neighbours. */
  getBlock?: (blockId: string) => (BlockSummary & { parentId: string; prevId: string; nextId: string }) | undefined;
  /** Move blocks one step up/down, or before/after another block. Ids are kept. */
  moveBlocks?: (blockIds: string[], move: { direction?: "up" | "down"; targetBlockId?: string; placement?: "before" | "after" }) => Promise<void>;
  /** Type plain text at the cursor, replacing the selection. */
  insertText?: (text: string) => Promise<void>;
  /** Bold/italic/colour/link the selection (or whole blocks). */
  formatText?: (format: TextFormat) => Promise<void>;
  /** Put the cursor at the start/end of a block, or select a run of blocks. */
  select?: (blockId: string, options: { endBlockId?: string; placement?: "start" | "end" }) => void;
  /** Insert Markdown relative to the cursor, the document edges, or a block. Returns new block ids. */
  insertMarkdown?: (markdown: string, position: InsertPosition, blockId?: string) => Promise<string[]>;
  /** Replace blocks with blocks parsed from Markdown. Returns new block ids. */
  replaceBlocks?: (blockIds: string[], markdown: string) => Promise<string[]>;
  updateBlock?: (blockId: string, patch: { type?: string; text?: string; props?: Record<string, unknown> }) => Promise<void>;
  removeBlocks?: (blockIds: string[]) => Promise<void>;
  /** Insert a custom (plugin/layer) block at the cursor or after a block. Returns its id. */
  insertCustomBlock?: (kind: string, data: unknown, afterBlockId?: string) => Promise<string>;
  getCustomBlock?: (blockId: string) => { kind: string; data: unknown } | undefined;
  setCustomBlockData?: (blockId: string, data: unknown) => Promise<void>;
  /** Replace the whole document with Markdown. */
  setMarkdown?: (markdown: string) => Promise<void>;
  undo?: () => boolean;
  redo?: () => boolean;
  getStats: () => EditorStats;
  insertBlocks: (blocks: unknown[]) => Promise<void>;
  insertPageLink: (pageId: string) => Promise<void>;
  openPagePicker: () => void;
  scrollToBlock: (blockId: string) => void;
  focus: () => void;
  focusTitle: () => void;
  /** Open the page's find bar (with the Replace row when `replace` is set). */
  openFind?: (replace?: boolean) => void;
}

const handles = new Map<string, EditorHandle>();
const selectionListeners = new Set<(pageId: string) => void>();

export const editorBridge = {
  register(pageId: string, handle: EditorHandle): () => void {
    handles.set(pageId, handle);
    return () => {
      if (handles.get(pageId) === handle) handles.delete(pageId);
    };
  },
  get(pageId: string): EditorHandle | undefined {
    return handles.get(pageId);
  },
  has(pageId: string): boolean {
    return handles.has(pageId);
  },
  /** Called by the editor when its cursor or selection moved. */
  selectionChanged(pageId: string) {
    for (const listener of selectionListeners) listener(pageId);
  },
  onSelectionChange(listener: (pageId: string) => void): () => void {
    selectionListeners.add(listener);
    return () => selectionListeners.delete(listener);
  },
};
