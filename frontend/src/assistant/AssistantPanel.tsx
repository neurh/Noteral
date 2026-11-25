import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { Clipboard } from "@wailsio/runtime";
import {
  AtSign,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  FileText,
  History,
  LoaderCircle,
  Plus,
  RotateCcw,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { tabDragId } from "../lib/dragTab";
import { relativeTime } from "../lib/format";
import { openMarkdownLink } from "../lib/links";
import { Markdown } from "../lib/markdownView";
import { dialogs } from "../lib/dialogs";
import { toggleAssistant } from "./open";
import { Composer, MentionChip, focusComposer, useComposer } from "./Composer";
import { canMention, mentionsFromDrop } from "./mentions";
import { displayModel } from "./models";
import { LedgerButton } from "./Ledger";
import { ProvidersView } from "./ProvidersView";
import { useAssistant } from "./store";
import { ApprovalCard, ChangeList, QuestionCard, SourceList, ThinkingLoader, Timeline, changesOf, formatTokens, layoutReply, sourcesOf } from "./Activity";
import { MODES } from "./tools";
import type { AssistantMode, ChatMessage } from "./types";

const iso = (ms: number) => new Date(ms).toISOString();

const SUGGESTIONS: Record<AssistantMode, string[]> = {
  ask: ["Summarize this page", "What did I write about this last week?", "Search the web for recent news on this topic"],
  edit: ["Turn my selection into a checklist", "Add a short summary at the top", "Create a meeting notes page for today"],
  creator: ["Make the accent color forest green", "Add a status bar word goal of 1,000 words", "Use a serif font for reading"],
};

export function AssistantPanel() {
  const init = useAssistant((state) => state.init);
  const ready = useAssistant((state) => state.ready);
  const view = useAssistant((state) => state.view);

  useEffect(() => {
    void init();
  }, [init]);

  if (!ready) {
    return (
      <div className="assistant assistant-loading">
        <LoaderCircle size={16} className="spin" />
      </div>
    );
  }
  return (
    <div className="assistant">
      <AssistantHeader />
      {view === "providers" ? <ProvidersView /> : view === "history" ? <HistoryView /> : <ChatView />}
    </div>
  );
}

/** Lets pages, rows, tabs, sidebar tabs and editor blocks be dropped on the chat to mention them. */
function useMentionDrop() {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const addMentions = useComposer((state) => state.addMentions);
  const accepts = (event: ReactDragEvent) => canMention(event.dataTransfer);
  return {
    over,
    handlers: {
      onDragEnter(event: ReactDragEvent) {
        if (!accepts(event)) return;
        event.preventDefault();
        depth.current += 1;
        setOver(true);
      },
      onDragOver(event: ReactDragEvent) {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "link";
      },
      onDragLeave(event: ReactDragEvent) {
        if (!accepts(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      },
      onDrop(event: ReactDragEvent) {
        if (!accepts(event)) return;
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        const items = mentionsFromDrop(event.dataTransfer, tabDragId());
        if (items.length) {
          addMentions(items);
          focusComposer();
        }
      },
    },
  };
}

function AssistantHeader() {
  const view = useAssistant((state) => state.view);
  const setView = useAssistant((state) => state.setView);
  const newChat = useAssistant((state) => state.newChat);
  const title = useAssistant((state) => state.chat.title);
  const label = view === "providers" ? "Assistant settings" : view === "history" ? "Chats" : title || "New chat";
  return (
    <header className="assistant-head">
      {view !== "chat" ? (
        <button type="button" className="icon-button" onClick={() => setView("chat")} aria-label="Back to chat" title="Back to chat">
          <ChevronRight size={15} style={{ transform: "rotate(180deg)" }} />
        </button>
      ) : null}
      <h3 title={label}>{label}</h3>
      <div className="assistant-head-actions">
        <LedgerButton />
        <button type="button" className={`icon-button ${view === "history" ? "is-on" : ""}`} onClick={() => setView(view === "history" ? "chat" : "history")} title="Chat history" aria-label="Chat history" aria-pressed={view === "history"}>
          <History size={15} />
        </button>
        <button type="button" className={`icon-button ${view === "providers" ? "is-on" : ""}`} onClick={() => setView(view === "providers" ? "chat" : "providers")} title="Providers and settings" aria-label="Providers and settings" aria-pressed={view === "providers"}>
          <Settings2 size={15} />
        </button>
        <button type="button" className="icon-button" onClick={newChat} title="New chat" aria-label="New chat">
          <Plus size={16} />
        </button>
        <button type="button" className="icon-button assistant-close" onClick={() => toggleAssistant(false)} title="Close assistant" aria-label="Close assistant">
          <X size={15} />
        </button>
      </div>
    </header>
  );
}

// ── chat ───────────────────────────────────────────────────────────────────

function ChatView() {
  const messages = useAssistant((state) => state.chat.messages);
  const running = useAssistant((state) => state.running);
  const providers = useAssistant((state) => state.providers);
  const scroller = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const drop = useMentionDrop();

  // Follow the stream unless the reader scrolled up; a new message from the
  // user always brings the view back to the bottom.
  const userCount = messages.reduce((sum, message) => sum + (message.role === "user" ? 1 : 0), 0);
  const lastUserCount = useRef(userCount);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (userCount > lastUserCount.current) pinned.current = true;
    lastUserCount.current = userCount;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages, userCount]);

  // Content can also grow without new messages (a reasoning block opened, a card
  // expanded, an image loaded): stay at the bottom when the reader was there.
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [messages.length === 0]);

  const hasProvider = providers.some((item) => item.enabled);
  const lastAssistant = messages.length && messages[messages.length - 1].role === "assistant" ? messages[messages.length - 1].id : null;

  return (
    <div className={`assistant-chat${drop.over ? " is-drop" : ""}`} {...drop.handlers}>
      <div
        className="assistant-scroll"
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {messages.length === 0 ? (
          <EmptyChat hasProvider={hasProvider} />
        ) : (
          <div className="assistant-messages" ref={content}>
            {messages.map((message) =>
              message.role === "user" ? (
                <UserMessage key={message.id} message={message} />
              ) : (
                <AssistantMessage key={message.id} message={message} live={running && message.id === lastAssistant} last={message.id === lastAssistant} />
              ),
            )}
          </div>
        )}
      </div>
      <Composer />
      {drop.over ? (
        <div className="assistant-drop" aria-hidden>
          <AtSign size={18} />
          <span>Drop to mention</span>
        </div>
      ) : null}
    </div>
  );
}

