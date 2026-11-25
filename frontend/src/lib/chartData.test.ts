import { describe, expect, it } from "vitest";
import { bucketStart, buildChartData, compactNumber, EMPTY_KEY, formatChartValue, isoWeek, niceStep, OTHER_KEY, shiftBucket } from "./chartData";
import type { ChartConfig, DatabaseRow, DatabaseSchema, RowValues } from "./database";

const schema: DatabaseSchema = {
  version: 1,
  titleName: "Name",
  views: [],
  properties: [
    {
      id: "status",
      name: "Status",
      type: "status",
      options: [
        { id: "todo", name: "Not started", color: "default", group: "todo" },
        { id: "doing", name: "In progress", color: "blue", group: "inProgress" },
        { id: "done", name: "Done", color: "green", group: "complete" },
      ],
    },
    {
      id: "tags",
      name: "Tags",
      type: "multiSelect",
      options: [
        { id: "a", name: "Alpha", color: "red" },
        { id: "b", name: "Beta", color: "yellow" },
      ],
    },
    { id: "price", name: "Price", type: "number", format: "dollar" },
    { id: "qty", name: "Qty", type: "number" },
    { id: "due", name: "Due", type: "date" },
    { id: "flag", name: "Flag", type: "checkbox" },
    { id: "city", name: "City", type: "text" },
    { id: "double", name: "Double", type: "formula", formula: "prop(\"Price\") * 2", resultType: "number" },
  ],
};

let seq = 0;
function row(values: RowValues, title = `Row ${++seq}`, createdAt = "2026-03-10T09:00:00Z"): DatabaseRow {
  const id = `r${++seq}`;
  return {
    id,
    meta: { id, parentId: "db", title, icon: "", cover: "", position: seq, updatedAt: createdAt, kind: "page", data: "", createdAt },
    values,
  };
}

function build(rows: DatabaseRow[], config: ChartConfig, now?: Date) {
  return buildChartData(rows, schema, config, { now });
}

describe("categories", () => {
  const rows = [
    row({ status: "done", tags: ["a", "b"], price: 10, city: "Paris" }),
    row({ status: "done", tags: ["a"], price: 5, city: "paris" }),
    row({ status: "doing", price: 20, city: "Rome" }),
    row({ tags: [], city: "" }),
  ];

  it("counts options in option order with their colours and No X last", () => {
    const data = build(rows, { kind: "column", x: "status" });
    expect(data.categories.map((c) => c.label)).toEqual(["Not started", "In progress", "Done", "No Status"]);
    expect(data.categories.map((c) => c.color)).toEqual(["default", "blue", "green", undefined]);
    expect(data.series).toHaveLength(1);
    expect(data.series[0].values).toEqual([0, 1, 2, 1]);
    expect(data.total).toBe(4);
    expect(data.rowsByCell("done")).toEqual([rows[0].id, rows[1].id]);
  });

  it("counts multi-select rows under each of their options", () => {
    const data = build(rows, { kind: "bar", x: "tags" });
    expect(data.categories.map((c) => c.key)).toEqual(["a", "b", EMPTY_KEY]);
    expect(data.series[0].values).toEqual([2, 1, 2]);
    expect(data.total).toBe(4);
  });

  it("sums a numeric property and takes its number format", () => {
    const data = build(rows, { kind: "column", x: "status", aggregate: "sum", y: "price" });
    expect(data.series[0].values).toEqual([0, 20, 15, 0]);
    expect(data.valueFormat).toBe("dollar");
    expect(data.measureLabel).toBe("Sum of Price");
    expect(data.total).toBe(35);
  });

  it("averages, medians and extremes ignore blank cells", () => {
    expect(build(rows, { x: "status", aggregate: "average", y: "price" }).series[0].values).toEqual([null, 20, 7.5, null]);
    expect(build(rows, { x: "status", aggregate: "median", y: "price" }).total).toBe(10);
    expect(build(rows, { x: "status", aggregate: "max", y: "price" }).series[0].values[2]).toBe(10);
  });

  it("treats number formulas as numbers", () => {
    // Views receive rows with formula results already filled in.
    const computed = rows.map((r) => ({ ...r, values: { ...r.values, double: typeof r.values.price === "number" ? r.values.price * 2 : undefined } }));
    const data = build(computed, { x: "status", aggregate: "sum", y: "double" });
    expect(data.issue).toBeUndefined();
    expect(data.total).toBe(70);
  });

  it("counts unique values", () => {
    const data = build(rows, { kind: "number", aggregate: "countUnique", y: "city" });
    expect(data.total).toBe(2);
    expect(build(rows, { kind: "number", aggregate: "countValues", y: "tags" }).total).toBe(3);
  });

  it("groups text case-insensitively and sorts it by value", () => {
    const data = build(rows, { kind: "bar", x: "city" });
    expect(data.categories.map((c) => c.label)).toEqual(["Paris", "Rome", "No City"]);
    expect(data.series[0].values).toEqual([2, 1, 1]);
  });

  it("splits checkboxes", () => {
    const data = build([row({ flag: true }), row({ flag: false }), row({})], { x: "flag" });
    expect(data.categories.map((c) => [c.label, c.color])).toEqual([
      ["Checked", "green"],
      ["Unchecked", "default"],
    ]);
    expect(data.series[0].values).toEqual([1, 2]);
  });

  it("sorts by label and value", () => {
    expect(build(rows, { x: "status", sort: "valueDesc" }).categories.map((c) => c.key)).toEqual(["done", "doing", "todo", EMPTY_KEY]);
    expect(build(rows, { x: "status", sort: "value" }).categories.map((c) => c.key)).toEqual(["todo", "doing", "done", EMPTY_KEY]);
    expect(build(rows, { x: "status", sort: "label" }).categories.map((c) => c.label)).toEqual(["Done", "In progress", "Not started", "No Status"]);
  });

  it("omits empty categories and the No X bucket", () => {
    const data = build(rows, { x: "status", omitEmpty: true });
    expect(data.categories.map((c) => c.key)).toEqual(["doing", "done"]);
  });

  it("merges the tail into Other without double counting", () => {
    const many = Array.from({ length: 6 }, (_, i) => row({ city: `C${i}`, tags: ["a"] }));
    many.push(row({ city: "C0" }));
    const data = build(many, { kind: "bar", x: "city", limit: 3 });
    expect(data.categories.map((c) => c.label)).toEqual(["C0", "C1", "Other"]);
    expect(data.series[0].values).toEqual([2, 1, 4]);
    expect(data.rowsByCell(OTHER_KEY)).toHaveLength(4);
    expect(data.truncated).toBe(true);
  });

  it("funnels sort by value", () => {
    const data = build(rows, { kind: "funnel", x: "status" });
    expect(data.categories[0].key).toBe("done");
  });
});

