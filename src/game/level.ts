// A level as a list of beats, played in order: waves, a rest between them, the ride up the street,
// the boss's entrance, the staredown, and then the fight. Adding a boss or a stop on the way means
// adding to this list. No DOM or rendering here, so it runs in plain tests.

export type LevelStage =
  | { kind: "wave"; wave: number }
  | { kind: "rest"; sec: number }
  /**
   * The camera rides up the street to here, in world units from where it started, turning as it arrives.
   * With bendZ, it follows the road instead: straight to there, then curving round to its stop.
   */
  | { kind: "travel"; sec: number; toX: number; toZ: number; toYaw?: number; bendZ?: number }
  /** Barricades come down round the arena. */
  | { kind: "arena"; sec: number }
  | { kind: "bossDrop"; sec: number }
  /** The boss, down in the street, points at you. */
  | { kind: "challenge"; sec: number }
  | { kind: "faceoff"; sec: number }
  | { kind: "boss" };

/** Where the road starts to curve. The same bend as the town's street, in lookdev/kit.ts. */
const BEND_Z = -25;
const BEND_K = 0.0042;
const STOP_Z = -82;
const STOP_X = BEND_K * (STOP_Z - BEND_Z) ** 2;

/**
 * Where the first fight happens: out past the last buildings, where the street opens up, looking along
 * the road at the bank that closes it off.
 */
export const BANK_STOP = { x: STOP_X, z: STOP_Z, yaw: Math.atan(2 * BEND_K * (BEND_Z - STOP_Z)) } as const;
/** How long the walk there takes, long enough to watch the sun go down. */
export const RIDE_SEC = 11;
/** How far through the ride the camera starts to turn. */
const TURN_FROM = 0.62;

/** Level one: the waves, then the ride to the bank, where the gator comes down off the roof. */
export function levelOne(waves: number): LevelStage[] {
  const stages: LevelStage[] = [];
  for (let wave = 0; wave < waves; wave++) {
    stages.push({ kind: "wave", wave });
    // Long enough to read the wave's tally.
    stages.push({ kind: "rest", sec: 3.4 });
  }
  stages.push({ kind: "travel", sec: RIDE_SEC, toX: BANK_STOP.x, toZ: BANK_STOP.z, toYaw: BANK_STOP.yaw, bendZ: BEND_Z });
  stages.push({ kind: "arena", sec: 1.6 });
  stages.push({ kind: "bossDrop", sec: 2.1 });
  stages.push({ kind: "challenge", sec: 2.4 });
  stages.push({ kind: "faceoff", sec: 4.6 });
  stages.push({ kind: "boss" });
  return stages;
}

export class LevelSequencer {
  private index = 0;
  /** Seconds spent in this stage. */
  t = 0;
  /** How far up the street the camera has ridden, in world units. */
  railX = 0;
  railZ = 0;
  /** How far the camera has turned, in radians. Positive is to the right. */
  railYaw = 0;
  private fromX = 0;
  private fromZ = 0;
  private fromYaw = 0;

  constructor(private readonly stages: readonly LevelStage[]) {}

  get stage(): LevelStage {
    return this.stages[this.index]!;
  }

  /** How far through a timed stage this is, 0..1. A stage with no timer just stays at 0. */
  get progress(): number {
    const { stage } = this;
    return "sec" in stage ? Math.min(1, this.t / stage.sec) : 0;
  }

  /** Runs the clock. Returns true when a timed stage has run out. */
  tick(dt: number): boolean {
    this.t += dt;
    const { stage } = this;
    if (stage.kind === "travel") {
      const u = this.progress;
      const eased = u * u * (3 - 2 * u);
      this.railZ = this.fromZ + (stage.toZ - this.fromZ) * eased;
      if (stage.bendZ !== undefined) {
        // Along the road, facing the way it's going.
        const k = (stage.toX - this.fromX) / (stage.toZ - stage.bendZ) ** 2;
        const past = Math.max(0, stage.bendZ - this.railZ);
        this.railX = this.fromX + k * past * past;
        this.railYaw = this.fromYaw + Math.atan(2 * k * past);
      } else {
        this.railX = this.fromX + (stage.toX - this.fromX) * eased;
        const turn = Math.max(0, Math.min(1, (u - TURN_FROM) / (1 - TURN_FROM)));
        this.railYaw = this.fromYaw + ((stage.toYaw ?? this.fromYaw) - this.fromYaw) * turn * turn * (3 - 2 * turn);
      }
    }
    return "sec" in stage && this.t >= stage.sec;
  }

  /** Moves on to the next stage, and returns it. The last one stays put. */
  next(): LevelStage {
    const { stage } = this;
    if (stage.kind === "travel") {
      this.railX = stage.toX;
      this.railZ = stage.toZ;
      this.railYaw = stage.toYaw ?? this.railYaw;
    }
    if (this.index < this.stages.length - 1) this.index += 1;
    this.t = 0;
    this.fromX = this.railX;
    this.fromZ = this.railZ;
    this.fromYaw = this.railYaw;
    return this.stage;
  }
}
