// What the match looks like in 3D. The town, lighting, monkeys, arm, revolver and shooting
// gallery all come from lookdev/, so they keep improving there. This file adds the duel on top:
// cameras, the slo-mo bullet, the ragdoll bound to the rig, stars and the kill cam.

import { BOSSES, bossFace, loadBoss, type BossInstance, type BossMood } from "../../lookdev/bosses";
import { FLAME_LIZARD, LIZARDS, OUTFITS, buildTumbleweed, flameLizardBuffer, lizardBuffer, monkeyBuffer } from "../../lookdev/character";
import { BLAST_PUFF, BOSS_SHIELD, DUST_PUFF, FLASH, FlameRenderer, GUN_PUFF, HEART_HALO, type FlameDraw, type FlameMesh, type PuffDraw } from "../../lookdev/flame";
import { PostPass } from "../../lookdev/post";
import { SUNDOWN_AT } from "../../lookdev/renderer";
import { MAG_GUNS, buildMagGun } from "../../lookdev/gunmodels";
import type { Intro } from "../../lookdev/intro";
import { gunById, type GunDef, type GunPaint } from "../game/guns";
import thompsonUrl from "../../lookdev/assets/guns/thompson.glb?url";
import m1911Url from "../../lookdev/assets/guns/1911.glb?url";
import { heldMatrix, loadPropBuilders, shieldGrip, shieldMatrix, type PropName } from "../../lookdev/props";
import { DIRECTIONS } from "../../lookdev/directions";
import { FaceAnim, buildFaceSheet, buildLizardFaceSheet, faceAtlas, lizardEye } from "../../lookdev/faces";
import type { EyeCell, MouthCell } from "../../lookdev/faces";
import { Effects } from "../../lookdev/fx";
import { Gallery, type TargetDef } from "../../lookdev/gallery";
import {
  identity as lookIdentity,
  invert,
  multiply,
  perspective,
  rotationX,
  rotationY,
  rotationZ,
  scaling,
  transformPoint,
  translation,
} from "../../lookdev/gl";
import type { Mat4 as LookMat4, V3 as LookV3 } from "../../lookdev/gl";
import { MAX_BONES, Rig, parseGlb, readSkeleton, readSkinnedMesh } from "../../lookdev/gltf";
import type { ParsedGlb, Skeleton } from "../../lookdev/gltf";
import { CHAMBER, CHAMBERS, GunAction, buildBullet, buildChamber, buildRevolver } from "../../lookdev/gun";
import type { RevolverParts } from "../../lookdev/gun";
import { MeshBuilder, hex, mix as mixColor } from "../../lookdev/mesh";
import type { RGB } from "../../lookdev/mesh";
import { Renderer as LookRenderer } from "../../lookdev/renderer";
import type { Camera as LookCamera, GpuMesh, HeldItem, HeldPart, LookState, MovingThing } from "../../lookdev/renderer";
import revolverText from "../../lookdev/assets/revolvers/Revolver_1.obj?raw";
import monkeyUrl from "../../lookdev/assets/monkey.glb?url";
import armUrl from "../../lookdev/assets/fps_arm.glb?url";

import { BOSS } from "../game/boss";
import { BANK_STOP, RIDE_SEC } from "../game/level";
import type { Match, PlayerId, Shot } from "../game/match";
import { FLAME_OUTFIT, GOLDEN_OUTFIT, RUSH, RUSH_CAM, Rush, reloadTime, rushCamStage, type RushEnemy, type RushEvent, type RushReload } from "../game/rush";
import { INTRO, KILLCAM, PLANE, clamp, introStage, killCamFor, lerp, type Vec2 } from "../game/rules";
import { drawLooseHat, type Palette } from "./character";
import { MAX_POINTS, POINT_STRIDE, Renderer, type Camera, type Look } from "./gl";
import { KillCam, type KillCamShot, type KillZone } from "./killcam";
import { Stack, frustum, lookAt, type V3 } from "./mat";
import { createMeshes, type Meshes } from "./meshes";
import { MONKEY_LAYOUT, P, Ragdoll, type V } from "./ragdoll";
import { RagdollSkin } from "./ragdollSkin";

/** The chosen look. The other directions stay available in lookdev/. */
const LOOK_ID = "haze";

/** The game's target line sits here in the town. The shooter stands at z = 0. */
const Z0 = -PLANE.distance;
/** Where each duellist stands in the side-on shots, in town coordinates. */
const WIDE_Z = [Z0 + 3.6, Z0 + 10.4] as const;

const NEAR = 0.3;
const FAR = 3000;
const ASPECT = 16 / 9;
const MENU_FOV = 44;
const HELD_PROJ = perspective(MENU_FOV, ASPECT, 0.05, 20);

/** Tuned by eye against the rigged model. */
/** On the flat face sheet: eyes sit at x 36 and 64, y 46, in its 100 x 100 drawing. */
const STAR_EYE = { x: 0.174, y: 1.79, z: 0.56, size: 0.25 };
const BULGE = { base: 0.05, radius: 0.1, length: 0.13, back: 0.08 };
/** How much bigger the gun gets at a full charge. */
const GUN_GROWTH = 0.4;
/** How long the throw clip runs, and how big a flying bottle is, so it reads from down the street. */
const THROW_CLIP_SEC = 1.04;
const BOTTLE_SIZE = 1.7;
/** How many bodies stay on the street, and for how long, to keep the frame rate up. */
const GATOR_EYE_Y = 4.4 * BOSS.drawScale;
/** The end of the minigun and the middle of the chest, on the gator as he was modelled. */
const GATOR_MUZZLE: LookV3 = [-3.2, 2.6, 5.1];
const GATOR_HEART: LookV3 = [0, 2.8, 1.5];
const GATOR_FLINCH_SEC = 0.3;
/** The heart's size against what you can hit, how fast it beats, and how much it glows at rest and on the beat. */
const HEART_MODEL_SIZE = 1.05;
const HEART_BEATS_PER_SEC = 1.3;
const HEART_GLOW_BASE = 0.12;
const HEART_GLOW_BEAT = 0.4;
/** How thick the air is once the game's on: the haze stays for the menu, but it mustn't hide anyone you're shooting at. */
const PLAY_AIR = 0.25;
const BOSS_SHIELD_SEC = 0.32;
/** How often the gun throws a tracer while it's firing. */
const GATOR_SHOT_GAP = 0.035;
/** The ring the fight's in, in the camera's own space once it's arrived. Its middle is where he lands. */
const RING = { x: 0, z: -22, radius: 14 };
/** Where the arena stands, and how the camera's turned, once it's got there. */
const RING_SWING = multiply(multiply(translation(BANK_STOP.x, 0, BANK_STOP.z), rotationY(-BANK_STOP.yaw)), translation(-BANK_STOP.x, 0, -BANK_STOP.z));
/** How far back the bank's front wall stands. */
const BANK_Z = -44;
/** The great bank, its blown-in front, the wreckage round the ring, and the loot lying about. */
const RING_PROPS: readonly { prop: PropName; x: number; z: number; yaw: number; scale?: number; tilt?: number; y?: number }[] = [
  { prop: "grand_bank", x: 0, z: BANK_Z, yaw: 0 },
  { prop: "bank_ruin", x: 0, z: BANK_Z + 0.3, yaw: 0, scale: 1.3 },
  { prop: "porch_wreck", x: 8.2, z: -33, yaw: 0.15, scale: 1.35 },
  { prop: "stable", x: -9.2, z: -31, yaw: 0.72, scale: 1.3 },
  { prop: "wagon_wreck", x: 10.6, z: -24, yaw: -1.2, scale: 1.3 },
  { prop: "crate_pile", x: -10.6, z: -23, yaw: 1.1, scale: 1.4 },
  { prop: "porch_wreck", x: -8.6, z: -14.5, yaw: 2.2, scale: 1.1 },
  { prop: "wagon_wreck", x: 8.6, z: -13.5, yaw: -2, scale: 1.1 },
  { prop: "vault_door", x: -3.2, z: -31, yaw: 0.5, tilt: 0.62, y: 0.6, scale: 1.4 },
  { prop: "gold_bars", x: 3.6, z: -32, yaw: 0.3, scale: 1.7 },
  { prop: "gold_bars", x: -6.2, z: -25, yaw: 2.2, scale: 1.5 },
  { prop: "gold_bars", x: 6.2, z: -19.5, yaw: 1.1, scale: 1.4 },
  { prop: "gold_bars", x: -5.8, z: -16.5, yaw: 3.4, scale: 1.2 },
  { prop: "cash", x: 1, z: -27, yaw: 0.8, scale: 1.7 },
  { prop: "cash", x: 6.4, z: -26, yaw: 2.6, scale: 1.4 },
  { prop: "cash", x: -5, z: -20, yaw: 4.2, scale: 1.3 },
  { prop: "cash", x: -1.5, z: -9.5, yaw: 1.4, scale: 1.05 },
  { prop: "cash", x: 3, z: -8.6, yaw: 5, scale: 1 },
];
/** The rodeo fence, in lengths round the ring from the bank, leaving it open behind you. */
const RING_FENCE: readonly number[] = Array.from({ length: 12 }, (_, i) => 6.55 + i * 13.1).flatMap((deg) => [-deg, deg]);
/** Which of those has a wanted poster on it. */
const RING_POSTERS: readonly number[] = [2, 5, 7, 10, 12, 15, 17, 20];
/** The bleachers packed with lizards, going round both sides, open toward the bank and behind you. */
const RING_STANDS: readonly number[] = [-33, -57, -81, -105, -129, 33, 57, 81, 105, 129];
const STAND_RADIUS = 15.4;
/** The torches just outside the fence. */
const RING_TORCHES: readonly number[] = [-21, -45, -69, -93, -117, 21, 45, 69, 93, 117];
const TORCH_RADIUS = 14.8;
const TORCH_TOP = 4.45;
/** Fires still burning on the wreckage and the bank, and where the smoke goes up. */
const RING_FIRES: readonly { x: number; z: number; tall: number }[] = [
  { x: -2.6, z: BANK_Z + 2.2, tall: 1.8 },
  { x: 2.8, z: BANK_Z + 2, tall: 1.5 },
  { x: 5, z: BANK_Z + 3, tall: 1.2 },
  { x: -5.2, z: BANK_Z + 3.2, tall: 1.1 },
  { x: 10.4, z: -23.5, tall: 1 },
  { x: -8.6, z: -13.8, tall: 0.75 },
];
/** Walking down the road, from where the sun starts to go, through sundown, to where it's dark. */
const NIGHT_FROM = 14;
const NIGHT_TO = 78;
const SMOKE_GAP_SEC = 0.42;
const MAX_FALLEN = 4;
const FALLEN_SEC = 3.5;
/** How far the horizon tips at a full lean, in radians. */
const LEAN_TILT = 0.2;
const BOTTLE_BODY: V3 = [0.2, 0.52, 0.32];
const WHISKEY: V3 = [0.86, 0.52, 0.12];
const FIRE_CORE: V3 = [1, 0.9, 0.38];
const FIRE_MID: V3 = [1, 0.56, 0.1];
const FIRE_OUTER: V3 = [0.9, 0.24, 0.06];
const WOOD_CHIP: V3 = [0.82, 0.62, 0.36];
const BLUE_SPARK: V3 = [0.5, 0.65, 1];
const WOOD_DARK: V3 = [0.48, 0.3, 0.16];
/** Added to a body's colour once the fire's done with it. */
const CHARRED: readonly [number, number, number] = [-0.74, -0.78, -0.8];
/** Where flames stand on a burning lizard: which bone, where on it at rest, and how tall. */
const BURN_SPOTS: readonly { bone: string; at: LookV3; tall: number }[] = [
  { bone: "chest", at: [0, 1.1, 0.14], tall: 1.3 },
  { bone: "head", at: [0, 1.85, 0.12], tall: 1.2 },
  { bone: "head", at: [0.36, 2.1, -0.05], tall: 0.75 },
  { bone: "arm.L", at: [-0.62, 0.85, 0.05], tall: 0.8 },
  { bone: "arm.R", at: [0.62, 0.85, 0.05], tall: 0.8 },
  { bone: "thigh.L", at: [-0.22, 0.42, 0.08], tall: 0.7 },
  { bone: "thigh.R", at: [0.22, 0.42, 0.08], tall: 0.7 },
];
/** Bits of fireball and smoke alive at once, to keep the frame rate up on the TV. */
const MAX_FIRE_BITS = 40;
/** How much of a goon's height the squash takes, on top of the waddle clip, to reach its hitbox. */
const DUCK_SQUASH = 0.84;
const SHIELD_HIT_SEC = 0.42;
/** Half a run cycle, on the clip's own clock: one foot coming down. */
const RUN_STEP_SEC = 0.3125;
/** On the turntable: the middle of each gun, so it spins about that, and how long it is, so it fills the frame. */
const TURNTABLE: Record<GunDef["model"], { x: number; y: number; length: number }> = {
  revolver: { x: 0.75, y: 0.12, length: 2 },
  m1911: { x: 0.55, y: 0.18, length: 2 },
  thompson: { x: 0.25, y: 0.1, length: 3.45 },
};
const TURNTABLE_DISTANCE = 3.4;
const TURNTABLE_FILL = 0.44;
const TURNTABLE_SPIN = 0.85;
const TURNTABLE_BACK = "#2A180E";
/** What each finish paints the parts of a gun, how shiny it is, and any light of its own. */
const GUN_FINISH: Record<GunPaint, { wood: string; light: string; mid: string; dark: string; gloss: number; glow: readonly [number, number, number] }> = {
  steel: { wood: "#7A4A26", light: "#8D9096", mid: "#62656B", dark: "#43474E", gloss: 0.3, glow: [0, 0, 0] },
  gold: { wood: "#F4D9A8", light: "#FFC53A", mid: "#FFB02E", dark: "#E8921E", gloss: 0.3, glow: [0, 0, 0] },
  ghost: { wood: "#6BBCC4", light: "#E9F2E2", mid: "#A6DDD8", dark: "#3F97AE", gloss: 0.15, glow: [0.05, 0.16, 0.18] },
};
/** In the swing clip: where the arm's up and where the blow lands, and how quick the chop itself is. */
const SWING_RAISED = 0.2;
const SWING_CHOP_SEC = 0.08;
/** How flat someone ends up on the cannonball, and how far the cannon jumps back when it goes off. */
const SPLAT_THICK = 0.09;
const CANNON_RECOIL = 1;
const PLANK_SEC = 2.6;
const FLAT_SHADING = { hardToon: true, facet: 0.55 };
/** How long an impact frame holds, and the shortest gap between them, so they can never strobe. */
const IMPACT_SEC = 0.07;
const IMPACT_GAP_SEC = 6;
/** How far a kill punches the camera in. */
const PUNCH_BODY = 0.04;
const PUNCH_HEAD = 0.1;
/** The muzzle flash: how long, and how far it reaches in the gun's own units. */
const FLASH_SEC = 0.075;
const FLASH_SIZE = 0.62;
/** How the gun's held to reload: how far it comes in from where it's aimed, and turned which way. */
const RELOAD_POSE = { x: 0.34, y: 0.26, z: 0.52, yaw: -0.3, pitch: 0.06, roll: -0.3 };
/** Barrel smoke trails off this long after the last shot, a wisp this often. */
const WISP_SEC = 1.1;
const WISP_GAP = 0.08;
/** A plain kill: how long the flash and shake last, how hard, and how far it throws them. */
const STAGGER_SEC = 0.2;
const STAGGER_FLASH_SEC = 0.08;
const STAGGER_SHAKE = 0.09;
const HIT_FLASH = 2.4;
const PUNT_BACK = 13;
const PUNT_UP = 4.5;
const HAT_SEC = 4;
/** The golden goon's outfit, which only exists for rush mode. */
const GOLDEN = {
  fur: "#E8A91E",
  skin: "#FFE9A8",
  poncho: "#FFC93C",
  stripe: "#FFF4C8",
  pants: "#B8860B",
  hat: "#FFD35A",
  band: "#A86A12",
  scarf: "#FFF4C8",
  iris: "#FFF4C8",
};
const BOTTLE_GLASS: V3 = [0.62, 0.88, 0.62];

/** The overlay pass only draws stars, bullets and hats, which ignore most of this. */
const OVERLAY_LOOK: Look = {
  sun: [0, 0, 1],
  light: normalized([-0.42, 0.72, 0.68]),
  fogColor: [0.9, 0.7, 0.5],
  fog: [1000, 2000],
  skyTop: [0, 0, 0],
  skyMid: [0, 0, 0],
  skyLow: [0, 0, 0],
  sunColor: [0, 0, 0],
};

const COLORS = {
  gold: [1, 0.8, 0.2] as V3,
  bullet: [1, 0.68, 0.18] as V3,
  brass: [0.86, 0.63, 0.25] as V3,
  steelDark: [0.24, 0.24, 0.28] as V3,
  dust: [0.92, 0.74, 0.54] as V3,
  spark: [1, 0.78, 0.3] as V3,
  sweat: [0.62, 0.86, 1] as V3,
};

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  r: number; g: number; b: number;
  size: number;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
}

interface Downed {
  rag: Ragdoll;
  skin: RagdollSkin;
  outfit: number;
  /** A goon rather than one of the monkeys. */
  lizard?: boolean;
}

export type View = { kind: "menu" } | { kind: "shop"; showGun: boolean } | { kind: "match"; match: Match } | { kind: "rush"; game: Rush };

/** A goon's own animation, so they don't all step in time. */
interface Goon {
  rig: Rig;
  clock: number;
  /** Seconds left of flashing white from a hit. */
  flash: number;
  /** On the goon's own clock: when its bottle leaves its hand, and when the throw has finished. */
  letGoAt: number;
  throwEndsAt: number;
  /** On the goon's own clock: when the shield's done being driven back into them. */
  shieldHitUntil: number;
  /** Seconds left of the shield flashing from a hit. */
  shieldFlash: number;
  /** 1 standing, less while ducked. */
  squash: number;
  /** Which way they're facing, eased so they turn rather than snap. */
  yaw: number;
}

/** A bit of a fireball, a puff of smoke or a falling drop of burning fuel, out in the street. */
interface FireBit {
  kind: "ball" | "smoke" | "drip" | "dust";
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  from: number;
  to: number;
  age: number;
  life: number;
  seed: number;
}

/** A loose board off a broken shield. */
interface Plank {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number;
  rz: number;
  spinX: number;
  spinZ: number;
  age: number;
}

/** A puff of gun smoke, in camera space, so it stays by the gun's own projection. */
interface GunPuff {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  from: number;
  to: number;
  age: number;
  life: number;
  seed: number;
  drag: number;
}

/** A plain kill's beat before the fall: a flash and a shake, standing where they were hit. */
interface Stagger {
  enemy: RushEnemy;
  goon: Goon;
  zone: "head" | "nuts" | "body";
  point: Vec2;
  t: number;
}

/** A hat in the air. */
interface LooseHat {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  spin: number;
  outfit: number;
  age: number;
}

/** Someone just shot in rush mode, falling where they were hit. */
interface Fallen extends Downed {
  age: number;
  hatOff: boolean;
  /** Burned to a crisp, with the last of the flames here. */
  burntAt?: { x: number; z: number };
}

export class Scene {
  private readonly look: LookRenderer;
  private readonly overlay: Renderer;
  private readonly m: Meshes;
  private readonly s = new Stack();
  private readonly killCam: KillCam;
  private readonly effects: Effects;
  private readonly flames: FlameRenderer;
  private readonly post: PostPass;
  /** 0..1 how hot the combo's running, eased, and the camera's punch in, on each kill. */
  private heat = 0;
  private punch = 0;
  private impactLeft = 0;
  private sinceImpact: number = IMPACT_GAP_SEC;
  private readonly calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  /** The combo's multiplier as of the last frame, for judging how big a kill was. */
  private multiplier = 1;
  /** Everything on fire this frame, rebuilt each time. */
  private flameList: FlameDraw[] = [];
  private puffList: PuffDraw[] = [];
  private fireBits: FireBit[] = [];
  private planks: Plank[] = [];
  private gunPuffs: GunPuff[] = [];
  /** The muzzle in camera space, as the gun's drawn, and which way the barrel points. */
  private muzzleMat: LookMat4 = lookIdentity();
  /** Seconds since the last shot, and since the last wisp came off the barrel. */
  private sinceShot = 10;
  private sinceWisp = 0;
  private flashMesh: FlameMesh = "star0";
  private flashRoll = 0;
  /** The reload going on in rush mode, and how many rounds are in the gun. */
  private reloadView: { reload: RushReload; ammo: number } | null = null;
  /** Rush mode says when the gun reloads. Everywhere else, it goes by its own count. */
  private rushRunning = false;
  private readonly dir =DIRECTIONS.find((d) => d.id === LOOK_ID) ?? DIRECTIONS[0]!;
  private readonly particles: Particle[] = [];
  private readonly pointData = new Float32Array(MAX_POINTS * POINT_STRIDE);

