// Page backgrounds: the pure model (types, validation, storage shape). It has
// no React or store dependencies so it can be unit-tested and reused by the
// SDK host; lib/pageBackground.ts binds it to the workspace store.

import { COVER_OPTIONS, coverBase, coverStyle, findCover, safeImageLink } from "./covers";
import { HOME_BACKGROUND_INFO, HOME_BACKGROUNDS, isAsciiBackground, type HomeAsciiBackground, type HomeAsciiDensity } from "./home";

export type PageBackground = {
  kind: "color" | "gradient" | "image" | "ascii";
  /** css color, css gradient, or image URL/data URL */
  value?: string;
  /** the ascii engine's options object (scene, text, colors, speed…) as the home background uses */
  ascii?: Record<string, unknown>;
  /** 0..1, default 1 */
  opacity?: number;
  /** 0..1 overlay to keep text readable */
  dim?: number;
};

export type PageBackgroundKind = PageBackground["kind"];

/**
 * Normalized ASCII options for a page background. Valid keys and values
 * (anything else is dropped; a missing or unknown scene makes the whole
 * background invalid):
 *
 *   scene    (required) "ascii-moon" | "ascii-sunset" | "ascii-galaxy" | "ascii-rain" | "ascii-dunes" | "ascii-topo"
 *            — the short forms "moon", "sunset", "galaxy", "rain", "dunes", "topo" are accepted too
 *   speed    number 0.25–3, animation speed multiplier (default 1)
 *   ink      "#rrggbb" hex color that re-tints the glyphs (default: the scene's own colors)
 *   density  "fine" | "normal" | "large" — character size 10 / 13 / 17 px (default "normal")
 *   still    boolean — true renders one still frame instead of animating (default false)
 *   cursor   boolean — false stops the scene reacting to hover and clicks (default true)
 *
 * These are the same options the Home tab's ASCII wallpapers use, except the
 * Home "veil" is replaced by the background's own `dim`.
 */
export interface PageAsciiOptions {
  scene: HomeAsciiBackground;
  speed?: number;
  ink?: string;
  density?: HomeAsciiDensity;
  still?: boolean;
  cursor?: boolean;
}

export const PAGE_ASCII_SCENES = HOME_BACKGROUNDS.filter(isAsciiBackground) as HomeAsciiBackground[];

export const ASCII_BACKGROUND_OPTIONS_DOC = [
  "ASCII page background options (PageBackground.ascii):",
  `- scene (required): ${PAGE_ASCII_SCENES.map((scene) => `"${scene}"`).join(" | ")}. Short forms without "ascii-" (e.g. "moon") are accepted.`,
  ...PAGE_ASCII_SCENES.map((scene) => `    ${scene}: ${HOME_BACKGROUND_INFO[scene].label} — ${HOME_BACKGROUND_INFO[scene].description}`),
  "- speed: number 0.25–3, animation speed multiplier (default 1).",
  '- ink: "#rrggbb" hex color that re-tints the glyphs (default: the scene\'s own colors).',
  '- density: "fine" | "normal" | "large" — character size 10 / 13 / 17 px (default "normal").',
  "- still: boolean — true draws one still frame instead of animating (default false).",
  "- cursor: boolean — false stops the scene reacting to hover and clicks (default true).",
  "Unknown keys are dropped; a missing or unknown scene makes the background invalid.",
  "Use the background's dim (0–1, default 0.55 for ascii) to keep page text readable.",
].join("\n");

/** Dim applied when a background does not set one: enough to keep text readable. */
export const DEFAULT_PAGE_BACKGROUND_DIM: Record<PageBackgroundKind, number> = {
  color: 0,
  gradient: 0,
  image: 0.35,
  ascii: 0.55,
};

