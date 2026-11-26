// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOFIT_MAX, AUTOFIT_MIN, autofitColumn, fitWidth, measureCells } from "./autofit";

describe("fitWidth", () => {
  it("rounds the widest width up, with a pixel to spare", () => {
    expect(fitWidth([90.2, 140.4, 120])).toBe(142);
    expect(fitWidth([100], { pad: 0 })).toBe(100);
  });

  it("clamps to the bounds", () => {
    expect(fitWidth([])).toBe(AUTOFIT_MIN);
    expect(fitWidth([10])).toBe(AUTOFIT_MIN);
    expect(fitWidth([5000])).toBe(AUTOFIT_MAX);
    expect(fitWidth([300], { min: 40, max: 200 })).toBe(200);
  });

  it("ignores broken measurements", () => {
    expect(fitWidth([Number.NaN, Number.POSITIVE_INFINITY, 120])).toBe(121);
  });
});

describe("measureCells", () => {
  // jsdom has no layout: a clone measures 7px per character, only while it sits
  // in a max-content probe inside the table (as the real code arranges).
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const inProbe = this.style.width === "max-content" && this.closest("[aria-hidden='true']") && this.isConnected;
      const width = inProbe ? (this.textContent ?? "").length * 7 : 50;
      return { width, height: 20, top: 0, left: 0, right: width, bottom: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  function table() {
    document.body.innerHTML = `
      <div class="db-table-inner">
        <div class="db-tr db-thead"><div class="db-th" id="head">Name</div></div>
        <div class="db-tr"><div class="db-td">Short</div></div>
        <div class="db-tr"><div class="db-td">A much longer value here</div></div>
      </div>`;
    const header = document.getElementById("head") as HTMLElement;
    const cells = Array.from(document.querySelectorAll<HTMLElement>(".db-td"));
    return { header, cells, host: document.querySelector<HTMLElement>(".db-table-inner")! };
  }

  it("measures clones and cleans up", () => {
    const { host, cells } = table();
    expect(measureCells(host, cells)).toEqual([35, 168]);
    expect(host.querySelectorAll(".db-td")).toHaveLength(2);
    expect(host.lastElementChild?.getAttribute("aria-hidden")).toBeNull();
  });

  it("keeps the row classes and drops ids on clones", () => {
    const { host, header } = table();
    const append = vi.spyOn(host, "appendChild");
    measureCells(host, [header]);
    const probe = append.mock.calls[0][0] as HTMLElement;
    expect(probe.firstElementChild?.className).toBe("db-tr db-thead");
    expect(probe.querySelector("#head")).toBeNull();
  });

  it("respects the cell limit", () => {
    const { host, cells } = table();
    expect(measureCells(host, cells, 1)).toHaveLength(1);
  });

  it("fits a column to its header and cells", () => {
    const { header, cells } = table();
    expect(autofitColumn(header, cells)).toBe(169);
    expect(autofitColumn(header, cells.slice(0, 1))).toBe(AUTOFIT_MIN);
  });
});
