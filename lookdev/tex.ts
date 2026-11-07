// Every texture is generated here at load, with no image files. Tiles hold a brightness detail
// around 0.5 (the shader doubles it), so palette colour stays in the vertex data and the same
// sand, wood and rock tiles work in every look.

export type MaterialMode = "flat" | "painted" | "crisp";

export interface PixelTex {
  size: number;
  data: Uint8Array;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => fade(clamp01((x - a) / (b - a)));

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647 / 7 | 0);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Value noise that repeats every (px, py) lattice cells, so tiles have no seams. */
function vnoise(u: number, v: number, px: number, py: number, seed: number): number {
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = fade(u - x0);
  const fy = fade(v - y0);
  const ax = mod(x0, px);
  const bx = mod(x0 + 1, px);
  const ay = mod(y0, py);
  const by = mod(y0 + 1, py);
  const a = hash(ax, ay, seed);
  const b = hash(bx, ay, seed);
  const c = hash(ax, by, seed);
  const d = hash(bx, by, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x: number, y: number, fx: number, fy: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let total = 0;
  let px = fx;
  let py = fy;
  for (let i = 0; i < octaves; i++) {
    sum += vnoise(x * px, y * py, px, py, seed + i * 31) * amp;
    total += amp;
    amp *= 0.5;
    px *= 2;
    py *= 2;
  }
  return sum / total;
}

/** Quantise softly, which is what gives the tiles a hand-painted look. */
const poster = (v: number, levels: number, soft = 0.3) => {
  const x = v * levels;
  const f = x - Math.floor(x);
  return (Math.floor(x) + smooth(0.5 - soft, 0.5 + soft, f)) / levels;
};

function makeTile(size: number, fn: (x: number, y: number) => [number, number, number, number]): PixelTex {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const [r, g, b, a] = fn(i / size, j / size);
      const o = (j * size + i) * 4;
      data[o] = clamp01(r) * 255;
      data[o + 1] = clamp01(g) * 255;
      data[o + 2] = clamp01(b) * 255;
      data[o + 3] = clamp01(a) * 255;
    }
  }
  return { size, data };
}

/** Small round stones and flecks that tile. Returns -1..1: dark to light. */
function pebbles(x: number, y: number, cells: number, seed: number, density: number): number {
  const u = x * cells;
  const v = y * cells;
  const cx = Math.floor(u);
  const cy = Math.floor(v);
  let out = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ix = mod(cx + dx, cells);
      const iy = mod(cy + dy, cells);
      if (hash(ix, iy, seed) > density) continue;
      const px = cx + dx + hash(ix, iy, seed + 1);
      const py = cy + dy + hash(ix, iy, seed + 2);
      const r = 0.12 + hash(ix, iy, seed + 3) * 0.3;
      const d = Math.hypot(u - px, v - py) / r;
      if (d < 1) out = (hash(ix, iy, seed + 4) < 0.5 ? -1 : 1) * smooth(1, 0.55, d);
    }
  }
  return out;
}

/** u is along the grain. */
function woodTile(mode: MaterialMode): PixelTex {
  const knots = [
    [0.22, 0.3],
    [0.68, 0.72],
    [0.88, 0.2],
  ];
  return makeTile(512, (x, y) => {
    let warp = fbm(x, y, 2, 5, 2, 11) * 1.4;
    for (const [kx, ky] of knots) {
      const dx = Math.abs(x - kx);
      const ddx = Math.min(dx, 1 - dx) * 2.8;
      const dy = Math.abs(y - ky);
      const ddy = Math.min(dy, 1 - dy) * 7;
      warp += 0.55 * Math.exp(-(ddx * ddx + ddy * ddy) * 14);
    }
    const rings = 0.5 + 0.5 * Math.sin((y * 9 + warp * 3.2) * Math.PI * 2);
    const streak = fbm(x, y, 3, 48, 3, 21);
    const hair = vnoise(x * 12, y * 200, 12, 200, 31);
    const broad = fbm(x, y, 2, 3, 2, 41);
    let v: number;
    if (mode === "painted") {
      v = 0.5 + 0.13 * (poster(rings, 3, 0.25) - 0.5) + 0.28 * (poster(streak, 5, 0.3) - 0.5) + 0.2 * (broad - 0.5);
    } else {
      v = 0.5 + 0.11 * (rings - 0.5) + 0.42 * (streak - 0.5) + 0.2 * (hair - 0.5) + 0.2 * (broad - 0.5);
    }
    // Dark grain runs slightly redder, so wood stays rich instead of going grey.
    return [v * 1.02, v * 0.985, v * 0.94, 1];
  });
}

