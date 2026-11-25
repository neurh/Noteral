// Pure aggregation behind database chart views: rows + schema + chart
// settings → categories × series of numbers, plus the rows behind each cell.
// Nothing here knows about ECharts; chartEngine.ts turns this into options.

import {
  asValueProperty,
  cellText,
  cellValue,
  defaultChart,
  formatNumber,
  localDateOf,
  optionById,
  parseISODate,
  propertyById,
  toISODate,
  type ChartAggregate,
  type ChartConfig,
  type ChartKind,
  type DatabaseRow,
  type DatabaseSchema,
  type DatabaseView,
  type DateBucket,
  type NumberFormat,
  type OptionColor,
  type Property,
  type PropertyType,
} from "./database";

export const EMPTY_KEY = "__empty";
export const OTHER_KEY = "__other";
export const VALUE_SERIES = "__value";

/** Categories beyond this merge into "Other" (dates keep the latest ones). */
export const MAX_CATEGORIES = 200;
/** Series beyond this merge into "Other". */
export const MAX_SERIES = 12;
/** Slices beyond this merge into "Other" on pies and donuts. */
export const MAX_SLICES = 16;
/** Scatter plots draw at most this many points. */
export const MAX_POINTS = 5000;
/** Gaps between dates are only filled while the axis stays this short. */
const MAX_FILLED_BUCKETS = 400;

export type ChartIssue =
  /** No rows match the view. */
  | "noRows"
  /** The category property is unset or was deleted. */
  | "missingX"
  /** A numeric aggregate (sum, average…) without a numeric property. */
  | "needsNumber"
  /** "Count values"/"Count unique" without a property to count. */
  | "needsProperty"
  /** Scatter plots need numeric (or date) x and numeric y. */
  | "needsAxes";

export type AxisKind = "category" | "date" | "number" | "option" | "checkbox";

export interface ChartCategory {
  key: string;
  /** Short axis label. */
  label: string;
  /** Long label for tooltips and popovers ("Week of Mar 3, 2026"). */
  fullLabel: string;
  color?: OptionColor;
  /** The "No X" bucket of rows without a value. */
  empty?: boolean;
  other?: boolean;
  /** Start date (YYYY-MM-DD) of a date bucket. */
  date?: string;
}

export interface ChartSeries {
  key: string;
  label: string;
  color?: OptionColor;
  empty?: boolean;
  other?: boolean;
  /** One value per category; null where nothing could be measured. */
  values: (number | null)[];
}

export interface ChartPoint {
  rowId: string;
  label: string;
  x: number;
  y: number;
  series: string;
}

export interface ChartKpi {
  /** The measure over every row. */
  value: number | null;
  /** The measure in the current (or latest) date bucket, when x is a date. */
  current?: number | null;
  previous?: number | null;
  /** Relative change current vs previous (0.12 = +12%); undefined when previous is 0/empty. */
  change?: number;
  /** "This month" / "Mar 2026". */
  currentLabel?: string;
  /** "vs last month" / "vs Feb 2026". */
  compareLabel?: string;
  /** Recent bucket values, oldest first, for a sparkline. */
  trend?: number[];
}

export interface ChartData {
  kind: ChartKind;
  issue?: ChartIssue;
  config: ChartConfig;
  xProperty?: Property;
  yProperty?: Property;
  seriesProperty?: Property;
  xKind: AxisKind;
  /** Bucket used when x is a date. */
  bucket?: DateBucket;
  categories: ChartCategory[];
  series: ChartSeries[];
  /** Points of a scatter plot. */
  points: ChartPoint[];
  /** Scatter x axis holds timestamps (ms). */
  pointsAreDates: boolean;
  /** The measure over every row (deduplicated, so multi-select rows count once). */
  total: number | null;
  /** Number format for values; "percent" when stacked to 100%. */
  valueFormat: NumberFormat;
  /** Values are shares (0..1) of each category. */
  normalized: boolean;
  /** "Count", "Sum of Price". */
  measureLabel: string;
  aggregate: ChartAggregate;
  rowCount: number;
  /** Some categories, series or points were dropped to stay readable. */
  truncated: boolean;
  /** Calendar heatmap: x is a date bucketed by day. */
  calendar: boolean;
  kpi?: ChartKpi;
  /** Rows behind one category (and optionally one series), in row order. */
  rowsByCell(categoryKey: string, seriesKey?: string): string[];
}

const DATE_TYPES: PropertyType[] = ["date", "createdTime", "lastEdited"];
const NUMERIC_AGGREGATES: ChartAggregate[] = ["sum", "average", "median", "min", "max"];

export const CHART_AGGREGATES: { id: ChartAggregate; name: string; numeric: boolean }[] = [
  { id: "count", name: "Count rows", numeric: false },
  { id: "countValues", name: "Count values", numeric: false },
  { id: "countUnique", name: "Count unique", numeric: false },
  { id: "sum", name: "Sum", numeric: true },
  { id: "average", name: "Average", numeric: true },
  { id: "median", name: "Median", numeric: true },
  { id: "min", name: "Min", numeric: true },
  { id: "max", name: "Max", numeric: true },
];

