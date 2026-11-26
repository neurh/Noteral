import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, type Block, type BlockNoteEditor } from "@blocknote/core";
import { en as englishDictionary } from "@blocknote/core/locales";
import {
  BasicTextStyleButton,
  FormattingToolbar,
  FormattingToolbarController,
  SideMenuController,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  getFormattingToolbarItems,
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { Blocks, FileSymlink, ImagePlus, Move, Puzzle, RefreshCw, SmilePlus, Table2, X } from "lucide-react";
import { api } from "../lib/api";
import { fileToBase64 } from "../lib/base64";
import { coverPositionOf, coverStyle, isPositionableCover, withCoverPosition, type CoverPosition } from "../lib/covers";
import { commandRegistry } from "../lib/commands";
import { editorBridge, type BlockSummary, type InsertPosition } from "../lib/editorBridge";
import { embedsToMarkdown, markdownToEmbedBlocks } from "../lib/markdownEmbeds";
import { statsOfDoc, type DocNode } from "../lib/docStats";
import { kindOf, useAppStore, type LoadedDocument } from "../store";
import { defaultSchema, newView, serializeSchema } from "../lib/database";
import { serializeRefs } from "../lib/databaseRefs";
import { updateSchemaOf } from "./database/useDatabase";
import { databaseBlockSpec } from "./database/DatabaseBlock";
import { CustomNodeView, useNodeType } from "./CustomNodeView";
import { customBlockSpec, parseBlockData, serializeBlockData } from "./CustomBlock";
import { useContributions } from "../lib/contributions";
import { DatabaseView } from "./database/DatabaseView";
import { RowProperties } from "./database/RowProperties";
import { FolderView } from "./FolderView";
import { pageLinkSpec } from "./PageLink";
import { PageIcon, parsePageIcon } from "./PageIcon";
import { PagePickerDialog } from "./PagePickerDialog";
import { FindBar, type FindRequest } from "./FindBar";
import { rankSlashItems } from "../lib/slashMenu";
import { blockSelectionExtension } from "../lib/blockActions";
import { NoteralSideMenu } from "./BlockHandleMenu";
import { useBlockMarquee } from "./useBlockMarquee";

const IconPickerDialog = lazy(() => import("./IconPickerDialog").then((module) => ({ default: module.IconPickerDialog })));
const CoverPickerDialog = lazy(() => import("./CoverPickerDialog").then((module) => ({ default: module.CoverPickerDialog })));
const preloadIconPicker = () => { void import("./IconPickerDialog"); };
const preloadCoverPicker = () => { void import("./CoverPickerDialog"); };

const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, database: databaseBlockSpec(), custom: customBlockSpec() },
  inlineContentSpecs: { ...defaultInlineContentSpecs, pageLink: pageLinkSpec },
});

type EditorView = BlockNoteEditor["prosemirrorView"];

const dictionary = {
  ...englishDictionary,
  placeholders: {
    ...englishDictionary.placeholders,
    default: "Type '/' for commands",
    emptyDocument: "Start writing, or type '/' for commands",
  },
};

/**
 * BlockNote's toolbar, with inline code beside the other text styles and the
 * link button next to them rather than at the far end.
 */
function EditorFormattingToolbar() {
  const items = getFormattingToolbarItems();
  const link = items.find((item) => item.key === "createLinkButton");
  const ordered = items.flatMap((item) => {
    if (item.key === "createLinkButton") return [];
    if (item.key === "strikeStyleButton") {
      return [item, <BasicTextStyleButton key="codeStyleButton" basicTextStyle="code" />, ...(link ? [link] : [])];
    }
    return [item];
  });
  return <FormattingToolbar>{ordered}</FormattingToolbar>;
}

/** True when the caret sits on the first visual line of the document's first block. */
function caretAtDocumentTop(view: EditorView): boolean {
  const { selection } = view.state;
  if (!selection.empty) return false;
  const { $from } = selection;
  // doc > blockGroup > blockContainer > content: every ancestor must be a first child.
  for (let depth = 0; depth < $from.depth; depth += 1) {
    if ($from.index(depth) !== 0) return false;
  }
  return view.endOfTextblock("up");
}

function inlineText(content: unknown, titleFor?: (id: string) => string | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      if (record.type === "pageLink") {
        const props = record.props as { pageId?: string } | undefined;
        const id = props?.pageId ?? "";
        return titleFor?.(id) ?? "page";
      }
      if (typeof record.text === "string") return record.text;
      if (Array.isArray(record.content)) return inlineText(record.content, titleFor);
      return "";
    })
    .join("");
}

