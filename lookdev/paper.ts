// The opening's paper-cut stills, and the paper behind the bosses. Everything is a flat cut-out with a
// grain and a soft drop shadow and no outline, baked once into a still. The edit in intro.ts moves them.

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647), s / 2147483647);
}

const INK = "#1A1210";
const C = {
  page: "#E7D6B4",
  sky: "#6FB9B3",
  skyHigh: "#3B8FA6",
  sun: "#FFF1CC",
  mesa: "#C98560",
  mesaFar: "#DDA67E",
  dune: "#DDA56E",
  road: "#C48A56",
  roadDark: "#A9703F",
  wood: "#8A5B3E",
  woodDark: "#5E3D2C",
  bank: "#C7A27C",
  cactus: "#3E7E62",
  fur: "#7A4524",
  face: "#F4CFA2",
  poncho: "#1F7C86",
  stripe: "#F2C230",
  pants: "#283A62",
  boot: "#4A2A18",
  hat: "#2E1A12",
  band: "#D2362A",
  smoke: "#F2DCB4",
  smokeDark: "#C99F73",
};

const PAPER_TRIM = "#F7F2E2";

let grainCanvas: HTMLCanvasElement | null = null;

/** A speckled sheet, laid over every cut-out, so it all looks like one stock of paper. */
function grain(): HTMLCanvasElement {
  if (grainCanvas) return grainCanvas;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  const r = rng(77);
  for (let i = 0; i < 2600; i++) {
    x.fillStyle = r() > 0.5 ? "rgba(255,255,255,.1)" : "rgba(40,20,10,.08)";
    x.fillRect(r() * 256, r() * 256, 1 + r() * 2.4, 1 + r() * 1.2);
  }
  grainCanvas = c;
  return c;
}

/** A hand-cut outline: long straight-ish runs with a wobble, as scissors leave. */
function cutOutline(points: Pt[], wobble: number, seed: number): Pt[] {
  const r = rng(seed * 137 + 11);
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const steps = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 34));
    for (let s = 0; s < steps; s++) {
      const k = s / steps;
      out.push([ax + (bx - ax) * k + (r() - 0.5) * wobble, ay + (by - ay) * k + (r() - 0.5) * wobble]);
    }
  }
  return out;
}

function trace(x: Ctx, pts: Pt[]) {
  x.beginPath();
  pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b)));
  x.closePath();
}

let shapeSeed = 3;

/** One cut shape, in one flat colour. */
function shape(x: Ctx, points: Pt[], color: string, wobble = 2.2, _edge = 0) {
  trace(x, cutOutline(points, wobble, shapeSeed++));
  x.fillStyle = color;
  x.fill();
}