/** Data URLs are kept small: backgrounds live in the workspace UI settings. */
export const MAX_BACKGROUND_DATA_URL = 48 * 1024;
const MAX_GRADIENT = 600;
const MAX_COLOR = 80;
export const MAX_PAGE_BACKGROUNDS = 500;
/** Budget for all page backgrounds of a workspace, as JSON (the UI settings object is capped at 256 KB). */
export const MAX_PAGE_BACKGROUNDS_BYTES = 160 * 1024;
export const PAGE_ID = /^[\w.:-]{1,80}$/;

const KINDS: readonly PageBackgroundKind[] = ["color", "gradient", "image", "ascii"];
const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX_ANY = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FN = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[-+0-9.%a-z\s,/]*\)$/i;
const NAMED_COLOR = /^[a-z]{3,24}$/i;
const VAR_COLOR = /^var\(--[a-z0-9-]{1,40}\)$/i;
const GRADIENT_FN = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(.*\)$/is;
const GRADIENT_CHARS = /^[-a-z0-9#%.,()\s/+]+$/i;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml);base64,[a-z0-9+/]+=*$/i;

type Loose = Record<string, unknown>;

function asObject(value: unknown): Loose | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : undefined;
}

function unit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

function balanced(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === "(") depth += 1;
    else if (char === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

export function normalizeBackgroundColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let color = value.trim();
  if (color.startsWith("color:")) color = color.slice(6);
  if (!color || color.length > MAX_COLOR) return undefined;
  if (HEX_ANY.test(color)) return color.toLowerCase();
  if (VAR_COLOR.test(color) || NAMED_COLOR.test(color)) return color;
  if (COLOR_FN.test(color) && balanced(color)) return color;
  return undefined;
}

export function normalizeBackgroundGradient(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  // Cover tokens from lib/covers.ts: "gradient:<name>" and "gradientcustom:<angle>:<from>:<to>".
  if (raw.startsWith("gradient:") || raw.startsWith("gradientcustom:")) return coverStyle(raw)?.backgroundImage;
  if (!raw || raw.length > MAX_GRADIENT || !GRADIENT_FN.test(raw) || !GRADIENT_CHARS.test(raw) || !balanced(raw)) return undefined;
  if (/url\s*\(|expression|image-set|element\s*\(/i.test(raw)) return undefined;
  return raw.replace(/\s+/g, " ");
}

function safeAssetPath(value: string): string | undefined {
  return value.startsWith("/__assets/") && !/["\\\s<>]/.test(value) && !value.includes("..") ? value : undefined;
}

export function normalizeBackgroundImage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = coverBase(value.trim());
  if (raw.startsWith("data:")) return raw.length <= MAX_BACKGROUND_DATA_URL && DATA_IMAGE.test(raw) ? raw : undefined;
  if (raw.startsWith("upload:")) return safeAssetPath(raw.slice(7));
  if (raw.startsWith("link:")) return safeImageLink(raw.slice(5));
  if (raw.startsWith("image:")) {
    // A bundled cover photo, e.g. "image:alpine-boat".
    const option = findCover(raw);
    const match = option ? /^url\("([^"]+)"\)$/.exec(option.preview) : null;
    return match?.[1];
  }
  if (raw.startsWith("/covers/")) {
    return COVER_OPTIONS.some((option) => option.preview === `url("${raw}")`) ? raw : undefined;
  }
  return safeAssetPath(raw) ?? safeImageLink(raw);
}

export function normalizeAsciiScene(value: unknown): HomeAsciiBackground | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim().toLowerCase();
  const scene = raw.startsWith("ascii-") ? raw : `ascii-${raw}`;
  return (PAGE_ASCII_SCENES as string[]).includes(scene) ? (scene as HomeAsciiBackground) : undefined;
}

export function normalizePageAscii(value: unknown, fallbackScene?: unknown): PageAsciiOptions | undefined {
  const a = asObject(value) ?? {};
  const scene = normalizeAsciiScene(a.scene) ?? normalizeAsciiScene(fallbackScene);
  if (!scene) return undefined;
  const out: PageAsciiOptions = { scene };
  if (typeof a.speed === "number" && Number.isFinite(a.speed)) {
    const speed = Math.round(Math.min(3, Math.max(0.25, a.speed)) * 100) / 100;
    if (speed !== 1) out.speed = speed;
  }
  if (typeof a.ink === "string" && HEX6.test(a.ink)) out.ink = a.ink.toLowerCase();
  if (a.density === "fine" || a.density === "large") out.density = a.density;
  if (a.still === true) out.still = true;
  if (a.cursor === false) out.cursor = false;
  return out;
}