function EmptyChat({ hasProvider }: { hasProvider: boolean }) {
  const mode = useAssistant((state) => state.settings.mode);
  const send = useAssistant((state) => state.send);
  const setView = useAssistant((state) => state.setView);
  const info = MODES.find((item) => item.id === mode)!;
  if (!hasProvider) {
    return (
      <div className="assistant-empty">
        <h4>Connect a model</h4>
        <p>Add a provider to start. Keys stay on this computer; Ollama and LM Studio run fully offline.</p>
        <button type="button" className="primary-button" onClick={() => setView("providers")}>Add a provider</button>
      </div>
    );
  }
  return (
    <div className="assistant-empty">
      <h4>{info.label} mode</h4>
      <p>{info.summary}</p>
      <div className="assistant-suggestions">
        {SUGGESTIONS[mode].map((text) => (
          <button key={text} type="button" className="assistant-suggestion" onClick={() => void send(text)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

const UserMessage = memo(function UserMessage({ message }: { message: ChatMessage }) {
  const text = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
  return (
    <div className="assistant-user">
      {message.mentions?.length ? (
        <div className="assistant-mentions is-sent">
          {message.mentions.map((item) => (
            <MentionChip key={`${item.kind}:${item.id}`} mention={item} />
          ))}
        </div>
      ) : message.context?.pageTitle ? (
        <span className="assistant-context-tag" title={message.context.selection ? `Selection: ${message.context.selection.slice(0, 200)}` : undefined}>
          <FileText size={11} /> {message.context.pageTitle}
          {message.context.selection ? " · selection" : ""}
        </span>
      ) : null}
      {text ? <div className="assistant-user-bubble">{text}</div> : null}
    </div>
  );
});

const AssistantMessage = memo(function AssistantMessage({ message, live, last }: { message: ChatMessage; live: boolean; last: boolean }) {
  const regenerate = useAssistant((state) => state.regenerate);
  const running = useAssistant((state) => state.running);
  const [copied, setCopied] = useState(false);
  const layout = useMemo(() => layoutReply(message.parts), [message.parts]);
  const sources = useMemo(() => (live ? [] : sourcesOf(message)), [message, live]);
  const changes = useMemo(() => (live ? [] : changesOf(message)), [message, live]);
  const text = layout.answer.trim();
  const started = !live || message.parts.some((part) => (part.type === "text" ? part.text.trim() : part.type === "tool" || part.text.trim()));

  const copy = async () => {
    try {
      await Clipboard.SetText(text);
    } catch {
      await navigator.clipboard?.writeText(text).catch(() => undefined);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1300);
  };

  return (
    <div className={`assistant-reply${live ? " live" : ""}`}>
      {!started ? <ThinkingLoader since={message.createdAt} /> : null}
      <Timeline message={message} steps={layout.steps} live={live && !layout.pending.length && !text} waiting={live && layout.pending.length > 0} />
      {layout.pending.map((tool) => (tool.status === "asking" ? <QuestionCard key={tool.id} tool={tool} /> : <ApprovalCard key={tool.id} tool={tool} />))}
      {text ? <Markdown source={layout.answer} className={`assistant-md assistant-answer${live ? " is-streaming" : ""}`} onLink={openMarkdownLink} /> : null}
      {message.error ? (
        <div className="assistant-error" role="alert">
          <CircleAlert size={13} /> <span>{message.error}</span>
        </div>
      ) : null}
      {message.stopped ? <div className="assistant-stopped">Stopped</div> : null}
      {!live ? <ChangeList changes={changes} /> : null}
      {!live ? <SourceList sources={sources} /> : null}
      {!live && (text || message.error) ? (
        <div className="assistant-reply-foot">
          {text ? (
            <button type="button" className="assistant-mini" onClick={() => void copy()} title="Copy reply">
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
          {last ? (
            <button type="button" className="assistant-mini" onClick={() => void regenerate()} disabled={running} title="Run this reply again">
              <RotateCcw size={12} /> Retry
            </button>
          ) : null}
          <span className="assistant-reply-meta">
            {message.model ? displayModel(message.model) : ""}
            {message.usage ? ` · ${formatTokens(message.usage.input)} in · ${formatTokens(message.usage.output)} out` : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
});

// ── history ────────────────────────────────────────────────────────────────

function HistoryView() {
  const chats = useAssistant((state) => state.chats);
  const currentId = useAssistant((state) => state.chat.id);
  const openChat = useAssistant((state) => state.openChat);
  const deleteChat = useAssistant((state) => state.deleteChat);
  const runs = useAssistant((state) => state.runs);
  const waiting = useAssistant((state) => state.waiting);
  const stop = useAssistant((state) => state.stop);
  const [filter, setFilter] = useState("");
  const visible = chats.filter((chat) => !filter.trim() || chat.title.toLowerCase().includes(filter.trim().toLowerCase()));

  const remove = async (id: string, title: string) => {
    const ok = await dialogs.confirm({ title: "Delete this chat?", message: `“${title || "Untitled chat"}” is removed from this computer.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    if (runs[id]) stop(id);
    await deleteChat(id);
  };

  return (
    <div className="assistant-scroll assistant-history">
      {chats.length > 6 ? (
        <input className="inline-input assistant-history-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter chats…" aria-label="Filter chats" />
      ) : null}
      {chats.length === 0 ? (
        <div className="assistant-empty">
          <h4>No chats yet</h4>
          <p>Chats are saved on this computer as you go.</p>
        </div>
      ) : (
        <ul className="assistant-history-list">
          {visible.map((chat) => (
            <li key={chat.id} className={chat.id === currentId ? "active" : ""}>
              <button type="button" className="assistant-history-open" onClick={() => void openChat(chat.id)}>
                <span className="assistant-history-title">{chat.title || "Untitled chat"}</span>
                <span className="assistant-history-meta">
                  {runs[chat.id] ? (
                    <span className="history-running">
                      <span className="ledger-run-dot" aria-hidden="true" /> {waiting[chat.id]?.length ? "Waiting for you" : "Working"} ·
                    </span>
                  ) : null}
                  <span className={`assistant-mode-dot mode-${chat.mode}`} /> {MODES.find((item) => item.id === chat.mode)?.label ?? chat.mode} · {chat.messages} messages · {relativeTime(iso(chat.updatedAt))}
                </span>
              </button>
              <button type="button" className="icon-button" onClick={() => void remove(chat.id, chat.title)} aria-label={`Delete ${chat.title}`} title="Delete chat">
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
