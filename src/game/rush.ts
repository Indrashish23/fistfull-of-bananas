// Rush mode. Goons run at you and jump around throwing things, and you shoot them and whatever
// they throw. Then a boss, in turns: shooting time, then dodging time, with a word telling you how
// to move. No DOM or rendering here, so it runs in plain tests.

import { gradeFor, waveReport, type Grade, type RunStats, type WaveReport } from "./arcade";
import { BOSS, BossBrain } from "./boss";
import type { GunStats } from "./guns";
import type { AimLevel } from "./settings";
import { LevelSequencer, levelOne, type LevelStage } from "./level";
import {
  DEFAULT_RULES,
  HITBOX,
  PLANE,
  clamp,
  hitZone,
  nearestPointOnBody,
  reticleHits,
  XRAYS_BY_ZONE,
  XRAY_LABEL,
  type HitZone,
  type XrayKind,
  type Vec2,
} from "./rules";

/** How one kind of target grabs the aim: from how far, in screen heights, and how far onto it. */
interface AimGrab {
  reach: number;
  pull: number;
}

interface AimTuning {
  thrown: AimGrab;
  whiskey: AimGrab;
  heart: AimGrab;
  enemy: AimGrab;
  barrel: AimGrab;
  /** How much of your arm's movement reaches the reticle while it's stuck, so you can still pick a spot. */
  friction: number;
  /** How far your arm has to move to pull free. */
  breakAt: number;
  /** How quickly the reticle settles onto something. */
  perSec: number;
  /** How close a shot counts as locked on, as a share of the reach. */
  lockAt: number;
}

/**
 * Aim assist, the usual kit: magnetism draws the reticle onto a target once it's in reach, friction makes it hard to
 * slide off, tracking carries it along as the target moves, and it stays stuck until you pull your arm away or
 * shake your hand. A flying bottle grabs hardest and from furthest. The boss only grabs by his heart.
 */
export const AIM_LEVELS: Record<Exclude<AimLevel, "off">, AimTuning> = {
  soft: {
    thrown: { reach: 0.13, pull: 0.5 },
    whiskey: { reach: 0.08, pull: 0.35 },
    heart: { reach: 0.1, pull: 0.4 },
    enemy: { reach: 0.06, pull: 0.22 },
    barrel: { reach: 0.045, pull: 0.2 },
    friction: 0.8,
    breakAt: 0.09,
    perSec: 9,
    lockAt: 0.4,
  },
  normal: {
    thrown: { reach: 0.18, pull: 0.72 },
    whiskey: { reach: 0.11, pull: 0.5 },
    heart: { reach: 0.13, pull: 0.55 },
    enemy: { reach: 0.085, pull: 0.35 },
    barrel: { reach: 0.06, pull: 0.3 },
    friction: 0.55,
    breakAt: 0.15,
    perSec: 12,
    lockAt: 0.65,
  },
  hard: {
    thrown: { reach: 0.24, pull: 0.92 },
    whiskey: { reach: 0.14, pull: 0.7 },
    heart: { reach: 0.17, pull: 0.75 },
    enemy: { reach: 0.12, pull: 0.6 },
    barrel: { reach: 0.08, pull: 0.45 },
    friction: 0.3,
    breakAt: 0.26,
    perSec: 18,
    lockAt: 0.85,
  },
};

export const RUSH = {
  hearts: 5,
  spawnZ: -40,
  rushSpeed: 6.5,
  /** How fast throwers run up the street to where they plant their feet. */
  comeOutSpeed: 7,
  /** Where runners stop in front of you, far enough off to be seen whole. */
  strikeZ: -5,
  /** How long from stopping there until the blow lands, and how long they hang about after. */
  strikeWindupSec: 0.75,
  strikeRecoverSec: 0.35,
  laneHalfWidth: 6,
  /** Reticle size, in world units on the plane at PLANE.distance. */
  reticle: 0.42,
  fireGapSec: 0.28,
  clearSec: 2,
  /** At most this many thrown things in the air at once, counting any about to be thrown. */
  maxThrown: 2,
  throwEveryMin: 2.5,
  throwEveryMax: 4.5,
  windupSec: 0.5,
  /** Slow enough to pick off. The wind-up above matches the moment the throw clip lets go. */
  throwSec: 3,
  throwGravity: 2,
  throwLandZ: -1.5,
  throwLandY: 1.1,
  /** How generous aiming at a thrown thing is, in world units at PLANE.distance. */
  thrownReticle: 0.75,
  thrownPoints: 50,
  /** How long before a target you've pulled free of will grab you again. */
  assistIgnoreSec: 0.7,
  /** Where dead-eye's lock goes on someone, and how fast it gets there. */
  lockHeadY: 1.9,
  lockPerSec: 30,
  /** A bottle is easier to pick than whatever's behind it. */
  assistThrownFavour: 0.6,
  /** How long the last kill of a wave plays out in slow motion. */
  lastKillSlowSec: 1.5,
  /**
   * How far up the street the tutorial's lizard stands: close enough that his nuts are easy to find, and far
   * enough that they're well above where a lowered arm reloads.
   */
  practiceZ: -12,
  /** How often a kill plays the bullet cam, and the shortest gap between them. */
  camChance: 0.3,
  camGapSec: 7,
  /** How often a killing shot carries on out the back, and what catching someone else with it pays. */
  pierceChance: 0.3,
  pierceBonus: 2,
  /** A tiny freeze on each kill, so it lands with a punch, and longer for a precise hit. */
  hitStopSec: 0.05,
  hitStopHeadSec: 0.11,
  hitStopNutsSec: 0.09,
  /** Each step of the combo adds this much more freeze. */
  hitStopPerCombo: 0.008,
  /** How much the player's view leans, and how far ducking lowers it. */
  leanReach: 1.1,
  duckDrop: 0.9,
  poseFollowPerSec: 10,
  /** How far you need to lean or duck to count as dodging. */
  leanedAt: 0.45,
  duckedAt: 0.5,
  /** The gator's drawn about 6 units tall, and the hit test is sized for 2.95. */
  bossScale: 2.02,
  /** The middle of the ring, well clear of the stands. */
  bossZ: -14,
  /** Where the gator starts, up on the bank's great beam, relative to the camera at its final stop. */
  bossRoofX: 0,
  bossRoofY: 10.9,
  bossRoofZ: -42.2,
  /** Your turn: he moves about, then shows his heart for the last of this, and attacks the moment he covers it. */
  shootTimeSec: 6.4,
  dodgesPerRound: 3,
  /** How long a word shows before the attack comes, and how long it takes to reach you. */
  warnSec: 1.2,
  attackSec: 0.8,
  /** How long an attack keeps going past you before the next word. */
  pastSec: 0.5,
  /** How often a dodged attack goes past in slow motion. */
  dodgeSlowChance: 0.35,
  slowSec: 0.9,
  slowScale: 0.22,
  /** How far a shot fire bottle sets goons alight. */
  fireRadius: 3.4,
  /** How long someone burns, running around screaming, before they drop. */
  burnSec: 2.8,
  burnSpeed: 5,
  burnTurnSec: 0.45,
  /** Burning goons set light to anyone they run into. */
  burnTouch: 1.2,
  burnPoints: 150,
  /** Fuel left burning on the ground by a bottle or barrel: anyone running through catches light. */
  firePatchSec: 2.6,
  firePatchRadius: 1.5,
  /** How close to the end of the street burning goons turn around. */
  burnTurnZ: -8,
  /** How far off straight ahead a burning goon runs, in radians. */
  burnWeave: 0.3,
  /** How many runners try ducking under your first shot at them. */
  duckChance: 0.12,
  duckSec: 1.8,
  /** How much slower they waddle while ducked, and how much of their height is left. */
  duckSpeed: 0.22,
  duckHeight: 0.62,
  /** Too late to try it past here. */
  duckBeforeZ: -9,
  /** How far an exploding barrel reaches. */
  barrelRadius: 5,
  barrelPoints: 75,
  /** Where a barrel's body sits, in world units. */
  barrelHalfWidth: 0.6,
  barrelHeight: 1.4,
  /** How far goons keep from a barrel, centre to centre, and how far ahead they look. */
  avoidRadius: 1.5,
  avoidAhead: 5,
  avoidSpeed: 3,
  /** How often a barrel rolls out of a saloon door, and how fast. */
  rollEverySec: 7,
  rollSpeed: 4.5,
  /** Where they come out, down each side of the street. */
  rollSideX: 8.5,
  /** Rolling into a goon sets it off. */
  rollTouch: 1.3,
  /** How close to the end of its roll a barrel gives up and goes off the other side. */
  rollEndX: 9,
  /** Kills in a row, within this long of each other, build the combo. */
  comboSec: 5,
  comboPerStep: 3,
  comboMax: 5,
  /** A shot above this height, on a hat that's still on, takes off the hat. */
  hatFromY: 2.3,
  hatPoints: 75,
  /** How long they stop to grab it. */
  hatGrabSec: 1.3,
  ammo: 8,
  /** Each reload goes this much quicker than the last, up to a limit. You get slick with practice. */
  reloadPacePerReload: 0.2,
  reloadPaceMax: 2.6,
  /** The cylinder swings out, one bullet goes in at a time, then it snaps shut. */
  reloadOpenSec: 0.2,
  reloadBulletSec: 0.14,
  reloadCloseSec: 0.18,
  /** An arm this low on the screen counts as lowered, for reloading. */
  reloadFromY: 0.9,
  /** Kills needed to fill dead-eye, how long it lasts, and how slow and fast it runs. */
  deadEyeKills: 16,
  deadEyeSec: 4,
  deadEyeScale: 0.28,
  deadEyeGapSec: 0.09,
  shieldHalfWidth: 0.55,
  shieldFromY: 0.3,
  shieldToY: 1.7,
  shieldSpeed: 4.5,
  /** Shots it takes to break a shield, what each is worth, and how far each knocks them back. */
  shieldHits: 3,
  shieldHitPoints: 25,
  shieldBreakPoints: 100,
  shieldKnock: 0.5,
  /** How long getting a shield up takes, standing still, and how far into that it starts stopping bullets. */
  shieldRaiseSec: 0.6,
  shieldUpAt: 0.3,
  /** A short breather after you've been hurt, before anyone else comes out. */
  mercySec: 1.2,
  /** Lizards wheel the cannon out from up the street to here, out on one side. */
  cannonFromX: 6.4,
  cannonFromZ: -46,
  cannonX: 4.2,
  cannonZ: -31,
  cannonRolloutSec: 2.4,
  /** How long the warning shows, with the fuse burning, before it goes off. */
  cannonWarnSec: 1.3,
  /** How long your view takes to come back to the middle, before anyone starts running again. */
  cannonRecoverSec: 0.7,
  ballRadius: 1.35,
  ballSpeed: 15,
  /** Which side of you it passes, once it reaches you, and where it's gone by the end. */
  ballReachX: 0.4,
  ballHitZ: -1.2,
  ballEndZ: 7,
  /** How close to its edge counts as under it. */
  ballTouch: 0.5,
  ballSlowFromZ: -6,
  tramplePoints: 150,
  cannonDodgePoints: 100,
  fatHits: 3,
  fatSpeed: 3.2,
  fatScale: 1.4,
  /** How long a goon peeks round a corner before stepping out, give or take, and how fast they step. */
  peekSec: 0.95,
  peekLeanSec: 0.28,
  stepOutSpeed: 7,
  peekBonus: 100,
  /** Runners close in on you as they come, and arrive at most this far to either side. */
  closeInX: 1.3,
  /** Barrels start this high when they drop in, and each one after the first comes this much later. */
  barrelDropY: 13,
  barrelDropGap: 6,
  barrelGravity: 24,
  /** The golden goon sprints straight down the street and past you, without stopping to fight. */
  goldenSpeed: 9,
  goldenPastZ: -2,
  goldenPoints: 500,
  /** How often a whiskey bottle comes down, when you've lost a heart. It lands, and waits on the ground. */
  whiskeyEverySec: 16,
  whiskeySec: 10,
  whiskeyFlightSec: 1.1,
  whiskeyRestY: 0.5,
  whiskeyLandX: 3.6,
  whiskeyPoints: 50,
} as const;

/** Which outfit the golden goon wears. The four before it are the regular ones. */
export const GOLDEN_OUTFIT = 4;
/** And the molotov throwers' yellow flame suit. */
export const FLAME_OUTFIT = 5;

/** Each stage of the bullet cam, in seconds, from the shot to the camera coming back. */
export const RUSH_CAM = {
  bulletSec: 0.95,
  xraySec: DEFAULT_RULES.killCamSec,
  ragdollSec: 1.2,
  backSec: 0.45,
} as const;

