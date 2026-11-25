/**
 * The assistant's input: mention chips and the `@` menu, slash commands, mode,
 * model and thinking pickers, web toggle and the context-window ring.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { create } from "zustand";
import {
  ArrowUp,
  AtSign,
  Brain,
  Check,
  ChevronDown,
  CircleAlert,
  Database,
  FileCode,
  FileText,
  Folder,
  Globe,
  Home,
  Image as ImageIcon,
  LoaderCircle,
  PanelRight,
  Plus,
  Rows3,
  Settings2,
  Shapes,
  Square,
  TextCursorInput,
  TextQuote,
  X,
} from "lucide-react";
import { useAppStore } from "../store";
import { commandIcon, fillPrompt, matchCommands, slashQuery } from "./commands";
import type { SlashCommand, SlashContext } from "./commands";
import { MENTION_KIND_LABEL, mentionCandidates, readSelection, sameMention } from "./mentions";
import type { Mention, MentionCandidate, MentionKind } from "./mentions";
import { DEFAULT_CONTEXT_WINDOW, THINKING_INFO, displayModel, effectiveThinking, estimateTokens, modelKey, resolveModel } from "./models";
import type { ThinkingLevel } from "./models";
import { presetFor } from "./providers";
import { useAssistant } from "./store";
import { MODES } from "./tools";
import { contextBreakdown, contextUsage } from "./context";
import { ACCEPT, MAX_FILES, formatBytes, readAttachment } from "./attachments";
import type { ContextSlice } from "./context";
import type { Attachment } from "./types";

// ── shared composer state (the panel's drop zone adds mentions too) ─────────

interface ComposerState {
  draft: string;
  mentions: Mention[];
  files: Attachment[];
  /** Files still being read (names), shown as pending chips. */
  reading: string[];
  setDraft(draft: string): void;
  addMentions(items: Mention[]): void;
  removeMention(item: Mention): void;
  addFiles(files: File[]): Promise<void>;
  removeFile(id: string): void;
  clear(): void;
}

const MAX_MENTIONS = 12;

export const useComposer = create<ComposerState>((set, get) => ({
  draft: "",
  mentions: [],
  setDraft: (draft) => set({ draft }),
  addMentions(items) {
    const next = [...get().mentions];
    for (const item of items) if (!next.some((existing) => sameMention(existing, item))) next.push(item);
    set({ mentions: next.slice(-MAX_MENTIONS) });
  },
  removeMention: (item) => set({ mentions: get().mentions.filter((existing) => !sameMention(existing, item)) }),
  files: [],
  reading: [],
  async addFiles(files) {
    const room = MAX_FILES - get().files.length - get().reading.length;
    if (room <= 0) {
      useAppStore.getState().notify(`Up to ${MAX_FILES} files per message.`, "error");
      return;
    }
    if (files.length > room) useAppStore.getState().notify(`Only the first ${room} file${room === 1 ? "" : "s"} were attached (up to ${MAX_FILES} per message).`, "error");
    const batch = files.slice(0, room);
    set({ reading: [...get().reading, ...batch.map((file) => file.name || "file")] });
    for (const file of batch) {
      try {
        const attachment = await readAttachment(file);
        set({ files: [...get().files, attachment] });
      } catch (error) {
        useAppStore.getState().notify(error instanceof Error ? error.message : String(error), "error");
      } finally {
        const reading = [...get().reading];
        reading.splice(reading.indexOf(file.name || "file"), 1);
        set({ reading });
      }
    }
    focusComposer();
  },
  removeFile: (id) => set({ files: get().files.filter((file) => file.id !== id) }),
  clear: () => set({ draft: "", mentions: [], files: [] }),
}));

