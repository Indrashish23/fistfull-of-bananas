// The look-dev page. The opening view is the game's menu as a shooting gallery, and the toolbar
// switches looks, materials, cameras and character clips. Aiming uses a mouse or the arrow keys,
// and firing uses a click, Enter, Space or F, so it works with what a TV remote can send.

import "@fontsource/rye/400.css";
import "@fontsource/bitter/400.css";
import "@fontsource/bitter/700.css";

import revolver1 from "./assets/revolvers/Revolver_1.obj?raw";
import revolver2 from "./assets/revolvers/Revolver_2.obj?raw";
import revolver3 from "./assets/revolvers/Revolver_3.obj?raw";
import revolver4 from "./assets/revolvers/Revolver_4.obj?raw";
import revolver5 from "./assets/revolvers/Revolver_5.obj?raw";

import { buildTumbleweed, monkeyBuffer, OUTFITS } from "./character";
import { DIRECTIONS } from "./directions";
import { buildFaceSheet, FaceAnim, faceAtlas } from "./faces";
import { Effects } from "./fx";
import { Gallery } from "./gallery";
import { Intro } from "./intro";
import { RushCheck } from "./rushCheck";
import { parseGlb, readSkeleton, readSkinnedMesh, Rig } from "./gltf";
import { buildRevolver, CHAMBERS, GunAction } from "./gun";
import type { RevolverParts } from "./gun";
import type { V3 } from "./gl";
import { frustum, identity, invert, lookAt, multiply, perspective, rotationX, rotationY, rotationZ, scaling, transformPoint, translation } from "./gl";
import { logoSvg } from "./logo";
import { hex, MeshBuilder, mix } from "./mesh";
import type { RGB } from "./mesh";
import { Audio, measureCue } from "./music";
import { MONKEY_LAYOUT, Ragdoll } from "../src/render/ragdoll";
import { RagdollSkin } from "../src/render/ragdollSkin";
import { Renderer } from "./renderer";
import type { Camera, GpuMesh, HeldItem, HeldPart, MovingThing } from "./renderer";
import { foliage, textureSet } from "./tex";
import type { MaterialMode, PixelTex } from "./tex";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const ASPECT = 16 / 9;
const NEAR = 1;
const FAR = 3000;
const REVOLVERS = [revolver1, revolver2, revolver3, revolver4, revolver5];

interface CamDef {
  id: string;
  label: string;
  make: (t: number) => Camera;
}

/** The game's fixed shooter frame: a 13.34 x 7.5 plane at distance 14, centred on y = 3.1. */
const SHOOTER_PROJ = (() => {
  const k = NEAR / 14;
  return frustum(-6.67 * k, 6.67 * k, (-0.65 - 1.75) * k, (6.85 - 1.75) * k, NEAR, FAR);
})();

const persp = (fov: number) => perspective(fov, ASPECT, NEAR, FAR);
const orbit = { yaw: 0.45, pitch: 0.28, dist: 62, target: [2, 3, -22] as V3 };

/** Aim in ndc, plus recoil state, shared by the gallery camera, reticle and pistol. */
const aim = { x: 0, y: 0.02, kick: 0, shake: 0, keysX: 0, keysY: 0, usingKeys: false };

const MENU_FOV = 44;

const CAMERAS: CamDef[] = [
  {
    id: "gallery",
    label: "Gallery",
    make: (t) => {
      const eye: V3 = [aim.x * 0.3 + Math.sin(t * 0.09) * 0.08, 1.72 + Math.sin(t * 0.13) * 0.02, 14.4];
      const sx = Math.sin(t * 61) * aim.shake * 0.05;
      const sy = Math.sin(t * 73) * aim.shake * 0.05;
      const target: V3 = [aim.x * 1.9 + sx, 3.0 + aim.y * 1.4 + aim.kick * 0.45 + sy, -20];
      return { eye, view: lookAt(eye, target), proj: persp(MENU_FOV) };
    },
  },
  {
    id: "town",
    label: "Town",
    make: (t) => {
      const dx = Math.sin(t * 0.09) * 0.45;
      const eye: V3 = [-1.2 + dx, 1.5, 14];
      return { eye, view: lookAt(eye, [3 + dx * 0.25, 4.6, -60]), proj: persp(52) };
    },
  },
  {
    id: "shooter",
    label: "Shooter",
    make: () => {
      const eye: V3 = [0, 1.75, 0];
      return { eye, view: lookAt(eye, [0, 1.75, -1]), proj: SHOOTER_PROJ };
    },
  },
  {
    id: "target",
    label: "Reverse",
    make: () => {
      const eye: V3 = [0, 1.75, -14];
      return { eye, view: lookAt(eye, [0, 1.75, 0]), proj: SHOOTER_PROJ };
    },
  },
  {
    id: "monkey",
    label: "Monkey",
    make: (t) => {
      const a = 0.42 + Math.sin(t * 0.25) * 0.28;
      const eye: V3 = [Math.sin(a) * 4.8, 1.5, -14 + Math.cos(a) * 4.8];
      return { eye, view: lookAt(eye, [0, 1.42, -14]), proj: persp(34) };
    },
  },
  {
    id: "saloon",
    label: "Saloon",
    make: () => {
      const eye: V3 = [-3.5, 2.1, -18];
      return { eye, view: lookAt(eye, [9.5, 3.6, -24]), proj: persp(46) };
    },
  },
  {
    id: "free",
    label: "Orbit",
    make: () => {
      const { yaw, pitch, dist, target } = orbit;
      const eye: V3 = [
        target[0] + Math.sin(yaw) * Math.cos(pitch) * dist,
        Math.max(0.6, target[1] + Math.sin(pitch) * dist),
        target[2] + Math.cos(yaw) * Math.cos(pitch) * dist,
      ];
      return { eye, view: lookAt(eye, target), proj: persp(42) };
    },
  },
];

