// The building kit: a duellist's street built from one parametric false-front building plus
// a handful of props. All local building coordinates: origin at the front wall's centre on
// the ground, +z toward the street, x along the facade.

import type { KitStyle, Palette, TopKind } from "./directions";
import type { V3 } from "./gl";
import { hex, mix, mul, MeshBuilder } from "./mesh";
import type { RGB } from "./mesh";

export const FRONT_X = 9.5;
export const DECK_DEPTH = 2.1;
export const DECK_Y = 0.42;
/** World z where the street starts bending away from the shooter. */
const BEND_Z = -25;
const BEND_K = 0.0042;

/** The street runs dead straight through the duel lane and bends only beyond it. */
export const streetOffset = (z: number) => (z < BEND_Z ? BEND_K * (z - BEND_Z) ** 2 : 0);
const streetSlope = (z: number) => (z < BEND_Z ? -2 * BEND_K * (z - BEND_Z) : 0);

export type Colors = Record<keyof Palette, RGB>;

export function paletteToRGB(p: Palette): Colors {
  const out = {} as Colors;
  for (const k of Object.keys(p) as (keyof Palette)[]) out[k] = hex(p[k]);
  return out;
}

export interface Kit {
  b: MeshBuilder;
  /** Alpha-tested plant cards. */
  fol: MeshBuilder;
  /** Additive soft-glow cards: lamps, marquee bulbs, lit windows. */
  glow: MeshBuilder;
  P: Colors;
  S: KitStyle;
}

export interface BuildingSpec {
  side: -1 | 1;
  z: number;
  w: number;
  depth?: number;
  stories?: 1 | 2;
  kind?: "plain" | "saloon" | "sheriff" | "store" | "bank" | "barn" | "hotel";
  wall: keyof Palette;
  top: TopKind;
  peak?: number;
  sign?: string;
  /** Sign on an arm, facing down the street, so it reads from the shooter's camera. */
  blade?: string;
  /** Rooftop water barrel, chimney or nothing, for skyline variety. */
  roofProp?: "tank" | "chimney";
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function topProfile(kind: TopKind, w: number, H: number, peak: number, tilt: number): (x: number) => number {
  const hw = w / 2;
  return (x) => {
    const u = Math.abs(x) / hw;
    let y = H;
    switch (kind) {
      case "flat":
        y = H + peak * 0.35;
        break;
      case "stepped":
        y = H + (u < 0.3 ? peak : u < 0.62 ? peak * 0.55 : 0);
        break;
      case "arch":
        y = H + peak * Math.sqrt(Math.max(0, 1 - u * u));
        break;
      case "pediment":
        y = H + peak * (1 - u);
        break;
      case "curve":
        y = H + peak * (1 - smooth(0.34, 0.92, u));
        break;
    }
    return y + tilt * x;
  };
}

/** A soft additive card that faces down the street (world z), positioned from local space. */
function glowAt(k: Kit, p: V3, r: number, c: RGB, gain = 1) {
  const g = gain * k.S.glow;
  if (g <= 0.01) return;
  const w = k.b.worldPoint(p);
  const center = mul(c, g);
  const black: RGB = [0, 0, 0];
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    k.glow.tri(
      w,
      [w[0] + Math.cos(a0) * r, w[1] + Math.sin(a0) * r, w[2]],
      [w[0] + Math.cos(a1) * r, w[1] + Math.sin(a1) * r, w[2]],
      center,
      black,
      black,
    );
  }
}

/** Baked contact shade: the wall is darkest under the porch roof and opens up above it. */
const underPorch = (y: number) => 0.52 + 0.48 * smooth(2.4, 4.1, y);

/** Dark backing plate cut to the silhouette, then a wall finish on top of it. */
function facade(k: Kit, w: number, topFn: (x: number) => number, wall: RGB, thick: number) {
  const { b, S } = k;
  const step = 0.5;
  const n = Math.max(2, Math.round(w / step));
  const dark = S.planks === "h" ? mul(wall, 0.42) : wall;
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + (i / n) * w;
    const x1 = -w / 2 + ((i + 1) / n) * w;
    const yA = topFn(x0);
    const yB = topFn(x1);
    const col = S.planks === "v" ? b.jitter(wall, S.tintVar) : dark;
    b.grain = "y";
    b.randUV();
    b.quad([x0, 0, 0], [x1, 0, 0], [x1, yB, 0], [x0, yA, 0], mul(col, 0.8), mul(col, 0.8), col, col);
    b.quad([x1, 0, -thick], [x0, 0, -thick], [x0, yA, -thick], [x1, yB, -thick], mul(wall, 0.7));
    b.quad([x0, yA, 0], [x1, yB, 0], [x1, yB, -thick], [x0, yA, -thick], mul(wall, 0.9));
  }
  b.quad([w / 2, 0, 0], [w / 2, 0, -thick], [w / 2, topFn(w / 2), -thick], [w / 2, topFn(w / 2), 0], mul(wall, 0.8));
  b.quad([-w / 2, 0, -thick], [-w / 2, 0, 0], [-w / 2, topFn(-w / 2), 0], [-w / 2, topFn(-w / 2), -thick], mul(wall, 0.8));

  if (S.planks === "h") {
    // Rows of overlapping planks, stair-stepped to fit the silhouette. Each plank is a chunky
    // slab that overshoots the corners a little: most of the hand-built character lives here.
    let maxY = 0;
    for (let x = -w / 2; x <= w / 2; x += 0.25) maxY = Math.max(maxY, topFn(x));
    const rows = Math.ceil(maxY / S.plankH);
    const proud = 0.085;
    for (let r = 0; r < rows; r++) {
      const y0 = r * S.plankH;
      const y1 = y0 + S.plankH * 0.87;
      let xa = Infinity;
      let xb = -Infinity;
      for (let x = -w / 2; x <= w / 2 + 0.001; x += 0.12) {
        if (topFn(x) >= y1) {
          xa = Math.min(xa, x);
          xb = Math.max(xb, x);
        }
      }
      if (xa >= xb) continue;
      const atEdgeA = xa <= -w / 2 + 0.2;
      const atEdgeB = xb >= w / 2 - 0.2;
      const ov = 0.2 * S.wonk;
      const xA = xa - (atEdgeA ? b.rng.range(0, ov) : 0);
      const xB = xb + (atEdgeB ? b.rng.range(0, ov) : 0);
      const dA = b.rng.range(-0.035, 0.035) * S.wonk;
      const dB = b.rng.range(-0.035, 0.035) * S.wonk;
      const c = mul(b.jitter(wall, S.tintVar), underPorch(y0));
      b.grain = "x";
      b.randUV();
      b.quad([xA, y0 + dA, proud], [xB, y0 + dB, proud], [xB, y1 + dB, proud], [xA, y1 + dA, proud], mul(c, 0.94), mul(c, 0.94), c, c);
      b.quad([xA, y1 + dA, proud], [xB, y1 + dB, proud], [xB, y1 + dB, 0], [xA, y1 + dA, 0], mul(c, 1.12));
      b.quad([xA, y0 + dA, 0], [xB, y0 + dB, 0], [xB, y0 + dB, proud], [xA, y0 + dA, proud], mul(c, 0.5));
      b.quad([xB, y0 + dB, proud], [xB, y0 + dB, 0], [xB, y1 + dB, 0], [xB, y1 + dB, proud], mul(c, 0.8));
      b.quad([xA, y0 + dA, 0], [xA, y0 + dA, proud], [xA, y1 + dA, proud], [xA, y1 + dA, 0], mul(c, 0.8));
    }
  }

  // Cap trim that follows the silhouette.
  const trim = k.P.trim;
  const t = S.trimH;
  const f = 0.16;
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + (i / n) * w;
    const x1 = -w / 2 + ((i + 1) / n) * w;
    const yA = topFn(x0);
    const yB = topFn(x1);
    b.quad([x0, yA - t, f], [x1, yB - t, f], [x1, yB + 0.05, f], [x0, yA + 0.05, f], trim);
    b.quad([x0, yA + 0.05, f], [x1, yB + 0.05, f], [x1, yB + 0.05, -thick - 0.05], [x0, yA + 0.05, -thick - 0.05], mul(trim, 1.08));
    b.quad([x0, yA - t, 0], [x1, yB - t, 0], [x1, yB - t, f], [x0, yA - t, f], mul(trim, 0.55));
  }
}

