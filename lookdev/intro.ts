// The opening, as a comic in flat colours with dithered shadow. Every picture is one frozen render of the
// real models, or one paper-cut picture, cut into a jagged panel. Nothing in a picture moves: the energy is
// in how panels land, one on each beat with a sound, and in the camera moves across them. The story: he
// enters a town people live in, the camera goes into the bank, it blows, Big Gat comes out with the lizard
// gang, his eyes, he doesn't run, and he cocks his gun with his own thumb.

import { BOSSES, bossFace, loadBoss } from "./bosses";
import type { BossInstance } from "./bosses";
import revolverObj from "./assets/revolvers/Revolver_1.obj?raw";
import { lizardBuffer, LIZARDS, monkeyPaint } from "./character";
import type { Outfit } from "./character";
import { DIRECTIONS } from "./directions";
import type { Direction } from "./directions";
import { buildLizardFaceSheet, lizardEye, lizardMouth } from "./faces";
import type { EyeCell, MouthCell } from "./faces";
import { identity, lookAt, multiply, perspective, rotationY, rotationZ, scaling, transformPoint, translation } from "./gl";
import type { Mat4, V3 } from "./gl";
import { readSkeleton, readSkinnedMesh, Rig } from "./gltf";
import type { ParsedGlb, Skeleton } from "./gltf";
import { buildRevolver } from "./gun";
import { PaperComic } from "./paper";
import { hex, MeshBuilder } from "./mesh";
import type { RGB } from "./mesh";
import { heldMatrix, loadPropBuilders } from "./props";
import type { PropName } from "./props";
import type { Camera, GpuMesh, LookState, MovingThing, Renderer } from "./renderer";

type Rect = [number, number, number, number];

const NEAR = 1;
const FAR = 3000;

/** The empty town at the end of the day, in a small flat palette. Dusty, sun-bleached, deserted. */
function ghostLook(): Direction {
  const base = DIRECTIONS.find((d) => d.id === "haze") ?? DIRECTIONS[0];
  const wall = ["#8A5B3E", "#7A4F36", "#99694A", "#6C4732"];
  const ink = "#3A241E";
  return {
    ...base,
    id: "ghost",
    name: "Ghost town",
    palette: {
      ...base.palette,
      skyZenith: "#2F7F99",
      skyMid: "#8CC4BE",
      skyHorizon: "#F7DFB2",
      sunDisc: "#FFF6DE",
      sunGlow: "#000000",
      fog: "#F0C794",
      street: "#D59A62",
      streetRut: "#C48A56",
      streetEdge: "#B97F4E",
      sandPatch: "#DDA56E",
      darkDirt: "#B97F4E",
      desert: "#D9A268",
      desertFar: "#E8BC88",
      mesaA: "#A85E45",
      mesaB: "#B66C4E",
      mesaC: "#96523E",
      mesaTop: "#C98560",
      wallSaloon: wall[1],
      wallSheriff: wall[0],
      wallStore: wall[2],
      wallBank: "#B79468",
      wallBarn: wall[1],
      wallA: wall[0],
      wallB: wall[3],
      wallC: wall[2],
      wallD: wall[1],
      church: "#C7A27C",
      trim: ink,
      trimDark: "#2C1A16",
      roof: "#4A3028",
      boards: "#5E3D2C",
      post: ink,
      glass: "#2C1A16",
      glint: "#2C1A16",
      windowLit: "#2C1A16",
      doorway: "#22130F",
      door: ink,
      sign: "#2C1A16",
      signText: "#F2C230",
      signAlt: "#2C1A16",
      signAltText: "#F2C230",
      bulb: "#2C1A16",
      awningA: "#5E3D2C",
      awningB: "#5E3D2C",
      bunting: ink,
      accent: "#5E3D2C",
      barrel: "#5E3D2C",
      band: "#2C1A16",
      canvas: "#B79468",
      hay: "#C9A268",
      water: "#8CC4BE",
      cactus: "#3E6E58",
      cactusDark: "#3E6E58",
      rock: "#96523E",
      scrub: "#7E7A44",
      twig: "#5E3D2C",
      leaf: "#7E7A44",
      cloud: "#D5E6DC",
      cloudShade: "#D5E6DC",
    },
    light: {
      ...base.light,
      azimuth: 180,
      elevation: 15,
      sun: "#FFE6C2",
      sunGain: 0.3,
      sunCurve: 1,
      bands: 1,
      ambientSky: "#E4D8D0",
      ambientGround: "#E4D8D0",
      ambientGain: 0.86,
      fogDensity: 0.0045,
      fogMax: 0.75,
      charLight: "#FFFFFF",
      charShade: "#B79CB4",
      charRim: "#000000",
      washGain: 0,
    },
    sky: { ...base.sky, bands: 4, midAt: 7, zenithAt: 34, sunSize: 7, glowSize: 1, glowGain: 0, clouds: "streaks" },
    kit: { ...base.kit, planks: "panel", tintVar: 0, wonk: 1, litWindows: 0, glow: 0, dust: 0, wind: 0, flatColor: true, stripedAwnings: false },
  };
}

/** Our sheriff, in flat colours. */
const SHERIFF: Outfit = {
  fur: "#7A4524",
  skin: "#F4CFA2",
  poncho: "#1F7C86",
  stripe: "#F2C230",
  pants: "#283A62",
  hat: "#2E1A12",
  band: "#D2362A",
  scarf: "#D2362A",
};

type Sound = "thunk" | "whip" | "blast" | "impact";
type Art = HTMLCanvasElement;

