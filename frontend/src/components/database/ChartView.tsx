import { ArrowDownRight, ArrowRight, ArrowUpRight, ChartColumn, FileText, Maximize2, RotateCcw, ScanSearch, Settings2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildChartData, chartConfigOf, formatChartValue, type ChartData, type ChartIssue } from "../../lib/chartData";
import type { DatabaseRow, DatabaseView } from "../../lib/database";
import { useAppStore } from "../../store";
import "../../styles/database-chart.css";
import { Modal } from "../Modal";
import { PageIcon } from "../PageIcon";
import type { ChartHandle, ChartPick, ZoomState } from "./chartEngine";
import { readChartTheme, type ChartTheme } from "./chartTheme";
import { Popover } from "./Popover";
import type { DatabaseApi } from "./useDatabase";

export interface ChartViewProps {
  db: DatabaseApi;
  view: DatabaseView;
  /** Rows after the view's filters, sorts and search. */
  rows: DatabaseRow[];
  /** Inline databases use the configured height; page databases fill the pane. */
  inline?: boolean;
  /** Opens the view settings (from empty / misconfigured states). */
  onOpenSettings?: (anchor?: HTMLElement) => void;
}

/** The chart engine, fetched once on first use. */
let engine: Promise<typeof import("./chartEngine")> | null = null;
const loadEngine = () => (engine ??= import("./chartEngine"));

const INLINE_HEIGHT = 320;
const MIN_HEIGHT = 280;
const MAX_PICK_ROWS = 200;
const HEAD_HEIGHT = 28;
const NO_ZOOM: ZoomState = { available: false, zoomed: false, boxing: false };
const MOD_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";

const ISSUES: Record<ChartIssue, { text: string; action?: string }> = {
  noRows: { text: "No rows to chart." },
  missingX: { text: "Choose what to put along the chart’s axis.", action: "Choose a property" },
  needsNumber: { text: "Sums, averages and other totals need a number property.", action: "Choose a number property" },
  needsProperty: { text: "Choose which property to count values of.", action: "Choose a property" },
  needsAxes: { text: "Scatter plots need a number or date along x and a number along y.", action: "Choose properties" },
};

