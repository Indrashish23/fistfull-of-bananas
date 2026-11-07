// Stylized low-poly fire and smoke. A small faceted mesh is bent by scrolling waves in the vertex
// shader, so the silhouette licks upward, and coloured in hard steps from a "heat" value made of height,
// how much a face points at the camera, a little scrolling noise and a per-face jitter. Burning out is
// erosion, raising the cut-off until the shape eats away from its tips, rather than a soft fade.
// Fire is opaque with no sorting to get wrong. Smoke is the same thing with a little see-through.

import { createProgram } from "./gl";
import type { Mat4, Program, V3 } from "./gl";

export interface FlamePalette {
  outer: V3;
  mid: V3;
  inner: V3;
  core: V3;
}

const rgb = (h: string): V3 => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const FIRE: FlamePalette = { outer: rgb("#C9301A"), mid: rgb("#F2681A"), inner: rgb("#FFB02E"), core: rgb("#FFF0A8") };
/** The boss's exposed heart. */
export const HEART_GLOW: FlamePalette = { outer: rgb("#6E1712"), mid: rgb("#A8241C"), inner: rgb("#D8201A"), core: rgb("#FF6A4A") };
/** What a bullet bounces off when he's invulnerable. */
/** The clean red halo round the boss's heart. */
export const HEART_HALO: FlamePalette = { outer: rgb("#D8201A"), mid: rgb("#D8201A"), inner: rgb("#F2681A"), core: rgb("#FF8A1E") };
export const BOSS_SHIELD: FlamePalette = { outer: rgb("#2F3DA8"), mid: rgb("#3D4FC4"), inner: rgb("#6F80E6"), core: rgb("#E9F2E2") };
/** Hotter and paler, for the gun. */
export const FLASH: FlamePalette = { outer: rgb("#F2681A"), mid: rgb("#FFB02E"), inner: rgb("#FFE27A"), core: rgb("#FFFBE6") };

/** How heat is made up for each shape: from its authored heat, from facing you, and from the noise. */
const SHAPE = {
  tongue: [0.74, 0.2, 0.1],
  ball: [0.55, 0.48, 0.15],
  star: [1.1, 0, 0.06],
} as const;

export type FlameMesh = "tongue" | "ball" | "star0" | "star1" | "star2";

const VS = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aData;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec3 uEye;
uniform vec3 uMotion;
uniform vec2 uLean;
varying vec3 vP;
varying float vHeat;
varying float vFacet;
varying float vFacing;
void main() {
  vec3 p = aPos;
  float w = aData.z * uMotion.z;
  float t = uMotion.x + uMotion.y * 17.0;
  float s = uMotion.y * 6.28;
  // Bulges that travel up the shape, faster the higher the note, so it reads as rising heat.
  float a = sin(p.y * 5.0 - t * 6.0 + s + p.x * 3.0);
  float b = sin(p.y * 9.0 - t * 9.5 + s * 2.0 + p.z * 4.0);
  p.xz *= 1.0 + (a * 0.24 + b * 0.13) * w;
  p.x += sin(p.y * 3.0 - t * 3.4 + s) * 0.15 * w;
  p.z += cos(p.y * 3.4 - t * 2.9 + s) * 0.13 * w;
  p.y += (a * 0.5 + 0.5) * 0.18 * w;
  vec4 world = uModel * vec4(p, 1.0);
  // Dragged behind whatever's carrying it, more toward the tip.
  world.xz += uLean * aData.z * aData.z;
  vec3 n = normalize(mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNormal);
  vFacing = max(0.0, dot(n, normalize(uEye - world.xyz)));
  vP = aPos;
  vHeat = aData.x;
  vFacet = aData.y;
  gl_Position = uViewProj * world;
}
`;

const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 uOuter;
uniform vec3 uMid;
uniform vec3 uInner;
uniform vec3 uCore;
uniform vec3 uShape;
uniform float uTime;
uniform float uErode;
uniform float uAlpha;
varying vec3 vP;
varying float vHeat;
varying float vFacet;
varying float vFacing;
void main() {
  float n = sin(vP.x * 9.0 + vP.y * 4.0 - uTime * 3.0) * sin(vP.y * 13.0 - uTime * 7.0 + vP.z * 8.0);
  float heat = vHeat * uShape.x + vFacing * uShape.y + n * uShape.z + vFacet - uErode;
  if (heat < 0.0) discard;
  vec3 c = uOuter;
  if (heat > 0.2) c = uMid;
  if (heat > 0.46) c = uInner;
  if (heat > 0.76) c = uCore;
  gl_FragColor = vec4(c * uAlpha, uAlpha);
}
`;

