// Shot effects: one dynamic buffer, one draw. Premultiplied blending lets additive sparks and
// solid black ink share a batch. The burst is built on a colour clash: hot orange sparks against
// a cool teal flash, with ink and wood splinters for weight.

import type { Mat4, V3 } from "./gl";
import { createProgram, cross, norm, sub } from "./gl";
import type { Program } from "./gl";
import type { Camera } from "./renderer";
import { fx as fxAtlas } from "./tex";
import type { RGB } from "./mesh";
import { hex } from "./mesh";
import { FX_FS, FX_VS } from "./shaders";

/** Cell in the 4x4 atlas. */
const CELL = { glow: [0, 0], flash: [1, 0], ink: [2, 0], ring: [3, 0], shard: [0, 1], spark: [1, 1], smoke: [2, 1], star: [3, 1], drop: [0, 2] } as const;
type CellName = keyof typeof CELL;

interface Particle {
  cell: CellName;
  p: V3;
  v: V3;
  g: number;
  drag: number;
  life: number;
  maxLife: number;
  size: number;
  grow: number;
  rot: number;
  spin: number;
  col: RGB;
  /** 0 is purely additive, 1 is solid. */
  solid: number;
  /** Stretch along velocity, for sparks. */
  stretch: number;
  /** Tumble: squash on one axis over time, so flat shards look 3D. */
  tumble: number;
}

const MAX = 420;
const STRIDE = 9;

export class Effects {
  private gl: WebGLRenderingContext;
  private prog: Program;
  private buf: WebGLBuffer;
  private tex: WebGLTexture;
  private data = new Float32Array(MAX * 6 * STRIDE);
  private list: Particle[] = [];
  count = 0;

  constructor(gl: WebGLRenderingContext, uploadTex: (t: ReturnType<typeof fxAtlas>) => WebGLTexture) {
    this.gl = gl;
    this.prog = createProgram(gl, FX_VS, FX_FS);
    this.buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    this.tex = uploadTex(fxAtlas());
  }

  private add(q: Partial<Particle> & { cell: CellName; p: V3; size: number; life: number; col: RGB }) {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push({
      v: [0, 0, 0],
      g: 0,
      drag: 0,
      maxLife: q.life,
      grow: 0,
      rot: 0,
      spin: 0,
      solid: 0,
      stretch: 0,
      tumble: 0,
      ...q,
    });
  }