const FACE = 0.09;

interface WindowOpts {
  bars?: boolean;
  lit?: boolean;
}

/** Set per building: some window frames and doors take the cool accent paint. */
let accentTrim = false;

function windowAt(k: Kit, x: number, y: number, w: number, h: number, o: WindowOpts = {}) {
  const { b, P, S } = k;
  b.mat = "plain";
  const f = 0.11 * Math.max(1, S.chunk * 0.8);
  const fz = FACE + 0.1;
  const lit = o.lit ?? b.rng.next() < S.litWindows;
  if (lit) {
    b.unlit = true;
    b.box(x - w / 2, y, FACE, x + w / 2, y + h, FACE + 0.03, P.windowLit, { skip: "-z -x +x -y +y" });
    b.unlit = false;
    glowAt(k, [x, y + h / 2, FACE + 0.3], Math.max(w, h) * 1.1, mul(P.windowLit, 0.45));
  } else {
    b.box(x - w / 2, y, FACE, x + w / 2, y + h, FACE + 0.03, P.glass, { skip: "-z -x +x -y +y" });
    b.tri(
      [x - w / 2 + 0.05, y + h - 0.05, FACE + 0.04],
      [x - w / 2 + 0.05, y + h * 0.45, FACE + 0.04],
      [x + w * 0.05, y + h - 0.05, FACE + 0.04],
      P.glint,
    );
  }
  b.mat = "wood";
  const frame = accentTrim ? P.accent : P.trim;
  b.box(x - w / 2 - f, y - f, FACE, x - w / 2, y + h + f, fz, frame, { skip: "-z" });
  b.box(x + w / 2, y - f, FACE, x + w / 2 + f, y + h + f, fz, frame, { skip: "-z" });
  b.box(x - w / 2 - f * 1.5, y + h, FACE, x + w / 2 + f * 1.5, y + h + f * 1.1, fz + 0.03, frame, { skip: "-z" });
  b.box(x - w / 2 - f * 1.4, y - f * 1.3, FACE, x + w / 2 + f * 1.4, y, fz + 0.1, frame, { skip: "-z" });
  b.box(x - 0.035, y, FACE, x + 0.035, y + h, FACE + 0.08, mul(frame, 0.8), { skip: "-z" });
  b.box(x - w / 2, y + h * 0.5 - 0.03, FACE, x + w / 2, y + h * 0.5 + 0.03, FACE + 0.08, mul(frame, 0.8), { skip: "-z" });
  if (o.bars) {
    for (let i = 1; i < 5; i++) {
      const bx = x - w / 2 + (i / 5) * w;
      b.withMat("plain", () => b.box(bx - 0.035, y, FACE + 0.08, bx + 0.035, y + h, FACE + 0.15, P.metal, { skip: "-z" }));
    }
  }
}

function doorAt(k: Kit, x: number, w: number, h: number) {
  const { b, P } = k;
  const y = DECK_Y;
  b.box(x - w / 2, y, FACE, x + w / 2, y + h, FACE + 0.04, accentTrim ? P.accent : P.door, { skip: "-z -x +x -y" });
  b.withMat("plain", () => b.box(x - w * 0.32, y + h * 0.56, FACE + 0.04, x + w * 0.32, y + h * 0.9, FACE + 0.06, P.glass, { skip: "-z -x +x -y +y" }));
  const f = 0.13;
  b.box(x - w / 2 - f, y, FACE, x - w / 2, y + h + f, FACE + 0.13, P.trim, { skip: "-z" });
  b.box(x + w / 2, y, FACE, x + w / 2 + f, y + h + f, FACE + 0.13, P.trim, { skip: "-z" });
  b.box(x - w / 2 - f * 1.5, y + h, FACE, x + w / 2 + f * 1.5, y + h + f * 1.2, FACE + 0.17, P.trim, { skip: "-z" });
}

/** Saloon doorway: a dark opening with two short louvred leaves hung ajar. */
function batwings(k: Kit, x: number) {
  const { b, P } = k;
  const y = DECK_Y;
  const w = 2.1;
  const h = 2.8;
  b.unlit = true;
  b.withMat("plain", () => b.box(x - w / 2, y, FACE, x + w / 2, y + h, FACE + 0.02, P.doorway, { skip: "-z -x +x -y +y" }));
  b.unlit = false;
  glowAt(k, [x, y + 1.4, FACE + 0.3], 2.2, mul(P.windowLit, 0.35));
  const f = 0.17;
  b.box(x - w / 2 - f, y, FACE, x - w / 2, y + h + f, FACE + 0.22, P.trim, { skip: "-z" });
  b.box(x + w / 2, y, FACE, x + w / 2 + f, y + h + f, FACE + 0.22, P.trim, { skip: "-z" });
  b.box(x - w / 2 - f * 1.5, y + h, FACE, x + w / 2 + f * 1.5, y + h + f * 1.4, FACE + 0.3, P.trim, { skip: "-z" });
  for (const s of [-1, 1]) {
    b.push();
    b.translate(x + (s * w) / 2, y + 0.85, FACE + 0.18);
    b.rotY(s * 0.28);
    const leaf = w / 2 - 0.03;
    const slats = 6;
    for (let i = 0; i < slats; i++) {
      const u0 = i / slats;
      const u1 = (i + 1) / slats;
      const xa = -s * u0 * leaf;
      const xb = -s * u1 * leaf;
      const h0 = 1.12 + 0.34 * Math.sin((1 - u0) * Math.PI * 0.5);
      const h1 = 1.12 + 0.34 * Math.sin((1 - u1) * Math.PI * 0.5);
      const c = b.jitter(P.door, 0.1);
      const [lx, rx, lh, rh] = s < 0 ? [xa, xb, h0, h1] : [xb, xa, h1, h0];
      b.quad([lx, 0, 0.05], [rx, 0, 0.05], [rx, rh, 0.05], [lx, lh, 0.05], c);
      b.quad([rx, 0, -0.05], [lx, 0, -0.05], [lx, lh, -0.05], [rx, rh, -0.05], mul(c, 0.8));
      b.quad([lx, lh, 0.05], [rx, rh, 0.05], [rx, rh, -0.05], [lx, lh, -0.05], mul(c, 1.15));
      b.box(lx, 0.14, 0.05, rx, 0.22, 0.09, mul(c, 1.25), { skip: "-z -x +x" });
      b.box(lx, 0.62, 0.05, rx, 0.7, 0.09, mul(c, 1.25), { skip: "-z -x +x" });
    }
    b.pop();
  }
}

