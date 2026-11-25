import { CloudOff, LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ContributedMenuItems, useMenuItems } from "./ContributedMenuItems";
import { commandRegistry } from "../lib/commands";
import { BUILTIN_STATUS_WIDGETS, useContributions } from "../lib/contributions";
import type { StatusWidgetContribution } from "../lib/contributions";
import { usePluginStatuses } from "../plugins/runtime";
import { useAppStore } from "../store";
import { PageIcon } from "./PageIcon";
import { ViewFrame } from "./ViewFrame";

type Slot = { key: string; side: "left" | "right"; order: number; node: ReactNode };

/** Runs a widget's command: an app command id, or a command of the plugin that owns the widget. */
function runWidgetCommand(widget: StatusWidgetContribution) {
  if (!widget.command) return;
  const command = commandRegistry.get(widget.command) ?? (widget.owner.kind === "plugin" ? commandRegistry.get(`plugin:${widget.owner.id}:${widget.command}`) : undefined);
  if (!command) {
    useAppStore.getState().notify(`${widget.owner.name}: no command "${widget.command}".`, "error");
    return;
  }
  void Promise.resolve(command.run()).catch((error: unknown) => {
    useAppStore.getState().notify(error instanceof Error ? error.message : String(error), "error");
  });
}

function ContributedWidget({ widget }: { widget: StatusWidgetContribution }) {
  const title = widget.tooltip ? `${widget.tooltip} — ${widget.owner.name}` : widget.owner.name;
  if (widget.html) {
    return (
      <span className="status-widget status-widget-html" style={{ width: widget.width ?? 120 }}>
        <ViewFrame
          surface="status"
          viewKey={widget.key}
          html={widget.html}
          owner={widget.owner}
          permissions={widget.permissions}
          fill
          className="status-widget-frame"
          title={title}
        />
      </span>
    );
  }
  const body = (
    <>
      {widget.icon ? <PageIcon value={widget.icon} size={12} /> : null}
      {widget.text ? <span className="status-widget-text">{widget.text}</span> : null}
    </>
  );
  if (widget.command) {
    return (
      <button type="button" className="status-widget is-button" title={title} onClick={() => runWidgetCommand(widget)}>
        {body}
      </button>
    );
  }
  return (
    <span className="status-widget" title={title}>
      {body}
    </span>
  );
}

export function StatusBar() {
  const document = useAppStore((state) => state.documents[state.activePageId]);
  const showStats = useAppStore((state) => state.settings.showStats);
  const liveWords = useAppStore((state) => state.liveWordCount);
  const liveBlocks = useAppStore((state) => state.liveBlockCount);
  const statuses = usePluginStatuses();
  const notify = useAppStore((state) => state.notify);
  const { statusWidgets } = useContributions();
  const statusMenu = useMenuItems({ menu: "status" });
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menuAt) return;
    const close = () => setMenuAt(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", close);
    };
  }, [menuAt]);

  const state = document?.saveState ?? "idle";
  const label =
    state === "saving"
      ? "Saving…"
      : state === "dirty"
        ? "Unsaved changes"
        : state === "error"
          ? "Save failed"
          : document
            ? "Saved"
            : "Ready";

  const builtin: Record<(typeof BUILTIN_STATUS_WIDGETS)[number]["id"], ReactNode> = {
    save: (
      <>
        <span className={`save-state save-${state}`} title={document?.error ?? "Saves are confirmed by the local backend before this indicator changes."}>
          <span className="save-dot" aria-hidden="true" />
          <span aria-live="polite">{label}</span>
        </span>
        {document?.error ? (
          <button
            type="button"
            className="status-retry"
            title="Try saving again"
            onClick={() => {
              notify("Retrying save…", "info");
              void useAppStore.getState().saveNow(document.id);
            }}
          >
            Retry
          </button>
        ) : null}
      </>
    ),
    stats:
      document && showStats && (document.kind ?? "page") === "page" ? (
        <span className="status-stats">
          {liveWords.toLocaleString()} words
          <span className="status-divider" aria-hidden="true">·</span>
          {liveBlocks.toLocaleString()} blocks
        </span>
      ) : null,
    plugins: statuses.length
      ? statuses.map((status) => (
          <span key={`${status.pluginId}:${status.itemId}`} className="plugin-status" title={status.title}>
            {status.text}
          </span>
        ))
      : null,
    local: (
      <>
        <span className="local-badge" title="Your notes stay on this device"><LockKeyhole size={11} /> Local-first</span>
        <CloudOff size={12} className="offline-icon" aria-label="No cloud connection" />
      </>
    ),
  };

  const slots: Slot[] = [];
  for (const item of BUILTIN_STATUS_WIDGETS) {
    const node = builtin[item.id];
    if (node) slots.push({ key: `builtin:${item.id}`, side: item.side, order: item.order, node });
  }
  for (const widget of statusWidgets) {
    slots.push({ key: widget.key, side: widget.side, order: widget.order, node: <ContributedWidget widget={widget} /> });
  }
  slots.sort((a, b) => a.order - b.order);

  const side = (which: "left" | "right") =>
    slots
      .filter((slot) => slot.side === which)
      .map((slot, index) => (
        <span key={slot.key} className="status-slot">
          {index > 0 ? <span className="status-divider" aria-hidden="true">·</span> : null}
          {slot.node}
        </span>
      ));

  return (
    <footer
      className="status-bar"
      aria-label="Status"
      onContextMenu={(event) => {
        if (!statusMenu.length) return;
        event.preventDefault();
        setMenuAt({ x: event.clientX, y: event.clientY });
      }}
    >
      <div className="status-left">{side("left")}</div>
      <div className="status-right">{side("right")}</div>
      {menuAt
        ? createPortal(
            <div
              className="menu status-menu"
              role="menu"
              style={{ position: "fixed", left: Math.min(menuAt.x, window.innerWidth - 240), bottom: Math.max(8, window.innerHeight - menuAt.y + 4) }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <ContributedMenuItems context={{ menu: "status" }} onDone={() => setMenuAt(null)} separator={<></>} />
            </div>,
            window.document.body,
          )
        : null}
    </footer>
  );
}
