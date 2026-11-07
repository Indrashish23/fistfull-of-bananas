import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, ZONES, damageFor, hitZone } from "./rules";
import { AIM_HOLD_SEC, NUTS_HOLD_SEC, Tutorial, nearNuts, nutsPoint } from "./tutorial";

const DT = 1 / 60;

function run(t: Tutorial, seconds: number, onTarget: boolean, onNuts: boolean): void {
  for (let i = 0; i < seconds / DT; i++) t.update(DT, onTarget, onNuts);
}

describe("the tutorial", () => {
  it("starts on aiming", () => {
    const t = new Tutorial();
    expect(t.step).toBe("aim");
    expect(t.number).toBe(1);
  });

  it("moves on to the nuts after holding on target", () => {
    const t = new Tutorial();
    run(t, AIM_HOLD_SEC + 0.1, true, false);
    expect(t.step).toBe("nuts");
    expect(t.number).toBe(2);
  });

  it("doesn't count a passing swipe across the target", () => {
    const t = new Tutorial();
    for (let i = 0; i < 20; i++) {
      run(t, AIM_HOLD_SEC / 2, true, false);
      run(t, 0.05, false, false);
    }
    expect(t.step).toBe("aim");
  });

  it("waits for the nuts, wherever else on the body you aim", () => {
    const t = new Tutorial();
    run(t, AIM_HOLD_SEC + 0.1, true, false);
    run(t, 5, true, false);
    expect(t.step).toBe("nuts");
  });

  it("reports reaching the last step exactly once, and locks the aim there", () => {
    const t = new Tutorial();
    run(t, AIM_HOLD_SEC + 0.1, true, false);
    expect(t.aimLocked).toBe(false);
    let reached = 0;
    for (let i = 0; i < 60; i++) if (t.update(DT, true, true)) reached += 1;
    expect(reached).toBe(1);
    expect(t.step).toBe("fire");
    expect(t.number).toBe(3);
    expect(t.aimLocked).toBe(true);
  });
});

describe("the nut shot lesson", () => {
  it("locks onto a spot that really is a nut shot", () => {
    expect(hitZone(nutsPoint(0), 0)).toBe("nuts");
  });

  it("is forgiving around the spot, but not elsewhere", () => {
    expect(nearNuts(nutsPoint(0), 0)).toBe(true);
    expect(nearNuts({ x: ZONES.nutsHalfWidth + 0.1, y: ZONES.nutsToY + 0.1 }, 0)).toBe(true);
    expect(nearNuts({ x: 0, y: 1.2 }, 0)).toBe(false);
    expect(nearNuts({ x: 1.5, y: 0.6 }, 0)).toBe(false);
  });

  it("teaches something true: a nut shot does bonus damage", () => {
    expect(damageFor(1, DEFAULT_RULES, "nuts")).toBeGreaterThan(damageFor(1, DEFAULT_RULES, "body"));
  });
});
