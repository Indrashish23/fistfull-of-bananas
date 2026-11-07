// MeshBuilder: the scene is emitted as triangles with baked per-vertex colour and merged into
// one buffer per material. Normals are flat from each transformed triangle unless a shape asks
// for smooth ones. UVs come from the local plane of each face, with the texture's u along the
// grain. Never mirror with a negative scale, because that flips the winding.

import { cross, identity, multiply, norm, rotationX, rotationY, rotationZ, scaling, sub, translation } from "./gl";
import type { Mat4, V3 } from "./gl";
import { glyph } from "./font";

export type RGB = [number, number, number];
export type Mat = "wood" | "plain" | "rock" | "ground" | "foliage";
export const MAT_ORDER: Mat[] = ["wood", "plain", "rock", "ground", "foliage"];

export const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
export const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
export const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  pick<T>(list: T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }
}

export interface BoxOpts {
  /** Faces to omit: any of "+x -x +y -y +z -z", space separated. */
  skip?: string;
  /** Random brightness per face, e.g. 0.04. */
  jit?: number;
  /** Multiplier applied to the bottom edge of side faces: cheap baked contact shading. */
  ao?: number;
}

interface Bucket {
  p: number[];
  n: number[];
  c: number[];
  t: number[];
}

type Axis = "x" | "y" | "z";
const AXIS: Record<Axis, number> = { x: 0, y: 1, z: 2 };

export class MeshBuilder {
  /** While true, every jitter call returns the colour unchanged. For flat-colour art. */
  static solidColors = false;
  buckets: Partial<Record<Mat, Bucket>> = {};
  /** Material of everything written from now on. */
  mat: Mat = "wood";
  /** Axis the texture's grain follows, for faces that contain it. */
  grain: Axis = "x";
  /** World units per texture repeat, along and across the grain. */
  uvScale: [number, number] = [3.2, 1.6];
  uvOff: [number, number] = [0, 0];
  /** Vertices written while true ignore lighting and shadow. */
  unlit = false;
  /** 0..1, how much distance fog applies to vertices written from now on. */
  fog = 1;
  /** Bone that vertices written from now on follow. -1 means not skinned. */
  bone = -1;
  rng: Rng;
  private uvRng: Rng;

  private m: Mat4 = identity();
  private stack: Mat4[] = [];

  constructor(seed = 1) {
    this.rng = new Rng(seed);
    this.uvRng = new Rng(seed ^ 0x5bd1e995);
  }

  push() {
    this.stack.push(this.m.slice() as Mat4);
  }
  pop() {
    this.m = this.stack.pop()!;
  }
  translate(x: number, y: number, z: number) {
    this.m = multiply(this.m, translation(x, y, z));
  }
  rotX(a: number) {
    this.m = multiply(this.m, rotationX(a));
  }
  rotY(a: number) {
    this.m = multiply(this.m, rotationY(a));
  }
  rotZ(a: number) {
    this.m = multiply(this.m, rotationZ(a));
  }
  scale(x: number, y: number, z: number) {
    this.m = multiply(this.m, scaling(x, y, z));
  }
  /** Lean: x += k * y. Used to make weathered buildings slump. */
  shearX(k: number) {
    const s = identity();
    s[4] = k;
    this.m = multiply(this.m, s);
  }
  /** New texture offset, so neighbouring planks don't share a grain pattern. */
  randUV() {
    this.uvOff = [this.uvRng.next() * 7, this.uvRng.next() * 7];
  }
  /** Run fn with one material, then restore the previous one. */
  withMat(mat: Mat, fn: () => void) {
    const was = this.mat;
    this.mat = mat;
    fn();
    this.mat = was;
  }

  private tp(p: V3): V3 {
    const m = this.m;
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
  }
  private tn(n: V3): V3 {
    const m = this.m;
    return norm([m[0] * n[0] + m[4] * n[1] + m[8] * n[2], m[1] * n[0] + m[5] * n[1] + m[9] * n[2], m[2] * n[0] + m[6] * n[1] + m[10] * n[2]]);
  }

  /** A local point in world space, through the current transform. */
  worldPoint(p: V3): V3 {
    return this.tp(p);
  }