const CAM_TOTAL_SEC = RUSH_CAM.bulletSec + RUSH_CAM.xraySec + RUSH_CAM.ragdollSec + RUSH_CAM.backSec;

/** How long loading this many bullets takes, from opening the cylinder to snapping it shut. */
export function reloadTime(bullets: number): number {
  return RUSH.reloadOpenSec + bullets * RUSH.reloadBulletSec + RUSH.reloadCloseSec;
}

export type CamStage = { name: "bullet" | "xray" | "ragdoll" | "back"; t: number; u: number };

/** Which stage of the bullet cam this is, and how far through it. */
export function rushCamStage(t: number): CamStage {
  let left = t;
  for (const [name, sec] of [
    ["bullet", RUSH_CAM.bulletSec],
    ["xray", RUSH_CAM.xraySec],
    ["ragdoll", RUSH_CAM.ragdollSec],
  ] as const) {
    if (left < sec) return { name, t: left, u: left / sec };
    left -= sec;
  }
  return { name: "back", t: left, u: clamp(left / RUSH_CAM.backSec, 0, 1) };
}

/**
 * The alleys between the buildings, where goons come out. Each spot is just out of sight behind the
 * corner of the nearer building, from where the camera stands. `hide` is out of view, `peek` is leaning
 * out into it, and which side of the street it is comes from their sign.
 */
export const PEEK_SPOTS: readonly { hide: number; peek: number; z: number; near: boolean }[] = [
  { hide: 11.4, peek: 10.3, z: -14, near: true },
  { hide: -11.6, peek: -10.5, z: -14.75, near: true },
  { hide: 10.7, peek: 9.9, z: -31.5, near: false },
  { hide: -10.5, peek: -9.8, z: -28.75, near: false },
  { hide: 11.7, peek: 11, z: -43, near: false },
  { hide: -9.2, peek: -8.5, z: -43.25, near: false },
];

/** Something the aim could settle on. */
interface AimTarget {
  ref: object;
  where: () => Vec2 | null;
  x: number;
  y: number;
  d: number;
  reach: number;
  pull: number;
  thrown: boolean;
}

/** One beat of a wave: someone coming out, a pause of this many seconds, or the cannon. */
export type WaveBeat = EnemyKind | number | "cannon";

export interface RushWave {
  /** Seconds between people in the same group. */
  gap: number;
  /** Nobody else comes out while this many are already up. */
  cap?: number;
  enemies: readonly WaveBeat[];
  barrels?: readonly { x: number; z: number }[];
}

/**
 * Who comes out in each wave, written like a ride rather than a queue: a build, a peak, then a moment to
 * breathe, with each wave bringing in one new idea. The numbers are rests. Groups come quickly and the rests
 * between them are what give it a rhythm, and the cap keeps someone who's falling behind from being buried.
 */
export const RUSH_WAVES: readonly RushWave[] = [
  // Learn the gun: one at a time, then in pairs, then the first bottle, then gold as a treat for getting there.
  {
    gap: 0.5,
    cap: 3,
    enemies: [
      "rusher", 2.4,
      "rusher", 2.2,
      "rusher", "rusher", 3,
      "thrower", 1.8,
      "rusher", "rusher", 2.6,
      "golden", 1.4,
      "rusher", "rusher", "thrower",
    ],
    barrels: [{ x: -3.6, z: -21 }, { x: 3.2, z: -25 }],
  },
  // Shields and the big fella change what you aim at. The cannon is the middle of the wave, with a rest after.
  {
    gap: 0.45,
    cap: 4,
    enemies: [
      "rusher", "rusher", 1.8,
      "shield", 1.6,
      "rusher", "thrower", 2.8,
      "cannon", 2.2,
      "fat", 1.4,
      "rusher", "rusher", 1.6,
      "shield", "rusher", 2,
      "thrower", "fat", "rusher",
    ],
    barrels: [{ x: -1.5, z: -18 }, { x: 4.5, z: -22 }, { x: -5, z: -27 }],
  },
  // Everything together, overlapping, and it ends on its biggest push rather than trailing off.
  {
    gap: 0.4,
    cap: 5,
    enemies: [
      "thrower", "rusher", "rusher", 1.4,
      "shield", "fat", 1.6,
      "rusher", "rusher", "thrower", 2.4,
      "cannon", 1.8,
      "golden", 0.8,
      "rusher", "shield", "rusher", 1.4,
      "thrower", "fat", 1.2,
      "rusher", "rusher", "shield", "rusher", "thrower", "rusher",
    ],
    barrels: [{ x: 2, z: -16 }, { x: -3.5, z: -20 }, { x: 5, z: -24 }, { x: -1, z: -29 }],
  },
];

const POINTS: Record<HitZone, number> = { body: 100, nuts: 150, head: 200 };
const ZONE_LABEL: Record<HitZone, string> = { body: "", nuts: "NUT SHOT!", head: "HEADSHOT!" };

export type RushPhase = "rush" | "clear" | "travel" | "arena" | "bossDrop" | "challenge" | "faceoff" | "bossShoot" | "bossCharge" | "bossDodge" | "won" | "lost";
export type EnemyKind = "rusher" | "thrower" | "boss" | "shield" | "fat" | "golden";
export type MeleeWeapon = "machete" | "axe" | "club";
export type DodgeMove = "left" | "right" | "duck";

export interface RushEnemy {
  id: number;
  kind: EnemyKind;
  x: number;
  /** Height off the ground, while jumping. */
  y: number;
  z: number;
  /** Where a thrower stops: they run up the street to here, and stay. */
  stopZ: number;
  outfit: number;
  throwIn: number;
  /** Seconds left of winding up a throw, or 0. */
  windup: number;
  /** Hits left before they go down. */
  hp: number;
  hatOff: boolean;
  /** Seconds left of stopping to grab a shot-off hat, or 0. */
  grabbing: number;
  /** Seconds left of burning, or 0 when they're not on fire. */
  burning: number;
  /** Which way they're running while they burn, on the ground. */
  burnX: number;
  burnZ: number;
  burnTurn: number;
  /** Which way along the street they're running while they burn: toward you or away. */
  burnHeading: number;
  /** What a runner's carrying, or null for anyone who isn't. */
  weapon: MeleeWeapon | null;
  /** Seconds since a runner started its final swing at you, or -1. */
  swing: number;
  /** Whether this one will try ducking under your first shot at them. */
  dodger: boolean;
  /** Seconds left of waddling along ducked, or 0. */
  ducking: number;
  /** Shots the shield can still take, or 0 for no shield. */
  shieldHp: number;
  /** Seconds left of peeking round a corner, or 0, and how long it started at. */
  peeking: number;
  peekLeft0: number;
  /** Where they're hiding and where they lean out to, while peeking. */
  hideX: number;
  peekX: number;
  /** Where they're stepping out to, in the street, or null once they're there. */
  stepTo: number | null;
  /** Where in the street they mean to reach you. */
  endX: number;
  /** Which way they're facing, in radians, 0 being straight at you. */
  heading: number;
  /** Seconds left of getting a shield up, stopped where they are. */
  raising: number;
  /** Which side of the cannon they're pushing, while they're pushing it, or 0. */
  crew: number;
}

/** The cannon's big moment, while it's on. */
export interface Cannon {
  phase: "rollout" | "warn" | "roll" | "recover";
  t: number;
  /** Which side of the street it's on, -1 for the left. */
  side: number;
  x: number;
  z: number;
  /** Which way it's pointing, in radians, 0 being straight at you. */
  yaw: number;
  /** Which way gets you out of its path. */
  move: DodgeMove;
  ball: { x: number; z: number; turned: number; fromZ: number } | null;
  /** Everyone flattened onto the ball, and how far round it. */
  stuck: { outfit: number; angle: number }[];
  /** Set once the ball's reached you. */
  outcome: "dodged" | "hit" | null;
}

/** A cannon that's been fired, still standing in the street. */
export interface ParkedCannon {
  x: number;
  z: number;
  yaw: number;
}

/** Fuel burning on the ground. */
export interface FirePatch {
  id: number;
  x: number;
  z: number;
  radius: number;
  /** Seconds left. */
  left: number;
}

/** A reload in progress. */
export interface RushReload {
  t: number;
  /** How many bullets this reload puts in, and how many are in so far. */
  bullets: number;
  loaded: number;
}

export interface Barrel {
  id: number;
  x: number;
  z: number;
  /** World units a second across the street, for one rolling out of a saloon, or 0. */
  roll: number;
  /** How far it's turned, for drawing it rolling. */
  turned: number;
  /** Height off the ground and how fast it's falling, while it drops in. */
  y: number;
  vy: number;
}

/** The bottle of whiskey that sails across: shoot it for a heart. */
export interface Whiskey {
  x: number;
  y: number;
  z: number;
  /** How far through its time it is, 0..1. */
  t: number;
  fromX: number;
  landX: number;
}

