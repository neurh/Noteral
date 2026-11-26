import { renameRefs } from "../../lib/formula";
import {
  BOARD_GROUP_TYPES,
  TITLE_ID,
  convertValue,
  isFilterGroup,
  defaultStatusOptions,
  hasOptions,
  optionsForTypeChange,
  orderedPropertyIds,
  typeName,
  uid,
  uniquePropertyName,
  type DatabaseSchema,
  type DatabaseView,
  type FilterGroup,
  type FilterNode,
  type Property,
  type PropertyType,
} from "../../lib/database";
import type { DatabaseApi } from "./useDatabase";

export function findView(schema: DatabaseSchema, viewId: string): DatabaseView | undefined {
  return schema.views.find((view) => view.id === viewId);
}

/** Adds a property; with `viewId` and `beside` it is placed next to a column. */
export function addProperty(
  db: DatabaseApi,
  type: PropertyType,
  options: { viewId?: string; beside?: string; side?: "left" | "right"; name?: string } = {},
): Property {
  const property: Property = {
    id: uid("prop"),
    name: uniquePropertyName(db.schema, options.name ?? typeName(type)),
    type,
    ...(hasOptions(type) ? { options: type === "status" ? defaultStatusOptions() : [] } : {}),
    ...(type === "number" ? { format: "number" as const } : {}),
  };
  db.updateSchema((schema) => {
    const index = options.beside ? schema.properties.findIndex((p) => p.id === options.beside) : -1;
    if (index >= 0) schema.properties.splice(options.side === "left" ? index : index + 1, 0, property);
    else schema.properties.push(property);
    for (const view of schema.views) {
      const order = orderedPropertyIds({ ...schema, properties: schema.properties.filter((p) => p.id !== property.id) }, view);
      const at = options.beside ? order.indexOf(options.beside) : -1;
      if (at >= 0 && view.id === options.viewId) order.splice(options.side === "left" ? at : at + 1, 0, property.id);
      else order.push(property.id);
      view.order = order;
      // A new property is visible where it was added, and in tables; card
      // layouts stay quiet until it is switched on.
      if (view.id !== options.viewId && (view.type === "gallery" || view.type === "list")) view.hidden = [...view.hidden, property.id];
    }
    if (!schema.views.some((view) => view.type === "board" && view.groupBy) && (type === "status" || type === "select")) {
      for (const view of schema.views) if (view.type === "board" && !view.groupBy) view.groupBy = property.id;
    }
    if (type === "date") for (const view of schema.views) if (view.type === "calendar" && !view.dateProperty) view.dateProperty = property.id;
  });
  return property;
}

export function removeProperty(db: DatabaseApi, propertyId: string) {
  if (propertyId === TITLE_ID) return;
  db.updateSchema((schema) => {
    schema.properties = schema.properties.filter((p) => p.id !== propertyId);
    for (const view of schema.views) {
      view.filters = view.filters.filter((rule) => rule.propertyId !== propertyId);
      view.sorts = view.sorts.filter((sort) => sort.propertyId !== propertyId);
      if (view.advanced) view.advanced = pruneRules(view.advanced, propertyId);
      view.hidden = view.hidden.filter((id) => id !== propertyId);
      view.order = view.order.filter((id) => id !== propertyId);
      delete view.widths[propertyId];
      if (view.groupBy === propertyId) view.groupBy = undefined;
      if (view.dateProperty === propertyId) view.dateProperty = undefined;
    }
  });
}

export function duplicateProperty(db: DatabaseApi, propertyId: string, viewId?: string) {
  const source = db.schema.properties.find((p) => p.id === propertyId);
  if (!source) return;
  const copy: Property = {
    ...structuredClone(source),
    id: uid("prop"),
    name: uniquePropertyName(db.schema, source.name),
  };
  db.updateSchema((schema) => {
    const index = schema.properties.findIndex((p) => p.id === propertyId);
    schema.properties.splice(index + 1, 0, copy);
    for (const view of schema.views) {
      const order = orderedPropertyIds({ ...schema, properties: schema.properties.filter((p) => p.id !== copy.id) }, view);
      order.splice(order.indexOf(propertyId) + 1, 0, copy.id);
      view.order = order;
      if (view.hidden.includes(propertyId) || (view.id !== viewId && (view.type === "gallery" || view.type === "list"))) view.hidden = [...view.hidden, copy.id];
    }
  });
  for (const row of db.rows) {
    if (row.values[propertyId] !== undefined) db.setValues(row.id, (values) => ({ ...values, [copy.id]: structuredClone(row.values[propertyId]) }), { force: true });
  }
}