export function FileChip({ file, onRemove, warn }: { file: Pick<Attachment, "name" | "kind" | "size" | "mime" | "data">; onRemove?: () => void; warn?: string }) {
  const Icon = file.kind === "image" ? ImageIcon : file.kind === "pdf" ? FileText : FileCode;
  const [broken, setBroken] = useState(false);
  const thumb = file.kind === "image" && file.data && !broken ? `data:${file.mime};base64,${file.data}` : "";
  return (
    <span className={`assistant-file kind-${file.kind}${warn ? " is-warn" : ""}`} title={warn || `${file.name} · ${formatBytes(file.size)}`}>
      {thumb ? <img src={thumb} alt="" className="assistant-file-thumb" onError={() => setBroken(true)} /> : <Icon size={12} aria-hidden />}
      <span className="assistant-file-name">{file.name}</span>
      <span className="assistant-file-size">{warn ? <CircleAlert size={11} /> : formatBytes(file.size)}</span>
      {onRemove ? (
        <button type="button" className="assistant-mention-remove" onClick={onRemove} aria-label={`Remove ${file.name}`}>
          <X size={10} />
        </button>
      ) : null}
    </span>
  );
}

/** Focuses the composer input (after a drop, a slash action…). */
export function focusComposer() {
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".assistant-input textarea")?.focus());
}

export const MENTION_ICONS: Record<MentionKind, typeof FileText> = {
  page: FileText,
  folder: Folder,
  database: Database,
  custom: Shapes,
  row: Rows3,
  block: TextQuote,
  selection: TextCursorInput,
  home: Home,
  sidebar: PanelRight,
  text: TextQuote,
};

export function MentionChip({ mention, onRemove }: { mention: Mention; onRemove?: () => void }) {
  const Icon = MENTION_ICONS[mention.kind];
  const openPage = useAppStore((state) => state.selectPage);
  const pageId = mention.kind === "page" || mention.kind === "row" || mention.kind === "database" || mention.kind === "folder" || mention.kind === "custom" ? mention.id : undefined;
  const label = (
    <>
      <Icon size={11} aria-hidden />
      <span>{mention.label}</span>
    </>
  );
  return (
    <span className={`assistant-mention kind-${mention.kind}`} title={`${MENTION_KIND_LABEL[mention.kind]}: ${mention.label}`}>
      {pageId && !onRemove ? (
        <button type="button" className="assistant-mention-open" onClick={() => void openPage(pageId)}>
          {label}
        </button>
      ) : (
        label
      )}
      {onRemove ? (
        <button type="button" className="assistant-mention-remove" onClick={onRemove} aria-label={`Remove ${mention.label}`}>
          <X size={10} />
        </button>
      ) : null}
    </span>
  );
}

// ── popover helper ──────────────────────────────────────────────────────────

function useDismiss(open: boolean, close: () => void, root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, close, root]);
}

export function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
}

