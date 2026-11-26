import { describe, expect, it } from "vitest";
import { normalizeHomePrefs } from "./home";
import {
  ASCII_BACKGROUND_OPTIONS_DOC,
  MAX_PAGE_BACKGROUNDS_BYTES,
  normalizePageBackground,
  pageBackgroundDim,
  pageBackgroundStyle,
  readPageBackgrounds,
  withPageBackground,
} from "./pageBackgroundModel";

describe("normalizePageBackground", () => {
  it("rejects anything that is not a known kind", () => {
    for (const input of [null, undefined, 3, "color", [], {}, { kind: "video", value: "x" }]) {
      expect(normalizePageBackground(input)).toBeNull();
    }
  });

  it("accepts colors, including cover tokens and theme variables", () => {
    expect(normalizePageBackground({ kind: "color", value: "#AABBCC" })).toEqual({ kind: "color", value: "#aabbcc" });
    expect(normalizePageBackground({ kind: "color", value: "color:#e6dccd" })?.value).toBe("#e6dccd");
    expect(normalizePageBackground({ kind: "color", value: "var(--bg-sunken)" })?.value).toBe("var(--bg-sunken)");
    expect(normalizePageBackground({ kind: "color", value: "rgb(10 20 30 / 50%)" })?.value).toBe("rgb(10 20 30 / 50%)");
    expect(normalizePageBackground({ kind: "color", value: "red; background: url(x)" })).toBeNull();
    expect(normalizePageBackground({ kind: "color" })).toBeNull();
  });

  it("accepts css gradients and cover gradient tokens, but not urls", () => {
    expect(normalizePageBackground({ kind: "gradient", value: "linear-gradient(135deg, #fff, #000)" })?.value).toBe("linear-gradient(135deg, #fff, #000)");
    expect(normalizePageBackground({ kind: "gradient", value: "gradientcustom:90:#ffffff:#000000" })?.value).toBe("linear-gradient(90deg, #ffffff, #000000)");
    expect(normalizePageBackground({ kind: "gradient", value: "gradient:not-a-gradient" })).toBeNull();
    expect(normalizePageBackground({ kind: "gradient", value: "linear-gradient(url(x), #000)" })).toBeNull();
    expect(normalizePageBackground({ kind: "gradient", value: "linear-gradient(#fff, #000" })).toBeNull();
    expect(normalizePageBackground({ kind: "gradient", value: "#fff" })).toBeNull();
  });

  it("accepts uploads, links, bundled photos and small data urls", () => {
    expect(normalizePageBackground({ kind: "image", value: "/__assets/ws/pg/a.png" })?.value).toBe("/__assets/ws/pg/a.png");
    expect(normalizePageBackground({ kind: "image", value: "upload:/__assets/ws/pg/a.png" })?.value).toBe("/__assets/ws/pg/a.png");
    expect(normalizePageBackground({ kind: "image", value: "https://example.com/a.jpg#x" })?.value).toBe("https://example.com/a.jpg");
    expect(normalizePageBackground({ kind: "image", value: "link:https://example.com/a.jpg" })?.value).toBe("https://example.com/a.jpg");
    expect(normalizePageBackground({ kind: "image", value: "image:alpine-boat" })?.value).toBe("/covers/alpine-boat.webp");
    expect(normalizePageBackground({ kind: "image", value: "data:image/png;base64,iVBORw0KGgo=" })?.value).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(normalizePageBackground({ kind: "image", value: `data:image/png;base64,${"A".repeat(60_000)}` })).toBeNull();
    expect(normalizePageBackground({ kind: "image", value: "javascript:alert(1)" })).toBeNull();
    expect(normalizePageBackground({ kind: "image", value: "file:///etc/passwd" })).toBeNull();
    expect(normalizePageBackground({ kind: "image", value: "/__assets/../secret" })).toBeNull();
    // Quotes cannot break out of url("…"): the URL parser percent-encodes them.
    expect(normalizePageBackground({ kind: "image", value: 'https://example.com/a.jpg")' })?.value).toBe("https://example.com/a.jpg%22)");
  });

  it("keeps only known ascii options, clamped", () => {
    expect(
      normalizePageBackground({
        kind: "ascii",
        ascii: { scene: "moon", speed: 9, ink: "#ABCDEF", density: "large", still: true, cursor: false, text: "hi", veil: 1 },
      }),
    ).toEqual({ kind: "ascii", ascii: { scene: "ascii-moon", speed: 3, ink: "#abcdef", density: "large", still: true, cursor: false } });
    expect(normalizePageBackground({ kind: "ascii", ascii: { scene: "ascii-rain", speed: 1, density: "normal", cursor: true } })).toEqual({
      kind: "ascii",
      ascii: { scene: "ascii-rain" },
    });
    expect(normalizePageBackground({ kind: "ascii", value: "topo" })?.ascii).toEqual({ scene: "ascii-topo" });
    expect(normalizePageBackground({ kind: "ascii", ascii: { scene: "ascii-nope" } })).toBeNull();
    expect(normalizePageBackground({ kind: "ascii", ascii: { scene: "dunes", ink: "red" } })?.ascii).toEqual({ scene: "ascii-dunes" });
  });

  it("clamps opacity and dim", () => {
    expect(normalizePageBackground({ kind: "color", value: "#000000", opacity: 4, dim: -1 })).toEqual({ kind: "color", value: "#000000", dim: 0 });
    expect(normalizePageBackground({ kind: "color", value: "#000000", opacity: 0.333, dim: Number.NaN })).toEqual({ kind: "color", value: "#000000", opacity: 0.33 });
    expect(pageBackgroundDim({ kind: "ascii", ascii: { scene: "ascii-moon" } })).toBe(0.55);
    expect(pageBackgroundDim({ kind: "image", value: "/__assets/a.png", dim: 0.1 })).toBe(0.1);
  });

  it("documents every ascii option key", () => {
    for (const key of ["scene", "speed", "ink", "density", "still", "cursor", "ascii-moon", "ascii-topo"]) {
      expect(ASCII_BACKGROUND_OPTIONS_DOC).toContain(key);
    }
  });
});