  // Filled in by load().
  private state!: LookState;
  private skeleton!: Skeleton;
  private armGlb!: ParsedGlb;
  private armRig!: Rig;
  private gallery!: Gallery;
  private tumble!: GpuMesh;
  private monkeys!: GpuMesh[];
  private rigs!: Rig[];
  private faces!: FaceAnim[];
  private faceSheet!: GpuMesh;
  private lizardFace!: GpuMesh;
  private lizards!: GpuMesh[];
  private props!: Record<PropName, GpuMesh>;
  private shieldHold!: LookMat4;
  private bulletMesh!: GpuMesh;
  private chamberMesh!: GpuMesh;
  private gator!: BossInstance;
  /** Where the camera's ridden to. Rush mode measures everything from here. */
  private rx = 0;
  private rz = 0;
  /** The gun being held, how it's finished, and its parts when it isn't the revolver. */
  private gunWanted: GunDef = gunById("revolver");
  private gunBuilt = "";
  private gunFinish = GUN_FINISH.steel;
  private magGun: { body: GpuMesh; slide: GpuMesh; mag: GpuMesh; muzzle: LookV3; slideBack: number } | null = null;
  private readonly gunCache = new Map<string, { parts?: RevolverParts; meshes?: { body: GpuMesh; cylinder: GpuMesh; hammer: GpuMesh; trigger: GpuMesh }; mag?: Scene["magGun"] }>();
  private monkeyGlb!: ParsedGlb;
  private gunGlbs!: { m1911: ParsedGlb; thompson: ParsedGlb };
  private revolverWalnut: RGB = [0.5, 0.3, 0.15];
  private gunParts!: RevolverParts;
  private gunMeshes!: { body: GpuMesh; cylinder: GpuMesh; hammer: GpuMesh; trigger: GpuMesh };
  private muzzleBulge!: GpuMesh;
  private readonly armMeshes = new Map<number, GpuMesh>();

  private time = 0;
  /** Each rig has its own clock, so the slow motion can slow it down. */
  private readonly clocks = [0, 0];
  private shake = 0;
  private trailTimer = 0;
  private nextSweat = 0;
  private loudness = 0;
  /** Where the bullet's heading, eased, because the target's still moving as it flies. */
  private bulletEnd: V3 | null = null;
  private flash = 0;
  private fireKick = 0;
  private readonly gunAction = new GunAction();
  private muzzle: LookV3 = [0.5, 1.4, -1.4];
  /** The muzzle's swell, on a spring so it wobbles like a balloon. */
  private inflate = 0;
  private inflateVelocity = 0;

  // The menu's aim, in normalized device coordinates.
  private readonly menuAim = { x: 0, y: 0.02, kick: 0 };
  private menuVP: LookMat4 = lookIdentity();
  private menuCam: LookCamera | null = null;

  private readonly goons = new Map<number, Goon>();
  private fallen: Fallen[] = [];
  private staggers: Stagger[] = [];
  private gatorClock = 0;
  /** Seconds left of each of his reactions, and what's next to happen with the gun. */
  private gatorFlinch = 0;
  private gatorOuch = 0;
  private gatorTaunt = 0;
  private gatorFlash = 0;
  private gatorShotIn = 0;
  private bossShieldLeft = 0;
  /** Seconds since the ring started to form, or -1, and which stakes have thrown up their dust. */
  /** 0 for day, 1 for night. */
  private night = 0;
  private playing = false;
  private gatorHeart: MovingThing | null = null;
  private cannonKick = 0;
  private splatRig: Rig | null = null;
  private ringT = -1;
  private ringDust = new Set<number>();
  private smokeIn = 0;
  private gatorNow: BossMood = {};
  /** How far the camera has turned, for drawing the rail's space in the town's. */
  private railYaw = 0;
  private looseHats: LooseHat[] = [];
  /** The bullet cam's starting point, and whether its body has started to fall yet. */
  private camFrom: V3 = [0.5, 1.4, -1.4];
  private camDropped = false;
  private camGoon: Goon | null = null;

  /** The body the last bullet hit. */
  private downed: Downed | null = null;
  private focus: V = [0, 0.8, Z0];
  /** The side the camera watches a downed body from, kept smooth as the body settles. */
  private camSide: [number, number] = [1, 0];
  private hitStop = 0;
  private dustDone = false;
  private loseHat: { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; rest: boolean } | null = null;
  private readonly losers: (Downed | null)[] = [null, null];
  /** False until the knockdown starts, which on a big hit is after the kill cam. */
  private dropped = true;

  constructor(private readonly canvas: HTMLCanvasElement) {
    // Both renderers share one WebGL context. The look renderer asks for its options first.
    this.look = new LookRenderer(canvas);
    this.look.setMode("painted");
    this.look.windScale = 1;
    this.overlay = new Renderer(canvas);
    this.m = createMeshes(this.overlay);
    this.killCam = new KillCam(this.overlay, this.m);
    this.effects = new Effects(this.look.gl, (t) => this.look.upload(t, false));
    this.flames = new FlameRenderer(this.look.gl);
    this.post = new PostPass(this.look.gl);
  }

  get drawCalls(): number {
    return this.look.drawCalls + this.overlay.drawCalls;
  }

  describe(): string {
    return this.overlay.describe();
  }

  /** Fetches the rigged models and bakes the town. Runs once, before the first frame. */
  async load(): Promise<void> {
    const fetchGlb = async (url: string) => parseGlb(await (await fetch(url)).arrayBuffer());
    const [monkeyGlb, armGlb, m1911Glb, thompsonGlb] = await Promise.all([fetchGlb(monkeyUrl), fetchGlb(armUrl), fetchGlb(m1911Url), fetchGlb(thompsonUrl)]);
    this.monkeyGlb = monkeyGlb;
    this.gunGlbs = { m1911: m1911Glb, thompson: thompsonGlb };
    const { look, dir } = this;
    this.skeleton = readSkeleton(monkeyGlb);
    this.armGlb = armGlb;
    this.armRig = new Rig(readSkeleton(armGlb));
    this.armRig.play("hold", 0, { fade: 0 });

    this.monkeys = OUTFITS.map((o) => {
      const b = monkeyBuffer(monkeyGlb, o);
      return look.uploadSkinned(b.data, b.count);
    });
    this.lizards = [...LIZARDS, GOLDEN].map((o) => {
      const b = lizardBuffer(monkeyGlb, o);
      return look.uploadSkinned(b.data, b.count);
    });
    const flame = flameLizardBuffer(monkeyGlb);
    this.lizards[FLAME_OUTFIT] = look.uploadSkinned(flame.data, flame.count);
    this.gator = await loadBoss(look, BOSSES[0]!);
    const builders = await loadPropBuilders();
    this.props = Object.fromEntries(
      (Object.keys(builders) as PropName[]).map((name) => [name, look.uploadMesh(builders[name])]),
    ) as Record<PropName, GpuMesh>;
    this.shieldHold = shieldGrip(this.skeleton);
    this.bulletMesh = look.uploadMesh(buildBullet());
    this.chamberMesh = look.uploadMesh(buildChamber());
    this.rigs = [new Rig(this.skeleton), new Rig(this.skeleton)];
    this.rigs.forEach((rig, i) => rig.play("idle", 0, { fade: 0, offset: i * 1.3 }));
    this.faces = this.rigs.map((_, i) => new FaceAnim(i + 0.5));
    look.setFaceAtlas(await faceAtlas());
    this.faceSheet = look.uploadMesh(buildFaceSheet());
    this.lizardFace = look.uploadMesh(buildLizardFaceSheet());
    this.gallery = new Gallery(look, dir, monkeyGlb, this.skeleton, this.faceSheet);
    this.tumble = look.uploadMesh(buildTumbleweed(hex(dir.palette.twig)));

    const walnut = mixColor(hex(dir.palette.barrel), hex("#9A4A20"), 0.45);
    this.revolverWalnut = walnut;
    this.gunParts = buildRevolver(revolverText, (name) => {
      if (name.includes("Wood")) return { color: walnut, mat: "wood" };
      if (name === "LightMetal") return { color: hex("#8D9096"), mat: "plain" };
      if (name === "Grey") return { color: hex("#62656B"), mat: "plain" };
      return { color: hex("#43474E"), mat: "plain" };
    });
    this.gunMeshes = {
      body: look.uploadMesh(this.gunParts.builders.body),
      cylinder: look.uploadMesh(this.gunParts.builders.cylinder),
      hammer: look.uploadMesh(this.gunParts.builders.hammer),
      trigger: look.uploadMesh(this.gunParts.builders.trigger),
    };
    this.muzzleBulge = look.uploadMesh(bulgeBuilder(hex("#43474E")));
    this.state = look.look(dir);
  }

  /** Puts a gun in your hand. It's built the first time it's drawn. */
  setGun(id: string): void {
    this.gunWanted = gunById(id);
  }

  private readyGun(): void {
    const def = this.gunWanted;
    if (this.gunBuilt === def.id) return;
    const look = this.look;
    const finish = GUN_FINISH[def.paint];
    let cached = this.gunCache.get(def.id);
    if (!cached) {
      cached = {};
      if (def.model === "revolver") {
        const steel = def.paint === "steel";
        const parts = buildRevolver(revolverText, (name) => {
          if (name.includes("Wood")) return { color: steel ? this.revolverWalnut : hex(finish.wood), mat: steel ? "wood" : "plain" };
          if (name === "LightMetal") return { color: hex(finish.light), mat: "plain" };
          if (name === "Grey") return { color: hex(finish.mid), mat: "plain" };
          return { color: hex(finish.dark), mat: "plain" };
        });
        cached.parts = parts;
        cached.meshes = {
          body: look.uploadMesh(parts.builders.body),
          cylinder: look.uploadMesh(parts.builders.cylinder),
          hammer: look.uploadMesh(parts.builders.hammer),
          trigger: look.uploadMesh(parts.builders.trigger),
        };
      } else {
        const spec = MAG_GUNS[def.model];
        const built = buildMagGun(this.gunGlbs[def.model], spec, (material) =>
          hex(material === "wood" ? finish.wood : material === "metal" ? finish.light : finish.dark));
        cached.mag = { body: look.uploadMesh(built.body), slide: look.uploadMesh(built.slide), mag: look.uploadMesh(built.mag), muzzle: spec.muzzle as unknown as LookV3, slideBack: spec.slideBack };
      }
      this.gunCache.set(def.id, cached);
    }
    this.magGun = cached.mag ?? null;
    if (cached.parts && cached.meshes) {
      this.gunParts = cached.parts;
      this.gunMeshes = cached.meshes;
    }
    this.gunFinish = finish;
    this.gunBuilt = def.id;
  }

  private turntableSlide = 0;

  /** Slides the turntable along: the next gun comes in from whichever side you moved toward. */
  turnShop(direction: number): void {
    this.turntableSlide = direction;
  }

  /** The outfits screen: nothing but the gun, big, turning slowly on a plain backdrop. */
  private renderShop(showGun: boolean, dt: number): void {
    this.turntableSlide *= Math.exp(-dt * 11);
    const eye: LookV3 = [0, 2, 10];
    const cam: LookCamera = { eye, view: lookAt(eye, [0, 2, 0]), proj: perspective(MENU_FOV, ASPECT, 1, FAR) };
    let held: HeldItem | undefined;
    if (showGun) {
      this.readyGun();
      const now = this.time;
      const { gunParts, gunMeshes, magGun, gunFinish } = this;
      const turn = TURNTABLE[this.gunWanted.model];
      const wide = 2 * TURNTABLE_DISTANCE * Math.tan((MENU_FOV * Math.PI) / 360) * ASPECT;
      const fit = (TURNTABLE_FILL * wide) / turn.length;
      let base = translation(this.turntableSlide * wide * 0.8, 0.3, -TURNTABLE_DISTANCE);
      base = multiply(base, rotationY(now * TURNTABLE_SPIN));
      base = multiply(base, rotationX(0.12));
      base = multiply(multiply(base, scaling(fit, fit, fit)), translation(-turn.x, -turn.y, 0));
      const glow = gunFinish.glow;
      const gloss = gunFinish.gloss;
      if (magGun) {
        held = { proj: HELD_PROJ, flash: 0, parts: [magGun.body, magGun.slide, magGun.mag].map((mesh) => ({ mesh, model: base, gloss, glow })) };
      } else {
        const mats = this.gunAction.partMatrices(now, gunParts, base);
        held = {
          proj: HELD_PROJ,
          flash: 0,
          parts: [
            { mesh: gunMeshes.body, model: mats.body, gloss, glow },
            { mesh: gunMeshes.cylinder, model: mats.cylinder, gloss, glow },
            { mesh: gunMeshes.hammer, model: mats.hammer, gloss, glow },
            { mesh: gunMeshes.trigger, model: mats.trigger, gloss, glow },
          ],
        };
      }
    }
    this.look.render(this.state, cam, [0, 0, this.canvas.width, this.canvas.height], [], {
      gray: false,
      time: this.time,
      held,
      flatArt: { ...FLAT_SHADING, bare: hex(TURNTABLE_BACK) },
    });
  }

  /** The storyboard that plays before the first fight. It draws itself over the top of everything. */
  async makeOpening(host: HTMLElement): Promise<Intro> {
    const { Intro: Opening } = await import("../../lookdev/intro");
    return Opening.create(this.look, this.monkeyGlb, this.skeleton, this.faceSheet, host, this.armGlb);
  }

  /** Sets the renderer back the way the game wants it, once the storyboard's done. */
  endOpening(): void {
    this.look.setMode("painted");
    this.look.windScale = 1;
  }

  private outfitOf(index: number): (typeof LIZARDS)[number] {
    return index === GOLDEN_OUTFIT ? GOLDEN : index === FLAME_OUTFIT ? FLAME_LIZARD : LIZARDS[index]!;
  }

  private outfitFor(match: Match | null, player: PlayerId): number {
    if (match && match.mode === 1 && player === 1) return 3;
    return player;
  }

  /** The shooter's own arm, in their poncho. Built the first time it's needed. */
  private armFor(outfit: number): GpuMesh {
    let mesh = this.armMeshes.get(outfit);
    if (mesh) return mesh;
    const o = OUTFITS[outfit]!;
    const fur = hex(o.fur);
    const skin = hex(o.skin);
    const palette: Record<string, RGB> = {
      skin,
      fur,
      knuckle: mixColor(skin, fur, 0.3),
      crease: mixColor(skin, fur, 0.55),
      nail: mixColor(skin, hex("#FFFFFF"), 0.5),
      sleeve: hex(o.poncho),
      cuff: hex(o.stripe),
    };
    const b = readSkinnedMesh(this.armGlb, (name) => {
      const color = palette[name];
      if (!color) throw new Error(`Arm material "${name}" has no paint`);
      return { color };
    });
    mesh = this.look.uploadSkinned(b.data, b.count);
    this.armMeshes.set(outfit, mesh);
    return mesh;
  }

  // ---- The menu: a shooting gallery ------------------------------------------------------

  /** Moves the menu's aim. Returns whether it's on a target. */
  menuUpdate(dt: number, aim: Vec2): boolean {
    this.menuAim.x = aim.x * 2 - 1;
    this.menuAim.y = 1 - aim.y * 2;
    const { o, d } = this.gallery.ray(this.menuVP, [this.menuAim.x, this.menuAim.y]);
    let hover = this.gallery.pick(o, d);
    if (hover?.state.down) hover = null;
    this.gallery.update(dt, this.time, hover?.state ?? null);
    this.menuAim.kick *= Math.exp(-dt * 7);
    return hover !== null;
  }

  /** With only arrow keys, letting go near a target settles the aim onto it. */
  menuAssist(): Vec2 | null {
    let best: { x: number; y: number; dist: number } | null = null;
    for (const s of this.gallery.targets) {
      if (s.down) continue;
      const p = transformPoint(this.menuVP, [s.x, 1.5, s.def.z]);
      const dist = Math.hypot(p[0] - this.menuAim.x, (p[1] - this.menuAim.y) * 0.6);
      if (dist < 0.26 && (!best || dist < best.dist)) best = { x: p[0], y: p[1], dist };
    }
    return best ? { x: best.x * 0.5 + 0.5, y: 0.5 - best.y * 0.5 } : null;
  }

  menuFire(): TargetDef | null {
    if (!this.menuCam || this.gallery.starting) return null;
    const now = this.time;
    if (now - this.gunAction.reloadAt < 1.1) return null;
    this.fireGun(now);
    const { o, d } = this.gallery.ray(this.menuVP, [this.menuAim.x, this.menuAim.y]);
    const res = this.gallery.shoot(o, d, now);
    this.menuAim.kick = 1;
    this.effects.tracer(this.muzzle, res.point);
    if (res.target) this.effects.hit(res.point, hex(this.dir.palette.hay));
    else this.effects.miss(res.point, hex(this.dir.palette.sandPatch));
    return res.target;
  }

  /** How many chambers are spent, for the reticle. */
  get shotsFired(): number {
    return this.gunAction.shots;
  }

  resetMenu(): void {
    this.gallery.reset();
  }

  // ---- Rush mode --------------------------------------------------------------------------

  /**
   * Draws one of everything the fight can show, off the books, before anyone's watching. A GPU driver finishes
   * building each shader the first time it's used, and on the TV that's a freeze of most of a second.
   */
  prewarm(): void {
    try {
      const game = new Rush({ seed: 1, peek: false, barrelsDrop: false, camChance: 0, whiskeyEvery: 0, rollEvery: 0 });
      const inner = game as unknown as {
        makeEnemy(kind: string): RushEnemy;
        enterStage(stage: unknown): void;
        level: { stage: { kind: string }; next(): unknown };
      };
      const kinds = ["rusher", "shield", "thrower", "fat", "golden", "rusher"];
      game.enemies = kinds.map((kind, i) => {
        const e = inner.makeEnemy(kind);
        e.peeking = 0;
        e.stepTo = null;
        e.x = (i - 2.5) * 1.6;
        e.z = -12;
        return e;
      });
      game.enemies[5]!.burning = RUSH.burnSec;
      game.enemies[5]!.weapon = null;
      game.thrown = [{ id: 9001, x: 1, y: 2, z: -8, vx: 0, vy: 0, vz: 0 }];
      game.barrels = [{ id: 9002, x: -2, y: 0, z: -14, roll: 0, turned: 0, vy: 0 }];
      game.fires = [{ id: 9003, x: 2, z: -10, radius: 1.5, left: 2 }];
      game.parkedCannons = [{ x: 3, z: -16, yaw: 0 }];
      game.whiskey = { x: 0, y: 1, z: -9, t: 0.5, fromX: 0, landX: 0 };
      this.fireGun(this.time);
      this.blast(0, 1, -11, true);
      this.landingSmoke(1, -11, true);
      this.sparks(0, 1, -11);
      this.effects.tracer([0, 1, 0], [0, 1, -10]);
      this.render({ kind: "rush", game }, 0.016, 0);
      this.render({ kind: "rush", game }, 0.016, 0);
      this.render({ kind: "menu" }, 0.016, 0);
      // The bullet cam and its x-ray, on the first of them.
      const target = game.enemies[0]!;
      game.enemies = game.enemies.slice(1);
      const point = { x: target.x, y: 2, z: 0 } as never;
      this.onRush({ type: "shot", point: [target.x, 2, target.z], killed: { enemy: target, zone: "head", point, cam: true }, bossHit: false, thrown: null }, 0, 0);
      game.cam = { enemy: target, zone: "head", point, t: 0.3, pierce: false, xray: "skull" };
      for (const t of [0.3, RUSH_CAM.bulletSec + 0.5, RUSH_CAM.bulletSec + RUSH_CAM.xraySec + 0.3]) {
        game.cam.t = t;
        this.render({ kind: "rush", game }, 0.016, 0);
      }
      game.cam = null;
      // The ride's end: the arena, the gator and the night.
      game.enemies = [];
      game.thrown = [];
      game.barrels = [];
      game.fires = [];
      while (inner.level.stage.kind !== "boss") inner.enterStage(inner.level.next());
      if (!game.enemies.length) game.enemies = [inner.makeEnemy("boss")];
      this.render({ kind: "rush", game }, 0.016, 0);
    } catch (error) {
      console.warn("[ragebait] prewarm stopped early", error);
    }
    this.resetRush();
    this.killCam.reset();
    this.camDropped = false;
    this.shake = 0;
    this.flash = 0;
    this.time = 0;
    this.railYaw = 0;
    this.night = 0;
    this.gunAction.fired = -10;
    this.gunAction.shots = 0;
  }

