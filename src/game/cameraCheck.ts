// The camera check before the game: it says the game needs a camera, waits until the camera has found
// you, and then has you point at a ring in the middle of the screen, so we know your arm moves the aim.
// No DOM here, so it runs in plain tests.

import type { Vec2 } from "./rules";

/**
 * none: there's no camera, or it's off. looking: it's on, but hasn't found you yet.
 * point: it can see your arm, and you're pointing at the ring. done: it's got you.
 */
export type CameraCheckState = "none" | "looking" | "point" | "done";

/** What the camera's doing: not there at all, on and searching, or following your arm. */
export type CameraReading = "none" | "looking" | "live";

/** How long to hold your arm on the ring. */
export const CHECK_HOLD_SEC = 1;
/** How long "Got you!" stays up before the game goes on. */
export const CHECK_DONE_SEC = 1.1;
/** The ring, a little below the middle of the screen to clear the words, and how near counts, as a share of the screen's height. The CSS puts it here too. */
export const CHECK_TARGET: Readonly<Vec2> = { x: 0.5, y: 0.56 };
export const CHECK_RADIUS = 0.13;
/** Wandering off the ring takes the fill back down, but more slowly than it went up. */
const DRAIN_SHARE = 0.5;
const ASPECT = 16 / 9;

export function onCheckTarget(aim: Vec2): boolean {
  return Math.hypot((aim.x - CHECK_TARGET.x) * ASPECT, aim.y - CHECK_TARGET.y) <= CHECK_RADIUS;
}

export class CameraCheck {
  state: CameraCheckState = "looking";
  /** 0..1, how full the ring is. */
  held = 0;
  private doneFor = 0;

  /** Moves the check along. Returns true once it's finished and the game should go on. */
  update(dt: number, camera: CameraReading, aim: Vec2 | null): boolean {
    if (this.state === "done") {
      this.doneFor += dt;
      return this.doneFor >= CHECK_DONE_SEC;
    }
    const drain = (dt / CHECK_HOLD_SEC) * DRAIN_SHARE;
    if (camera === "none") {
      this.state = "none";
      this.held = 0;
      return false;
    }
    if (camera === "looking" || !aim) {
      this.state = "looking";
      this.held = Math.max(0, this.held - drain);
      return false;
    }
    this.state = "point";
    this.held = onCheckTarget(aim) ? Math.min(1, this.held + dt / CHECK_HOLD_SEC) : Math.max(0, this.held - drain);
    if (this.held >= 1) this.state = "done";
    return false;
  }
}
