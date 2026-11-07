// A small raw WebGL renderer: flat-shaded procedural meshes, stepped toon lighting,
// inverted-hull outlines, a sky and point particles. WebGL 1 on purpose, so it has the
// best chance of running on whatever a television ships.

import { multiply, type M4, type V3 } from "./mat";

const MESH_VS = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uVP;
uniform mat4 uM;
uniform float uOutline;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vec4 world = uM * vec4(aPos, 1.0);
  if (uOutline > 0.0) {
    world.xyz += normalize((uM * vec4(aPos, 0.0)).xyz) * uOutline;
  }
  vN = (uM * vec4(aNormal, 0.0)).xyz;
  vWorld = world.xyz;
  gl_Position = uVP * world;
}`;

const MESH_FS = `
precision mediump float;
varying vec3 vN;
varying vec3 vWorld;
uniform vec3 uColor;
uniform vec3 uEye;
uniform vec3 uSun;
uniform vec3 uFogColor;
uniform vec2 uFog;
uniform float uUnlit;
void main() {
  vec3 col = uColor;
  if (uUnlit < 0.5) {
    vec3 n = normalize(vN);
    float d = dot(n, uSun);
    float band = 0.58 + 0.27 * step(-0.05, d) + 0.25 * step(0.45, d);
    vec3 shade = mix(vec3(0.70, 0.62, 0.86), vec3(1.0, 0.95, 0.84), step(-0.05, d));
    float up = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    col *= band * shade * (0.9 + 0.12 * up);
  }
  float dist = distance(vWorld, uEye);
  float f = clamp((dist - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  gl_FragColor = vec4(mix(col, uFogColor, f), 1.0);
}`;

const SKY_VS = `
attribute vec2 aPos;
varying vec2 vPos;
void main() { vPos = aPos; gl_Position = vec4(aPos, 0.999, 1.0); }`;

const SKY_FS = `
precision mediump float;
varying vec2 vPos;
uniform float uHorizon;
uniform vec3 uSunPos;
uniform float uAspect;
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uLow;
uniform vec3 uSunCol;
void main() {
  float h = vPos.y - uHorizon;
  vec3 col = h < 0.0 ? uLow : mix(uLow, uMid, smoothstep(0.0, 0.35, h));
  col = mix(col, uTop, smoothstep(0.3, 1.5, h));
  float bands = floor(h * 15.0) / 15.0;
  col = mix(col, mix(uLow, uTop, clamp(bands * 0.8, 0.0, 1.0)), 0.18);
  if (uSunPos.z > 0.0) {
    vec2 d = (vPos - uSunPos.xy) * vec2(uAspect, 1.0);
    float r = length(d);
    col = mix(col, uSunCol, smoothstep(0.62, 0.0, r) * 0.32);
    col = mix(col, uSunCol, step(r, 0.14));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const POINT_VS = `
attribute vec3 aPos;
attribute vec4 aColor;
attribute float aSize;
uniform mat4 uVP;
uniform float uScale;
varying vec4 vColor;
void main() {
  gl_Position = uVP * vec4(aPos, 1.0);
  gl_PointSize = aSize * uScale / gl_Position.w;
  vColor = aColor;
}`;

const POINT_FS = `
precision mediump float;
varying vec4 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  gl_FragColor = vColor;
}`;

export interface Mesh {
  buffer: WebGLBuffer;
  count: number;
}

export interface Look {
  /** Where the sun appears in the sky. */
  sun: V3;
  /** The direction shading comes from, kept in front of faces so they stay readable. */
  light: V3;
  fogColor: V3;
  fog: [number, number];
  skyTop: V3;
  skyMid: V3;
  skyLow: V3;
  sunColor: V3;
}

export interface Camera {
  projection: M4;
  view: M4;
  eye: V3;
}

interface DrawOptions {
  unlit?: boolean;
  /** Outline thickness in world units. */
  outline?: number;
}

const OUTLINE_COLOR: V3 = [0.09, 0.05, 0.04];
const MAX_POINTS = 700;
const POINT_STRIDE = 8;

export class Renderer {
  readonly gl: WebGLRenderingContext;
  readonly mesh: WebGLProgram;
  private readonly u: Record<string, WebGLUniformLocation | null> = {};
  private readonly sky: WebGLProgram;
  private readonly skyU: Record<string, WebGLUniformLocation | null> = {};
  private readonly skyQuad: WebGLBuffer;
  private readonly points: WebGLProgram;
  private readonly pointU: Record<string, WebGLUniformLocation | null> = {};
  private readonly pointBuffer: WebGLBuffer;
  private readonly pointData = new Float32Array(MAX_POINTS * POINT_STRIDE);
  private readonly vp = new Float32Array(16);
  private bound: Mesh | null = null;
  /** The colour of inverted-hull outlines. The x-ray swaps this to make its glow. */
  outlineColor: V3 = OUTLINE_COLOR;
  drawCalls = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    // Shares the context the look renderer already made, so its options win.
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, stencil: true, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL is not available on this device.");
    this.gl = gl;

    this.mesh = link(gl, MESH_VS, MESH_FS);
    for (const n of ["uVP", "uM", "uOutline", "uColor", "uEye", "uSun", "uFogColor", "uFog", "uUnlit"]) {
      this.u[n] = gl.getUniformLocation(this.mesh, n);
    }
    this.sky = link(gl, SKY_VS, SKY_FS);
    for (const n of ["uHorizon", "uSunPos", "uAspect", "uTop", "uMid", "uLow", "uSunCol"]) {
      this.skyU[n] = gl.getUniformLocation(this.sky, n);
    }
    this.points = link(gl, POINT_VS, POINT_FS);
    for (const n of ["uVP", "uScale"]) this.pointU[n] = gl.getUniformLocation(this.points, n);

    this.skyQuad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyQuad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.pointBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.pointData.byteLength, gl.DYNAMIC_DRAW);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 1);
  }

  createMesh(positions: number[], normals: number[]): Mesh {
    const { gl } = this;
    const count = positions.length / 3;
    const data = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      data.set(positions.slice(i * 3, i * 3 + 3), i * 6);
      data.set(normals.slice(i * 3, i * 3 + 3), i * 6 + 3);
    }
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.bound = null;
    return { buffer, count };
  }

  /** Takes back the shared context's state, after the look renderer has had it. */
  begin(): void {
    const { gl, canvas } = this;
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    this.bound = null;
  }

  resetOutlineColor(): void {
    this.outlineColor = OUTLINE_COLOR;
  }

  /** Fills the screen with one colour, for scenes with no sky. */
  clearTo(r: number, g: number, b: number): void {
    const { gl } = this;
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.clearColor(0, 0, 0, 1);
  }

  clearDepth(): void {
    this.gl.clear(this.gl.DEPTH_BUFFER_BIT);
  }

  drawSky(camera: Camera, look: Look): void {
    const { gl } = this;
    multiply(this.vp, camera.projection, camera.view);
    const [ex, ey, ez] = camera.eye;
    // The horizon is where a far level point lands on screen, along the view direction.
    const fx = -camera.view[2]!;
    const fz = -camera.view[10]!;
    const len = Math.hypot(fx, fz) || 1;
    const far = project(this.vp, ex + (fx / len) * 4000, ey, ez + (fz / len) * 4000);
    const sun = project(this.vp, ex + look.sun[0] * 4000, ey + look.sun[1] * 4000, ez + look.sun[2] * 4000);

    gl.useProgram(this.sky);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyQuad);
    this.bound = null;
    const a = gl.getAttribLocation(this.sky, "aPos");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(this.skyU.uHorizon!, far[1]);
    gl.uniform3f(this.skyU.uSunPos!, sun[0], sun[1], sun[2] > 0 ? 1 : -1);
    gl.uniform1f(this.skyU.uAspect!, this.canvas.width / this.canvas.height);
    setVec3(gl, this.skyU.uTop!, look.skyTop);
    setVec3(gl, this.skyU.uMid!, look.skyMid);
    setVec3(gl, this.skyU.uLow!, look.skyLow);
    setVec3(gl, this.skyU.uSunCol!, look.sunColor);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    this.drawCalls += 1;
  }

  useCamera(camera: Camera, look: Look): void {
    const { gl } = this;
    multiply(this.vp, camera.projection, camera.view);
    gl.useProgram(this.mesh);
    this.bound = null;
    gl.uniformMatrix4fv(this.u.uVP!, false, this.vp);
    setVec3(gl, this.u.uEye!, camera.eye);
    setVec3(gl, this.u.uSun!, look.light);
    setVec3(gl, this.u.uFogColor!, look.fogColor);
    gl.uniform2f(this.u.uFog!, look.fog[0], look.fog[1]);
  }

  draw(mesh: Mesh, model: M4, color: V3, options: DrawOptions = {}): void {
    const { gl } = this;
    if (this.bound !== mesh) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
      const pos = gl.getAttribLocation(this.mesh, "aPos");
      const nor = gl.getAttribLocation(this.mesh, "aNormal");
      gl.enableVertexAttribArray(pos);
      gl.enableVertexAttribArray(nor);
      gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(nor, 3, gl.FLOAT, false, 24, 12);
      this.bound = mesh;
    }
    gl.uniformMatrix4fv(this.u.uM!, false, model);
    setVec3(gl, this.u.uColor!, color);
    gl.uniform1f(this.u.uUnlit!, options.unlit ? 1 : 0);
    gl.uniform1f(this.u.uOutline!, 0);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    this.drawCalls += 1;

    if (options.outline) {
      gl.cullFace(gl.FRONT);
      setVec3(gl, this.u.uColor!, this.outlineColor);
      gl.uniform1f(this.u.uUnlit!, 1);
      gl.uniform1f(this.u.uOutline!, options.outline);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      gl.cullFace(gl.BACK);
      this.drawCalls += 1;
    }
  }

  /** Draws `count` particles from packed x,y,z,r,g,b,a,size data. */
  drawPoints(camera: Camera, data: Float32Array, count: number): void {
    if (count === 0) return;
    const { gl } = this;
    multiply(this.vp, camera.projection, camera.view);
    gl.useProgram(this.points);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, Math.min(count, MAX_POINTS) * POINT_STRIDE));
    this.bound = null;
    const stride = POINT_STRIDE * 4;
    const pos = gl.getAttribLocation(this.points, "aPos");
    const col = gl.getAttribLocation(this.points, "aColor");
    const size = gl.getAttribLocation(this.points, "aSize");
    gl.enableVertexAttribArray(pos);
    gl.enableVertexAttribArray(col);
    gl.enableVertexAttribArray(size);
    gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribPointer(col, 4, gl.FLOAT, false, stride, 12);
    gl.vertexAttribPointer(size, 1, gl.FLOAT, false, stride, 28);
    gl.uniformMatrix4fv(this.pointU.uVP!, false, this.vp);
    gl.uniform1f(this.pointU.uScale!, this.canvas.height * camera.projection[5]! * 0.5);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(gl.POINTS, 0, Math.min(count, MAX_POINTS));
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(size);
    gl.disableVertexAttribArray(col);
    this.drawCalls += 1;
  }

  /** Lets callers confirm what the device gave us. */
  describe(): string {
    const { gl } = this;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return `${String(gl.getParameter(gl.VERSION))} / ${String(name)}`;
  }
}

function setVec3(gl: WebGLRenderingContext, location: WebGLUniformLocation, v: V3): void {
  gl.uniform3f(location, v[0], v[1], v[2]);
}

function project(vp: M4, x: number, y: number, z: number): [number, number, number] {
  const cx = vp[0]! * x + vp[4]! * y + vp[8]! * z + vp[12]!;
  const cy = vp[1]! * x + vp[5]! * y + vp[9]! * z + vp[13]!;
  const w = vp[3]! * x + vp[7]! * y + vp[11]! * z + vp[15]!;
  return [cx / (w || 1), cy / (w || 1), w];
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader failed: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function link(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

export { MAX_POINTS, POINT_STRIDE };
