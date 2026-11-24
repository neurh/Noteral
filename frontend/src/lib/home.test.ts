import { describe, expect, it } from "vitest";
import { ASCII_SCENES } from "../components/home/asciiScenes";
import {
  backgroundForView,
  defaultTabSettings,
  homeViewKey,
  normalizeHomePrefs,
  splitBackgroundPatch,
  HOME_BACKGROUNDS,
  HOME_CUSTOM_PRESETS,
  compactWidgets,
  findFreeSpot,
  newWidget,
  normalizeCustomViews,
  resolveCollisions,
  defaultHomeTabSettings, homeTone, isAsciiBackground, normalizeCustomLayout, normalizeHomeTabSettings } from "./home";

describe("normalizeHomeTabSettings", () => {
  it("uses the default view for missing settings", () => {
    expect(normalizeHomeTabSettings()).toEqual(defaultHomeTabSettings);
    expect(normalizeHomeTabSettings(null)).toEqual(defaultHomeTabSettings);
  });

  it("keeps supported templates and backgrounds", () => {
    expect(normalizeHomeTabSettings({ template: "gallery", background: "ascii-rain" })).toEqual({
      template: "gallery",
      background: "ascii-rain",
    });
  });

  it("maps views from earlier releases", () => {
    expect(normalizeHomeTabSettings({ template: "default" }).template).toBe("desk");
    expect(normalizeHomeTabSettings({ template: "library" }).template).toBe("index");
  });

  it("falls back when persisted values are unknown", () => {
    expect(normalizeHomeTabSettings({ template: "unknown", background: "neon" })).toEqual(defaultHomeTabSettings);
  });

  it("drops custom backgrounds without a valid color", () => {
    expect(normalizeHomeTabSettings({ background: "custom-color", color: "red" }).background).toBe("paper");
    const kept = normalizeHomeTabSettings({ background: "custom-gradient", gradient: { from: "#000000", to: "#FFFFFF", angle: 400, kind: "x" } });
    expect(kept.background).toBe("custom-gradient");
    expect(kept.gradient).toEqual({ from: "#000000", to: "#ffffff", angle: 40, kind: "linear" });
  });

  it("cleans the custom widget layout", () => {
    const settings = normalizeHomeTabSettings({
      template: "custom",
      custom: {
        title: "Mine",
        width: "huge",
        widgets: [
          { id: "a", type: "clock", size: "l" },
          { id: "a", type: "note", text: "x".repeat(3000) },
          { id: "b", type: "nope" },
        ],
      },
    });
    expect(settings.custom?.width).toBe("wide");
    expect(settings.custom?.widgets).toHaveLength(2);
    expect(settings.custom?.widgets[1].id).not.toBe("a");
    expect(settings.custom?.widgets[0].w).toBe(24);
    expect(settings.custom?.widgets[1].y).toBeGreaterThanOrEqual(settings.custom!.widgets[0].y + settings.custom!.widgets[0].h);
    expect(settings.custom?.widgets[1].text).toHaveLength(2000);
  });
});

describe("custom layout and wallpapers", () => {
  it("maps retired ASCII backgrounds onto the new scenes", () => {
    expect(normalizeHomeTabSettings({ background: "ascii-torus" }).background).toBe("ascii-galaxy");
    expect(normalizeHomeTabSettings({ background: "ascii-rain", ascii: { speed: 2, density: "fine", still: true, ink: "#ABCDEF" } }).ascii).toEqual({
      speed: 2,
      density: "fine",
      still: true,
      ink: "#abcdef",
    });
  });

  it("clamps widget settings and page style", () => {
    const custom = normalizeHomeTabSettings({
      template: "custom",
      custom: {
        radius: 99,
        gap: "huge",
        cards: "outline",
        accent: "#112233",
        widgets: [
          { id: "r", type: "recent", span: 40, limit: 99, variant: "cards", style: "neon", tint: "#FF0000" },
          { id: "t", type: "todo", items: [{ text: "a" }, { id: "x", text: "b", done: true }, { id: "x", text: "c" }, 4] },
          { id: "c", type: "countdown", date: "2027-01-01" },
          { id: "d", type: "countdown", date: "soon" },
          { id: "q", type: "quick", actions: ["page", "nuke", "search"] },
        ],
      },
    }).custom!;
    expect(custom.radius).toBe(28);
    expect(custom.gap).toBe("normal");
    expect(custom.cards).toBe("outline");
    expect(custom.accent).toBe("#112233");
    expect(custom.widgets[0]).toMatchObject({ w: 24, limit: 20, variant: "cards", tint: "#ff0000" });
    expect(custom.widgets[0].style).toBeUndefined();
    expect(custom.widgets[1].items?.map((item) => item.text)).toEqual(["a", "b", "c"]);
    expect(new Set(custom.widgets[1].items?.map((item) => item.id)).size).toBe(3);
    expect(custom.widgets[2].date).toBe("2027-01-01");
    expect(custom.widgets[3].date).toBeUndefined();
    expect(custom.widgets[4].actions).toEqual(["page", "search"]);
  });

  it("builds every preset into a valid layout", () => {
    for (const preset of HOME_CUSTOM_PRESETS) {
      const layout = preset.build();
      expect(normalizeCustomLayout(layout)).toEqual(layout);
    }
  });
});

