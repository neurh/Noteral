/**
 * Database view and property handlers: everything the database UI can do to a view
 * (layout, filters, sorts, grouping, visibility, order, widths, calculations) and to
 * properties (rename, retype, options, delete), plus row deletion.
 *
 * Params refer to properties by name (or id) and to options by name; these handlers
 * resolve them to the ids the schema stores.
 */
import {
  BOARD_GROUP_TYPES,
  DATE_RANGES,
  OPEN_MODES,
  RELATIVE_DATES,
  TITLE_ID,
  applyView,
  asValueProperty,
  canGroupBy,
  defaultSchema,
  uniquePropertyName,
  DEFAULT_CUSTOM_VIEW,
  defaultChart,
  isFilterGroup,
  OPTION_COLORS,
  convertValue as convertStoredValue,
  filterOpsFor,
  hasOptions,
  newView,
  optionsForTypeChange,
  orderedPropertyIds,
  parseRowValues,
  propertyById,
  rowsOf,
  serializeRowValues,
  serializeSchema,
  uid,
} from "../lib/database";
import type { CalcKind, ChartConfig, DatabaseRow, DatabaseSchema, DatabaseView, FilterGroup, FilterNode, FilterOp, FilterRule, OptionColor, Property, PropertyType, SelectOption, SortRule, StatusGroup, ViewType } from "../lib/database";
import { FORMULA_FUNCTIONS, checkFormula as checkFormulaSource, formulaPosition, renameRefs } from "../lib/formula";
import { withFormulas } from "../lib/databaseFormulas";
import { activePageId, applyPropertyExtras, assertUnlocked, buildProperty, displayTitle, findMeta, formulaRows, insertStoredBlock, isTitleKey, propertyByName, requireDatabase, requireMeta, rowInfos, schemaInfo, store } from "./handlers";
import { editorBridge } from "../lib/editorBridge";
import { databaseMarker } from "../lib/markdownEmbeds";
import type { DatabaseChartInfo, DatabaseFilterNode, DatabaseRowInfo, DatabaseViewInfo } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = Record<string, any>;

const MAX_VIEWS = 30;

/** Resolve a property name or id (or the title column) to a schema id. */
function resolveProperty(schema: DatabaseSchema, ref: string): string {
  const property = propertyByName(schema, ref);
  if (property) return property.id;
  if (ref === TITLE_ID || isTitleKey(schema, ref)) return TITLE_ID;
  const known = [schema.titleName, ...schema.properties.map((item) => item.name)].map((name) => `"${name}"`).join(", ");
  throw new Error(`Unknown property "${ref}". Properties: ${known}.`);
}

function propertyNameOf(schema: DatabaseSchema, id: string): string {
  return propertyById(schema, id)?.name ?? id;
}

function requireView(schema: DatabaseSchema, viewId: string | undefined): DatabaseView {
  if (!viewId) {
    const first = schema.views[0];
    if (!first) throw new Error("This database has no views.");
    return first;
  }
  const view = schema.views.find((item) => item.id === viewId || item.name.toLowerCase() === viewId.toLowerCase());
  if (!view) throw new Error(`No view "${viewId}". Views: ${schema.views.map((item) => `${item.name} (${item.id})`).join(", ")}.`);
  return view;
}

function optionNameOf(property: Property, id: unknown): unknown {
  if (typeof id !== "string") return id;
  return property.options?.find((option) => option.id === id)?.name ?? id;
}

/** Converts a friendly filter value (option names, booleans, ISO dates) into the stored form. */
function filterValue(input: Property, op: FilterOp, value: unknown): unknown {
  if (op === "isEmpty" || op === "isNotEmpty") return undefined;
  // Formulas filter as the type of their results.
  const property = asValueProperty(input);
  switch (property.type) {
    case "select":
    case "status":
    case "multiSelect": {
      if (value === undefined || value === null || value === "") return undefined;
      const optionId = (raw: unknown) => {
        const name = String(raw);
        const known = property.options?.find((option) => option.name.toLowerCase() === name.toLowerCase() || option.id === name);
        if (!known) {
          const names = (property.options ?? []).map((option) => `"${option.name}"`).join(", ") || "none";
          throw new Error(`"${property.name}" has no option "${name}". Options: ${names}.`);
        }
        return known.id;
      };
      // A list means "is any of" / "is none of".
      if (Array.isArray(value)) return value.length > 1 ? value.map(optionId) : value.length ? optionId(value[0]) : undefined;
      return optionId(value);
    }
    case "checkbox": {
      if (typeof value === "boolean") return value;
      const text = String(value ?? "").trim().toLowerCase();
      return ["true", "yes", "1", "checked", "done", "x"].includes(text);
    }
    case "number": {
      const number = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(number)) throw new Error(`Filter on "${property.name}" needs a number.`);
      return number;
    }
    case "date":
    case "createdTime":
    case "lastEdited": {
      const text = String(value ?? "").trim();
      if (op === "within") {
        const range = DATE_RANGES.find((item) => item.id.toLowerCase() === text.toLowerCase());
        if (!range) throw new Error(`"within" needs a range: ${DATE_RANGES.map((item) => item.id).join(", ")}.`);
        return range.id;
      }
      const relative = RELATIVE_DATES.find((item) => item.id.toLowerCase() === text.toLowerCase() || item.id.slice(1).toLowerCase() === text.toLowerCase());
      if (relative) return relative.id;
      if (!/^\d{4}-\d{2}-\d{2}/.test(text)) throw new Error(`Filter on "${property.name}" needs a date like 2026-03-14 or one of ${RELATIVE_DATES.map((item) => item.id).join(", ")}.`);
      return text.slice(0, 10);
    }
    default:
      return value === undefined || value === null ? "" : String(value);
  }
}

