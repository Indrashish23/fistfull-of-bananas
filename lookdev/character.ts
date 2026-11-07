// The cowboy monkeys and little lizards. Shape, skeleton and clips come from monkey.glb, which holds
// both on one rig (see blender/build_rigs.py).
// This file holds what varies per character: colours and the sign they carry. Faces: faces.ts.

import type { Paint, ParsedGlb } from "./gltf";
import { readSkinnedMesh } from "./gltf";
import { hex, mix, mul, MeshBuilder } from "./mesh";
import type { RGB } from "./mesh";

export interface Outfit {
  fur: string;
  skin: string;
  poncho: string;
  stripe: string;
  pants: string;
  hat: string;
  band: string;
  scarf: string;
}

/** Each monkey has its own fur and its own skin tone. */
export const OUTFITS: Outfit[] = [
  { fur: "#7A4524", skin: "#F4CFA2", poncho: "#178C96", stripe: "#FFC93C", pants: "#2B3F68", hat: "#3A2316", band: "#E8483A", scarf: "#E8483A" },
  { fur: "#C8813F", skin: "#FFE2C2", poncho: "#C22838", stripe: "#FFF1D0", pants: "#2A2A38", hat: "#F4E7CB", band: "#3A2316", scarf: "#2E9E6B" },
  { fur: "#3B2A22", skin: "#A87553", poncho: "#3D4FC4", stripe: "#FF8A3C", pants: "#3A2A22", hat: "#8A5230", band: "#FFC93C", scarf: "#FFC93C" },
  { fur: "#958B7B", skin: "#E9BBA2", poncho: "#2E9E6B", stripe: "#F4E7CB", pants: "#54302A", hat: "#26222E", band: "#2FBFC8", scarf: "#C22838" },
];

/** The home screen's lizards: scales in fur, shirt in poncho, suspenders in stripe, tie in scarf. iris tints the eyes. */
export const LIZARDS: (Outfit & { iris: string })[] = [
  { fur: "#2F9E3A", skin: "#D6F0B4", poncho: "#3D4FC4", stripe: "#FF8A3C", pants: "#262F7A", hat: "#26222E", band: "#FF8A3C", scarf: "#FF8A3C", iris: "#FFE14D" },
  { fur: "#1F7A4A", skin: "#C4E8B0", poncho: "#FF8A3C", stripe: "#3D4FC4", pants: "#3D4FC4", hat: "#262F7A", band: "#FF8A3C", scarf: "#3D4FC4", iris: "#FFE14D" },
  { fur: "#6FCB32", skin: "#EFFAD0", poncho: "#3D4FC4", stripe: "#FFC93C", pants: "#FF8A3C", hat: "#F4E7CB", band: "#3D4FC4", scarf: "#FF8A3C", iris: "#FFE14D" },
  { fur: "#A4D62E", skin: "#F4FBD0", poncho: "#FF8A3C", stripe: "#262F7A", pants: "#262F7A", hat: "#3D4FC4", band: "#FFC93C", scarf: "#262F7A", iris: "#FFE14D" },
];

/** The molotov throwers: a yellow suit, with flames painted on in the model. */
export const FLAME_LIZARD: Outfit & { iris: string } = { fur: "#3DBE3A", skin: "#E4F7C8", poncho: "#FFD21F", stripe: "#D2261E", pants: "#FFD21F", hat: "#1E1616", band: "#FF7A1A", scarf: "#D2261E", iris: "#FF5A1E" };

