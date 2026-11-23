/**
 * Noteral databases.
 *
 * A database is a page of kind "database" whose `data` holds this schema. Its
 * rows are its child pages; each row's `data` holds `{ values }` keyed by
 * property id. The row title is the built-in "title" property, and created /
 * last-edited times come from the row's page metadata.
 */
import type { PageMeta } from "./api";

export const TITLE_ID = "title";

export type PropertyType =
  | "text"
  | "number"
  | "select"
  | "multiSelect"
  | "status"
  | "date"
  | "checkbox"
  | "url"
  | "email"
  | "phone"
  | "createdTime"
  | "lastEdited";

export type OptionColor = "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";
export const OPTION_COLORS: OptionColor[] = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

export type StatusGroup = "todo" | "inProgress" | "complete";
export const STATUS_GROUPS: { id: StatusGroup; name: string }[] = [
  { id: "todo", name: "To-do" },
  { id: "inProgress", name: "In progress" },
  { id: "complete", name: "Complete" },
];

export interface SelectOption {
  id: string;
  name: string;
  color: OptionColor;
  group?: StatusGroup;
}

export type NumberFormat = "number" | "commas" | "percent" | "dollar" | "euro" | "pound" | "yen";
export const NUMBER_FORMATS: { id: NumberFormat; name: string }[] = [
  { id: "number", name: "Number" },
  { id: "commas", name: "Number with commas" },
  { id: "percent", name: "Percent" },
  { id: "dollar", name: "US dollar" },
  { id: "euro", name: "Euro" },
  { id: "pound", name: "Pound" },
  { id: "yen", name: "Yen" },
];

export interface Property {
  id: string;
  name: string;
  type: PropertyType;
  options?: SelectOption[];
  format?: NumberFormat;
}

export type ViewType = "table" | "board" | "gallery" | "list" | "calendar";

export type FilterOp =
  | "contains"
  | "notContains"
  | "is"
  | "isNot"
  | "startsWith"
  | "endsWith"
  | "isEmpty"
  | "isNotEmpty"
  | "eq"
  | "neq"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "before"
  | "after"
  | "onOrBefore"
  | "onOrAfter";

export interface FilterRule {
  id: string;
  propertyId: string;
  op: FilterOp;
  value?: unknown;
}

export interface SortRule {
  propertyId: string;
  direction: "asc" | "desc";
}

export interface DatabaseView {
  id: string;
  name: string;
  type: ViewType;
  filters: FilterRule[];
  /** "and": every rule must match; "or": any rule. */
  filterMode?: "and" | "or";
  sorts: SortRule[];
  /** Property ids that are not shown in this view. */
  hidden: string[];
  /** Display order of property ids (title included). Missing ids follow. */
  order: string[];
  widths: Record<string, number>;
  groupBy?: string;
  /** Board groups hidden in this view. */
  hiddenGroups?: string[];
  dateProperty?: string;
  cardPreview?: "cover" | "none";
  wrap?: boolean;
  /** Table footer calculations per property id. */
  calcs?: Record<string, CalcKind>;
}

export type CalcKind =
  | "none"
  | "countAll"
  | "countValues"
  | "countUnique"
  | "countEmpty"
  | "countNotEmpty"
  | "percentEmpty"
  | "percentNotEmpty"
  | "checked"
  | "unchecked"
  | "percentChecked"
  | "sum"
  | "average"
  | "median"
  | "min"
  | "max"
  | "range"
  | "earliest"
  | "latest";

export interface DatabaseSchema {
  version: 1;
  titleName: string;
  properties: Property[];
  views: DatabaseView[];
}

export interface DateValue {
  start: string;
  end?: string;
}

export type RowValues = Record<string, unknown>;

export interface DatabaseRow {
  id: string;
  meta: PageMeta;
  values: RowValues;
}