  resetRush(): void {
    this.goons.clear();
    this.fallen = [];
    this.staggers = [];
    this.looseHats = [];
    this.particles.length = 0;
    this.camGoon = null;
    this.ringT = -1;
    this.ringDust.clear();
    this.gatorFlinch = 0;
    this.gatorOuch = 0;
    this.gatorTaunt = 0;
    this.gatorFlash = 0;
    this.bossShieldLeft = 0;
    this.heat = 0;
    this.punch = 0;
    this.impactLeft = 0;
    this.fireBits = [];
    this.planks = [];
    this.gunPuffs = [];
    this.reloadView = null;
    this.gunAction.shots = 0;
    this.gunAction.open = 0;
    this.gunAction.loadSpin = 0;
  }

  onRush(event: RushEvent, railX: number, railZ: number): void {
    this.rx = railX;
    this.rz = railZ;
    if (event.type === "bossLanded") {
      this.bossSlam();
    } else if (event.type === "strikeDone") {
      this.landingSmoke(event.x, event.z, false);
    } else if (event.type === "cannonFired") {
      this.cannonKick = 1;
      this.shake = Math.max(this.shake, 1.2);
      const mouth = 1.7;
      this.blast(event.x + Math.sin(event.yaw) * mouth, 1.25, event.z + Math.cos(event.yaw) * mouth, true);
    } else if (event.type === "trampled") {
      this.shake = Math.max(this.shake, 0.7);
      this.landingSmoke(event.x, event.z, true);
      this.sparks(event.x, 1.2, event.z);
    } else if (event.type === "arena") {
      this.ringT = 0;
      this.ringDust.clear();
    } else if (event.type === "bossHurt") {
      this.gatorFlash = STAGGER_FLASH_SEC;
      if (event.heart) {
        this.gatorOuch = 0.5;
        this.gatorFlinch = GATOR_FLINCH_SEC;
        this.shake = Math.max(this.shake, 0.7);
        this.killPunch(PUNCH_BODY);
      } else {
        this.gatorFlinch = Math.max(this.gatorFlinch, GATOR_FLINCH_SEC * 0.5);
      }
    } else if (event.type === "bossBlocked") {
      this.bossShieldLeft = BOSS_SHIELD_SEC;
      // The bullet glances off, away into the air.
      const at: LookV3 = [event.x + railX, event.y, event.z + railZ];
      this.effects.tracer(at, [at[0] + rand(-6, 6), at[1] + rand(1.5, 6), at[2] + rand(-2, 6)]);
      for (let i = 0; i < 14; i++) {
        this.emit(at[0], at[1], at[2], rand(-4, 4), rand(-1, 5), rand(-1, 4),
          i % 2 === 0 ? BLUE_SPARK : COLORS.spark, rand(0.03, 0.08), rand(0.2, 0.45), 7, 1);
      }
    } else if (event.type === "bossRicochet") {
      // No shield this time: a spray of sparks off his hide, and the bullet away into the air.
      const at: LookV3 = [event.x + railX, event.y, event.z + railZ];
      this.effects.tracer(at, [at[0] + rand(-7, 7), at[1] + rand(1.5, 7), at[2] + rand(-2, 7)]);
      for (let i = 0; i < 12; i++) {
        this.emit(at[0], at[1], at[2], rand(-5, 5), rand(0, 6), rand(0, 5),
          i % 3 === 0 ? FIRE_CORE : COLORS.spark, rand(0.03, 0.07), rand(0.15, 0.35), 8, 1);
      }
    } else if (event.type === "struck") {
      this.shake = 1.5;
      this.gatorTaunt = 1.3;
    } else if (event.type === "shot") {
      this.fireGun(this.time);
      this.shake = Math.max(this.shake, 0.2);
      this.camFrom = [this.muzzle[0], this.muzzle[1], this.muzzle[2]];
      event.point[0] += railX;
      event.point[2] += railZ;
      if (event.killed?.cam) {
        // Nothing shows yet: the bullet cam flies this bullet itself.
        this.killCam.reset();
        this.particles.length = 0;
        this.camDropped = false;
        this.camGoon = this.goons.get(event.killed.enemy.id) ?? null;
        this.goons.delete(event.killed.enemy.id);
        return;
      }
      this.effects.tracer(this.muzzle, event.point);
      if (event.killed) {
        const { enemy, zone, point } = event.killed;
        this.killPunch(zone === "head" ? PUNCH_HEAD : PUNCH_BODY);
        if ((zone === "head" && this.multiplier >= 3) || enemy.kind === "golden") this.impactFrame();
        const goon = this.goons.get(enemy.id);
        this.goons.delete(enemy.id);
        if (enemy.shieldHp > 0) this.dropShield(enemy, 3);
        // A flash and a shake on the spot, and only then does the shot throw them back.
        if (goon) {
          goon.flash = STAGGER_FLASH_SEC;
          this.staggers.push({ enemy, goon, zone, point, t: 0 });
        } else {
          this.dropGoon(enemy, zone, point);
        }
        this.sparks(point.x, point.y, enemy.z);
      } else if (event.bossHit) {
        this.sparks(event.point[0], event.point[1], event.point[2]);
      } else if (!event.thrown) {
        this.effects.miss(event.point, hex(this.dir.palette.sandPatch));
      }
    } else if (event.type === "smashed") {
      this.smash(event.x, event.y, event.z);
    } else if (event.type === "fireBurst") {
      this.blast(event.x, event.y, event.z, false);
      this.fireball(event.x, event.y, event.z, 16);
      this.shake = Math.max(this.shake, 0.5);
    } else if (event.type === "ignited") {
      const goon = this.goons.get(event.enemy.id);
      if (goon) goon.flash = STAGGER_FLASH_SEC;
      if (event.enemy.shieldHp > 0) this.dropShield(event.enemy, 3);
    } else if (event.type === "burnedDown") {
      this.goons.delete(event.enemy.id);
      // They've nothing left: down on the spot, charred, with the last of the flames on them.
      this.dropGoon(event.enemy, "body", { x: event.enemy.x, y: 1.2 }, [rand(-0.5, 0.5), 1.5, 0], true);
    } else if (event.type === "wounded") {
      const goon = this.goons.get(event.enemy.id);
      if (goon) goon.flash = STAGGER_FLASH_SEC;
      this.shake = Math.max(this.shake, 0.3);
    } else if (event.type === "pierced") {
      const from: LookV3 = [event.from[0], event.from[1], event.from[2]];
      const to: LookV3 = [event.to[0] + railX, event.to[1], event.to[2] + railZ];
      // During a bullet cam, it plays out in the x-ray instead.
      if (!this.camGoon) {
        this.effects.tracer(from, to);
        this.exitSpray(from[0] - railX, from[1], from[2] - railZ);
      }
      if (event.next) {
        const { enemy, zone, point } = event.next;
        const goon = this.goons.get(enemy.id);
        this.goons.delete(enemy.id);
        this.killPunch(PUNCH_HEAD);
        if (goon) {
          goon.flash = STAGGER_FLASH_SEC;
          this.staggers.push({ enemy, goon, zone, point, t: 0 });
        } else {
          this.dropGoon(enemy, zone, point);
        }
        this.sparks(point.x, point.y, enemy.z);
      }
    } else if (event.type === "blocked") {
      const goon = this.goons.get(event.enemy.id);
      if (goon) {
        goon.shieldHitUntil = goon.clock + SHIELD_HIT_SEC;
        goon.shieldFlash = STAGGER_FLASH_SEC;
      }
      this.splinters(event.x, event.y, event.z, 16);
      this.shake = Math.max(this.shake, 0.35);
    } else if (event.type === "shieldBroke") {
      this.dropShield(event.enemy, 5);
      this.splinters(event.x, event.y, event.z, 36);
      this.shake = Math.max(this.shake, 0.8);
    } else if (event.type === "hat") {
      const { x, y, z, outfit } = event.enemy;
      this.looseHats.push({
        x, y: y + 2.4, z,
        vx: rand(-1.4, 1.4), vy: 6, vz: -1.5,
        spin: 0, outfit, age: 0,
      });
    } else if (event.type === "barrel") {
      if (event.killed.length >= 2) this.impactFrame();
      this.killPunch(PUNCH_BODY * 1.5);
      this.blast(event.x, event.y + 0.7, event.z, true);
      this.fireball(event.x, event.y + 0.8, event.z, 34);
      this.shake = Math.max(this.shake, 1.2);
      for (const enemy of event.killed) {
        this.goons.delete(enemy.id);
        if (enemy.shieldHp > 0) this.dropShield(enemy, 3);
        const dx = enemy.x - event.x;
        const dz = enemy.z - event.z;
        const length = Math.hypot(dx, dz) || 1;
        this.dropGoon(enemy, "body", { x: enemy.x, y: 1.2 }, [(dx / length) * 9, 6, (dz / length) * 9]);
      }
    } else if (event.type === "barrelLanded") {
      this.landingSmoke(event.x, event.z, event.hard);
    } else if (event.type === "reloading") {
      this.gunAction.shots = 0;
      this.gunAction.loadSpin = 0;
    }
  }

  private dropGoon(
    enemy: RushEnemy,
    zone: "head" | "nuts" | "body",
    point: Vec2,
    punt: [number, number, number] = [rand(-1.2, 1.2), PUNT_UP, -PUNT_BACK],
    burnt = false,
  ): void {
    const body = this.newDowned(enemy.x + this.rx, enemy.z + this.rz, 1, enemy.outfit);
    body.lizard = true;
    body.rag.hit({ zone, landing: { x: point.x + this.rx, y: point.y, z: enemy.z + this.rz + 0.25 }, power: 0.7 });
    body.rag.punt(punt[0], punt[1], punt[2]);
    const burntAt = burnt ? { x: enemy.x + this.rx, z: enemy.z + this.rz } : undefined;
    this.fallen.push({ ...body, age: 0, hatOff: enemy.hatOff, burntAt });
    if (this.fallen.length > MAX_FALLEN) this.fallen.shift();
  }

  /** The camera jumps in on a kill, harder the longer the combo's been running. */
  private killPunch(amount: number): void {
    if (this.calm) return;
    this.punch = Math.max(this.punch, amount * (1 + (this.multiplier - 1) * 0.15));
  }

  /** A single two-tone frame on the biggest kills. They're rare, and held well apart. */
  private impactFrame(): void {
    if (this.calm || this.sinceImpact < IMPACT_GAP_SEC) return;
    this.impactLeft = IMPACT_SEC;
    this.sinceImpact = 0;
  }

