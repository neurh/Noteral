// ASCII wallpaper scenes.
//
// Each scene is a composed picture: a painted backdrop (sky, glows, solid
// silhouettes) with ASCII texture and motion on top. Geometry is computed in
// cell units from the grid size, so a scene frames itself the same way on a
// full window and on a 200px menu thumbnail. Dot, cross and braille fields
// live in asciiFields.ts; shared types and helpers in asciiKit.ts.

import { FIELD_SCENES } from "./asciiFields";
import {
  applySceneFx,
  cell,
  fbm,
  fillRidge,
  glow,
  glyphIndex,
  hash2,
  linear,
  noise2,
  put,
  ramp,
  rimRidge,
  scatterStars,
  twinkle,
  vgrad,
  type AsciiScene,
  type Twinkle,
} from "./asciiKit";

export type { AsciiScene, Ctx2D, SceneGrid } from "./asciiKit";
export { cell } from "./asciiKit";

// ---------------------------------------------------------------------------
// Ocean sunset

const SUN_GLYPHS = " .-~=_v^'";
const SG = glyphIndex(SUN_GLYPHS);
// 0-5 sea ramp (horizon → near), 6-11 reflection, 12-15 clouds, 16 birds, 17 horizon
const SEA = ["#ffc79acc", "#f6a08aaa", "#d97b8c99", "#a35d8d88", "#7a4c8a77", "#56407a66"];
const REFLECT = ["#fff3c2", "#ffe29a", "#ffc078", "#ff9e6b", "#ff8a7aaa", "#ff7d8a77"];
const CLOUD = ["#f9b5a8cc", "#f08fa4bb", "#c26e9ebb", "#8f5a95aa"];

interface Cloud {
  y: number;
  x0: number;
  len: number;
  v: number;
  color: number;
}

interface SunsetState {
  horizon: number;
  cx: number;
  sunW: number;
  clouds: Cloud[];
  birds: { x: number; y: number; v: number; phase: number }[];
}

