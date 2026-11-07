// A small Verlet ragdoll. The body is points joined by sticks, and the bullet's impulse is
// applied where it landed, so every fall comes out differently. Purely visual: the rules
// have already decided the damage. No DOM or WebGL here, so it runs in plain tests.

export type RagZone = "head" | "nuts" | "body";

export type V = [number, number, number];

/** Named points of the body. */
export const P = {
  pelvis: 0, chest: 1, head: 2,
  shL: 3, shR: 4, elL: 5, elR: 6, haL: 7, haR: 8,
  hipL: 9, hipR: 10, knL: 11, knR: 12, ftL: 13, ftR: 14,
} as const;

/** At rest, these sit on the joints of the rigged monkey in lookdev/assets/monkey.glb. */
export const REST: readonly V[] = [
  [0, 0.78, 0], [0, 1.22, 0], [0, 1.74, 0],
  [-0.38, 1.13, 0], [0.38, 1.13, 0], [-0.66, 0.82, 0.04], [0.66, 0.82, 0.04], [-0.8, 0.34, 0.12], [0.8, 0.34, 0.12],
  [-0.2, 0.68, 0], [0.2, 0.68, 0], [-0.22, 0.38, 0], [0.22, 0.38, 0], [-0.23, 0.08, 0], [0.23, 0.08, 0],
];

/** Which ragdoll points drive each bone of the monkey. */
export const MONKEY_LAYOUT = {
  pelvis: P.pelvis, chest: P.chest, head: P.head, shL: P.shL, shR: P.shR,
  rest: REST,
  hatPivot: [0, 2.1, 0],
  bones: {
    root: { from: "torso" }, spine: { from: "torso" }, chest: { from: "torso" }, sign: { from: "torso" },
    "tail.1": { from: "torso" }, "tail.2": { from: "torso" }, "tail.3": { from: "torso" },
    head: { from: "head" }, hat: { from: "head" }, "ear.L": { from: "head" }, "ear.R": { from: "head" },
    "arm.L": { from: P.shL, to: P.elL }, "fore.L": { from: P.elL, to: P.haL }, "hand.L": { from: P.elL, to: P.haL },
    "arm.R": { from: P.shR, to: P.elR }, "fore.R": { from: P.elR, to: P.haR }, "hand.R": { from: P.elR, to: P.haR },
    "thigh.L": { from: P.hipL, to: P.knL }, "shin.L": { from: P.knL, to: P.ftL },
    "thigh.R": { from: P.hipR, to: P.knR }, "shin.R": { from: P.knR, to: P.ftR },
  },
} as const;

/** How far each point's surface sits from the ground. */
const RADIUS = [0.26, 0.28, 0.5, 0.12, 0.12, 0.1, 0.1, 0.12, 0.12, 0.15, 0.15, 0.12, 0.12, 0.09, 0.09];

const STICKS: readonly [number, number][] = [
  // The torso is held rigid by its diagonals.
  [P.pelvis, P.chest], [P.shL, P.shR], [P.shL, P.chest], [P.shR, P.chest],
  [P.hipL, P.hipR], [P.hipL, P.pelvis], [P.hipR, P.pelvis],
  [P.shL, P.hipL], [P.shR, P.hipR], [P.shL, P.hipR], [P.shR, P.hipL],
  // The head rides on the shoulders.
  [P.chest, P.head], [P.shL, P.head], [P.shR, P.head],
  // Arms and legs.
  [P.shL, P.elL], [P.elL, P.haL], [P.shR, P.elR], [P.elR, P.haR],
  [P.hipL, P.knL], [P.knL, P.ftL], [P.hipR, P.knR], [P.knR, P.ftR],
];

/** Pairs kept from folding through each other, so limbs bend without collapsing. */
const MIN_DISTANCE: readonly [number, number, number][] = [
  [P.shL, P.haL, 0.26], [P.shR, P.haR, 0.26],
  [P.hipL, P.ftL, 0.3], [P.hipR, P.ftR, 0.3],
  [P.head, P.pelvis, 0.72],
  [P.haL, P.head, 0.42], [P.haR, P.head, 0.42],
  [P.ftL, P.ftR, 0.16], [P.knL, P.knR, 0.14],
];

const STEP = 1 / 120;
const GRAVITY = 11;
const AIR_DAMPING = 0.998;
const GROUND_FRICTION = 0.42;
const ITERATIONS = 8;
/** The curl after a nut shot lasts this long, before the body gives up. */
const CURL_SEC = 1.05;

export interface Impact {
  zone: RagZone;
  /** World position the bullet landed. */
  landing: { x: number; y: number; z: number };
  /** The bar at firing, 0..1. Louder shots throw harder. */
  power: number;
}

export class Ragdoll {
  readonly points: V[];
  private readonly previous: V[];
  private readonly lengths: number[];
  private readonly mins: number[];
  private accumulator = 0;
  private curling = 0;
  /** +1 faces +Z, -1 faces -Z. Backward is the opposite way. */
  readonly facing: 1 | -1;
  time = 0;

  constructor(x: number, z: number, facing: 1 | -1) {
    this.facing = facing;
    this.points = REST.map(([px, py, pz]) => [x + px * facing, py, z + pz * facing]);
    this.previous = this.points.map((p) => [p[0], p[1], p[2]]);
    this.lengths = STICKS.map(([a, b]) => distance(this.points[a]!, this.points[b]!));
    this.mins = MIN_DISTANCE.map(([, , m]) => m);
  }

  /** Throws the whole body away along the ground, and a little up, on top of any hit. */
  punt(vx: number, vy: number, vz: number): void {
    for (let i = 0; i < this.points.length; i++) this.kick(i, vx, vy, vz);
  }