export const DATE_BUCKETS: { id: DateBucket; name: string }[] = [
  { id: "day", name: "Day" },
  { id: "week", name: "Week" },
  { id: "month", name: "Month" },
  { id: "quarter", name: "Quarter" },
  { id: "year", name: "Year" },
];

/** Kinds drawn over a category axis (bars, lines, areas). */
export function isCartesian(kind: ChartKind): boolean {
  return kind === "bar" || kind === "column" || kind === "line" || kind === "area";
}

export function isNumericAggregate(aggregate: ChartAggregate | undefined): boolean {
  return !!aggregate && NUMERIC_AGGREGATES.includes(aggregate);
}

/** The chart settings of a view, falling back to a first chart that says something. */
export function chartConfigOf(view: DatabaseView, schema: DatabaseSchema): ChartConfig {
  return view.chart ?? defaultChart(schema);
}

/** A property by id, including the virtual "createdTime"/"lastEdited" ids used by default charts. */
export function chartProperty(schema: DatabaseSchema, id: string | undefined): Property | undefined {
  if (!id) return undefined;
  const found = propertyById(schema, id);
  if (found) return found;
  if (id === "createdTime") return { id, name: "Created time", type: "createdTime" };
  if (id === "lastEdited") return { id, name: "Last edited", type: "lastEdited" };
  return undefined;
}

export function isDateProperty(property: Property | undefined): boolean {
  return !!property && DATE_TYPES.includes(asValueProperty(property).type);
}

export function isNumberProperty(property: Property | undefined): boolean {
  return !!property && asValueProperty(property).type === "number";
}

/** Properties that can sit on the category axis or split series. */
export function groupableProperties(schema: DatabaseSchema): Property[] {
  const list: Property[] = [chartProperty(schema, "title")!, ...schema.properties];
  if (!schema.properties.some((p) => p.type === "createdTime")) list.push(chartProperty(schema, "createdTime")!);
  if (!schema.properties.some((p) => p.type === "lastEdited")) list.push(chartProperty(schema, "lastEdited")!);
  return list;
}

export function numericProperties(schema: DatabaseSchema): Property[] {
  return schema.properties.filter(isNumberProperty);
}

// ── Dates ──────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** The local YYYY-MM-DD day of a date cell, timestamp, or formula date. */
function dayOf(value: unknown): string {
  const raw = typeof value === "string" ? value : value && typeof value === "object" ? String((value as { start?: unknown }).start ?? "") : "";
  return raw ? localDateOf(raw) : "";
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Start (YYYY-MM-DD) of the bucket holding a day. Weeks are ISO weeks (Monday first). */
export function bucketStart(day: string, bucket: DateBucket): string {
  const date = parseISODate(day);
  if (!date) return "";
  switch (bucket) {
    case "day":
      return toISODate(date);
    case "week":
      return toISODate(addDays(date, -((date.getDay() + 6) % 7)));
    case "month":
      return toISODate(new Date(date.getFullYear(), date.getMonth(), 1));
    case "quarter":
      return toISODate(new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1));
    case "year":
      return toISODate(new Date(date.getFullYear(), 0, 1));
  }
}

/** Start of the bucket after (step 1) or before (step −1) one. */
export function shiftBucket(start: string, bucket: DateBucket, step = 1): string {
  const date = parseISODate(start)!;
  switch (bucket) {
    case "day":
      return toISODate(addDays(date, step));
    case "week":
      return toISODate(addDays(date, 7 * step));
    case "month":
      return toISODate(new Date(date.getFullYear(), date.getMonth() + step, 1));
    case "quarter":
      return toISODate(new Date(date.getFullYear(), date.getMonth() + 3 * step, 1));
    case "year":
      return toISODate(new Date(date.getFullYear() + step, 0, 1));
  }
}