/** One beat. Every panel lands on it, with a sound. */
const B = 0.3;

const STILL_W = 1024;
const STILL_H = 576;
const ASPECT = STILL_W / STILL_H;
const KEY = "#FF00FF";
const PAPER = "#F2E6CC";
const INK = "#0B0708";
const RED = "#C9201A";
const ORANGE = "#E8712A";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** The snap of a panel landing: nearly all of the move in the first few frames. */
const snap = (age: number, over = 0.13) => 1 - Math.pow(1 - clamp01(age / over), 4);

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function seeded(seed: number) {
  let s = seed * 7919 + 13;
  return () => ((s = (s * 16807) % 2147483647), s / 2147483647);
}

type Pt = [number, number];

/** A hacked-out panel edge: each side broken into uneven teeth, like something cut with a knife. */
function jagged(corners: Pt[], seed: number, amp = 15): Pt[] {
  const r = seeded(seed);
  const out: Pt[] = [];
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / (len || 1);
    const ny = (b[0] - a[0]) / (len || 1);
    out.push(a);
    let at = 26 + r() * 50;
    while (at < len - 26) {
      const k = at / len;
      const d = (r() > 0.78 ? 2.1 : 1) * (r() * 2 - 1) * amp;
      out.push([a[0] + (b[0] - a[0]) * k + nx * d, a[1] + (b[1] - a[1]) * k + ny * d]);
      at += 22 + r() * 62;
    }
  });
  return out;
}

/** A panel shaped like an explosion, for the biggest hit. */
function burst(cx: number, cy: number, rx: number, ry: number, spikes: number, seed: number): Pt[] {
  const r = seeded(seed);
  const out: Pt[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 + (r() - 0.5) * 0.05;
    const k = i % 2 === 0 ? 0.92 + r() * 0.2 : 0.68 + r() * 0.08;
    out.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return out;
}

function pathOf(pts: Pt[]): Path2D {
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Prints a flat picture the way the character shader does, for those it can't reach, like the town and
 * the paper art. Colours stay flat. Dark areas and the panel's corners break into a darker flat colour
 * through an ordered dither.
 */
function printed(c: Art, cut: number): Art {
  const x = c.getContext("2d", { willReadFrequently: true })!;
  const img = x.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const cell = Math.max(2, Math.round(c.height / 180));
  for (let i = 0, n = 0; i < d.length; i += 4, n++) {
    const px = n % c.width;
    const py = Math.floor(n / c.width);
    const L = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
    const ex = (px / c.width - 0.5) * 2;
    const ey = (py / c.height - 0.5) * 2;
    const shade = L * (1 - Math.pow(ex * ex + ey * ey, 1.6) * 0.5);
    const t = (BAYER[(Math.floor(py / cell) % 4) * 4 + (Math.floor(px / cell) % 4)] + 0.5) / 16;
    if (clamp01((shade - cut) / 0.26) >= t) continue;
    d[i] = d[i] * 0.42 + 2;
    d[i + 1] = d[i + 1] * 0.42 + 1;
    d[i + 2] = d[i + 2] * 0.42 + 2;
  }
  x.putImageData(img, 0, 0);
  return c;
}

/** A low bank of flat paper smoke, to stand a figure in: transparent above, at 1920 by 300. */
function dustBank(seed: number): Art {
  const c = makeCanvas(1920, 340);
  const x = c.getContext("2d")!;
  const r = seeded(seed);
  for (const [color, y, size] of [["#D9B68A", 160, 110], [PAPER, 230, 100], ["#C8A07A", 310, 90]] as [string, number, number][]) {
    x.fillStyle = color;
    for (let at = -60; at < 1980; at += size * (0.8 + r() * 0.6)) {
      x.beginPath();
      x.arc(at, y + r() * 40, size * (0.7 + r() * 0.6), 0, Math.PI * 2);
      x.fill();
    }
  }
  return printed(c, 0.3);
}

/** Black paper, with spatters of ink flicked across it. */
function pageArt(seed: number): Art {
  const c = makeCanvas(960, 540);
  const x = c.getContext("2d")!;
  x.fillStyle = INK;
  x.fillRect(0, 0, 960, 540);
  const r = seeded(seed);
  x.fillStyle = "#3A2A26";
  for (let i = 0; i < 260; i++) {
    x.beginPath();
    x.arc(r() * 960, r() * 540, Math.pow(r(), 5) * 7 + 0.4, 0, Math.PI * 2);
    x.fill();
  }
  return c;
}

/** Streaks for a page being whipped in, baked once. */
function whipStreaks(): Art {
  const c = makeCanvas(960, 540);
  const x = c.getContext("2d")!;
  const r = seeded(11);
  for (let i = 0; i < 46; i++) {
    x.globalAlpha = 0.45 + r() * 0.5;
    x.fillStyle = i % 3 === 0 ? PAPER : INK;
    x.fillRect(r() * 200 - 100, r() * 540, 250 + r() * 750, 2 + r() * 13);
  }
  return c;
}

/** Radial speed lines around the middle, in black. */
function speedLines(): Art {
  const c = makeCanvas(960, 540);
  const x = c.getContext("2d")!;
  const r = seeded(5);
  x.fillStyle = "#000";
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2 + r() * 0.05;
    const w = 0.006 + r() * 0.016;
    const r0 = 165 + r() * 85;
    x.beginPath();
    x.moveTo(480 + Math.cos(a) * r0, 270 + Math.sin(a) * r0);
    x.lineTo(480 + Math.cos(a + w) * 750, 270 + Math.sin(a + w) * 750);
    x.lineTo(480 + Math.cos(a - w) * 750, 270 + Math.sin(a - w) * 750);
    x.closePath();
    x.fill();
  }
  return c;
}

/** A camera that can roll. */
function cameraAt(eye: V3, at: V3, fov: number, aspect: number, roll = 0, near = NEAR): Camera {
  const f = [at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]];
  const fl = Math.hypot(f[0], f[1], f[2]) || 1;
  const n = [f[0] / fl, f[1] / fl, f[2] / fl];
  // Right = forward x up, for a world-up camera.
  const rx = -n[2];
  const rz = n[0];
  const rl = Math.hypot(rx, rz) || 1;
  const right = [rx / rl, 0, rz / rl];
  const u0 = [right[1] * n[2] - right[2] * n[1], right[2] * n[0] - right[0] * n[2], right[0] * n[1] - right[1] * n[0]];
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  const up: V3 = [u0[0] * c + right[0] * s, u0[1] * c + right[1] * s, u0[2] * c + right[2] * s];
  return { eye, view: lookAt(eye, at, up), proj: perspective(fov, aspect, near, FAR) };
}

