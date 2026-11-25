// ECharts glue for database chart views. Loaded with a dynamic import so the
// chart engine stays out of the main bundle; everything chart-shaped is
// computed by lib/chartData.ts, this file only turns it into options.

import { BarChart, FunnelChart, HeatmapChart, LineChart, PieChart, RadarChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent,
  CalendarComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  RadarComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { LabelLayout, UniversalTransition } from "echarts/features";
import { SVGRenderer } from "echarts/renderers";
import { formatChartValue, isCartesian, shareOf, type ChartCategory, type ChartData } from "../../lib/chartData";
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
  dispose(): void;
}

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

function valueAxis(data: ChartData, theme: ChartTheme, showGrid: boolean, span = 400): Record<string, unknown> {
  const { config } = data;
  return {
    type: "value",
    min: data.normalized ? 0 : config.yMin,
    max: data.normalized ? 1 : config.yMax,
    // Fewer ticks when the value axis runs across a narrow chart.
    splitNumber: span < 300 ? 3 : 4,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { show: showGrid, lineStyle: { color: theme.border, width: 1 } },
    axisLabel: {
      color: theme.textMuted,
      fontSize: 11,
      hideOverlap: true,
      formatter: (value: number) => formatChartValue(value, data.valueFormat, true),
    },
  };
}