const params = new URLSearchParams(location.search);
const state = {
  dir: Math.max(0, DIRECTIONS.findIndex((d) => d.id === params.get("d"))),
  cam: Math.max(0, CAMERAS.findIndex((c) => c.id === params.get("c"))),
  ui: params.get("ui") !== "0",
  duellist: params.get("duellist") === "1",
  lane: params.get("lane") === "1",
  gray: params.get("gray") === "1",
  compare: params.get("compare") === "1",
  board: params.get("board") === "1",
  outfit: 0,
  clip: params.get("clip") || "crab",
  mode: (params.get("m") as MaterialMode) || "painted",
  gun: Math.max(0, Math.min(4, Number(params.get("gun") ?? 1) - 1)),
  music: params.get("music") !== "0",
  wind: params.get("wind") !== "0",
  inspect: params.get("inspect") === "1",
};
renderer.windScale = state.wind ? 1 : 0;
document.getElementById("logo")!.innerHTML = logoSvg();
renderer.setMode(state.mode);

const audio = new Audio();
audio.musicOn = state.music;

const effects = new Effects(renderer.gl, (t) => renderer.upload(t, false));

const isGallery = () => CAMERAS[state.cam].id === "gallery";

// ---- Meshes

const fetchGlb = async (name: string) => parseGlb(await (await fetch(new URL(`./assets/${name}`, import.meta.url))).arrayBuffer());
const [monkeyGlb, armGlb] = await Promise.all([fetchGlb("monkey.glb"), fetchGlb("fps_arm.glb")]);
const monkeySkel = readSkeleton(monkeyGlb);
const armSkel = readSkeleton(armGlb);
const monkeys = OUTFITS.map((o) => {
  const b = monkeyBuffer(monkeyGlb, o);
  return renderer.uploadSkinned(b.data, b.count);
});
const duellistRig = new Rig(monkeySkel);
duellistRig.play("crab", 0, { fade: 0 });
const duellistFace = new FaceAnim(0.5);
renderer.setFaceAtlas(await faceAtlas());
const faceSheet = renderer.uploadMesh(buildFaceSheet());
const tumbleMeshes = DIRECTIONS.map((d) => renderer.uploadMesh(buildTumbleweed(hex(d.palette.twig))));

const galleries = new Map<string, Gallery>();
function gallery(): Gallery {
  const d = DIRECTIONS[state.dir];
  let g = galleries.get(d.id);
  if (!g) {
    g = new Gallery(renderer, d, monkeyGlb, monkeySkel, faceSheet);
    galleries.set(d.id, g);
  }
  return g;
}

interface GunSet {
  parts: RevolverParts;
  meshes: { body: GpuMesh; cylinder: GpuMesh; hammer: GpuMesh; trigger: GpuMesh };
}

const gunSets = new Map<string, GunSet>();

function gunSet(): GunSet {
  const d = DIRECTIONS[state.dir];
  const key = `${d.id}:${state.gun}`;
  let m = gunSets.get(key);
  if (m) return m;
  const walnut = mix(hex(d.palette.barrel), hex("#9A4A20"), 0.45);
  const parts = buildRevolver(REVOLVERS[state.gun], (name) => {
    if (name.includes("Wood")) return { color: walnut, mat: "wood" };
    if (name === "LightMetal") return { color: hex("#8D9096"), mat: "plain" };
    if (name === "Grey") return { color: hex("#62656B"), mat: "plain" };
    return { color: hex("#43474E"), mat: "plain" };
  });
  m = {
    parts,
    meshes: {
      body: renderer.uploadMesh(parts.builders.body),
      cylinder: renderer.uploadMesh(parts.builders.cylinder),
      hammer: renderer.uploadMesh(parts.builders.hammer),
      trigger: renderer.uploadMesh(parts.builders.trigger),
    },
  };
  gunSets.set(key, m);
  return m;
}

/** The shooter's own monkey arm. Skin and fur match the first monkey. */
const armMesh = (() => {
  const o = OUTFITS[0];
  const fur = hex(o.fur);
  const skin = hex(o.skin);
  const palette: Record<string, RGB> = {
    skin,
    fur,
    sleeve: hex(o.poncho),
    cuff: hex(o.stripe),
  };
  const b = readSkinnedMesh(armGlb, (m) => {
    const color = palette[m];
    if (!color) throw new Error(`Arm material "${m}" has no paint`);
    return { color };
  });
  return renderer.uploadSkinned(b.data, b.count);
})();
const armRig = new Rig(armSkel);
armRig.play("hold", 0, { fade: 0 });
const gunAction = new GunAction();

