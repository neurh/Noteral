/**
 * The page editor's floating toolbars: the formatting toolbar shown over a text
 * selection and the link toolbar shown when a link is hovered or the caret sits in one.
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { Block, BlockNoteEditor } from "@blocknote/core";
import { DEFAULT_LINK_PROTOCOL, LinkToolbarExtension, VALID_LINK_PROTOCOLS } from "@blocknote/core/extensions";
import {
  BasicTextStyleButton,
  ColorStyleButton,
  CreateLinkButton,
  FormattingToolbar,
  blockTypeSelectItems,
  getFormattingToolbarItems,
  useBlockNoteEditor,
  useComponentsContext,
  useEditorState,
  useExtension,
  usePortalElement,
  type LinkToolbarProps,
} from "@blocknote/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Languages,
  Lightbulb,
  Link2,
  Mail,
  MessageCircleQuestion,
  Minimize2,
  PencilLine,
  ScrollText,
  Sparkles,
  SpellCheck,
  Type,
  Unlink,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { flip, offset, shift, size, type Middleware } from "@floating-ui/react";
import { draftInAssistant, sendToAssistant } from "../assistant/quickActions";
import type { Mention } from "../assistant/mentions";
import type { AssistantMode } from "../assistant/types";
import { Favicon } from "../browser/WebTabIcon";
import { openPageLink } from "../browser/open";
import { useAppStore } from "../store";
import { PageIcon } from "./PageIcon";

type AnyEditor = BlockNoteEditor<any, any, any>;
type AnyBlock = Block<any, any, any>;

/** The blocks the selection covers, or the caret's block. */
function selectedBlocks(editor: AnyEditor): AnyBlock[] {
  const selection = editor.getSelection();
  if (selection?.blocks.length) return selection.blocks as AnyBlock[];
  return [editor.getTextCursorPosition().block as AnyBlock];
}

const hasText = (block: AnyBlock) => Array.isArray(block.content);

/** A thin rule between groups; doubled or dangling rules are hidden in CSS. */
function Separator() {
  return <span className="editor-toolbar-sep" aria-hidden="true" />;
}

/* ───────────────────────── Placement ───────────────────────── */

const EDGE = 8;

/** Never wider than the pane: a narrow toolbar wraps onto a second row. */
const fitWidth: Middleware = size({
  padding: EDGE,
  apply({ availableWidth, elements }) {
    elements.floating.style.maxWidth = `${Math.max(200, Math.floor(availableWidth))}px`;
  },
});

/** Both toolbars sit above the text and stay inside the pane, even at its edges. */
function toolbarMiddleware(): Middleware[] {
  return [offset(8), flip({ padding: EDGE }), shift({ padding: EDGE, crossAxis: false }), fitWidth];
}

export const formattingToolbarFloating = { useFloatingOptions: { middleware: toolbarMiddleware() } };
export const linkToolbarFloating = { useFloatingOptions: { middleware: toolbarMiddleware() } };

/* ───────────────────────── Formatting toolbar ───────────────────────── */

/** BlockNote's own items that only show for special blocks (tables, files). */
const CONTEXT_ITEMS = new Set([
  "tableCellMergeButton",
  "fileCaptionButton",
  "replaceFileButton",
  "fileRenameButton",
  "fileDeleteButton",
  "fileDownloadButton",
  "filePreviewButton",
]);

/**
 * The selection toolbar: block type, text styles, link and colour, alignment
 * and the assistant. Nesting lives on Tab / Shift+Tab, so it has no buttons.
 */
export function EditorFormattingToolbar() {
  const editor = useBlockNoteEditor<any, any, any>();
  const types = [
    ...blockTypeSelectItems(editor),
    { name: "Callout", type: "callout", icon: Lightbulb as unknown as ReturnType<typeof blockTypeSelectItems>[number]["icon"] },
  ].filter((item) => item.type in editor.schema.blockSchema);
  const items = getFormattingToolbarItems(types);
  const pick = (key: string) => items.find((item) => item.key === key) ?? null;
  return (
    <FormattingToolbar>
      {pick("blockTypeSelect")}
      {items.filter((item) => CONTEXT_ITEMS.has(String(item.key)))}
      <Separator />
      <BasicTextStyleButton key="bold" basicTextStyle="bold" />
      <BasicTextStyleButton key="italic" basicTextStyle="italic" />
      <BasicTextStyleButton key="underline" basicTextStyle="underline" />
      <BasicTextStyleButton key="strike" basicTextStyle="strike" />
      <BasicTextStyleButton key="code" basicTextStyle="code" />
      <Separator />
      <CreateLinkButton key="link" />
      <ColorStyleButton key="color" />
      <AlignMenu />
      <Separator />
      <AskAssistantMenu />
    </FormattingToolbar>
  );
}