/** Validate and clamp untrusted input (from plugins, the assistant or storage). Returns null when unusable. */
export function normalizePageBackground(input: unknown): PageBackground | null {
  const raw = asObject(input);
  if (!raw || typeof raw.kind !== "string" || !KINDS.includes(raw.kind as PageBackgroundKind)) return null;
  const kind = raw.kind as PageBackgroundKind;
  const out: PageBackground = { kind };
  if (kind === "ascii") {
    const ascii = normalizePageAscii(raw.ascii, raw.value);
    if (!ascii) return null;
    out.ascii = { ...ascii };
  } else {
    const value =
      kind === "color" ? normalizeBackgroundColor(raw.value)
        : kind === "gradient" ? normalizeBackgroundGradient(raw.value)
          : normalizeBackgroundImage(raw.value);
    if (!value) return null;
    out.value = value;
  }
  const opacity = unit(raw.opacity);
  if (opacity !== undefined && opacity !== 1) out.opacity = opacity;
  const dim = unit(raw.dim);
  if (dim !== undefined) out.dim = dim;
  return out;
}

/** Typed ASCII options of a normalized ascii background. */
export function pageAsciiOptions(background: PageBackground | null | undefined): PageAsciiOptions | undefined {
  return background?.kind === "ascii" ? normalizePageAscii(background.ascii) : undefined;
}

export function pageBackgroundDim(background: PageBackground): number {
  return background.dim ?? DEFAULT_PAGE_BACKGROUND_DIM[background.kind];
}

export function pageBackgroundOpacity(background: PageBackground): number {
  return background.opacity ?? 1;
}

/** Inline style for the color, gradient and image layers (ascii renders a canvas instead). */
export function pageBackgroundStyle(background: PageBackground): Record<string, string> | undefined {
  if (!background.value) return undefined;
  if (background.kind === "color") return { backgroundColor: background.value };
  if (background.kind === "gradient") return { backgroundImage: background.value, backgroundSize: "cover" };
  if (background.kind === "image") {
    return { backgroundImage: `url("${background.value}")`, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" };
  }
  return undefined;
}

/** The stored map (`homePrefs.pageBackgrounds`), normalized; unusable entries are dropped. */
export function readPageBackgrounds(prefs: unknown): Record<string, PageBackground> {
  const map = asObject(asObject(prefs)?.pageBackgrounds);
  const out: Record<string, PageBackground> = {};
  if (!map) return out;
  for (const [pageId, value] of Object.entries(map).slice(0, MAX_PAGE_BACKGROUNDS)) {
    if (!PAGE_ID.test(pageId)) continue;
    const background = normalizePageBackground(value);
    if (background) out[pageId] = background;
  }
  return out;
}

/**
 * The map with one page's background replaced (or removed with null). Throws
 * when the result would not fit the workspace budget.
 */
export function withPageBackground(map: Record<string, PageBackground>, pageId: string, background: PageBackground | null): Record<string, PageBackground> {
  if (!PAGE_ID.test(pageId)) throw new Error("Invalid page id.");
  const next = { ...map };
  if (background) next[pageId] = background;
  else delete next[pageId];
  if (background) {
    if (Object.keys(next).length > MAX_PAGE_BACKGROUNDS) throw new Error(`A workspace can have at most ${MAX_PAGE_BACKGROUNDS} page backgrounds.`);
    if (JSON.stringify(next).length > MAX_PAGE_BACKGROUNDS_BYTES) {
      throw new Error("Page backgrounds in this workspace are too large. Use an uploaded image or a link instead of a data URL.");
    }
  }
  return next;
}