const sunset: AsciiScene<SunsetState> = {
  glyphs: SUN_GLYPHS,
  colors: [...SEA, ...REFLECT, ...CLOUD, "#3b1f3fcc", "#ffd8a866"],
  base: "#2a1834",
  fx: { hot: [cell(SG("="), 6), cell(SG("~"), 7), cell(SG("-"), 8), cell(SG("."), 9)], squashBelow: 0.6 },
  setup(grid, rand) {
    const { cols, rows } = grid;
    const horizon = Math.round(rows * 0.6);
    const sunPx = Math.min(grid.h * 0.22, grid.w * 0.14);
    for (let x = 0; x < cols; x++) put(grid, x, horizon, cell(SG("_"), 17));
    const clouds: Cloud[] = [];
    const n = Math.max(3, Math.round(cols / 18));
    for (let i = 0; i < n; i++) {
      const y = Math.round(rows * 0.08 + rand() * (horizon - rows * 0.2));
      const f = y / horizon;
      clouds.push({ y, x0: rand() * cols, len: 8 + rand() * cols * 0.22, v: 0.25 + rand() * 0.45, color: 12 + Math.min(3, Math.floor((1 - f) * 4)) });
    }
    const birds = Array.from({ length: 4 }, (_, i) => ({ x: cols * (0.1 + i * 0.05) + rand() * 4, y: rows * (0.24 + rand() * 0.12), v: 1.2 + rand() * 0.4, phase: rand() * 6 }));
    return { horizon, cx: cols * 0.5, sunW: sunPx / grid.cw, clouds, birds };
  },
  backdrop(ctx, w, h, s, grid) {
    const k = w / grid.w;
    const hy = (s.horizon + 0.5) * grid.ch * k;
    vgrad(ctx, w, 0, hy, [
      [0, "#1c1236"],
      [0.38, "#5a2a5e"],
      [0.7, "#c4566b"],
      [0.9, "#f08a62"],
      [1, "#f9b872"],
    ]);
    vgrad(ctx, w, hy, h, [
      [0, "#a3496a"],
      [0.25, "#5c2e5a"],
      [1, "#140c22"],
    ]);
    const cx = w * 0.5;
    const r = s.sunW * grid.cw * k;
    glow(ctx, cx, hy, r * 4.5, "#ff9a6a", 0.42, 0.55);
    glow(ctx, cx, hy, r * 1.8, "#ffd38a", 0.5);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, hy);
    ctx.clip();
    const sun = ctx.createLinearGradient(0, hy - r, 0, hy);
    sun.addColorStop(0, "#fff1b8");
    sun.addColorStop(0.55, "#ffc168");
    sun.addColorStop(1, "#ff7a6a");
    ctx.fillStyle = sun;
    // Retro banded sun: horizontal slices with widening gaps near the sea.
    const bands = 9;
    for (let i = 0; i < bands; i++) {
      const top = hy - r + (i / bands) * r;
      const gap = i < 4 ? 0 : ((i - 3) / (bands - 3)) * (r / bands) * 0.8;
      ctx.beginPath();
      ctx.rect(0, top + gap, w, r / bands - gap + 0.5);
      ctx.save();
      ctx.clip();
      ctx.beginPath();
      ctx.arc(cx, hy, r, Math.PI, 0);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },
  frame(grid, s, t) {
    const { cols, rows } = grid;
    const H = s.horizon;
    for (let y = H + 1; y < rows; y++) {
      const d = (y - H) / Math.max(1, rows - H);
      const f = 0.32 * (1.25 - d * 0.75);
      const thr = 0.95 - d * 0.45;
      const sea = cell(SG(d < 0.25 ? "-" : "~"), Math.min(5, Math.floor(d * 6)));
      const half = s.sunW * (0.95 - d * 0.35) + Math.sin(y * 0.9 + t * 1.6) * 1.2;
      for (let x = 0; x < cols; x++) {
        const dx = Math.abs(x - s.cx);
        if (dx < half) {
          const shimmer = Math.sin(x * 0.8 + t * 3.2 + y * 2.3) + Math.sin(y * 2.7 - t * 1.9 + x * 0.15);
          if (shimmer > 0.1) {
            const c = 6 + Math.min(5, Math.floor((dx / half) * 3 + d * 3));
            put(grid, x, y, cell(SG(d < 0.35 ? "=" : "-"), c));
            continue;
          }
        }
        const wave = Math.sin(x * f + t * 1.05 + y * 1.7) + 0.6 * Math.sin(x * f * 0.45 - t * 0.7 + y * 0.9);
        if (wave > thr) put(grid, x, y, sea);
      }
    }
    for (const c of s.clouds) {
      const span = cols + c.len * 2;
      const x0 = ((((c.x0 + t * c.v) % span) + span) % span) - c.len;
      for (let i = 0; i < c.len; i++) {
        const e = Math.min(i, c.len - 1 - i);
        put(grid, x0 + i, c.y, cell(SG(e < 2 ? "-" : "="), c.color));
        if (i > c.len * 0.2 && i < c.len * 0.75) put(grid, x0 + i + 3, c.y + 1, cell(SG(e < 3 ? "." : "-"), Math.min(15, c.color + 1)));
      }
    }
    for (const b of s.birds) {
      const x = ((b.x + t * b.v) % (cols + 20)) - 10;
      const y = b.y + Math.sin(t * 0.6 + b.phase) * 0.8;
      put(grid, x, y, cell(SG(Math.sin(t * 6 + b.phase) > 0 ? "v" : "-"), 16));
    }
  },
};

// ---------------------------------------------------------------------------
// Spiral galaxy

const GALAXY_GLYPHS = " .'`,:;+*%@o";
const GAL = glyphIndex(GALAXY_GLYPHS);
// 0-2 core warm, 3-5 inner violet, 6-8 outer blue, 9 pink knots, 10-11 field stars, 12 bright star
const GALAXY_COLORS = ["#fff3dc", "#ffd59a", "#ffb68a", "#e4d6ff", "#b9a6ff", "#9283ff", "#9fb4ff", "#7486f0", "#5865c8", "#ff8fd0", "#8f97c8", "#5e6699", "#ffffff"];
const GALAXY_RAMP = [".", "'", ":", ";", "+", "*", "%", "@"].map(GAL);