const laneMesh = (() => {
  const b = new MeshBuilder(1);
  b.mat = "plain";
  b.unlit = true;
  b.fog = 0;
  const c = hex("#00E5FF");
  b.box(-4.6, 0.03, -18, -4.54, 0.05, -10, c);
  b.box(4.54, 0.03, -18, 4.6, 0.05, -10, c);
  b.box(-4.6, 0.03, -14.03, 4.6, 0.05, -13.97, c);
  return renderer.uploadMesh(b);
})();

// ---- Per-frame things

function duellistThings(t: number): MovingThing[] {
  const atOrigin = CAMERAS[state.cam].id === "monkey";
  const clip = state.clip;
  const x = clip === "crab" && !atOrigin ? Math.sin(t * 0.45) * 4.6 : 0;
  duellistRig.play(clip, t, { fade: 0.25 });
  duellistFace.update(clip, t);
  duellistRig.update(t);
  const model = translation(x, 0, -14);
  return [
    {
      mesh: monkeys[state.outfit],
      model,
      character: true,
      shadow: true,
      bones: duellistRig.bones,
      face: {
        mesh: faceSheet,
        model: multiply(model, duellistRig.boneMatrix("head")),
        eye: duellistFace.eye,
        mouth: duellistFace.mouth,
        skin: hex(OUTFITS[state.outfit].skin),
      },
    },
  ];
}

function tumbleThings(t: number, dirIndex: number): MovingThing[] {
  const path = (phase: number, speed: number, z: number, span: number) => {
    const u = ((t * speed + phase) % span) - span / 2;
    const r = 0.62;
    const roll = u / r;
    const bob = Math.abs(Math.sin(roll * 0.7)) * 0.28;
    return multiply(multiply(translation(u, r + bob, z), rotationZ(-roll)), rotationY(phase));
  };
  const mesh = tumbleMeshes[dirIndex];
  return [
    { mesh, model: path(10, 3.1, -24, 60), character: false, shadow: true },
    { mesh, model: path(44, 2.2, -3, 60), character: false, shadow: true },
  ];
}

const HELD_PROJ = perspective(MENU_FOV, ASPECT, 0.05, 20);
const held = { model: identity(), gunBase: identity(), flash: 0 };

/** Arm and pistol in camera space, pointing at the reticle. */
function heldItem(now: number): HeldItem {
  const tanV = Math.tan((MENU_FOV * Math.PI) / 360);
  const tanH = tanV * ASPECT;
  const base: V3 = [0.5, -0.3, -1.2];
  const dist = 12;
  const tx = aim.x * tanH * dist - base[0];
  const ty = aim.y * tanV * dist - base[1];
  const yaw = -Math.atan2(tx, dist);
  const pitch = Math.atan2(ty, Math.hypot(tx, dist));
  // Reload flourish: tips the gun up and in.
  const fl = gunAction.flourish(now);
  let m = translation(base[0] - fl * 0.08, base[1] + fl * 0.12, base[2]);
  m = multiply(m, rotationY(yaw));
  m = multiply(m, rotationX(pitch + fl * 0.75));
  m = multiply(m, rotationZ(0.05 - fl * 0.4));
  m = multiply(m, rotationY(Math.PI / 2));
  m = multiply(m, scaling(0.38, 0.38, 0.38));
  // Inspect view: the arm and gun turning slowly, close up, to check the hand and rig.
  if (state.inspect) {
    const spin = Number(params.get("spin") ?? "NaN");
    const a = Number.isNaN(spin) ? now * 0.6 : spin;
    m = translation(0, -0.02, -1.75);
    m = multiply(m, rotationY(a));
    m = multiply(m, rotationY(Math.PI / 2));
    m = multiply(m, scaling(1.15, 1.15, 1.15));
    m = multiply(m, translation(-0.12, -0.02, 0));
  }
  held.model = m;
  armRig.update(now);
  if (armRig.clipName === "fire" && armRig.progress(now) >= 1) armRig.play("hold", now, { fade: 0.2 });
  const gunBase = multiply(m, armRig.boneMatrix("gun"));
  held.gunBase = gunBase;
  const set = gunSet();
  const mats = gunAction.partMatrices(now, set.parts, gunBase);
  const parts: HeldPart[] = [
    { mesh: set.meshes.body, model: mats.body, gloss: 0.26 },
    { mesh: set.meshes.cylinder, model: mats.cylinder, gloss: 0.34 },
    { mesh: set.meshes.hammer, model: mats.hammer, gloss: 0.3 },
    { mesh: set.meshes.trigger, model: mats.trigger, gloss: 0.3 },
    { mesh: armMesh, model: m, bones: armRig.bones },
  ];
  return { parts, proj: HELD_PROJ, flash: held.flash };
}

function muzzleWorld(cam: Camera): V3 {
  const p = transformPoint(held.gunBase, gunSet().parts.muzzle);
  return transformPoint(invert(cam.view), p);
}

// ---- Shooting

let lastCam: Camera | null = null;
let lastVP = identity();
let lastHeldVP = identity();
const reticleEl = document.getElementById("reticle")!;
const bannerEl = document.getElementById("banner")!;
const flashEl = document.getElementById("flash")!;
let bannerUntil = 0;
let outroAt = 0;

