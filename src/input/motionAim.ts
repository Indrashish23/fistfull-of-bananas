// Aiming with your arm: the TV's camera tracks one hand through its hand-cursor control, and the
// gun follows. The mouse and remote stay in charge whenever tracking isn't live.

import type { Vec2 } from "../game/rules";

export interface CursorControl {
  id: string;
  component?: string;
  state: string;
  value?: unknown;
  range?: unknown;
}

export type Arm = "left" | "right";

/**
 * Where a relaxed pointing arm sits in the cursor's -1..1 range, measured on a real TV. The
 * cursor is the wrist relative to the shoulders, so each hand rests off to its own side.
 */
export const ARM_HOME = { x: 0.62, y: 0.32 } as const;
/** How far the arm moves from home to reach the edge of the screen. Bigger means less wobble. */
export const ARM_REACH = 0.36;

/**
 * Maps a cursor value to screen space (0..1, y down), using the range the control reports.
 * Returns null if the value isn't a usable vector.
 */
export function cursorToScreen(value: unknown, range: unknown, arm: Arm = "right"): Vec2 | null {
  const v = value as Vec2 | undefined;
  if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
  const [lo, hi] = (Array.isArray(range) ? range : [{ x: -1, y: -1 }, { x: 1, y: 1 }]) as [Vec2, Vec2];
  const normal = (u: number, a: number, b: number) => ((u - a) / (b - a || 1)) * 2 - 1;
  const homeX = arm === "right" ? ARM_HOME.x : -ARM_HOME.x;
  const toScreen = (offset: number) => Math.min(1, Math.max(0, 0.5 + offset / (2 * ARM_REACH)));
  return {
    x: toScreen(normal(v.x, lo.x, hi.x) - homeX),
    y: toScreen(normal(v.y, lo.y, hi.y) - ARM_HOME.y),
  };
}

/** Eases toward a goal without depending on the frame rate. */
export function smoothToward(from: number, to: number, dt: number, perSecond: number): number {
  return from + (to - from) * (1 - Math.exp(-perSecond * dt));
}

/**
 * Fills in between pose readings, which only arrive 10-20 times a second. The match adds
 * its own aim smoothing on top, so this stays quick, to avoid stacking up more delay.
 */
const FOLLOW_PER_SEC = 24;
/** Tracking is treated as lost after this long without a fresh active reading. */
const STALE_SEC = 0.35;

export type MotionState = "off" | "starting" | "tracking" | "lost" | "unavailable";

export class MotionAim {
  readonly position: Vec2 = { x: 0.5, y: 0.5 };
  /** Which hand aims. */
  arm: Arm = "right";
  /** The latest reading in the cursor's own units, for the logs. */
  raw: Vec2 | null = null;
  /** The latest reading of each hand, whichever one's aiming, for spotting a shake. */
  readonly hands: Record<Arm, Vec2 | null> = { left: null, right: null };
  private goal: Vec2 | null = null;
  private sinceReading = Infinity;
  private unavailable = false;
  private close: (() => void) | null = null;

  get on(): boolean {
    return this.close !== null;
  }

  /** Whether the hand is driving the aim right now. */
  get live(): boolean {
    return this.on && this.goal !== null && this.sinceReading < STALE_SEC;
  }

  get state(): MotionState {
    if (this.unavailable) return "unavailable";
    if (!this.on) return "off";
    if (this.live) return "tracking";
    return this.goal ? "lost" : "starting";
  }

  /** Called with a started session's own subscribe functions, so this stays testable. */
  attach(close: () => void): void {
    this.close = close;
    this.unavailable = false;
    this.goal = null;
    this.sinceReading = Infinity;
  }

  stop(): void {
    this.close?.();
    this.close = null;
    this.goal = null;
    this.raw = null;
    this.sinceReading = Infinity;
  }

  markUnavailable(): void {
    this.stop();
    this.unavailable = true;
  }

  /** Takes the latest controls from the motion session. Missing or neutral readings count as lost. */
  onControls(controls: readonly CursorControl[]): void {
    for (const hand of ["left", "right"] as const) {
      const reading = controls.find((c) => c.id === `${hand}-hand-cursor`);
      this.hands[hand] = reading?.state === "active" && reading.value ? { ...(reading.value as Vec2) } : null;
    }
    const id = `${this.arm}-hand-cursor`;
    const cursor = controls.find((c) => c.id === id && c.state === "active");
    if (!cursor) return;
    const screen = cursorToScreen(cursor.value, cursor.range, this.arm);
    if (!screen) return;
    this.raw = { ...(cursor.value as Vec2) };
    if (!this.goal) {
      // First reading: jump there, rather than sliding in from the middle.
      this.position.x = screen.x;
      this.position.y = screen.y;
    }
    this.goal = screen;
    this.sinceReading = 0;
  }

  update(dt: number): void {
    this.sinceReading += dt;
    if (!this.goal) return;
    this.position.x = smoothToward(this.position.x, this.goal.x, dt, FOLLOW_PER_SEC);
    this.position.y = smoothToward(this.position.y, this.goal.y, dt, FOLLOW_PER_SEC);
  }
}
