import type { PlayerInput } from "../game/match";
import { clamp, planeToScreen, type Vec2 } from "../game/rules";

/** Raw mouse and keyboard state. The mouse stands in for the remote's pointer for now. */
export class Controls {
  readonly mouse: Vec2 = { x: 0.5, y: 0.5 };
  private held = new Set<string>();
  /** Set when someone clicks or presses Select; read once per frame. */
  private confirmPressed = false;
  private shoutPresses = 0;
  /** The key most recently used to aim, so arrows and mouse don't fight. */
  arrowsActive = false;
  /** Whether the mouse button's being held down. */
  mouseHeld = false;
  /** Whether a mouse has moved at all. A TV with only a remote never shows its crosshair. */
  mouseUsed = false;
  /** Walking speed from stepping aside, -1..1, set each frame while the camera can see someone. */
  bodyStep = 0;
  /** Whether they're crouching, set each frame the same way. */
  bodyDuck = false;

  constructor(surface: HTMLElement) {
    window.addEventListener("mousemove", (e) => {
      const r = surface.getBoundingClientRect();
      this.mouse.x = clamp((e.clientX - r.left) / r.width, 0, 1);
      this.mouse.y = clamp((e.clientY - r.top) / r.height, 0, 1);
      this.arrowsActive = false;
      this.mouseUsed = true;
    });
    window.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || isInteractive(e.target)) return;
      this.mouseHeld = true;
      this.press();
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseHeld = false;
    });
    window.addEventListener("keydown", (e) => {
      const code = keyName(e);
      if (import.meta.env?.DEV && !e.repeat) console.info(`[ragebait] key=${e.key} code=${e.code}`);
      if (isInteractive(e.target) && code === "Enter") return;
      if (!e.repeat) {
        this.held.add(code);
        if (code === "Enter") this.press();
      }
      if (code.startsWith("Arrow")) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.held.delete(keyName(e)));
    window.addEventListener("blur", () => {
      this.held.clear();
      this.mouseHeld = false;
    });
  }

  private press(): void {
    this.confirmPressed = true;
    this.shoutPresses += 1;
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }


  consumeConfirm(): boolean {
    const was = this.confirmPressed;
    this.confirmPressed = false;
    return was;
  }

  consumeShoutPresses(): number {
    const n = this.shoutPresses;
    this.shoutPresses = 0;
    return n;
  }
}

/**
 * A TV remote's keys don't always carry the `code` a keyboard's do, but they do carry the
 * right `key`, so the remote's six keys go by that. Letters still go by `code`.
 */
export function keyName(e: { key: string; code: string }): string {
  if (e.key === "Enter" || e.key === "Escape" || e.key.startsWith("Arrow")) return e.key;
  return e.code;
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, input, select, label") !== null;
}

/**
 * The remote, simulated: mouse or arrows to aim, and button spam for the voice.
 * Each press is a burst of noise that dies away, so loud means pressing fast.
 * Holding F is a steady shout. Real mic loudness replaces this in `loudness()`.
 */
export class SimulatedRemote implements PlayerInput {
  private envelope = 0;
  private arrowAim: Vec2 = { x: 0.5, y: 0.5 };
  /** When this gives a position, it aims instead of the mouse and arrows. The camera, usually. */
  aimOverride: (() => Vec2 | null) | null = null;
  /** A real voice's loudness, when there is one. Mashing still works alongside it. */
  voiceLevel: (() => number) | null = null;

  constructor(private readonly controls: Controls) {}

  /** Called once per rendered frame, so presses are never lost between fixed steps. */
  update(dt: number): void {
    const { controls } = this;
    this.envelope = clamp(this.envelope + controls.consumeShoutPresses() * PRESS_LEVEL, 0, 1);
    this.envelope = Math.max(0, this.envelope - PRESS_DECAY_PER_SEC * dt);
    if (controls.isDown("KeyF")) this.envelope = Math.max(this.envelope, HOLD_LEVEL);

    const dx = axis(controls, "ArrowRight", "ArrowLeft");
    const dy = axis(controls, "ArrowDown", "ArrowUp");
    if (dx !== 0 || dy !== 0) {
      if (!controls.arrowsActive) this.arrowAim = { ...controls.mouse };
      controls.arrowsActive = true;
      this.arrowAim.x = clamp(this.arrowAim.x + dx * ARROW_SPEED * dt, 0, 1);
      this.arrowAim.y = clamp(this.arrowAim.y + dy * ARROW_SPEED * dt, 0, 1);
    }
  }

  reset(): void {
    this.envelope = 0;
    this.controls.consumeShoutPresses();
  }

  /** Puts the arrow-key aim at a point, so aiming starts from there. */
  aimFrom(point: Vec2): void {
    this.arrowAim = { ...point };
    this.controls.arrowsActive = true;
  }

  /** Eases the arrow-key aim toward a point, for the menu's aim assist. */
  settleToward(point: Vec2, k: number): void {
    if (!this.controls.arrowsActive) return;
    this.arrowAim.x += (point.x - this.arrowAim.x) * k;
    this.arrowAim.y += (point.y - this.arrowAim.y) * k;
  }

