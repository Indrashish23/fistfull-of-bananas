import {
  DUCK_HEIGHT,
  HITBOX,
  aimToPlane,
  clamp,
  damageFor,
  followToward,
  hitZone,
  killCamFor,
  nearestPointOnBody,
  reticleHits,
  lerp,
  reticleRadius,
  shapeMove,
  type HitZone,
  type Rules,
  type Vec2,
} from "./rules";

/** Every source of play goes through this, so real mic and camera can replace buttons. */
export interface PlayerInput {
  /** Normalized screen position, 0..1 with y down. */
  aim(): Vec2;
  /** 0..1, calibrated. Parked for now: the charge runs by itself while voice is off. */
  loudness(): number;
  /** -1..1 walking speed, in the shooter's screen direction. */
  lateral(): number;
  /** Whether they're ducking right now. */
  duck?(): boolean;
  /** False while the source is suspended (for example the agent has the mic). */
  available(): boolean;
}

export type Mode = 1 | 2;
export type PlayerId = 0 | 1;
export type Phase = "intro" | "handoff" | "aim" | "shot" | "impact" | "results";
export type Winner = PlayerId | "draw";

export interface Shot {
  shooter: PlayerId;
  target: PlayerId;
  aim: Vec2;
  radius: number;
  bar: number;
  targetX: number;
  hit: boolean;
  /** Where on the body it hit. Null for a miss. */
  zone: HitZone | null;
  /** Whether a body hit got a lucky x-ray. Rolled as it lands. */
  xray: boolean;
  damage: number;
  /**
   * Where the bullet ends up: on the body for a hit, at the aim point for a miss.
   * These all stay live until it lands, because the target is still moving.
   */
  landing: Vec2;
}

export type MatchEvent =
  | { type: "turn"; shooter: PlayerId }
  | { type: "fired"; shot: Shot }
  | { type: "impact"; shot: Shot }
  | { type: "results"; winner: Winner };

export interface MatchInputs {
  shooter: PlayerInput;
  target: PlayerInput;
  /** A press of Select or a click, once, on the frame it happened. */
  confirm: boolean;
}

const FIRE_GUARD_SEC = 0.35;

export class Match {
  phase: Phase = "intro";
  /** Seconds spent in the current phase. Frozen while suspended. */
  phaseTime = 0;
  round = 1;
  shooter: PlayerId = 0;
  health: [number, number];
  bar = 0;
  aim: Vec2 = { x: 0, y: 2 };
  targetX = 0;
  /** The target's current speed, -1..1, for animating the walk. */
  lateral = 0;
  suspended = false;
  /** 0 standing up, to 1 fully ducked. */
  duck = 0;
  /** What the target was doing as the shot left. It plays out, slowly, while the bullet flies. */
  private flightLateral = 0;
  private flightDuck = false;
  /** Whether the bar's filling. The tutorial holds this off until it's ready. */
  charging = true;
  shot: Shot | null = null;
  winner: Winner | null = null;
  /** Damage dealt per player, for the results screen. */
  shotsLanded: [number, number] = [0, 0];

  private events: MatchEvent[] = [];
  /** The first frame of a turn takes the aim as it is, rather than sliding in from elsewhere. */
  private snapAim = true;

  constructor(
    readonly mode: Mode,
    readonly rules: Rules,
    private readonly random: () => number = Math.random,
  ) {
    this.health = [rules.startHealth, rules.startHealth];
  }

  get target(): PlayerId {
    return this.shooter === 0 ? 1 : 0;
  }

  isHuman(player: PlayerId): boolean {
    return player === 0 || this.mode === 2;
  }

  /** How tall the target is right now. */
  get bodyHeight(): number {
    return lerp(HITBOX.height, DUCK_HEIGHT, this.duck);
  }

  get reticle(): number {
    return reticleRadius(this.bar, this.rules);
  }

  get timeLeft(): number {
    return Math.max(0, (1 - this.bar) * this.rules.aimSec);
  }

  /** Lets the dev panel pick who shoots next, ahead of the next turn. */
  setShooter(player: PlayerId): void {
    this.shooter = player;
    this.startTurn();
  }

  /** Hands the accumulated events to the renderer and audio, once. */
  drainEvents(): MatchEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  step(dt: number, inputs: MatchInputs): void {
    if (this.phase === "results") return;

    if (this.phase === "aim") {
      this.suspended = !inputs.shooter.available() || !inputs.target.available();
      if (this.suspended) return;
    } else {
      this.suspended = false;
    }

    this.phaseTime += dt;

    switch (this.phase) {
      case "intro":
        if (inputs.confirm || this.phaseTime >= this.rules.introSec) this.beginTurnFlow();
        break;
      case "handoff":
        if (inputs.confirm) this.startTurn();
        break;
      case "aim":
        this.stepAim(dt, inputs);
        break;
      case "shot":
        this.stepFlight(dt);
        if (this.phaseTime >= this.rules.slowMoSec) this.land();
        break;
      case "impact":
        if (this.phaseTime >= this.rules.impactSec + killCamFor(this.shot?.zone ?? null, this.rules, this.shot?.xray)) this.endTurn();
        break;
    }
  }

