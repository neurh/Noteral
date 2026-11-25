// Chart colours and app tokens, read at runtime so charts follow the theme
// (and any token customisations). Kept free of ECharts so the settings panel
// can show palette swatches without loading the chart engine.

import { OPTION_COLORS, type OptionColor } from "../../lib/database";

export interface ChartPalette {
  id: string;
  name: string;
  light: string[];
  dark: string[];
}

/**
 * Mark colours for select-option colours, tuned to sit beside the chips:
 * a "Done" green chip shows as this green in charts. Mirrors
 * `--chart-tone-*` in styles/database-chart.css (these are fallbacks).
 */
export const CHART_TONES: Record<"light" | "dark", Record<OptionColor, string>> = {
  light: {
    default: "#a2978a",
    gray: "#857f77",
    brown: "#9a5a2c",
    orange: "#d0793a",
    yellow: "#c99a1e",
    green: "#3e8a58",
    blue: "#3f78b5",
    purple: "#7e62b5",
    pink: "#c25a8a",
    red: "#c4483a",
  },
  dark: {
    default: "#80776b",
    gray: "#8f8a83",
    brown: "#b8733a",
    orange: "#e0884a",
    yellow: "#c29a2c",
    green: "#4aa66a",
    blue: "#5b95d6",
    purple: "#9d85da",
    pink: "#d46c9c",
    red: "#dd6352",
  },
};

/**
 * Palettes offered in chart settings. "auto" starts from the app accent and
 * uses option colours wherever the chart is coloured by an option property.
 */
export const CHART_PALETTES: ChartPalette[] = [
  {
    id: "auto",
    name: "Auto",
    light: ["#b1533d", "#3f78b5", "#c99a1e", "#0f8b86", "#7e62b5", "#3e8a58", "#c25a8a", "#9a5a2c"],
    dark: ["#d4765c", "#5b95d6", "#c29a2c", "#1fa39d", "#9d85da", "#4aa66a", "#d46c9c", "#b8733a"],
  },
  {
    id: "ember",
    name: "Ember",
    light: ["#b1533d", "#d0873f", "#c99a1e", "#7d8a3a", "#7a5a44", "#d79b80"],
    dark: ["#d4765c", "#e09a52", "#c9a032", "#a3b04e", "#a87e60", "#e6b49a"],
  },
  {
    id: "harbor",
    name: "Harbor",
    light: ["#2f5d8a", "#0f8b86", "#4f93c4", "#5a6fb0", "#6fae9f", "#8aa9c8"],
    dark: ["#5b8fd0", "#1fa39d", "#6fb3e0", "#8496d8", "#86c4b5", "#a7c1dc"],
  },
  {
    id: "meadow",
    name: "Meadow",
    light: ["#2f6e45", "#5d9a3e", "#0f8b86", "#c99a1e", "#7d8f5a", "#94b86a"],
    dark: ["#4aa66a", "#86c060", "#1fa39d", "#c9a032", "#9fb07a", "#b4d48a"],
  },
  {
    id: "graphite",
    name: "Graphite",
    light: ["#3b352e", "#6e665b", "#9a9084", "#c2b8aa", "#565048", "#ada395"],
    dark: ["#e6dfd3", "#b8afa1", "#8a8173", "#625b50", "#cfc6b8", "#a0978a"],
  },
  {
    id: "contrast",
    name: "Contrast",
    light: ["#0072b2", "#e69f00", "#009e73", "#cc79a7", "#56b4e9", "#d55e00", "#b8a400"],
    dark: ["#3a9ad9", "#f0ad1c", "#1fb98c", "#dd8fb8", "#78c6f0", "#ef7a2a", "#e8d84a"],
  },
];

export function paletteById(id: string | undefined): ChartPalette {
  return CHART_PALETTES.find((p) => p.id === id) ?? CHART_PALETTES[0];
}

export interface ChartTheme {
  dark: boolean;
  bg: string;
  bgRaised: string;
  bgSunken: string;
  bgHover: string;
  text: string;
  textSoft: string;
  textMuted: string;
  textFaint: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentSoft: string;
  fontUi: string;
  radius: number;
  shadow: string;
  tones: Record<OptionColor, string>;
}

