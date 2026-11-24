import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, ReactNode } from "react";
import { Clipboard } from "@wailsio/runtime";
import {
  AtSign,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleHelp,
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
import { AskForm } from "../components/AskForm";
import { tabDragId } from "../lib/dragTab";
import { relativeTime } from "../lib/format";
import { openMarkdownLink } from "../lib/links";
import { Markdown } from "../lib/markdownView";
import { dialogs } from "../lib/dialogs";
import { toggleAssistant } from "./open";
import { Composer, MentionChip, focusComposer, useComposer } from "./Composer";
import { canMention, mentionsFromDrop } from "./mentions";
import { displayModel } from "./models";
import { ProvidersView } from "./ProvidersView";
import { useAssistant } from "./store";
import { MODES, toolHint, toolLabel, toolSpec } from "./tools";
import type { AssistantMode, ChatMessage, Part, ToolPart } from "./types";

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

  // Follow the stream unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

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
  const text = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("\n\n").trim();
  const groups = useMemo(() => groupParts(message.parts), [message.parts]);
  const waiting = message.parts.some((part) => part.type === "tool" && (part.status === "awaiting" || part.status === "asking"));
  const working = live && !waiting && (!message.parts.length || message.parts[message.parts.length - 1].type === "tool");

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
      {groups.map((group, index) =>
        group.kind === "tools" ? (
          <ToolGroup key={index} tools={group.tools} />
        ) : group.kind === "thinking" ? (
          <details key={index} className="assistant-thinking">
            <summary>{live && index === groups.length - 1 ? "Thinking…" : "Reasoning"}</summary>
            <p>{group.text}</p>
          </details>
        ) : (
          <Markdown key={index} source={group.text} className="assistant-md" onLink={openMarkdownLink} />
        ),
      )}
      {working ? (
        <div className="assistant-working" aria-live="polite">
          <span className="assistant-dots" aria-hidden="true"><i /><i /><i /></span> Working…
        </div>
      ) : null}
      {message.error ? (
        <div className="assistant-error" role="alert">
          <CircleAlert size={13} /> <span>{message.error}</span>
        </div>
      ) : null}
      {message.stopped ? <div className="assistant-stopped">Stopped</div> : null}
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

function formatTokens(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

type Group = { kind: "text"; text: string } | { kind: "thinking"; text: string } | { kind: "tools"; tools: ToolPart[] };

function groupParts(parts: Part[]): Group[] {
  const groups: Group[] = [];
  for (const part of parts) {
    const last = groups[groups.length - 1];
    if (part.type === "tool") {
      if (last?.kind === "tools") last.tools.push(part);
      else groups.push({ kind: "tools", tools: [part] });
    } else if (part.text.trim()) {
      if (last && last.kind === part.type) last.text += part.text;
      else groups.push({ kind: part.type, text: part.text });
    }
  }
  return groups;
}

// ── tools ──────────────────────────────────────────────────────────────────

function ToolGroup({ tools }: { tools: ToolPart[] }) {
  return (
    <div className="assistant-tools">
      {tools.map((tool) =>
        tool.status === "awaiting" ? (
          <ApprovalCard key={tool.id} tool={tool} />
        ) : tool.status === "asking" ? (
          <QuestionCard key={tool.id} tool={tool} />
        ) : tool.name === "ui.ask" && tool.status === "done" ? (
          <AnsweredRow key={tool.id} tool={tool} />
        ) : (
          <ToolRow key={tool.id} tool={tool} />
        ),
      )}
    </div>
  );
}

interface AskArgs {
  question?: string;
  options?: { label?: string; description?: string }[];
  multiple?: boolean;
  allowText?: boolean;
  placeholder?: string;
}

/** The assistant asked a question (ui.ask): answer it right in the chat. */
function QuestionCard({ tool }: { tool: ToolPart }) {
  const answer = useAssistant((state) => state.answer);
  const args = (tool.args ?? {}) as AskArgs;
  const options = (args.options ?? []).filter((item) => item?.label).map((item, index) => ({ id: String(index), label: String(item.label), description: item.description ? String(item.description) : undefined }));
  return (
    <div className="assistant-question" role="group" aria-label="Question from the assistant">
      <div className="assistant-question-title">
        <CircleHelp size={13} aria-hidden /> <span>{args.question || "The assistant has a question"}</span>
      </div>
      <AskForm
        compact
        hideQuestion
        question={args.question ?? ""}
        options={options}
        multiple={Boolean(args.multiple)}
        allowText={args.allowText !== false || !options.length}
        placeholder={args.placeholder ?? (options.length ? "Or type your own answer…" : "Type your answer…")}
        onAnswer={(reply) => answer(tool.id, reply)}
        onCancel={() => answer(tool.id, { answer: "", choices: [], cancelled: true })}
        submitLabel="Send answer"
      />
    </div>
  );
}

function AnsweredRow({ tool }: { tool: ToolPart }) {
  const args = (tool.args ?? {}) as AskArgs;
  let reply = "";
  let cancelled = false;
  try {
    const parsed = JSON.parse(tool.result ?? "{}") as { answer?: string; cancelled?: boolean };
    reply = parsed.answer ?? "";
    cancelled = Boolean(parsed.cancelled);
  } catch {
    reply = tool.result ?? "";
  }
  return (
    <div className="assistant-answered">
      <span className="assistant-answered-q">
        <CircleHelp size={12} aria-hidden /> {args.question}
      </span>
      <span className={`assistant-answered-a${cancelled ? " is-skipped" : ""}`}>{cancelled ? "Skipped" : reply || "—"}</span>
    </div>
  );
}

function StatusIcon({ status }: { status: ToolPart["status"] }) {
  if (status === "running" || status === "pending") return <LoaderCircle size={12} className="spin" />;
  if (status === "error") return <CircleAlert size={12} />;
  if (status === "declined") return <X size={12} />;
  return <Check size={12} />;
}

function ToolRow({ tool }: { tool: ToolPart }) {
  const [open, setOpen] = useState(false);
  const done = tool.status === "done";
  const hint = toolHint(tool.name, tool.args);
  const spec = toolSpec(tool.name);
  const plain = (spec?.summary ?? tool.name).replace(/\.$/, "");
  const label =
    tool.status === "declined" ? `Declined · ${plain}` : tool.status === "error" ? `Failed · ${plain}` : toolLabel(tool.name, done);
  const sources = tool.name === "web.search" && done ? searchResults(tool.result) : [];
  return (
    <div className={`assistant-tool status-${tool.status}`}>
      <button type="button" className="assistant-tool-row" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="assistant-tool-icon"><StatusIcon status={tool.status} /></span>
        <span className="assistant-tool-label">{label}</span>
        {hint ? <span className="assistant-tool-hint">{hint}</span> : null}
        {sources.length ? <span className="assistant-tool-count">{sources.length} results</span> : null}
        <ChevronDown size={12} className="assistant-tool-caret" />
      </button>
      {open ? (
        <div className="assistant-tool-detail">
          {sources.length ? (
            <ul className="assistant-sources">
              {sources.map((item) => (
                <li key={item.url}>
                  <button type="button" onClick={() => openMarkdownLink(item.url)} title={item.url}>
                    <span>{item.title || item.url}</span>
                    <small>{hostOf(item.url)}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="assistant-tool-io">
            <span>{tool.name}</span>
            <pre>{JSON.stringify(tool.args, null, 2)}</pre>
          </div>
          {tool.error ? <div className="assistant-tool-io error"><span>Error</span><pre>{tool.error}</pre></div> : null}
          {tool.result && !sources.length ? (
            <div className="assistant-tool-io">
              <span>Result</span>
              <pre>{prettyResult(tool.result)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ApprovalCard({ tool }: { tool: ToolPart }) {
  const respond = useAssistant((state) => state.respond);
  const spec = toolSpec(tool.name);
  const destructive = Boolean(spec?.confirm);
  const preview = describeCall(tool);
  return (
    <div className={`assistant-approval${destructive ? " danger" : ""}`} role="group" aria-label="Approve action">
      <div className="assistant-approval-title">
        <CircleAlert size={13} /> {(spec?.summary ?? tool.name).replace(/\.$/, "")}
      </div>
      {preview ? <div className="assistant-approval-body">{preview}</div> : null}
      <details className="assistant-approval-args">
        <summary>Details</summary>
        <pre>{JSON.stringify(tool.args, null, 2)}</pre>
      </details>
      <div className="assistant-approval-actions">
        <button type="button" className={destructive ? "primary-button primary-danger" : "primary-button"} onClick={() => respond(tool.id, true)} autoFocus>
          Allow
        </button>
        {!destructive ? (
          <button type="button" className="secondary-button" onClick={() => respond(tool.id, true, true)} title={`Don't ask again for ${tool.name} in this chat`}>
            Allow for this chat
          </button>
        ) : null}
        <button type="button" className="secondary-button" onClick={() => respond(tool.id, false)}>
          Decline
        </button>
      </div>
    </div>
  );
}

/** A readable one-liner for what an approval-gated call will do. */
function describeCall(tool: ToolPart): ReactNode {
  const args = tool.args as Record<string, unknown>;
  if (tool.name === "plugins.create") {
    const manifest = (args.manifest ?? {}) as { name?: string; permissions?: string[]; description?: string };
    const code = typeof args.code === "string" ? args.code : "";
    return (
      <>
        <strong>{manifest.name ?? "Plugin"}</strong> — {manifest.description ?? ""}
        <div className="assistant-approval-meta">
          {(manifest.permissions ?? []).length ? `Permissions: ${(manifest.permissions ?? []).join(", ")}` : "No permissions"} · {code.split("\n").length} lines of code
        </div>
      </>
    );
  }
  const hint = toolHint(tool.name, tool.args);
  return hint ? <span>{hint}</span> : null;
}

function searchResults(result?: string): { title: string; url: string }[] {
  if (!result) return [];
  try {
    const parsed = JSON.parse(result) as { results?: { title: string; url: string }[] };
    return (parsed.results ?? []).filter((item) => item.url).slice(0, 10);
  } catch {
    return [];
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function prettyResult(result: string) {
  try {
    const text = JSON.stringify(JSON.parse(result), null, 2);
    return text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text;
  } catch {
    return result.length > 4000 ? `${result.slice(0, 4000)}\n…` : result;
  }
}

// ── history ────────────────────────────────────────────────────────────────

function HistoryView() {
  const chats = useAssistant((state) => state.chats);
  const currentId = useAssistant((state) => state.chat.id);
  const openChat = useAssistant((state) => state.openChat);
  const deleteChat = useAssistant((state) => state.deleteChat);
  const [filter, setFilter] = useState("");
  const visible = chats.filter((chat) => !filter.trim() || chat.title.toLowerCase().includes(filter.trim().toLowerCase()));

  const remove = async (id: string, title: string) => {
    const ok = await dialogs.confirm({ title: "Delete this chat?", message: `“${title || "Untitled chat"}” is removed from this computer.`, confirmLabel: "Delete", danger: true });
    if (ok) await deleteChat(id);
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