type RuleInput = { property: string; op: string; value?: unknown };
type NodeInput = RuleInput | { mode?: string; items: NodeInput[] };

function buildRule(schema: DatabaseSchema, rule: RuleInput): FilterRule {
  const propertyId = resolveProperty(schema, rule.property);
  const property = propertyById(schema, propertyId);
  if (!property) throw new Error(`Unknown property "${rule.property}".`);
  const op = rule.op as FilterOp;
  const allowed = filterOpsFor(property).map((item) => item.op);
  const kind = property.type === "formula" ? `formula → ${property.resultType ?? "text"}` : property.type;
  if (!allowed.includes(op)) throw new Error(`"${property.name}" (${kind}) supports ${allowed.join(", ")} — not "${rule.op}".`);
  return { id: uid("filter"), propertyId, op, value: filterValue(property, op, rule.value) };
}

/** `schema` should be the formula-typed schema (see typedSchema) so formulas filter as their result type. */
function buildFilters(schema: DatabaseSchema, rules: RuleInput[]): FilterRule[] {
  return rules.map((rule) => buildRule(schema, rule));
}

const MAX_FILTER_DEPTH = 4;
const MAX_FILTER_RULES = 60;

/** A friendly advanced-filter tree ({ mode, items: [rule | group] }) → the stored FilterGroup. */
function buildFilterGroup(schema: DatabaseSchema, input: { mode?: string; items?: NodeInput[] }, depth = 1): FilterGroup {
  if (depth > MAX_FILTER_DEPTH) throw new Error(`Advanced filters nest at most ${MAX_FILTER_DEPTH} levels deep.`);
  if (!input || !Array.isArray(input.items)) throw new Error("An advanced filter group needs items: [{ property, op, value } | { mode, items }].");
  const mode = input.mode === "or" ? "or" : "and";
  if (input.mode && input.mode !== "and" && input.mode !== "or") throw new Error(`Group mode is "and" or "or", not "${input.mode}".`);
  return {
    id: uid("grp"),
    mode,
    items: input.items.map((item): FilterNode => ("items" in item ? buildFilterGroup(schema, item, depth + 1) : buildRule(schema, item as RuleInput))),
  };
}

function countNodes(group: FilterGroup): number {
  return group.items.reduce((sum, item) => sum + (isFilterGroup(item) ? countNodes(item) : 1), 0);
}

function ruleInfo(schema: DatabaseSchema, rule: FilterRule) {
  const property = propertyById(schema, rule.propertyId);
  return { id: rule.id, property: property?.name ?? rule.propertyId, op: rule.op, ...(rule.value !== undefined ? { value: property ? optionNameOf(property, rule.value) : rule.value } : {}) };
}

function groupInfo(schema: DatabaseSchema, group: FilterGroup): { id: string; mode: "and" | "or"; items: DatabaseFilterNode[] } {
  return { id: group.id, mode: group.mode, items: group.items.map((item) => (isFilterGroup(item) ? groupInfo(schema, item) : ruleInfo(schema, item))) };
}

/** Chart pseudo-axes that are not schema properties. */
const CHART_AXES = ["createdTime", "lastEdited"];

function chartAxisName(schema: DatabaseSchema, id: string | undefined): string | undefined {
  if (!id) return undefined;
  return CHART_AXES.includes(id) && !propertyById(schema, id) ? id : propertyNameOf(schema, id);
}

function chartInfo(schema: DatabaseSchema, chart: ChartConfig): DatabaseChartInfo {
  const info: DatabaseChartInfo = { ...chart };
  for (const key of ["x", "y", "series", "y2"] as const) {
    if (chart[key]) info[key] = chartAxisName(schema, chart[key]);
  }
  return info;
}

function buildSorts(schema: DatabaseSchema, rules: { property: string; direction?: string }[]): SortRule[] {
  return rules.map((rule) => ({ propertyId: resolveProperty(schema, rule.property), direction: rule.direction === "desc" ? "desc" : "asc" }));
}

export function viewInfo(databaseId: string, schema: DatabaseSchema, view: DatabaseView): DatabaseViewInfo {
  const order = orderedPropertyIds(schema, view);
  const hidden = new Set(view.hidden);
  const info: DatabaseViewInfo = {
    databaseId,
    id: view.id,
    name: view.name,
    type: view.type,
    filters: view.filters.map((rule) => ruleInfo(schema, rule)),
    filterMode: view.filterMode ?? "and",
    sorts: view.sorts.map((sort) => ({ property: propertyNameOf(schema, sort.propertyId), direction: sort.direction })),
    visible: order.filter((id) => id === TITLE_ID || !hidden.has(id)).map((id) => propertyNameOf(schema, id)),
    hidden: order.filter((id) => id !== TITLE_ID && hidden.has(id)).map((id) => propertyNameOf(schema, id)),
  };
  if (view.groupBy) info.groupBy = propertyNameOf(schema, view.groupBy);
  if (view.hiddenGroups?.length) {
    const group = view.groupBy ? propertyById(schema, view.groupBy) : undefined;
    info.hiddenGroups = view.hiddenGroups.map((id) => String(group ? optionNameOf(group, id) : id));
  }
  if (view.dateProperty) info.dateProperty = propertyNameOf(schema, view.dateProperty);
  if (view.cardPreview) info.cardPreview = view.cardPreview;
  if (view.wrap) info.wrap = true;
  if (view.icon) info.icon = view.icon;
  if (view.owner) info.owner = view.owner;
  if (Object.keys(view.widths ?? {}).length) info.widths = Object.fromEntries(Object.entries(view.widths).map(([id, width]) => [propertyNameOf(schema, id), width]));
  if (view.calcs && Object.keys(view.calcs).length) info.calcs = Object.fromEntries(Object.entries(view.calcs).map(([id, calc]) => [propertyNameOf(schema, id), calc]));
  if (view.advanced?.items.length) info.advanced = groupInfo(schema, view.advanced);
  if (view.collapsedGroups?.length) {
    const group = view.groupBy ? propertyById(schema, view.groupBy) : undefined;
    info.collapsedGroups = view.collapsedGroups.map((id) => String(group ? optionNameOf(group, id) : id));
  }
  if (view.hideEmptyGroups) info.hideEmptyGroups = true;
  if (view.colorColumns) info.colorColumns = true;
  if (view.cardSize) info.cardSize = view.cardSize;
  if (view.showFilterBar === false) info.showFilterBar = false;
  if (view.limit) info.limit = view.limit;
  if (view.showIcons === false) info.showIcons = false;
  if (view.openIn) info.openIn = view.openIn;
  if (view.rowNumbers) info.rowNumbers = true;
  if (view.chart) info.chart = chartInfo(schema, view.chart);
  if (view.custom) info.custom = { ...view.custom };
  return info;
}

