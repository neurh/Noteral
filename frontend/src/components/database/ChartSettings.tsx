import {
  ChartArea,
  ChartBar,
  ChartColumn,
  ChartLine,
  ChartPie,
  ChartScatter,
  Donut,
  Filter,
  Grid3x3,
  Hash,
  Radar,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CHART_AGGREGATES,
  DATE_BUCKETS,
  chartConfigOf,
  chartProperty,
  groupableProperties,
  isCartesian,
  isDateProperty,
  isNumberProperty,
  isNumericAggregate,
  numericProperties,
} from "../../lib/chartData";
import { NUMBER_FORMATS, type ChartAggregate, type ChartConfig, type ChartKind, type DatabaseView, type DateBucket, type NumberFormat, type Property } from "../../lib/database";
import { useAppStore } from "../../store";
import "../../styles/database-chart.css";
import { CHART_PALETTES, CHART_TONES, paletteColors } from "./chartTheme";
import { updateView } from "./ops";
import type { DatabaseApi } from "./useDatabase";

export interface ChartSettingsProps {
  db: DatabaseApi;
  view: DatabaseView;
  /** Inline databases get a height control (page databases fill the pane). */
  inline?: boolean;
}

const KINDS: { id: ChartKind; name: string; icon: LucideIcon }[] = [
  { id: "column", name: "Column", icon: ChartColumn },
  { id: "bar", name: "Bar", icon: ChartBar },
  { id: "line", name: "Line", icon: ChartLine },
  { id: "area", name: "Area", icon: ChartArea },
  { id: "pie", name: "Pie", icon: ChartPie },
  { id: "donut", name: "Donut", icon: Donut },
  { id: "scatter", name: "Scatter", icon: ChartScatter },
  { id: "funnel", name: "Funnel", icon: Filter },
  { id: "radar", name: "Radar", icon: Radar },
  { id: "heatmap", name: "Heatmap", icon: Grid3x3 },
  { id: "number", name: "Number", icon: Hash },
];

const SORTS: { id: NonNullable<ChartConfig["sort"]>; name: string }[] = [
  { id: "default", name: "Default" },
  { id: "label", name: "A → Z" },
  { id: "labelDesc", name: "Z → A" },
  { id: "value", name: "Smallest first" },
  { id: "valueDesc", name: "Largest first" },
];

const NONE = "";

/** Settings that are on unless explicitly turned off. */
const DEFAULT_ON = new Set(["legend", "grid", "labels"]);

/** Drop unset keys so stored configs stay small. */
function compact(config: ChartConfig): ChartConfig {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value === null || value === "") continue;
    if (value === false && !DEFAULT_ON.has(key)) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    out[key] = value;
  }
  return out as ChartConfig;
}

/** Keep a config coherent when the chart type changes. */
function retarget(config: ChartConfig, kind: ChartKind, properties: Property[], numbers: Property[]): ChartConfig {
  const next: ChartConfig = { ...config, kind };
  const x = properties.find((p) => p.id === config.x);
  if (kind === "scatter") {
    if (!x || !(isNumberProperty(x) || isDateProperty(x))) next.x = (numbers[0] ?? properties.find(isDateProperty))?.id;
    if (!numbers.some((p) => p.id === config.y)) next.y = numbers.find((p) => p.id !== next.x)?.id ?? numbers[0]?.id;
    next.series = config.series && config.series !== next.x ? config.series : undefined;
  } else if (config.kind === "scatter") {
    // Leaving scatter: a category axis reads best on an option or date property.
    const option = properties.find((p) => p.type === "status" || p.type === "select");
    next.x = option?.id ?? properties.find(isDateProperty)?.id ?? config.x;
    if (!isNumericAggregate(config.aggregate)) next.aggregate = "count";
    if (next.aggregate === "count") next.y = undefined;
  }
  return next;
}