describe("homeTone", () => {
  it("follows the theme for auto backgrounds and luminance for custom ones", () => {
    expect(homeTone({ background: "paper" }, "dark")).toBe("dark");
    expect(homeTone({ background: "ink" }, "light")).toBe("dark");
    expect(homeTone({ background: "custom-color", color: "#101418" }, "light")).toBe("dark");
    expect(homeTone({ background: "custom-color", color: "#f4efe6" }, "dark")).toBe("light");
    expect(homeTone({ background: "ascii-dunes" }, "dark")).toBe("light");
  });
});

describe("ascii wallpapers", () => {
  it("maps retired scenes onto their successors", () => {
    expect(normalizeHomeTabSettings({ background: "ascii-peaks" }).background).toBe("ascii-moon");
    expect(normalizeHomeTabSettings({ background: "ascii-silk" }).background).toBe("ascii-topo");
    expect(normalizeHomeTabSettings({ background: "ascii-sakura" }).background).toBe("ascii-dunes");
    expect(normalizeHomeTabSettings({ background: "ascii-flow" }).background).toBe("ascii-galaxy");
    expect(normalizeHomeTabSettings({ background: "ascii-topo" }).background).toBe("ascii-topo");
  });

  it("keeps the cursor option only when it is turned off", () => {
    expect(normalizeHomeTabSettings({ background: "ascii-moon", ascii: { speed: 1, cursor: true } }).ascii?.cursor).toBeUndefined();
    expect(normalizeHomeTabSettings({ background: "ascii-moon", ascii: { speed: 1, cursor: false } }).ascii?.cursor).toBe(false);
  });

  it("has a scene for every ascii background", () => {
    for (const bg of HOME_BACKGROUNDS.filter(isAsciiBackground)) expect(ASCII_SCENES[bg]).toBeDefined();
  });
});

describe("free-form custom layout", () => {
  const at = (id: string, x: number, y: number, w: number, h: number) => ({ ...newWidget("note"), id, x, y, w, h });

  it("growing one widget leaves its side-by-side neighbour alone", () => {
    const left = at("left", 0, 0, 12, 20);
    const right = at("right", 12, 0, 12, 20);
    const below = at("below", 12, 20, 12, 10);
    const grown = resolveCollisions([left, { ...right, h: 60 }, below], "right");
    expect(grown.find((w) => w.id === "left")).toMatchObject({ x: 0, y: 0, h: 20 });
    expect(grown.find((w) => w.id === "below")!.y).toBe(60);
  });

  it("pushes chains of collisions down and nothing else", () => {
    const a = at("a", 0, 0, 24, 10);
    const b = at("b", 0, 12, 12, 10);
    const c = at("c", 0, 22, 12, 10);
    const d = at("d", 12, 40, 12, 10);
    const out = resolveCollisions([{ ...a, h: 18 }, b, c, d], "a");
    expect(out.find((w) => w.id === "b")!.y).toBe(18);
    expect(out.find((w) => w.id === "c")!.y).toBe(28);
    expect(out.find((w) => w.id === "d")!.y).toBe(40);
  });

  it("finds free spots and tidies gaps without changing columns", () => {
    const widgets = [at("a", 0, 0, 12, 10), at("b", 12, 30, 12, 10)];
    expect(findFreeSpot(widgets, 12, 10)).toEqual({ x: 12, y: 0 });
    const tidy = compactWidgets(widgets);
    expect(tidy.find((w) => w.id === "b")).toMatchObject({ x: 12, y: 0 });
  });

  it("keeps custom views unique and bounded", () => {
    const views = normalizeCustomViews([
      { id: "v1", name: "  Work  ", widgets: [] },
      { id: "v1", name: "", widgets: [] },
      "junk",
    ]);
    expect(views).toHaveLength(2);
    expect(views[0].name).toBe("Work");
    expect(views[1].id).not.toBe("v1");
    expect(views[1].name.length).toBeGreaterThan(0);
  });
});

describe("home prefs", () => {
  it("keeps a background per view and drops junk", () => {
    const prefs = normalizeHomePrefs({
      defaultView: "focus",
      backgrounds: { desk: { background: "ascii-moon", ascii: { speed: 2 } }, "bad key!": { background: "paper" }, v1: "nope", v2: { background: "ascii-snow" } },
    });
    expect(prefs.defaultView).toBe("focus");
    expect(Object.keys(prefs.backgrounds)).toEqual(["desk", "v2"]);
    expect(backgroundForView(prefs, "desk")).toEqual({ background: "ascii-moon", ascii: { speed: 2 } });
    expect(backgroundForView(prefs, "v2").background).toBe("ascii-moon");
    expect(backgroundForView(prefs, "gallery")).toEqual({ background: "paper" });
  });

  it("keys custom views by id and built-ins by template", () => {
    expect(homeViewKey({ template: "custom", view: "v9" })).toBe("v9");
    expect(homeViewKey({ template: "gallery" })).toBe("gallery");
  });

  it("opens new tabs with the default view only while it exists", () => {
    expect(defaultTabSettings({ defaultView: "focus", backgrounds: {} }, [])).toMatchObject({ template: "focus" });
    expect(defaultTabSettings({ defaultView: "v1", backgrounds: {} }, ["v1"])).toMatchObject({ template: "custom", view: "v1" });
    expect(defaultTabSettings({ defaultView: "v1", backgrounds: {} }, [])).toMatchObject({ template: "desk" });
  });

  it("splits menu patches between the view and the tab", () => {
    expect(splitBackgroundPatch({ background: "ascii-rain", ascii: { speed: 1 } })).toEqual({ background: { background: "ascii-rain", ascii: { speed: 1 } }, tab: {} });
    expect(splitBackgroundPatch({ template: "focus" })).toEqual({ background: undefined, tab: { template: "focus" } });
  });
});
