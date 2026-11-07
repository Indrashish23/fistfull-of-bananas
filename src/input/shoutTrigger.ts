// Turning a shout into one press: it fires as the voice gets loud, then waits for it to drop
// before it can fire again, so holding a long shout doesn't empty the gun.

/** How loud a voice has to get to fire. */
export const SHOUT_FIRE_LEVEL = 0.45;
/** How far it has to drop before the next shout counts. */
export const SHOUT_REARM_LEVEL = 0.15;
/** The shortest gap between shots, so the gun's own bang can't set off the next one. */
export const SHOUT_GAP_SEC = 0.6;

export class ShoutTrigger {
  private armed = true;
  private wait = 0;

  /** Returns true on the frame a shout fires. */
  update(level: number, dt: number): boolean {
    this.wait = Math.max(0, this.wait - dt);
    if (level <= SHOUT_REARM_LEVEL) this.armed = true;
    if (!this.armed || this.wait > 0 || level < SHOUT_FIRE_LEVEL) return false;
    this.armed = false;
    this.wait = SHOUT_GAP_SEC;
    return true;
  }
}