export interface Thrown {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface DodgePrompt {
  move: DodgeMove;
  /** Seconds since the word appeared. */
  t: number;
  from: [number, number, number];
  /** Whether a clean dodge goes past in slow motion. */
  slow: boolean;
  /** Set once the attack's reached you. */
  outcome: "dodged" | "hit" | null;
}

export interface RushCam {
  enemy: RushEnemy;
  zone: HitZone;
  point: Vec2;
  t: number;
  /** Whether the bullet comes out the far side, rather than stopping inside. */
  pierce: boolean;
  /** Which x-ray this is. */
  xray: XrayKind;
}

export interface RushInput {
  /** Normalized screen position, 0..1 with y down. */
  aim: Vec2;
  /** 0..1 how much aim assist to give. Left out, there's none. */
  assist?: number;
  /** A shake of the hand, which pulls the aim free of whatever it's stuck to. */
  breakAim?: boolean;
  /** A press of OK or a click, once, on the frame it happened. */
  fire: boolean;
  /** Whether OK's being held down, for guns that keep firing. */
  fireHeld?: boolean;
  /** A press of the reload key, once. Lowering the arm also reloads. */
  reload?: boolean;
  /** -1..1, how far they're leaning. */
  lean: number;
  duck: boolean;
}

export interface RushKill {
  enemy: RushEnemy;
  zone: HitZone;
  point: Vec2;
  cam: boolean;
}

export type RushEvent =
  | { type: "wave"; number: number }
  | { type: "shot"; point: [number, number, number]; killed: RushKill | null; bossHit: boolean; thrown: Thrown | null }
  /** Points landing, at a spot in the street, with a word for how they were earned. */
  | { type: "scored"; points: number; label: string; x: number; y: number; z: number }
  | { type: "blocked"; enemy: RushEnemy; x: number; y: number; z: number }
  | { type: "shieldBroke"; enemy: RushEnemy; x: number; y: number; z: number }
  | { type: "ducked"; enemy: RushEnemy }
  /** A bullet out the back of whoever it hit, on to wherever it ends up, maybe killing someone else. */
  | { type: "pierced"; from: [number, number, number]; to: [number, number, number]; next: RushKill | null }
  | { type: "wounded"; enemy: RushEnemy; point: Vec2 }
  | { type: "hat"; enemy: RushEnemy }
  | { type: "ignited"; enemy: RushEnemy }
  | { type: "burnedDown"; enemy: RushEnemy }
  | { type: "fireBurst"; x: number; y: number; z: number; caught: number }
  | { type: "barrel"; x: number; y: number; z: number; killed: RushEnemy[] }
  | { type: "barrelRolled"; barrel: Barrel }
  | { type: "barrelLanded"; x: number; z: number; hard: boolean }
  /** Someone's stopped in front of you, and is about to hit you. */
  | { type: "strikeWindup"; enemy: RushEnemy }
  /** Whoever just hit you has gone. */
  | { type: "strikeDone"; x: number; z: number }
  /** The last of a wave has gone down, and it's all in slow motion for a moment. */
  | { type: "lastKill" }
  | { type: "cannonRollout"; side: number }
  | { type: "cannonWarn"; move: DodgeMove }
  | { type: "cannonFired"; x: number; z: number; yaw: number }
  | { type: "trampled"; enemy: RushEnemy; x: number; z: number }
  | { type: "cannonDone" }
  | { type: "whiskey" }
  | { type: "healed"; hearts: number }
  | { type: "goldenEscaped" }
  | { type: "combo"; combo: number; multiplier: number }
  | { type: "empty" }
  | { type: "reloading"; bullets: number }
  | { type: "bulletIn"; loaded: number; bullets: number }
  | { type: "reloadClosing" }
  | { type: "reloaded" }
  | { type: "deadEyeReady" }
  | { type: "deadEyeStart" }
  | { type: "deadEyeEnd" }
  | { type: "threw"; thrown: Thrown }
  | { type: "smashed"; x: number; y: number; z: number }
  | { type: "struck"; hearts: number }
  | { type: "cleared"; number: number; report: WaveReport }
  | { type: "travel" }
  | { type: "arena" }
  | { type: "bossArrives" }
  | { type: "bossLanded" }
  | { type: "challenge" }
  /** He's about to open up, and can't be hurt until your next turn. */
  | { type: "bossCharge" }
  /** The gun's firing, and for how long. */
  | { type: "bossFire"; sec: number }
  /** A shot bouncing off him while he's invulnerable. */
  | { type: "bossBlocked"; x: number; y: number; z: number }
  /** A shot off his hide: only the heart can hurt him. */
  | { type: "bossRicochet"; x: number; y: number; z: number }
  /** A shot through the heart. */
  | { type: "bossHurt"; damage: number; heart: boolean; hp: number }
  | { type: "bossReveal" }
  | { type: "faceoff" }
  | { type: "shootTime" }
  | { type: "dodgeTime" }
  | { type: "word"; move: DodgeMove }
  | { type: "dodged"; slow: boolean }
  | { type: "ended"; won: boolean };

/** A screen position, on the upright plane this far in front of the camera. */
export function aimAtDepth(aim: Vec2, distance: number, cameraX: number, cameraY: number): Vec2 {
  const k = distance / PLANE.distance;
  return {
    x: cameraX + (aim.x - 0.5) * PLANE.width * k,
    y: cameraY + ((0.5 - aim.y) * PLANE.height + PLANE.centerY - PLANE.cameraY) * k,
  };
}

/** Where a point in the street shows on screen, 0..1. The opposite of aimAtDepth. */
export function projectToScreen(x: number, y: number, z: number, cameraX: number, cameraY: number): Vec2 | null {
  const distance = -z;
  if (distance <= 0.1) return null;
  const k = distance / PLANE.distance;
  return {
    x: 0.5 + (x - cameraX) / (PLANE.width * k),
    y: 0.5 - ((y - cameraY) / k + PLANE.cameraY - PLANE.centerY) / PLANE.height,
  };
}

function freshStats(): RunStats {
  return { kills: 0, shots: 0, hits: 0, bestCombo: 0, heartsLost: 0 };
}

function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RushOptions {
  seed?: number;
  camChance?: number;
  dodgeSlowChance?: number;
  /** How many shots before a reload. Tests can make this endless. */
  ammo?: number;
  /** The gun in your hand. Left out, it's the revolver. */
  gun?: GunStats;
  /** How much the aim helps. Left out, it's normal. */
  aimLevel?: AimLevel;
  /** Seconds between whiskey bottles, or 0 for none. */
  whiskeyEvery?: number;
  /** Seconds between barrels rolling out, or 0 for none. */
  rollEvery?: number;
  /** How many runners try ducking under your shot. */
  duckChance?: number;
  /** How often a killing shot carries on through. */
  pierceChance?: number;
  /** Whether goons peek out from the buildings, or just start down the street. */
  peek?: boolean;
  /** Whether barrels drop in from above, or are just there. */
  barrelsDrop?: boolean;
  waves?: readonly RushWave[];
  /** The tutorial: one lizard standing still in the street, and nothing else. Nobody attacks and the wave never ends. */
  practice?: boolean;
}

/** The tutorial's whole wave: just him. */
const PRACTICE_WAVES: readonly RushWave[] = [{ gap: 0, enemies: ["rusher"] }];

export class Rush {
  phase: RushPhase = "rush";
  wave = 0;
  hearts: number = RUSH.hearts;
  score = 0;
  kills = 0;
  enemies: RushEnemy[] = [];
  thrown: Thrown[] = [];
  aim: Vec2 = { x: 0.5, y: 0.5 };
  /** -1..1 how far the view's leaning, and 0..1 how far it's ducked. */
  lean = 0;
  duck = 0;
  onTarget = false;
  /** The bullet cam, while it's playing. The game holds still until it's over. */
  cam: RushCam | null = null;
  bossHits = 0;
  prompt: DodgePrompt | null = null;
  /** Seconds left of shooting time, and of the warning before he fires. */
  shootLeft = 0;
  chargeLeft = 0;
  bossHp: number = BOSS.hp;
  /** How Big Gat's moving, once the fight's on. */
  brain: BossBrain | null = null;
  barrels: Barrel[] = [];
  fires: FirePatch[] = [];
  /** The cannon's turn, while it's on. Nobody else moves or comes out until it's over. */
  cannon: Cannon | null = null;
  parkedCannons: ParkedCannon[] = [];
  whiskey: Whiskey | null = null;
  combo = 0;
  /** Shots left before a reload, how many it holds, and the reload going on, if any. */
  ammo: number;
  readonly maxAmmo: number;
  reload: RushReload | null = null;
  /** 0..1 how full dead-eye is, and seconds left of it running. */
  deadEye = 0;
  deadEyeLeft = 0;

  /** Whether this is the tutorial's practice lizard. */
  readonly practice: boolean;

  private readonly gun: GunStats;
  /** How much the aim helps, or null for not at all. */
  private readonly aimTuning: AimTuning | null;
  private readonly random: () => number;
  /** Its own stream, so who ducks doesn't change what else happens. */
  private readonly duckRandom: () => number;
  private readonly duckChance: number;
  private readonly pierceRandom: () => number;
  private readonly pierceChance: number;
  private readonly peek: boolean;
  private readonly barrelsDrop: boolean;
  private lastSpot = -1;
  /** Where the arm really is, before any assist, and how far the assist has moved the reticle from there. */
  private rawAim: Vec2 = { x: 0.5, y: 0.5 };
  private assistX = 0;
  private assistY = 0;
  /** What the aim's stuck to: where it is now, where your arm was when it grabbed, and which spot on it. */
  private stick: { ref: object; at: () => Vec2 | null; rawX: number; rawY: number; offX: number; offY: number } | null = null;
  private stickClock = 0;
  private ignoredRef: object | null = null;
  private ignoredUntil = 0;
  private assist = 0;
  private reloadsDone = 0;
  /** The shots still to come round for each zone, so you see them all before any repeats. */
  private readonly xrayBags: Partial<Record<HitZone, XrayKind[]>> = {};
  private readonly xrayRandom: () => number;
  private lastXray: XrayKind | null = null;
  private lastKillSeen = false;
  private killsLastStep = 0;
  private readonly camChance: number;
  private readonly dodgeSlowChance: number;
  private events: RushEvent[] = [];
  private readonly level: LevelSequencer;
  private spawned = 0;
  private untilSpawn = 0;
  private untilFire = 0;
  private slowFor = 0;
  private sinceCam: number = RUSH.camGapSec;
  private dodgesLeft = 0;
  private heartShown = false;
  private lastMove: DodgeMove | null = null;
  private nextId = 1;
  private readonly waveList: NonNullable<RushOptions["waves"]>;
  private readonly whiskeyEvery: number;
  private untilWhiskey: number;
  private readonly rollEvery: number;
  private untilRoll: number;
  private comboLeft = 0;
  private hitStopLeft = 0;
  private waveStats: RunStats = freshStats();
  private readonly runStats: RunStats = freshStats();

  constructor(options: RushOptions = {}) {
    this.random = makeRandom(options.seed ?? 1);
    this.duckRandom = makeRandom((options.seed ?? 1) ^ 0x5bd1e995);
    this.duckChance = options.duckChance ?? RUSH.duckChance;
    this.pierceRandom = makeRandom((options.seed ?? 1) ^ 0x2f6e2b1);
    this.pierceChance = options.pierceChance ?? RUSH.pierceChance;
    this.xrayRandom = makeRandom((options.seed ?? 1) ^ 0x3c6ef372);
    this.practice = options.practice ?? false;
    this.peek = this.practice ? false : options.peek ?? true;
    this.barrelsDrop = options.barrelsDrop ?? true;
    this.camChance = options.camChance ?? RUSH.camChance;
    this.dodgeSlowChance = options.dodgeSlowChance ?? RUSH.dodgeSlowChance;
    const aimLevel = options.aimLevel ?? "normal";
    this.aimTuning = aimLevel === "off" ? null : AIM_LEVELS[aimLevel];
    this.gun = options.gun ?? { ammo: RUSH.ammo, gapSec: RUSH.fireGapSec, auto: false, mag: false };
    this.maxAmmo = options.ammo ?? this.gun.ammo;
    this.ammo = this.maxAmmo;
    this.waveList = this.practice ? PRACTICE_WAVES : options.waves ?? RUSH_WAVES;
    this.whiskeyEvery = this.practice ? 0 : options.whiskeyEvery ?? RUSH.whiskeyEverySec;
    this.untilWhiskey = this.whiskeyEvery;
    this.rollEvery = this.practice ? 0 : options.rollEvery ?? RUSH.rollEverySec;
    this.untilRoll = this.rollEvery;
    this.level = new LevelSequencer(levelOne(this.waveList.length));
    this.placeBarrels();
    if (this.practice) {
      // He's already out, right in front of you, empty-handed and too scared to move.
      const lizard = this.makeEnemy("rusher");
      Object.assign(lizard, { x: 0, z: RUSH.practiceZ, hideX: 0, peekX: 0, endX: 0, stepTo: null, weapon: null, dodger: false, heading: 0 });
      this.enemies.push(lizard);
      this.spawned = 1;
      return;
    }
    this.events.push({ type: "wave", number: 1 });
  }

  get waves(): number {
    return this.waveList.length;
  }

  /** How fast the world's running: slower while an attack goes past, or during dead-eye. */
  get timeScale(): number {
    if (this.hitStopLeft > 0) return 0;
    if (this.deadEyeLeft > 0) return RUSH.deadEyeScale;
    return this.slowFor > 0 ? RUSH.slowScale : 1;
  }

  /** Everyone who's about to hit you, and hasn't yet. */
  get attackers(): RushEnemy[] {
    return this.enemies.filter((e) => e.swing >= 0 && e.swing < RUSH.strikeWindupSec);
  }

  /** The move on the screen right now, if there is one. */
  get wordMove(): DodgeMove | null {
    if (this.prompt) return this.prompt.move;
    const c = this.cannon;
    return c && (c.phase === "warn" || (c.phase === "roll" && c.outcome === null)) ? c.move : null;
  }

  /** Where the warning goes on screen, while it's showing: over the cannon. */
  get cannonAlertAt(): Vec2 | null {
    const c = this.cannon;
    return c?.phase === "warn" ? projectToScreen(c.x, 3.2, c.z, this.cameraX, this.cameraY) : null;
  }

  /** What each kill's score is multiplied by. */
  get multiplier(): number {
    return Math.min(RUSH.comboMax, 1 + Math.floor(this.combo / RUSH.comboPerStep));
  }

  get deadEyeReady(): boolean {
    return this.deadEye >= 1 && this.deadEyeLeft <= 0;
  }

  /** How far up the street the camera has ridden. Everything else is measured from there. */
  get railX(): number {
    return this.level.railX;
  }

  get railZ(): number {
    return this.level.railZ;
  }

  /** How far the camera has turned, in radians. */
  get railYaw(): number {
    return this.level.railYaw;
  }

  /** Seconds into the ride to the bank, for the head bob. Zero the rest of the time. */
  get travelT(): number {
    return this.phase === "travel" ? this.level.t : 0;
  }

  /** How far through the current stage of the boss's entrance this is, 0..1. */
  get stageProgress(): number {
    return this.level.progress;
  }

  /** Nothing hurts him while he's getting ready to fire, or firing. */
  get bossInvulnerable(): boolean {
    return this.phase === "bossCharge" || this.phase === "bossDodge";
  }

  get heartOpen(): boolean {
    return this.brain?.heartOpen ?? false;
  }

  /** Seconds into the staredown, while it's on. */
  get faceoffT(): number {
    return this.phase === "faceoff" ? this.level.t : 0;
  }

  get cameraX(): number {
    return this.lean * RUSH.leanReach;
  }

  get cameraY(): number {
    return PLANE.cameraY - this.duck * RUSH.duckDrop;
  }

  get over(): boolean {
    return this.phase === "won" || this.phase === "lost";
  }

  drainEvents(): RushEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Whether the gun's up. It's lowered for dodging time, so the arm can rest. */
  get canShoot(): boolean {
    return (this.phase === "rush" || this.phase === "clear" || this.phase === "bossShoot" || this.phase === "bossCharge") && !this.over;
  }

