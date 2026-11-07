// The stylized x-ray kill cam for headshots, nut shots and lucky body hits. It runs in its own little
// space around the origin, away from the street: an impact frame, then a glowing x-ray
// where the bullet creeps in and the skull, or a pair of walnuts, shatters in slow motion.

import { KILLCAM, clamp, lerp, type XrayKind } from "../game/rules";
import { drawLooseHat, type Palette } from "./character";
import type { Camera, Look, Renderer } from "./gl";
import { Stack, frustum, lookAt, type V3 } from "./mat";
import type { Meshes } from "./meshes";

const NAVY: V3 = [0.03, 0.09, 0.2];
const GHOST: V3 = [0.05, 0.17, 0.32];
const CYAN: V3 = [0.42, 0.93, 1];
const INK: V3 = [0.05, 0.05, 0.1];
const BONE: V3 = [0.97, 0.93, 0.78];
const SOCKET: V3 = [0.06, 0.07, 0.13];
const HOT: V3 = [1, 0.62, 0.14];
const GOLD: V3 = [1, 0.83, 0.2];
const WALNUT: V3 = [0.68, 0.43, 0.2];
const WALNUT_DARK: V3 = [0.36, 0.2, 0.1];
const HEART: V3 = [0.9, 0.16, 0.2];
const HEART_DARK: V3 = [0.58, 0.07, 0.12];
const BULLET: V3 = [1, 0.68, 0.18];
const BRASS: V3 = [0.86, 0.63, 0.25];

const LOOK: Look = {
  sun: [0, 0, 1],
  light: normalized([0.55, 0.6, 0.6]),
  fogColor: NAVY,
  fog: [1000, 2000],
  skyTop: NAVY,
  skyMid: NAVY,
  skyLow: NAVY,
  sunColor: NAVY,
};

const GHOST_PALETTE: Palette = {
  skin: GHOST, shirt: GHOST, poncho: GHOST, accent: GHOST, pants: GHOST,
  boots: GHOST, hat: GHOST, band: GHOST, hair: GHOST,
};

const INK_PALETTE: Palette = {
  skin: INK, shirt: INK, poncho: INK, accent: INK, pants: INK,
  boots: INK, hat: INK, band: INK, hair: INK,
};

const WHITE_PALETTE: Palette = {
  skin: [1, 1, 1], shirt: [1, 1, 1], poncho: [1, 1, 1], accent: [1, 1, 1], pants: [1, 1, 1],
  boots: [1, 1, 1], hat: [1, 1, 1], band: [1, 1, 1], hair: [1, 1, 1],
};

/** Only one light-dark swap, then none for anyone who has asked for less motion. */
const reducedMotion = (): boolean =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export type Emit = (
  x: number, y: number, z: number,
  vx: number, vy: number, vz: number,
  color: V3, size: number, life: number, gravity: number, drag: number,
) => void;

export type KillZone = "head" | "nuts" | "chest";

/** How far up or down each part's bullet comes in, and how far forward. */
const AIM: Record<KillZone, { x: number; y: number; z: number }> = {
  head: { x: 0, y: 0, z: 0 },
  nuts: { x: 0, y: -0.14, z: 0.14 },
  chest: { x: 0, y: 0.1, z: 0.1 },
};

/** A shot with its own framing: the camera's path, what it looks at, where the bullet's from and where it hits. */
interface XrayAngle {
  eye0: V3;
  eye1: V3;
  target: V3;
  from: V3;
  aim: { x: number; y: number; z: number };
  /** Goes all the way through, whatever else is true. */
  through?: boolean;
}