function ellipse(cx: number, cy: number, rx: number, ry: number, n = 20, spin = 0): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = spin + (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

function star(cx: number, cy: number, outer: number, inner: number, n: number, seed: number): Pt[] {
  const r = rng(seed);
  const out: Pt[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const len = i % 2 === 0 ? outer * (0.72 + r() * 0.4) : inner * (0.85 + r() * 0.3);
    out.push([cx + Math.cos(a) * len, cy + Math.sin(a) * len]);
  }
  return out;
}

interface Piece {
  canvas: HTMLCanvasElement;
  /** Its pivot, within its canvas. */
  ox: number;
  oy: number;
}

/** Bakes a cut-out with a drop shadow and grain. fn draws around (0, 0), its pivot. */
function bake(w: number, h: number, ox: number, oy: number, fn: (x: Ctx) => void, shadow = true): Piece {
  const pad = 16;
  const body = document.createElement("canvas");
  body.width = w + pad * 2;
  body.height = h + pad * 2;
  const b = body.getContext("2d")!;
  b.translate(ox + pad, oy + pad);
  fn(b);
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.globalCompositeOperation = "source-atop";
  b.fillStyle = b.createPattern(grain(), "repeat")!;
  b.fillRect(0, 0, body.width, body.height);
  const canvas = document.createElement("canvas");
  canvas.width = body.width;
  canvas.height = body.height;
  const c = canvas.getContext("2d")!;
  if (shadow) {
    c.shadowColor = "rgba(30,14,6,.42)";
    c.shadowBlur = 5;
    c.shadowOffsetX = 3;
    c.shadowOffsetY = 5;
  }
  c.drawImage(body, 0, 0);
  return { canvas, ox: ox + pad, oy: oy + pad };
}

function put(x: Ctx, p: Piece, px: number, py: number, rot = 0, scale = 1) {
  x.save();
  x.translate(px, py);
  if (rot) x.rotate(rot);
  if (scale !== 1) x.scale(scale, scale);
  x.drawImage(p.canvas, -p.ox, -p.oy);
  x.restore();
}

/** A puff of paper smoke whose outside breaks up in an ordered dither. */
function ditherPuff(r: number, seed: number, light: string, dark: string): Piece {
  const size = Math.ceil(r * 2 + 8);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d")!;
  const img = x.createImageData(size, size);
  const rand = rng(seed);
  const lobes = Array.from({ length: 7 }, () => {
    const a = rand() * Math.PI * 2;
    const d = rand() * r * 0.55;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, r: r * (0.34 + rand() * 0.3) };
  });
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const parse = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const L = parse(light);
  const D = parse(dark);
  const cell = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const qx = px - size / 2;
      const qy = py - size / 2;
      let d = 0;
      for (const l of lobes) d = Math.max(d, 1 - Math.hypot(qx - l.x, qy - l.y) / l.r);
      const t = (BAYER[(Math.floor(py / cell) % 4) * 4 + (Math.floor(px / cell) % 4)] + 0.5) / 16;
      if (d * 3.2 < t) continue;
      const lit = (-qx * 0.45 - qy * 0.75) / r + 0.15 + (t - 0.5) * 0.4;
      const col = lit > 0 ? L : D;
      const o = (py * size + px) * 4;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return { canvas: c, ox: size / 2, oy: size / 2 };
}

function bankFront(x: Ctx, w: number, h: number) {
  // The false front, sign, door and barred windows, with the ground line at y = 0.
  const peak = h * 1.0;
  const eave = h * 0.72;
  shape(x, [[-w / 2, 0], [-w / 2, -eave], [0, -peak], [w / 2, -eave], [w / 2, 0]], C.bank);
  shape(x, [[-w * 0.3, -eave * 0.97], [w * 0.3, -eave * 0.97], [w * 0.3, -eave * 0.7], [-w * 0.3, -eave * 0.7]], C.woodDark, 1, 3);
  x.fillStyle = C.stripe;
  x.font = `400 ${Math.round(h * 0.17)}px Rye, serif`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText("BANK", 0, -eave * 0.835);
  shape(x, [[-w * 0.13, 0], [-w * 0.13, -h * 0.4], [w * 0.13, -h * 0.4], [w * 0.13, 0]], C.woodDark, 1, 3);
  for (const s of [-1, 1]) {
    const cx = s * w * 0.33;
    shape(x, [[cx - w * 0.09, -h * 0.14], [cx - w * 0.09, -h * 0.38], [cx + w * 0.09, -h * 0.38], [cx + w * 0.09, -h * 0.14]], INK, 1, 3);
    x.fillStyle = C.bank;
    for (const k of [-0.5, 0, 0.5]) x.fillRect(cx + k * w * 0.09 - 1.5, -h * 0.38, 3, h * 0.24);
  }
}

