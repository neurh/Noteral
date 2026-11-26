// ECharts glue for database chart views. Loaded with a dynamic import so the
// chart engine stays out of the main bundle; everything chart-shaped is
// computed by lib/chartData.ts, this file only turns it into options.

import { BarChart, FunnelChart, HeatmapChart, LineChart, PieChart, RadarChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent,
  BrushComponent,
  CalendarComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  RadarComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { LabelLayout, UniversalTransition } from "echarts/features";
import { SVGRenderer } from "echarts/renderers";
import { formatChartValue, isCartesian, shareOf, type ChartCategory, type ChartData } from "../../lib/chartData";
import type { ChartLabelContent } from "../../lib/database";
import { paletteById, paletteColors, mixColors, textOn, withAlpha, type ChartTheme } from "./chartTheme";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  FunnelChart,
  RadarChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  VisualMapComponent,
  CalendarComponent,
  GraphicComponent,
  RadarComponent,
  AriaComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  BrushComponent,
  ToolboxComponent,
  LabelLayout,
  UniversalTransition,
  SVGRenderer,
]);

type Option = echarts.EChartsCoreOption;
type Params = {
  componentType?: string;
  seriesType?: string;
  seriesId?: string;
  seriesIndex?: number;
  dataIndex?: number;
  data?: unknown;
  value?: unknown;
  name?: string;
  color?: string;
  percent?: number;
  event?: { event?: MouseEvent; offsetX?: number; offsetY?: number };
};

/** What a click on the chart picked: a mark's rows, or a single row (scatter). */
export interface ChartPick {
  x: number;
  y: number;
  title: string;
  color?: string;
  /** Formatted measure of the picked mark. */
  value?: string;
  rowIds: string[];
  /** Open this row directly (scatter points). */
  rowId?: string;
}

export interface ChartSize {
  width: number;
  height: number;
}

export interface ChartHandle {
  update(data: ChartData, theme: ChartTheme, size: ChartSize): void;
  resize(size: ChartSize): void;
  /** Pause hover tooltips (while the picked-rows popover is open). */
  quiet(on: boolean): void;
  /** Zoom around the middle of the visible range; above 1 zooms in. */
  zoom(factor: number): void;
  resetZoom(): void;
  /** Arm (or cancel) a one-shot box zoom: drag across the plot to zoom into that range. */
  boxZoom(on: boolean): void;
  /** Let the plain wheel zoom (after the chart was clicked into, or in the expanded view). */
  setFreeWheel(on: boolean): void;
  dispose(): void;
}

export interface ZoomState {
  /** The chart can zoom at all. */
  available: boolean;
  /** Some axis shows less than its full range. */
  zoomed: boolean;
  /** A box zoom is armed. */
  boxing: boolean;
}

const SECONDARY_ID = "__secondary";

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ── Colours ──────────────────────────────────────────────────────────────

interface Colored {
  color?: ChartCategory["color"];
  empty?: boolean;
  other?: boolean;
}

/** Whether a list's option colours tell its items apart well enough to use them. */
function optionColorsWork(items: Colored[]): boolean {
  const colored = items.filter((item) => !item.empty && !item.other);
  if (!colored.length || colored.some((item) => !item.color)) return false;
  const unique = new Set(colored.map((item) => item.color)).size;
  return unique >= Math.min(colored.length, 3);
}

function colorsFor(items: Colored[], data: ChartData, theme: ChartTheme): string[] {
  const palette = paletteById(data.config.palette);
  const colors = paletteColors(palette, theme);
  const useTones = palette.id === "auto" && optionColorsWork(items);
  const neutral = theme.dark ? mixColors(theme.textFaint, theme.bg, 0.25) : theme.textFaint;
  let next = 0;
  return items.map((item) => {
    if (item.empty || item.other) return neutral;
    if (useTones && item.color) return theme.tones[item.color];
    return colors[next++ % colors.length];
  });
}

// ── Formatting ───────────────────────────────────────────────────────────

function tipRow(color: string, name: string, value: string, extra?: string): string {
  return `<div class="db-chart-tip-row"><i style="background:${color}"></i><span>${escapeHtml(name)}</span><b>${escapeHtml(value)}</b>${extra ? `<em>${escapeHtml(extra)}</em>` : ""}</div>`;
}

function tip(title: string, rows: string, hint?: string): string {
  return `<div class="db-chart-tip"><div class="db-chart-tip-title">${escapeHtml(title)}</div>${rows}${hint ? `<div class="db-chart-tip-hint">${escapeHtml(hint)}</div>` : ""}</div>`;
}

const pct = (share: number) => `${(share * 100).toLocaleString(undefined, { maximumFractionDigits: share < 0.1 ? 1 : 0 })}%`;

function approxTextWidth(text: string, size = 11): number {
  return text.length * size * 0.56;
}

// ── Option building ──────────────────────────────────────────────────────

function baseOption(theme: ChartTheme, animate: boolean): Option {
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily: theme.fontUi, color: theme.textSoft, fontSize: 11 },
    animation: animate,
    animationDuration: 520,
    animationDurationUpdate: 420,
    animationEasing: "cubicOut",
    animationEasingUpdate: "cubicInOut",
    aria: { enabled: true, decal: { show: false } },
    tooltip: {
      confine: true,
      className: "db-chart-tooltip",
      backgroundColor: theme.bgRaised,
      borderColor: theme.border,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: theme.text, fontFamily: theme.fontUi, fontSize: 12 },
      extraCssText: `box-shadow:${theme.shadow};border-radius:8px;`,
      transitionDuration: 0.12,
      enterable: false,
    },
  };
}

function legendOption(theme: ChartTheme, place: "top" | "bottom"): Record<string, unknown> {
  return {
    type: "scroll",
    [place]: 0,
    left: 0,
    right: 0,
    icon: "roundRect",
    itemWidth: 10,
    itemHeight: 10,
    itemGap: 14,
    textStyle: { color: theme.textSoft, fontSize: 11.5, fontFamily: theme.fontUi },
    inactiveColor: withAlpha(theme.textFaint, 0.6),
    pageIconColor: theme.textMuted,
    pageIconInactiveColor: theme.border,
    pageIconSize: 10,
    pageTextStyle: { color: theme.textMuted, fontSize: 11 },
  };
}

type LegendPlace = NonNullable<ChartData["config"]["legendPosition"]>;
interface Pad {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A legend at the configured edge, and the room the plot leaves for it. */
function legendAt(theme: ChartTheme, place: LegendPlace, show: boolean, width: number): { legend: Record<string, unknown>; pad: Pad } {
  const pad = { top: 0, right: 0, bottom: 0, left: 0 };
  if (!show) return { legend: { show: false }, pad };
  if (place === "top" || place === "bottom") {
    pad[place] = place === "top" ? 24 : 26;
    return { legend: legendOption(theme, place), pad };
  }
  // Side legends: a column of entries, at most a quarter of the chart wide.
  const room = Math.max(80, Math.min(150, Math.round(width * 0.24)));
  pad[place] = room + 10;
  const { left: _l, right: _r, ...rest } = legendOption(theme, "top");
  return {
    legend: { ...rest, top: "middle", [place]: 0, orient: "vertical", width: room, textStyle: { ...(rest.textStyle as object), width: room - 18, overflow: "truncate" } },
    pad,
  };
}

/** The mark colour of single-colour charts. */
function singleColor(data: ChartData, theme: ChartTheme): string | undefined {
  const color = data.config.color;
  if (!color) return undefined;
  if (color === "accent") return theme.accent;
  if (color in theme.tones) return theme.tones[color as keyof ChartTheme["tones"]];
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color)) return color;
  return undefined;
}