/** ISO 8601 week number of a day. */
export function isoWeek(day: string): number {
  const date = parseISODate(day)!;
  const thursday = addDays(date, 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  return 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
}

/** A bucket that keeps a date axis between ~8 and ~60 points. */
export function autoBucket(first: string, last: string): DateBucket {
  const a = parseISODate(first);
  const b = parseISODate(last);
  if (!a || !b) return "month";
  const days = Math.abs(b.getTime() - a.getTime()) / DAY_MS;
  if (days <= 45) return "day";
  if (days <= 200) return "week";
  if (days <= 365 * 4) return "month";
  return "year";
}

function bucketLabels(start: string, bucket: DateBucket, multiYear: boolean): { label: string; fullLabel: string } {
  const date = parseISODate(start)!;
  const year = date.getFullYear();
  const short = (opts: Intl.DateTimeFormatOptions) => date.toLocaleDateString(undefined, opts);
  // "Dec 1 ’25" reads better on an axis than the locale's "Dec 1, 25".
  const withYear = (text: string) => (multiYear ? `${text} ’${String(year).slice(2)}` : text);
  switch (bucket) {
    case "day":
      return {
        label: withYear(short({ month: "short", day: "numeric" })),
        fullLabel: short({ weekday: "short", month: "short", day: "numeric", year: "numeric" }),
      };
    case "week":
      return {
        label: withYear(short({ month: "short", day: "numeric" })),
        fullLabel: `Week ${isoWeek(start)} · ${short({ month: "short", day: "numeric", year: "numeric" })}`,
      };
    case "month":
      return { label: short({ month: "short", ...(multiYear ? { year: "2-digit" } : {}) }), fullLabel: short({ month: "long", year: "numeric" }) };
    case "quarter": {
      const q = Math.floor(date.getMonth() / 3) + 1;
      return { label: multiYear ? `Q${q} ’${String(year).slice(2)}` : `Q${q}`, fullLabel: `Q${q} ${year}` };
    }
    case "year":
      return { label: String(year), fullLabel: String(year) };
  }
}

const BUCKET_NOUN: Record<DateBucket, string> = { day: "day", week: "week", month: "month", quarter: "quarter", year: "year" };

// ── Numbers ────────────────────────────────────────────────────────────────

/** A round step (1, 2, 2.5, 5 × 10ⁿ) that splits a range into about `parts` bins. */
export function niceStep(range: number, parts: number): number {
  if (!(range > 0)) return 1;
  const raw = range / parts;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10;
  return nice * power;
}

/** Short number for axes and labels: 1.2k, 3.4M, 0.25. */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  const trim = (n: number, digits: number) => n.toFixed(digits).replace(/\.0+$|(\.\d*?)0+$/, "$1");
  if (abs >= 1e12) return `${trim(value / 1e12, 1)}T`;
  if (abs >= 1e9) return `${trim(value / 1e9, 1)}B`;
  if (abs >= 1e6) return `${trim(value / 1e6, 1)}M`;
  if (abs >= 1e4) return `${trim(value / 1e3, abs >= 1e5 ? 0 : 1)}k`;
  if (abs >= 1e3) return `${trim(value / 1e3, 1)}k`;
  if (abs === 0) return "0";
  if (abs < 0.01) return value.toExponential(0);
  return trim(value, abs < 1 ? 2 : abs < 10 ? 1 : 0);
}

const CURRENCY: Partial<Record<NumberFormat, string>> = { dollar: "$", euro: "€", pound: "£", yen: "¥" };