  get triangleCount() {
    let n = 0;
    for (const m of MAT_ORDER) n += (this.buckets[m]?.p.length ?? 0) / 9;
    return n;
  }

  private planarUV(p: V3, nLocal: V3): [number, number] {
    const ax = Math.abs(nLocal[0]);
    const ay = Math.abs(nLocal[1]);
    const az = Math.abs(nLocal[2]);
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) [u, v] = [0, 2];
    else if (ax >= az) [u, v] = [2, 1];
    else [u, v] = [0, 1];
    const g = AXIS[this.grain];
    if (v === g) [u, v] = [v, u];
    return [p[u] / this.uvScale[0] + this.uvOff[0], p[v] / this.uvScale[1] + this.uvOff[1]];
  }

  /** Full-control triangle. Omitted normals are flat, omitted UVs are planar. */
  triFull(
    a: V3,
    b: V3,
    c: V3,
    ca: RGB,
    cb: RGB,
    cc: RGB,
    normals?: [V3, V3, V3],
    uvs?: [[number, number], [number, number], [number, number]],
  ) {
    const A = this.tp(a);
    const B = this.tp(b);
    const C = this.tp(c);
    const flat = norm(cross(sub(B, A), sub(C, A)));
    const local = norm(cross(sub(b, a), sub(c, a)));
    const na = normals ? this.tn(normals[0]) : flat;
    const nb = normals ? this.tn(normals[1]) : flat;
    const nc = normals ? this.tn(normals[2]) : flat;
    // Skinned meshes carry their bone index in u instead of a texture coordinate.
    const skinned = this.bone >= 0;
    const boneUv: [number, number] = [this.bone, 0];
    const ua = skinned ? boneUv : uvs ? uvs[0] : this.planarUV(a, local);
    const ub = skinned ? boneUv : uvs ? uvs[1] : this.planarUV(b, local);
    const uc = skinned ? boneUv : uvs ? uvs[2] : this.planarUV(c, local);
    const bucket = (this.buckets[this.mat] ??= { p: [], n: [], c: [], t: [] });
    const flag = this.unlit ? 1 : 0;
    const f = this.fog;
    const put = (p: V3, n: V3, col: RGB, uv: [number, number]) => {
      bucket.p.push(p[0], p[1], p[2]);
      bucket.n.push(n[0], n[1], n[2], flag);
      bucket.c.push(col[0], col[1], col[2], f);
      bucket.t.push(uv[0], uv[1]);
    };
    put(A, na, ca, ua);
    put(B, nb, cb, ub);
    put(C, nc, cc, uc);
  }

  /** Counter-clockwise when viewed from outside. */
  tri(a: V3, b: V3, c: V3, ca: RGB, cb: RGB = ca, cc: RGB = ca) {
    this.triFull(a, b, c, ca, cb, cc);
  }

  /** a, b, c, d counter-clockwise from outside. Optional per-corner colours. */
  quad(a: V3, b: V3, c: V3, d: V3, ca: RGB, cb: RGB = ca, cc: RGB = ca, cd: RGB = ca) {
    this.tri(a, b, c, ca, cb, cc);
    this.tri(a, c, d, ca, cc, cd);
  }

  /** Quad with explicit UVs, for plant cards and the ground. */
  quadUV(
    a: V3,
    b: V3,
    c: V3,
    d: V3,
    ua: [number, number],
    ub: [number, number],
    uc: [number, number],
    ud: [number, number],
    ca: RGB,
    cb: RGB = ca,
    cc: RGB = ca,
    cd: RGB = ca,
    normal?: V3,
  ) {
    const n = normal ? ([normal, normal, normal] as [V3, V3, V3]) : undefined;
    this.triFull(a, b, c, ca, cb, cc, n, [ua, ub, uc]);
    this.triFull(a, c, d, ca, cc, cd, n, [ua, uc, ud]);
  }

  jitter(c: RGB, amount: number): RGB {
    if (!amount || MeshBuilder.solidColors) return c;
    const k = 1 + (this.rng.next() - 0.5) * 2 * amount;
    return mul(c, k);
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: RGB, o: BoxOpts = {}) {
    const skip = o.skip ?? "";
    const jit = o.jit ?? 0;
    const ao = o.ao ?? 1;
    // Grain follows the longest side, and every box gets its own patch of texture.
    const was = this.grain;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const dz = Math.abs(z1 - z0);
    this.grain = dx >= dy && dx >= dz ? "x" : dy >= dz ? "y" : "z";
    this.randUV();
    const side = (a: V3, b: V3, cc: V3, d: V3) => {
      const col = this.jitter(c, jit);
      const low = mul(col, ao);
      this.quad(a, b, cc, d, low, low, col, col);
    };
    if (!skip.includes("+z")) side([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    if (!skip.includes("-z")) side([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    if (!skip.includes("+x")) side([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    if (!skip.includes("-x")) side([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    if (!skip.includes("+y")) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], this.jitter(c, jit));
    if (!skip.includes("-y")) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], this.jitter(c, jit));
    this.grain = was;
  }

  /** Y-axis frustum with n sides. Smooth-shaded by default, with grain running up the side. */
  cyl(
    cx: number,
    y0: number,
    cz: number,
    r0: number,
    y1: number,
    r1: number,
    n: number,
    c: RGB,
    o: { capTop?: boolean; capBottom?: boolean; jit?: number; phase?: number; low?: RGB; flat?: boolean } = {},
  ) {
    const phase = o.phase ?? 0;
    const at = (a: number, r: number, y: number): V3 => [cx + r * Math.cos(a), y, cz + r * Math.sin(a)];
    const slope = (r0 - r1) / Math.max(0.001, y1 - y0);
    const nrm = (a: number): V3 => norm([Math.cos(a), slope, Math.sin(a)]);
    this.randUV();
    const [su, sv] = this.uvScale;
    const [ou, ov] = this.uvOff;
    const circ = Math.PI * 2 * Math.max(r0, r1);
    for (let i = 0; i < n; i++) {
      const a0 = phase + (i / n) * Math.PI * 2;
      const a1 = phase + ((i + 1) / n) * Math.PI * 2;
      const col = this.jitter(c, o.jit ?? 0);
      const low = o.low ?? col;
      const uvBL: [number, number] = [ou + y0 / su, ov + ((i + 1) / n) * circ / sv];
      const uvBR: [number, number] = [ou + y0 / su, ov + (i / n) * circ / sv];
      const uvTR: [number, number] = [ou + y1 / su, ov + (i / n) * circ / sv];
      const uvTL: [number, number] = [ou + y1 / su, ov + ((i + 1) / n) * circ / sv];
      const na = nrm(a1);
      const nb = nrm(a0);
      const nsT: [V3, V3, V3] = [na, nb, nb];
      const nsU: [V3, V3, V3] = [na, nb, na];
      const sm = !o.flat;
      this.triFull(at(a1, r0, y0), at(a0, r0, y0), at(a0, r1, y1), low, low, col, sm ? nsT : undefined, [uvBL, uvBR, uvTR]);
      this.triFull(at(a1, r0, y0), at(a0, r1, y1), at(a1, r1, y1), low, col, col, sm ? nsU : undefined, [uvBL, uvTR, uvTL]);
      if (o.capTop !== false && r1 > 0) this.tri([cx, y1, cz], at(a1, r1, y1), at(a0, r1, y1), c);
      if (o.capBottom && r0 > 0) this.tri([cx, y0, cz], at(a0, r0, y0), at(a1, r0, y0), c);
    }
  }

  /** A stick between two points. Square by default; round gives a smooth 8-sided log. */
  beam(p0: V3, p1: V3, t: number, c: RGB, o: { caps?: boolean; jit?: number; t1?: number; round?: boolean } = {}) {
    const d = norm(sub(p1, p0));
    const up: V3 = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const a = norm(cross(d, up));
    const b = cross(a, d);
    const r0 = t / 2;
    const r1 = (o.t1 ?? t) / 2;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const n = o.round ? 8 : 4;
    const spread = o.round ? 1 : Math.SQRT2;
    const phase = o.round ? 0 : Math.PI / 4;
    const dir = (i: number): V3 => {
      const ang = phase + (i / n) * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      return [a[0] * ca + b[0] * sa, a[1] * ca + b[1] * sa, a[2] * ca + b[2] * sa];
    };
    const at = (p: V3, r: number, v: V3): V3 => [
      p[0] + v[0] * r * spread,
      p[1] + v[1] * r * spread,
      p[2] + v[2] * r * spread,
    ];
    this.randUV();
    const [su, sv] = this.uvScale;
    const [ou, ov] = this.uvOff;
    const girth = Math.PI * 2 * r0;
    for (let i = 0; i < n; i++) {
      const v0 = dir(i);
      const v1 = dir(i + 1);
      const col = this.jitter(c, o.jit ?? 0);
      const uv = (along: number, around: number): [number, number] => [ou + (along * len) / su, ov + (around * girth) / sv];
      const u00 = uv(0, i / n);
      const u01 = uv(0, (i + 1) / n);
      const u11 = uv(1, (i + 1) / n);
      const u10 = uv(1, i / n);
      const ns1: [V3, V3, V3] | undefined = o.round ? [v0, v1, v1] : undefined;
      const ns2: [V3, V3, V3] | undefined = o.round ? [v0, v1, v0] : undefined;
      this.triFull(at(p0, r0, v0), at(p0, r0, v1), at(p1, r1, v1), col, col, col, ns1, [u00, u01, u11]);
      this.triFull(at(p0, r0, v0), at(p1, r1, v1), at(p1, r1, v0), col, col, col, ns2, [u00, u11, u10]);
    }
    if (o.caps !== false) {
      for (let i = 1; i < n - 1; i++) {
        this.tri(at(p1, r1, dir(0)), at(p1, r1, dir(i)), at(p1, r1, dir(i + 1)), c);
        this.tri(at(p0, r0, dir(0)), at(p0, r0, dir(i + 1)), at(p0, r0, dir(i)), c);
      }
    }
  }

  /** Ellipsoid. sub=0 is 20 faces, sub=1 is 80, sub=2 is 320. Pass smooth for rounded shading. */
  ico(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    sub: number,
    c: RGB | ((n: V3) => RGB),
    o: { flatBelow?: number; rough?: number; jit?: number; smooth?: boolean } = {},
  ) {
    const rough = o.rough ?? 0;
    const lift = (v: V3): V3 => {
      let k = 1;
      if (rough) {
        const h = Math.sin(v[0] * 12.9 + v[1] * 78.2 + v[2] * 37.7 + cx) * 43758.5;
        k = 1 + (h - Math.floor(h) - 0.5) * rough;
      }
      let y = cy + v[1] * sy * k;
      if (o.flatBelow !== undefined) y = Math.max(y, cy + o.flatBelow * sy);
      return [cx + v[0] * sx * k, y, cz + v[2] * sz * k];
    };
    const col = typeof c === "function" ? c : null;
    for (const [a, b, d] of icoFaces(sub)) {
      const ca = col ? col(a) : this.jitter(c as RGB, o.jit ?? 0);
      const cb = col ? col(b) : ca;
      const cd = col ? col(d) : ca;
      const ns: [V3, V3, V3] | undefined = o.smooth
        ? [norm([a[0] / sx, a[1] / sy, a[2] / sz]), norm([b[0] / sx, b[1] / sy, b[2] / sz]), norm([d[0] / sx, d[1] / sy, d[2] / sz])]
        : undefined;
      this.triFull(lift(a), lift(b), lift(d), ca, cb, cd, ns);
    }
  }

  /** Extruded polygon in the XY plane, front face toward +z. Points counter-clockwise. */
  prismXY(points: [number, number][], z0: number, z1: number, c: RGB, back = false) {
    let cxp = 0;
    let cyp = 0;
    for (const p of points) {
      cxp += p[0];
      cyp += p[1];
    }
    cxp /= points.length;
    cyp /= points.length;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      this.tri([cxp, cyp, z1], [a[0], a[1], z1], [b[0], b[1], z1], c);
      if (back) this.tri([cxp, cyp, z0], [b[0], b[1], z0], [a[0], a[1], z0], c);
      this.quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], mul(c, 0.8));
    }
  }

  /**
   * Block letters made from real geometry, so no font texture is needed. Centred on x, sitting
   * on y, facing +z. Depth 0 means flat quads, which are cheapest.
   */
  blockText(text: string, x: number, y: number, z: number, height: number, c: RGB, depth = 0, widen = 1) {
    const was = this.mat;
    this.mat = "plain";
    const px = height / 7;
    const pw = px * widen;
    const adv = 6 * pw;
    const width = text.length * adv - pw;
    let lx = x - width / 2;
    for (const ch of text) {
      const rows = glyph(ch);
      if (rows) {
        rows.forEach((row, r) => {
          const top = y + height - r * px;
          let i = 0;
          while (i < 5) {
            if (row[i] !== "#") {
              i++;
              continue;
            }
            let j = i;
            while (j + 1 < 5 && row[j + 1] === "#") j++;
            const x0 = lx + i * pw;
            const x1 = lx + (j + 1) * pw;
            if (depth > 0) {
              this.box(x0, top - px, z, x1, top, z + depth, c, { skip: "-z -y" });
            } else {
              this.quad([x0, top - px, z], [x1, top - px, z], [x1, top, z], [x0, top, z], c);
            }
            i = j + 1;
          }
        });
      }
      lx += adv;
    }
    this.mat = was;
  }
}