/** What a data label reads: value, share, name, or a mix. */
function labelText(content: ChartLabelContent, name: string, value: number | null, share: number | null, format: ChartData["valueFormat"]): string {
  if (value === null) return "";
  const formatted = formatChartValue(value, format, true);
  const percent = share === null ? "" : pct(share);
  switch (content) {
    case "value":
      return formatted;
    case "percent":
      return percent;
    case "name":
      return name;
    case "nameValue":
      return `${name}  ${formatted}`;
    case "namePercent":
      return `${name}  ${percent}`;
  }
}

function axisTitle(title: string | undefined, theme: ChartTheme): Record<string, unknown> {
  if (!title?.trim()) return {};
  return {
    name: title.trim(),
    nameLocation: "middle",
    nameGap: 10,
    nameMoveOverlap: true,
    nameTextStyle: { color: theme.textMuted, fontSize: 11, fontWeight: 500, fontFamily: theme.fontUi },
  };
}

/** A log axis cannot draw zero or negatives; those values are left out. */
export function usesLog(data: ChartData): boolean {
  return !!data.config.logScale && !data.normalized;
}

function valueAxis(data: ChartData, theme: ChartTheme, showGrid: boolean, span = 400): Record<string, unknown> {
  const { config } = data;
  const log = usesLog(data);
  return {
    type: log ? "log" : "value",
    logBase: 10,
    min: data.normalized ? 0 : log ? (config.yMin && config.yMin > 0 ? config.yMin : undefined) : config.yMin,
    max: data.normalized ? 1 : config.yMax,
    // Fewer ticks when the value axis runs across a narrow chart.
    splitNumber: span < 300 ? 3 : 4,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { show: showGrid, lineStyle: { color: theme.border, width: 1 } },
    axisLabel: {
      show: config.yLabels ?? true,
      color: theme.textMuted,
      fontSize: 11,
      hideOverlap: true,
      formatter: (value: number) => formatChartValue(value, data.valueFormat, true),
    },
    ...axisTitle(config.yTitle, theme),
  };
}

/** Series values on a log axis: non-positive values become gaps. */
const logSafe = (values: (number | null)[], log: boolean) => (log ? values.map((v) => (v !== null && v > 0 ? v : null)) : values);