function post(k: Kit, x: number, y0: number, z: number, y1: number, col: RGB) {
  const { b, S } = k;
  if (S.logPosts) {
    const lean = b.rng.range(-0.05, 0.05) * S.wonk;
    const r = 0.1 * S.chunk;
    b.beam([x, y0, z], [x + lean, y1, z + lean * 0.5], r * 2, col, { caps: false, jit: 0.12, t1: r * 1.8, round: true });
  } else {
    const t = 0.1 * S.chunk;
    b.box(x - t, y0, z - t, x + t, y1, z + t, col, { skip: "-y" });
  }
}

/** Shed-roof porch: posts on the deck edge, planked roof slanting off the wall. */
function porch(k: Kit, w: number, h: number, o: { balcony?: boolean; stripes?: boolean } = {}) {
  const { b, P, S } = k;
  const d = DECK_DEPTH;
  const postZ = d - 0.2;
  const spans = Math.max(2, Math.round(w / 3.4));
  for (let i = 0; i <= spans; i++) {
    const x = -w / 2 + 0.25 + (i / spans) * (w - 0.5);
    post(k, x, DECK_Y, postZ, h, P.post);
    if (S.logPosts && i > 0 && i < spans) {
      const s = 0.42;
      b.beam([x, h - s, postZ], [x + s, h, postZ], 0.09 * S.chunk, P.post, { caps: false, round: true });
      b.beam([x, h - s, postZ], [x - s, h, postZ], 0.09 * S.chunk, P.post, { caps: false, round: true });
    }
  }
  const tilt = b.rng.range(-0.018, 0.018) * S.wonk;
  const beamT = 0.1 * S.chunk;
  b.box(-w / 2, h - 0.02, postZ - beamT, w / 2, h + beamT * 1.3, postZ + beamT, mul(P.post, 1.05), { jit: 0.05 });

  const roofRise = 0.62;
  const roofY = (x: number, z: number) => h + 0.14 + roofRise * (1 - z / (d + 0.2)) + tilt * x;
  const n = Math.round(w / (S.planks === "panel" ? 0.9 : 0.42));
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 - 0.15 + (i / n) * (w + 0.3);
    const x1 = -w / 2 - 0.15 + ((i + 1) / n) * (w + 0.3);
    const over = d + 0.22 + b.rng.range(0, 0.28) * S.wonk;
    const c = o.stripes
      ? i % 2 === 0
        ? P.awningA
        : P.awningB
      : b.jitter(b.rng.next() < 0.14 * S.wonk ? P.awningA : P.roof, 0.16);
    const t = 0.1;
    b.grain = "z";
    b.randUV();
    const a0 = roofY(x0, 0);
    const a1 = roofY(x1, 0);
    const e0 = roofY(x0, over);
    const e1 = roofY(x1, over);
    b.quad([x0, e0, over], [x1, e1, over], [x1, a1, 0], [x0, a0, 0], c);
    b.quad([x0, a0 - t, 0], [x1, a1 - t, 0], [x1, e1 - t, over], [x0, e0 - t, over], mul(c, 0.62));
    b.quad([x0, e0 - t, over], [x1, e1 - t, over], [x1, e1, over], [x0, e0, over], mul(c, 0.78));
  }

  if (o.balcony) {
    // Balcony rail on a second level, directly above the porch roof's eave line.
    const by = h + 0.82;
    b.box(-w / 2, by - 0.1, 0.1, w / 2, by, d - 0.1, P.boards, { jit: 0.08, skip: "-y" });
    const rail = by + 1.0;
    b.box(-w / 2, rail, d - 0.28, w / 2, rail + 0.09 * S.chunk, d - 0.12, P.post, {});
    const count = Math.round(w / 0.5);
    for (let i = 0; i <= count; i++) {
      const x = -w / 2 + (i / count) * w;
      b.box(x - 0.045, by, d - 0.24, x + 0.045, rail, d - 0.16, P.post, { skip: "-y +y" });
    }
    const top = by + 2.5;
    for (let i = 0; i <= spans; i++) {
      const x = -w / 2 + 0.25 + (i / spans) * (w - 0.5);
      post(k, x, by, d - 0.2, top, P.post);
    }
    const ro = d + 0.3;
    const c = P.roof;
    b.quad([-w / 2 - 0.1, top, ro], [w / 2 + 0.1, top, ro], [w / 2 + 0.1, top + 0.55, 0], [-w / 2 - 0.1, top + 0.55, 0], c);
    b.quad([-w / 2 - 0.1, top - 0.08, 0], [w / 2 + 0.1, top - 0.08, 0], [w / 2 + 0.1, top - 0.08, ro], [-w / 2 - 0.1, top - 0.08, ro], mul(c, 0.6));
    b.box(-w / 2 - 0.1, top - 0.08, ro - 0.08, w / 2 + 0.1, top, ro, mul(c, 0.8), { skip: "-z" });
  }
}

/** Deck of planks that run out from the wall to the street edge. */
function deck(k: Kit, w: number) {
  const { b, P, S } = k;
  const d = DECK_DEPTH;
  const n = Math.round(w / 0.56);
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 - 0.1 + (i / n) * (w + 0.2);
    const x1 = -w / 2 - 0.1 + ((i + 1) / n) * (w + 0.2) - 0.035;
    const over = d + b.rng.range(0, 0.16) * S.wonk;
    const y = DECK_Y + b.rng.range(-0.012, 0.012) * S.wonk;
    const c = b.jitter(P.boards, 0.13);
    b.grain = "z";
    b.randUV();
    b.quad([x0, y, over], [x1, y, over], [x1, y, 0], [x0, y, 0], c);
    b.quad([x0, y - 0.13, over], [x1, y - 0.13, over], [x1, y, over], [x0, y, over], mul(c, 0.8));
  }
  // Dark fascia and thick stringer below the plank ends.
  b.box(-w / 2 - 0.1, 0, d - 0.28, w / 2 + 0.1, DECK_Y - 0.1, d - 0.05, P.trimDark, { skip: "-y", ao: 0.7 });
  b.box(-w / 2 - 0.1, 0, 0, -w / 2, DECK_Y - 0.02, d, P.trimDark, { skip: "-y" });
  b.box(w / 2, 0, 0, w / 2 + 0.1, DECK_Y - 0.02, d, P.trimDark, { skip: "-y" });
  // Top step.
  const sw = Math.min(3, w * 0.4);
  b.box(-sw / 2, 0, d, sw / 2, DECK_Y * 0.5, d + 0.55, mul(P.boards, 0.9), { skip: "-y -z", jit: 0.08 });
}

function facadeSign(k: Kit, text: string, y: number, width: number, opts: { alt?: boolean; h?: number } = {}) {
  const { b, P, S } = k;
  const h = opts.h ?? Math.min(1.3, (width / (text.length * 6)) * 7 * 1.15);
  const bh = h + 0.42;
  const sign = opts.alt ? P.signAlt : P.sign;
  const text_ = opts.alt ? P.signAltText : P.signText;
  b.box(-width / 2, y, FACE, width / 2, y + bh, FACE + 0.13, sign, { jit: 0.04, skip: "-z" });
  b.box(-width / 2 - 0.08, y - 0.07, FACE, width / 2 + 0.08, y + 0.03, FACE + 0.2, P.trim, { skip: "-z" });
  b.box(-width / 2 - 0.08, y + bh - 0.03, FACE, width / 2 + 0.08, y + bh + 0.07, FACE + 0.2, P.trim, { skip: "-z" });
  const px = h / 7;
  const pw = Math.min(px * 1.2, width / (text.length * 6));
  b.blockText(text, 0, y + 0.21, FACE + 0.14, h, text_, 0.05, pw / px);
}