const PUFF_VS = `
attribute vec2 aCorner;
uniform mat4 uViewProj;
uniform vec3 uCenter;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uSize;
varying vec2 vP;
void main() {
  vP = aCorner;
  gl_Position = uViewProj * vec4(uCenter + (uRight * aCorner.x + uUp * aCorner.y) * uSize, 1.0);
}
`;

/**
 * A cartoon puff: a scalloped cloud shape in two flat tones, with no outline. It goes away by a hole
 * opening up from one side, the way hand-drawn smoke does.
 */
const PUFF_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 uFill;
uniform vec3 uShade;
uniform float uSeed;
uniform float uErode;
varying vec2 vP;
void main() {
  float a = atan(vP.y, vP.x);
  float r = length(vP);
  float s = uSeed * 40.0;
  float lobes = pow(abs(sin(a * 2.5 + s)), 0.6);
  float edge = (0.6 + 0.3 * lobes + 0.05 * sin(a * 3.0 - s)) * (1.0 - uErode * 0.3);
  vec2 from = vec2(cos(s) * 0.5, sin(s) * 0.5);
  float hole = length(vP - from) - uErode * 1.75;
  float d = min(edge - r, hole);
  if (d < 0.0) discard;
  vec3 c = uFill;
  // A hard shadow low on the side away from the sun, with a scalloped edge of its own.
  if (dot(vP, vec2(-0.5, 0.86)) + lobes * 0.1 < -0.14) c = uShade;
  gl_FragColor = vec4(c, 1.0);
}
`;

export interface PuffColors {
  fill: V3;
  shade: V3;
}

/** Gun smoke: pale and clean against the sky. */
export const GUN_PUFF: PuffColors = { fill: rgb("#FBF3E3"), shade: rgb("#CFC3B0") };
/** Off an explosion: dirty and dark. */
export const BLAST_PUFF: PuffColors = { fill: rgb("#83776B"), shade: rgb("#5D534A") };

/** Kicked up off the street: the colour of the dirt. */
export const DUST_PUFF: PuffColors = { fill: rgb("#E2C39A"), shade: rgb("#B9966D") };

export interface PuffDraw {
  at: V3;
  size: number;
  seed: number;
  /** 0 is whole, and about 1 is gone. */
  erode: number;
  colors: PuffColors;
}

const STRIDE = 9;

/** Adds one flat-shaded triangle to the list. Each corner is [x, y, z, heat, wobble]. */
function tri(out: number[], a: number[], b: number[], c: number[], facet: number) {
  const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
  const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  for (const p of [a, b, c]) out.push(p[0]!, p[1]!, p[2]!, nx, ny, nz, p[3]!, facet, p[4]!);
}

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647), s / 2147483647);
}

/** A faceted teardrop standing on the origin, one unit tall. */
export function tongueData(): Float32Array {
  const out: number[] = [];
  const r = seeded(11);
  const sides = 6;
  const rings: [number, number][] = [[0, 0.5], [0.17, 0.62], [0.4, 0.5], [0.64, 0.3], [0.84, 0.13], [1, 0.0]];
  const at = (ring: number, i: number) => {
    const [y, radius] = rings[ring]!;
    const a = ((i + (ring % 2) * 0.5) / sides) * Math.PI * 2;
    return [Math.cos(a) * radius, y, Math.sin(a) * radius, 1 - y, 0.15 + y * 0.85];
  };
  for (let g = 0; g < rings.length - 1; g++) {
    for (let i = 0; i < sides; i++) {
      const facet = (r() - 0.5) * 0.16;
      // Alternate rings sit half a step round, so the sides are triangles and the facets catch the eye.
      const odd = g % 2 === 1;
      const a0 = at(g, i), a1 = at(g, i + 1);
      const b0 = at(g + 1, odd ? i + 1 : i), b1 = at(g + 1, odd ? i + 2 : i + 1);
      tri(out, a0, b0, a1, facet);
      tri(out, a1, b0, b1, (r() - 0.5) * 0.16);
    }
  }
  // The bottom, in case it's seen from low down.
  for (let i = 0; i < sides; i++) tri(out, [0, 0, 0, 1, 0.1], at(0, i), at(0, i + 1), 0);
  return new Float32Array(out);
}

/** A once-subdivided icosahedron of radius one: a lumpy ball, for fireballs and smoke. */
export function ballData(): Float32Array {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: [number, number, number][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const unit = (p: number[]): [number, number, number] => {
    const l = Math.hypot(p[0]!, p[1]!, p[2]!);
    return [p[0]! / l, p[1]! / l, p[2]! / l];
  };
  const verts = raw.map(unit);
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const r = seeded(29);
  const out: number[] = [];
  const corner = (p: number[]) => [p[0]!, p[1]!, p[2]!, 0.55 - p[1]! * 0.25, 0.9];
  for (const [ia, ib, ic] of faces) {
    const a = verts[ia!]!, b = verts[ib!]!, c = verts[ic!]!;
    const ab = unit([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
    const bc = unit([b[0] + c[0], b[1] + c[1], b[2] + c[2]]);
    const ca = unit([c[0] + a[0], c[1] + a[1], c[2] + a[2]]);
    for (const [x, y, z] of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]] as const) {
      tri(out, corner(x), corner(y), corner(z), (r() - 0.5) * 0.14);
    }
  }
  return new Float32Array(out);
}

/**
 * A muzzle flash, along +x. One spiky star faces back up the barrel at the shooter, and two more stand
 * along the barrel, so it reads from any angle. A few variants, so no two shots look quite the same.
 */
export function starData(seed: number): Float32Array {
  const r = seeded(seed * 97 + 13);
  const out: number[] = [];
  const hot = (p: number[]) => [p[0]!, p[1]!, p[2]!, 1, 0];
  const mid = (p: number[]) => [p[0]!, p[1]!, p[2]!, 0.42, 0];
  const tip = (p: number[]) => [p[0]!, p[1]!, p[2]!, 0.02, 0];
  // Facing back at you: long and short spikes around a hot middle.
  const spikes = 7;
  const spin = r() * 6.28;
  for (let i = 0; i < spikes; i++) {
    const a0 = spin + (i / spikes) * Math.PI * 2;
    const a1 = spin + ((i + 0.5) / spikes) * Math.PI * 2;
    const a2 = spin + ((i + 1) / spikes) * Math.PI * 2;
    const reach = i % 2 === 0 ? 0.72 + r() * 0.34 : 0.42 + r() * 0.2;
    const waist = 0.2 + r() * 0.05;
    const s0 = [0.04, Math.cos(a0) * waist, Math.sin(a0) * waist];
    const s1 = [0.1, Math.cos(a1) * reach, Math.sin(a1) * reach];
    const s2 = [0.04, Math.cos(a2) * waist, Math.sin(a2) * waist];
    tri(out, hot([0, 0, 0]), mid(s0), tip(s1), 0);
    tri(out, hot([0, 0, 0]), tip(s1), mid(s2), 0);
  }
  // Along the barrel: a tall thin blade of fire in two crossed planes.
  for (const [u, v] of [[1, 0], [0, 1]] as const) {
    const len = 1.05 + r() * 0.5;
    const wide = 0.2 + r() * 0.06;
    const point = (x: number, side: number) => [x, u * side, v * side];
    for (const side of [-1, 1]) {
      const bulge = wide * (0.8 + r() * 0.4);
      tri(out, hot([0, 0, 0]), mid(point(len * 0.4, side * bulge)), hot(point(len * 0.34, 0)), 0);
      tri(out, hot(point(len * 0.34, 0)), mid(point(len * 0.4, side * bulge)), tip(point(len, side * 0.02)), 0);
      // A side spike, so the silhouette isn't a clean lens.
      tri(out, mid(point(len * 0.18, side * wide * 0.5)), tip(point(len * (0.42 + r() * 0.2), side * (wide + 0.22))), mid(point(len * 0.34, side * wide * 0.4)), 0);
    }
  }
  return new Float32Array(out);
}

export interface FlameDraw {
  mesh: FlameMesh;
  model: Mat4;
  /** 0..1, so shapes aren't in step. */
  seed: number;
  /** How far it's eaten away: 0 is whole, and about 1.3 is gone. */
  erode: number;
  /** How much the shape's bent by the licks. Set 0 for something rigid. */
  wobble?: number;
  /** World x and z the tip's dragged by, say by the speed of whatever's carrying it. */
  lean?: readonly [number, number];
  palette?: FlamePalette;
  /** Below 1, it's see-through, and drawn after the solid ones. */
  alpha?: number;
}

export class FlameRenderer {
  private gl: WebGLRenderingContext;
  private prog: Program;
  private bufs = new Map<FlameMesh, { buf: WebGLBuffer; count: number; shape: readonly number[] }>();
  private puffProg: Program;
  private quad: WebGLBuffer;

  constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    this.prog = createProgram(gl, VS, FS);
    this.puffProg = createProgram(gl, PUFF_VS, PUFF_FS);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    const add = (name: FlameMesh, data: Float32Array, shape: readonly number[]) => {
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      this.bufs.set(name, { buf, count: data.length / STRIDE, shape });
    };
    add("tongue", tongueData(), SHAPE.tongue);
    add("ball", ballData(), SHAPE.ball);
    add("star0", starData(0), SHAPE.star);
    add("star1", starData(1), SHAPE.star);
    add("star2", starData(2), SHAPE.star);
  }

  /** Draws cartoon puffs, flat to the camera along these axes. */
  puffs(list: readonly PuffDraw[], vp: Mat4, right: V3, up: V3): void {
    if (!list.length) return;
    const gl = this.gl;
    const { handle, u } = this.puffProg;
    gl.useProgram(handle);
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    gl.uniform3fv(u.uRight, right);
    gl.uniform3fv(u.uUp, up);
    for (let i = 0; i < 6; i++) gl.disableVertexAttribArray(i);
    const corner = gl.getAttribLocation(handle, "aCorner");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    for (const p of list) {
      gl.uniform3fv(u.uCenter, p.at);
      gl.uniform1f(u.uSize, p.size);
      gl.uniform1f(u.uSeed, p.seed);
      gl.uniform1f(u.uErode, p.erode);
      gl.uniform3fv(u.uFill, p.colors.fill);
      gl.uniform3fv(u.uShade, p.colors.shade);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.enable(gl.CULL_FACE);
    gl.disableVertexAttribArray(corner);
  }

  /** Draws these with this camera, into whatever depth is already there. Returns how many it drew. */
  draw(list: readonly FlameDraw[], vp: Mat4, eye: V3, time: number): number {
    if (!list.length) return 0;
    const gl = this.gl;
    const { handle, u } = this.prog;
    gl.useProgram(handle);
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    gl.uniform3fv(u.uEye, eye);
    gl.uniform1f(u.uTime, time);
    for (let i = 0; i < 6; i++) gl.disableVertexAttribArray(i);
    const pos = gl.getAttribLocation(handle, "aPos");
    const nor = gl.getAttribLocation(handle, "aNormal");
    const dat = gl.getAttribLocation(handle, "aData");
    gl.enableVertexAttribArray(pos);
    gl.enableVertexAttribArray(nor);
    gl.enableVertexAttribArray(dat);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    let bound: FlameMesh | null = null;
    const one = (d: FlameDraw) => {
      const mesh = this.bufs.get(d.mesh)!;
      if (bound !== d.mesh) {
        bound = d.mesh;
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
        gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, STRIDE * 4, 0);
        gl.vertexAttribPointer(nor, 3, gl.FLOAT, false, STRIDE * 4, 12);
        gl.vertexAttribPointer(dat, 3, gl.FLOAT, false, STRIDE * 4, 24);
        gl.uniform3f(u.uShape!, mesh.shape[0]!, mesh.shape[1]!, mesh.shape[2]!);
      }
      const p = d.palette ?? FIRE;
      gl.uniform3fv(u.uOuter, p.outer);
      gl.uniform3fv(u.uMid, p.mid);
      gl.uniform3fv(u.uInner, p.inner);
      gl.uniform3fv(u.uCore, p.core);
      gl.uniformMatrix4fv(u.uModel, false, d.model);
      gl.uniform3f(u.uMotion!, time, d.seed, d.wobble ?? 1);
      gl.uniform2f(u.uLean!, d.lean?.[0] ?? 0, d.lean?.[1] ?? 0);
      gl.uniform1f(u.uErode, d.erode);
      gl.uniform1f(u.uAlpha, d.alpha ?? 1);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    };
    gl.depthMask(true);
    for (const d of list) if ((d.alpha ?? 1) >= 1) one(d);
    if (list.some((d) => (d.alpha ?? 1) < 1)) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const d of list) if ((d.alpha ?? 1) < 1) one(d);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    gl.enable(gl.CULL_FACE);
    for (const a of [pos, nor, dat]) gl.disableVertexAttribArray(a);
    return list.length;
  }
}