  /** A streak of light from the muzzle to the impact. */
  tracer(a: V3, b: V3) {
    const hot = hex("#FFB347");
    const d = sub(b, a);
    const len = Math.hypot(d[0], d[1], d[2]);
    const dir = norm(d);
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      const u = (i + 0.5) / steps;
      this.add({
        cell: "spark",
        p: [a[0] + d[0] * u, a[1] + d[1] * u, a[2] + d[2] * u],
        v: [dir[0] * 0.001, dir[1] * 0.001, dir[2] * 0.001],
        size: (len / steps) * 0.75,
        stretch: 0.03,
        life: 0.09,
        col: hot,
      });
    }
  }

  muzzle(p: V3) {
    this.add({ cell: "flash", p, size: 0.1, grow: 1.3, life: 0.06, col: hex("#FFD27A"), rot: Math.random() * 6.28 });
    this.add({ cell: "glow", p, size: 0.2, grow: 0.7, life: 0.08, col: hex("#FF8A2A") });
    for (let i = 0; i < 4; i++) {
      this.add({
        cell: "smoke",
        p: [p[0], p[1], p[2]],
        v: [(Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6],
        size: 0.025,
        grow: 0.15,
        life: 0.45,
        col: [0.75, 0.72, 0.68],
        solid: 0.55,
        rot: Math.random() * 6.28,
      });
    }
  }

  /** The big one: a hit on a target. dirToCam pushes debris back out of the target. */
  hit(p: V3, wood: RGB) {
    const cool = hex("#2FE6D0");
    const hot = hex("#FF8A1E");
    const white = hex("#FFF4D8");
    const ink = hex("#120A06");
    this.add({ cell: "flash", p, size: 1, grow: 8, life: 0.12, col: white, rot: Math.random() * 6.28 });
    this.add({ cell: "glow", p, size: 2, grow: 9, life: 0.22, col: cool });
    this.add({ cell: "ring", p, size: 0.4, grow: 13, life: 0.3, col: cool });
    this.add({ cell: "ring", p, size: 0.3, grow: 7, life: 0.36, col: hot });
    const R = () => Math.random();
    for (let i = 0; i < 36; i++) {
      const a = R() * 6.283;
      const up = R() * 1.2 - 0.25;
      const sp = 5 + R() * 11;
      this.add({
        cell: "spark",
        p: [p[0], p[1], p[2]],
        v: [Math.cos(a) * sp, up * sp, Math.sin(a) * sp * 0.6 + 2],
        g: 13,
        drag: 2,
        size: 0.1 + R() * 0.12,
        stretch: 0.07,
        life: 0.35 + R() * 0.45,
        col: i % 4 === 0 ? cool : hot,
      });
    }
    for (let i = 0; i < 18; i++) {
      const a = R() * 6.283;
      const sp = 1.5 + R() * 5;
      this.add({
        cell: "ink",
        p: [p[0], p[1], p[2]],
        v: [Math.cos(a) * sp, Math.sin(a) * sp * 0.8 + 1, 1 + R() * 2],
        g: 7,
        drag: 3,
        size: 0.14 + R() * 0.32,
        grow: 0.5,
        life: 0.45 + R() * 0.5,
        col: ink,
        solid: 1,
        rot: R() * 6.28,
        spin: (R() - 0.5) * 8,
      });
    }
    for (let i = 0; i < 12; i++) {
      const a = R() * 6.283;
      const sp = 4 + R() * 7;
      this.add({
        cell: "shard",
        p: [p[0], p[1], p[2]],
        v: [Math.cos(a) * sp, Math.abs(Math.sin(a)) * sp + 2, 1 + R() * 3],
        g: 14,
        drag: 0.6,
        size: 0.16 + R() * 0.26,
        life: 0.8 + R() * 0.5,
        col: [wood[0] * (0.8 + R() * 0.4), wood[1] * (0.8 + R() * 0.4), wood[2] * (0.8 + R() * 0.4)],
        solid: 1,
        rot: R() * 6.28,
        spin: (R() - 0.5) * 16,
        tumble: 7 + R() * 10,
      });
    }
  }

  /** A bead of nervous sweat flying off a monkey's head. */
  sweat(p: V3) {
    const R = () => Math.random();
    const s = R() < 0.5 ? -1 : 1;
    this.add({
      cell: "drop",
      p: [p[0], p[1], p[2]],
      v: [s * (0.6 + R() * 1.1), 1.1 + R() * 1.1, 0.4 * R()],
      g: 6.5,
      size: 0.075 + R() * 0.05,
      life: 0.55 + R() * 0.3,
      col: hex("#BDEBFF"),
      solid: 1,
    });
  }

  /** A puff where a stray shot lands. */
  miss(p: V3, sand: RGB) {
    const R = () => Math.random();
    this.add({ cell: "star", p, size: 0.3, grow: 3, life: 0.08, col: hex("#FFD27A"), rot: R() * 6.28 });
    for (let i = 0; i < 7; i++) {
      this.add({
        cell: "smoke",
        p: [p[0], p[1], p[2]],
        v: [(R() - 0.5) * 3, 1 + R() * 2, (R() - 0.5) * 2],
        g: 2,
        drag: 2.4,
        size: 0.22,
        grow: 1.6,
        life: 0.55 + R() * 0.3,
        col: sand,
        solid: 0.8,
        rot: R() * 6.28,
      });
    }
    for (let i = 0; i < 6; i++) {
      const a = R() * 6.28;
      this.add({
        cell: "spark",
        p: [p[0], p[1], p[2]],
        v: [Math.cos(a) * 4, 3 + R() * 4, Math.sin(a) * 4],
        g: 14,
        size: 0.08,
        stretch: 0.06,
        life: 0.3,
        col: hex("#FF8A1E"),
      });
    }
  }

  update(dt: number) {
    for (const q of this.list) {
      q.life -= dt;
      const d = Math.max(0, 1 - q.drag * dt);
      q.v[0] *= d;
      q.v[1] = q.v[1] * d - q.g * dt;
      q.v[2] *= d;
      q.p[0] += q.v[0] * dt;
      q.p[1] += q.v[1] * dt;
      q.p[2] += q.v[2] * dt;
      q.size += q.grow * dt;
      q.rot += q.spin * dt;
      if (q.p[1] < 0.03 && q.g > 0) {
        q.p[1] = 0.03;
        q.v[1] *= -0.3;
        q.v[0] *= 0.6;
        q.v[2] *= 0.6;
        q.spin *= 0.5;
      }
    }
    this.list = this.list.filter((q) => q.life > 0);
    this.count = this.list.length;
  }

  draw(vp: Mat4, cam: Camera) {
    if (!this.list.length) return false;
    const gl = this.gl;
    const v = cam.view;
    const right: V3 = [v[0], v[4], v[8]];
    const up: V3 = [v[1], v[5], v[9]];
    const fwd: V3 = [-v[2], -v[6], -v[10]];
    const d = this.data;
    let o = 0;
    const put = (x: number, y: number, z: number, c: RGB, al: number, a: number, s: number, t: number) => {
      d[o++] = x;
      d[o++] = y;
      d[o++] = z;
      d[o++] = c[0] * al;
      d[o++] = c[1] * al;
      d[o++] = c[2] * al;
      d[o++] = a;
      d[o++] = s;
      d[o++] = t;
    };
    for (const q of this.list) {
      const k = q.life / q.maxLife;
      const alpha = Math.min(1, k * 2.4);
      const [cu, cv] = CELL[q.cell];
      const u0 = cu * 0.25 + 0.001;
      const v0 = cv * 0.25 + 0.001;
      const u1 = u0 + 0.248;
      const v1 = v0 + 0.248;
      let ax: V3;
      let ay: V3;
      const sz = q.size;
      if (q.stretch > 0) {
        // Align with velocity on screen.
        const sv = cross(fwd, norm(q.v));
        const n = norm(sv);
        const speed = Math.hypot(q.v[0], q.v[1], q.v[2]);
        const dir = norm(q.v);
        const long = sz * (1 + speed * q.stretch * 6);
        ax = [dir[0] * long, dir[1] * long, dir[2] * long];
        ay = [n[0] * sz * 0.5, n[1] * sz * 0.5, n[2] * sz * 0.5];
      } else {
        const c = Math.cos(q.rot);
        const s = Math.sin(q.rot);
        const flip = q.tumble ? 0.25 + 0.75 * Math.abs(Math.cos(q.rot * q.tumble * 0.2)) : 1;
        ax = [(right[0] * c + up[0] * s) * sz, (right[1] * c + up[1] * s) * sz, (right[2] * c + up[2] * s) * sz];
        ay = [(-right[0] * s + up[0] * c) * sz * flip, (-right[1] * s + up[1] * c) * sz * flip, (-right[2] * s + up[2] * c) * sz * flip];
      }
      const px = q.p[0];
      const py = q.p[1];
      const pz = q.p[2];
      const A = q.solid * alpha;
      const a: [number, number, number] = [px - ax[0] - ay[0], py - ax[1] - ay[1], pz - ax[2] - ay[2]];
      const b: [number, number, number] = [px + ax[0] - ay[0], py + ax[1] - ay[1], pz + ax[2] - ay[2]];
      const c2: [number, number, number] = [px + ax[0] + ay[0], py + ax[1] + ay[1], pz + ax[2] + ay[2]];
      const e: [number, number, number] = [px - ax[0] + ay[0], py - ax[1] + ay[1], pz - ax[2] + ay[2]];
      put(a[0], a[1], a[2], q.col, alpha, A, u0, v1);
      put(b[0], b[1], b[2], q.col, alpha, A, u1, v1);
      put(c2[0], c2[1], c2[2], q.col, alpha, A, u1, v0);
      put(a[0], a[1], a[2], q.col, alpha, A, u0, v1);
      put(c2[0], c2[1], c2[2], q.col, alpha, A, u1, v0);
      put(e[0], e[1], e[2], q.col, alpha, A, u0, v0);
    }
    gl.useProgram(this.prog.handle);
    gl.uniformMatrix4fv(this.prog.u.uViewProj, false, vp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.prog.u.uTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.subarray(0, o));
    for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i);
    const loc = (name: string) => gl.getAttribLocation(this.prog.handle, name);
    const bytes = STRIDE * 4;
    gl.enableVertexAttribArray(loc("aPos"));
    gl.vertexAttribPointer(loc("aPos"), 3, gl.FLOAT, false, bytes, 0);
    gl.enableVertexAttribArray(loc("aColor"));
    gl.vertexAttribPointer(loc("aColor"), 4, gl.FLOAT, false, bytes, 12);
    gl.enableVertexAttribArray(loc("aUv"));
    gl.vertexAttribPointer(loc("aUv"), 2, gl.FLOAT, false, bytes, 28);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, o / STRIDE);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    return true;
  }
}