/** Lit marquee: an unlit gold sign ringed with bulbs. The accent the street's eye goes to. */
function marquee(k: Kit, text: string, y: number, width: number) {
  const { b, P, S } = k;
  const h = 1.12;
  const bh = h + 0.68;
  const backing = P.sign;
  b.box(-width / 2, y, FACE + 0.02, width / 2, y + bh, FACE + 0.22, backing, { skip: "-z" });
  b.unlit = true;
  b.mat = "plain";
  const px = h / 7;
  const pw = Math.min(px * 1.25, width / (text.length * 6.3));
  b.blockText(text, 0, y + 0.34, FACE + 0.23, h, P.signText, 0.05, pw / px);
  const bulbs = Math.round(width / 0.42);
  for (let i = 0; i <= bulbs; i++) {
    const x = -width / 2 + (i / bulbs) * width;
    b.ico(x, y + 0.02, FACE + 0.28, 0.075, 0.075, 0.075, 0, P.bulb);
    b.ico(x, y + bh - 0.02, FACE + 0.28, 0.075, 0.075, 0.075, 0, P.bulb);
  }
  for (const sx of [-1, 1]) {
    for (let i = 1; i < 4; i++) {
      b.ico((sx * width) / 2, y + (i / 4) * bh, FACE + 0.28, 0.075, 0.075, 0.075, 0, P.bulb);
    }
  }
  b.unlit = false;
  b.mat = "wood";
  glowAt(k, [0, y + bh / 2, FACE + 0.6], width * 0.72, mul(P.signText, 0.55));
}

function star(k: Kit, x: number, y: number, z: number, r: number, c: RGB) {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.42;
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  k.b.withMat("plain", () => k.b.prismXY(pts, z, z + 0.07, c));
}

function lantern(k: Kit, x: number, y: number, z: number) {
  const { b, P } = k;
  b.mat = "plain";
  b.box(x - 0.015, y, z - 0.015, x + 0.015, y + 0.34, z + 0.015, P.metal, { skip: "-y +y" });
  b.unlit = true;
  b.cyl(x, y - 0.3, z, 0.11, y, 0.09, 6, P.bulb, { capBottom: true });
  b.unlit = false;
  b.cyl(x, y, z, 0.13, y + 0.06, 0.03, 6, P.metal);
  b.mat = "wood";
  glowAt(k, [x, y - 0.15, z + 0.1], 1.25, mul(P.bulb, 0.5));
}

/** Pennant string across a facade. Small, cheap and very good at saying "someone lives here". */
function bunting(k: Kit, x0: number, x1: number, y: number, z: number) {
  const { b, P } = k;
  b.mat = "plain";
  const n = Math.max(4, Math.round((x1 - x0) / 0.6));
  for (let i = 0; i < n; i++) {
    const u0 = i / n;
    const u1 = (i + 0.72) / n;
    const sag = (u: number) => -0.35 * (1 - (2 * u - 1) ** 2);
    const xa = x0 + (x1 - x0) * u0;
    const xb = x0 + (x1 - x0) * u1;
    const ya = y + sag(u0);
    const yb = y + sag(u1);
    b.tri([xa, ya, z], [(xa + xb) / 2, (ya + yb) / 2 - 0.3, z], [xb, yb, z], b.jitter(i % 3 === 2 ? P.accent : P.bunting, 0.08));
  }
  b.mat = "wood";
}

function gableRoof(k: Kit, w: number, d: number, eave: number, rise: number) {
  const { b, P, S } = k;
  const o = 0.32;
  const hw = w / 2 + o;
  const z0 = -d - 0.3;
  const n = Math.round(d / 0.9);
  const tilt = b.rng.range(-0.012, 0.012) * S.wonk;
  for (let i = 0; i < n; i++) {
    const za = z0 + (i / n) * (d + 0.1);
    const zb = z0 + ((i + 1) / n) * (d + 0.1);
    const c = b.jitter(P.roof, 0.13);
    b.grain = "x";
    b.randUV();
    const ya = eave + tilt * i;
    b.quad([-hw, ya, zb], [0, ya + rise, zb], [0, ya + rise, za], [-hw, ya, za], c);
    b.quad([0, ya + rise, zb], [hw, ya, zb], [hw, ya, za], [0, ya + rise, za], mul(c, 0.94));
  }
  b.tri([-w / 2, eave, z0], [0, eave + rise, z0], [w / 2, eave, z0], mul(P.wallA, 0.8));
}