interface GalaxyState {
  cx: number;
  cy: number;
  radius: number;
  r: Float32Array;
  theta: Float32Array;
  omega: Float32Array;
  weight: Float32Array;
  knot: Uint8Array;
  density: Float32Array;
  stars: Twinkle;
}

const galaxy: AsciiScene<GalaxyState> = {
  glyphs: GALAXY_GLYPHS,
  colors: GALAXY_COLORS,
  base: "#05030c",
  fx: { hot: [cell(GAL("@"), 12), cell(GAL("*"), 0), cell(GAL("+"), 3), cell(GAL("."), 4)] },
  setup(grid, rand) {
    const { cols, rows } = grid;
    const stars = scatterStars(grid, rand, 0.018, () => rows, [cell(GAL("."), 10), cell(GAL("'"), 11)], [cell(GAL("+"), 12), cell(GAL("*"), 3)]);
    const n = Math.max(600, Math.min(5200, Math.round(cols * rows * 0.6)));
    const r = new Float32Array(n);
    const theta = new Float32Array(n);
    const omega = new Float32Array(n);
    const weight = new Float32Array(n);
    const knot = new Uint8Array(n);
    const arms = 2;
    for (let i = 0; i < n; i++) {
      const core = i < n * 0.18;
      const disk = !core && i < n * 0.32;
      const rr = core ? Math.pow(rand(), 1.6) * 0.18 : disk ? 0.08 + Math.pow(rand(), 1.3) * 0.8 : 0.06 + Math.pow(rand(), 0.9) * 0.94;
      const arm = i % arms;
      const g = (rand() + rand() + rand() - 1.5) / 1.5;
      const spread = g * (0.36 + 0.3 * (1 - rr));
      r[i] = rr * (1 + (rand() - 0.5) * 0.12);
      theta[i] = core || disk ? rand() * Math.PI * 2 : (arm * Math.PI * 2) / arms + Math.log(rr + 0.04) * 2.2 + spread;
      omega[i] = 0.5 / (0.3 + rr);
      weight[i] = core ? 1.3 : disk ? 0.3 : 0.7 + (1 - rr) * 0.7;
      knot[i] = !core && !disk && rr > 0.3 && rand() < 0.01 ? 1 : 0;
    }
    return {
      cx: cols * 0.5,
      cy: rows * 0.5,
      radius: Math.min(grid.w * 0.48, grid.h * 1.05),
      r,
      theta,
      omega,
      weight,
      knot,
      density: new Float32Array(cols * rows),
      stars,
    };
  },
  backdrop(ctx, w, h) {
    vgrad(ctx, w, 0, h, [
      [0, "#07041a"],
      [0.5, "#0b0620"],
      [1, "#050311"],
    ]);
    const m = Math.min(w, h);
    ctx.save();
    ctx.translate(w * 0.5, h * 0.5);
    ctx.rotate(-0.32);
    glow(ctx, 0, 0, Math.min(w * 0.5, h * 1.05), "#5a3cff", 0.18, 0.42);
    glow(ctx, 0, 0, m * 0.42, "#b06cff", 0.2, 0.5);
    glow(ctx, 0, 0, m * 0.16, "#ffd9a0", 0.55, 0.62);
    ctx.restore();
    glow(ctx, w * 0.15, h * 0.8, m * 0.4, "#ff4fa3", 0.06);
    glow(ctx, w * 0.88, h * 0.15, m * 0.35, "#3cc0ff", 0.05);
  },
  frame(grid, s, t) {
    twinkle(grid, s.stars, t);
    const { cols, rows, cw, ch } = grid;
    const tilt = -0.32;
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const R = s.radius;
    const D = s.density;
    D.fill(0);
    const knots: number[] = [];
    for (let i = 0; i < s.r.length; i++) {
      const th = s.theta[i] + s.omega[i] * t * 0.05;
      const px = Math.cos(th) * s.r[i] * R;
      const py = Math.sin(th) * s.r[i] * R * 0.4;
      const x = Math.floor(s.cx + (px * ct - py * st) / cw);
      const y = Math.floor(s.cy + (px * st + py * ct) / ch);
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const p = y * cols + x;
      D[p] += s.weight[i];
      if (s.knot[i]) knots.push(p);
    }
    const levels = GALAXY_RAMP.length;
    for (let p = 0; p < D.length; p++) {
      const d = D[p];
      if (d < 0.3) continue;
      const level = Math.min(levels - 1, Math.floor(Math.log2(1 + d) * 1.45));
      const x = p % cols;
      const y = (p / cols) | 0;
      // Elliptical radius in px decides the tint: warm core → violet → blue rim.
      const dx = (x - s.cx) * cw;
      const dy = (y - s.cy) * ch;
      const rx = dx * ct + dy * st;
      const ry = (-dx * st + dy * ct) / 0.4;
      const rr = Math.hypot(rx, ry) / R;
      const band = rr < 0.08 ? 0 : rr < 0.16 ? 1 : rr < 0.24 ? 2 : rr < 0.38 ? 3 : rr < 0.5 ? 4 : rr < 0.62 ? 5 : rr < 0.75 ? 6 : rr < 0.88 ? 7 : 8;
      grid.buf[p] = cell(GALAXY_RAMP[level], band);
    }
    for (const p of knots) grid.buf[p] = cell(GAL("*"), 9);
  },
};