function ContextRing({ used, total, exact, slices, canCompact, onCompact }: { used: number; total: number; exact: boolean; slices: ContextSlice[]; canCompact: boolean; onCompact: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const close = useMemo(() => () => setOpen(false), []);
  useDismiss(open, close, root);
  const ratio = Math.min(1, used / Math.max(1, total));
  const percent = Math.round(ratio * 100);
  const r = 6;
  const circumference = 2 * Math.PI * r;
  const level = ratio >= 0.9 ? "full" : ratio >= 0.7 ? "high" : "ok";
  const free = Math.max(0, total - used);
  return (
    <div className="assistant-context" ref={root}>
      <button
        type="button"
        className={`assistant-context-ring level-${level}`}
        onClick={() => setOpen((value) => !value)}
        aria-label={`Context ${percent}% used`}
        aria-expanded={open}
        title={`${exact ? "" : "≈ "}${formatCount(used)} of ${formatCount(total)} tokens`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r={r} className="track" />
          <circle cx="8" cy="8" r={r} className="fill" strokeDasharray={`${circumference * ratio} ${circumference}`} transform="rotate(-90 8 8)" />
        </svg>
        <span>{percent}%</span>
      </button>
      {open ? (
        <div className="assistant-popover assistant-context-pop context-window" role="dialog" aria-label="Context window">
          <div className="pop-title">Context window</div>
          <div className="context-head">
            <strong>{percent}%</strong>
            <span>
              {exact ? "" : "≈ "}
              {formatCount(used)} / {formatCount(total)} tokens
            </span>
          </div>
          <div className="context-bar" aria-hidden>
            {slices.map((slice) => (
              <span key={slice.key} style={{ width: `${(slice.tokens / Math.max(total, used)) * 100}%`, background: slice.color }} />
            ))}
          </div>
          <ul className="context-legend">
            {slices.map((slice) => (
              <li key={slice.key}>
                <i style={{ background: slice.color }} />
                <span>{slice.label}</span>
                <b>{formatCount(slice.tokens)}</b>
              </li>
            ))}
            <li>
              <i style={{ background: "var(--bg-sunken)", boxShadow: "inset 0 0 0 1px var(--border)" }} />
              <span>Free</span>
              <b>{formatCount(free)}</b>
            </li>
          </ul>
          <p className="assistant-context-note">
            {exact ? "Total from the provider's last count, plus anything added since; the split is estimated." : "Estimated until the model replies."}
            {level !== "ok" ? " Compacting keeps a summary and frees the rest." : ""} Change a model's window in Settings → Models.
          </p>
          <div className="context-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={!canCompact}
              onClick={() => {
                setOpen(false);
                onCompact();
              }}
              title="Summarize this chat into a new one"
            >
              Compact chat
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── thinking picker ─────────────────────────────────────────────────────────

function ThinkingPicker({ offered, value, onChange, disabled }: { offered: ThinkingLevel[]; value: ThinkingLevel; onChange: (level: ThinkingLevel) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const close = useMemo(() => () => setOpen(false), []);
  useDismiss(open, close, root);
  const current = effectiveThinking(value, offered);
  if (!current) return null;
  return (
    <div className="assistant-think" ref={root}>
      <button
        type="button"
        className={`assistant-chip-button${current !== "auto" && current !== "off" ? " on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Thinking: ${THINKING_INFO[current].label}`}
      >
        <Brain size={12} aria-hidden />
        <span>{THINKING_INFO[current].label}</span>
      </button>
      {open ? (
        <div className="assistant-popover assistant-think-menu" role="listbox" aria-label="Thinking level">
          <div className="assistant-popover-title">Thinking</div>
          {offered.map((level) => (
            <button
              key={level}
              type="button"
              role="option"
              aria-selected={level === current}
              className={`assistant-menu-option${level === current ? " active" : ""}`}
              onClick={() => {
                onChange(level);
                setOpen(false);
              }}
            >
              <span className="assistant-menu-text">
                <span>{THINKING_INFO[level].label}</span>
                <small>{THINKING_INFO[level].hint}</small>
              </span>
              {level === current ? <Check size={12} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── model picker ────────────────────────────────────────────────────────────

let openModelMenu: (() => void) | null = null;

export function ModelPicker() {
  const providers = useAssistant((state) => state.providers);
  const settings = useAssistant((state) => state.settings);
  const selectModel = useAssistant((state) => state.selectModel);
  const setView = useAssistant((state) => state.setView);
  const running = useAssistant((state) => state.running);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const root = useRef<HTMLDivElement | null>(null);
  const close = useMemo(() => () => setOpen(false), []);
  useDismiss(open, close, root);

  useEffect(() => {
    openModelMenu = () => setOpen(true);
    return () => {
      openModelMenu = null;
    };
  }, []);

  const enabled = providers.filter((item) => item.enabled);
  const needle = filter.trim().toLowerCase();
  const groups = enabled.map((provider) => {
    const known = new Set<string>([...(provider.models ?? []), ...(provider.models?.length ? [] : presetFor(provider.preset)?.models ?? []), provider.defaultModel].filter(Boolean));
    if (provider.id === settings.providerId && settings.model) known.add(settings.model);
    const labelOf = (model: string) => settings.models[modelKey(provider.id, model)]?.label?.trim() || "";
    const shown = [...known].filter((model) => {
      const active = provider.id === settings.providerId && model === settings.model;
      // Hidden models stay findable by typing their id.
      if (settings.models[modelKey(provider.id, model)]?.hidden && !active && !needle) return false;
      return !needle || model.toLowerCase().includes(needle) || labelOf(model).toLowerCase().includes(needle) || provider.name.toLowerCase().includes(needle);
    });
    return { provider, models: shown };
  });
  const current = providers.find((item) => item.id === settings.providerId);
  const custom = filter.trim();

  if (!enabled.length) return <span />;

  const pick = (providerId: string, model: string) => {
    selectModel(providerId, model);
    setOpen(false);
    setFilter("");
    focusComposer();
  };

  return (
    <div className="assistant-model" ref={root}>
      <button
        type="button"
        className="assistant-model-button"
        onClick={() => setOpen((value) => !value)}
        disabled={running}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={current && settings.model ? `${settings.model} · ${current.name}` : "Choose model"}
      >
        <span>{settings.model ? settings.models[modelKey(settings.providerId, settings.model)]?.label?.trim() || displayModel(settings.model) : "Choose a model"}</span>
        <ChevronDown size={11} aria-hidden />
      </button>
      {open ? (
        <div className="assistant-popover assistant-model-menu" role="listbox" aria-label="Model">
          <input
            autoFocus
            className="assistant-model-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter or type a model id…"
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === "Enter" && custom && current) pick(current.id, custom);
            }}
          />
          <div className="assistant-model-list">
            {groups.map(({ provider, models }) =>
              models.length ? (
                <div key={provider.id} className="assistant-model-group">
                  <div className="assistant-popover-title">{provider.name}</div>
                  {models.map((model) => {
                    const active = provider.id === settings.providerId && model === settings.model;
                    return (
                      <button key={model} type="button" role="option" aria-selected={active} className={`assistant-menu-option${active ? " active" : ""}`} onClick={() => pick(provider.id, model)} title={model}>
                        <span className="assistant-menu-label">{settings.models[modelKey(provider.id, model)]?.label?.trim() || displayModel(model)}</span>
                        {active ? <Check size={12} /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null,
            )}
            {custom && current && !groups.some((group) => group.models.includes(custom)) ? (
              <button type="button" className="assistant-menu-option" onClick={() => pick(current.id, custom)}>
                <span className="assistant-menu-label">
                  Use “{custom}” with {current.name}
                </span>
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="assistant-model-manage"
            onClick={() => {
              setOpen(false);
              setView("providers");
            }}
          >
            <Settings2 size={12} /> Providers and models
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── inline menus (@ and /) ──────────────────────────────────────────────────

interface MenuItem {
  key: string;
  icon: ReactNode;
  label: ReactNode;
  hint?: string;
  group?: string;
  /** Draw the icon in a small rounded tile (slash commands). */
  tile?: boolean;
  run(): void;
}

function InlineMenu({ items, active, setActive, label }: { items: MenuItem[]; active: number; setActive: (index: number) => void; label: string }) {
  const list = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  let lastGroup: string | undefined;
  return (
    <div className="assistant-popover assistant-inline-menu" role="listbox" aria-label={label} ref={list}>
      {items.length === 0 ? <div className="assistant-menu-empty">Nothing matches</div> : null}
      {items.map((item, index) => {
        const head = item.group && item.group !== lastGroup ? <div className="assistant-popover-title">{item.group}</div> : null;
        lastGroup = item.group;
        return (
          <div key={item.key}>
            {head}
            <button
              type="button"
              role="option"
              data-index={index}
              aria-selected={index === active}
              className={`assistant-menu-option${index === active ? " active" : ""}`}
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => setActive(index)}
              onClick={item.run}
            >
              <span className={`assistant-menu-icon${item.tile ? " is-tile" : ""}`}>{item.icon}</span>
              <span className="assistant-menu-label">{item.label}</span>
              {item.hint ? <small className="assistant-menu-hint">{item.hint}</small> : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** `@query` right before the caret. */
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,40})$/.exec(before);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2] };
}

// ── composer ────────────────────────────────────────────────────────────────

export function Composer() {
  const send = useAssistant((state) => state.send);
  const stop = useAssistant((state) => state.stop);
  const running = useAssistant((state) => state.running);
  const awaiting = useAssistant((state) => state.awaiting.length > 0);
  const settings = useAssistant((state) => state.settings);
  const providers = useAssistant((state) => state.providers);
  const messages = useAssistant((state) => state.chat.messages);
  const updateSettings = useAssistant((state) => state.updateSettings);
  const setMode = useAssistant((state) => state.setMode);
  const setView = useAssistant((state) => state.setView);
  const newChat = useAssistant((state) => state.newChat);
  const regenerate = useAssistant((state) => state.regenerate);
  const compact = useAssistant((state) => state.compact);
  const hasProvider = providers.some((item) => item.enabled);
  const { draft, mentions, files, reading, setDraft, addMentions, removeMention, addFiles, removeFile, clear } = useComposer();
  const filePicker = useRef<HTMLInputElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState("");
  const [hasSelection, setHasSelection] = useState(false);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(220, el.scrollHeight)}px`;
  }, [draft]);

  const provider = providers.find((item) => item.id === settings.providerId);
  const resolved = resolveModel(settings.models, settings.discovered, settings.providerId, provider?.kind ?? "openai", settings.model);
  const draftTokens = estimateTokens(draft) + mentions.reduce((sum, item) => sum + estimateTokens(item.content ?? "") + (item.content ? 0 : 400), 0);
  const usage = contextUsage(messages, draftTokens);
  const slices = useMemo(() => contextBreakdown(messages, draftTokens, usage.used), [messages, draftTokens, usage.used]);

  const slash = slashQuery(draft);
  const mention = slash ? null : mentionQuery(draft, caret);
  const menuKey = slash ? `/${slash.name}` : mention ? `@${mention.start}` : "";
  const menuOpen = Boolean(menuKey) && dismissed !== menuKey;

  // Whether the editor has a selection, so the @ menu can offer it.
  useEffect(() => {
    if (!mention) return;
    let live = true;
    void readSelection().then((text) => live && setHasSelection(Boolean(text)));
    return () => {
      live = false;
    };
  }, [mention?.start]); // eslint-disable-line react-hooks/exhaustive-deps

  const slashCtx: SlashContext = {
    newChat: () => {
      newChat();
      clear();
    },
    setMode,
    setView,
    toggleWeb: () => updateSettings({ webAccess: !settings.webAccess }),
    openModels: () => openModelMenu?.(),
    setThinking: (level) => updateSettings({ thinking: level }),
    thinkingLevels: resolved.thinking,
    regenerate: () => void regenerate(),
    compact: () => void compact(),
    canRetry: !running && messages.length > 0,
    canCompact: !running && messages.length > 1,
  };

  const runCommand = (command: SlashCommand, arg: string) => {
    if (command.run) {
      setDraft("");
      command.run(slashCtx, arg);
    } else {
      if (command.mode && command.mode !== settings.mode && (command.mode === "creator" || settings.mode === "ask")) setMode(command.mode);
      const text = fillPrompt(command, arg);
      setDraft(text);
      requestAnimationFrame(() => {
        const el = input.current;
        if (!el) return;
        el.focus();
        // Put the caret where the user's input goes when nothing was typed yet.
        const at = !arg.trim() && command.prompt?.includes("{input}") ? (command.prompt.indexOf("{input}") ?? text.length) : text.length;
        el.setSelectionRange(at, at);
        setCaret(at);
      });
    }
    setActive(0);
  };

  const pickMention = (item: MentionCandidate) => {
    if (!mention) return;
    const before = draft.slice(0, mention.start);
    const after = draft.slice(caret);
    const next = `${before}${after.startsWith(" ") ? after.slice(1) : after}`;
    const { hint: _hint, ...plain } = item;
    addMentions([plain]);
    setDraft(next);
    setActive(0);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(before.length, before.length);
      setCaret(before.length);
    });
  };

  let items: MenuItem[] = [];
  if (menuOpen && slash) {
    items = matchCommands(slash.name, slashCtx).map((command) => {
      const Icon = commandIcon(command);
      return {
        key: command.name,
        icon: <Icon size={14} aria-hidden />,
        tile: true,
        label: (
          <>
            <span className="assistant-cmd-name">/{command.name}</span>
            {command.args ? <span className="assistant-cmd-args"> {command.args}</span> : null}
            <span className="assistant-cmd-desc">{command.description}</span>
          </>
        ),
        group: command.group === "Chat" ? "Actions" : command.group === "Mode" ? "Mode" : "Prompts",
        run: () => runCommand(command, slash.arg),
      };
    });
    // Keep groups together in a stable order.
    const order = ["Actions", "Mode", "Prompts"];
    items.sort((a, b) => order.indexOf(a.group!) - order.indexOf(b.group!));
  } else if (menuOpen && mention) {
    items = mentionCandidates(mention.query, hasSelection)
      .filter((item) => !mentions.some((existing) => sameMention(existing, item)))
      .map((item) => {
        const Icon = MENTION_ICONS[item.kind];
        return { key: `${item.kind}:${item.id}`, icon: <Icon size={12} />, label: item.label, hint: item.hint, run: () => pickMention(item) };
      });
  }
  const activeIndex = Math.min(active, Math.max(0, items.length - 1));

  const submit = () => {
    if (running || !hasProvider) return;
    const command = slash ? matchCommands(slash.name, slashCtx).find((item) => item.name === slash.name) : undefined;
    if (command) return runCommand(command, slash!.arg);
    if (reading.length) return;
    if (!draft.trim() && !mentions.length && !files.length) return;
    void send(draft.trim() || (files.length && !mentions.length ? "Look at the attached file" + (files.length === 1 ? "." : "s.") : "Look at what I mentioned."), mentions, files);
    clear();
    setDismissed("");
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (menuOpen && items.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((activeIndex + step + items.length) % items.length);
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        items[activeIndex].run();
        return;
      }
    }
    if (menuOpen && event.key === "Escape") {
      event.preventDefault();
      setDismissed(menuKey);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape" && running) {
      event.preventDefault();
      stop();
    } else if (event.key === "Backspace" && !draft && files.length) {
      removeFile(files[files.length - 1].id);
    } else if (event.key === "Backspace" && !draft && mentions.length) {
      removeMention(mentions[mentions.length - 1]);
    }
  };

  const syncCaret = () => setCaret(input.current?.selectionStart ?? 0);

  const placeholder = !hasProvider
    ? "Add a provider to start"
    : awaiting
      ? "Waiting for you above…"
      : settings.mode === "ask"
        ? "Ask anything — @ to mention, / for commands"
        : settings.mode === "edit"
          ? "Ask for an edit — @ to mention, / for commands"
          : "Describe a change to the app — / for commands";

  const mode = MODES.find((item) => item.id === settings.mode)!;
  const canSend = hasProvider && !reading.length && (Boolean(draft.trim()) || mentions.length > 0 || files.length > 0);
  const noVision = !resolved.vision;

  return (
    <div className="assistant-composer">
      {menuOpen ? <InlineMenu items={items} active={activeIndex} setActive={setActive} label={slash ? "Commands" : "Mention"} /> : null}
      <div className={`assistant-input mode-${settings.mode}`}>
        {mentions.length || files.length || reading.length ? (
          <div className="assistant-mentions" aria-label="Attached">
            {files.map((file) => (
              <FileChip
                key={file.id}
                file={file}
                onRemove={() => removeFile(file.id)}
                warn={noVision && file.kind !== "text" ? `${settings.model || "This model"} can't read ${file.kind === "pdf" ? "PDFs" : "images"}; only its name is sent. Change it in the model's options if it can.` : undefined}
              />
            ))}
            {reading.map((name, index) => (
              <span key={`reading-${index}`} className="assistant-file is-reading">
                <LoaderCircle size={11} className="spin" aria-hidden />
                <span className="assistant-file-name">{name}</span>
              </span>
            ))}
            {mentions.map((item) => (
              <MentionChip key={`${item.kind}:${item.id}`} mention={item} onRemove={() => removeMention(item)} />
            ))}
          </div>
        ) : null}
        <textarea
          ref={input}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
            setActive(0);
            if (dismissed && !event.target.value.includes(dismissed[0])) setDismissed("");
          }}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            const pasted = [...event.clipboardData.files];
            if (!pasted.length) return;
            event.preventDefault();
            void addFiles(pasted);
          }}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onBlur={() => setDismissed(menuKey)}
          onFocus={() => setDismissed("")}
          placeholder={placeholder}
          rows={1}
          aria-label="Message the assistant"
          aria-autocomplete="list"
          aria-expanded={menuOpen}
          disabled={!hasProvider}
        />
        <div className="assistant-input-bar">
          <div className="assistant-modes" role="radiogroup" aria-label="Mode">
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={settings.mode === item.id}
                className={`assistant-mode${settings.mode === item.id ? " active" : ""} mode-${item.id}`}
                onClick={() => setMode(item.id)}
                title={item.summary}
                disabled={running}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="assistant-input-tools">
            <input
              ref={filePicker}
              type="file"
              multiple
              accept={ACCEPT}
              hidden
              onChange={(event) => {
                const picked = [...(event.target.files ?? [])];
                event.target.value = "";
                if (picked.length) void addFiles(picked);
              }}
            />
            <button
              type="button"
              className="assistant-toggle"
              onClick={() => filePicker.current?.click()}
              title="Attach images, PDFs or text files"
              aria-label="Attach files"
              disabled={!hasProvider}
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              className="assistant-toggle"
              onClick={() => {
                const el = input.current;
                if (!el) return;
                const at = el.selectionStart ?? draft.length;
                const pad = at > 0 && !/\s/.test(draft[at - 1]) ? " @" : "@";
                const next = `${draft.slice(0, at)}${pad}${draft.slice(at)}`;
                setDraft(next);
                setDismissed("");
                requestAnimationFrame(() => {
                  el.focus();
                  el.setSelectionRange(at + pad.length, at + pad.length);
                  setCaret(at + pad.length);
                });
              }}
              title="Mention a page (@)"
              aria-label="Mention"
              disabled={!hasProvider}
            >
              <AtSign size={13} />
            </button>
            <button
              type="button"
              className={`assistant-toggle${settings.webAccess ? " on" : ""}`}
              onClick={() => updateSettings({ webAccess: !settings.webAccess })}
              title={settings.webAccess ? "Web search and reading on" : "Web access off"}
              aria-pressed={settings.webAccess}
              aria-label="Web access"
            >
              <Globe size={13} />
            </button>
            {running ? (
              <button type="button" className="assistant-send stop" onClick={() => stop()} title="Stop (Esc)" aria-label="Stop">
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button type="button" className="assistant-send" onClick={submit} disabled={!canSend} title="Send (Enter)" aria-label="Send">
                <ArrowUp size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="assistant-composer-foot">
        <ModelPicker />
        {hasProvider && settings.model ? (
          <ThinkingPicker offered={resolved.thinking} value={settings.thinking} onChange={(level) => updateSettings({ thinking: level })} disabled={running} />
        ) : null}
        <span className="assistant-foot-spacer" />
        {hasProvider && settings.model ? (
          <ContextRing used={usage.used} total={resolved.contextWindow || DEFAULT_CONTEXT_WINDOW} exact={usage.exact} slices={slices} canCompact={slashCtx.canCompact} onCompact={() => void compact()} />
        ) : null}
      </div>
      <span className="visually-hidden" aria-live="polite">
        {mode.label} mode
      </span>
    </div>
  );
}