/** View types that can group rows, and what they may group by. */
const GROUPING_VIEWS: ViewType[] = ["board", "table", "list", "gallery"];

function canGroup(viewType: ViewType, property: Property | undefined): boolean {
  if (!property || !canGroupBy(property)) return false;
  if (viewType === "board") return BOARD_GROUP_TYPES.includes(asValueProperty(property).type);
  return GROUPING_VIEWS.includes(viewType);
}

/** Group names (option names, true/false, a value) → the group ids views store. */
function groupIds(group: Property, names: string[], field: string): string[] {
  const property = asValueProperty(group);
  return names.map((name) => {
    if (property.type === "checkbox") return /^(true|checked|yes|1)$/i.test(name) ? "true" : "false";
    if (!property.options) return /^(none|no value|empty)$/i.test(name) ? "__none" : name;
    if (/^(none|no value|empty|no \S+)$/i.test(name) && !property.options.some((item) => item.name.toLowerCase() === name.toLowerCase())) return "__none";
    const option = property.options.find((item) => item.name.toLowerCase() === name.toLowerCase() || item.id === name);
    if (!option) throw new Error(`${field}: "${group.name}" has no option "${name}". Options: ${property.options.map((item) => `"${item.name}"`).join(", ")}.`);
    return option.id;
  });
}

const NUMERIC_AGGREGATES = ["sum", "average", "median", "min", "max"];

/** Merges a friendly chart patch (property names) into a view's chart settings. */
function patchChart(schema: DatabaseSchema, current: ChartConfig, patch: Params): ChartConfig {
  const chart: ChartConfig = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "x" || key === "y" || key === "series" || key === "y2") {
      const ref = String(value ?? "").trim();
      if (!ref) delete chart[key];
      else if (CHART_AXES.includes(ref) && !propertyByName(schema, ref)) chart[key] = ref;
      else chart[key] = resolveProperty(schema, ref);
    } else if (value === "" || value === null) delete (chart as Record<string, unknown>)[key];
    else (chart as Record<string, unknown>)[key] = value;
  }
  if (chart.aggregate && NUMERIC_AGGREGATES.includes(chart.aggregate)) {
    if (!chart.y) throw new Error(`aggregate "${chart.aggregate}" needs y: a number property to measure.`);
    const measured = propertyById(schema, chart.y);
    if (!measured || asValueProperty(measured).type !== "number") throw new Error(`aggregate "${chart.aggregate}" needs a number property as y; "${measured?.name ?? chart.y}" is ${measured ? asValueProperty(measured).type : "unknown"}.`);
  }
  if ((chart.aggregate === "countValues" || chart.aggregate === "countUnique") && !chart.y) throw new Error(`aggregate "${chart.aggregate}" needs y: the property whose values are counted.`);
  if (chart.yMin !== undefined && chart.yMax !== undefined && chart.yMin >= chart.yMax) throw new Error("yMin must be below yMax.");
  if (chart.aggregate2 && NUMERIC_AGGREGATES.includes(chart.aggregate2)) {
    if (!chart.y2) throw new Error(`aggregate2 "${chart.aggregate2}" needs y2: a number property to measure.`);
    const measured = propertyById(schema, chart.y2);
    if (!measured || asValueProperty(measured).type !== "number") throw new Error(`aggregate2 "${chart.aggregate2}" needs a number property as y2; "${measured?.name ?? chart.y2}" is ${measured ? asValueProperty(measured).type : "unknown"}.`);
  }
  if ((chart.aggregate2 === "countValues" || chart.aggregate2 === "countUnique") && !chart.y2) throw new Error(`aggregate2 "${chart.aggregate2}" needs y2: the property whose values are counted.`);
  if (!chart.aggregate2) delete chart.y2;
  if (chart.labelAngle !== undefined) chart.labelAngle = [0, 30, 45, 60, 90].reduce((a, b) => (Math.abs(b - chart.labelAngle!) < Math.abs(a - chart.labelAngle!) ? b : a), 0);
  if (chart.color !== undefined && chart.color !== "accent" && !OPTION_COLORS.includes(chart.color as OptionColor)) throw new Error(`color must be "accent" or an option colour (${OPTION_COLORS.filter((c) => c !== "default").join(", ")}).`);
  return chart;
}

/**
 * Applies the viewPatch fields from the spec onto a view (in place). `schema` is only read,
 * so pass the formula-typed schema (typedSchema) for formula-aware checks.
 */