describe("series", () => {
  const rows = [
    row({ status: "done", tags: ["a"], price: 1 }),
    row({ status: "done", tags: ["b"], price: 2 }),
    row({ status: "doing", tags: ["a", "b"], price: 4 }),
  ];

  it("splits categories by a second property", () => {
    const data = build(rows, { kind: "column", x: "status", series: "tags", aggregate: "sum", y: "price" });
    expect(data.series.map((s) => [s.label, s.color])).toEqual([
      ["Alpha", "red"],
      ["Beta", "yellow"],
    ]);
    expect(data.categories.map((c) => c.key)).toEqual(["todo", "doing", "done"]);
    expect(data.series[0].values).toEqual([0, 4, 1]);
    expect(data.series[1].values).toEqual([0, 4, 2]);
    expect(data.rowsByCell("done", "b")).toEqual([rows[1].id]);
  });

  it("normalizes each category to 100%", () => {
    const data = build(rows, { kind: "column", x: "status", series: "tags", stacked: true, normalize: true, omitEmpty: true });
    expect(data.valueFormat).toBe("percent");
    expect(data.series[0].values).toEqual([0.5, 0.5]);
    expect(data.series[1].values).toEqual([0.5, 0.5]);
  });

  it("ignores series on pies", () => {
    expect(build(rows, { kind: "pie", x: "status", series: "tags" }).series).toHaveLength(1);
  });
});