export function monkeyPaint(o: Outfit): (material: string) => Paint {
  const fur = hex(o.fur);
  const skin = hex(o.skin);
  const hat = hex(o.hat);
  const palette: Record<string, RGB> = {
    fur,
    skin,
    belly: mix(skin, fur, 0.2),
    earin: mix(skin, fur, 0.45),
    spot: mul(fur, 0.68),
    flameOrange: hex("#FF7A1A"),
    flameRed: hex("#D8201A"),
    poncho: hex(o.poncho),
    stripe: hex(o.stripe),
    scarf: hex(o.scarf),
    pants: hex(o.pants),
    boot: hex("#57301A"),
    sole: hex("#2A170D"),
    hat,
    hatunder: mul(hat, 0.62),
    hatdent: mul(hat, 0.8),
    band: hex(o.band),
  };
  return (m) => {
    const color = palette[m];
    if (!color) throw new Error(`Monkey material "${m}" has no paint`);
    return { color };
  };
}

export interface SignSpec {
  text: string;
  wood: RGB;
  ink: RGB;
}

/** The sign a monkey holds, in bind space. Attached to the rig's sign bone. */
export function buildSign(sign: SignSpec): MeshBuilder {
  const b = new MeshBuilder(77);
  const w = 1.22;
  const h = 0.34;
  const y = 0.92;
  // Far enough forward that hands, chin and tongue stay behind it in every clip the gallery uses.
  const z = 0.82;
  b.uvScale = [2.4, 1.2];
  b.box(-w, y - h, z - 0.05, w, y + h, z + 0.05, sign.wood, {});
  b.box(-w - 0.05, y - h - 0.05, z - 0.03, w + 0.05, y - h + 0.02, z + 0.08, mul(sign.wood, 0.72), {});
  b.box(-w - 0.05, y + h - 0.02, z - 0.03, w + 0.05, y + h + 0.05, z + 0.08, mul(sign.wood, 0.72), {});
  // Two short handles under the board, for the hands to hold, so they never go through it.
  for (const x of [-0.5, 0.5]) b.beam([x, y - h + 0.04, z - 0.03], [x, y - h - 0.32, z - 0.42], 0.05, mul(sign.wood, 0.6), { round: true });
  const hgt = 0.34;
  const px = hgt / 7;
  const fit = (2 * w - 0.22) / (sign.text.length * 6 - 1);
  // Letters carry fog 0, which the character shader reads as "this part can light up". It keeps
  // the sign one mesh, so anything that rebuilds a sign with new text still just works.
  b.fog = 0;
  b.blockText(sign.text, 0, y - hgt / 2, z + 0.06, hgt, sign.ink, 0, Math.min(1.5, fit / px));
  b.fog = 1;
  return b;
}

export function lizardBuffer(g: ParsedGlb, o: Outfit) {
  return readSkinnedMesh(g, monkeyPaint(o), "Reptile");
}

export function flameLizardBuffer(g: ParsedGlb) {
  return readSkinnedMesh(g, monkeyPaint(FLAME_LIZARD), "ReptileFlame");
}

export function monkeyBuffer(g: ParsedGlb, o: Outfit) {
  return readSkinnedMesh(g, monkeyPaint(o));
}

export function buildTumbleweed(c: RGB): MeshBuilder {
  const b = new MeshBuilder(55);
  b.mat = "plain";
  const r = 0.62;
  for (let i = 0; i < 44; i++) {
    const a0 = b.rng.range(0, Math.PI * 2);
    const y0 = b.rng.range(-1, 1);
    const s0 = Math.sqrt(1 - y0 * y0);
    const a1 = a0 + b.rng.range(0.8, 2.3);
    const y1 = y0 + b.rng.range(-1, 1);
    const yy = Math.max(-1, Math.min(1, y1));
    const s1 = Math.sqrt(1 - yy * yy);
    const r0 = r * b.rng.range(0.55, 1);
    const r1 = r * b.rng.range(0.55, 1);
    b.beam(
      [Math.cos(a0) * s0 * r0, y0 * r0, Math.sin(a0) * s0 * r0],
      [Math.cos(a1) * s1 * r1, yy * r1, Math.sin(a1) * s1 * r1],
      0.038,
      b.jitter(c, 0.25),
      { caps: false },
    );
  }
  return b;
}
