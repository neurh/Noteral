// Home tab appearance: which view a Home tab shows, what sits behind it, and
// the widget layout of the fully customizable view. Everything here is
// normalized defensively because it round-trips through persisted UI state.

import { normalizeCustomLayout, type HomeCustomLayout } from "./homeCustom";

export * from "./homeCustom";

export const HOME_TEMPLATES = ["desk", "focus", "dashboard", "gallery", "timeline", "index", "launchpad", "custom"] as const;
export type HomeTemplate = (typeof HOME_TEMPLATES)[number];

/** Views from earlier releases, mapped onto their successors. */
const LEGACY_TEMPLATES: Record<string, HomeTemplate> = { default: "desk", library: "index" };

export interface HomeTemplateInfo {
  label: string;
  description: string;
}

export const HOME_TEMPLATE_INFO: Record<HomeTemplate, HomeTemplateInfo> = {
  desk: { label: "Desk", description: "Greeting, quick actions and what you touched last." },
  focus: { label: "Focus", description: "One quiet prompt and the page you were writing." },
  dashboard: { label: "Dashboard", description: "Numbers, activity and lists at a glance." },
  gallery: { label: "Gallery", description: "Your pages as covered cards." },
  timeline: { label: "Timeline", description: "Edits grouped by day, newest first." },
  index: { label: "Index", description: "Every page, A to Z, with search." },
  launchpad: { label: "Launchpad", description: "Search first, favorites one click away." },
  custom: { label: "Custom", description: "Build your own Home from widgets." },
};

export const HOME_TEMPLATE_LABELS: Record<HomeTemplate, string> = Object.fromEntries(
  HOME_TEMPLATES.map((id) => [id, HOME_TEMPLATE_INFO[id].label]),
) as Record<HomeTemplate, string>;

export type HomeBackgroundGroup = "solid" | "gradient" | "pattern" | "ascii" | "custom";

export interface HomeBackgroundInfo {
  label: string;
  group: HomeBackgroundGroup;
  /** "auto" follows the app theme; "dark"/"light" are fixed (the background is a picture). */
  tone: "auto" | "dark" | "light";
  description?: string;
}

export const HOME_BACKGROUND_INFO = {
  paper: { label: "Paper", group: "solid", tone: "auto" },
  linen: { label: "Linen", group: "solid", tone: "auto" },
  sage: { label: "Sage", group: "solid", tone: "auto" },
  mist: { label: "Mist", group: "solid", tone: "auto" },
  clay: { label: "Clay", group: "solid", tone: "auto" },
  slate: { label: "Slate", group: "solid", tone: "auto" },
  dusk: { label: "Dusk", group: "solid", tone: "dark" },
  ink: { label: "Ink", group: "solid", tone: "dark" },
  dawn: { label: "Dawn", group: "gradient", tone: "auto" },
  meadow: { label: "Meadow", group: "gradient", tone: "auto" },
  lagoon: { label: "Lagoon", group: "gradient", tone: "auto" },
  peach: { label: "Peach", group: "gradient", tone: "auto" },
  aurora: { label: "Aurora", group: "gradient", tone: "dark" },
  midnight: { label: "Midnight", group: "gradient", tone: "dark" },
  dots: { label: "Dot grid", group: "pattern", tone: "auto" },
  grid: { label: "Graph paper", group: "pattern", tone: "auto" },
  ruled: { label: "Ruled", group: "pattern", tone: "auto" },
  blueprint: { label: "Blueprint", group: "pattern", tone: "dark" },
  "ascii-moon": { label: "Full moon", group: "ascii", tone: "dark", description: "A lit moon in a still sky — hover to move the light." },
  "ascii-sunset": { label: "Ocean sunset", group: "ascii", tone: "dark", description: "A striped sun over rolling sea." },
  "ascii-galaxy": { label: "Spiral galaxy", group: "ascii", tone: "dark", description: "A turning galaxy in deep space." },
  "ascii-rain": { label: "Code rain", group: "ascii", tone: "dark", description: "Falling streams of glyphs." },
  "ascii-dunes": { label: "Dunes", group: "ascii", tone: "light", description: "Warm sand under a pale sun." },
  "ascii-topo": { label: "Topography", group: "ascii", tone: "light", description: "Contour lines of a shifting landscape." },
  "custom-color": { label: "Custom color", group: "custom", tone: "auto" },
  "custom-gradient": { label: "Custom gradient", group: "custom", tone: "auto" },
} as const satisfies Record<string, HomeBackgroundInfo>;

