import { ArrowDownRight, ArrowRight, ArrowUpRight, ChartColumn, FileText, Settings2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildChartData, chartConfigOf, formatChartValue, type ChartData, type ChartIssue } from "../../lib/chartData";
import type { DatabaseRow, DatabaseView } from "../../lib/database";
import { useAppStore } from "../../store";
import "../../styles/database-chart.css";
import { PageIcon } from "../PageIcon";
import type { ChartHandle, ChartPick } from "./chartEngine";
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

export function ChartView({ db, view, rows, inline = false, onOpenSettings }: ChartViewProps) {
  const config = useMemo(() => chartConfigOf(view, db.schema), [view, db.schema]);
  const data = useMemo(() => buildChartData(rows, db.schema, config), [rows, db.schema, config]);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const rootRef = useRef<HTMLDivElement>(null);
  const paneHeight = usePaneHeight(rootRef, !inline);
  const height = inline ? Math.max(180, config.height ?? INLINE_HEIGHT) : paneHeight ?? 420;

  const issue = data.issue;
  const kpi = data.kind === "number" && !issue;
  const head = !issue && !kpi ? <ChartHead data={data} /> : null;

  return (
    <div ref={rootRef} className={`db-chart ${inline ? "is-inline" : ""}`} data-kind={data.kind}>
      {issue ? (
        <ChartEmpty issue={issue} onOpenSettings={onOpenSettings} filtered={issue === "noRows" && db.rows.length > 0} />
      ) : kpi ? (
        <KpiTile data={data} />
      ) : (
        <>
          {head}
          <ChartPlot db={db} rows={rows} data={data} height={height - 28} themeKey={resolvedTheme} />
        </>
      )}
    </div>
  );
}

function ChartHead({ data }: { data: ChartData }) {
  const series = data.series.length;
  const showTotal = data.kind !== "scatter" && (data.aggregate === "count" || data.aggregate === "sum" || data.aggregate === "countValues" || data.aggregate === "countUnique");
  const label = data.kind === "scatter" ? `${data.yProperty?.name ?? ""} by ${data.xProperty?.name ?? ""}` : `${data.measureLabel} by ${data.xProperty?.name ?? ""}${data.seriesProperty && series > 1 ? ` and ${data.seriesProperty.name}` : ""}`;
  const note = data.truncated ? (data.kind === "scatter" ? "Showing the first points" : "Smaller groups merged into Other") : data.config.cumulative ? "Running total" : data.normalized ? "Share of each group" : "";
  return (
    <div className="db-chart-head">
      {data.config.title ? <strong>{data.config.title}</strong> : null}
      <span>{label}</span>
      {data.kind === "scatter" ? (
        <span>· {data.points.length.toLocaleString()} rows</span>
      ) : showTotal && data.total !== null ? (
        <span>· {formatChartValue(data.total, data.aggregate === "sum" ? data.valueFormat : "number")} total</span>
      ) : null}
      {note ? <span className="db-chart-note">{note}</span> : null}
    </div>
  );
}

function ChartEmpty({ issue, onOpenSettings, filtered }: { issue: ChartIssue; onOpenSettings?: (anchor?: HTMLElement) => void; filtered: boolean }) {
  const info = ISSUES[issue];
  return (
    <div className="db-empty-state db-chart-empty">
      <ChartColumn size={22} strokeWidth={1.6} />
      <p>{filtered ? "No rows match this view’s filters." : info.text}</p>
      {info.action && onOpenSettings ? (
        <button type="button" className="db-ghost" onClick={(event) => onOpenSettings(event.currentTarget)}>
          <Settings2 size={14} />
          {info.action}
        </button>
      ) : null}
    </div>
  );
}

function ChartPlot({ db, rows, data, height, themeKey }: { db: DatabaseApi; rows: DatabaseRow[]; data: ChartData; height: number; themeKey: string }) {
  const plotRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const handle = useRef<ChartHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pick, setPick] = useState<ChartPick | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // Re-read tokens whenever the theme flips (custom accents too, through the store).
  const theme = useMemo<ChartTheme>(() => readChartTheme(plotRef.current), [themeKey, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const openRow = db.openRow;

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

  // Mount the engine once.
  useEffect(() => {
    let cancelled = false;
    loadEngine()
      .then((mod) => {
        if (cancelled || !canvasRef.current) return;
        handle.current = mod.mountChart(canvasRef.current, (next) => {
          if (next.rowId) openRow(next.rowId);
          else if (next.rowIds.length) setPick(next);
        });
        setReady(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      handle.current?.dispose();
      handle.current = null;
    };
  }, [openRow]);

  // Draw (animated) when data, theme or size change.
  const lastSize = useRef<{ width: number; height: number } | null>(null);
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

  return (
    <div ref={plotRef} className="db-chart-plot" style={{ height }}>
      <div ref={canvasRef} className="db-chart-canvas" role="img" aria-label={`${data.measureLabel} by ${data.xProperty?.name ?? "category"}`} />
      {!ready && !failed ? (
        <div className="db-chart-loading" aria-hidden>
          {[0.45, 0.8, 0.6, 1, 0.7, 0.35].map((h, i) => (
            <span key={i} style={{ height: `${h * 100}%` }} />
          ))}
        </div>
      ) : null}
      {failed ? <div className="db-empty-state db-chart-empty"><p>The chart could not be drawn.</p></div> : null}
      {pick ? <PickPopover pick={pick} rows={rows} data={data} onOpen={openRow} onClose={() => setPick(null)} /> : null}
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