  /** He hits the street like a dropped safe: a ring of dust, rubble in the air, and everything jumps. */
  private bossSlam(): void {
    this.shake = 2;
    this.killPunch(PUNCH_HEAD);
    const x = this.rx;
    const z = RUSH.bossZ + this.rz;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const speed = rand(5, 8.5);
      this.pushBit({
        kind: "dust",
        x: x + Math.cos(a) * 1.5, y: rand(0.1, 0.5), z: z + Math.sin(a) * 1.5,
        vx: Math.cos(a) * speed, vy: rand(0.2, 1.2), vz: Math.sin(a) * speed,
        from: rand(0.35, 0.5), to: rand(1, 1.5),
        age: 0, life: rand(0.8, 1.3), seed: Math.random(),
      });
    }
    for (let i = 0; i < 46; i++) {
      this.emit(x + rand(-2, 2), 0.2, z + rand(-2, 2),
        rand(-7, 7), rand(2, 9), rand(-7, 7),
        i % 3 === 0 ? COLORS.dust : WOOD_DARK, rand(0.06, 0.16), rand(0.5, 1.1), 11, 0.6);
    }
  }

  /** Takes a spot in the ring to where it's drawn now, however far the camera's got on its way there. */
  private ringMatrix(local: LookMat4): LookMat4 {
    const fixed = multiply(RING_SWING, multiply(translation(BANK_STOP.x, 0, BANK_STOP.z), local));
    const now = this.railYaw
      ? multiply(multiply(translation(this.rx, 0, this.rz), rotationY(-this.railYaw)), translation(-this.rx, 0, -this.rz))
      : null;
    return now ? multiply(invert(now), fixed) : fixed;
  }

  /**
   * The arena. The bank, the stands and the wreckage are there from the start of the ride, fixed at the end
   * of the road. The rodeo fence comes up out of the ground as the camera arrives.
   */
  private arenaThings(game: Rush, dt: number): MovingThing[] {
    if (game.phase === "rush" || game.phase === "clear") return [];
    const out: MovingThing[] = [];
    const piece = (prop: PropName, local: LookMat4, shadow = true): MovingThing => ({
      mesh: this.props[prop], model: this.ringMatrix(local), character: false, shadow, toon: true,
    });
    /** A spot on a circle round the ring, facing its middle. */
    const around = (deg: number, radius: number, y = 0): LookMat4 => {
      const a = (deg * Math.PI) / 180;
      return multiply(translation(RING.x + Math.sin(a) * radius, y, RING.z - Math.cos(a) * radius), rotationY(-a));
    };
    out.push(piece("arena_floor", multiply(translation(RING.x, 0.06, RING.z), scaling(RING.radius * 1.12, 1, RING.radius * 1.12)), false));
    for (const p of RING_PROPS) {
      const s = p.scale ?? 1;
      const local = multiply(multiply(multiply(translation(p.x, p.y ?? 0, p.z), rotationY(p.yaw)), rotationX(p.tilt ?? 0)), scaling(s, s, s));
      out.push(piece(p.prop, local));
    }
    // The crowd's on its feet for his entrance, and bouncing whenever his heart's showing.
    const worked = game.phase === "challenge" || game.phase === "faceoff" || game.phase === "bossDrop" || game.heartOpen;
    RING_STANDS.forEach((deg, i) => {
      const stand = around(deg, STAND_RADIUS);
      out.push(piece("stand", stand));
      const bounce = Math.abs(Math.sin(this.time * (worked ? 9 : 4.5) + i * 1.9)) * (worked ? 0.26 : 0.08);
      out.push(piece("crowd", multiply(stand, translation(0, bounce, 0)), false));
    });
    RING_TORCHES.forEach((deg, i) => {
      const torch = around(deg, TORCH_RADIUS);
      out.push(piece("torch", torch));
      const [x, y, z] = transformPoint(this.ringMatrix(torch), [0, TORCH_TOP, 0]);
      this.tongue(x, y, z, 1, (i * 0.37) % 1);
    });
    // The fence comes up a length at a time, round from the bank.
    if (this.ringT >= 0) this.ringT += dt;
    RING_FENCE.forEach((deg, i) => {
      const started = this.ringT - (Math.abs(deg) / 151) * 0.8;
      const up = this.ringT < 0 ? (game.phase === "travel" ? 0 : 1) : smooth(0, 0.28, started);
      if (up <= 0) return;
      const local = multiply(around(deg, RING.radius, (up - 1) * 2), rotationZ(((i * 37) % 11 - 5) * 0.008));
      out.push(piece("fence", local));
      if (up >= 1 && RING_POSTERS.includes(i)) out.push(piece("poster", multiply(local, translation(((i * 13) % 5 - 2) * 0.4, 1.05, 0.2)), false));
      if (started > 0 && !this.ringDust.has(i)) {
        this.ringDust.add(i);
        const [wx, , wz] = transformPoint(this.ringMatrix(around(deg, RING.radius)), [0, 0, 0]);
        this.landingSmoke(wx - this.rx, wz - this.rz, false);
        this.shake = Math.max(this.shake, 0.25);
      }
    });
    // Still burning, and smoke going up from the hole.
    RING_FIRES.forEach((f, i) => {
      const [x, y, z] = transformPoint(this.ringMatrix(translation(f.x, 0.1, f.z)), [0, 0, 0]);
      this.tongue(x, y, z, f.tall, (i * 0.23) % 1);
    });
    this.smokeIn -= dt;
    if (this.smokeIn <= 0) {
      this.smokeIn = SMOKE_GAP_SEC;
      const [x, y, z] = transformPoint(this.ringMatrix(translation(rand(-3, 3), rand(4.5, 6.5), BANK_Z)), [0, 0, 0]);
      this.pushBit({
        kind: "smoke",
        x, y, z,
        vx: rand(-0.15, 0.3), vy: rand(1.2, 1.9), vz: rand(-0.15, 0.15),
        from: rand(0.45, 0.65), to: rand(1.3, 1.8),
        age: 0, life: rand(1.5, 2.1), seed: Math.random(),
      });
    }
    return out;
  }

  /** The cannons in the street, and the great ball with whoever it's picked up. */
  private cannonThings(game: Rush, dt: number): MovingThing[] {
    const out: MovingThing[] = [];
    const cannon = (x: number, y: number, z: number, yaw: number, kick: number): MovingThing => ({
      mesh: this.props.cannon,
      model: multiply(multiply(translation(x + this.rx, y, z + this.rz), rotationY(yaw)), translation(0, 0, -kick * CANNON_RECOIL)),
      character: false, shadow: true, toon: true,
    });
    for (const p of game.parkedCannons) out.push(cannon(p.x, 0, p.z, p.yaw, 1));
    const c = game.cannon;
    if (!c) return out;
    // It's hauled along in heaves, and jumps back when it goes off.
    this.cannonKick = Math.max(0, this.cannonKick - dt * 3);
    const fired = c.phase === "roll" || c.phase === "recover";
    const kick = fired ? 1 - this.cannonKick * this.cannonKick * 0.6 : 0;
    const heave = c.phase === "rollout" ? Math.abs(Math.sin(c.t * 7)) * 0.04 : 0;
    out.push(cannon(c.x, heave, c.z, c.yaw, kick));
    // The fuse burns down while the warning's up.
    if (c.phase === "warn") {
      const [fx, fy, fz] = transformPoint(multiply(translation(c.x + this.rx, 0, c.z + this.rz), rotationY(c.yaw)), [0.13, 1.66, -0.6]);
      this.tongue(fx, fy, fz, 0.42, 0.4);
      if (Math.random() < 0.6) {
        this.emit(fx, fy, fz, rand(-1.5, 1.5), rand(0.6, 2.6), rand(-1.5, 1.5), FIRE_CORE, rand(0.03, 0.07), rand(0.2, 0.4), 4, 1);
      }
    }
    const ball = c.ball;
    if (!ball) return out;
    const r = RUSH.ballRadius;
    const hop = Math.abs(Math.sin(ball.turned * 0.7)) * 0.1;
    const at = multiply(translation(ball.x + this.rx, r + hop, ball.z + this.rz), rotationY(c.yaw));
    out.push({
      mesh: this.props.cannonball,
      model: multiply(multiply(at, rotationX(ball.turned)), scaling(r, r, r)),
      character: false, shadow: true, toon: true,
    });
    // Everyone it's caught, pressed flat to its surface and going round with it.
    if (!this.splatRig) {
      this.splatRig = new Rig(this.skeleton);
      this.splatRig.play("splat", 0, { fade: 0 });
      this.splatRig.update(0);
    }
    for (const s of c.stuck) {
      const model = multiply(
        multiply(multiply(at, rotationX(ball.turned + s.angle)), translation(0, 0, r - 0.02)),
        multiply(scaling(0.88, 0.88, SPLAT_THICK), translation(0, -1.35, 0)),
      );
      out.push(this.lizardThing(this.splatRig, model, s.outfit, "x", "openA"));
    }
    // The ground shakes harder the nearer it gets, and it kicks up a wake of dirt.
    this.shake = Math.max(this.shake, smooth(-20, -3, ball.z) * (1 - smooth(0, 6, ball.z)) * 1.1);
    if (Math.random() < dt * 22) {
      this.pushBit({
        kind: "dust",
        x: ball.x + this.rx + rand(-r, r), y: rand(0.1, 0.4), z: ball.z + this.rz - r * 0.6,
        vx: rand(-1.8, 1.8), vy: rand(0.5, 1.6), vz: rand(-2.5, 0),
        from: rand(0.4, 0.6), to: rand(1.1, 1.6),
        age: 0, life: rand(0.5, 0.9), seed: Math.random(),
      });
    }
    return out;
  }

  /** Sparks and bits thrown out the back of someone a bullet's gone through. */
  private exitSpray(x: number, y: number, z: number): void {
    for (let i = 0; i < 22; i++) {
      this.emit(x + this.rx, y, z + this.rz - 0.3,
        rand(-1.6, 1.6), rand(-0.4, 2.2), rand(-8, -3),
        i % 2 === 0 ? COLORS.spark : FIRE_CORE,
        rand(0.03, 0.08), rand(0.2, 0.5), 5, 0.6);
    }
  }

  /** Bits of wood off a shield, some fresh and pale, some dark. */
  private splinters(x: number, y: number, z: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.emit(x + this.rx, y, z + this.rz,
        rand(-3.6, 3.6), rand(0, 5.5), rand(0.5, 4.5),
        i % 3 === 0 ? WOOD_DARK : WOOD_CHIP,
        rand(0.04, 0.11), rand(0.35, 0.8), 11, 0.8);
    }
  }

  /** The shield comes apart, or falls from their hands: its boards go flying. */
  private dropShield(enemy: RushEnemy, boards: number): void {
    for (let i = 0; i < boards; i++) {
      const u = boards > 1 ? i / (boards - 1) - 0.5 : 0;
      this.planks.push({
        x: enemy.x + this.rx + u * 0.9,
        y: 1 + rand(-0.15, 0.15),
        z: enemy.z + this.rz + 0.7,
        vx: u * 7 + rand(-0.8, 0.8),
        vy: rand(3, 6),
        vz: rand(0.5, 3.5),
        rx: 0,
        rz: 0,
        spinX: rand(-8, 8),
        spinZ: rand(-9, 9),
        age: 0,
      });
    }
  }

  private plankThings(dt: number): MovingThing[] {
    const out: MovingThing[] = [];
    for (const p of this.planks) {
      p.age += dt;
      if (p.y > 0.09) {
        p.vy -= 12 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.rx += p.spinX * dt;
        p.rz += p.spinZ * dt;
        if (p.y <= 0.09) {
          // Lands flat, or near enough.
          p.y = 0.09;
          p.rx = Math.PI / 2;
          p.rz = Math.round(p.rz / Math.PI) * Math.PI + rand(-0.4, 0.4);
        }
      }
      const model = multiply(multiply(translation(p.x, p.y, p.z), rotationZ(p.rz)), rotationX(p.rx));
      out.push({ mesh: this.props.shield_plank, model, character: false, shadow: true, toon: true });
    }
    this.planks = this.planks.filter((p) => p.age < PLANK_SEC);
    return out;
  }

  private pushBit(bit: FireBit): void {
    if (this.fireBits.length >= MAX_FIRE_BITS) this.fireBits.shift();
    this.fireBits.push(bit);
  }

  /**
   * A low-poly explosion: faceted fireballs that swell and eat themselves away, smoke climbing out of
   * them, and for a bottle, drops of burning fuel that fall to the street.
   */
  private blast(localX: number, y: number, localZ: number, big: boolean): void {
    const x = localX + this.rx;
    const z = localZ + this.rz;
    const spread = big ? 0.8 : 0.3;
    for (let i = 0; i < (big ? 7 : 3); i++) {
      this.pushBit({
        kind: "ball",
        x: x + rand(-spread, spread), y: y + rand(-0.1, big ? 1.1 : 0.4), z: z + rand(-spread, spread),
        vx: rand(-1, 1), vy: rand(0.4, 2), vz: rand(-1, 1),
        from: big ? rand(0.5, 0.9) : rand(0.2, 0.34),
        to: big ? rand(1.5, 2.3) : rand(0.65, 0.95),
        age: i * 0.02, life: big ? rand(0.42, 0.72) : rand(0.32, 0.46), seed: Math.random(),
      });
    }
    for (let i = 0; i < (big ? 6 : 3); i++) {
      this.pushBit({
        kind: "smoke",
        x: x + rand(-spread, spread), y: y + rand(0.2, 1), z: z + rand(-spread, spread),
        vx: rand(-0.5, 0.7), vy: rand(1.3, 2.6), vz: rand(-0.4, 0.4),
        from: big ? rand(0.3, 0.5) : rand(0.2, 0.3),
        to: big ? rand(0.85, 1.25) : rand(0.5, 0.75),
        age: -i * 0.04 - 0.08, life: big ? rand(0.9, 1.4) : rand(0.7, 1), seed: Math.random(),
      });
    }
    if (big) return;
    for (let i = 0; i < 7; i++) {
      this.pushBit({
        kind: "drip",
        x, y, z,
        vx: rand(-2.6, 2.6), vy: rand(-0.5, 3), vz: rand(-2.6, 2.6),
        from: rand(0.1, 0.17), to: 0.06,
        age: 0, life: 1.4, seed: Math.random(),
      });
    }
  }

  /** A barrel hitting the street: smoke and dust thrown out low, all round it, and a jolt. */
  private landingSmoke(localX: number, localZ: number, hard: boolean): void {
    const x = localX + this.rx;
    const z = localZ + this.rz;
    const count = hard ? 7 : 3;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand(-0.3, 0.3);
      const speed = hard ? rand(1.8, 3.2) : rand(0.8, 1.4);
      this.pushBit({
        kind: "dust",
        x: x + Math.cos(a) * 0.55, y: rand(0.1, 0.45), z: z + Math.sin(a) * 0.55,
        vx: Math.cos(a) * speed, vy: rand(0.2, 0.8), vz: Math.sin(a) * speed,
        from: rand(0.2, 0.32), to: hard ? rand(0.75, 1.05) : rand(0.4, 0.55),
        age: 0, life: rand(0.65, 1.05), seed: Math.random(),
      });
    }
    if (hard) this.shake = Math.max(this.shake, 0.55);
  }

  /** Moves everything in the air, and queues it to be drawn. */
  private stepFire(game: Rush, dt: number): void {
    for (const b of this.fireBits) {
      b.age += dt;
      if (b.age < 0) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.kind === "drip") {
        b.vy -= 9 * dt;
        if (b.y < 0.05) b.age = b.life;
      } else {
        b.vx *= 1 - 1.5 * dt;
        b.vz *= 1 - 1.5 * dt;
      }
      const u = clamp(b.age / b.life, 0, 1);
      const eased = 1 - (1 - u) * (1 - u) * (1 - u);
      const size = lerp(b.from, b.to, eased);
      if (b.kind === "smoke" || b.kind === "dust") {
        const colors = b.kind === "smoke" ? BLAST_PUFF : DUST_PUFF;
        this.puffList.push({ at: [b.x, b.y, b.z], size: size * 1.35, seed: b.seed, erode: Math.pow(u, 1.8), colors });
        continue;
      }
      this.flameList.push({
        mesh: "ball",
        model: multiply(translation(b.x, b.y, b.z), scaling(size, size, size)),
        seed: b.seed,
        erode: b.kind === "ball" ? u * u * 1.35 - 0.05 : u * 0.5,
        wobble: 0.7,
      });
    }
    this.fireBits = this.fireBits.filter((b) => b.age < b.life);

    // Fuel burning on the street: a loose ring of tongues that catch, burn, then gutter out.
    for (const fire of game.fires) {
      const age = RUSH.firePatchSec - fire.left;
      const grow = smooth(0, 0.25, age);
      const fade = smooth(0, 0.7, fire.left);
      const count = Math.max(5, Math.round(fire.radius * 4));
      for (let i = 0; i < count; i++) {
        const a = fract(Math.sin(fire.id * 12.9 + i * 78.2) * 437.5);
        const b = fract(Math.sin(fire.id * 39.3 + i * 11.1) * 921.7);
        const angle = (i / count) * Math.PI * 2 + a * 0.8;
        const reach = fire.radius * (0.2 + b * 0.7);
        const tall = (0.75 + a * 0.85) * grow * (0.4 + fade * 0.6);
        const wide = 0.5 * (0.7 + b * 0.5);
        const model = multiply(
          translation(fire.x + this.rx + Math.cos(angle) * reach, 0, fire.z + this.rz + Math.sin(angle) * reach),
          scaling(wide * grow, tall, wide * grow),
        );
        this.flameList.push({ mesh: "tongue", model, seed: a, erode: (1 - fade) * 0.75 });
      }
    }
  }

  /** A tongue of fire standing at this point in the world. */
  private tongue(x: number, y: number, z: number, tall: number, seed: number, erode = 0, lean?: readonly [number, number]): void {
    const wide = tall * 0.56;
    this.flameList.push({
      mesh: "tongue",
      model: multiply(translation(x, y, z), scaling(wide, tall, wide)),
      seed,
      erode,
      lean,
    });
  }

  /** Flames on every part of someone burning. They catch quickly and die with the body. */
  private burnFlames(enemy: RushEnemy, goon: Goon, model: LookMat4): void {
    const caught = smooth(0, 0.3, RUSH.burnSec - enemy.burning);
    const lean: [number, number] = [-enemy.burnX * RUSH.burnSpeed * 0.1, -enemy.burnZ * RUSH.burnSpeed * 0.1];
    const scale = this.goonScale(enemy);
    BURN_SPOTS.forEach((spot, i) => {
      const [x, y, z] = transformPoint(multiply(model, goon.rig.boneMatrix(spot.bone)), spot.at);
      this.tongue(x, y, z, spot.tall * caught * scale, ((enemy.id * 7 + i) * 0.137) % 1, 0, lean);
    });
  }

  private sparks(x: number, y: number, z: number): void {
    for (let i = 0; i < 26; i++) {
      this.emit(x + this.rx, y, z + this.rz + 0.2,
        rand(-4, 4), rand(-1, 5), rand(-3, 4),
        i % 2 === 0 ? COLORS.gold : COLORS.spark,
        rand(0.03, 0.08), rand(0.25, 0.6), 7, 1.5);
    }
  }

  private fireball(x: number, y: number, z: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const pick = i % 3;
      this.emit(x + this.rx + rand(-0.4, 0.4), y + rand(0, 0.5), z + this.rz + rand(-0.4, 0.4),
        rand(-5, 5), rand(0.5, 7), rand(-5, 5),
        pick === 0 ? FIRE_CORE : pick === 1 ? FIRE_MID : FIRE_OUTER,
        rand(0.12, 0.4), rand(0.3, 0.9), 3, 1.5);
    }
  }

  /** A thrown bottle going to pieces. */
  private smash(x: number, y: number, z: number): void {
    for (let i = 0; i < 34; i++) {
      this.emit(x + this.rx, y, z + this.rz,
        rand(-4, 4), rand(-1, 4.5), rand(-4, 4),
        i % 3 === 0 ? BOTTLE_GLASS : i % 3 === 1 ? COLORS.spark : COLORS.dust,
        rand(0.04, 0.1), rand(0.3, 0.7), 8, 1);
    }
  }

  /** The player's own view, leaning and ducking with them. */
  private rushCamera(game: Rush): LookCamera {
    const x = game.cameraX + game.railX;
    const y = game.cameraY;
    const z = game.railZ;
    const shake = this.shake * this.shake * 0.05;
    const sx = Math.sin(this.time * 67) * shake;
    const sy = Math.sin(this.time * 53) * shake;
    // The horizon tips with the lean, so it feels like the whole body's moving.
    // Riding up to the bank: each stride bounces the view and sways it, easing in and out.
    const t = game.travelT;
    const stride = t * 9.5;
    const riding = smooth(0, 0.5, t) * (1 - smooth(RIDE_SEC - 0.7, RIDE_SEC, t));
    const bobY = Math.abs(Math.sin(stride)) * 0.17 * riding;
    const bobX = Math.sin(stride) * 0.07 * riding;
    const roll = Math.sin(stride) * 0.016 * riding;
    const view = multiply(rotationZ(-game.lean * LEAN_TILT + roll), translation(-x + sx - bobX, -y + sy - bobY, -z));
    // The punch is a quick zoom, straight in.
    const proj = frustumAt(0);
    const zoom = 1 + this.punch;
    proj[0] = proj[0]! * zoom;
    proj[5] = proj[5]! * zoom;
    return { eye: [x, y, z], view, proj };
  }

  private renderRush(game: Rush, realDt: number): void {
    this.rx = game.railX;
    this.rz = game.railZ;
    if (game.phase === "faceoff") {
      this.renderFaceoff(game, realDt);
      return;
    }
    if (game.cam) {
      this.renderRushCam(game, realDt);
      return;
    }
    const dt = realDt * game.timeScale;
    this.rushRunning = true;
    this.multiplier = game.multiplier;
    const heatGoal = game.over ? 0 : (game.multiplier - 1) / (RUSH.comboMax - 1);
    this.heat += (heatGoal - this.heat) * Math.min(1, realDt * 3);
    this.reloadView = game.reload ? { reload: game.reload, ammo: game.ammo } : null;
    const cam = this.rushCamera(game);
    this.stepFire(game, dt);
    const things = this.rushThings(game, dt, cam.eye);
    const bottles = game.thrown.map((t) => ({ t, thing: this.bottleThing(t.x, t.y, t.z, t.id) }));
    things.push(...bottles.map((b) => b.thing));
    for (const { t, thing } of bottles) this.bottleFlame(thing, t.x, t.y, t.z, t.id, t.vx, t.vz);
    const held = game.canShoot
      ? this.heldItem(game.aim.x * 2 - 1, 1 - game.aim.y * 2, 0, cam, 0, realDt)
      : undefined;
    this.drawWorld(cam, things, held);
    const camera = this.overlayCamera(cam);
    this.drawLooseHats(dt);
    if (game.whiskey) this.drawBottle(game.whiskey.x, game.whiskey.y, game.whiskey.z, game.whiskey.t * 20, false, WHISKEY);
    this.drawParticles(camera);
  }

  private rushThings(game: Rush, dt: number, eye: LookV3): MovingThing[] {
    const things: MovingThing[] = [];
    const alive = new Set<number>();
    for (const enemy of game.enemies) {
      alive.add(enemy.id);
      if (enemy.kind === "boss") {
        things.push(this.gatorThing(enemy, game, dt));
        if (this.gatorHeart) things.push(this.gatorHeart);
        continue;
      }
      const goon = this.goonThing(enemy, dt, game);
      things.push(goon);
      const held = this.heldBy(enemy, goon.model);
      if (held) things.push(held);
    }
    for (const id of this.goons.keys()) if (!alive.has(id)) this.goons.delete(id);
    for (const barrel of game.barrels) things.push(this.barrelThing(barrel));
    things.push(...this.staggerThings(dt));
    things.push(...this.plankThings(dt));
    things.push(...this.arenaThings(game, dt));
    things.push(...this.cannonThings(game, dt));
    for (const body of this.fallen) {
      body.age += dt;
      body.rag.update(dt);
      body.skin.update(body.rag.points, eye, { hatOff: body.hatOff });
      const thing = this.downedThing(body, "x", "openA");
      if (body.burntAt) {
        things.push({ ...thing, tint: CHARRED });
        const erode = smooth(0.15, 1.3, body.age) * 1.3;
        if (erode < 1.3) {
          for (let i = 0; i < 3; i++) {
            this.tongue(body.burntAt.x + (i - 1) * 0.4, 0, body.burntAt.z + (i % 2) * 0.3, 0.9 - i * 0.15, i * 0.31, erode);
          }
        }
      } else {
        things.push(thing);
      }
    }
    this.fallen = this.fallen.filter((b) => b.age < FALLEN_SEC);
    return things;
  }

  /** Everyone in the beat between being shot and being thrown back. */
  private staggerThings(dt: number): MovingThing[] {
    const out: MovingThing[] = [];
    for (const s of this.staggers) {
      s.t += dt;
      s.goon.flash = Math.max(0, s.goon.flash - dt);
      if (s.t >= STAGGER_SEC) {
        this.dropGoon(s.enemy, s.zone, s.point);
        this.sparks(s.point.x, s.point.y, s.enemy.z);
        continue;
      }
      const shake = Math.sin(s.t * 110) * STAGGER_SHAKE;
      const scale = this.goonScale(s.enemy);
      const model = multiply(
        multiply(translation(s.enemy.x + this.rx + shake, s.enemy.y, s.enemy.z + this.rz), rotationZ(shake * 0.5)),
        scaling(scale, scale, scale),
      );
      if (s.enemy.hatOff) this.hideHat(s.goon.rig);
      const thing = this.lizardThing(s.goon.rig, model, s.enemy.outfit, "x", "openA");
      out.push({ ...thing, flash: s.goon.flash > 0 ? HIT_FLASH : 0 });
    }
    this.staggers = this.staggers.filter((s) => s.t < STAGGER_SEC);
    return out;
  }

  private goonScale(enemy: RushEnemy): number {
    return enemy.kind === "boss" ? RUSH.bossScale : enemy.kind === "fat" ? RUSH.fatScale : 1;
  }

  /** Shrinks the hat away about its base, once it's been shot off. */
  private hideHat(rig: Rig): void {
    const joint = this.skeleton.jointIndex.get("hat");
    if (joint === undefined) return;
    const m = rig.bones.subarray(joint * 16, joint * 16 + 16) as unknown as LookMat4;
    const [px, py, pz] = MONKEY_LAYOUT.hatPivot;
    const s = 0.0001;
    // Keeps where the pivot lands, and squashes everything else onto it.
    const tx = m[0]! * px + m[4]! * py + m[8]! * pz + m[12]!;
    const ty = m[1]! * px + m[5]! * py + m[9]! * pz + m[13]!;
    const tz = m[2]! * px + m[6]! * py + m[10]! * pz + m[14]!;
    for (let i = 0; i < 12; i++) m[i] = m[i]! * s;
    m[12] = tx - s * (m[0]! / s * px + m[4]! / s * py + m[8]! / s * pz);
    m[13] = ty - s * (m[1]! / s * px + m[5]! / s * py + m[9]! / s * pz);
    m[14] = tz - s * (m[2]! / s * px + m[6]! / s * py + m[10]! / s * pz);
  }

  /** Which clip he should be in, from what he's up to. */
  private gatorClip(game: Rush): { clip: string; once: boolean } {
    if (game.phase === "bossDrop") return { clip: "jump", once: true };
    if (game.phase === "challenge") return game.stageProgress < 0.2 ? { clip: "land", once: true } : { clip: "challenge", once: true };
    const brain = game.brain;
    if (!brain) return { clip: "pose", once: false };
    const { move, dir } = brain;
    const hurtable = move === "idle" || move === "strafe" || move === "land";
    if (this.gatorFlinch > 0 && hurtable) return { clip: "flinch", once: true };
    switch (move) {
      case "strafe": return { clip: dir > 0 ? "strafe_r" : "strafe_l", once: false };
      case "dash": return { clip: dir > 0 ? "dash_r" : "dash_l", once: true };
      case "jump": return { clip: "jump", once: true };
      case "land": return { clip: "land", once: true };
      case "duck": return { clip: "duck", once: false };
      case "reveal": return { clip: "reveal", once: false };
      case "charge": return { clip: "charge", once: true };
      case "fire": return { clip: "fire", once: false };
      default: return { clip: "idle", once: false };
    }
  }

  /** His face, reacting to whatever's going on. */
  private gatorMood(game: Rush): BossMood {
    if (game.phase === "bossDrop") return { eye: "evilWide", mouth: "roar" };
    if (game.phase === "challenge") return { eye: "evil", mouth: "evilLaugh" };
    if (game.phase === "won") return { eye: "x", mouth: "openA" };
    if (this.gatorOuch > 0) return { eye: "evilPain", mouth: "grit" };
    if (this.gatorTaunt > 0) return { eye: "evil", mouth: "evilLaugh" };
    switch (game.brain?.move) {
      case "reveal": return { eye: "evilWide", mouth: "roar" };
      case "charge": return { eye: "evilRage", mouth: "grit" };
      case "fire": return { eye: "evilRage", mouth: "roar" };
      case "duck": return { eye: "evilWide", mouth: "worried" };
      case "jump": return { eye: "evilWide", mouth: "openA" };
      case "dash": return { eye: "evil", mouth: "grit" };
      case "land": return { eye: "evil", mouth: "grit" };
      default: return {};
    }
  }

  /** The gator, at wherever the game has put it. Its clips and its face follow what it's doing. */
  private gatorThing(enemy: RushEnemy, game: Rush, dt: number): MovingThing {
    const { rig } = this.gator;
    this.gatorClock += dt;
    this.gatorFlinch = Math.max(0, this.gatorFlinch - dt);
    this.gatorOuch = Math.max(0, this.gatorOuch - dt);
    this.gatorTaunt = Math.max(0, this.gatorTaunt - dt);
    this.gatorFlash = Math.max(0, this.gatorFlash - dt);
    this.bossShieldLeft = Math.max(0, this.bossShieldLeft - dt);
    const { clip, once } = this.gatorClip(game);
    // A fresh burst has to spin up from scratch, even straight after the last one.
    if (clip === "charge" && rig.clipName === "charge" && (game.brain?.t ?? 1) < 0.06) rig.clipName = "";
    const quick = clip === "flinch" || clip.startsWith("dash");
    rig.play(clip, this.gatorClock, { fade: quick ? 0.05 : 0.14, loop: !once });
    rig.update(this.gatorClock);
    this.gatorNow = this.gatorMood(game);

    const wobble = this.gatorFlash > 0 ? Math.sin(this.time * 110) * 0.07 : 0;
    const model = multiply(translation(enemy.x + this.rx + wobble, enemy.y, enemy.z + this.rz), scaling(BOSS.drawScale, BOSS.drawScale, BOSS.drawScale));

    this.gatorHeart = game.heartOpen ? this.heartThing(model, game.brain?.t ?? 0) : null;
    if (game.brain?.move === "charge") this.gunWarning(model, game.brain.t / game.brain.dur);
    if (game.brain?.move === "fire") this.gunFire(model, game, dt);
    if (this.bossShieldLeft > 0) this.shieldBubble(model);
    // A little of his own light in the dark, so he stands out against the night behind him.
    const lift = this.night * 0.11;
    return { ...this.gatorAt(model), flash: this.gatorFlash > 0 ? HIT_FLASH * 0.7 : 0, tint: [lift, lift * 1.15, lift * 1.2] };
  }

  /** The heart he's protecting, glowing and beating out of his chest for as long as it's showing. */
  private heartThing(model: LookMat4, t: number): MovingThing | null {
    const [x, y, z] = transformPoint(multiply(model, this.gator.rig.boneMatrix("chest")), GATOR_HEART);
    const open = smooth(0, 0.18, t) * (1 - smooth(BOSS.revealSec - 0.14, BOSS.revealSec, t));
    // Lub-dub: two quick beats, then a rest. It jumps when it's hit.
    const cycle = (this.time * HEART_BEATS_PER_SEC) % 1;
    const beat = Math.max(0, 1 - cycle / 0.14) + Math.max(0, 1 - Math.abs(cycle - 0.26) / 0.1) * 0.7;
    const hit = this.gatorFlash > 0 ? 1 : 0;
    const size = BOSS.heartRadius * HEART_MODEL_SIZE * open * (1 + beat * 0.13 + hit * 0.2);
    if (size <= 0.01) return null;
    // A glow behind it that swells with each beat.
    const glow = size * (1.32 + beat * 0.22);
    this.flameList.push({
      mesh: "ball",
      // Flat, and behind it: a ball this size would stick out past the heart and tint it.
      model: multiply(translation(x, y, z + size * 0.42), scaling(glow, glow, 0.03)),
      seed: 0.6,
      erode: -0.4,
      wobble: 0.15,
      palette: HEART_HALO,
      alpha: 0.4 + beat * 0.2,
    });
    if (Math.random() < 0.4) {
      this.emit(x + rand(-0.3, 0.3), y + rand(-0.3, 0.3), z + 0.2, rand(-0.8, 0.8), rand(0.6, 2.2), rand(0, 1),
        Math.random() < 0.5 ? FIRE_MID : FIRE_OUTER, rand(0.03, 0.07), rand(0.3, 0.6), 0, 1);
    }
    return {
      mesh: this.props.heart,
      model: multiply(multiply(multiply(translation(x, y, z + size * 1.15), rotationY(Math.sin(this.time * 1.4) * 0.35)), rotationZ(-0.16)), scaling(size, size, size)),
      character: false,
      shadow: false,
      toon: true,
      // Lit from inside, brightest on the beat.
      flash: HEART_GLOW_BASE + beat * HEART_GLOW_BEAT + hit * 0.6,
    };
  }

  /** A glow building at the end of the barrels, with sparks, as the gun spins up. */
  private gunWarning(model: LookMat4, u: number): void {
    const [x, y, z] = transformPoint(multiply(model, this.gator.rig.boneMatrix("gun")), GATOR_MUZZLE);
    const size = 0.06 + u * u * 0.3;
    this.flameList.push({
      mesh: "ball",
      model: multiply(translation(x, y, z), scaling(size, size, size)),
      seed: 0.4,
      erode: 0,
      wobble: 0.6,
      palette: FLASH,
    });
    if (Math.random() < u) {
      this.emit(x, y, z, rand(-1.5, 1.5), rand(-1, 2), rand(0, 2.5),
        Math.random() < 0.5 ? COLORS.spark : FIRE_CORE, rand(0.02, 0.05), rand(0.15, 0.35), 4, 1);
    }
  }

  /** Flame at the muzzle, tracers at where you were, and brass flying out of the side. */
  private gunFire(model: LookMat4, game: Rush, dt: number): void {
    const gun = multiply(model, this.gator.rig.boneMatrix("gun"));
    const tip = transformPoint(gun, GATOR_MUZZLE);
    const flash = 0.7 + Math.random() * 0.3;
    this.flameList.push({
      mesh: (["star0", "star1", "star2"] as const)[Math.floor(this.time * 40) % 3]!,
      model: multiply(multiply(translation(tip[0], tip[1], tip[2]), rotationY(-Math.PI / 2)), scaling(flash, flash, flash)),
      seed: 0.1,
      erode: 0,
      wobble: 0,
      palette: FLASH,
    });
    this.gatorShotIn -= dt;
    while (this.gatorShotIn <= 0) {
      this.gatorShotIn += GATOR_SHOT_GAP;
      // At the spot you're standing in. Dodging takes you out of the way of it.
      const at: LookV3 = [this.rx + rand(-0.45, 0.45), PLANE.cameraY + rand(-0.35, 0.3), this.rz - 0.8];
      this.effects.tracer(tip, at);
      const side = transformPoint(gun, [GATOR_MUZZLE[0] + 0.3, GATOR_MUZZLE[1] + 0.1, GATOR_MUZZLE[2] - 3.4]);
      this.emit(side[0], side[1], side[2], rand(1.5, 3.5), rand(1.5, 3.5), rand(-0.6, 0.6),
        COLORS.brass, rand(0.04, 0.07), rand(0.3, 0.6), 11, 0.3);
    }
    void game;
  }

  /** The blue skin that shows he can't be hurt. It's only there for the moment a shot lands on it. */
  private shieldBubble(model: LookMat4): void {
    const [x, y, z] = transformPoint(multiply(model, this.gator.rig.boneMatrix("chest")), [0, 3.1, 0.3]);
    const u = 1 - this.bossShieldLeft / BOSS_SHIELD_SEC;
    const size = lerp(1.9, 2.25, u * (2 - u));
    this.flameList.push({
      mesh: "ball",
      model: multiply(translation(x, y, z), scaling(size, size * 1.08, size * 0.85)),
      seed: 0.7,
      erode: u * u * 0.95 - 0.1,
      wobble: 0.15,
      palette: BOSS_SHIELD,
      alpha: 0.42,
    });
  }

  private gatorAt(model: LookMat4): MovingThing {
    return {
      mesh: this.gator.mesh,
      model,
      character: true,
      shadow: true,
      bones: this.gator.rig.bones,
      face: bossFace(this.gator, model, this.time, 1, this.gatorNow),
    };
  }

  /**
   * The staredown, saved for the first boss: your eyes, its eyes, then both with the VS between
   * them. The HUD draws the bars, names and slash on top.
   */
  private renderFaceoff(game: Rush, dt: number): void {
    const t = game.faceoffT;
    const stage = introStage(t);
    const { width: W, height: H } = this.canvas;
    if (stage === "versus") {
      const since = t - INTRO.secondSec;
      this.stareAtMonkey(since, dt, ASPECT * 2, [0, H / 2, W, H / 2], -0.07);
      this.stareAtGator(since, dt, ASPECT * 2, [0, 0, W, H / 2], 0.07);
    } else if (stage === "first") {
      this.stareAtMonkey(t, dt, ASPECT, [0, 0, W, H], 0);
    } else {
      this.stareAtGator(t - INTRO.firstSec, dt, ASPECT, [0, 0, W, H], 0);
    }
  }

  private stareAtMonkey(since: number, dt: number, aspect: number, viewport: [number, number, number, number], shiftY: number): void {
    const rig = this.rigs[0]!;
    this.clocks[0]! += dt;
    rig.play("idle", this.clocks[0]!, { fade: 0 });
    rig.update(this.clocks[0]!);
    const model = translation(this.rx, 0, this.rz - 6);
    const thing = this.monkeyThing(rig, model, 0, "squint", "grit");
    const distance = lerp(1.95, 1.65, clamp(since / 1.6, 0, 1));
    const head = transformPoint(multiply(model, rig.boneMatrix("head")), [0, STAR_EYE.y, 0]);
    const camEye: LookV3 = [head[0], head[1] + 0.04 + shiftY, head[2] + distance];
    this.drawWorld({
      eye: camEye,
      view: lookAt(camEye, [head[0], head[1] + 0.04 + shiftY, head[2]]),
      proj: perspective(aspect > ASPECT * 1.5 ? 16 : 27, aspect, 0.2, FAR),
    }, [thing], undefined, viewport);
  }

  private stareAtGator(since: number, dt: number, aspect: number, viewport: [number, number, number, number], shiftY: number): void {
    const { rig } = this.gator;
    this.gatorClock += dt;
    rig.play("pose", this.gatorClock, { fade: 0.1 });
    rig.update(this.gatorClock);
    this.gatorNow = { eye: "evilRage", mouth: "evilGrin" };
    const s = BOSS.drawScale;
    const model = multiply(translation(this.rx, 0, this.rz + RUSH.bossZ), scaling(s, s, s));
    // Its eyes, up on the head, from far enough out to clear the snout.
    const distance = lerp(8.6, 7.6, clamp(since / 1.6, 0, 1)) * s;
    const look: LookV3 = [this.rx, GATOR_EYE_Y + shiftY, this.rz + RUSH.bossZ];
    const camEye: LookV3 = [look[0], look[1] + 0.1, look[2] + distance];
    this.drawWorld({
      eye: camEye,
      view: lookAt(camEye, look),
      proj: perspective(aspect > ASPECT * 1.5 ? 16 : 27, aspect, 0.2, FAR),
    }, [this.gatorAt(model)], undefined, viewport);
  }

  private goonThing(enemy: RushEnemy, dt: number, game?: Rush): MovingThing {
    let goon = this.goons.get(enemy.id);
    if (!goon) {
      goon = {
        rig: new Rig(this.skeleton),
        clock: enemy.id * 0.37,
        flash: 0,
        letGoAt: -1,
        throwEndsAt: -1,
        shieldHitUntil: -1,
        shieldFlash: 0,
        squash: 1,
        yaw: enemy.heading,
      };
      goon.rig.play("idle", goon.clock, { fade: 0 });
      this.goons.set(enemy.id, goon);
    }
    goon.flash = Math.max(0, goon.flash - dt);
    goon.shieldFlash = Math.max(0, goon.shieldFlash - dt);
    const burning = enemy.burning > 0;
    const grabbing = enemy.grabbing > 0;
    const ducking = enemy.ducking > 0;
    const shielded = enemy.shieldHp > 0 && !burning;
    // While the cannon's going, everyone stands and stares. Its crew are the only ones doing anything.
    const pushing = enemy.crew !== 0 && game?.cannon?.phase === "rollout";
    // Stopped where they are: everyone, while the cannon's out, and the tutorial's lizard, the whole time.
    const held = (Boolean(game?.cannon) || game?.practice === true) && !burning && !pushing;
    const walks = enemy.kind === "rusher" || enemy.kind === "shield" || enemy.kind === "fat" || enemy.kind === "golden";
    const stepping = enemy.kind === "thrower" && enemy.z < enemy.stopZ;
    const running = !grabbing && !held && enemy.raising <= 0 && (burning || walks || stepping);
    // Legs keep up with the ground, so feet don't skate. A throw or a swing keeps its own timing.
    const striding = running && enemy.swing < 0 && !ducking && enemy.peeking <= 0;
    // The swing's slowed to fit its wind-up: a long, slow raise, and then the chop comes down at full speed.
    const raiseSec = RUSH.strikeWindupSec - SWING_CHOP_SEC;
    const stride = enemy.swing >= 0 ? (enemy.swing < raiseSec ? SWING_RAISED / raiseSec : 1) : held && shielded ? 0 : burning ? 1.7 : !striding ? 1 : enemy.kind === "fat" ? 0.9 : shielded ? 1.35 : enemy.kind === "golden" ? 2 : 1.55;
    const stepBefore = Math.floor(goon.clock / RUN_STEP_SEC);
    goon.clock += dt * stride;
    if (striding && Math.floor(goon.clock / RUN_STEP_SEC) !== stepBefore && enemy.z > -26) this.footDust(enemy);

    // A throw starts with the wind-up, and carries on past the moment the bottle leaves.
    if (enemy.windup > 0 && goon.clock >= goon.throwEndsAt) {
      goon.letGoAt = goon.clock + enemy.windup;
      goon.throwEndsAt = goon.clock + THROW_CLIP_SEC;
    }
    const throwing = goon.clock < goon.throwEndsAt;
    const clip = pushing ? "push_cannon"
      : shielded && enemy.peeking > 0 ? "shield_idle"
      : shielded && enemy.stepTo !== null ? "shield_carry"
      : shielded && enemy.raising > 0 ? "shield_raise"
      : enemy.peeking > 0 ? (enemy.peekX > 0 ? "peek_r" : "peek_l")
      : ducking ? "waddle"
      : held ? (shielded ? "shield_walk" : enemy.kind === "thrower" ? "idle_molotov" : "nervous")
      : enemy.swing >= 0 ? "swing"
      : throwing ? "throw"
      : burning ? "run"
      : enemy.kind === "thrower" && !running && !grabbing ? "idle_molotov"
      : shielded ? (goon.clock < goon.shieldHitUntil ? "shield_hit" : "shield_walk")
      : grabbing ? "nervous"
      : enemy.weapon && running ? "run_weapon"
      : running ? "run"
      : "idle";
    const once = clip === "swing" || clip === "throw" || clip === "shield_hit" || clip === "shield_raise";
    goon.rig.play(clip, goon.clock, { fade: clip === "shield_hit" ? 0.04 : once ? 0.08 : 0.14, loop: !once });
    goon.rig.update(goon.clock);
    if (enemy.hatOff) this.hideHat(goon.rig);
    const scale = this.goonScale(enemy);
    goon.squash += ((ducking ? DUCK_SQUASH : 1) - goon.squash) * Math.min(1, dt * 14);
    // Everyone faces where they're going, turning into it. Someone on fire goes wherever they've got to.
    const facing = burning ? Math.atan2(enemy.burnX, enemy.burnZ) : enemy.heading;
    const turn = ((facing - goon.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    goon.yaw += turn * Math.min(1, dt * 12);
    // They lean into a turn, like anyone running flat out.
    const bank = burning ? 0 : clamp(-goon.yaw * 0.18, -0.26, 0.26);
    const model = multiply(
      multiply(multiply(translation(enemy.x + this.rx, enemy.y, enemy.z + this.rz), rotationZ(bank)), rotationY(goon.yaw)),
      scaling(scale, scale * goon.squash, scale),
    );

    if (burning) {
      this.burnFlames(enemy, goon, model);
      if (Math.random() < 0.5) {
        this.emit(enemy.x + this.rx + rand(-0.5, 0.5), rand(0.8, 2.6), enemy.z + this.rz + rand(-0.4, 0.5),
          rand(-0.5, 0.5), rand(2, 4.5), rand(-0.5, 0.5),
          Math.random() < 0.5 ? FIRE_CORE : FIRE_MID,
          rand(0.03, 0.07), rand(0.3, 0.6), 0, 1);
      }
    } else if (enemy.kind === "golden" && Math.random() < 0.5) {
      this.emit(enemy.x + this.rx + rand(-0.6, 0.6), rand(0.3, 2.6), enemy.z + this.rz + 0.4,
        rand(-0.3, 0.3), rand(0.2, 1), 0,
        COLORS.gold, rand(0.04, 0.09), rand(0.3, 0.6), 0, 1);
    }

    const angry = enemy.windup > 0 || enemy.kind === "boss" || (walks && enemy.z > -14);
    const scared = burning || grabbing || ducking || held || enemy.peeking > 0;
    const eye = scared ? "wide" : angry ? "squint" : "wide";
    const mouth = burning ? "openA" : grabbing || ducking ? "worried" : angry ? "grit" : "openA";
    const thing = this.lizardThing(goon.rig, model, enemy.outfit, eye, mouth);
    // The fire chars them as it goes, under a warm glow from the flames.
    const burnt = burning ? 1 - enemy.burning / RUSH.burnSec : 0;
    const tint: readonly [number, number, number] | undefined = burning
      ? [0.1 - burnt * 0.8, -0.14 - burnt * 0.62, -0.26 - burnt * 0.52]
      : undefined;
    return { ...thing, flash: goon.flash > 0 ? HIT_FLASH : 0, tint };
  }

  /** A little kick of dirt from a foot coming down. */
  private footDust(enemy: RushEnemy): void {
    for (let i = 0; i < 2; i++) {
      this.emit(enemy.x + this.rx + rand(-0.3, 0.3), 0.08, enemy.z + this.rz + rand(-0.2, 0.2),
        rand(-0.5, 0.5), rand(0.3, 0.9), rand(-0.6, -0.1),
        COLORS.dust, rand(0.07, 0.13), rand(0.22, 0.4), 1.5, 1.5);
    }
  }

  /** Stands upright, or on its side and turning if it's rolling across the street. */
  private barrelThing(barrel: { x: number; y: number; z: number; roll: number; turned: number }): MovingThing {
    const x = barrel.x + this.rx;
    const z = barrel.z + this.rz;
    const rolling = barrel.roll !== 0;
    const model = rolling
      ? multiply(
          multiply(translation(x, RUSH.barrelHalfWidth, z), rotationZ(-barrel.turned)),
          multiply(rotationX(Math.PI / 2), translation(0, -RUSH.barrelHeight / 2, 0)),
        )
      : multiply(translation(x, barrel.y, z), rotationZ(barrel.y * 0.05));
    // A little flame on the fuse, spitting sparks, whichever way up it is.
    const [sx, sy, sz] = transformPoint(model, [0.33, 1.63, 0.03]);
    this.tongue(sx, sy, sz, 0.3, barrel.x % 1 + 0.5);
    if (Math.random() < 0.25) {
      this.emit(sx, sy + 0.15, sz,
        rand(-0.9, 0.9), rand(0.4, 1.8), rand(-0.9, 0.9),
        Math.random() < 0.5 ? COLORS.spark : FIRE_CORE,
        rand(0.025, 0.06), rand(0.15, 0.4), 4, 1);
    }
    return { mesh: this.props.barrel, model, character: false, shadow: true };
  }

  private drawLooseHats(dt: number): void {
    const { m, s } = this;
    for (const hat of this.looseHats) {
      hat.age += dt;
      if (hat.y > 0.06) {
        hat.vy -= 11 * dt;
        hat.x += hat.vx * dt;
        hat.y = Math.max(0.06, hat.y + hat.vy * dt);
        hat.z += hat.vz * dt;
        hat.spin += dt * 9;
      }
      const o = this.outfitOf(hat.outfit);
      s.reset().translate(hat.x, hat.y, hat.z);
      if (hat.y > 0.06) s.rotZ(hat.spin).rotX(hat.spin * 0.6);
      s.scale(0.85);
      drawLooseHat(this.overlay, m, s, hatPalette(hex(o.hat), hex(o.band)));
    }
    this.looseHats = this.looseHats.filter((h) => h.age < HAT_SEC);
  }

  /** What this goon has in its hand right now, if anything. */
  private heldBy(enemy: RushEnemy, model: LookMat4): MovingThing | null {
    const goon = this.goons.get(enemy.id);
    if (!goon || enemy.burning > 0) return null;
    if (enemy.shieldHp > 0) {
      // It looks more and more shot up as it takes hits.
      const mesh = enemy.shieldHp >= 3 ? this.props.shield : enemy.shieldHp === 2 ? this.props.shield_shot : this.props.shield_wrecked;
      return {
        mesh,
        model: shieldMatrix(model, goon.rig, this.shieldHold),
        character: false,
        shadow: true,
        toon: true,
        flash: goon.shieldFlash > 0 ? HIT_FLASH * 0.6 : 0,
      };
    }
    let prop: PropName | null = enemy.weapon;
    if (enemy.kind === "thrower") {
      // Empty-handed from the moment it lets go, until the throw has finished.
      const thrown = goon.clock >= goon.letGoAt && goon.clock < goon.throwEndsAt;
      prop = thrown ? null : "molotov";
    }
    if (!prop) return null;
    const matrix = heldMatrix(model, goon.rig);
    if (prop === "molotov") {
      // Already lit, so you can see who's about to throw.
      const [x, y, z] = transformPoint(matrix, [0.05, 0.56, 0]);
      this.tongue(x, y, z, 0.42, (enemy.id * 0.31) % 1);
    }
    return { mesh: this.props[prop], model: matrix, character: false, shadow: true, toon: true };
  }

  /** A tumbling molotov from the model, flying with a flame at its neck and a trail of fire. */
  private bottleThing(localX: number, y: number, localZ: number, seed: number): MovingThing {
    const spin = this.time * 7 + seed;
    const model = multiply(
      multiply(translation(localX + this.rx, y, localZ + this.rz), multiply(rotationZ(spin), rotationX(spin * 0.6))),
      scaling(BOTTLE_SIZE, BOTTLE_SIZE, BOTTLE_SIZE),
    );
    return { mesh: this.props.molotov, model, character: false, shadow: true, toon: true };
  }

  /**
   * The flame on a flying bottle. The bottle tumbles but the fire doesn't: it always stands up from the
   * rag, trailing behind the way it's flying, and leaves embers in the air.
   */
  private bottleFlame(thing: MovingThing, x: number, y: number, z: number, seed: number, vx: number, vz: number): void {
    const [fx, fy, fz] = transformPoint(thing.model, [0.05, 0.55, 0]);
    this.tongue(fx, fy - 0.1, fz, 0.95, (seed * 0.37) % 1, 0, [-vx * 0.12, -vz * 0.12]);
    this.tongue(fx, fy - 0.15, fz, 0.6, (seed * 0.71) % 1, 0, [-vx * 0.08, -vz * 0.08]);
    if (Math.random() < 0.6) {
      this.emit(x + this.rx + rand(-0.1, 0.1), y + rand(-0.1, 0.1), z + this.rz - 0.1,
        rand(-0.4, 0.4), rand(0.2, 1.2), rand(-0.8, -0.2),
        Math.random() < 0.5 ? FIRE_MID : FIRE_OUTER, rand(0.03, 0.07), rand(0.2, 0.45), 0, 1.5);
    }
  }

  /** A tumbling bottle, big and slow. Fire bottles carry a flame and leave a trail of it. */
  private drawBottle(localX: number, y: number, localZ: number, seed: number, fire: boolean, color: V3 = BOTTLE_BODY): void {
    const { m, s, overlay } = this;
    const x = localX + this.rx;
    const z = localZ + this.rz;
    const spin = this.time * 7 + seed;
    s.reset().translate(x, y, z).rotZ(spin).rotX(spin * 0.6);
    s.push().scale(0.16, 0.3, 0.16);
    overlay.draw(m.hex, s.top, color, { outline: 0.014 });
    s.pop();
    s.push().translate(0, 0.36, 0).scale(0.07, 0.15, 0.07);
    overlay.draw(m.hex, s.top, color, { outline: 0.012 });
    s.pop();
    if (!fire) return;
    const flicker = 0.28 + (Math.floor(this.time * 14 + seed) % 3) * 0.05;
    s.push().translate(0, 0.54, 0).scale(flicker);
    overlay.draw(m.ball, s.top, FIRE_OUTER, { unlit: true, outline: 0.016 });
    s.pop();
    s.push().translate(0, 0.54, 0).scale(flicker * 0.6);
    overlay.draw(m.ball, s.top, FIRE_CORE, { unlit: true });
    s.pop();
    for (let i = 0; i < 2; i++) {
      this.emit(x + rand(-0.1, 0.1), y + rand(-0.1, 0.1), z - 0.1,
        rand(-0.4, 0.4), rand(0.2, 1.2), rand(-0.8, -0.2),
        i === 0 ? FIRE_MID : FIRE_OUTER, rand(0.08, 0.2), rand(0.2, 0.45), 0, 1.5);
    }
  }

  /**
   * A lucky kill, like Sniper Elite: the camera rides the bullet in slow motion, the x-ray shows
   * the hit, the body falls as the camera watches from the side, and then it flies back to you.
   */
  private renderRushCam(game: Rush, realDt: number): void {
    const cam = game.cam!;
    const stage = rushCamStage(cam.t);
    const { enemy, zone, point } = cam;
    const worldX = enemy.x + this.rx;
    const worldZ = enemy.z + this.rz;
    const end: V3 = [point.x + this.rx, point.y, worldZ + 0.25];

    if (stage.name === "xray") {
      const killZone: KillZone = zone === "head" ? "head" : zone === "nuts" ? "nuts" : "chest";
      const scale = enemy.kind === "boss" ? RUSH.bossScale : 1;
      const local = (point.y - enemy.y) / scale;
      const centre = killZone === "head" ? 1.78 : killZone === "nuts" ? 0.62 : 1.1;
      this.renderKillCamView({
        zone: killZone,
        lizard: true,
        xray: cam.xray,
        pierce: cam.pierce,
        offsetX: (point.x - enemy.x) / scale / 0.6,
        offsetY: (local - centre) / 0.6,
        power: 0.8,
      }, stage.t);
      return;
    }

    if (stage.name === "bullet") {
      const u = stage.u;
      const px = lerp(this.camFrom[0], end[0], u);
      const py = lerp(this.camFrom[1], end[1], u);
      const pz = lerp(this.camFrom[2], end[2], u);
      const k = smooth(0.03, 0.25, u);
      const start = this.rushCamera(game).eye;
      const eye: LookV3 = [
        lerp(start[0], px + 0.72, k),
        lerp(start[1], py + 0.34, k),
        lerp(start[2], pz + 2.5, k),
      ];
      const roll = Math.sin(u * Math.PI) * 0.09;
      const view = lookAt(eye, [
        lerp(start[0], end[0], k),
        lerp(game.cameraY, Math.max(end[1], 0.8), k),
        lerp(worldZ, end[2], k),
      ], [Math.sin(roll), Math.cos(roll), 0]);
      const things = this.rushThings(game, 0, eye);
      things.push(this.camTarget(enemy, realDt * 0.14));
      this.drawWorld({ eye, view, proj: frustumAt(k) }, things);
      const camera = this.overlayCamera({ eye, view, proj: frustumAt(k) });
      this.drawBullet(px, py, pz, end, 0.8);
      this.emit(px + rand(-0.04, 0.04), py + rand(-0.04, 0.04), pz + 0.25,
        rand(-0.12, 0.12), rand(-0.06, 0.12), rand(0.1, 0.5),
        Math.random() < 0.5 ? COLORS.spark : COLORS.dust,
        rand(0.02, 0.05), rand(0.4, 0.9), 0, 0.3);
      this.stepParticles(realDt * 0.16);
      this.drawParticles(camera);
      return;
    }

    // The body falls in slow motion from the side, then the camera flies back to you.
    if (!this.camDropped) {
      this.camDropped = true;
      if (enemy.kind !== "boss") this.dropGoon(enemy, zone, point);
      this.particles.length = 0;
      this.sparks(point.x, point.y, enemy.z);
      this.shake = zone === "body" ? 0.9 : 1.4;
    }
    const slow = stage.name === "ragdoll" ? 0.45 : 0.8;
    const dt = realDt * slow;
    const home = this.rushCamera(game);
    const side = enemy.x > 0 ? -1 : 1;
    const reach = enemy.kind === "boss" ? 2 : 1;
    const away: LookV3 = [worldX + side * 3.6 * reach, lerp(1.9, 2.3, stage.u) * reach, worldZ + 3.2 * reach];
    const k = stage.name === "back" ? smooth(0, 1, stage.u) : 0;
    const eye: LookV3 = [
      lerp(away[0], home.eye[0], k),
      lerp(away[1], home.eye[1], k),
      lerp(away[2], home.eye[2], k),
    ];
    const shake = this.shake * this.shake * 0.06;
    const focus: LookV3 = [
      lerp(worldX + Math.sin(this.time * 67) * shake, home.eye[0], k),
      lerp(reach + Math.sin(this.time * 53) * shake, game.cameraY + 0.3, k),
      lerp(worldZ, this.rz - 30, k),
    ];
    const view = lookAt(eye, focus);
    const proj = frustumAt(1 - k);
    const things = this.rushThings(game, dt, eye);
    // The gator's too big and built too differently for the ragdoll, so it topples like a tree.
    if (enemy.kind === "boss") {
      const fall = stage.name === "ragdoll" ? smooth(0, 0.75, stage.u) : 1;
      const s = BOSS.drawScale;
      const over = multiply(multiply(translation(worldX, 0, worldZ), rotationX(-fall * Math.PI * 0.49)), scaling(s, s, s));
      this.gatorNow = { eye: "x", mouth: "openA" };
      this.gator.rig.update(this.gatorClock);
      things.push(this.gatorAt(over));
    }
    this.drawWorld({ eye, view, proj }, things);
    const camera = this.overlayCamera({ eye, view, proj });
    this.stepParticles(dt);
    this.drawParticles(camera);
  }

  /** The one the bullet cam's flying at, frozen in slow motion until it lands. */
  private camTarget(enemy: RushEnemy, dt: number): MovingThing {
    if (enemy.kind === "boss") {
      this.gatorClock += dt;
      this.gator.rig.update(this.gatorClock);
      const s = BOSS.drawScale;
      this.gatorNow = { eye: "evilPain", mouth: "roar" };
      return this.gatorAt(multiply(translation(enemy.x + this.rx, enemy.y, enemy.z + this.rz), scaling(s, s, s)));
    }
    if (this.camGoon) this.goons.set(enemy.id, this.camGoon);
    const thing = this.goonThing(enemy, dt);
    this.goons.delete(enemy.id);
    return { ...thing, face: thing.face ? { ...thing.face, eye: "wide", mouth: "worried" } : thing.face };
  }

  private fireGun(now: number): void {
    this.gunAction.shoot(now);
    this.armRig.play("hold", now, { fade: 0 });
    this.armRig.play("fire", now, { fade: 0.02, loop: false });
    this.flash = 1;
    this.fireKick = 1;
    this.muzzleBlast();
    if (!this.rushRunning && this.gunAction.shots >= CHAMBERS) this.gunAction.reload(now + 0.5);
  }

  /** One shot's flash and smoke: a star for a moment, a quick puff out the front, and a slow drift after. */
  private muzzleBlast(): void {
    this.sinceShot = 0;
    this.flashMesh = (["star0", "star1", "star2"] as const)[Math.floor(Math.random() * 3)]!;
    this.flashRoll = Math.random() * Math.PI * 2;
    const m = this.muzzleMat;
    const [x, y, z] = transformPoint(m, [0, 0, 0]);
    const [fx, fy, fz] = transformPoint(m, [1, 0, 0]);
    const length = Math.hypot(fx - x, fy - y, fz - z) || 1;
    const ax = (fx - x) / length, ay = (fy - y) / length, az = (fz - z) / length;
    const puff = (speed: number, spread: number, rise: number, from: number, to: number, life: number, drag: number) => {
      this.gunPuffs.push({
        x, y, z,
        vx: ax * speed + rand(-spread, spread),
        vy: ay * speed + rand(-spread, spread) + rise,
        vz: az * speed + rand(-spread, spread),
        from, to, age: 0, life, seed: Math.random(), drag,
      });
    };
    // A chain of puffs punched out along the barrel, bigger the further out they get.
    for (let i = 0; i < 3; i++) puff(1.6 + i * 1.5, 0.12, 0, 0.018 + i * 0.008, 0.05 + i * 0.022, 0.26 + i * 0.05, 7);
    // And one or two left hanging, drifting up.
    for (let i = 0; i < 2; i++) puff(rand(0.5, 1.1), 0.05, rand(0.1, 0.2), 0.02, rand(0.07, 0.1), rand(0.7, 1), 2.6);
    if (this.gunPuffs.length > 18) this.gunPuffs.splice(0, this.gunPuffs.length - 18);
  }

  private stepGunSmoke(dt: number): void {
    this.sinceShot += dt;
    for (const p of this.gunPuffs) {
      p.age += dt;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k + 0.1 * dt;
      p.vz *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
    this.gunPuffs = this.gunPuffs.filter((p) => p.age < p.life);
    // A thin wisp keeps curling up off the end of the barrel for a little while.
    this.sinceWisp += dt;
    if (this.sinceShot > 0.1 && this.sinceShot < WISP_SEC && this.sinceWisp >= WISP_GAP) {
      this.sinceWisp = 0;
      const [x, y, z] = transformPoint(this.muzzleMat, [0, 0, 0]);
      const fading = 1 - this.sinceShot / WISP_SEC;
      // Curls side to side as it climbs.
      this.gunPuffs.push({
        x, y, z,
        vx: Math.sin(this.time * 7) * 0.05, vy: rand(0.14, 0.2), vz: 0,
        from: 0.007 + fading * 0.007, to: 0.016 + fading * 0.016,
        age: 0, life: rand(0.45, 0.65), seed: Math.random(), drag: 0.4,
      });
    }
  }

  /** The flash and smoke, in the gun's own camera space, so they sit right on the end of the barrel. */
  private drawMuzzle(proj: LookMat4): void {
    const list: FlameDraw[] = [];
    if (this.sinceShot < FLASH_SEC) {
      const u = this.sinceShot / FLASH_SEC;
      const size = FLASH_SIZE * (0.8 + u * 0.55);
      list.push({
        mesh: this.flashMesh,
        model: multiply(multiply(this.muzzleMat, rotationX(this.flashRoll)), scaling(size, size, size)),
        seed: this.flashRoll / 6.28,
        erode: u * u * 0.85,
        wobble: 0,
        palette: FLASH,
      });
    }
    this.flames.draw(list, proj, [0, 0, 0], this.time);
    const puffs: PuffDraw[] = this.gunPuffs.map((p) => {
      const u = p.age / p.life;
      return {
        at: [p.x, p.y, p.z],
        // Pops out fast, then holds its size while it's eaten away.
        size: lerp(p.from, p.to, 1 - (1 - u) * (1 - u) * (1 - u)),
        seed: p.seed,
        erode: Math.pow(u, 1.6),
        colors: GUN_PUFF,
      };
    });
    this.flames.puffs(puffs, proj, [1, 0, 0], [0, 1, 0]);
  }

  // ---- Match events ---------------------------------------------------------------------

  onFired(): void {
    this.bulletEnd = null;
    this.fireGun(this.time);
    this.shake = 0.4;
    this.trailTimer = 0;
  }

  private newDowned(x: number, z: number, facing: 1 | -1, outfit: number): Downed {
    return {
      rag: new Ragdoll(x, z, facing),
      skin: new RagdollSkin(MONKEY_LAYOUT, this.skeleton.jointIndex, MAX_BONES),
      outfit,
    };
  }

  onImpact(shot: Shot, match: Match): void {
    const { x, y } = shot.landing;
    this.downed = null;
    this.loseHat = null;
    this.killCam.reset();
    this.dustDone = false;
    this.dropped = true;
    if (shot.zone) {
      const body = this.newDowned(shot.targetX, Z0, 1, this.outfitFor(match, shot.target));
      body.rag.hit({ zone: shot.zone, landing: { x, y, z: Z0 + 0.25 }, power: shot.bar });
      this.downed = body;
      this.focus = [shot.targetX, 0.9, Z0];
      this.camSide = [shot.targetX > 0 ? -0.7 : 0.7, 0.7];
      if (shot.zone === "head") {
        this.loseHat = {
          x, y: 2.3, z: Z0,
          vx: (x - shot.targetX) * 3 + 1.2, vy: 6.2, vz: -3.6,
          spin: 0, rest: false,
        };
      }
      if (shot.zone === "body" && !shot.xray) {
        this.startDrop(shot);
      } else {
        // The kill cam has its own little space, so street particles can't follow it in.
        this.dropped = false;
        this.particles.length = 0;
      }
      return;
    }
    this.shake = 0;
    this.effects.miss([x * 1.5, 0.1, Z0 - 7], hex(this.dir.palette.sandPatch));
  }

  private startDrop(shot: Shot): void {
    const { x, y } = shot.landing;
    this.dropped = true;
    this.particles.length = 0;
    const zone = shot.zone ?? "body";
    this.shake = zone === "head" ? 1.7 : zone === "nuts" ? 1.35 : 1;
    this.hitStop = zone === "body" ? 0.05 : 0.1;
    // The gallery's hit effect is sized for far-off targets, so this close it gets sparks.
    for (let i = 0; i < 46; i++) {
      this.emit(x, y, Z0 + 0.2,
        rand(-4.5, 4.5), rand(-1, 5.5), rand(-4.5, 3.5),
        i % 3 === 0 ? COLORS.gold : i % 3 === 1 ? COLORS.spark : COLORS.dust,
        rand(0.025, 0.07), rand(0.3, 0.8), 7, 1.5);
    }
  }

  onResults(winner: PlayerId | "draw", match: Match): void {
    for (const player of [0, 1] as const) {
      if (winner === player) {
        this.losers[player] = null;
        continue;
      }
      const facing = player === 0 ? 1 : -1;
      const z = WIDE_Z[player];
      const body = this.newDowned(0, z, facing, this.outfitFor(match, player));
      body.rag.hit({ zone: "body", landing: { x: 0.3 * facing, y: 1, z: z + facing * 0.3 }, power: 0 });
      body.rag.settle(3);
      this.losers[player] = body;
    }
  }

  /** Puffs of dust under walking feet. */
  private walkDust(x: number, speed: number): void {
    if (Math.abs(speed) < 0.1 || Math.random() > 0.3) return;
    this.emit(x + rand(-0.25, 0.25), 0.08, Z0 + rand(-0.2, 0.2),
      -speed * rand(0.3, 1), rand(0.2, 0.7), rand(-0.2, 0.2),
      COLORS.dust, rand(0.1, 0.24), rand(0.3, 0.7), 0.5, 2);
  }

  // ---- Particles ------------------------------------------------------------------------

  private emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    color: V3, size: number, life: number, gravity: number, drag: number,
  ): void {
    if (this.particles.length >= MAX_POINTS) this.particles.shift();
    this.particles.push({
      x, y, z, vx, vy, vz,
      r: color[0], g: color[1], b: color[2],
      size, life, maxLife: life, gravity, drag,
    });
  }

  private readonly emitBound = (
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    color: V3, size: number, life: number, gravity: number, drag: number,
  ): void => this.emit(x, y, z, vx, vy, vz, color, size, life, gravity, drag);

  private stepParticles(dt: number): void {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        ps.splice(i, 1);
        continue;
      }
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k; p.vy = (p.vy - p.gravity * dt) * k; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.03) { p.y = 0.03; p.vy *= -0.3; }
    }
  }

  private drawParticles(camera: Camera): void {
    const ps = this.particles;
    const data = this.pointData;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]!;
      const o = i * POINT_STRIDE;
      const a = Math.min(1, (p.life / p.maxLife) * 1.8);
      data[o] = p.x; data[o + 1] = p.y; data[o + 2] = p.z;
      data[o + 3] = p.r; data[o + 4] = p.g; data[o + 5] = p.b; data[o + 6] = a;
      data[o + 7] = p.size;
    }
    this.overlay.drawPoints(camera, data, ps.length);
  }

  // ---- The frame ------------------------------------------------------------------------

  /** Draws the frame, then runs it through the arcade pass. */
  render(view: View, dt: number, loudness: number): void {
    this.railYaw = view.kind === "rush" ? view.game.railYaw : 0;
    this.playing = view.kind === "rush" || view.kind === "match";
    // Night falls on the walk to the bank, and stays until you're back at the menu.
    this.night = view.kind === "rush" ? smooth(NIGHT_FROM, NIGHT_TO, -view.game.railZ) : 0;
    this.punch *= Math.exp(-dt * 11);
    this.sinceImpact += dt;
    const impact = this.impactLeft > 0;
    this.impactLeft = Math.max(0, this.impactLeft - dt);
    if (view.kind !== "rush") this.heat = Math.max(0, this.heat - dt);
    this.renderView(view, dt, loudness);
    this.post.apply(this.heat, impact, smooth(SUNDOWN_AT, 1, this.night));
  }

  private renderView(view: View, dt: number, loudness: number): void {
    this.time += dt;
    this.flameList = [];
    this.puffList = [];
    this.rushRunning = false;
    this.stepGunSmoke(dt);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.flash *= Math.exp(-dt * 26);
    this.fireKick = Math.max(0, this.fireKick - dt * 2.8);
    this.loudness = loudness;
    this.look.drawCalls = 0;
    this.overlay.drawCalls = 0;
    this.effects.update(dt);

    if (view.kind === "shop") {
      this.renderShop(view.showGun, dt);
      return;
    }
    if (view.kind === "menu") {
      this.stepParticles(dt);
      this.renderMenu(dt);
      return;
    }
    if (view.kind === "rush") {
      if (!view.game.cam) this.stepParticles(dt * view.game.timeScale);
      this.renderRush(view.game, dt);
      return;
    }
    const { match } = view;
    const inKillCam = match.phase === "impact" && !this.dropped;
    this.stepParticles(match.phase === "shot" ? dt * 0.16 : inKillCam ? dt * 0.3 : dt);
    switch (match.phase) {
      case "intro":
        this.renderIntro(match, dt);
        break;
      case "results":
        this.renderWide(match, wideCamera(0.8 + Math.sin(this.time * 0.2) * 0.1, this.time), dt);
        break;
      case "handoff":
      case "aim":
        this.renderAim(match, dt);
        break;
      case "shot":
        this.renderShot(match, dt);
        break;
      case "impact":
        this.renderImpact(match, dt);
        break;
    }
  }

  /** One monkey standing or moving under its rig, with its flat face on. */
  private monkeyThing(rig: Rig, model: LookMat4, outfit: number, eye: EyeCell | string, mouth: MouthCell | string): MovingThing {
    return {
      mesh: this.monkeys[outfit]!,
      model,
      character: true,
      shadow: true,
      bones: rig.bones,
      face: {
        mesh: this.faceSheet,
        model: multiply(model, rig.boneMatrix("head")),
        eye,
        mouth,
        skin: hex(OUTFITS[outfit]!.skin),
      },
    };
  }

  /** One lizard goon, standing or moving under its rig. */
  private lizardThing(rig: Rig, model: LookMat4, outfit: number, eye: EyeCell | string, mouth: MouthCell | string): MovingThing {
    return {
      mesh: this.lizards[outfit]!,
      model,
      character: true,
      shadow: true,
      bones: rig.bones,
      face: {
        mesh: this.lizardFace,
        model: multiply(model, rig.boneMatrix("head")),
        eye: lizardEye(eye),
        mouth: "evilGrin",
        skin: hex(this.outfitOf(outfit).iris),
        plate: "blank",
      },
    };
  }

  /** A downed monkey, its face following the ragdoll's head. */
  private downedThing(body: Downed, eye: string, mouth: string): MovingThing {
    if (body.lizard) {
      return {
        mesh: this.lizards[body.outfit]!,
        model: lookIdentity(),
        character: true,
        shadow: true,
        bones: body.skin.bones,
        face: {
          mesh: this.lizardFace,
          model: body.skin.head,
          eye: lizardEye(eye),
          mouth: "evilGrin",
          skin: hex(this.outfitOf(body.outfit).iris),
          plate: "blank",
        },
      };
    }
    return {
      mesh: this.monkeys[body.outfit]!,
      model: lookIdentity(),
      character: true,
      shadow: true,
      bones: body.skin.bones,
      face: {
        mesh: this.faceSheet,
        model: body.skin.head,
        eye,
        mouth,
        skin: hex(OUTFITS[body.outfit]!.skin),
      },
    };
  }

  private tumbleThings(): MovingThing[] {
    const t = this.time;
    const path = (phase: number, speed: number, z: number, span: number) => {
      const u = ((t * speed + phase) % span) - span / 2;
      const r = 0.62;
      const roll = u / r;
      const bob = Math.abs(Math.sin(roll * 0.7)) * 0.28;
      return multiply(multiply(translation(u, r + bob, z), rotationZ(-roll)), rotationY(phase));
    };
    return [
      { mesh: this.tumble, model: path(10, 3.1, -24, 60), character: false, shadow: true },
      { mesh: this.tumble, model: path(44, 2.2, -3, 60), character: false, shadow: true },
    ];
  }

  private drawWorld(
    cam: LookCamera,
    things: MovingThing[],
    held?: HeldItem,
    viewport: [number, number, number, number] = [0, 0, this.canvas.width, this.canvas.height],
  ): void {
    // Rush mode works in the rail's own space, as if the camera never turned. Turning shows up here:
    // the town's camera and everything standing in it are swung round the rail's position, while
    // whatever draws straight to the screen, like flames and tracers, keeps using the rail's camera.
    const swing = this.railYaw
      ? multiply(multiply(translation(this.rx, 0, this.rz), rotationY(-this.railYaw)), translation(-this.rx, 0, -this.rz))
      : null;
    const townCam: LookCamera = swing
      ? { eye: transformPoint(swing, cam.eye), view: multiply(cam.view, invert(swing)), proj: cam.proj }
      : cam;
    const swung = swing
      ? things.map((t) => ({
          ...t,
          model: multiply(swing, t.model),
          face: t.face ? { ...t.face, model: multiply(swing, t.face.model) } : t.face,
        }))
      : things;
    const railVp = multiply(cam.proj, cam.view);
    this.look.render(this.state, townCam, viewport, [...this.tumbleThings(), ...swung], {
      gray: false,
      time: this.time,
      held,
      // A hard two-tone shadow, and facets that show, for a flatter low-poly look.
      flatArt: FLAT_SHADING,
      night: this.night,
      air: this.playing ? PLAY_AIR : 1,
      fx: () => {
        this.flames.draw(this.flameList, railVp, cam.eye, this.time);
        const v = cam.view;
        this.flames.puffs(this.puffList, railVp, [v[0]!, v[4]!, v[8]!], [v[1]!, v[5]!, v[9]!]);
        this.effects.draw(railVp, cam);
      },
      afterHeld: (proj) => this.drawMuzzle(proj),
    });
  }

  /** Prepares the overlay pass, which draws over the finished world with the same camera. */
  private overlayCamera(cam: LookCamera): Camera {
    const camera: Camera = { projection: cam.proj, view: cam.view, eye: cam.eye };
    this.overlay.begin();
    this.overlay.useCamera(camera, OVERLAY_LOOK);
    return camera;
  }

  private renderMenu(dt: number): void {
    const { gallery, menuAim } = this;
    const t = this.time;
    const eye: LookV3 = [menuAim.x * 0.3 + Math.sin(t * 0.09) * 0.08, 1.72 + Math.sin(t * 0.13) * 0.02, 14.4];
    const target: LookV3 = [menuAim.x * 1.9, 3 + menuAim.y * 1.4 + menuAim.kick * 0.45, -20];
    const cam: LookCamera = {
      eye,
      view: lookAt(eye, target),
      proj: perspective(MENU_FOV, ASPECT, 1, FAR),
    };
    this.menuCam = cam;
    this.menuVP = multiply(cam.proj, cam.view);
    const things: MovingThing[] = [
      { mesh: gallery.stage, model: lookIdentity(), character: false, shadow: false },
      ...gallery.things(t),
    ];
    for (const p of gallery.sweatPoints) this.effects.sweat(p);
    const held = this.heldItem(menuAim.x, menuAim.y, 0, cam, 0, dt);
    this.drawWorld(cam, things, held);
  }

  /**
   * The opening stare: an extreme close-up on one pair of eyes, then the other's, then both
   * stacked with the VS between them. The HUD draws the bars, names and slash on top.
   */
  private renderIntro(match: Match, dt: number): void {
    const t = match.phaseTime;
    const stage = introStage(t);
    const { width: W, height: H } = this.canvas;
    if (stage === "versus") {
      const since = t - INTRO.secondSec;
      // Each pair of eyes sits away from the slash that runs between them.
      this.drawStare(match, 0, since, dt, ASPECT * 2, [0, H / 2, W, H / 2], false, -0.07);
      this.drawStare(match, 1, since, dt, ASPECT * 2, [0, 0, W, H / 2], false, 0.07);
      return;
    }
    const player: PlayerId = stage === "first" ? 0 : 1;
    const since = stage === "first" ? t : t - INTRO.firstSec;
    this.drawStare(match, player, since, dt, ASPECT, [0, 0, W, H], true, 0);
  }

  private drawStare(
    match: Match,
    player: PlayerId,
    since: number,
    dt: number,
    aspect: number,
    viewport: [number, number, number, number],
    glance: boolean,
    shiftY: number,
  ): void {
    const rig = this.rigs[player]!;
    this.clocks[player]! += dt;
    rig.play("idle", this.clocks[player]!, { fade: 0 });
    rig.update(this.clocks[player]!);
    const model = translation(0, 0, Z0);
    // Eyes narrow on the other duellist, with one sideways glance on the solo shots.
    const eye = glance && since > 0.72 && since < 0.98 ? (player === 0 ? "sideR" : "sideL") : "squint";
    const thing = this.monkeyThing(rig, model, this.outfitFor(match, player), eye, "grit");
    const distance = lerp(1.95, 1.65, clamp(since / 1.6, 0, 1));
    const head = transformPoint(multiply(model, rig.boneMatrix("head")), [0, STAR_EYE.y, 0]);
    const camEye: LookV3 = [head[0], head[1] + 0.04 + shiftY, Z0 + distance];
    // Wide enough to frame the whole brow, whatever the band's shape.
    const fov = aspect > ASPECT * 1.5 ? 16 : 27;
    this.drawWorld({
      eye: camEye,
      view: lookAt(camEye, [head[0], head[1] + 0.04 + shiftY, Z0]),
      proj: perspective(fov, aspect, 0.2, FAR),
    }, [thing], undefined, viewport);
  }

  /** Both duellists side by side, for the results. */
  private renderWide(match: Match, camera: LookCamera, dt: number): void {
    const things: MovingThing[] = [];
    const downedHeads: V[] = [];
    for (const player of [0, 1] as const) {
      const outfit = this.outfitFor(match, player);
      const down = match.phase === "results" ? this.losers[player] : null;
      if (down) {
        down.skin.update(down.rag.points, camera.eye, { hatOff: false });
        things.push(this.downedThing(down, "wide", "worried"));
        downedHeads.push(down.rag.points[P.head]!);
        continue;
      }
      const clip = match.phase === "results" ? "taunt" : "idle";
      this.clocks[player]! += dt;
      this.rigs[player]!.play(clip, this.clocks[player]!, { fade: 0.3 });
      this.faces[player]!.update(clip, this.clocks[player]!);
      this.rigs[player]!.update(this.clocks[player]!);
      const model = multiply(translation(0, 0, WIDE_Z[player]), rotationY(player === 0 ? 0 : Math.PI));
      const face = this.faces[player]!;
      things.push(this.monkeyThing(this.rigs[player]!, model, outfit, face.eye, face.mouth));
    }
    this.drawWorld(camera, things);
    const overlay = this.overlayCamera(camera);
    for (const player of [0, 1] as const) {
      const down = match.phase === "results" ? this.losers[player] : null;
      if (down) this.drawStarEyes(down.skin);
    }
    for (const head of downedHeads) this.drawStars(head, this.time);
    this.drawParticles(overlay);
  }

  private shooterCamera(): LookCamera {
    return { eye: [0, PLANE.cameraY, 0], view: translation(0, -PLANE.cameraY, 0), proj: frustumAt(0) };
  }

  private renderAim(match: Match, dt: number): void {
    const cam = this.shooterCamera();
    // Fear rises as the clock runs down and the reticle closes in.
    const away = Math.hypot(match.aim.x - match.targetX, match.aim.y - 1.2);
    const near = 1 - clamp((away - match.reticle) / 3.2, 0, 1);
    const timer = 1 - match.timeLeft / match.rules.aimSec;
    const aiming = match.phase === "aim";
    const fear = aiming ? clamp(0.16 + timer * 0.3 + near * 0.5 + match.bar * 0.14, 0, 1) : 0.1;

    const player = match.target;
    const rig = this.rigs[player]!;
    this.clocks[player]! += dt;
    const clock = this.clocks[player]!;
    const walking = Math.abs(match.lateral) > 0.05;
    const clip = match.duck > 0.4 ? "hide" : walking ? "crab" : fear > 0.55 ? "nervous" : "idle";
    rig.play(clip, clock, { fade: 0.14 });
    if (aiming) this.walkDust(match.targetX, match.lateral);
    const face = this.faces[player]!;
    face.update(clip, clock);
    rig.update(clock);
    // The face reads the danger: eyes follow the reticle, and panic as it closes in.
    const reticleSide = match.aim.x > match.targetX ? "sideR" : "sideL";
    const eye = !aiming ? face.eye
      : face.eye === "blink" ? "blink"
      : fear > 0.72 ? "wide"
      : fear > 0.34 ? reticleSide
      : face.eye;
    const mouth = !aiming ? "smile" : fear > 0.72 ? "openB" : fear > 0.5 ? "grit" : fear > 0.3 ? "worried" : "smile";

    // A little weight into each step.
    const lean = match.lateral;
    const model = multiply(
      multiply(
        multiply(translation(match.targetX, 0, Z0), rotationZ(-lean * 0.1)),
        rotationY(lean * 0.16),
      ),
      duckSquash(match.duck),
    );
    const outfit = this.outfitFor(match, player);
    const things: MovingThing[] = [this.monkeyThing(rig, model, outfit, eye, mouth)];
    if (aiming && this.time > this.nextSweat && fear > 0.3) {
      this.nextSweat = this.time + 0.42 - fear * 0.3;
      const head = multiply(model, rig.boneMatrix("head"));
      const side = Math.random() < 0.5 ? -1 : 1;
      this.effects.sweat(transformPoint(head, [side * 0.42, 2.0, 0.3]));
    }

    let held: HeldItem | undefined;
    if (aiming) {
      const sx = match.aim.x / (PLANE.width / 2);
      const sy = (match.aim.y - PLANE.centerY) / (PLANE.height / 2);
      held = this.heldItem(sx, sy, this.outfitFor(match, match.shooter), cam, match.bar, dt);
    }
    this.drawWorld(cam, things, held);
    this.drawParticles(this.overlayCamera(cam));
  }

  private renderShot(match: Match, dt: number): void {
    const shot = match.shot!;
    const u = clamp(match.phaseTime / match.rules.slowMoSec, 0, 1);
    const { start, end: heading } = bulletPath(shot, this.muzzle);
    if (!this.bulletEnd) this.bulletEnd = [...heading];
    const ease = 1 - Math.exp(-dt * 6);
    this.bulletEnd = [
      lerp(this.bulletEnd[0], heading[0], ease),
      lerp(this.bulletEnd[1], heading[1], ease),
      lerp(this.bulletEnd[2], heading[2], ease),
    ];
    const end = this.bulletEnd;
    const px = lerp(start[0], end[0], u);
    const py = lerp(start[1], end[1], u);
    const pz = lerp(start[2], end[2], u);

    const k = smooth(0.03, 0.2, u);
    const chase: V3 = [px + 0.72, py + 0.34, pz + 2.5];
    const eyeStart: V3 = [0, PLANE.cameraY, 0];
    const eye: LookV3 = [
      lerp(eyeStart[0], chase[0], k),
      lerp(eyeStart[1], chase[1], k),
      lerp(eyeStart[2], chase[2], k),
    ];
    const lookStart: V3 = [0, PLANE.cameraY, Z0];
    const roll = Math.sin(u * Math.PI) * 0.09;
    const cam: LookCamera = {
      eye,
      view: lookAt(eye, [
        lerp(lookStart[0], end[0], k),
        lerp(lookStart[1], Math.max(end[1], 0.8), k),
        lerp(lookStart[2], end[2], k),
      ], [Math.sin(roll), Math.cos(roll), 0]),
      proj: frustumAt(k),
    };

    // The target hangs in the air while the world crawls, then starts to scream.
    const player = shot.target;
    const rig = this.rigs[player]!;
    this.clocks[player]! += dt * 0.14;
    const clock = this.clocks[player]!;
    const moving = Math.abs(match.lateral) > 0.05;
    const clip = match.duck > 0.4 ? "hide" : moving ? "crab" : u > 0.45 ? "shout" : "nervous";
    rig.play(clip, clock, { fade: 0.12 });
    rig.update(clock);
    const model = multiply(
      multiply(translation(shot.targetX, 0, Z0), rotationZ(-match.lateral * 0.1)),
      duckSquash(match.duck),
    );
    const things: MovingThing[] = [
      this.monkeyThing(rig, model, this.outfitFor(match, player), "wide", u > 0.45 ? "openA" : "worried"),
    ];
    let held: HeldItem | undefined;
    // The gun stays on screen only until the camera pulls away with the bullet.
    if (k < 0.01) held = this.heldItem(0, 0, this.outfitFor(match, match.shooter), this.shooterCamera(), 0, dt);
    this.drawWorld(cam, things, held);

    const camera = this.overlayCamera(cam);
    this.drawBullet(px, py, pz, end, shot.bar);
    this.trailTimer -= dt;
    if (this.trailTimer <= 0) {
      this.trailTimer = 0.01;
      this.emit(px + rand(-0.04, 0.04), py + rand(-0.04, 0.04), pz + 0.25,
        rand(-0.12, 0.12), rand(-0.06, 0.12), rand(0.1, 0.5),
        Math.random() < 0.5 ? COLORS.spark : COLORS.dust,
        rand(0.012, 0.032) * (0.7 + shot.bar), rand(0.4, 0.9), 0, 0.3);
    }
    this.drawParticles(camera);
  }

  private renderImpact(match: Match, dt: number): void {
    const shot = match.shot!;
    const killCam = killCamFor(shot.zone, match.rules, shot.xray);
    if (match.phaseTime < killCam && shot.zone) {
      this.renderKillCam(shot, match.phaseTime);
      return;
    }
    if (!this.dropped) this.startDrop(shot);

    const t = match.phaseTime - killCam;
    const tx = shot.targetX;
    const body = this.downed;

    this.hitStop = Math.max(0, this.hitStop - dt);
    const live = this.hitStop > 0 ? 0 : dt;
    body?.rag.update(live);
    this.stepHat(live);

    let eye: LookV3;
    let target: LookV3;
    if (body) {
      // Follows wherever the body ends up, framing hips to head so it all stays in shot.
      const pelvis = body.rag.points[P.pelvis]!;
      const headPoint = body.rag.points[P.head]!;
      const follow = Math.min(1, dt * 5);
      this.focus[0] += ((pelvis[0] + headPoint[0]) / 2 - this.focus[0]) * follow;
      this.focus[1] += ((pelvis[1] + headPoint[1]) / 2 - this.focus[1]) * follow;
      this.focus[2] += ((pelvis[2] + headPoint[2]) / 2 - this.focus[2]) * follow;
      const [fx, fy, fz] = this.focus;
      const push = smooth(0.05, 1.15, t);
      // Watches from square-on to the way the body lies, so a hat can't point at the camera.
      // Of the two sides, it takes the one nearer the middle of the street.
      const ax = headPoint[0] - pelvis[0];
      const az = headPoint[2] - pelvis[2];
      const al = Math.hypot(ax, az);
      if (al > 0.25) {
        let sx = -az / al;
        let sz = ax / al;
        if (sx * fx > 0 || (fx === 0 && sz < 0)) { sx = -sx; sz = -sz; }
        const turn = Math.min(1, dt * 3);
        this.camSide[0] += (sx - this.camSide[0]) * turn;
        this.camSide[1] += (sz - this.camSide[1]) * turn;
      }
      const sl = Math.hypot(this.camSide[0], this.camSide[1]) || 1;
      const side: [number, number] = [this.camSide[0] / sl, this.camSide[1] / sl];
      const reach = lerp(5.4, 3.9, push) + Math.min(1, t / 3) * 0.3;
      eye = [fx + side[0] * reach, lerp(1.9, 2.5, push), fz + side[1] * reach];
      // Shifted a little toward the sign's side of the screen, which keeps the body clear of it.
      target = [fx - side[1] * 0.55 * push, fy + lerp(0.3, 0, push), fz + side[0] * 0.55 * push];
    } else {
      eye = [tx + 2.6, 1.6, Z0 + 6.4 - t * 0.2];
      target = [tx, 1.3, Z0];
    }
    const shake = this.shake * this.shake * 0.14;
    const sx = Math.sin(this.time * 67) * shake;
    const sy = Math.sin(this.time * 53) * shake;
    const cam: LookCamera = {
      eye,
      view: lookAt([eye[0] + sx, eye[1] + sy, eye[2]], [target[0] + sx, target[1] + sy, target[2]]),
      proj: symmetricProjection(0.72),
    };

    if (body) {
      const hatOff = this.loseHat !== null;
      const starry = shot.zone === "nuts" ? t >= 0.8 : t >= 0.4;
      body.skin.update(body.rag.points, eye, { hatOff });
      // The stars sit over the eyes, so the drawing under them just needs to fit behind.
      const faceEye = starry ? "blink" : shot.zone === "nuts" ? "wide" : "x";
      const faceMouth = shot.zone === "nuts" ? "openA" : starry ? "worried" : "openA";
      this.drawWorld(cam, [this.downedThing(body, faceEye, faceMouth)]);
      const camera = this.overlayCamera(cam);
      if (starry) this.drawStarEyes(body.skin);
      this.drawFlyingHat(body.outfit);
      if (t > 0.65) this.drawStars(body.rag.points[P.head]!, t);
      this.landingDust(body.rag);
      this.drawParticles(camera);
      return;
    }

    // A miss: relief, with a taunt for the shooter.
    const player = shot.target;
    const rig = this.rigs[player]!;
    this.clocks[player]! += dt;
    rig.play("taunt", this.clocks[player]!, { fade: 0.2 });
    const face = this.faces[player]!;
    face.update("taunt", this.clocks[player]!);
    rig.update(this.clocks[player]!);
    this.drawWorld(cam, [
      this.monkeyThing(rig, translation(tx, 0, Z0), this.outfitFor(match, player), face.eye, face.mouth),
    ]);
    this.drawParticles(this.overlayCamera(cam));
  }

  private renderKillCam(shot: Shot, t: number): void {
    const zone: KillZone = shot.zone === "head" ? "head" : shot.zone === "nuts" ? "nuts" : "chest";
    const centre = zone === "head" ? 1.78 : zone === "nuts" ? 0.62 : 1.1;
    this.renderKillCamView({
      zone,
      offsetX: (shot.landing.x - shot.targetX) / 0.6,
      offsetY: (shot.landing.y - centre) / 0.6,
      power: shot.bar,
    }, t);
  }

  private renderKillCamView(view: KillCamShot, t: number): void {
    this.overlay.begin();
    if (t < KILLCAM.frameSec) {
      this.killCam.renderFrame(view, t);
      return;
    }
    this.killCam.renderXray(view, t, this.emitBound);
    this.drawParticles(this.killCam.cameraAt(view, t));
  }

  private landingDust(rag: Ragdoll): void {
    if (this.dustDone) return;
    const pelvis = rag.points[P.pelvis]!;
    if (pelvis[1] > 0.36) return;
    this.dustDone = true;
    this.shake = Math.max(this.shake, 0.55);
    for (let i = 0; i < 26; i++) {
      this.emit(pelvis[0] + rand(-1, 1), 0.12, pelvis[2] + rand(-1, 1),
        rand(-1.7, 1.7), rand(0.4, 1.7), rand(-1.7, 1.7),
        COLORS.dust, rand(0.06, 0.16), rand(0.5, 1.2), 1.4, 1.6);
    }
  }

  private stepHat(dt: number): void {
    const hat = this.loseHat;
    if (!hat || hat.rest || dt === 0) return;
    hat.vy -= 11 * dt;
    hat.x += hat.vx * dt;
    hat.y += hat.vy * dt;
    hat.z += hat.vz * dt;
    hat.spin += dt * 9;
    if (hat.y < 0.06) {
      hat.y = 0.06;
      hat.rest = true;
    }
  }

  private drawFlyingHat(outfit: number): void {
    const hat = this.loseHat;
    if (!hat) return;
    const { m, s } = this;
    const o = OUTFITS[outfit]!;
    s.reset().translate(hat.x, hat.y, hat.z);
    if (!hat.rest) s.rotZ(hat.spin).rotX(hat.spin * 0.6);
    s.scale(0.85);
    drawLooseHat(this.overlay, m, s, hatPalette(hex(o.hat), hex(o.band)));
  }

  /** Spinning gold stars where the eyes are, placed through the head bone. */
  private drawStarEyes(skin: RagdollSkin): void {
    const { m, s } = this;
    for (const side of [-1, 1]) {
      s.reset();
      s.top.set(skin.head);
      s.translate(side * STAR_EYE.x, STAR_EYE.y, STAR_EYE.z).rotZ(this.time * side * 4.2);
      const pulse = STAR_EYE.size + Math.sin(this.time * 8 + side) * 0.03;
      s.scale(pulse, pulse, 0.5);
      this.overlay.draw(m.star, s.top, COLORS.gold, { unlit: true, outline: 0.014 });
    }
  }

  /** Stars circling a downed duellist's head. */
  private drawStars(head: V, t: number): void {
    const { m, s } = this;
    const count = 5;
    for (let i = 0; i < count; i++) {
      const a = t * 3.1 + (i / count) * Math.PI * 2;
      s.reset();
      s.translate(
        head[0] + Math.cos(a) * 0.95,
        head[1] + 0.72 + Math.sin(a * 2) * 0.1,
        head[2] + Math.sin(a) * 0.95,
      );
      s.rotY(a * 1.8).rotZ(t * 4);
      s.scale(0.34);
      this.overlay.draw(m.star, s.top, COLORS.gold, { unlit: true, outline: 0.022 });
    }
  }

  private drawBullet(x: number, y: number, z: number, end: V3, bar: number): void {
    const { m, s, overlay: r } = this;
    const dx = end[0] - x, dy = end[1] - y, dz = end[2] - z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.asin(clamp(dy / len, -1, 1));
    const size = 0.11 + bar * 0.09;
    s.reset().translate(x, y, z).rotY(yaw).rotX(pitch);
    s.push().rotX(Math.PI / 2).scale(size, size * 2.1, size);
    r.draw(m.hex, s.top, COLORS.bullet, { outline: 0.012 });
    s.pop();
    s.push().translate(0, 0, -size * 1.5).rotX(-Math.PI / 2).scale(size, size * 1.1, size);
    r.draw(m.cone, s.top, COLORS.brass, { outline: 0.012 });
    s.pop();
    s.push().rotZ(this.time * 3).translate(0, 0, size * 0.6).rotX(Math.PI / 2).scale(size * 1.08, size * 0.2, size * 1.08);
    r.draw(m.hex, s.top, COLORS.steelDark);
    s.pop();
  }

  /**
   * The world point that lines up on screen with the muzzle. The gun has its own camera, so its position
   * in space isn't where it looks to be from the street: a shot's tracer has to start from where it shows.
   */
  private muzzleInWorld(inView: LookV3, cam: LookCamera): LookV3 {
    const ndc = transformPoint(HELD_PROJ, inView);
    const p = cam.proj;
    const z = -3;
    const x = (ndc[0] * -z - p[8]! * z) / p[0]!;
    const y = (ndc[1] * -z - p[9]! * z) / p[5]!;
    return transformPoint(invert(cam.view), [x, y, z]);
  }

  /** Drives the gun through a reload. Returns how far it's turned up to be looked at, 0..1. */
  private reloadPose(dt: number): number {
    const { gunAction } = this;
    const view = this.reloadView;
    if (!view) {
      gunAction.open = Math.max(0, gunAction.open - dt * 7);
      gunAction.loadSpin = gunAction.open > 0 ? gunAction.loadSpin : 0;
      return gunAction.open;
    }
    const { t, bullets } = view.reload;
    const closeAt = reloadTime(bullets) - RUSH.reloadCloseSec;
    gunAction.open = smooth(0, RUSH.reloadOpenSec * 0.8, t) * (1 - smooth(closeAt, closeAt + RUSH.reloadCloseSec * 0.7, t));
    // Each chamber comes round to the top, ready for the next round.
    const goal = -view.ammo * CHAMBER;
    gunAction.loadSpin += (goal - gunAction.loadSpin) * Math.min(1, dt * 24);
    return smooth(0, RUSH.reloadOpenSec, t) * (1 - smooth(closeAt + 0.03, closeAt + RUSH.reloadCloseSec, t));
  }

  /** Rounds in their chambers, the next one flying in, and the empties dropping out. */
  private bulletParts(cylinder: LookMat4): HeldPart[] {
    const view = this.reloadView;
    if (!view || this.magGun) return [];
    const { t, bullets, loaded } = view.reload;
    const { cylinderPivot, chamberOrbit, cylinderRear, cylinderLength } = this.gunParts;
    const length = cylinderLength * 0.95;
    const radius = chamberOrbit * 0.3;
    const chamber = (i: number, back: number, down: number, tumble: number): HeldPart => {
      const a = i * CHAMBER;
      return {
        mesh: this.bulletMesh,
        model: multiply(
          multiply(
            multiply(cylinder, translation(cylinderRear - 0.015 - back, cylinderPivot[1] + Math.cos(a) * chamberOrbit - down, Math.sin(a) * chamberOrbit)),
            rotationZ(tumble),
          ),
          scaling(length, radius, radius),
        ),
        gloss: 0.5,
      };
    };
    const out: HeldPart[] = [];
    // Six dark chambers in the back of the cylinder, so you can see them fill up.
    for (let i = 0; i < CHAMBERS; i++) {
      const a = i * CHAMBER;
      out.push({
        mesh: this.chamberMesh,
        model: multiply(
          multiply(cylinder, translation(cylinderRear - 0.004, cylinderPivot[1] + Math.cos(a) * chamberOrbit, Math.sin(a) * chamberOrbit)),
          scaling(1, radius * 1.1, radius * 1.1),
        ),
        gloss: 0,
      });
    }
    // Show them seated only once the cylinder's out far enough to see.
    if (t < reloadTime(bullets)) for (let i = 0; i < view.ammo; i++) out.push(chamber(i, 0, 0, 0));
    // The empties slide out the back and fall, as the cylinder opens.
    const dropAt = RUSH.reloadOpenSec * 0.5;
    const age = t - dropAt;
    if (age > 0 && age < 0.55) {
      for (let i = 0; i < bullets; i++) {
        // They slide out of the chamber, then fall straight down the screen, whichever way the gun's held.
        const spent = age * (1 + i * 0.1);
        const shell = chamber(view.ammo - loaded + i, Math.min(spent * 2, 0.25) * cylinderLength, 0, spent * (5 + i));
        const fall = spent * spent * 3.4;
        out.push({ ...shell, model: multiply(translation(spent * (i - 2.5) * 0.04, -fall, 0), shell.model) });
      }
    }
    // The next round, coming in from below and behind, nose first.
    if (loaded < bullets && t >= RUSH.reloadOpenSec) {
      const into = clamp((t - RUSH.reloadOpenSec) / RUSH.reloadBulletSec - loaded, 0, 1);
      const left = 1 - smooth(0, 1, into);
      out.push(chamber(view.ammo, 0.04 + left * 0.34, left * left * 0.16, -left * 0.5));
    }
    return out;
  }

  /** The arm and revolver in camera space, pointing at the aim, with the muzzle swelling. */
  private heldItem(aimX: number, aimY: number, outfit: number, cam: LookCamera, bar: number, dt: number): HeldItem {
    const now = this.time;
    const tanV = Math.tan((MENU_FOV * Math.PI) / 360);
    const tanH = tanV * ASPECT;
    const base: LookV3 = [0.62, -0.36, -1.2];
    const dist = 12;
    const tx = aimX * tanH * dist - base[0];
    const ty = aimY * tanV * dist - base[1];
    const yaw = -Math.atan2(tx, dist);
    const pitch = Math.atan2(ty, Math.hypot(tx, dist));
    // The gun shakes harder as the shot charges, like it can barely hold it.
    const jitter = this.loudness * 0.007 + bar * bar * 0.016;
    // For a reload, the gun's brought up and close, with the back of the cylinder toward you.
    const loading = this.reloadPose(dt);
    const flourish = this.gunAction.flourish(now);
    let model = translation(
      base[0] - flourish * 0.08 - loading * RELOAD_POSE.x + Math.sin(now * 47) * jitter,
      base[1] + flourish * 0.12 + loading * RELOAD_POSE.y + Math.sin(now * 61) * jitter,
      base[2] + loading * RELOAD_POSE.z,
    );
    model = multiply(model, rotationY(lerp(yaw, RELOAD_POSE.yaw, loading)));
    model = multiply(model, rotationX(lerp(pitch, RELOAD_POSE.pitch, loading) + flourish * 0.75));
    model = multiply(model, rotationZ(0.05 - flourish * 0.4 + loading * RELOAD_POSE.roll + Math.sin(now * 53) * jitter * 3));
    model = multiply(model, rotationY(Math.PI / 2));
    model = multiply(model, scaling(0.38, 0.38, 0.38));

    this.readyGun();
    const { armRig, gunParts, gunMeshes, magGun, gunFinish } = this;
    armRig.update(now);
    if (armRig.clipName === "fire" && armRig.progress(now) >= 1) armRig.play("hold", now, { fade: 0.2 });
    // The gun swells from the grip and runs red as the shot charges, while the hand stays put.
    const growth = 1 + bar * GUN_GROWTH;
    const gunBase = multiply(multiply(model, armRig.boneMatrix("gun")), scaling(growth, growth, growth));
    const heat: readonly [number, number, number] = [bar * 2.1 + gunFinish.glow[0], -bar * 0.62 + gunFinish.glow[1], -bar * 0.62 + gunFinish.glow[2]];
    const gloss = gunFinish.gloss;
    const muzzle = magGun ? magGun.muzzle : gunParts.muzzle;

    const inView = transformPoint(gunBase, muzzle);
    this.muzzleMat = multiply(gunBase, translation(muzzle[0], muzzle[1], muzzle[2]));
    this.muzzle = this.muzzleInWorld(inView, cam);

    let parts: HeldPart[];
    if (magGun) {
      // The slide kicks back on every shot, and the magazine drops out for a reload.
      const kick = 1 - smooth(0, 0.1, now - this.gunAction.fired);
      parts = [
        { mesh: magGun.body, model: gunBase, gloss, glow: heat },
        { mesh: magGun.slide, model: multiply(gunBase, translation(-kick * magGun.slideBack, 0, 0)), gloss, glow: heat },
        { mesh: magGun.mag, model: multiply(gunBase, translation(0, -this.gunAction.open * 1.7, 0)), gloss, glow: heat },
        { mesh: this.armFor(outfit), model, bones: armRig.bones },
      ];
    } else {
      const mats = this.gunAction.partMatrices(now, gunParts, gunBase);
      parts = [
        { mesh: gunMeshes.body, model: mats.body, gloss: gloss * 0.9, glow: heat },
        { mesh: gunMeshes.cylinder, model: mats.cylinder, gloss: gloss * 1.1, glow: heat },
        { mesh: gunMeshes.hammer, model: mats.hammer, gloss, glow: heat },
        { mesh: gunMeshes.trigger, model: mats.trigger, gloss, glow: heat },
        { mesh: this.armFor(outfit), model, bones: armRig.bones },
        ...this.bulletParts(mats.cylinder),
      ];
    }

    // The muzzle swells with the holler, on a spring. Firing lets the air out in a blink.
    const goal = this.fireKick > 0 ? 0 : clamp(bar * 0.92 + this.loudness * 0.2, 0, 1.15);
    this.inflateVelocity += (goal - this.inflate) * 150 * dt;
    this.inflateVelocity *= Math.exp(-11 * dt);
    this.inflate = Math.max(0, this.inflate + this.inflateVelocity * dt);
    if (this.inflate > 0.02) {
      // Along the barrel, the direction from the cylinder out to the muzzle.
      const axis = magGun ? 1 : Math.sign(gunParts.muzzle[0] - gunParts.cylinderPivot[0]) || 1;
      const swell = this.inflate;
      const radius = BULGE.base + swell * BULGE.radius;
      const at = translation(muzzle[0] - axis * BULGE.back, muzzle[1], muzzle[2]);
      parts.push({
        mesh: this.muzzleBulge,
        model: multiply(multiply(gunBase, at), scaling(BULGE.length + swell * 0.12, radius, radius)),
        gloss: 0.4,
        glow: heat,
      });
    }
    return { parts, proj: HELD_PROJ, flash: this.flash };
  }
}