/** The outlaws as black paper shapes, for the moment they come through the smoke: big round heads. */
function robberShape(x: Ctx, kind: number, s: number) {
  if (kind === 0) {
    // Huge and round, with a broad snout and a sack over the shoulder.
    shape(x, ellipse(0, -112 * s, 92 * s, 104 * s, 20), INK, 2, 0);
    shape(x, [[-62 * s, -50 * s], [-24 * s, -50 * s], [-28 * s, 0], [-72 * s, 0]], INK, 2, 0);
    shape(x, [[62 * s, -50 * s], [24 * s, -50 * s], [28 * s, 0], [72 * s, 0]], INK, 2, 0);
    shape(x, ellipse(0, -236 * s, 94 * s, 78 * s, 20), INK, 2, 0);
    shape(x, ellipse(-58 * s, -214 * s, 62 * s, 34 * s, 14), INK, 2, 0);
    shape(x, ellipse(136 * s, -214 * s, 62 * s, 68 * s, 14), INK, 2, 0);
    hatShape(x, 0, -296 * s, s * 1.2);
  } else {
    // Slim, with a big round head that comes to a soft point.
    shape(x, [[-40 * s, 0], [-36 * s, -128 * s], [36 * s, -128 * s], [46 * s, 0]], INK, 2, 0);
    shape(x, [[-16 * s, -124 * s], [-16 * s, -170 * s], [16 * s, -170 * s], [16 * s, -124 * s]], INK, 2, 0);
    shape(x, ellipse(0, -204 * s, 64 * s, 54 * s, 18), INK, 2, 0);
    shape(x, [[-40 * s, -216 * s], [-92 * s, -190 * s], [-40 * s, -176 * s]], INK, 2, 0);
    hatShape(x, 0, -248 * s, s * 0.9);
  }
}

function hatShape(x: Ctx, cx: number, cy: number, s: number) {
  shape(x, [[cx - 62 * s, cy + 2 * s], [cx - 24 * s, cy - 6 * s], [cx - 20 * s, cy - 44 * s], [cx + 20 * s, cy - 44 * s], [cx + 24 * s, cy - 6 * s], [cx + 62 * s, cy + 2 * s], [cx, cy + 10 * s]], INK, 1, 0);
}

/** How far the blast has got when it freezes, in seconds of its bloom. */
const BLAST_AGE = 0.62;

export type PaperStill = "road" | "legs" | "bank" | "blast" | "smoke";

/** The size the between-the-legs and blast art was cut for. */
const ART_W = 884;
const ART_H = 392;

export class PaperComic {
  private x!: Ctx;
  private far!: Piece;
  private near!: Piece;
  private sun!: Piece;
  private town!: Piece;
  private road!: Piece;
  private bankBig!: Piece;
  private legs!: Piece;
  private hem!: Piece;
  private bursts!: Piece[];
  private puffs!: Piece[];
  private robbers!: Piece[];
  private planks!: Piece;
  private weed!: Piece;

  constructor() {
    this.bakeAll();
  }

