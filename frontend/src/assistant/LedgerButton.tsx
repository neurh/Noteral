/**
 * The agent ledger: which chats are running right now, and what this chat has
 * done so far — steps, changes, sub-agents, sources and tokens.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, ListChecks, Square } from "lucide-react";
import { openMarkdownLink } from "../lib/links";
import { useAppStore } from "../store";
import { formatDuration, formatTokens, useNow } from "./Activity";
import { ledgerOf } from "./ledger";
import { useAssistant } from "./store";

export function LedgerButton() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const runs = useAssistant((state) => state.runs);
  const chatId = useAssistant((state) => state.chat.id);
  const others = Object.keys(runs).filter((id) => id !== chatId).length;
  const active = Object.keys(runs).length;
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`icon-button assistant-ledger-button${open ? " is-on" : ""}`}
        onClick={() => setOpen((value) => !value)}
        title={active ? `${active} running · Activity` : "Activity"}
        aria-label="Activity ledger"
        aria-expanded={open}
      >
        <ListChecks size={15} />
        {others ? <span className="ledger-badge">{others}</span> : null}
      </button>
      {open && button.current ? <LedgerPopover anchor={button.current} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function usePopoverPosition(anchor: HTMLElement, pop: React.RefObject<HTMLDivElement | null>) {
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = pop.current?.offsetWidth ?? 320;
      const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
      setStyle({ top: rect.bottom + 6, left });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor, pop]);
  return style;
}

export function useDismiss(ref: React.RefObject<HTMLElement | null>, anchor: HTMLElement | null, onClose: () => void) {
  useEffect(() => {
    const down = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [ref, anchor, onClose]);
}

function LedgerPopover({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const pop = useRef<HTMLDivElement>(null);
  const style = usePopoverPosition(anchor, pop);
  useDismiss(pop, anchor, onClose);
  const runs = useAssistant((state) => state.runs);
  const chat = useAssistant((state) => state.chat);
  const openChat = useAssistant((state) => state.openChat);
  const stop = useAssistant((state) => state.stop);
  const running = Object.keys(runs).length > 0;
  const now = useNow(running);
  const ledger = useMemo(() => ledgerOf(chat, now), [chat, now]);
  const pages = useAppStore((state) => state.pages);

  const runList = Object.entries(runs).sort((a, b) => a[1].startedAt - b[1].startedAt);

  return createPortal(
    <div ref={pop} className="ledger-pop" style={style} role="dialog" aria-label="Activity ledger">
      <div className="pop-title">Running</div>
      {runList.length ? (
        <ul className="ledger-list">
          {runList.map(([id, run]) => (
            <li key={id}>
              <span className="ledger-run-dot" aria-hidden="true" />
              <button
                type="button"
                className="ledger-name"
                onClick={() => {
                  void openChat(id);
                  onClose();
                }}
                title={id === chat.id ? "This chat" : "Open this chat"}
              >
                {run.title || "New chat"}
                {id === chat.id ? " · this chat" : ""}
              </button>
              <span className="ledger-meta">{formatDuration(now - run.startedAt)}</span>
              <button type="button" className="icon-button" onClick={() => stop(id)} title="Stop" aria-label="Stop this run" style={{ width: 22, height: 22 }}>
                <Square size={10} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ledger-empty">Nothing running. Chats keep working when you switch to another one.</div>
      )}

      <div className="pop-title">This chat</div>
      <div className="ledger-stats">
        <div className="ledger-stat">
          <b>{ledger.steps}</b>
          <span>steps</span>
        </div>
        <div className="ledger-stat">
          <b>{ledger.changes.length}</b>
          <span>changes</span>
        </div>
        <div className="ledger-stat">
          <b>{ledger.agents.length}</b>
          <span>agents</span>
        </div>
        <div className="ledger-stat">
          <b>{ledger.sources}</b>
          <span>sources</span>
        </div>
      </div>
      <div className="ledger-empty">
        {formatDuration(ledger.ms)} working · {formatTokens(ledger.input)} in · {formatTokens(ledger.output)} out
      </div>

      {ledger.agents.length ? (
        <>
          <div className="pop-title">Agents</div>
          <ul className="ledger-list">
            {ledger.agents.map((agent) => (
              <li key={agent.id}>
                <Bot size={12} />
                <span className="ledger-name">{agent.title}</span>
                <span className="ledger-meta">
                  {agent.status === "running" ? "running" : agent.status} · {agent.steps} steps · {formatDuration(agent.ms)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {ledger.changes.length ? (
        <>
          <div className="pop-title">Changes</div>
          <ul className="ledger-list">
            {ledger.changes.slice(-12).reverse().map((change) => {
              const page = change.pageId ? pages.find((item) => item.id === change.pageId) : undefined;
              return (
                <li key={change.id}>
                  <span className="ledger-name" title={change.hint}>
                    {change.label}
                    {change.hint ? ` · ${change.hint}` : ""}
                  </span>
                  {page ? (
                    <button type="button" className="reply-link" onClick={() => openMarkdownLink(`noteral://page/${page.id}`)}>
                      Open
                    </button>
                  ) : (
                    <span className="ledger-meta">{change.area}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
