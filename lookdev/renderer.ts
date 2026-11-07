// The renderer. Per frame: sky, the town split by material, moving things with planar shadows,
// glow cards, dust, effects, one additive sun wash and the held pistol. The shadow map is baked
// once per look because the town never moves, so it costs a texture read and nothing else.

import { DIRECTIONS } from "./directions";
import type { Direction } from "./directions";
import { createProgram, identity, invert, lookAt, multiply, norm, ortho, transformPoint, translation } from "./gl";
import type { Mat4, Program, V3 } from "./gl";
import { cellOffset, CELL_SIZE } from "./faces";
import { SKIN_VERTEX_BYTES } from "./gltf";
import { bake, hex, MeshBuilder, mul, VERTEX_BYTES } from "./mesh";
import type { Mat, MeshPart, RGB } from "./mesh";
import { streetOffset } from "./kit";
import {
  DEPTH_FS,
  DEPTH_VS,
  DUST_FS,
  DUST_VS,
  FACE_FS,
  FACE_VS,
  FOLIAGE_FS,
  FOLIAGE_VS,
  GROUND_FS,
  PLANAR_FS,
  PLANAR_SKIN_VS,
  PLANAR_VS,
  TOON_FS,
  TOON_SKIN_VS,
  TOON_VS,
  SKY_FS,
  SKY_VS,
  WASH_FS,
  WASH_VS,
  WORLD_FS,
  WORLD_VS,
} from "./shaders";
import { FLAT, foliage, SPLAT, splatMap, textureSet } from "./tex";
import type { MaterialMode, PixelTex } from "./tex";
import { buildTown, CLOUD_SPAN } from "./town";
import { Wind } from "./wind";

/** Golden Standoff, the town at sundown: the walk to the bank passes through its light and its plum sky. */
const SUNDOWN = DIRECTIONS.find((d) => d.id === "golden")!;
/** How far from day to night is the height of sundown. */
export const SUNDOWN_AT = 0.6;
const NIGHT_ZENITH = "#332A6B";
const NIGHT_MID = "#733A80";
const NIGHT_HORIZON = "#D9526B";

const blendRGB = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const easeStep = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** The light for this time of day: the look's own at 0, Golden Standoff's from sundown on. Night adds to that in the final pass. */
function lightAt(dir: Direction, night: number) {
  const k = easeStep(night / SUNDOWN_AT);
  const a = dir.light;
  const b = SUNDOWN.light;
  const scaled = (pick: (l: Direction["light"]) => string, gain: (l: Direction["light"]) => number) =>
    blendRGB(mul(hex(pick(a)), gain(a)), mul(hex(pick(b)), gain(b)), k);
  return {
    sun: scaled((l) => l.sun, (l) => l.sunGain),
    ambSky: scaled((l) => l.ambientSky, (l) => l.ambientGain),
    ambGround: scaled((l) => l.ambientGround, (l) => l.ambientGain),
    fog: blendRGB(hex(dir.palette.fog), hex(SUNDOWN.palette.fog), k),
    charLight: blendRGB(hex(a.charLight), hex(b.charLight), k),
    charShade: blendRGB(hex(a.charShade), hex(b.charShade), k),
    charRim: blendRGB(hex(a.charRim), hex(b.charRim), k),
  };
}

/** Casters inside this box get baked shadows. Big enough for the whole town and its skyline. */
const SHADOW_BOUNDS = { x0: -44, x1: 76, y0: 0, y1: 30, z0: -128, z1: 62 };
const SHADOW_SIZE = 2048;

export interface GpuMesh {
  buffer: WebGLBuffer;
  count: number;
  parts: MeshPart[];
  /** Uses the 28-byte skinned layout: position, normal, colour, joints, weights. */
  skinned?: boolean;
}

export interface LookState {
  dir: Direction;
  town: GpuMesh;
  shadowTex: WebGLTexture;
  shadowM: Mat4;
  L: V3;
  triangles: number;
}

export interface Camera {
  eye: V3;
  view: Mat4;
  proj: Mat4;
}

export interface MovingThing {
  mesh: GpuMesh;
  model: Mat4;
  character: boolean;
  shadow: boolean;
  /** Bone matrices, for skinned characters. */
  bones?: Float32Array;
  /** Rigid object that belongs with a character, like a sign: shaded to match it. */
  toon?: boolean;
  /** Height of the floor under this thing, for its flat shadow. */
  groundY?: number;
  /** Flat vector face drawn on top of this thing. */
  face?: FaceDraw;
  /** 0..1, how lit up this thing's marked letters are. */
  lit?: number;
  /** How far this thing is flashing toward white, for a hit. */
  flash?: number;
  /** Added to its colour, in proportion, channel by channel. Negative darkens, like charring. */
  tint?: readonly [number, number, number];
}

