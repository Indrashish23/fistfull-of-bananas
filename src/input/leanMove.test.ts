import { describe, expect, it } from "vitest";
import { LEAN_DEADZONE, LEAN_FULL, LeanMove, readLean } from "./leanMove";

const DT = 1 / 20;

describe("reading the lean control", () => {
  const control = (value: number, state = "active") => ({
    id: "torso-lateral-lean",
    state,
    value,
    range: [-40, 40],
    neutralValue: 0,
  });

  it("scales to the control's own range", () => {
    expect(readLean([control(20)])).toBeCloseTo(0.5);
    expect(readLean([control(-40)])).toBeCloseTo(-1);
  });

  it("has nothing to say without a live reading", () => {
    expect(readLean([])).toBeNull();
    expect(readLean([control(20, "neutral")])).toBeNull();
    expect(readLean([{ id: "right-hand-cursor", state: "active", value: 1 }])).toBeNull();
  });
});

describe("leaning to walk", () => {
  it("stands still at however they first stand, even off-center", () => {
    const l = new LeanMove();
    expect(l.update(-0.2, DT)).toBe(0);
    expect(l.update(-0.2, DT)).toBe(0);
  });

  it("ignores a small sway", () => {
    const l = new LeanMove();
    l.update(0, DT);
    expect(l.update(LEAN_DEADZONE - 0.02, DT)).toBe(0);
  });

  it("walks the way they lean, faster the further they go", () => {
    const l = new LeanMove();
    l.update(0, DT);
    const gentle = l.update(LEAN_DEADZONE + 0.1, DT);
    const full = l.update(LEAN_DEADZONE + LEAN_FULL + 0.1, DT);
    expect(gentle).toBeGreaterThan(0);
    expect(gentle).toBeLessThan(1);
    expect(full).toBe(1);
    expect(l.update(-(LEAN_DEADZONE + LEAN_FULL + 0.2), DT)).toBe(-1);
  });

  it("gets used to a new stance over time", () => {
    const l = new LeanMove();
    l.update(0, DT);
    for (let i = 0; i < 20 * 60; i++) l.update(0.3, DT);
    expect(l.update(0.3, DT)).toBe(0);
  });

  it("stops when tracking drops, and starts fresh when it returns", () => {
    const l = new LeanMove();
    l.update(0, DT);
    expect(l.update(0.5, DT)).toBeGreaterThan(0);
    expect(l.update(null, DT)).toBe(0);
    expect(l.update(0.5, DT)).toBe(0);
  });
});