  /** Where the prompt's attack is now, and how far along. Null while it's only a word. */
  attackAt(prompt: DodgePrompt): { x: number; y: number; z: number } | null {
    const u = (prompt.t - RUSH.warnSec) / RUSH.attackSec;
    if (u < 0) return null;
    const [fx, fy, fz] = prompt.from;
    return {
      x: fx + (0 - fx) * u,
      y: fy + (PLANE.cameraY - fy) * u,
      z: fz + (0 - fz) * u,
    };
  }

  step(realDt: number, input: RushInput): void {
    if (this.over) return;
    this.sinceCam += realDt;
    if (this.cam) {
      this.cam.t += realDt;
      if (this.cam.t >= CAM_TOTAL_SEC) {
        this.cam = null;
        if (this.bossDefeated()) this.end(true);
      }
      return;
    }
    this.slowFor = Math.max(0, this.slowFor - realDt);
    this.hitStopLeft = Math.max(0, this.hitStopLeft - realDt);
    this.stepDeadEye(realDt);
    this.comboLeft -= realDt;
    if (this.comboLeft <= 0) this.combo = 0;
    const dt = realDt * this.timeScale;
    this.rawAim = input.aim;
    this.assist = this.aimTuning ? input.assist ?? 0 : 0;
    const aimed = this.assistedAim(input.aim, realDt, input.breakAim === true);
    this.aim = aimed;
    input = { ...input, aim: aimed };
    const follow = Math.min(1, RUSH.poseFollowPerSec * dt);
    // Once the ball's gone by, your view comes back to the middle by itself, ready for what's next.
    const leanTo = this.cannon?.phase === "recover" ? 0 : clamp(input.lean, -1, 1);
    this.lean += (leanTo - this.lean) * follow;
    this.duck += ((input.duck ? 1 : 0) - this.duck) * follow;

    switch (this.phase) {
      case "rush":
        this.stepCannon(dt);
        if (this.over) return;
        this.stepEnemies(dt);
        this.stepThrown(dt);
        if (this.over) return;
        this.stepFires(dt);
        this.stepFalling(dt);
        this.stepRolling(dt);
        this.stepWhiskey(dt);
        this.stepGun(realDt, input);
        if (this.cam) return;
        this.stepSpawns(dt);
        this.stepLastKill();
        if (this.waveDone()) this.finishWave();
        break;
      case "clear":
        this.stepThrown(dt);
        if (this.over) return;
        if (this.level.tick(dt)) this.enterStage(this.level.next());
        break;
      case "travel":
      case "arena":
      case "challenge":
        if (this.level.tick(dt)) this.enterStage(this.level.next());
        break;
      case "bossDrop":
        this.stepBossDrop(dt);
        break;
      case "faceoff":
        // OK skips the staredown, once there's been time to see who it is.
        if (this.level.tick(dt) || (input.fire && this.level.t > 0.4)) this.enterStage(this.level.next());
        break;
      case "bossShoot":
        this.brain?.step(dt);
        this.stepWhiskey(dt);
        this.stepGun(realDt, input);
        this.shootLeft -= dt;
        this.stepReveals();
        break;
      case "bossCharge":
        this.brain?.step(dt);
        this.stepGun(realDt, input);
        this.chargeLeft -= dt;
        if (this.chargeLeft <= 0) this.startDodging();
        break;
      case "bossDodge":
        this.brain?.step(dt);
        this.stepDodging(dt);
        break;
    }
  }

  /** The best thing near this spot on screen for the aim to settle on, if there is one. */
  private assistTarget(at: Vec2): AimTarget | null {
    const tune = this.aimTuning;
    if (!tune) return null;
    let best: AimTarget | null = null;
    let bestScore = 1;
    const aspect = PLANE.width / PLANE.height;
    const ignoring = this.stickClock < this.ignoredUntil ? this.ignoredRef : null;
    const consider = (ref: object, where: () => Vec2 | null, kind: { reach: number; pull: number }, favour = 1, thrown = false) => {
      if (ref === ignoring) return;
      const p = where();
      if (!p) return;
      const d = Math.hypot((p.x - at.x) * aspect, p.y - at.y);
      const reach = kind.reach * Math.max(0.6, this.assist);
      const score = (d / reach) * favour;
      if (d >= reach || score >= bestScore) return;
      bestScore = score;
      best = { ref, where, x: p.x, y: p.y, d, reach, pull: kind.pull * this.assist, thrown };
    };
    const seen = (x: number, y: number, z: number) => projectToScreen(x, y, z, this.cameraX, this.cameraY);
    for (const t of this.thrown) {
      if (t.z < -0.5) consider(t, () => (this.thrown.includes(t) && t.z < -0.5 ? seen(t.x, t.y, t.z) : null), tune.thrown, RUSH.assistThrownFavour, true);
    }
    const w = this.whiskey;
    if (w) consider(w, () => (this.whiskey === w ? seen(w.x, w.y, w.z) : null), tune.whiskey);
    for (const e of this.enemies) {
      if (e.kind === "boss") {
        const heart = () => (this.enemies.includes(e) && this.heartOpen && !this.bossInvulnerable ? seen(e.x, e.y + BOSS.heartY, e.z) : null);
        consider(e, heart, tune.heart);
        continue;
      }
      const scale = e.kind === "fat" ? RUSH.fatScale : 1;
      consider(e, () => (this.enemies.includes(e) ? seen(e.x, e.y + 1.35 * scale * (e.ducking > 0 ? RUSH.duckHeight : 1), e.z) : null), tune.enemy);
    }
    for (const b of this.barrels) {
      consider(b, () => (this.barrels.includes(b) ? seen(b.x, b.y + RUSH.barrelHeight / 2, b.z) : null), tune.barrel);
    }
    return best;
  }

  /**
   * What dead-eye locks onto: anything flying at you first, then whoever's nearest and in the frame, in the
   * head. Above the hat brim and over the top of a shield, so every press does the most it can.
   */
  private lockTarget(): Vec2 | null {
    const onScreen = (x: number, y: number, z: number): Vec2 | null => {
      const p = projectToScreen(x, y, z, this.cameraX, this.cameraY);
      return p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? p : null;
    };
    for (const t of [...this.thrown].sort((a, b) => b.z - a.z)) {
      const p = t.z < -0.5 ? onScreen(t.x, t.y, t.z) : null;
      if (p) return p;
    }
    for (const e of [...this.enemies].sort((a, b) => b.z - a.z)) {
      if (e.kind === "boss") {
        const p = this.heartOpen && !this.bossInvulnerable ? onScreen(e.x, e.y + BOSS.heartY, e.z) : null;
        if (p) return p;
        continue;
      }
      const scale = e.kind === "fat" ? RUSH.fatScale : 1;
      const p = onScreen(e.x, e.y + RUSH.lockHeadY * scale * (e.ducking > 0 ? RUSH.duckHeight : 1), e.z);
      if (p) return p;
    }
    return null;
  }

  /** Draws the reticle onto whatever it's near, easing so it never jumps, and carries it along as that moves. */
  private assistedAim(raw: Vec2, realDt: number, breakAim: boolean): Vec2 {
    let toX = 0;
    let toY = 0;
    this.stickClock += realDt;
    if (this.deadEyeLeft > 0 && this.canShoot) {
      // Dead-eye: a hard lock. Your arm doesn't matter, you only have to keep pressing OK.
      const lock = this.lockTarget();
      if (lock) {
        const snap = Math.min(1, RUSH.lockPerSec * realDt);
        this.assistX += (lock.x - raw.x - this.assistX) * snap;
        this.assistY += (lock.y - raw.y - this.assistY) * snap;
        return { x: raw.x + this.assistX, y: raw.y + this.assistY };
      }
    }
    const live = this.assist > 0 && this.canShoot && raw.y < RUSH.reloadFromY;
    if (!live) this.stick = null;
    if (live) {
      // Something flying at you always takes the aim away from whatever it was on.
      const fresh = this.assistTarget(raw);
      if (fresh && (!this.stick || (fresh.thrown && fresh.ref !== this.stick.ref))) {
        this.stick = {
          ref: fresh.ref,
          at: fresh.where,
          rawX: raw.x,
          rawY: raw.y,
          offX: (raw.x - fresh.x) * (1 - fresh.pull),
          offY: (raw.y - fresh.y) * (1 - fresh.pull),
        };
      }
    }
    const stuck = this.stick;
    if (stuck) {
      const p = stuck.at();
      const movedX = raw.x - stuck.rawX;
      const movedY = raw.y - stuck.rawY;
      const moved = Math.hypot(movedX * (PLANE.width / PLANE.height), movedY);
      if (!p || breakAim || moved > (this.aimTuning?.breakAt ?? 0)) {
        // Pulled free on purpose: it won't grab straight back.
        if (p) {
          this.ignoredRef = stuck.ref;
          this.ignoredUntil = this.stickClock + RUSH.assistIgnoreSec;
        }
        this.stick = null;
      } else {
        const friction = this.aimTuning?.friction ?? 1;
        toX = p.x + stuck.offX + movedX * friction - raw.x;
        toY = p.y + stuck.offY + movedY * friction - raw.y;
      }
    }
    const k = Math.min(1, (this.aimTuning?.perSec ?? AIM_LEVELS.normal.perSec) * realDt);
    this.assistX += (toX - this.assistX) * k;
    this.assistY += (toY - this.assistY) * k;
    return { x: raw.x + this.assistX, y: raw.y + this.assistY };
  }

  /** A shot that's near enough goes where it was meant to: always for a bottle, otherwise only if it'd miss. */
  private lockedShot(aim: Vec2): Vec2 {
    if (this.deadEyeLeft > 0) return this.lockTarget() ?? aim;
    if (this.assist <= 0) return aim;
    const target = this.assistTarget(aim);
    if (!target || target.d > target.reach * (this.aimTuning?.lockAt ?? 0)) return aim;
    if (target.thrown) return { x: target.x, y: target.y };
    const onSomething = this.thrownUnderAim(aim) !== null || this.whiskeyUnderAim(aim)
      || this.enemyUnderAim(aim) !== null || this.barrelUnderAim(aim) !== null;
    return onSomething ? aim : { x: target.x, y: target.y };
  }

  private bossDefeated(): boolean {
    return this.bossHp <= 0;
  }

  /** Late in your turn he rears back and shows you where to shoot. Once he covers it again, he opens up. */
  private stepReveals(): void {
    if (!this.heartShown) {
      if (this.shootLeft > BOSS.revealSec || !this.brain?.reveal()) return;
      this.heartShown = true;
      this.events.push({ type: "bossReveal" });
    } else if (this.brain?.move !== "reveal" && !this.cam && this.phase === "bossShoot") {
      this.startCharging();
    }
  }

  private between(a: number, b: number): number {
    return a + this.random() * (b - a);
  }

  private get allOut(): boolean {
    return this.spawned >= this.waveList[this.wave]!.enemies.length;
  }

  private waveDone(): boolean {
    // The tutorial isn't a wave: whoever's running it decides when it's over.
    if (this.practice) return false;
    // Lets the last one finish going down before the tally comes up.
    return this.allOut && this.enemies.length === 0 && this.thrown.length === 0 && !this.cannon && this.slowFor <= 0;
  }

  /** The last of a wave goes down in slow motion, however they went. Someone who got past you doesn't count. */
  private stepLastKill(): void {
    const killed = this.kills > this.killsLastStep;
    this.killsLastStep = this.kills;
    if (this.lastKillSeen || !killed || !this.allOut || this.enemies.length > 0 || this.cannon) return;
    this.lastKillSeen = true;
    this.slowFor = RUSH.lastKillSlowSec;
    this.events.push({ type: "lastKill" });
  }

