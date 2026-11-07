// The last pass of every frame. The picture so far is copied to a texture and redrawn through a fixed
// palette, with a very light ordered dither to soften the steps between colours. Each colour is looked up
// in a baked table, so a big palette costs no more than a small one. It also carries the combo's heat,
// impact frames and the fall of night.

import { createProgram } from "./gl";
import type { Program } from "./gl";

/** Everything the game's allowed to show: sky, sand and wood, lizard greens, fire, and a few neutrals. */
export const ARCADE_PALETTE: readonly string[] = [
  // Sky and cloud.
  "#2B6F8F", "#3F97AE", "#6BBCC4", "#A6DDD8", "#E9F2E2", "#FFFFFF",
  // Sand, wood and shadow, light to dark.
  "#F4D9A8", "#E8BE83", "#D69C62", "#B97A47", "#8F5A33", "#6B3F24", "#472917", "#2A180E", "#120A06",
  // Fire.
  "#6E1712", "#A8241C", "#D8201A", "#F2681A", "#FF8A1E", "#FFB02E", "#FFD35A", "#FFF0A8",
  // Lizards and plants.
  "#1F5C4A", "#2F8F6F", "#4DB38C", "#8BD6A8", "#5B7A33", "#8FA84A",
  "#176B24", "#23962F", "#3DBE3A", "#6FDB4A", "#C4F29A", "#1F7A4A", "#2F9E3A", "#6FCB32", "#A4D62E", "#D6F0B4",
  // Clothes and hats.
  "#2A2F5A", "#454F8C", "#3A2A3A", "#5A4756", "#F2C4B8", "#C98F86",
  "#1C2468", "#2F3DA8", "#3D4FC4", "#6F80E6", "#E06F24", "#FF8A3C",
  // Steel.
  "#26272C", "#3A3C42", "#55585F", "#7A7A80", "#A8A8AE", "#D8D8DC",
  // Sundown, from Golden Standoff: plum sky, magenta and violet shade, hot earth.
  "#2C2358", "#5B3FA8", "#7C5CA8", "#B83F6B", "#F4687A", "#7C2F6E", "#58243F", "#7C2F46", "#993D45", "#C85A42", "#FFA94D", "#EDAE6C", "#D88F52", "#A9603A",
  // Night: the same plum gone dark, with moonlit wood and walls.
  "#120E30", "#1C1548", "#2A2064", "#3C2F80", "#4A2A6E", "#6A3A7E",
  "#201A3A", "#332B52", "#4A4068", "#6C6082", "#8A7EA0", "#B4A8C8",
  "#17352F", "#245447", "#3A7A5C",
];

/** Cells along each side of the colour table. */
export const LUT_SIZE = 32;

const rgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** The nearest palette colour for this one, weighted the way eyes are: green counts most. */
export function nearestColor(r: number, g: number, b: number, palette: readonly (readonly [number, number, number])[]): readonly [number, number, number] {
  let best = palette[0]!;
  let bestD = Infinity;
  for (const p of palette) {
    const dr = r - p[0];
    const dg = g - p[1];
    const db = b - p[2];
    const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Bakes the table: a strip of blue slices, each with red going across and green going down. */
export function buildPaletteLut(colors: readonly string[], size = LUT_SIZE): Uint8Array {
  const palette = colors.map(rgb);
  const data = new Uint8Array(size * size * size * 4);
  const step = 255 / (size - 1);
  let o = 0;
  for (let g = 0; g < size; g++) {
    for (let b = 0; b < size; b++) {
      for (let r = 0; r < size; r++) {
        const c = nearestColor(r * step, g * step, b * step, palette);
        data[o++] = c[0];
        data[o++] = c[1];
        data[o++] = c[2];
        data[o++] = 255;
      }
    }
  }
  return data;
}

const VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uScene;
uniform sampler2D uLut;
uniform float uHeat;
uniform float uImpact;
uniform float uNight;
varying vec2 vUv;
const vec3 INK = vec3(0.07, 0.04, 0.03);
const vec3 PAPER = vec3(1.0, 0.94, 0.78);
/** How far the dither nudges a colour, in all. Kept small, so it only shows where colours meet. */
const float DITHER = 0.04;
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
void main() {
  vec3 c = texture2D(uScene, vUv).rgb;
  float luma = dot(c, vec3(0.3, 0.59, 0.11));
  // An impact frame: the whole picture slammed down to two tones, for a moment.
  if (uImpact > 0.5) {
    gl_FragColor = vec4(luma > 0.46 ? PAPER : INK, 1.0);
    return;
  }
  // Night: everything goes moonlit violet, except what's giving off its own light. Fire, lit windows and gold
  // stay warm, and the stars and the moon stay white.
  if (uNight > 0.0) {
    float hi = max(c.r, max(c.g, c.b));
    float lo = min(c.r, min(c.g, c.b));
    float sat = hi > 0.0 ? (hi - lo) / hi : 0.0;
    float warm = smoothstep(0.5, 0.72, sat) * smoothstep(0.62, 0.88, hi) * step(c.g, c.r);
    float glow = max(warm, smoothstep(0.92, 0.99, lo));
    c = mix(c, c * vec3(0.56, 0.5, 0.86) + vec3(0.018, 0.012, 0.04), uNight * (1.0 - glow));
  }
  // The combo runs hot: richer colour, and a glow creeping in from the edges of the screen.
  c = mix(vec3(luma), c, 1.0 + uHeat * 0.5);
  vec2 p = vUv * 2.0 - 1.0;
  float edge = smoothstep(0.55, 1.35, length(p * vec2(1.0, 0.85)));
  c += edge * uHeat * vec3(0.42, 0.13, 0.0);
  c += (bayer4(gl_FragCoord.xy) - 0.5) * DITHER;
  vec3 s = floor(clamp(c, 0.0, 1.0) * 31.0 + 0.5);
  vec2 cell = vec2((s.b * 32.0 + s.r + 0.5) / 1024.0, (s.g + 0.5) / 32.0);
  gl_FragColor = vec4(texture2D(uLut, cell).rgb, 1.0);
}
`;

// Kept clear of the units the other passes use.
const UNIT_SCENE = 5;
const UNIT_LUT = 6;

export class PostPass {
  private readonly prog: Program;
  private readonly tri: WebGLBuffer;
  private readonly scene: WebGLTexture;
  private readonly lut: WebGLTexture;
  private sized = false;

  constructor(private readonly gl: WebGLRenderingContext) {
    this.prog = createProgram(gl, VS, FS);
    this.tri = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const texture = (unit: number): WebGLTexture => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.scene = texture(UNIT_SCENE);
    this.lut = texture(UNIT_LUT);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, LUT_SIZE * LUT_SIZE, LUT_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildPaletteLut(ARCADE_PALETTE));
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Runs over whatever's been drawn this frame. heat and night are 0..1, and impact shows an impact frame. */
  apply(heat: number, impact: boolean, night = 0): void {
    const { gl, prog } = this;
    const { drawingBufferWidth: w, drawingBufferHeight: h } = gl;
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    gl.depthMask(false);
    gl.viewport(0, 0, w, h);

    gl.activeTexture(gl.TEXTURE0 + UNIT_SCENE);
    gl.bindTexture(gl.TEXTURE_2D, this.scene);
    if (this.sized) gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
    else {
      gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, w, h, 0);
      this.sized = true;
    }
    gl.activeTexture(gl.TEXTURE0 + UNIT_LUT);
    gl.bindTexture(gl.TEXTURE_2D, this.lut);

    gl.useProgram(prog.handle);
    gl.uniform1i(prog.u.uScene!, UNIT_SCENE);
    gl.uniform1i(prog.u.uLut!, UNIT_LUT);
    gl.uniform1f(prog.u.uHeat!, heat);
    gl.uniform1f(prog.u.uImpact!, impact ? 1 : 0);
    gl.uniform1f(prog.u.uNight!, night);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tri);
    for (let i = 0; i < 6; i++) gl.disableVertexAttribArray(i);
    const pos = gl.getAttribLocation(prog.handle, "aPos");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(pos);

    gl.activeTexture(gl.TEXTURE0);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }
}
