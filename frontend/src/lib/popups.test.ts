import { describe, expect, it } from "vitest";
import { normalizeMenuItems, normalizeRect, placePopup } from "./popups";

describe("normalizeMenuItems", () => {
  it("keeps valid items, drops run and items without ids", () => {
    const items = normalizeMenuItems([
      { id: "a", label: "A", run: () => undefined, checked: true, danger: true },
      { label: "no id" },
      "-",
      { header: true, label: "Group" },
      { title: "B", id: "b", shortcut: "Ctrl+B" },
    ]);
    expect(items).toEqual([
      { type: "item", label: "A", id: "a", danger: true, checked: true },
      { type: "separator" },
      { type: "header", label: "Group" },
      { type: "item", label: "B", id: "b", hint: "Ctrl+B" },
    ]);
  });

  it("trims leading, trailing and doubled separators", () => {
    const items = normalizeMenuItems(["-", { id: "a", label: "A" }, "-", "-", { id: "b", label: "B" }, "-"]);
    expect(items.map((item) => item.type)).toEqual(["item", "separator", "item"]);
  });

  it("supports submenus and caps depth", () => {
    const ok = { label: "1", children: [{ label: "2", children: [{ label: "3", children: [{ id: "x", label: "X" }] }] }] };
    const tooDeep = { label: "1", children: [{ label: "2", children: [{ label: "3", children: [{ label: "4", children: [{ id: "y", label: "Y" }] }] }] }] };
    const items = normalizeMenuItems([ok, tooDeep, { label: "Sub", items: [{ id: "c", label: "C" }] }]);
    expect(items[0].children?.[0].children?.[0].children).toEqual([{ type: "item", label: "X", id: "x" }]);
    // A submenu that ends up empty is dropped.
    expect(items).toHaveLength(2);
    expect(items[1].children).toEqual([{ type: "item", label: "C", id: "c" }]);
  });

  it("caps the item count", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `i${i}`, label: `Item ${i}` }));
    expect(normalizeMenuItems(many).length).toBe(200);
  });
});

describe("normalizeRect", () => {
  it("accepts DOMRect-like and point objects", () => {
    expect(normalizeRect({ left: 4, top: 5, width: 10, height: 2 })).toEqual({ x: 4, y: 5, width: 10, height: 2 });
    expect(normalizeRect({ x: 1, y: 2 })).toEqual({ x: 1, y: 2, width: 0, height: 0 });
    expect(normalizeRect({ x: "a" })).toBeUndefined();
    expect(normalizeRect(null)).toBeUndefined();
  });
});

describe("placePopup", () => {
  const viewport = { width: 800, height: 600 };
  it("opens below an anchor and flips above when there's no room", () => {
    expect(placePopup({ width: 200, height: 100 }, { anchor: { x: 10, y: 10, width: 50, height: 20 } }, viewport)).toEqual({ left: 10, top: 34 });
    expect(placePopup({ width: 200, height: 100 }, { anchor: { x: 10, y: 560, width: 50, height: 20 } }, viewport).top).toBe(456);
  });
  it("aligns end placements to the anchor's right edge", () => {
    expect(placePopup({ width: 200, height: 100 }, { anchor: { x: 500, y: 10, width: 100, height: 20 }, placement: "bottom-end" }, viewport).left).toBe(400);
  });
  it("drops submenus below their item when neither side fits", () => {
    const at = { anchor: { x: 10, y: 200, width: 240, height: 28 }, placement: "right-start" as const };
    expect(placePopup({ width: 190, height: 150 }, at, { width: 390, height: 844 })).toEqual({ left: 34, top: 230 });
    expect(placePopup({ width: 190, height: 150 }, at, viewport).left).toBe(252);
  });
  it("keeps point menus inside the window", () => {
    expect(placePopup({ width: 200, height: 300 }, { x: 790, y: 590 }, viewport)).toEqual({ left: 590, top: 290 });
  });
});