export interface FaceDraw {
  mesh: GpuMesh;
  /** Head bone, in world space. */
  model: Mat4;
  eye: string;
  mouth: string;
  skin: RGB;
  /** The atlas cell under the eyes and mouth. Monkeys have a skin plate; leave it out for that. */
  plate?: string;
}

export interface HeldPart {
  mesh: GpuMesh;
  /** In camera space. */
  model: Mat4;
  bones?: Float32Array;
  gloss?: number;
  /** Added to the muzzle flash's color on this part, so it can run hot. */
  glow?: readonly [number, number, number];
}

export interface HeldItem {
  parts: HeldPart[];
  proj: Mat4;
  flash: number;
}

export interface FrameOpts {
  gray: boolean;
  time: number;
  /** Draws effects after the world and before the sun wash. */
  fx?: (vp: Mat4, cam: Camera) => void;
  held?: HeldItem;
  /** Draws just after the held item, in its camera space and depth, like its muzzle flash. */
  afterHeld?: (proj: Mat4) => void;
  /** Flat-colour cinematic drawing. Leave unset for the normal look. */
  flatArt?: FlatArt;
  /** 0 is day and 1 is night, for the sky. The rest of the picture gets its night in the final pass. */
  night?: number;
  /** How thick the air is, 0..1: haze, dust, drifting sand and the sun's wash. Below 1, characters get none at all. */
  air?: number;
}

export interface FlatArt {
  /** Distance fog snaps to this many solid layers. */
  fogSteps?: number;
  /** Characters get one hard shadow shape instead of a soft ramp. */
  hardToon?: boolean;
  /** 0..1 how far characters are shaded by their flat facets, rather than smoothly. */
  facet?: number;
  /** Draws that shadow as comic-book dots instead, with cells this many pixels across. */
  halftone?: number;
  /** Or as an ordered dither, with cells this many pixels across. */
  dither?: number;
  /** Or no shadow at all: every surface just shows its flat colour. */
  flat?: boolean;
  /** Draws just after the bare colour field, behind the characters. */
  under?: () => void;
  /** Draws every character as one solid colour. */
  silhouette?: RGB;
  /** Prints characters like a comic: flat colours, a dithered shadow, and an ink contour. */
  ink?: {
    /** Where the shadow starts, in dot(normal, key): higher means more shadow. */
    cut: number;
    /** Dither cell in pixels. */
    cell: number;
    /** The dot(normal, view) below which a surface is contour line. */
    contour: number;
    dark: RGB;
    /** The key light, as amounts of the camera's right, up and back. */
    key: [number, number, number];
  };
  /** Skips the world and clears to a solid colour field behind the characters. */
  bare?: RGB;
  /** Draws in front of the sky and behind the town, such as a moon. */
  backdrop?: (vp: Mat4, cam: Camera) => void;
}

const ATTRS = [
  { name: "aPos", size: 3, type: "float", offset: 0 },
  { name: "aNormal", size: 4, type: "byte", offset: 12 },
  { name: "aColor", size: 4, type: "ubyte", offset: 16 },
  { name: "aUv", size: 2, type: "float", offset: 20 },
] as const;

export class Renderer {
  gl: WebGLRenderingContext;
  drawCalls = 0;
  private world: Program;
  private face: Program;
  private faceTex: WebGLTexture | null = null;
  private toon: Program;
  private toonSkin: Program;
  private foliage: Program;
  private ground: Program;
  private depth: Program;
  private planar: Program;
  private planarSkin: Program;
  private sky: Program;
  /** How far into the night this frame is, and how thick the air is. */
  private night = 0;
  private air = 1;
  private wash: Program;
  private dust: Program;
  private fsTri: WebGLBuffer;
  private dustBuf: WebGLBuffer;
  private dustCount = 140;
  private looks = new Map<string, LookState>();
  private fogSteps = 0;
  private wind: Wind;
  /** Multiplies every look's wind. 0 turns all of it off, for a performance comparison. */
  windScale = 1;
  private tex: Record<string, WebGLTexture> = {};
  private modes = new Map<MaterialMode, Record<string, WebGLTexture>>();
  private aniso: EXT_texture_filter_anisotropic | null;
  mode: MaterialMode = "painted";

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      stencil: true,
      depth: true,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL is not available");
    this.gl = gl;
    this.aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    gl.getExtension("OES_standard_derivatives");
    this.world = createProgram(gl, WORLD_VS, WORLD_FS);
    this.face = createProgram(gl, FACE_VS, FACE_FS);
    this.toon = createProgram(gl, TOON_VS, TOON_FS);
    this.toonSkin = createProgram(gl, TOON_SKIN_VS, TOON_FS);
    this.foliage = createProgram(gl, FOLIAGE_VS, FOLIAGE_FS);
    this.ground = createProgram(gl, WORLD_VS, GROUND_FS);
    this.depth = createProgram(gl, DEPTH_VS, DEPTH_FS);
    this.planar = createProgram(gl, PLANAR_VS, PLANAR_FS);
    this.planarSkin = createProgram(gl, PLANAR_SKIN_VS, PLANAR_FS);
    this.sky = createProgram(gl, SKY_VS, SKY_FS);
    this.wash = createProgram(gl, WASH_VS, WASH_FS);
    this.dust = createProgram(gl, DUST_VS, DUST_FS);

