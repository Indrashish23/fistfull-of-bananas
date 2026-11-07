// The menu as a shooting gallery. Each option is a little lizard outlaw holding a sign: aim, shoot, and
// it falls under the game's own ragdoll physics and triggers its option. No DOM here: main.ts
// handles input, this owns the rules and the animation.

import { buildSign, LIZARDS, lizardBuffer } from "./character";
import { buildLizardFaceSheet, FaceAnim, lizardEye, lizardMouth } from "./faces";
import type { Direction } from "./directions";
import type { Mat4, V3 } from "./gl";
import { invert, multiply, rotationX, rotationY, translation, transformPoint } from "./gl";
import { MAX_BONES, Rig } from "./gltf";
import type { ParsedGlb, Skeleton } from "./gltf";
import { hex, MeshBuilder, mul } from "./mesh";
import type { RGB } from "./mesh";
import type { GpuMesh, MovingThing, Renderer } from "./renderer";
import { hitZone } from "../src/game/rules";
import { MONKEY_LAYOUT, P, Ragdoll } from "../src/render/ragdoll";
import type { V } from "../src/render/ragdoll";
import { RagdollSkin } from "../src/render/ragdollSkin";

export interface TargetDef {
  id: string;
  label: string;
  x: number;
  z: number;
  outfit: number;
  /** "start" topples for good and starts the game. "tease" and "open" don't fall at all. */
  kind: "start" | "tease" | "open";
  message: string;
  /** What this monkey does when you aim at it. Otherwise it just stands idle. */
  behaviour: "hide" | "taunt" | "shout" | "nervous";
}

export const TARGETS: TargetDef[] = [
  { id: "play", label: "PLAY", x: -1.55, z: 4.6, outfit: 0, kind: "start", message: "Here they come!", behaviour: "nervous" },
  { id: "outfits", label: "OUTFITS", x: 1.55, z: 4.6, outfit: 2, kind: "open", message: "Pick your iron!", behaviour: "shout" },
  { id: "settings", label: "SETTINGS", x: -4.65, z: 4.6, outfit: 3, kind: "open", message: "Settings!", behaviour: "shout" },
  { id: "quit", label: "QUIT", x: 4.65, z: 4.6, outfit: 1, kind: "tease", message: "So long, partner!", behaviour: "taunt" },
];

const RISER_Y = 0.26;
/** Platforms the monkeys stand on: [x0, x1, z0, z1]. A body thrown off one drops to the street. */
const RISERS: [number, number, number, number][] = [
  [-6.1, 6.1, 3.9, 5.5],
  [-7.4, -4.6, 1.5, 3.1],
  [4.6, 7.4, 1.5, 3.1],
];
const onRiser = (x: number, z: number) => RISERS.some(([a, b, c, d]) => x > a && x < b && z > c && z < d);

/** Seconds to blend from the animation into the physics, and back when getting up. */
const INTO_RAGDOLL = 0.05;
const GET_UP = 0.8;
const THROW = 0.42;

/** How long a shot one keeps looking scared on its way down, how much it sweats, and how long a tease lasts. */
const PANIC_SEC = 0.55;
const PANIC_SWEAT = 7;
const TEASE_SEC = 2.4;

/** Bones that carry the sign. They follow the hold poses; the rest of the body does its act. */
const SIGN_BONES = ["arm.L", "fore.L", "hand.L", "arm.R", "fore.R", "hand.R", "sign"];

/** The bone whose motion each ragdoll point follows when a fall begins. */
const POINT_BONE: Record<number, string> = {
  [P.pelvis]: "root",
  [P.chest]: "chest",
  [P.head]: "head",
  [P.shL]: "arm.L",
  [P.shR]: "arm.R",
  [P.elL]: "fore.L",
  [P.elR]: "fore.R",
  [P.haL]: "hand.L",
  [P.haR]: "hand.R",
  [P.hipL]: "thigh.L",
  [P.hipR]: "thigh.R",
  [P.knL]: "shin.L",
  [P.knR]: "shin.R",
  [P.ftL]: "shin.L",
  [P.ftR]: "shin.R",
};

interface TargetState {
  def: TargetDef;
  mesh: GpuMesh;
  sign: GpuMesh;
  rig: Rig;
  face: FaceAnim;
  skin: RGB;
  nextSweat: number;
  /** Drops of sweat still to fly off in the burst when it's shot. */
  sweatBurst: number;
  /** Until when it's still mocking you, after being shot at. */
  teaseUntil: number;
  /** Physics body, while falling or lying down. */
  rag: Ragdoll | null;
  ragSkin: RagdollSkin;
  /** 0 is pure animation, 1 is pure physics. */
  ragMix: number;
  /** How much the sign-carrying arm pose applies. */
  signHold: number;
  /** Height of the floor under the body. */
  floorY: number;
  bones: Float32Array;
  down: boolean;
  downT: number;
  hitT: number;
  hover: number;
  x: number;
}

