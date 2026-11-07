// Spots someone shaking their hand: the arm going back and forth, far enough and fast enough that it can't
// just be aiming. Feed it one axis of the arm's position each frame.

/** How far each swing has to go, in the hand cursor's own units. */
const SWING = 0.09;
/** How many changes of direction count as a shake, and how quickly they have to come. Readings only arrive 10 times a second, so a couple's plenty. */
const TURNS = 2;
const WINDOW_SEC = 1;

export class ShakeDetector {
  private time = 0;
  private dir = 0;
  private extreme: number | null = null;
  private turns: number[] = [];

  /** Returns true on the frame the shake's recognised. */
  update(value: number | null, dt: number): boolean {
    this.time += dt;
    if (value === null) {
      this.reset();
      return false;
    }
    if (this.extreme === null) {
      this.extreme = value;
      return false;
    }
    const moved = value - this.extreme;
    if (this.dir === 0) {
      if (Math.abs(moved) >= SWING) {
        this.dir = Math.sign(moved);
        this.extreme = value;
      }
    } else if (Math.sign(moved) === this.dir) {
      this.extreme = value;
    } else if (Math.abs(moved) >= SWING) {
      this.turns.push(this.time);
      this.dir = -this.dir;
      this.extreme = value;
    }
    this.turns = this.turns.filter((at) => this.time - at <= WINDOW_SEC);
    if (this.turns.length < TURNS) return false;
    this.turns = [];
    return true;
  }

  reset(): void {
    this.dir = 0;
    this.extreme = null;
    this.turns = [];
  }
}