  /** The next x-ray for this zone: every one of them comes round before any repeats. */
  private pickXray(zone: HitZone): XrayKind {
    let bag = this.xrayBags[zone];
    if (!bag || bag.length === 0) {
      bag = [...XRAYS_BY_ZONE[zone]];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.xrayRandom() * (i + 1));
        [bag[i], bag[j]] = [bag[j]!, bag[i]!];
      }
      if (bag.length > 1 && bag[bag.length - 1] === this.lastXray) bag.unshift(bag.pop()!);
      this.xrayBags[zone] = bag;
    }
    const pick = bag.pop()!;
    this.lastXray = pick;
    return pick;
  }

  private stepSpawns(dt: number): void {
    const wave = this.waveList[this.wave]!;
    if (this.spawned >= wave.enemies.length || this.cannon) return;
    this.untilSpawn -= dt;
    if (this.untilSpawn > 0) return;
    const beat = wave.enemies[this.spawned]!;
    if (typeof beat === "number") {
      this.untilSpawn = beat;
      this.spawned += 1;
    } else if (beat === "cannon") {
      if (this.startCannon()) this.spawned += 1;
    } else if (this.enemies.length < (wave.cap ?? Infinity)) {
      this.enemies.push(this.makeEnemy(beat));
      this.spawned += 1;
      this.untilSpawn = wave.gap;
    }
  }

  /** Lizards start wheeling it out, once there's nothing in the air and nobody mid-swing. */
  private startCannon(): boolean {
    if (this.thrown.length > 0 || this.enemies.some((e) => e.swing >= 0)) return false;
    const side = this.random() < 0.5 ? -1 : 1;
    for (const enemy of this.enemies) enemy.windup = 0;
    const x = side * RUSH.cannonFromX;
    const reach = side * RUSH.ballReachX;
    this.cannon = {
      phase: "rollout",
      t: 0,
      side,
      x,
      z: RUSH.cannonFromZ,
      yaw: Math.atan2(reach - side * RUSH.cannonX, -RUSH.cannonZ),
      // Away from the cannon, so the ball goes by on the side it came from.
      move: side < 0 ? "right" : "left",
      ball: null,
      stuck: [],
      outcome: null,
    };
    for (const crew of [-1, 1]) {
      const enemy = this.makeEnemy("rusher");
      enemy.peeking = 0;
      enemy.peekLeft0 = 0;
      enemy.stepTo = null;
      enemy.weapon = null;
      enemy.dodger = false;
      enemy.crew = crew;
      enemy.endX = clamp(side * RUSH.cannonX * 0.22, -RUSH.closeInX, RUSH.closeInX);
      this.placeCrew(enemy, this.cannon);
      this.enemies.push(enemy);
    }
    this.events.push({ type: "cannonRollout", side });
    return true;
  }

  /** One each side, shoving at the wheels. */
  private placeCrew(enemy: RushEnemy, cannon: Cannon): void {
    enemy.x = cannon.x + enemy.crew * 1.15;
    enemy.z = cannon.z - 1.15;
    enemy.heading = cannon.yaw;
  }

  private stepCannon(dt: number): void {
    const c = this.cannon;
    if (!c) return;
    c.t += dt;
    switch (c.phase) {
      case "rollout": {
        const u = clamp(c.t / RUSH.cannonRolloutSec, 0, 1);
        const eased = u * (2 - u);
        c.x = c.side * (RUSH.cannonFromX + (RUSH.cannonX - RUSH.cannonFromX) * eased);
        c.z = RUSH.cannonFromZ + (RUSH.cannonZ - RUSH.cannonFromZ) * eased;
        for (const enemy of this.enemies) if (enemy.crew !== 0) this.placeCrew(enemy, c);
        if (u >= 1) {
          c.phase = "warn";
          c.t = 0;
          this.events.push({ type: "cannonWarn", move: c.move });
        }
        break;
      }
      case "warn":
        if (c.t >= RUSH.cannonWarnSec) {
          c.phase = "roll";
          c.t = 0;
          const fromZ = c.z + 2;
          c.ball = { x: c.x, z: fromZ, turned: 0, fromZ };
          this.events.push({ type: "cannonFired", x: c.x, z: c.z, yaw: c.yaw });
        }
        break;
      case "roll":
        this.stepBall(c, dt);
        break;
      case "recover":
        if (c.t >= RUSH.cannonRecoverSec) this.finishCannon(c);
        break;
    }
  }

  private stepBall(c: Cannon, dt: number): void {
    const ball = c.ball;
    if (!ball) return;
    const step = RUSH.ballSpeed * dt;
    ball.z += step;
    ball.turned += step / RUSH.ballRadius;
    const u = clamp((ball.z - ball.fromZ) / -ball.fromZ, 0, 1);
    ball.x = c.x + (c.side * RUSH.ballReachX - c.x) * u;
    // Whoever's in the way ends up on it.
    const reach = RUSH.ballRadius + RUSH.ballTouch;
    for (const enemy of [...this.enemies]) {
      if (enemy.kind === "boss" || enemy.crew !== 0) continue;
      if (Math.abs(enemy.x - ball.x) > reach || Math.abs(enemy.z - ball.z) > 1.1) continue;
      this.remove(enemy);
      c.stuck.push({ outfit: enemy.outfit, angle: -ball.turned + (this.random() - 0.5) * 0.5 });
      this.addKill(enemy.kind === "golden" ? RUSH.goldenPoints : RUSH.tramplePoints, { x: enemy.x, y: 3, z: enemy.z }, "TRAMPLED!");
      this.events.push({ type: "trampled", enemy, x: enemy.x, z: enemy.z });
    }
    for (const barrel of [...this.barrels]) {
      if (this.barrels.includes(barrel) && Math.abs(barrel.x - ball.x) < reach && Math.abs(barrel.z - ball.z) < 1.1) this.explodeBarrel(barrel);
    }
    if (c.outcome === null && ball.z >= RUSH.ballSlowFromZ && ball.z - step < RUSH.ballSlowFromZ && this.isPosed(c.move)) {
      // Already out of the way: it goes by in slow motion, so you can see who's on it.
      this.slowFor = RUSH.slowSec;
    }
    if (c.outcome === null && ball.z >= RUSH.ballHitZ) {
      const dodged = this.isPosed(c.move);
      c.outcome = dodged ? "dodged" : "hit";
      if (dodged) {
        this.addPoints(RUSH.cannonDodgePoints, { x: ball.x, y: 3, z: RUSH.ballHitZ - 3 }, "DODGED!");
        this.events.push({ type: "dodged", slow: this.slowFor > 0 });
      } else {
        this.hurt();
        if (this.over) return;
      }
    }
    if (ball.z >= RUSH.ballEndZ) {
      c.phase = "recover";
      c.t = 0;
      c.ball = null;
    }
  }

  /** It's over: the crew pull out their weapons and come for you, and everyone else gets going again. */
  private finishCannon(c: Cannon): void {
    this.parkedCannons.push({ x: c.x, z: c.z, yaw: c.yaw });
    for (const enemy of this.enemies) {
      if (enemy.crew === 0) continue;
      enemy.crew = 0;
      enemy.weapon = (["machete", "axe", "club"] as const)[Math.floor(this.random() * 3)]!;
    }
    this.cannon = null;
    this.events.push({ type: "cannonDone" });
  }

  private makeEnemy(kind: EnemyKind): RushEnemy {
    const side = this.random() < 0.5 ? -1 : 1;
    // Throwers and the golden goon keep to the sides of the street.
    const lane = kind === "boss" ? 0
      : kind === "golden" || kind === "thrower" ? side * this.between(2.5, RUSH.laneHalfWidth)
      : this.between(-RUSH.laneHalfWidth, RUSH.laneHalfWidth);
    const spot = kind !== "boss" && this.peek ? this.pickSpot(kind) : null;
    const startZ = kind === "boss" ? RUSH.bossZ : spot?.z ?? RUSH.spawnZ;
    // A goon out of a right-hand alley stays on the right-hand side of the street.
    const stepTo = spot ? Math.sign(spot.hide) * Math.abs(lane) : null;
    const x = spot ? spot.hide : lane;
    const street = stepTo ?? lane;
    const peeking = spot ? RUSH.peekSec * this.between(0.75, 1.25) : 0;
    return {
      id: this.nextId++,
      kind,
      x,
      y: 0,
      z: startZ,
      stopZ: kind === "thrower" ? (spot ? Math.min(-11, startZ + this.between(0.5, 2.5)) : this.between(-24, -13)) : 0,
      peeking,
      peekLeft0: peeking,
      hideX: x,
      peekX: spot?.peek ?? x,
      stepTo,
      endX: clamp(street * 0.22, -RUSH.closeInX, RUSH.closeInX),
      heading: 0,
      outfit: kind === "boss" ? 3
        : kind === "golden" ? GOLDEN_OUTFIT
        : kind === "thrower" ? FLAME_OUTFIT
        : Math.floor(this.random() * 4),
      throwIn: this.between(RUSH.throwEveryMin * 0.5, RUSH.throwEveryMax * 0.6),
      windup: 0,
      hp: kind === "fat" ? RUSH.fatHits : 1,
      hatOff: false,
      grabbing: 0,
      burning: 0,
      burnX: 0,
      burnZ: 0,
      burnTurn: 0,
      burnHeading: 1,
      weapon: kind === "rusher" ? (["machete", "axe", "club"] as const)[Math.floor(this.random() * 3)]! : null,
      swing: -1,
      dodger: kind === "rusher" && this.duckRandom() < this.duckChance,
      ducking: 0,
      shieldHp: kind === "shield" ? RUSH.shieldHits : 0,
      raising: 0,
      crew: 0,
    };
  }

  /** Somewhere to come out from that isn't where the last one did. Throwers like the near ones. */
  private pickSpot(kind: EnemyKind): (typeof PEEK_SPOTS)[number] {
    const nearOk = kind === "thrower";
    const options = PEEK_SPOTS.map((_, i) => i).filter((i) => i !== this.lastSpot && (nearOk || !PEEK_SPOTS[i]!.near));
    this.lastSpot = options[Math.floor(this.random() * options.length)]!;
    return PEEK_SPOTS[this.lastSpot]!;
  }

  /** Coming out of hiding: a lean round the corner, then a few quick steps out into the street. */
  private stepEntering(enemy: RushEnemy, dt: number): boolean {
    if (enemy.peeking > 0) {
      const sinceStart = enemy.peekLeft0 - enemy.peeking;
      const u = clamp(sinceStart / RUSH.peekLeanSec, 0, 1);
      enemy.x = enemy.hideX + (enemy.peekX - enemy.hideX) * (u * u * (3 - 2 * u));
      // Looks right at you.
      enemy.heading = Math.atan2(-enemy.x, -enemy.z);
      enemy.peeking = Math.max(0, enemy.peeking - dt);
      return true;
    }
    if (enemy.stepTo === null) return false;
    const gap = enemy.stepTo - enemy.x;
    const step = RUSH.stepOutSpeed * dt;
    enemy.heading = Math.sign(gap) * 1.25;
    if (Math.abs(gap) > step) {
      enemy.x += Math.sign(gap) * step;
      return true;
    }
    enemy.x = enemy.stepTo;
    enemy.stepTo = null;
    enemy.heading = 0;
    // Out in the open now: time to get that shield up.
    if (enemy.shieldHp > 0) enemy.raising = RUSH.shieldRaiseSec;
    return false;
  }

  /** Heads straight for where they mean to reach you, so everyone stays in the frame as they close in. */
  private closeIn(enemy: RushEnemy, speed: number, endZ: number, dt: number): void {
    const left = endZ - enemy.z;
    if (left > 0.05) {
      const dx = ((enemy.endX - enemy.x) / left) * speed;
      enemy.x += dx * dt;
      enemy.heading = Math.atan2(dx, speed);
    }
    enemy.z += speed * dt;
  }

  private stepEnemies(dt: number): void {
    // The practice lizard just stands there and takes it.
    if (this.practice) return;
    for (const enemy of [...this.enemies]) {
      if (enemy.burning > 0) {
        this.stepBurning(enemy, dt);
        continue;
      }
      // Everyone stops and stares while the cannon's going.
      if (this.cannon) continue;
      if (enemy.grabbing > 0) {
        enemy.grabbing = Math.max(0, enemy.grabbing - dt);
        continue;
      }
      if (this.stepEntering(enemy, dt)) continue;
      if (enemy.raising > 0) {
        enemy.raising = Math.max(0, enemy.raising - dt);
        continue;
      }
      if (enemy.kind === "golden") {
        this.closeIn(enemy, RUSH.goldenSpeed, RUSH.goldenPastZ, dt);
        this.steerAround(enemy, dt);
        if (enemy.z >= RUSH.goldenPastZ) {
          this.remove(enemy);
          this.events.push({ type: "goldenEscaped" });
        }
      } else if (enemy.kind === "rusher" || enemy.kind === "shield" || enemy.kind === "fat") {
        if (enemy.swing >= 0) {
          // Stopped in front of you, winding up. There's still time to shoot them before it lands.
          const before = enemy.swing;
          enemy.swing += dt;
          if (before < RUSH.strikeWindupSec && enemy.swing >= RUSH.strikeWindupSec) {
            this.hurt();
            if (this.over) return;
          }
          if (enemy.swing >= RUSH.strikeWindupSec + RUSH.strikeRecoverSec) {
            this.remove(enemy);
            this.events.push({ type: "strikeDone", x: enemy.x, z: enemy.z });
          }
          continue;
        }
        const speed = this.runSpeed(enemy);
        this.closeIn(enemy, speed, RUSH.strikeZ, dt);
        this.steerAround(enemy, dt);
        enemy.ducking = Math.max(0, enemy.ducking - dt);
        if (enemy.z >= RUSH.strikeZ) {
          enemy.z = RUSH.strikeZ;
          enemy.ducking = 0;
          enemy.swing = 0;
          enemy.heading = Math.atan2(-enemy.x, -enemy.z);
          this.events.push({ type: "strikeWindup", enemy });
        }
      } else if (enemy.kind === "thrower") {
        // They run up to their spot once, plant their feet, and just keep throwing.
        const step = RUSH.comeOutSpeed * dt;
        if (enemy.stopZ - enemy.z > step) enemy.z += step;
        else {
          enemy.z = enemy.stopZ;
          this.stepThrowing(enemy, dt);
        }
      }
    }
  }

  private runSpeed(enemy: RushEnemy): number {
    const base = enemy.kind === "fat" ? RUSH.fatSpeed
      : enemy.kind === "shield" && enemy.shieldHp > 0 ? RUSH.shieldSpeed
      : RUSH.rushSpeed;
    return enemy.ducking > 0 ? base * RUSH.duckSpeed : base;
  }

  /** Burning goons and anyone running through burning ground. */
  private stepFires(dt: number): void {
    for (const fire of this.fires) fire.left -= dt;
    this.fires = this.fires.filter((f) => f.left > 0);
    for (const fire of this.fires) {
      for (const enemy of this.enemies) {
        if (enemy.kind === "boss" || enemy.burning > 0) continue;
        if (Math.hypot(enemy.x - fire.x, enemy.z - fire.z) < fire.radius) this.ignite(enemy);
      }
    }
  }

  private lightFire(x: number, z: number, radius: number): void {
    this.fires.push({ id: this.nextId++, x, z, radius, left: RUSH.firePatchSec });
  }

  /**
   * On fire: running blind up and down the street, screaming, and setting light to anyone they touch.
   * Their line weaves a bit, but nobody runs sideways.
   */
  private stepBurning(enemy: RushEnemy, dt: number): void {
    enemy.burning -= dt;
    enemy.burnTurn -= dt;
    if (enemy.z >= RUSH.burnTurnZ) enemy.burnHeading = -1;
    else if (enemy.z <= RUSH.spawnZ + 2) enemy.burnHeading = 1;
    if (enemy.burnTurn <= 0) {
      enemy.burnTurn = RUSH.burnTurnSec * (0.6 + this.random());
      const a = (this.random() * 2 - 1) * RUSH.burnWeave;
      enemy.burnX = Math.sin(a);
      enemy.burnZ = Math.cos(a) * enemy.burnHeading;
    }
    // Keeps running the way it's meant to, even between turns.
    enemy.burnZ = Math.abs(enemy.burnZ) * enemy.burnHeading;
    enemy.x = clamp(enemy.x + enemy.burnX * RUSH.burnSpeed * dt, -RUSH.laneHalfWidth, RUSH.laneHalfWidth);
    enemy.z = clamp(enemy.z + enemy.burnZ * RUSH.burnSpeed * dt, RUSH.spawnZ, RUSH.burnTurnZ);
    for (const other of this.enemies) {
      if (other === enemy || other.burning > 0 || other.kind === "boss") continue;
      if (Math.hypot(other.x - enemy.x, other.z - enemy.z) < RUSH.burnTouch) this.ignite(other);
    }
    if (enemy.burning <= 0) {
      this.remove(enemy);
      this.addKill(RUSH.burnPoints, { x: enemy.x, y: 2.6, z: enemy.z }, "TOAST!");
      this.events.push({ type: "burnedDown", enemy });
    }
  }

  private ignite(enemy: RushEnemy): void {
    enemy.burning = RUSH.burnSec;
    enemy.burnTurn = 0;
    enemy.burnHeading = 1;
    enemy.windup = 0;
    enemy.grabbing = 0;
    enemy.ducking = 0;
    enemy.peeking = 0;
    enemy.stepTo = null;
    enemy.raising = 0;
    enemy.crew = 0;
    enemy.swing = -1;
    enemy.y = 0;
    this.events.push({ type: "ignited", enemy });
  }

  /** The run so far, for the end screen. */
  get summary(): RunStats & { grade: Grade; accuracy: number } {
    const s = this.runStats;
    return { ...s, grade: gradeFor(s), accuracy: s.shots > 0 ? s.hits / s.shots : 0 };
  }

  private count(change: (stats: RunStats) => void): void {
    change(this.waveStats);
    change(this.runStats);
  }

  /** Scores a kill, with the combo's multiplier, and builds the combo and dead-eye. */
  private addKill(points: number, at: { x: number; y: number; z: number } = { x: 0, y: 0, z: -20 }, label = ""): void {
    this.kills += 1;
    this.addPoints(points, at, label);
    this.combo += 1;
    const combo = this.combo;
    this.count((s) => {
      s.kills += 1;
      s.bestCombo = Math.max(s.bestCombo, combo);
    });
    this.comboLeft = RUSH.comboSec;
    if (this.combo % RUSH.comboPerStep === 0) {
      this.events.push({ type: "combo", combo: this.combo, multiplier: this.multiplier });
    }
    if (this.deadEyeLeft <= 0 && this.deadEye < 1) {
      this.deadEye = Math.min(1, this.deadEye + 1 / RUSH.deadEyeKills);
      if (this.deadEye >= 1) this.events.push({ type: "deadEyeReady" });
    }
  }

  private addPoints(points: number, at: { x: number; y: number; z: number }, label: string): void {
    const earned = points * this.multiplier;
    this.score += earned;
    if (earned > 0) this.events.push({ type: "scored", points: earned, label, x: at.x, y: at.y, z: at.z });
  }

  private stepDeadEye(realDt: number): void {
    if (this.deadEyeLeft > 0) {
      this.deadEyeLeft -= realDt;
      this.deadEye = Math.max(0, this.deadEyeLeft / RUSH.deadEyeSec);
      if (this.deadEyeLeft <= 0) {
        this.deadEyeLeft = 0;
        this.deadEye = 0;
        this.events.push({ type: "deadEyeEnd" });
      }
    } else if (this.deadEye >= 1 && this.canShoot && this.lockTarget() !== null) {
      // Goes off by itself once it's full and there's someone to use it on. A reload's no reason to waste it.
      this.deadEyeLeft = RUSH.deadEyeSec;
      this.reload = null;
      this.ammo = this.maxAmmo;
      this.events.push({ type: "deadEyeStart" });
    }
  }

  /** A wave's barrels come down out of the sky, one after another. */
  private placeBarrels(): void {
    this.barrels = (this.waveList[this.wave]?.barrels ?? []).map((b, i) => ({
      id: this.nextId++,
      x: b.x,
      z: b.z,
      roll: 0,
      turned: 0,
      y: this.barrelsDrop ? RUSH.barrelDropY + i * RUSH.barrelDropGap : 0,
      vy: 0,
    }));
  }

  private stepFalling(dt: number): void {
    for (const barrel of this.barrels) {
      if (barrel.y <= 0 && barrel.vy === 0) continue;
      barrel.vy -= RUSH.barrelGravity * dt;
      barrel.y += barrel.vy * dt;
      if (barrel.y > 0) continue;
      barrel.y = 0;
      const hard = barrel.vy < -6;
      this.events.push({ type: "barrelLanded", x: barrel.x, z: barrel.z, hard });
      // One little bounce, then it stays.
      barrel.vy = hard ? -barrel.vy * 0.22 : 0;
    }
  }

  private explodeBarrel(barrel: Barrel): void {
    this.barrels = this.barrels.filter((b) => b !== barrel);
    const killed: RushEnemy[] = [];
    for (const enemy of [...this.enemies]) {
      if (enemy.kind === "boss") continue;
      if (Math.hypot(enemy.x - barrel.x, enemy.z - barrel.z) > RUSH.barrelRadius) continue;
      this.remove(enemy);
      this.addKill(enemy.kind === "golden" ? RUSH.goldenPoints : RUSH.barrelPoints, { x: enemy.x, y: 2.6, z: enemy.z }, "BOOM!");
      killed.push(enemy);
    }
    this.events.push({ type: "barrel", x: barrel.x, y: barrel.y, z: barrel.z, killed });
    this.lightFire(barrel.x, barrel.z, RUSH.firePatchRadius * 1.4);
    // A barrel going up sets off any others close enough.
    for (const other of [...this.barrels]) {
      if (this.barrels.includes(other) && Math.hypot(other.x - barrel.x, other.z - barrel.z) <= RUSH.barrelRadius) {
        this.explodeBarrel(other);
      }
    }
  }

  private stepWhiskey(dt: number): void {
    if (this.whiskey) {
      const w = this.whiskey;
      w.t += dt / RUSH.whiskeySec;
      const u = clamp((w.t * RUSH.whiskeySec) / RUSH.whiskeyFlightSec, 0, 1);
      w.x = w.fromX + (w.landX - w.fromX) * u;
      w.y = RUSH.whiskeyRestY + (1 - u) * 1.3 + Math.sin(u * Math.PI) * 2.6;
      if (u >= 1) w.y = RUSH.whiskeyRestY;
      if (w.t >= 1) this.whiskey = null;
      return;
    }
    if (this.whiskeyEvery <= 0 || this.hearts >= RUSH.hearts) return;
    this.untilWhiskey -= dt;
    if (this.untilWhiskey > 0) return;
    this.untilWhiskey = this.whiskeyEvery;
    const dir = this.random() < 0.5 ? -1 : 1;
    const fromX = -dir * (RUSH.laneHalfWidth + 1);
    this.whiskey = { x: fromX, y: RUSH.whiskeyRestY + 1.3, z: -11, t: 0, fromX, landX: (this.random() * 2 - 1) * RUSH.whiskeyLandX };
    this.events.push({ type: "whiskey" });
  }

  private whiskeyUnderAim(aim: Vec2): boolean {
    const w = this.whiskey;
    if (!w) return false;
    const point = aimAtDepth(aim, -w.z, this.cameraX, this.cameraY);
    return Math.hypot(point.x - w.x, point.y - w.y) <= (RUSH.thrownReticle * -w.z) / PLANE.distance;
  }

  private barrelUnderAim(aim: Vec2): Barrel | null {
    let best: Barrel | null = null;
    for (const barrel of this.barrels) {
      const distance = -barrel.z;
      const point = aimAtDepth(aim, distance, this.cameraX, this.cameraY);
      const radius = (RUSH.reticle * distance) / PLANE.distance;
      const dx = Math.max(0, Math.abs(point.x - barrel.x) - RUSH.barrelHalfWidth);
      const dy = Math.max(0, point.y - barrel.y - RUSH.barrelHeight, barrel.y - point.y);
      if (Math.hypot(dx, dy) > radius) continue;
      if (!best || barrel.z > best.z) best = barrel;
    }
    return best;
  }

  /** Goons heading for a barrel go around it, whichever way is shorter, and never through it. */
  private steerAround(enemy: RushEnemy, dt: number): void {
    let push = 0;
    const standing = [...this.barrels.filter((b) => b.roll === 0 && b.y <= 2), ...this.parkedCannons];
    for (const barrel of standing) {
      const ahead = barrel.z - enemy.z;
      const dx = enemy.x - barrel.x;
      if (ahead < -RUSH.avoidRadius || ahead > RUSH.avoidAhead || Math.abs(dx) >= RUSH.avoidRadius) continue;
      // Past the middle of the barrel's side, the way out is the way they're already going.
      const side = dx === 0 ? (barrel.x >= 0 ? -1 : 1) : Math.sign(dx);
      // Stays on the street: if there's no room that way, it goes the other.
      const room = Math.abs(barrel.x + side * RUSH.avoidRadius) <= RUSH.laneHalfWidth + 1;
      push += (room ? side : -side) * (1 - Math.abs(dx) / RUSH.avoidRadius + 0.3);
    }
    if (push !== 0) {
      enemy.x = clamp(enemy.x + Math.sign(push) * RUSH.avoidSpeed * dt, -RUSH.laneHalfWidth - 1, RUSH.laneHalfWidth + 1);
    }
  }

  /** Barrels rolling out of the saloons, across the street. */
  private stepRolling(dt: number): void {
    if (this.rollEvery > 0 && !this.cannon) {
      this.untilRoll -= dt;
      if (this.untilRoll <= 0) {
        this.untilRoll = this.rollEvery;
        const from = this.random() < 0.5 ? -1 : 1;
        const barrel: Barrel = {
          id: this.nextId++,
          x: from * RUSH.rollSideX,
          z: this.between(-26, -12),
          roll: -from * RUSH.rollSpeed,
          turned: 0,
          y: 0,
          vy: 0,
        };
        this.barrels.push(barrel);
        this.events.push({ type: "barrelRolled", barrel });
      }
    }
    for (const barrel of [...this.barrels]) {
      if (barrel.roll === 0 || !this.barrels.includes(barrel)) continue;
      barrel.x += barrel.roll * dt;
      barrel.turned += (barrel.roll * dt) / RUSH.barrelHalfWidth;
      if (Math.abs(barrel.x) > RUSH.rollEndX) {
        this.barrels = this.barrels.filter((b) => b !== barrel);
        continue;
      }
      // Rolling into someone sets it off, and that's their problem.
      const hit = this.enemies.some((e) => e.kind !== "boss" && e.burning <= 0
        && Math.hypot(e.x - barrel.x, e.z - barrel.z) < RUSH.rollTouch);
      if (hit) this.explodeBarrel(barrel);
    }
  }

  private stepThrowing(enemy: RushEnemy, dt: number): void {
    if (enemy.kind !== "thrower") return;
    if (enemy.windup > 0) {
      enemy.windup -= dt;
      if (enemy.windup <= 0) {
        enemy.windup = 0;
        this.launch(enemy);
      }
      return;
    }
    enemy.throwIn -= dt;
    if (enemy.throwIn > 0) return;
    const winding = this.enemies.filter((e) => e.windup > 0).length;
    // Tries again in a moment if there's no room for another right now.
    if (this.thrown.length + winding >= RUSH.maxThrown) {
      enemy.throwIn = 0.3;
      return;
    }
    enemy.windup = RUSH.windupSec;
  }

  private launch(enemy: RushEnemy): void {
    const from = { x: enemy.x + 0.45, y: 2, z: enemy.z + 0.4 };
    const t = RUSH.throwSec;
    const thrown: Thrown = {
      id: this.nextId++,
      ...from,
      vx: (this.cameraX - from.x) / t,
      vy: (RUSH.throwLandY - from.y + 0.5 * RUSH.throwGravity * t * t) / t,
      vz: (RUSH.throwLandZ - from.z) / t,
    };
    this.thrown.push(thrown);
    enemy.throwIn = this.between(RUSH.throwEveryMin, RUSH.throwEveryMax);
    this.events.push({ type: "threw", thrown });
  }

  private stepThrown(dt: number): void {
    for (const thrown of [...this.thrown]) {
      thrown.x += thrown.vx * dt;
      thrown.vy -= RUSH.throwGravity * dt;
      thrown.y += thrown.vy * dt;
      thrown.z += thrown.vz * dt;
      if (thrown.z < RUSH.throwLandZ) continue;
      this.thrown = this.thrown.filter((t) => t !== thrown);
      this.events.push({ type: "smashed", x: thrown.x, y: thrown.y, z: thrown.z });
      this.hurt();
      if (this.over) return;
    }
  }

  private hurt(): void {
    this.hearts -= 1;
    this.combo = 0;
    this.count((s) => (s.heartsLost += 1));
    // Nobody piles on right after a hit.
    this.untilSpawn = Math.max(this.untilSpawn, RUSH.mercySec);
    this.events.push({ type: "struck", hearts: this.hearts });
    if (this.hearts <= 0) this.end(false);
  }

  /** The thrown thing under the reticle, if any. */
  private thrownUnderAim(aim: Vec2): Thrown | null {
    let best: Thrown | null = null;
    for (const thrown of this.thrown) {
      if (thrown.z >= -0.5) continue;
      const point = aimAtDepth(aim, -thrown.z, this.cameraX, this.cameraY);
      const radius = (RUSH.thrownReticle * -thrown.z) / PLANE.distance;
      if (Math.hypot(point.x - thrown.x, point.y - thrown.y) > radius) continue;
      if (!best || thrown.z > best.z) best = thrown;
    }
    return best;
  }

  /** Who the reticle's on, nearest first, and where it touches them. */
  private enemyUnderAim(aim: Vec2): { enemy: RushEnemy; landing: Vec2; zone: HitZone; local: Vec2 } | null {
    let best: { enemy: RushEnemy; landing: Vec2; zone: HitZone; local: Vec2 } | null = null;
    for (const enemy of this.enemies) {
      const distance = -enemy.z;
      if (distance <= 0) continue;
      const world = aimAtDepth(aim, distance, this.cameraX, this.cameraY);
      // Checked as if they were normal-sized and standing on the ground.
      const scale = enemy.kind === "boss" ? RUSH.bossScale : enemy.kind === "fat" ? RUSH.fatScale : 1;
      // A ducked goon is shorter, with all the same parts, so shots go over the top.
      const tall = scale * (enemy.ducking > 0 ? RUSH.duckHeight : 1);
      const point = { x: enemy.x + (world.x - enemy.x) / scale, y: (world.y - enemy.y) / tall };
      const radius = ((RUSH.reticle * distance) / PLANE.distance) / scale;
      if (!reticleHits(point, radius, enemy.x, HITBOX.height)) continue;
      if (best && enemy.z <= best.enemy.z) continue;
      const near = nearestPointOnBody(point, enemy.x);
      best = {
        enemy,
        zone: hitZone(near, enemy.x),
        local: point,
        landing: { x: enemy.x + (near.x - enemy.x) * scale, y: near.y * tall + enemy.y },
      };
    }
    return best;
  }

  private stepGun(realDt: number, input: RushInput): void {
    this.untilFire = Math.max(0, this.untilFire - realDt);
    const inDeadEye = this.deadEyeLeft > 0;

    // Lowering your arm reloads, which also gives it a rest.
    const armDown = this.rawAim.y >= RUSH.reloadFromY;
    if (this.reload) this.stepReload(this.reload, realDt);
    else if (!inDeadEye && this.ammo < this.maxAmmo && (armDown || input.reload)) this.startReload();

    this.onTarget = !armDown && (this.thrownUnderAim(input.aim) !== null
      || this.whiskeyUnderAim(input.aim)
      || this.enemyUnderAim(input.aim) !== null
      || this.barrelUnderAim(input.aim) !== null);
    // The gun only ever fires on a press.
    const pulling = input.fire || (this.gun.auto && input.fireHeld === true);
    if (!pulling || this.reload || this.untilFire > 0) return;
    if (this.ammo <= 0 && !inDeadEye) {
      // Pulling the trigger on nothing clicks, and goes straight into a reload.
      this.events.push({ type: "empty" });
      this.startReload();
      return;
    }
    this.fire(this.lockedShot(input.aim), inDeadEye);
  }

  private startReload(): void {
    // A magazine goes in all at once, so it counts as one.
    const bullets = this.gun.mag ? 1 : Math.max(0, this.maxAmmo - this.ammo);
    this.reload = { t: 0, bullets, loaded: 0 };
    this.reloadsDone += 1;
    this.events.push({ type: "reloading", bullets });
  }

  /** Each bullet counts the moment it goes in, so the ammo fills up along with the gun. */
  private stepReload(reload: RushReload, realDt: number): void {
    const before = reload.t;
    reload.t += realDt * Math.min(RUSH.reloadPaceMax, 1 + (this.reloadsDone - 1) * RUSH.reloadPacePerReload);
    const seated = Math.floor((reload.t - RUSH.reloadOpenSec) / RUSH.reloadBulletSec);
    while (reload.loaded < reload.bullets && seated > reload.loaded) {
      reload.loaded += 1;
      this.ammo = this.gun.mag ? this.maxAmmo : Math.min(this.maxAmmo, this.ammo + 1);
      this.events.push({ type: "bulletIn", loaded: reload.loaded, bullets: reload.bullets });
    }
    const closeAt = reloadTime(reload.bullets) - RUSH.reloadCloseSec;
    if (before < closeAt && reload.t >= closeAt) this.events.push({ type: "reloadClosing" });
    if (reload.t >= reloadTime(reload.bullets)) {
      this.reload = null;
      this.events.push({ type: "reloaded" });
    }
  }

  private fire(aim: Vec2, inDeadEye: boolean): void {
    this.untilFire = inDeadEye ? Math.min(RUSH.deadEyeGapSec, this.gun.gapSec) : this.gun.gapSec;
    if (!inDeadEye) this.ammo -= 1;
    this.count((s) => (s.shots += 1));
    // Something flying at you is always the first thing worth hitting.
    const thrown = this.thrownUnderAim(aim);
    if (thrown) {
      this.count((s) => (s.hits += 1));
      this.thrown = this.thrown.filter((t) => t !== thrown);
      this.addPoints(RUSH.thrownPoints, thrown, "BOTTLE!");
      this.events.push({ type: "shot", point: [thrown.x, thrown.y, thrown.z], killed: null, bossHit: false, thrown });
      this.burstFire(thrown);
      return;
    }
    if (this.whiskey && this.whiskeyUnderAim(aim)) {
      this.count((s) => (s.hits += 1));
      const w = this.whiskey;
      this.whiskey = null;
      this.hearts = Math.min(RUSH.hearts, this.hearts + 1);
      this.addPoints(RUSH.whiskeyPoints, w, "ONE MORE HEART!");
      this.events.push({ type: "shot", point: [w.x, w.y, w.z], killed: null, bossHit: false, thrown: null });
      this.events.push({ type: "healed", hearts: this.hearts });
      return;
    }
    if (this.tryDucking(aim)) {
      // The shot goes clean over their head and off down the street.
      const far = aimAtDepth(aim, 40, this.cameraX, this.cameraY);
      this.events.push({ type: "shot", point: [far.x, Math.max(0.1, far.y), -40], killed: null, bossHit: false, thrown: null });
      return;
    }
    const under = this.enemyUnderAim(aim);
    // A shot his way, hit or miss, might make him dart off.
    if (!this.bossInvulnerable) this.brain?.react();
    const barrel = this.barrelUnderAim(aim);
    if (barrel && (!under || barrel.z > under.enemy.z)) {
      this.count((s) => (s.hits += 1));
      this.events.push({ type: "shot", point: [barrel.x, 0.7, barrel.z], killed: null, bossHit: true, thrown: null });
      this.explodeBarrel(barrel);
      return;
    }
    if (!under) {
      const far = aimAtDepth(aim, 40, this.cameraX, this.cameraY);
      this.events.push({ type: "shot", point: [far.x, Math.max(0.1, far.y), -40], killed: null, bossHit: false, thrown: null });
      return;
    }
    this.count((s) => (s.hits += 1));
    this.hitEnemy(under, inDeadEye, aim);
  }

  /** The rare goon sees it coming, and ducks under your first shot at them. They only get one go. */
  private tryDucking(aim: Vec2): boolean {
    const enemy = this.enemyUnderAim(aim)?.enemy;
    if (!enemy?.dodger) return false;
    enemy.dodger = false;
    if (enemy.swing >= 0 || enemy.burning > 0 || enemy.grabbing > 0 || enemy.z >= RUSH.duckBeforeZ) return false;
    enemy.ducking = RUSH.duckSec;
    this.events.push({ type: "ducked", enemy });
    return true;
  }

  /** A shot fire bottle: anyone close enough catches light, and fuel rains down onto the street. */
  private burstFire(thrown: Thrown): void {
    let caught = 0;
    for (const enemy of this.enemies) {
      if (enemy.kind === "boss" || enemy.burning > 0) continue;
      if (Math.hypot(enemy.x - thrown.x, enemy.z - thrown.z) > RUSH.fireRadius) continue;
      this.ignite(enemy);
      caught += 1;
    }
    this.lightFire(thrown.x, thrown.z, RUSH.firePatchRadius);
    this.events.push({ type: "fireBurst", x: thrown.x, y: thrown.y, z: thrown.z, caught });
    this.events.push({ type: "smashed", x: thrown.x, y: thrown.y, z: thrown.z });
  }

  /** Whether the reticle's on his heart, and it's showing. */
  private heartUnderAim(boss: RushEnemy, aim: Vec2): boolean {
    if (!this.heartOpen) return false;
    const distance = -boss.z;
    const point = aimAtDepth(aim, distance, this.cameraX, this.cameraY);
    const reach = BOSS.heartRadius + ((RUSH.reticle * distance) / PLANE.distance) * 0.5;
    return Math.hypot(point.x - boss.x, point.y - (boss.y + BOSS.heartY)) <= reach;
  }

  private hitEnemy(under: { enemy: RushEnemy; landing: Vec2; zone: HitZone; local: Vec2 }, inDeadEye: boolean, aim: Vec2): void {
    const { enemy, landing, zone, local } = under;
    const point: [number, number, number] = [landing.x, landing.y, enemy.z];

    // A shield stops anything aimed at it, and takes the damage. Go over or under, or break it.
    const shieldUp = enemy.peeking <= 0 && enemy.stepTo === null && enemy.raising <= RUSH.shieldRaiseSec - RUSH.shieldUpAt;
    const onShield = enemy.shieldHp > 0 && enemy.burning <= 0 && shieldUp
      && Math.abs(local.x - enemy.x) < RUSH.shieldHalfWidth
      && local.y >= RUSH.shieldFromY && local.y <= RUSH.shieldToY;
    if (onShield) {
      const at = { x: landing.x, y: landing.y, z: enemy.z + 0.75 };
      enemy.shieldHp -= 1;
      enemy.z -= RUSH.shieldKnock;
      this.events.push({ type: "shot", point, killed: null, bossHit: true, thrown: null });
      if (enemy.shieldHp > 0) {
        this.addPoints(RUSH.shieldHitPoints, at, "");
        this.events.push({ type: "blocked", enemy, ...at });
      } else {
        this.addPoints(RUSH.shieldBreakPoints, at, "SHIELD BROKEN!");
        this.events.push({ type: "shieldBroke", enemy, ...at });
      }
      return;
    }
    // Clipping a hat doesn't hurt, but it does make them stop and go after it.
    if (local.y >= RUSH.hatFromY && !enemy.hatOff && enemy.kind !== "boss") {
      enemy.hatOff = true;
      enemy.grabbing = RUSH.hatGrabSec;
      this.addPoints(RUSH.hatPoints, { x: enemy.x, y: enemy.y + 3, z: enemy.z }, "HAT SHOT!");
      this.events.push({ type: "shot", point, killed: null, bossHit: true, thrown: null });
      this.events.push({ type: "hat", enemy });
      return;
    }
    if (enemy.kind === "boss") {
      // Getting ready to fire, he shrugs it all off.
      if (this.bossInvulnerable) {
        this.events.push({ type: "shot", point, killed: null, bossHit: true, thrown: null });
        this.events.push({ type: "bossBlocked", x: landing.x, y: landing.y, z: enemy.z + 1.6 });
        return;
      }
      if (!this.heartUnderAim(enemy, aim)) {
        // Anywhere else, the bullet just whines off into the night.
        this.events.push({ type: "shot", point, killed: null, bossHit: true, thrown: null });
        this.events.push({ type: "bossRicochet", x: landing.x, y: landing.y, z: enemy.z + 1.6 });
        return;
      }
      const damage = BOSS.heartDamage;
      this.bossHp = Math.max(0, this.bossHp - damage);
      this.events.push({ type: "bossHurt", damage, heart: true, hp: this.bossHp });
      if (!this.bossDefeated()) {
        this.addPoints(BOSS.heartPoints, { x: landing.x, y: landing.y + 0.5, z: enemy.z }, "HEART!");
        this.events.push({ type: "shot", point, killed: null, bossHit: true, thrown: null });
        return;
      }
    } else if (enemy.kind === "fat" && zone !== "head") {
      enemy.hp -= zone === "body" ? 1 : 2;
      if (enemy.hp > 0) {
        this.addPoints(25, { x: landing.x, y: landing.y + 0.5, z: enemy.z }, "");
        this.events.push({ type: "shot", point, killed: null, bossHit: true, thrown: null });
        this.events.push({ type: "wounded", enemy, point: landing });
        return;
      }
    }
    this.remove(enemy);
    // Picked off while they're still peeking: that's worth something.
    const caughtPeeking = enemy.peeking > 0;
    // The boss always goes out with one, and dead-eye keeps moving.
    // A nut shot always gets its moment, as long as bullet cams are on at all.
    const nutShot = zone === "nuts" && this.camChance > 0 && !inDeadEye && !this.cannon;
    const cam = enemy.kind === "boss" || nutShot
      || (!inDeadEye && !this.cannon && this.sinceCam >= RUSH.camGapSec && this.random() < this.camChance);
    // The boss only goes down through the heart. Everyone else gets the next shot along.
    const xray: XrayKind = enemy.kind === "boss" ? "heart" : cam ? this.pickXray(zone) : XRAYS_BY_ZONE[zone][0]!;
    // An x-ray always says what it hit.
    const named = cam ? XRAY_LABEL[xray] : ZONE_LABEL[zone];
    // The bullet cam's slow enough on its own, so the last kill's slow motion isn't stacked on top.
    if (cam && this.allOut && this.enemies.length === 0) this.lastKillSeen = true;
    const label = enemy.kind === "boss" ? "BOSS DOWN!" : caughtPeeking ? "PEEKABOO!" : enemy.kind === "golden" ? "GOLD!" : named;
    this.addKill(
      enemy.kind === "boss" ? BOSS.killPoints : enemy.kind === "golden" ? RUSH.goldenPoints : POINTS[zone] + (caughtPeeking ? RUSH.peekBonus : 0),
      { x: enemy.x, y: enemy.y + 3, z: enemy.z },
      label,
    );
    this.hitStopLeft = (zone === "head" ? RUSH.hitStopHeadSec : zone === "nuts" ? RUSH.hitStopNutsSec : RUSH.hitStopSec)
      + (this.multiplier - 1) * RUSH.hitStopPerCombo;
    const pierce = enemy.kind !== "boss" && this.pierceRandom() < this.pierceChance;
    if (cam) {
      this.cam = { enemy, zone, point: landing, t: 0, pierce, xray };
      this.sinceCam = 0;
    }
    this.events.push({ type: "shot", point, killed: { enemy, zone, point: landing, cam }, bossHit: false, thrown: null });
    if (pierce) this.pierceThrough(point, enemy, aim);
  }

  /** The bullet carries on out the back, and takes down anyone unlucky enough to be standing behind. */
  private pierceThrough(from: [number, number, number], first: RushEnemy, aim: Vec2): void {
    const under = this.enemyUnderAim(aim);
    const behind = under && under.enemy.z < first.z && under.enemy.kind !== "boss" && under.enemy.shieldHp <= 0 ? under : null;
    const far = aimAtDepth(aim, 40, this.cameraX, this.cameraY);
    if (!behind) {
      this.events.push({ type: "pierced", from, to: [far.x, Math.max(0.1, far.y), -40], next: null });
      return;
    }
    const { enemy, zone, landing } = behind;
    this.remove(enemy);
    this.addKill(POINTS[zone] * RUSH.pierceBonus, { x: enemy.x, y: enemy.y + 3, z: enemy.z }, "PIERCED!");
    this.events.push({
      type: "pierced",
      from,
      to: [landing.x, landing.y, enemy.z],
      next: { enemy, zone, point: landing, cam: false },
    });
  }

  private remove(enemy: RushEnemy): void {
    this.enemies = this.enemies.filter((e) => e !== enemy);
  }

  private finishWave(): void {
    const report = waveReport(this.wave + 1, this.waveStats);
    this.score += report.bonus;
    this.events.push({ type: "cleared", number: this.wave + 1, report });
    this.events.push({ type: "scored", points: report.bonus, label: "", x: 0, y: 3, z: -8 });
    this.waveStats = freshStats();
    this.barrels = [];
    this.fires = [];
    this.enterStage(this.level.next());
  }

  /** Sets the game up for whichever beat of the level comes next. */
  private enterStage(stage: LevelStage): void {
    switch (stage.kind) {
      case "wave":
        this.wave = stage.wave;
        this.lastKillSeen = false;
        this.spawned = 0;
        this.untilSpawn = 0;
        this.placeBarrels();
        this.phase = "rush";
        this.events.push({ type: "wave", number: this.wave + 1 });
        break;
      case "rest":
        this.phase = "clear";
        break;
      case "travel":
        this.phase = "travel";
        this.onTarget = false;
        this.parkedCannons = [];
        this.whiskey = null;
        this.reload = null;
        this.ammo = this.maxAmmo;
        this.events.push({ type: "travel" });
        break;
      case "arena":
        this.phase = "arena";
        this.events.push({ type: "arena" });
        break;
      case "challenge":
        this.phase = "challenge";
        this.events.push({ type: "challenge" });
        break;
      case "bossDrop":
        this.startBossDrop();
        break;
      case "faceoff":
        this.phase = "faceoff";
        this.events.push({ type: "faceoff" });
        break;
      case "boss":
        this.ammo = this.maxAmmo;
        this.reload = null;
        if (this.enemies[0]) this.brain = new BossBrain(this.enemies[0], this.random);
        this.startShooting();
        break;
    }
  }

  /** The gator comes down off the bank's roof, in one big leap. */
  private startBossDrop(): void {
    this.phase = "bossDrop";
    const boss = this.makeEnemy("boss");
    boss.x = RUSH.bossRoofX;
    boss.y = RUSH.bossRoofY;
    boss.z = RUSH.bossRoofZ;
    this.enemies = [boss];
    this.events.push({ type: "bossArrives" });
  }

  private stepBossDrop(dt: number): void {
    const done = this.level.tick(dt);
    const boss = this.enemies[0];
    if (!boss) return;
    const u = this.level.progress;
    boss.x = RUSH.bossRoofX * (1 - u);
    boss.z = RUSH.bossRoofZ + (RUSH.bossZ - RUSH.bossRoofZ) * u;
    // A hop up off the edge first, then all the way down.
    boss.y = RUSH.bossRoofY * (1 - u) + Math.sin(u * Math.PI) * 2.5;
    if (done) {
      boss.x = 0;
      boss.y = 0;
      boss.z = RUSH.bossZ;
      this.events.push({ type: "bossLanded" });
      this.enterStage(this.level.next());
    }
  }

  private startShooting(): void {
    this.phase = "bossShoot";
    this.shootLeft = RUSH.shootTimeSec;
    this.heartShown = false;
    this.prompt = null;
    this.brain?.loosen();
    this.events.push({ type: "shootTime" });
  }

  /** The warning: he plants his feet and spins up the gun, and nothing can hurt him now. */
  private startCharging(): void {
    this.phase = "bossCharge";
    this.chargeLeft = BOSS.chargeSec;
    this.brain?.charge();
    this.events.push({ type: "bossCharge" });
  }

  private startDodging(): void {
    this.phase = "bossDodge";
    this.dodgesLeft = RUSH.dodgesPerRound;
    this.onTarget = false;
    // The gun's down for this anyway, so it comes back loaded.
    this.ammo = this.maxAmmo;
    this.reload = null;
    this.events.push({ type: "dodgeTime" });
    this.nextPrompt();
  }

  private nextPrompt(): void {
    if (this.dodgesLeft <= 0) {
      this.startShooting();
      return;
    }
    this.dodgesLeft -= 1;
    // Never the same move twice in a row, so it always asks for something new.
    const moves = (["left", "right", "duck"] as const).filter((m) => m !== this.lastMove);
    const move = moves[Math.floor(this.random() * moves.length)]!;
    this.lastMove = move;
    const boss = this.enemies[0];
    this.prompt = {
      move,
      t: 0,
      // Out of the minigun, which it holds low on its right, our left.
      from: [(boss?.x ?? 0) - 2.9, 2.7, (boss?.z ?? RUSH.bossZ) + 4.5],
      slow: this.random() < this.dodgeSlowChance,
      outcome: null,
    };
    // A little spin-up before each burst, while the word's up.
    this.brain?.charge(RUSH.warnSec);
    this.events.push({ type: "word", move });
  }

  private isPosed(move: DodgeMove): boolean {
    if (move === "left") return this.lean <= -RUSH.leanedAt;
    if (move === "right") return this.lean >= RUSH.leanedAt;
    return this.duck >= RUSH.duckedAt;
  }

  private stepDodging(dt: number): void {
    const prompt = this.prompt;
    if (!prompt) return;
    prompt.t += dt;
    const u = (prompt.t - RUSH.warnSec) / RUSH.attackSec;
    if (u >= 0 && this.brain?.move === "charge") {
      const sec = RUSH.attackSec + RUSH.pastSec;
      this.brain.fire(sec);
      this.events.push({ type: "bossFire", sec });
    }
    // Time slows just before it reaches you, if you're already out of the way.
    if (prompt.slow && prompt.outcome === null && u > 0.5 && this.isPosed(prompt.move)) {
      this.slowFor = RUSH.slowSec;
      prompt.slow = false;
    }
    if (u >= 1 && prompt.outcome === null) {
      const dodged = this.isPosed(prompt.move);
      prompt.outcome = dodged ? "dodged" : "hit";
      if (dodged) {
        this.score += 25;
        this.events.push({ type: "dodged", slow: this.slowFor > 0 });
      } else {
        this.hurt();
        if (this.over) return;
      }
    }
    if (prompt.t >= RUSH.warnSec + RUSH.attackSec + RUSH.pastSec) this.nextPrompt();
  }

  private end(won: boolean): void {
    this.phase = won ? "won" : "lost";
    this.enemies = [];
    this.thrown = [];
    this.barrels = [];
    this.fires = [];
    this.whiskey = null;
    this.prompt = null;
    this.cam = null;
    this.cannon = null;
    this.events.push({ type: "ended", won });
  }
}
