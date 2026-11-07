import { describe, expect, it } from "vitest";
import { P, Ragdoll, type Impact, type RagZone } from "./ragdoll";

function fall(zone: RagZone, landing: Impact["landing"], power = 0.7, facing: 1 | -1 = 1): Ragdoll {
  const rag = new Ragdoll(0, 0, facing);
  rag.hit({ zone, landing, power });
  rag.settle(3);
  return rag;
}

const HEAD = { x: 0, y: 1.8, z: 0 };
const NUTS = { x: 0, y: 0.62, z: 0 };
const CHEST = { x: 0, y: 1.05, z: 0 };

describe("the ragdoll", () => {
  it("ends up lying down, whatever hit it", () => {
    for (const [zone, landing] of [["head", HEAD], ["nuts", NUTS], ["body", CHEST]] as const) {
      const rag = fall(zone, landing);
      const head = rag.points[P.head]!;
      const pelvis = rag.points[P.pelvis]!;
      expect(head[1]).toBeLessThan(1.1);
      expect(pelvis[1]).toBeLessThan(0.7);
    }
  });

  it("stays above the ground and in one piece", () => {
    const rag = fall("head", HEAD, 1);
    for (const point of rag.points) {
      expect(point[1]).toBeGreaterThan(0);
      for (const v of point) expect(Number.isFinite(v)).toBe(true);
    }
    const headToPelvis = Math.hypot(
      rag.points[P.head]![0] - rag.points[P.pelvis]![0],
      rag.points[P.head]![1] - rag.points[P.pelvis]![1],
      rag.points[P.head]![2] - rag.points[P.pelvis]![2],
    );
    expect(headToPelvis).toBeLessThan(1.3);
    expect(headToPelvis).toBeGreaterThan(0.6);
  });

  it("comes to rest", () => {
    expect(fall("body", CHEST).speed()).toBeLessThan(0.2);
  });

  it("throws a body backward on a headshot", () => {
    const rag = fall("head", HEAD);
    expect(rag.points[P.head]![2]).toBeLessThan(-1);
  });

  it("falls the other way when facing the other way", () => {
    const rag = fall("head", HEAD, 0.7, -1);
    expect(rag.points[P.head]![2]).toBeGreaterThan(1);
  });

  it("drops a nut shot closer to its feet than a headshot", () => {
    const head = fall("head", HEAD);
    const nuts = fall("nuts", NUTS);
    expect(Math.abs(nuts.points[P.pelvis]![2])).toBeLessThan(Math.abs(head.points[P.pelvis]![2]));
  });

  it("folds a nut shot forward, head past the hips", () => {
    const rag = fall("nuts", NUTS);
    expect(rag.points[P.head]![2]).toBeGreaterThan(rag.points[P.pelvis]![2]);
    const away = fall("nuts", NUTS, 0.7, -1);
    expect(away.points[P.head]![2]).toBeLessThan(away.points[P.pelvis]![2]);
  });

  it("brings the hands in to the crotch during a nut shot", () => {
    const rag = new Ragdoll(0, 0, 1);
    rag.hit({ zone: "nuts", landing: NUTS, power: 0.7 });
    rag.settle(0.6);
    const hand = rag.points[P.haL]!;
    const pelvis = rag.points[P.pelvis]!;
    expect(Math.hypot(hand[0] - pelvis[0], hand[1] - pelvis[1], hand[2] - pelvis[2])).toBeLessThan(0.7);
  });

  it("throws harder when the shout was louder", () => {
    const quiet = fall("body", CHEST, 0);
    const loud = fall("body", CHEST, 1);
    expect(loud.points[P.pelvis]![2]).toBeLessThan(quiet.points[P.pelvis]![2]);
  });

  it("falls differently depending on the side that was hit", () => {
    const left = fall("body", { x: -0.5, y: 1.05, z: 0 });
    const right = fall("body", { x: 0.5, y: 1.05, z: 0 });
    expect(left.points[P.head]![0]).toBeLessThan(right.points[P.head]![0]);
  });

  it("repeats exactly from the same hit", () => {
    expect(fall("body", CHEST).points).toEqual(fall("body", CHEST).points);
  });
});