function cartesian(data: ChartData, theme: ChartTheme, size: ChartSize): Option {
  const { config, categories, kind } = data;
  const horizontal = kind === "bar";
  const multi = data.series.length > 1;
  const stacked = multi && (!!config.stacked || data.normalized);
  const second = horizontal ? undefined : data.secondary;
  const showLegend = config.legend ?? (multi || !!second);
  const showGrid = config.grid ?? true;
  const labels = !!config.labels;
  const area = kind === "area";
  const isBar = kind === "bar" || kind === "column";
  const log = usesLog(data);
  const n = categories.length;
  const single = singleColor(data, theme);
  // Colour each bar by its category when a lone series is split by options, or when asked to.
  const autoPerCategory = paletteById(config.palette).id === "auto" ? optionColorsWork(categories) : data.xKind === "option" || data.xKind === "checkbox";
  const perCategory = isBar && !multi && (config.colorBy === "category" || (config.colorBy !== "single" && !single && autoPerCategory));
  const categoryColors = perCategory ? colorsFor(categories, data, theme) : [];
  const seriesColors = !multi && single ? [single] : colorsFor(data.series, data, theme);
  const { legend, pad } = legendAt(theme, config.legendPosition ?? "top", showLegend, size.width);

  // Data labels: what they say and where they sit.
  const content: ChartLabelContent = config.labelContent ?? "value";
  const inside = config.labelPosition ? config.labelPosition === "inside" : stacked;
  const seriesTotals = data.series.map((s) => s.values.reduce<number>((a, v) => a + Math.abs(v ?? 0), 0));
  const labelFor = (si: number, i: number, value: unknown) => {
    if (typeof value !== "number" || (isBar && value === 0)) return "";
    const share = data.normalized ? value : seriesTotals[si] ? value / seriesTotals[si] : null;
    return labelText(content, categories[i]?.label ?? "", value, share, data.valueFormat);
  };

  // Category labels: rotate when they will not fit side by side (or as set); truncate always.
  const plotWidth = Math.max(120, size.width - 64 - pad.left - pad.right);
  const slot = plotWidth / Math.max(1, n);
  const longest = Math.max(0, ...categories.map((c) => approxTextWidth(c.label)));
  const autoRotate = longest > slot - 6 && n > 1 && n <= 48 && data.xKind !== "date" ? 35 : 0;
  const rotate = horizontal ? 0 : config.labelAngle ?? autoRotate;
  const categoryAxis = {
    type: "category",
    data: categories.map((c) => c.label),
    inverse: horizontal,
    boundaryGap: isBar || n === 1,
    axisLine: { show: true, lineStyle: { color: theme.borderStrong } },
    axisTick: { show: false },
    axisLabel: {
      show: config.xLabels ?? true,
      color: theme.textMuted,
      fontSize: 11,
      hideOverlap: true,
      rotate,
      // Dates keep whole labels and thin out (hideOverlap); text truncates to its slot.
      width: horizontal ? Math.min(140, size.width * 0.3) : rotate ? 96 : data.xKind === "date" ? undefined : Math.max(36, slot - 6),
      overflow: data.xKind === "date" && !horizontal ? "none" : "truncate",
      ellipsis: "…",
      margin: 10,
    },
    ...axisTitle(config.xTitle, theme),
  };
  const vAxis = valueAxis(data, theme, showGrid, horizontal ? size.width - 140 : size.height);

  const topIndex = categories.map((_, i) => {
    for (let s = data.series.length - 1; s >= 0; s--) if ((data.series[s].values[i] ?? 0) !== 0) return s;
    return -1;
  });
  const radius = Math.min(4, theme.radius);
  const roundEnd = horizontal ? [0, radius, radius, 0] : [radius, radius, 0, 0];
  const showSymbols = config.points ?? n <= 32;
  const curve = config.curve ?? (config.smooth ? "smooth" : "straight");
  const lineShape = { smooth: curve === "smooth" ? 0.32 : false, step: curve === "step" ? "middle" : false };

  const series: Record<string, unknown>[] = data.series.map((s, si) => {
    const color = seriesColors[si];
    const values = logSafe(s.values, log);
    if (isBar) {
      return {
        id: s.key,
        name: s.label,
        type: "bar",
        stack: stacked ? "total" : undefined,
        barMaxWidth: horizontal ? 28 : 46,
        barMinHeight: 0,
        barCategoryGap: multi && !stacked ? "28%" : "36%",
        barGap: "12%",
        itemStyle: { color, borderRadius: stacked ? 0 : roundEnd, ...(stacked ? { borderColor: theme.bg, borderWidth: 1 } : {}) },
        emphasis: { focus: multi ? "series" : "none", itemStyle: { color: perCategory ? undefined : color } },
        blur: { itemStyle: { opacity: 0.35 } },
        label: {
          show: labels,
          position: inside ? "inside" : horizontal ? "right" : "top",
          color: inside ? textOn(color, theme) : theme.textSoft,
          fontSize: 11,
          formatter: (p: Params) => labelFor(si, p.dataIndex ?? 0, p.value),
        },
        labelLayout: { hideOverlap: true },
        data: values.map((value, i) => {
          const item: Record<string, unknown> = { value };
          const style: Record<string, unknown> = {};
          if (perCategory) style.color = categoryColors[i];
          if (stacked && topIndex[i] === si) style.borderRadius = roundEnd;
          if (Object.keys(style).length) item.itemStyle = style;
          if (perCategory && inside) item.label = { color: textOn(categoryColors[i], theme) };
          return item;
        }),
      };
    }
    const gradient =
      config.gradient === false
        ? withAlpha(color, theme.dark ? 0.24 : 0.18)
        : new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: withAlpha(color, theme.dark ? 0.32 : 0.26) },
            { offset: 1, color: withAlpha(color, 0.02) },
          ]);
    return {
      id: s.key,
      name: s.label,
      type: "line",
      stack: stacked ? "total" : undefined,
      ...lineShape,
      connectNulls: true,
      symbol: "circle",
      symbolSize: 7,
      showSymbol: showSymbols,
      lineStyle: { width: 2, color },
      itemStyle: { color, borderColor: theme.bg, borderWidth: 1.5 },
      areaStyle: area ? (stacked ? { color: withAlpha(color, theme.dark ? 0.55 : 0.5), opacity: 1 } : { color: gradient }) : undefined,
      emphasis: { focus: multi ? "series" : "none", scale: 1.4 },
      blur: { lineStyle: { opacity: 0.3 }, areaStyle: { opacity: 0.2 } },
      label: {
        show: labels,
        position: inside ? "bottom" : "top",
        color: theme.textSoft,
        fontSize: 11,
        formatter: (p: Params) => labelFor(si, p.dataIndex ?? 0, p.value),
      },
      labelLayout: { hideOverlap: true },
      data: values,
    };
  });

  if (config.goal !== undefined && Number.isFinite(config.goal) && series.length) {
    const goal = data.normalized ? undefined : config.goal;
    if (goal !== undefined) {
      const name = config.goalLabel?.trim() || "Goal";
      series[series.length - 1].markLine = {
        silent: true,
        symbol: "none",
        animation: false,
        lineStyle: { color: theme.textMuted, type: [4, 4], width: 1 },
        label: { formatter: `${name} ${formatChartValue(goal, data.valueFormat, true)}`, position: "insideEndTop", color: theme.textMuted, fontSize: 11 },
        data: [horizontal ? { xAxis: goal } : { yAxis: goal }],
      };
    }
  }

  // Combo: the second measure as a line over its own right-hand axis.
  const palette = paletteColors(paletteById(config.palette), theme);
  const secondColor = perCategory ? theme.textSoft : palette.find((c) => !seriesColors.includes(c)) ?? theme.textSoft;
  let secondAxis: Record<string, unknown> | undefined;
  if (second) {
    series.push({
      id: SECONDARY_ID,
      name: second.label,
      type: "line",
      yAxisIndex: 1,
      z: 5,
      ...lineShape,
      connectNulls: true,
      symbol: "circle",
      symbolSize: 6,
      showSymbol: showSymbols,
      lineStyle: { width: 2, color: secondColor },
      itemStyle: { color: secondColor, borderColor: theme.bg, borderWidth: 1.5 },
      emphasis: { focus: "series", scale: 1.4 },
      label: {
        show: labels,
        position: "top",
        color: theme.textSoft,
        fontSize: 11,
        formatter: (p: Params) => (typeof p.value === "number" ? formatChartValue(p.value, second.format, true) : ""),
      },
      labelLayout: { hideOverlap: true },
      data: second.values,
    });
    secondAxis = {
      type: "value",
      position: "right",
      alignTicks: !log,
      splitNumber: size.height < 300 ? 3 : 4,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: config.yLabels ?? true, color: theme.textMuted, fontSize: 11, hideOverlap: true, formatter: (value: number) => formatChartValue(value, second.format, true) },
    };
  }

  const tipMode = config.tooltip ?? "group";
  return {
    legend,
    grid: {
      left: 2 + pad.left,
      right: (horizontal ? 24 : 10) + pad.right,
      top: 10 + pad.top + (labels && !horizontal && !inside ? 12 : 0),
      bottom: 2 + pad.bottom,
      outerBoundsMode: "same",
      outerBoundsContain: config.xTitle?.trim() || config.yTitle?.trim() ? "all" : "axisLabel",
    },
    xAxis: horizontal ? vAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : secondAxis ? [vAxis, secondAxis] : vAxis,
    tooltip: {
      show: tipMode !== "off",
      trigger: tipMode === "item" ? "item" : "axis",
      axisPointer: isBar
        ? { type: "shadow", shadowStyle: { color: withAlpha(theme.text, theme.dark ? 0.06 : 0.045) } }
        : { type: "line", lineStyle: { color: theme.borderStrong, width: 1 } },
      formatter: (raw: Params | Params[]) => {
        const params = (Array.isArray(raw) ? raw : [raw]).filter((p) => p.seriesType === "bar" || p.seriesType === "line");
        if (!params.length) return "";
        const index = params[0].dataIndex ?? 0;
        const category = categories[index];
        const primary = params.filter((p) => p.seriesId !== SECONDARY_ID);
        let rows = "";
        let sum = 0;
        for (const p of stacked ? [...primary].reverse() : primary) {
          const s = data.series[p.seriesIndex ?? 0];
          if (!s) continue;
          const value = s.values[index] ?? null;
          sum += value ?? 0;
          const color = perCategory ? categoryColors[index] : seriesColors[p.seriesIndex ?? 0];
          rows += tipRow(color, multi ? s.label : data.measureLabel, formatChartValue(value, data.valueFormat));
        }
        if (multi && !data.normalized && primary.length > 1 && data.aggregate !== "average" && data.aggregate !== "median" && data.aggregate !== "min" && data.aggregate !== "max") {
          rows += `<div class="db-chart-tip-total">${tipRow("transparent", "Total", formatChartValue(sum, data.valueFormat))}</div>`;
        }
        if (second && params.some((p) => p.seriesId === SECONDARY_ID)) rows += tipRow(secondColor, second.label, formatChartValue(second.values[index] ?? null, second.format));
        return tip(category?.fullLabel ?? "", rows, config.cumulative ? "Running total" : undefined);
      },
    },
    series,
  };
}

