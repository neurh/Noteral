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
  Database,
  FileText,
  Folder,
  Globe,
  Home,
  PanelRight,
  Rows3,
  Settings2,
  Shapes,
  Slash,
  Square,
  TextCursorInput,
  TextQuote,
  X,
} from "lucide-react";
import { useAppStore } from "../store";
import { fillPrompt, matchCommands, slashQuery } from "./commands";
import type { SlashCommand, SlashContext } from "./commands";
import { MENTION_KIND_LABEL, mentionCandidates, readSelection, sameMention } from "./mentions";
import type { Mention, MentionCandidate, MentionKind } from "./mentions";
import { DEFAULT_CONTEXT_WINDOW, THINKING_INFO, displayModel, effectiveThinking, estimateTokens, resolveModel } from "./models";
import type { ThinkingLevel } from "./models";
import { presetFor } from "./providers";
import { useAssistant } from "./store";
import { MODES } from "./tools";
import type { ChatMessage } from "./types";

// ── shared composer state (the panel's drop zone adds mentions too) ─────────

interface ComposerState {
  draft: string;
  mentions: Mention[];
  setDraft(draft: string): void;
  addMentions(items: Mention[]): void;
  removeMention(item: Mention): void;
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
  clear: () => set({ draft: "", mentions: [] }),
}));

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

// ── context usage ───────────────────────────────────────────────────────────

function partTokens(message: ChatMessage): number {
  let chars = 0;
  for (const part of message.parts) {
    if (part.type === "text" || part.type === "thinking") chars += part.text.length;
    else chars += JSON.stringify(part.args ?? {}).length + (part.result?.length ?? 0) + (part.error?.length ?? 0);
  }
  for (const mention of message.mentions ?? []) chars += (mention.content?.length ?? 0) + 60;
  return Math.ceil(chars / 4);
}

/** Tokens the next request will send: the provider's last count plus anything newer, or an estimate. */
export function contextUsage(messages: ChatMessage[], draftTokens: number): { used: number; exact: boolean } {
  let lastIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant" && messages[index].usage?.input) {
      lastIndex = index;
      break;
    }
  }
  // System prompt + tool schemas aren't in the messages; ~6k is typical.
  const overhead = 6000;
  if (lastIndex < 0) return { used: overhead + messages.reduce((sum, message) => sum + partTokens(message), 0) + draftTokens, exact: false };
  const usage = messages[lastIndex].usage!;
  const after = messages.slice(lastIndex + 1).reduce((sum, message) => sum + partTokens(message), 0);
  return { used: usage.input + usage.output + after + draftTokens, exact: true };
}

export function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
}

function ContextRing({ used, total, exact, canCompact, onCompact }: { used: number; total: number; exact: boolean; canCompact: boolean; onCompact: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const close = useMemo(() => () => setOpen(false), []);
  useDismiss(open, close, root);
  const ratio = Math.min(1, used / Math.max(1, total));
  const percent = Math.round(ratio * 100);
  const r = 6;
  const circumference = 2 * Math.PI * r;
  const level = ratio >= 0.9 ? "full" : ratio >= 0.7 ? "high" : "ok";
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
        <div className="assistant-popover assistant-context-pop" role="dialog" aria-label="Context window">
          <div className="assistant-context-head">
            <strong>{percent}%</strong> of the context window used
          </div>
          <div className="assistant-context-bar" aria-hidden>
            <span className={`level-${level}`} style={{ width: `${Math.max(2, percent)}%` }} />
          </div>
          <div className="assistant-context-meta">
            {exact ? "" : "About "}
            {used.toLocaleString()} / {total.toLocaleString()} tokens
          </div>
          <p className="assistant-context-note">
            {exact ? "From the provider's last count, plus anything added since." : "Estimated until the model replies."} Change a model's window in Settings → Models.
          </p>
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
    return { provider, models: [...known].filter((model) => !needle || model.toLowerCase().includes(needle) || provider.name.toLowerCase().includes(needle)) };
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
        <span>{settings.model ? displayModel(settings.model) : "Choose a model"}</span>
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
                        <span className="assistant-menu-label">{displayModel(model)}</span>
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
              <span className="assistant-menu-icon">{item.icon}</span>
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
  const { draft, mentions, setDraft, addMentions, removeMention, clear } = useComposer();
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
  const usage = contextUsage(messages, estimateTokens(draft) + mentions.reduce((sum, item) => sum + estimateTokens(item.content ?? "") + (item.content ? 0 : 400), 0));

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
    items = matchCommands(slash.name, slashCtx).map((command) => ({
      key: command.name,
      icon: <Slash size={12} />,
      label: (
        <>
          <span className="assistant-cmd-name">/{command.name}</span>
          {command.args ? <span className="assistant-cmd-args"> {command.args}</span> : null}
          <span className="assistant-cmd-desc">{command.description}</span>
        </>
      ),
      group: command.group === "Chat" ? "Actions" : command.group === "Mode" ? "Mode" : "Prompts",
      run: () => runCommand(command, slash.arg),
    }));
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
    if (!draft.trim() && !mentions.length) return;
    void send(draft.trim() || "Look at what I mentioned.", mentions);
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
  const canSend = hasProvider && (Boolean(draft.trim()) || mentions.length > 0);

  return (
    <div className="assistant-composer">
      {menuOpen ? <InlineMenu items={items} active={activeIndex} setActive={setActive} label={slash ? "Commands" : "Mention"} /> : null}
      <div className={`assistant-input mode-${settings.mode}`}>
        {mentions.length ? (
          <div className="assistant-mentions" aria-label="Mentioned">
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
              <button type="button" className="assistant-send stop" onClick={stop} title="Stop (Esc)" aria-label="Stop">
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
          <ContextRing used={usage.used} total={resolved.contextWindow || DEFAULT_CONTEXT_WINDOW} exact={usage.exact} canCompact={slashCtx.canCompact} onCompact={() => void compact()} />
        ) : null}
      </div>
      <span className="visually-hidden" aria-live="polite">
        {mode.label} mode
      </span>
    </div>
  );
}