const ALIGNMENTS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "left", label: "Align left", icon: AlignLeft },
  { value: "center", label: "Align center", icon: AlignCenter },
  { value: "right", label: "Align right", icon: AlignRight },
  { value: "justify", label: "Justify", icon: AlignJustify },
];

/** One button for alignment; its icon shows the current one. */
function AlignMenu() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const portalElement = usePortalElement();
  const current = useEditorState({
    editor,
    selector: ({ editor: live }) => {
      if (!live?.isEditable) return null;
      const block = selectedBlocks(live as AnyEditor).find((item) => "textAlignment" in (item.props as object));
      return block ? String((block.props as { textAlignment?: string }).textAlignment ?? "left") : null;
    },
  });
  if (!current) return null;
  const active = ALIGNMENTS.find((item) => item.value === current) ?? ALIGNMENTS[0];
  const Icon = active.icon;
  const apply = (value: string) => {
    editor.transact(() => {
      for (const block of selectedBlocks(editor)) {
        if ("textAlignment" in (block.props as object)) editor.updateBlock(block, { props: { textAlignment: value } } as never);
      }
    });
    editor.focus();
  };
  return (
    <Components.Generic.Menu.Root position="bottom-start" portalElement={portalElement}>
      <Components.Generic.Menu.Trigger>
        <Components.FormattingToolbar.Button className="bn-button editor-toolbar-menu" mainTooltip="Alignment" label="Alignment" isSelected={current !== "left"}>
          <Icon size={16} strokeWidth={1.9} />
          <ChevronDown size={11} className="editor-toolbar-chevron" />
        </Components.FormattingToolbar.Button>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown handle-menu-dropdown editor-toolbar-dropdown">
        {ALIGNMENTS.map((item) => {
          const ItemIcon = item.icon;
          return (
            <Components.Generic.Menu.Item
              key={item.value}
              className="bn-menu-item handle-menu-item"
              icon={<ItemIcon size={16} />}
              checked={item.value === current}
              onClick={() => apply(item.value)}
            >
              {item.label}
            </Components.Generic.Menu.Item>
          );
        })}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

interface AssistantAction {
  id: string;
  label: string;
  icon: LucideIcon;
  mode: AssistantMode;
  /** Sent right away… */
  prompt?: string;
  /** …or left in the composer for the user to finish. */
  draft?: string;
}

const REPLACE = "Replace exactly that passage in the open page and leave everything else as it is.";

const ASSISTANT_ACTIONS: (AssistantAction | "separator")[] = [
  { id: "improve", label: "Improve writing", icon: WandSparkles, mode: "edit", prompt: `Improve the writing of the selected passage: clearer and tighter, with the same meaning and voice. ${REPLACE}` },
  { id: "fix", label: "Fix spelling & grammar", icon: SpellCheck, mode: "edit", prompt: `Fix spelling and grammar in the selected passage, keeping the wording otherwise unchanged. ${REPLACE}` },
  { id: "shorter", label: "Make shorter", icon: Minimize2, mode: "edit", prompt: `Make the selected passage about half as long, keeping every key point. ${REPLACE}` },
  { id: "simpler", label: "Simplify language", icon: Type, mode: "edit", prompt: `Rewrite the selected passage in plainer, simpler language. ${REPLACE}` },
  { id: "translate", label: "Translate…", icon: Languages, mode: "edit", draft: "Translate the selected passage, in place, into " },
  "separator",
  { id: "explain", label: "Explain", icon: Lightbulb, mode: "ask", prompt: "Explain the selected passage in simple terms." },
  { id: "summarize", label: "Summarize", icon: ScrollText, mode: "ask", prompt: "Summarize the selected passage in two or three sentences." },
  { id: "ask", label: "Ask about it…", icon: MessageCircleQuestion, mode: "ask", draft: "About the selected passage: " },
];

/** "Ask AI": rewrite, fix or explain the selected text with the assistant. */
function AskAssistantMenu() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const portalElement = usePortalElement();
  const pageId = useAppStore((state) => state.activePageId);
  const available = useEditorState({
    editor,
    selector: ({ editor: live }) => Boolean(live?.isEditable && selectedBlocks(live as AnyEditor).some(hasText)),
  });
  // The text is read when the menu opens: by the time an item is picked the
  // menu holds focus and the editor's selection may already be gone.
  const picked = useRef("");
  if (!available) return null;
  const run = (action: AssistantAction) => {
    const text = picked.current.trim();
    if (!text) {
      useAppStore.getState().notify("Select some text first.", "info");
      return;
    }
    const mentions: Mention[] = [{ kind: "selection", id: "selection", label: "Selection", pageId: pageId ?? undefined, content: text }];
    if (action.prompt) sendToAssistant(action.prompt, action.mode, mentions);
    else draftInAssistant(action.draft ?? "", action.mode, mentions);
  };
  return (
    <Components.Generic.Menu.Root
      position="bottom-start"
      portalElement={portalElement}
      onOpenChange={(open) => {
        if (open) picked.current = editor.getSelectedText();
      }}
    >
      <Components.Generic.Menu.Trigger>
        <Components.FormattingToolbar.Button className="bn-button editor-toolbar-ai" mainTooltip="Ask AI" secondaryTooltip="Rewrite, fix or explain the selection" label="Ask AI" isSelected={false}>
          <Sparkles size={15} strokeWidth={1.9} />
          <span>Ask AI</span>
        </Components.FormattingToolbar.Button>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown handle-menu-dropdown editor-toolbar-dropdown">
        <Components.Generic.Menu.Label className="bn-menu-label handle-menu-heading">Edit with AI</Components.Generic.Menu.Label>
        {ASSISTANT_ACTIONS.map((action, index) => {
          if (action === "separator") return <Components.Generic.Menu.Divider key={`sep-${index}`} className="bn-menu-divider" />;
          const Icon = action.icon;
          return (
            <Components.Generic.Menu.Item key={action.id} className="bn-menu-item handle-menu-item" icon={<Icon size={16} />} onClick={() => run(action)}>
              {action.label}
            </Components.Generic.Menu.Item>
          );
        })}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

/* ───────────────────────── Link toolbar ───────────────────────── */

export interface LinkTarget {
  kind: "web" | "page" | "mail" | "other";
  /** What the toolbar shows: "host/path", the page title or the address. */
  primary: string;
  secondary: string;
  pageId?: string;
}

/** How a link reads in the toolbar. */
export function describeLink(url: string, pageTitle?: (id: string) => string | undefined): LinkTarget {
  const page = /^noteral:\/\/page\/([\w-]+)/i.exec(url);
  if (page) return { kind: "page", primary: pageTitle?.(page[1]) ?? "Missing page", secondary: "Page in this workspace", pageId: page[1] };
  if (/^mailto:/i.test(url)) return { kind: "mail", primary: decodeURIComponent(url.replace(/^mailto:/i, "").split("?")[0]), secondary: "Email" };
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      const host = parsed.hostname.replace(/^www\./, "");
      let rest = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      if (rest === "/") rest = "";
      try {
        rest = decodeURI(rest);
      } catch {
        // Keep the encoded form.
      }
      return { kind: "web", primary: host, secondary: rest };
    }
  } catch {
    // Not a URL we can take apart.
  }
  return { kind: "other", primary: url, secondary: "" };
}

