import { describe, expect, it } from "vitest";
import type { PageMeta } from "./api";
import {
  NO_GROUP,
  TITLE_ID,
  applyView,
  computeCalc,
  convertValue,
  defaultSchema,
  filterIsActive,
  formatNumber,
  groupRows,
  newView,
  parseRowValues,
  parseSchema,
  rowsOf,
  seedValuesForView,
  serializeRowValues,
  serializeSchema,
  visiblePropertyIds,
  type DatabaseRow,
  type DatabaseSchema,
  type Property,
} from "./database";

function meta(id: string, title: string, parentId: string, position: number, values: Record<string, unknown> = {}): PageMeta {
  return {
    id,
    title,
    parentId,
    position,
    icon: "",
    cover: "",
    kind: "page",
    data: JSON.stringify({ values }),
    createdAt: "2026-01-01T10:00:00Z",
    updatedAt: "2026-01-02T10:00:00Z",
  } as unknown as PageMeta;
}

function fixture() {
  const schema: DatabaseSchema = defaultSchema();
  const status = schema.properties.find((p) => p.type === "status")!;
  const tags = schema.properties.find((p) => p.type === "multiSelect")!;
  const date = schema.properties.find((p) => p.type === "date")!;
  const estimate: Property = { id: "prop_est", name: "Estimate", type: "number" };
  tags.options = [
    { id: "t_ui", name: "UI", color: "blue" },
    { id: "t_bug", name: "Bug", color: "red" },
  ];
  schema.properties.push(estimate);
  const [todo, doing, done] = status.options!;
  const pages = [
    meta("r1", "Write spec", "db", 1, { [status.id]: done.id, [tags.id]: ["t_ui"], [date.id]: { start: "2026-03-02" }, prop_est: 3 }),
    meta("r2", "Fix crash", "db", 2, { [status.id]: doing.id, [tags.id]: ["t_bug", "t_ui"], prop_est: 8 }),
    meta("r3", "Polish board", "db", 3, { [status.id]: todo.id, [date.id]: { start: "2026-03-10" } }),
    meta("x1", "Elsewhere", "other", 1),
  ];
  return { schema, status, tags, date, estimate, todo, doing, done, rows: rowsOf(pages, "db") };
}

describe("schema", () => {
  it("round-trips and survives garbage", () => {
    const schema = defaultSchema();
    expect(parseSchema(serializeSchema(schema))).toEqual(schema);
    const broken = parseSchema("{not json");
    expect(broken.views).toHaveLength(1);
    expect(broken.properties).toEqual([]);
    const partial = parseSchema(JSON.stringify({ properties: [{ id: "a", type: "select" }, { nope: 1 }], views: [{ id: "v", type: "weird" }] }));
    expect(partial.properties).toEqual([{ id: "a", type: "select", name: "", options: [] }]);
    expect(partial.views[0].type).toBe("table");
    expect(partial.titleName).toBe("Name");
  });

  it("new views pick sensible defaults", () => {
    const schema = defaultSchema();
    expect(newView("board", schema).groupBy).toBe(schema.properties[0].id);
    expect(newView("calendar", schema).dateProperty).toBe(schema.properties[2].id);
    expect(newView("gallery", schema).hidden).toEqual([schema.properties[2].id]);
  });

  it("orders visible properties with the title first", () => {
    const { schema } = fixture();
    const view = schema.views[0];
    expect(visiblePropertyIds(schema, view)[0]).toBe(TITLE_ID);
    view.hidden = [schema.properties[1].id];
    expect(visiblePropertyIds(schema, view)).not.toContain(schema.properties[1].id);
  });
});

describe("row values", () => {
  it("drops empty values when serialising", () => {
    const raw = serializeRowValues({ a: "", b: [], c: null, d: 0, e: false, f: "x" });
    expect(parseRowValues(raw)).toEqual({ d: 0, e: false, f: "x" });
    expect(parseRowValues("oops")).toEqual({});
  });

  it("collects only the database's rows in position order", () => {
    const { rows } = fixture();
    expect(rows.map((row) => row.id)).toEqual(["r1", "r2", "r3"]);
  });
});