/** The shots that don't use the standard three-quarter view. Each one's seen from somewhere different. */
const XRAY_ANGLES: Partial<Record<XrayKind, XrayAngle>> = {
  // In one temple and out the other, looking back down the snout at it.
  temple: { eye0: [0.3, 0.42, 5.1], eye1: [0.2, 0.28, 4.2], target: [0, 0.1, 0.1], from: [1, 0.08, 0.05], aim: { x: 0, y: 0.18, z: -0.05 }, through: true },
  // Right up close, over the bullet's shoulder, into the socket.
  eye: { eye0: [1.5, 0.78, 3.7], eye1: [0.72, 0.42, 2.05], target: [0.28, 0.24, 0.26], from: [0.35, 0.15, 1], aim: { x: 0.28, y: 0.24, z: 0.28 } },
  // From down low, as it comes up under the chin.
  jaw: { eye0: [3.4, -1.6, 2.6], eye1: [2.75, -1.2, 2], target: [0, -0.3, 0.5], from: [0.12, -0.75, 0.65], aim: { x: 0, y: -0.46, z: 0.62 } },
  // Looking down from above, as it comes through the top.
  crown: { eye0: [1.2, 4.6, 1.8], eye1: [0.9, 3.9, 1.25], target: [0, 0.1, 0.15], from: [0.12, 0.92, 0.38], aim: { x: 0, y: 0.62, z: -0.1 } },
  // Tight on the chest, with the heart front and centre.
  heart: { eye0: [0.6, 0.58, 2.6], eye1: [0.2, 0.3, 1.7], target: [-0.03, 0.14, 0.34], from: [-0.04, 0.06, 1], aim: { x: -0.03, y: 0.14, z: 0.34 } },
  // From behind, as it comes out through the backbone at you.
  spine: { eye0: [-1.7, 0.72, -3.2], eye1: [-1.15, 0.4, -2.45], target: [0, 0.1, -0.1], from: [0.06, 0.04, 1], aim: { x: 0, y: 0.1, z: -0.2 }, through: true },
  // From knee height, for the full horror of it.
  cracker: { eye0: [0.62, -1.42, 2.6], eye1: [0.34, -1.08, 1.9], target: [0, -0.12, 0.14], from: [0.1, -0.3, 1], aim: { x: 0, y: -0.14, z: 0.14 } },
};

export interface KillCamShot {
  zone: KillZone;
  /** A lizard's head rather than a monkey's: a long snout, and teeth. */
  lizard?: boolean;
  /** Whether the bullet tears out the far side and carries on, rather than stopping inside. */
  pierce?: boolean;
  /** Which x-ray this is. Left out, it's the standard view of whatever was hit. */
  xray?: XrayKind;
  /** Where it landed, -1..1 across the part that was hit, so the bullet comes in true. */
  offsetX: number;
  offsetY: number;
  power: number;
}

export class KillCam {
  private readonly s = new Stack();
  private contactDone = false;
  private exitDone = false;

  constructor(
    private readonly r: Renderer,
    private readonly m: Meshes,
  ) {}

  /** Call when a new kill cam starts. */
  reset(): void {
    this.contactDone = false;
    this.exitDone = false;
  }

  /** The white-on-black or black-on-white beat at the instant of impact. */
  renderFrame(shot: KillCamShot, t: number): void {
    const dark = !reducedMotion() && t >= KILLCAM.frameSwapSec;
    const { r } = this;
    if (dark) r.clearTo(0, 0, 0);
    else r.clearTo(1, 1, 1);
    const camera = cameraFor(shot, 0);
    r.useCamera(camera, LOOK);
    const color: V3 = dark ? [1, 1, 1] : [0, 0, 0];
    r.outlineColor = color;
    if (shot.zone === "head" && shot.lizard) {
      this.drawLizardShell(color, dark ? WHITE_PALETTE : INK_PALETTE);
    } else if (shot.zone === "head") {
      this.drawShell(color, dark ? WHITE_PALETTE : INK_PALETTE);
    } else if (shot.zone === "chest") {
      this.drawTorso(color, true);
    } else {
      this.drawHips(color, true);
    }
    r.resetOutlineColor();
  }

