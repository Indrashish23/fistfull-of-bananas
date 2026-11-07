// Reading a real step and a real crouch from the camera's skeleton. Steps are measured in
// shoulder-widths, so it works the same near the camera or across the room. No browser code here.

export type Keypoint = { name: string; x: number; y: number; score: number };

const MIN_SCORE = 0.35;
/** How far from home a step starts to count, in shoulder-widths. */
export const STEP_DEADZONE = 0.4;
/** How much further is a full step. */
export const STEP_FULL = 1;
/** Crouching this far, as a share of the torso's length, counts as a duck. */
export const DUCK_AT = 0.3;
const DUCK_RELEASE = 0.18;
/** Home drifts toward wherever they stand, slowly, so standing off-center doesn't stay a step. */
const HOME_FOLLOW_PER_SEC = 0.03;
/** Standing height follows them, so sitting down ends up as just another way of standing. */
const STAND_FOLLOW_PER_SEC = 0.5;
const STAND_FOLLOW_DUCKED_PER_SEC = 0.05;

export class BodyStance {
  /** -1..1 across the camera's frame. Whether that's left or right depends on the camera. */
  step = 0;
  ducking = false;
  /** Whether this frame had a usable body in it. */
  seen = false;
  private home: number | null = null;
  private standY = 0;
  private torso = 0;

  /** Starts over, for when the person may have moved while nobody was watching. */
  reset(): void {
    this.step = 0;
    this.ducking = false;
    this.seen = false;
    this.home = null;
  }

  update(keypoints: readonly Keypoint[], dt: number): void {
    const point = (name: string): Keypoint | null => {
      const found = keypoints.find((k) => k.name === name);
      return found && found.score >= MIN_SCORE ? found : null;
    };
    const ls = point("left_shoulder");
    const rs = point("right_shoulder");
    const lh = point("left_hip");
    const rh = point("right_hip");
    if (!ls || !rs || !lh || !rh) {
      this.reset();
      return;
    }
    this.seen = true;
    const width = Math.abs(ls.x - rs.x);
    const hipsX = (lh.x + rh.x) / 2;
    const hipsY = (lh.y + rh.y) / 2;
    const shouldersY = (ls.y + rs.y) / 2;

    if (this.home === null) {
      this.home = hipsX;
      this.standY = shouldersY;
      this.torso = hipsY - shouldersY;
    }
    this.home += (hipsX - this.home) * Math.min(1, HOME_FOLLOW_PER_SEC * dt);
    const away = width > 0.01 ? (hipsX - this.home) / width : 0;
    const beyond = Math.abs(away) - STEP_DEADZONE;
    this.step = beyond <= 0 ? 0 : Math.sign(away) * Math.min(1, beyond / STEP_FULL);

    // y runs down the frame, so a lower body has a bigger y. Rising up is always believed at once.
    if (shouldersY < this.standY) this.standY = shouldersY;
    const drop = this.torso > 0.01 ? (shouldersY - this.standY) / this.torso : 0;
    this.ducking = this.ducking ? drop > DUCK_RELEASE : drop > DUCK_AT;
    const follow = this.ducking ? STAND_FOLLOW_DUCKED_PER_SEC : STAND_FOLLOW_PER_SEC;
    this.standY += (shouldersY - this.standY) * Math.min(1, follow * dt);
    if (!this.ducking) this.torso += (hipsY - shouldersY - this.torso) * Math.min(1, follow * dt);
  }
}
