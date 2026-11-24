/**
 * Database view and property handlers: everything the database UI can do to a view
 * (layout, filters, sorts, grouping, visibility, order, widths, calculations) and to
 * properties (rename, retype, options, delete), plus row deletion.
 *
 * Params refer to properties by name (or id) and to options by name; these handlers
 * resolve them to the ids the schema stores.
 */
import {
  TITLE_ID,
  applyView,
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
import type { CalcKind, DatabaseSchema, DatabaseView, FilterOp, FilterRule, NumberFormat, OptionColor, Property, PropertyType, SelectOption, SortRule, StatusGroup, ViewType } from "../lib/database";
import { displayTitle, findMeta, isTitleKey, propertyByName, requireDatabase, requireMeta, rowInfo, schemaInfo, store } from "./handlers";
import type { DatabaseRowInfo, DatabaseViewInfo } from "./types";

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
function filterValue(property: Property, op: FilterOp, value: unknown): unknown {
  if (op === "isEmpty" || op === "isNotEmpty") return undefined;
  switch (property.type) {
    case "select":
    case "status":
    case "multiSelect": {
      if (value === undefined || value === null || value === "") return undefined;
      const name = String(Array.isArray(value) ? value[0] : value);
      const known = property.options?.find((option) => option.name.toLowerCase() === name.toLowerCase() || option.id === name);
      if (!known) {
        const names = (property.options ?? []).map((option) => `"${option.name}"`).join(", ") || "none";
        throw new Error(`"${property.name}" has no option "${name}". Options: ${names}.`);
      }
      return known.id;
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
      if (!/^\d{4}-\d{2}-\d{2}/.test(text)) throw new Error(`Filter on "${property.name}" needs a date like 2026-03-14.`);
      return text.slice(0, 10);
    }
    default:
      return value === undefined || value === null ? "" : String(value);
  }
}

function buildFilters(schema: DatabaseSchema, rules: { property: string; op: string; value?: unknown }[]): FilterRule[] {
  return rules.map((rule) => {
    const propertyId = resolveProperty(schema, rule.property);
    const property = propertyById(schema, propertyId);
    if (!property) throw new Error(`Unknown property "${rule.property}".`);
    const op = rule.op as FilterOp;
    const allowed = filterOpsFor(property.type).map((item) => item.op);
    if (!allowed.includes(op)) throw new Error(`"${property.name}" (${property.type}) supports ${allowed.join(", ")} — not "${rule.op}".`);
    return { id: uid("filter"), propertyId, op, value: filterValue(property, op, rule.value) };
  });
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
    filters: view.filters.map((rule) => {
      const property = propertyById(schema, rule.propertyId);
      return { id: rule.id, property: property?.name ?? rule.propertyId, op: rule.op, ...(rule.value !== undefined ? { value: property ? optionNameOf(property, rule.value) : rule.value } : {}) };
    }),
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
  if (Object.keys(view.widths ?? {}).length) info.widths = Object.fromEntries(Object.entries(view.widths).map(([id, width]) => [propertyNameOf(schema, id), width]));
  if (view.calcs && Object.keys(view.calcs).length) info.calcs = Object.fromEntries(Object.entries(view.calcs).map(([id, calc]) => [propertyNameOf(schema, id), calc]));
  return info;
}

const GROUPABLE: PropertyType[] = ["select", "multiSelect", "status", "checkbox"];

/** Applies the viewPatch fields from the spec onto a view (in place). */
function patchView(schema: DatabaseSchema, view: DatabaseView, p: Params) {
  if (typeof p.name === "string" && p.name.trim()) view.name = p.name.trim().slice(0, 80);
  if (p.type) view.type = p.type as ViewType;
  if (Array.isArray(p.filters)) view.filters = buildFilters(schema, p.filters);
  if (p.filterMode) view.filterMode = p.filterMode;
  if (Array.isArray(p.sorts)) view.sorts = buildSorts(schema, p.sorts);
  if (typeof p.groupBy === "string") {
    if (!p.groupBy) {
      view.groupBy = undefined;
      view.hiddenGroups = undefined;
    } else {
      const id = resolveProperty(schema, p.groupBy);
      const property = propertyById(schema, id);
      if (!property || !GROUPABLE.includes(property.type)) throw new Error(`Group by needs a select, multi-select, status or checkbox property; "${p.groupBy}" is ${property?.type ?? "the title"}.`);
      if (view.groupBy !== id) view.hiddenGroups = undefined;
      view.groupBy = id;
    }
  }
  if (Array.isArray(p.hiddenGroups)) {
    const group = view.groupBy ? propertyById(schema, view.groupBy) : undefined;
    if (!group) throw new Error("Set groupBy before hiddenGroups.");
    view.hiddenGroups = p.hiddenGroups.map((name: string) => {
      if (group.type === "checkbox") return /^(true|checked|yes)$/i.test(name) ? "true" : "false";
      const option = group.options?.find((item) => item.name.toLowerCase() === name.toLowerCase() || item.id === name);
      if (!option) throw new Error(`"${group.name}" has no option "${name}".`);
      return option.id;
    });
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
      if (!property || !["date", "createdTime", "lastEdited"].includes(property.type)) throw new Error(`"${p.dateProperty}" is not a date property.`);
      view.dateProperty = id;
    }
  }
  if (p.cardPreview) view.cardPreview = p.cardPreview;
  if (typeof p.wrap === "boolean") view.wrap = p.wrap;
  if (view.type === "board" && !view.groupBy) {
    const groupable = schema.properties.find((property) => property.type === "status" || property.type === "select");
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

function rowsInfo(databaseId: string, schema: DatabaseSchema, view: DatabaseView, search: string, limit: number): DatabaseRowInfo[] {
  return applyView(rowsOf(store().pages, databaseId), schema, view, search)
    .slice(0, limit)
    .map((row) => rowInfo(row, schema));
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

export const DATABASE_HANDLERS: Record<string, (p: Params) => unknown> = {
  "databases.getView": (p) => {
    const { schema } = requireDatabase(p.databaseId);
    return viewInfo(p.databaseId, schema, requireView(schema, p.viewId));
  },
  "databases.queryView": (p) => {
    const { schema } = requireDatabase(p.databaseId);
    const view = structuredClone(requireView(schema, p.viewId));
    if (Array.isArray(p.filters)) {
      // Extra filters narrow the view's own: both sets must match.
      const extra = buildFilters(schema, p.filters);
      if (view.filters.length && (view.filterMode ?? "and") === "or") {
        const base = { ...view };
        const baseRows = new Set(applyView(rowsOf(store().pages, p.databaseId), schema, base, "").map((row) => row.id));
        const narrowed = { ...view, filters: extra, filterMode: p.filterMode ?? "and" };
        return applyView(rowsOf(store().pages, p.databaseId).filter((row) => baseRows.has(row.id)), schema, narrowed, p.search ?? "")
          .slice(0, p.limit ?? 200)
          .map((row) => rowInfo(row, schema));
      }
      view.filters = [...view.filters, ...extra];
      if (p.filterMode && !view.filters.length) view.filterMode = p.filterMode;
    }
    if (Array.isArray(p.sorts)) view.sorts = buildSorts(schema, p.sorts);
    return rowsInfo(p.databaseId, schema, view, p.search ?? "", p.limit ?? 200);
  },
  "databases.addView": async (p) => {
    const { schema } = requireDatabase(p.databaseId);
    if (schema.views.length >= MAX_VIEWS) throw new Error(`A database has at most ${MAX_VIEWS} views.`);
    const view = newView((p.type ?? "table") as ViewType, schema, typeof p.name === "string" && p.name.trim() ? p.name.trim() : undefined);
    patchView(schema, view, { ...p, type: undefined });
    schema.views.push(view);
    await saveSchema(p.databaseId, schema);
    return viewInfo(p.databaseId, schema, view);
  },
  "databases.updateView": async (p) => {
    const { schema } = requireDatabase(p.databaseId);
    const view = requireView(schema, p.viewId);
    patchView(schema, view, p);
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
      if (p.type || p.options || p.format) throw new Error("The title column is always text; only its name can change (use name or databases.rename).");
      if (typeof p.name === "string" && p.name.trim()) schema.titleName = p.name.trim().slice(0, 100);
      await saveSchema(meta.id, schema);
      return schemaInfo(meta, schema);
    }
    const index = schema.properties.findIndex((item) => item.id === id);
    const from = schema.properties[index];
    let next: Property = structuredClone(from);
    if (typeof p.name === "string" && p.name.trim()) {
      const name = p.name.trim().slice(0, 100);
      const clash = schema.properties.some((item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase()) || name.toLowerCase() === schema.titleName.toLowerCase();
      if (clash) throw new Error(`Another property is already called "${name}".`);
      next.name = name;
    }
    const rows = rowsOf(store().pages, meta.id);
    const retype = p.type && p.type !== from.type;
    if (retype) {
      const type = p.type as PropertyType;
      next = { ...next, type, options: optionsForTypeChange(from, type, rows), ...(type === "number" ? { format: from.format ?? "number" } : {}) };
      if (!hasOptions(type)) delete next.options;
      if (type !== "number") delete next.format;
      for (const view of schema.views) {
        view.filters = view.filters.filter((rule) => rule.propertyId !== id);
        if (view.groupBy === id && !GROUPABLE.includes(type)) view.groupBy = undefined;
        if (view.dateProperty === id && type !== "date") view.dateProperty = undefined;
        if (view.calcs?.[id]) delete view.calcs[id];
      }
    }
    if (p.format) {
      if (next.type !== "number") throw new Error(`format applies to number properties; "${next.name}" is ${next.type}.`);
      next.format = p.format as NumberFormat;
    }
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
    await saveSchema(meta.id, schema);
    // Convert stored values: retyped properties, and options that no longer exist.
    if (retype || removedOptions?.size) {
      for (const row of rows) {
        const values = parseRowValues(row.meta.data);
        const value = values[id];
        if (value === undefined) continue;
        let converted: unknown = value;
        if (retype) converted = convertStoredValue(value, from, next);
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
      }
      if (view.dateProperty === id) view.dateProperty = undefined;
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
  "databases.rename": async (p) => {
    const { meta, schema } = requireDatabase(p.databaseId);
    if (typeof p.titleColumn === "string" && p.titleColumn.trim()) {
      const name = p.titleColumn.trim().slice(0, 100);
      if (schema.properties.some((item) => item.name.toLowerCase() === name.toLowerCase())) throw new Error(`A property is already called "${name}".`);
      schema.titleName = name;
      await saveSchema(meta.id, schema);
    }
    if (typeof p.title === "string") await store().renamePage(meta.id, p.title);
  },
};
