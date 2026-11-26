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

  it.each([
    ["column", { x: "status" }],
    ["bar", { x: "status", aggregate: "sum", y: "price", labelContent: "percent", labelPosition: "inside", colorBy: "single", color: "accent" }],
    ["line", { x: "due", dateBucket: "month", curve: "step", points: false, xTitle: "Month", yTitle: "Tasks", xLabels: false, labelAngle: 45, legendPosition: "right" }],
    ["column", { x: "status", aggregate: "sum", y: "price", logScale: true, aggregate2: "average", y2: "qty", goal: 50, goalLabel: "Budget", tooltip: "item" }],
    ["area", { x: "due", dateBucket: "month", gradient: false, tooltip: "off", legendPosition: "left", series: "status" }],
    ["donut", { x: "status", donutWidth: 70, labelContent: "nameValue", labelPosition: "inside", legendPosition: "bottom" }],
    ["scatter", { x: "price", y: "qty", logScale: true, xTitle: "Price", color: "green", colorBy: "single" }],
  ] as [ChartKind, ChartConfig][])("builds a %s option with display options", async (kind, config) => {
    const { buildOption } = await import("./chartEngine");
    const data = buildChartData(rows, schema, { kind, ...config }, { now: new Date(2026, 10, 25) });
    expect(data.issue).toBeUndefined();
    const option = buildOption(data, readChartTheme(), { width: 640, height: 320 }, false);
    expect(option.series).toBeTruthy();
  });

  it("adds a combo line on its own axis", async () => {
    const { buildOption } = await import("./chartEngine");
    const data = buildChartData(rows, schema, { kind: "column", x: "status", aggregate2: "sum", y2: "price" });
    const option = buildOption(data, readChartTheme(), { width: 640, height: 320 }, false);
    const series = option.series as { type: string; yAxisIndex?: number }[];
    expect(series.map((s) => s.type)).toEqual(["bar", "line"]);
    expect(series[1].yAxisIndex).toBe(1);
    expect(option.yAxis).toHaveLength(2);
  });

  it("zooms cartesian charts only, and only when allowed", async () => {
    const { buildOption, zoomAxes } = await import("./chartEngine");
    const build = (config: ChartConfig) => buildChartData(rows, schema, config, { now: new Date(2026, 10, 25) });
    const zoomIds = (config: ChartConfig) =>
      ((buildOption(build(config), readChartTheme(), { width: 640, height: 320 }, false).dataZoom as { id: string; type: string; zoomOnMouseWheel?: unknown }[] | undefined) ?? []).map((z) => `${z.type}:${z.id}:${z.zoomOnMouseWheel ?? ""}`);
    expect(zoomIds({ kind: "column", x: "status" })).toEqual(["inside:zoomX:ctrl"]);
    expect(zoomIds({ kind: "bar", x: "status" })).toEqual(["inside:zoomY:ctrl"]);
    expect(zoomIds({ kind: "line", x: "due", zoomSlider: true })).toEqual(["inside:zoomX:ctrl", "slider:zoomSlider:"]);
    expect(zoomIds({ kind: "scatter", x: "price", y: "qty" })).toEqual(["inside:zoomX:ctrl", "inside:zoomY:ctrl"]);
    expect(zoomIds({ kind: "column", x: "status", zoom: false })).toEqual([]);
    for (const kind of ["pie", "donut", "funnel", "radar"] as ChartKind[]) {
      expect(zoomAxes(build({ kind, x: "status" }))).toBeNull();
      expect(zoomIds({ kind, x: "status" })).toEqual([]);
    }
    expect(zoomAxes(build({ kind: "heatmap", x: "due" }))).toBeNull();
  });

  it("zooms in, out and back through the handle", async () => {
    const { mountChart } = await import("./chartEngine");
    const states: { zoomed: boolean; available: boolean }[] = [];
    const el = document.createElement("div");
    document.body.appendChild(el);
    const chart = mountChart(el, () => {}, (state) => states.push(state));
    const data = buildChartData(rows, schema, { kind: "line", x: "due", dateBucket: "day" });
    chart.update(data, readChartTheme(), { width: 640, height: 320 });
    expect(states[states.length - 1]).toMatchObject({ available: true, zoomed: false });
    chart.zoom(2);
    expect(states[states.length - 1]).toMatchObject({ zoomed: true });
    chart.resetZoom();
    expect(states[states.length - 1]).toMatchObject({ zoomed: false });
    chart.dispose();
    el.remove();
  });
});

