// Flat-colour fire, smoke and moon for the intro. Hard-edged shapes with no gradients, and time
// stepped so the flames animate in held poses rather than smoothly, like limited animation.

import { createProgram, norm } from "./gl";
import type { Mat4, Program, V3 } from "./gl";
import type { Camera } from "./renderer";

const FS_PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

const QUAD_VS = `
attribute vec3 aPos;
attribute vec4 aData;
uniform mat4 uViewProj;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uTime;
uniform float uRise;
varying vec2 vP;
varying float vSeed;
void main() {
  vec2 corner = aData.xy;
  float size = aData.z;
  vSeed = aData.w;
  vP = corner;
  vec3 w = aPos;
  float s = size;
  if (uRise > 0.0) {
    // Smoke: each puff climbs, drifts with the wind and swells, then starts again.
    float life = fract(uTime * (0.05 + vSeed * 0.05) + vSeed * 7.3);
    w.y += life * uRise;
    w.x += life * life * uRise * 0.32 + sin(life * 6.0 + vSeed * 30.0) * 1.2;
    s *= 0.55 + life * 1.4;
  }
  w += uRight * corner.x * s + uUp * (corner.y * s + (uRise > 0.0 ? 0.0 : s));
  gl_Position = uViewProj * vec4(w, 1.0);
}
`;

/** Three hard bands of flame. */
const FLAME_FS = `${FS_PRECISION}
uniform float uTime;
uniform vec3 uOuter;
uniform vec3 uMid;
uniform vec3 uInner;
varying vec2 vP;
varying float vSeed;
void main() {
  float y = (vP.y + 1.0) * 0.5;
  float t = uTime + vSeed * 13.0;
  float bend = sin(y * 7.0 - t * 5.0) * 0.17 * y + sin(y * 15.0 - t * 9.0 + vSeed * 9.0) * 0.07 * y;
  float x = vP.x + bend;
  float width = pow(1.0 - y, 0.75) * 0.78;
  float tongues = 0.14 * sin(x * 11.0 + t * 4.0) * y;
  float body = 1.0 - abs(x) / max(width + tongues, 0.0001);
  if (body <= 0.0 || y > 1.0) discard;
  vec3 c = uOuter;
  float h = body - y * 0.34;
  if (h > 0.26) c = uMid;
  if (h > 0.5) c = uInner;
  gl_FragColor = vec4(c, 1.0);
}
`;

/** Lumpy flat smoke, in two tones. */
const SMOKE_FS = `${FS_PRECISION}
uniform vec3 uDark;
uniform vec3 uLight;
varying vec2 vP;
varying float vSeed;
void main() {
  float a = atan(vP.y, vP.x);
  float r = length(vP);
  float edge = 0.78 + 0.13 * sin(a * 5.0 + vSeed * 40.0) + 0.07 * sin(a * 9.0 + vSeed * 90.0);
  if (r > edge) discard;
  gl_FragColor = vec4(vP.y + vP.x * 0.4 > 0.2 + 0.2 * sin(vSeed * 50.0) ? uLight : uDark, 1.0);
}
`;

const MOON_VS = `
attribute vec3 aPos;
attribute vec4 aData;
uniform mat4 uViewProj;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uCenter;
uniform float uRadius;
varying vec2 vP;
void main() {
  vP = aData.xy;
  gl_Position = uViewProj * vec4(uCenter + (uRight * aData.x + uUp * aData.y) * uRadius, 1.0);
}
`;

/** A huge flat moon: one pale disc and a few flat craters. */
const MOON_FS = `${FS_PRECISION}
uniform vec3 uColor;
uniform vec3 uCrater;
varying vec2 vP;
float hit(vec2 c, float r) { return step(length(vP - c), r); }
void main() {
  if (length(vP) > 1.0) discard;
  float k = hit(vec2(-0.42, 0.34), 0.25) + hit(vec2(0.3, 0.55), 0.13) + hit(vec2(0.5, -0.1), 0.2)
          + hit(vec2(-0.1, -0.45), 0.16) + hit(vec2(-0.66, -0.2), 0.09) + hit(vec2(0.1, 0.05), 0.07);
  gl_FragColor = vec4(k > 0.5 ? uCrater : uColor, 1.0);
}
`;

const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, -1],
  [1, 1],
  [-1, 1],
];

function buildQuads(gl: WebGLRenderingContext, items: { p: V3; size: number; seed: number }[]) {
  const data = new Float32Array(items.length * 6 * 7);
  let o = 0;
  for (const it of items) {
    for (const [cx, cy] of CORNERS) {
      data[o++] = it.p[0];
      data[o++] = it.p[1];
      data[o++] = it.p[2];
      data[o++] = cx;
      data[o++] = cy;
      data[o++] = it.size;
      data[o++] = it.seed;
    }
  }
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return { buf, count: items.length * 6 };
}