describe("applyView", () => {
  it("filters by status, tags, numbers and dates", () => {
    const { schema, rows, status, tags, date, done } = fixture();
    const view = newView("table", schema);
    view.filters = [{ id: "f1", propertyId: status.id, op: "isNot", value: done.id }];
    expect(applyView(rows, schema, view).map((r) => r.id)).toEqual(["r2", "r3"]);
    view.filters = [{ id: "f2", propertyId: tags.id, op: "contains", value: "t_ui" }];
    expect(applyView(rows, schema, view).map((r) => r.id)).toEqual(["r1", "r2"]);
    view.filters = [{ id: "f3", propertyId: "prop_est", op: "gt", value: 4 }];
    expect(applyView(rows, schema, view).map((r) => r.id)).toEqual(["r2"]);
    view.filters = [{ id: "f4", propertyId: date.id, op: "onOrAfter", value: "2026-03-05" }];
    expect(applyView(rows, schema, view).map((r) => r.id)).toEqual(["r3"]);
    view.filters = [{ id: "f5", propertyId: date.id, op: "isEmpty" }];
    expect(applyView(rows, schema, view).map((r) => r.id)).toEqual(["r2"]);
  });

  it("combines filters with and/or and ignores incomplete rules", () => {
    const { schema, rows, tags } = fixture();
    const view = newView("table", schema);
    view.filters = [
      { id: "a", propertyId: tags.id, op: "contains", value: "t_bug" },
      { id: "b", propertyId: TITLE_ID, op: "contains", value: "spec" },
    ];
    expect(applyView(rows, schema, view)).toHaveLength(0);
    view.filterMode = "or";
    expect(applyView(rows, schema, view).map((r) => r.id)).toEqual(["r1", "r2"]);
    const incomplete = { id: "c", propertyId: TITLE_ID, op: "contains" as const, value: "" };
    expect(filterIsActive(incomplete)).toBe(false);
    view.filters = [incomplete];
    expect(applyView(rows, schema, view)).toHaveLength(3);
  });

  it("searches titles and option names", () => {
    const { schema, rows } = fixture();
    const view = newView("table", schema);
    expect(applyView(rows, schema, view, "crash").map((r) => r.id)).toEqual(["r2"]);
    expect(applyView(rows, schema, view, "bug").map((r) => r.id)).toEqual(["r2"]);
  });

  it("sorts with empty values last in both directions", () => {
    const { schema, rows, date } = fixture();
    const view = newView("table", schema);
    view.sorts = [{ propertyId: "prop_est", direction: "desc" }];
    expect(applyView(rows, schema, view).map((r) => r.id)).toEqual(["r2", "r1", "r3"]);
    view.sorts = [{ propertyId: date.id, direction: "desc" }];
    expect(applyView(rows, schema, view).map((r) => r.id)).toEqual(["r3", "r1", "r2"]);
    view.sorts = [{ propertyId: date.id, direction: "asc" }];
    expect(applyView(rows, schema, view).map((r) => r.id)).toEqual(["r1", "r3", "r2"]);
  });
});

describe("board groups", () => {
  it("groups by option with a no-value column", () => {
    const { rows, status, tags } = fixture();
    const groups = groupRows(rows, status);
    expect(groups.map((g) => g.rows.length)).toEqual([0, 1, 1, 1]);
    expect(groups[0].id).toBe(NO_GROUP);
    const byTag = groupRows(rows, tags);
    expect(byTag.find((g) => g.id === "t_ui")!.rows.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(byTag[0].rows.map((r) => r.id)).toEqual(["r3"]);
  });

  it("seeds new rows so they land inside the filtered view", () => {
    const { schema, status, doing } = fixture();
    const view = newView("table", schema);
    view.filters = [{ id: "f", propertyId: status.id, op: "is", value: doing.id }];
    expect(seedValuesForView(schema, view)).toEqual({ [status.id]: doing.id });
  });
});

describe("conversion and calculations", () => {
  it("converts values between types", () => {
    const { tags } = fixture();
    const text: Property = { id: "t", name: "T", type: "text" };
    const num: Property = { id: "n", name: "N", type: "number" };
    const select: Property = { id: "s", name: "S", type: "select", options: [{ id: "o1", name: "Bug", color: "red" }] };
    expect(convertValue(["t_bug", "t_ui"], tags, text)).toBe("Bug, UI");
    expect(convertValue("$1,250.5", text, num)).toBe(1250.5);
    expect(convertValue("abc", text, num)).toBeUndefined();
    expect(convertValue(["t_bug"], tags, select)).toBe("o1");
  });

  it("formats numbers", () => {
    expect(formatNumber(1234.5, "commas")).toMatch(/1.234.5/);
    expect(formatNumber(0.25, "percent")).toMatch(/25/);
    expect(formatNumber(12, "dollar")).toMatch(/\$12/);
  });

  it("computes column calculations", () => {
    const { rows, estimate, date } = fixture();
    expect(computeCalc(rows, estimate, "sum")).toBe("11");
    expect(computeCalc(rows, estimate, "countAll")).toBe("3");
    expect(computeCalc(rows, date, "countEmpty")).toBe("1");
  });
});

// Keep the helper type exercised so unused-import lint stays quiet.
export type _Rows = DatabaseRow[];