  /** The x-ray itself, from the moment after the impact frame. */
  renderXray(shot: KillCamShot, t: number, emit: Emit): void {
    const { r } = this;
    const u = clamp((t - KILLCAM.frameSec) / (KILLCAM.contactSec - KILLCAM.frameSec), 0, 1);
    const since = t - KILLCAM.contactSec;

    r.clearTo(NAVY[0], NAVY[1], NAVY[2]);
    const camera = this.cameraAt(shot, t);
    r.useCamera(camera, LOOK);

    // The ghost of the body: dark with a glowing outline.
    r.outlineColor = CYAN;
    if (shot.zone === "head" && shot.lizard) this.drawLizardShell(GHOST, GHOST_PALETTE);
    else if (shot.zone === "head") this.drawShell(GHOST, GHOST_PALETTE);
    else if (shot.zone === "chest") this.drawTorso(GHOST, false);
    else this.drawHips(GHOST, false);
    r.resetOutlineColor();

    // Bones draw over the ghost, however deep they sit.
    r.clearDepth();

    const dir = incoming(shot);
    if (!this.contactDone && since >= 0) {
      this.contactDone = true;
      this.burst(dir, shot, emit);
    }
    if (shot.zone === "head" && shot.lizard) this.drawLizardSkull(dir, since, emit, shot.xray);
    else if (shot.zone === "head") this.drawSkull(dir, since);
    else if (shot.zone === "chest") this.drawRibs(dir, since, shot.xray);
    else this.drawNuts(dir, since);

    // The bullet creeps in, then carries on through.
    // A lizard's skull gets the slowest pass: the bullet crawls in one side and out the other.
    // One that's going all the way moves faster, so it's out the far side with time left to see it.
    const angle = shot.xray ? XRAY_ANGLES[shot.xray] : undefined;
    const pierce = shot.pierce || angle?.through === true;
    const through = pierce ? 1.3 : shot.lizard && shot.zone === "head" ? 0.8 : 0.62;
    const { x: aimX, y: aimY, z: aimZ } = angle?.aim ?? AIM[shot.zone];
    // Most stop inside, where they did their damage. A piercing one crawls through, then tears out the
    // far side and flies off.
    let distance = since < 0 ? lerp(2.8, 0.58, u) : 0.58 - since * through;
    if (!pierce) distance = Math.max(distance, -0.02);
    else if (distance < EXIT_AT) {
      const out = EXIT_AT - distance;
      distance = EXIT_AT - out * (1 + out * 26);
      if (!this.exitDone) {
        this.exitDone = true;
        this.exitBurst(dir, shot, aimX, aimY, aimZ, emit);
      }
      this.drawPop(dir, 0.05 + out * 0.35, aimX + dir[0] * EXIT_POP, aimY + dir[1] * EXIT_POP, aimZ + dir[2] * EXIT_POP);
    }
    if (distance > -5) this.drawBullet(dir, distance, shot.power, aimX, aimY, aimZ);
    this.drawPop(dir, since, aimX, aimY, aimZ);
  }

  /** The kill cam's camera at this moment, so particles line up with it. */
  cameraAt(shot: KillCamShot, t: number): Camera {
    return cameraFor(shot, clamp(t / 1.6, 0, 1));
  }

  /** The bullet coming out the back: bits of whatever it hit, thrown after it. */
  private exitBurst(dir: V3, shot: KillCamShot, aimX: number, aimY: number, aimZ: number, emit: Emit): void {
    const chip = shot.zone === "nuts" ? WALNUT : shot.zone === "chest" ? HEART : BONE;
    const x = dir[0] * EXIT_AT + aimX, y = dir[1] * EXIT_AT + aimY, z = dir[2] * EXIT_AT + aimZ;
    for (let i = 0; i < 44; i++) {
      const spread = 0.9;
      const speed = 1.4 + Math.random() * 2.8;
      emit(x, y, z,
        -dir[0] * speed + (Math.random() - 0.5) * spread,
        -dir[1] * speed + (Math.random() - 0.5) * spread,
        -dir[2] * speed + (Math.random() - 0.5) * spread,
        i % 3 === 0 ? GOLD : i % 3 === 1 ? chip : HOT,
        0.03 + Math.random() * 0.06, 0.5 + Math.random() * 0.9, 0.6, 0.8);
    }
  }