export function ChartSettings({ db, view, inline = false }: ChartSettingsProps) {
  const schema = db.schema;
  const config = useMemo(() => chartConfigOf(view, schema), [view, schema]);
  const dark = useAppStore((s) => s.resolvedTheme) === "dark";
  const accent = useMemo(() => (typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()), [dark]);

  const kind: ChartKind = config.kind ?? "column";
  const properties = useMemo(() => groupableProperties(schema), [schema]);
  const numbers = useMemo(() => numericProperties(schema), [schema]);
  const dates = useMemo(() => properties.filter(isDateProperty), [properties]);
  const x = chartProperty(schema, config.x);
  const xIsDate = isDateProperty(x);
  const aggregate: ChartAggregate = config.aggregate ?? "count";
  const series = chartProperty(schema, config.series);

  const set = (patch: Partial<ChartConfig>) =>
    updateView(db, view.id, (target) => {
      target.chart = compact({ ...chartConfigOf(target, schema), ...patch });
    });
  const setKind = (next: ChartKind) =>
    updateView(db, view.id, (target) => {
      target.chart = compact(retarget(chartConfigOf(target, schema), next, properties, numbers));
    });

  const cartesian = isCartesian(kind);
  const pieLike = kind === "pie" || kind === "donut";
  /** Pies and funnels label their slices by default and skip the legend. */
  const sliced = pieLike || kind === "funnel";
  const calendar = kind === "heatmap" && xIsDate;
  const hasSeries = (cartesian || kind === "radar" || (kind === "heatmap" && !xIsDate)) && !!series;
  const axisLabel = cartesian ? (kind === "bar" ? "Y axis" : "X axis") : pieLike ? "Slices" : kind === "funnel" ? "Stages" : kind === "radar" ? "Spokes" : kind === "heatmap" ? (xIsDate ? "Date" : "Columns") : kind === "number" ? "Compare by" : "X axis";
  const valueLabel = cartesian ? (kind === "bar" ? "X axis" : "Y axis") : "Value";
  const seriesLabel = kind === "heatmap" ? "Rows" : "Group by";

  const xChoices = kind === "scatter" ? properties.filter((p) => isNumberProperty(p) || isDateProperty(p)) : kind === "number" || calendar ? dates : properties;
  const valueChoices = isNumericAggregate(aggregate) ? numbers : properties;
  const palettes = CHART_PALETTES;

  return (
    <div className="db-chart-settings">
      <div className="db-menu-label">Chart type</div>
      <div className="db-chart-kinds" role="radiogroup" aria-label="Chart type">
        {KINDS.map(({ id, name, icon: Icon }) => (
          <button key={id} type="button" role="radio" aria-checked={kind === id} className={`db-chart-kind ${kind === id ? "is-active" : ""}`} onClick={() => kind !== id && setKind(id)} title={name}>
            <Icon size={17} strokeWidth={1.7} />
            <span>{name}</span>
          </button>
        ))}
      </div>

      <div className="db-menu-sep" />
      <div className="db-menu-label">Data</div>

      <Row label={axisLabel}>
        <PropertySelect
          value={config.x}
          choices={xChoices}
          none={kind === "number" ? "None" : undefined}
          onChange={(id) => set({ x: id, series: config.series === id ? undefined : config.series, dateBucket: undefined })}
          allowMissing={kind === "number" ? undefined : "Choose…"}
        />
      </Row>
      {kind === "heatmap" ? <div className="db-chart-hint">{xIsDate ? "Draws a calendar of the last year, one cell per day." : "Pick a date for a calendar, or two properties for a grid."}</div> : null}

      {xIsDate && !calendar && kind !== "scatter" ? (
        <Row label={kind === "number" ? "Period" : "Group dates by"}>
          <select className="db-select" value={config.dateBucket ?? ""} onChange={(event) => set({ dateBucket: (event.target.value || undefined) as DateBucket | undefined })}>
            <option value="">Automatic</option>
            {DATE_BUCKETS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Row>
      ) : null}

      {kind === "scatter" ? (
        <Row label="Y axis">
          <PropertySelect value={config.y} choices={numbers} onChange={(id) => set({ y: id })} allowMissing="Choose a number…" />
        </Row>
      ) : (
        <Row label={valueLabel}>
          <span className="db-chart-pair">
            <select
              className="db-select"
              value={aggregate}
              aria-label="Aggregate"
              onChange={(event) => {
                const next = event.target.value as ChartAggregate;
                const keep = next === "count" ? undefined : isNumericAggregate(next) ? (numbers.some((p) => p.id === config.y) ? config.y : numbers[0]?.id) : (config.y ?? config.x);
                set({ aggregate: next, y: keep });
              }}
            >
              {CHART_AGGREGATES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {aggregate !== "count" ? <PropertySelect value={config.y} choices={valueChoices} onChange={(id) => set({ y: id })} allowMissing="Choose…" label="Property" /> : null}
          </span>
        </Row>
      )}

      {cartesian || kind === "radar" || (kind === "heatmap" && !xIsDate) || kind === "scatter" ? (
        <Row label={kind === "scatter" ? "Color by" : seriesLabel}>
          <PropertySelect value={config.series} choices={properties.filter((p) => p.id !== config.x && p.id !== config.y)} none="None" onChange={(id) => set({ series: id })} />
        </Row>
      ) : null}

      {kind !== "scatter" && kind !== "number" && !calendar ? (
        <>
          {!xIsDate ? (
            <Row label="Sort">
              <select className="db-select" value={config.sort ?? "default"} onChange={(event) => set({ sort: event.target.value === "default" ? undefined : (event.target.value as ChartConfig["sort"]) })}>
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id === "default" && kind === "funnel" ? "Largest first" : s.name}
                  </option>
                ))}
              </select>
            </Row>
          ) : null}
          <Row label={xIsDate ? "Show latest" : "Show top"}>
            <NumberField value={config.limit} placeholder="All" min={1} step={1} integer onCommit={(value) => set({ limit: value })} label={xIsDate ? "Latest buckets" : "Top groups"} />
          </Row>
        </>
      ) : null}

      <div className="db-menu-sep" />
      <div className="db-menu-label">Display</div>

      {cartesian && hasSeries ? <Toggle label="Stacked" on={!!config.stacked || !!config.normalize} onChange={(on) => set({ stacked: on, normalize: on ? config.normalize : false })} /> : null}
      {cartesian ? <Toggle label={hasSeries ? "Stack to 100%" : "Show as share of total"} on={!!config.normalize} onChange={(on) => set({ normalize: on, stacked: on && hasSeries ? true : config.stacked })} /> : null}
      {cartesian ? <Toggle label="Running total" on={!!config.cumulative} onChange={(on) => set({ cumulative: on })} /> : null}
      {kind === "line" || kind === "area" || kind === "radar" ? <Toggle label="Smooth lines" on={!!config.smooth} onChange={(on) => set({ smooth: on })} /> : null}
      {kind !== "number" && kind !== "heatmap" ? <Toggle label="Data labels" on={config.labels ?? sliced} onChange={(on) => set({ labels: on })} /> : null}
      {hasSeries || sliced || (kind === "scatter" && !!series) ? <Toggle label="Legend" on={config.legend ?? !sliced} onChange={(on) => set({ legend: on })} /> : null}
      {cartesian || kind === "scatter" ? <Toggle label="Gridlines" on={config.grid ?? true} onChange={(on) => set({ grid: on })} /> : null}
      {kind !== "scatter" && kind !== "number" && !calendar ? <Toggle label="Hide empty groups" on={!!config.omitEmpty} onChange={(on) => set({ omitEmpty: on })} /> : null}

      {cartesian || kind === "scatter" || kind === "number" ? (
        <Row label="Goal">
          <NumberField value={config.goal} placeholder="None" onCommit={(value) => set({ goal: value })} label="Goal" />
        </Row>
      ) : null}
      {(cartesian && !config.normalize) || kind === "scatter" ? (
        <Row label={kind === "scatter" ? "Y range" : "Value range"}>
          <span className="db-chart-range">
            <NumberField value={config.yMin} placeholder="Auto" onCommit={(value) => set({ yMin: value })} label="Minimum" />
            <i>–</i>
            <NumberField value={config.yMax} placeholder="Auto" onCommit={(value) => set({ yMax: value })} label="Maximum" />
          </span>
        </Row>
      ) : null}
      {!config.normalize && kind !== "heatmap" ? (
        <Row label="Number format">
          <select className="db-select" value={config.format ?? ""} onChange={(event) => set({ format: (event.target.value || undefined) as NumberFormat | undefined })}>
            <option value="">From property</option>
            {NUMBER_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Row>
      ) : null}
      {inline ? (
        <Row label="Height">
          <NumberField value={config.height} placeholder="320" min={180} max={1200} step={20} integer onCommit={(value) => set({ height: value })} label="Height in pixels" />
        </Row>
      ) : null}

      {kind !== "number" ? (
        <>
          <div className="db-menu-sep" />
          <div className="db-menu-label">Colors</div>
          <div className="db-chart-palettes" role="radiogroup" aria-label="Palette">
            {palettes.map((palette) => {
              const active = (config.palette ?? "auto") === palette.id;
              const colors =
                palette.id === "auto"
                  ? [paletteColors(palette, { dark, accent: accent || palette.light[0] })[0], ...(["green", "blue", "yellow", "red"] as const).map((c) => CHART_TONES[dark ? "dark" : "light"][c])]
                  : (dark ? palette.dark : palette.light).slice(0, 5);
              return (
                <button key={palette.id} type="button" role="radio" aria-checked={active} className={`db-chart-palette ${active ? "is-active" : ""}`} onClick={() => set({ palette: palette.id === "auto" ? undefined : palette.id })}>
                  <span className="db-chart-swatches" aria-hidden>
                    {colors.map((color, i) => (
                      <i key={i} style={{ background: color }} />
                    ))}
                  </span>
                  <span>{palette.name}</span>
                </button>
              );
            })}
          </div>
          <div className="db-chart-hint">{(config.palette ?? "auto") === "auto" ? "Select and status options keep their own colors." : "Applies to every group, including option colors."}</div>
        </>
      ) : null}

      <div className="db-menu-sep" />
      <Row label="Title">
        <TextField value={config.title} placeholder="None" onCommit={(value) => set({ title: value })} />
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="db-settings-row">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="db-settings-row db-chart-toggle" onClick={() => onChange(!on)}>
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`db-switch ${on ? "is-on" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          onChange(!on);
        }}
      >
        <span />
      </button>
    </div>
  );
}

function PropertySelect({ value, choices, onChange, none, allowMissing, label }: { value?: string; choices: Property[]; onChange: (id: string | undefined) => void; none?: string; allowMissing?: string; label?: string }) {
  const known = choices.some((p) => p.id === value);
  return (
    <select className="db-select" value={known ? value : NONE} aria-label={label} onChange={(event) => onChange(event.target.value || undefined)}>
      {none !== undefined ? <option value={NONE}>{none}</option> : !known ? <option value={NONE} disabled>{allowMissing ?? "Choose…"}</option> : null}
      {choices.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name || "Untitled"}
        </option>
      ))}
    </select>
  );
}

/** A number input that commits on blur/Enter; empty clears the setting. */
function NumberField({ value, onCommit, placeholder, min, max, step, integer, label }: { value?: number; onCommit: (value: number | undefined) => void; placeholder?: string; min?: number; max?: number; step?: number; integer?: boolean; label: string }) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  useEffect(() => setDraft(value === undefined ? "" : String(value)), [value]);
  const commit = () => {
    const text = draft.trim();
    if (!text) return value !== undefined && onCommit(undefined);
    let next = Number(text);
    if (!Number.isFinite(next)) return setDraft(value === undefined ? "" : String(value));
    if (integer) next = Math.round(next);
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <input
      className="db-input db-chart-number"
      type="number"
      inputMode="decimal"
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step ?? "any"}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        if (event.key === "Escape") setDraft(value === undefined ? "" : String(value));
      }}
    />
  );
}

function TextField({ value, onCommit, placeholder }: { value?: string; onCommit: (value: string | undefined) => void; placeholder?: string }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  const commit = () => {
    const next = draft.trim() || undefined;
    if (next !== value) onCommit(next);
  };
  return (
    <input
      className="db-input db-chart-title-input"
      value={draft}
      placeholder={placeholder}
      aria-label="Chart title"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        if (event.key === "Escape") setDraft(value ?? "");
      }}
    />
  );
}