function cartesian(data: ChartData, theme: ChartTheme, size: ChartSize): Option {
  const { config, categories, kind } = data;
  const horizontal = kind === "bar";
  const multi = data.series.length > 1;
  const stacked = multi && (!!config.stacked || data.normalized);
  const showLegend = config.legend ?? multi;
  const showGrid = config.grid ?? true;
  const labels = !!config.labels;
  const area = kind === "area";
  const isBar = kind === "bar" || kind === "column";
  const n = categories.length;
  // Colour each bar by its category when a lone series is split by options.
  const perCategory = isBar && !multi && paletteById(config.palette).id === "auto" ? optionColorsWork(categories) : isBar && !multi && (data.xKind === "option" || data.xKind === "checkbox");
  const categoryColors = perCategory ? colorsFor(categories, data, theme) : [];
  const seriesColors = colorsFor(data.series, data, theme);

  // Category labels: rotate when they will not fit side by side; truncate always.
  const plotWidth = Math.max(120, size.width - 64);
  const slot = plotWidth / Math.max(1, n);
  const longest = Math.max(0, ...categories.map((c) => approxTextWidth(c.label)));
  const rotate = !horizontal && longest > slot - 6 && n > 1 && n <= 48 && data.xKind !== "date" ? 35 : 0;
  const categoryAxis = {
    type: "category",
    data: categories.map((c) => c.label),
    inverse: horizontal,
    boundaryGap: isBar || n === 1,
    axisLine: { show: true, lineStyle: { color: theme.borderStrong } },
    axisTick: { show: false },
    axisLabel: {
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
  };
  const vAxis = valueAxis(data, theme, showGrid, horizontal ? size.width - 140 : size.height);

  const topIndex = categories.map((_, i) => {
    for (let s = data.series.length - 1; s >= 0; s--) if ((data.series[s].values[i] ?? 0) !== 0) return s;
    return -1;
  });
  const radius = Math.min(4, theme.radius);
  const roundEnd = horizontal ? [0, radius, radius, 0] : [radius, radius, 0, 0];
  const showSymbols = n <= 32;

  const series = data.series.map((s, si) => {
    const color = seriesColors[si];
    const values = s.values;
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
          position: stacked ? "inside" : horizontal ? "right" : "top",
          color: stacked ? textOn(color, theme) : theme.textSoft,
          fontSize: 11,
          formatter: (p: Params) => (typeof p.value === "number" && p.value !== 0 ? formatChartValue(p.value, data.valueFormat, true) : ""),
        },
        labelLayout: { hideOverlap: true },
        data: values.map((value, i) => {
          const item: Record<string, unknown> = { value };
          const style: Record<string, unknown> = {};
          if (perCategory) style.color = categoryColors[i];
          if (stacked && topIndex[i] === si) style.borderRadius = roundEnd;
          if (Object.keys(style).length) item.itemStyle = style;
          return item;
        }),
      };
    }
    const gradient = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: withAlpha(color, theme.dark ? 0.32 : 0.26) },
      { offset: 1, color: withAlpha(color, 0.02) },
    ]);
    return {
      id: s.key,
      name: s.label,
      type: "line",
      stack: stacked ? "total" : undefined,
      smooth: config.smooth ? 0.32 : false,
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
        position: "top",
        color: theme.textSoft,
        fontSize: 11,
        formatter: (p: Params) => (typeof p.value === "number" ? formatChartValue(p.value, data.valueFormat, true) : ""),
      },
      labelLayout: { hideOverlap: true },
      data: values,
    };
  });

  if (config.goal !== undefined && Number.isFinite(config.goal) && series.length) {
    const goal = data.normalized ? undefined : config.goal;
    if (goal !== undefined) {
      (series[series.length - 1] as Record<string, unknown>).markLine = {
        silent: true,
        symbol: "none",
        animation: false,
        lineStyle: { color: theme.textMuted, type: [4, 4], width: 1 },
        label: { formatter: `Goal ${formatChartValue(goal, data.valueFormat, true)}`, position: "insideEndTop", color: theme.textMuted, fontSize: 11 },
        data: [horizontal ? { xAxis: goal } : { yAxis: goal }],
      };
    }
  }

  return {
    legend: showLegend ? legendOption(theme, "top") : { show: false },
    grid: {
      left: 2,
      right: horizontal ? 24 : 10,
      top: (showLegend ? 34 : 10) + (labels && !horizontal && !stacked ? 12 : 0),
      bottom: 2,
      outerBoundsMode: "same",
      outerBoundsContain: "axisLabel",
    },
    xAxis: horizontal ? vAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : vAxis,
    tooltip: {
      trigger: "axis",
      axisPointer: isBar
        ? { type: "shadow", shadowStyle: { color: withAlpha(theme.text, theme.dark ? 0.06 : 0.045) } }
        : { type: "line", lineStyle: { color: theme.borderStrong, width: 1 } },
      formatter: (raw: Params | Params[]) => {
        const params = (Array.isArray(raw) ? raw : [raw]).filter((p) => p.seriesType === "bar" || p.seriesType === "line");
        if (!params.length) return "";
        const index = params[0].dataIndex ?? 0;
        const category = categories[index];
        let rows = "";
        let sum = 0;
        for (const p of stacked ? [...params].reverse() : params) {
          const s = data.series[p.seriesIndex ?? 0];
          const value = s?.values[index] ?? null;
          sum += value ?? 0;
          const color = perCategory ? categoryColors[index] : seriesColors[p.seriesIndex ?? 0];
          rows += tipRow(color, multi ? s.label : data.measureLabel, formatChartValue(value, data.valueFormat));
        }
        if (multi && !data.normalized && params.length > 1 && data.aggregate !== "average" && data.aggregate !== "median" && data.aggregate !== "min" && data.aggregate !== "max") {
          rows += `<div class="db-chart-tip-total">${tipRow("transparent", "Total", formatChartValue(sum, data.valueFormat))}</div>`;
        }
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
  const small = Math.min(size.width, size.height) < 260;
  const narrow = size.width < 420;
  const outer = labels && !small ? (narrow ? "52%" : "66%") : "78%";
  const centerY = showLegend ? 0.53 : 0.5;
  const option: Option = {
    legend: showLegend ? { ...legendOption(theme, "top") } : { show: false },
    tooltip: {
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
        radius: donut ? [`${parseFloat(outer) * 0.66}%`, outer] : [0, outer],
        center: ["50%", `${centerY * 100}%`],
        avoidLabelOverlap: true,
        padAngle: donut ? 1.2 : 0,
        minAngle: 1,
        startAngle: 90,
        itemStyle: { borderColor: theme.bg, borderWidth: donut ? 0 : 1.5, borderRadius: donut ? 3 : 2 },
        label: {
          show: labels && !small,
          color: theme.textSoft,
          fontSize: 11.5,
          fontFamily: theme.fontUi,
          overflow: "truncate",
          width: narrow ? Math.max(64, size.width * 0.24) : Math.max(60, Math.min(140, size.width * 0.18)),
          lineHeight: 14,
          // Narrow charts stack the share under the name so names keep their room.
          formatter: (p: Params) => `${p.name}${narrow ? "\n" : "  "}{pct|${pct(shareOf(values[p.dataIndex ?? 0] ?? null, values))}}`,
          rich: { pct: { color: theme.textMuted, fontSize: 11 } },
        },
        labelLine: { length: 8, length2: 10, smooth: 0.2, lineStyle: { color: theme.borderStrong } },
        labelLayout: { hideOverlap: true },
        emphasis: { scale: true, scaleSize: 5, label: { show: labels && !small } },
        data: categories.map((c, i) => ({ id: c.key, name: c.label, value: values[i] ?? 0, itemStyle: { color: colors[i] } })),
      },
    ],
  };
  if (donut) {
    const total = data.aggregate === "count" || data.aggregate === "sum" || data.aggregate === "countValues" ? values.reduce<number>((a, v) => a + (v ?? 0), 0) : data.total;
    const big = Math.max(16, Math.min(30, Math.min(size.width, size.height) * 0.09));
    option.graphic = [
      {
        id: "centre",
        type: "text",
        left: "center",
        top: size.height * centerY - big * 0.85,
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

function funnelOption(data: ChartData, theme: ChartTheme): Option {
  const { config, categories } = data;
  const values = data.series[0]?.values ?? [];
  const colors = colorsFor(categories, data, theme);
  const first = values[0] ?? 0;
  return {
    legend: config.legend ? legendOption(theme, "top") : { show: false },
    tooltip: {
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
        left: "8%",
        right: "8%",
        top: config.legend ? 36 : 8,
        bottom: 8,
        minSize: "6%",
        gap: 2,
        itemStyle: { borderWidth: 0, borderRadius: 3 },
        label: {
          show: config.labels ?? true,
          position: "inside",
          fontSize: 11.5,
          fontFamily: theme.fontUi,
          formatter: (p: Params) => `${p.name}  ${formatChartValue(values[p.dataIndex ?? 0] ?? null, data.valueFormat, true)}`,
        },
        emphasis: { label: { fontWeight: 600 } },
        data: categories.map((c, i) => ({
          id: c.key,
          name: c.label,
          value: values[i] ?? 0,
          itemStyle: { color: colors[i] },
          label: { color: textOn(colors[i], theme) },
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
  return {
    legend: showLegend ? legendOption(theme, "top") : { show: false },
    tooltip: {
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
      radius: size.width < 420 ? "58%" : "66%",
      center: ["50%", showLegend ? "55%" : "50%"],
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
        symbol: "circle",
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
  const rotate = categories.some((c) => approxTextWidth(c.label) > slot - 4) && categories.length <= 48 ? 35 : 0;
  return {
    tooltip: {
      trigger: "item",
      formatter: (p: Params) => {
        const [i, j, v] = p.value as [number, number, number | null];
        const title = rows.length > 1 ? `${categories[i]?.fullLabel} · ${rows[j]?.label}` : categories[i]?.fullLabel ?? "";
        return tip(title, tipRow(String(p.color ?? theme.accent), data.measureLabel, formatChartValue(v, data.valueFormat)));
      },
    },
    grid: { left: 2, right: 8, top: 8, bottom: 2, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
    xAxis: {
      type: "category",
      data: categories.map((c) => c.label),
      splitArea: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.textMuted, fontSize: 11, hideOverlap: true, rotate, overflow: "truncate", width: rotate ? 96 : Math.max(30, slot - 4) },
    },
    yAxis: {
      type: "category",
      data: rows.map((s) => s.label),
      inverse: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.textMuted, fontSize: 11, overflow: "truncate", width: 110 },
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

function scatterOption(data: ChartData, theme: ChartTheme): Option {
  const { config } = data;
  const colors = colorsFor(data.series, data, theme);
  const multi = data.series.length > 1;
  const showLegend = config.legend ?? multi;
  const showGrid = config.grid ?? true;
  const xFormat = data.xProperty?.format ?? "number";
  const dense = data.points.length > 400;
  const axisCommon = {
    axisLine: { show: true, lineStyle: { color: theme.borderStrong } },
    axisTick: { show: false },
    splitLine: { show: showGrid, lineStyle: { color: theme.border } },
  };
  return {
    legend: showLegend ? legendOption(theme, "top") : { show: false },
    grid: { left: 2, right: 14, top: showLegend ? 34 : 12, bottom: 2, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
    xAxis: data.pointsAreDates
      ? { type: "time", ...axisCommon, splitLine: { show: false }, axisLabel: { color: theme.textMuted, fontSize: 11, hideOverlap: true } }
      : { type: "value", scale: true, ...axisCommon, axisLabel: { color: theme.textMuted, fontSize: 11, hideOverlap: true, formatter: (v: number) => formatChartValue(v, xFormat, true) } },
    yAxis: {
      type: "value",
      scale: config.yMin === undefined,
      min: config.yMin,
      max: config.yMax,
      ...axisCommon,
      axisLine: { show: false },
      axisLabel: { color: theme.textMuted, fontSize: 11, formatter: (v: number) => formatChartValue(v, data.valueFormat, true) },
    },
    tooltip: {
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
      data: data.points.filter((p) => p.series === s.key).map((p) => ({ name: p.label, value: [p.x, p.y], rowId: p.rowId, series: i })),
      markLine:
        config.goal !== undefined && i === data.series.length - 1
          ? {
              silent: true,
              symbol: "none",
              lineStyle: { color: theme.textMuted, type: [4, 4], width: 1 },
              label: { formatter: `Goal ${formatChartValue(config.goal, data.valueFormat, true)}`, position: "insideEndTop", color: theme.textMuted, fontSize: 11 },
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
  else if (data.kind === "funnel") body = funnelOption(data, theme);
  else if (data.kind === "radar") body = radarOption(data, theme, size);
  else if (data.kind === "heatmap") body = data.calendar ? calendarOption(data, theme, size) : matrixOption(data, theme, size);
  else if (data.kind === "scatter") body = scatterOption(data, theme);
  else body = {};
  return { ...base, ...body, tooltip: { ...(base.tooltip as object), ...((body.tooltip as object) ?? {}) } };
}

/** Option components that differ between chart shapes; a change rebuilds the chart. */
function shapeOf(data: ChartData, size: ChartSize): string {
  const legend = data.config.legend ?? data.series.length > 1;
  return [data.kind, data.calendar, data.config.stacked, data.normalized, legend, data.config.goal !== undefined, Math.round(size.height / 40)].join("|");
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
export function mountChart(el: HTMLElement, onPick: (pick: ChartPick) => void): ChartHandle {
  const chart = echarts.init(el, null, { renderer: "svg", width: el.clientWidth || undefined, height: el.clientHeight || undefined });
  let current: { data: ChartData; theme: ChartTheme; size: ChartSize; shape: string } | null = null;
  let markClicked = false;

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
    if (!current) return;
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
    if (clicked || !current || !isCartesian(current.data.kind)) return;
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
      if (rebuild) chart.setOption(option, { notMerge: true, lazyUpdate: false });
      else chart.setOption(option, { replaceMerge: ["series", "graphic", "xAxis", "yAxis", "visualMap"] });
      current = { data, theme, size, shape };
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
      chart.setOption({ tooltip: { show: !on } });
    },
    dispose() {
      chart.dispose();
    },
  };
}
