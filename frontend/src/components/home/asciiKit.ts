// Shared types and helpers for the ASCII wallpaper scenes.
//
// Each scene is a composed picture: a painted backdrop (sky, glows, solid
// silhouettes) with glyph texture and motion on top. Geometry is computed in
// cell units from the grid size, so a scene frames itself the same way on a
// full window and on a 200px menu thumbnail.

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface SceneGrid {
  cols: number;
  rows: number;
  /** Cell size in CSS px. */
  cw: number;
  ch: number;
  /** Surface size in CSS px. */
  w: number;
  h: number;
  buf: Uint16Array;
  /** The static layer captured after setup; frames may edit it for lasting changes. */
  base: Uint16Array;
  /** Pointer state in cell units, updated by the engine before every frame. */
  fx: PointerFx;
}

export interface Ripple {
  x: number;
  y: number;
  /** Seconds since the click. */
  age: number;
}

export interface PointerFx {
  /** Smoothed pointer position in cells. */
  x: number;
  y: number;
  /** 0 when the pointer is away, eases to 1 while it hovers. */
  hover: number;
  ripples: Ripple[];
  /** Cell height / cell width, to measure round distances in cell units. */
  aspect: number;
}

/** How long a click ripple lives, in seconds. */
export const RIPPLE_LIFE = 2.6;
/** Ripple speed in cell widths per second. */
export const RIPPLE_SPEED = 46;

/** Generic pointer response for picture scenes that do not handle it themselves. */
export interface SceneFx {
  /** Cells used for hover glints and the ripple ring, brightest first. */
  hot: number[];
  /** Hover radius in cell widths (default 9). */
  radius?: number;
  /** Rows below this fraction of the height squash the ripple into an ellipse (water). */
  squashBelow?: number;
  /** Only draw click rings (for scenes that handle hover themselves). */
  noHover?: boolean;
}

export interface AsciiScene<S = unknown> {
  /** Every character the scene uses; scenes refer to them by index. */
  glyphs: string;
  /** Up to 31 colors (#rrggbb or #rrggbbaa). */
  colors: string[];
  /** Flat fallback color. */
  base: string;
  /** Builds scene state; cells written now become the static layer. */
  setup(grid: SceneGrid, rand: () => number): S;
  /** Paints the static backdrop in device pixels. */
  backdrop(ctx: Ctx2D, w: number, h: number, state: S, grid: SceneGrid): void;
  /** Overlays animated cells for time t (seconds). */
  frame(grid: SceneGrid, state: S, t: number, dt: number, rand: () => number): void;
  /** Cell size as multiples of the font size, overriding the font's own advance × 1.2 line. */
  cell?: { w: number; h: number };
  /** Scenes without their own pointer handling get this generic overlay. */
  fx?: SceneFx;
  /** True when frame() reads grid.fx itself. */
  interactive?: boolean;
  /** Frame-rate ceiling for scenes that change many cells per frame. */
  fps?: number;
}

export function cell(glyph: number, color: number): number {
  return glyph * 32 + color + 1;
}

// ---------------------------------------------------------------------------
// Synthetic glyphs. The atlas draws these as shapes instead of font text, so
// dots, crosses and braille look the same on every machine.

/** A filled disc; size 0–15 (15 fills the cell). */
export const DISC = (size: number) => String.fromCharCode(0xe000 + size);
/** A plus sign; size 0–15. */
export const PLUS = (size: number) => String.fromCharCode(0xe100 + size);
/** A diagonal cross; size 0–15. */
export const TIMES = (size: number) => String.fromCharCode(0xe200 + size);
/** A ring outline; size 0–15. */
export const RING = (size: number) => String.fromCharCode(0xe300 + size);
/** Every braille pattern U+2800–U+28FF in bit order, for 2×4 sub-cell drawing. */
export const BRAILLE = Array.from({ length: 256 }, (_, i) => String.fromCharCode(0x2800 + i)).join("");
/** Braille dot bit for sub-cell (sx 0–1, sy 0–3). */
export const BRAILLE_BIT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

export function sizes(make: (size: number) => string): string {
  let out = "";
  for (let i = 0; i < 16; i++) out += make(i);
  return out;
}

// ---------------------------------------------------------------------------
// Pointer helpers

/**
 * Pointer energy at a cell: a soft lens around the hover point plus click
 * rings. Returns 0 when there is nothing near.
 */
export function pointerEnergy(fx: PointerFx, x: number, y: number, radius = 10, ringWidth = 3.2): number {
  let e = 0;
  if (fx.hover > 0.01) {
    const dx = (x - fx.x) / radius;
    const dy = ((y - fx.y) * fx.aspect) / radius;
    const d2 = dx * dx + dy * dy;
    if (d2 < 4) e = fx.hover * Math.exp(-d2 * 1.6);
  }
  for (let i = 0; i < fx.ripples.length; i++) e += ringEnergy(fx.ripples[i], fx.aspect, x, y, ringWidth);
  return e;
}