function pieOption(data: ChartData, theme: ChartTheme, size: ChartSize): Option {
  const { config, categories } = data;
  const donut = data.kind === "donut";
  const values = data.series[0]?.values ?? [];
  const colors = colorsFor(categories, data, theme);
  const showLegend = config.legend ?? false;
  const labels = config.labels ?? true;
  const { legend, pad } = legendAt(theme, config.legendPosition ?? "top", showLegend, size.width);
  const plotW = Math.max(120, size.width - pad.left - pad.right);
  const plotH = Math.max(120, size.height - pad.top - pad.bottom);
  const small = Math.min(plotW, plotH) < 260;
  const narrow = plotW < 420;
  const insideLabels = config.labelPosition === "inside";
  const outside = labels && !small && !insideLabels;
  const outer = outside ? (narrow ? "52%" : "66%") : "78%";
  const centerX = (pad.left + plotW / 2) / Math.max(1, size.width);
  const centerY = (pad.top + plotH / 2) / Math.max(1, size.height) + (pad.top ? 0.03 : 0);
  const content: ChartLabelContent = config.labelContent ?? "namePercent";
  const thickness = Math.min(90, Math.max(10, config.donutWidth ?? 34)) / 100;
  const option: Option = {
    legend,
    tooltip: {
      show: config.tooltip !== "off",
      trigger: "item",
      formatter: (p: Params) => {
        const i = p.dataIndex ?? 0;
        const value = values[i] ?? null;
        return tip(categories[i]?.fullLabel ?? "", tipRow(colors[i], data.measureLabel, formatChartValue(value, data.valueFormat), pct(shareOf(value, values))));
      },
    },
    series: [
      {
        id: "slices",
        type: "pie",
        radius: donut ? [`${parseFloat(outer) * (1 - thickness)}%`, outer] : [0, outer],
        center: [`${centerX * 100}%`, `${centerY * 100}%`],
        avoidLabelOverlap: true,
        padAngle: donut ? 1.2 : 0,
        minAngle: 1,
        startAngle: 90,
        itemStyle: { borderColor: theme.bg, borderWidth: donut ? 0 : 1.5, borderRadius: donut ? 3 : 2 },
        label: {
          show: labels && (!small || insideLabels),
          position: insideLabels ? "inside" : "outside",
          color: insideLabels ? undefined : theme.textSoft,
          fontSize: 11.5,
          fontFamily: theme.fontUi,
          overflow: "truncate",
          width: narrow ? Math.max(64, size.width * 0.24) : Math.max(60, Math.min(140, size.width * 0.18)),
          lineHeight: 14,
          // Narrow charts stack the share under the name so names keep their room.
          formatter: (p: Params) => {
            const value = values[p.dataIndex ?? 0] ?? null;
            const share = pct(shareOf(value, values));
            const amount = formatChartValue(value, data.valueFormat, true);
            const gap = narrow || insideLabels ? "\n" : "  ";
            if (content === "value") return amount;
            if (content === "percent") return share;
            if (content === "name") return p.name ?? "";
            return `${p.name}${gap}{pct|${content === "nameValue" ? amount : share}}`;
          },
          rich: { pct: { color: insideLabels ? undefined : theme.textMuted, fontSize: 11 } },
        },
        labelLine: { length: 8, length2: 10, smooth: 0.2, lineStyle: { color: theme.borderStrong } },
        labelLayout: { hideOverlap: true },
        emphasis: { scale: true, scaleSize: 5, label: { show: labels && (!small || insideLabels) } },
        data: categories.map((c, i) => ({ id: c.key, name: c.label, value: values[i] ?? 0, itemStyle: { color: colors[i] }, ...(insideLabels ? { label: { color: textOn(colors[i], theme) } } : {}) })),
      },
    ],
  };
  // The centre total needs a hole big enough to sit in.
  if (donut && thickness <= 0.55) {
    const total = data.aggregate === "count" || data.aggregate === "sum" || data.aggregate === "countValues" ? values.reduce<number>((a, v) => a + (v ?? 0), 0) : data.total;
    const big = Math.max(16, Math.min(30, Math.min(size.width, size.height) * 0.09));
    option.graphic = [
      {
        id: "centre",
        type: "text",
        x: size.width * centerX,
        y: size.height * centerY - big * 0.85,
        silent: true,
        style: {
          text: `{v|${formatChartValue(total, data.valueFormat, (total ?? 0) >= 1e5)}}\n{l|${data.measureLabel}}`,
          align: "center",
          rich: {
            v: { fontSize: big, fontWeight: 650, fill: theme.text, fontFamily: theme.fontUi, lineHeight: big * 1.15 },
            l: { fontSize: 11, fill: theme.textMuted, fontFamily: theme.fontUi, lineHeight: 14 },
          },
        },
      },
    ];
  }
  return option;
}

function funnelOption(data: ChartData, theme: ChartTheme, size: ChartSize): Option {
  const { config, categories } = data;
  const values = data.series[0]?.values ?? [];
  const colors = colorsFor(categories, data, theme);
  const first = values[0] ?? 0;
  const { legend, pad } = legendAt(theme, config.legendPosition ?? "top", !!config.legend, size.width);
  const content: ChartLabelContent = config.labelContent ?? "nameValue";
  const outside = config.labelPosition === "outside";
  return {
    legend,
    tooltip: {
      show: config.tooltip !== "off",
      trigger: "item",
      formatter: (p: Params) => {
        const i = p.dataIndex ?? 0;
        const value = values[i] ?? null;
        const ofFirst = first && value !== null ? `${pct(value / first)} of top` : undefined;
        return tip(categories[i]?.fullLabel ?? "", tipRow(colors[i], data.measureLabel, formatChartValue(value, data.valueFormat), ofFirst));
      },
    },
    series: [
      {
        id: "funnel",
        type: "funnel",
        sort: "none",
        left: pad.left + size.width * 0.08,
        right: pad.right + size.width * (outside ? 0.3 : 0.08),
        top: 8 + pad.top,
        bottom: 8 + pad.bottom,
        minSize: "6%",
        gap: 2,
        itemStyle: { borderWidth: 0, borderRadius: 3 },
        label: {
          show: config.labels ?? true,
          position: outside ? "right" : "inside",
          fontSize: 11.5,
          fontFamily: theme.fontUi,
          formatter: (p: Params) => {
            const value = values[p.dataIndex ?? 0] ?? null;
            return labelText(content, p.name ?? "", value, first && value !== null ? value / first : null, data.valueFormat);
          },
        },
        emphasis: { label: { fontWeight: 600 } },
        data: categories.map((c, i) => ({
          id: c.key,
          name: c.label,
          value: values[i] ?? 0,
          itemStyle: { color: colors[i] },
          label: { color: outside ? theme.textSoft : textOn(colors[i], theme) },
        })),
      },
    ],
  };
}

function radarOption(data: ChartData, theme: ChartTheme, size: ChartSize): Option {
  const { config, categories } = data;
  const colors = colorsFor(data.series, data, theme);
  const multi = data.series.length > 1;
  const showLegend = config.legend ?? multi;
  const peak = Math.max(0, ...data.series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const max = config.yMax ?? (data.normalized ? 1 : peak > 0 ? niceCeil(peak) : 1);
  const { legend, pad } = legendAt(theme, config.legendPosition ?? "top", showLegend, size.width);
  const plotW = Math.max(120, size.width - pad.left - pad.right);
  const plotH = Math.max(120, size.height - pad.top - pad.bottom);
  return {
    legend,
    tooltip: {
      show: config.tooltip !== "off",
      trigger: "item",
      formatter: (p: Params) => {
        const s = data.series[p.dataIndex ?? 0];
        if (!s) return "";
        const rows = categories.map((c, i) => tipRow(colors[p.dataIndex ?? 0], c.label, formatChartValue(s.values[i], data.valueFormat))).join("");
        return tip(multi ? s.label : data.measureLabel, rows);
      },
    },
    radar: {
      shape: "polygon",
      radius: Math.round(Math.min(plotW, plotH) * (plotW < 420 ? 0.34 : 0.38)),
      center: [pad.left + plotW / 2, pad.top + plotH / 2 + (pad.top ? 4 : 0)],
      splitNumber: 4,
      indicator: categories.map((c) => ({ name: c.label, max, min: config.yMin ?? 0 })),
      axisName: { color: theme.textMuted, fontSize: 11, fontFamily: theme.fontUi, overflow: "truncate", width: 90 },
      axisNameGap: 8,
      splitLine: { lineStyle: { color: theme.border } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: theme.border } },
    },
    series: [
      {
        id: "radar",
        type: "radar",
        symbol: config.points === false ? "none" : "circle",
        symbolSize: 6,
        emphasis: { focus: "self", lineStyle: { width: 2.5 } },
        data: data.series.map((s, i) => ({
          id: s.key,
          name: s.label,
          value: s.values.map((v) => v ?? 0),
          itemStyle: { color: colors[i], borderColor: theme.bg, borderWidth: 1 },
          lineStyle: { color: colors[i], width: 2 },
          areaStyle: { color: withAlpha(colors[i], multi ? 0.1 : 0.18) },
          label: { show: !!config.labels, color: theme.textSoft, fontSize: 10.5, formatter: (p: Params) => formatChartValue(Number(p.value), data.valueFormat, true) },
        })),
      },
    ],
  };
}

