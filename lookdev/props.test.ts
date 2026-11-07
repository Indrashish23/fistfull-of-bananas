import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { flameLizardBuffer, lizardBuffer, LIZARDS, monkeyBuffer, OUTFITS } from "./character";
import { parseGlb, readSkeleton } from "./gltf";
import { propBuilder } from "./props";

const load = (path: string) => {
  const b = readFileSync(new URL(path, import.meta.url));
  return parseGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};

describe("props", () => {
  for (const name of ["barrel", "machete", "axe", "club", "molotov"]) {
    it(`${name} is painted, light enough, and uses materials the renderer has`, () => {
      const g = load(`./assets/props/${name}.glb`);
      const builder = propBuilder(g);
      const buckets = Object.keys(builder.buckets);
      expect(buckets.length).toBeGreaterThan(0);
      for (const b of buckets) expect(["wood", "plain"]).toContain(b);
      let tris = 0;
      for (const p of g.json.meshes[0].primitives as any[]) {
        expect(p.attributes.COLOR_0).toBeDefined();
        tris += g.json.accessors[p.indices].count / 3;
      }
      expect(tris).toBeLessThan(2000);
    });
  }
});

describe("monkey.glb", () => {
  const g = load("./assets/monkey.glb");

  it("keeps the monkey first, since anything reading the default mesh expects it", () => {
    expect(g.json.meshes[0].name).toBe("Monkey");
  });

  it("keeps the 21 joints the ragdoll depends on", () => {
    expect(g.json.skins[0].joints.length).toBe(21);
  });

  it("has rush mode's clips", () => {
    const clips = readSkeleton(g).clips;
    for (const name of ["run", "run_weapon", "swing", "throw", "waddle", "shield_walk", "shield_hit", "peek_l", "peek_r", "idle_molotov", "shield_carry", "shield_idle", "shield_raise", "push_cannon", "splat"]) expect(clips.has(name)).toBe(true);
  });

  it("paints every material on all three characters", () => {
    expect(monkeyBuffer(g, OUTFITS[0]).count).toBeGreaterThan(0);
    expect(lizardBuffer(g, LIZARDS[0]).count).toBeGreaterThan(0);
    expect(flameLizardBuffer(g).count).toBeGreaterThan(0);
  });
});