function showBanner(text: string, seconds: number, now: number) {
  bannerEl.textContent = text;
  bannerEl.classList.remove("show");
  void bannerEl.offsetWidth;
  bannerEl.classList.add("show");
  bannerUntil = now + seconds;
}

function fire(now: number) {
  if (!isGallery() || !lastCam) return;
  const g = gallery();
  if (g.starting) return;
  if (now - gunAction.reloadAt < 1.1) return;
  audio.start();
  gunAction.shoot(now);
  armRig.play("hold", now, { fade: 0 });
  armRig.play("fire", now, { fade: 0.02, loop: false });
  updateReticle();
  const { o, d } = g.ray(lastVP, [aim.x, aim.y]);
  const res = g.shoot(o, d, now);
  const muzzle = muzzleWorld(lastCam);
  aim.kick = 1;
  aim.shake = 1;
  held.flash = 1;
  effects.muzzle(muzzle);
  effects.tracer(muzzle, res.point);
  const dir = DIRECTIONS[state.dir];
  if (res.target) {
    effects.hit(res.point, hex(dir.palette.hay));
    showBanner(res.target.message, res.target.kind === "start" ? 3 : 2, now);
    if (res.target.kind === "start") outroAt = now + 3;
  } else {
    effects.miss(res.point, hex(dir.palette.sandPatch));
  }
  audio.shot(!!res.target);
  flashEl.classList.remove("go");
  void flashEl.offsetWidth;
  flashEl.classList.add("go");
  // Out of bullets: spin the cylinder and load up again.
  if (gunAction.shots >= CHAMBERS) {
    window.setTimeout(() => {
      gunAction.reload(lastT);
      updateReticle();
      reticleEl.classList.add("reload");
      window.setTimeout(() => reticleEl.classList.remove("reload"), 1100);
    }, 520);
  }
}

/** The reticle is the gun's cylinder: spent chambers go dark and it clicks round with each shot. */
function buildReticle() {
  const holes: string[] = [];
  for (let i = 0; i < CHAMBERS; i++) {
    const a = (i / CHAMBERS) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * 36;
    const y = Math.sin(a) * 36;
    holes.push(`<g class="ch" transform="translate(${x.toFixed(2)} ${y.toFixed(2)})"><circle class="hole" r="12.5"/><circle class="brass" r="9.5"/><circle class="primer" r="3.2"/></g>`);
  }
  const notches: string[] = [];
  for (let i = 0; i < CHAMBERS; i++) {
    const a = ((i + 0.5) / CHAMBERS) * 360 - 90;
    notches.push(`<path class="notch" d="M50 -5 L60 -7 L60 7 L50 5Z" transform="rotate(${a})"/>`);
  }
  reticleEl.innerHTML = `<svg viewBox="-70 -70 140 140"><g class="spin"><circle class="body" r="53"/>${notches.join("")}${holes.join("")}</g><circle class="pin" r="6"/><path class="tick" d="M0 -68 L0 -56 M0 68 L0 56 M-68 0 L-56 0 M68 0 L56 0"/></svg>`;
  updateReticle();
}

function updateReticle() {
  const spin = reticleEl.querySelector<SVGGElement>(".spin");
  if (!spin) return;
  spin.style.transform = `rotate(${-gunAction.shots * (360 / CHAMBERS)}deg)`;
  reticleEl.querySelectorAll(".ch").forEach((el, i) => el.classList.toggle("spent", i < gunAction.shots));
}

// ---- Frame

let frames = 0;
let lastStats = performance.now();
let lastT = 0;
const statsEl = document.getElementById("stats")!;
const nameEl = document.getElementById("look-name")!;
const tagEl = document.getElementById("look-tag")!;

function renderOne(dirIndex: number, camIndex: number, t: number, vp: [number, number, number, number], gray: boolean, withGallery: boolean) {
  const look = renderer.look(DIRECTIONS[dirIndex]);
  const things: MovingThing[] = [...tumbleThings(t, dirIndex)];
  const cam = CAMERAS[camIndex].make(t);
  let heldOpt: HeldItem | undefined;
  if (withGallery) {
    const g = gallery();
    things.push({ mesh: g.stage, model: identity(), character: false, shadow: false });
    things.push(...g.things(t, cam.eye));
    for (const p of g.sweatPoints) effects.sweat(p);
    heldOpt = heldItem(t);
    lastCam = cam;
    lastVP = multiply(cam.proj, cam.view);
    lastHeldVP = multiply(HELD_PROJ, cam.view);
  }
  if (state.duellist || CAMERAS[camIndex].id === "monkey") things.push(...duellistThings(t));
  if (state.lane) things.push({ mesh: laneMesh, model: identity(), character: false, shadow: false });
  renderer.render(look, cam, vp, things, {
    gray,
    time: t,
    held: heldOpt,
    fx: withGallery ? (m, c) => effects.draw(m, c) && void renderer.drawCalls++ : undefined,
  });
  // Everything drawn: the town plus characters, faces, the held arm and the gun.
  let triangles = look.triangles;
  for (const t of things) triangles += (t.mesh.count + (t.face?.mesh.count ?? 0)) / 3;
  for (const p of heldOpt?.parts ?? []) triangles += p.mesh.count / 3;
  return { triangles };
}

const keys = new Set<string>();

