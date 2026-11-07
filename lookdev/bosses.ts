// The two boss outlaws: flat-colour paint and game facts. Shape, skeleton and clips come from
// assets/bosses/<id>.glb, built by blender/build_bosses.py in the same style as the home screen's
// lizards. Every boss has idle, pose and fire clips. Big Gat also has steal, walking out with the sack.

import { buildFaceGrid } from "./faces";
import type { EyeCell, FaceGrid, MouthCell } from "./faces";
import { multiply } from "./gl";
import type { Mat4 } from "./gl";
import { parseGlb, readSkeleton, readSkinnedMesh, Rig } from "./gltf";
import type { Skeleton } from "./gltf";
import { hex } from "./mesh";
import type { RGB } from "./mesh";
import type { FaceDraw, GpuMesh, Renderer } from "./renderer";

export type BossId = "gator" | "snake" | "bird";

export interface BossDef {
  id: BossId;
  name: string;
  weapon: string;
  /** Flat colour behind it in its split-screen panel. */
  panel: string;
  /** Its close-up: what the camera looks at, how tall the frame is, the angle round it, and how low. */
  close: { at: [number, number, number]; frame: number; yaw: number; low: number; split?: number };
  /** The flat mouth drawn on its face. A beak needs none. */
  mouth: MouthCell;
  paint: Record<string, string>;
}

const SHARED = {
  ink: "#120A0C",
  gunmetal: "#2B2C36",
  steel: "#6C7280",
  brass: "#E2A52C",
  wood: "#7A3F1E",
  tooth: "#F7F0DC",
  band: "#C8261E",
};

export const BOSSES: BossDef[] = [
  {
    id: "gator",
    name: "BIG GAT",
    weapon: "Minigun",
    panel: "#E8712A",
    close: { at: [-0.5, 3.1, 0.9], frame: 7.2, yaw: 0.3, low: 0.12 },
    mouth: "evilGrin",
    paint: {
      ...SHARED,
      iris: "#FF5A1E",
      hide: "#2F7A3C",
      belly: "#C8C48A",
      spot: "#17452A",
      suit: "#1C1A26",
      lapel: "#0F0E16",
      shirt: "#34303A",
      belt: "#3A2316",
      claw: "#1B1218",
      hat: "#2A1A20",
      drum: "#3A3C48",
      sack: "#D4B078",
    },
  },
  {
    id: "snake",
    name: "SAL SIDEWINDER",
    weapon: "Crossbow",
    panel: "#EDBB2E",
    close: { at: [-0.1, 2.9, 0.8], frame: 5.3, yaw: 0.26, low: 0.14 },
    mouth: "tongue",
    paint: {
      ...SHARED,
      iris: "#FF8A3C",
      scale: "#B8452E",
      belly: "#F0D8A0",
      diamond: "#4A1820",
      suit: "#5A2E6B",
      lapel: "#3C1C4C",
      shirt: "#F7F2E2",
      claw: "#1B1218",
      hat: "#1F1420",
      rattle: "#E9D29A",
    },
  },
];

/** Modelled and ready for loadBoss, but not in the intro's cast. */
export const BIRD: BossDef = {
  id: "bird",
  name: "JUDGE BUZZARD",
  weapon: "Long rifle",
  panel: "#C42E2A",
  close: { at: [-0.05, 3.4, 0.7], frame: 5.2, yaw: 0.5, low: 0.1 },
  mouth: "blank",
  paint: {
    ...SHARED,
    iris: "#F7F0A0",
    bare: "#E88A78",
    beak: "#F2C24A",
    beak2: "#C9963A",
    ruff: "#F7F2E2",
    coat: "#1E1A2A",
    shirt: "#F4E7D8",
    pants: "#3A3048",
    feather: "#2A2438",
    feather2: "#3D3550",
    leg: "#E8B84A",
    claw: "#1B1218",
    hat: "#0E0A12",
  },
};

export interface BossInstance {
  def: BossDef;
  mesh: GpuMesh;
  rig: Rig;
  skeleton: Skeleton;
  /** The flat face sheet, in bind space, and the colour that tints its eyes. */
  faceSheet: GpuMesh;
  iris: RGB;
}

/** How a boss's face is reacting right now. Leave these out for its usual look. */
export interface BossMood {
  eye?: EyeCell;
  mouth?: MouthCell;
}

/** The flat face for a boss drawn at this model matrix. It blinks now and then. */
export function bossFace(b: BossInstance, model: Mat4, time: number, seed: number, mood: BossMood = {}): FaceDraw {
  const blink = (time + seed * 1.7) % 3.4 < 0.1;
  const eye = mood.eye ?? (blink ? "evilBlink" : "evil");
  return { mesh: b.faceSheet, model: multiply(model, b.rig.boneMatrix("head")), eye, mouth: mood.mouth ?? b.def.mouth, skin: b.iris, plate: "blank" };
}

export async function loadBoss(renderer: Renderer, def: BossDef): Promise<BossInstance> {
  const res = await fetch(new URL(`./assets/bosses/${def.id}.glb`, import.meta.url));
  const glb = parseGlb(await res.arrayBuffer());
  const skeleton = readSkeleton(glb);
  const colors: Record<string, RGB> = {};
  for (const [k, v] of Object.entries(def.paint)) colors[k] = hex(v);
  const b = readSkinnedMesh(glb, (m) => {
    const color = colors[m];
    if (!color) throw new Error(`${def.id}: material "${m}" has no paint`);
    return { color };
  });
  const grid = (await (await fetch(new URL(`./assets/bosses/${def.id}.face.json`, import.meta.url))).json()) as FaceGrid;
  return {
    def,
    mesh: renderer.uploadSkinned(b.data, b.count),
    rig: new Rig(skeleton),
    skeleton,
    faceSheet: renderer.uploadMesh(buildFaceGrid(grid)),
    iris: colors.iris,
  };
}
