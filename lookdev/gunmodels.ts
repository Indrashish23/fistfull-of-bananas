// The guns that aren't the revolver: CC0 models, split into a body, a part that kicks back when it fires, and a
// magazine that drops out for a reload. They're turned to match the revolver, with the barrel along +x and the
// grip at the origin, so they sit in the same hand.

import type { V3 } from "./gl";
import { readAccessor } from "./gltf";
import type { ParsedGlb } from "./gltf";
import { MeshBuilder } from "./mesh";
import type { RGB } from "./mesh";

export interface MagGunSpec {
  /** Units of the source model, to units of the revolver. */
  scale: number;
  /** The middle of the pistol grip in the source model, which ends up in the palm. */
  grip: V3;
  muzzle: V3;
  /** Which nodes kick back on a shot, and which is the magazine. Everything else is the body. */
  slide: readonly string[];
  mag: readonly string[];
  slideBack: number;
}

export const MAG_GUNS = {
  m1911: { scale: 7.6, grip: [0, -0.094, 0.008], muzzle: [1.52, 0.61, 0], slide: ["m1911slide", "m1911hammer"], mag: ["m1911magazine"], slideBack: 0.34 },
  thompson: { scale: 4.3, grip: [0, -0.11, 0.02], muzzle: [1.98, 0.41, 0], slide: ["thompsonbolt"], mag: ["thompsonmagazine"], slideBack: 0.22 },
} as const satisfies Record<string, MagGunSpec>;

export type MagGunName = keyof typeof MAG_GUNS;

export type MetalPaint = (material: string) => RGB;

function rotate(q: readonly number[], v: V3): V3 {
  const [x, y, z, w] = q as [number, number, number, number];
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}

/** Bakes a model's parts into the game's meshes, in this paint. */
export function buildMagGun(g: ParsedGlb, spec: MagGunSpec, paint: MetalPaint): { body: MeshBuilder; slide: MeshBuilder; mag: MeshBuilder } {
  const out = { body: new MeshBuilder(51), slide: new MeshBuilder(52), mag: new MeshBuilder(53) };
  for (const b of Object.values(out)) b.mat = "plain";
  const [, gy, gz] = spec.grip;
  const S = spec.scale;
  for (const node of g.json.nodes as any[]) {
    if (node.mesh === undefined) continue;
    const name: string = node.name;
    const b = spec.slide.includes(name) ? out.slide : spec.mag.includes(name) ? out.mag : out.body;
    const q: number[] = node.rotation ?? [0, 0, 0, 1];
    const t: number[] = node.translation ?? [0, 0, 0];
    for (const prim of g.json.meshes[node.mesh].primitives as any[]) {
      const color = paint(g.json.materials[prim.material]?.name ?? "metal");
      const pos = readAccessor(g, prim.attributes.POSITION).data;
      const nor = readAccessor(g, prim.attributes.NORMAL).data;
      const idx = readAccessor(g, prim.indices).data;
      const point = (i: number): V3 => {
        const r = rotate(q, [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!]);
        return [-(r[2] + t[2]! - gz) * S, (r[1] + t[1]! - gy) * S, (r[0] + t[0]!) * S];
      };
      const normal = (i: number): V3 => {
        const n = rotate(q, [nor[i * 3]!, nor[i * 3 + 1]!, nor[i * 3 + 2]!]);
        return [-n[2], n[1], n[0]];
      };
      for (let k = 0; k < idx.length; k += 3) {
        const [a, c, d] = [idx[k]!, idx[k + 1]!, idx[k + 2]!];
        b.triFull(point(a), point(c), point(d), color, color, color, [normal(a), normal(c), normal(d)]);
      }
    }
  }
  return out;
}