describe("dates", () => {
  const rows = [
    row({ due: { start: "2026-01-05" }, price: 1 }),
    row({ due: { start: "2026-01-20" }, price: 2 }),
    row({ due: { start: "2026-04-02" }, price: 4 }),
    row({ price: 8 }),
  ];

  it("buckets by month, fills gaps and drops undated rows", () => {
    const data = build(rows, { kind: "line", x: "due", dateBucket: "month" });
    expect(data.categories.map((c) => c.key)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"]);
    expect(data.series[0].values).toEqual([2, 0, 0, 1]);
    expect(data.categories[0].fullLabel).toMatch(/2026/);
  });

  it("does not fill gaps on pies, and keeps No X there", () => {
    const data = build(rows, { kind: "pie", x: "due", dateBucket: "month" });
    expect(data.categories.map((c) => c.key)).toEqual(["2026-01-01", "2026-04-01", EMPTY_KEY]);
  });

  it("runs cumulative totals", () => {
    const data = build(rows, { kind: "area", x: "due", dateBucket: "month", aggregate: "sum", y: "price", cumulative: true });
    expect(data.series[0].values).toEqual([3, 3, 3, 7]);
  });

  it("buckets quarters and ISO weeks", () => {
    expect(build(rows, { kind: "column", x: "due", dateBucket: "quarter" }).categories.map((c) => c.label)).toEqual(["Q1", "Q2"]);
    expect(bucketStart("2026-01-01", "week")).toBe("2025-12-29");
    expect(bucketStart("2026-03-15", "week")).toBe("2026-03-09");
    expect(isoWeek("2026-01-01")).toBe(1);
    expect(isoWeek("2025-12-29")).toBe(1);
    expect(isoWeek("2027-01-01")).toBe(53);
    expect(shiftBucket("2026-11-01", "quarter")).toBe("2027-02-01");
  });

  it("keeps the latest N buckets when limited", () => {
    const data = build(rows, { kind: "column", x: "due", dateBucket: "month", limit: 2 });
    expect(data.categories.map((c) => c.key)).toEqual(["2026-03-01", "2026-04-01"]);
  });

  it("uses created time as a virtual property", () => {
    const data = build([row({}, "a", "2026-02-01T10:00:00Z"), row({}, "b", "2026-02-03T10:00:00Z")], { kind: "line", x: "createdTime", dateBucket: "month" });
    expect(data.issue).toBeUndefined();
    expect(data.series[0].values).toEqual([2]);
  });

  it("builds a calendar heatmap by day", () => {
    const data = build(rows, { kind: "heatmap", x: "due" });
    expect(data.calendar).toBe(true);
    expect(data.bucket).toBe("day");
    expect(data.categories.map((c) => c.key)).toEqual(["2026-01-05", "2026-01-20", "2026-04-02"]);
  });
});

describe("numbers on the x axis", () => {
  it("keeps few distinct numbers as categories", () => {
    const data = build([row({ qty: 3 }), row({ qty: 1 }), row({ qty: 3 })], { x: "qty" });
    expect(data.categories.map((c) => c.label)).toEqual(["1", "3"]);
  });

  it("bins many distinct numbers into round ranges", () => {
    const rows = Array.from({ length: 50 }, (_, i) => row({ qty: i * 2 }));
    const data = build(rows, { kind: "column", x: "qty" });
    expect(data.categories.length).toBeLessThanOrEqual(13);
    expect(data.categories[0].label).toBe("0–10");
    expect(data.series[0].values.reduce((a, b) => a! + b!, 0)).toBe(50);
  });

  it("plots scatter points", () => {
    const rows = [row({ qty: 1, price: 5, status: "done" }), row({ qty: 2, price: 7, status: "doing" }), row({ qty: 3 })];
    const data = build(rows, { kind: "scatter", x: "qty", y: "price", series: "status" });
    expect(data.points.map((p) => [p.x, p.y, p.series])).toEqual([
      [1, 5, "done"],
      [2, 7, "doing"],
    ]);
    expect(data.series.map((s) => s.key)).toEqual(["doing", "done"]);
  });
});

describe("issues", () => {
  it("reports what is missing", () => {
    expect(build([], { x: "status" }).issue).toBe("noRows");
    expect(build([row({})], { x: "gone" }).issue).toBe("missingX");
    expect(build([row({})], { x: "status", aggregate: "sum" }).issue).toBe("needsNumber");
    expect(build([row({})], { x: "status", aggregate: "sum", y: "city" }).issue).toBe("needsNumber");
    expect(build([row({})], { x: "status", aggregate: "countUnique" }).issue).toBe("needsProperty");
    expect(build([row({})], { kind: "scatter", x: "status", y: "price" }).issue).toBe("needsAxes");
  });
});

describe("number KPI", () => {
  const rows = [
    row({ due: { start: "2026-10-03" }, price: 10 }),
    row({ due: { start: "2026-11-02" }, price: 6 }),
    row({ due: { start: "2026-11-20" }, price: 6 }),
  ];

  it("compares the current bucket with the previous one", () => {
    const data = build(rows, { kind: "number", x: "due", dateBucket: "month", aggregate: "sum", y: "price" }, new Date(2026, 10, 25));
    expect(data.total).toBe(22);
    expect(data.kpi?.current).toBe(12);
    expect(data.kpi?.previous).toBe(10);
    expect(data.kpi?.change).toBeCloseTo(0.2);
    expect(data.kpi?.compareLabel).toBe("vs last month");
    expect(data.kpi?.trend).toHaveLength(12);
    expect(data.kpi?.trend?.slice(-2)).toEqual([10, 12]);
  });

  it("falls back to the latest bucket with data", () => {
    const data = build(rows, { kind: "number", x: "due", dateBucket: "month" }, new Date(2027, 5, 1));
    expect(data.kpi?.current).toBe(2);
    expect(data.kpi?.currentLabel).toMatch(/November 2026/);
  });

  it("is a plain total without a date", () => {
    expect(build(rows, { kind: "number" }).kpi).toEqual({ value: 3 });
  });
});

describe("formatting", () => {
  it("shortens numbers", () => {
    expect(compactNumber(1234)).toBe("1.2k");
    expect(compactNumber(12_500)).toBe("12.5k");
    expect(compactNumber(250_000)).toBe("250k");
    expect(compactNumber(3_400_000)).toBe("3.4M");
    expect(compactNumber(0.25)).toBe("0.25");
    expect(compactNumber(42)).toBe("42");
    expect(formatChartValue(1500, "dollar", true)).toBe("$1.5k");
    expect(formatChartValue(0.123, "percent")).toBe("12%");
    expect(formatChartValue(null, "number")).toBe("–");
    expect(niceStep(98, 12)).toBe(10);
  });
});