export type HomeBackground = keyof typeof HOME_BACKGROUND_INFO;
export const HOME_BACKGROUNDS = Object.keys(HOME_BACKGROUND_INFO) as HomeBackground[];
export type HomeAsciiBackground = Extract<HomeBackground, `ascii-${string}`>;

/** Animated backgrounds from earlier releases, mapped onto their successors. */
const LEGACY_BACKGROUNDS: Record<string, HomeBackground> = {
  "ascii-waves": "ascii-topo",
  "ascii-stars": "ascii-galaxy",
  "ascii-torus": "ascii-galaxy",
  "ascii-embers": "ascii-sunset",
  "ascii-ripples": "ascii-moon",
  "ascii-contours": "ascii-dunes",
  "ascii-life": "ascii-moon",
  "ascii-peaks": "ascii-moon",
  "ascii-aurora": "ascii-galaxy",
  "ascii-city": "ascii-rain",
  "ascii-deepsea": "ascii-moon",
  "ascii-sakura": "ascii-dunes",
  "ascii-silk": "ascii-topo",
  "ascii-fireflies": "ascii-moon",
  "ascii-snow": "ascii-moon",
  "ascii-halftone": "ascii-dunes",
  "ascii-nightsea": "ascii-moon",
  "ascii-pulse": "ascii-galaxy",
  "ascii-stitch": "ascii-topo",
  "ascii-signal": "ascii-rain",
  "ascii-flow": "ascii-galaxy",
  "ascii-ridges": "ascii-topo",
};

export const HOME_BACKGROUND_GROUPS: { id: HomeBackgroundGroup; label: string; hint?: string }[] = [
  { id: "solid", label: "Solid" },
  { id: "gradient", label: "Gradient" },
  { id: "pattern", label: "Pattern" },
  { id: "ascii", label: "ASCII wallpapers", hint: "Animated · hover to preview" },
  { id: "custom", label: "Custom" },
];

export function isAsciiBackground(value: HomeBackground): value is HomeAsciiBackground {
  return value.startsWith("ascii-");
}

export interface HomeGradient {
  from: string;
  to: string;
  angle: number;
  kind: "linear" | "radial";
}

export type HomeAsciiDensity = "fine" | "normal" | "large";

export interface HomeAsciiOptions {
  /** Animation speed multiplier, 0.25–3. */
  speed: number;
  /** Optional ink color that re-tints the scene. */
  ink?: string;
  /** Character size. */
  density?: HomeAsciiDensity;
  /** Render a single still frame. */
  still?: boolean;
  /** Strength of the readability veil behind content, 0–0.8 (default 0.35). */
  veil?: number;
  /** Set to false to stop the wallpaper reacting to hover and clicks. */
  cursor?: boolean;
}

export const DEFAULT_ASCII_VEIL = 0.35;

export const ASCII_FONT_SIZE: Record<HomeAsciiDensity, number> = { fine: 10, normal: 13, large: 17 };

export interface HomeTabSettings {
  template: HomeTemplate;
  background: HomeBackground;
  color?: string;
  gradient?: HomeGradient;
  ascii?: HomeAsciiOptions;
  /** Legacy per-tab layout; read once and migrated into a shared custom view. */
  custom?: HomeCustomLayout;
  /** Which saved custom view a "custom" tab shows. */
  view?: string;
}

export const defaultHomeTabSettings: HomeTabSettings = {
  template: "desk",
  background: "paper",
};

export const DEFAULT_CUSTOM_COLOR = "#dfe7dc";
export const DEFAULT_GRADIENT: HomeGradient = { from: "#f6d5c4", to: "#c9d9e8", angle: 135, kind: "linear" };
const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

