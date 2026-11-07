// Turning a lean of the body into walking left and right. People don't stand perfectly straight,
// and a camera is rarely dead ahead, so "upright" slowly follows however they're standing.

/** How far from upright a lean starts to count, as a share of the control's range. */
export const LEAN_DEADZONE = 0.12;
/** How far past that is a full-speed walk. */
export const LEAN_FULL = 0.25;
/** How fast upright follows their stance. Slow, so holding a lean keeps walking for a while. */
const UPRIGHT_FOLLOW_PER_SEC = 0.12;

/** Reads the lean control as -1..1 around upright, or null if there's no live reading. */
export function readLean(controls: readonly {
  id: string;
  state?: string;
  value?: unknown;
  range?: unknown;
  neutralValue?: unknown;
}[]): number | null {
  const control = controls.find((c) => c.id === "torso-lateral-lean");
  if (!control || control.state !== "active" || typeof control.value !== "number") return null;
  const neutral = typeof control.neutralValue === "number" ? control.neutralValue : 0;
  const range = Array.isArray(control.range) ? (control.range as number[]) : [-1, 1];
  const offset = control.value - neutral;
  const reach = offset >= 0 ? (range[1] ?? 1) - neutral : neutral - (range[0] ?? -1);
  return reach > 0 ? Math.max(-1, Math.min(1, offset / reach)) : null;
}

export class LeanMove {
  private upright: number | null = null;

  /** Walking speed, -1..1. A null reading stands still, and the next one is taken as upright. */
  update(lean: number | null, dt: number): number {
    if (lean === null) {
      this.upright = null;
      return 0;
    }
    if (this.upright === null) this.upright = lean;
    this.upright += (lean - this.upright) * Math.min(1, UPRIGHT_FOLLOW_PER_SEC * dt);
    const away = lean - this.upright;
    const beyond = Math.abs(away) - LEAN_DEADZONE;
    if (beyond <= 0) return 0;
    return Math.sign(away) * Math.min(1, beyond / LEAN_FULL);
  }
}