export function ringEnergy(r: Ripple, aspect: number, x: number, y: number, width = 3.2): number {
  const dx = x - r.x;
  const dy = (y - r.y) * aspect;
  const d = Math.sqrt(dx * dx + dy * dy);
  const off = (d - r.age * RIPPLE_SPEED) / width;
  if (off < -2.5 || off > 2.5) return 0;
  const life = 1 - r.age / RIPPLE_LIFE;
  return Math.exp(-off * off * 1.4) * life * life;
}

/** True when the pointer has nothing to show this frame. */
export function fxIdle(fx: PointerFx): boolean {
  return fx.hover < 0.01 && fx.ripples.length === 0;
}

/** The generic hover glints and click rings for picture scenes. */
export function applySceneFx(grid: SceneGrid, fx: PointerFx, style: SceneFx, t: number) {
  if (fxIdle(fx)) return;
  const { cols, rows, buf } = grid;
  const hot = style.hot;
  const radius = style.radius ?? 9;
  if (fx.hover > 0.01 && !style.noHover) {
    const rx = Math.ceil(radius * 1.6);
    const ry = Math.ceil((radius * 1.6) / fx.aspect);
    const frame = Math.floor(t * 8);
    for (let y = Math.max(0, Math.floor(fx.y) - ry); y <= Math.min(rows - 1, Math.floor(fx.y) + ry); y++) {
      for (let x = Math.max(0, Math.floor(fx.x) - rx); x <= Math.min(cols - 1, Math.floor(fx.x) + rx); x++) {
        const dx = (x - fx.x) / radius;
        const dy = ((y - fx.y) * fx.aspect) / radius;
        const e = fx.hover * Math.exp(-(dx * dx + dy * dy) * 1.8);
        if (e < 0.08) continue;
        const p = y * cols + x;
        const h = hash2(x + frame * 0.37, y - frame * 0.11);
        if (buf[p]) {
          if (h < e * 0.9) buf[p] = hot[Math.min(hot.length - 1, Math.floor((1 - e) * hot.length))];
        } else if (h < e * 0.16) {
          buf[p] = hot[hot.length - 1];
        }
      }
    }
  }
  const squash = style.squashBelow;
  for (const r of fx.ripples) {
    const life = 1 - r.age / RIPPLE_LIFE;
    const radiusNow = r.age * RIPPLE_SPEED;
    const level = Math.min(hot.length - 1, Math.floor((1 - life) * hot.length));
    const water = squash !== undefined && r.y > rows * squash;
    const sy = water ? 0.32 : 1 / fx.aspect;
    const steps = Math.max(12, Math.ceil(radiusNow * 6.6));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = Math.round(r.x + Math.cos(a) * radiusNow);
      const y = Math.round(r.y + Math.sin(a) * radiusNow * sy);
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      if (water && y < rows * squash!) continue;
      if (hash2(x * 1.7, y * 2.3 + i) > life * 1.25) continue;
      buf[y * cols + x] = hot[level];
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers

export function glyphIndex(glyphs: string) {
  const list = [...glyphs];
  return (ch: string) => {
    const i = list.indexOf(ch);
    if (i < 0) throw new Error(`glyph ${ch} missing`);
    return i;
  };
}

export function put(g: SceneGrid, x: number, y: number, v: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= g.cols || yi >= g.rows) return;
  g.buf[yi * g.cols + xi] = v;
}

export function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function noise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash2(i, 0.5) * (1 - u) + hash2(i + 1, 0.5) * u;
}

/** Ridged fractal noise in [0, 1]: sharp crests, soft valleys. */
export function ridged(x: number, octaves = 4): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * (1 - Math.abs(noise1(x) * 2 - 1));
    norm += amp;
    x *= 2.07;
    amp *= 0.48;
  }
  return sum / norm;
}

export function fbm(x: number, octaves = 4): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise1(x);
    norm += amp;
    x *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

export function vgrad(ctx: Ctx2D, w: number, y0: number, y1: number, stops: [number, string][]) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, w, y1 - y0);
}

export function glow(ctx: Ctx2D, x: number, y: number, r: number, color: string, alpha: number, sy = 1) {
  if (r <= 0) return;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, sy);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, `${color}${a}`);
  g.addColorStop(1, `${color}00`);
  ctx.fillStyle = g;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
}

