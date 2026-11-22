import { lazy, Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, type Block } from "@blocknote/core";
import { SuggestionMenuController, getDefaultReactSlashMenuItems, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { FileSymlink, ImagePlus, Move, RefreshCw, SmilePlus, X } from "lucide-react";
import { api } from "../lib/api";
import { fileToBase64 } from "../lib/base64";
import { coverPositionOf, coverStyle, isPositionableCover, withCoverPosition, type CoverPosition } from "../lib/covers";
import { commandRegistry } from "../lib/commands";
import { editorBridge, type OutlineItem } from "../lib/editorBridge";
import { useAppStore, type LoadedDocument } from "../store";
import { pageLinkSpec } from "./PageLink";
import { PageIcon, parsePageIcon } from "./PageIcon";
import { PagePickerDialog } from "./PagePickerDialog";

const IconPickerDialog = lazy(() => import("./IconPickerDialog").then((module) => ({ default: module.IconPickerDialog })));
const CoverPickerDialog = lazy(() => import("./CoverPickerDialog").then((module) => ({ default: module.CoverPickerDialog })));
const preloadIconPicker = () => { void import("./IconPickerDialog"); };
const preloadCoverPicker = () => { void import("./CoverPickerDialog"); };

const schema = BlockNoteSchema.create({
  blockSpecs: defaultBlockSpecs,
  inlineContentSpecs: { ...defaultInlineContentSpecs, pageLink: pageLinkSpec },
});

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

function countWords(text: string): number {
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const latin = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, " ").match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return cjk + latin;
}