/** The crouch clip gets partway down. This takes the body the rest of the way to its hitbox. */
function duckSquash(duck: number): LookMat4 {
  return scaling(1, lerp(1, 0.8, duck), 1);
}

function hatPalette(hat: V3, band: V3): Palette {
  return { skin: hat, shirt: hat, poncho: hat, accent: hat, pants: hat, boots: hat, hat, band, hair: hat };
}

/** A smooth little ball, for the swollen end of the barrel. */
function bulgeBuilder(color: RGB): MeshBuilder {
  const b = new MeshBuilder(77);
  b.mat = "plain";
  const onBall = (p: LookV3): LookV3 => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return [p[0] / l, p[1] / l, p[2] / l];
  };
  const px: LookV3 = [1, 0, 0], py: LookV3 = [0, 1, 0], pz: LookV3 = [0, 0, 1];
  const nx: LookV3 = [-1, 0, 0], ny: LookV3 = [0, -1, 0], nz: LookV3 = [0, 0, -1];
  let faces: [LookV3, LookV3, LookV3][] = [
    [px, py, pz], [py, nx, pz], [nx, ny, pz], [ny, px, pz],
    [py, px, nz], [nx, py, nz], [ny, nx, nz], [px, ny, nz],
  ];
  for (let level = 0; level < 2; level++) {
    faces = faces.flatMap(([a, c, d]) => {
      const ac = onBall([a[0] + c[0], a[1] + c[1], a[2] + c[2]]);
      const cd = onBall([c[0] + d[0], c[1] + d[1], c[2] + d[2]]);
      const da = onBall([d[0] + a[0], d[1] + a[1], d[2] + a[2]]);
      return [[a, ac, da], [c, cd, ac], [d, da, cd], [ac, cd, da]] as [LookV3, LookV3, LookV3][];
    });
  }
  for (const [a, c, d] of faces) b.tri(a, c, d, color);
  return b;
}