let intro: Intro | null = null;
let introStart = 0;
/** Set from tests: holds the cinematic at one moment, to check a shot. */
let introHold: number | null = null;
let savedWind = 1;
let savedMode: MaterialMode = "painted";

async function playIntro() {
  if (intro) return;
  savedWind = renderer.windScale;
  savedMode = state.mode;
  const hud = document.getElementById("hud")!;
  audio.start();
  audio.setMusic(false);
  intro = await Intro.create(renderer, monkeyGlb, monkeySkel, faceSheet, hud, armGlb);
  intro.onCue = (cue) => audio.sting(cue);
  introStart = performance.now();
  refresh();
}

function endIntro() {
  if (!intro) return;
  intro.dispose();
  intro = null;
  renderer.windScale = savedWind;
  renderer.setMode(savedMode);
  audio.setMusic(state.music);
  state.cam = CAMERAS.findIndex((c) => c.id === "gallery");
  refresh();
  // The title slams in over the live game screen.
  const logo = document.getElementById("logo")!;
  logo.classList.remove("slam");
  void logo.offsetWidth;
  logo.classList.add("slam");
  flashEl.classList.remove("go");
  void flashEl.offsetWidth;
  flashEl.classList.add("go");
}

let rushCheck: RushCheck | null = null;

function frame(ms: number) {
  const t = (window as unknown as { __lookdevTime?: number }).__lookdevTime ?? ms / 1000;
  if (rushCheck) {
    renderer.drawCalls = 0;
    rushCheck.frame(t, canvas.width, canvas.height);
    requestAnimationFrame(frame);
    return;
  }
  if (intro) {
    renderer.drawCalls = 0;
    const local = introHold ?? (performance.now() - introStart) / 1000;
    if (!intro.frame(local, canvas.width, canvas.height)) endIntro();
    requestAnimationFrame(frame);
    return;
  }
  const dt = Math.min(0.05, Math.max(0, t - lastT));
  lastT = t;
  renderer.drawCalls = 0;
  const W = canvas.width;
  const H = canvas.height;
  let triangles = 0;

  // Input and game logic for the gallery.
  if (isGallery() && !state.compare) {
    const g = gallery();
    const kx = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
    const ky = (keys.has("ArrowUp") ? 1 : 0) - (keys.has("ArrowDown") ? 1 : 0);
    if (kx || ky) {
      aim.usingKeys = true;
      aim.x = Math.max(-0.96, Math.min(0.96, aim.x + kx * dt * 0.95));
      aim.y = Math.max(-0.9, Math.min(0.9, aim.y + ky * dt * 1.0));
    }
    const { o, d } = g.ray(lastVP, [aim.x, aim.y]);
    let hover = g.pick(o, d);
    // Remote aim gets help: let go near a target and the reticle settles onto it.
    if (aim.usingKeys && !kx && !ky) {
      let best = null as null | { x: number; y: number; dist: number };
      for (const s of g.targets) {
        if (s.down) continue;
        const p = transformPoint(lastVP, [s.x, 1.5, s.def.z]);
        const dist = Math.hypot(p[0] - aim.x, (p[1] - aim.y) * 0.6);
        if (dist < 0.26 && (!best || dist < best.dist)) best = { x: p[0], y: p[1], dist };
      }
      if (best) {
        aim.x += (best.x - aim.x) * Math.min(1, dt * 9);
        aim.y += (best.y - aim.y) * Math.min(1, dt * 9);
      }
    }
    if (hover?.state.down) hover = null;
    g.update(dt, t, hover?.state ?? null);
    reticleEl.classList.toggle("on", !!hover);
    reticleEl.style.left = `${(aim.x * 0.5 + 0.5) * 1920}px`;
    reticleEl.style.top = `${(0.5 - aim.y * 0.5) * 1080}px`;
    if (outroAt && t > outroAt) {
      outroAt = 0;
      // In the real game this is where the match would start. Here the range just resets.
      g.reset();
    }
    aim.kick *= Math.exp(-dt * 7);
    aim.shake *= Math.exp(-dt * 10);
    held.flash *= Math.exp(-dt * 26);
    effects.update(dt);
  }
  if (t > bannerUntil && bannerEl.classList.contains("show")) bannerEl.classList.remove("show");

  if (state.compare) {
    const w = W / 2;
    const h = H / 2;
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const cam = isGallery() ? 1 : state.cam;
    triangles += renderOne(0, cam, t, [0, h, w, h], false, false).triangles;
    triangles += renderOne(1, cam, t, [w, h, w, h], false, false).triangles;
    triangles += renderOne(2, cam, t, [0, 0, w, h], false, false).triangles;
    renderOne(state.dir, cam, t, [w, 0, w, h], true, false);
  } else {
    triangles = renderOne(state.dir, state.cam, t, [0, 0, W, H], state.gray, isGallery()).triangles;
  }
  frames++;
  const now = performance.now();
  if (now - lastStats > 500) {
    const fps = (frames * 1000) / (now - lastStats);
    statsEl.textContent = `${fps.toFixed(0)} fps · ${renderer.drawCalls} draws · ${(triangles / 1000).toFixed(0)}k tris`;
    frames = 0;
    lastStats = now;
  }
  requestAnimationFrame(frame);
}

// ---- Toolbar