  /** Chips and sparks at the moment of contact. */
  private burst(dir: V3, shot: KillCamShot, emit: Emit): void {
    const chip = shot.zone === "nuts" ? WALNUT : shot.zone === "chest" ? HEART : BONE;
    const aim = (shot.xray ? XRAY_ANGLES[shot.xray]?.aim : undefined) ?? AIM[shot.zone];
    const x = dir[0] * 0.5 + aim.x, y = dir[1] * 0.5 + aim.y, z = dir[2] * 0.5 + aim.z;
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 1.9;
      const color = i % 3 === 0 ? GOLD : i % 3 === 1 ? chip : HOT;
      emit(x, y, z,
        Math.cos(a) * speed + dir[0], Math.sin(a) * speed + dir[1], dir[2] * (0.4 + Math.random()),
        color, 0.03 + Math.random() * 0.05, 0.5 + Math.random() * 1, 0.6, 1);
    }
  }

  /** The head's shell, with the character's own hat on it. */
  private drawShell(color: V3, palette: Palette): void {
    const { r, m, s } = this;
    s.reset().scale(1.26, 1.14, 1.16);
    r.draw(m.ball, s.top, color, { unlit: true, outline: 0.04 });
    s.reset().translate(0, -0.72, 0).scale(0.26, 0.4, 0.26);
    r.draw(m.hex, s.top, color, { unlit: true, outline: 0.03 });
    s.reset();
    drawLooseHat(r, m, s, palette);
  }

  /** The ghost of the hips and thighs. */
  private drawHips(color: V3, flat: boolean): void {
    const { r, m, s } = this;
    const o = flat ? 0 : 0.04;
    s.reset().translate(0, 0.3, 0).scale(1.26, 0.82, 0.74);
    r.draw(m.cube, s.top, color, { unlit: true, outline: o });
    for (const side of [-1, 1]) {
      s.reset().translate(side * 0.36, -0.7, 0).rotZ(side * 0.08).scale(0.52, 1.4, 0.56);
      r.draw(m.cube, s.top, color, { unlit: true, outline: o });
    }
  }

  /** The ghost of the chest and shoulders. */
  private drawTorso(color: V3, flat: boolean): void {
    const { r, m, s } = this;
    const o = flat ? 0 : 0.04;
    s.reset().translate(0, 0.05, 0).scale(1.34, 1.72, 0.82);
    r.draw(m.cube, s.top, color, { unlit: true, outline: o });
    for (const side of [-1, 1]) {
      s.reset().translate(side * 0.84, 0.42, 0).rotZ(side * 0.5).scale(0.38, 0.94, 0.42);
      r.draw(m.cube, s.top, color, { unlit: true, outline: o });
    }
  }

  /** A ribcage that snaps away from the bullet, with a heart that pops. */
  private drawRibs(dir: V3, hitSince: number, xray?: XrayKind): void {
    const { r, m, s } = this;
    r.outlineColor = INK;
    // Through the heart, it goes first and the ribs follow.
    const since = xray === "heart" ? hitSince - 0.22 : hitSince;
    const heartSize = xray === "heart" ? 0.56 : 0.34;

    if (xray === "spine") {
      // The backbone in its separate bones, going one after another from where it was hit.
      for (let i = 0; i < 9; i++) {
        const y = 0.75 - i * 0.17;
        const f = hitSince - Math.abs(y - 0.1) * 0.5;
        const fly = f > 0 ? easeOut(f / 0.9) : 0;
        const side = i % 2 === 0 ? 1 : -1;
        s.reset().translate(side * fly * (0.25 + i * 0.05), y - fly * fly * 0.3, -0.2 - fly * 0.7);
        s.rotX(fly * 2.6 * side).rotZ(fly * 1.8).scale(0.2, 0.075, 0.18);
        r.draw(m.cube, s.top, f > 0 ? mix(BONE, HOT, clamp(1 - f / 0.5, 0, 1)) : BONE, { outline: 0.01 });
      }
    } else {
      s.reset().translate(0, 0.05, -0.2).scale(0.2, 1.5, 0.2);
      r.draw(m.hex, s.top, BONE, { outline: 0.012 });
    }

    const levels = 6;
    for (let level = 0; level < levels; level++) {
      const y = 0.62 - level * 0.2;
      // The ribs nearest the bullet's height go first.
      const f = since - Math.abs(y - 0.1) * 0.12;
      const fly = f > 0.05 ? easeOut((f - 0.05) / 0.9) : 0;
      for (const side of [-1, 1]) {
        const out = fly * (0.5 + ((level * 7 + side + 3) % 5) * 0.14);
        const width = 0.56 - Math.abs(level - 2) * 0.03;
        s.reset().translate(side * (0.36 + out), y + fly * (0.26 - level * 0.08) - fly * fly * 0.26, 0.12 + out * 0.6);
        s.rotZ(side * (-0.28 - fly * (2.4 + level * 0.4)));
        s.scale(width, 0.075, 0.3);
        r.draw(m.cube, s.top, f > 0 ? mix(BONE, HOT, clamp(1 - f / 0.5, 0, 1)) : BONE, { outline: 0.01 });
      }
    }

    const shards = m.shards;
    for (let i = 0; i < shards.length; i++) {
      const shard = shards[i]!;
      const heat = this.placeShard(shard, i, dir, hitSince, -0.03, 0.14, heartSize, xray === "heart" ? 0.2 : 0.06);
      const flesh = i % 2 === 0 ? HEART : HEART_DARK;
      r.draw(shard.mesh, s.top, mix(flesh, HOT, heat), { outline: 0.012 });
    }
    r.resetOutlineColor();
  }

  /** A lizard's head: a round cranium with a long snout out the front, and the character's hat. */
  private drawLizardShell(color: V3, palette: Palette): void {
    const { r, m, s } = this;
    s.reset().translate(0, 0.12, -0.12).scale(1.1, 0.92, 1.16);
    r.draw(m.ball, s.top, color, { unlit: true, outline: 0.04 });
    s.reset().translate(0, -0.14, 0.72).scale(0.76, 0.5, 1.26);
    r.draw(m.ball, s.top, color, { unlit: true, outline: 0.04 });
    s.reset().translate(0, -0.44, 0.5).scale(0.66, 0.2, 1.1);
    r.draw(m.ball, s.top, color, { unlit: true, outline: 0.03 });
    s.reset().translate(0, -0.72, -0.2).scale(0.3, 0.44, 0.3);
    r.draw(m.hex, s.top, color, { unlit: true, outline: 0.03 });
    s.reset();
    drawLooseHat(r, m, s, palette);
  }

  /**
   * A lizard's skull, in dozens of pieces: the cranium, the long snout, a row of fangs and a jaw
   * that drops. Each piece cracks as the bullet reaches it, so the break follows it through.
   */
  private drawLizardSkull(dir: V3, hitSince: number, emit: Emit, xray?: XrayKind): void {
    const { r, m, s } = this;
    r.outlineColor = INK;
    const pieces = m.fineShards;
    // The bone goes from wherever it was hit: a shot to the jaw reaches the top of the head last.
    const since = xray === "jaw" ? hitSince - 0.42 : xray === "eye" ? hitSince - 0.14 : hitSince;

    const part = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, seed: number): void => {
      for (let i = 0; i < pieces.length; i++) {
        const shard = pieces[i]!;
        const heat = this.placeShard(shard, i + seed, dir, since, cx, cy, 1, cz, [sx, sy, sz]);
        const bone = (i + seed) % 3 === 0 ? mix(BONE, SOCKET, 0.1) : BONE;
        r.draw(shard.mesh, s.top, mix(bone, HOT, heat), { outline: 0.008 });
      }
    };
    part(0, 0.12, -0.1, 0.92, 0.76, 0.98, 0);
    part(0, -0.12, 0.72, 0.6, 0.38, 1.08, 40);

    // Sockets and nostrils ride on the piece of bone they sit on, and fly with it.
    for (const f of LIZARD_FEATURES) {
      const index = f.shard(pieces);
      const shard = pieces[index]!;
      const [cx, cy, cz, sx, sy, sz, seed] = f.onSnout
        ? [0, -0.12, 0.72, 0.6, 0.38, 1.08, 40] as const
        : [0, 0.12, -0.1, 0.92, 0.76, 0.98, 0] as const;
      this.placeShard(shard, index + seed, dir, since, cx, cy, 1, cz, [sx, sy, sz]);
      s.translate(f.x, f.y, f.z).scale(f.sx, f.sy, f.sz);
      r.draw(m.smallBall, s.top, SOCKET, { unlit: true });
    }

    // The upper fangs snap away one at a time.
    for (let i = 0; i < FANGS; i++) {
      for (const side of [-1, 1]) {
        const along = i / (FANGS - 1);
        const f = (xray === "jaw" ? hitSince : since) - 0.04 - i * 0.03;
        const fly = f > 0 ? easeOut(f / 0.9) : 0;
        const x = side * lerp(0.3, 0.1, along);
        const z = lerp(0.42, 1.2, along);
        s.reset().translate(x * (1 + fly * 2.2), -0.34 - fly * (0.5 + i * 0.1) - fly * fly * 0.5, z + fly * 0.4);
        s.rotZ(Math.PI + fly * side * 3).rotX(fly * 2).scale(0.09, 0.2, 0.09);
        r.draw(m.cone, s.top, BONE, { outline: 0.008 });
      }
    }

    // The jaw comes away and drops, with its own teeth. Hit square on, it's knocked clean off.
    const jawHit = xray === "jaw";
    const fall = jawHit ? ease(hitSince / 0.6) : since > 0.1 ? ease((since - 0.1) / 1.1) : 0;
    s.reset().translate(jawHit ? fall * 0.5 : 0, -0.5 - fall * (jawHit ? 1.5 : 0.95), 0.42 + fall * (jawHit ? 0.9 : 0.2)).rotX(fall * (jawHit ? 2.2 : 0.7));
    if (jawHit) s.rotZ(fall * 0.9);
    s.push().scale(0.62, 0.13, 1.1);
    r.draw(m.cube, s.top, BONE, { outline: 0.012 });
    s.pop();
    for (let i = 0; i < FANGS; i++) {
      for (const side of [-1, 1]) {
        const along = i / (FANGS - 1);
        s.push().translate(side * lerp(0.26, 0.09, along), 0.14, lerp(-0.34, 0.46, along)).scale(0.07, 0.16, 0.07);
        r.draw(m.cone, s.top, BONE, { outline: 0.006 });
        s.pop();
      }
    }

    // Hit in the eye, it pops out and goes flying, and the other one just watches.
    if (xray === "eye") {
      for (const side of [1, -1]) {
        const out = side > 0 && hitSince > 0 ? easeOut(hitSince / 0.8) : 0;
        const drop = out * out * 0.8;
        const x = side * 0.28 + out * 1.1;
        const y = 0.24 + out * 0.7 - drop;
        const z = 0.34 + out * 1.3;
        s.reset().translate(x, y, z).rotX(out * 5).rotZ(out * 3);
        s.push().scale(0.2);
        r.draw(m.smallBall, s.top, side > 0 && hitSince > 0 ? mix(BONE, HOT, clamp(1 - hitSince / 0.5, 0, 1)) : BONE, { outline: 0.01 });
        s.pop();
        s.push().translate(0, 0, 0.16).scale(0.09);
        r.draw(m.smallBall, s.top, GOLD, { unlit: true });
        s.pop();
      }
    }

    // Chips keep spitting out behind the bullet as it goes through.
    if (since > 0 && since < 0.9 && Math.random() < 0.7) {
      const along = 0.58 - since * 0.8;
      emit(dir[0] * along, dir[1] * along, dir[2] * along,
        (Math.random() - 0.5) * 2.4 + dir[0], (Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.4 - dir[2] * 1.4,
        Math.random() < 0.5 ? BONE : HOT, 0.025 + Math.random() * 0.04, 0.4 + Math.random() * 0.6, 0.6, 1);
    }
    r.resetOutlineColor();
  }

  private drawSkull(dir: V3, since: number): void {
    const { r, m, s } = this;
    r.outlineColor = INK;
    const scale = 0.95;
    const shards = m.shards;

    // Sockets, nose and teeth ride on the piece of skull they sit on.
    for (let i = 0; i < shards.length; i++) {
      const shard = shards[i]!;
      const heat = this.placeShard(shard, i, dir, since, 0, 0, scale);
      r.draw(shard.mesh, s.top, mix(BONE, HOT, heat), { outline: 0.012 });
      for (const feature of FEATURES) {
        if (feature.shard(shards) !== i) continue;
        s.push();
        s.translate(feature.x, feature.y, feature.z).scale(feature.sx, feature.sy, feature.sz);
        r.draw(feature.teeth ? m.cube : m.smallBall, s.top, feature.teeth ? BONE : SOCKET, {
          unlit: !feature.teeth,
          outline: feature.teeth ? 0.008 : undefined,
        });
        s.pop();
      }
    }

    // The jaw comes away and drops.
    const fall = since > 0.12 ? ease((since - 0.12) / 1.1) : 0;
    s.reset().translate(0, -0.46 - fall * 0.85, 0.1 + fall * 0.12).rotX(fall * 0.55);
    s.push().scale(0.62, 0.15, 0.56);
    r.draw(m.cube, s.top, BONE, { outline: 0.012 });
    s.pop();
    for (let i = -3; i <= 3; i++) {
      s.push().translate(i * 0.074, 0.1, 0.25).scale(0.058, 0.09, 0.05);
      r.draw(m.cube, s.top, BONE, { outline: 0.008 });
      s.pop();
    }
    r.resetOutlineColor();
  }

  private drawNuts(dir: V3, since: number): void {
    const { r, m, s } = this;
    r.outlineColor = INK;

    // A cartoon pelvis, as a frame for the joke.
    for (const side of [-1, 1]) {
      s.reset().translate(side * 0.42, 0.32, -0.08).rotZ(side * -0.55).scale(0.62, 0.34, 0.14);
      r.draw(m.cube, s.top, BONE, { outline: 0.012 });
      s.reset().translate(side * 0.44, -0.72, -0.05).rotZ(side * 0.08).scale(0.18, 1.34, 0.18);
      r.draw(m.cylinder, s.top, BONE, { outline: 0.012 });
      s.reset().translate(side * 0.46, -0.04, -0.05).scale(0.28);
      r.draw(m.smallBall, s.top, BONE, { outline: 0.012 });
    }
    s.reset().translate(0, 0.72, -0.12).scale(0.22, 0.6, 0.2);
    r.draw(m.hex, s.top, BONE, { outline: 0.012 });

    // The stars of the show, a second apart in their suffering.
    const shards = m.shards;
    for (const [side, delay] of [[-1, 0], [1, 0.07]] as const) {
      const cx = side * 0.2, cy = -0.14, cz = 0.14;
      for (let i = 0; i < shards.length; i++) {
        const shard = shards[i]!;
        const heat = this.placeShard(shard, i + (side > 0 ? 5 : 0), dir, since - delay, cx, cy, 0.42, cz);
        // Wrinkled, by shading every other piece.
        const shell = i % 2 === 0 ? WALNUT : mix(WALNUT, WALNUT_DARK, 0.45);
        r.draw(shard.mesh, s.top, mix(shell, HOT, heat), { outline: 0.012 });
      }
    }
    r.resetOutlineColor();
  }

  /**
   * Puts the stack on one piece of a shattering ball. Pieces near the hit go first, and
   * each one first opens a thin crack, holds, then flies. Returns how hot it glows, 0..1.
   */
  private placeShard(
    shard: Meshes["shards"][number],
    index: number,
    dir: V3,
    since: number,
    cx: number,
    cy: number,
    scale: number,
    cz = 0,
    shape: readonly [number, number, number] = [1, 1, 1],
  ): number {
    const { s } = this;
    const facing = shard.dir[0] * dir[0] + shard.dir[1] * dir[1] + shard.dir[2] * dir[2];
    const delay = ((1 - facing) / 2) * 0.2;
    const f = since - delay;
    const crack = f > 0 ? ease(f / 0.07) * 0.045 : 0;
    const fly = f > 0.2 ? easeOut((f - 0.2) / 1.1) : 0;
    const gap = crack + fly * (0.52 + (1 + facing) * 0.2);
    const turn = fly * 1.3;
    const spinA = Math.sin(index * 2.399) * turn;
    const spinB = Math.cos(index * 1.731) * turn;
    const [ox, oy, oz] = shard.centroid;
    s.reset().translate(cx, cy, cz).scale(scale * shape[0], scale * shape[1], scale * shape[2]);
    s.translate(shard.dir[0] * gap, shard.dir[1] * gap - fly * fly * 0.2, shard.dir[2] * gap);
    s.translate(ox, oy, oz).rotX(spinA).rotZ(spinB).translate(-ox, -oy, -oz);
    return f > 0 ? clamp(1 - f / 0.5, 0, 1) * clamp((facing + 0.6) * 1.1, 0, 1) : 0;
  }

  private drawBullet(dir: V3, distance: number, power: number, aimX: number, aimY: number, aimZ: number): void {
    const { r, m, s } = this;
    const x = dir[0] * distance + aimX, y = dir[1] * distance + aimY, z = dir[2] * distance + aimZ;
    const size = 0.13 + power * 0.08;
    r.outlineColor = INK;
    const yaw = Math.atan2(dir[0], dir[2]);
    const pitch = -Math.asin(clamp(dir[1], -1, 1));
    s.reset().translate(x, y, z).rotY(yaw).rotX(pitch);
    s.push().translate(0, 0, size * 0.9).rotX(Math.PI / 2).scale(size, size * 1.9, size);
    r.draw(m.hex, s.top, BULLET, { outline: 0.012 });
    s.pop();
    s.push().translate(0, 0, -size * 0.55).rotX(-Math.PI / 2).scale(size, size, size);
    r.draw(m.cone, s.top, BRASS, { outline: 0.012 });
    s.pop();
    r.resetOutlineColor();
  }

  /** A comic-book pop at the point of impact. */
  private drawPop(dir: V3, since: number, aimX: number, aimY: number, aimZ: number): void {
    if (since < 0 || since > 0.42) return;
    const { r, m, s } = this;
    const grow = ease(since / 0.1) * (1 - ease((since - 0.14) / 0.28));
    if (grow <= 0) return;
    const size = 1.5 * grow;
    s.reset().translate(dir[0] * 0.62 + aimX, dir[1] * 0.62 + aimY, dir[2] * 0.62 + aimZ);
    s.rotY(Math.atan2(dir[0], dir[2])).rotZ(since * 3);
    s.push().scale(size);
    r.draw(m.flash, s.top, GOLD, { unlit: true });
    s.pop();
    s.push().translate(0, 0, 0.03).scale(size * 0.6);
    r.draw(m.flash, s.top, [1, 1, 0.92], { unlit: true });
    s.pop();
  }
}