/** Wind-combed ripples with scattered grit. Alpha holds a height used to break up edges. */
function sandTile(mode: MaterialMode): PixelTex {
  return makeTile(512, (x, y) => {
    const warp = fbm(x, y, 3, 3, 3, 51);
    const ripple = Math.sin((y * 26 + x * 4 + warp * 7) * Math.PI * 2);
    const crest = smooth(0.25, 0.95, ripple);
    const trough = smooth(-0.35, -0.95, ripple);
    const fade2 = smooth(0.3, 0.62, fbm(x, y, 4, 4, 2, 61));
    const big = fbm(x, y, 3, 3, 3, 71);
    const peb = pebbles(x, y, 42, 81, 0.2);
    const grain = vnoise(x * 170, y * 170, 170, 170, 91) - 0.5;
    let v: number;
    if (mode === "painted") {
      v = 0.5 + 0.1 * (crest - trough * 0.8) * fade2 + 0.16 * (poster(big, 5) - 0.5) + 0.05 * peb;
    } else {
      v = 0.5 + 0.075 * (crest - trough) * fade2 + 0.17 * (big - 0.5) + 0.1 * peb + 0.085 * grain;
    }
    return [v, v * 0.995, v * 0.98, fbm(x, y, 8, 8, 4, 95)];
  });
}

/** Packed, cracked earth with clods. */
function dirtTile(mode: MaterialMode): PixelTex {
  return makeTile(512, (x, y) => {
    const clod = fbm(x, y, 9, 9, 3, 101);
    const n = fbm(x, y, 7, 7, 2, 111);
    const crack = smooth(0.03, 0.0, Math.abs(n - 0.5));
    const big = fbm(x, y, 3, 3, 2, 121);
    const peb = pebbles(x, y, 30, 131, 0.3);
    const grain = vnoise(x * 170, y * 170, 170, 170, 141) - 0.5;
    let v: number;
    if (mode === "painted") {
      v = 0.5 + 0.15 * (poster(clod, 5) - 0.5) + 0.1 * (big - 0.5) - 0.07 * crack + 0.05 * peb;
    } else {
      v = 0.5 + 0.2 * (clod - 0.5) + 0.1 * (big - 0.5) - 0.08 * crack + 0.08 * peb + 0.07 * grain;
    }
    return [v, v * 0.985, v * 0.96, 1];
  });
}

/** u is along the strata. */
function rockTile(mode: MaterialMode): PixelTex {
  return makeTile(512, (x, y) => {
    const warp = fbm(x, y, 3, 3, 3, 151);
    const strata = fbm(x * 1, y + warp * 0.08, 2, 20, 3, 161);
    const crackN = fbm(x, y, 8, 5, 2, 171);
    const crack = smooth(0.035, 0.0, Math.abs(crackN - 0.5));
    const big = fbm(x, y, 3, 3, 3, 181);
    const grit = vnoise(x * 120, y * 120, 120, 120, 191) - 0.5;
    let v: number;
    if (mode === "painted") {
      v = 0.5 + 0.36 * (poster(strata, 5, 0.2) - 0.5) + 0.16 * (big - 0.5) - 0.12 * crack;
    } else {
      v = 0.5 + 0.38 * (strata - 0.5) + 0.16 * (big - 0.5) - 0.13 * crack + 0.11 * grit;
    }
    return [v, v * 0.98, v * 0.95, 1];
  });
}

