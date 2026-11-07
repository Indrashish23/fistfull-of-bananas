// Rush mode's props: an explosive barrel, three melee weapons and a molotov. Shape and paint come from
// assets/props/<name>.glb, built by blender/build_props.py. Paint is per-corner colour, and wood picks up
// the game's grain texture through its UVs, so a prop is a MeshBuilder ready for renderer.uploadMesh.

import { invert, multiply, rotationX, transformPoint, translation } from "./gl";
import type { Mat4, V3 } from "./gl";
import { Rig, parseGlb, readAccessor } from "./gltf";
import type { ParsedGlb, Skeleton } from "./gltf";
import { MeshBuilder } from "./mesh";
import type { Mat, RGB } from "./mesh";

/** Each file's URL. Literal paths, so the bundler picks them up. */
export const PROP_URLS = {
  barrel: new URL("./assets/props/barrel.glb", import.meta.url).href,
  machete: new URL("./assets/props/machete.glb", import.meta.url).href,
  axe: new URL("./assets/props/axe.glb", import.meta.url).href,
  club: new URL("./assets/props/club.glb", import.meta.url).href,
  molotov: new URL("./assets/props/molotov.glb", import.meta.url).href,
  shield: new URL("./assets/props/shield.glb", import.meta.url).href,
  shield_shot: new URL("./assets/props/shield_shot.glb", import.meta.url).href,
  shield_wrecked: new URL("./assets/props/shield_wrecked.glb", import.meta.url).href,
  shield_plank: new URL("./assets/props/shield_plank.glb", import.meta.url).href,
  wagon_wreck: new URL("./assets/props/wagon_wreck.glb", import.meta.url).href,
  crate_pile: new URL("./assets/props/crate_pile.glb", import.meta.url).href,
  porch_wreck: new URL("./assets/props/porch_wreck.glb", import.meta.url).href,
  stable: new URL("./assets/props/stable.glb", import.meta.url).href,
  gold_bars: new URL("./assets/props/gold_bars.glb", import.meta.url).href,
  cash: new URL("./assets/props/cash.glb", import.meta.url).href,
  vault_door: new URL("./assets/props/vault_door.glb", import.meta.url).href,
  bank_ruin: new URL("./assets/props/bank_ruin.glb", import.meta.url).href,
  arena_floor: new URL("./assets/props/arena_floor.glb", import.meta.url).href,
  stake: new URL("./assets/props/stake.glb", import.meta.url).href,
  cannon: new URL("./assets/props/cannon.glb", import.meta.url).href,
  cannonball: new URL("./assets/props/cannonball.glb", import.meta.url).href,
  grand_bank: new URL("./assets/props/grand_bank.glb", import.meta.url).href,
  stand: new URL("./assets/props/stand.glb", import.meta.url).href,
  crowd: new URL("./assets/props/crowd.glb", import.meta.url).href,
  fence: new URL("./assets/props/fence.glb", import.meta.url).href,
  poster: new URL("./assets/props/poster.glb", import.meta.url).href,
  torch: new URL("./assets/props/torch.glb", import.meta.url).href,
  heart: new URL("./assets/props/heart.glb", import.meta.url).href,
};

export type PropName = keyof typeof PROP_URLS;

/** Turns a parsed prop file into a MeshBuilder, keeping its paint, UVs and normals. */
export function propBuilder(g: ParsedGlb): MeshBuilder {
  const b = new MeshBuilder(1);
  for (const p of g.json.meshes[0].primitives as any[]) {
    b.mat = (g.json.materials[p.material]?.name ?? "plain") as Mat;
    const pos = readAccessor(g, p.attributes.POSITION).data;
    const nor = readAccessor(g, p.attributes.NORMAL).data;
    const uv = readAccessor(g, p.attributes.TEXCOORD_0).data;
    const col = readAccessor(g, p.attributes.COLOR_0);
    const scale = col.data instanceof Uint16Array ? 1 / 65535 : col.data instanceof Uint8Array ? 1 / 255 : 1;
    const idx = readAccessor(g, p.indices).data;
    const point = (i: number): V3 => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const normal = (i: number): V3 => [nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]];
    const color = (i: number): RGB => [col.data[i * col.size] * scale, col.data[i * col.size + 1] * scale, col.data[i * col.size + 2] * scale];
    const tex = (i: number): [number, number] => [uv[i * 2], uv[i * 2 + 1]];
    for (let k = 0; k < idx.length; k += 3) {
      const [x, y, z] = [idx[k], idx[k + 1], idx[k + 2]];
      b.triFull(point(x), point(y), point(z), color(x), color(y), color(z), [normal(x), normal(y), normal(z)], [tex(x), tex(y), tex(z)]);
    }
  }
  return b;
}

/** Fetches every prop, ready for renderer.uploadMesh. */
export async function loadPropBuilders(): Promise<Record<PropName, MeshBuilder>> {
  const names = Object.keys(PROP_URLS) as PropName[];
  const builders = await Promise.all(
    names.map(async (n) => {
      const res = await fetch(PROP_URLS[n]);
      return propBuilder(parseGlb(await res.arrayBuffer()));
    }),
  );
  return Object.fromEntries(names.map((n, i) => [n, builders[i]])) as Record<PropName, MeshBuilder>;
}

/**
 * Where a held prop sits in the character's bind pose: at the right palm, its +Y pointing forward. With
 * the arm hanging, a weapon held this way points straight ahead, so raising the arm raises the weapon.
 */
export const GRIP: Mat4 = multiply(translation(0.785, 0.34, 0.12), rotationX(Math.PI / 2));

/** The model matrix for a prop held in the right hand of a character drawn at this model matrix. */
export function heldMatrix(model: Mat4, rig: Rig): Mat4 {
  return multiply(multiply(model, rig.boneMatrix("hand.R")), GRIP);
}

/** How far in front of the hands the shield's boards sit. */
const SHIELD_OUT = 0.1;
/** The wrists at rest, where the hand bones pivot. */
const WRIST_L: V3 = [-0.76, 0.48, 0.08];
const WRIST_R: V3 = [0.76, 0.48, 0.08];

/**
 * The shield hangs off the left hand. Rather than being worked out by hand, its grip is read from the
 * clip: wherever the two hands are once it's raised, the shield goes between them, upright, with its edges in
 * their fingers. From then on it just follows the left hand, through the carry and the lift.
 */
export function shieldGrip(skeleton: Skeleton): Mat4 {
  const rig = new Rig(skeleton);
  rig.play("shield_walk", 0, { fade: 0 });
  rig.update(0);
  const left = rig.boneMatrix("hand.L");
  const a = transformPoint(left, WRIST_L);
  const b = transformPoint(rig.boneMatrix("hand.R"), WRIST_R);
  return multiply(invert(left), translation((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + SHIELD_OUT));
}

/** The model matrix for a shield held by a character drawn at this model matrix. */
export function shieldMatrix(model: Mat4, rig: Rig, grip: Mat4): Mat4 {
  return multiply(multiply(model, rig.boneMatrix("hand.L")), grip);
}