describe("page background storage", () => {
  it("styles each kind", () => {
    expect(pageBackgroundStyle({ kind: "color", value: "#123456" })).toEqual({ backgroundColor: "#123456" });
    expect(pageBackgroundStyle({ kind: "image", value: "/__assets/a.png" })?.backgroundImage).toBe('url("/__assets/a.png")');
    expect(pageBackgroundStyle({ kind: "ascii", ascii: { scene: "ascii-moon" } })).toBeUndefined();
  });

  it("reads and replaces per-page entries, dropping bad ones", () => {
    const prefs = { backgrounds: {}, pageBackgrounds: { pg_a: { kind: "color", value: "#000000" }, pg_b: { kind: "nope" }, "bad id!": { kind: "color", value: "#fff" } } };
    const map = readPageBackgrounds(prefs);
    expect(map).toEqual({ pg_a: { kind: "color", value: "#000000" } });
    const next = withPageBackground(map, "pg_c", { kind: "ascii", ascii: { scene: "ascii-galaxy" } });
    expect(Object.keys(next)).toEqual(["pg_a", "pg_c"]);
    expect(withPageBackground(next, "pg_a", null)).toEqual({ pg_c: { kind: "ascii", ascii: { scene: "ascii-galaxy" } } });
    expect(() => withPageBackground(map, "bad id!", null)).toThrow();
  });

  it("refuses to grow past the workspace budget", () => {
    const big = `data:image/png;base64,${"A".repeat(40_000)}`;
    let map = {};
    let threw = false;
    try {
      for (let i = 0; i < 10; i += 1) map = withPageBackground(map, `pg_${i}`, { kind: "image", value: big });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(JSON.stringify(map).length).toBeLessThanOrEqual(MAX_PAGE_BACKGROUNDS_BYTES);
  });

  it("survives the home prefs normalizer", () => {
    const prefs = normalizeHomePrefs({ backgrounds: {}, pageBackgrounds: { pg_a: { kind: "color", value: "#000000" }, x: "junk" } });
    expect(prefs.pageBackgrounds).toEqual({ pg_a: { kind: "color", value: "#000000" } });
    expect(normalizeHomePrefs({ backgrounds: {} }).pageBackgrounds).toBeUndefined();
  });
});