const flatTile = (): PixelTex => ({ size: 2, data: new Uint8Array(16).map((_, i) => (i % 4 === 3 ? 255 : 128)) });

function canvasToTile(c: HTMLCanvasElement): PixelTex {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const data = new Uint8Array(img.data.buffer.slice(0));
  // Fully transparent pixels would otherwise bleed black into the card edges when filtered.
  for (let o = 0; o < data.length; o += 4) {
    if (data[o + 3] === 0) {
      data[o] = 110;
      data[o + 1] = 110;
      data[o + 2] = 110;
    }
  }
  return { size: c.width, data };
}

/** 2x2 grid of plant cards, painted with real blades: tuft, soft clump, dry bush, weed in flower. */
function foliageAtlas(): PixelTex {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  let seed = 7;
  const rnd = (a = 1, b?: number) => {
    seed = (seed * 16807) % 2147483647;
    const r = seed / 2147483647;
    return b === undefined ? r * a : a + (b - a) * r;
  };
  const cell = 256;
  const grey = (v: number) => `rgb(${v | 0},${v | 0},${v | 0})`;

  const blade = (x: number, base: number, lean: number, h: number, w: number, tone: number) => {
    const tipX = x + lean;
    const tipY = base - h;
    const midX = x + lean * 0.25;
    const midY = base - h * 0.62;
    const grad = g.createLinearGradient(0, base, 0, tipY);
    grad.addColorStop(0, grey(tone * 0.5));
    grad.addColorStop(0.55, grey(tone * 0.95));
    grad.addColorStop(1, grey(Math.min(235, tone * 1.32)));
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x - w, base);
    g.quadraticCurveTo(midX - w * 0.5, midY, tipX, tipY);
    g.quadraticCurveTo(midX + w * 0.8, midY, x + w, base);
    g.closePath();
    g.fill();
  };

  // Spiky desert grass: long thin blades fanning out.
  for (let i = 0; i < 46; i++) {
    const t = rnd(-1, 1);
    blade(128 + t * 34, 252, t * 92 + rnd(-14, 14), rnd(120, 230) * (1 - Math.abs(t) * 0.3), rnd(2.5, 5), rnd(95, 175));
  }
  // Soft clump: shorter, thicker, arching over.
  for (let i = 0; i < 60; i++) {
    const t = rnd(-1, 1);
    blade(256 + 128 + t * 62, 252, t * 74 + rnd(-10, 10), rnd(58, 142), rnd(4, 8), rnd(90, 170));
  }
  // Dry bush: branching twigs.
  const twig = (x: number, y: number, a: number, len: number, w: number, d: number) => {
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    g.strokeStyle = grey(rnd(70, 150));
    g.lineWidth = w;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(ex, ey);
    g.stroke();
    if (d <= 0) return;
    const n = 2 + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) twig(ex, ey, a + rnd(-0.75, 0.75), len * rnd(0.55, 0.82), w * 0.72, d - 1);
  };
  for (let i = 0; i < 9; i++) twig(128, 506, -Math.PI / 2 + rnd(-0.85, 0.85), rnd(44, 72), 5, 3);
  // Weed in flower: grass with pale seed heads.
  for (let i = 0; i < 26; i++) {
    const t = rnd(-1, 1);
    blade(256 + 128 + t * 44, 508, t * 58, rnd(70, 150), rnd(3, 5), rnd(90, 160));
  }
  for (let i = 0; i < 11; i++) {
    const t = rnd(-1, 1);
    const x = 256 + 128 + t * 66;
    const y = 508 - rnd(130, 220);
    g.strokeStyle = grey(110);
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(256 + 128 + t * 28, 508);
    g.quadraticCurveTo(x - t * 8, y + 60, x, y);
    g.stroke();
    g.fillStyle = grey(238);
    for (let j = 0; j < 6; j++) {
      g.beginPath();
      g.arc(x + rnd(-8, 8), y + rnd(-9, 9), rnd(3.5, 6), 0, Math.PI * 2);
      g.fill();
    }
  }
  void cell;
  return canvasToTile(c);
}