/** A long-lens camera that fits a height of `frame` around a point, from angle az round it. */
function framed(at: V3, frame: number, az: number, roll = 0): Camera {
  const fov = 14;
  const dist = frame / 2 / Math.tan((fov * Math.PI) / 360);
  return cameraAt([at[0] + Math.sin(az) * dist, at[1], at[2] + Math.cos(az) * dist], at, fov, ASPECT, roll);
}

/** One panel landing on the page: its art, its shape, where it flies in from, and how it crops. */
interface Panel {
  art?: Art;
  shape: Pt[];
  /** Where it comes from, in stage units, and how much it's turned. */
  from: [number, number, number];
  zoom?: number;
  shift?: Pt;
  /** Draws over the art, inside the panel. */
  over?: (age: number) => void;
  /** Draws instead of the art, inside the panel. */
  draw?: (age: number) => void;
  /** Draws after the panel, on top of the page, unclipped. */
  after?: (age: number) => void;
  /** Leave off its paper border? */
  bare?: boolean;
  path?: Path2D;
  box?: [number, number, number, number];
}

interface Step {
  /** A new page wipes the old one. */
  page?: "cut" | "whip";
  at: number;
  len: number;
  sound?: Sound;
  panel?: Panel;
  id: string;
}

export class Intro {
  private layer: HTMLElement;
  private stage: HTMLCanvasElement;
  private x: CanvasRenderingContext2D;
  private look: LookState;
  private star: GpuMesh;
  private monkey: GpuMesh;
  private arm: GpuMesh;
  private armRig: Rig;
  private gun: { body: GpuMesh; cylinder: GpuMesh; hammer: GpuMesh; trigger: GpuMesh; hammerPivot: V3 };
  private rig: Rig;
  private cued = new Set<string>();
  private steps: Step[] = [];
  private page = pageArt(3);
  private settled = makeCanvas(1280, 720);
  private settledKey = "";
  private streaks = whipStreaks();
  private lines = speedLines();
  /** Called once per sound cue. */
  onCue: (cue: Sound) => void = () => {};

  private constructor(
    private renderer: Renderer,
    private skeleton: Skeleton,
    private glb: ParsedGlb,
    private faceSheet: GpuMesh,
    hud: HTMLElement,
    armGlb: ParsedGlb,
    private gator: BossInstance,
    private props: Record<PropName, GpuMesh>,
  ) {
    this.look = renderer.look(ghostLook());
    const star = new MeshBuilder(4);
    star.mat = "plain";
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
      const r = i % 2 === 0 ? 0.13 : 0.055;
      pts.push([Math.cos(a) * r, 1.12 + Math.sin(a) * r]);
    }
    star.prismXY(pts, 0.38, 0.42, hex("#F2C230"));
    this.star = renderer.uploadMesh(star);
    const b = readSkinnedMesh(glb, monkeyPaint(SHERIFF));
    this.monkey = renderer.uploadSkinned(b.data, b.count);
    this.rig = new Rig(skeleton);
    const armPaint: Record<string, RGB> = { skin: hex(SHERIFF.skin), fur: hex(SHERIFF.fur), sleeve: hex(SHERIFF.poncho), cuff: hex(SHERIFF.stripe) };
    const a = readSkinnedMesh(armGlb, (m) => ({ color: armPaint[m] }));
    this.arm = renderer.uploadSkinned(a.data, a.count);
    this.armRig = new Rig(readSkeleton(armGlb));
    const parts = buildRevolver(revolverObj, (name) => ({ color: hex(/wood|grip|handle/i.test(name) ? "#7A3F1E" : "#3A3C48"), mat: "plain" }));
    this.gun = {
      body: renderer.uploadMesh(parts.builders.body),
      cylinder: renderer.uploadMesh(parts.builders.cylinder),
      hammer: renderer.uploadMesh(parts.builders.hammer),
      trigger: renderer.uploadMesh(parts.builders.trigger),
      hammerPivot: parts.hammerPivot,
    };

    if (!document.getElementById("intro-css")) {
      const st = document.createElement("style");
      st.id = "intro-css";
      st.textContent = `#intro { position: absolute; inset: 0; overflow: hidden; pointer-events: none; background: ${INK}; }
#intro canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#intro .skip { position: absolute; right: 44px; bottom: 26px; font: 700 20px/1 "Bitter", serif; color: #fff; -webkit-text-stroke: 5px ${INK}; paint-order: stroke fill; }`;
      document.head.appendChild(st);
    }
    this.layer = document.createElement("div");
    this.layer.id = "intro";
    this.stage = makeCanvas(1280, 720);
    this.x = this.stage.getContext("2d")!;
    this.layer.appendChild(this.stage);
    const skip = document.createElement("div");
    skip.className = "skip";
    skip.textContent = "Select to skip";
    this.layer.appendChild(skip);
    hud.appendChild(this.layer);