/** Fills the area under a ridge line given in cell rows per column. */
export function fillRidge(ctx: Ctx2D, grid: SceneGrid, k: number, ridge: Float32Array, fill: string | CanvasGradient, bottom: number) {
  const cw = grid.cw * k;
  const ch = grid.ch * k;
  ctx.beginPath();
  ctx.moveTo(0, bottom);
  ctx.lineTo(0, ridge[0] * ch + ch * 0.5);
  for (let x = 0; x < ridge.length; x++) ctx.lineTo(x * cw + cw * 0.5, ridge[x] * ch + ch * 0.5);
  ctx.lineTo(grid.cols * cw, ridge[ridge.length - 1] * ch + ch * 0.5);
  ctx.lineTo(grid.cols * cw, bottom);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

export function linear(ctx: Ctx2D, y0: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [at, color] of stops) g.addColorStop(at, color);
  return g;
}

/** Draws a ridge outline whose glyphs follow the slope. */
export function rimRidge(grid: SceneGrid, ridge: Float32Array, color: number, G: (c: string) => number, peak = "^") {
  const { cols } = grid;
  for (let x = 0; x < cols; x++) {
    const r = ridge[x];
    const l = ridge[Math.max(0, x - 1)];
    const rr = ridge[Math.min(cols - 1, x + 1)];
    const a = (l + r) / 2;
    const b = (r + rr) / 2;
    const top = Math.round(Math.min(a, b, r));
    const bottom = Math.round(Math.max(a, b, r));
    const slope = rr - l;
    let ch = "_";
    if (r <= l && r <= rr && (l - r > 0.4 || rr - r > 0.4)) ch = peak;
    else if (slope < -0.7) ch = "/";
    else if (slope > 0.7) ch = "\\";
    else if (slope < -0.25) ch = "-";
    else if (slope > 0.25) ch = "-";
    for (let y = top; y <= bottom; y++) put(grid, x, y, cell(G(ch), color));
  }
}

export interface Twinkle {
  idx: Int32Array;
  rate: Float32Array;
  phase: Float32Array;
  bright: Uint16Array;
}

export function scatterStars(
  grid: SceneGrid,
  rand: () => number,
  density: number,
  maxRow: (x: number) => number,
  dim: number[],
  bright: number[],
): Twinkle {
  const idx: number[] = [];
  const rate: number[] = [];
  const phase: number[] = [];
  const hi: number[] = [];
  const count = Math.round(grid.cols * grid.rows * density);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * grid.cols);
    const limit = maxRow(x);
    const y = Math.floor(Math.pow(rand(), 1.4) * limit);
    if (y < 0 || y >= limit) continue;
    const p = y * grid.cols + x;
    grid.buf[p] = dim[Math.floor(rand() * dim.length)];
    if (rand() < 0.45) {
      idx.push(p);
      rate.push(0.6 + rand() * 1.8);
      phase.push(rand() * Math.PI * 2);
      hi.push(bright[Math.floor(rand() * bright.length)]);
    }
  }
  return { idx: Int32Array.from(idx), rate: Float32Array.from(rate), phase: Float32Array.from(phase), bright: Uint16Array.from(hi) };
}

export function twinkle(grid: SceneGrid, s: Twinkle, t: number) {
  for (let i = 0; i < s.idx.length; i++) {
    const v = Math.sin(t * s.rate[i] + s.phase[i]);
    if (v > 0.8) grid.buf[s.idx[i]] = s.bright[i];
    else if (v < -0.75) grid.buf[s.idx[i]] = 0;
  }
}


/** n colors evenly interpolated through the given #rrggbb(aa) stops. */
export function ramp(stops: string[], n: number, alpha?: number): string[] {
  const parse = (c: string) => {
    const v = Number.parseInt(c.slice(1, 7), 16);
    const a = c.length >= 9 ? Number.parseInt(c.slice(7, 9), 16) : 255;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
  };
  const pts = stops.map(parse);
  const hex = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1)) * (pts.length - 1);
    const k = Math.min(pts.length - 2, Math.floor(t));
    const f = t - k;
    const a = pts[k];
    const b = pts[Math.min(pts.length - 1, k + 1)];
    const c = [0, 1, 2, 3].map((j) => a[j] + (b[j] - a[j]) * f);
    const al = alpha !== undefined ? alpha * 255 : c[3];
    out.push(`#${hex(c[0])}${hex(c[1])}${hex(c[2])}${al < 255 ? hex(al) : ""}`);
  }
  return out;
}

/** Smooth 2D value noise in [0, 1]. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = xi & 255;
  const x1 = (xi + 1) & 255;
  const r0 = (yi & 255) << 8;
  const r1 = ((yi + 1) & 255) << 8;
  const a = LATTICE[r0 | x0];
  const b = LATTICE[r0 | x1];
  const c = LATTICE[r1 | x0];
  const d = LATTICE[r1 | x1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Value-noise lattice, 256×256, filled once from the same hash as hash2. */
const LATTICE = (() => {
  const out = new Float32Array(256 * 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) out[(y << 8) | x] = hash2(x, y);
  return out;
})();

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
