// Tunable rules and the geometry of the plane the target stands on. No DOM, audio or
// WebGL here, so everything in src/game runs in plain automated tests.

export interface Rules {
  startHealth: number;
  introSec: number;
  aimSec: number;
  /** How long the bullet takes to reach the target. */
  slowMoSec: number;
  /** The knockdown (or the miss) after the bullet lands. */
  impactSec: number;
  /** The x-ray before a headshot or nut shot knockdown. Plays ahead of impactSec. */
  killCamSec: number;
  /** How often a plain body hit gets an x-ray too. Head and nut shots always do. */
  xrayChance: number;
  damageMin: number;
  damageMax: number;
  headMultiplier: number;
  nutsMultiplier: number;
  reticleMin: number;
  reticleMax: number;
  walkSpeed: number;
  /** How quickly the reticle catches up with the aim input, per second. Higher is snappier. */
  aimFollowPerSec: number;
  /** Multiplies the movement input, so a small lean or tap counts for more. */
  moveSensitivity: number;
  /** How quickly walking speeds up and slows down, per second. Higher is snappier. */
  moveFollowPerSec: number;
  /** Movement input smaller than this is ignored, so tracking jitter can't cause a drift. */
  moveDeadzone: number;
  /** How much slower than normal the target moves while the bullet flies. */
  shotMotionScale: number;
  duckPerSec: number;
  /** Walking speed while ducked, as a share of normal. */
  duckWalk: number;
  laneHalfWidth: number;
  /** Rounds played before the healthier player wins. Keeps a match near 2 minutes. */
  maxRounds: number;
}

export const DEFAULT_RULES: Readonly<Rules> = {
  startHealth: 100,
  introSec: 4.6,
  aimSec: 6,
  slowMoSec: 4,
  impactSec: 3,
  killCamSec: 1.7,
  xrayChance: 0.3,
  damageMin: 25,
  damageMax: 25,
  headMultiplier: 1.5,
  nutsMultiplier: 1.25,
  reticleMin: 0.45,
  reticleMax: 0.45,
  walkSpeed: 4.2,
  // Light on purpose: smoothing adds delay of its own, on top of the TV's.
  aimFollowPerSec: 20,
  moveSensitivity: 1.2,
  moveFollowPerSec: 16,
  moveDeadzone: 0.06,
  shotMotionScale: 0.14,
  duckPerSec: 12,
  duckWalk: 0.55,
  laneHalfWidth: 4.6,
  maxRounds: 6,
};

/**
 * The vertical plane through the target, in world units, as seen by the fixed shooter
 * camera. The camera looks straight along it, so a screen position maps to it linearly.
 */
export const PLANE = {
  width: 13.34,
  height: 7.5,
  centerY: 2.6,
  distance: 14,
  cameraY: 1.75,
} as const;

/** The target's body at the moment of firing. */
export const HITBOX = { width: 1.2, height: 2.95 } as const;
/** How tall the body is when fully ducked. */
export const DUCK_HEIGHT = 2.0;