  /** Whether arrows are being held right now. */
  get arrowsHeld(): boolean {
    const c = this.controls;
    return c.isDown("ArrowLeft") || c.isDown("ArrowRight") || c.isDown("ArrowUp") || c.isDown("ArrowDown");
  }

  aim(): Vec2 {
    return this.aimOverride?.() ?? (this.controls.arrowsActive ? this.arrowAim : this.controls.mouse);
  }

  loudness(): number {
    return Math.max(this.envelope, this.voiceLevel?.() ?? 0);
  }

  /** Just the button presses, for the click each one makes. */
  get pressLevel(): number {
    return this.envelope;
  }

  lateral(): number {
    return 0;
  }

  available(): boolean {
    return true;
  }
}

// Tuned so about 3 presses a second, a comfortable pace on a TV remote, fills the bar.
const PRESS_LEVEL = 0.5;
const PRESS_DECAY_PER_SEC = 1;
const HOLD_LEVEL = 0.85;
const ARROW_SPEED = 0.55;

function axis(controls: Controls, plus: string, minus: string): number {
  return (controls.isDown(plus) ? 1 : 0) - (controls.isDown(minus) ? 1 : 0);
}

/**
 * A person dodging. With one remote the target has nothing in hand, so they drift by
 * themselves unless A and D, the arrows or a step aside take over. Crouching, S or the down arrow ducks.
 */
export class DodgingPlayer implements PlayerInput {
  /** Drift when nobody is pressing anything. */
  autoDodge = true;
  private time = 0;

  constructor(
    private readonly controls: Controls,
    private readonly useArrows: boolean,
  ) {}

  update(dt: number): void {
    this.time += dt;
  }

  aim(): Vec2 {
    return { x: 0.5, y: 0.5 };
  }

  loudness(): number {
    return 0;
  }

  lateral(): number {
    const { controls } = this;
    let dir = axis(controls, "KeyD", "KeyA");
    if (this.useArrows) dir += axis(controls, "ArrowRight", "ArrowLeft");
    if (dir !== 0) return clamp(dir, -1, 1);
    if (controls.bodyStep !== 0) return controls.bodyStep;
    return this.autoDodge ? swayAt(this.time) * 0.8 : 0;
  }

  duck(): boolean {
    const { controls } = this;
    return controls.bodyDuck || controls.isDown("KeyS") || (this.useArrows && controls.isDown("ArrowDown"));
  }

  available(): boolean {
    return true;
  }
}

/** A non-repeating left and right drift, used by both people and the dummy. */
function swayAt(t: number): number {
  return Math.sin(t * 1.1) * 0.7 + Math.sin(t * 2.3 + 1) * 0.3;
}

export type DummyBehaviour = "still" | "sway" | "random";

/** Small seeded generator, so dummy runs repeat exactly. */
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

/** The training dummy, implementing the same interface as a player. */
export class Dummy implements PlayerInput {
  behaviour: DummyBehaviour = "sway";
  /** How far off its shots wander, in world units. */
  shooterError = 1.1;
  private time = 0;
  private random = makeRandom(7);
  private walk = 0;
  private walkUntil = 0;
  private shoutUntil = 0;
  private quietUntil = 0;
  private aimPoint: Vec2 = { x: 0.5, y: 0.5 };
  private wander: Vec2 = { x: 0, y: 0 };
  private wanderUntil = 0;

  constructor(private readonly targetX: () => number) {}

  update(dt: number): void {
    this.time += dt;
    if (this.time >= this.walkUntil) {
      this.walk = this.random() * 2 - 1;
      this.walkUntil = this.time + 0.4 + this.random() * 1.1;
    }
    if (this.time >= this.wanderUntil) {
      const e = this.shooterError;
      this.wander = { x: (this.random() * 2 - 1) * e, y: (this.random() * 2 - 1) * e };
      this.wanderUntil = this.time + 0.5 + this.random();
    }
    const goal = planeToScreen({ x: this.targetX() + this.wander.x, y: 1 + this.wander.y });
    const follow = Math.min(1, dt * 2.6);
    this.aimPoint.x += (goal.x - this.aimPoint.x) * follow;
    this.aimPoint.y += (goal.y - this.aimPoint.y) * follow;
    if (this.time >= this.quietUntil && this.time >= this.shoutUntil) {
      this.shoutUntil = this.time + 1.4 + this.random() * 1.8;
      this.quietUntil = this.shoutUntil + 0.3 + this.random() * 0.8;
    }
  }

  aim(): Vec2 {
    return this.aimPoint;
  }

  loudness(): number {
    return this.time < this.shoutUntil ? 0.9 : 0;
  }

  lateral(): number {
    switch (this.behaviour) {
      case "still":
        return 0;
      case "sway":
        return swayAt(this.time);
      case "random":
        return this.walk;
    }
  }

  available(): boolean {
    return true;
  }
}