/** Nearest ancestor that scrolls vertically (page databases live in .page-scroll). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

/** Plot height for page databases: the rest of the visible pane, never cramped. */
function usePaneHeight(ref: React.RefObject<HTMLElement | null>, enabled: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const pane = scrollParent(el);
    if (!pane) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
      const next = Math.max(MIN_HEIGHT, Math.round(pane.clientHeight - top - 36));
      setHeight((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return height;
}

/** Plot height of the expanded chart: most of the window. */
function expandedHeight(): number {
  const h = typeof window !== "undefined" ? window.innerHeight : 800;
  return Math.max(300, Math.min(820, Math.round(h * 0.86) - 150));
}

export function ChartView({ db, view, rows, inline = false, onOpenSettings }: ChartViewProps) {
  const config = useMemo(() => chartConfigOf(view, db.schema), [view, db.schema]);
  const data = useMemo(() => buildChartData(rows, db.schema, config), [rows, db.schema, config]);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const rootRef = useRef<HTMLDivElement>(null);
  const paneHeight = usePaneHeight(rootRef, !inline);
  const height = inline ? Math.max(180, config.height ?? INLINE_HEIGHT) : paneHeight ?? 420;
  const [expanded, setExpanded] = useState(false);

  const issue = data.issue;
  const kpi = data.kind === "number" && !issue;
  const title = config.title?.trim() || view.name || "Chart";

  return (
    <div ref={rootRef} className={`db-chart ${inline ? "is-inline" : ""}`} data-kind={data.kind}>
      {issue ? (
        <ChartEmpty issue={issue} onOpenSettings={onOpenSettings} filtered={issue === "noRows" && db.rows.length > 0} custom={config.emptyText} />
      ) : kpi ? (
        <KpiTile data={data} />
      ) : (
        <>
          <ChartPlot db={db} rows={rows} data={data} height={height - HEAD_HEIGHT} themeKey={resolvedTheme} head={<ChartHead data={data} />} onExpand={() => setExpanded(true)} />
          <Modal open={expanded} title={title} subtitle={chartLabel(data)} width="large" className="db-chart-modal" bodyClassName="db-chart-modal-body" onClose={() => setExpanded(false)}>
            <div className="db-chart is-expanded" data-kind={data.kind}>
              <ChartPlot db={db} rows={rows} data={data} height={expandedHeight()} themeKey={resolvedTheme} head={<ChartHead data={data} bare />} expanded />
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}

function chartLabel(data: ChartData): string {
  const series = data.series.length;
  if (data.kind === "scatter") return `${data.yProperty?.name ?? ""} by ${data.xProperty?.name ?? ""}`;
  return `${data.measureLabel} by ${data.xProperty?.name ?? ""}${data.seriesProperty && series > 1 ? ` and ${data.seriesProperty.name}` : ""}${data.secondary ? ` · ${data.secondary.label}` : ""}`;
}

function ChartHead({ data, bare = false }: { data: ChartData; bare?: boolean }) {
  const showTotal = data.kind !== "scatter" && (data.aggregate === "count" || data.aggregate === "sum" || data.aggregate === "countValues" || data.aggregate === "countUnique");
  const merged = data.config.other === false ? "Showing the top groups" : "Smaller groups merged into Other";
  const note = data.truncated ? (data.kind === "scatter" ? "Showing the first points" : merged) : data.config.cumulative ? "Running total" : data.normalized ? "Share of each group" : "";
  return (
    <>
      {!bare && data.config.title ? <strong>{data.config.title}</strong> : null}
      {!bare ? <span>{chartLabel(data)}</span> : null}
      {data.kind === "scatter" ? (
        <span>{bare ? "" : "· "}{data.points.length.toLocaleString()} rows</span>
      ) : showTotal && data.total !== null ? (
        <span>{bare ? "" : "· "}{formatChartValue(data.total, data.aggregate === "sum" ? data.valueFormat : "number")} total</span>
      ) : null}
      {note ? <span className="db-chart-note">{note}</span> : null}
    </>
  );
}

function ChartEmpty({ issue, onOpenSettings, filtered, custom }: { issue: ChartIssue; onOpenSettings?: (anchor?: HTMLElement) => void; filtered: boolean; custom?: string }) {
  const info = ISSUES[issue];
  const text = issue === "noRows" && custom?.trim() ? custom.trim() : filtered ? "No rows match this view’s filters." : info.text;
  return (
    <div className="db-empty-state db-chart-empty">
      <ChartColumn size={22} strokeWidth={1.6} />
      <p>{text}</p>
      {info.action && onOpenSettings ? (
        <button type="button" className="db-ghost" onClick={(event) => onOpenSettings(event.currentTarget)}>
          <Settings2 size={14} />
          {info.action}
        </button>
      ) : null}
    </div>
  );
}

interface ChartPlotProps {
  db: DatabaseApi;
  rows: DatabaseRow[];
  data: ChartData;
  height: number;
  themeKey: string;
  /** Text of the head row; the zoom tools sit at its end. */
  head?: ReactNode;
  /** Shows the Expand button. */
  onExpand?: () => void;
  /** The big copy in the modal: the wheel zooms freely, tools stay visible. */
  expanded?: boolean;
}

function ChartPlot({ db, rows, data, height, themeKey, head, onExpand, expanded = false }: ChartPlotProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const handle = useRef<ChartHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pick, setPick] = useState<ChartPick | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState<ZoomState>(NO_ZOOM);
  // After a click into the chart the plain wheel zooms too, until the pointer leaves.
  const [engaged, setEngaged] = useState(false);
  const [hint, setHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSize = useRef<{ width: number; height: number } | null>(null);
  // Re-read tokens whenever the theme flips (custom accents too, through the store).
  const theme = useMemo<ChartTheme>(() => readChartTheme(plotRef.current), [themeKey, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const openRow = db.openRow;
  // The click handler reads the latest openRow, so a new one (each view has
  // its own) never re-creates the chart.
  const openRowRef = useRef(openRow);
  openRowRef.current = openRow;

  // Track the plot's size.
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = () => {
      const width = Math.floor(el.clientWidth);
      if (width > 0) setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [height]);

  // Mount the engine once per plot.
  useEffect(() => {
    let cancelled = false;
    loadEngine()
      .then((mod) => {
        if (cancelled || !canvasRef.current) return;
        handle.current = mod.mountChart(
          canvasRef.current,
          (next) => {
            if (next.rowId) openRowRef.current(next.rowId);
            else if (next.rowIds.length) setPick(next);
          },
          setZoom,
        );
        // A fresh instance has drawn nothing yet; make the draw effect run.
        lastSize.current = null;
        setReady(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      handle.current?.dispose();
      handle.current = null;
      setReady(false);
      setZoom(NO_ZOOM);
    };
  }, []);

  // Draw (animated) when data, theme or size change.
  useEffect(() => {
    const chart = handle.current;
    if (!ready || !chart || !size) return;
    const prev = lastSize.current;
    lastSize.current = size;
    if (prev && (prev.width !== size.width || prev.height !== size.height)) chart.resize(size);
    chart.update(data, theme, size);
  }, [ready, data, theme, size]);

  // The picked rows go stale when the data changes.
  useEffect(() => setPick(null), [data]);
  // Tooltips would sit on top of the row list.
  useEffect(() => {
    if (ready) handle.current?.quiet(!!pick);
  }, [ready, pick]);
  // The plain wheel zooms in the expanded view, or once the chart was clicked into.
  const freeWheel = expanded || engaged;
  useEffect(() => {
    if (ready) handle.current?.setFreeWheel(freeWheel);
  }, [ready, freeWheel]);
  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      if (!zoom.available || freeWheel || event.ctrlKey || event.metaKey || Math.abs(event.deltaY) < 1) return;
      setHint(true);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint(false), 1400);
    },
    [zoom.available, freeWheel],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    const chart = handle.current;
    if (!chart || !zoom.available || event.target !== event.currentTarget) return;
    if (event.key === "+" || event.key === "=") chart.zoom(1.5);
    else if (event.key === "-") chart.zoom(1 / 1.5);
    else if (event.key === "0") chart.resetZoom();
    else if (event.key === "Escape" && zoom.boxing) chart.boxZoom(false);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const tools = ready ? (
    <ChartTools
      zoom={zoom}
      pinned={expanded}
      onZoomIn={() => handle.current?.zoom(1.5)}
      onZoomOut={() => handle.current?.zoom(1 / 1.5)}
      onReset={() => handle.current?.resetZoom()}
      onBox={() => handle.current?.boxZoom(!zoom.boxing)}
      onExpand={onExpand}
    />
  ) : null;

  return (
    <>
      {head !== undefined || tools ? (
        <div className="db-chart-head">
          {head}
          {tools}
        </div>
      ) : null}
      <div
        ref={plotRef}
        className={`db-chart-plot ${zoom.boxing ? "is-boxing" : ""}`}
        style={{ height }}
        tabIndex={zoom.available ? 0 : undefined}
        aria-keyshortcuts={zoom.available ? "+ - 0" : undefined}
        onPointerDown={() => zoom.available && setEngaged(true)}
        onPointerLeave={() => setEngaged(false)}
        onBlur={(event) => !event.currentTarget.contains(event.relatedTarget as Node | null) && setEngaged(false)}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <div ref={canvasRef} className="db-chart-canvas" role="img" aria-label={`${data.measureLabel} by ${data.xProperty?.name ?? "category"}`} />
        {!ready && !failed ? (
          <div className="db-chart-loading" aria-hidden>
            {[0.45, 0.8, 0.6, 1, 0.7, 0.35].map((h, i) => (
              <span key={i} style={{ height: `${h * 100}%` }} />
            ))}
          </div>
        ) : null}
        {failed ? <div className="db-empty-state db-chart-empty"><p>The chart could not be drawn.</p></div> : null}
        {hint || zoom.boxing ? (
          <div className="db-chart-zoom-hint" role="status">
            {zoom.boxing ? "Drag across the chart to zoom into that range · Esc cancels" : `Hold ${MOD_KEY} and scroll to zoom, or click the chart first`}
          </div>
        ) : null}
        {pick ? <PickPopover pick={pick} rows={rows} data={data} onOpen={openRow} onClose={() => setPick(null)} /> : null}
      </div>
    </>
  );
}

function ChartTools({
  zoom,
  pinned,
  onZoomIn,
  onZoomOut,
  onReset,
  onBox,
  onExpand,
}: {
  zoom: ZoomState;
  pinned: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onBox: () => void;
  onExpand?: () => void;
}) {
  if (!zoom.available && !onExpand) return null;
  const active = pinned || zoom.zoomed || zoom.boxing;
  return (
    <div className={`db-chart-tools ${active ? "is-active" : ""}`} role="toolbar" aria-label="Chart tools">
      {zoom.available ? (
        <>
          <button type="button" className="db-chart-tool" onClick={onZoomIn} aria-label="Zoom in" title={`Zoom in (${MOD_KEY}+scroll)`}>
            <ZoomIn size={14} />
          </button>
          <button type="button" className="db-chart-tool" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out" disabled={!zoom.zoomed}>
            <ZoomOut size={14} />
          </button>
          <button type="button" className={`db-chart-tool ${zoom.boxing ? "is-on" : ""}`} onClick={onBox} aria-label="Zoom to a range" aria-pressed={zoom.boxing} title="Drag across a range to zoom into it">
            <ScanSearch size={14} />
          </button>
          {zoom.zoomed ? (
            <button type="button" className="db-chart-tool is-text" onClick={onReset} aria-label="Reset zoom" title="Show everything">
              <RotateCcw size={13} />
              <span>Reset</span>
            </button>
          ) : null}
        </>
      ) : null}
      {onExpand ? (
        <button type="button" className="db-chart-tool" onClick={onExpand} aria-label="Expand chart" title="Expand">
          <Maximize2 size={14} />
        </button>
      ) : null}
    </div>
  );
}

function PickPopover({ pick, rows, data, onOpen, onClose }: { pick: ChartPick; rows: DatabaseRow[]; data: ChartData; onOpen: (id: string) => void; onClose: () => void }) {
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const list = pick.rowIds.map((id) => byId.get(id)).filter((row): row is DatabaseRow => !!row);
  const shown = list.slice(0, MAX_PICK_ROWS);
  const count = list.length;
  return (
    <Popover anchor={{ x: pick.x, y: pick.y + 6 }} onClose={onClose} width={272} label={pick.title}>
      <div className="db-menu">
        <div className="db-chart-pick-head">
          <div className="db-chart-pick-title">
            {pick.color ? <i style={{ background: pick.color }} /> : null}
            <span>{pick.title || "Untitled"}</span>
          </div>
          <div className="db-chart-pick-meta">
            {count.toLocaleString()} {count === 1 ? "row" : "rows"}
            {pick.value && data.aggregate !== "count" ? ` · ${data.measureLabel} ${pick.value}` : ""}
          </div>
        </div>
        <div className="db-menu-sep" />
        <div className="db-menu-scroll is-short">
          {shown.map((row) => (
            <button
              key={row.id}
              type="button"
              className="db-menu-item db-chart-pick-row"
              onClick={() => {
                onClose();
                onOpen(row.id);
              }}
            >
              <PageIcon value={row.meta.icon} size={14} fallback={<FileText size={14} />} />
              <span>{row.meta.title || "Untitled"}</span>
            </button>
          ))}
          {count > shown.length ? <div className="db-menu-empty">and {(count - shown.length).toLocaleString()} more</div> : null}
        </div>
      </div>
    </Popover>
  );
}

function KpiTile({ data }: { data: ChartData }) {
  const kpi = data.kpi!;
  const hasPeriod = kpi.current !== undefined;
  const label = data.config.title || data.measureLabel;
  const change = kpi.change;
  const direction = change === undefined ? "flat" : change > 0.0005 ? "up" : change < -0.0005 ? "down" : "flat";
  const Arrow = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : ArrowRight;
  const delta = change === undefined ? null : `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change * 100).toLocaleString(undefined, { maximumFractionDigits: Math.abs(change) < 0.1 ? 1 : 0 })}%`;
  const goal = data.config.goal;
  return (
    <div className="db-chart-kpi">
      <div className="db-chart-kpi-label">{label}</div>
      <div className="db-chart-kpi-body">
        <div className="db-chart-kpi-main">
          <div className="db-chart-kpi-value" title={formatChartValue(kpi.value, data.valueFormat)}>
            {formatChartValue(hasPeriod ? kpi.current : kpi.value, data.valueFormat, Math.abs((hasPeriod ? kpi.current : kpi.value) ?? 0) >= 1e7)}
          </div>
          <div className="db-chart-kpi-sub">
            {hasPeriod ? <span>{kpi.currentLabel}</span> : null}
            {delta ? (
              <span className={`db-chart-kpi-delta is-${direction}`}>
                <Arrow size={12} strokeWidth={2.2} />
                {delta}
              </span>
            ) : null}
            {hasPeriod ? (
              <span>
                {kpi.compareLabel} <b>{formatChartValue(kpi.previous, data.valueFormat)}</b>
              </span>
            ) : null}
            {hasPeriod ? (
              <span>
                · <b>{formatChartValue(kpi.value, data.valueFormat)}</b> all time
              </span>
            ) : null}
            {goal !== undefined ? (
              <span>
                · Goal <b>{formatChartValue(goal, data.valueFormat)}</b>
              </span>
            ) : null}
          </div>
        </div>
        {kpi.trend && kpi.trend.some((v) => v !== 0) ? <Sparkline values={kpi.trend} /> : null}
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 220;
  const h = 56;
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const step = w / Math.max(1, values.length - 1);
  const points = values.map((v, i) => [i * step, h - 4 - ((v - min) / span) * (h - 10)] as const);
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const [lx, ly] = points[points.length - 1];
  return (
    <div className="db-chart-kpi-spark" aria-hidden>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="db-spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#db-spark-fill)" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={lx} cy={ly} r="3" fill="currentColor" />
      </svg>
    </div>
  );
}
