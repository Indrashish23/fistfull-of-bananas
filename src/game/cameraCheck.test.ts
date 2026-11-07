import { describe, expect, it } from "vitest";
import { CHECK_DONE_SEC, CHECK_HOLD_SEC, CameraCheck, onCheckTarget } from "./cameraCheck";

const DT = 1 / 60;
const MIDDLE = { x: 0.5, y: 0.56 };
const AWAY = { x: 0.1, y: 0.2 };

function run(check: CameraCheck, sec: number, camera: "none" | "looking" | "live", aim: { x: number; y: number } | null): boolean {
  let finished = false;
  for (let t = 0; t < sec; t += DT) finished = check.update(DT, camera, aim) || finished;
  return finished;
}

describe("the camera check", () => {
  it("says there's no camera, and never finishes by itself", () => {
    const check = new CameraCheck();
    expect(run(check, 5, "none", null)).toBe(false);
    expect(check.state).toBe("none");
  });

  it("waits while the camera's looking for you", () => {
    const check = new CameraCheck();
    expect(run(check, 5, "looking", null)).toBe(false);
    expect(check.state).toBe("looking");
  });

  it("asks you to point once it can see your arm, and fills while you're on the ring", () => {
    const check = new CameraCheck();
    run(check, 0.5, "live", AWAY);
    expect(check.state).toBe("point");
    expect(check.held).toBe(0);
    run(check, CHECK_HOLD_SEC / 2, "live", MIDDLE);
    expect(check.held).toBeGreaterThan(0.4);
    expect(check.state).toBe("point");
  });

  it("gets you after a steady hold, then moves on after a moment", () => {
    const check = new CameraCheck();
    run(check, CHECK_HOLD_SEC + 0.05, "live", MIDDLE);
    expect(check.state).toBe("done");
    expect(check.update(DT, "live", MIDDLE)).toBe(false);
    expect(run(check, CHECK_DONE_SEC, "live", MIDDLE)).toBe(true);
  });

  it("drains when you wander off, more slowly than it fills", () => {
    const check = new CameraCheck();
    run(check, CHECK_HOLD_SEC * 0.6, "live", MIDDLE);
    const before = check.held;
    run(check, CHECK_HOLD_SEC * 0.2, "live", AWAY);
    expect(check.held).toBeLessThan(before);
    expect(check.held).toBeGreaterThan(before - 0.2);
  });

  it("counts near the middle, but not the edge of the screen", () => {
    expect(onCheckTarget({ x: 0.53, y: 0.52 })).toBe(true);
    expect(onCheckTarget({ x: 0.75, y: 0.56 })).toBe(false);
  });
});