function niceCeil(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  const unit = value / power;
  // A fine ladder so the largest spoke reaches most of the way out.
  const nice = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((step) => unit <= step) ?? 10;
  return nice * power;
}

function rampColors(theme: ChartTheme, steps: number): string[] {
  const base = theme.dark ? mixColors(theme.bgSunken, theme.bg, 0.5) : theme.bgSunken;
  return Array.from({ length: steps }, (_, i) => mixColors(base, theme.accent, 0.22 + (0.78 * i) / Math.max(1, steps - 1)));
}

function calendarOption(data: ChartData, theme: ChartTheme, size: ChartSize): Option {
  const values = data.series[0]?.values ?? [];
  const days = data.categories.map((c, i) => [c.key, values[i] ?? 0] as [string, number]).filter(([, v]) => v !== 0);
  const last = data.categories[data.categories.length - 1]?.key ?? new Date().toISOString().slice(0, 10);
  const firstData = data.categories[0]?.key ?? last;
  const end = new Date(`${last}T00:00:00`);
  const earliest = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 364);
  const latestStart = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 7 * 16);
  const first = new Date(`${firstData}T00:00:00`);
  const startDate = first < earliest ? earliest : first > latestStart ? latestStart : first;
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const weeks = Math.ceil((end.getTime() - startDate.getTime()) / (7 * 86_400_000)) + 1;
  const cell = Math.max(9, Math.min(22, Math.floor((size.width - 44) / weeks), Math.floor((size.height - 56) / 7)));
  const max = Math.max(1, ...days.map(([, v]) => v));
  const ramp = rampColors(theme, 5);
  const pieces = max <= 5
    ? Array.from({ length: Math.ceil(max) }, (_, i) => ({ min: i + 1, max: i + 1, color: ramp[Math.round((i / Math.max(1, Math.ceil(max) - 1)) * 4)] }))
    : ramp.map((color, i) => ({ gt: (max * i) / 5, lte: (max * (i + 1)) / 5, color }));
  const gridWidth = weeks * cell;
  const calendarTop = Math.max(26, (size.height - 7 * cell - 28) / 2 + 10);
  return {
    tooltip: {
      trigger: "item",
      formatter: (p: Params) => {
        const [day, value] = (p.data as [string, number]) ?? [];
        const date = new Date(`${day}T00:00:00`);
        const label = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
        return tip(label, tipRow(String(p.color ?? theme.accent), data.measureLabel, formatChartValue(value, data.valueFormat)));
      },
    },
    visualMap: {
      type: "piecewise",
      show: size.height >= 200,
      orient: "horizontal",
      right: Math.max(8, (size.width - gridWidth) / 2),
      // Sits just under the grid rather than at the far bottom.
      top: Math.min(size.height - 18, calendarTop + 7 * cell + 12),
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 3,
      itemSymbol: "roundRect",
      showLabel: false,
      text: ["More", "Less"],
      textGap: 6,
      textStyle: { color: theme.textMuted, fontSize: 11 },
      pieces,
      outOfRange: { color: "transparent" },
      selectedMode: false,
    },
    calendar: {
      range: [iso(startDate), last],
      cellSize: [cell, cell],
      left: Math.max(28, (size.width - gridWidth) / 2 + 14),
      top: calendarTop,
      orient: "horizontal",
      splitLine: { show: false },
      itemStyle: { color: theme.dark ? mixColors(theme.bgSunken, theme.bg, 0.5) : theme.bgSunken, borderColor: theme.bg, borderWidth: Math.max(2, cell * 0.16), borderRadius: 2 },
      yearLabel: { show: false },
      monthLabel: { color: theme.textMuted, fontSize: 11, fontFamily: theme.fontUi, margin: 6 },
      dayLabel: { firstDay: 1, color: theme.textFaint, fontSize: 10, fontFamily: theme.fontUi, nameMap: ["S", "M", "T", "W", "T", "F", "S"], margin: 6 },
    },
    series: [
      {
        id: "days",
        type: "heatmap",
        coordinateSystem: "calendar",
        data: days,
        itemStyle: { borderColor: theme.bg, borderWidth: Math.max(2, cell * 0.16), borderRadius: 3 },
        emphasis: { itemStyle: { borderColor: theme.text, borderWidth: 1 } },
      },
    ],
  };
}

function matrixOption(data: ChartData, theme: ChartTheme, size: ChartSize): Option {
  const { categories, config } = data;
  const rows = data.series;
  const cells: [number, number, number | null][] = [];
  let max = 0;
  rows.forEach((s, j) => s.values.forEach((v, i) => {
    cells.push([i, j, v]);
    if (v !== null) max = Math.max(max, v);
  }));
  const ramp = rampColors(theme, 2);
  const slot = (size.width - 120) / Math.max(1, categories.length);
  const showLabels = config.labels ?? (slot >= 34 && cells.length <= 240);
  const rotate = config.labelAngle ?? (categories.some((c) => approxTextWidth(c.label) > slot - 4) && categories.length <= 48 ? 35 : 0);
  const titled = !!(config.xTitle?.trim() || config.yTitle?.trim());
  return {
    tooltip: {
      show: config.tooltip !== "off",
      trigger: "item",
      formatter: (p: Params) => {
        const [i, j, v] = p.value as [number, number, number | null];
        const title = rows.length > 1 ? `${categories[i]?.fullLabel} · ${rows[j]?.label}` : categories[i]?.fullLabel ?? "";
        return tip(title, tipRow(String(p.color ?? theme.accent), data.measureLabel, formatChartValue(v, data.valueFormat)));
      },
    },
    grid: { left: 2, right: 8, top: 8, bottom: 2, outerBoundsMode: "same", outerBoundsContain: titled ? "all" : "axisLabel" },
    xAxis: {
      type: "category",
      data: categories.map((c) => c.label),
      splitArea: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: config.xLabels ?? true, color: theme.textMuted, fontSize: 11, hideOverlap: true, rotate, overflow: "truncate", width: rotate ? 96 : Math.max(30, slot - 4) },
      ...axisTitle(config.xTitle, theme),
    },
    yAxis: {
      type: "category",
      data: rows.map((s) => s.label),
      inverse: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: config.yLabels ?? true, color: theme.textMuted, fontSize: 11, overflow: "truncate", width: 110 },
      ...axisTitle(config.yTitle, theme),
    },
    visualMap: { type: "continuous", show: false, min: 0, max: max || 1, inRange: { color: ramp }, dimension: 2 },
    series: [
      {
        id: "matrix",
        type: "heatmap",
        // Readable text on every cell: pick light/dark from the cell's place on the ramp.
        data: cells.map((cell) => {
          const v = cell[2];
          if (v === null || !max) return cell;
          return { value: cell, label: { color: textOn(mixColors(ramp[0], ramp[1], v / max), theme) } };
        }),
        itemStyle: { borderColor: theme.bg, borderWidth: 2, borderRadius: Math.min(4, theme.radius) },
        label: {
          show: showLabels,
          fontSize: 11,
          fontFamily: theme.fontUi,
          formatter: (p: Params) => {
            const v = (p.value as [number, number, number | null])[2];
            return v === null || v === 0 ? "" : formatChartValue(v, data.valueFormat, true);
          },
          color: theme.text,
        },
        emphasis: { itemStyle: { borderColor: theme.text, borderWidth: 1 } },
      },
    ],
  };
}