describe("ChartView", () => {
  it("keeps drawing when switching to another chart view (new openRow each view)", async () => {
    const flush = () => act(async () => {
      await import("./chartEngine");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const { container, rerender } = render(<ChartView db={{ ...api(), openRow: () => {} }} view={viewWith({ kind: "column", x: "status" })} rows={rows} inline />);
    await flush();
    expect(container.querySelector(".db-chart-canvas svg")).not.toBeNull();
    rerender(<ChartView db={{ ...api(), openRow: () => {} }} view={{ ...viewWith({ kind: "pie", x: "status" }), id: "v2" }} rows={rows} inline />);
    await flush();
    expect(container.querySelector(".db-chart-loading")).toBeNull();
    const svg = container.querySelector(".db-chart-canvas svg");
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll("path").length).toBeGreaterThan(0);
  });
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

  it("uses a custom empty-state message", () => {
    render(<ChartView db={{ ...api(), rows: [] } as DatabaseApi} view={viewWith({ kind: "column", x: "status", emptyText: "Nothing logged yet" })} rows={[]} />);
    expect(screen.getByText("Nothing logged yet")).toBeTruthy();
  });
});

describe("ChartView zoom and expand", () => {
  const flush = () =>
    act(async () => {
      await import("./chartEngine");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

  it("offers zoom tools on cartesian charts and resets", async () => {
    const { container } = render(<ChartView db={api()} view={viewWith({ kind: "line", x: "due", dateBucket: "day" })} rows={rows} inline />);
    await flush();
    const toolbar = screen.getByRole("toolbar", { name: "Chart tools" });
    expect(toolbar).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();
    expect((screen.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeTruthy();
    expect(toolbar.className).toContain("is-active");
    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();
    // Keyboard: the plot is focusable while zoom is on.
    const plot = container.querySelector(".db-chart-plot") as HTMLElement;
    expect(plot.tabIndex).toBe(0);
    fireEvent.keyDown(plot, { key: "+" });
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeTruthy();
    fireEvent.keyDown(plot, { key: "0" });
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();
  });

  it("toggles box zoom", async () => {
    render(<ChartView db={api()} view={viewWith({ kind: "column", x: "status" })} rows={rows} inline />);
    await flush();
    const box = screen.getByRole("button", { name: "Zoom to a range" });
    fireEvent.click(box);
    expect(box.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Drag across the chart");
    fireEvent.click(box);
    expect(box.getAttribute("aria-pressed")).toBe("false");
  });

  it("hints instead of hijacking a plain wheel", async () => {
    const { container } = render(<ChartView db={api()} view={viewWith({ kind: "column", x: "status" })} rows={rows} inline />);
    await flush();
    const plot = container.querySelector(".db-chart-plot") as HTMLElement;
    fireEvent.wheel(plot, { deltaY: 40, ctrlKey: true });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.wheel(plot, { deltaY: 40 });
    expect(screen.getByRole("status").textContent).toMatch(/scroll to zoom/);
  });

  it("has no zoom on pies but can expand them; Esc closes", async () => {
    render(<ChartView db={api()} view={viewWith({ kind: "pie", x: "status" })} rows={rows} inline />);
    await flush();
    expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand chart" }));
    await flush();
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector(".db-chart-canvas svg")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("zooms inside the expanded chart too", async () => {
    render(<ChartView db={api()} view={viewWith({ kind: "column", x: "due", dateBucket: "day", zoomSlider: true })} rows={rows} inline />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Expand chart" }));
    await flush();
    const dialog = screen.getByRole("dialog");
    const zoomIn = dialog.querySelector("button[aria-label='Zoom in']") as HTMLButtonElement;
    expect(zoomIn).not.toBeNull();
    fireEvent.click(zoomIn);
    expect(dialog.querySelector("button[aria-label='Reset zoom']")).not.toBeNull();
    // No nested expand inside the dialog.
    expect(dialog.querySelector("button[aria-label='Expand chart']")).toBeNull();
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

  it("has no title field and round-trips zoom off", () => {
    const updateSchema = vi.fn();
    const view = viewWith({ kind: "column", x: "status" });
    render(<ChartSettings db={api(updateSchema)} view={view} />);
    expect(screen.queryByLabelText("Chart title")).toBeNull();
    const zoomSwitch = screen.queryByRole("switch", { name: /zoom/i });
    if (!zoomSwitch) fireEvent.click(screen.getByRole("button", { name: /^Zoom/ }));
    fireEvent.click(screen.getAllByRole("switch", { name: /zoom/i })[0]);
    const draft: DatabaseSchema = { ...schema, views: [structuredClone(view)] };
    (updateSchema.mock.calls[updateSchema.mock.calls.length - 1][0] as (s: DatabaseSchema) => void)(draft);
    expect(draft.views[0].chart?.zoom).toBe(false);
  });
});
