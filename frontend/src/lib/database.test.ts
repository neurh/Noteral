import { describe, expect, it } from "vitest";
import type { PageMeta } from "./api";
import {
  NO_GROUP,
  TITLE_ID,
  applyView,
  canGroupBy,
  computeCalc,
  countRules,
  emptyFilterGroup,
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
import { withFormulas } from "./databaseFormulas";

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

describe("advanced filters, grouping and formulas", () => {
  it("matches nested and/or groups together with the simple filters", () => {
    const { schema, rows, status, tags, done } = fixture();
    const view = newView("table", schema);
    // (status is done) OR (tags contain Bug AND estimate > 5)
    view.advanced = {
      id: "g0",
      mode: "or",
      items: [
        { id: "a1", propertyId: status.id, op: "is", value: done.id },
        {
          id: "g1",
          mode: "and",
          items: [
            { id: "a2", propertyId: tags.id, op: "contains", value: "t_bug" },
            { id: "a3", propertyId: "prop_est", op: "gt", value: 5 },
          ],
        },
      ],
    };
    expect(applyView(rows, schema, view).map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(countRules(view.advanced)).toBe(3);
    // Simple filters still apply on top (AND).
    view.filters = [{ id: "f1", propertyId: "prop_est", op: "lt", value: 5 }];
    expect(applyView(rows, schema, view).map((r) => r.id)).toEqual(["r1"]);
    // An empty group matches everything.
    view.filters = [];
    view.advanced = emptyFilterGroup("and");
    expect(applyView(rows, schema, view)).toHaveLength(3);
  });

  it("groups table rows by number, text and date", () => {
    const { rows, estimate, date } = fixture();
    const byNumber = groupRows(rows, estimate);
    expect(byNumber.find((g) => g.name === "8")?.rows.map((r) => r.id)).toEqual(["r2"]);
    expect(byNumber[byNumber.length - 1].id).toBe(NO_GROUP);
    const byDate = groupRows(rows, date);
    const march = byDate.find((g) => g.id.startsWith("v:2026-03"));
    expect(march?.rows.map((r) => r.id).sort()).toEqual(["r1", "r3"]);
    expect(canGroupBy(estimate)).toBe(true);
  });

  it("computes formula properties that filters, sorts and groups can use", () => {
    const { schema, rows, estimate } = fixture();
    const points: Property = { id: "prop_pts", name: "Points", type: "formula", formula: 'prop("Estimate") * 2' };
    const label: Property = { id: "prop_lbl", name: "Size", type: "formula", formula: 'if({Points} > 10, "Big", "Small")' };
    schema.properties.push(points, label);
    const result = withFormulas(rows, schema);
    expect(result.issues).toEqual([]);
    const byId = new Map(result.rows.map((r) => [r.id, r]));
    expect(byId.get("r2")?.values.prop_pts).toBe(16);
    expect(byId.get("r2")?.values.prop_lbl).toBe("Big");
    expect(byId.get("r1")?.values.prop_lbl).toBe("Small");
    expect(result.schema.properties.find((p) => p.id === "prop_pts")?.resultType).toBe("number");
    const view = newView("table", result.schema);
    view.filters = [{ id: "f1", propertyId: "prop_pts", op: "gt", value: 10 }];
    expect(applyView(result.rows, result.schema, view).map((r) => r.id)).toEqual(["r2"]);
    view.filters = [];
    view.sorts = [{ propertyId: "prop_pts", direction: "desc" }];
    expect(applyView(result.rows, result.schema, view)[0].id).toBe("r2");
    // Source rows are untouched: formula values are never stored.
    expect(rows.find((r) => r.id === "r2")?.values.prop_pts).toBeUndefined();
    expect(estimate.type).toBe("number");
  });

  it("reports cycles and unknown properties as issues", () => {
    const { schema, rows } = fixture();
    schema.properties.push(
      { id: "fa", name: "A", type: "formula", formula: "{B} + 1" },
      { id: "fb", name: "B", type: "formula", formula: "{A} + 1" },
      { id: "fc", name: "C", type: "formula", formula: 'prop("Nope")' },
    );
    const result = withFormulas(rows, schema);
    const ids = new Set(result.issues.map((issue) => issue.propertyId));
    expect(ids.has("fa") || ids.has("fb")).toBe(true);
    expect(ids.has("fc") || result.rowErrors.size > 0).toBe(true);
  });
});

describe("database lock", () => {
  it("round-trips locked and drops anything that isn't true", () => {
    const schema = parseSchema(serializeSchema({ ...parseSchema(undefined), locked: true }));
    expect(schema.locked).toBe(true);
    expect(parseSchema(JSON.stringify({ ...parseSchema(undefined), locked: "yes" })).locked).toBeUndefined();
    expect(parseSchema(undefined).locked).toBeUndefined();
  });
});
