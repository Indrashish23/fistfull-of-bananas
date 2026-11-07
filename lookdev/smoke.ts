// Dithered comic smoke, and flat full-screen backdrops, for the intro. Each puff is a billboard whose
// shape comes from domain-warped noise, so it flows rather than just scaling up. It decays by alpha
// erosion: the noise eats it away from its thin parts. Edges are ordered (Bayer) dither, which needs no
// blending or sorting, so it stays cheap on a TV. The noise is baked into one texture up front.

import { createProgram } from "./gl";
import type { Mat4, Program, V3 } from "./gl";
import type { Camera } from "./renderer";

const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

const PUFF_VS = `
attribute vec2 aCorner;
uniform mat4 uViewProj;
uniform vec3 uCenter;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = aCorner;
  gl_Position = uViewProj * vec4(uCenter + (uRight * aCorner.x + uUp * aCorner.y) * uSize, 1.0);
}
`;

const PUFF_FS = `${PRECISION}
uniform sampler2D uNoise;
uniform float uTime;
uniform float uSeed;
uniform float uErode;
uniform float uCell;
uniform vec3 uLight;
uniform vec3 uMid;
uniform vec3 uDark;
uniform vec3 uEdge;
varying vec2 vUv;
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
void main() {
  // Domain warp: two samples push the coordinate of a third, and the whole thing climbs.
  vec2 p = vUv * 0.36 + uSeed;
  vec2 rise = vec2(0.0, -uTime * 0.06);
  float a = texture2D(uNoise, p + rise).r;
  float b = texture2D(uNoise, p * 1.7 - rise + 3.1).g;
  float n = texture2D(uNoise, p * 1.3 + (vec2(a, b) - 0.5) * 0.6 + rise * 1.4).b;
  // A soft ball with a lumpy edge, eroded from its thin parts as it ages.
  float body = 1.0 - smoothstep(0.3, 1.0, length(vUv) + (n - 0.5) * 0.8);
  float density = body - uErode * (1.15 - n * 0.85);
  float d = bayer4(gl_FragCoord.xy / uCell);
  if (density <= 0.0 || density * 3.4 < d) discard;
  // A colour ramp in three flat bands, lit from up and to the left, with dithered steps between them.
  vec3 normal = normalize(vec3(vUv + (n - 0.5) * 0.95, 0.7));
  float tone = dot(normal, normalize(vec3(-0.45, 0.75, 0.5))) + (d - 0.5) * 0.3;
  vec3 c = tone > 0.5 ? uLight : tone > 0.08 ? uMid : uDark;
  // A thin inked line where the puff is about to give out.
  if (density < 0.022) c = uEdge;
  gl_FragColor = vec4(c, 1.0);
}
`;

