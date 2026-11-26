import { describe, expect, it } from "vitest";
import { isStatusItemHidden, mergeStatusBar, normalizeStatusBar, normalizeStatusWidth, resolveStatusSlots, statusItemKey } from "./statusLayout";

describe("status bar layout", () => {
  it("normalizes widths", () => {
    expect(normalizeStatusWidth(4)).toBe(16);
    expect(normalizeStatusWidth("50%")).toBe("50%");
    expect(normalizeStatusWidth("140px")).toBe(140);
    expect(normalizeStatusWidth("fill")).toBe("fill");
    expect(normalizeStatusWidth("wide")).toBeUndefined();
  });

  it("hides local-first by default and lets layouts show it again", () => {
    expect(isStatusItemHidden("builtin:local", undefined)).toBe(true);
    expect(isStatusItemHidden("builtin:local", { items: { "builtin:local": { hidden: false } } })).toBe(false);
    expect(isStatusItemHidden("builtin:save", undefined)).toBe(false);
  });

  it("moves, reorders and resizes slots", () => {
    const slots = [
      { key: "builtin:save", side: "right" as const, order: 100 },
      { key: "builtin:stats", side: "left" as const, order: -90 },
      { key: "builtin:local", side: "right" as const, order: 90 },
    ];
    const out = resolveStatusSlots(slots, { items: { "builtin:stats": { side: "center", width: "fill" }, "builtin:save": { order: -200 } } });
    expect(out.map((slot) => [slot.key, slot.side, slot.order])).toEqual([
      ["builtin:save", "right", -200],
      ["builtin:stats", "center", -90],
    ]);
    expect(out[1].width).toBe("fill");
  });

  it("drops bad values and merges per item", () => {
    expect(normalizeStatusBar({ separator: "zigzag", gap: 900, items: { "bad key!": { hidden: true }, ok: { side: "up" } } })).toEqual({ gap: 48 });
    const merged = mergeStatusBar({ separator: "line", items: { a: { hidden: true, order: 1 } } }, { items: { a: { hidden: false } } });
    expect(merged?.separator).toBe("line");
    expect(merged?.items?.a).toEqual({ hidden: false, order: 1 });
  });

  it("resolves short ids to keys", () => {
    const known = ["builtin:save", "plugin:clock:time"];
    expect(statusItemKey("save", known)).toBe("builtin:save");
    expect(statusItemKey("time", known)).toBe("plugin:clock:time");
  });
});