const icoCache = new Map<number, [V3, V3, V3][]>();

function icoFaces(sub: number): [V3, V3, V3][] {
  const hit = icoCache.get(sub);
  if (hit) return hit;
  const t = (1 + Math.sqrt(5)) / 2;
  const v: V3[] = (
    [
      [-1, t, 0],
      [1, t, 0],
      [-1, -t, 0],
      [1, -t, 0],
      [0, -1, t],
      [0, 1, t],
      [0, -1, -t],
      [0, 1, -t],
      [t, 0, -1],
      [t, 0, 1],
      [-t, 0, -1],
      [-t, 0, 1],
    ] as V3[]
  ).map(norm);
  const idx = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  let faces: [V3, V3, V3][] = idx.map(([a, b, c]) => [v[a], v[b], v[c]]);
  const mid = (a: V3, b: V3): V3 => norm([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  for (let s = 0; s < sub; s++) {
    const next: [V3, V3, V3][] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  icoCache.set(sub, faces);
  return faces;
}

export const VERTEX_BYTES = 28;

export interface MeshPart {
  group: number;
  mat: Mat;
  first: number;
  count: number;
}

/** Packs builders, in order and split by material, into one buffer of 28 bytes per vertex. */
export function bake(...builders: MeshBuilder[]): { data: ArrayBuffer; vertexCount: number; parts: MeshPart[] } {
  let total = 0;
  const parts: MeshPart[] = [];
  builders.forEach((b, group) => {
    for (const mat of MAT_ORDER) {
      const bucket = b.buckets[mat];
      if (!bucket) continue;
      const count = bucket.p.length / 3;
      parts.push({ group, mat, first: total, count });
      total += count;
    }
  });
  const data = new ArrayBuffer(total * VERTEX_BYTES);
  const view = new DataView(data);
  const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  let o = 0;
  for (const b of builders) {
    for (const mat of MAT_ORDER) {
      const bucket = b.buckets[mat];
      if (!bucket) continue;
      const n = bucket.p.length / 3;
      for (let i = 0; i < n; i++) {
        view.setFloat32(o, bucket.p[i * 3], true);
        view.setFloat32(o + 4, bucket.p[i * 3 + 1], true);
        view.setFloat32(o + 8, bucket.p[i * 3 + 2], true);
        view.setInt8(o + 12, Math.round(bucket.n[i * 4] * 127));
        view.setInt8(o + 13, Math.round(bucket.n[i * 4 + 1] * 127));
        view.setInt8(o + 14, Math.round(bucket.n[i * 4 + 2] * 127));
        view.setInt8(o + 15, bucket.n[i * 4 + 3] * 127);
        view.setUint8(o + 16, clampByte(bucket.c[i * 4]));
        view.setUint8(o + 17, clampByte(bucket.c[i * 4 + 1]));
        view.setUint8(o + 18, clampByte(bucket.c[i * 4 + 2]));
        view.setUint8(o + 19, clampByte(bucket.c[i * 4 + 3]));
        view.setFloat32(o + 20, bucket.t[i * 2], true);
        view.setFloat32(o + 24, bucket.t[i * 2 + 1], true);
        o += VERTEX_BYTES;
      }
    }
  }
  return { data, vertexCount: total, parts };
}