// ---------------------------------------------------------------------------
// Code rain

const RAIN_GLYPHS = " 0123456789ABCDEFZ:.=*+-<>|";
const RAIN_SYMBOLS = RAIN_GLYPHS.length - 1;
// near: 0 head, 1-6 tail fade; far: 7 head, 8-11 fade
const RAIN_COLORS = ["#eafff1", "#7dfaa8ee", "#46d881cc", "#2fb069aa", "#228a5188", "#1a6a3e66", "#134d2b44", "#a8f0c499", "#3fae6c66", "#2a7f4f55", "#1d5c3844", "#14402733"];

interface Drop {
  y: number;
  v: number;
  len: number;
  far: boolean;
}

interface RainState {
  drops: Drop[][];
}

const rain: AsciiScene<RainState> = {
  glyphs: RAIN_GLYPHS,
  colors: RAIN_COLORS,
  base: "#020a06",
  fx: { hot: ["Z", "+", ":", "."].map((g, i) => cell(RAIN_GLYPHS.indexOf(g), i)) },
  setup(grid, rand) {
    const drops: Drop[][] = [];
    for (let x = 0; x < grid.cols; x++) {
      const far = rand() < 0.55;
      // Leave about a third of the columns empty so the field breathes.
      const count = rand() < 0.32 ? 0 : rand() < 0.15 ? 2 : 1;
      drops.push(
        Array.from({ length: count }, () => ({
          y: rand() * grid.rows * 1.6 - grid.rows * 0.3,
          v: far ? 4 + rand() * 4 : 8 + rand() * 9,
          len: Math.round((far ? 5 : 8) + rand() * grid.rows * 0.3),
          far,
        })),
      );
    }
    return { drops };
  },
  backdrop(ctx, w, h) {
    vgrad(ctx, w, 0, h, [
      [0, "#010604"],
      [0.6, "#03130a"],
      [1, "#062012"],
    ]);
    glow(ctx, w * 0.5, h * 1.05, w * 0.7, "#1cff7a", 0.1, 0.45);
    glow(ctx, w * 0.5, h * 0.45, Math.min(w, h) * 0.5, "#0a3a20", 0.5);
  },
  frame(grid, s, t, dt, rand) {
    const { cols, rows } = grid;
    for (let x = 0; x < cols; x++) {
      for (const d of s.drops[x]) {
        d.y += d.v * dt;
        if (d.y - d.len > rows) {
          d.y = -rand() * rows * 0.5;
          d.v = d.far ? 4 + rand() * 4 : 8 + rand() * 9;
        }
        const head = Math.floor(d.y);
        for (let k = 0; k < d.len; k++) {
          const y = head - k;
          if (y < 0) break;
          if (y >= rows) continue;
          const f = k / d.len;
          const color = d.far ? (k === 0 ? 7 : 8 + Math.min(3, Math.floor(f * 4))) : k === 0 ? 0 : 1 + Math.min(5, Math.floor(f * 6));
          const mutate = Math.floor(t * (k === 0 ? 10 : 0.6) + hash2(x, y) * 40);
          const g = 1 + (Math.floor(hash2(x * 7 + mutate, y) * 997) % RAIN_SYMBOLS);
          put(grid, x, y, cell(g, color));
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Dunes (light)

const DUNE_GLYPHS = " .`'-~_^/\\:,";
const DU = glyphIndex(DUNE_GLYPHS);
// 0-3 crest by layer, 4-7 ripple by layer, 8 sand spray, 9 bird
const DUNE_COLORS = ["#fff3e2cc", "#fbe2c7cc", "#f6d1aacc", "#f1c193cc", "#c98a5e55", "#b9774b55", "#a8653e55", "#985a3666", "#fff4e6bb", "#7a4a3a"];

interface DuneState {
  layers: Float32Array[];
  spray: { x: number; y: number; life: number; layer: number }[];
  birds: { x: number; y: number; v: number; phase: number }[];
}

const dunes: AsciiScene<DuneState> = {
  glyphs: DUNE_GLYPHS,
  colors: DUNE_COLORS,
  base: "#f3cfa3",
  fx: { hot: [cell(DU("^"), 9), cell(DU("~"), 7), cell(DU("-"), 6), cell(DU("."), 5)] },
  setup(grid, rand) {
    const { cols, rows } = grid;
    const o = rand() * 60;
    const layers: Float32Array[] = [];
    const specs = [
      [0.5, 0.1, 1.6],
      [0.62, 0.12, 2.1],
      [0.75, 0.13, 2.6],
      [0.88, 0.12, 3.1],
    ];
    specs.forEach(([base, amp, freq], i) => {
      const ridge = new Float32Array(cols);
      for (let x = 0; x < cols; x++) {
        const u = (x / cols) * (grid.w / 900) * freq + o + i * 13;
        ridge[x] = rows * (base - amp * (Math.sin(u * 2.2) * 0.5 + 0.5) * (0.6 + 0.4 * fbm(u)));
      }
      layers.push(ridge);
    });
    layers.forEach((ridge, i) => {
      const next = layers[i + 1];
      for (let x = 0; x < cols; x++) {
        const top = Math.round(ridge[x]);
        const bottom = next ? Math.round(next[x]) : rows;
        for (let y = top; y < bottom; y++) put(grid, x, y, 0);
      }
      rimRidge(grid, ridge, i, DU, "^");
    });
    const birds = Array.from({ length: 3 }, (_, i) => ({ x: cols * (0.6 + i * 0.04), y: rows * (0.18 + i * 0.03), v: 0.9, phase: rand() * 6 }));
    return { layers, spray: [], birds };
  },
  backdrop(ctx, w, h, s, grid) {
    const k = w / grid.w;
    vgrad(ctx, w, 0, h, [
      [0, "#f9e7d6"],
      [0.35, "#f9d9bb"],
      [0.6, "#f5bf93"],
      [1, "#e9a676"],
    ]);
    const m = Math.min(w, h);
    glow(ctx, w * 0.3, h * 0.3, m * 0.6, "#fff1d6", 0.55);
    ctx.fillStyle = "#fff6e4";
    ctx.beginPath();
    ctx.arc(w * 0.3, h * 0.3, m * 0.075, 0, Math.PI * 2);
    ctx.fill();
    const fills: [string, string][] = [
      ["#efc49b", "#e6b083"],
      ["#e6ad7c", "#d99863"],
      ["#d8935e", "#c97f4b"],
      ["#c67b48", "#b4693a"],
    ];
    s.layers.forEach((ridge, i) => {
      let min = Infinity;
      for (const v of ridge) min = Math.min(min, v);
      fillRidge(ctx, grid, k, ridge, linear(ctx, min * grid.ch * k, h, [[0, fills[i][0]], [1, fills[i][1]]]), h);
    });
  },
  frame(grid, s, t, dt, rand) {
    const { cols, rows } = grid;
    // Wind ripples: slow bands that drift along each dune face.
    s.layers.forEach((ridge, i) => {
      const next = s.layers[i + 1];
      const ripple = cell(DU(i < 2 ? "-" : "~"), 4 + i);
      for (let x = 0; x < cols; x++) {
        const top = Math.round(ridge[x]) + 1;
        const bottom = next ? Math.round(next[x]) - 1 : rows;
        for (let y = top; y < bottom; y++) {
          const depth = y - ridge[x];
          const n = Math.sin(x * 0.22 - depth * 1.9 + t * 0.35 + i * 2) + Math.sin(x * 0.07 + depth * 0.6 - t * 0.12) * 0.6;
          if (n > 1.05) put(grid, x, y, ripple);
        }
      }
    });
    if (s.spray.length < cols * 0.5 && rand() < dt * cols * 0.5) {
      const layer = Math.floor(rand() * s.layers.length);
      const x = Math.floor(rand() * cols);
      const ridge = s.layers[layer];
      const l = ridge[Math.max(0, x - 1)];
      const r = ridge[Math.min(cols - 1, x + 1)];
      if (ridge[x] <= l && ridge[x] <= r + 0.3) s.spray.push({ x, y: ridge[x], life: 1 + rand() * 1.5, layer });
    }
    for (let i = s.spray.length - 1; i >= 0; i--) {
      const p = s.spray[i];
      p.x += 6 * dt;
      p.y += Math.sin(t * 3 + i) * dt * 0.8 - dt * 0.3;
      p.life -= dt;
      if (p.life <= 0) {
        s.spray.splice(i, 1);
        continue;
      }
      put(grid, p.x, p.y, cell(DU(p.life > 0.8 ? "~" : p.life > 0.4 ? "`" : "."), 8));
    }
    for (const b of s.birds) {
      const x = ((b.x + t * b.v) % (cols + 12)) - 6;
      put(grid, x, b.y + Math.sin(t * 0.5 + b.phase) * 0.6, cell(DU(Math.sin(t * 5 + b.phase) > 0 ? "^" : "-"), 9));
    }
  },
};


// ---------------------------------------------------------------------------
// Full moon — a shaded sphere in a quiet sky. Hover moves the light source.

const MOON_GLYPHS = " .,:;-=+*#%@'`";
const MG = glyphIndex(MOON_GLYPHS);
const MOON_RAMP = [".", ",", ":", ";", "-", "=", "+", "*", "#", "%", "@"].map(MG);
const MOON_COLORS = [...ramp(["#2c3557", "#56618f", "#9aa4c9", "#d9dcea", "#fbf6e8"], 11), "#7c86b8", "#c7cff0", "#ffffff", "#ffe8b8"];

interface MoonState {
  cx: number;
  cy: number;
  r: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Per cell inside the bounding box: normal (nx, ny, nz) and albedo, nz < 0 outside. */
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
  albedo: Float32Array;
  stars: Twinkle;
  lx: number;
  ly: number;
  lz: number;
}

const moon: AsciiScene<MoonState> = {
  glyphs: MOON_GLYPHS,
  colors: MOON_COLORS,
  base: "#070b18",
  interactive: true,
  fx: { hot: [cell(MG("*"), 13), cell(MG("+"), 12), cell(MG("."), 11)], noHover: true },
  setup(grid, rand) {
    const { cols, rows } = grid;
    const aspect = grid.fx.aspect;
    const wide = grid.w > grid.h * 1.1;
    const cx = cols * (wide ? 0.74 : 0.6);
    const cy = rows * (wide ? 0.4 : 0.26);
    // Radius in cell widths.
    const r = Math.min(cols * (wide ? 0.17 : 0.3), rows * aspect * 0.26);
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(cols - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r / aspect - 1));
    const y1 = Math.min(rows - 1, Math.ceil(cy + r / aspect + 1));
    const n = (x1 - x0 + 1) * (y1 - y0 + 1);
    const nx = new Float32Array(n);
    const ny = new Float32Array(n);
    const nz = new Float32Array(n).fill(-1);
    const albedo = new Float32Array(n);
    let i = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++, i++) {
        const u = (x + 0.5 - cx) / r;
        const v = ((y + 0.5 - cy) * aspect) / r;
        const d2 = u * u + v * v;
        if (d2 >= 1) continue;
        nx[i] = u;
        ny[i] = v;
        nz[i] = Math.sqrt(1 - d2);
        // Maria: large soft dark seas, plus a few small craters.
        const sea = noise2(u * 2.2 + 4.1, v * 2.2 + 1.3);
        const fine = noise2(u * 7 + 9, v * 7);
        albedo[i] = 0.92 - Math.max(0, sea - 0.45) * 0.9 - fine * 0.12;
      }
    }
    const stars = scatterStars(
      grid,
      rand,
      0.014,
      () => rows,
      [cell(MG("."), 0), cell(MG("."), 1), cell(MG("'"), 1)],
      [cell(MG("+"), 3), cell(MG("*"), 2), cell(MG("."), 4)],
    );
    // Keep stars out of the moon and its halo.
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid.buf[y * cols + x] = 0;
    return { cx, cy, r, x0, x1, y0, y1, nx, ny, nz, albedo, stars, lx: -0.55, ly: -0.35, lz: 0.76 };
  },
  backdrop(ctx, w, h, s, grid) {
    vgrad(ctx, w, 0, h, [
      [0, "#04060f"],
      [0.6, "#0a1128"],
      [1, "#141c3a"],
    ]);
    const k = w / grid.w;
    const px = (s.cx * grid.cw) * k;
    const py = (s.cy * grid.ch) * k;
    const pr = s.r * grid.cw * k;
    glow(ctx, px, py, pr * 3.2, "#5a6db8", 0.22);
    glow(ctx, px, py, pr * 1.6, "#b8c4f0", 0.12);
  },
  frame(grid, s, t) {
    const { cols, buf, fx } = grid;
    twinkle(grid, s.stars, t);
    // The light drifts slowly; the cursor pulls it toward itself.
    const a = -2.3 + Math.sin(t * 0.03) * 0.35;
    let lx = Math.cos(a) * 0.8;
    let ly = -0.3;
    let lz = 0.55;
    if (fx.hover > 0.01) {
      const dx = fx.x - s.cx;
      const dy = (fx.y - s.cy) * fx.aspect;
      const d = Math.sqrt(dx * dx + dy * dy) + 1e-3;
      const reach = Math.min(1, d / (s.r * 2.2));
      const tx = (dx / d) * reach;
      const ty = (dy / d) * reach;
      const tz = 1 - reach * 0.75;
      const h = fx.hover;
      lx = lx * (1 - h) + tx * h;
      ly = ly * (1 - h) + ty * h;
      lz = lz * (1 - h) + tz * h;
    }
    const ln = 1 / Math.sqrt(lx * lx + ly * ly + lz * lz);
    // Ease, so the terminator glides instead of snapping.
    s.lx += (lx * ln - s.lx) * 0.12;
    s.ly += (ly * ln - s.ly) * 0.12;
    s.lz += (lz * ln - s.lz) * 0.12;
    let i = 0;
    const top = MOON_RAMP.length - 1;
    for (let y = s.y0; y <= s.y1; y++) {
      for (let x = s.x0; x <= s.x1; x++, i++) {
        const nz = s.nz[i];
        if (nz < 0) continue;
        const lambert = s.nx[i] * s.lx + s.ny[i] * s.ly + nz * s.lz;
        const v = Math.max(0, lambert) * s.albedo[i] + 0.07;
        const level = Math.min(top, Math.floor(v * (top + 0.99)));
        buf[y * cols + x] = cell(MOON_RAMP[level], Math.min(10, level));
      }
    }
    applySceneFx(grid, fx, moon.fx!, t);
  },
};

// ---------------------------------------------------------------------------

export const ASCII_SCENES = {
  "ascii-moon": moon,
  "ascii-sunset": sunset,
  "ascii-galaxy": galaxy,
  "ascii-rain": rain,
  "ascii-dunes": dunes,
  ...FIELD_SCENES,
} satisfies Record<string, AsciiScene<unknown>>;

export type AsciiSceneId = keyof typeof ASCII_SCENES;