export function building(k: Kit, s: BuildingSpec) {
  const { b, P, S } = k;
  const kind = s.kind ?? "plain";
  const stories = s.stories ?? 1;
  const w = s.w;
  const depth = s.depth ?? 9;
  const storyH = 3.25 * S.heightMul;
  const eave = stories * storyH + 0.35;
  const shoulder = eave + 1.2 * S.heightMul;
  const topKind: TopKind = S.topMap[s.top] ?? s.top;
  const peak = (s.peak ?? 1.3) * S.heightMul;
  const tilt = b.rng.range(-0.022, 0.022) * S.wonk;
  const topFn = topProfile(topKind, w, shoulder, peak, tilt);
  const wall = P[s.wall];
  accentTrim = b.rng.next() < 0.45;
  const wx = 1.25 * S.windowMul;
  const wy = 1.45 * S.windowMul;

  const off = streetOffset(s.z);
  b.push();
  b.translate(s.side * FRONT_X + off, 0, s.z);
  b.rotY(-Math.atan(streetSlope(s.z)));
  b.rotY(s.side < 0 ? Math.PI / 2 : -Math.PI / 2);
  if (S.wonk > 0) b.shearX(b.rng.range(-0.012, 0.012) * S.wonk);

  // Body behind the false front, and the roof it hides.
  b.box(-w / 2 + 0.06, 0, -depth, w / 2 - 0.06, eave, -0.12, mul(wall, 0.88), { skip: "+z -y", jit: 0.05, ao: 0.75 });
  gableRoof(k, w - 0.12, depth, eave, kind === "barn" ? 2.6 : 1.5);

  facade(k, w, topFn, wall, 0.18);
  deck(k, w);

  // Corner boards.
  const cT = S.trimT;
  b.box(-w / 2 - 0.02, 0, 0, -w / 2 + cT, topFn(-w / 2) - S.trimH, FACE + 0.1, P.trim, { skip: "-z", ao: 0.8 });
  b.box(w / 2 - cT, 0, 0, w / 2 + 0.02, topFn(w / 2) - S.trimH, FACE + 0.1, P.trim, { skip: "-z", ao: 0.8 });

  // Ground floor.
  const groundY = DECK_Y + 0.95;
  const slots = (count: number, span: number, skipCentre: number) => {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const x = -span / 2 + ((i + 0.5) / count) * span;
      if (Math.abs(x) > skipCentre) out.push(x);
    }
    return out;
  };

  switch (kind) {
    case "saloon":
      batwings(k, 0);
      for (const x of [-w * 0.3, w * 0.3]) windowAt(k, x, groundY - 0.2, wx * 1.3, wy * 1.1, { lit: true });
      break;
    case "sheriff":
      doorAt(k, -w * 0.18, 1.3, 2.6);
      windowAt(k, w * 0.2, groundY, wx * 1.2, wy, { bars: true, lit: false });
      windowAt(k, -w * 0.38, groundY, wx * 0.85, wy, {});
      break;
    case "store":
      doorAt(k, 0, 1.6, 2.7);
      for (const x of [-w * 0.3, w * 0.3]) windowAt(k, x, groundY - 0.45, wx * 2.1, wy * 1.2, {});
      break;
    case "bank":
      doorAt(k, 0, 1.5, 2.8);
      for (const x of [-w * 0.3, w * 0.3]) windowAt(k, x, groundY, wx * 0.95, wy * 1.1, { bars: true, lit: false });
      break;
    case "barn": {
      const dw = 3.6;
      b.box(-dw / 2, 0, FACE, dw / 2, 3.9, FACE + 0.04, P.doorway, { skip: "-z -x +x -y +y" });
      for (const sx of [-1, 1]) {
        const x0 = sx < 0 ? -dw / 2 : 0;
        const x1 = sx < 0 ? 0 : dw / 2;
        b.box(x0 + 0.03, 0, FACE + 0.04, x1 - 0.03, 3.9, FACE + 0.12, P.door, { skip: "-z", jit: 0.05 });
        b.beam([x0 + 0.1, 0.2, FACE + 0.14], [x1 - 0.1, 3.7, FACE + 0.14], 0.14, mul(P.door, 1.25), { caps: false });
        b.beam([x1 - 0.1, 0.2, FACE + 0.14], [x0 + 0.1, 3.7, FACE + 0.14], 0.14, mul(P.door, 1.25), { caps: false });
      }
      b.box(-1, 5.1, FACE, 1, 6.5, FACE + 0.03, P.doorway, { skip: "-z -x +x -y +y" });
      break;
    }
    default: {
      const dx = (b.rng.next() < 0.5 ? -1 : 1) * w * 0.14;
      doorAt(k, dx, 1.25, 2.55);
      for (const x of slots(Math.max(2, Math.floor((w - 1.2) / 2.5)), w - 1.2, 0)) {
        if (Math.abs(x - dx) > 1.5) windowAt(k, x, groundY, wx, wy);
      }
    }
  }

  // Upper floor.
  if (stories === 2) {
    const count = Math.max(2, Math.floor((w - 1) / 2.7));
    for (const x of slots(count, w - 1, 0)) windowAt(k, x, storyH + 1.15, wx, wy);
  }

  // Sign on the false front.
  const signTopY = (shoulder + (stories === 2 ? eave : eave)) / 2;
  if (kind === "saloon" && s.sign) {
    marquee(k, s.sign, stories === 2 ? eave + 0.42 : signTopY, Math.min(w - 1.4, 8.6));
    star(k, 0, shoulder + peak * 0.5 + 0.5, FACE + 0.02, 0.46, P.brass);
  } else if (kind === "sheriff" && s.sign) {
    facadeSign(k, s.sign, eave + 0.3, Math.min(w - 1.2, 6.6), { alt: true, h: 0.94 });
    star(k, 0, shoulder + peak * 0.5 + 0.55, FACE + 0.02, 0.5, P.brass);
  } else if (s.sign) {
    const signW = Math.min(w - 1.0, 0.5 + s.sign.length * 0.72);
    facadeSign(k, s.sign, stories === 2 ? eave + 0.3 : eave + 0.28, signW, { alt: b.rng.next() < 0.3 });
  }

  // Porch or balcony.
  if (kind !== "barn") {
    const porchH = 3.1 * S.heightMul + DECK_Y * 0.2;
    porch(k, w, porchH, {
      balcony: stories === 2 && (kind === "saloon" || kind === "hotel"),
      stripes: S.stripedAwnings && kind !== "saloon",
    });
    for (const x of [-w * 0.34, w * 0.34]) {
      if (b.rng.next() < 0.75) lantern(k, x, porchH - 0.3, DECK_DEPTH - 0.45);
    }
    if (kind === "saloon") bunting(k, -w / 2 + 0.3, w / 2 - 0.3, porchH - 0.1, DECK_DEPTH - 0.1);
    if (kind === "store") bunting(k, -w / 2 + 0.3, w / 2 - 0.3, porchH - 0.1, DECK_DEPTH - 0.1);
  }

  if (s.roofProp === "chimney") {
    b.box(w * 0.2, eave, -5, w * 0.2 + 0.7, eave + 3, -4.3, mul(P.rock, 0.85), { jit: 0.08, skip: "-y" });
  }
  if (s.roofProp === "tank") {
    const y = eave + 1.2;
    b.cyl(-w * 0.15, y, -4.6, 1.05, y + 1.7, 1.15, 8, P.barrel, { jit: 0.1 });
    b.cyl(-w * 0.15, y + 1.7, -4.6, 1.3, y + 2.3, 0.15, 8, P.roof);
  }
  b.pop();

  // Sign on an arm, in world space so it squarely faces the street's length.
  if (s.blade) {
    const edge = s.side * (FRONT_X - DECK_DEPTH * 0.5);
    bladeSign(k, edge + off, 3.75 * S.heightMul + (stories === 2 ? 0.9 : 0), s.z + w * 0.42, s.blade, s.side);
  }
}

export function bladeSign(k: Kit, x: number, y: number, z: number, text: string, side: number) {
  const { b, P, S } = k;
  const width = Math.max(2.2, text.length * 0.42 + 0.5);
  const h = 0.55;
  const bh = h + 0.32;
  const cx = x - side * (width / 2 - DECK_DEPTH * 0.5);
  b.box(cx - width / 2 - 0.3, y + bh + 0.16, z - 0.05, cx + width / 2 + 0.3, y + bh + 0.26, z + 0.05, P.post, {});
  b.box(cx - width / 2 + 0.25, y + bh, z - 0.015, cx - width / 2 + 0.3, y + bh + 0.17, z + 0.015, P.metal, { skip: "-y +y" });
  b.box(cx + width / 2 - 0.3, y + bh, z - 0.015, cx + width / 2 - 0.25, y + bh + 0.17, z + 0.015, P.metal, { skip: "-y +y" });
  b.box(cx - width / 2, y, z - 0.07, cx + width / 2, y + bh, z + 0.07, P.sign, { jit: 0.05 });
  const px = h / 7;
  const pw = Math.min(px * 1.2, (width - 0.3) / (text.length * 6));
  b.blockText(text, cx, y + 0.16, z + 0.08, h, P.signText, 0, pw / px);
  b.push();
  b.translate(cx, 0, z);
  b.rotY(Math.PI);
  b.blockText(text, 0, y + 0.16, 0.08, h, P.signText, 0, pw / px);
  b.pop();
  // Glow only where there's a lamp-lit look to it.
  void S;
}

// ------------------------------------------------------------------------- props

export function barrel(k: Kit, x: number, y: number, z: number, scale = 1) {
  const { b, P, S } = k;
  const r = 0.4 * scale * Math.max(1, S.chunk * 0.75);
  const h = 1.05 * scale * Math.max(1, S.chunk * 0.7);
  const n = 14;
  b.cyl(x, y, z, r * 0.84, y + h * 0.5, r, n, P.barrel, { capTop: false, jit: 0.1, capBottom: false });
  b.cyl(x, y + h * 0.5, z, r, y + h, r * 0.84, n, P.barrel, { jit: 0.1 });
  b.withMat("plain", () => {
    b.cyl(x, y + h * 0.2, z, r * 1.0, y + h * 0.27, r * 1.01, n, P.band, { capTop: false });
    b.cyl(x, y + h * 0.73, z, r * 1.01, y + h * 0.8, r * 1.0, n, P.band, { capTop: false });
  });
}