export interface ShotResult {
  point: V3;
  target: TargetDef | null;
}

export class Gallery {
  private lizardFace: GpuMesh;
  targets: TargetState[];
  stage: GpuMesh;
  /** Where sweat comes from, read each frame. */
  sweatPoints: V3[] = [];
  /** Time of the last start-type hit, to run the outro. */
  starting: { def: TargetDef; t: number } | null = null;
  private jointIndex: Map<string, number>;
  private lastThings = 0;

  constructor(renderer: Renderer, dir: Direction, glb: ParsedGlb, skel: Skeleton, _monkeyFace: GpuMesh) {
    this.lizardFace = renderer.uploadMesh(buildLizardFaceSheet());
    this.jointIndex = skel.jointIndex;
    const wood = hex(dir.palette.sign === dir.palette.signAlt ? dir.palette.canvas : "#E9CE9A");
    const ink = hex("#2A1610");
    this.targets = TARGETS.map((def, i) => {
      const buf = lizardBuffer(glb, LIZARDS[def.outfit]);
      const rig = new Rig(skel);
      rig.play("idle", 0, { fade: 0, offset: i * 0.9 });
      return {
        def,
        mesh: renderer.uploadSkinned(buf.data, buf.count),
        sign: renderer.uploadMesh(buildSign({ text: def.label, wood, ink })),
        rig,
        face: new FaceAnim(i),
        skin: hex(LIZARDS[def.outfit].iris),
        nextSweat: 0,
        sweatBurst: 0,
        teaseUntil: -10,
        rag: null,
        ragSkin: new RagdollSkin(MONKEY_LAYOUT, skel.jointIndex, MAX_BONES),
        ragMix: 0,
        signHold: 1,
        floorY: RISER_Y,
        bones: new Float32Array(MAX_BONES * 16),
        down: false,
        downT: 0,
        hitT: -10,
        hover: 0,
        x: def.x,
      };
    });
    this.stage = renderer.uploadMesh(buildStage(dir));
  }

  reset() {
    for (const t of this.targets) {
      t.down = false;
      t.hitT = -10;
      t.teaseUntil = -10;
      t.sweatBurst = 0;
    }
    this.starting = null;
  }

  /** World ray through a screen point (ndc). */
  ray(vp: Mat4, ndc: [number, number]): { o: V3; d: V3 } {
    const inv = invert(vp);
    const a = transformPoint(inv, [ndc[0], ndc[1], -1]);
    const b = transformPoint(inv, [ndc[0], ndc[1], 1]);
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    return { o: a, d: [d[0] / l, d[1] / l, d[2] / l] };
  }

  /** Nearest standing target under a ray, with the hit point on it. */
  pick(o: V3, d: V3): { state: TargetState; point: V3 } | null {
    let best: { state: TargetState; point: V3 } | null = null;
    let bestT = Infinity;
    for (const t of this.targets) {
      if (t.down) continue;
      const tt = (t.def.z - o[2]) / d[2];
      if (tt <= 0 || tt > bestT) continue;
      const px = o[0] + d[0] * tt;
      const py = o[1] + d[1] * tt;
      if (Math.abs(px - t.x) < 1.3 && py > RISER_Y && py < RISER_Y + 2.62) {
        best = { state: t, point: [px, py, t.def.z + 0.6] };
        bestT = tt;
      }
    }
    return best;
  }

  /** Fire along a ray. Returns where it landed and what it hit. */
  shoot(o: V3, d: V3, now: number): ShotResult {
    const hit = this.pick(o, d);
    if (hit) {
      const s = hit.state;
      s.hitT = now;
      if (s.def.kind !== "start") {
        s.teaseUntil = now + TEASE_SEC;
        return { point: hit.point, target: s.def };
      }
      s.sweatBurst = PANIC_SWEAT;
      s.down = true;
      s.downT = now;
      this.startFall(s, hit.point);
      if (s.def.kind === "start" && !this.starting) this.starting = { def: s.def, t: now };
      return { point: hit.point, target: s.def };
    }
    // Lands on the ground, or far away down the street.
    const tg = d[1] < -0.001 ? -o[1] / d[1] : 90;
    const dist = Math.min(tg, 90);
    return { point: [o[0] + d[0] * dist, Math.max(0.05, o[1] + d[1] * dist), o[2] + d[2] * dist], target: null };
  }