    this.fsTri = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fsTri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const seeds = new Float32Array(this.dustCount * 3);
    let seed = 3;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    this.dustBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dustBuf);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clearStencil(0);

    this.wind = new Wind(gl);
    this.tex.flat = this.upload(FLAT(), true);
    this.tex.foliage = this.upload(foliage(), true);
    this.tex.splat = this.upload(splatMap(streetOffset), false);
    this.setMode("painted");
  }

  upload(t: PixelTex, repeat: boolean): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, t.size, t.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, t.data);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    return tex;
  }

  setMode(mode: MaterialMode) {
    this.mode = mode;
    let set = this.modes.get(mode);
    if (!set) {
      const t = textureSet(mode);
      set = {
        wood: this.upload(t.wood, true),
        rock: this.upload(t.rock, true),
        sand: this.upload(t.sand, true),
        dirt: this.upload(t.dirt, true),
      };
      this.modes.set(mode, set);
    }
    Object.assign(this.tex, set);
  }

  uploadMesh(...builders: MeshBuilder[]): GpuMesh {
    const gl = this.gl;
    const baked = bake(...builders);
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, baked.data, gl.STATIC_DRAW);
    return { buffer, count: baked.vertexCount, parts: baked.parts };
  }

  /** Stores the face atlas premultiplied, which is what keeps its edges free of dark fringes. */
  setFaceAtlas(canvas: HTMLCanvasElement) {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    this.faceTex = tex;
  }

  uploadSkinned(data: ArrayBuffer, count: number): GpuMesh {
    const gl = this.gl;
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buffer, count, parts: [{ group: 0, mat: "plain", first: 0, count }], skinned: true };
  }

  private bindSkinned(prog: Program, mesh: GpuMesh) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    for (let i = 0; i < 6; i++) gl.disableVertexAttribArray(i);
    const attrs: [string, number, number, boolean, number][] = [
      ["aPos", 3, gl.FLOAT, false, 0],
      ["aNormal", 4, gl.BYTE, true, 12],
      ["aColor", 4, gl.UNSIGNED_BYTE, true, 16],
      ["aJoints", 4, gl.UNSIGNED_BYTE, false, 20],
      ["aWeights", 4, gl.UNSIGNED_BYTE, true, 24],
    ];
    for (const [name, size, type, normalized, offset] of attrs) {
      const loc = gl.getAttribLocation(prog.handle, name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, normalized, SKIN_VERTEX_BYTES, offset);
    }
  }

  /** Binds a mesh's buffer to whichever attributes the program actually uses. */
  private bindMesh(prog: Program, mesh: GpuMesh) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    for (let i = 0; i < 6; i++) gl.disableVertexAttribArray(i);
    for (const a of ATTRS) {
      const loc = gl.getAttribLocation(prog.handle, a.name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      const type = a.type === "float" ? gl.FLOAT : a.type === "byte" ? gl.BYTE : gl.UNSIGNED_BYTE;
      gl.vertexAttribPointer(loc, a.size, type, a.type !== "float", VERTEX_BYTES, a.offset);
    }
  }

  private bindFsTri(prog: Program) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fsTri);
    for (let i = 0; i < 6; i++) gl.disableVertexAttribArray(i);
    const loc = gl.getAttribLocation(prog.handle, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  look(dir: Direction): LookState {
    const hit = this.looks.get(dir.id);
    if (hit) return hit;
    const town = buildTown(dir);
    const mesh = this.uploadMesh(town.casters, town.receivers, town.foliage, town.glow, town.cloudsFar, town.cloudsNear);
    const az = (dir.light.azimuth * Math.PI) / 180;
    const el = (dir.light.elevation * Math.PI) / 180;
    const L = norm([Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]);
    const { tex, matrix } = this.bakeShadow(mesh, L);
    const state: LookState = { dir, town: mesh, shadowTex: tex, shadowM: matrix, L, triangles: mesh.count / 3 };
    this.looks.set(dir.id, state);
    return state;
  }

  private bakeShadow(mesh: GpuMesh, L: V3) {
    const gl = this.gl;
    const size = Math.min(SHADOW_SIZE, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const rb = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);

    const B = SHADOW_BOUNDS;
    const c: V3 = [(B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2, (B.z0 + B.z1) / 2];
    const lightEye: V3 = [c[0] + L[0] * 300, c[1] + L[1] * 300, c[2] + L[2] * 300];
    const lv = lookAt(lightEye, c);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const x of [B.x0, B.x1]) {
      for (const y of [B.y0, B.y1]) {
        for (const z of [B.z0, B.z1]) {
          const p = transformPoint(lv, [x, y, z]);
          x0 = Math.min(x0, p[0]);
          x1 = Math.max(x1, p[0]);
          y0 = Math.min(y0, p[1]);
          y1 = Math.max(y1, p[1]);
          z0 = Math.min(z0, p[2]);
          z1 = Math.max(z1, p[2]);
        }
      }
    }
    const clip = multiply(ortho(x0, x1, y0, y1, -z1 - 1, -z0 + 1), lv);

    gl.viewport(0, 0, size, size);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.depth.handle);
    gl.uniformMatrix4fv(this.depth.u.uShadowClip, false, clip);
    this.bindMesh(this.depth, mesh);
    for (const p of mesh.parts) {
      if (p.group === 0) gl.drawArrays(gl.TRIANGLES, p.first, p.count);
    }
    gl.enable(gl.CULL_FACE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteRenderbuffer(rb);

    // Clip space to the 0..1 range used to sample the map.
    const bias = identity();
    bias[0] = bias[5] = bias[10] = 0.5;
    bias[12] = bias[13] = bias[14] = 0.5;
    return { tex, matrix: multiply(bias, clip) };
  }

  private bind(unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | undefined) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (loc) gl.uniform1i(loc, unit);
  }

  private setLit(prog: Program, s: LookState, eye: V3, vp: Mat4, gray: boolean) {
    const gl = this.gl;
    const u = prog.u;
    const l = s.dir.light;
    const now = lightAt(s.dir, this.night);
    gl.useProgram(prog.handle);
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    gl.uniformMatrix4fv(u.uModel, false, identity());
    gl.uniformMatrix4fv(u.uShadowM, false, s.shadowM);
    gl.uniform3fv(u.uCam, eye);
    gl.uniform3fv(u.uL, s.L);
    gl.uniform3fv(u.uSun, now.sun);
    gl.uniform3fv(u.uAmbSky, now.ambSky);
    gl.uniform3fv(u.uAmbGround, now.ambGround);
    gl.uniform3fv(u.uUnlit, [1, 1, 1]);
    gl.uniform1f(u.uSunCurve, l.sunCurve);
    gl.uniform1f(u.uBands, l.bands);
    gl.uniform1f(u.uFogD, l.fogDensity * this.air);
    gl.uniform1f(u.uFogMax, l.fogMax * this.air);
    gl.uniform3fv(u.uFog, now.fog);
    gl.uniform1f(u.uGray, gray ? 1 : 0);
    gl.uniform1f(u.uTexel, 1 / SHADOW_SIZE);
    gl.uniform1f(u.uFogSteps, this.fogSteps);
    gl.uniform3fv(u.uFill, [0, 0, 0]);
    gl.uniform3fv(u.uFillDir, [0, 0, 1]);
    gl.uniform1f(u.uSpec, 0);
    this.bind(0, s.shadowTex, u.uShadow);
  }

  /** Key is a soft light from beside the camera, so characters stay flattering whatever the sun does. */
  private setToon(prog: Program, s: LookState, eye: V3, vp: Mat4, key: V3, sunDir: V3, gray: boolean, fog: number) {
    const gl = this.gl;
    const u = prog.u;
    const l = s.dir.light;
    const now = lightAt(s.dir, this.night);
    gl.useProgram(prog.handle);
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    gl.uniform3fv(u.uCam, eye);
    gl.uniform1f(u.uFogD, l.fogDensity);
    gl.uniform1f(u.uFogMax, fog);
    gl.uniform3fv(u.uFog, now.fog);
    gl.uniform3fv(u.uKey, key);
    gl.uniform3fv(u.uSunDir, sunDir);
    gl.uniform3fv(u.uLight, now.charLight);
    gl.uniform3fv(u.uShade, now.charShade);
    gl.uniform3fv(u.uRim, now.charRim);
    gl.uniform3fv(u.uFlash, [0, 0, 0]);
    gl.uniform1f(u.uGloss, 0);
    gl.uniform1f(u.uGray, gray ? 1 : 0);
    gl.uniform1f(u.uLit, 0);
    gl.uniform1f(u.uIsSign, 0);
    gl.uniform1f(u.uHard, 0);
    gl.uniform1f(u.uFacet, 0);
    gl.uniform4f(u.uSil, 0, 0, 0, 0);
    gl.uniform4f(u.uInk, 0, 0, 0, 0);
  }

  private matTex(mat: Mat): WebGLTexture {
    if (mat === "wood") return this.tex.wood;
    if (mat === "rock") return this.tex.rock;
    return this.tex.flat;
  }

  private groundShadowMul(s: LookState): RGB {
    const l = s.dir.light;
    const ndl = Math.max(s.L[1], 0);
    let k = ndl ** l.sunCurve;
    if (l.bands > 0) k = Math.floor(k * l.bands + 0.5) / l.bands;
    const sun = mul(hex(l.sun), l.sunGain * k);
    const amb = mul(hex(l.ambientSky), l.ambientGain);
    return [amb[0] / (amb[0] + sun[0]), amb[1] / (amb[1] + sun[1]), amb[2] / (amb[2] + sun[2])];
  }

  /** viewport is [x, y, w, h] in canvas pixels, y measured from the bottom. */
  render(s: LookState, cam: Camera, viewport: [number, number, number, number], things: MovingThing[], o: FrameOpts) {
    const gl = this.gl;
    const dir = s.dir;
    const P = dir.palette;
    const [vx, vy, vw, vh] = viewport;
    this.night = o.night ?? 0;
    this.air = o.air ?? 1;
    gl.viewport(vx, vy, vw, vh);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(vx, vy, vw, vh);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    const vp = multiply(cam.proj, cam.view);
    const art = o.flatArt;
    const bare = art?.bare;
    this.fogSteps = art?.fogSteps ?? 0;
    if (bare) {
      gl.clearColor(bare[0], bare[1], bare[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      art?.under?.();
    }

    if (!bare) {
    // Sky.
    const camRot = cam.view.slice() as Mat4;
    camRot[12] = camRot[13] = camRot[14] = 0;
    const invVP = invert(multiply(cam.proj, camRot));
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.sky.handle);
    const su = this.sky.u;
    gl.uniformMatrix4fv(su.uInvVP, false, invVP);
    // Day, through Golden Standoff's plum and magenta sundown, and on into the night.
    const toSundown = easeStep(this.night / SUNDOWN_AT);
    const toNight = easeStep((this.night - SUNDOWN_AT) / (1 - SUNDOWN_AT));
    const skyAt = (day: string, sundown: string, dark: string) => blendRGB(blendRGB(hex(day), hex(sundown), toSundown), hex(dark), toNight);
    gl.uniform3fv(su.uZenith, skyAt(P.skyZenith, SUNDOWN.palette.skyZenith, NIGHT_ZENITH));
    gl.uniform3fv(su.uMid, skyAt(P.skyMid, SUNDOWN.palette.skyMid, NIGHT_MID));
    gl.uniform3fv(su.uHorizon, skyAt(P.skyHorizon, SUNDOWN.palette.skyHorizon, NIGHT_HORIZON));
    gl.uniform1f(su.uNight, toNight);
    gl.uniform3fv(su.uSunDisc, blendRGB(hex(P.sunDisc), hex(SUNDOWN.palette.sunDisc), toSundown));
    gl.uniform3fv(su.uSunGlow, blendRGB(hex(P.sunGlow), hex(SUNDOWN.palette.sunGlow), toSundown));
    gl.uniform3fv(su.uL, s.L);
    const rad = Math.PI / 180;
    gl.uniform4f(
      su.uStops,
      Math.sin((dir.sky.midAt + (SUNDOWN.sky.midAt - dir.sky.midAt) * toSundown) * rad),
      Math.sin((dir.sky.zenithAt + (SUNDOWN.sky.zenithAt - dir.sky.zenithAt) * toSundown) * rad),
      Math.cos(dir.sky.sunSize * rad),
      Math.cos(dir.sky.glowSize * rad),
    );
    gl.uniform1f(su.uGlowGain, (dir.sky.glowGain + (SUNDOWN.sky.glowGain - dir.sky.glowGain) * toSundown) * (1 - toNight));
    gl.uniform1f(su.uBands, dir.sky.bands);
    gl.uniform1f(su.uGray, o.gray ? 1 : 0);
    this.bindFsTri(this.sky);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawCalls++;

    // Clouds: two layers drifting at different speeds, each drawn twice so it wraps seamlessly.
    this.setLit(this.world, s, cam.eye, vp, o.gray);
    gl.enable(gl.CULL_FACE);
    this.bind(1, this.tex.flat, this.world.u.uDetail);
    this.bindMesh(this.world, s.town);
    // Clouds carry their own paint, so they're tinted: Golden Standoff's pink at sundown, plum in the dark.
    gl.uniform3fv(this.world.u.uUnlit, blendRGB(blendRGB([1, 1, 1], hex(SUNDOWN.palette.cloud), toSundown), [0.5, 0.36, 0.62], toNight));
    for (const p of s.town.parts) {
      if (p.group < 4) continue;
      const speed = p.group === 4 ? 6 : 11;
      const x = ((o.time * speed) % CLOUD_SPAN) - CLOUD_SPAN;
      for (const shift of [0, CLOUD_SPAN]) {
        gl.uniformMatrix4fv(this.world.u.uModel, false, translation(x + shift, 0, 0));
        gl.drawArrays(gl.TRIANGLES, p.first, p.count);
        this.drawCalls++;
      }
    }
    gl.uniformMatrix4fv(this.world.u.uModel, false, identity());
    gl.uniform3fv(this.world.u.uUnlit, [1, 1, 1]);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);

    if (art?.backdrop) {
      art.backdrop(vp, cam);
      this.setLit(this.world, s, cam.eye, vp, o.gray);
      this.bindMesh(this.world, s.town);
    }

    // The static town: one draw per material. Ground and plant cards have their own shaders.
    for (const p of s.town.parts) {
      if (p.group >= 3 || p.mat === "ground" || p.mat === "foliage") continue;
      this.bind(1, this.matTex(p.mat), this.world.u.uDetail);
      gl.drawArrays(gl.TRIANGLES, p.first, p.count);
      this.drawCalls++;
    }

    const groundPart = s.town.parts.find((p) => p.mat === "ground");
    if (groundPart) {
      this.setLit(this.ground, s, cam.eye, vp, o.gray);
      const u = this.ground.u;
      this.bind(1, this.tex.splat, u.uSplat);
      this.bind(2, this.tex.sand, u.uSand);
      this.bind(3, this.tex.dirt, u.uDirt);
      gl.uniform3fv(u.uSandCol, hex(P.sandPatch));
      gl.uniform3fv(u.uDirtCol, hex(P.street));
      gl.uniform3fv(u.uWearCol, hex(P.darkDirt));
      gl.uniform1f(u.uTime, o.time);
      gl.uniform1f(u.uWind, dir.kit.wind * this.windScale);
      gl.uniform4f(
        u.uSplatX,
        1 / (SPLAT.x1 - SPLAT.x0),
        1 / (SPLAT.z1 - SPLAT.z0),
        -SPLAT.x0 / (SPLAT.x1 - SPLAT.x0),
        -SPLAT.z0 / (SPLAT.z1 - SPLAT.z0),
      );
      this.bindMesh(this.ground, s.town);
      gl.drawArrays(gl.TRIANGLES, groundPart.first, groundPart.count);
      this.drawCalls++;
    }
    }

    // Moving things. Characters take the soft stylised shader; everything else matches the town.
    const v = cam.view;
    const right: V3 = [v[0], v[4], v[8]];
    const up: V3 = [v[1], v[5], v[9]];
    const back: V3 = [v[2], v[6], v[10]];
    const key = art?.ink?.key ?? [-0.5, 0.65, 0.7];
    const worldKey = norm([
      right[0] * key[0] + up[0] * key[1] + back[0] * key[2],
      right[1] * key[0] + up[1] * key[1] + back[1] * key[2],
      right[2] * key[0] + up[2] * key[1] + back[2] * key[2],
    ]);
    this.setLit(this.world, s, cam.eye, vp, o.gray);
    const charFog = art || this.air < 1 ? 0 : dir.light.fogMax;
    this.setToon(this.toon, s, cam.eye, vp, worldKey, s.L, o.gray, charFog);
    this.setToon(this.toonSkin, s, cam.eye, vp, worldKey, s.L, o.gray, charFog);
    if (art?.ink) {
      for (const prog of [this.toon, this.toonSkin]) {
        gl.useProgram(prog.handle);
        gl.uniform4f(prog.u.uInk, 1, art.ink.cut, art.ink.cell, art.ink.contour);
        gl.uniform3fv(prog.u.uInkDark, art.ink.dark);
      }
    }
    if (art?.hardToon || art?.silhouette) {
      for (const prog of [this.toon, this.toonSkin]) {
        gl.useProgram(prog.handle);
        gl.uniform1f(prog.u.uHard, art.flat ? 1.25 : art.dither ? -art.dither : art.halftone ?? (art.hardToon ? 1 : 0));
        gl.uniform1f(prog.u.uFacet, art.facet ?? 0);
        if (art.silhouette) gl.uniform4f(prog.u.uSil, art.silhouette[0], art.silhouette[1], art.silhouette[2], 1);
      }
    }
    for (const t of things) {
      const prog = t.bones ? this.toonSkin : t.toon ? this.toon : this.world;
      gl.useProgram(prog.handle);
      gl.uniformMatrix4fv(prog.u.uModel, false, t.model);
      const glow = t.flash ?? 0;
      gl.uniform3fv(prog.u.uFlash, t.tint ? [t.tint[0] + glow, t.tint[1] + glow, t.tint[2] + glow] : [glow, glow, glow]);
      if (prog === this.toon) {
        gl.uniform1f(prog.u.uLit, t.lit ?? 0);
        gl.uniform1f(prog.u.uIsSign, t.lit === undefined ? 0 : 1);
      }
      if (t.bones) {
        gl.uniformMatrix4fv(prog.u["uBones[0]"], false, t.bones);
        this.bind(1, this.tex.flat, prog.u.uDetail);
        this.bindSkinned(prog, t.mesh);
        gl.drawArrays(gl.TRIANGLES, 0, t.mesh.count);
        this.drawCalls++;
        continue;
      }
      this.bindMesh(prog, t.mesh);
      for (const p of t.mesh.parts) {
        this.bind(1, this.matTex(p.mat), prog.u.uDetail);
        gl.drawArrays(gl.TRIANGLES, p.first, p.count);
        this.drawCalls++;
      }
    }

    // Flat faces, on top of the heads they belong to.
    const faces = things.filter((t) => t.face);
    if (faces.length && this.faceTex && !art?.silhouette) {
      const fp = this.face;
      const u = fp.u;
      gl.useProgram(fp.handle);
      gl.uniformMatrix4fv(u.uViewProj, false, vp);
      gl.uniform3fv(u.uCam, cam.eye);
      gl.uniform1f(u.uFogD, dir.light.fogDensity);
      gl.uniform1f(u.uFogMax, charFog);
      const faceLight = lightAt(dir, this.night);
      gl.uniform3fv(u.uFog, faceLight.fog);
      gl.uniform3fv(u.uLight, faceLight.charLight);
      gl.uniform1f(u.uGray, o.gray ? 1 : 0);
      gl.uniform2fv(u.uCell, CELL_SIZE);
      gl.uniform3fv(u.uTongue, hex("#EE5A72"));
      gl.uniform3fv(u.uInk, hex("#1B100C"));
      this.bind(1, this.faceTex, u.uAtlas);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const t of faces) {
        const f = t.face!;
        gl.uniformMatrix4fv(u.uModel, false, f.model);
        gl.uniform2fv(u.uEye, cellOffset(f.eye));
        gl.uniform2fv(u.uMouth, cellOffset(f.mouth));
        gl.uniform2fv(u.uPlate, cellOffset(f.plate ?? "plate"));
        gl.uniform3fv(u.uSkin, f.skin);
        this.bindMesh(fp, f.mesh);
        gl.drawArrays(gl.TRIANGLES, 0, f.mesh.count);
        this.drawCalls++;
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // Plant cards, after the solid things.
    const fol = s.town.parts.find((p) => p.mat === "foliage");
    if (fol && !bare) {
      this.setLit(this.foliage, s, cam.eye, vp, o.gray);
      this.bind(1, this.tex.foliage, this.foliage.u.uDetail);
      gl.uniform1f(this.foliage.u.uTime, o.time);
      gl.uniform1f(this.foliage.u.uWind, this.windScale);
      this.bindMesh(this.foliage, s.town);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.drawArrays(gl.TRIANGLES, fol.first, fol.count);
      this.drawCalls++;
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.enable(gl.CULL_FACE);
    }

    // Flat shadows for moving things, once per pixel thanks to the stencil.
    const casters = things.filter((t) => t.shadow);
    if (casters.length && !bare) {
      const m = this.groundShadowMul(s);
      const mulCol: RGB = o.gray ? mul([1, 1, 1], (m[0] + m[1] + m[2]) / 3) : m;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.EQUAL, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
      for (const t of casters) {
        const prog = t.bones ? this.planarSkin : this.planar;
        gl.useProgram(prog.handle);
        gl.uniformMatrix4fv(prog.u.uViewProj, false, vp);
        gl.uniform3fv(prog.u.uL, s.L);
        gl.uniform3fv(prog.u.uMul, mulCol);
        gl.uniform1f(prog.u.uGroundY, t.groundY ?? 0);
        gl.uniformMatrix4fv(prog.u.uModel, false, t.model);
        if (t.bones) {
          gl.uniformMatrix4fv(prog.u["uBones[0]"], false, t.bones);
          this.bindSkinned(prog, t.mesh);
        } else {
          this.bindMesh(prog, t.mesh);
        }
        gl.drawArrays(gl.TRIANGLES, 0, t.mesh.count);
        this.drawCalls++;
      }
      gl.disable(gl.STENCIL_TEST);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
    }

    // Glow cards: additive, unlit, no depth writes.
    const glowPart = s.town.parts.find((p) => p.group === 3);
    if (glowPart && !bare && dir.kit.glow > 0) {
      this.setLit(this.world, s, cam.eye, vp, o.gray);
      this.bind(1, this.tex.flat, this.world.u.uDetail);
      gl.uniform1f(this.world.u.uFogMax, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      this.bindMesh(this.world, s.town);
      gl.drawArrays(gl.TRIANGLES, glowPart.first, glowPart.count);
      this.drawCalls++;
      gl.enable(gl.CULL_FACE);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // Dust motes.
    if (dir.kit.dust > 0 && !bare) {
      gl.useProgram(this.dust.handle);
      const du = this.dust.u;
      gl.uniformMatrix4fv(du.uViewProj, false, vp);
      gl.uniform1f(du.uTime, o.time);
      gl.uniform1f(du.uPx, 0.11 * vh);
      const col = hex(P.sandPatch);
      gl.uniform4f(du.uColor, col[0], col[1], col[2], 0.55 * dir.kit.dust * this.air);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dustBuf);
      for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i);
      const loc = gl.getAttribLocation(this.dust.handle, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, this.dustCount);
      this.drawCalls++;
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // Wind: sand veils and drawn gust lines, then shot effects on top.
    this.drawCalls += this.wind.draw(
      vp,
      o.time,
      this.tex.sand,
      hex(P.sandPatch),
      mul(blendRGB(hex(P.cloud), hex(SUNDOWN.palette.cloud), easeStep(this.night / SUNDOWN_AT)), 1 - easeStep((this.night - SUNDOWN_AT) / (1 - SUNDOWN_AT)) * 0.6),
      bare ? 0 : dir.kit.wind * this.windScale * this.air,
    );

    if (o.fx) o.fx(vp, cam);

    // Sun wash.
    if (dir.light.washGain > 0 && !bare && (o.night ?? 0) < 1) {
      const far: V3 = [cam.eye[0] + s.L[0] * 1000, cam.eye[1] + s.L[1] * 1000, cam.eye[2] + s.L[2] * 1000];
      const w = vp[3] * far[0] + vp[7] * far[1] + vp[11] * far[2] + vp[15];
      if (w > 0) {
        const p = transformPoint(vp, far);
        gl.useProgram(this.wash.handle);
        const wa = this.wash.u;
        gl.uniform2f(wa.uCenter, p[0], p[1]);
        const glow = mul(blendRGB(hex(P.sunGlow), hex(SUNDOWN.palette.sunGlow), easeStep(this.night / SUNDOWN_AT)), dir.light.washGain * this.air * (1 - easeStep((this.night - SUNDOWN_AT) / (1 - SUNDOWN_AT))));
        const luma = glow[0] * 0.299 + glow[1] * 0.587 + glow[2] * 0.114;
        gl.uniform3fv(wa.uColor, o.gray ? [luma, luma, luma] : glow);
        gl.uniform1f(wa.uRadius, dir.light.washRadius);
        gl.uniform1f(wa.uAspect, vw / vh);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        this.bindFsTri(this.wash);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.drawCalls++;
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.enable(gl.CULL_FACE);
        gl.disable(gl.BLEND);
      }
    }

    // Held arm and pistol: their own depth, in camera space, with the same soft shading.
    if (o.held) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const h = o.held;
      const toCam = (d: V3): V3 => norm([
        v[0] * d[0] + v[4] * d[1] + v[8] * d[2],
        v[1] * d[0] + v[5] * d[1] + v[9] * d[2],
        v[2] * d[0] + v[6] * d[1] + v[10] * d[2],
      ]);
      const key = norm([-0.45, 0.6, 0.75]);
      const sunView = toCam(s.L);
      const flash = mul(hex("#FF9A50"), h.flash * 0.9);
      for (const prog of [this.toon, this.toonSkin]) {
        this.setToon(prog, s, [0, 0, 0], h.proj, key, sunView, o.gray, 0);
        if (art?.hardToon) {
          gl.uniform1f(prog.u.uHard, 1);
          gl.uniform1f(prog.u.uFacet, art.facet ?? 0);
        }
        gl.uniform3fv(prog.u.uFlash, flash);
      }
      for (const part of h.parts) {
        const prog = part.bones ? this.toonSkin : this.toon;
        gl.useProgram(prog.handle);
        gl.uniformMatrix4fv(prog.u.uModel, false, part.model);
        const g = part.glow;
        gl.uniform3fv(prog.u.uFlash, g ? [flash[0] + g[0], flash[1] + g[1], flash[2] + g[2]] : flash);
        if (part.bones) {
          gl.uniformMatrix4fv(prog.u["uBones[0]"], false, part.bones);
          gl.uniform1f(prog.u.uGloss, 0);
          this.bind(1, this.tex.flat, prog.u.uDetail);
          this.bindSkinned(prog, part.mesh);
          gl.drawArrays(gl.TRIANGLES, 0, part.mesh.count);
          this.drawCalls++;
          continue;
        }
        this.bindMesh(prog, part.mesh);
        for (const p of part.mesh.parts) {
          gl.uniform1f(prog.u.uGloss, p.mat === "plain" ? (part.gloss ?? 0.3) : 0.05);
          this.bind(1, this.matTex(p.mat), prog.u.uDetail);
          gl.drawArrays(gl.TRIANGLES, p.first, p.count);
          this.drawCalls++;
        }
      }
      o.afterHeld?.(h.proj);
    }
    gl.disable(gl.SCISSOR_TEST);
  }
}