const CLIP_BUTTONS = [
  { id: "idle", label: "Idle" },
  { id: "crab", label: "Crab walk" },
  { id: "shout", label: "Shout" },
  { id: "taunt", label: "Taunt" },
  { id: "hide", label: "Hide" },
  { id: "nervous", label: "Nervous" },
  { id: "draw", label: "Draw" },
  { id: "hit", label: "Hit" },
  { id: "ragdoll", label: "Ragdoll test" },
];

function buttons(host: string, items: { label: string; on: () => void; active: () => boolean }[]) {
  const el = document.getElementById(host)!;
  el.innerHTML = "";
  const nodes = items.map((it) => {
    const b = document.createElement("button");
    b.textContent = it.label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      it.on();
      refresh();
      b.blur();
    });
    el.appendChild(b);
    return { b, it };
  });
  return () => nodes.forEach(({ b, it }) => b.setAttribute("aria-pressed", String(it.active())));
}

const refreshers = [
  buttons(
    "dirs",
    DIRECTIONS.map((d, i) => ({ label: `${i + 1} ${d.name}`, on: () => (state.dir = i), active: () => state.dir === i })),
  ),
  buttons(
    "mats",
    (["flat", "painted", "crisp"] as MaterialMode[]).map((m) => ({
      label: m[0].toUpperCase() + m.slice(1),
      on: () => {
        state.mode = m;
        renderer.setMode(m);
      },
      active: () => state.mode === m,
    })),
  ),
  buttons(
    "cams",
    CAMERAS.map((c, i) => ({ label: c.label, on: () => (state.cam = i), active: () => state.cam === i })),
  ),
  buttons(
    "clips",
    CLIP_BUTTONS.map((c) => ({
      label: c.label,
      on: () => {
        state.clip = c.id;
        state.duellist = true;
        const mi = CAMERAS.findIndex((k) => k.id === "monkey");
        if (CAMERAS[state.cam].id !== "shooter" && CAMERAS[state.cam].id !== "target") state.cam = mi;
      },
      active: () => state.clip === c.id && (state.duellist || CAMERAS[state.cam].id === "monkey"),
    })),
  ),
  buttons("toggles", [
    {
      label: "Play intro",
      on: () => void playIntro(),
      active: () => !!intro,
    },
    {
      label: "Music",
      on: () => {
        state.music = !state.music;
        audio.setMusic(state.music);
      },
      active: () => state.music,
    },
    {
      label: "Wind",
      on: () => {
        state.wind = !state.wind;
        renderer.windScale = state.wind ? 1 : 0;
      },
      active: () => state.wind,
    },
    {
      label: "Inspect arm",
      on: () => {
        state.inspect = !state.inspect;
      },
      active: () => state.inspect,
    },
    {
      label: "Revolver",
      on: () => {
        state.gun = (state.gun + 1) % REVOLVERS.length;
      },
      active: () => false,
    },
    { label: "Duellist", on: () => (state.duellist = !state.duellist), active: () => state.duellist },
    { label: "Lane", on: () => (state.lane = !state.lane), active: () => state.lane },
    { label: "Value check", on: () => (state.gray = !state.gray), active: () => state.gray },
    { label: "Compare", on: () => (state.compare = !state.compare), active: () => state.compare },
    {
      label: "Materials",
      on: () => {
        state.board = !state.board;
        if (state.board) buildBoard();
      },
      active: () => state.board,
    },
  ]),
];

const menuEl = document.getElementById("menu")!;
const boardEl = document.getElementById("board")!;

function refresh() {
  refreshers.forEach((r) => r());
  const d = DIRECTIONS[state.dir];
  nameEl.textContent = d.name;
  tagEl.textContent = d.tagline;
  menuEl.hidden = !(state.ui && !state.compare && isGallery() && !intro);
  document.getElementById("compare-labels")!.hidden = !state.compare;
  document.getElementById("cmp-gray")!.textContent = `Value check: ${d.name}`;
  boardEl.hidden = !state.board;
  if (state.board) buildBoard();
  document.body.classList.toggle("aiming", isGallery() && !state.compare && !state.board);
}

// ---- Materials board