export function crate(k: Kit, x: number, y: number, z: number, s: number, rot = 0) {
  const { b, P } = k;
  b.push();
  b.translate(x, y, z);
  b.rotY(rot);
  b.box(-s / 2, 0, -s / 2, s / 2, s, s / 2, P.hay === P.canvas ? P.barrel : mul(P.barrel, 1.2), { jit: 0.06 });
  const t = 0.06;
  const c = mul(P.barrel, 0.75);
  b.beam([-s / 2, 0.02, s / 2 + 0.01], [s / 2, s - 0.02, s / 2 + 0.01], t, c, { caps: false });
  b.beam([s / 2 + 0.01, 0.02, -s / 2], [s / 2 + 0.01, s - 0.02, s / 2], t, c, { caps: false });
  b.pop();
}

export function hitchingPost(k: Kit, x: number, z: number, len: number) {
  const { b, P, S } = k;
  const t = 0.09 * S.chunk;
  b.box(x - t, 0, z - t, x + t, 1.15, z + t, P.post, { skip: "-y", jit: 0.1 });
  b.box(x - t, 0, z + len - t, x + t, 1.15, z + len + t, P.post, { skip: "-y", jit: 0.1 });
  b.beam([x, 1.04, z - 0.25], [x, 1.1, z + len + 0.25], t * 1.5, P.post);
}

export function trough(k: Kit, x: number, z: number) {
  const { b, P } = k;
  const hl = 1.2;
  b.box(x - 0.45, 0.04, z - hl, x + 0.45, 0.62, z + hl, P.barrel, { jit: 0.06, skip: "-y +y" });
  b.box(x - 0.45, 0.62, z - hl, x + 0.45, 0.66, z + hl, mul(P.barrel, 1.1), { skip: "-y" });
  b.withMat("plain", () => b.box(x - 0.36, 0.66, z - hl + 0.09, x + 0.36, 0.67, z + hl - 0.09, P.water, { skip: "-y -x +x -z +z" }));
}

export function wheel(k: Kit, x: number, y: number, z: number, r: number) {
  const { b, P } = k;
  const n = 12;
  const pt = (a: number, rr: number, dx = 0): V3 => [x + dx, y + Math.sin(a) * rr, z + Math.cos(a) * rr];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    b.beam(pt(a0, r), pt(a1, r), 0.09, P.trimDark, { caps: false });
    if (i % 2 === 0) b.beam(pt(a0, 0.05), pt(a0, r), 0.05, P.barrel, { caps: false });
  }
  b.beam(pt(0, 0, -0.1), pt(0, 0, 0.1), 0.16, P.band);
}

export function wagon(k: Kit, x: number, z: number, covered: boolean, rot = 0) {
  const { b, P } = k;
  b.push();
  b.translate(x, 0, z);
  b.rotY(rot);
  const w = 0.85;
  const hl = 1.9;
  b.box(-w, 0.78, -hl, w, 0.9, hl, mul(P.barrel, 0.8), {});
  for (const s of [-1, 1]) {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const y = 0.9 + i * 0.2;
      b.box(s * w - 0.05, y, -hl, s * w + 0.05, y + 0.17, hl, P.barrel, { jit: 0.1 });
    }
    b.box(-w, 0.9, s * hl - 0.04, w, 1.65, s * hl + 0.04, mul(P.barrel, 0.9), {});
    wheel(k, s * (w + 0.14), 0.72, 1.25, 0.72);
    wheel(k, s * (w + 0.14), 0.56, -1.25, 0.56);
  }
  b.beam([0, 0.6, -hl], [0, 0.3, -hl - 2.1], 0.11, P.post);
  if (covered) {
    b.mat = "plain";
    const arcs = 8;
    const zs = [-hl + 0.1, -hl * 0.5, 0, hl * 0.5, hl - 0.1];
    for (let j = 0; j < zs.length - 1; j++) {
      for (let i = 0; i < arcs; i++) {
        const a0 = (i / arcs) * Math.PI;
        const a1 = ((i + 1) / arcs) * Math.PI;
        const bow = (zz: number) => 1 + 0.1 * (Math.abs(zz) / hl) ** 2;
        const P0 = (a: number, zz: number): V3 => [Math.cos(a) * w * bow(zz), 1.55 + Math.sin(a) * 1.25 * bow(zz), zz * 1.05];
        const shade = 0.88 + 0.12 * Math.sin((a0 + a1) * 0.5);
        const c = mul(j % 2 ? P.canvas : mul(P.canvas, 0.97), shade);
        b.quad(P0(a1, zs[j + 1]), P0(a0, zs[j + 1]), P0(a0, zs[j]), P0(a1, zs[j]), c);
      }
    }
    b.mat = "wood";
  } else {
    b.box(-0.6, 0.92, -0.9, 0.6, 1.5, 0.9, P.hay, { jit: 0.1 });
    b.box(-0.45, 1.5, -0.5, 0.45, 1.95, 0.7, mul(P.hay, 0.95), { jit: 0.1 });
  }
  b.pop();
}

export function waterTower(k: Kit, x: number, z: number) {
  const { b, P, S } = k;
  const legY = 8.5;
  const r = 2.8;
  const t = 0.26 * Math.max(1, S.chunk * 0.75);
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const at = (cx: number, cz: number, y: number): V3 => {
    const q = 2.9 - (y / legY) * 0.9;
    return [x + cx * q, y, z + cz * q];
  };
  corners.forEach(([cx, cz], i) => {
    b.beam(at(cx, cz, 0), at(cx, cz, legY), t, P.post, { caps: false, jit: 0.1 });
    const [nx, nz] = corners[(i + 1) % 4];
    for (const y of [2.7, 5.6]) {
      b.beam(at(cx, cz, y), at(nx, nz, y), t * 0.6, P.post, { caps: false });
    }
    b.beam(at(cx, cz, 0.2), at(nx, nz, 2.7), t * 0.4, P.post, { caps: false });
    b.beam(at(nx, nz, 2.7), at(cx, cz, 5.6), t * 0.4, P.post, { caps: false });
    b.beam(at(cx, cz, 5.6), at(nx, nz, legY), t * 0.4, P.post, { caps: false });
  });
  const n = 20;
  const h = 3.6;
  b.withMat("plain", () => b.cyl(x, legY, z, r * 0.96, legY + 0.15, r, n, P.band, { capBottom: true, capTop: false }));
  b.cyl(x, legY + 0.15, z, r, legY + h, r * 1.02, n, P.barrel, { jit: 0.16 });
  for (const f of [0.2, 0.55, 0.88]) {
    const y = legY + h * f;
    b.withMat("plain", () => b.cyl(x, y, z, r + 0.05, y + 0.14, r + 0.06, n, P.band, { capTop: false }));
  }
  b.cyl(x, legY + h, z, r * 1.14, legY + h + 1.7, 0.2, n, P.roof, { jit: 0.1, capBottom: true });
  b.beam([x - r, legY + 0.5, z], [x - r - 1.1, legY - 1.1, z], 0.2, P.metal);
}

