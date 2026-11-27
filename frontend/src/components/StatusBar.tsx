import { canConfigure } from "./PluginConfigureDialog";
import { pluginConfigure } from "../lib/pluginConfigure";
import { CloudOff, LockKeyhole } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { runMenuItem, useMenuItems } from "./ContributedMenuItems";
import { commandRegistry } from "../lib/commands";
import { BUILTIN_STATUS_WIDGETS, useContributions } from "../lib/contributions";
import type { StatusWidgetContribution } from "../lib/contributions";
import { customizations, useStatusBarLayout } from "../lib/customizations";
import { popups } from "../lib/popups";
import type { PopupMenuItem, PopupPlacement, PopupRect } from "../lib/popups";
import { STATUS_SEPARATORS, isStatusItemHidden, mergeStatusBar, normalizeStatusBar, resolveStatusSlots, statusWidthStyle } from "../lib/statusLayout";
import type { StatusBarLayout, StatusItemLayout, StatusSeparator, StatusSide, StatusWidth } from "../lib/statusLayout";
import { pluginRuntime, usePluginStatuses } from "../plugins/runtime";
import { useAppStore } from "../store";
import { PageIcon } from "./PageIcon";
import { ViewFrame } from "./ViewFrame";

type Slot = {
  key: string;
  title: string;
  side: StatusSide;
  order: number;
  width?: StatusWidth;
  minWidth?: number;
  maxWidth?: number;
  node: ReactNode | ((width: StatusWidth | undefined) => ReactNode);
};