interface Feature {
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  teeth: boolean;
  shard(shards: Meshes["shards"]): number;
}

/** The face on the skull, each piece tied to the shard nearest to it. */
const FEATURES: Feature[] = [
  ...[-1, 1].map((side) => feature(side * 0.18, 0.06, 0.37, 0.27, 0.28, 0.16, false)),
  feature(0, -0.09, 0.42, 0.1, 0.14, 0.08, false),
  ...[-3, -2, -1, 0, 1, 2, 3].map((i) => feature(i * 0.07, -0.25, 0.34, 0.056, 0.09, 0.05, true)),
];

const FANGS = 6;
/** How far along the bullet's line, past the middle, it breaks out the far side. */
const EXIT_AT = -0.42;
const EXIT_POP = -0.42;

/** A lizard skull's sockets and nostrils, in its pieces' own space, each tied to the nearest piece. */
const LIZARD_FEATURES: (Feature & { onSnout: boolean })[] = [
  ...[-1, 1].map((side) => ({ ...feature(side * 0.3, 0.14, 0.3, 0.28, 0.32, 0.2, false), onSnout: false })),
  ...[-1, 1].map((side) => ({ ...feature(side * 0.16, 0.34, 0.36, 0.1, 0.12, 0.1, false), onSnout: true })),
];

