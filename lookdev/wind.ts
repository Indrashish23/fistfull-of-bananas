// Stylised wind, in two pieces and two draws:
// - Ribbons: thin drawn gust lines that race along and curl at the head, cartoon-style.
// - Veils: low sheets of sand skimming the street, made from scrolling noise.
// The geometry never changes. Everything moves in the vertex and fragment shaders from one time
// uniform, so wind costs no CPU per frame.

import type { Mat4 } from "./gl";
import { createProgram } from "./gl";
import type { Program } from "./gl";
import type { RGB } from "./mesh";

const FS_PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

const RIBBON_VS = `
attribute vec3 aPos;
attribute vec2 aUv;
uniform mat4 uViewProj;
uniform float uTime;
varying float vA;
varying float vV;
float gSeed;
float gPh;
vec3 baseP;
vec3 P(float u) {
  float len = 8.0 + gSeed * 7.0;
  float x = mix(-36.0, 36.0, gPh) - (1.0 - u) * len;
  vec3 p = vec3(
    x,
    baseP.y + sin(u * 5.0 + uTime * 1.3 + gSeed * 20.0) * 0.32,
    baseP.z + cos(u * 3.0 + gSeed * 9.0 + uTime * 0.4) * 0.5);
  // The head of the gust winds up into a curl.
  float c = smoothstep(0.66, 1.0, u);
  float ang = c * 7.4;
  float r = (0.28 + gSeed * 0.42) * c;
  p.x += sin(ang) * r;
  p.y += (1.0 - cos(ang)) * r;
  return p;
}
void main() {
  gSeed = aPos.x;
  baseP = aPos;
  gPh = fract(uTime * (0.075 + 0.05 * fract(gSeed * 7.0)) + gSeed * 13.7);
  float u = aUv.x;
  vec3 p = P(u);
  vec3 t = P(u + 0.012) - P(u - 0.012);
  vec2 n = normalize(vec2(-t.y, t.x) + vec2(0.0001, 0.0));
  float w = 0.036 * (0.35 + sin(u * 3.14159));
  p.xy += n * aUv.y * w;
  vA = pow(sin(u * 3.14159), 0.7) * smoothstep(0.0, 0.08, gPh) * smoothstep(1.0, 0.9, gPh);
  vV = aUv.y;
  gl_Position = uViewProj * vec4(p, 1.0);
}
`;

const RIBBON_FS = `${FS_PRECISION}
uniform vec4 uColor;
varying float vA;
varying float vV;
void main() {
  float e = 1.0 - smoothstep(0.35, 1.0, abs(vV));
  gl_FragColor = vec4(uColor.rgb, 1.0) * uColor.a * e * vA;
}
`;

const VEIL_VS = `
attribute vec3 aPos;
attribute vec2 aUv;
uniform mat4 uViewProj;
varying vec2 vW;
varying float vH;
varying float vEdge;
void main() {
  vW = vec2(aPos.x + aPos.z * 3.7, aPos.z);
  vH = aUv.y;
  vEdge = aUv.x;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

const VEIL_FS = `${FS_PRECISION}
uniform sampler2D uSand;
uniform float uTime;
uniform vec4 uColor;
varying vec2 vW;
varying float vH;
varying float vEdge;
void main() {
  // Two noise layers running at different speeds; where they agree, a wisp of sand shows.
  float a = texture2D(uSand, vec2(vW.x * 0.028 - uTime * 0.17, vH * 0.34 + vW.y * 0.07)).a;
  float b = texture2D(uSand, vec2(vW.x * 0.012 - uTime * 0.075, vH * 0.12 + vW.y * 0.03)).a;
  float wisp = smoothstep(0.44, 0.66, a) * smoothstep(0.38, 0.6, b);
  float fall = (1.0 - vH) * (1.0 - vH);
  float rim = smoothstep(0.0, 0.12, vEdge) * smoothstep(1.0, 0.88, vEdge);
  gl_FragColor = vec4(uColor.rgb, 1.0) * uColor.a * wisp * fall * rim;
}
`;

const RIBBONS = 16;
const SEGMENTS = 36;
const VEIL_Z = [8.5, 3.5, -5, -20, -33];
const VEIL_H = 2.3;

export class Wind {
  private gl: WebGLRenderingContext;
  private ribbon: Program;
  private veil: Program;
  private ribbonBuf: WebGLBuffer;
  private ribbonCount: number;
  private veilBuf: WebGLBuffer;
  private veilCount: number;

  constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    this.ribbon = createProgram(gl, RIBBON_VS, RIBBON_FS);
    this.veil = createProgram(gl, VEIL_VS, VEIL_FS);

    let seed = 19;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const r: number[] = [];
    for (let i = 0; i < RIBBONS; i++) {
      const s = rnd();
      const y = 0.9 + rnd() * rnd() * 7;
      const z = 7 - rnd() * 42;
      for (let k = 0; k < SEGMENTS; k++) {
        const a = k / SEGMENTS;
        const b = (k + 1) / SEGMENTS;
        for (const [u, v] of [
          [a, -1],
          [b, -1],
          [b, 1],
          [a, -1],
          [b, 1],
          [a, 1],
        ]) {
          r.push(s, y, z, u, v);
        }
      }
    }
    this.ribbonCount = r.length / 5;
    this.ribbonBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(r), gl.STATIC_DRAW);

    const w: number[] = [];
    for (const z of VEIL_Z) {
      const x0 = -34;
      const x1 = 34;
      for (const [x, y, u, v] of [
        [x0, 0, 0, 0],
        [x1, 0, 1, 0],
        [x1, VEIL_H, 1, 1],
        [x0, 0, 0, 0],
        [x1, VEIL_H, 1, 1],
        [x0, VEIL_H, 0, 1],
      ]) {
        w.push(x, y, z, u, v);
      }
    }
    this.veilCount = w.length / 5;
    this.veilBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.veilBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(w), gl.STATIC_DRAW);
  }

  private attribs(p: Program, buf: WebGLBuffer) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i);
    const pos = gl.getAttribLocation(p.handle, "aPos");
    const uv = gl.getAttribLocation(p.handle, "aUv");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 20, 12);
  }

  /** Returns the number of draw calls. Colours are premultiplied by the shaders. */
  draw(vp: Mat4, time: number, sand: WebGLTexture, sandCol: RGB, lineCol: RGB, amount: number): number {
    if (amount <= 0) return 0;
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    gl.useProgram(this.veil.handle);
    gl.uniformMatrix4fv(this.veil.u.uViewProj, false, vp);
    gl.uniform1f(this.veil.u.uTime, time);
    gl.uniform4f(this.veil.u.uColor, sandCol[0], sandCol[1], sandCol[2], 0.62 * amount);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sand);
    gl.uniform1i(this.veil.u.uSand, 0);
    this.attribs(this.veil, this.veilBuf);
    gl.drawArrays(gl.TRIANGLES, 0, this.veilCount);

    gl.useProgram(this.ribbon.handle);
    gl.uniformMatrix4fv(this.ribbon.u.uViewProj, false, vp);
    gl.uniform1f(this.ribbon.u.uTime, time);
    gl.uniform4f(this.ribbon.u.uColor, lineCol[0], lineCol[1], lineCol[2], 0.72 * amount);
    this.attribs(this.ribbon, this.ribbonBuf);
    gl.drawArrays(gl.TRIANGLES, 0, this.ribbonCount);

    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    return 2;
  }
}
