import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { dialogs, useCurrentDialog } from "../lib/dialogs";
import type { AskRequest, ConfirmRequest, OpenDialog, PickRequest, PromptRequest } from "../lib/dialogs";
import { AskForm } from "./AskForm";
import { Modal } from "./Modal";

/**
 * Renders the confirm / prompt / pick dialogs that plugins (ui.confirm,
 * ui.prompt, ui.pick), permission checks and the assistant ask for. Requests
 * queue up and show one at a time; closing a dialog counts as "cancel".
 */
export function HostDialogs() {
  const current = useCurrentDialog();
  if (!current) return null;
  const { request } = current;
  if (request.kind === "confirm") return <ConfirmDialog key={current.id} dialog={current} request={request} />;
  if (request.kind === "prompt") return <PromptDialog key={current.id} dialog={current} request={request} />;
  if (request.kind === "ask") return <AskDialog key={current.id} dialog={current} request={request} />;
  return <PickDialog key={current.id} dialog={current} request={request} />;
}

function Source({ source }: { source?: string }) {
  if (!source) return null;
  return <p className="host-dialog-source">Requested by <strong>{source}</strong></p>;
}

function ConfirmDialog({ dialog, request }: { dialog: OpenDialog; request: ConfirmRequest }) {
  const close = (value: boolean) => dialogs.settle(dialog.id, value);
  return (
    <Modal
      open
      title={request.title}
      onClose={() => close(false)}
      width="small"
      className="host-dialog"
      footer={
        <>
          <button type="button" className="secondary-button" onClick={() => close(false)}>{request.cancelLabel ?? "Cancel"}</button>
          <button type="button" className={`primary-button${request.danger ? " primary-danger" : ""}`} onClick={() => close(true)} autoFocus>
            {request.confirmLabel ?? "Continue"}
          </button>
        </>
      }
    >
      <Source source={request.source} />
      {request.message ? <p className="host-dialog-message">{request.message}</p> : null}
      {request.details?.length ? (
        <ul className="host-dialog-details">
          {request.details.map((item, index) => (
            <li key={`${item.label}-${index}`} className={item.tone === "danger" ? "danger-row" : undefined}>
              {item.tone === "danger" ? <AlertTriangle size={13} aria-hidden="true" /> : <span className="host-dialog-dot" aria-hidden="true" />}
              <div>
                <strong>{item.label}</strong>
                {item.description ? <span>{item.description}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  );
}

function AskDialog({ dialog, request }: { dialog: OpenDialog; request: AskRequest }) {
  const close = (value: unknown) => dialogs.settle(dialog.id, value);
  return (
    <Modal open title="Question" onClose={() => close(null)} width="small" className="host-dialog">
      <Source source={request.source} />
      <AskForm
        question={request.question}
        options={request.options}
        multiple={request.multiple}
        allowText={request.allowText}
        placeholder={request.placeholder}
        onAnswer={(answer) => close(answer)}
        onCancel={() => close(null)}
      />
    </Modal>
  );
}

function PromptDialog({ dialog, request }: { dialog: OpenDialog; request: PromptRequest }) {
  const [value, setValue] = useState(request.value ?? "");
  const close = (result: string | null) => dialogs.settle(dialog.id, result);
  const submit = () => close(value);
  return (
    <Modal
      open
      title={request.title}
      onClose={() => close(null)}
      width="small"
      className="host-dialog"
      footer={
        <>
          <button type="button" className="secondary-button" onClick={() => close(null)}>Cancel</button>
          <button type="button" className="primary-button" onClick={submit}>{request.confirmLabel ?? "OK"}</button>
        </>
      }
    >
      <Source source={request.source} />
      <form
        className="host-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {request.message ? <label className="host-dialog-message" htmlFor={`host-prompt-${dialog.id}`}>{request.message}</label> : null}
        {request.multiline ? (
          <textarea
            id={`host-prompt-${dialog.id}`}
            className="host-field"
            rows={5}
            value={value}
            placeholder={request.placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
            }}
            autoFocus
          />
        ) : (
          <input
            id={`host-prompt-${dialog.id}`}
            className="host-field"
            value={value}
            placeholder={request.placeholder}
            onChange={(event) => setValue(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            autoFocus
            spellCheck={false}
          />
        )}
      </form>
    </Modal>
  );
}

function PickDialog({ dialog, request }: { dialog: OpenDialog; request: PickRequest }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const close = (result: string | null) => dialogs.settle(dialog.id, result);
  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return request.items;
    return request.items.filter((item) => `${item.label} ${item.description ?? ""}`.toLowerCase().includes(needle));
  }, [query, request.items]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <Modal open title={request.title} onClose={() => close(null)} width="small" className="host-dialog" bodyClassName="host-pick-body">
      <Source source={request.source} />
      {request.items.length > 6 ? (
        <label className="picker-search host-pick-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter…"
            aria-label="Filter items"
            autoFocus
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(items.length - 1, index + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter" && items[active]) {
                event.preventDefault();
                close(items[active].id);
              }
            }}
          />
        </label>
      ) : null}
      <div className="host-pick-list" role="listbox" aria-label={request.title} ref={list}>
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === active}
            data-index={index}
            className={`host-pick-item${index === active ? " active" : ""}`}
            onMouseEnter={() => setActive(index)}
            onClick={() => close(item.id)}
            autoFocus={request.items.length <= 6 && index === 0}
          >
            <span>{item.label}</span>
            {item.description ? <small>{item.description}</small> : null}
          </button>
        ))}
        {items.length === 0 ? <p className="host-pick-empty">Nothing matches “{query}”.</p> : null}
      </div>
    </Modal>
  );
}