function documentStats(blocks: unknown[], titles: Map<string, string>): { wordCount: number; blockCount: number; text: string; outline: OutlineItem[] } {
  const outline: OutlineItem[] = [];
  let blockCount = 0;
  const chunks: string[] = [];
  const walk = (items: unknown[]) => {
    for (const raw of items) {
      const block = raw as Block;
      blockCount += 1;
      const text = inlineText(block.content, (id) => titles.get(id));
      if (text) chunks.push(text);
      if (block.type === "heading" && text) {
        outline.push({ id: block.id, text, level: Number((block.props as { level?: number }).level ?? 1) });
      }
      const children = (block as unknown as { children?: Block[] }).children;
      if (Array.isArray(children) && children.length) walk(children);
    }
  };
  walk(blocks);
  const text = chunks.join("\n");
  return { wordCount: countWords(text), blockCount, text, outline };
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

export function PageView({ page, active }: PageViewProps) {
  const workspace = useAppStore((state) => state.workspace);
  const pages = useAppStore((state) => state.pages);
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
  const titleInputRef = useRef<HTMLInputElement>(null);
  const initialJson = useRef(page.docJson);
  const lastJson = useRef(page.docJson);
  const coverOffsetRef = useRef(coverOffset);
  const coverDragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number; width: number; height: number } | null>(null);
  const titleFor = useMemo(() => new Map(pages.map((item) => [item.id, item.title])), [pages]);
  const initialContent = useMemo(() => parseDocument(page.docJson), [page.id, page.loadVersion]);
  const canRepositionCover = isPositionableCover(page.cover);
  const cover = coverStyle(withCoverPosition(page.cover, coverOffset.x, coverOffset.y));
  const icon = parsePageIcon(page.icon) ? page.icon : "";

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
      uploadFile: async (file: File) => {
        if (!workspace) throw new Error("No workspace is open");
        const data = await fileToBase64(file);
        const asset = await api.saveAsset(workspace.id, page.id, file.name, data);
        return asset.url;
      },
    },
    [page.id, page.loadVersion],
  );

  useEffect(() => {
    setTitle(page.title);
  }, [page.id, page.title]);

  useEffect(() => {
    ready.current = false;
    initialJson.current = page.docJson;
    lastJson.current = page.docJson;
    const timer = setTimeout(() => {
      ready.current = true;
    }, 120);
    return () => clearTimeout(timer);
  }, [page.id, page.loadVersion, page.docJson]);

  useEffect(() => {
    const stats = documentStats(editor.document, titleFor);
    setOutline(page.id, stats.outline);
    setLiveStats(page.id, stats.wordCount, stats.blockCount);
    // `active` matters: the store only accepts stats for the active page, and
    // switching tabs must refresh the shared status bar/inspector immediately.
  }, [active, editor, page.id, titleFor, setOutline, setLiveStats]);

  useEffect(() => {
    const handle = {
      getJSON: () => JSON.stringify(editor.document),
      getStats: () => documentStats(editor.document, titleFor),
      insertBlocks: async (blocks: unknown[]) => {
        const converted = blocks.map(toPluginBlock);
        if (!converted.length) return;
        const cursor = editor.getTextCursorPosition().block;
        const currentText = inlineText(cursor.content, (id) => titleFor.get(id));
        if (cursor.type === "paragraph" && !currentText.trim()) {
          editor.replaceBlocks([cursor], converted as never);
        } else {
          editor.insertBlocks(converted as never, cursor, "after");
        }
        editor.focus();
      },
      insertPageLink: async (pageId: string) => {
        editor.insertInlineContent([{ type: "pageLink", props: { pageId } }] as never, { updateSelection: true });
        editor.focus();
      },
      openPagePicker: () => setPickerOpen(true),
      scrollToBlock: (blockId: string) => {
        const target = [...document.querySelectorAll<HTMLElement>("[data-id]")].find((element) => element.dataset.id === blockId);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
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
  }, [editor, page.id, titleFor]);

  useEffect(() => {
    if (active) {
      const timer = setTimeout(() => {
        if (!editorBridge.has(page.id)) return;
        // Do not steal focus from the title field or an open dialog.
        const current = document.activeElement;
        if (current && (current.tagName === "INPUT" || current.tagName === "TEXTAREA")) return;
        editor.focus();
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [active, editor, page.id]);

  function commitTitle() {
    const clean = title.trim() || "Untitled";
    setTitle(clean);
    if (clean !== page.title) void renamePage(page.id, clean);
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

  async function onChange() {
    if (!ready.current) return;
    let json: string;
    try {
      json = JSON.stringify(editor.document);
    } catch {
      return;
    }
    if (json === lastJson.current || json === initialJson.current) return;
    lastJson.current = json;
    const stats = documentStats(editor.document, titleFor);
    markDirty(page.id, stats);
  }

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
    ],
    [],
  );

  return (
    <div className={`page-pane ${active ? "active" : ""}`} aria-hidden={!active}>
      <div className="page-scroll">
        <div className="page-document">
          <div className={`page-editor ${cover ? "has-cover" : ""} ${icon ? "has-icon" : ""}`}>
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
                <input
                  ref={titleInputRef}
                  className="page-title-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      (event.currentTarget as HTMLInputElement).blur();
                    } else if (event.key === "Escape") {
                      setTitle(page.title);
                      (event.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  aria-label="Page title"
                  spellCheck={false}
                />
              </div>
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
            <BlockNoteView
              editor={editor}
              theme={theme}
              slashMenu={false}
              spellCheck={spellcheck}
              className="noteral-editor"
              onChange={() => void onChange()}
            >
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
                      icon: <FileSymlink size={16} />,
                      onItemClick: () => void command.run(),
                    }));
                  const all = [...defaults, ...customItems, ...pluginItems];
                  const needle = query.trim().toLowerCase();
                  return needle
                    ? all.filter((item) => `${item.title} ${(item.aliases ?? []).join(" ")}`.toLowerCase().includes(needle))
                    : all;
                }}
              />
            </BlockNoteView>
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
      <PagePickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(pageId) => {
          const handle = editorBridge.get(page.id);
          if (handle) void handle.insertPageLink(pageId);
        }}
      />
    </div>
  );
}
