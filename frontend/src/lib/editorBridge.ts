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

export interface EditorHandle {
  getJSON: () => string;
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