function scatterOption(data: ChartData, theme: ChartTheme, size: ChartSize): Option {
  const { config } = data;
  const multi = data.series.length > 1;
  const single = singleColor(data, theme);
  const colors = !multi && single ? [single] : colorsFor(data.series, data, theme);
  const showLegend = config.legend ?? multi;
  const { legend, pad } = legendAt(theme, config.legendPosition ?? "top", showLegend, size.width);
  const log = usesLog(data);
  const xLabels = config.xLabels ?? true;
  const showGrid = config.grid ?? true;
  const xFormat = data.xProperty?.format ?? "number";
  const dense = data.points.length > 400;
  const axisCommon = {
    axisLine: { show: true, lineStyle: { color: theme.borderStrong } },
    axisTick: { show: false },
    splitLine: { show: showGrid, lineStyle: { color: theme.border } },
  };
  return {
    legend,
    grid: {
      left: 2 + pad.left,
      right: 14 + pad.right,
      top: 12 + pad.top,
      bottom: 2 + pad.bottom,
      outerBoundsMode: "same",
      outerBoundsContain: config.xTitle?.trim() || config.yTitle?.trim() ? "all" : "axisLabel",
    },
    xAxis: data.pointsAreDates
      ? { type: "time", ...axisCommon, splitLine: { show: false }, axisLabel: { show: xLabels, color: theme.textMuted, fontSize: 11, hideOverlap: true }, ...axisTitle(config.xTitle, theme) }
      : { type: "value", scale: true, ...axisCommon, axisLabel: { show: xLabels, color: theme.textMuted, fontSize: 11, hideOverlap: true, formatter: (v: number) => formatChartValue(v, xFormat, true) }, ...axisTitle(config.xTitle, theme) },
    yAxis: {
      type: log ? "log" : "value",
      scale: config.yMin === undefined,
      min: log && !(config.yMin && config.yMin > 0) ? undefined : config.yMin,
      max: config.yMax,
      ...axisCommon,
      axisLine: { show: false },
      axisLabel: { show: config.yLabels ?? true, color: theme.textMuted, fontSize: 11, formatter: (v: number) => formatChartValue(v, data.valueFormat, true) },
      ...axisTitle(config.yTitle, theme),
    },
    tooltip: {
      show: config.tooltip !== "off",
      trigger: "item",
      formatter: (p: Params) => {
        const point = p.data as { name: string; value: [number, number]; series: number };
        const s = data.series[point.series];
        const xText = data.pointsAreDates
          ? new Date(point.value[0]).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
          : formatChartValue(point.value[0], xFormat);
        const rows =
          tipRow(colors[point.series], data.xProperty?.name ?? "x", xText) +
          tipRow(colors[point.series], data.yProperty?.name ?? "y", formatChartValue(point.value[1], data.valueFormat)) +
          (multi && s ? tipRow("transparent", s.label, "") : "");
        return tip(point.name, rows, "Click to open");
      },
    },
    series: data.series.map((s, i) => ({
      id: s.key,
      name: s.label,
      type: "scatter",
      symbolSize: dense ? 6 : 9,
      large: data.points.length > 2000,
      itemStyle: { color: withAlpha(colors[i], dense ? 0.6 : 0.82), borderColor: theme.bg, borderWidth: dense ? 0 : 1 },
      emphasis: { focus: multi ? "series" : "none", scale: 1.5 },
      blur: { itemStyle: { opacity: 0.25 } },
      data: data.points.filter((p) => p.series === s.key && (!log || p.y > 0)).map((p) => ({ name: p.label, value: [p.x, p.y], rowId: p.rowId, series: i })),
      markLine:
        config.goal !== undefined && i === data.series.length - 1
          ? {
              silent: true,
              symbol: "none",
              lineStyle: { color: theme.textMuted, type: [4, 4], width: 1 },
              label: { formatter: `${config.goalLabel?.trim() || "Goal"} ${formatChartValue(config.goal, data.valueFormat, true)}`, position: "insideEndTop", color: theme.textMuted, fontSize: 11 },
              data: [{ yAxis: config.goal }],
            }
          : undefined,
    })),
  };
}

export function buildOption(data: ChartData, theme: ChartTheme, size: ChartSize, animate = true): Option {
  const base = baseOption(theme, animate);
  let body: Option;
  if (isCartesian(data.kind)) body = cartesian(data, theme, size);
  else if (data.kind === "pie" || data.kind === "donut") body = pieOption(data, theme, size);
  else if (data.kind === "funnel") body = funnelOption(data, theme, size);
  else if (data.kind === "radar") body = radarOption(data, theme, size);
  else if (data.kind === "heatmap") body = data.calendar ? calendarOption(data, theme, size) : matrixOption(data, theme, size);
  else if (data.kind === "scatter") body = scatterOption(data, theme, size);
  else body = {};
  const axes = zoomAxes(data);
  if (axes) Object.assign(body, zoomOption(data, theme, axes, body.grid as Record<string, number> | undefined, false));
  return { ...base, ...body, tooltip: { ...(base.tooltip as object), ...((body.tooltip as object) ?? {}) } };
}

// ── Zoom ─────────────────────────────────────────────────────────────────

interface ZoomAxes {
  x: boolean;
  y: boolean;
  /** Box-zoom brush: a range along one axis, or a rectangle. */
  brush: "lineX" | "lineY" | "rect";
}

/** Which axes zoom: the category axis of bars and lines, both axes of scatter plots and grid heatmaps. */
export function zoomAxes(data: ChartData): ZoomAxes | null {
  if (data.issue || data.config.zoom === false) return null;
  if (data.kind === "bar") return { x: false, y: true, brush: "lineY" };
  if (isCartesian(data.kind)) return { x: true, y: false, brush: "lineX" };
  if (data.kind === "scatter" || (data.kind === "heatmap" && !data.calendar)) return { x: true, y: true, brush: "rect" };
  return null;
}

const ZOOM_IDS = { x: "zoomX", y: "zoomY" } as const;