function tileCanvas(t: PixelTex, tint: RGB, px = 168, zoom = 1, cropTo?: [number, number, number, number]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d")!;
  const img = g.createImageData(px, px);
  const [cx, cy, cw, ch] = cropTo ?? [0, 0, t.size, t.size];
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      const sx = (cx + Math.floor(((i / px) * cw) / zoom)) % t.size;
      const sy = (cy + Math.floor(((j / px) * ch) / zoom)) % t.size;
      const so = (sy * t.size + sx) * 4;
      const o = (j * px + i) * 4;
      const a = cropTo ? t.data[so + 3] / 255 : 1;
      const bg = [52, 34, 22];
      for (let k = 0; k < 3; k++) {
        const col = Math.min(255, ((t.data[so + k] * 2) / 255) * tint[k] * 255);
        img.data[o + k] = col * a + bg[k] * (1 - a);
      }
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

let foliageTile: PixelTex | null = null;

function buildBoard() {
  const d = DIRECTIONS[state.dir];
  const P = d.palette;
  const t = textureSet(state.mode);
  foliageTile ??= foliage();
  boardEl.innerHTML = "";
  const h = document.createElement("h2");
  h.textContent = `Materials: ${d.name} (${state.mode})`;
  boardEl.appendChild(h);

  const tiles = document.createElement("div");
  tiles.className = "tiles";
  const add = (label: string, note: string, c: HTMLCanvasElement) => {
    const f = document.createElement("figure");
    f.appendChild(c);
    const cap = document.createElement("figcaption");
    cap.innerHTML = `<b>${label}</b><span>${note}</span>`;
    f.appendChild(cap);
    tiles.appendChild(f);
  };
  add("Sand", "Wind ripples, grit", tileCanvas(t.sand, hex(P.sandPatch)));
  add("Dirt", "Packed clods, cracks", tileCanvas(t.dirt, hex(P.street)));
  add("Wood", "Long grain, knots", tileCanvas(t.wood, hex(P.wallA)));
  add("Rock", "Strata, fractures", tileCanvas(t.rock, hex(P.mesaA)));
  add("Grass", "Painted blade cards", tileCanvas(foliageTile, hex(P.scrub), 168, 1, [0, 0, 256, 256]));
  add("Dry bush", "Branching twigs", tileCanvas(foliageTile, hex(P.twig), 168, 1, [0, 256, 256, 256]));
  boardEl.appendChild(tiles);

  const h3 = document.createElement("h3");
  h3.textContent = "Complementary pairs";
  boardEl.appendChild(h3);
  const pairs = document.createElement("div");
  pairs.className = "pairs";
  for (const p of d.colorStory) {
    const row = document.createElement("div");
    row.className = "pair";
    row.innerHTML = `<i style="background:${p.a}"></i><i style="background:${p.b}"></i><span><b>${p.a} / ${p.b}</b>${p.note}</span>`;
    pairs.appendChild(row);
  }
  boardEl.appendChild(pairs);
}

// ---- Input

const stageEl = document.getElementById("stage")!;
canvas.addEventListener("pointermove", (e) => {
  if (!isGallery()) return;
  const r = canvas.getBoundingClientRect();
  aim.usingKeys = false;
  aim.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
  aim.y = Math.max(-1, Math.min(1, -(((e.clientY - r.top) / r.height) * 2 - 1)));
});
let drag: { x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  audio.start();
  if (isGallery()) {
    if (!intro) fire(lastT);
    return;
  }
  drag = { x: e.clientX, y: e.clientY };
  state.cam = CAMERAS.findIndex((c) => c.id === "free");
  refresh();
});
window.addEventListener("pointerup", () => (drag = null));
window.addEventListener("pointermove", (e) => {
  if (!drag) return;
  orbit.yaw -= (e.clientX - drag.x) * 0.005;
  orbit.pitch = Math.max(0.02, Math.min(1.3, orbit.pitch + (e.clientY - drag.y) * 0.004));
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener(
  "wheel",
  (e) => {
    if (isGallery()) return;
    orbit.dist = Math.max(8, Math.min(240, orbit.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
    e.preventDefault();
  },
  { passive: false },
);

window.addEventListener("keydown", (e) => {
  if (intro) {
    if (e.key === "Enter" || e.key === " ") endIntro();
    return;
  }
  if (e.key >= "1" && e.key <= "9") {
    const i = Number(e.key) - 1;
    if (i < DIRECTIONS.length) {
      state.dir = i;
      refresh();
    }
    return;
  }
  audio.start();
  if (e.key.startsWith("Arrow")) {
    keys.add(e.key);
    e.preventDefault();
    return;
  }
  if ((e.key === "Enter" || e.key === " " || e.key === "f" || e.key === "F") && !e.repeat) {
    fire(lastT);
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key));

(window as unknown as { __lookdev: unknown }).__lookdev = {
  state,
  refresh,
  aim,
  fire: () => fire(lastT),
  playIntro,
  holdIntro: (sec: number | null) => (introHold = sec),
  rush: () => rushCheck,
  gun: gunAction,
  /** For each clip, how far the body pokes in front of the sign. Below 0 means it stays behind. */
  signClearance: () => {
    const rig = new Rig(monkeySkel);
    const points: [string, string, V3][] = [
      ["nose", "head", [0, 1.74, 0.58]],
      ["cheekL", "head", [-0.3, 1.6, 0.5]],
      ["cheekR", "head", [0.3, 1.6, 0.5]],
      ["chin", "head", [0, 1.32, 0.42]],
      ["brim", "hat", [0, 2.08, 0.84]],
      ["handL", "hand.L", [-0.8, 0.3, 0.2]],
      ["handR", "hand.R", [0.8, 0.3, 0.2]],
      ["belly", "spine", [0, 0.92, 0.33]],
    ];
    const out: Record<string, { worst: number; part: string; at: number; duration: number }> = {};
    for (const [name, clip] of monkeySkel.clips) {
      let worst = -Infinity;
      let part = "";
      let at = 0;
      rig.play(name, 0, { fade: 0, loop: true });
      for (let t = 0; t < clip.duration; t += 1 / 24) {
        rig.update(t);
        const sign = rig.boneMatrix("sign");
        const top = transformPoint(sign, [0, 1.26, 0.77]);
        const bottom = transformPoint(sign, [0, 0.58, 0.77]);
        const signZ = Math.min(top[2], bottom[2]);
        const y0 = Math.min(top[1], bottom[1]);
        const y1 = Math.max(top[1], bottom[1]);
        for (const [label, bone, p] of points) {
          const q = transformPoint(rig.boneMatrix(bone), p);
          if (q[1] < y0 || q[1] > y1) continue;
          const d = q[2] - signZ;
          if (d > worst) {
            worst = d;
            part = label;
            at = t;
          }
        }
      }
      out[name] = { worst: Math.round(worst * 100) / 100, part, at: Math.round(at * 10) / 10, duration: clip.duration };
    }
    return out;
  },
  setOutfit: (i: number) => (state.outfit = i),
  clips: () => [...monkeySkel.clips.keys()],
  armClips: () => [...armSkel.clips.keys()],
  stats: () => statsEl.textContent,
  measureCue,
  fxCount: () => effects.count,
  targets: () => gallery().targets.map((t) => ({ id: t.def.id, down: t.down, rag: !!t.rag, mix: t.ragMix, clip: t.rig.clipName })),
  /** Runs a monkey's fall forward at once, to see where it ends up. */
  settle: (seconds: number) => gallery().targets.forEach((t) => t.rag?.settle(seconds)),
  /** Skin stretch under the game's real ragdoll, across many falls. */
  ragdollStretch: () => {
    const buf = monkeyBuffer(monkeyGlb, OUTFITS[0]);
    const view = new DataView(buf.data);
    const names = [...monkeySkel.jointIndex.entries()].reduce<Record<number, string>>((a, [n, j]) => ((a[j] = n), a), {});
    const n = buf.count;
    const pos = new Float32Array(n * 3);
    const joints = new Uint8Array(n * 4);
    const weights = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const o = i * 28;
      for (let c = 0; c < 3; c++) pos[i * 3 + c] = view.getFloat32(o + c * 4, true);
      for (let c = 0; c < 4; c++) {
        joints[i * 4 + c] = view.getUint8(o + 20 + c);
        weights[i * 4 + c] = view.getUint8(o + 24 + c) / 255;
      }
    }
    const skin = new RagdollSkin(MONKEY_LAYOUT, monkeySkel.jointIndex, 24);
    const posed = new Float32Array(n * 3);
    const zones = ["head", "body", "nuts"] as const;
    let worst = 1;
    let worstBones = "";
    let bad = 0;
    let total = 0;
    const perBone: Record<string, number> = {};
    for (const zone of zones) {
      for (let run = 0; run < 6; run++) {
        const rag = new Ragdoll(0, 0, 1);
        const y = zone === "head" ? 1.7 : zone === "nuts" ? 0.62 : 1;
        rag.hit({ zone, landing: { x: (run - 2.5) * 0.12, y, z: 0.3 }, power: 0.4 + run * 0.12 });
        for (const dt of [0.25, 0.25, 0.5, 1, 1.5]) {
          rag.settle(dt);
          skin.update(rag.points, [0, 2, 10], { hatOff: false });
          for (let i = 0; i < n; i++) {
            let x = 0;
            let yy = 0;
            let z = 0;
            for (let c = 0; c < 4; c++) {
              const w = weights[i * 4 + c];
              if (!w) continue;
              const m = joints[i * 4 + c] * 16;
              const B = skin.bones;
              x += w * (B[m] * pos[i * 3] + B[m + 4] * pos[i * 3 + 1] + B[m + 8] * pos[i * 3 + 2] + B[m + 12]);
              yy += w * (B[m + 1] * pos[i * 3] + B[m + 5] * pos[i * 3 + 1] + B[m + 9] * pos[i * 3 + 2] + B[m + 13]);
              z += w * (B[m + 2] * pos[i * 3] + B[m + 6] * pos[i * 3 + 1] + B[m + 10] * pos[i * 3 + 2] + B[m + 14]);
            }
            posed[i * 3] = x;
            posed[i * 3 + 1] = yy;
            posed[i * 3 + 2] = z;
          }
          for (let t = 0; t < n; t += 3) {
            for (let e = 0; e < 3; e++) {
              const a = t + e;
              const b = t + ((e + 1) % 3);
              const r0 = Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
              if (r0 < 0.004) continue;
              const r = Math.hypot(posed[a * 3] - posed[b * 3], posed[a * 3 + 1] - posed[b * 3 + 1], posed[a * 3 + 2] - posed[b * 3 + 2]) / r0;
              total++;
              if (r > 1.8) {
                bad++;
                const name = names[joints[a * 4]];
                perBone[name] = (perBone[name] ?? 0) + 1;
              }
              if (r > worst) {
                worst = r;
                worstBones = `${names[joints[a * 4]]} / ${names[joints[b * 4]]}, ${zone}`;
              }
            }
          }
        }
      }
    }
    return { worst: Math.round(worst * 100) / 100, worstBones, badPct: Math.round((10000 * bad) / total) / 100, perBone };
  },
};
void stageEl;
void lastHeldVP;

buildReticle();
refresh();
requestAnimationFrame(frame);
if (params.get("intro") === "1") void playIntro();
if (params.get("rush") === "1") rushCheck = await RushCheck.create(renderer, renderer.look(DIRECTIONS[0]), monkeyGlb, monkeySkel);