/** The widget's slot rect, for popups and command contexts. */
function slotRect(key: string): PopupRect | undefined {
  const element = document.querySelector(`[data-status-key="${CSS.escape(key)}"]`);
  if (!element) return undefined;
  const r = element.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

function defaultPlacement(widget: StatusWidgetContribution): PopupPlacement {
  return widget.side === "left" ? "top-start" : widget.side === "center" ? "top-center" : "top-end";
}

/** Toggle the widget's own popover (declared with `popup`). */
export function toggleWidgetPopup(widget: StatusWidgetContribution) {
  if (!widget.popup) return;
  const anchor = slotRect(widget.key);
  void popups.popover(
    {
      owner: widget.owner,
      permissions: widget.permissions,
      html: widget.popup.html,
      data: widget.popup.data ?? null,
      name: `status:${widget.id}`,
      ...(anchor ? { anchor } : {}),
      placement: widget.popup.placement ?? defaultPlacement(widget),
      ...(widget.popup.width ? { width: widget.popup.width } : {}),
      ...(widget.popup.height ? { height: widget.popup.height } : {}),
      ...(widget.popup.bare ? { bare: true } : {}),
      ...(widget.popup.persistent ? { persistent: true } : {}),
      ignore: `[data-status-key="${widget.key.replace(/["\\]/g, "")}"]`,
    },
    { toggle: true },
  );
}

/**
 * Runs a widget's command: an app command id, or a command of the plugin that owns the widget.
 * Plugin commands get `{ source: "status", widget, anchor }` so they can open a popover next to it.
 */
function runWidgetCommand(widget: StatusWidgetContribution) {
  if (!widget.command) return;
  const fail = (error: unknown) => useAppStore.getState().notify(error instanceof Error ? error.message : String(error), "error");
  const own = widget.owner.kind === "plugin" ? commandRegistry.get(`plugin:${widget.owner.id}:${widget.command}`) : undefined;
  if (own && widget.owner.kind === "plugin") {
    const anchor = slotRect(widget.key);
    void pluginRuntime.runMenuCommand(widget.owner.id, widget.command, { source: "status", widget: widget.id, ...(anchor ? { anchor } : {}) }).catch(fail);
    return;
  }
  const command = commandRegistry.get(widget.command);
  if (!command) {
    useAppStore.getState().notify(`${widget.owner.name}: no command "${widget.command}".`, "error");
    return;
  }
  void Promise.resolve(command.run()).catch(fail);
}

function widgetStyle(widget: StatusWidgetContribution): CSSProperties | undefined {
  const style: Record<string, string> = {};
  if (widget.color) style.color = widget.color;
  if (widget.background) style.background = widget.background;
  if (widget.progress !== undefined) style["--status-progress"] = `${Math.round(widget.progress * 1000) / 10}%`;
  return Object.keys(style).length ? (style as CSSProperties) : undefined;
}

function ContributedWidget({ widget, autoWidth }: { widget: StatusWidgetContribution; autoWidth: boolean }) {
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  const props = useMemo(() => ({ data: widget.data ?? null, widget: widget.id }), [widget.data, widget.id]);
  const title = widget.tooltip ? `${widget.tooltip} — ${widget.owner.name}` : widget.owner.name;
  const tone = widget.tone ? ` tone-${widget.tone}` : "";
  const progress = widget.progress !== undefined ? <span className="status-widget-progress" aria-hidden="true" /> : null;
  if (widget.html) {
    const style: CSSProperties = { ...widgetStyle(widget) };
    if (autoWidth) {
      style.width = Math.max(16, Math.min(widget.maxWidth ?? 600, contentWidth ?? 24));
      style.flex = "0 0 auto";
    }
    return (
      <span className={`status-widget status-widget-html${tone}${progress ? " has-progress" : ""}`} style={style}>
        <ViewFrame
          surface="status"
          viewKey={widget.key}
          html={widget.html}
          owner={widget.owner}
          permissions={widget.permissions}
          props={props}
          fill
          className="status-widget-frame"
          title={title}
          onContentWidth={autoWidth ? setContentWidth : undefined}
        />
        {progress}
      </span>
    );
  }
  const body = (
    <>
      {widget.icon ? <PageIcon value={widget.icon} size={12} /> : null}
      {widget.text ? <span className="status-widget-text">{widget.text}</span> : null}
      {widget.badge ? <span className="status-widget-badge">{widget.badge}</span> : null}
      {progress}
    </>
  );
  const className = `status-widget${tone}${progress ? " has-progress" : ""}${widget.background ? " has-background" : ""}`;
  if (widget.command || widget.popup) {
    return (
      <button
        type="button"
        className={`${className} is-button`}
        title={title}
        style={widgetStyle(widget)}
        aria-haspopup={widget.popup ? "dialog" : undefined}
        onClick={() => (widget.popup ? toggleWidgetPopup(widget) : runWidgetCommand(widget))}
      >
        {body}
      </button>
    );
  }
  return (
    <span className={className} title={title} style={widgetStyle(widget)}>
      {body}
    </span>
  );
}

function StatusClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className="status-clock" title={now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}>
      {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

/** Save a change to the user's own status bar layout. */
export function updateStatusLayout(patch: StatusBarLayout | null) {
  customizations.update((draft) => {
    const next = patch === null ? undefined : normalizeStatusBar(mergeStatusBar(draft.statusBar, patch));
    if (next) draft.statusBar = next;
    else delete draft.statusBar;
  });
}

function setItem(key: string, item: StatusItemLayout) {
  updateStatusLayout({ items: { [key]: item } });
}

const SEPARATOR_LABELS: Record<StatusSeparator, string> = { none: "None", line: "Vertical line", dot: "Dot", slash: "Slash", space: "Extra space" };
const SIDE_LABELS: Record<StatusSide, string> = { left: "Left", center: "Center", right: "Right" };

function widthLabel(width: StatusWidth | undefined): string {
  if (width === undefined || width === "auto") return "Fit content";
  if (width === "fill") return "Fill free space";
  return typeof width === "number" ? `${width}px` : `${width} of the bar`;
}

export function StatusBar() {
  const document = useAppStore((state) => state.documents[state.activePageId]);
  const activeId = useAppStore((state) => state.activePageId);
  const activeMeta = useAppStore((state) => state.pages.find((page) => page.id === state.activePageId));
  const showStats = useAppStore((state) => state.settings.showStats);
  const liveWords = useAppStore((state) => state.liveWordCount);
  const liveBlocks = useAppStore((state) => state.liveBlockCount);
  const statuses = usePluginStatuses();
  const notify = useAppStore((state) => state.notify);
  const { statusWidgets } = useContributions();
  const statusMenu = useMenuItems({ menu: "status" });
  const layout = useStatusBarLayout();

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
          {liveWords.toLocaleString()} words <span className="status-stats-dot" aria-hidden="true">·</span> {liveBlocks.toLocaleString()} blocks
        </span>
      ) : null,
    plugins: statuses.length ? (
      <span className="status-plugins">
        {statuses.map((status) => (
          <span key={`${status.pluginId}:${status.itemId}`} className="plugin-status" title={status.title}>
            {status.text}
          </span>
        ))}
      </span>
    ) : null,
    local: (
      <span className="local-badge" title="Your notes stay on this device">
        <LockKeyhole size={11} /> Local-first
        <CloudOff size={12} className="offline-icon" aria-label="No cloud connection" />
      </span>
    ),
    page:
      activeId && activeMeta ? (
        <span className="status-page" title={activeMeta.title || "Untitled"}>
          {activeMeta.icon ? <PageIcon value={activeMeta.icon} size={11} /> : null}
          <span className="status-page-title">{activeMeta.title || "Untitled"}</span>
        </span>
      ) : null,
    clock: <StatusClock />,
  };

  const all: Slot[] = [];
  for (const item of BUILTIN_STATUS_WIDGETS) {
    all.push({ key: `builtin:${item.id}`, title: item.title, side: item.side, order: item.order, node: builtin[item.id] });
  }
  for (const widget of statusWidgets) {
    all.push({
      key: widget.key,
      title: widget.tooltip || widget.text || `${widget.owner.name} · ${widget.id}`,
      side: widget.side,
      order: widget.order,
      width: widget.width ?? (widget.html ? 120 : undefined),
      minWidth: widget.minWidth,
      maxWidth: widget.maxWidth,
      node: (width) => <ContributedWidget widget={widget} autoWidth={Boolean(widget.html) && width === "auto"} />,
    });
  }
  const slots = resolveStatusSlots(
    all.filter((slot) => slot.node),
    layout,
  );
  const separator = layout?.separator ?? "none";

  const grows = (slot: { width?: StatusWidth }) => slot.width === "fill" || (typeof slot.width === "string" && slot.width.endsWith("%"));
  const growing = new Set(slots.filter(grows).map((slot) => slot.side));
  const side = (which: StatusSide) =>
    slots
      .filter((slot) => slot.side === which)
      .map((slot, index) => {
        const style: CSSProperties = { ...widthStyle(slot.width) };
        if (slot.minWidth !== undefined) style.minWidth = slot.minWidth;
        if (slot.maxWidth !== undefined) style.maxWidth = slot.maxWidth;
        if (slot.align) style.justifyContent = slot.align === "start" ? "flex-start" : slot.align === "end" ? "flex-end" : "center";
        const node = typeof slot.node === "function" ? slot.node(slot.width) : slot.node;
        return (
          <span key={slot.key} className={`status-slot${slot.width === "fill" ? " is-fill" : ""}${grows(slot) ? " is-grow" : ""}`} data-status-key={slot.key} style={style}>
            {index > 0 && separator !== "none" ? <span className={`status-sep status-sep-${separator}`} aria-hidden="true" /> : null}
            {node}
          </span>
        );
      });

  const openMenu = (event: ReactMouseEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-status-key]");
    // Let HTML widgets keep their own right-click (their frame gets the event, not us).
    const key = target?.dataset.statusKey;
    const items: PopupMenuItem[] = [];
    const here = key ? all.find((slot) => slot.key === key) : undefined;
    if (here) {
      const current = { ...layout?.items?.[here.key] };
      const width = current.width ?? here.width;
      items.push(
        { type: "header", label: here.title },
        {
          label: "Move to",
          icon: "move-horizontal",
          children: (["left", "center", "right"] as StatusSide[]).map((s) => ({
            id: `side:${s}`,
            label: SIDE_LABELS[s],
            checked: (current.side ?? here.side) === s,
            run: () => setItem(here.key, { side: s }),
          })),
        },
        {
          label: "Width",
          icon: "ruler",
          hint: widthLabel(width),
          children: (
            [
              ["auto", "Fit content"],
              ["fill", "Fill free space"],
              ["25%", "Quarter of the bar"],
              ["50%", "Half of the bar"],
              ["100%", "Whole bar"],
            ] as [StatusWidth, string][]
          ).map(([value, text]) => ({ id: `width:${value}`, label: text, checked: (width ?? "auto") === value, run: () => setItem(here.key, { width: value }) })),
        },
        { id: "first", label: "Move to start", icon: "chevrons-left", run: () => setItem(here.key, { order: Math.min(...slots.map((s) => s.order)) - 1 }) },
        { id: "last", label: "Move to end", icon: "chevrons-right", run: () => setItem(here.key, { order: Math.max(...slots.map((s) => s.order)) + 1 }) },
        { id: "hide", label: "Hide", icon: "eye-off", run: () => setItem(here.key, { hidden: true }) },
        { type: "separator" },
      );
      const widget = statusWidgets.find((item) => item.key === here.key);
      const plugin = widget?.owner.kind === "plugin" ? useAppStore.getState().plugins.find((info) => info.manifest.id === widget.owner.id) : undefined;
      if (plugin && canConfigure(plugin.manifest)) {
        items.push({ id: "configure", label: `Configure ${plugin.manifest.name}…`, icon: "sliders-horizontal", run: () => pluginConfigure.open(plugin.manifest.id) }, { type: "separator" });
      }
    }
    items.push({
      label: "Show items",
      icon: "list-checks",
      children: all.map((slot) => {
        const hidden = isStatusItemHidden(slot.key, layout);
        return { id: `show:${slot.key}`, label: slot.title, checked: !hidden, run: () => setItem(slot.key, { hidden: !hidden }) };
      }),
    });
    items.push({
      label: "Separators",
      icon: "separator-vertical",
      hint: SEPARATOR_LABELS[separator],
      children: STATUS_SEPARATORS.map((value) => ({ id: `sep:${value}`, label: SEPARATOR_LABELS[value], checked: separator === value, run: () => updateStatusLayout({ separator: value }) })),
    });
    items.push({ id: "reset", label: "Reset status bar", icon: "rotate-ccw", run: () => updateStatusLayout(null) });
    if (statusMenu.length) {
      items.push({ type: "separator" });
      for (const item of statusMenu) items.push({ id: item.key, label: item.title, icon: item.icon, danger: item.danger, run: () => runMenuItem(item, { menu: "status" }) });
    }
    void popups.contextMenu(event, items, { placement: "top-start" });
  };

  if (layout?.hidden) return null;
  const barStyle: CSSProperties = {};
  if (layout?.gap !== undefined) (barStyle as Record<string, unknown>)["--status-gap"] = `${layout.gap}px`;
  if (layout?.height !== undefined) {
    barStyle.height = layout.height;
    barStyle.flexBasis = layout.height;
  }
  if (layout?.padding !== undefined) barStyle.padding = `0 ${layout.padding}px`;
  if (layout?.fontSize !== undefined) barStyle.fontSize = layout.fontSize;
  const center = side("center");

  return (
    <footer className={`status-bar status-sep-mode-${separator}${growing.size ? " has-grow" : ""}`} aria-label="Status" style={barStyle} onContextMenu={openMenu}>
      <div className={`status-left${growing.has("left") ? " is-grow" : ""}`}>{side("left")}</div>
      {center.length ? <div className={`status-center${growing.has("center") ? " is-grow" : ""}`}>{center}</div> : null}
      <div className={`status-right${growing.has("right") ? " is-grow" : ""}`}>{side("right")}</div>
    </footer>
  );
}

/** Percentages are of the whole bar (the bar is a size container). */
function widthStyle(width: StatusWidth | undefined): CSSProperties {
  // Shrinkable, so "100%" next to other items takes what's left instead of overflowing.
  if (typeof width === "string" && width.endsWith("%")) return { width: `${parseFloat(width)}cqw`, flex: `0 1 ${parseFloat(width)}cqw`, minWidth: 0 };
  return statusWidthStyle(width) as CSSProperties;
}