/** 4x4 effect atlas: glow, flash, ink, ring, shard, spark, smoke, star. RGB is premultiplied. */
function fxAtlas(): PixelTex {
  const size = 512;
  const cell = 128;
  const data = new Uint8Array(size * size * 4);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
  const blobs: [number, number, number][][] = [];
  for (let k = 0; k < 2; k++) {
    const list: [number, number, number][] = [];
    for (let i = 0; i < 22; i++) {
      const a = rnd() * 6.283;
      const d = Math.pow(rnd(), 1.5) * 0.8;
      list.push([Math.cos(a) * d, Math.sin(a) * d, 0.05 + rnd() * 0.2 * (1 - d * 0.7)]);
    }
    blobs.push(list);
  }
  const put = (col: number, row: number, fn: (x: number, y: number) => number) => {
    for (let j = 0; j < cell; j++) {
      for (let i = 0; i < cell; i++) {
        const x = (i + 0.5) / cell * 2 - 1;
        const y = (j + 0.5) / cell * 2 - 1;
        const a = clamp01(fn(x, y));
        const o = (((row * cell + j) * size + col * cell + i) * 4) | 0;
        const v = a * 255;
        data[o] = data[o + 1] = data[o + 2] = data[o + 3] = v;
      }
    }
  };
  put(0, 0, (x, y) => {
    const d = Math.hypot(x, y);
    return Math.pow(clamp01(1 - d), 2.2);
  });
  put(1, 0, (x, y) => {
    const a = Math.atan2(y, x);
    const d = Math.hypot(x, y);
    const rays = 0.42 + 0.58 * Math.pow(Math.abs(Math.cos(a * 3.5)), 5);
    return smooth(rays, rays * 0.45, d);
  });
  put(2, 0, (x, y) => {
    let v = 0;
    for (const [bx, by, r] of blobs[0]) v += (r * r) / ((x - bx) ** 2 + (y - by) ** 2 + 0.0004);
    return smooth(0.95, 1.05, v) * smooth(1, 0.9, Math.hypot(x, y));
  });
  put(3, 0, (x, y) => {
    const d = Math.hypot(x, y);
    return smooth(0.62, 0.8, d) * smooth(0.98, 0.84, d);
  });
  put(0, 1, (x, y) => {
    // Splintered shard.
    const inRect = Math.abs(y) < 0.3 + 0.12 * Math.sin(x * 11) && Math.abs(x) < 0.9 - Math.abs(Math.sin(y * 17)) * 0.2;
    return inRect ? 1 : 0;
  });
  put(1, 1, (x, y) => {
    // Spark: hot streak along x.
    return Math.pow(clamp01(1 - Math.abs(y) * 5), 1.5) * Math.pow(clamp01(1 - Math.abs(x)), 0.7);
  });
  put(2, 1, (x, y) => {
    let v = 0;
    for (const [bx, by, r] of blobs[1]) v += (r * r) / ((x - bx) ** 2 + (y - by) ** 2 + 0.002);
    return smooth(0.55, 1.5, v) * smooth(1, 0.72, Math.hypot(x, y));
  });
  put(0, 2, (x, y) => {
    // A drop of sweat: round at the bottom, pointed at the top.
    const yy = y + 0.2;
    const r = yy > 0 ? 0.55 : 0.55 * Math.max(0, 1 + yy / 0.85);
    const d = Math.abs(x);
    const round = yy > 0 ? Math.hypot(x, yy) : d;
    return smooth(r, r * 0.8, round);
  });
  put(3, 1, (x, y) => {
    const a = Math.atan2(y, x);
    const d = Math.hypot(x, y);
    const r = 0.5 + 0.45 * Math.cos(a * 5);
    return smooth(r, r * 0.8, d);
  });
  return { size, data };
}

export interface TextureSet {
  wood: PixelTex;
  sand: PixelTex;
  dirt: PixelTex;
  rock: PixelTex;
}

const sets = new Map<MaterialMode, TextureSet>();