export interface Vec2 {
  x: number;
  y: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Normalized screen position (0..1, y down) to a point on the target's plane. */
export function aimToPlane(aim: Vec2): Vec2 {
  return {
    x: (aim.x - 0.5) * PLANE.width,
    y: PLANE.centerY + (0.5 - aim.y) * PLANE.height,
  };
}

/** A point on the target's plane back to normalized screen position. */
export function planeToScreen(p: Vec2): Vec2 {
  return {
    x: p.x / PLANE.width + 0.5,
    y: 0.5 - (p.y - PLANE.centerY) / PLANE.height,
  };
}

/** Eases toward a goal, without depending on the frame rate. */
export function followToward(from: number, to: number, dt: number, perSecond: number): number {
  return from + (to - from) * (1 - Math.exp(-perSecond * dt));
}

/** Applies the deadzone and sensitivity to a raw -1..1 movement input. */
export function shapeMove(raw: number, rules: Rules): number {
  const size = Math.abs(raw);
  if (size <= rules.moveDeadzone) return 0;
  // Rescaled from the deadzone's edge, so movement starts gently instead of with a jump.
  const beyond = (size - rules.moveDeadzone) / (1 - rules.moveDeadzone);
  return clamp(Math.sign(raw) * beyond * rules.moveSensitivity, -1, 1);
}

/** The bar rises with loudness and drains in silence, so the last seconds matter most. */
export function reticleRadius(bar: number, rules: Rules): number {
  return lerp(rules.reticleMin, rules.reticleMax, clamp(bar, 0, 1));
}

export function damageFor(bar: number, rules: Rules, zone: HitZone = "body"): number {
  const base = lerp(rules.damageMin, rules.damageMax, clamp(bar, 0, 1));
  const multiplier = zone === "head" ? rules.headMultiplier : zone === "nuts" ? rules.nutsMultiplier : 1;
  return Math.round(base * multiplier);
}

export type HitZone = "head" | "nuts" | "body";

/** Every x-ray the bullet cam can show, each with its own camera and line of fire. */
export type XrayKind = "skull" | "eye" | "jaw" | "temple" | "crown" | "ribs" | "heart" | "spine" | "nuts" | "cracker";

/** Which shots go with hits to each zone, and what each is called when it lands. */
export const XRAYS_BY_ZONE: Record<HitZone, readonly XrayKind[]> = {
  head: ["skull", "eye", "jaw", "temple", "crown"],
  body: ["ribs", "heart", "spine"],
  nuts: ["nuts", "cracker"],
};

export const XRAY_LABEL: Record<XrayKind, string> = {
  skull: "HEADSHOT!",
  eye: "RIGHT IN THE EYE!",
  jaw: "JAW BREAKER!",
  temple: "TEMPLE SHOT!",
  crown: "TOP OF THE SKULL!",
  ribs: "RIB SHOT!",
  heart: "HEART SHOT!",
  spine: "SPINE SHOT!",
  nuts: "NUT SHOT!",
  cracker: "NUT CRACKER!",
};

/** The opening: one player's eyes, then the other's, then both with the VS. */
export type IntroStage = "first" | "second" | "versus";

export const INTRO = { firstSec: 1.4, secondSec: 2.8 } as const;

export function introStage(t: number): IntroStage {
  if (t < INTRO.firstSec) return "first";
  return t < INTRO.secondSec ? "second" : "versus";
}

/** Fixed beats inside the kill cam, in seconds from the bullet landing. */
export const KILLCAM = {
  /** One light-dark swap inside this, and no more, to stay clear of strobing. */
  frameSwapSec: 0.06,
  frameSec: 0.14,
  contactSec: 0.36,
} as const;

/** How long the kill cam runs for a hit. Plain body hits and misses have none. */
export function killCamFor(zone: HitZone | null, rules: Rules, xray = false): number {
  return zone === "head" || zone === "nuts" || (zone === "body" && xray) ? rules.killCamSec : 0;
}

export type KillCamStage = "frame" | "approach" | "shatter" | "over";

export function killCamStage(t: number, zone: HitZone | null, rules: Rules, xray = false): KillCamStage {
  const length = killCamFor(zone, rules, xray);
  if (t >= length) return "over";
  if (t < KILLCAM.frameSec) return "frame";
  return t < KILLCAM.contactSec ? "approach" : "shatter";
}

/** Heights on the body, measured against the rigged monkey in lookdev/assets. */
export const ZONES = {
  headFromY: 1.3,
  nutsFromY: 0.46,
  nutsToY: 0.78,
  nutsHalfWidth: 0.24,
} as const;

/** Which part of the body a landing point is on. */
export function hitZone(landing: Vec2, targetX: number, height: number = HITBOX.height): HitZone {
  // Ducking brings every part of the body down together.
  const squash = height / HITBOX.height;
  if (landing.y >= ZONES.headFromY * squash) return "head";
  const inNutsHeight = landing.y >= ZONES.nutsFromY * squash && landing.y <= ZONES.nutsToY * squash;
  if (inNutsHeight && Math.abs(landing.x - targetX) <= ZONES.nutsHalfWidth) return "nuts";
  return "body";
}

/** The point of the target's body nearest to `center`. */
export function nearestPointOnBody(center: Vec2, targetX: number, height: number = HITBOX.height): Vec2 {
  return {
    x: clamp(center.x, targetX - HITBOX.width / 2, targetX + HITBOX.width / 2),
    y: clamp(center.y, 0, height),
  };
}

/** Exact circle against body test. No randomness, so the slo-mo always looks fair. */
export function reticleHits(center: Vec2, radius: number, targetX: number, height: number = HITBOX.height): boolean {
  const near = nearestPointOnBody(center, targetX, height);
  return Math.hypot(center.x - near.x, center.y - near.y) <= radius;
}
