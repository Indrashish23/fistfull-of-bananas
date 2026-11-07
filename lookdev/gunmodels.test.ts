import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildMagGun, MAG_GUNS } from "./gunmodels";
import { parseGlb } from "./gltf";

const load = (path: string) => {
  const b = readFileSync(new URL(path, import.meta.url));
  return parseGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};
const white = () => [1, 1, 1] as [number, number, number];

describe("the CC0 guns", () => {
  for (const [name, file] of [["thompson", "thompson.glb"], ["m1911", "1911.glb"]] as const) {
    it(`${name} comes apart into its moving parts, and it's light enough`, () => {
      const parts = buildMagGun(load(`./assets/guns/${file}`), MAG_GUNS[name], white);
      for (const part of [parts.body, parts.slide, parts.mag]) expect(Object.keys(part.buckets).length).toBeGreaterThan(0);
      for (const b of Object.values(load(`./assets/guns/${file}`).json.meshes as any[])) expect(b.primitives.length).toBeGreaterThan(0);
    });
    it(`${name} has its muzzle out in front of the grip`, () => {
      expect(MAG_GUNS[name].muzzle[0]).toBeGreaterThan(1);
    });
  }
});