export function windmill(k: Kit, x: number, z: number) {
  const { b, P } = k;
  const h = 13;
  const q = 1.5;
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const at = (cx: number, cz: number, y: number): V3 => {
    const s = q * (1 - (y / h) * 0.86);
    return [x + cx * s, y, z + cz * s];
  };
  corners.forEach(([cx, cz], i) => {
    b.beam(at(cx, cz, 0), at(cx, cz, h), 0.14, P.post, { caps: false });
    const [nx, nz] = corners[(i + 1) % 4];
    for (const y of [3, 6, 9, 11.5]) b.beam(at(cx, cz, y), at(nx, nz, y), 0.07, P.post, { caps: false });
    b.beam(at(cx, cz, 0.1), at(nx, nz, 3), 0.05, P.post, { caps: false });
    b.beam(at(nx, nz, 3), at(cx, cz, 6), 0.05, P.post, { caps: false });
    b.beam(at(cx, cz, 6), at(nx, nz, 9), 0.05, P.post, { caps: false });
  });
  const hub: V3 = [x, h + 0.2, z + 0.5];
  const blades = 14;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + 0.1;
    const da = 0.17;
    const r0 = 0.5;
    const r1 = 2.5;
    const pt = (r: number, ang: number, zo: number): V3 => [
      hub[0] + Math.cos(ang) * r,
      hub[1] + Math.sin(ang) * r,
      hub[2] + zo,
    ];
    const c = i % 3 === 0 ? P.awningA : P.metal;
    b.quad(pt(r0, a - da * 0.6, 0.04), pt(r0, a + da * 0.6, -0.04), pt(r1, a + da, -0.12), pt(r1, a - da, 0.12), c);
    b.quad(pt(r1, a - da, 0.12), pt(r1, a + da, -0.12), pt(r0, a + da * 0.6, -0.04), pt(r0, a - da * 0.6, 0.04), mul(c, 0.7));
  }
  b.beam([x, h + 0.2, z - 2.4], [x, h + 0.2, z + 0.5], 0.14, P.metal);
  b.quad([x, h + 0.9, z - 2.5], [x, h - 0.4, z - 2.5], [x, h, z - 1.0], [x, h + 0.4, z - 1.0], P.awningA);
  b.quad([x, h - 0.4, z - 2.5], [x, h + 0.9, z - 2.5], [x, h + 0.4, z - 1.0], [x, h, z - 1.0], mul(P.awningA, 0.8));
}

export function cactus(k: Kit, x: number, z: number, h: number, seed = 1) {
  const { b, P } = k;
  b.mat = "plain";
  const r = h * 0.085;
  const col = P.cactus;
  const low = P.cactusDark;
  const n = 14;
  const ribbed = (cx: number, y0: number, cz: number, r0: number, y1: number, r1: number) => {
    // Ribs: alternating bright and dark facets, faked with one material and no texture.
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const lit = i % 2 === 0 ? col : mix(col, low, 0.75);
      const pt = (a: number, rr: number, y: number): V3 => [cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr];
      const na: V3 = [Math.cos(a1), 0, Math.sin(a1)];
      const nb: V3 = [Math.cos(a0), 0, Math.sin(a0)];
      b.triFull(pt(a1, r0, y0), pt(a0, r0, y0), pt(a0, r1, y1), lit, lit, lit, [na, nb, nb]);
      b.triFull(pt(a1, r0, y0), pt(a0, r1, y1), pt(a1, r1, y1), lit, lit, lit, [na, nb, na]);
    }
  };
  ribbed(x, 0, z, r * 1.05, h * 0.86, r);
  b.ico(x, h * 0.86, z, r, h * 0.14, r, 1, mix(col, low, 0.3), { smooth: true });
  const arm = (dir: number, y: number, out: number, up: number) => {
    const ar = r * 0.72;
    const ang = seed + dir;
    const dx = Math.cos(ang) * dir;
    const dz = Math.sin(ang) * 0.4;
    const ex = x + dx * out;
    const ez = z + dz * out;
    b.beam([x, y, z], [ex, y + up * 0.08, ez], ar * 1.8, mix(col, low, 0.35), { caps: false, round: true });
    b.ico(ex, y + up * 0.08, ez, ar, ar, ar, 1, mix(col, low, 0.35), { smooth: true });
    ribbed(ex, y + up * 0.08, ez, ar, y + up * 0.84, ar);
    b.ico(ex, y + up * 0.84, ez, ar, up * 0.16, ar, 1, mix(col, low, 0.3), { smooth: true });
  };
  arm(1, h * 0.42, h * 0.24, h * 0.34);
  arm(-1, h * 0.55, h * 0.22, h * 0.3);
  b.mat = "wood";
}

export function rock(k: Kit, x: number, z: number, s: number, c?: RGB) {
  const { b, P } = k;
  b.mat = "rock";
  b.uvScale = [3, 3];
  b.randUV();
  b.ico(x, s * 0.25, z, s * b.rng.range(0.9, 1.3), s * 0.75, s * b.rng.range(0.8, 1.2), 1, c ?? P.rock, { rough: 0.3, flatBelow: -0.35 });
  b.uvScale = [3.2, 1.6];
  b.mat = "wood";
}

/** Plant: two crossed cards from the foliage atlas, dark at the root. Cell is 0..3. */
export function tuft(k: Kit, x: number, z: number, s: number, c?: RGB, cell = 0) {
  const { fol, P } = k;
  fol.mat = "foliage";
  const col = fol.jitter(c ?? P.scrub, 0.18);
  const root = mul(col, 0.55);
  const u0 = (cell % 2) * 0.5;
  const v0 = Math.floor(cell / 2) * 0.5;
  const w = s * 0.95;
  const h = s * 1.5;
  const up: V3 = [0.12, 1, 0.12];
  const a0 = fol.rng.range(0, Math.PI);
  for (const a of [a0, a0 + Math.PI / 2]) {
    const dx = Math.cos(a) * w;
    const dz = Math.sin(a) * w;
    fol.quadUV(
      [x - dx, 0, z - dz],
      [x + dx, 0, z + dz],
      [x + dx, h, z + dz],
      [x - dx, h, z - dz],
      [u0, v0 + 0.5],
      [u0 + 0.5, v0 + 0.5],
      [u0 + 0.5, v0],
      [u0, v0],
      root,
      root,
      col,
      col,
      up,
    );
  }
}

/** A flat, irregular splat on the ground. Layer these for the sand-over-dirt look. */
export function patch(k: Kit, x: number, z: number, rx: number, rz: number, y: number, c: RGB, c2: RGB = c) {
  const { b } = k;
  const n = 16;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = b.rng.range(0.62, 1.12);
    pts.push([x + Math.cos(a) * rx * r, z + Math.sin(a) * rz * r]);
  }
  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];
    b.tri([x, y, z], [p1[0], y, p1[1]], [p0[0], y, p0[1]], c, c2, c2);
  }
}

/** A run of loose boards lying across the street. */
export function boardRun(k: Kit, x: number, z: number, count: number, width: number, rot: number) {
  const { b, P } = k;
  b.push();
  b.translate(x, 0, z);
  b.rotY(rot);
  for (let i = 0; i < count; i++) {
    const l = width * b.rng.range(0.72, 1.12);
    const ox = b.rng.range(-0.5, 0.5);
    const zz = i * 0.56;
    const c = b.jitter(P.boards, 0.18);
    b.rotY(0);
    b.box(ox - l / 2, 0.02, zz, ox + l / 2, 0.11, zz + 0.47, c, { skip: "-y" });
  }
  b.pop();
}