  /** Adds velocity to one point, by moving where Verlet thinks it was. */
  private kick(index: number, vx: number, vy: number, vz: number): void {
    const prev = this.previous[index]!;
    prev[0] -= vx * STEP;
    prev[1] -= vy * STEP;
    prev[2] -= vz * STEP;
  }

  hit(impact: Impact): void {
    const { zone, landing, power } = impact;
    const back = -this.facing;
    // A nut shot doesn't throw anyone: they crumple where they stand.
    const strength = zone === "nuts" ? 1 + power * 0.8 : 6.5 + power * 7.5;
    const pelvis = this.points[P.pelvis]!;
    // Hitting one side turns the body, because only that side gets the shove.
    const offset = clampTo(landing.x - pelvis[0], -1, 1);
    const reach = zone === "head" ? 0.95 : 1.35;

    for (let i = 0; i < this.points.length; i++) {
      const point = this.points[i]!;
      const d = Math.hypot(point[0] - landing.x, point[1] - landing.y, point[2] - landing.z);
      const near = Math.max(0, 1 - d / reach);
      const shove = strength * (near * near * 1.7 + 0.22);
      this.kick(i, offset * shove * 0.32, shove * 0.2, back * shove);
    }

    if (zone === "head") {
      this.kick(P.head, offset * 3, 2.6, back * strength * 1.15);
      // Whip the feet forward, so a headshot lays them out flat.
      for (const foot of [P.ftL, P.ftR]) this.kick(foot, 0, 1.2, -back * 4.5);
    } else if (zone === "nuts") {
      this.curling = CURL_SEC;
      this.kick(P.pelvis, 0, 1.6, back * 1.5);
    } else if (landing.y < 0.7) {
      // A low hit takes the legs out from under them.
      for (const foot of [P.ftL, P.ftR, P.knL, P.knR]) this.kick(foot, 0, 1.4, back * strength * 0.8);
    }
  }

  update(dt: number): void {
    this.accumulator += dt;
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      this.step();
    }
  }

  /** Runs the simulation forward at once, for bodies already lying down when shown. */
  settle(seconds: number): void {
    for (let i = 0; i < seconds / STEP; i++) this.step();
  }

  private step(): void {
    this.time += STEP;
    const { points, previous } = this;

    if (this.curling > 0) this.applyCurl();

    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      const q = previous[i]!;
      const vx = (p[0] - q[0]) * AIR_DAMPING;
      const vy = (p[1] - q[1]) * AIR_DAMPING;
      const vz = (p[2] - q[2]) * AIR_DAMPING;
      q[0] = p[0]; q[1] = p[1]; q[2] = p[2];
      p[0] += vx;
      p[1] += vy - GRAVITY * STEP * STEP;
      p[2] += vz;
    }

    for (let it = 0; it < ITERATIONS; it++) {
      for (let s = 0; s < STICKS.length; s++) {
        const [a, b] = STICKS[s]!;
        solve(points[a]!, points[b]!, this.lengths[s]!, false);
      }
      for (let m = 0; m < MIN_DISTANCE.length; m++) {
        const [a, b] = MIN_DISTANCE[m]!;
        solve(points[a]!, points[b]!, this.mins[m]!, true);
      }
      for (let i = 0; i < points.length; i++) {
        const p = points[i]!;
        const r = RADIUS[i]!;
        if (p[1] < r) {
          p[1] = r;
          const q = previous[i]!;
          // Dragging along the dirt scrubs off sideways speed.
          q[0] += (p[0] - q[0]) * GROUND_FRICTION;
          q[2] += (p[2] - q[2]) * GROUND_FRICTION;
        }
      }
    }
  }

  /** Doubled over: hands to the crotch, knees together, folding forward. */
  private applyCurl(): void {
    this.curling -= STEP;
    const strength = Math.min(1, this.curling / 0.3);
    const { points } = this;
    const pelvis = points[P.pelvis]!;
    const forward = this.facing;
    const pull = (index: number, x: number, y: number, z: number, k: number): void => {
      const p = points[index]!;
      this.kick(index, (x - p[0]) * k * strength, (y - p[1]) * k * strength, (z - p[2]) * k * strength);
    };
    const crotch = { x: pelvis[0], y: pelvis[1] - 0.05, z: pelvis[2] + forward * 0.32 };
    pull(P.haL, crotch.x - 0.08, crotch.y, crotch.z, 0.34);
    pull(P.haR, crotch.x + 0.08, crotch.y, crotch.z, 0.34);
    pull(P.knL, pelvis[0] - 0.08, 0.3, pelvis[2] + forward * 0.2, 0.2);
    pull(P.knR, pelvis[0] + 0.08, 0.3, pelvis[2] + forward * 0.2, 0.2);
    // Fold the top of the body over the belly.
    this.kick(P.head, 0, -0.1 * strength, forward * 0.22 * strength);
    this.kick(P.chest, 0, -0.06 * strength, forward * 0.12 * strength);
  }

  /** How much the body is still moving, for deciding when the dust has settled. */
  speed(): number {
    let sum = 0;
    for (let i = 0; i < this.points.length; i++) {
      sum += distance(this.points[i]!, this.previous[i]!);
    }
    return (sum / this.points.length) / STEP;
  }
}

function clampTo(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function distance(a: V, b: V): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Moves both points to hold their distance. With `onlyIfCloser`, it only pushes apart. */
function solve(a: V, b: V, length: number, onlyIfCloser: boolean): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const d = Math.hypot(dx, dy, dz) || 0.0001;
  if (onlyIfCloser && d >= length) return;
  const k = ((d - length) / d) * 0.5;
  a[0] += dx * k; a[1] += dy * k; a[2] += dz * k;
  b[0] -= dx * k; b[1] -= dy * k; b[2] -= dz * k;
}
