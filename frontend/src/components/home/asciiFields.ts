// Field wallpapers drawn in braille.
//
// All of these read the pointer directly (grid.fx): hover swells or bends the
// field around the cursor and clicks send a ring through it.

import {
  BRAILLE,
  fxIdle,
  glow,
  noise2,
  pointerEnergy,
  ramp,
  vgrad,
  type AsciiScene,
} from "./asciiKit";


const braille = (bits: number, color: number) => (bits + 1) * 32 + color + 1;
const BRAILLE_GLYPHS = " " + BRAILLE;
const SUB_Y_LEFT = [0x01, 0x02, 0x04, 0x40];
const SUB_Y_RIGHT = [0x08, 0x10, 0x20, 0x80];

// Topography (light) — contour lines of a slowly shifting landscape.

const TOPO_COLORS = [...ramp(["#b9ab96", "#9d8a72"], 3), "#c46a45", "#a9523a", ...ramp(["#4f74b8", "#2f5aa0"], 2)];

interface Topo {
  /** Height samples at cell corners: (cols + 1) × (rows + 1). */
  h: Float32Array;
  /** Pointer energy at the same corners. */
  e: Float32Array;
  seed: number;
}

const topo: AsciiScene<Topo> = {
  glyphs: BRAILLE_GLYPHS,
  colors: TOPO_COLORS,
  base: "#f3efe6",
  interactive: true,
  setup(grid, rand) {
    const n = (grid.cols + 1) * (grid.rows + 1);
    return { h: new Float32Array(n), e: new Float32Array(n), seed: rand() * 50 };
  },
  backdrop(ctx, w, h) {
    vgrad(ctx, w, 0, h, [
      [0, "#f5f1e9"],
      [1, "#efe9dd"],
    ]);
    glow(ctx, w * 0.2, h * 0.3, h * 0.8, "#e9dcc4", 0.5);
  },
  frame(grid, s, t) {
    const { cols, rows, buf, fx } = grid;
    const idle = fxIdle(fx);
    const stride = cols + 1;
    const scale = 1 / Math.max(cols * 0.5, rows);
    const k = 20;
    const drift = t * 0.025;
    for (let y = 0; y <= rows; y++) {
      for (let x = 0; x <= cols; x++) {
        const u = x * 0.5 * scale * 2.4;
        const v = y * scale * 2.4;
        let h = noise2(u + s.seed + drift, v - drift * 0.6) * 0.62 + noise2(u * 2.1 - drift, v * 2.1 + s.seed) * 0.28 + noise2(u * 4.3, v * 4.3 + drift * 2) * 0.1;
        const e = idle ? 0 : pointerEnergy(fx, x, y, 9, 3);
        s.e[y * stride + x] = e;
        s.h[y * stride + x] = (h + e * 0.12) * k;
      }
    }
    const hs = s.h;
    // Sub-pixel heights are bilinear between corners; a dot is lit where the
    // quantized level changes against its right or lower neighbour.
    const level = new Int16Array(3 * 5);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * stride + x;
        const a = hs[i];
        const b = hs[i + 1];
        const c = hs[i + stride];
        const d = hs[i + stride + 1];
        const lo = Math.min(a, b, c, d);
        const hi = Math.max(a, b, c, d);
        if (Math.floor(lo) === Math.floor(hi)) {
          buf[y * cols + x] = 0;
          continue;
        }
        for (let sy = 0; sy < 5; sy++) {
          const fy = sy / 4;
          const l = a + (c - a) * fy;
          const r = b + (d - b) * fy;
          for (let sx = 0; sx < 3; sx++) level[sy * 3 + sx] = Math.floor(l + (r - l) * (sx / 2));
        }
        let bits = 0;
        let lit = 0;
        for (let sy = 0; sy < 4; sy++) {
          for (let sx = 0; sx < 2; sx++) {
            const me = level[sy * 3 + sx];
            if (me !== level[sy * 3 + sx + 1] || me !== level[(sy + 1) * 3 + sx]) {
              bits |= sx === 0 ? SUB_Y_LEFT[sy] : SUB_Y_RIGHT[sy];
              lit = Math.max(me, level[sy * 3 + sx + 1], level[(sy + 1) * 3 + sx]);
            }
          }
        }
        if (!bits) {
          buf[y * cols + x] = 0;
          continue;
        }
        let color = lit % 5 === 0 ? 3 + (lit > k * 0.55 ? 1 : 0) : lit % 3;
        if (!idle && s.e[i] > 0.3) color = 5 + (lit % 2);
        buf[y * cols + x] = braille(bits, color);
      }
    }
  },
};

// Flow (dark) — silk threads tracing a slow flow field.


export const FIELD_SCENES = {
  "ascii-topo": topo,
} as const;