  /** One finished paper picture, at 1280 by 720. */
  still(kind: PaperStill): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = 1280;
    c.height = 720;
    this.x = c.getContext("2d")!;
    if (kind === "road") {
      this.x.scale(1280 / 1920, 720 / 1080);
      this.walkPanel(1920, 1080);
      return c;
    }
    // Fills the height, keeping the middle of the art.
    const scale = 720 / ART_H;
    this.x.translate((1280 - ART_W * scale) / 2, 0);
    this.x.scale(scale, scale);
    if (kind === "legs") this.legsPanel(ART_W, ART_H);
    else if (kind === "bank") this.bankBack(ART_W, ART_H, 0.92);
    else this.bustPanel(ART_W, ART_H, kind === "blast");
    return c;
  }

  private bakeAll() {
    this.sun = bake(280, 280, 140, 140, (x) => shape(x, ellipse(0, 0, 124, 124, 26), C.sun, 2, 0));
    this.far = bake(3000, 300, 0, 300, (x) => {
      const r = rng(5);
      let at = -40;
      while (at < 3000) {
        const w = 240 + r() * 300;
        const h = 90 + r() * 170;
        shape(x, [[at, 0], [at + w * 0.14, -h], [at + w * 0.8, -h * (0.82 + r() * 0.2)], [at + w, 0]], r() > 0.5 ? C.mesaFar : C.mesa, 4);
        at += w * (0.8 + r() * 0.3);
      }
    });
    this.near = bake(3000, 150, 0, 150, (x) => shape(x, [[0, 0], [0, -56], [420, -96], [860, -62], [1320, -120], [1800, -68], [2300, -110], [3000, -60], [3000, 0]], C.dune, 5));
    this.road = bake(3200, 420, 0, 220, (x) => {
      shape(x, [[0, -30], [3200, -30], [3200, 200], [0, 200]], C.road, 3);
      const r = rng(9);
      for (let i = 0; i < 26; i++) {
        const cx = r() * 3200;
        const cy = r() * 150;
        shape(x, [[cx, cy], [cx + 70 + r() * 90, cy + 3], [cx + 60, cy + 10], [cx + 8, cy + 8]], C.roadDark, 1, 0);
      }
      // Cacti, a sign and scrub go by close to the road.
      for (const cx of [360, 1120, 1960, 2700]) {
        shape(x, [[cx - 14, -22], [cx - 14, -176], [cx + 14, -176], [cx + 14, -22]], C.cactus, 2, 3);
        shape(x, [[cx + 14, -96], [cx + 54, -96], [cx + 54, -150], [cx + 34, -150], [cx + 34, -116], [cx + 14, -116]], C.cactus, 2, 3);
        shape(x, [[cx - 14, -70], [cx - 48, -70], [cx - 48, -122], [cx - 30, -122], [cx - 30, -90], [cx - 14, -90]], C.cactus, 2, 3);
      }
    });
    this.town = bake(1040, 420, 0, 420, (x) => {
      // A clean little town that people live in: painted fronts, lit windows, awnings, signs, washing out
      // to dry, a chimney going, barrels by the doors. Back to front, then what stands before it.
      shape(x, [[900, 0], [900, -250], [1020, -250], [1020, 0]], C.woodDark, 2);
      shape(x, ellipse(960, -320, 66, 64, 16), C.woodDark, 2);
      shape(x, [[890, -360], [960, -398], [1030, -360]], C.band, 1.5);
      const fronts: [number, number, number, string, string][] = [
        [0, 170, 200, "#B5533A", "SALOON"],
        [170, 136, 160, "#D9B26A", "STORE"],
        [306, 180, 250, "#5E8F8A", "HOTEL"],
        [486, 216, 300, C.bank, "BANK"],
        [702, 124, 170, "#A8623E", ""],
        [826, 120, 214, "#7A8FA6", ""],
      ];
      const lit = "#FFD86B";
      for (const [fx, w, h, c, name] of fronts) {
        shape(x, [[fx, 0], [fx, -h * 0.76], [fx + w * 0.22, -h * 0.76], [fx + w * 0.22, -h], [fx + w * 0.78, -h], [fx + w * 0.78, -h * 0.76], [fx + w, -h * 0.76], [fx + w, 0]], c, 1.6);
        for (let wy = 0; wy < 2; wy++) {
          const top = -h * 0.66 + wy * h * 0.27;
          const bottom = top + h * 0.15;
          for (const [a0, a1] of [[0.16, 0.4], [0.6, 0.84]]) {
            shape(x, [[fx + w * a0, top], [fx + w * a1, top], [fx + w * a1, bottom], [fx + w * a0, bottom]], (fx + wy * 37 + a0 * 100) % 3 < 2 ? lit : C.woodDark, 0.8, 0);
            x.fillStyle = PAPER_TRIM;
            x.fillRect(fx + w * (a0 + a1) * 0.5 - 1.5, top, 3, bottom - top);
          }
        }
        // A door, and an awning over it, in stripes.
        shape(x, [[fx + w * 0.38, 0], [fx + w * 0.38, -h * 0.24], [fx + w * 0.62, -h * 0.24], [fx + w * 0.62, 0]], C.woodDark, 0.8, 0);
        const ay = -h * 0.28;
        const stripes = 6;
        for (let i = 0; i < stripes; i++) {
          const x0 = fx + w * (0.06 + (0.88 * i) / stripes);
          const x1 = fx + w * (0.06 + (0.88 * (i + 1)) / stripes);
          shape(x, [[x0, ay - 16], [x1, ay - 16], [x1 + 2, ay + 8], [x0 + 2, ay + 8]], i % 2 ? PAPER_TRIM : C.band, 0.5, 0);
        }
        if (name) {
          x.fillStyle = C.woodDark;
          x.font = `400 ${name === "BANK" ? 42 : 25}px Rye, serif`;
          x.textAlign = "center";
          x.fillText(name, fx + w / 2, -h * 0.82);
        }
      }
      // A chimney going, in clean round puffs.
      shape(x, [[60, -196], [60, -236], [90, -236], [90, -196]], C.woodDark, 1);
      for (const [px, py, pr] of [[76, -254, 15], [90, -282, 21], [108, -316, 27]]) shape(x, ellipse(px, py, pr, pr, 12), C.smoke, 0.8, 0);
      // Washing strung between the hotel and the store.
      x.strokeStyle = C.woodDark;
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(170, -150);
      x.quadraticCurveTo(240, -128, 310, -160);
      x.stroke();
      for (const [lx, ly, c] of [[196, -140, "#F7F2E2"], [228, -134, C.band], [262, -136, "#3B8FA6"]] as [number, number, string][]) {
        shape(x, [[lx, ly], [lx + 22, ly], [lx + 20, ly + 30], [lx + 2, ly + 30]], c, 0.6, 0);
      }
      // Barrels, a bench and a lamp by the doors.
      for (const bx of [16, 150, 712]) shape(x, [[bx, 0], [bx - 2, -30], [bx + 22, -30], [bx + 20, 0]], C.woodDark, 0.8, 0);
      shape(x, [[476, -66], [482, -66], [482, 0], [476, 0]], C.woodDark, 0.5, 0);
      shape(x, ellipse(479, -74, 10, 10, 10), lit, 0.5, 0);
    });
    this.weed = bake(90, 90, 45, 45, (x) => {
      const r = rng(4);
      x.strokeStyle = C.woodDark;
      x.lineWidth = 3;
      for (let i = 0; i < 18; i++) {
        x.beginPath();
        x.moveTo(Math.cos(r() * 7) * 36 * r(), Math.sin(r() * 7) * 36 * r());
        x.quadraticCurveTo((r() - 0.5) * 70, (r() - 0.5) * 70, Math.cos(r() * 7) * 40, Math.sin(r() * 7) * 40);
        x.stroke();
      }
    });

    // The bank, between his legs and in the blast.
    this.bankBig = bake(760, 380, 380, 370, (x) => bankFront(x, 720, 340));
    this.legs = bake(884, 400, 0, 0, (x) => {
      for (const m of [0, 1]) {
        const X = (v: number) => (m ? 884 - v : v);
        shape(x, [[X(442), -8], [X(442), 66], [X(318), 190], [X(244), 322], [X(112), 322], [X(84), 196], [X(150), -8]], C.pants, 2.6);
        shape(x, [[X(100), 312], [X(256), 312], [X(278), 372], [X(320), 400], [X(52), 400], [X(70), 352]], C.boot, 1.8);
      }
    });
    this.hem = bake(900, 70, 0, 0, (x) => {
      shape(x, [[-8, -8], [908, -8], [908, 26], [-8, 26]], C.poncho, 1.8);
    });

    // The blast.
    this.bursts = [
      bake(860, 620, 430, 310, (x) => shape(x, star(0, 0, 400, 160, 15, 21), "#E8452A", 3)),
      bake(680, 500, 340, 250, (x) => shape(x, star(0, 0, 310, 130, 13, 33), "#F58B2A", 3)),
      bake(460, 360, 230, 180, (x) => shape(x, star(0, 0, 210, 90, 11, 45), "#FFE14D", 2.4)),
    ];
    this.puffs = [90, 120, 150, 110, 135].map((r, i) => ditherPuff(r, 41 + i * 13, C.smoke, C.smokeDark));
    this.robbers = [0, 1].map((kind) => bake(400, 380, 200, 360, (x) => robberShape(x, kind, 1)));
    this.planks = bake(150, 40, 75, 20, (x) => shape(x, [[-70, -13], [70, -13], [62, 13], [-66, 11]], C.woodDark, 1.4, 3));
  }

  private sky(w: number, h: number) {
    const x = this.x;
    x.fillStyle = C.skyHigh;
    x.fillRect(0, 0, w, h);
    x.fillStyle = C.sky;
    x.fillRect(0, h * 0.28, w, h);
  }

  private walkPanel(w: number, h: number) {
    const x = this.x;
    this.sky(w, h);
    put(x, this.sun, w * 0.68, h * 0.27);
    const horizon = h * 0.66;
    put(x, this.far, -80, horizon);
    put(x, this.town, w * 0.45, horizon + 6, 0, 1.0);
    put(x, this.near, -180, horizon + 34);
    put(x, this.road, -420, h * 0.78);
    put(x, this.weed, w * 0.86, h * 0.86, 0.6);
  }

  private bankBack(w: number, h: number, zoom: number, shake = 0) {
    const x = this.x;
    this.sky(w, h);
    x.fillStyle = C.mesa;
    x.fillRect(0, h * 0.52, w, h);
    x.fillStyle = C.road;
    x.fillRect(0, h * 0.74, w, h);
    put(x, this.bankBig, w / 2 + shake, h * 0.78, 0, zoom);
  }

  private legsPanel(w: number, h: number) {
    const x = this.x;
    // Seen between his legs: the bank sits small in the gap.
    this.bankBack(w, h, 0.46);
    put(x, this.legs, 0, 0);
    put(x, this.hem, -8, -8);
  }

  private bustPanel(w: number, h: number, robbers: boolean) {
    const x = this.x;
    const held = Math.floor(BLAST_AGE * 12);
    const u = 1;
    const shake = 0;
    this.bankBack(w, h, 0.78, shake);
    const cx = w / 2;
    const cy = h * 0.6;
    const grow = 0.34 + easeOut(u) * 0.75;
    put(x, this.bursts[0], cx, cy, held * 0.09, grow);
    put(x, this.bursts[1], cx, cy, -held * 0.11, grow * 0.95);
    put(x, this.bursts[2], cx, cy, held * 0.06, grow * 0.86);
    // Smoke rolls out behind them.
    const spots: Pt[] = [[-310, -24], [270, -34], [-180, -96], [156, -110], [-60, -150], [360, 20], [-400, 40]];
    spots.forEach(([sx, sy], i) => {
      const puff = this.puffs[i % this.puffs.length];
      const g = 0.45 + easeOut(u) * 0.9;
      put(x, puff, cx + sx * easeOut(u), cy + sy * easeOut(u), i, g);
    });
    // The robbers come through it, black against the blast.
    const rise = easeOut(Math.max(0, (u - 0.2) / 0.8));
    if (robbers) {
      put(x, this.robbers[1], cx + 200, h + 12, 0.07, 0.8 * rise + 0.001);
      put(x, this.robbers[0], cx - 130, h + 16, -0.03, 0.86 * rise + 0.001);
    }
    // Planks in flight.
    for (let i = 0; i < 6; i++) {
      const a = 0.5 + (i / 6) * (Math.PI * 2);
      const dist = 40 + easeOut(u) * (250 + i * 26);
      put(x, this.planks, cx + Math.cos(a) * dist * 1.3, cy + Math.sin(a) * dist * 0.64, a * 2 + held * 0.6, 0.58);
    }
    // Low smoke in front of their feet.
    for (let i = 0; i < 4; i++) {
      const puff = this.puffs[(i + 2) % this.puffs.length];
      put(x, puff, cx + (i - 1.5) * 220 * easeOut(u), h * 0.98, i * 2, 0.7 + easeOut(u) * 0.4);
    }
  }

}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);