/** Adds https:// when the address has no scheme. */
export function normalizeLinkInput(value: string): string {
  const url = value.trim();
  if (!url) return "";
  if (VALID_LINK_PROTOCOLS.some((protocol: string) => url.toLowerCase().startsWith(protocol))) return url;
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(url)) return `mailto:${url}`;
  return `${DEFAULT_LINK_PROTOCOL}://${url}`;
}

function ToolbarIcon({ label, hint, onClick, children, danger }: { label: string; hint?: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      className={`link-toolbar-button${danger ? " is-danger" : ""}`}
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * The link toolbar: where the link goes (click to open it in a browser tab),
 * then edit, copy, open in the system browser and remove.
 */
export function EditorLinkToolbar(props: LinkToolbarProps) {
  const { url, text, range, setToolbarOpen, setToolbarPositionFrozen } = props;
  const editor = useBlockNoteEditor<any, any, any>();
  // eslint-disable-next-line @typescript-eslint/unbound-method -- plain object methods
  const { editLink, deleteLink } = useExtension(LinkToolbarExtension);
  const pages = useAppStore((state) => state.pages);
  const [editing, setEditing] = useState(false);
  // While text is selected the formatting toolbar owns that spot.
  const textSelected = useEditorState({
    editor,
    selector: ({ editor: live }) => Boolean(live?.prosemirrorState && !live.prosemirrorState.selection.empty),
  });
  const [copied, setCopied] = useState(false);
  const target = describeLink(url, (id) => pages.find((item) => item.id === id)?.title || (pages.some((item) => item.id === id) ? "Untitled" : undefined));
  const page = target.pageId ? pages.find((item) => item.id === target.pageId) : undefined;

  // A different link was hovered: leave edit mode.
  useEffect(() => {
    setEditing(false);
    setCopied(false);
  }, [url, range.from]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const close = () => {
    setToolbarPositionFrozen?.(false);
    setToolbarOpen?.(false);
  };
  const open = (external = false) => {
    close();
    openPageLink(url, { external });
  };

  if (editing) {
    return (
      <LinkEditForm
        url={url}
        text={text}
        onCancel={() => {
          setEditing(false);
          setToolbarPositionFrozen?.(false);
          editor.focus();
        }}
        onSave={(nextUrl, nextText) => {
          editLink(nextUrl, nextText || nextUrl, range.from);
          close();
          editor.focus();
        }}
      />
    );
  }

  if (textSelected) return null;
  const webLike = target.kind === "web";
  return (
    <div className="bn-toolbar bn-link-toolbar link-toolbar" role="toolbar" aria-label="Link">
      <button
        type="button"
        className="link-toolbar-target"
        title={target.kind === "page" ? `Open ${target.primary}` : `Open ${url}${webLike ? " in a browser tab" : ""}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => open(false)}
      >
        <span className="link-toolbar-icon" aria-hidden="true">
          {target.kind === "web" ? <Favicon location={url} size={14} /> : target.kind === "page" ? <PageIcon value={page?.icon} size={14} fallback={<Link2 size={14} />} /> : target.kind === "mail" ? <Mail size={14} /> : <Link2 size={14} />}
        </span>
        <span className="link-toolbar-address">
          <span className="link-toolbar-primary">{target.primary}</span>
          {target.secondary ? <span className="link-toolbar-secondary">{target.secondary}</span> : null}
        </span>
      </button>
      <span className="editor-toolbar-sep" aria-hidden="true" />
      <ToolbarIcon
        label="Edit link"
        onClick={() => {
          setToolbarPositionFrozen?.(true);
          setEditing(true);
        }}
      >
        <PencilLine size={15} />
      </ToolbarIcon>
      <ToolbarIcon
        label={copied ? "Copied" : "Copy link"}
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => useAppStore.getState().notify("Could not copy the link.", "error"));
        }}
      >
        {copied ? <Check size={15} className="link-toolbar-copied" /> : <Copy size={15} />}
      </ToolbarIcon>
      {webLike ? (
        <ToolbarIcon label="Open in system browser" hint="Shift+click" onClick={() => open(true)}>
          <ExternalLink size={15} />
        </ToolbarIcon>
      ) : null}
      <ToolbarIcon
        label="Remove link"
        danger
        onClick={() => {
          deleteLink(range.from);
          close();
          editor.focus();
        }}
      >
        <Unlink size={15} />
      </ToolbarIcon>
    </div>
  );
}

function LinkEditForm({ url, text, onSave, onCancel }: { url: string; text: string; onSave: (url: string, text: string) => void; onCancel: () => void }) {
  const [address, setAddress] = useState(url);
  const [label, setLabel] = useState(text);
  const addressInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    addressInput.current?.focus();
    addressInput.current?.select();
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = normalizeLinkInput(address);
    if (!next) return;
    onSave(next, label.trim());
  };
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };
  return (
    <form className="bn-toolbar bn-link-toolbar link-toolbar link-edit" onSubmit={submit} onKeyDown={onKeyDown}>
      <label className="link-edit-field">
        <Link2 size={14} aria-hidden="true" />
        <input ref={addressInput} value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Paste or type a link" aria-label="Link address" spellCheck={false} />
      </label>
      <label className="link-edit-field">
        <Type size={14} aria-hidden="true" />
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Link text" aria-label="Link text" />
      </label>
      <div className="link-edit-actions">
        <span className="link-edit-hint">Enter to save · Esc to cancel</span>
        <button type="button" className="secondary-button link-edit-button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary-button link-edit-button" disabled={!address.trim()}>Save</button>
      </div>
    </form>
  );
}