type Loose = Record<string, unknown>;

function asObject(value: unknown): Loose | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : undefined;
}

function normalizeGradient(value: unknown): HomeGradient | undefined {
  const g = asObject(value);
  if (!g || !isHexColor(g.from) || !isHexColor(g.to)) return undefined;
  const raw = typeof g.angle === "number" && Number.isFinite(g.angle) ? Math.round(g.angle) : 135;
  return {
    from: g.from.toLowerCase(),
    to: g.to.toLowerCase(),
    angle: ((raw % 360) + 360) % 360,
    kind: g.kind === "radial" ? "radial" : "linear",
  };
}

function normalizeAscii(value: unknown): HomeAsciiOptions | undefined {
  const a = asObject(value);
  if (!a) return undefined;
  const out: HomeAsciiOptions = { speed: typeof a.speed === "number" && a.speed >= 0.25 && a.speed <= 3 ? a.speed : 1 };
  if (isHexColor(a.ink)) out.ink = a.ink.toLowerCase();
  if (a.density === "fine" || a.density === "large") out.density = a.density;
  if (a.still === true) out.still = true;
  if (a.cursor === false) out.cursor = false;
  if (typeof a.veil === "number" && a.veil >= 0 && a.veil <= 0.8) out.veil = Math.round(a.veil * 100) / 100;
  return out;
}

export function normalizeHomeTabSettings(value?: unknown): HomeTabSettings {
  const v = asObject(value) ?? {};
  const rawTemplate = typeof v.template === "string" ? v.template : "";
  const template = LEGACY_TEMPLATES[rawTemplate] ?? (HOME_TEMPLATES.includes(rawTemplate as HomeTemplate) ? (rawTemplate as HomeTemplate) : defaultHomeTabSettings.template);
  const rawBackground = typeof v.background === "string" ? (LEGACY_BACKGROUNDS[v.background] ?? v.background) : "";
  let background = HOME_BACKGROUNDS.includes(rawBackground as HomeBackground) ? (rawBackground as HomeBackground) : defaultHomeTabSettings.background;
  const out: HomeTabSettings = { template, background };
  if (isHexColor(v.color)) out.color = v.color.toLowerCase();
  const gradient = normalizeGradient(v.gradient);
  if (gradient) out.gradient = gradient;
  const ascii = normalizeAscii(v.ascii);
  if (ascii) out.ascii = ascii;
  const custom = normalizeCustomLayout(v.custom);
  if (custom) out.custom = custom;
  if (template === "custom" && typeof v.view === "string" && /^[\w-]{1,40}$/.test(v.view)) out.view = v.view;
  if ((background === "custom-color" && !out.color) || (background === "custom-gradient" && !out.gradient)) {
    background = defaultHomeTabSettings.background;
    out.background = background;
  }
  return out;
}

/** CSS background for a user-picked gradient. */
export function gradientCss(g: HomeGradient): string {
  return g.kind === "radial"
    ? `radial-gradient(circle at 30% 20%, ${g.from}, ${g.to})`
    : `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})`;
}

/** Relative luminance (0–1) of a #rrggbb color. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Whether text on this Home should be light-on-dark or dark-on-light. */
export function homeTone(settings: Pick<HomeTabSettings, "background" | "color" | "gradient">, theme: "light" | "dark"): "light" | "dark" {
  const { background } = settings;
  if (background === "custom-color" && settings.color) return luminance(settings.color) < 0.3 ? "dark" : "light";
  if (background === "custom-gradient" && settings.gradient) {
    const mid = (luminance(settings.gradient.from) + luminance(settings.gradient.to)) / 2;
    return mid < 0.3 ? "dark" : "light";
  }
  const tone: HomeBackgroundInfo["tone"] = HOME_BACKGROUND_INFO[background].tone;
  return tone === "auto" ? theme : tone;
}

// ---------------------------------------------------------------------------
// Workspace Home preferences: each view (built-in or custom) keeps its own
// background, and one view is the default for new Home tabs.

export const HOME_BACKGROUND_KEYS = ["background", "color", "gradient", "ascii"] as const;
export type HomeBackgroundSettings = Pick<HomeTabSettings, "background" | "color" | "gradient" | "ascii">;