  private enter(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
  }

  /** Two people on one remote pass it over; a dummy needs no hand-off. */
  private beginTurnFlow(): void {
    if (this.mode === 2) this.enter("handoff");
    else this.startTurn();
  }

  private startTurn(): void {
    this.bar = 0;
    this.targetX = 0;
    this.lateral = 0;
    this.duck = 0;
    this.snapAim = true;
    this.shot = null;
    this.enter("aim");
    this.events.push({ type: "turn", shooter: this.shooter });
  }

  private stepAim(dt: number, inputs: MatchInputs): void {
    const { rules } = this;
    if (this.charging) this.bar = clamp(this.bar + dt / rules.aimSec, 0, 1);
    const aimGoal = aimToPlane(inputs.shooter.aim());
    if (this.snapAim) {
      this.aim = aimGoal;
      this.snapAim = false;
    } else {
      this.aim = {
        x: followToward(this.aim.x, aimGoal.x, dt, rules.aimFollowPerSec),
        y: followToward(this.aim.y, aimGoal.y, dt, rules.aimFollowPerSec),
      };
    }
    const ducking = inputs.target.duck?.() ?? false;
    this.flightDuck = ducking;
    this.duck = followToward(this.duck, ducking ? 1 : 0, dt, rules.duckPerSec);
    const moveGoal = shapeMove(inputs.target.lateral(), rules);
    this.lateral = followToward(this.lateral, moveGoal, dt, rules.moveFollowPerSec);
    if (moveGoal === 0 && Math.abs(this.lateral) < 0.005) this.lateral = 0;
    this.moveTarget(this.lateral * dt);
    // OK fires early. The guard stops a press from the screen before going off by accident.
    const pressed = inputs.confirm && this.charging && this.isHuman(this.shooter) && this.phaseTime >= FIRE_GUARD_SEC;
    if (pressed || this.bar >= 1) this.fire();
  }

  /** Walks the target along by this much full-speed time. Ducking walks slower. */
  private moveTarget(time: number): void {
    const { rules } = this;
    const speed = rules.walkSpeed * lerp(1, rules.duckWalk, this.duck);
    this.targetX = clamp(this.targetX + time * speed, -rules.laneHalfWidth, rules.laneHalfWidth);
  }

  /**
   * The world crawls while the bullet flies. Whatever the target was doing as the shot left
   * carries on, easing to a stop, and nobody can change it now.
   */
  private stepFlight(dt: number): void {
    const { rules } = this;
    const slow = dt * rules.shotMotionScale;
    const u = clamp(this.phaseTime / rules.slowMoSec, 0, 1);
    this.lateral = this.flightLateral * (1 - u);
    this.moveTarget(this.lateral * slow);
    this.duck = followToward(this.duck, this.flightDuck ? 1 : 0, slow, rules.duckPerSec);
    if (this.shot) this.judge(this.shot);
  }

  /** Works out what this shot hits with the target where it is now. */
  private judge(shot: Shot): void {
    const height = this.bodyHeight;
    shot.targetX = this.targetX;
    shot.hit = reticleHits(shot.aim, shot.radius, this.targetX, height);
    shot.landing = shot.hit ? nearestPointOnBody(shot.aim, this.targetX, height) : { ...shot.aim };
    shot.zone = shot.hit ? hitZone(shot.landing, this.targetX, height) : null;
    shot.damage = shot.zone ? damageFor(shot.bar, this.rules, shot.zone) : 0;
  }

  private fire(): void {
    const { rules } = this;
    const shot: Shot = {
      shooter: this.shooter,
      target: this.target,
      aim: { ...this.aim },
      radius: reticleRadius(this.bar, rules),
      bar: this.bar,
      targetX: this.targetX,
      hit: false,
      zone: null,
      xray: false,
      damage: 0,
      landing: { ...this.aim },
    };
    this.judge(shot);
    this.shot = shot;
    this.flightLateral = this.lateral;
    this.enter("shot");
    this.events.push({ type: "fired", shot });
  }

  private land(): void {
    const shot = this.shot;
    if (!shot) return;
    this.lateral = 0;
    this.judge(shot);
    shot.xray = shot.zone === "body" && this.random() < this.rules.xrayChance;
    this.health[shot.target] = Math.max(0, this.health[shot.target] - shot.damage);
    if (shot.hit) this.shotsLanded[shot.shooter] += 1;
    this.enter("impact");
    this.events.push({ type: "impact", shot });
  }

  /** The player who shoots second always gets a reply, so a round can end in a draw. */
  private endTurn(): void {
    if (this.shooter === 0) {
      this.shooter = 1;
      this.beginTurnFlow();
      return;
    }
    const [a, b] = this.health;
    if (a <= 0 || b <= 0 || this.round >= this.rules.maxRounds) {
      this.finish(a === b ? "draw" : a > b ? 0 : 1);
      return;
    }
    this.round += 1;
    this.shooter = 0;
    this.beginTurnFlow();
  }

  private finish(winner: Winner): void {
    this.winner = winner;
    this.enter("results");
    this.events.push({ type: "results", winner });
  }
}