/** Inside zoom (wheel with Ctrl/⌘, pinch, drag to pan), an optional slider, and the box-zoom brush. */
function zoomOption(data: ChartData, theme: ChartTheme, axes: ZoomAxes, grid: Record<string, number> | undefined, freeWheel: boolean): Option {
  const categoryLike = data.kind !== "scatter";
  const inside = (axis: "x" | "y") => ({
    type: "inside",
    id: ZOOM_IDS[axis],
    [axis === "x" ? "xAxisIndex" : "yAxisIndex"]: 0,
    filterMode: categoryLike && data.kind !== "heatmap" ? "filter" : "none",
    // Plain wheel scrolls the page; Ctrl (and pinch, which arrives as Ctrl+wheel) zooms.
    zoomOnMouseWheel: freeWheel ? true : "ctrl",
    moveOnMouseWheel: false,
    moveOnMouseMove: true,
    preventDefaultMouseMove: true,
    ...(categoryLike ? { minValueSpan: 1 } : {}),
  });
  const zooms: Record<string, unknown>[] = [];
  if (axes.x) zooms.push(inside("x"));
  if (axes.y) zooms.push(inside("y"));
  const option: Option = { dataZoom: zooms };
  if (data.config.zoomSlider) {
    const vertical = !axes.x;
    zooms.push({
      type: "slider",
      id: "zoomSlider",
      [vertical ? "yAxisIndex" : "xAxisIndex"]: 0,
      ...(vertical ? { right: 2, top: grid?.top ?? 10, bottom: grid?.bottom ?? 2, width: 14, orient: "vertical" } : { left: grid?.left ?? 2, right: grid?.right ?? 10, bottom: 4, height: 16 }),
      filterMode: categoryLike && data.kind !== "heatmap" ? "filter" : "none",
      showDetail: false,
      brushSelect: false,
      borderColor: theme.border,
      borderRadius: 4,
      backgroundColor: theme.bgSunken,
      fillerColor: withAlpha(theme.accent, theme.dark ? 0.18 : 0.12),
      dataBackground: { lineStyle: { color: theme.borderStrong, width: 1 }, areaStyle: { color: withAlpha(theme.textFaint, 0.18) } },
      selectedDataBackground: { lineStyle: { color: theme.accent, width: 1 }, areaStyle: { color: withAlpha(theme.accent, 0.14) } },
      handleIcon: "path://M2,0 L6,0 Q8,0 8,2 L8,14 Q8,16 6,16 L2,16 Q0,16 0,14 L0,2 Q0,0 2,0 Z",
      handleSize: "100%",
      handleStyle: { color: theme.bgRaised, borderColor: theme.borderStrong, borderWidth: 1 },
      moveHandleSize: 0,
      emphasis: { handleStyle: { borderColor: theme.accent } },
      textStyle: { color: theme.textMuted, fontSize: 10.5 },
    });
    if (grid) {
      if (vertical) grid.right = (grid.right ?? 10) + 24;
      else grid.bottom = (grid.bottom ?? 2) + 28;
    }
  }
  // The brush registers its buttons on a toolbox; ours live in the chart head instead.
  option.toolbox = { show: false };
  option.brush = {
    id: "boxZoom",
    ...(axes.x ? { xAxisIndex: 0 } : {}),
    ...(axes.y ? { yAxisIndex: 0 } : {}),
    brushType: axes.brush,
    brushMode: "single",
    transformable: false,
    removeOnClick: true,
    throttleType: "debounce",
    throttleDelay: 0,
    brushStyle: { borderWidth: 1, color: withAlpha(theme.accent, 0.1), borderColor: withAlpha(theme.accent, 0.65) },
    outOfBrush: { colorAlpha: 1 },
  };
  return option;
}

/** Option components that differ between chart shapes; a change rebuilds the chart. */
function shapeOf(data: ChartData, size: ChartSize): string {
  const { config } = data;
  const legend = config.legend ?? (data.series.length > 1 || !!data.secondary);
  // Zoom ranges reset whenever this changes: a new axis, bucket, kind, or set of categories.
  return [
    data.kind,
    data.calendar,
    config.stacked,
    data.normalized,
    legend,
    config.legendPosition,
    config.goal !== undefined,
    !!data.secondary,
    config.zoom,
    config.zoomSlider,
    config.x,
    config.y,
    config.series,
    data.bucket,
    config.logScale,
    data.categories.length,
    data.kind === "scatter" ? data.points.length : 0,
    Math.round(size.height / 40),
  ].join("|");
}

// ── Picking ──────────────────────────────────────────────────────────────

function unionRows(data: ChartData, categoryKeys: string[], seriesKey?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of categoryKeys) for (const id of data.rowsByCell(key, seriesKey)) if (!seen.has(id)) seen.add(id), out.push(id);
  return out;
}

function pickFrom(data: ChartData, theme: ChartTheme, params: Params, x: number, y: number): ChartPick | null {
  const { categories, series } = data;
  const measure = (value: number | null | undefined) => (value === null || value === undefined ? undefined : formatChartValue(value, data.valueFormat));
  if (params.componentType !== "series") return null;
  if (data.kind === "scatter") {
    const point = params.data as { rowId?: string; name?: string } | undefined;
    return point?.rowId ? { x, y, title: point.name ?? "", rowIds: [point.rowId], rowId: point.rowId } : null;
  }
  if (data.kind === "radar") {
    const s = series[params.dataIndex ?? 0];
    if (!s) return null;
    return { x, y, title: series.length > 1 ? s.label : data.measureLabel, color: params.color, rowIds: unionRows(data, categories.map((c) => c.key), series.length > 1 ? s.key : undefined) };
  }
  if (data.kind === "heatmap") {
    if (data.calendar) {
      const [day, value] = (params.data as [string, number]) ?? [];
      const date = new Date(`${day}T00:00:00`);
      return { x, y, title: date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }), color: params.color, value: measure(value), rowIds: data.rowsByCell(day) };
    }
    const [i, j, v] = params.value as [number, number, number | null];
    const c = categories[i];
    const s = series[j];
    if (!c) return null;
    return { x, y, title: series.length > 1 && s ? `${c.fullLabel} · ${s.label}` : c.fullLabel, color: params.color, value: measure(v), rowIds: data.rowsByCell(c.key, series.length > 1 ? s?.key : undefined) };
  }
  const index = params.dataIndex ?? 0;
  const c = categories[index];
  if (!c) return null;
  const s = series.find((item) => item.key === params.seriesId) ?? series[params.seriesIndex ?? 0];
  const multi = series.length > 1;
  const title = multi && s ? `${c.fullLabel} · ${s.label}` : c.fullLabel;
  return { x, y, title, color: params.color, value: measure(s?.values[index]), rowIds: data.rowsByCell(c.key, multi ? s?.key : undefined) };
}

