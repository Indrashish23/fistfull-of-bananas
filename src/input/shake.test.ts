import { describe, expect, it } from "vitest";
import { ShakeDetector } from "./shake";

const DT = 1 / 30;
const play = (d: ShakeDetector, sec: number, at: (t: number) => number) => {
  let seen = false;
  for (let i = 0; i < sec / DT; i++) if (d.update(at(i * DT), DT)) seen = true;
  return seen;
};

describe("shaking your hand", () => {
  it("is spotted when the arm goes quickly back and forth", () => {
    expect(play(new ShakeDetector(), 1.5, (t) => 0.5 + Math.sin(t * 18) * 0.1)).toBe(true);
  });

  it("takes just one quick back and forth, even at 10 readings a second", () => {
    const d = new ShakeDetector();
    let seen = false;
    for (const value of [0.5, 0.65, 0.42, 0.62, 0.45]) if (d.update(value, 0.1)) seen = true;
    expect(seen).toBe(true);
  });

  it("isn't set off by a slow sweep across the screen", () => {
    expect(play(new ShakeDetector(), 3, (t) => 0.5 + Math.sin(t * 1.2) * 0.3)).toBe(false);
  });

  it("isn't set off by a hand that's just a bit unsteady", () => {
    expect(play(new ShakeDetector(), 3, (t) => 0.5 + Math.sin(t * 25) * 0.015)).toBe(false);
  });

  it("forgets everything when the arm's lost", () => {
    const d = new ShakeDetector();
    play(d, 0.2, (t) => 0.5 + Math.sin(t * 18) * 0.1);
    d.update(null, DT);
    expect(d.update(0.5, DT)).toBe(false);
  });
});