export function textureSet(mode: MaterialMode): TextureSet {
  const hit = sets.get(mode);
  if (hit) return hit;
  const set: TextureSet =
    mode === "flat"
      ? { wood: flatTile(), sand: { ...flatTile() }, dirt: flatTile(), rock: flatTile() }
      : { wood: woodTile(mode), sand: sandTile(mode), dirt: dirtTile(mode), rock: rockTile(mode) };
  if (mode === "flat") {
    // Flat sand still needs a soft height in alpha so its edge has a shape.
    set.sand = sandTile("painted");
    for (let o = 0; o < set.sand.data.length; o += 4) {
      set.sand.data[o] = set.sand.data[o + 1] = set.sand.data[o + 2] = 128;
    }
  }
  sets.set(mode, set);
  return set;
}

export const foliage = () => foliageAtlas();
export const fx = () => fxAtlas();
export const FLAT = flatTile;

// ---- Ground splat: which ground goes where across the town.

/** World area the splat map covers. Anything outside clamps to its edge, which is open sand. */
export const SPLAT = { x0: -64, x1: 64, z0: -128, z1: 64, size: 512 };

/** Hand-placed sand drifts for the opening view: [x, z, rx, rz]. */
const DRIFTS: [number, number, number, number][] = [
  [-4.6, 9.8, 4.2, 2.6],
  [5.6, 3.8, 3.2, 4.2],
  [-1.2, -3.4, 4.2, 2.2],
  [6.6, 11, 2.4, 1.8],
  [-2.6, -24.5, 3.2, 3.4],
  [3.6, -33, 2.8, 5],
  [-3.4, -50, 3.2, 5],
];

/** R: sand amount. G: dark wear, for wheel ruts and the dirt along the boardwalks. */
export function splatMap(streetOffset: (z: number) => number): PixelTex {
  const { x0, x1, z0, z1, size } = SPLAT;
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    const z = z0 + ((j + 0.5) / size) * (z1 - z0);
    for (let i = 0; i < size; i++) {
      const x = x0 + ((i + 0.5) / size) * (x1 - x0);
      const off = streetOffset(z);
      const sx = Math.abs(x - off);
      const nu = (x + 400) * 0.07;
      const nv = (z + 400) * 0.07;
      const edgeN = fbm(nu * 0.02, nv * 0.02, 64, 64, 3, 201);
      const drift = fbm(nu * 0.018, nv * 0.018, 64, 64, 3, 211);

      // Open sand outside the town; the street narrows to a trail past each end.
      const ends = clamp01(smooth(-92, -125, z) + smooth(55, 63, z));
      const hw = 9.4 - ends * 5.5;
      const edge = smooth(hw - 1.4, hw + 4.5, sx + (edgeN - 0.5) * 7);
      let r = Math.max(edge, smooth(0.54, 0.7, drift) * 0.72);
      for (const [dx, dz, rx, rz] of DRIFTS) {
        const ddx = (x - dx - streetOffset(dz)) / rx;
        const ddz = (z - dz) / rz;
        const d = Math.sqrt(ddx * ddx + ddz * ddz);
        r = Math.max(r, smooth(1.2, 0.55, d + (edgeN - 0.5) * 1.15));
      }
      // Keep the duel lane calm: a character has to read clearly on it.
      const lane = smooth(-20.5, -18, z) * smooth(-8, -10.2, z) * smooth(8.5, 6.5, sx);
      r = r * (1 - lane) + 0.3 * lane;

      const rutN = (vnoise(nv * 0.25, 1, 64, 64, 221) - 0.5) * 0.7;
      const rut = Math.max(
        smooth(0.62, 0.12, Math.abs(x - off - 2.5 + rutN)),
        smooth(0.62, 0.12, Math.abs(x - off + 2.5 - rutN)),
      ) * (1 - ends);
      const walk = smooth(5.8, 7.6, sx + (edgeN - 0.5) * 2.4) * smooth(13, 9.8, sx) * (1 - ends);
      const g = clamp01(rut * 0.62 + walk * 0.8);

      const o = (j * size + i) * 4;
      data[o] = r * 255;
      data[o + 1] = g * 255;
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  }
  return { size, data };
}