/** Mounts a chart in an element. Clicks report what was picked. */
export function mountChart(el: HTMLElement, onPick: (pick: ChartPick) => void, onZoom?: (state: ZoomState) => void): ChartHandle {
  const chart = echarts.init(el, null, { renderer: "svg", width: el.clientWidth || undefined, height: el.clientHeight || undefined });
  let current: { data: ChartData; theme: ChartTheme; size: ChartSize; shape: string } | null = null;
  let markClicked = false;
  let freeWheel = false;
  let boxing = false;
  let lastState = "";

  type ZoomModel = { id?: string; start?: number; end?: number };
  const zooms = (): ZoomModel[] => {
    const list = (chart.getOption()?.dataZoom as ZoomModel[] | undefined) ?? [];
    return list.filter((z) => z.id === ZOOM_IDS.x || z.id === ZOOM_IDS.y);
  };
  const report = () => {
    const list = current && zoomAxes(current.data) ? zooms() : [];
    const state: ZoomState = { available: list.length > 0, zoomed: list.some((z) => (z.start ?? 0) > 0.01 || (z.end ?? 100) < 99.99), boxing };
    const key = `${state.available}|${state.zoomed}|${state.boxing}`;
    if (key !== lastState) {
      lastState = key;
      onZoom?.(state);
    }
  };
  const applyWheel = () => {
    const list = zooms();
    if (list.length) chart.setOption({ dataZoom: list.map((z) => ({ id: z.id, zoomOnMouseWheel: freeWheel ? true : "ctrl" })) });
  };
  chart.on("datazoom", report);

  // ⌘+wheel on macOS zooms like Ctrl+wheel (pinch already arrives as Ctrl+wheel).
  const onWheel = (event: WheelEvent) => {
    if (event.metaKey && !event.ctrlKey) Object.defineProperty(event, "ctrlKey", { value: true });
  };
  el.addEventListener("wheel", onWheel, { capture: true, passive: true });

  // Box zoom: the brushed range becomes the zoom window, then the brush goes away.
  chart.on("brushEnd", (raw) => {
    const area = ((raw as { areas?: { coordRange?: unknown }[] }).areas ?? [])[0];
    const axes = current ? zoomAxes(current.data) : null;
    const range = area?.coordRange;
    if (axes && Array.isArray(range)) {
      const span = (a: unknown, b: unknown) => {
        const lo = Math.min(Number(a), Number(b));
        const hi = Math.max(Number(a), Number(b));
        return current?.data.kind === "scatter" ? { startValue: lo, endValue: hi } : { startValue: Math.round(lo), endValue: Math.round(hi) };
      };
      const batch: Record<string, unknown>[] = [];
      if (axes.brush === "rect" && Array.isArray(range[0]) && Array.isArray(range[1])) {
        batch.push({ dataZoomId: ZOOM_IDS.x, ...span(range[0][0], range[0][1]) }, { dataZoomId: ZOOM_IDS.y, ...span(range[1][0], range[1][1]) });
      } else if (range.length === 2 && range.every((v) => Number.isFinite(Number(v)))) {
        batch.push({ dataZoomId: axes.x ? ZOOM_IDS.x : ZOOM_IDS.y, ...span(range[0], range[1]) });
      }
      if (batch.length) chart.dispatchAction({ type: "dataZoom", batch });
    }
    chart.dispatchAction({ type: "brush", areas: [] });
    setBoxing(false);
  });
  const setBoxing = (on: boolean) => {
    const axes = current ? zoomAxes(current.data) : null;
    boxing = on && !!axes;
    chart.dispatchAction({ type: "takeGlobalCursor", key: "brush", brushOption: boxing && axes ? { brushType: axes.brush, brushMode: "single" } : { brushType: false } });
    report();
  };

  const client = (params: Params): { x: number; y: number } => {
    const e = params.event?.event;
    if (e && typeof e.clientX === "number") return { x: e.clientX, y: e.clientY };
    const rect = el.getBoundingClientRect();
    return { x: rect.left + (params.event?.offsetX ?? 0), y: rect.top + (params.event?.offsetY ?? 0) };
  };

  // The row list replaces the tooltip; never show both.
  const pickAndHide = (pick: ChartPick) => {
    chart.dispatchAction({ type: "hideTip" });
    onPick(pick);
  };

  chart.on("click", (raw) => {
    if (!current || boxing) return;
    const params = raw as unknown as Params;
    const { x, y } = client(params);
    const pick = pickFrom(current.data, current.theme, params, x, y);
    if (pick) {
      markClicked = true;
      pickAndHide(pick);
    }
  });

  // Clicking anywhere in a category's band (not only on a mark) picks that category:
  // thin lines and short bars are easy to miss.
  chart.getZr().on("click", (event) => {
    const clicked = markClicked;
    markClicked = false;
    if (clicked || boxing || !current || !isCartesian(current.data.kind)) return;
    const { data } = current;
    const point = [event.offsetX, event.offsetY];
    if (!chart.containPixel({ gridIndex: 0 }, point)) return;
    const value = chart.convertFromPixel({ gridIndex: 0 }, point) as number[] | number;
    const coords = Array.isArray(value) ? value : [value, value];
    const index = Math.round(data.kind === "bar" ? coords[1] : coords[0]);
    const c = data.categories[index];
    if (!c) return;
    const rect = el.getBoundingClientRect();
    const total = data.series.length > 1 && !data.normalized ? data.series.reduce((a, s) => a + (s.values[index] ?? 0), 0) : data.series[0]?.values[index];
    pickAndHide({
      x: rect.left + event.offsetX,
      y: rect.top + event.offsetY,
      title: c.fullLabel,
      value: total === null || total === undefined ? undefined : formatChartValue(total, data.valueFormat),
      rowIds: unionRows(data, [c.key]),
    });
  });

  return {
    update(data, theme, size) {
      const shape = shapeOf(data, size);
      const rebuild = !current || current.shape !== shape || current.theme !== theme;
      const option = buildOption(data, theme, size, true);
      if (rebuild) {
        boxing = false;
        chart.setOption(option, { notMerge: true, lazyUpdate: false });
      } else chart.setOption(option, { replaceMerge: ["series", "graphic", "xAxis", "yAxis", "visualMap"] });
      current = { data, theme, size, shape };
      if (freeWheel) applyWheel();
      report();
    },
    resize(size) {
      chart.resize({ width: size.width, height: size.height, animation: { duration: 0 } });
      if (current && (current.data.kind === "donut" || current.data.calendar || Math.abs(current.size.width - size.width) > 40)) {
        // Layout that depends on size (centre label, calendar cells, label widths).
        const option = buildOption(current.data, current.theme, size, false);
        chart.setOption(option, { replaceMerge: ["series", "graphic", "xAxis", "yAxis", "visualMap", "calendar"] });
        current = { ...current, size };
      }
    },
    quiet(on) {
      chart.dispatchAction({ type: "hideTip" });
      chart.setOption({ tooltip: { show: !on && current?.data.config.tooltip !== "off" } });
    },
    zoom(factor) {
      const batch = zooms().map((z) => {
        const from = z.start ?? 0;
        const to = z.end ?? 100;
        const span = Math.min(100, Math.max(1, (to - from) / factor));
        const mid = Math.min(100 - span / 2, Math.max(span / 2, (from + to) / 2));
        return { dataZoomId: z.id, start: mid - span / 2, end: mid + span / 2 };
      });
      if (batch.length) chart.dispatchAction({ type: "dataZoom", batch });
    },
    resetZoom() {
      const batch = zooms().map((z) => ({ dataZoomId: z.id, start: 0, end: 100 }));
      if (batch.length) chart.dispatchAction({ type: "dataZoom", batch });
      if (boxing) setBoxing(false);
    },
    boxZoom(on) {
      setBoxing(on);
    },
    setFreeWheel(on) {
      if (freeWheel === on) return;
      freeWheel = on;
      applyWheel();
    },
    dispose() {
      el.removeEventListener("wheel", onWheel, { capture: true });
      chart.dispose();
    },
  };
}
