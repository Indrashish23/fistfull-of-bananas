import { describe, expect, it } from "vitest";
import { BANK_STOP, LevelSequencer, levelOne, type LevelStage } from "./level";

describe("level one", () => {
  it("goes through the waves, up to the bank, and into the boss, in that order", () => {
    const kinds = levelOne(2).map((s) => s.kind);
    expect(kinds).toEqual(["wave", "rest", "wave", "rest", "travel", "arena", "bossDrop", "challenge", "faceoff", "boss"]);
  });

  it("numbers its waves", () => {
    const waves = levelOne(3).filter((s): s is Extract<LevelStage, { kind: "wave" }> => s.kind === "wave");
    expect(waves.map((w) => w.wave)).toEqual([0, 1, 2]);
  });

  it("ends in front of the bank", () => {
    const travel = levelOne(1).find((s): s is Extract<LevelStage, { kind: "travel" }> => s.kind === "travel")!;
    expect(travel.toX).toBe(BANK_STOP.x);
    expect(travel.toZ).toBe(BANK_STOP.z);
    expect(travel.toYaw).toBe(BANK_STOP.yaw);
  });

  it("only turns toward the bank near the end of the ride", () => {
    const s = new LevelSequencer([{ kind: "travel", sec: 10, toX: 0, toZ: -30, toYaw: 1 }, { kind: "boss" }]);
    s.tick(5);
    expect(s.railYaw).toBe(0);
    expect(s.railZ).toBeLessThan(0);
    s.tick(4);
    expect(s.railYaw).toBeGreaterThan(0);
    expect(s.railYaw).toBeLessThan(1);
    s.tick(1);
    s.next();
    expect(s.railYaw).toBe(1);
  });
});

describe("the sequencer", () => {
  const stages: LevelStage[] = [
    { kind: "wave", wave: 0 },
    { kind: "rest", sec: 1 },
    { kind: "travel", sec: 2, toX: 4, toZ: -10 },
    { kind: "boss" },
  ];

  it("starts on the first stage", () => {
    expect(new LevelSequencer(stages).stage.kind).toBe("wave");
  });

  it("doesn't time out a stage with no timer", () => {
    const s = new LevelSequencer(stages);
    expect(s.tick(100)).toBe(false);
    expect(s.progress).toBe(0);
  });

  it("times out a timed stage", () => {
    const s = new LevelSequencer(stages);
    s.next();
    expect(s.tick(0.5)).toBe(false);
    expect(s.progress).toBeCloseTo(0.5);
    expect(s.tick(0.6)).toBe(true);
  });

  it("restarts the clock on each stage", () => {
    const s = new LevelSequencer(stages);
    s.tick(5);
    s.next();
    expect(s.t).toBe(0);
  });

  it("rides the camera smoothly, and arrives exactly", () => {
    const s = new LevelSequencer(stages);
    s.next();
    s.next();
    expect(s.railZ).toBe(0);
    s.tick(0.2);
    const early = s.railZ;
    s.tick(0.8);
    const halfway = s.railZ;
    expect(early).toBeLessThan(0);
    expect(early).toBeGreaterThan(-2);
    expect(halfway).toBeCloseTo(-5);
    s.next();
    expect(s.railX).toBe(4);
    expect(s.railZ).toBe(-10);
  });

  it("stays on the last stage", () => {
    const s = new LevelSequencer([{ kind: "boss" }]);
    expect(s.next().kind).toBe("boss");
  });
});
