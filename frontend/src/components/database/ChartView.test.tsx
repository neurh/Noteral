// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChartConfig, ChartKind, DatabaseRow, DatabaseSchema, DatabaseView } from "../../lib/database";
import { buildChartData } from "../../lib/chartData";
import { ChartSettings } from "./ChartSettings";
import { ChartView } from "./ChartView";
import { readChartTheme } from "./chartTheme";
import type { DatabaseApi } from "./useDatabase";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // jsdom has no canvas; echarts only needs text measuring from it.
  HTMLCanvasElement.prototype.getContext = (() => ({ font: "", measureText: (text: string) => ({ width: text.length * 6 }) })) as unknown as HTMLCanvasElement["getContext"];
  // jsdom has no layout; give the chart a size.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 320 });
});
afterEach(cleanup);

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
        { id: "todo", name: "Not started", color: "default" },
        { id: "doing", name: "In progress", color: "blue" },
        { id: "done", name: "Done", color: "green" },
      ],
    },
    { id: "price", name: "Price", type: "number", format: "dollar" },
    { id: "qty", name: "Qty", type: "number" },
    { id: "due", name: "Due", type: "date" },
  ],
};

const rows: DatabaseRow[] = Array.from({ length: 24 }, (_, i) => ({
  id: `r${i}`,
  meta: { id: `r${i}`, parentId: "db", title: `Task ${i}`, icon: "", cover: "", position: i, updatedAt: "2026-03-10T09:00:00Z", kind: "page", data: "", createdAt: "2026-03-10T09:00:00Z" },
  values: { status: ["todo", "doing", "done"][i % 3], price: 10 + i * 3, qty: i % 7, due: { start: `2026-${String(1 + (i % 10)).padStart(2, "0")}-${String(1 + i).padStart(2, "0")}` } },
})) as unknown as DatabaseRow[];

function viewWith(chart: ChartConfig): DatabaseView {
  return { id: "v1", name: "Chart", type: "chart", filters: [], sorts: [], hidden: [], order: [], widths: {}, chart } as DatabaseView;
}

function api(updateSchema = vi.fn()): DatabaseApi {
  return { schema, rows, openRow: vi.fn(), updateSchema } as unknown as DatabaseApi;
}

describe("chart engine", () => {
  const kinds: [ChartKind, ChartConfig][] = [
    ["column", { x: "status" }],
    ["bar", { x: "status", series: "status", aggregate: "sum", y: "price", stacked: true, goal: 100 }],
    ["line", { x: "due", dateBucket: "month", cumulative: true, smooth: true }],
    ["area", { x: "due", series: "status", stacked: true, normalize: true }],
    ["pie", { x: "status", labels: true }],
    ["donut", { x: "status", aggregate: "sum", y: "price" }],
    ["scatter", { x: "price", y: "qty", series: "status" }],
    ["funnel", { x: "status" }],
    ["radar", { x: "status", series: "qty" }],
    ["heatmap", { x: "due" }],
    ["heatmap", { x: "status", series: "qty" }],
  ];
  it.each(kinds)("builds a %s option and renders SVG", async (kind, config) => {
    const { buildOption, mountChart } = await import("./chartEngine");
    const data = buildChartData(rows, schema, { kind, ...config }, { now: new Date(2026, 10, 25) });
    expect(data.issue).toBeUndefined();
    const theme = readChartTheme();
    const option = buildOption(data, theme, { width: 640, height: 320 }, false);
    expect(option.series).toBeTruthy();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const chart = mountChart(el, () => {});
    chart.update(data, theme, { width: 640, height: 320 });
    chart.update(data, theme, { width: 640, height: 320 });
    expect(el.querySelector("svg")).not.toBeNull();
    chart.dispose();
    el.remove();
  });
});

describe("ChartView", () => {
  it("renders a column chart after the engine loads", async () => {
    const { container } = render(<ChartView db={api()} view={viewWith({ kind: "column", x: "status" })} rows={rows} inline />);
    expect(container.querySelector(".db-chart-head")?.textContent).toContain("24 total");
    await act(async () => {
      await import("./chartEngine");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.querySelector(".db-chart-canvas svg")).not.toBeNull();
  });

  it("renders a KPI tile for number charts", () => {
    render(<ChartView db={api()} view={viewWith({ kind: "number", aggregate: "sum", y: "price" })} rows={rows} />);
    expect(screen.getByText("$1,068")).toBeTruthy();
  });

  it("explains a misconfigured chart and offers settings", () => {
    const onOpenSettings = vi.fn();
    render(<ChartView db={api()} view={viewWith({ kind: "column", x: "status", aggregate: "sum" })} rows={rows} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByText("Choose a number property"));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("shows the empty state without rows", () => {
    render(<ChartView db={{ ...api(), rows: [] } as DatabaseApi} view={viewWith({ kind: "column", x: "status" })} rows={[]} />);
    expect(screen.getByText("No rows to chart.")).toBeTruthy();
  });
});

describe("ChartSettings", () => {
  it("switches kind and keeps a coherent config", () => {
    const updateSchema = vi.fn();
    const view = viewWith({ kind: "column", x: "status" });
    render(<ChartSettings db={api(updateSchema)} view={view} inline />);
    fireEvent.click(screen.getByRole("radio", { name: "Scatter" }));
    const change = updateSchema.mock.calls[0][0] as (s: DatabaseSchema) => void;
    const draft: DatabaseSchema = { ...schema, views: [structuredClone(view)] };
    change(draft);
    expect(draft.views[0].chart).toMatchObject({ kind: "scatter", x: "price", y: "qty" });
    expect(screen.getByText("Height")).toBeTruthy();
  });

  it("stores explicit off for default-on toggles", () => {
    const updateSchema = vi.fn();
    const view = viewWith({ kind: "column", x: "status" });
    render(<ChartSettings db={api(updateSchema)} view={view} />);
    fireEvent.click(screen.getByRole("switch", { name: "Gridlines" }));
    const draft: DatabaseSchema = { ...schema, views: [structuredClone(view)] };
    (updateSchema.mock.calls[0][0] as (s: DatabaseSchema) => void)(draft);
    expect(draft.views[0].chart?.grid).toBe(false);
  });
});
