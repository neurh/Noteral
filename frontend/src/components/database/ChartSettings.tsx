import {
  ChartArea,
  ChartBar,
  ChartColumn,
  ChartLine,
  ChartPie,
  ChartScatter,
  ChevronRight,
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
  supportsSecondary,
} from "../../lib/chartData";
import { NUMBER_FORMATS, type ChartAggregate, type ChartConfig, type ChartKind, type ChartLabelContent, type DatabaseView, type DateBucket, type NumberFormat, type Property } from "../../lib/database";
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
const DEFAULT_ON = new Set(["legend", "grid", "labels", "zoom", "xLabels", "yLabels", "gradient", "other"]);

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

  const scatter = kind === "scatter";
  const lineLike = kind === "line" || kind === "area";
  const isBar = kind === "bar" || kind === "column";
  const matrix = kind === "heatmap" && !xIsDate;
  const axes = cartesian || scatter || matrix;
  const zoomable = cartesian || scatter || matrix;
  const hasLabels = kind !== "number" && kind !== "heatmap";
  const labelsOn = config.labels ?? sliced;
  const legendShown = config.legend ?? (sliced ? false : hasSeries || !!config.aggregate2 || (scatter && !!series));
  const canLegend = hasSeries || sliced || (scatter && !!series) || (supportsSecondary(kind) && !!config.aggregate2);
  const singleSeries = !hasSeries && !(scatter && !!series);
  const curve = config.curve ?? (config.smooth ? "smooth" : "straight");
  const secondChoices = config.aggregate2 && isNumericAggregate(config.aggregate2) ? numbers : properties;
  const labelContents = sliced ? LABEL_CONTENTS : LABEL_CONTENTS.filter((c) => c.id === "value" || c.id === "percent" || c.id === "nameValue");
  const defaultContent = pieLike ? "namePercent" : kind === "funnel" ? "nameValue" : "value";

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

      {xIsDate && !calendar && !scatter ? (
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

      {scatter ? (
        <Row label="Y axis">
          <PropertySelect value={config.y} choices={numbers} onChange={(id) => set({ y: id })} allowMissing="Choose a number…" />
        </Row>
      ) : (
        <Row label={valueLabel}>
          <span className="db-chart-pair">
            <AggregateSelect value={aggregate} onChange={(next = "count") => set({ aggregate: next, y: keepMeasure(next, config.y, config.x, numbers) })} />
            {aggregate !== "count" ? <PropertySelect value={config.y} choices={valueChoices} onChange={(id) => set({ y: id })} allowMissing="Choose…" label="Property" /> : null}
          </span>
        </Row>
      )}

      {cartesian || kind === "radar" || matrix || scatter ? (
        <Row label={scatter ? "Color by" : seriesLabel}>
          <PropertySelect value={config.series} choices={properties.filter((p) => p.id !== config.x && p.id !== config.y)} none="None" onChange={(id) => set({ series: id })} />
        </Row>
      ) : null}

      {!scatter && kind !== "number" && !calendar ? (
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
          {config.limit && !xIsDate ? <Toggle label="Group the rest as Other" on={config.other ?? true} onChange={(on) => set({ other: on })} /> : null}
          <Toggle label="Hide empty groups" on={!!config.omitEmpty} onChange={(on) => set({ omitEmpty: on })} />
        </>
      ) : null}

      {supportsSecondary(kind) ? (
        <Section id="combo" title="Second measure" summary={config.aggregate2 ? measureName(config.aggregate2, chartProperty(schema, config.y2)) : "None"}>
          <Row label="Line">
            <span className="db-chart-pair">
              <AggregateSelect
                value={config.aggregate2}
                none="None"
                onChange={(next) => set({ aggregate2: next, y2: next ? keepMeasure(next, config.y2, config.y ?? config.x, numbers) : undefined })}
              />
              {config.aggregate2 && config.aggregate2 !== "count" ? <PropertySelect value={config.y2} choices={secondChoices} onChange={(id) => set({ y2: id })} allowMissing="Choose…" label="Second property" /> : null}
            </span>
          </Row>
          <div className="db-chart-hint">Drawn as a line over its own axis on the right, e.g. bars of revenue with a line of orders.</div>
        </Section>
      ) : null}

      {kind !== "number" || inline ? (
        <>
          <div className="db-menu-sep" />
          <div className="db-menu-label">Style</div>
          {cartesian && hasSeries ? <Toggle label="Stacked" on={!!config.stacked || !!config.normalize} onChange={(on) => set({ stacked: on, normalize: on ? config.normalize : false })} /> : null}
          {cartesian ? <Toggle label={hasSeries ? "Stack to 100%" : "Show as share of total"} on={!!config.normalize} onChange={(on) => set({ normalize: on, stacked: on && hasSeries ? true : config.stacked })} /> : null}
          {cartesian ? <Toggle label="Running total" on={!!config.cumulative} onChange={(on) => set({ cumulative: on })} /> : null}
          {lineLike || kind === "radar" || (supportsSecondary(kind) && config.aggregate2) ? (
            <Row label="Line shape" as="div">
              <Segmented
                label="Line shape"
                value={curve}
                options={kind === "radar" ? CURVES.filter((c) => c.id !== "step") : CURVES}
                onChange={(next) => set({ curve: next === "straight" ? undefined : next, smooth: undefined })}
              />
            </Row>
          ) : null}
          {lineLike || kind === "radar" || (supportsSecondary(kind) && config.aggregate2) ? (
            <Toggle label="Points" on={config.points ?? true} onChange={(on) => set({ points: on ? undefined : false })} />
          ) : null}
          {kind === "area" && !(config.stacked && hasSeries) ? <Toggle label="Fade fill" on={config.gradient ?? true} onChange={(on) => set({ gradient: on })} /> : null}
          {kind === "donut" ? (
            <Row label="Ring thickness">
              <span className="db-chart-slider">
                <input
                  type="range"
                  min={10}
                  max={90}
                  step={2}
                  value={config.donutWidth ?? 34}
                  aria-label="Ring thickness"
                  onChange={(event) => set({ donutWidth: Number(event.target.value) === 34 ? undefined : Number(event.target.value) })}
                />
                <output>{config.donutWidth ?? 34}%</output>
              </span>
            </Row>
          ) : null}
          {axes ? <Toggle label="Gridlines" on={config.grid ?? true} onChange={(on) => set({ grid: on })} /> : null}
          {inline ? (
            <Row label="Height">
              <NumberField value={config.height} placeholder="320" min={180} max={1200} step={20} integer onCommit={(value) => set({ height: value })} label="Height in pixels" />
            </Row>
          ) : null}

          {kind !== "number" ? (
          <Section id="colors" title="Colors" summary={colorSummary(config)}>
            {isBar && singleSeries ? (
              <Row label="Color bars" as="div">
                <Segmented
                  label="Color bars"
                  value={config.colorBy ?? "auto"}
                  options={[
                    { id: "auto", name: "Auto" },
                    { id: "category", name: "By group" },
                    { id: "single", name: "One" },
                  ]}
                  onChange={(next) => set({ colorBy: next === "auto" ? undefined : (next as ChartConfig["colorBy"]) })}
                />
              </Row>
            ) : null}
            {singleSeries && !sliced && kind !== "heatmap" && config.colorBy !== "category" ? (
              <div className="db-settings-row db-chart-colors-row">
                <span>Color</span>
                <div className="db-chart-colors" role="radiogroup" aria-label="Color">
                  <ColorDot name="From palette" color={undefined} active={!config.color} onPick={() => set({ color: undefined })} />
                  <ColorDot name="Accent" color={accent || CHART_TONES.light.orange} active={config.color === "accent"} onPick={() => set({ color: "accent", colorBy: config.colorBy === "category" ? undefined : config.colorBy })} />
                  {SINGLE_TONES.map((tone) => (
                    <ColorDot key={tone} name={tone[0].toUpperCase() + tone.slice(1)} color={CHART_TONES[dark ? "dark" : "light"][tone]} active={config.color === tone} onPick={() => set({ color: tone })} />
                  ))}
                </div>
              </div>
            ) : null}
            <div className="db-chart-palettes" role="radiogroup" aria-label="Palette">
              {CHART_PALETTES.map((palette) => {
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
          </Section>
          ) : null}
        </>
      ) : null}

      {hasLabels || !config.normalize ? (
        <Section id="labels" title="Labels & numbers" summary={hasLabels ? (labelsOn ? "Labels on" : "Labels off") : formatName(config.format)}>
          {hasLabels ? <Toggle label="Data labels" on={labelsOn} onChange={(on) => set({ labels: on })} /> : null}
          {hasLabels && labelsOn ? (
            <>
              <Row label="Show">
                <select className="db-select" value={config.labelContent ?? defaultContent} aria-label="Label shows" onChange={(event) => set({ labelContent: event.target.value === defaultContent ? undefined : (event.target.value as ChartLabelContent) })}>
                  {labelContents.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Row>
              {kind !== "radar" ? (
                <Row label="Position" as="div">
                  <Segmented
                    label="Label position"
                    value={config.labelPosition ?? "auto"}
                    options={[
                      { id: "auto", name: "Auto" },
                      { id: "inside", name: "Inside" },
                      { id: "outside", name: "Outside" },
                    ]}
                    onChange={(next) => set({ labelPosition: next === "auto" ? undefined : (next as ChartConfig["labelPosition"]) })}
                  />
                </Row>
              ) : null}
            </>
          ) : null}
          {!config.normalize ? (
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
        </Section>
      ) : null}

      {axes ? (
        <Section id="axes" title="Axes" summary={axesSummary(config)}>
          <Row label={kind === "bar" ? "Y axis title" : "X axis title"}>
            <TextField value={config.xTitle} placeholder="None" label="Category axis title" onCommit={(value) => set({ xTitle: value })} />
          </Row>
          <Row label={kind === "bar" ? "X axis title" : "Y axis title"}>
            <TextField value={config.yTitle} placeholder="None" label="Value axis title" onCommit={(value) => set({ yTitle: value })} />
          </Row>
          <Toggle label={kind === "bar" ? "Category labels" : "X axis labels"} on={config.xLabels ?? true} onChange={(on) => set({ xLabels: on })} />
          <Toggle label={kind === "bar" ? "Value labels" : "Y axis labels"} on={config.yLabels ?? true} onChange={(on) => set({ yLabels: on })} />
          {kind !== "bar" && !scatter && (config.xLabels ?? true) ? (
            <Row label="Label angle">
              <select className="db-select" value={config.labelAngle ?? ""} aria-label="Label angle" onChange={(event) => set({ labelAngle: event.target.value === "" ? undefined : Number(event.target.value) })}>
                <option value="">Automatic</option>
                {ANGLES.map((angle) => (
                  <option key={angle} value={angle}>
                    {angle === 0 ? "Level" : `${angle}°`}
                  </option>
                ))}
              </select>
            </Row>
          ) : null}
          {(cartesian && !config.normalize) || scatter ? (
            <>
              <Toggle label="Log scale" on={!!config.logScale} onChange={(on) => set({ logScale: on })} />
              <Row label={scatter ? "Y range" : "Value range"}>
                <span className="db-chart-range">
                  <NumberField value={config.yMin} placeholder="Auto" onCommit={(value) => set({ yMin: value })} label="Minimum" />
                  <i>–</i>
                  <NumberField value={config.yMax} placeholder="Auto" onCommit={(value) => set({ yMax: value })} label="Maximum" />
                </span>
              </Row>
              {config.logScale ? <div className="db-chart-hint">Zero and negative values are left out on a log scale.</div> : null}
            </>
          ) : null}
        </Section>
      ) : null}

      {kind !== "number" ? (
        <Section id="legend" title="Legend & tooltip" summary={[canLegend ? (legendShown ? LEGEND_NAMES[config.legendPosition ?? "top"] : "No legend") : "", TOOLTIP_NAMES[config.tooltip ?? "group"]].filter(Boolean).join(" · ")}>
          {canLegend ? <Toggle label="Legend" on={legendShown} onChange={(on) => set({ legend: on })} /> : null}
          {canLegend && legendShown ? (
            <Row label="Position" as="div">
              <Segmented
                label="Legend position"
                value={config.legendPosition ?? "top"}
                options={(["top", "bottom", "left", "right"] as const).map((id) => ({ id, name: LEGEND_NAMES[id] }))}
                onChange={(next) => set({ legendPosition: next === "top" ? undefined : (next as ChartConfig["legendPosition"]) })}
              />
            </Row>
          ) : null}
          <Row label="Tooltip">
            <select className="db-select" value={config.tooltip ?? "group"} aria-label="Tooltip" onChange={(event) => set({ tooltip: event.target.value === "group" ? undefined : (event.target.value as ChartConfig["tooltip"]) })}>
              {cartesian ? <option value="group">Whole group</option> : <option value="group">On hover</option>}
              {cartesian ? <option value="item">Single mark</option> : null}
              <option value="off">Off</option>
            </select>
          </Row>
        </Section>
      ) : null}

      {cartesian || scatter || kind === "number" ? (
        <Section id="goal" title="Goal line" summary={config.goal === undefined ? "None" : `${config.goalLabel?.trim() || "Goal"} ${config.goal.toLocaleString()}`}>
          <Row label="Goal">
            <NumberField value={config.goal} placeholder="None" onCommit={(value) => set({ goal: value })} label="Goal" />
          </Row>
          {kind !== "number" && config.goal !== undefined ? (
            <Row label="Label">
              <TextField value={config.goalLabel} placeholder="Goal" label="Goal label" onCommit={(value) => set({ goalLabel: value })} />
            </Row>
          ) : null}
        </Section>
      ) : null}

      {zoomable ? (
        <Section id="zoom" title="Zoom" summary={config.zoom === false ? "Off" : config.zoomSlider ? "On · slider" : "On"}>
          <Toggle label="Zoom and pan" on={config.zoom ?? true} onChange={(on) => set({ zoom: on, zoomSlider: on ? config.zoomSlider : undefined })} />
          {config.zoom !== false ? <Toggle label="Range slider" on={!!config.zoomSlider} onChange={(on) => set({ zoomSlider: on })} /> : null}
          {config.zoom !== false ? <div className="db-chart-hint">{`${MOD_KEY}+scroll or pinch to zoom, drag to pan. Click into the chart and the wheel zooms on its own.`}</div> : null}
        </Section>
      ) : null}

      <Section id="empty" title="Empty state" summary={config.emptyText ? "Custom" : "Default"}>
        <Row label="Message">
          <TextField value={config.emptyText} placeholder="No rows to chart." label="Empty message" onCommit={(value) => set({ emptyText: value })} />
        </Row>
      </Section>
    </div>
  );
}

const MOD_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";
const ANGLES = [0, 30, 45, 60, 90];
const SINGLE_TONES = ["blue", "green", "purple", "pink", "yellow", "gray"] as const;
const CURVES: { id: NonNullable<ChartConfig["curve"]>; name: string }[] = [
  { id: "straight", name: "Straight" },
  { id: "smooth", name: "Smooth" },
  { id: "step", name: "Step" },
];
const LABEL_CONTENTS: { id: ChartLabelContent; name: string }[] = [
  { id: "value", name: "Value" },
  { id: "percent", name: "Percent" },
  { id: "name", name: "Name" },
  { id: "nameValue", name: "Name and value" },
  { id: "namePercent", name: "Name and percent" },
];
const LEGEND_NAMES: Record<NonNullable<ChartConfig["legendPosition"]>, string> = { top: "Top", bottom: "Bottom", left: "Left", right: "Right" };
const TOOLTIP_NAMES: Record<NonNullable<ChartConfig["tooltip"]>, string> = { group: "Tooltip", item: "Single tooltip", off: "No tooltip" };

/** Which property a measure keeps when its aggregate changes. */
function keepMeasure(next: ChartAggregate, current: string | undefined, fallback: string | undefined, numbers: Property[]): string | undefined {
  if (next === "count") return undefined;
  if (isNumericAggregate(next)) return numbers.some((p) => p.id === current) ? current : numbers[0]?.id;
  return current ?? fallback;
}

function measureName(agg: ChartAggregate, property: Property | undefined): string {
  const name = CHART_AGGREGATES.find((a) => a.id === agg)?.name ?? agg;
  return agg === "count" ? name : `${name.replace(/ rows$/, "")} of ${property?.name || "…"}`;
}

function formatName(format: NumberFormat | undefined): string {
  return format ? (NUMBER_FORMATS.find((f) => f.id === format)?.name ?? format) : "From property";
}

function colorSummary(config: ChartConfig): string {
  const palette = CHART_PALETTES.find((p) => p.id === (config.palette ?? "auto"))?.name ?? "Auto";
  if (config.color) return `${config.color === "accent" ? "Accent" : config.color[0].toUpperCase() + config.color.slice(1)} · ${palette}`;
  return palette;
}

function axesSummary(config: ChartConfig): string {
  const parts: string[] = [];
  if (config.xTitle || config.yTitle) parts.push("Titled");
  if (config.logScale) parts.push("Log");
  if (config.yMin !== undefined || config.yMax !== undefined) parts.push("Fixed range");
  if (config.xLabels === false || config.yLabels === false) parts.push("Labels hidden");
  return parts.join(" · ") || "Automatic";
}

const OPEN_KEY = "noteral.chartSettings.open";
function readOpen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(OPEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** A collapsed group of advanced settings; its open state is remembered per section. */
function Section({ id, title, summary, children }: { id: string; title: string; summary?: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => readOpen().has(id));
  const toggle = () => {
    setOpen((was) => {
      const next = !was;
      try {
        const all = readOpen();
        if (next) all.add(id);
        else all.delete(id);
        window.localStorage.setItem(OPEN_KEY, JSON.stringify([...all]));
      } catch {
        /* per-viewer convenience only */
      }
      return next;
    });
  };
  const bodyId = `db-chart-section-${id}`;
  return (
    <div className={`db-chart-section ${open ? "is-open" : ""}`}>
      <button type="button" className="db-chart-section-head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        <ChevronRight size={13} className="db-chart-section-chevron" aria-hidden />
        <span>{title}</span>
        {!open && summary ? <em>{summary}</em> : null}
      </button>
      {open ? (
        <div id={bodyId} className="db-chart-section-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; name: string }[]; onChange: (next: T) => void }) {
  return (
    <div className="db-segmented db-chart-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? "is-on" : ""} onClick={() => value !== o.id && onChange(o.id)}>
          {o.name}
        </button>
      ))}
    </div>
  );
}

function ColorDot({ name, color, active, onPick }: { name: string; color: string | undefined; active: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={active} aria-label={name} title={name} className={`db-chart-color ${active ? "is-active" : ""} ${color ? "" : "is-auto"}`} onClick={onPick}>
      <i style={color ? { background: color } : undefined} />
    </button>
  );
}

function AggregateSelect({ value, onChange, none }: { value: ChartAggregate | undefined; onChange: (next: ChartAggregate | undefined) => void; none?: string }) {
  return (
    <select className="db-select" value={value ?? ""} aria-label={none ? "Second aggregate" : "Aggregate"} onChange={(event) => onChange((event.target.value || undefined) as ChartAggregate | undefined)}>
      {none ? <option value="">{none}</option> : null}
      {CHART_AGGREGATES.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}

function Row({ label, children, as = "label" }: { label: string; children: ReactNode; as?: "label" | "div" }) {
  const Tag = as;
  return (
    <Tag className="db-settings-row">
      <span>{label}</span>
      {children}
    </Tag>
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

function TextField({ value, onCommit, placeholder, label }: { value?: string; onCommit: (value: string | undefined) => void; placeholder?: string; label: string }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  const commit = () => {
    const next = draft.trim() || undefined;
    if (next !== value) onCommit(next);
  };
  return (
    <input
      className="db-input db-chart-text"
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      maxLength={80}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        if (event.key === "Escape") setDraft(value ?? "");
      }}
    />
  );
}
