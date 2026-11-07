import { describe, expect, it } from "vitest";
import { followRoom, loudnessFrom, rmsToDb } from "./voiceLevel";

describe("reading the mic", () => {
  it("reads a full-scale signal as about 0 dB", () => {
    expect(rmsToDb(new Float32Array(100).fill(1))).toBeCloseTo(0);
  });

  it("survives silence", () => {
    expect(Number.isFinite(rmsToDb(new Float32Array(100)))).toBe(true);
  });
});

describe("the room's level", () => {
  it("falls quickly when the room goes quiet", () => {
    expect(followRoom(-30, -60, 0.5)).toBeLessThan(-50);
  });

  it("doesn't mistake a shout for a loud room", () => {
    let room = -50;
    for (let i = 0; i < 180; i++) room = followRoom(room, -15, 1 / 60);
    expect(room).toBeLessThan(-46);
  });

  it("does get used to a steadily louder room", () => {
    let room = -50;
    for (let i = 0; i < 60 * 15; i++) room = followRoom(room, -40, 1 / 60);
    expect(room).toBeCloseTo(-40, 0);
  });

  it("stops at a floor", () => {
    expect(followRoom(-64, -100, 10)).toBe(-65);
  });
});

describe("how loud a shout is", () => {
  it("is nothing at the room's own level", () => {
    expect(loudnessFrom(-50, -50)).toBe(0);
  });

  it("is full, and no more, for a real shout", () => {
    expect(loudnessFrom(-5, -50)).toBe(1);
  });

  it("charges the bar from a raised voice near the phone, as measured on an iPhone", () => {
    expect(loudnessFrom(-55, -65)).toBeGreaterThan(0.3);
    expect(loudnessFrom(-49, -65)).toBe(1);
  });

  it("ignores the room's flickers", () => {
    expect(loudnessFrom(-60, -65)).toBe(0);
  });

  it("grows with the voice", () => {
    expect(loudnessFrom(-37, -50)).toBeGreaterThan(loudnessFrom(-41, -50));
  });
});
