// ASCII wallpaper renderer.
//
// Two canvases: a backdrop painted once per resize (sky, glows, silhouettes)
// and a glyph layer. Scenes write cells into a Uint16Array (glyph * 32 +
// color + 1, 0 = empty); the renderer diffs it against the previous frame and
// only redraws changed cells, copying pre-rendered glyphs from an atlas. The
// same class runs inside a Web Worker (OffscreenCanvas) or on the main thread.

import { applySceneFx, RIPPLE_LIFE, type AsciiScene, type Ctx2D, type PointerFx, type SceneGrid } from "./asciiKit";
import { ASCII_SCENES, type AsciiSceneId } from "./asciiScenes";

export type { AsciiSceneId };

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface EngineOptions {
  scene: AsciiSceneId;
  speed: number;
  ink?: string;
  fontSize: number;
  maxFps: number;
  fontFamily: string;
  seed: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Color helpers (ink re-tinting)

function parseHex(color: string): [number, number, number, number] {
  const hex = color.slice(1);
  const n = Number.parseInt(hex.slice(0, 6), 16);
  const a = hex.length >= 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

function toHex([r, g, b, a]: [number, number, number, number]): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a * 255) : ""}`;
}

function tint(colors: string[], ink: string, base: string): string[] {
  const target = parseHex(ink);
  const bg = parseHex(base);
  const parsed = colors.map(parseHex);
  const lum = parsed.map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
  const bgLum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
  const spread = Math.max(1, ...lum.map((l) => Math.abs(l - bgLum)));
  return parsed.map((c, i) => {
    const k = 0.3 + 0.7 * (Math.abs(lum[i] - bgLum) / spread);
    return toHex([bg[0] + (target[0] - bg[0]) * k, bg[1] + (target[1] - bg[1]) * k, bg[2] + (target[2] - bg[2]) * k, c[3]]);
  });
}

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const ATLAS_PAD = 2;
/** Scenes start mid-animation so particles are already spread out. */
const START_TIME = 18;

// ---------------------------------------------------------------------------

export class AsciiEngine {
  private opts: EngineOptions;
  private glyphCtx: Ctx2D;
  private backCtx: Ctx2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private grid: SceneGrid | null = null;
  private prev: Uint16Array = new Uint16Array(0);
  private state: unknown = null;
  private atlas: AnyCanvas | null = null;
  private cwD = 0;
  private chD = 0;
  private time = START_TIME;
  private playing = false;
  private handle: number | ReturnType<typeof setTimeout> | null = null;
  private last = 0;
  private fps: number;
  private cost = 0;
  private rand: () => number;
  private dirty = true;
  private destroyed = false;
  private usingRaf = false;
  private fx: PointerFx = { x: 0, y: 0, hover: 0, ripples: [], aspect: 2 };
  private target = { x: 0, y: 0, inside: false, fresh: true };

  constructor(
    private glyphCanvas: AnyCanvas,
    private backCanvas: AnyCanvas,
    opts: EngineOptions,
  ) {
    this.opts = { ...opts };
    this.fps = opts.maxFps;
    this.rand = mulberry32(opts.seed);
    this.glyphCtx = glyphCanvas.getContext("2d", { alpha: true }) as Ctx2D;
    this.backCtx = backCanvas.getContext("2d", { alpha: false }) as Ctx2D;
  }

  resize(width: number, height: number, dpr: number) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const d = Math.max(1, Math.min(2, dpr || 1));
    if (w === this.width && h === this.height && d === this.dpr && this.grid) return;
    this.width = w;
    this.height = h;
    this.dpr = d;
    this.rebuild();
  }

  setOptions(patch: Partial<EngineOptions>) {
    const prev = this.opts;
    this.opts = { ...prev, ...patch };
    if (patch.maxFps !== undefined) this.fps = this.opts.maxFps;
    const structural =
      prev.scene !== this.opts.scene || prev.fontSize !== this.opts.fontSize || prev.ink !== this.opts.ink || prev.fontFamily !== this.opts.fontFamily;
    if (structural && this.width) this.rebuild();
  }

  /** Pointer position in CSS px relative to the canvas; inside=false fades the hover out. */
  pointer(x: number, y: number, inside: boolean) {
    const g = this.grid;
    if (!g) return;
    const tx = x / g.cw;
    const ty = y / g.ch;
    if (inside && (this.target.fresh || this.fx.hover < 0.02)) {
      // Appear where the pointer is instead of sliding in from the last spot.
      this.fx.x = tx;
      this.fx.y = ty;
    }
    this.target = { x: tx, y: ty, inside, fresh: !inside };
  }

  /** A click at CSS px (x, y): starts a ripple. */
  tap(x: number, y: number) {
    const g = this.grid;
    if (!g || !this.playing) return;
    const ripples = this.fx.ripples;
    if (ripples.length >= 5) ripples.shift();
    ripples.push({ x: x / g.cw, y: y / g.ch, age: 0 });
  }

  setPlaying(playing: boolean) {
    if (this.playing === playing) return;
    this.playing = playing;
    if (playing) {
      this.last = now();
      this.schedule();
    } else {
      this.cancel();
    }
  }

  destroy() {
    this.destroyed = true;
    this.cancel();
    this.atlas = null;
    this.grid = null;
  }

  private rebuild() {
    const scene = ASCII_SCENES[this.opts.scene] as AsciiScene;
    const { width, height, dpr } = this;
    const wD = Math.round(width * dpr);
    const hD = Math.round(height * dpr);
    this.glyphCanvas.width = wD;
    this.glyphCanvas.height = hD;
    this.backCanvas.width = wD;
    this.backCanvas.height = hD;

    // Cell metrics in whole device pixels so glyph copies never blur.
    const fontPx = this.opts.fontSize * dpr;
    const font = `500 ${fontPx}px ${this.opts.fontFamily}`;
    this.glyphCtx.font = font;
    const advance = this.glyphCtx.measureText("M").width || fontPx * 0.6;
    this.cwD = Math.max(2, Math.round(scene.cell ? fontPx * scene.cell.w : advance));
    this.chD = Math.max(3, Math.round(fontPx * (scene.cell ? scene.cell.h : 1.2)));
    const cols = Math.ceil(wD / this.cwD);
    const rows = Math.ceil(hD / this.chD);

    const colors = this.opts.ink ? tint(scene.colors, this.opts.ink, scene.base) : scene.colors;
    this.atlas = this.buildAtlas(scene.glyphs, colors, font);

    const buf = new Uint16Array(cols * rows);
    this.fx.aspect = this.chD / this.cwD;
    const grid: SceneGrid = { cols, rows, cw: this.cwD / dpr, ch: this.chD / dpr, w: width, h: height, buf, base: buf, fx: this.fx };
    const rand = mulberry32(this.opts.seed);
    this.state = scene.setup(grid, rand);
    grid.base = buf.slice();
    this.grid = grid;
    this.prev = new Uint16Array(cols * rows);

    this.backCtx.fillStyle = scene.base;
    this.backCtx.fillRect(0, 0, wD, hD);
    scene.backdrop(this.backCtx, wD, hD, this.state, grid);

    this.dirty = true;
    this.renderFrame(0);
  }

  private buildAtlas(glyphs: string, colors: string[], font: string): AnyCanvas {
    const sw = this.cwD + ATLAS_PAD * 2;
    const sh = this.chD + ATLAS_PAD * 2;
    const chars = [...glyphs];
    const atlas = makeCanvas(chars.length * sw, colors.length * sh);
    const ctx = atlas.getContext("2d") as Ctx2D;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    colors.forEach((color, c) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      chars.forEach((ch, g) => {
        if (ch === " ") return;
        const x0 = g * sw + ATLAS_PAD;
        const y0 = c * sh + ATLAS_PAD;
        if (!drawShape(ctx, ch.charCodeAt(0), x0, y0, this.cwD, this.chD, this.dpr)) ctx.fillText(ch, x0 + this.cwD / 2, y0 + this.chD / 2 + this.chD * 0.04);
      });
    });
    return atlas;
  }

  private renderFrame(dt: number) {
    const grid = this.grid;
    const atlas = this.atlas;
    if (!grid || !atlas || this.destroyed) return;
    const scene = ASCII_SCENES[this.opts.scene] as AsciiScene;
    grid.buf.set(grid.base);
    scene.frame(grid, this.state, this.time, dt, this.rand);
    if (scene.fx && !scene.interactive) applySceneFx(grid, this.fx, scene.fx, this.time);

    const ctx = this.glyphCtx;
    const { cols, rows, buf } = grid;
    const prev = this.prev;
    const cw = this.cwD;
    const ch = this.chD;
    const sw = cw + ATLAS_PAD * 2;
    const sh = ch + ATLAS_PAD * 2;
    if (this.dirty) {
      ctx.clearRect(0, 0, cols * cw, rows * ch);
      prev.fill(0);
      this.dirty = false;
    }
    for (let y = 0; y < rows; y++) {
      const row = y * cols;
      let x = 0;
      while (x < cols) {
        if (buf[row + x] === prev[row + x]) {
          x++;
          continue;
        }
        // Clear a run of changed cells at once, then stamp the new glyphs.
        let end = x;
        while (end < cols && buf[row + end] !== prev[row + end]) end++;
        ctx.clearRect(x * cw, y * ch, (end - x) * cw, ch);
        for (let i = x; i < end; i++) {
          const v = buf[row + i];
          if (v) {
            const g = ((v - 1) / 32) | 0;
            const c = (v - 1) % 32;
            ctx.drawImage(atlas, g * sw + ATLAS_PAD, c * sh + ATLAS_PAD, cw, ch, i * cw, y * ch, cw, ch);
          }
        }
        x = end;
      }
    }
    prev.set(buf);
  }

  private schedule() {
    if (!this.playing || this.destroyed) return;
    const tick = () => {
      this.handle = null;
      if (!this.playing || this.destroyed) return;
      const t = now();
      const cap = (ASCII_SCENES[this.opts.scene] as AsciiScene).fps;
      const interval = 1000 / (cap ? Math.min(cap, this.fps) : this.fps);
      if (t - this.last >= interval - 2) {
        const real = Math.min(0.1, (t - this.last) / 1000);
        const dt = real * this.opts.speed;
        this.last = t;
        this.stepPointer(real);
        this.time += dt;
        const start = now();
        this.renderFrame(dt);
        this.adapt(now() - start);
      }
      this.schedule();
    };
    const g = globalThis as { requestAnimationFrame?: (cb: () => void) => number };
    this.usingRaf = typeof g.requestAnimationFrame === "function";
    this.handle = this.usingRaf ? g.requestAnimationFrame!(tick) : setTimeout(tick, 1000 / this.fps);
  }

  private stepPointer(dt: number) {
    const fx = this.fx;
    const target = this.target;
    const follow = Math.min(1, dt * 16);
    fx.x += (target.x - fx.x) * follow;
    fx.y += (target.y - fx.y) * follow;
    const goal = target.inside ? 1 : 0;
    fx.hover += (goal - fx.hover) * Math.min(1, dt * (target.inside ? 5 : 2.5));
    if (fx.hover < 0.005) fx.hover = 0;
    if (fx.ripples.length) {
      for (const r of fx.ripples) r.age += dt;
      fx.ripples = fx.ripples.filter((r) => r.age < RIPPLE_LIFE);
    }
  }

  /** Halve the frame rate when frames get expensive; recover slowly. */
  private adapt(ms: number) {
    this.cost = this.cost * 0.9 + ms * 0.1;
    if (this.cost > 9 && this.fps > 12) {
      this.fps = Math.max(12, Math.round(this.fps / 1.5));
      this.cost = 0;
    } else if (this.cost < 3 && this.fps < this.opts.maxFps) {
      this.fps = Math.min(this.opts.maxFps, this.fps + 1);
    }
  }

  private cancel() {
    if (this.handle === null) return;
    const g = globalThis as { cancelAnimationFrame?: (id: number) => void };
    if (this.usingRaf && g.cancelAnimationFrame) g.cancelAnimationFrame(this.handle as number);
    else clearTimeout(this.handle as ReturnType<typeof setTimeout>);
    this.handle = null;
  }
}

/**
 * Draws synthetic glyphs (see asciiKit DISC/PLUS/TIMES/RING and braille) as
 * shapes. Returns false for ordinary characters.
 */
function drawShape(ctx: Ctx2D, code: number, x0: number, y0: number, cw: number, ch: number, dpr: number): boolean {
  const cx = x0 + cw / 2;
  const cy = y0 + ch / 2;
  const half = Math.min(cw, ch) / 2;
  if (code >= 0x2800 && code <= 0x28ff) {
    const bits = code - 0x2800;
    const dx = cw / 2;
    const dy = ch / 4;
    const r = Math.max(0.6 * dpr, Math.min(dx, dy) * 0.36);
    const map = [
      [0x01, 0, 0],
      [0x02, 0, 1],
      [0x04, 0, 2],
      [0x40, 0, 3],
      [0x08, 1, 0],
      [0x10, 1, 1],
      [0x20, 1, 2],
      [0x80, 1, 3],
    ];
    ctx.beginPath();
    for (const [bit, sx, sy] of map) {
      if (!(bits & bit)) continue;
      const px = x0 + dx * (sx + 0.5);
      const py = y0 + dy * (sy + 0.5);
      ctx.moveTo(px + r, py);
      ctx.arc(px, py, r, 0, Math.PI * 2);
    }
    ctx.fill();
    return true;
  }
  const kind = code >> 8;
  if (kind < 0xe0 || kind > 0xe3) return false;
  const k = ((code & 0xff) + 1) / 16;
  ctx.beginPath();
  if (kind === 0xe0) {
    ctx.arc(cx, cy, Math.max(0.5 * dpr, half * 0.96 * k), 0, Math.PI * 2);
    ctx.fill();
    return true;
  }
  const arm = Math.max(1.2 * dpr, half * 0.92 * k);
  ctx.lineWidth = Math.max(dpr, half * (0.1 + 0.08 * k));
  ctx.lineCap = "round";
  if (kind === 0xe1) {
    ctx.moveTo(cx - arm, cy);
    ctx.lineTo(cx + arm, cy);
    ctx.moveTo(cx, cy - arm);
    ctx.lineTo(cx, cy + arm);
  } else if (kind === 0xe2) {
    const a = arm * 0.78;
    ctx.moveTo(cx - a, cy - a);
    ctx.lineTo(cx + a, cy + a);
    ctx.moveTo(cx + a, cy - a);
    ctx.lineTo(cx - a, cy + a);
  } else {
    ctx.lineWidth = Math.max(dpr * 0.9, half * 0.1);
    ctx.arc(cx, cy, Math.max(dpr, half * 0.9 * k), 0, Math.PI * 2);
  }
  ctx.stroke();
  return true;
}