    this.renderer.setMode("flat");
    this.renderer.windScale = 0;
    this.script();
  }

  static async create(renderer: Renderer, glb: ParsedGlb, skeleton: Skeleton, faceSheet: GpuMesh, hud: HTMLElement, armGlb: ParsedGlb) {
    // The art letters its signs in Rye, and bakes once, so the font has to be ready first.
    await document.fonts.load("400 60px Rye").catch(() => undefined);
    const [gator, builders] = await Promise.all([loadBoss(renderer, BOSSES.find((b) => b.id === "gator")!), loadPropBuilders()]);
    const props = Object.fromEntries(Object.entries(builders).map(([k, b]) => [k, renderer.uploadMesh(b)])) as Record<PropName, GpuMesh>;
    return new Intro(renderer, skeleton, glb, faceSheet, hud, armGlb, gator, props);
  }

  dispose() {
    this.layer.remove();
  }

  /** Stays out of sight once it's built, until it's time to play. */
  show(on: boolean) {
    this.layer.style.display = on ? "" : "none";
  }

  // ---- The art: each picture is one render of the real models, printed, frozen and never drawn again.

  private ink(cut: number, key: [number, number, number], contour = 0.2) {
    const cell = Math.max(3, Math.round((this.renderer.gl.canvas as HTMLCanvasElement).height / 200));
    return { cut, cell, contour, dark: hex(INK), key };
  }

  /** Runs a render and keeps what it drew. Keyed art loses its background and becomes a cut-out. */
  private capture(draw: (vp: Rect) => void, keyed = false): Art {
    const r = this.renderer;
    const glCanvas = r.gl.canvas as HTMLCanvasElement;
    const vp: Rect = [0, 0, glCanvas.width, glCanvas.height];
    r.gl.viewport(0, 0, vp[2], vp[3]);
    r.gl.scissor(0, 0, vp[2], vp[3]);
    draw(vp);
    const c = makeCanvas(STILL_W, STILL_H);
    const x = c.getContext("2d", { willReadFrequently: keyed })!;
    x.drawImage(glCanvas, 0, 0, STILL_W, STILL_H);
    if (keyed) {
      const img = x.getImageData(0, 0, STILL_W, STILL_H);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 150 && d[i + 2] > 150 && d[i + 1] < 110) d[i + 3] = 0;
      }
      x.putImageData(img, 0, 0);
    }
    return c;
  }

  /** Renders characters printed, on a bare colour. */
  private inked(camera: Camera, things: MovingThing[], bare: string, cut: number, key: [number, number, number], keyed = false, contour = 0.2): Art {
    return this.capture((vp) => this.renderer.render(this.look, camera, vp, things, { gray: false, time: 0, flatArt: { fogSteps: 4, hardToon: true, bare: hex(bare), ink: this.ink(cut, key, contour) } }), keyed);
  }

  private body(model: Mat4, eye: EyeCell, mouth: MouthCell): MovingThing[] {
    return [
      { mesh: this.monkey, model, character: true, shadow: false, bones: this.rig.bones, face: { mesh: this.faceSheet, model: multiply(model, this.rig.boneMatrix("head")), eye, mouth, skin: hex(SHERIFF.skin) } },
      { mesh: this.star, model: multiply(model, this.rig.boneMatrix("chest")), character: true, shadow: false, toon: true },
    ];
  }

  /** The sheriff, revolver up by his face, its barrel pointing out, away from him. */
  private armed(model: Mat4, eye: EyeCell, mouth: MouthCell, towards: V3): MovingThing[] {
    this.rig.play("cock", 0, { fade: 0 });
    this.rig.update(1.9);
    const at = transformPoint(multiply(model, this.rig.boneMatrix("hand.R")), [0.79, 0.3, 0.12]);
    const fl = Math.hypot(towards[0], towards[1], towards[2]);
    const X: V3 = [towards[0] / fl, towards[1] / fl, towards[2] / fl];
    // Gun up stays world-up as near as it can; gun z is the shooter's right.
    const zl = Math.hypot(X[2], X[0]) || 1;
    const Z: V3 = [-X[2] / zl, 0, X[0] / zl];
    const Y: V3 = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
    const s = 1.05;
    // The grip's middle goes in his hand.
    const g: V3 = [0.02, -0.14, 0];
    const base = identity();
    base[0] = X[0] * s; base[1] = X[1] * s; base[2] = X[2] * s;
    base[4] = Y[0] * s; base[5] = Y[1] * s; base[6] = Y[2] * s;
    base[8] = Z[0] * s; base[9] = Z[1] * s; base[10] = Z[2] * s;
    base[12] = at[0] - (X[0] * g[0] + Y[0] * g[1]) * s;
    base[13] = at[1] - (X[1] * g[0] + Y[1] * g[1]) * s;
    base[14] = at[2] - (X[2] * g[0] + Y[2] * g[1]) * s;
    const part = (mesh: GpuMesh, m: Mat4): MovingThing => ({ mesh, model: m, character: true, shadow: false, toon: true });
    return [...this.body(model, eye, mouth), part(this.gun.body, base), part(this.gun.cylinder, base), part(this.gun.hammer, this.hammerAt(base, 0.72)), part(this.gun.trigger, base)];
  }

  private hammerAt(base: Mat4, angle: number): Mat4 {
    const p = this.gun.hammerPivot;
    return multiply(multiply(multiply(base, translation(p[0], p[1], p[2])), rotationZ(angle)), translation(-p[0], -p[1], -p[2]));
  }

  /** The player's own arm and revolver, barrel pointing away down the street, as the game holds it. */
  private pov(clipTime: number, angle: number): { things: MovingThing[]; hammer: V3 } {
    let m = translation(0.04, -0.14, -0.9);
    m = multiply(m, rotationY(-0.04));
    m = multiply(m, rotationZ(0.05));
    m = multiply(m, rotationY(Math.PI / 2));
    m = multiply(m, scaling(0.38, 0.38, 0.38));
    this.armRig.play("cock", 0, { fade: 0 });
    this.armRig.update(clipTime);
    const base = multiply(m, this.armRig.boneMatrix("gun"));
    const part = (mesh: GpuMesh, at: Mat4): MovingThing => ({ mesh, model: at, character: true, shadow: false, toon: true });
    return {
      hammer: transformPoint(base, [0.16, 0.4, 0]),
      things: [
        part(this.gun.body, base),
        part(this.gun.cylinder, base),
        part(this.gun.hammer, this.hammerAt(base, angle)),
        part(this.gun.trigger, base),
        { mesh: this.arm, model: m, character: true, shadow: false, bones: this.armRig.bones },
      ],
    };
  }

  /** Some of the lizard gang, armed, frozen mid-stride, as one cut-out in the gang's shared camera. */
  private lizards(camera: Camera, squad: { x: number; z: number; yaw: number; t: number; outfit: number; prop: PropName }[]): Art {
    const sheet = this.renderer.uploadMesh(buildLizardFaceSheet());
    const things: MovingThing[] = [];
    for (const m of squad) {
      const look = LIZARDS[m.outfit];
      const b = lizardBuffer(this.glb, look);
      const rig = new Rig(this.skeleton);
      rig.play("run_weapon", 0, { fade: 0 });
      rig.update(m.t);
      const model = multiply(translation(m.x, 0, m.z), rotationY(m.yaw));
      things.push({ mesh: this.renderer.uploadSkinned(b.data, b.count), model, character: true, shadow: false, bones: rig.bones, face: { mesh: sheet, model: multiply(model, rig.boneMatrix("head")), eye: lizardEye("angry"), mouth: lizardMouth("smile"), skin: hex(look.iris), plate: "blank" } });
      things.push({ mesh: this.props[m.prop], model: heldMatrix(model, rig), character: true, shadow: false, toon: true });
    }
    return this.inked(camera, things, KEY, 0.05, [0.5, 0.6, 0.6], true);
  }

  // ---- The storyboard. Each step is one panel, on one beat.

  private script() {
    const r = this.renderer;
    const step = (id: string, beats: number, sound: Sound | undefined, panel: Panel, page?: "cut" | "whip") => {
      const last = this.steps[this.steps.length - 1];
      panel.path = pathOf(panel.shape);
      const xs = panel.shape.map((p) => p[0]);
      const ys = panel.shape.map((p) => p[1]);
      panel.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      this.steps.push({ id, at: last ? last.at + last.len : 0, len: beats * B, sound, panel, page });
    };
    const comic = new PaperComic();
    const front = identity();

    // He enters: a paper figure shoved in along the road, rocking on held frames, then his boot lands.
    this.rig.play("walk", 0, { fade: 0 });
    this.rig.update(0.5);
    const stride = rotationY(1.05);
    const walking = this.body(stride, "squint", "smile");
    const walker = this.inked(framed([0, 1.34, 0], 3.3, 0), walking, KEY, 0.05, [0.85, 0.5, 0.3], true);
    const shin = transformPoint(multiply(stride, this.rig.boneMatrix("shin.R")), [0.22, 0.14, 0.1]);
    const boot = this.inked(framed(shin, 1.15, 1.05, 0.12), walking, RED, 0.1, [0.8, 0.5, 0.2]);
    const WALK = 3 * B;
    step(
      "road",
      4,
      "thunk",
      {
        art: printed(comic.still("road"), 0.3),
        shape: jagged([[30, 28], [1892, 18], [1898, 1054], [22, 1064]], 1),
        from: [-2100, 0, -0.05],
        over: (age) => {
          const held = Math.floor(age * 8) / 8;
          const k = clamp01(held / WALK);
          const rock = k < 1 ? (Math.floor(age * 8) % 2 ? 0.035 : -0.035) : 0;
          const x = this.x;
          x.save();
          x.translate(-1100 + (1 - Math.pow(1 - k, 2)) * 1570, 880);
          x.rotate(rock);
          x.drawImage(walker, -675, -689, 1351, 760);
          x.restore();
        },
      },
      "cut",
    );
    step("boot", 1, "thunk", { art: boot, shape: jagged([[1340, 800], [1882, 776], [1888, 1042], [1296, 1054]], 2), from: [900, 700, 0.16] });

    // The camera goes into the bank: crash zooms on the beat, through the gap between his legs.
    const legs = printed(comic.still("legs"), 0.12);
    step(
      "legs",
      3,
      "whip",
      {
        shape: jagged([[28, 24], [1894, 16], [1896, 1058], [20, 1064]], 3),
        from: [-2100, 0, 0.04],
        draw: (age) => {
          const stage = Math.min(2, Math.floor(age / B));
          const scale = [1, 1.55, 2.4][stage] * (1 + 0.1 * (1 - snap(age - stage * B)) + age * 0.03);
          this.put(legs, { scale, y: -(scale - 1) * 150 });
        },
      },
      "whip",
    );
    step("bank", 1, "thunk", { art: printed(comic.still("bank"), 0.3), shape: jagged([[960, 110], [1886, 76], [1876, 1006], [880, 1040]], 4), from: [1500, -200, -0.14], zoom: 1.15, shift: [0, 70] });

    // The next panel: it blows.
    step("blast", 4, "blast", { art: printed(comic.still("blast"), 0.2), shape: burst(960, 560, 1180, 760, 22, 5), from: [0, 0, 0], bare: true, after: (age) => this.hit(age, 1, 0.07) });

    // Big Gat walks out of it, then his lizards slam in either side, one side to a beat.
    const gangCam = cameraAt([0, 1.2, 26], [0, 2.6, 0], 19, ASPECT, 0.03);
    const g = this.gator;
    // His free arm thrust out to the side and forward, with one big finger on the end of the mitten.
    const pointing: [number, number, number] = [0.8, 0.04, 0.6];
    for (const bone of ["arm.L", "fore.L", "hand.L"]) g.rig.aimBone(bone, pointing);
    g.rig.play("steal", 0, { fade: 0 });
    g.rig.update(0.35);
    const finger = new MeshBuilder(6);
    finger.mat = "plain";
    const round = (radius: number): [number, number][] => Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2) * radius, Math.sin((i / 8) * Math.PI * 2) * radius]);
    finger.prismXY(round(0.2), 0, 0.85, hex(g.def.paint.hide ?? "#4F9A52"));
    finger.prismXY(round(0.11), 0.85, 1.1, hex(g.def.paint.claw ?? "#1B1218"));
    const hand = g.rig.boneWorld("hand.L");
    const fl = Math.hypot(...pointing);
    const Z: V3 = [pointing[0] / fl, pointing[1] / fl, pointing[2] / fl];
    const xl = Math.hypot(Z[2], Z[0]) || 1;
    const X: V3 = [Z[2] / xl, 0, -Z[0] / xl];
    const Y: V3 = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
    const fingerAt = identity();
    fingerAt[0] = X[0]; fingerAt[1] = X[1]; fingerAt[2] = X[2];
    fingerAt[4] = Y[0]; fingerAt[5] = Y[1]; fingerAt[6] = Y[2];
    fingerAt[8] = Z[0]; fingerAt[9] = Z[1]; fingerAt[10] = Z[2];
    fingerAt[12] = hand[12] + Z[0] * 0.62; fingerAt[13] = hand[13] + Z[1] * 0.62; fingerAt[14] = hand[14] + Z[2] * 0.62;
    const gatorThings: MovingThing[] = [
      { mesh: g.mesh, model: front, character: true, shadow: false, bones: g.rig.bones, face: bossFace(g, front, 0.35, 0) },
      { mesh: this.renderer.uploadMesh(finger), model: fingerAt, character: true, shadow: false, toon: true },
    ];
    const gatorArt = this.inked(gangCam, gatorThings, KEY, 0.05, [0.5, 0.6, 0.6], true);
    const gatorShape = this.capture((vp) => r.render(this.look, gangCam, vp, gatorThings, { gray: false, time: 0, flatArt: { fogSteps: 4, hardToon: true, bare: hex(KEY), silhouette: hex("#050307") } }), true);
    // Smoke up over his legs, in front of him and behind the lizards.
    const dust = dustBank(4);
    const smokeBack = printed(comic.still("smoke"), 0.2);
    const gangShape = jagged([[24, 20], [1896, 16], [1892, 1064], [20, 1060]], 11);
    // One frame he's a black shape, the next he's in colour, in the same place.
    step(
      "gangBlack",
      1,
      "thunk",
      {
        art: smokeBack,
        shape: gangShape,
        from: [0, 1200, 0.03],
        over: (age) => {
          this.put(gatorShape, { scale: 1 + 0.18 * (1 - snap(age)) + age * 0.02 });
          this.x.drawImage(dust, 0, 650, 1920, 450);
        },
      },
      "cut",
    );
    step("gang", 2, "blast", {
      art: smokeBack,
      shape: gangShape,
      from: [0, 0, 0],
      over: (age) => {
        this.put(gatorArt, { scale: 1 + (age + B) * 0.02 });
        this.x.drawImage(dust, 0, 650, 1920, 450);
      },
    });
    const whole: Pt[] = [[-20, -20], [1940, -20], [1940, 1100], [-20, 1100]];
    const left = this.lizards(gangCam, [{ x: -5.3, z: 6, yaw: 0.35, t: 0.3, outfit: 2, prop: "club" }, { x: -3.5, z: 10, yaw: 0.25, t: 0.1, outfit: 0, prop: "machete" }]);
    step("gangL", 1, "thunk", { draw: () => this.put(left), shape: whole, from: [-1500, 0, -0.05], bare: true });
    const right = this.lizards(gangCam, [{ x: 5.3, z: 6, yaw: -0.35, t: 0.4, outfit: 3, prop: "machete" }, { x: 3.5, z: 10, yaw: -0.25, t: 0.22, outfit: 1, prop: "axe" }]);
    step("gangR", 2, "thunk", { draw: () => this.put(right), shape: whole, from: [1500, 0, 0.05], bare: true });

    // His eyes, wide across the page, the blast lighting them.
    this.rig.play("idle", 0, { fade: 0 });
    this.rig.update(0.5);
    const head = transformPoint(this.rig.boneMatrix("head"), [0, 1.86, 0.5]);
    const eyes = this.inked(framed(head, 0.82, 0.04, 0.03), this.body(front, "angry", "grit"), ORANGE, -0.02, [0.1, 0.25, 0.9]);
    step("eyes", 3, "thunk", { art: eyes, shape: jagged([[22, 300], [1898, 266], [1890, 800], [30, 832]], 6), from: [0, 0, 0], zoom: 1.0, over: (age) => this.creep(eyes, age, 0.09) }, "cut");

    // He doesn't run: seen from behind, planted, the blast filling the page and debris flying past him.
    const firm = printed(comic.still("smoke"), 0.2);
    const back = this.inked(framed([0, 1.3, 0], 3.1, 0), this.body(rotationY(Math.PI), "angry", "grit"), KEY, 0.3, [0.25, 0.3, -0.9], true);
    const fx = firm.getContext("2d")!;
    fx.setTransform(1, 0, 0, 1, 0, 0);
    // The gang up the street to the left, stood in dust, Big Gat pointing right at him, big on the right.
    fx.drawImage(gatorArt, 30, 70, 900, 506);
    fx.drawImage(dust, 0, 365, 1280, 355);
    for (const member of [left, right]) fx.drawImage(member, 30, 70, 900, 506);
    fx.drawImage(back, 442, 150, 1088, 612);
    const bits = (() => {
      const q = seeded(21);
      return Array.from({ length: 16 }, () => ({ a: q() * Math.PI * 2, d: 170 + q() * 420, v: 300 + q() * 620, w: 26 + q() * 60, h: 10 + q() * 22, spin: 2 + q() * 7 }));
    })();
    step(
      "firm",
      4,
      "thunk",
      {
        art: firm,
        shape: jagged([[26, 22], [1894, 18], [1890, 1062], [24, 1058]], 7),
        from: [0, 1200, 0.03],
        over: (age) => {
          // Debris on held frames, thrown out from behind him and past the camera.
          const held = Math.floor(age * 12) / 12;
          const x = this.x;
          x.fillStyle = "#3A241E";
          for (const b of bits) {
            const d = b.d + b.v * held;
            x.save();
            x.translate(960 + Math.cos(b.a) * d, 560 + Math.sin(b.a) * d * 0.62);
            x.rotate(b.a + b.spin * held);
            x.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
            x.restore();
          }
        },
      },
      "whip",
    );

    // He draws: low in the real town, then the player's own thumb on the hammer.
    const heroEye: V3 = [2.2, 0.9, 18];
    const here = translation(0, 0, 11);
    const looking = this.armed(here, "angry", "grit", [1, 0.1, 0.55]);
    const heroCam = cameraAt(heroEye, [0.75, 1.62, 11], 30, ASPECT, -0.13);
    const hero = printed(this.capture((vp) => r.render(this.look, heroCam, vp, [], { gray: false, time: 0, flatArt: { fogSteps: 4, hardToon: true } })), 0.3);
    hero.getContext("2d")!.drawImage(this.inked(heroCam, looking, KEY, 0.02, [0.75, 0.55, 0.4], true), 0, 0);
    step("hero", 2, "whip", { art: hero, shape: jagged([[24, 24], [760, 18], [700, 1062], [18, 1062]], 8), from: [-1100, 0, -0.05], shift: [-40, 0] }, "whip");
    const down = this.pov(0.36, 0);
    const lift = (h: V3): Camera => cameraAt([h[0] - 0.62, h[1] + 0.14, h[2] + 0.2], [h[0], h[1] - 0.03, h[2] - 0.08], 30, ASPECT, -0.06, 0.05);
    const gunShape = jagged([[790, 24], [1896, 16], [1894, 700], [740, 730]], 9);
    step("hammer", 2, "thunk", { art: this.inked(lift(down.hammer), down.things, PAPER, 0.02, [0.75, 0.6, 0.3]), shape: gunShape, from: [1300, -400, 0.1] });
    const cocked = this.pov(0.99, 0.72);
    step("cocked", 1, "thunk", { art: this.inked(lift(cocked.hammer), cocked.things, RED, 0.02, [0.75, 0.6, 0.3]), shape: gunShape, from: [0, 0, 0], after: (age) => this.hit(age, 0.45) });
    const face = this.armed(front, "angry", "grit", [1, 0.1, 0.55]);
    const glareAt = transformPoint(this.rig.boneMatrix("head"), [0, 1.86, 0.5]);
    step("glare", 2, "thunk", { art: this.inked(framed(glareAt, 0.82, 0.1, 0.08), face, "#FFE14D", 0.05, [0.5, 0.3, 0.8]), shape: jagged([[744, 760], [1894, 730], [1892, 1060], [710, 1062]], 10), from: [0, 800, 0.05], zoom: 1.2, shift: [0, -40] });

    // Last: one black shape, flipped and tinted on the beat.
    const shot = this.armed(front, "angry", "openA", [1, 0.1, 0.55]);
    const impact = this.capture((vp) => r.render(this.look, cameraAt([0.9, 1.65, 7], [0.75, 1.5, 0], 26, ASPECT, -0.13), vp, shot, { gray: false, time: 0, flatArt: { fogSteps: 4, hardToon: true, bare: hex("#FFFFFF"), silhouette: hex("#050307") } }));
    step("final", 2.6, "impact", { draw: (age) => this.finale(impact, age), shape: [[-20, -20], [1940, -20], [1940, 1100], [-20, 1100]], from: [0, 0, 0], bare: true }, "cut");
  }

  // ---- The edit: everything below moves those pictures about, and nothing in them moves.

  private put(c: Art, p: { x?: number; y?: number; scale?: number } = {}) {
    const s = p.scale ?? 1;
    this.x.drawImage(c, 960 + (p.x ?? 0) - 960 * s, 540 + (p.y ?? 0) - 540 * s, 1920 * s, 1080 * s);
  }

  /** A slow push in on a picture, drawn over itself so it fills the panel. */
  private creep(c: Art, age: number, rate: number) {
    this.put(c, { scale: 1.02 + age * rate, y: 26 });
  }

  private fill(color: string) {
    this.x.fillStyle = color;
    this.x.fillRect(-200, -200, 2320, 1480);
  }

  /** A white hit on the first frames of a panel. */
  private hit(age: number, amount: number, over = 0.05) {
    if (age >= over) return;
    this.x.globalAlpha = amount;
    this.fill("#FFFFFF");
    this.x.globalAlpha = 1;
  }

  private finale(impact: Art, age: number) {
    const x = this.x;
    const f = Math.floor(age * 12);
    this.put(impact, { scale: 1 + Math.min(f, 6) * 0.03 });
    const flip = f % 2 === 1 && f < 3;
    if (f >= 3) {
      x.globalCompositeOperation = "multiply";
      this.fill("#D2221A");
    } else if (flip) {
      x.globalCompositeOperation = "difference";
      this.fill("#FFFFFF");
    }
    x.globalCompositeOperation = flip ? "difference" : "source-over";
    x.drawImage(this.lines, 0, 0, 1920, 1080);
    x.globalCompositeOperation = "source-over";
  }

  /** One panel, flying in and landing, with its art held still inside it. */
  private land(p: Panel, age: number) {
    const x = this.x;
    const [x0, y0, x1, y1] = p.box!;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const k = snap(age);
    const away = 1 - k;
    x.save();
    x.translate(cx + p.from[0] * away, cy + p.from[1] * away);
    x.rotate(p.from[2] * away);
    const s = 1 + away * 0.12;
    x.scale(s, s);
    x.translate(-cx, -cy);
    if (!p.bare) {
      x.strokeStyle = PAPER;
      x.lineWidth = 12;
      x.lineJoin = "miter";
      x.stroke(p.path!);
    }
    x.save();
    x.clip(p.path!);
    if (p.draw) p.draw(age);
    else if (p.art) {
      const fit = Math.max((x1 - x0) / 1920, (y1 - y0) / 1080) * (p.zoom ?? 1) * (1 + age * 0.018);
      const w = 1920 * fit;
      const h = 1080 * fit;
      x.drawImage(p.art, cx + (p.shift?.[0] ?? 0) - w / 2, cy + (p.shift?.[1] ?? 0) - h / 2, w, h);
    }
    p.over?.(age);
    if (age < 0.05) {
      x.globalAlpha = 0.35;
      this.fill("#FFFFFF");
      x.globalAlpha = 1;
    }
    x.restore();
    x.restore();
    p.after?.(age);
  }

  /** Draws the page and every panel that has already landed, once, when a new one arrives. */
  private settle(first: number, at: number) {
    const key = `${first}:${at}`;
    if (key === this.settledKey) return;
    this.settledKey = key;
    const stage = this.x;
    this.x = this.settled.getContext("2d")!;
    this.x.setTransform(1280 / 1920, 0, 0, 720 / 1080, 0, 0);
    this.x.drawImage(this.page, 0, 0, 1920, 1080);
    for (let i = first; i < at; i++) {
      const s = this.steps[i];
      if (s.panel) this.land(s.panel, s.len);
    }
    this.x = stage;
  }

  /** Draws the opening at time t. Returns false once it has finished. */
  frame(t: number, _W: number, _H: number): boolean {
    const last = this.steps[this.steps.length - 1];
    if (t >= last.at + last.len) return false;
    let at = 0;
    while (at < this.steps.length - 1 && t >= this.steps[at + 1].at) at++;
    const now = this.steps[at];
    if (now.sound && !this.cued.has(now.id)) {
      this.cued.add(now.id);
      this.onCue(now.sound);
    }
    // Back to the step that began this page.
    let first = at;
    while (first > 0 && !this.steps[first].page) first--;
    const x = this.x;
    x.setTransform(1280 / 1920, 0, 0, 720 / 1080, 0, 0);
    x.globalAlpha = 1;
    // The page jolts as each panel lands.
    const age = t - now.at;
    const f = Math.floor(age * 24);
    const jolt = age < 0.12 ? 7 * (f % 2 ? 1 : -1) : 0;
    const start = this.steps[first];
    const whip = start.page === "whip" ? 1 - snap(t - start.at, 0.16) : 0;
    this.settle(first, at);
    x.fillStyle = INK;
    x.fillRect(0, 0, 1920, 1080);
    x.translate(jolt + whip * 1920, age < 0.12 ? -jolt * 0.6 : 0);
    x.drawImage(this.settled, 0, 0, 1920, 1080);
    if (now.panel) this.land(now.panel, age);
    x.setTransform(1280 / 1920, 0, 0, 720 / 1080, 0, 0);
    if (whip > 0.02) {
      if (Math.floor(t * 24) % 2) {
        x.translate(0, 1080);
        x.scale(1, -1);
      }
      x.drawImage(this.streaks, 0, 0, 1920, 1080);
      x.setTransform(1280 / 1920, 0, 0, 720 / 1080, 0, 0);
    }
    return true;
  }
}