  /** Hands a monkey to the physics, starting from the exact pose it's in, so nothing pops. */
  private startFall(s: TargetState, point: V3) {
    s.rig.update(s.hitT);
    const rag = new Ragdoll(s.x, s.def.z, 1);
    const rest = MONKEY_LAYOUT.rest;
    // The ragdoll only exposes its positions, so its velocity memory is reached this way once.
    const previous = (rag as unknown as { previous: V[] }).previous;
    rag.points.forEach((p, i) => {
      const r = rest[i];
      const q = transformPoint(s.rig.boneMatrix(POINT_BONE[i]), [r[0], r[1], r[2]]);
      p[0] = s.x + q[0];
      p[1] = q[1];
      p[2] = s.def.z + q[2];
      previous[i][0] = p[0];
      previous[i][1] = p[1];
      previous[i][2] = p[2];
    });
    const y = point[1] - RISER_Y;
    rag.hit({
      zone: hitZone({ x: point[0], y }, s.x),
      landing: { x: point[0], y, z: s.def.z + 0.3 },
      power: 0.55 + Math.random() * 0.4,
    });
    // The game's throw suits a body 14 units away. This close, it would land out of sight behind
    // the platform, so the gallery keeps only part of it.
    rag.points.forEach((p, i) => {
      const q = previous[i];
      for (let c = 0; c < 3; c++) q[c] = p[c] - (p[c] - q[c]) * THROW;
    });
    s.rag = rag;
    s.ragMix = 0;
  }

  update(dt: number, now: number, hovered: TargetState | null) {
    for (const t of this.targets) {
      t.hover += ((t === hovered ? 1 : 0) - t.hover) * Math.min(1, dt * 12);
      if (t.rag) {
        t.rag.update(dt);
        t.ragMix = t.down ? Math.min(1, t.ragMix + dt / INTO_RAGDOLL) : Math.max(0, t.ragMix - dt / GET_UP);
        const pelvis = t.rag.points[P.pelvis];
        const floor = !t.down || onRiser(pelvis[0], pelvis[2]) ? RISER_Y : 0;
        t.floorY += (floor - t.floorY) * Math.min(1, dt * 9);
        if (!t.down && t.ragMix <= 0) {
          t.rag = null;
          t.floorY = RISER_Y;
        }
      }
    }
  }

  /** eye is optional: a downed monkey's head turns toward it, so its face stays in view. */
  things(now: number, eye?: V3): MovingThing[] {
    const out: MovingThing[] = [];
    this.sweatPoints.length = 0;
    const dtHold = Math.min(0.05, Math.max(0, now - this.lastThings));
    this.lastThings = now;
    this.targets.forEach((t, i) => {
      // Shot: limp, X eyes. Aimed at: does its act. Otherwise: stands idle.
      let clip: string = "idle";
      const teasing = now < t.teaseUntil;
      if ((!t.rag && t.hover > 0.4 && !t.down) || teasing) clip = t.def.behaviour;
      // Just shot: still knows what's happening, for a moment, on the way down.
      const panicking = t.down && now - t.downT < PANIC_SEC;
      // Each time starts somewhere different in the loop, so no two reactions match.
      const offset = clip === "idle" ? i * 0.9 : Math.random() * 6;
      t.rig.play(clip, now, { fade: 0.45, loop: true, offset });
      const scared = clip === "hide" || clip === "nervous" || panicking;
      t.face.update(panicking ? "hide" : t.rag && t.down ? "hit" : clip, now);
      // Carried low until aimed at, then brandished overhead. A hiding monkey has its own hold.
      const aimed = teasing ? 1 : t.hover * t.hover * (3 - 2 * t.hover);
      t.signHold += ((clip === "hide" ? 0 : 1) - t.signHold) * Math.min(1, dtHold * 7);
      t.rig.setLayer(SIGN_BONES, "hold_low", "hold_high", aimed, t.signHold);
      t.rig.update(now);

      // Slow carnival sway, so the row feels alive. The hit box follows it.
      const sway = t.down || t.rag ? 0 : Math.sin(now * 0.42 + i * 1.7) * 0.16;
      if (!t.rag) t.x = t.def.x + sway;
      const yaw = t.rag ? 0 : Math.sin(now * 0.3 + i) * 0.05;
      let model = multiply(translation(t.x, RISER_Y, t.def.z), rotationY(yaw));
      let bones = t.rig.bones;
      let head = t.rig.boneMatrix("head");
      let sign = t.rig.boneMatrix("sign");

      if (t.rag) {
        // The physics works in the world, so animation is brought into world space to blend.
        const look: V3 = eye ?? [t.x, 2, t.def.z + 10];
        t.ragSkin.update(t.rag.points, look, { hatOff: false });
        const standing = translation(t.x, 0, t.def.z);
        const k = t.ragMix * t.ragMix * (3 - 2 * t.ragMix);
        const count = t.bones.length / 16;
        for (let b = 0; b < count; b++) {
          const anim = t.rig.bones.subarray(b * 16, b * 16 + 16) as unknown as Mat4;
          const moved = multiply(standing, anim);
          for (let c = 0; c < 16; c++) t.bones[b * 16 + c] = moved[c] + (t.ragSkin.bones[b * 16 + c] - moved[c]) * k;
        }
        bones = t.bones;
        model = translation(0, t.floorY, 0);
        const slice = (name: string): Mat4 => {
          const j = this.jointIndex.get(name)!;
          return bones.slice(j * 16, j * 16 + 16) as Mat4;
        };
        head = slice("head");
        sign = slice("sign");
      }

      out.push({
        mesh: t.mesh,
        model,
        character: true,
        shadow: true,
        bones,
        groundY: t.floorY,
        face: {
          mesh: this.lizardFace,
          model: multiply(model, head),
          eye: lizardEye(t.face.eye),
          mouth: lizardMouth(t.face.mouth),
          skin: t.skin,
          plate: "blank",
        },
      });
      out.push({
        mesh: t.sign,
        model: multiply(model, sign),
        character: true,
        shadow: true,
        toon: true,
        groundY: t.floorY,
        // Letters light up when aimed at, with a slight unevenness like old bulbs.
        lit: t.down ? 0 : t.hover * (0.88 + 0.12 * Math.sin(now * 9 + i * 2) * Math.sin(now * 5.3 + i)),
      });

      const h = multiply(model, head);
      const drop = (spread: number): V3 => {
        const side = Math.random() < 0.5 ? -1 : 1;
        return transformPoint(h, [side * (0.42 + Math.random() * spread), 2.0 + Math.random() * spread, 0.3]);
      };
      if (scared && now > t.nextSweat) {
        t.nextSweat = now + (panicking ? 0.08 : 0.26 + Math.random() * 0.34);
        this.sweatPoints.push(drop(0));
      }
      for (; t.sweatBurst > 0; t.sweatBurst--) this.sweatPoints.push(drop(0.3));
    });
    return out;
  }
}