export const PROPERTY_TYPES: { type: PropertyType; name: string }[] = [
  { type: "text", name: "Text" },
  { type: "number", name: "Number" },
  { type: "select", name: "Select" },
  { type: "multiSelect", name: "Multi-select" },
  { type: "status", name: "Status" },
  { type: "date", name: "Date" },
  { type: "checkbox", name: "Checkbox" },
  { type: "url", name: "URL" },
  { type: "email", name: "Email" },
  { type: "phone", name: "Phone" },
  { type: "createdTime", name: "Created time" },
  { type: "lastEdited", name: "Last edited time" },
];

export const VIEW_TYPES: { type: ViewType; name: string }[] = [
  { type: "table", name: "Table" },
  { type: "board", name: "Board" },
  { type: "gallery", name: "Gallery" },
  { type: "list", name: "List" },
  { type: "calendar", name: "Calendar" },
];

export function typeName(type: PropertyType): string {
  return PROPERTY_TYPES.find((item) => item.type === type)?.name ?? type;
}

export function uid(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36).slice(-4)}${random}`;
}

export function isComputed(type: PropertyType): boolean {
  return type === "createdTime" || type === "lastEdited";
}

export function hasOptions(type: PropertyType): boolean {
  return type === "select" || type === "multiSelect" || type === "status";
}

export function defaultStatusOptions(): SelectOption[] {
  return [
    { id: uid("opt"), name: "Not started", color: "default", group: "todo" },
    { id: uid("opt"), name: "In progress", color: "blue", group: "inProgress" },
    { id: uid("opt"), name: "Done", color: "green", group: "complete" },
  ];
}

export function newView(type: ViewType, schema?: DatabaseSchema, name?: string): DatabaseView {
  const view: DatabaseView = {
    id: uid("view"),
    name: name ?? VIEW_TYPES.find((item) => item.type === type)?.name ?? "View",
    type,
    filters: [],
    sorts: [],
    hidden: [],
    order: [],
    widths: {},
  };
  if (schema) {
    if (type === "board") view.groupBy = schema.properties.find((p) => p.type === "status" || p.type === "select")?.id;
    if (type === "calendar") view.dateProperty = schema.properties.find((p) => p.type === "date")?.id;
    if (type === "gallery" || type === "list") {
      // Cards and list rows start quiet: only the first couple of properties.
      view.hidden = schema.properties.slice(2).map((p) => p.id);
    }
    if (type === "gallery") view.cardPreview = "cover";
  }
  return view;
}

export function defaultSchema(): DatabaseSchema {
  const status: Property = { id: uid("prop"), name: "Status", type: "status", options: defaultStatusOptions() };
  const tags: Property = { id: uid("prop"), name: "Tags", type: "multiSelect", options: [] };
  const date: Property = { id: uid("prop"), name: "Date", type: "date" };
  const schema: DatabaseSchema = { version: 1, titleName: "Name", properties: [status, tags, date], views: [] };
  schema.views = [newView("table", schema, "Table")];
  return schema;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Reads a schema defensively; malformed data yields a usable default. */
export function parseSchema(raw: string | undefined | null): DatabaseSchema {
  let value: Partial<DatabaseSchema> | null = null;
  try {
    value = raw ? (JSON.parse(raw) as Partial<DatabaseSchema>) : null;
  } catch {
    value = null;
  }
  if (!value || typeof value !== "object") {
    return { version: 1, titleName: "Name", properties: [], views: [newView("table", undefined, "Table")] };
  }
  const properties = asArray<Property>(value.properties)
    .filter((p) => p && typeof p.id === "string" && typeof p.type === "string")
    .map((p) => ({ ...p, name: String(p.name ?? ""), options: hasOptions(p.type) ? asArray<SelectOption>(p.options) : p.options }));
  let views = asArray<DatabaseView>(value.views)
    .filter((v) => v && typeof v.id === "string")
    .map((v) => ({
      ...v,
      name: String(v.name ?? "View"),
      type: (VIEW_TYPES.some((t) => t.type === v.type) ? v.type : "table") as ViewType,
      filters: asArray<FilterRule>(v.filters),
      sorts: asArray<SortRule>(v.sorts),
      hidden: asArray<string>(v.hidden),
      order: asArray<string>(v.order),
      widths: v.widths && typeof v.widths === "object" ? v.widths : {},
    }));
  if (!views.length) views = [newView("table", undefined, "Table")];
  return { version: 1, titleName: String(value.titleName || "Name"), properties, views };
}

export function serializeSchema(schema: DatabaseSchema): string {
  return JSON.stringify(schema);
}

export function parseRowValues(raw: string | undefined | null): RowValues {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as { values?: RowValues };
    return value && typeof value.values === "object" && value.values ? value.values : {};
  } catch {
    return {};
  }
}

export function serializeRowValues(values: RowValues): string {
  const clean: RowValues = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    clean[key] = value;
  }
  return JSON.stringify({ values: clean });
}

const rowCache = new WeakMap<PageMeta, DatabaseRow>();

/** Rows of a database. A row object is reused while its page meta is unchanged. */
export function rowsOf(pages: PageMeta[], databaseId: string): DatabaseRow[] {
  return pages
    .filter((page) => page.parentId === databaseId)
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
    .map((meta) => {
      let row = rowCache.get(meta);
      if (!row) {
        row = { id: meta.id, meta, values: parseRowValues(meta.data) };
        rowCache.set(meta, row);
      }
      return row;
    });
}

/** Ordered property ids of a view, title first unless the view moved it. */
export function orderedPropertyIds(schema: DatabaseSchema, view: DatabaseView): string[] {
  const all = [TITLE_ID, ...schema.properties.map((p) => p.id)];
  const known = new Set(all);
  const ordered = view.order.filter((id) => known.has(id));
  for (const id of all) if (!ordered.includes(id)) ordered.push(id);
  return ordered;
}

export function visiblePropertyIds(schema: DatabaseSchema, view: DatabaseView): string[] {
  const hidden = new Set(view.hidden);
  return orderedPropertyIds(schema, view).filter((id) => id === TITLE_ID || !hidden.has(id));
}

export function propertyById(schema: DatabaseSchema, id: string): Property | undefined {
  if (id === TITLE_ID) return { id: TITLE_ID, name: schema.titleName, type: "text" };
  return schema.properties.find((p) => p.id === id);
}

export function optionById(property: Property | undefined, id: unknown): SelectOption | undefined {
  if (typeof id !== "string") return undefined;
  return property?.options?.find((option) => option.id === id);
}

/** The raw value of a property, with computed and title properties resolved. */
export function cellValue(row: DatabaseRow, property: Property): unknown {
  if (property.id === TITLE_ID) return row.meta.title;
  if (property.type === "createdTime") return row.meta.createdAt;
  if (property.type === "lastEdited") return row.meta.updatedAt;
  return row.values[property.id];
}

export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "" || value === false) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return !(value as DateValue).start;
  return false;
}

export function dateStart(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 10);
  if (value && typeof value === "object") return String((value as DateValue).start ?? "").slice(0, 10);
  return "";
}

export function dateEnd(value: unknown): string {
  if (value && typeof value === "object") return String((value as DateValue).end ?? "").slice(0, 10);
  return "";
}

/** Local calendar date as YYYY-MM-DD. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The local calendar date of a stored timestamp (RFC 3339) or a date. */
export function localDateOf(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : toISODate(date);
}

export function parseISODate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function formatDate(value: string): string {
  const date = parseISODate(value);
  if (!date) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatNumber(value: unknown, format: NumberFormat = "number"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  switch (format) {
    case "commas":
      return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
    case "percent":
      return `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 4 })}%`;
    case "dollar":
      return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
    case "euro":
      return value.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
    case "pound":
      return value.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
    case "yen":
      return value.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });
    default:
      return String(value);
  }
}

/** Plain text of a cell, used for search, filters on text and exports. */
export function cellText(row: DatabaseRow, property: Property): string {
  const value = cellValue(row, property);
  switch (property.type) {
    case "select":
    case "status":
      return optionById(property, value)?.name ?? "";
    case "multiSelect":
      return (Array.isArray(value) ? value : []).map((id) => optionById(property, id)?.name ?? "").filter(Boolean).join(", ");
    case "checkbox":
      return value ? "Yes" : "";
    case "number":
      return formatNumber(value, property.format);
    case "date": {
      const start = dateStart(value);
      const end = dateEnd(value);
      return start ? (end ? `${formatDate(start)} → ${formatDate(end)}` : formatDate(start)) : "";
    }
    case "createdTime":
    case "lastEdited":
      return typeof value === "string" ? formatDateTime(value) : "";
    default:
      return typeof value === "string" ? value : value == null ? "" : String(value);
  }
}

export function filterOpsFor(type: PropertyType): { op: FilterOp; name: string }[] {
  switch (type) {
    case "number":
      return [
        { op: "eq", name: "=" },
        { op: "neq", name: "≠" },
        { op: "gt", name: ">" },
        { op: "lt", name: "<" },
        { op: "gte", name: "≥" },
        { op: "lte", name: "≤" },
        { op: "isEmpty", name: "Is empty" },
        { op: "isNotEmpty", name: "Is not empty" },
      ];
    case "select":
    case "status":
      return [
        { op: "is", name: "Is" },
        { op: "isNot", name: "Is not" },
        { op: "isEmpty", name: "Is empty" },
        { op: "isNotEmpty", name: "Is not empty" },
      ];
    case "multiSelect":
      return [
        { op: "contains", name: "Contains" },
        { op: "notContains", name: "Does not contain" },
        { op: "isEmpty", name: "Is empty" },
        { op: "isNotEmpty", name: "Is not empty" },
      ];
    case "checkbox":
      return [{ op: "is", name: "Is" }];
    case "date":
    case "createdTime":
    case "lastEdited":
      return [
        { op: "is", name: "Is" },
        { op: "before", name: "Is before" },
        { op: "after", name: "Is after" },
        { op: "onOrBefore", name: "Is on or before" },
        { op: "onOrAfter", name: "Is on or after" },
        { op: "isEmpty", name: "Is empty" },
        { op: "isNotEmpty", name: "Is not empty" },
      ];
    default:
      return [
        { op: "contains", name: "Contains" },
        { op: "notContains", name: "Does not contain" },
        { op: "is", name: "Is" },
        { op: "isNot", name: "Is not" },
        { op: "startsWith", name: "Starts with" },
        { op: "endsWith", name: "Ends with" },
        { op: "isEmpty", name: "Is empty" },
        { op: "isNotEmpty", name: "Is not empty" },
      ];
  }
}

export function opNeedsValue(op: FilterOp): boolean {
  return op !== "isEmpty" && op !== "isNotEmpty";
}

export function defaultFilter(property: Property): FilterRule {
  const op = filterOpsFor(property.type)[0].op;
  return { id: uid("flt"), propertyId: property.id, op, value: property.type === "checkbox" ? true : undefined };
}

/** Whether a rule is complete enough to apply; half-written rules are ignored. */
export function filterIsActive(rule: FilterRule): boolean {
  if (!opNeedsValue(rule.op)) return true;
  if (rule.value === undefined || rule.value === null || rule.value === "") return false;
  return true;
}

function dateKey(property: Property, value: unknown): string {
  if (property.type === "createdTime" || property.type === "lastEdited") return typeof value === "string" ? localDateOf(value) : "";
  return dateStart(value);
}

export function matchesFilter(row: DatabaseRow, property: Property, rule: FilterRule): boolean {
  if (!filterIsActive(rule)) return true;
  const value = cellValue(row, property);
  if (rule.op === "isEmpty") return property.type === "checkbox" ? !value : isEmptyValue(property.type === "date" ? dateStart(value) : value);
  if (rule.op === "isNotEmpty") return property.type === "checkbox" ? !!value : !isEmptyValue(property.type === "date" ? dateStart(value) : value);
  switch (property.type) {
    case "number": {
      if (typeof value !== "number") return false;
      const target = Number(rule.value);
      if (!Number.isFinite(target)) return true;
      switch (rule.op) {
        case "eq": return value === target;
        case "neq": return value !== target;
        case "gt": return value > target;
        case "lt": return value < target;
        case "gte": return value >= target;
        case "lte": return value <= target;
        default: return true;
      }
    }
    case "select":
    case "status":
      return rule.op === "isNot" ? value !== rule.value : value === rule.value;
    case "multiSelect": {
      const list = Array.isArray(value) ? value : [];
      return rule.op === "notContains" ? !list.includes(rule.value) : list.includes(rule.value);
    }
    case "checkbox":
      return !!value === !!rule.value;
    case "date":
    case "createdTime":
    case "lastEdited": {
      const key = dateKey(property, value);
      const target = String(rule.value ?? "");
      if (!key) return false;
      switch (rule.op) {
        case "is": return key === target;
        case "before": return key < target;
        case "after": return key > target;
        case "onOrBefore": return key <= target;
        case "onOrAfter": return key >= target;
        default: return true;
      }
    }
    default: {
      const text = cellText(row, property).toLowerCase();
      const target = String(rule.value ?? "").toLowerCase();
      switch (rule.op) {
        case "contains": return text.includes(target);
        case "notContains": return !text.includes(target);
        case "is": return text === target;
        case "isNot": return text !== target;
        case "startsWith": return text.startsWith(target);
        case "endsWith": return text.endsWith(target);
        default: return true;
      }
    }
  }
}

function compareValues(a: DatabaseRow, b: DatabaseRow, property: Property): number {
  const av = cellValue(a, property);
  const bv = cellValue(b, property);
  const aEmpty = property.type === "checkbox" ? false : isEmptyValue(property.type === "date" ? dateStart(av) : av);
  const bEmpty = property.type === "checkbox" ? false : isEmptyValue(property.type === "date" ? dateStart(bv) : bv);
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  switch (property.type) {
    case "number":
      return (av as number) - (bv as number);
    case "checkbox":
      return Number(!!av) - Number(!!bv);
    case "select":
    case "status": {
      // Options sort in their defined order, the way they read in the menu.
      const options = property.options ?? [];
      return options.findIndex((o) => o.id === av) - options.findIndex((o) => o.id === bv);
    }
    case "date":
      return dateStart(av).localeCompare(dateStart(bv));
    case "createdTime":
    case "lastEdited":
      return String(av).localeCompare(String(bv));
    default:
      return cellText(a, property).localeCompare(cellText(b, property), undefined, { numeric: true, sensitivity: "base" });
  }
}

/** Applies a view's filters, search and sorts; the row order is the fallback. */
export function applyView(rows: DatabaseRow[], schema: DatabaseSchema, view: DatabaseView, search = ""): DatabaseRow[] {
  const rules = view.filters
    .map((rule) => ({ rule, property: propertyById(schema, rule.propertyId) }))
    .filter((item): item is { rule: FilterRule; property: Property } => !!item.property && filterIsActive(item.rule));
  const needle = search.trim().toLowerCase();
  const searchable = [propertyById(schema, TITLE_ID)!, ...schema.properties];
  let out = rows.filter((row) => {
    if (rules.length) {
      const results = rules.map(({ rule, property }) => matchesFilter(row, property, rule));
      const ok = view.filterMode === "or" ? results.some(Boolean) : results.every(Boolean);
      if (!ok) return false;
    }
    if (needle) return searchable.some((property) => cellText(row, property).toLowerCase().includes(needle));
    return true;
  });
  const sorts = view.sorts
    .map((sort) => ({ sort, property: propertyById(schema, sort.propertyId) }))
    .filter((item): item is { sort: SortRule; property: Property } => !!item.property);
  if (sorts.length) {
    const index = new Map(rows.map((row, i) => [row.id, i]));
    out = [...out].sort((a, b) => {
      for (const { sort, property } of sorts) {
        const result = compareValues(a, b, property);
        if (result !== 0) {
          // Empty values stay last in both directions.
          const av = cellValue(a, property);
          const bv = cellValue(b, property);
          const emptyInvolved = property.type !== "checkbox" && (isEmptyValue(property.type === "date" ? dateStart(av) : av) || isEmptyValue(property.type === "date" ? dateStart(bv) : bv));
          return sort.direction === "desc" && !emptyInvolved ? -result : result;
        }
      }
      return (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0);
    });
  }
  return out;
}

export interface BoardGroup {
  id: string;
  name: string;
  color: OptionColor;
  option?: SelectOption;
  rows: DatabaseRow[];
}

export const NO_GROUP = "__none";

/** Splits rows into board columns by a select/status/checkbox property. */
export function groupRows(rows: DatabaseRow[], property: Property | undefined): BoardGroup[] {
  if (!property) return [{ id: NO_GROUP, name: "All", color: "default", rows }];
  if (property.type === "checkbox") {
    return [
      { id: "true", name: "Checked", color: "green", rows: rows.filter((row) => !!row.values[property.id]) },
      { id: "false", name: "Unchecked", color: "default", rows: rows.filter((row) => !row.values[property.id]) },
    ];
  }
  const options = property.options ?? [];
  const known = new Set(options.map((o) => o.id));
  const none: BoardGroup = {
    id: NO_GROUP,
    name: `No ${property.name || "value"}`,
    color: "default",
    rows: rows.filter((row) => {
      const value = row.values[property.id];
      if (property.type === "multiSelect") return !Array.isArray(value) || !value.some((id) => known.has(id));
      return typeof value !== "string" || !known.has(value);
    }),
  };
  const groups = options.map((option) => ({
    id: option.id,
    name: option.name,
    color: option.color,
    option,
    rows: rows.filter((row) => {
      const value = row.values[property.id];
      return property.type === "multiSelect" ? Array.isArray(value) && value.includes(option.id) : value === option.id;
    }),
  }));
  return [none, ...groups];
}

/** Values a new row should start with so it lands inside the current view. */
export function seedValuesForView(schema: DatabaseSchema, view: DatabaseView): RowValues {
  const values: RowValues = {};
  for (const rule of view.filters) {
    const property = propertyById(schema, rule.propertyId);
    if (!property || property.id === TITLE_ID || isComputed(property.type) || !filterIsActive(rule)) continue;
    if (values[property.id] !== undefined) continue;
    if ((property.type === "select" || property.type === "status") && rule.op === "is") values[property.id] = rule.value;
    else if (property.type === "multiSelect" && rule.op === "contains") values[property.id] = [rule.value];
    else if (property.type === "checkbox" && rule.op === "is") values[property.id] = !!rule.value;
    else if (property.type === "number" && (rule.op === "eq" || rule.op === "gte" || rule.op === "lte")) values[property.id] = Number(rule.value);
    else if (property.type === "date" && (rule.op === "is" || rule.op === "onOrAfter" || rule.op === "onOrBefore")) values[property.id] = { start: String(rule.value) };
    else if ((property.type === "text" || property.type === "url" || property.type === "email" || property.type === "phone") && (rule.op === "is" || rule.op === "contains" || rule.op === "startsWith")) values[property.id] = String(rule.value);
  }
  return values;
}

/** Converts a stored value when a property changes type, keeping what it can. */
export function convertValue(value: unknown, from: Property, to: Property): unknown {
  if (value === undefined || value === null) return undefined;
  const fromOptions = from.options ?? [];
  const optionNames = (ids: unknown): string[] =>
    (Array.isArray(ids) ? ids : [ids]).map((id) => fromOptions.find((o) => o.id === id)?.name ?? "").filter(Boolean);
  let text = "";
  if (hasOptions(from.type)) text = optionNames(value).join(", ");
  else if (from.type === "date") text = dateStart(value);
  else if (from.type === "checkbox") text = value ? "Yes" : "";
  else text = String(value);
  switch (to.type) {
    case "number": {
      const cleaned = String(text).replace(/[^0-9.eE+-]/g, "");
      const n = Number(cleaned);
      return /\d/.test(cleaned) && Number.isFinite(n) ? n : undefined;
    }
    case "checkbox":
      return from.type === "checkbox" ? value : ["yes", "true", "1", "x", "done"].includes(text.trim().toLowerCase());
    case "date":
      return from.type === "date" ? value : /^\d{4}-\d{2}-\d{2}/.test(text) ? { start: text.slice(0, 10) } : undefined;
    case "select":
    case "status":
    case "multiSelect": {
      const names = hasOptions(from.type) ? optionNames(value) : text.split(",").map((s) => s.trim()).filter(Boolean);
      const ids = names.map((name) => to.options?.find((o) => o.name.toLowerCase() === name.toLowerCase())?.id).filter((id): id is string => !!id);
      return to.type === "multiSelect" ? ids : ids[0];
    }
    case "createdTime":
    case "lastEdited":
      return undefined;
    default:
      return text || undefined;
  }
}

/** Option lists for a property after a type change: names carry over. */
export function optionsForTypeChange(from: Property, to: PropertyType, rows: DatabaseRow[]): SelectOption[] | undefined {
  if (!hasOptions(to)) return undefined;
  if (hasOptions(from.type)) {
    const carried = (from.options ?? []).map((o) => ({ ...o }));
    if (to === "status") {
      if (!carried.length) return defaultStatusOptions();
      return carried.map((o, i) => ({ ...o, group: o.group ?? (i === carried.length - 1 ? "complete" : i === 0 ? "todo" : "inProgress") }));
    }
    return carried.map(({ group: _group, ...o }) => o);
  }
  if (to === "status") return defaultStatusOptions();
  // Text becomes options: one per distinct comma-separated value.
  const names = new Set<string>();
  for (const row of rows) {
    const value = row.values[from.id];
    const text = from.type === "date" ? dateStart(value) : from.type === "checkbox" ? "" : value == null ? "" : String(value);
    for (const part of text.split(",")) if (part.trim()) names.add(part.trim());
  }
  return [...names].slice(0, 100).map((name, i) => ({ id: uid("opt"), name, color: OPTION_COLORS[(i + 1) % OPTION_COLORS.length] }));
}

export function nextOptionColor(options: SelectOption[]): OptionColor {
  const used = new Set(options.map((o) => o.color));
  return OPTION_COLORS.slice(1).find((c) => !used.has(c)) ?? OPTION_COLORS[(options.length % (OPTION_COLORS.length - 1)) + 1];
}

/** Unique property name: "Text", "Text 2", ... */
export function uniquePropertyName(schema: DatabaseSchema, base: string): string {
  const names = new Set([schema.titleName, ...schema.properties.map((p) => p.name)].map((n) => n.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i += 1) if (!names.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  return `${base} ${Date.now()}`;
}

export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function calcsFor(type: PropertyType): { kind: CalcKind; name: string; short: string }[] {
  const base: { kind: CalcKind; name: string; short: string }[] = [
    { kind: "none", name: "None", short: "" },
    { kind: "countAll", name: "Count all", short: "Count" },
  ];
  if (type === "checkbox") {
    return [
      ...base,
      { kind: "checked", name: "Checked", short: "Checked" },
      { kind: "unchecked", name: "Unchecked", short: "Unchecked" },
      { kind: "percentChecked", name: "Percent checked", short: "Checked" },
    ];
  }
  const counts: { kind: CalcKind; name: string; short: string }[] = [
    { kind: "countValues", name: "Count values", short: "Values" },
    { kind: "countUnique", name: "Count unique values", short: "Unique" },
    { kind: "countEmpty", name: "Count empty", short: "Empty" },
    { kind: "countNotEmpty", name: "Count not empty", short: "Not empty" },
    { kind: "percentEmpty", name: "Percent empty", short: "Empty" },
    { kind: "percentNotEmpty", name: "Percent not empty", short: "Not empty" },
  ];
  if (type === "number") {
    return [
      ...base,
      ...counts,
      { kind: "sum", name: "Sum", short: "Sum" },
      { kind: "average", name: "Average", short: "Average" },
      { kind: "median", name: "Median", short: "Median" },
      { kind: "min", name: "Min", short: "Min" },
      { kind: "max", name: "Max", short: "Max" },
      { kind: "range", name: "Range", short: "Range" },
    ];
  }
  if (type === "date" || type === "createdTime" || type === "lastEdited") {
    return [...base, ...counts, { kind: "earliest", name: "Earliest date", short: "Earliest" }, { kind: "latest", name: "Latest date", short: "Latest" }];
  }
  return [...base, ...counts];
}

/** A column summary for the table footer; "" when the kind does not apply. */
export function computeCalc(rows: DatabaseRow[], property: Property, kind: CalcKind): string {
  if (kind === "none") return "";
  const values = rows.map((row) => cellValue(row, property));
  const empty = (value: unknown) => (property.type === "date" ? !dateStart(value) : property.type === "checkbox" ? !value : isEmptyValue(value));
  const total = rows.length;
  const pct = (n: number) => (total ? `${Math.round((n / total) * 1000) / 10}%` : "0%");
  const filled = values.filter((v) => !empty(v));
  switch (kind) {
    case "countAll":
      return String(total);
    case "countValues":
      return String(property.type === "multiSelect" ? filled.reduce<number>((n, v) => n + (v as unknown[]).length, 0) : filled.length);
    case "countUnique": {
      const keys = new Set<string>();
      for (const v of filled) {
        if (Array.isArray(v)) v.forEach((item) => keys.add(String(item)));
        else keys.add(property.type === "date" ? dateStart(v) : typeof v === "object" ? JSON.stringify(v) : String(v).trim().toLowerCase());
      }
      return String(keys.size);
    }
    case "countEmpty":
      return String(total - filled.length);
    case "countNotEmpty":
      return String(filled.length);
    case "percentEmpty":
      return pct(total - filled.length);
    case "percentNotEmpty":
      return pct(filled.length);
    case "checked":
      return String(values.filter(Boolean).length);
    case "unchecked":
      return String(values.filter((v) => !v).length);
    case "percentChecked":
      return pct(values.filter(Boolean).length);
    case "earliest":
    case "latest": {
      const keys = values
        .map((v) => (property.type === "date" ? dateStart(v) : typeof v === "string" ? localDateOf(v) : ""))
        .filter(Boolean)
        .sort();
      if (!keys.length) return "";
      return formatDate(kind === "earliest" ? keys[0] : keys[keys.length - 1]);
    }
    default: {
      const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
      if (!nums.length) return "";
      const sum = nums.reduce((a, b) => a + b, 0);
      let result = 0;
      if (kind === "sum") result = sum;
      else if (kind === "average") result = sum / nums.length;
      else if (kind === "median") result = nums.length % 2 ? nums[(nums.length - 1) / 2] : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2;
      else if (kind === "min") result = nums[0];
      else if (kind === "max") result = nums[nums.length - 1];
      else if (kind === "range") result = nums[nums.length - 1] - nums[0];
      const rounded = Math.round(result * 100) / 100;
      return formatNumber(rounded, property.format ?? "number");
    }
  }
}