export function churchAtEnd(k: Kit, x: number, z: number) {
  const { b, P } = k;
  const w = 8;
  const h = 6;
  const d = 12;
  const c = P.church;
  b.push();
  b.translate(x, 0, z);
  b.box(-w / 2, 0, -d, w / 2, h, 0, c, { skip: "-y", jit: 0.04, ao: 0.8 });
  b.tri([-w / 2, h, 0], [w / 2, h, 0], [0, h + 3.2, 0], c);
  const r = P.roof;
  b.quad([-w / 2 - 0.3, h, 0.3], [0, h + 3.2, 0.3], [0, h + 3.2, -d], [-w / 2 - 0.3, h, -d], r);
  b.quad([0, h + 3.2, 0.3], [w / 2 + 0.3, h, 0.3], [w / 2 + 0.3, h, -d], [0, h + 3.2, -d], mul(r, 0.9));
  b.box(-1.2, 0, 0, 1.2, 3.6, 0.1, P.door, { skip: "-z" });
  const ts = 1.7;
  b.box(-ts, h, -1 - ts * 2, ts, h + 7, -1, c, { skip: "-y", jit: 0.04 });
  b.box(-ts + 0.4, h + 5, -1 - 0.2, ts - 0.4, h + 6.5, -0.95, P.doorway, { skip: "-z -x +x -y +y" });
  b.quad([-ts - 0.15, h + 7, -0.9], [ts + 0.15, h + 7, -0.9], [0, h + 11, -1 - ts], [0, h + 11, -1 - ts], r);
  b.quad([ts + 0.15, h + 7, -0.9], [ts + 0.15, h + 7, -1 - ts * 2 - 0.1], [0, h + 11, -1 - ts], [0, h + 11, -1 - ts], mul(r, 0.85));
  b.quad([-ts - 0.15, h + 7, -1 - ts * 2 - 0.1], [-ts - 0.15, h + 7, -0.9], [0, h + 11, -1 - ts], [0, h + 11, -1 - ts], mul(r, 0.85));
  b.pop();
}

export function telegraphLine(k: Kit, points: [number, number][], h: number) {
  const { b, P } = k;
  const wireOff = [-0.85, 0.85];
  points.forEach(([x, z], i) => {
    b.beam([x, 0, z], [x + 0.03, h, z + 0.02], 0.2, P.post, { caps: false, jit: 0.08 });
    b.box(x - 1.05, h - 0.5, z - 0.05, x + 1.05, h - 0.38, z + 0.05, P.post, {});
    const next = points[i + 1];
    if (!next) return;
    for (const off of wireOff) {
      const seg = 4;
      for (let s = 0; s < seg; s++) {
        const u0 = s / seg;
        const u1 = (s + 1) / seg;
        const sag = (u: number) => -0.75 * (1 - (2 * u - 1) ** 2);
        b.beam(
          [x + off + (next[0] - x) * u0, h - 0.34 + sag(u0), z + (next[1] - z) * u0],
          [x + off + (next[0] - x) * u1, h - 0.34 + sag(u1), z + (next[1] - z) * u1],
          0.035,
          P.trimDark,
          { caps: false },
        );
      }
    }
  });
}

/** A rock mass: uneven broken shelves with quiet strata, not an even stack of stripes. */
export function rockMass(
  k: Kit,
  cx: number,
  cz: number,
  rx: number,
  rz: number,
  h: number,
  layers: number,
  n = 16,
) {
  const { b, P } = k;
  b.mat = "rock";
  b.grain = "x";
  b.uvScale = [Math.max(14, h * 0.8), Math.max(10, h * 0.55)];
  const seed = cx * 0.13 + cz * 0.07;
  const wobble = (i: number, l: number) => {
    const a = (i / n) * Math.PI * 2;
    return (
      1 +
      0.16 * Math.sin(a * 2 + seed) +
      0.12 * Math.sin(a * 5 + seed * 2 + l * 0.9) +
      0.08 * Math.sin(a * 9 + l * 2.3 + seed)
    );
  };
  const bands = [P.mesaA, P.mesaB, P.mesaA, P.mesaC];
  // Uneven layer heights: a few tall cliffs, a few thin ledges.
  const hs: number[] = [];
  let sum = 0;
  for (let l = 0; l < layers; l++) {
    const v = 0.45 + 1.5 * Math.abs(Math.sin(l * 2.4 + seed));
    hs.push(v);
    sum += v;
  }
  let y = 0;
  let shelf: V3[] | null = null;
  for (let l = 0; l < layers; l++) {
    const u = l / layers;
    const y0 = y;
    y += (hs[l] / sum) * h;
    const radius = (1 - 0.18 * u - 0.3 * u * u) * (1 + 0.07 * Math.sin(l * 1.7 + seed));
    const ring = (yy: number, shrink: number, twist: number): V3[] =>
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + twist;
        const q = wobble(i, l) * radius * shrink;
        return [cx + Math.cos(a) * rx * q, yy, cz + Math.sin(a) * rz * q] as V3;
      });
    const twist = l * 0.05;
    const bot = ring(y0, 1.05, twist);
    const top = ring(y, 0.97, twist);
    const band = bands[l % bands.length];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const c = b.jitter(band, 0.1);
      b.quad(bot[j], bot[i], top[i], top[j], mul(c, 0.8), mul(c, 0.8), c, c);
    }
    shelf = ring(y, 0.8, twist);
    const ledge = mix(band, P.mesaTop, 0.3);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      b.quad(top[j], top[i], shelf[i], shelf[j], b.jitter(ledge, 0.07));
    }
  }
  if (shelf) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      b.tri([cx, y, cz], shelf[j], shelf[i], mix(P.mesaTop, P.mesaA, 0.15));
    }
  }
  b.uvScale = [3.2, 1.6];
  b.mat = "wood";
}

/** Far clouds are unlit and painted with a top-to-belly gradient, heaped into lobes. */
export function cloud(k: Kit, x: number, y: number, z: number, s: number, flat: number, puffs: number) {
  const { b, P } = k;
  const was = [b.unlit, b.fog] as const;
  b.unlit = true;
  b.fog = 0;
  b.mat = "plain";
  const shade = (n: V3) => mix(P.cloudShade, P.cloud, Math.min(1, Math.max(0, n[1] * 1.5 + 0.55)));
  for (let i = 0; i < puffs; i++) {
    const t = puffs === 1 ? 0 : i / (puffs - 1) - 0.5;
    const env = 0.5 + 0.5 * Math.cos(t * Math.PI);
    const r = s * (0.5 + 0.5 * env) * b.rng.range(0.85, 1.1);
    const px = x + t * s * 2.9;
    const pz = z + b.rng.range(-6, 6);
    b.ico(px, y + r * flat * 0.1, pz, r, r * flat, r * 0.8, 1, shade, { flatBelow: -0.12 });
    if (flat > 0.3) {
      for (let j = 0; j < 3; j++) {
        const rr = r * b.rng.range(0.38, 0.62);
        b.ico(px + b.rng.range(-0.75, 0.75) * r, y + r * flat * b.rng.range(0.55, 0.95), pz + 8, rr, rr * 0.86, rr * 0.8, 1, shade, { flatBelow: -0.2 });
      }
    }
  }
  b.unlit = was[0];
  b.fog = was[1];
  b.mat = "wood";
}