export interface FireColors {
  outer: string;
  mid: string;
  inner: string;
  smokeDark: string;
  smokeLight: string;
  moon: string;
  crater: string;
}

const rgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export class TownFire {
  private gl: WebGLRenderingContext;
  private flame: Program;
  private smoke: Program;
  private moon: Program;
  private flames: { buf: WebGLBuffer; count: number };
  private puffs: { buf: WebGLBuffer; count: number };
  private quad: { buf: WebGLBuffer; count: number };

  constructor(gl: WebGLRenderingContext, spots: { p: V3; size: number }[], private colors: FireColors) {
    this.gl = gl;
    this.flame = createProgram(gl, QUAD_VS, FLAME_FS);
    this.smoke = createProgram(gl, QUAD_VS, SMOKE_FS);
    this.moon = createProgram(gl, MOON_VS, MOON_FS);
    let seed = 41;
    const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
    this.flames = buildQuads(gl, spots.map((s) => ({ p: s.p, size: s.size, seed: rnd() })));
    const puffItems: { p: V3; size: number; seed: number }[] = [];
    for (const s of spots) {
      if (s.size < 2) continue;
      for (let i = 0; i < 2; i++) {
        puffItems.push({ p: [s.p[0] + rnd() * 2 - 1, s.p[1] + s.size, s.p[2] + rnd() * 2 - 1], size: 2.4 + rnd() * 2.6, seed: rnd() });
      }
    }
    this.puffs = buildQuads(gl, puffItems);
    this.quad = buildQuads(gl, [{ p: [0, 0, 0], size: 1, seed: 0 }]);
  }

  private bind(p: Program, q: { buf: WebGLBuffer }) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, q.buf);
    for (let i = 0; i < 6; i++) gl.disableVertexAttribArray(i);
    const pos = gl.getAttribLocation(p.handle, "aPos");
    const dat = gl.getAttribLocation(p.handle, "aData");
    if (pos >= 0) {
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 28, 0);
    }
    gl.enableVertexAttribArray(dat);
    gl.vertexAttribPointer(dat, 4, gl.FLOAT, false, 28, 12);
  }

  private axes(cam: Camera, p: Program) {
    const v = cam.view;
    this.gl.uniform3f(p.u.uRight, v[0], v[4], v[8]);
    this.gl.uniform3f(p.u.uUp, v[1], v[5], v[9]);
  }

  /** Drawn behind the town. */
  drawMoon(vp: Mat4, cam: Camera, center: V3, radius: number) {
    const gl = this.gl;
    const p = this.moon;
    gl.useProgram(p.handle);
    gl.uniformMatrix4fv(p.u.uViewProj, false, vp);
    this.axes(cam, p);
    gl.uniform3fv(p.u.uCenter, center);
    gl.uniform1f(p.u.uRadius, radius);
    gl.uniform3fv(p.u.uColor, rgb(this.colors.moon));
    gl.uniform3fv(p.u.uCrater, rgb(this.colors.crater));
    this.bind(p, this.quad);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, this.quad.count);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
  }

  /** Drawn after the town. Time is stepped, so flames hold each pose for a few frames. */
  draw(vp: Mat4, cam: Camera, time: number) {
    const gl = this.gl;
    const stepped = Math.floor(time * 8) / 8;
    gl.disable(gl.CULL_FACE);

    const s = this.smoke;
    gl.useProgram(s.handle);
    gl.uniformMatrix4fv(s.u.uViewProj, false, vp);
    this.axes(cam, s);
    gl.uniform1f(s.u.uTime, stepped);
    gl.uniform1f(s.u.uRise, 34);
    gl.uniform3fv(s.u.uDark, rgb(this.colors.smokeDark));
    gl.uniform3fv(s.u.uLight, rgb(this.colors.smokeLight));
    this.bind(s, this.puffs);
    gl.drawArrays(gl.TRIANGLES, 0, this.puffs.count);

    const f = this.flame;
    gl.useProgram(f.handle);
    gl.uniformMatrix4fv(f.u.uViewProj, false, vp);
    this.axes(cam, f);
    gl.uniform1f(f.u.uTime, stepped);
    gl.uniform1f(f.u.uRise, 0);
    gl.uniform3fv(f.u.uOuter, rgb(this.colors.outer));
    gl.uniform3fv(f.u.uMid, rgb(this.colors.mid));
    gl.uniform3fv(f.u.uInner, rgb(this.colors.inner));
    this.bind(f, this.flames);
    gl.drawArrays(gl.TRIANGLES, 0, this.flames.count);

    gl.enable(gl.CULL_FACE);
    void norm;
  }
}
