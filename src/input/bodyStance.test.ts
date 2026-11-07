import { describe, expect, it } from "vitest";
import { BodyStance, DUCK_AT, STEP_DEADZONE, type Keypoint } from "./bodyStance";

const DT = 1 / 15;
const WIDTH = 0.2;
const TORSO = 0.3;

/** A person facing the camera, with their hips at x and their shoulders at y. */
function body(x: number, shouldersY = 0.3, score = 0.9): Keypoint[] {
  const hipsY = shouldersY + TORSO;
  return [
    { name: "left_shoulder", x: x + WIDTH / 2, y: shouldersY, score },
    { name: "right_shoulder", x: x - WIDTH / 2, y: shouldersY, score },
    { name: "left_hip", x: x + 0.07, y: hipsY, score },
    { name: "right_hip", x: x - 0.07, y: hipsY, score },
  ];
}

describe("reading a step", () => {
  it("takes wherever they first stand as home", () => {
    const s = new BodyStance();
    s.update(body(0.8), DT);
    expect(s.seen).toBe(true);
    expect(s.step).toBe(0);
  });

  it("ignores a small sway", () => {
    const s = new BodyStance();
    s.update(body(0.5), DT);
    s.update(body(0.5 + WIDTH * (STEP_DEADZONE - 0.1)), DT);
    expect(s.step).toBe(0);
  });

  it("reads a step either way", () => {
    const s = new BodyStance();
    s.update(body(0.5), DT);
    s.update(body(0.5 + WIDTH * 0.9), DT);
    expect(s.step).toBeGreaterThan(0);
    s.update(body(0.5 - WIDTH * 0.9), DT);
    expect(s.step).toBeLessThan(0);
  });

  it("tops out at a full step", () => {
    const s = new BodyStance();
    s.update(body(0.5), DT);
    s.update(body(0.9), DT);
    expect(s.step).toBe(1);
  });

  it("measures in shoulder-widths, so distance from the camera doesn't matter", () => {
    const far = new BodyStance();
    const small = (x: number): Keypoint[] => body(0).map((k) => ({ ...k, x: x + k.x / 2 }));
    far.update(small(0.5), DT);
    far.update(small(0.5 + (WIDTH / 2) * 0.9), DT);
    const near = new BodyStance();
    near.update(body(0.5), DT);
    near.update(body(0.5 + WIDTH * 0.9), DT);
    expect(far.step).toBeCloseTo(near.step);
  });

  it("gets used to a new spot over time", () => {
    const s = new BodyStance();
    s.update(body(0.5), DT);
    for (let i = 0; i < 15 * 120; i++) s.update(body(0.7), DT);
    expect(s.step).toBe(0);
  });
});

describe("reading a duck", () => {
  it("is off when standing", () => {
    const s = new BodyStance();
    s.update(body(0.5), DT);
    expect(s.ducking).toBe(false);
  });

  it("reads a real crouch", () => {
    const s = new BodyStance();
    s.update(body(0.5), DT);
    s.update(body(0.5, 0.3 + TORSO * (DUCK_AT + 0.1)), DT);
    expect(s.ducking).toBe(true);
  });

  it("ignores a small dip", () => {
    const s = new BodyStance();
    s.update(body(0.5), DT);
    s.update(body(0.5, 0.3 + TORSO * (DUCK_AT - 0.1)), DT);
    expect(s.ducking).toBe(false);
  });

  it("stays down while crouched, and ends on standing up", () => {
    const s = new BodyStance();
    s.update(body(0.5), DT);
    for (let i = 0; i < 15; i++) s.update(body(0.5, 0.3 + TORSO * 0.6), DT);
    expect(s.ducking).toBe(true);
    s.update(body(0.5), DT);
    expect(s.ducking).toBe(false);
  });

  it("treats sitting down as just standing lower, in the end", () => {
    const s = new BodyStance();
    s.update(body(0.5), DT);
    for (let i = 0; i < 15 * 120; i++) s.update(body(0.5, 0.5), DT);
    expect(s.ducking).toBe(false);
  });
});

describe("losing sight of them", () => {
  it("stops when the body's gone", () => {
    const s = new BodyStance();
    s.update(body(0.5), DT);
    s.update(body(0.9), DT);
    s.update([], DT);
    expect(s.seen).toBe(false);
    expect(s.step).toBe(0);
  });

  it("doesn't trust low-confidence points", () => {
    const s = new BodyStance();
    s.update(body(0.5, 0.3, 0.1), DT);
    expect(s.seen).toBe(false);
  });

  it("starts afresh when they come back", () => {
    const s = new BodyStance();
    s.update(body(0.5), DT);
    s.update([], DT);
    s.update(body(0.9), DT);
    expect(s.step).toBe(0);
  });
});
