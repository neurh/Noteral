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

export interface EditorHandle {
  getJSON: () => string;
  /** Whole document (or the given blocks) as Markdown. Lossy for custom blocks. */
  getMarkdown?: (blockIds?: string[]) => string;
  getBlocks?: () => BlockSummary[];
  getSelection?: () => EditorSelection;
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
};