function patchView(schema: DatabaseSchema, view: DatabaseView, p: Params) {
  if (typeof p.name === "string" && p.name.trim()) view.name = p.name.trim().slice(0, 80);
  if (p.type && p.type !== view.type) {
    view.type = p.type as ViewType;
    if (view.type === "chart" && !view.chart) view.chart = defaultChart(schema);
    if (view.type === "custom" && !view.custom) view.custom = { html: DEFAULT_CUSTOM_VIEW };
    // A board groups only by options or checkboxes; drop a grouping it cannot show.
    if (view.groupBy && !canGroup(view.type, propertyById(schema, view.groupBy))) {
      view.groupBy = undefined;
      view.hiddenGroups = undefined;
      view.collapsedGroups = undefined;
    }
  }
  if (Array.isArray(p.filters)) view.filters = buildFilters(schema, p.filters);
  if (p.filterMode) view.filterMode = p.filterMode;
  if (p.advanced !== undefined) {
    if (p.advanced === false || !p.advanced?.items?.length) view.advanced = undefined;
    else {
      const group = buildFilterGroup(schema, p.advanced);
      if (countNodes(group) > MAX_FILTER_RULES) throw new Error(`Advanced filters hold at most ${MAX_FILTER_RULES} rules.`);
      view.advanced = group;
    }
  }
  if (Array.isArray(p.sorts)) view.sorts = buildSorts(schema, p.sorts);
  if (typeof p.groupBy === "string") {
    if (!p.groupBy) {
      view.groupBy = undefined;
      view.hiddenGroups = undefined;
      view.collapsedGroups = undefined;
    } else {
      const id = resolveProperty(schema, p.groupBy);
      const property = propertyById(schema, id);
      if (!canGroup(view.type, property)) {
        if (!GROUPING_VIEWS.includes(view.type)) throw new Error(`${view.type} views do not group rows. Grouping works in ${GROUPING_VIEWS.join(", ")} views.`);
        if (id === TITLE_ID) throw new Error("Rows cannot be grouped by the title.");
        throw new Error(`A board groups by a select, multi-select, status or checkbox property; "${property?.name}" is ${property?.type}. Tables, lists and galleries can group by it.`);
      }
      if (view.groupBy !== id) {
        view.hiddenGroups = undefined;
        view.collapsedGroups = undefined;
      }
      view.groupBy = id;
    }
  }
  if (Array.isArray(p.hiddenGroups)) {
    const group = view.groupBy ? propertyById(schema, view.groupBy) : undefined;
    if (!group) throw new Error("Set groupBy before hiddenGroups.");
    view.hiddenGroups = groupIds(group, p.hiddenGroups, "hiddenGroups");
  }
  if (Array.isArray(p.collapsedGroups)) {
    const group = view.groupBy ? propertyById(schema, view.groupBy) : undefined;
    if (!group) throw new Error("Set groupBy before collapsedGroups.");
    view.collapsedGroups = groupIds(group, p.collapsedGroups, "collapsedGroups");
  }
  if (typeof p.hideEmptyGroups === "boolean") view.hideEmptyGroups = p.hideEmptyGroups || undefined;
  if (typeof p.colorColumns === "boolean") view.colorColumns = p.colorColumns || undefined;
  if (typeof p.rowNumbers === "boolean") view.rowNumbers = p.rowNumbers || undefined;
  if (typeof p.showFilterBar === "boolean") view.showFilterBar = p.showFilterBar ? undefined : false;
  if (typeof p.showIcons === "boolean") view.showIcons = p.showIcons ? undefined : false;
  if (typeof p.icon === "string") view.icon = p.icon.trim() || undefined;
  if (typeof p.limit === "number") view.limit = p.limit > 0 ? p.limit : undefined;
  if (typeof p.openIn === "string") {
    if (!OPEN_MODES.some((mode) => mode.id === p.openIn)) throw new Error(`openIn is one of ${OPEN_MODES.map((mode) => mode.id).join(", ")}.`);
    view.openIn = p.openIn === "modal" ? undefined : (p.openIn as DatabaseView["openIn"]);
  }
  if (p.cardSize) view.cardSize = p.cardSize === "medium" ? undefined : p.cardSize;
  if (p.chart && typeof p.chart === "object") {
    if (view.type !== "chart") throw new Error(`chart settings apply to chart views; "${view.name}" is a ${view.type} view (set type: "chart").`);
    view.chart = patchChart(schema, view.chart ?? defaultChart(schema), p.chart);
  }
  if (p.custom && typeof p.custom === "object") {
    if (view.type !== "custom") throw new Error(`custom settings apply to custom views; "${view.name}" is a ${view.type} view (set type: "custom").`);
    const next = { ...(view.custom ?? { html: DEFAULT_CUSTOM_VIEW }) };
    if (typeof p.custom.html === "string") {
      if (!p.custom.html.trim()) throw new Error("custom.html is empty.");
      next.html = p.custom.html;
    }
    if (typeof p.custom.height === "number") next.height = p.custom.height;
    view.custom = next;
  }
  if (Array.isArray(p.order)) {
    const ids = p.order.map((ref: string) => resolveProperty(schema, ref));
    const rest = orderedPropertyIds(schema, view).filter((id) => !ids.includes(id));
    view.order = [...ids, ...rest];
  }
  if (Array.isArray(p.show)) {
    const ids: string[] = p.show.map((ref: string) => resolveProperty(schema, ref));
    view.hidden = schema.properties.map((property) => property.id).filter((id) => !ids.includes(id));
    if (!Array.isArray(p.order)) {
      const rest = orderedPropertyIds(schema, view).filter((id) => !ids.includes(id));
      const withTitle = ids.includes(TITLE_ID) ? ids : [TITLE_ID, ...ids];
      view.order = [...withTitle, ...rest.filter((id) => id !== TITLE_ID)];
    }
  }
  if (Array.isArray(p.hide)) {
    const ids = p.hide.map((ref: string) => resolveProperty(schema, ref)).filter((id: string) => id !== TITLE_ID);
    view.hidden = [...new Set([...view.hidden, ...ids])];
  }
  if (p.widths && typeof p.widths === "object") {
    const widths = { ...view.widths };
    for (const [ref, width] of Object.entries(p.widths as Record<string, number>)) {
      const id = resolveProperty(schema, ref);
      if (typeof width === "number" && Number.isFinite(width)) widths[id] = Math.max(60, Math.min(900, Math.round(width)));
    }
    view.widths = widths;
  }
  if (p.calcs && typeof p.calcs === "object") {
    const calcs: Record<string, CalcKind> = { ...(view.calcs ?? {}) };
    for (const [ref, calc] of Object.entries(p.calcs as Record<string, CalcKind>)) {
      const id = resolveProperty(schema, ref);
      if (calc === "none") delete calcs[id];
      else calcs[id] = calc;
    }
    view.calcs = calcs;
  }
  if (typeof p.dateProperty === "string") {
    if (!p.dateProperty) view.dateProperty = undefined;
    else {
      const id = resolveProperty(schema, p.dateProperty);
      const property = propertyById(schema, id);
      if (!property || !["date", "createdTime", "lastEdited"].includes(asValueProperty(property).type)) throw new Error(`"${p.dateProperty}" is not a date property.`);
      view.dateProperty = id;
    }
  }
  if (p.cardPreview) view.cardPreview = p.cardPreview;
  if (typeof p.wrap === "boolean") view.wrap = p.wrap;
  if (view.type === "board" && !view.groupBy) {
    const groupable = schema.properties.find((property) => property.type === "status" || property.type === "select") ?? schema.properties.find((property) => canGroup("board", property));
    if (groupable) view.groupBy = groupable.id;
  }
  if (view.type === "calendar" && !view.dateProperty) {
    const date = schema.properties.find((property) => property.type === "date");
    if (!date) throw new Error("A calendar view needs a date property. Add one with databases.addProperty first.");
    view.dateProperty = date.id;
  }
}