/** The riser the monkeys stand on, and the counter you're shooting over. */
function buildStage(dir: Direction): MeshBuilder {
  const b = new MeshBuilder(404);
  const boards = hex(dir.palette.boards);
  const dark = hex(dir.palette.trimDark);
  const post = hex(dir.palette.post);
  // Riser under the two main targets, and two smaller ones for the toggles.
  const riser = (x0: number, x1: number, z0: number, z1: number) => {
    const n = Math.round((x1 - x0) / 0.62);
    for (let i = 0; i < n; i++) {
      const xa = x0 + ((x1 - x0) * i) / n;
      const xb = x0 + ((x1 - x0) * (i + 1)) / n - 0.03;
      b.grain = "z";
      b.randUV();
      const c = b.jitter(boards, 0.14);
      const over = b.rng.range(0, 0.12);
      b.quad([xa, RISER_Y, z1 + over], [xb, RISER_Y, z1 + over], [xb, RISER_Y, z0], [xa, RISER_Y, z0], c);
      b.quad([xa, RISER_Y - 0.1, z1 + over], [xb, RISER_Y - 0.1, z1 + over], [xb, RISER_Y, z1 + over], [xa, RISER_Y, z1 + over], mul(c, 0.8));
    }
    b.box(x0, 0, z1 - 0.2, x1, RISER_Y - 0.06, z1, dark, { skip: "-y", ao: 0.7 });
    b.box(x0, 0, z0, x0 + 0.1, RISER_Y - 0.02, z1, dark, { skip: "-y" });
    b.box(x1 - 0.1, 0, z0, x1, RISER_Y - 0.02, z1, dark, { skip: "-y" });
  };
  riser(-6.1, 6.1, 3.9, 5.5);
  riser(-7.4, -4.6, 1.5, 3.1);
  riser(4.6, 7.4, 1.5, 3.1);
  // Counter you're shooting over: chunky plank top on log posts, with a painted front.
  const z0 = 11.3;
  const z1 = 12.3;
  const y = 0.82;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const zA = z0 + ((z1 - z0) * i) / n;
    const zB = z0 + ((z1 - z0) * (i + 1)) / n - 0.02;
    b.grain = "x";
    b.randUV();
    const c = b.jitter(boards, 0.12);
    const o0 = b.rng.range(0, 0.3);
    const o1 = b.rng.range(0, 0.3);
    b.box(-8.2 - o0, y - 0.11, zA, 8.2 + o1, y, zB, c, { skip: "-y" });
  }
  for (const x of [-7.6, -2.5, 2.5, 7.6]) {
    b.beam([x, 0, z0 + 0.03], [x, y - 0.1, z0 + 0.03], 0.3, post, { caps: false, round: true, jit: 0.1 });
  }
  return b;
}
