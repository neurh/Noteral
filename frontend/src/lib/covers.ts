export type CoverKind = "color" | "gradient" | "image";

export interface CoverOption {
  id: string;
  kind: CoverKind;
  name: string;
  tags: string[];
  value: string;
  preview: string;
}

export interface CoverPosition {
  x: number;
  y: number;
}

export interface CustomGradient {
  angle: number;
  from: string;
  to: string;
}

const POSITION_SUFFIX = /#pos=(\d{1,3}),(\d{1,3})$/;
const COLOR_VALUE = /^#[0-9a-f]{6}$/i;
const CUSTOM_GRADIENT_VALUE = /^gradientcustom:(\d{1,3}):(#[0-9a-f]{6}):(#[0-9a-f]{6})$/i;

const colors: Array<[string, string, string[]]> = [
  ["Linen", "#e8dfd2", ["neutral", "warm", "paper"]],
  ["Parchment", "#f0e7d8", ["neutral", "cream", "paper"]],
  ["Sand", "#ddc8a9", ["warm", "beige", "desert"]],
  ["Clay", "#c99a7a", ["warm", "terracotta", "earth"]],
  ["Terracotta", "#b86e55", ["warm", "orange", "earth"]],
  ["Rust", "#9f4f3e", ["warm", "red", "earth"]],
  ["Rosewood", "#8d5558", ["red", "rose", "muted"]],
  ["Blush", "#e3c3c0", ["rose", "pink", "soft"]],
  ["Plum", "#6f4c63", ["purple", "wine", "moody"]],
  ["Lavender", "#cfc3dd", ["purple", "soft", "calm"]],
  ["Iris", "#8c7aa8", ["purple", "violet"]],
  ["Dusk", "#5c5f7d", ["blue", "purple", "moody"]],
  ["Mist", "#c9d5db", ["blue", "grey", "calm"]],
  ["Sea glass", "#a8c3bd", ["green", "blue", "calm"]],
  ["Eucalyptus", "#92a895", ["green", "sage", "calm"]],
  ["Olive", "#7f825c", ["green", "earth"]],
  ["Forest", "#4f6555", ["green", "dark", "nature"]],
  ["Deep pine", "#35483f", ["green", "dark", "nature"]],
  ["Lagoon", "#5f9296", ["blue", "teal", "water"]],
  ["Ocean", "#4b7187", ["blue", "water", "calm"]],
  ["Slate", "#64727d", ["blue", "grey", "moody"]],
  ["Ink", "#35404d", ["blue", "dark", "night"]],
  ["Charcoal", "#34322f", ["neutral", "dark"]],
  ["Graphite", "#55514b", ["neutral", "grey"]],
  ["Cocoa", "#6b5142", ["brown", "warm", "earth"]],
  ["Amber", "#c68d4d", ["yellow", "warm", "sun"]],
  ["Marigold", "#d9a84e", ["yellow", "gold", "sun"]],
  ["Butter", "#ead8a6", ["yellow", "soft", "cream"]],
  ["Sage", "#bdc6a8", ["green", "soft", "nature"]],
  ["Sky", "#b9d2df", ["blue", "soft", "sky"]],
];

const gradients: Array<[string, string, string, string[]]> = [
  ["First light", "linear-gradient(135deg,#f6d5b8 0%,#e9a780 48%,#bf6b62 100%)", "linear-gradient(135deg,#f6d5b8,#e9a780 48%,#bf6b62)", ["sunrise", "warm", "peach"]],
  ["Apricot silk", "linear-gradient(120deg,#f8e4bf,#efb98f 55%,#d98b7d)", "linear-gradient(120deg,#f8e4bf,#efb98f 55%,#d98b7d)", ["apricot", "soft", "warm"]],
  ["Quiet rose", "linear-gradient(145deg,#f3ddd9,#d9a8ad 52%,#a96f7d)", "linear-gradient(145deg,#f3ddd9,#d9a8ad 52%,#a96f7d)", ["rose", "pink", "soft"]],
  ["Lavender haze", "linear-gradient(135deg,#e9e0ee,#c5b3d7 52%,#8f7fac)", "linear-gradient(135deg,#e9e0ee,#c5b3d7 52%,#8f7fac)", ["purple", "lavender", "calm"]],
  ["Blue hour", "linear-gradient(150deg,#c8d8e6,#849db4 50%,#465d76)", "linear-gradient(150deg,#c8d8e6,#849db4 50%,#465d76)", ["blue", "dusk", "calm"]],
  ["Deep water", "linear-gradient(135deg,#35586b,#28475b 48%,#182f40)", "linear-gradient(135deg,#35586b,#28475b 48%,#182f40)", ["ocean", "dark", "blue"]],
  ["Sea glass", "linear-gradient(135deg,#d9ece5,#9cc8bf 50%,#5b928e)", "linear-gradient(135deg,#d9ece5,#9cc8bf 50%,#5b928e)", ["green", "teal", "calm"]],
  ["Forest floor", "linear-gradient(140deg,#a9b59b,#75856a 53%,#415447)", "linear-gradient(140deg,#a9b59b,#75856a 53%,#415447)", ["green", "forest", "nature"]],
  ["Olive grove", "linear-gradient(125deg,#e2ddc5,#b8b493 55%,#7f8862)", "linear-gradient(125deg,#e2ddc5,#b8b493 55%,#7f8862)", ["olive", "sage", "earth"]],
  ["Golden field", "linear-gradient(135deg,#f1e2b8,#ddc47e 55%,#b49452)", "linear-gradient(135deg,#f1e2b8,#ddc47e 55%,#b49452)", ["gold", "sun", "warm"]],
  ["Honey", "linear-gradient(120deg,#f3d6a0,#dfae62 55%,#b77f42)", "linear-gradient(120deg,#f3d6a0,#dfae62 55%,#b77f42)", ["honey", "amber", "warm"]],
  ["Dune light", "linear-gradient(135deg,#f3e0c7,#d6b58d 52%,#a27b59)", "linear-gradient(135deg,#f3e0c7,#d6b58d 52%,#a27b59)", ["sand", "desert", "warm"]],
  ["Clay earth", "linear-gradient(140deg,#d8ad91,#b4775e 52%,#7e4a3e)", "linear-gradient(140deg,#d8ad91,#b4775e 52%,#7e4a3e)", ["clay", "brown", "earth"]],
  ["Ember", "linear-gradient(135deg,#e7b286,#c4775b 50%,#8d4744)", "linear-gradient(135deg,#e7b286,#c4775b 50%,#8d4744)", ["red", "orange", "fire"]],
  ["Midnight", "linear-gradient(145deg,#293343,#1e2734 55%,#111822)", "linear-gradient(145deg,#293343,#1e2734 55%,#111822)", ["night", "dark", "blue"]],
  ["Ink wash", "linear-gradient(135deg,#66727d,#424c56 52%,#292f36)", "linear-gradient(135deg,#66727d,#424c56 52%,#292f36)", ["grey", "ink", "moody"]],
  ["Paper", "linear-gradient(135deg,#fbf7ee,#f0e8d9 55%,#e2d6c4)", "linear-gradient(135deg,#fbf7ee,#f0e8d9 55%,#e2d6c4)", ["paper", "cream", "neutral"]],
  ["Soft dawn", "radial-gradient(circle at 22% 18%,#fbe7c8 0%,#f0c9a8 36%,#d99b8c 70%,#b97373 100%)", "radial-gradient(circle at 22% 18%,#fbe7c8,#f0c9a8 36%,#d99b8c 70%,#b97373)", ["radial", "sunrise", "peach"]],
  ["Lagoon glow", "radial-gradient(circle at 78% 22%,#d8ece1 0%,#a7cec4 34%,#6ca09d 68%,#3f6f76 100%)", "radial-gradient(circle at 78% 22%,#d8ece1,#a7cec4 34%,#6ca09d 68%,#3f6f76)", ["radial", "teal", "water"]],
  ["Evening glow", "radial-gradient(circle at 76% 28%,#f4d7ae 0%,#d9a17f 36%,#a76f70 68%,#685166 100%)", "radial-gradient(circle at 76% 28%,#f4d7ae,#d9a17f 36%,#a76f70 68%,#685166)", ["radial", "dusk", "warm"]],
  ["Moss light", "radial-gradient(circle at 25% 70%,#e2e4c9 0%,#b9c49f 35%,#849578 68%,#536a59 100%)", "radial-gradient(circle at 25% 70%,#e2e4c9,#b9c49f 35%,#849578 68%,#536a59)", ["radial", "green", "nature"]],
  ["Quiet sky", "linear-gradient(180deg,#dce9ee 0%,#c2d8e2 45%,#9ab9ca 100%)", "linear-gradient(180deg,#dce9ee,#c2d8e2 45%,#9ab9ca)", ["sky", "blue", "calm"]],
];

const images: Array<[string, string, string[]]> = [
  ["alpine-boat", "Alpine boat", ["lake", "mountains", "boat", "teal", "travel"]],
  ["alpine-canyon", "Alpine canyon", ["canyon", "river", "mountains", "earth", "adventure"]],
  ["city-skyline", "City skyline", ["city", "skyline", "architecture", "urban", "blue"]],
  ["coastline", "Coastline", ["ocean", "beach", "sand", "waves", "calm"]],
  ["desert-sunset", "Desert sunset", ["desert", "sunset", "warm", "sky", "minimal"]],
  ["emerald-valley", "Emerald valley", ["valley", "green", "fields", "mountains", "landscape"]],
  ["evening-lake", "Evening lake", ["lake", "dusk", "purple", "calm", "water"]],
  ["forest-bridge", "Forest bridge", ["forest", "bridge", "green", "path", "nature"]],
  ["lavender-field", "Lavender field", ["lavender", "flowers", "field", "purple", "summer"]],
  ["lone-tree", "Lone tree", ["tree", "field", "sky", "minimal", "nature"]],
  ["mountain-lake", "Mountain lake", ["mountains", "lake", "fog", "blue", "calm"]],
  ["ocean-wave", "Ocean wave", ["ocean", "wave", "blue", "water", "motion"]],
  ["poppy-field", "Poppy field", ["poppies", "flowers", "sunset", "warm", "field"]],
  ["rain-glass", "Rain glass", ["rain", "bokeh", "glass", "purple", "moody"]],
  ["redwood-forest", "Redwood forest", ["forest", "trees", "green", "light", "nature"]],
  ["river-bend", "River bend", ["river", "water", "green", "aerial", "nature"]],
  ["rolling-hills", "Rolling hills", ["hills", "green", "curves", "minimal", "landscape"]],
  ["snow-mist", "Snow mist", ["snow", "mountains", "mist", "winter", "monochrome"]],
  ["turquoise-lake", "Turquoise lake", ["lake", "turquoise", "mountains", "travel", "water"]],
  ["waterfall", "Waterfall", ["waterfall", "bridge", "green", "lush", "nature"]],
];

function colorOption([name, color, tags]: [string, string, string[]]): CoverOption {
  return { id: `color-${name.toLowerCase().replace(/\W+/g, "-")}`, kind: "color", name, tags, value: `color:${color}`, preview: color };
}

function gradientOption([name, preview, css, tags]: [string, string, string, string[]]): CoverOption {
  return { id: `gradient-${name.toLowerCase().replace(/\W+/g, "-")}`, kind: "gradient", name, tags, value: `gradient:${name.toLowerCase().replace(/\W+/g, "-")}`, preview: css };
}

function imageOption([id, name, tags]: [string, string, string[]]): CoverOption {
  return { id: `image-${id}`, kind: "image", name, tags, value: `image:${id}`, preview: `url("/covers/${id}.webp")` };
}

export const COVER_COLORS = colors.map(colorOption);
export const COVER_GRADIENTS = gradients.map(gradientOption);
export const COVER_IMAGES = images.map(imageOption);
export const COVER_OPTIONS = [...COVER_COLORS, ...COVER_GRADIENTS, ...COVER_IMAGES];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeUploadSrc(src: string): string | undefined {
  return src.startsWith("/__assets/") && !/["\\\n\r]/.test(src) ? src : undefined;
}

/** Longest image link accepted for covers, icons and page backgrounds. */
export const MAX_IMAGE_LINK = 2048;

/**
 * Validates an image link typed by the user (or sent by a plugin): only
 * http(s), no credentials, no fragment (so it never collides with `#pos=`),
 * and nothing that could break out of a CSS `url("…")`. Returns the
 * normalized href, or undefined when the link is unusable.
 */
export function safeImageLink(input: string): string | undefined {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw || raw.length > MAX_IMAGE_LINK) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (!url.hostname || url.username || url.password) return undefined;
  url.hash = "";
  const href = url.href;
  if (href.length > MAX_IMAGE_LINK || /["\\\s<>]/.test(href)) return undefined;
  return href;
}

/** The cover/icon value for an image link: `link:<https url>`. */
export function linkValue(input: string): string | undefined {
  const href = safeImageLink(input);
  return href ? `link:${href}` : undefined;
}

export function coverBase(value: string): string {
  return value.replace(POSITION_SUFFIX, "");
}

export function coverPositionOf(value: string): CoverPosition {
  const match = POSITION_SUFFIX.exec(value);
  if (!match) return { x: 50, y: 50 };
  return { x: clamp(Number(match[1]), 0, 100), y: clamp(Number(match[2]), 0, 100) };
}

export function isPositionableCover(value: string): boolean {
  const base = coverBase(value);
  if (base.startsWith("image:")) return Boolean(findCover(base));
  if (base.startsWith("upload:")) return safeUploadSrc(base.slice(7)) !== undefined;
  if (base.startsWith("link:")) return safeImageLink(base.slice(5)) !== undefined;
  return false;
}

export function withCoverPosition(value: string, x: number, y: number): string {
  const base = coverBase(value);
  if (!isPositionableCover(base)) return base;
  return `${base}#pos=${Math.round(clamp(x, 0, 100))},${Math.round(clamp(y, 0, 100))}`;
}

export function parseCustomGradient(value: string): CustomGradient | undefined {
  const match = CUSTOM_GRADIENT_VALUE.exec(coverBase(value));
  if (!match) return undefined;
  return {
    angle: clamp(Number(match[1]), 0, 360),
    from: match[2].toLowerCase(),
    to: match[3].toLowerCase(),
  };
}

export function customGradientValue(angle: number, from: string, to: string): string {
  const safeAngle = Math.round(clamp(Number.isFinite(angle) ? angle : 135, 0, 360));
  const safeFrom = COLOR_VALUE.test(from) ? from.toLowerCase() : "#f6d5b8";
  const safeTo = COLOR_VALUE.test(to) ? to.toLowerCase() : "#bf6b62";
  return `gradientcustom:${safeAngle}:${safeFrom}:${safeTo}`;
}

export function findCover(value: string): CoverOption | undefined {
  const base = coverBase(value);
  return COVER_OPTIONS.find((option) => option.value === base);
}

export function coverColor(value: string): string | undefined {
  const base = coverBase(value);
  if (!base.startsWith("color:")) return undefined;
  const color = base.slice(6);
  return COLOR_VALUE.test(color) ? color : undefined;
}

export function coverStyle(value: string): Record<string, string> | undefined {
  if (!value) return undefined;
  const base = coverBase(value);
  if (base.startsWith("color:")) {
    const color = coverColor(base);
    return color ? { backgroundColor: color } : undefined;
  }
  if (base.startsWith("gradientcustom:")) {
    const custom = parseCustomGradient(base);
    return custom
      ? { backgroundImage: `linear-gradient(${custom.angle}deg, ${custom.from}, ${custom.to})`, backgroundSize: "cover" }
      : undefined;
  }
  if (base.startsWith("gradient:")) {
    const option = findCover(base);
    return option ? { backgroundImage: option.preview, backgroundSize: "cover" } : undefined;
  }
  if (base.startsWith("image:")) {
    const option = findCover(base);
    const position = coverPositionOf(value);
    return option
      ? {
          backgroundImage: option.preview,
          backgroundSize: "cover",
          backgroundPosition: `${position.x}% ${position.y}%`,
        }
      : undefined;
  }
  if (base.startsWith("upload:") || base.startsWith("link:")) {
    const src = base.startsWith("link:") ? safeImageLink(base.slice(5)) : safeUploadSrc(base.slice(7));
    if (!src) return undefined;
    const position = coverPositionOf(value);
    return {
      backgroundImage: `url("${src}")`,
      backgroundSize: "cover",
      backgroundPosition: `${position.x}% ${position.y}%`,
    };
  }
  return undefined;
}

export function coverName(value: string): string {
  const base = coverBase(value);
  const custom = parseCustomGradient(base);
  if (custom) return "Custom gradient";
  if (base.startsWith("color:") && coverColor(base)) return "Custom color";
  const catalog = findCover(base);
  if (catalog) return catalog.name;
  if (base.startsWith("link:")) return safeImageLink(base.slice(5)) ? "Linked image" : "Cover";
  return safeUploadSrc(base.slice(7)) ? "Uploaded image" : "Cover";
}