async function saveSchema(databaseId: string, schema: DatabaseSchema) {
  await store().setPageData(databaseId, serializeSchema(schema));
}

/** The schema with each formula's result type, for filters, sorts and grouping checks. Never save it. */
function typedSchema(databaseId: string, schema: DatabaseSchema): DatabaseSchema {
  return formulaRows(databaseId, schema).schema;
}

function rowsInfo(databaseId: string, schema: DatabaseSchema, view: DatabaseView, search: string, limit: number, only?: Set<string>): DatabaseRowInfo[] {
  const computed = formulaRows(databaseId, schema);
  const rows: DatabaseRow[] = only ? computed.rows.filter((row) => only.has(row.id)) : computed.rows;
  return rowInfos(computed, applyView(rows, computed.schema, view, search).slice(0, limit));
}

function resolveOptions(property: Property, items: { name: string; color?: string; group?: string }[]): SelectOption[] {
  const existing = property.options ?? [];
  const used = new Set<string>();
  const out: SelectOption[] = [];
  items.forEach((item, index) => {
    const name = item.name.trim();
    if (!name || used.has(name.toLowerCase())) return;
    used.add(name.toLowerCase());
    const match = existing.find((option) => option.name.toLowerCase() === name.toLowerCase());
    const option: SelectOption = match ? { ...match, name } : { id: uid("opt"), name, color: "default" };
    if (item.color) option.color = item.color as OptionColor;
    else if (!match) option.color = (["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as OptionColor[])[index % 9];
    if (property.type === "status") option.group = (item.group as StatusGroup | undefined) ?? match?.group ?? (index === 0 ? "todo" : index === items.length - 1 ? "complete" : "inProgress");
    else delete option.group;
    out.push(option);
  });
  return out;
}

/** Rewrites `{Old}` / prop("Old") references in every other formula after a rename. */
function rewriteFormulaRefs(schema: DatabaseSchema, from: string, to: string, skipId?: string): void {
  for (const property of schema.properties) {
    if (property.type !== "formula" || !property.formula || property.id === skipId) continue;
    property.formula = renameRefs(property.formula, from, to);
  }
}

function renameTitle(schema: DatabaseSchema, name: string): void {
  if (name !== schema.titleName) rewriteFormulaRefs(schema, schema.titleName, name);
  schema.titleName = name;
}

/** The filter tree without rules on a property (empty groups go too). */
function dropRules(group: FilterGroup, propertyId: string): FilterGroup | undefined {
  const items = group.items
    .map((item) => (isFilterGroup(item) ? dropRules(item, propertyId) : item.propertyId === propertyId ? undefined : item))
    .filter((item): item is FilterNode => !!item);
  return items.length ? { ...group, items } : undefined;
}

function uniqueProbeName(schema: DatabaseSchema): string {
  let name = "Formula";
  for (let n = 2; schema.properties.some((item) => item.name.toLowerCase() === name.toLowerCase()); n++) name = `Formula ${n}`;
  return name;
}

/** The formula reference, one compact line per function (databases.formulaFunctions). */
const FORMULA_HELP = [
  "Formula syntax: refer to properties as {Name} or prop(\"Name\"); strings in quotes; lists [1, 2]; operators + - * / % ^, == != > < >= <=, and or not, cond ? a : b; x.fn(args) is fn(x, args). Formulas may span lines and use // or /* */ comments. In map/filter/find/some/every/count/sort `current` is the item and `index` its position; reduce(list, acc + current, 0) folds. Dates compare and subtract; results are number, text (style() and link() give formatted text), checkbox, date (dateRange() for a range) or list.",
  ...FORMULA_FUNCTIONS.map((item) => `${item.signature} — ${item.description} e.g. ${item.example}${item.result ? ` → ${item.result}` : ""}`),
].join("\n");

type NewProperty = { name: string; type: PropertyType; options?: string[]; formula?: string; format?: string; dateFormat?: string; display?: unknown };

/** A new database schema from the friendly create/embed params. Formulas may use any property in the list. */
function newSchema(properties: NewProperty[] | undefined, viewType: ViewType): DatabaseSchema {
  let schema = defaultSchema();
  if (properties?.length) {
    schema = { version: 1, titleName: "Name", properties: [], views: [] };
    for (const item of properties) schema.properties.push(buildProperty(uniquePropertyName(schema, item.name.trim() || "Property"), item.type, item.options));
    properties.forEach((item, index) => applyPropertyExtras(schema, schema.properties[index], item));
  }
  const view = newView(viewType, schema);
  if (viewType === "calendar" && !view.dateProperty) throw new Error("A calendar view needs a date property; add one to properties.");
  schema.views = [view];
  return schema;
}

async function createDatabase(parentId: string, title: string | undefined, properties: NewProperty[] | undefined, viewType: ViewType): Promise<PageMetaLike> {
  const schema = newSchema(properties, viewType);
  const meta = await store().createItem("database", parentId, { open: false, title: title ?? "", data: serializeSchema(schema) });
  if (!meta) throw new Error("The database could not be created.");
  return meta;
}

type PageMetaLike = { id: string };

export const DATABASE_HANDLERS: Record<string, (p: Params) => unknown> = {
  "databases.create": async (p) => {
    const parentId = p.parentId ?? "";
    if (parentId) {
      const parent = requireMeta(parentId, "Parent");
      if (parent.kind === "database") throw new Error("A database cannot hold another database. Pick a page or folder.");
    }
    const meta = await createDatabase(parentId, p.title, p.properties, (p.view ?? "table") as ViewType);
    if (p.open !== false) await store().selectPage(meta.id);
    return { databaseId: meta.id };
  },
  "databases.embed": async (p) => {
    const pageId = p.pageId || activePageId();
    if (!pageId) throw new Error("No page is open. Pass pageId.");
    const page = requireMeta(pageId, "Page");
    if (page.kind !== "page") throw new Error(`"${displayTitle(pageId)}" is a ${page.kind}; databases embed into pages.`);
    if (page.deletedAt) throw new Error(`"${displayTitle(pageId)}" is in the trash. Restore it first.`);
    const position = (p.position ?? "end") as "start" | "end" | "before" | "after";
    if ((position === "before" || position === "after") && !p.blockId && !p.anchor) throw new Error(`position "${position}" needs blockId or anchor.`);
    if (p.databaseId && (p.title || p.properties)) throw new Error("title and properties are for a new database; omit them when linking databaseId.");
    if (p.databaseId) requireDatabase(p.databaseId);
    const handle = editorBridge.get(pageId);
    // Resolve a text anchor in an open editor before creating anything.
    let blockId: string | undefined = p.blockId;
    if (handle && !blockId && p.anchor) {
      const wanted = String(p.anchor).trim().toLowerCase();
      const found = (handle.getBlocks?.() ?? []).find((block) => block.text.toLowerCase().includes(wanted));
      if (!found) throw new Error(`No block on "${displayTitle(pageId)}" contains "${p.anchor}".`);
      blockId = found.id;
    }
    const databaseId = p.databaseId ?? (await createDatabase(pageId, p.title, p.properties, (p.view ?? "table") as ViewType)).id;
    const created = !p.databaseId;
    try {
      if (handle?.insertMarkdown) await handle.insertMarkdown(databaseMarker(databaseId), position, blockId);
      else await insertStoredBlock(pageId, { type: "database", props: { databaseId }, children: [] }, position, { blockId, text: p.anchor });
    } catch (error) {
      // Do not leave a stray database behind when the block could not go in.
      if (created) await store().trashPage(databaseId, { quiet: true }).catch(() => undefined);
      throw error;
    }
    return { databaseId, pageId, created };
  },
  "databases.getView": (p) => {
    const { schema } = requireDatabase(p.databaseId);
    return viewInfo(p.databaseId, schema, requireView(schema, p.viewId));
  },
  "databases.queryView": (p) => {
    const { schema } = requireDatabase(p.databaseId);
    const typed = typedSchema(p.databaseId, schema);
    const view = structuredClone(requireView(schema, p.viewId));
    if (Array.isArray(p.sorts)) view.sorts = buildSorts(typed, p.sorts);
    if (p.advanced?.items?.length) {
      // An extra filter tree narrows the view's own advanced filters.
      const extra = buildFilterGroup(typed, p.advanced);
      view.advanced = view.advanced?.items.length ? { id: uid("grp"), mode: "and", items: [view.advanced, extra] } : extra;
    }
    if (Array.isArray(p.filters)) {
      // Extra filters narrow the view's own: both sets must match.
      const extra = buildFilters(typed, p.filters);
      if (view.filters.length && (view.filterMode ?? "and") === "or") {
        const baseRows = new Set(rowsInfo(p.databaseId, schema, view, "", Number.MAX_SAFE_INTEGER).map((row) => row.id));
        const narrowed = { ...view, filters: extra, filterMode: p.filterMode ?? "and", advanced: undefined };
        return rowsInfo(p.databaseId, schema, narrowed, p.search ?? "", p.limit ?? 200, baseRows);
      }
      view.filters = [...view.filters, ...extra];
      if (p.filterMode && !view.filters.length) view.filterMode = p.filterMode;
    }
    return rowsInfo(p.databaseId, schema, view, p.search ?? "", p.limit ?? 200);
  },
  "databases.addView": async (p) => {
    const { schema } = requireDatabase(p.databaseId);
    if (schema.views.length >= MAX_VIEWS) throw new Error(`A database has at most ${MAX_VIEWS} views.`);
    const view = newView((p.type ?? "table") as ViewType, schema, typeof p.name === "string" && p.name.trim() ? p.name.trim() : undefined);
    patchView(typedSchema(p.databaseId, schema), view, { ...p, type: undefined });
    schema.views.push(view);
    await saveSchema(p.databaseId, schema);
    return viewInfo(p.databaseId, schema, view);
  },
  "databases.updateView": async (p) => {
    const { schema } = requireDatabase(p.databaseId);
    const view = requireView(schema, p.viewId);
    patchView(typedSchema(p.databaseId, schema), view, p);
    await saveSchema(p.databaseId, schema);
    return viewInfo(p.databaseId, schema, view);
  },
  "databases.removeView": async (p) => {
    const { schema } = requireDatabase(p.databaseId);
    const view = requireView(schema, p.viewId);
    if (schema.views.length <= 1) throw new Error("A database keeps at least one view.");
    schema.views = schema.views.filter((item) => item.id !== view.id);
    await saveSchema(p.databaseId, schema);
  },
  "databases.duplicateView": async (p) => {
    const { schema } = requireDatabase(p.databaseId);
    if (schema.views.length >= MAX_VIEWS) throw new Error(`A database has at most ${MAX_VIEWS} views.`);
    const source = requireView(schema, p.viewId);
    const copy: DatabaseView = { ...structuredClone(source), id: uid("view"), name: (p.name?.trim() || `${source.name} copy`).slice(0, 80) };
    copy.filters = copy.filters.map((rule) => ({ ...rule, id: uid("filter") }));
    schema.views.splice(schema.views.indexOf(source) + 1, 0, copy);
    await saveSchema(p.databaseId, schema);
    return viewInfo(p.databaseId, schema, copy);
  },
  "databases.moveView": async (p) => {
    const { schema } = requireDatabase(p.databaseId);
    const view = requireView(schema, p.viewId);
    const rest = schema.views.filter((item) => item.id !== view.id);
    rest.splice(Math.max(0, Math.min(p.index, rest.length)), 0, view);
    schema.views = rest;
    await saveSchema(p.databaseId, schema);
  },
  "databases.updateProperty": async (p) => {
    const { meta, schema } = requireDatabase(p.databaseId);
    const id = resolveProperty(schema, p.property);
    if (id === TITLE_ID) {
      if (p.type || p.options || p.format || p.formula !== undefined || p.dateFormat !== undefined || p.display !== undefined) throw new Error("The title column is always text; only its name can change (use name or databases.rename).");
      if (typeof p.name === "string" && p.name.trim()) renameTitle(schema, p.name.trim().slice(0, 100));
      await saveSchema(meta.id, schema);
      return schemaInfo(meta, schema);
    }
    const index = schema.properties.findIndex((item) => item.id === id);
    const from = schema.properties[index];
    let next: Property = structuredClone(from);
    if (schema.locked && (p.formula !== undefined || (p.type && p.type !== from.type))) assertUnlocked(meta, schema, "its formulas and property types can't change");
    if (typeof p.name === "string" && p.name.trim()) {
      const name = p.name.trim().slice(0, 100);
      const clash = schema.properties.some((item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase()) || name.toLowerCase() === schema.titleName.toLowerCase();
      if (clash) throw new Error(`Another property is already called "${name}".`);
      if (name !== from.name) rewriteFormulaRefs(schema, from.name, name, id);
      next.name = name;
    }
    const rows = rowsOf(store().pages, meta.id);
    // A formula's results become the stored values when it turns into an ordinary property.
    const computed = from.type === "formula" ? formulaRows(meta.id, schema) : undefined;
    const retype = p.type && p.type !== from.type;
    if (retype) {
      const type = p.type as PropertyType;
      const source = computed ? asValueProperty(computed.schema.properties.find((item) => item.id === id) ?? from) : from;
      const sourceRows = computed?.rows ?? rows;
      next = { ...next, type, options: type === "formula" ? undefined : optionsForTypeChange(source, type, sourceRows), ...(type === "number" ? { format: from.format ?? "number" } : {}) };
      if (!hasOptions(type)) delete next.options;
      if (type !== "number" && type !== "formula") {
        delete next.format;
        delete next.display;
      }
      if (type !== "formula") {
        delete next.formula;
        delete next.dateFormat;
      }
    }
    applyPropertyExtras(schema, next, { formula: p.formula, format: p.format, dateFormat: p.dateFormat, display: p.display });
    let removedOptions: Set<string> | undefined;
    if (Array.isArray(p.options)) {
      if (!hasOptions(next.type)) throw new Error(`"${next.name}" is ${next.type}; only select, multi-select and status have options.`);
      const options = resolveOptions(next, p.options);
      if (!options.length) throw new Error("Give at least one option.");
      const kept = new Set(options.map((option) => option.id));
      removedOptions = new Set((next.options ?? []).map((option) => option.id).filter((optionId) => !kept.has(optionId)));
      next.options = options;
      for (const view of schema.views) {
        view.filters = view.filters.filter((rule) => rule.propertyId !== id || !removedOptions!.has(String(rule.value)));
        if (view.groupBy === id && view.hiddenGroups) view.hiddenGroups = view.hiddenGroups.filter((optionId) => !removedOptions!.has(optionId));
      }
    }
    schema.properties[index] = next;
    const formulaChanged = next.type === "formula" && (retype || next.formula !== from.formula);
    if (retype || formulaChanged) {
      // Filters, groups and calendars keyed to the old behaviour may no longer fit.
      const typed = withFormulas(rows, schema).schema;
      const now = asValueProperty(typed.properties.find((item) => item.id === id) ?? next);
      for (const view of schema.views) {
        view.filters = view.filters.filter((rule) => rule.propertyId !== id);
        if (view.advanced) view.advanced = dropRules(view.advanced, id);
        if (view.groupBy === id && !canGroup(view.type, now)) {
          view.groupBy = undefined;
          view.hiddenGroups = undefined;
          view.collapsedGroups = undefined;
        }
        if (view.dateProperty === id && !["date", "createdTime", "lastEdited"].includes(now.type)) view.dateProperty = undefined;
        if (view.calcs?.[id]) delete view.calcs[id];
      }
    }
    await saveSchema(meta.id, schema);
    // Convert stored values: retyped properties, and options that no longer exist.
    if (retype || removedOptions?.size) {
      const results = computed ? new Map(computed.rows.map((row) => [row.id, row.values[id]])) : undefined;
      const source = computed ? asValueProperty(computed.schema.properties.find((item) => item.id === id) ?? from) : from;
      for (const row of rows) {
        const values = parseRowValues(row.meta.data);
        const value = results ? results.get(row.id) : values[id];
        if (value === undefined && values[id] === undefined) continue;
        let converted: unknown = value;
        // Formulas store nothing: their values are computed.
        if (next.type === "formula") converted = undefined;
        else if (retype) converted = convertStoredValue(value, source, next);
        if (removedOptions?.size) {
          if (Array.isArray(converted)) converted = converted.filter((item) => !removedOptions!.has(String(item)));
          else if (typeof converted === "string" && removedOptions.has(converted)) converted = undefined;
        }
        if (converted === undefined || (Array.isArray(converted) && !converted.length)) delete values[id];
        else values[id] = converted;
        await store().setPageData(row.id, serializeRowValues(values));
      }
    }
    return schemaInfo(meta, schema);
  },
  "databases.formulaFunctions": () => FORMULA_HELP,
  "databases.checkFormula": (p) => {
    const { schema } = requireDatabase(p.databaseId);
    const self = p.property ? schema.properties.find((item) => item.id === resolveProperty(schema, p.property)) : undefined;
    const probe: Property = self ? { ...self, type: "formula" } : { id: "__check", name: uniqueProbeName(schema), type: "formula" };
    const trial: DatabaseSchema = { ...schema, properties: [...schema.properties.filter((item) => item.id !== probe.id), { ...probe, formula: p.formula }] };
    const names = [propertyById(schema, TITLE_ID)?.name ?? "Name", ...schema.properties.filter((item) => item.id !== probe.id).map((item) => item.name)];
    const problem = checkFormulaSource(p.formula, names);
    if (problem) {
      const at = formulaPosition(p.formula, problem.start);
      return { ok: false, error: `${problem.message} (line ${at.line}, column ${at.column})` };
    }
    try {
      applyPropertyExtras(trial, probe, { formula: p.formula });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    trial.properties = trial.properties.map((item) => (item.id === probe.id ? probe : item));
    const result = withFormulas(rowsOf(store().pages, p.databaseId), trial);
    const typed = result.schema.properties.find((item) => item.id === probe.id);
    const sample = result.rows.slice(0, 5).map((row) => ({ title: displayTitle(row.id), value: row.values[probe.id] ?? null, ...(result.rowErrors.get(row.id)?.[probe.id] ? { error: result.rowErrors.get(row.id)![probe.id] } : {}) }));
    return { ok: true, resultType: typed?.resultType ?? "text", sample };
  },
  "databases.removeProperty": async (p) => {
    const { meta, schema } = requireDatabase(p.databaseId);
    const id = resolveProperty(schema, p.property);
    if (id === TITLE_ID) throw new Error("The title column cannot be removed.");
    schema.properties = schema.properties.filter((item) => item.id !== id);
    for (const view of schema.views) {
      view.filters = view.filters.filter((rule) => rule.propertyId !== id);
      view.sorts = view.sorts.filter((sort) => sort.propertyId !== id);
      view.hidden = view.hidden.filter((item) => item !== id);
      view.order = view.order.filter((item) => item !== id);
      delete view.widths[id];
      if (view.calcs) delete view.calcs[id];
      if (view.groupBy === id) {
        view.groupBy = undefined;
        view.hiddenGroups = undefined;
        view.collapsedGroups = undefined;
      }
      if (view.dateProperty === id) view.dateProperty = undefined;
      if (view.advanced) view.advanced = dropRules(view.advanced, id);
      if (view.chart) {
        const chart = { ...view.chart };
        if (chart.x === id) delete chart.x;
        if (chart.y === id) {
          delete chart.y;
          chart.aggregate = "count";
        }
        if (chart.series === id) delete chart.series;
        if (chart.y2 === id) {
          delete chart.y2;
          delete chart.aggregate2;
        }
        view.chart = chart;
      }
    }
    await saveSchema(meta.id, schema);
    for (const row of rowsOf(store().pages, meta.id)) {
      const values = parseRowValues(row.meta.data);
      if (values[id] === undefined) continue;
      delete values[id];
      await store().setPageData(row.id, serializeRowValues(values));
    }
  },
  "databases.deleteRows": async (p) => {
    let deleted = 0;
    for (const rowId of p.rowIds as string[]) {
      const row = requireMeta(rowId, "Row");
      const parent = row.parentId ? findMeta(row.parentId) : undefined;
      if (!parent || parent.kind !== "database") throw new Error(`"${displayTitle(rowId)}" is not a database row.`);
      if (row.deletedAt) continue;
      await store().trashPage(rowId, { quiet: true });
      deleted += 1;
    }
    return { deleted };
  },
  "databases.setLocked": async (p) => {
    const { meta, schema } = requireDatabase(p.databaseId);
    if (p.locked) schema.locked = true;
    else delete schema.locked;
    await saveSchema(meta.id, schema);
    return { locked: !!schema.locked };
  },
  "databases.rename": async (p) => {
    const { meta, schema } = requireDatabase(p.databaseId);
    if (typeof p.titleColumn === "string" && p.titleColumn.trim()) {
      const name = p.titleColumn.trim().slice(0, 100);
      if (schema.properties.some((item) => item.name.toLowerCase() === name.toLowerCase())) throw new Error(`A property is already called "${name}".`);
      renameTitle(schema, name);
      await saveSchema(meta.id, schema);
    }
    if (typeof p.title === "string") await store().renamePage(meta.id, p.title);
  },
};