function feature(x: number, y: number, z: number, sx: number, sy: number, sz: number, teeth: boolean): Feature {
  let cached = -1;
  return {
    x, y, z, sx, sy, sz, teeth,
    shard(shards) {
      if (cached >= 0) return cached;
      let best = 0;
      let bestDot = -Infinity;
      const l = Math.hypot(x, y, z) || 1;
      shards.forEach((shard, i) => {
        const d = (shard.dir[0] * x + shard.dir[1] * y + shard.dir[2] * z) / l;
        if (d > bestDot) { bestDot = d; best = i; }
      });
      cached = best;
      return best;
    },
  };
}

function cameraFor(shot: KillCamShot, u: number): Camera {
  const { zone, lizard } = shot;
  const angle = shot.xray ? XRAY_ANGLES[shot.xray] : undefined;
  // A lizard's head runs out along a long snout, so it needs more room and a side view.
  const eye: V3 = angle
    ? [lerp(angle.eye0[0], angle.eye1[0], u), lerp(angle.eye0[1], angle.eye1[1], u), lerp(angle.eye0[2], angle.eye1[2], u)]
    : zone === "head" && lizard
    ? [lerp(3.4, 2.9, u), lerp(0.9, 0.6, u), lerp(4.3, 3.7, u)]
    : zone === "head"
    ? [lerp(1.55, 1.2, u), lerp(0.42, 0.28, u), lerp(2.9, 2.5, u)]
    : [lerp(1.3, 1.05, u), lerp(0.22, 0.08, u), lerp(3.1, 2.65, u)];
  const target: V3 = angle ? angle.target : zone === "head" && lizard ? [0, 0, 0.3] : zone === "head" ? [0, 0.06, 0] : zone === "chest" ? [0, 0.08, 0] : [0, -0.08, 0];
  const t = Math.tan(0.36);
  const near = 0.05;
  return {
    projection: frustum(-t * (16 / 9) * near, t * (16 / 9) * near, -t * near, t * near, near, 80),
    view: lookAt(eye, target),
    eye,
  };
}

/** The direction the bullet comes from, leaning toward where it landed. */
function incoming(shot: KillCamShot): V3 {
  const angle = shot.xray ? XRAY_ANGLES[shot.xray] : undefined;
  if (angle) return normalized(angle.from);
  return normalized([
    0.34 + clamp(shot.offsetX, -1, 1) * 0.35,
    0.1 + clamp(shot.offsetY, -1, 1) * 0.3,
    1,
  ]);
}

function ease(t: number): number {
  const k = clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
}

function easeOut(t: number): number {
  const k = clamp(t, 0, 1);
  return 1 - (1 - k) * (1 - k);
}

function mix(a: V3, b: V3, t: number): V3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function normalized(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