const FALLBACK: Record<"light" | "dark", Omit<ChartTheme, "dark" | "tones" | "fontUi" | "radius" | "shadow">> = {
  light: {
    bg: "#f7f3ec",
    bgRaised: "#fcfaf6",
    bgSunken: "#efe9df",
    bgHover: "#eee7dc",
    text: "#2c2822",
    textSoft: "#5f574c",
    textMuted: "#8b8174",
    textFaint: "#a79d90",
    border: "#e4dcd0",
    borderStrong: "#d6cbbc",
    accent: "#b1533d",
    accentSoft: "#f2e0d8",
  },
  dark: {
    bg: "#1d1b18",
    bgRaised: "#24211d",
    bgSunken: "#171512",
    bgHover: "#2b2823",
    text: "#eee8de",
    textSoft: "#c5bcae",
    textMuted: "#928878",
    textFaint: "#6f675c",
    border: "#332f29",
    borderStrong: "#433d35",
    accent: "#d4765c",
    accentSoft: "#3a2a24",
  },
};

let probe: HTMLElement | null = null;

/** Any CSS colour (hex, rgb, color-mix…) as a hex/rgb string ECharts understands. */
function resolveColor(value: string, fallback: string, scope: Element): string {
  const raw = value.trim();
  if (!raw) return fallback;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw) || /^rgba?\(/i.test(raw)) return raw;
  if (typeof document === "undefined") return fallback;
  try {
    if (!probe) {
      probe = document.createElement("span");
      probe.style.display = "none";
    }
    scope.appendChild(probe);
    probe.style.color = "";
    probe.style.color = raw;
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return /^rgba?\(/.test(computed) || computed.startsWith("#") ? computed : fallback;
  } catch {
    return fallback;
  }
}

/** Reads the app tokens that charts draw with from an element's computed style. */
export function readChartTheme(scope?: Element | null): ChartTheme {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  const dark = !!root && root.dataset.theme === "dark";
  const mode = dark ? "dark" : "light";
  const fallback = FALLBACK[mode];
  const target = scope ?? root;
  const style = target && typeof getComputedStyle === "function" ? getComputedStyle(target) : null;
  const read = (name: string) => style?.getPropertyValue(name) ?? "";
  const color = (name: string, fb: string) => (target ? resolveColor(read(name), fb, target) : fb);
  const tones = {} as Record<OptionColor, string>;
  for (const tone of OPTION_COLORS) tones[tone] = color(`--chart-tone-${tone}`, CHART_TONES[mode][tone]);
  const radius = parseFloat(read("--radius-sm")) || 6;
  return {
    dark,
    bg: color("--bg", fallback.bg),
    bgRaised: color("--bg-raised", fallback.bgRaised),
    bgSunken: color("--bg-sunken", fallback.bgSunken),
    bgHover: color("--bg-hover", fallback.bgHover),
    text: color("--text", fallback.text),
    textSoft: color("--text-soft", fallback.textSoft),
    textMuted: color("--text-muted", fallback.textMuted),
    textFaint: color("--text-faint", fallback.textFaint),
    border: color("--border", fallback.border),
    borderStrong: color("--border-strong", fallback.borderStrong),
    accent: color("--accent", fallback.accent),
    accentSoft: color("--accent-soft", fallback.accentSoft),
    fontUi: read("--font-ui").trim() || "Inter, system-ui, sans-serif",
    radius,
    shadow: read("--shadow-md").trim() || "0 8px 28px rgb(0 0 0 / 12%)",
    tones,
  };
}

/** The colours a palette draws with in a theme; "auto" leads with the live accent. */
export function paletteColors(palette: ChartPalette, theme: Pick<ChartTheme, "dark" | "accent">): string[] {
  const colors = theme.dark ? palette.dark : palette.light;
  return palette.id === "auto" ? [theme.accent, ...colors.slice(1)] : colors;
}

// ── Colour maths ─────────────────────────────────────────────────────────

export function parseColor(value: string): [number, number, number, number] | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const rgb = /^rgba?\(([^)]+)\)/i.exec(value.trim());
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    const [r, g, b] = parts.slice(0, 3).map(Number);
    const a = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : Number(parts[3]);
    if ([r, g, b].every(Number.isFinite)) return [r, g, b, Number.isFinite(a) ? a : 1];
  }
  return null;
}

/** A colour at some opacity. */
export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  return c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})` : color;
}

/** Mixes two colours (t = 0 → a, 1 → b). */
export function mixColors(a: string, b: string, t: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return t < 0.5 ? a : b;
  const m = (i: number) => Math.round(x[i] + (y[i] - x[i]) * t);
  return `rgb(${m(0)}, ${m(1)}, ${m(2)})`;
}

function luminance(color: string): number {
  const c = parseColor(color);
  if (!c) return 0.5;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** Dark or light text, whichever reads better on a fill. */
export function textOn(fill: string, theme: Pick<ChartTheme, "dark">): string {
  return luminance(fill) > 0.36 ? "#24201b" : theme.dark ? "#f4efe7" : "#ffffff";
}