/** A value in the chart's number format, short (axes, labels) or full (tooltips). */
export function formatChartValue(value: number | null | undefined, format: NumberFormat, compact = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  if (format === "percent") {
    const pct = value * 100;
    return `${compact ? compactNumber(pct) : pct.toLocaleString(undefined, { maximumFractionDigits: Math.abs(pct) < 10 ? 1 : 0 })}%`;
  }
  if (compact) {
    const symbol = CURRENCY[format];
    const text = compactNumber(Math.abs(value));
    return `${value < 0 ? "−" : ""}${symbol ?? ""}${text}`;
  }
  if (format === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const symbol = CURRENCY[format];
  // Whole currency amounts read better without ".00" in chart labels and totals.
  if (symbol && Number.isInteger(value)) return `${value < 0 ? "−" : ""}${symbol}${Math.abs(value).toLocaleString()}`;
  return formatNumber(value, format);
}

// ── Values ─────────────────────────────────────────────────────────────────

interface Dim {
  key: string;
  label: string;
  fullLabel?: string;
  color?: OptionColor;
  /** Sort key: option index, number, date, or label. */
  order: number | string;
}

/** The raw number of a numeric cell (formulas included). */
function numberOf(row: DatabaseRow, property: Property): number | undefined {
  const value = cellValue(row, property);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

/** Tokens a "count values"/"count unique" aggregate sees in a cell. */
function tokensOf(row: DatabaseRow, property: Property): string[] {
  const value = cellValue(row, property);
  if (property.type === "multiSelect") return (Array.isArray(value) ? value : []).filter((id) => optionById(property, id)).map(String);
  if (property.type === "checkbox") return value ? ["true"] : [];
  if (property.type === "select" || property.type === "status") return optionById(property, value) ? [String(value)] : [];
  if (DATE_TYPES.includes(property.type)) {
    const day = dayOf(value);
    return day ? [day] : [];
  }
  if (property.type === "number") {
    const n = numberOf(row, property);
    return n === undefined ? [] : [String(n)];
  }
  const text = cellText(row, property).trim();
  return text ? [text.toLowerCase()] : [];
}

function aggregate(values: number[], tokens: string[][], kind: ChartAggregate, rows: number): number | null {
  switch (kind) {
    case "count":
      return rows;
    case "countValues":
      return tokens.reduce((n, list) => n + list.length, 0);
    case "countUnique":
      return new Set(tokens.flat()).size;
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "average":
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    case "median": {
      if (!values.length) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    case "min":
      return values.length ? Math.min(...values) : null;
    case "max":
      return values.length ? Math.max(...values) : null;
  }
}

function measureLabelOf(kind: ChartAggregate, y: Property | undefined): string {
  const name = y?.name || "value";
  switch (kind) {
    case "count":
      return "Count";
    case "countValues":
      return `Count of ${name}`;
    case "countUnique":
      return `Unique ${name}`;
    case "sum":
      return `Sum of ${name}`;
    case "average":
      return `Average ${name}`;
    case "median":
      return `Median ${name}`;
    case "min":
      return `Min ${name}`;
    case "max":
      return `Max ${name}`;
  }
}

/** Splits rows along one property: the keys each row falls under. */
interface Dimension {
  kind: AxisKind;
  bucket?: DateBucket;
  /** Keys for one row (several for multi-select; EMPTY_KEY when blank). */
  keysOf(row: DatabaseRow): string[];
  /** Known keys in their natural order with labels. */
  dims: Map<string, Dim>;
  emptyLabel: string;
  multiYear: boolean;
}

function buildDimension(rows: DatabaseRow[], input: Property, options: { bucket?: DateBucket; bin?: number }): Dimension {
  const property = asValueProperty(input);
  const dims = new Map<string, Dim>();
  const emptyLabel = `No ${input.name || "value"}`;
  const type = property.type;

  if (type === "select" || type === "status" || type === "multiSelect") {
    (property.options ?? []).forEach((option, index) => dims.set(option.id, { key: option.id, label: option.name || "Untitled", color: option.color, order: index }));
    return {
      kind: "option",
      dims,
      emptyLabel,
      multiYear: false,
      keysOf(row) {
        const value = cellValue(row, property);
        const ids = type === "multiSelect" ? (Array.isArray(value) ? value : []) : [value];
        const keys = [...new Set(ids.filter((id): id is string => typeof id === "string" && dims.has(id)))];
        return keys.length ? keys : [EMPTY_KEY];
      },
    };
  }

  if (type === "checkbox") {
    dims.set("true", { key: "true", label: "Checked", color: "green", order: 0 });
    dims.set("false", { key: "false", label: "Unchecked", color: "default", order: 1 });
    return { kind: "checkbox", dims, emptyLabel, multiYear: false, keysOf: (row) => [cellValue(row, property) ? "true" : "false"] };
  }

  if (DATE_TYPES.includes(type)) {
    const days = new Map<string, string>();
    let first = "";
    let last = "";
    for (const row of rows) {
      const day = dayOf(cellValue(row, property));
      days.set(row.id, day);
      if (!day) continue;
      if (!first || day < first) first = day;
      if (!last || day > last) last = day;
    }
    const bucket = options.bucket ?? autoBucket(first, last);
    const multiYear = !!first && first.slice(0, 4) !== last.slice(0, 4);
    return {
      kind: "date",
      bucket,
      dims,
      emptyLabel,
      multiYear,
      keysOf(row) {
        const day = days.get(row.id) ?? dayOf(cellValue(row, property));
        if (!day) return [EMPTY_KEY];
        const start = bucketStart(day, bucket);
        if (!dims.has(start)) dims.set(start, { key: start, ...bucketLabels(start, bucket, multiYear), order: start });
        return [start];
      },
    };
  }

  if (type === "number") {
    const format = input.format ?? property.format;
    const numbers = new Map<string, number>();
    for (const row of rows) {
      const n = numberOf(row, property);
      if (n !== undefined) numbers.set(row.id, n);
    }
    const distinct = new Set(numbers.values());
    const bin = options.bin ?? 24;
    if (distinct.size > bin) {
      const values = [...distinct];
      const min = Math.min(...values);
      const max = Math.max(...values);
      const step = niceStep(max - min, 12);
      const origin = Math.floor(min / step) * step;
      const round = (n: number) => Number(n.toPrecision(12));
      for (let start = origin; start <= max; start = round(start + step)) {
        const key = String(round(start));
        const end = round(start + step);
        dims.set(key, { key, label: `${compactNumber(start)}–${compactNumber(end)}`, order: start });
      }
      return {
        kind: "number",
        dims,
        emptyLabel,
        multiYear: false,
        keysOf(row) {
          const n = numbers.get(row.id);
          if (n === undefined) return [EMPTY_KEY];
          return [String(round(origin + Math.floor(round((n - origin) / step)) * step))];
        },
      };
    }
    for (const n of [...distinct].sort((a, b) => a - b)) dims.set(String(n), { key: String(n), label: formatNumber(n, format) || String(n), order: n });
    return {
      kind: "number",
      dims,
      emptyLabel,
      multiYear: false,
      keysOf(row) {
        const n = numbers.get(row.id);
        return [n === undefined ? EMPTY_KEY : String(n)];
      },
    };
  }

  return {
    kind: "category",
    dims,
    emptyLabel,
    multiYear: false,
    keysOf(row) {
      const label = cellText(row, input).trim();
      if (!label) return [EMPTY_KEY];
      const key = label.toLowerCase();
      if (!dims.has(key)) dims.set(key, { key, label, order: label });
      return [key];
    },
  };
}

// ── Building ───────────────────────────────────────────────────────────────

interface RowMeasure {
  num?: number;
  tokens: string[];
}

type Cell = Set<string>;

function emptyResult(config: ChartConfig, kind: ChartKind, extra: Partial<ChartData>): ChartData {
  return {
    kind,
    config,
    xKind: "category",
    categories: [],
    series: [],
    points: [],
    pointsAreDates: false,
    total: null,
    valueFormat: "number",
    normalized: false,
    measureLabel: "Count",
    aggregate: config.aggregate ?? "count",
    rowCount: 0,
    truncated: false,
    calendar: false,
    rowsByCell: () => [],
    ...extra,
  };
}

export interface BuildOptions {
  /** "Today" for the KPI's current period (tests). */
  now?: Date;
}

/** Aggregates rows into categories × series for a chart. */
export function buildChartData(rows: DatabaseRow[], schema: DatabaseSchema, input: ChartConfig, options: BuildOptions = {}): ChartData {
  const config = input;
  const kind: ChartKind = config.kind ?? "column";
  const agg: ChartAggregate = config.aggregate ?? "count";
  const xProperty = chartProperty(schema, config.x);
  const yProperty = chartProperty(schema, config.y);
  const seriesProperty = kind === "pie" || kind === "donut" || kind === "funnel" || kind === "number" ? undefined : chartProperty(schema, config.series);
  const numericAgg = isNumericAggregate(agg);
  const measureLabel = measureLabelOf(agg, yProperty);
  const valueFormat: NumberFormat = numericAgg ? config.format ?? yProperty?.format ?? "number" : config.format && config.format !== "percent" ? config.format : "number";
  const base = { xProperty, yProperty, seriesProperty, measureLabel, aggregate: agg, valueFormat, rowCount: rows.length };

  // Misconfiguration first: it is fixable even before rows exist.
  if (kind === "scatter") {
    const xOk = isNumberProperty(xProperty) || isDateProperty(xProperty);
    if (!xOk || !isNumberProperty(yProperty)) return emptyResult(config, kind, { ...base, issue: "needsAxes" });
  } else {
    if (kind !== "number" && !xProperty) return emptyResult(config, kind, { ...base, issue: "missingX" });
    if (numericAgg && !isNumberProperty(yProperty)) return emptyResult(config, kind, { ...base, issue: "needsNumber" });
    if ((agg === "countValues" || agg === "countUnique") && !yProperty) return emptyResult(config, kind, { ...base, issue: "needsProperty" });
  }
  if (!rows.length) return emptyResult(config, kind, { ...base, issue: "noRows" });

  if (kind === "scatter") return buildScatter(rows, config, base, xProperty!, yProperty!, seriesProperty);

  // Per-row measure inputs, computed once.
  const measures = new Map<string, RowMeasure>();
  const yValue = yProperty ? asValueProperty(yProperty) : undefined;
  for (const row of rows) {
    measures.set(row.id, {
      num: yValue && numericAgg ? numberOf(row, yValue) : undefined,
      tokens: yValue && (agg === "countValues" || agg === "countUnique") ? tokensOf(row, yValue) : [],
    });
  }
  const measure = (ids: Iterable<string>): number | null => {
    const values: number[] = [];
    const tokens: string[][] = [];
    let n = 0;
    for (const id of ids) {
      n++;
      const m = measures.get(id)!;
      if (m.num !== undefined) values.push(m.num);
      tokens.push(m.tokens);
    }
    return aggregate(values, tokens, agg, n);
  };
  const total = measure(rows.map((row) => row.id));

  if (kind === "number") return { ...emptyResult(config, kind, base), total, kpi: buildKpi(rows, config, xProperty, measure, total, options.now ?? new Date()) };

  const calendar = kind === "heatmap" && isDateProperty(xProperty);
  const xDim = buildDimension(rows, xProperty!, { bucket: calendar ? "day" : config.dateBucket });
  const sDim = seriesProperty ? buildDimension(rows, seriesProperty, { bin: 12 }) : undefined;

  // cells[category][series] = row ids
  const cells = new Map<string, Map<string, Cell>>();
  const seriesRows = new Map<string, Set<string>>();
  const categoryRows = new Map<string, Set<string>>();
  for (const row of rows) {
    const cats = xDim.keysOf(row);
    const sers = sDim ? sDim.keysOf(row) : [VALUE_SERIES];
    for (const cat of cats) {
      let byCat = cells.get(cat);
      if (!byCat) cells.set(cat, (byCat = new Map()));
      for (const ser of sers) {
        let cell = byCat.get(ser);
        if (!cell) byCat.set(ser, (cell = new Set()));
        cell.add(row.id);
        let sr = seriesRows.get(ser);
        if (!sr) seriesRows.set(ser, (sr = new Set()));
        sr.add(row.id);
      }
      let cr = categoryRows.get(cat);
      if (!cr) categoryRows.set(cat, (cr = new Set()));
      cr.add(row.id);
    }
  }

  const isDate = xDim.kind === "date";
  const pieLike = kind === "pie" || kind === "donut" || kind === "funnel";
  const fillGaps = isDate && !calendar && isCartesian(kind);

  // Category list in natural order.
  let catKeys: string[];
  if (isDate) {
    const present = [...cells.keys()].filter((key) => key !== EMPTY_KEY).sort();
    catKeys = present;
    if (fillGaps && present.length > 1) {
      const filled: string[] = [];
      for (let key = present[0]; key <= present[present.length - 1] && filled.length <= MAX_FILLED_BUCKETS; key = shiftBucket(key, xDim.bucket!)) filled.push(key);
      if (filled.length <= MAX_FILLED_BUCKETS) {
        for (const key of filled) if (!xDim.dims.has(key)) xDim.dims.set(key, { key, ...bucketLabels(key, xDim.bucket!, xDim.multiYear), order: key });
        catKeys = filled;
      }
    }
  } else {
    // Options show every option (empty ones as zero); numbers keep empty bins.
    catKeys = [...xDim.dims.values()]
      .sort((a, b) => (typeof a.order === "number" && typeof b.order === "number" ? a.order - b.order : String(a.order).localeCompare(String(b.order), undefined, { numeric: true, sensitivity: "base" })))
      .map((dim) => dim.key);
  }
  // Blank values: shown as "No X" for option-like axes and part-to-whole charts; dates drop them.
  const showEmpty = cells.has(EMPTY_KEY) && (!isDate || pieLike);
  if (showEmpty) catKeys.push(EMPTY_KEY);

  // Series list: option order, else biggest first; cap with "Other".
  let serKeys: string[] = [VALUE_SERIES];
  let truncated = false;
  if (sDim) {
    const natural = [...sDim.dims.values()]
      .filter((dim) => seriesRows.has(dim.key))
      .sort((a, b) => (typeof a.order === "number" && typeof b.order === "number" ? a.order - b.order : String(a.order).localeCompare(String(b.order), undefined, { numeric: true })))
      .map((dim) => dim.key);
    if (seriesRows.has(EMPTY_KEY)) natural.push(EMPTY_KEY);
    if (sDim.kind === "category" || sDim.kind === "number") natural.sort((a, b) => (seriesRows.get(b)?.size ?? 0) - (seriesRows.get(a)?.size ?? 0) || (a === EMPTY_KEY ? 1 : b === EMPTY_KEY ? -1 : 0));
    serKeys = natural;
    if (serKeys.length > MAX_SERIES) {
      const bySize = [...serKeys].sort((a, b) => (seriesRows.get(b)?.size ?? 0) - (seriesRows.get(a)?.size ?? 0));
      const keep = new Set(bySize.slice(0, MAX_SERIES - 1));
      const merged = serKeys.filter((key) => !keep.has(key));
      for (const byCat of cells.values()) {
        const other = new Set<string>();
        for (const key of merged) for (const id of byCat.get(key) ?? []) other.add(id);
        for (const key of merged) byCat.delete(key);
        if (other.size) byCat.set(OTHER_KEY, other);
      }
      serKeys = [...serKeys.filter((key) => keep.has(key)), OTHER_KEY];
      truncated = true;
    }
  }

  const cellRows = (cat: string, ser?: string): Set<string> => {
    if (ser) return cells.get(cat)?.get(ser) ?? new Set();
    return categoryRows.get(cat) ?? new Set();
  };
  const valueOf = (cat: string, ser: string): number | null => {
    const ids = cells.get(cat)?.get(ser);
    if (!ids || !ids.size) return agg === "count" || agg === "countValues" || agg === "countUnique" || agg === "sum" ? 0 : null;
    return measure(ids);
  };
  /** Category size used for value sorts and limits: the measure over its rows. */
  const categoryValue = (cat: string): number => {
    if (serKeys.length === 1) return valueOf(cat, serKeys[0]) ?? 0;
    return serKeys.reduce((sum, ser) => sum + (valueOf(cat, ser) ?? 0), 0);
  };

  // Sort.
  const sort = config.sort ?? "default";
  const labelOf = (key: string) => (key === EMPTY_KEY ? xDim.emptyLabel : xDim.dims.get(key)?.label ?? key);
  const textDefault = xDim.kind === "category" && sort === "default";
  const funnelDefault = kind === "funnel" && sort === "default";
  if (sort !== "default" || textDefault || funnelDefault) {
    const values = new Map(catKeys.map((key) => [key, categoryValue(key)]));
    const regular = catKeys.filter((key) => key !== EMPTY_KEY);
    const compareLabel = (a: string, b: string) =>
      isDate || xDim.kind === "number" ? (xDim.dims.get(a)!.order < xDim.dims.get(b)!.order ? -1 : 1) : labelOf(a).localeCompare(labelOf(b), undefined, { numeric: true, sensitivity: "base" });
    if (sort === "label") regular.sort(compareLabel);
    else if (sort === "labelDesc") regular.sort((a, b) => compareLabel(b, a));
    else if (sort === "value") regular.sort((a, b) => values.get(a)! - values.get(b)! || compareLabel(a, b));
    else regular.sort((a, b) => values.get(b)! - values.get(a)! || compareLabel(a, b));
    catKeys = catKeys.includes(EMPTY_KEY) ? [...regular, EMPTY_KEY] : regular;
  }

  // Limit: top N (+ "Other"); date axes keep the latest N buckets instead.
  const ceiling = kind === "pie" || kind === "donut" ? MAX_SLICES : calendar ? 366 : MAX_CATEGORIES;
  const cap = Math.min(config.limit && config.limit > 0 && !calendar ? Math.floor(config.limit) : Infinity, ceiling);
  if (catKeys.length > cap) {
    if (isDate && sort === "default") {
      const chronological = catKeys.filter((key) => key !== EMPTY_KEY);
      const keep = chronological.slice(-cap);
      catKeys = catKeys.includes(EMPTY_KEY) && pieLike ? [...keep, EMPTY_KEY] : keep;
    } else {
      const keep = catKeys.slice(0, Math.max(1, cap - 1));
      const rest = catKeys.slice(keep.length);
      const merged = new Map<string, Set<string>>();
      const all = new Set<string>();
      for (const cat of rest) {
        for (const [ser, ids] of cells.get(cat) ?? []) {
          let target = merged.get(ser);
          if (!target) merged.set(ser, (target = new Set()));
          for (const id of ids) {
            target.add(id);
            all.add(id);
          }
        }
      }
      cells.set(OTHER_KEY, merged);
      categoryRows.set(OTHER_KEY, all);
      catKeys = [...keep, OTHER_KEY];
    }
    truncated = true;
  }

  // Omit empty: drop zero/blank categories and the "No X" bucket.
  if (config.omitEmpty) {
    catKeys = catKeys.filter((key) => key !== EMPTY_KEY && serKeys.some((ser) => (valueOf(key, ser) ?? 0) !== 0));
  } else if (!isDate) {
    // A "No X" bucket with nothing in it is noise.
    catKeys = catKeys.filter((key) => key !== EMPTY_KEY || cellRows(key).size > 0);
  }

  const categories: ChartCategory[] = catKeys.map((key) => {
    if (key === EMPTY_KEY) return { key, label: xDim.emptyLabel, fullLabel: xDim.emptyLabel, empty: true };
    if (key === OTHER_KEY) return { key, label: "Other", fullLabel: "Other", other: true };
    const dim = xDim.dims.get(key)!;
    return { key, label: dim.label, fullLabel: dim.fullLabel ?? dim.label, color: dim.color, ...(isDate ? { date: key } : {}) };
  });

  let series: ChartSeries[] = serKeys.map((key) => {
    const values = catKeys.map((cat) => valueOf(cat, key));
    if (key === VALUE_SERIES) return { key, label: measureLabel, values };
    if (key === EMPTY_KEY) return { key, label: sDim!.emptyLabel, empty: true, values };
    if (key === OTHER_KEY) return { key, label: "Other", other: true, values };
    const dim = sDim!.dims.get(key)!;
    return { key, label: dim.label, color: dim.color, values };
  });

  // Cumulative running totals (blank cells carry the running total).
  if (config.cumulative && isCartesian(kind)) {
    series = series.map((s) => {
      let run = 0;
      return { ...s, values: s.values.map((v) => (run += v ?? 0)) };
    });
  }

  // 100%: each category's series share; a single series shows its share of the whole.
  const normalized = !!config.normalize && (isCartesian(kind) || kind === "radar" || kind === "heatmap");
  if (normalized) {
    if (series.length === 1) {
      const sum = series[0].values.reduce<number>((a, v) => a + Math.abs(v ?? 0), 0);
      series = [{ ...series[0], values: series[0].values.map((v) => (v === null ? null : sum ? v / sum : 0)) }];
    } else {
      const sums = catKeys.map((_, i) => series.reduce((a, s) => a + Math.abs(s.values[i] ?? 0), 0));
      series = series.map((s) => ({ ...s, values: s.values.map((v, i) => (v === null ? null : sums[i] ? v / sums[i] : 0)) }));
    }
  }

  const rowOrder = new Map(rows.map((row, index) => [row.id, index]));
  return {
    ...base,
    kind,
    config,
    xKind: xDim.kind,
    bucket: xDim.bucket,
    categories,
    series,
    points: [],
    pointsAreDates: false,
    total,
    valueFormat: normalized ? "percent" : valueFormat,
    normalized,
    truncated,
    calendar,
    rowsByCell(cat, ser) {
      const ids = ser !== undefined && ser !== VALUE_SERIES ? cellRows(cat, ser) : cellRows(cat);
      return [...ids].sort((a, b) => (rowOrder.get(a) ?? 0) - (rowOrder.get(b) ?? 0));
    },
  };
}

function buildScatter(
  rows: DatabaseRow[],
  config: ChartConfig,
  base: Partial<ChartData>,
  xProperty: Property,
  yProperty: Property,
  seriesProperty: Property | undefined,
): ChartData {
  const xValue = asValueProperty(xProperty);
  const yValue = asValueProperty(yProperty);
  const dates = isDateProperty(xProperty);
  const sDim = seriesProperty ? buildDimension(rows, seriesProperty, { bin: 12 }) : undefined;
  const points: ChartPoint[] = [];
  const seriesKeys = new Map<string, number>();
  let truncated = false;
  for (const row of rows) {
    const y = numberOf(row, yValue);
    if (y === undefined) continue;
    let x: number | undefined;
    if (dates) {
      const day = dayOf(cellValue(row, xValue));
      x = day ? parseISODate(day)?.getTime() : undefined;
    } else x = numberOf(row, xValue);
    if (x === undefined) continue;
    if (points.length >= MAX_POINTS) {
      truncated = true;
      break;
    }
    const ser = sDim ? sDim.keysOf(row)[0] : VALUE_SERIES;
    seriesKeys.set(ser, (seriesKeys.get(ser) ?? 0) + 1);
    points.push({ rowId: row.id, label: row.meta.title || "Untitled", x, y, series: ser });
  }
  let keys = [...seriesKeys.keys()];
  if (sDim) {
    const order = (key: string) => (key === EMPTY_KEY ? Infinity : sDim.dims.get(key)?.order ?? key);
    keys.sort((a, b) => {
      const oa = order(a);
      const ob = order(b);
      return typeof oa === "number" && typeof ob === "number" ? oa - ob : String(oa).localeCompare(String(ob));
    });
    if (keys.length > MAX_SERIES) {
      const keep = new Set([...keys].sort((a, b) => seriesKeys.get(b)! - seriesKeys.get(a)!).slice(0, MAX_SERIES - 1));
      for (const point of points) if (!keep.has(point.series)) point.series = OTHER_KEY;
      keys = [...keys.filter((key) => keep.has(key)), OTHER_KEY];
      truncated = true;
    }
  }
  const series: ChartSeries[] = keys.map((key) => {
    if (key === VALUE_SERIES) return { key, label: yProperty.name, values: [] };
    if (key === EMPTY_KEY) return { key, label: sDim!.emptyLabel, empty: true, values: [] };
    if (key === OTHER_KEY) return { key, label: "Other", other: true, values: [] };
    const dim = sDim!.dims.get(key)!;
    return { key, label: dim.label, color: dim.color, values: [] };
  });
  const format = config.format ?? yValue.format ?? yProperty.format ?? "number";
  return {
    ...emptyResult(config, "scatter", base),
    xKind: dates ? "date" : "number",
    series,
    points,
    pointsAreDates: dates,
    total: points.length,
    valueFormat: format,
    truncated,
    rowsByCell: () => [],
  };
}

function buildKpi(
  rows: DatabaseRow[],
  config: ChartConfig,
  xProperty: Property | undefined,
  measure: (ids: Iterable<string>) => number | null,
  total: number | null,
  now: Date,
): ChartKpi {
  if (!isDateProperty(xProperty)) return { value: total };
  const bucket = config.dateBucket ?? "month";
  const property = asValueProperty(xProperty!);
  const byBucket = new Map<string, string[]>();
  for (const row of rows) {
    const day = dayOf(cellValue(row, property));
    if (!day) continue;
    const key = bucketStart(day, bucket);
    const list = byBucket.get(key);
    if (list) list.push(row.id);
    else byBucket.set(key, [row.id]);
  }
  if (!byBucket.size) return { value: total };
  const today = bucketStart(toISODate(now), bucket);
  const before = shiftBucket(today, bucket, -1);
  const live = byBucket.has(today) || byBucket.has(before);
  const latest = [...byBucket.keys()].sort().pop()!;
  const current = live ? today : latest;
  const previous = shiftBucket(current, bucket, -1);
  const valueAt = (key: string) => {
    const ids = byBucket.get(key);
    return ids ? measure(ids) : config.aggregate && isNumericAggregate(config.aggregate) && config.aggregate !== "sum" ? null : 0;
  };
  const cur = valueAt(current);
  const prev = valueAt(previous);
  const change = cur !== null && prev !== null && prev !== 0 ? (cur - prev) / Math.abs(prev) : undefined;
  const noun = BUCKET_NOUN[bucket];
  const trend: number[] = [];
  for (let i = 11, key = shiftBucket(current, bucket, -11); i >= 0; i--, key = shiftBucket(key, bucket, 1)) trend.push(valueAt(key) ?? 0);
  const labels = (key: string) => bucketLabels(key, bucket, true).fullLabel;
  return {
    value: total,
    current: cur,
    previous: prev,
    change,
    currentLabel: live ? (bucket === "day" ? "Today" : `This ${noun}`) : labels(current),
    compareLabel: live ? (bucket === "day" ? "vs yesterday" : `vs last ${noun}`) : `vs ${labels(previous)}`,
    trend,
  };
}

/** Share of a value in the sum of all values (pies, funnels). */
export function shareOf(value: number | null, values: (number | null)[]): number {
  const sum = values.reduce<number>((a, v) => a + Math.abs(v ?? 0), 0);
  return sum && value !== null ? Math.abs(value) / sum : 0;
}
