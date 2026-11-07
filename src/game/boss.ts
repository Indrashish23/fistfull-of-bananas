// How Big Gat moves and how he can be hurt. He never stands still in your turn: he strafes, dashes, jumps
// and ducks to throw your aim off, and now and then rears back and shows the glowing heart he's protecting,
// which is the only place a shot really counts. No DOM or rendering here, so it runs in plain tests.

export const BOSS = {
  hp: 120,
  /** The body barely feels it, and the heart is where the fight's won. */
  /** His heart's the only thing that can be hurt. Everything else ricochets off that hide. */
  heartDamage: 6,
  heartPoints: 150,
  killPoints: 2000,
  /** How much smaller than his model's natural size he's drawn, to fit the frame. */
  drawScale: 0.88,
  /** Where his heart sits above the ground when it's showing, and how big a target it is. */
  heartY: 2.52,
  heartRadius: 0.67,
  /** How long it shows. Your turn has this many chances, at these shares of the way through it. */
  revealSec: 2.4,
  /** The warning before he opens up. He can't be hurt from here until your next turn. */
  chargeSec: 1.3,
  /** How far he ranges from the middle of the arena. */
  arenaHalf: 4.7,
  idleMin: 0.3,
  idleMax: 0.7,
  strafeSpeed: 8.4,
  strafeMin: 2.3,
  dashSec: 0.24,
  /** A tiny lean first, so a dash can just about be read. */
  dashWindup: 0.1,
  dashMin: 3.2,
  dashMax: 5.8,
  jumpSec: 1,
  jumpHeight: 3.4,
  jumpReach: 3.2,
  landSec: 0.2,
  duckSec: 1.1,
  /** How often a shot makes him dash out of the way, if he's free to. */
  reactChance: 0.3,
} as const;

export type BossMove = "idle" | "strafe" | "dash" | "jump" | "land" | "duck" | "reveal" | "charge" | "fire";

/** The bits of an enemy that he moves around. */
export interface BossBody {
  x: number;
  y: number;
  ducking: number;
}

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export class BossBrain {
  move: BossMove = "idle";
  /** Seconds into this move, and how long it runs. */
  t = 0;
  dur: number = BOSS.idleMin;
  /** Which way he's moving: 1 is to the right of the screen. */
  dir = 1;
  private fromX = 0;
  private toX = 0;
  private last: BossMove = "idle";

  constructor(
    private readonly body: BossBody,
    private readonly random: () => number,
  ) {}

  get heartOpen(): boolean {
    return this.move === "reveal";
  }

  /** Whether he's in the middle of something he won't break off for a dodge. */
  private get busy(): boolean {
    return this.move === "reveal" || this.move === "charge" || this.move === "fire" || this.move === "jump" || this.move === "dash";
  }

  private between(a: number, b: number): number {
    return a + this.random() * (b - a);
  }

  private begin(move: BossMove, dur: number): void {
    if (move !== "idle" && move !== "land") this.last = move;
    this.move = move;
    this.t = 0;
    this.dur = dur;
    this.fromX = this.body.x;
    this.toX = this.body.x;
    this.body.ducking = move === "duck" ? dur : 0;
  }

  step(dt: number): void {
    this.t += dt;
    const u = clamp(this.t / this.dur, 0, 1);
    const { body } = this;
    switch (this.move) {
      case "strafe":
        body.x = lerp(this.fromX, this.toX, u);
        break;
      case "dash": {
        const k = clamp((this.t - BOSS.dashWindup) / (this.dur - BOSS.dashWindup), 0, 1);
        body.x = lerp(this.fromX, this.toX, k * (2 - k));
        break;
      }
      case "jump":
        body.x = lerp(this.fromX, this.toX, u);
        body.y = Math.sin(u * Math.PI) * BOSS.jumpHeight;
        break;
      case "charge":
      case "fire":
      case "reveal":
      case "land":
        // Whatever he was up to, he comes down for this.
        body.y = Math.max(0, body.y - dt * 12);
        break;
      default:
        break;
    }
    if (this.move === "duck") body.ducking = Math.max(0, this.dur - this.t);
    if (this.t < this.dur) return;
    if (this.move === "jump") {
      body.y = 0;
      this.begin("land", BOSS.landSec);
    } else if (this.move === "charge" || this.move === "fire") {
      // He holds these until he's told otherwise.
      this.t = this.dur;
    } else if (this.move === "idle" || this.move === "land" || this.move === "reveal") {
      this.pickMove();
    } else {
      this.begin("idle", this.between(BOSS.idleMin, BOSS.idleMax));
    }
  }

  /** Something new every time, so there's no rhythm to pick up. */
  private pickMove(): void {
    const options: BossMove[] = ["strafe", "strafe", "dash", "dash", "jump", "duck"];
    const fresh = options.filter((m) => m !== this.last);
    const move = fresh[Math.floor(this.random() * fresh.length)]!;
    if (move === "strafe") this.strafe();
    else if (move === "dash") this.dash(this.roomier());
    else if (move === "jump") this.jump();
    else this.begin("duck", BOSS.duckSec);
  }

  /** The side with more room. */
  private roomier(): number {
    return this.body.x > 0 ? -1 : 1;
  }

  private strafe(): void {
    const dir = Math.abs(this.body.x) > BOSS.arenaHalf * 0.5 ? this.roomier() : this.random() < 0.5 ? -1 : 1;
    const to = clamp(this.body.x + dir * this.between(BOSS.strafeMin, BOSS.strafeMin * 2), -BOSS.arenaHalf, BOSS.arenaHalf);
    const dur = Math.max(0.2, Math.abs(to - this.body.x) / BOSS.strafeSpeed);
    this.begin("strafe", dur);
    this.toX = to;
    this.dir = dir;
  }

  private dash(dir: number): void {
    const to = clamp(this.body.x + dir * this.between(BOSS.dashMin, BOSS.dashMax), -BOSS.arenaHalf, BOSS.arenaHalf);
    this.begin("dash", BOSS.dashSec);
    this.toX = to;
    this.dir = dir;
  }

  private jump(): void {
    const dir = this.random() < 0.5 ? -1 : 1;
    this.begin("jump", BOSS.jumpSec);
    this.toX = clamp(this.body.x + dir * this.between(1, BOSS.jumpReach), -BOSS.arenaHalf, BOSS.arenaHalf);
    this.dir = dir;
  }

  /** You've just fired. Sometimes he darts out of the way. */
  react(): void {
    if (this.busy || this.random() >= BOSS.reactChance) return;
    this.dash(this.roomier());
  }

  /** Rears back and shows his heart. Returns false if he's in the air and can't yet. */
  reveal(): boolean {
    if (this.move === "jump" || this.move === "dash") return false;
    this.begin("reveal", BOSS.revealSec);
    return true;
  }

  /** Plants his feet and spins the gun up. */
  charge(sec: number = BOSS.chargeSec): void {
    this.begin("charge", sec);
  }

  fire(sec: number): void {
    this.begin("fire", sec);
  }

  /** Your turn again. */
  loosen(): void {
    this.begin("idle", BOSS.idleMin);
  }
}