function clampCoverPosition(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function parseDocument(raw: string): Block[] {
  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value)) return value as Block[];
    if (value && Array.isArray(value.blocks)) return value.blocks as Block[];
  } catch {
    // Fall through to an empty paragraph.
  }
  return [{ type: "paragraph", content: "" } as unknown as Block];
}

function summarizeBlock(block: unknown, titleFor: (id: string) => string | undefined): BlockSummary {
  const record = block as unknown as { id: string; type: string; content?: unknown; props?: Record<string, unknown>; children?: Block[] };
  const out: BlockSummary = { id: record.id, type: record.type, text: inlineText(record.content, titleFor) };
  // Drop styling defaults so summaries stay short; keep meaningful props (level, checked, language, url…).
  const props = Object.fromEntries(
    Object.entries(record.props ?? {}).filter(([key, value]) => {
      if (key === "textAlignment") return value !== "left";
      return value !== "default" && value !== "" && value !== false;
    }),
  );
  if (record.type === "custom" && typeof props.data === "string" && props.data.length > 400) props.data = `${props.data.slice(0, 400)}…`;
  if (Object.keys(props).length) out.props = props;
  if (record.children?.length) out.children = record.children.map((child) => summarizeBlock(child, titleFor));
  return out;
}

function toPluginBlock(block: unknown): Record<string, unknown> {
  const input = (block ?? {}) as { type?: string; text?: string; content?: unknown; props?: Record<string, unknown>; children?: unknown[] };
  const type = typeof input.type === "string" ? input.type : "paragraph";
  if (type === "divider" || type === "pageBreak") return { type };
  const props = { ...(input.props ?? {}) };
  if (type === "heading" && props.level == null) props.level = 2;
  if (type === "codeBlock" && props.language == null) props.language = "text";
  const content = typeof input.text === "string" ? input.text : typeof input.content === "string" ? input.content : "";
  const out: Record<string, unknown> = { type, props, content };
  if (Array.isArray(input.children)) out.children = input.children.map(toPluginBlock);
  return out;
}

interface PageViewProps {
  page: LoadedDocument;
  active: boolean;
}

/** Title of any page, read on demand so editors do not re-render on every save. */
function titleOf(pageId: string): string | undefined {
  return useAppStore.getState().pages.find((item) => item.id === pageId)?.title;
}

