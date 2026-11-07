// The first-time tutorial's steps. It plays on a real match turn, so everything it teaches
// behaves as it will in the game. No DOM here, so it runs in plain tests.

import { ZONES, type Vec2 } from "./rules";

export type TutorialStep = "aim" | "nuts" | "fire";

/** Stay on target this long, so a passing swipe doesn't count as aiming. */
export const AIM_HOLD_SEC = 0.6;
/** Shorter here, because the spot is small and an arm wobbles. */
export const NUTS_HOLD_SEC = 0.25;
export const TOTAL_STEPS = 3;
/** How far around the nuts still counts as finding them, in world units. */
const NUTS_MARGIN = 0.2;

/** Where the shot gets locked, on the target's plane. */
export function nutsPoint(targetX: number): Vec2 {
  return { x: targetX, y: (ZONES.nutsFromY + ZONES.nutsToY) / 2 };
}

export function nearNuts(aim: Vec2, targetX: number): boolean {
  return (
    Math.abs(aim.x - targetX) <= ZONES.nutsHalfWidth + NUTS_MARGIN &&
    aim.y >= ZONES.nutsFromY - NUTS_MARGIN &&
    aim.y <= ZONES.nutsToY + NUTS_MARGIN
  );
}

export class Tutorial {
  step: TutorialStep = "aim";
  private heldFor = 0;

  /**
   * Moves the steps along. Returns true on the frame it reaches the last step, which is when
   * the caller should let the gun start charging.
   */
  update(dt: number, onTarget: boolean, onNuts: boolean): boolean {
    if (this.step === "aim") {
      this.heldFor = onTarget ? this.heldFor + dt : 0;
      if (this.heldFor >= AIM_HOLD_SEC) {
        this.step = "nuts";
        this.heldFor = 0;
      }
      return false;
    }
    if (this.step === "nuts") {
      this.heldFor = onNuts ? this.heldFor + dt : 0;
      if (this.heldFor >= NUTS_HOLD_SEC) {
        this.step = "fire";
        return true;
      }
    }
    return false;
  }

  /** Once they've found the spot, the aim holds there so the shot lands as a nut shot. */
  get aimLocked(): boolean {
    return this.step === "fire";
  }

  /** Which step this is, counting from 1. */
  get number(): number {
    return ["aim", "nuts", "fire"].indexOf(this.step) + 1;
  }
}