const BACKDROP_VS = `
attribute vec2 aCorner;
uniform vec4 uPart;
varying vec2 vUv;
void main() {
  vUv = uPart.xy + (aCorner * 0.5 + 0.5) * uPart.zw;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

const BACKDROP_FS = `${PRECISION}
uniform sampler2D uImage;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(uImage, vUv).rgb, 1.0);
}
`;

const SIZE = 128;

/** Tiling multi-octave noise, one independent pattern per colour channel. */
function bakeNoise(): Uint8Array {
  let s = 1234;
  const rnd = () => ((s = (s * 16807) % 2147483647), s / 2147483647);
  const out = new Uint8Array(SIZE * SIZE * 4);
  for (let channel = 0; channel < 3; channel++) {
    const field = new Float32Array(SIZE * SIZE);
    let amp = 1;
    let total = 0;
    for (const cells of [4, 8, 16, 32]) {
      const grid = new Float32Array(cells * cells);
      for (let i = 0; i < grid.length; i++) grid[i] = rnd();
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const fx = (x / SIZE) * cells;
          const fy = (y / SIZE) * cells;
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const tx = fx - x0;
          const ty = fy - y0;
          const u = tx * tx * (3 - 2 * tx);
          const v = ty * ty * (3 - 2 * ty);
          const at = (i: number, j: number) => grid[(j % cells) * cells + (i % cells)];
          const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * u;
          const low = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * u;
          field[y * SIZE + x] += (top + (low - top) * v) * amp;
        }
      }
      total += amp;
      amp *= 0.5;
    }
    for (let i = 0; i < field.length; i++) out[i * 4 + channel] = Math.round((field[i] / total) * 255);
  }
  for (let i = 0; i < SIZE * SIZE; i++) out[i * 4 + 3] = 255;
  return out;
}

export interface Puff {
  p: V3;
  size: number;
  seed: number;
  /** 0 is whole, and around 1 is eaten away. */
  erode: number;
}

export interface SmokeColors {
  light: [number, number, number];
  mid: [number, number, number];
  dark: [number, number, number];
  edge: [number, number, number];
}

export class DitherSmoke {
  private puff: Program;
  private backdrop: Program;
  private quad: WebGLBuffer;
  private noise: WebGLTexture;

  constructor(private gl: WebGLRenderingContext) {
    this.puff = createProgram(gl, PUFF_VS, PUFF_FS);
    this.backdrop = createProgram(gl, BACKDROP_VS, BACKDROP_FS);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    this.noise = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.noise);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIZE, SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, bakeNoise());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  private bindQuad(p: Program) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    for (let i = 0; i < 6; i++) gl.disableVertexAttribArray(i);
    const at = gl.getAttribLocation(p.handle, "aCorner");
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 8, 0);
  }

  /** Uploads a canvas as a backdrop. Pass an earlier texture to refresh it instead of making another. */
  texture(canvas: HTMLCanvasElement, reuse?: WebGLTexture): WebGLTexture {
    const gl = this.gl;
    const t = reuse ?? gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Fills the viewport with a backdrop, behind everything. part picks a piece of it: u, v, width, height. */
  drawBackdrop(t: WebGLTexture, part: [number, number, number, number] = [0, 0, 1, 1]) {
    const gl = this.gl;
    const p = this.backdrop;
    gl.useProgram(p.handle);
    this.bindQuad(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(p.u.uImage, 0);
    gl.uniform4f(p.u.uPart, part[0], part[1], part[2], part[3]);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    const culled = gl.isEnabled(gl.CULL_FACE);
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (culled) gl.enable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  draw(vp: Mat4, cam: Camera, puffs: Puff[], time: number, cell: number, colors: SmokeColors) {
    const gl = this.gl;
    const p = this.puff;
    gl.useProgram(p.handle);
    this.bindQuad(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.noise);
    gl.uniform1i(p.u.uNoise, 0);
    gl.uniformMatrix4fv(p.u.uViewProj, false, vp);
    const v = cam.view;
    gl.uniform3f(p.u.uRight, v[0], v[4], v[8]);
    gl.uniform3f(p.u.uUp, v[1], v[5], v[9]);
    gl.uniform1f(p.u.uTime, time);
    gl.uniform1f(p.u.uCell, cell);
    gl.uniform3fv(p.u.uLight, colors.light);
    gl.uniform3fv(p.u.uMid, colors.mid);
    gl.uniform3fv(p.u.uDark, colors.dark);
    gl.uniform3fv(p.u.uEdge, colors.edge);
    const culled = gl.isEnabled(gl.CULL_FACE);
    gl.disable(gl.CULL_FACE);
    for (const q of puffs) {
      if (q.erode >= 1.1) continue;
      gl.uniform3fv(p.u.uCenter, q.p);
      gl.uniform1f(p.u.uSize, q.size);
      gl.uniform1f(p.u.uSeed, q.seed);
      gl.uniform1f(p.u.uErode, q.erode);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    if (culled) gl.enable(gl.CULL_FACE);
  }
}