export function renameProperty(db: DatabaseApi, propertyId: string, name: string) {
  const clean = name.trim();
  if (!clean) return;
  db.updateSchema((schema) => {
    const before = propertyId === TITLE_ID ? schema.titleName ?? "Name" : schema.properties.find((p) => p.id === propertyId)?.name;
    if (propertyId === TITLE_ID) schema.titleName = clean;
    else {
      const property = schema.properties.find((p) => p.id === propertyId);
      if (property) property.name = clean;
    }
    // Formulas refer to properties by name: keep them pointing at the renamed one.
    if (before && before !== clean) {
      for (const property of schema.properties) {
        if (property.type === "formula" && property.formula) property.formula = renameRefs(property.formula, before, clean);
      }
    }
  });
}

/** Changes a property's type and converts every row's value. */
export function changePropertyType(db: DatabaseApi, propertyId: string, type: PropertyType) {
  const from = db.schema.properties.find((p) => p.id === propertyId);
  if (!from || from.type === type) return;
  const options = optionsForTypeChange(from, type, db.rows);
  const to: Property = {
    ...from,
    type,
    options,
    ...(type === "number" ? { format: from.format ?? "number" } : {}),
    ...(type === "formula" ? { formula: from.formula ?? "" } : {}),
  };
  if (!hasOptions(type)) delete to.options;
  if (type !== "number" && type !== "formula") delete to.display;
  db.updateSchema((schema) => {
    const index = schema.properties.findIndex((p) => p.id === propertyId);
    if (index >= 0) schema.properties[index] = to;
    for (const view of schema.views) {
      // Filters written for the old type no longer mean anything.
      view.filters = view.filters.filter((rule) => rule.propertyId !== propertyId);
      if (view.advanced) view.advanced = pruneRules(view.advanced, propertyId);
      if (view.groupBy === propertyId && view.type === "board" && !BOARD_GROUP_TYPES.includes(type)) view.groupBy = undefined;
      if (view.dateProperty === propertyId && type !== "date") view.dateProperty = undefined;
    }
  });
  for (const row of db.rows) {
    const value = row.values[propertyId];
    if (value === undefined) continue;
    const next = convertValue(value, from, to);
    db.setValues(row.id, (values) => ({ ...values, [propertyId]: next }), { force: true });
  }
}

/** Drops rules about one property from a filter tree (empty groups go too). */
export function pruneRules(group: FilterGroup, propertyId: string): FilterGroup {
  const items: FilterNode[] = [];
  for (const node of group.items) {
    if (isFilterGroup(node)) {
      const inner = pruneRules(node, propertyId);
      if (inner.items.length) items.push(inner);
    } else if (node.propertyId !== propertyId) items.push(node);
  }
  return { ...group, items };
}

export function updateView(db: DatabaseApi, viewId: string, change: (view: DatabaseView) => void) {
  db.updateSchema((schema) => {
    const view = findView(schema, viewId);
    if (view) change(view);
  });
}

export function setPropertyHidden(db: DatabaseApi, viewId: string, propertyId: string, hidden: boolean) {
  if (propertyId === TITLE_ID) return;
  updateView(db, viewId, (view) => {
    view.hidden = hidden ? [...new Set([...view.hidden, propertyId])] : view.hidden.filter((id) => id !== propertyId);
  });
}

/** Moves a property in a view's order to sit before `beforeId` ("" = end). */
export function movePropertyInView(db: DatabaseApi, viewId: string, propertyId: string, beforeId: string) {
  if (propertyId === beforeId) return;
  db.updateSchema((schema) => {
    const view = findView(schema, viewId);
    if (!view) return;
    const order = orderedPropertyIds(schema, view).filter((id) => id !== propertyId);
    const at = beforeId ? order.indexOf(beforeId) : -1;
    if (at >= 0) order.splice(at, 0, propertyId);
    else order.push(propertyId);
    view.order = order;
  });
}