export const PageView = memo(function PageView({ page, active }: PageViewProps) {
  const workspace = useAppStore((state) => state.workspace);
  const theme = useAppStore((state) => state.resolvedTheme);
  const spellcheck = useAppStore((state) => state.settings.spellcheck);
  const markDirty = useAppStore((state) => state.markDirty);
  const renamePage = useAppStore((state) => state.renamePage);
  const setPageAppearance = useAppStore((state) => state.setPageAppearance);
  const reloadPage = useAppStore((state) => state.reloadPage);
  const setOutline = useAppStore((state) => state.setOutline);
  const setLiveStats = useAppStore((state) => state.setLiveStats);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [coverOffset, setCoverOffset] = useState<CoverPosition>(() => coverPositionOf(page.cover));
  const [coverEditing, setCoverEditing] = useState(false);
  const [coverDragging, setCoverDragging] = useState(false);
  const [title, setTitle] = useState(page.title);
  const ready = useRef(false);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [find, setFind] = useState<FindRequest | null>(null);
  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coverOffsetRef = useRef(coverOffset);
  const coverDragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number; width: number; height: number } | null>(null);
  const initialContent = useMemo(() => parseDocument(page.docJson), [page.id, page.loadVersion]);
  const canRepositionCover = isPositionableCover(page.cover);
  const cover = coverStyle(withCoverPosition(page.cover, coverOffset.x, coverOffset.y));
  const icon = parsePageIcon(page.icon) ? page.icon : "";
  const kind = page.kind;
  const nodeData = useAppStore((state) => (kind === "custom" ? state.pages.find((item) => item.id === page.id)?.data : undefined));
  const nodeType = useNodeType(nodeData);
  const fullCustom = kind === "custom" && (!nodeType || (nodeType.layout ?? "full") === "full");
  const parentId = useAppStore((state) => state.pages.find((item) => item.id === page.id)?.parentId ?? page.parentId);
  const parentIsDatabase = useAppStore((state) => kindOf(state.pages.find((item) => item.id === parentId)) === "database");
  const createItem = useAppStore((state) => state.createItem);
  const [databasePickerOpen, setDatabasePickerOpen] = useState(false);
  const databaseCursor = useRef<string | undefined>(undefined);

  useEffect(() => {
    // The pickers are split out of the initial bundle. Warm them once the page
    // is idle so the first click opens with no perceptible wait.
    const timer = setTimeout(() => {
      preloadIconPicker();
      preloadCoverPicker();
    }, 900);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const next = coverPositionOf(page.cover);
    coverOffsetRef.current = next;
    setCoverOffset(next);
    coverDragRef.current = null;
    setCoverDragging(false);
    if (!page.cover) setCoverEditing(false);
  }, [page.cover]);

  useEffect(() => {
    setCoverEditing(false);
    coverDragRef.current = null;
    setCoverDragging(false);
  }, [page.id]);

  const editor = useCreateBlockNote(
    {
      schema,
      initialContent: initialContent as never,
      animations: false,
      dictionary,
      extensions: [blockSelectionExtension],
      uploadFile: async (file: File) => {
        if (!workspace) throw new Error("No workspace is open");
        const data = await fileToBase64(file);
        const asset = await api.saveAsset(workspace.id, page.id, file.name, data);
        return asset.url;
      },
    },
    [page.id, page.loadVersion],
  );

  useBlockMarquee({
    scrollRef,
    getView: () => editor.prosemirrorView ?? null,
    isEditable: () => kind === "page" && editor.isEditable,
    onClickBelow: continueBelow,
  });

  useEffect(() => {
    setTitle(page.title);
  }, [page.id, page.title]);

  useEffect(() => {
    ready.current = false;
    const timer = setTimeout(() => {
      ready.current = true;
    }, 120);
    return () => clearTimeout(timer);
  }, [page.id, page.loadVersion, page.docJson]);

  const publishStats = useCallback(() => {
    if (statsTimer.current) {
      clearTimeout(statsTimer.current);
      statsTimer.current = null;
    }
    const stats = statsOfDoc(editor.prosemirrorState.doc as unknown as DocNode, titleOf);
    setOutline(page.id, stats.outline);
    setLiveStats(page.id, stats.wordCount, stats.blockCount);
  }, [editor, page.id, setOutline, setLiveStats]);

  useEffect(() => {
    // `active` matters: the store only accepts stats for the active page, and
    // switching tabs must refresh the shared status bar/inspector immediately.
    publishStats();
  }, [active, publishStats]);

  useEffect(() => () => {
    if (statsTimer.current) clearTimeout(statsTimer.current);
  }, []);

  useEffect(() => {
    const parseMarkdown = (markdown: string) =>
      markdownToEmbedBlocks(markdown, (text) => editor.tryParseMarkdownToBlocks(text) as never, {
        lookup: (id) => (editor.getBlock(id) as never) ?? undefined,
      });
    const handle = {
      getJSON: () => JSON.stringify(editor.document),
      getStats: () => statsOfDoc(editor.prosemirrorState.doc as unknown as DocNode, titleOf, true),
      insertBlocks: async (blocks: unknown[]) => {
        const converted = blocks.map(toPluginBlock);
        if (!converted.length) return;
        const cursor = editor.getTextCursorPosition().block;
        const currentText = inlineText(cursor.content, titleOf);
        if (cursor.type === "paragraph" && !currentText.trim()) {
          editor.replaceBlocks([cursor], converted as never);
        } else {
          editor.insertBlocks(converted as never, cursor, "after");
        }
        editor.focus();
      },
      getMarkdown: (blockIds?: string[]) => {
        const all = editor.document;
        const chosen = blockIds?.length ? all.filter((block) => blockIds.includes(block.id)) : all;
        // Databases and custom blocks become `<!-- database:ID -->` / `<!-- block:ID -->` lines.
        return embedsToMarkdown(chosen as never, (run) => editor.blocksToMarkdownLossy(run as never), titleOf);
      },
      getBlocks: () => editor.document.map((block) => summarizeBlock(block, titleOf)),
      getSelection: () => {
        const selection = editor.getSelection();
        const cursor = editor.getTextCursorPosition().block;
        return {
          text: editor.getSelectedText(),
          blockIds: selection ? selection.blocks.map((block) => block.id) : [cursor.id],
          cursorBlockId: cursor.id,
        };
      },
      insertMarkdown: async (markdown: string, position: InsertPosition, blockId?: string) => {
        const parsed = parseMarkdown(markdown);
        if (!parsed.length) return [];
        const doc = editor.document;
        let inserted: { id: string }[];
        if (position === "start") {
          inserted = editor.insertBlocks(parsed as never, doc[0], "before");
        } else if (position === "end") {
          const last = doc[doc.length - 1];
          const lastEmpty = last.type === "paragraph" && !inlineText(last.content, titleOf).trim();
          inserted = lastEmpty ? editor.replaceBlocks([last], parsed as never).insertedBlocks : editor.insertBlocks(parsed as never, last, "after");
        } else if ((position === "before" || position === "after") && blockId) {
          if (!editor.getBlock(blockId)) throw new Error(`Block ${blockId} does not exist`);
          inserted = editor.insertBlocks(parsed as never, blockId, position);
        } else {
          const cursor = editor.getTextCursorPosition().block;
          const empty = cursor.type === "paragraph" && !inlineText(cursor.content, titleOf).trim();
          inserted = empty ? editor.replaceBlocks([cursor], parsed as never).insertedBlocks : editor.insertBlocks(parsed as never, cursor, "after");
        }
        return inserted.map((block) => block.id);
      },
      replaceBlocks: async (blockIds: string[], markdown: string) => {
        const missing = blockIds.filter((id) => !editor.getBlock(id));
        if (missing.length) throw new Error(`Unknown block ids: ${missing.join(", ")}`);
        const parsed = parseMarkdown(markdown);
        const result = editor.replaceBlocks(blockIds, (parsed.length ? parsed : [{ type: "paragraph" }]) as never);
        return result.insertedBlocks.map((block) => block.id);
      },
      updateBlock: async (blockId: string, patch: { type?: string; text?: string; props?: Record<string, unknown> }) => {
        if (!editor.getBlock(blockId)) throw new Error(`Block ${blockId} does not exist`);
        const update: Record<string, unknown> = {};
        if (patch.type) update.type = patch.type;
        if (patch.props) update.props = patch.props;
        if (typeof patch.text === "string") update.content = patch.text;
        editor.updateBlock(blockId, update as never);
      },
      removeBlocks: async (blockIds: string[]) => {
        const existing = blockIds.filter((id) => editor.getBlock(id));
        if (existing.length) editor.removeBlocks(existing);
      },
      insertCustomBlock: async (kind: string, data: unknown, afterBlockId?: string) => {
        const block = { type: "custom", props: { kind, data: serializeBlockData(data) } } as never;
        let inserted: { id: string }[];
        if (afterBlockId) {
          if (!editor.getBlock(afterBlockId)) throw new Error(`Block ${afterBlockId} does not exist`);
          inserted = editor.insertBlocks([block], afterBlockId, "after");
        } else {
          const cursor = editor.getTextCursorPosition().block;
          const empty = cursor.type === "paragraph" && !inlineText(cursor.content, titleOf).trim();
          inserted = empty ? editor.replaceBlocks([cursor], [block]).insertedBlocks : editor.insertBlocks([block], cursor, "after");
        }
        const id = inserted[0]?.id ?? "";
        const doc = editor.document;
        if (doc[doc.length - 1]?.id === id) editor.insertBlocks([{ type: "paragraph" } as never], id, "after");
        return id;
      },
      getCustomBlock: (blockId: string) => {
        const block = editor.getBlock(blockId);
        if (!block || block.type !== ("custom" as never)) return undefined;
        const props = block.props as unknown as { kind: string; data: string };
        return { kind: props.kind, data: parseBlockData(props.data) };
      },
      setCustomBlockData: async (blockId: string, data: unknown) => {
        const block = editor.getBlock(blockId);
        if (!block || block.type !== ("custom" as never)) throw new Error(`Block ${blockId} is not a custom block`);
        editor.updateBlock(blockId, { props: { data: serializeBlockData(data) } } as never);
      },
      setMarkdown: async (markdown: string) => {
        const parsed = parseMarkdown(markdown);
        editor.replaceBlocks(editor.document, (parsed.length ? parsed : [{ type: "paragraph" }]) as never);
      },
      undo: () => editor.undo(),
      redo: () => editor.redo(),
      insertPageLink: async (pageId: string) => {
        editor.insertInlineContent([{ type: "pageLink", props: { pageId } }] as never, { updateSelection: true });
        editor.focus();
      },
      openPagePicker: () => setPickerOpen(true),
      scrollToBlock: (blockId: string) => {
        // Scope to this editor: the same page can be open in two panes, and
        // block ids are only unique within one document.
        const root = editor.domElement;
        const target = root
          ? [...root.querySelectorAll<HTMLElement>(".bn-block-outer[data-id]")].find((element) => element.dataset.id === blockId)
          : undefined;
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        const block = editor.getBlock(blockId);
        if (block && editor.isEditable) {
          try {
            editor.setTextCursorPosition(block, "end");
          } catch {
            // Blocks without inline content cannot hold a caret; scrolling is enough.
          }
        }
      },
      openFind: kind !== "page" ? undefined : (replace = false) => {
        const selected = editor.prosemirrorState.selection;
        const text = selected.empty ? "" : editor.prosemirrorState.doc.textBetween(selected.from, selected.to, " ");
        setFind({ nonce: Date.now(), query: text.includes("\n") || text.length > 200 ? "" : text, replace });
      },
      focus: () => editor.focus(),
      focusTitle: () => {
        const input = titleInputRef.current;
        if (!input) return;
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        input.focus();
        input.select();
      },
    };
    return editorBridge.register(page.id, handle);
  }, [editor, page.id, kind]);

  useEffect(() => {
    if (active && kind === "page") {
      const timer = setTimeout(() => {
        if (!editorBridge.has(page.id)) return;
        // Do not steal focus from the title field or an open dialog.
        const current = document.activeElement;
        if (current && (current.tagName === "INPUT" || current.tagName === "TEXTAREA")) return;
        // A fresh, blank page starts by naming it; anything else resumes writing.
        const blocks = editor.document;
        const blank = blocks.length <= 1 && (!blocks[0] || (blocks[0].type === "paragraph" && !inlineText(blocks[0].content).trim()));
        const untitled = !page.title.trim() || page.title === "Untitled";
        const field = titleInputRef.current;
        if (blank && untitled && field) {
          field.focus();
          field.select();
          return;
        }
        editor.focus();
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [active, editor, page.id, kind]);

  function commitTitle() {
    const clean = title.replace(/\s+/g, " ").trim() || "Untitled";
    setTitle(clean);
    if (clean !== page.title) void renamePage(page.id, clean);
  }

  // The title wraps like a heading instead of clipping, so it is a textarea
  // that grows with its content.
  useLayoutEffect(() => {
    const field = titleInputRef.current;
    if (!field) return;
    const fit = () => {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    };
    fit();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    observer?.observe(field.parentElement ?? field);
    return () => observer?.disconnect();
  }, [title, kind]);

  /** Moves the caret from the title into the first line of the page body. */
  function enterBody() {
    if (kind !== "page" || !editor.isEditable) return false;
    const first = editor.document[0];
    if (!first) return false;
    if (Array.isArray(first.content)) {
      editor.setTextCursorPosition(first, "start");
    } else {
      // A database or image first: give the writer a line above it.
      const [inserted] = editor.insertBlocks([{ type: "paragraph" } as never], first, "before");
      if (inserted) editor.setTextCursorPosition(inserted, "start");
    }
    editor.focus();
    return true;
  }

  function handleTitleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    const field = event.currentTarget;
    if (event.key === "Enter") {
      event.preventDefault();
      commitTitle();
      if (!enterBody()) field.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setTitle(page.title);
      requestAnimationFrame(() => field.blur());
    } else if (event.key === "ArrowDown" && !event.shiftKey) {
      // Leave the title only from its last line, as a heading would.
      const atEnd = field.selectionStart === field.value.length && field.selectionEnd === field.value.length;
      if (atEnd && enterBody()) {
        event.preventDefault();
        commitTitle();
      }
    } else if (event.key === "Tab" && !event.shiftKey && kind === "page") {
      if (enterBody()) {
        event.preventDefault();
        commitTitle();
      }
    }
  }

  function focusTitleEnd() {
    const field = titleInputRef.current;
    if (!field) return;
    field.focus();
    const end = field.value.length;
    field.setSelectionRange(end, end);
  }

  function handleEditorKeyDownCapture(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowUp" || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    if (!(event.target as HTMLElement).closest(".ProseMirror")) return;
    // ArrowUp on the first line climbs into the title, as in a single document.
    if (caretAtDocumentTop(editor.prosemirrorView)) {
      event.preventDefault();
      event.stopPropagation();
      focusTitleEnd();
    }
  }

  /** A click in the empty space under the last block continues the page there. */
  function continueBelow() {
    if (kind !== "page" || !editor.isEditable) return;
    const blocks = editor.document;
    const last = blocks[blocks.length - 1];
    if (!last) return;
    const lastIsEmptyText = last.type === "paragraph" && !inlineText(last.content, titleOf).trim();
    if (lastIsEmptyText) {
      editor.setTextCursorPosition(last, "end");
    } else {
      const [inserted] = editor.insertBlocks([{ type: "paragraph" } as never], last, "after");
      if (inserted) editor.setTextCursorPosition(inserted, "start");
    }
    editor.focus();
  }

  function persistCoverPosition() {
    const next = withCoverPosition(page.cover, coverOffsetRef.current.x, coverOffsetRef.current.y);
    if (next !== page.cover) void setPageAppearance(page.id, icon, next);
  }

  function handleCoverPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!coverEditing || !canRepositionCover || !event.isPrimary || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    coverDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: coverOffsetRef.current.x,
      baseY: coverOffsetRef.current.y,
      width: rect.width,
      height: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setCoverDragging(true);
  }

  function handleCoverPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = coverDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = {
      x: clampCoverPosition(drag.baseX + ((event.clientX - drag.startX) / Math.max(1, drag.width)) * 100),
      y: clampCoverPosition(drag.baseY + ((event.clientY - drag.startY) / Math.max(1, drag.height)) * 100),
    };
    coverOffsetRef.current = next;
    setCoverOffset(next);
  }

  function handleCoverPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = coverDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    coverDragRef.current = null;
    setCoverDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    persistCoverPosition();
  }

  function onChange() {
    if (!ready.current) return;
    // Keystrokes only flag the page; serialising happens once per autosave and
    // the status bar/outline catch up a moment after typing pauses.
    markDirty(page.id);
    if (statsTimer.current) clearTimeout(statsTimer.current);
    statsTimer.current = setTimeout(publishStats, active ? 250 : 1000);
  }

  const { blockTypes } = useContributions();
  const blockTypeItems = useMemo(
    () =>
      blockTypes.map((def) => ({
        title: def.title,
        subtext: def.description ?? `Added by ${def.owner.name}`,
        group: "Custom blocks",
        aliases: [def.type, ...(def.keywords ?? [])],
        icon: def.icon ? <PageIcon value={def.icon} size={16} /> : <Blocks size={16} />,
        onItemClick: () => {
          const cursor = editor.getTextCursorPosition().block;
          const block = { type: "custom", props: { kind: def.type, data: def.defaultData === undefined ? "" : serializeBlockData(def.defaultData) } } as never;
          const empty = cursor.type === "paragraph" && !inlineText(cursor.content, titleOf).trim();
          const inserted = empty ? editor.replaceBlocks([cursor], [block]).insertedBlocks : editor.insertBlocks([block], cursor, "after");
          const id = inserted[0]?.id;
          const doc = editor.document;
          if (id && doc[doc.length - 1]?.id === id) editor.insertBlocks([{ type: "paragraph" } as never], id, "after");
        },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, blockTypes],
  );

  const customItems = useMemo(
    () => [
      {
        title: "Link to page",
        subtext: "Add a stable internal link",
        group: "Noteral",
        aliases: ["link", "page", "internal", "reference"],
        icon: <FileSymlink size={16} />,
        onItemClick: () => setPickerOpen(true),
      },
      {
        title: "Database",
        subtext: "New database, or a view of an existing one",
        group: "Noteral",
        aliases: ["database", "table", "board", "kanban", "gallery", "calendar", "list", "db", "linked", "existing", "view", "embed"],
        icon: <Table2 size={16} />,
        onItemClick: () => {
          databaseCursor.current = editor.getTextCursorPosition().block.id;
          setDatabasePickerOpen(true);
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, page.id],
  );

  function createDatabaseBlock(nearBlockId?: string) {
    void createItem("database", page.id, { open: false, data: serializeSchema(defaultSchema()) }).then((meta) => {
      if (meta) insertDatabaseBlock(meta.id, nearBlockId);
    });
  }

  /** Shows an existing database through a new table view that belongs to this block. */
  function linkDatabaseBlock(databaseId: string, nearBlockId?: string) {
    const blockId = crypto.randomUUID();
    let viewId = "";
    updateSchemaOf(databaseId, (schema) => {
      const view = { ...newView("table", schema), owner: blockId };
      viewId = view.id;
      schema.views.push(view);
    });
    insertDatabaseBlock(databaseId, nearBlockId, { id: blockId, views: serializeRefs([{ db: databaseId, view: viewId }]) });
  }

  function insertDatabaseBlock(databaseId: string, nearBlockId?: string, extra?: { id: string; views: string }) {
    const block = { ...(extra ? { id: extra.id } : {}), type: "database", props: { databaseId, ...(extra ? { views: extra.views } : {}) } } as never;
    const target = (nearBlockId && editor.getBlock(nearBlockId)) || editor.getTextCursorPosition().block;
    const text = inlineText(target.content, titleOf);
    if (target.type === "paragraph" && !text.trim()) {
      editor.replaceBlocks([target], [block]);
    } else {
      editor.insertBlocks([block], target, "after");
    }
    // Keep a writable line after the database so typing can continue below it.
    const inserted = editor.document.find((item) => (extra ? item.id === extra.id : item.type === ("database" as never) && (item.props as { databaseId?: string }).databaseId === databaseId));
    if (inserted) {
      const index = editor.document.indexOf(inserted);
      const next = editor.document[index + 1];
      if (!next) editor.insertBlocks([{ type: "paragraph" } as never], inserted, "after");
    }
  }

  if (fullCustom) {
    // A full-page custom type: the view is the whole page, with its own scrolling.
    return (
      <div className={`page-pane custom-node-pane ${active ? "active" : ""}`} aria-hidden={!active}>
        <CustomNodeView pageId={page.id} />
      </div>
    );
  }

  return (
    <div className={`page-pane ${active ? "active" : ""}`} aria-hidden={!active}>
      {find && kind === "page" ? (
        <FindBar editor={editor} request={find} scrollRef={scrollRef} onClose={() => setFind(null)} />
      ) : null}
      <div className="page-scroll" ref={scrollRef}>
        <div className="page-document">
          <div className={`page-editor kind-${kind} ${cover ? "has-cover" : ""} ${icon ? "has-icon" : ""}`}>
            <div className="page-head">
              {cover ? (
                <div className="page-cover-wrap">
                <div
                  className={`page-cover ${coverEditing ? "editing" : ""} ${coverDragging ? "dragging" : ""}`}
                  style={cover}
                  role="img"
                  aria-label={coverEditing ? "Page cover. Drag to reposition." : "Page cover"}
                  onPointerDown={handleCoverPointerDown}
                  onPointerMove={handleCoverPointerMove}
                  onPointerUp={handleCoverPointerUp}
                  onPointerCancel={handleCoverPointerUp}
                >
                  <div className="page-cover-actions">
                    {canRepositionCover ? (
                      <button
                        type="button"
                        className={`page-cover-action ${coverEditing ? "active" : ""}`}
                        onClick={() => setCoverEditing((value) => !value)}
                        title={coverEditing ? "Finish repositioning" : "Reposition cover"}
                        aria-label={coverEditing ? "Finish repositioning cover" : "Reposition cover"}
                        aria-pressed={coverEditing}
                      >
                        <Move size={15} />
                      </button>
                    ) : null}
                    <button type="button" className="page-cover-action" onClick={() => setCoverPickerOpen(true)} onPointerEnter={preloadCoverPicker} title="Change cover" aria-label="Change cover">
                      <ImagePlus size={15} />
                    </button>
                    <button type="button" className="page-cover-action" onClick={() => { setCoverEditing(false); void setPageAppearance(page.id, icon, ""); }} title="Remove cover" aria-label="Remove cover">
                      <X size={15} />
                    </button>
                  </div>
                  {coverEditing && canRepositionCover ? (
                    <div className="page-cover-hint"><Move size={12} /> Drag to reposition</div>
                  ) : null}
                </div>
                {icon ? (
                  <button
                    type="button"
                    className="page-cover-badge"
                    onClick={() => setIconPickerOpen(true)}
                    onPointerEnter={preloadIconPicker}
                    title="Change page icon"
                    aria-label="Change page icon"
                  >
                    <PageIcon value={icon} size={52} />
                  </button>
                ) : null}
                </div>
              ) : null}
              {!icon || !cover ? (
                <div className={`page-appearance ${!cover && icon ? "with-icon" : ""}`}>
                  {!cover && icon ? (
                    <button type="button" className="page-appearance-icon" onClick={() => setIconPickerOpen(true)} onPointerEnter={preloadIconPicker} title="Change page icon" aria-label="Change page icon">
                      <PageIcon value={icon} size={46} />
                    </button>
                  ) : null}
                  <div className="page-appearance-bar">
                    {!icon ? (
                      <button type="button" className="page-appearance-button" onClick={() => setIconPickerOpen(true)} onPointerEnter={preloadIconPicker}>
                        <SmilePlus size={14} /> Add icon
                      </button>
                    ) : null}
                    {!cover ? (
                      <button type="button" className="page-appearance-button" onClick={() => setCoverPickerOpen(true)} onPointerEnter={preloadCoverPicker}>
                        <ImagePlus size={14} /> Add cover
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div className="page-title-row">
                <textarea
                  ref={titleInputRef}
                  className="page-title-input"
                  value={title}
                  rows={1}
                  onChange={(event) => setTitle(event.target.value.replace(/[\r\n]+/g, " "))}
                  onBlur={commitTitle}
                  onKeyDown={handleTitleKeyDown}
                  aria-label={kind === "database" ? "Database name" : kind === "folder" ? "Folder name" : "Page title"}
                  placeholder="Untitled"
                  spellCheck={false}
                />
              </div>
              {parentIsDatabase && kind === "page" ? <RowProperties databaseId={parentId} rowId={page.id} /> : null}
            </div>
            {page.error ? (
              <div className="save-error" role="alert">
                <span>{page.error}</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    if (window.confirm("Reload this page and discard unsaved changes?")) void reloadPage(page.id);
                  }}
                >
                  <RefreshCw size={13} /> Reload
                </button>
              </div>
            ) : null}
            {kind === "database" ? <DatabaseView databaseId={page.id} /> : null}
            {kind === "folder" ? <FolderView folderId={page.id} /> : null}
            {kind === "custom" ? <CustomNodeView pageId={page.id} /> : null}
            {kind === "page" ? (
            <div className="page-body" onKeyDownCapture={handleEditorKeyDownCapture}>
            <BlockNoteView
              editor={editor}
              theme={theme}
              slashMenu={false}
              formattingToolbar={false}
              sideMenu={false}
              spellCheck={spellcheck}
              className="noteral-editor"
              onChange={onChange}
            >
              <SideMenuController sideMenu={NoteralSideMenu} />
              <FormattingToolbarController formattingToolbar={EditorFormattingToolbar} />
              <SuggestionMenuController
                triggerCharacter="/"
                getItems={async (query: string) => {
                  const defaults = getDefaultReactSlashMenuItems(editor);
                  const pluginItems = commandRegistry
                    .getSnapshot()
                    .filter((command) => command.category === "Plugins")
                    .map((command) => ({
                      title: command.title,
                      subtext: command.description ?? "Plugin command",
                      group: "Plugins",
                      aliases: command.keywords ? command.keywords.split(/\s+/) : [],
                      icon: <Puzzle size={16} />,
                      onItemClick: () => void command.run(),
                    }));
                  return rankSlashItems([...defaults, ...customItems, ...blockTypeItems, ...pluginItems], query);
                }}
              />
            </BlockNoteView>
            <div className="page-below" aria-hidden="true" />
            </div>
            ) : null}
          </div>
        </div>
      </div>
      {iconPickerOpen ? (
        <Suspense fallback={null}>
          <IconPickerDialog
            open
            workspaceId={workspace?.id ?? ""}
            pageId={page.id}
            current={icon}
            onClose={() => setIconPickerOpen(false)}
            onPick={(value) => {
              setIconPickerOpen(false);
              void setPageAppearance(page.id, value, page.cover);
            }}
          />
        </Suspense>
      ) : null}
      {coverPickerOpen ? (
        <Suspense fallback={null}>
          <CoverPickerDialog
            open
            workspaceId={workspace?.id ?? ""}
            pageId={page.id}
            current={page.cover}
            onClose={() => setCoverPickerOpen(false)}
            onPick={(value) => {
              setCoverPickerOpen(false);
              setCoverEditing(false);
              void setPageAppearance(page.id, icon, value);
            }}
          />
        </Suspense>
      ) : null}
      {databasePickerOpen ? <PagePickerDialog
        open={databasePickerOpen}
        title="Add a database"
        subtitle="Start a new database, or show an existing one in this page."
        placeholder="Find a database…"
        emptyText="No databases match."
        filter={(item) => kindOf(item) === "database" && !item.deletedAt}
        create={{ label: "New database", hint: "An empty table, stored in this page", icon: <Table2 size={14} />, onCreate: () => createDatabaseBlock(databaseCursor.current) }}
        onClose={() => setDatabasePickerOpen(false)}
        onPick={(databaseId) => linkDatabaseBlock(databaseId, databaseCursor.current)}
      /> : null}
      {pickerOpen ? <PagePickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(pageId) => {
          const handle = editorBridge.get(page.id);
          if (handle) void handle.insertPageLink(pageId);
        }}
      /> : null}
    </div>
  );
});
