import { describe, expect, it } from "vitest";
import { BOSS, BossBrain, type BossBody } from "./boss";

function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647), s / 2147483647);
}

const make = (seed = 7): { body: BossBody; brain: BossBrain } => {
  const body: BossBody = { x: 0, y: 0, ducking: 0 };
  return { body, brain: new BossBrain(body, seeded(seed)) };
};

const DT = 1 / 60;

describe("how Big Gat moves", () => {
  it("uses every move, and stays in the arena and on or above the ground", () => {
    for (const seed of [3, 7, 11, 19]) {
      const { body, brain } = make(seed);
      const seen = new Set<string>();
      for (let i = 0; i < 60 * 40; i++) {
        brain.step(DT);
        seen.add(brain.move);
        expect(Math.abs(body.x)).toBeLessThanOrEqual(BOSS.arenaHalf + 1e-6);
        expect(body.y).toBeGreaterThanOrEqual(0);
      }
      for (const move of ["idle", "strafe", "dash", "jump", "land", "duck"]) expect(seen.has(move)).toBe(true);
    }
  });

  it("gets clear across the arena in a dash", () => {
    const { body, brain } = make();
    (brain as unknown as { dash(dir: number): void }).dash(1);
    const from = body.x;
    for (let i = 0; i < 60 * BOSS.dashSec; i++) brain.step(DT);
    expect(body.x - from).toBeGreaterThan(BOSS.dashMin * 0.9);
  });

  it("leans before a dash, so it can just about be read", () => {
    const { body, brain } = make();
    (brain as unknown as { dash(dir: number): void }).dash(1);
    brain.step(BOSS.dashWindup * 0.5);
    expect(body.x).toBe(0);
  });

  it("gets off the ground and comes back down in a jump", () => {
    const { body, brain } = make();
    (brain as unknown as { jump(): void }).jump();
    let top = 0;
    while (brain.move === "jump") {
      brain.step(DT);
      top = Math.max(top, body.y);
    }
    expect(top).toBeGreaterThan(BOSS.jumpHeight * 0.9);
    expect(body.y).toBe(0);
    expect(brain.move).toBe("land");
  });

  it("counts as ducked only while ducking", () => {
    const { body, brain } = make();
    (brain as unknown as { begin(move: string, dur: number): void }).begin("duck", BOSS.duckSec);
    expect(body.ducking).toBeGreaterThan(0);
    for (let i = 0; i < 60 * (BOSS.duckSec + 0.05); i++) brain.step(DT);
    expect(body.ducking).toBe(0);
  });

  it("shows his heart only for a moment, then moves on", () => {
    const { brain } = make();
    expect(brain.reveal()).toBe(true);
    expect(brain.heartOpen).toBe(true);
    for (let i = 0; i < 60 * (BOSS.revealSec + 0.05); i++) brain.step(DT);
    expect(brain.heartOpen).toBe(false);
  });

  it("can't show his heart in mid air", () => {
    const { brain } = make();
    (brain as unknown as { jump(): void }).jump();
    expect(brain.reveal()).toBe(false);
  });

  it("doesn't dart off while he's showing his heart or firing", () => {
    const { brain } = make();
    brain.reveal();
    for (let i = 0; i < 50; i++) brain.react();
    expect(brain.move).toBe("reveal");
    brain.charge();
    for (let i = 0; i < 50; i++) brain.react();
    expect(brain.move).toBe("charge");
  });

  it("sometimes darts away when shot at", () => {
    const { brain } = make();
    let dashed = false;
    for (let i = 0; i < 40 && !dashed; i++) {
      brain.loosen();
      brain.react();
      dashed = brain.move === "dash";
    }
    expect(dashed).toBe(true);
  });

  it("holds the gun steady until told otherwise, and comes down from a jump for it", () => {
    const { body, brain } = make();
    body.y = 2;
    brain.charge(0.3);
    for (let i = 0; i < 60; i++) brain.step(DT);
    expect(brain.move).toBe("charge");
    expect(body.y).toBe(0);
  });
});