export interface HomePrefs {
  /** A built-in template id, or a custom view id. */
  defaultView?: string;
  /** Background per view key (see homeViewKey). */
  backgrounds: Record<string, HomeBackgroundSettings>;
  /**
   * Per-page backgrounds keyed by page id. Owned and validated by
   * lib/pageBackgroundModel.ts; kept here only so it persists with the
   * workspace's UI settings.
   */
  pageBackgrounds?: Record<string, unknown>;
}

export const DEFAULT_HOME_BACKGROUND: HomeBackgroundSettings = { background: "paper" };
const VIEW_KEY = /^[\w-]{1,40}$/;
const MAX_PREF_BACKGROUNDS = 64;
const PAGE_KEY = /^[\w.:-]{1,80}$/;
const MAX_PAGE_BACKGROUND_ENTRIES = 500;

/** The key a tab's background is stored under: its template, or its custom view id. */
export function homeViewKey(settings: Pick<HomeTabSettings, "template" | "view">): string {
  return settings.template === "custom" ? (settings.view ?? "custom") : settings.template;
}

export function normalizeHomeBackground(value: unknown): HomeBackgroundSettings {
  const { background, color, gradient, ascii } = normalizeHomeTabSettings(value);
  const out: HomeBackgroundSettings = { background };
  if (color) out.color = color;
  if (gradient) out.gradient = gradient;
  if (ascii) out.ascii = ascii;
  return out;
}

export function normalizeHomePrefs(value: unknown): HomePrefs {
  const v = asObject(value) ?? {};
  const out: HomePrefs = { backgrounds: {} };
  if (typeof v.defaultView === "string" && VIEW_KEY.test(v.defaultView)) out.defaultView = v.defaultView;
  const backgrounds = asObject(v.backgrounds);
  if (backgrounds) {
    for (const [key, bg] of Object.entries(backgrounds).slice(0, MAX_PREF_BACKGROUNDS)) {
      if (VIEW_KEY.test(key) && asObject(bg)) out.backgrounds[key] = normalizeHomeBackground(bg);
    }
  }
  const pages = asObject(v.pageBackgrounds);
  if (pages) {
    const kept = Object.entries(pages).filter(([key, bg]) => PAGE_KEY.test(key) && asObject(bg)).slice(0, MAX_PAGE_BACKGROUND_ENTRIES);
    if (kept.length) out.pageBackgrounds = Object.fromEntries(kept);
  }
  return out;
}

/** Background of a view, falling back to plain paper. */
export function backgroundForView(prefs: HomePrefs, key: string): HomeBackgroundSettings {
  return prefs.backgrounds[key] ?? DEFAULT_HOME_BACKGROUND;
}

/** Tab settings a new Home tab starts with: the default view when it still exists. */
export function defaultTabSettings(prefs: HomePrefs, viewIds: string[]): HomeTabSettings {
  const key = prefs.defaultView;
  if (key && HOME_TEMPLATES.includes(key as HomeTemplate) && key !== "custom") return { ...defaultHomeTabSettings, template: key as HomeTemplate };
  if (key && viewIds.includes(key)) return { ...defaultHomeTabSettings, template: "custom", view: key };
  return { ...defaultHomeTabSettings };
}

/** Split a menu patch into the view's background part and the tab's own part. */
export function splitBackgroundPatch(patch: Partial<HomeTabSettings>): { background?: Partial<HomeBackgroundSettings>; tab: Partial<HomeTabSettings> } {
  const background: Partial<HomeBackgroundSettings> = {};
  const tab: Partial<HomeTabSettings> = {};
  let hasBackground = false;
  for (const [key, value] of Object.entries(patch) as [keyof HomeTabSettings, unknown][]) {
    if ((HOME_BACKGROUND_KEYS as readonly string[]).includes(key)) {
      (background as Record<string, unknown>)[key] = value;
      hasBackground = true;
    } else (tab as Record<string, unknown>)[key] = value;
  }
  return { background: hasBackground ? background : undefined, tab };
}