/**
 * The shooter camera's off-centre frustum, blending toward a wider, centred one as the
 * camera leaves with the bullet. At k = 0, a screen position maps exactly to the plane.
 */
function frustumAt(k: number): LookMat4 {
  const d = PLANE.distance;
  const halfW = PLANE.width / 2 / d;
  const top = (PLANE.centerY - PLANE.cameraY + PLANE.height / 2) / d;
  const bottom = (PLANE.centerY - PLANE.cameraY - PLANE.height / 2) / d;
  const wide = Math.tan(0.42);
  const t = lerp(top, wide, k);
  const b = lerp(bottom, -wide, k);
  const w = lerp(halfW, wide * ASPECT, k);
  return frustum(-w * NEAR, w * NEAR, b * NEAR, t * NEAR, NEAR, FAR);
}

function symmetricProjection(fovY: number): LookMat4 {
  const t = Math.tan(fovY / 2);
  return frustum(-t * ASPECT * NEAR, t * ASPECT * NEAR, -t * NEAR, t * NEAR, NEAR, FAR);
}

/** The side-on standoff, dollying in as `u` goes from 0 to 1. */
function wideCamera(u: number, time: number): LookCamera {
  const x = lerp(-7.4, -6.3, clamp(u, 0, 1));
  const eye: LookV3 = [x, 1.2 + Math.sin(time * 0.3) * 0.03, (WIDE_Z[0] + WIDE_Z[1]) / 2];
  return {
    eye,
    view: lookAt(eye, [0, 1.5, eye[2]]),
    proj: symmetricProjection(0.86),
  };
}

function bulletPath(shot: Shot, muzzle: V3): { start: V3; end: V3 } {
  if (shot.hit) return { start: muzzle, end: [shot.landing.x, shot.landing.y, Z0 + 0.25] };
  // A miss flies on past the target's plane and into the dirt behind them.
  const over = 7 / PLANE.distance;
  return {
    start: muzzle,
    end: [
      shot.landing.x * (1 + over),
      Math.max(0.1, shot.landing.y + (shot.landing.y - PLANE.cameraY) * over),
      Z0 - 7,
    ],
  };
}

function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function normalized(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
