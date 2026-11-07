// Monkey faces are flat vector art: SVG drawn into one atlas, with eyes and mouth as separate
// cells so they can change independently. The SVG uses key colours, not final ones: red is skin,
// green is white, blue is tongue and black is ink. The shader swaps in each monkey's real colours,
// so every skin tone shares one texture.

import { LIZARD_FACE } from "./lizardFaceData";
import { MeshBuilder } from "./mesh";
import type { V3 } from "./gl";

const COLS = 8;
const ROWS = 3;

const SKIN = "#F00";
const WHITE = "#0F0";
const TONGUE = "#00F";
const INK = "#000";

const line = (d: string, w = 3.6) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const both = (fn: (x: number, s: number) => string) => fn(36, -1) + fn(64, 1);
const oval = (x: number, y: number, rx: number, ry: number, c: string) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${c}"/>`;

/** The plain open eye: a tall ink oval with one bright highlight. */
const openEye = (x: number) => oval(x, 46, 7.6, 10.5, INK) + oval(x - 2.6, 41.5, 2.7, 3.4, WHITE);

/** A lizard's almond of an eye, tilted down toward the nose. */
const almond = (x: number, s: number) => `M${x + s * 13} 35 Q${x} 33 ${x - s * 13} 49 Q${x} 59 ${x + s * 13} 35Z`;

/** Each cell is a 100 x 100 square covering the head. Eyes sit around y 46, mouth around y 70. */
const EYE_ART: Record<string, string> = {
  open: both((x) => openEye(x)),
  blink: both((x) => line(`M${x - 8.5} 47 Q${x} 40 ${x + 8.5} 47`)),
  wide: both((x) => oval(x, 46, 11.5, 13, WHITE) + `<ellipse cx="${x}" cy="46" rx="11.5" ry="13" fill="none" stroke="${INK}" stroke-width="2.6"/>` + oval(x, 47, 3.6, 4.2, INK)),
  sideL: both((x) => oval(x, 46, 10, 11.5, WHITE) + `<ellipse cx="${x}" cy="46" rx="10" ry="11.5" fill="none" stroke="${INK}" stroke-width="2.6"/>` + oval(x - 4.2, 46, 4.8, 6.4, INK)),
  sideR: both((x) => oval(x, 46, 10, 11.5, WHITE) + `<ellipse cx="${x}" cy="46" rx="10" ry="11.5" fill="none" stroke="${INK}" stroke-width="2.6"/>` + oval(x + 4.2, 46, 4.8, 6.4, INK)),
  x: both((x) => line(`M${x - 7} 39 L${x + 7} 53 M${x + 7} 39 L${x - 7} 53`, 4.4)),
  // Brows angle down toward the nose, into a scowl.
  angry: both((x, s) => openEye(x) + line(`M${x + s * 10} 33 L${x - s * 9} 39.5`, 4.6)),
  // A narrowed, steely stare: lids cut across the top and bottom of the eye, under a low brow.
  // The lizards. Skin colour tints the eye, so each lizard can have its own.
  evil: both((x, s) => `<path d="${almond(x, s)}" fill="${SKIN}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>` + oval(x - s * 0.5, 45.5, 2.3, 7.6, INK) + line(`M${x + s * 15} 31 L${x - s * 15} 47`, 5)),
  evilBlink: both((x, s) => line(`M${x + s * 14} 36 Q${x} 44 ${x - s * 13} 49`, 4.6) + line(`M${x + s * 15} 31 L${x - s * 15} 47`, 5)),
  evilWide: both((x) => oval(x, 45, 12.5, 14, SKIN) + `<ellipse cx="${x}" cy="45" rx="12.5" ry="14" fill="none" stroke="${INK}" stroke-width="2.6"/>` + oval(x, 46, 2.2, 3.4, INK)),
  // Furious: a small burning pupil under a brow slammed right down.
  evilRage: both((x, s) => `<path d="${almond(x, s)}" fill="${SKIN}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>` + oval(x - s * 0.5, 47, 2, 3, INK) + line(`M${x + s * 16} 29 L${x - s * 15} 49`, 7.5)),
  // Screwed shut in pain.
  evilPain: both((x, s) => line(`M${x + s * 11} 38 L${x - s * 9} 46 L${x + s * 11} 54`, 5)),
  squint: both((x, s) => openEye(x) + `<rect x="${x - 13}" y="31" width="26" height="12" fill="${SKIN}"/><rect x="${x - 13}" y="52" width="26" height="10" fill="${SKIN}"/>` + line(`M${x - 10} 52 Q${x} 54 ${x + 10} 52`, 2.4) + line(`M${x + s * 11} 37 L${x - s * 10} 44`, 5.6)),
};

const MOUTH_ART: Record<string, string> = {
  blank: "",
  // A pointed grin full of teeth.
  evilGrin: `<path d="M30 60 L70 60 L50 86Z" fill="${INK}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/><path d="M33 60.5 L37 67 L41 60.5 L45 68 L50 60.5 L55 68 L59 60.5 L63 67 L67 60.5Z" fill="${WHITE}"/>`,
  // A huge open roar, with fangs top and bottom.
  roar: `<path d="M24 56 Q50 50 76 56 Q82 92 50 96 Q18 92 24 56Z" fill="${INK}"/><path d="M28 57.5 L34 69 L40 56 L46 70 L54 70 L60 56 L66 69 L72 57.5Z" fill="${WHITE}"/><path d="M34 90 L39 81 L45 92 L55 92 L61 81 L66 90Z" fill="${WHITE}"/><path d="M42 84 Q50 76 58 84 Q56 90 50 90 Q44 90 42 84Z" fill="${TONGUE}"/>`,
  // Mouth wide in a nasty laugh.
  evilLaugh: `<path d="M28 58 L72 58 Q70 88 50 88 Q30 88 28 58Z" fill="${INK}"/><path d="M31 58.5 L36 66 L41 58.5 L46 67 L50 58.5 L54 67 L59 58.5 L64 66 L69 58.5Z" fill="${WHITE}"/><path d="M40 78 Q50 71 60 78 Q58 86 50 86.5 Q42 86 40 78Z" fill="${TONGUE}"/>`,
  smile: line("M39 66 Q50 75 61 66"),
  // Open mouth: flat black, with a flat tongue. This is the shouting face.
  openA: `<path d="M33 60 Q50 55 67 60 Q72 87 50 90 Q28 87 33 60Z" fill="${INK}"/><path d="M38 79 Q50 69 62 79 Q60 88 50 88.6 Q40 88 38 79Z" fill="${TONGUE}"/>`,
  openB: `<path d="M36 61 Q50 57 64 61 Q68 83 50 86 Q32 83 36 61Z" fill="${INK}"/><path d="M40 76 Q50 68 60 76 Q58 83.6 50 84.6 Q42 83.6 40 76Z" fill="${TONGUE}"/>`,
  tongue: `<path d="M35 62 Q50 72 65 62 Q62 73 50 74 Q38 73 35 62Z" fill="${INK}"/><path d="M42 68 L58 68 L58 79 Q50 90 42 79Z" fill="${TONGUE}"/>` + line("M50 71 L50 79", 1.8),
  worried: line("M37 71 q4.3 -5 8.6 0 t8.6 0 t8.6 0"),
  grit: `<rect x="35" y="62" width="30" height="13" rx="4.5" fill="${WHITE}" stroke="${INK}" stroke-width="2.8"/>` + line("M42.5 62.5 V74.5 M50 62.5 V74.5 M57.5 62.5 V74.5 M35.5 68.5 H64.5", 1.9),
};

/** Heart-shaped bare skin, and a small nose. */
const PLATE = `<path d="M50 33 C42 20 19 21 15 41 C13 54 20 65 25 71 C33 90 67 90 75 71 C80 65 87 54 85 41 C81 21 58 20 50 33Z" fill="${SKIN}"/>${oval(46.6, 60.4, 1.5, 1.2, INK)}${oval(53.4, 60.4, 1.5, 1.2, INK)}`;

export type EyeCell = "open" | "blink" | "wide" | "sideL" | "sideR" | "x" | "angry" | "squint" | "evil" | "evilBlink" | "evilWide" | "evilRage" | "evilPain";
export type MouthCell = "smile" | "openA" | "openB" | "tongue" | "worried" | "grit" | "blank" | "evilGrin" | "roar" | "evilLaugh";

const CELLS: Record<string, [number, number]> = {
  open: [0, 0],
  blink: [1, 0],
  wide: [2, 0],
  sideL: [3, 0],
  sideR: [4, 0],
  x: [5, 0],
  smile: [0, 1],
  openA: [1, 1],
  openB: [2, 1],
  tongue: [3, 1],
  worried: [4, 1],
  grit: [5, 1],
  plate: [0, 2],
  angry: [1, 2],
  squint: [2, 2],
  blank: [3, 2],
  evil: [6, 0],
  evilBlink: [7, 0],
  evilWide: [6, 1],
  evilGrin: [7, 1],
  evilRage: [4, 2],
  evilPain: [5, 2],
  roar: [6, 2],
  evilLaugh: [7, 2],
};

export const cellOffset = (name: string): [number, number] => {
  const [c, r] = CELLS[name];
  return [c / COLS, r / ROWS];
};
export const CELL_SIZE: [number, number] = [1 / COLS, 1 / ROWS];

export function faceSvg(): string {
  const W = 2048;
  const H = 1024;
  const cw = W / COLS;
  const ch = H / ROWS;
  const cell = (name: string, art: string) => {
    const [c, r] = CELLS[name];
    return `<svg x="${c * cw}" y="${r * ch}" width="${cw}" height="${ch}" viewBox="0 0 100 100" preserveAspectRatio="none">${art}</svg>`;
  };
  const parts = [
    ...Object.entries(EYE_ART).map(([k, v]) => cell(k, v)),
    ...Object.entries(MOUTH_ART).map(([k, v]) => cell(k, v)),
    cell("plate", PLATE),
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

export async function faceAtlas(): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(faceSvg())}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 1024;
  c.getContext("2d")!.drawImage(img, 0, 0, 2048, 1024);
  return c;
}

/** Thin curved sheet that hugs the front of the head, in the rig's bind space. */
export function buildFaceSheet(): MeshBuilder {
  const b = new MeshBuilder(3);
  b.mat = "plain";
  const H: V3 = [0, 1.74, 0];
  const R: V3 = [0.65, 0.58, 0.56];
  const half = 0.62;
  const n = 18;
  const white: [number, number, number] = [1, 1, 1];
  const at = (u: number, v: number): V3 => {
    const x = (u * 2 - 1) * half;
    const y = H[1] + (1 - v * 2) * half;
    const q = 1 - (x / R[0]) ** 2 - ((y - H[1]) / R[1]) ** 2;
    const z = Math.sqrt(Math.max(0, q)) * R[2] + 0.014;
    return [x, y, z];
  };
  const up: V3 = [0, 0, 1];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u0 = i / n;
      const u1 = (i + 1) / n;
      const v0 = j / n;
      const v1 = (j + 1) / n;
      b.quadUV(at(u0, v1), at(u1, v1), at(u1, v0), at(u0, v0), [u0, v1], [u1, v1], [u1, v0], [u0, v0], white, white, white, white, up);
    }
  }
  return b;
}

/** A face sheet fitted to a head, from a grid baked in Blender. Null points are off the head. */
export type FaceGrid = (null | [number, number, number])[][];

export function buildFaceGrid(grid: FaceGrid): MeshBuilder {
  const b = new MeshBuilder(3);
  b.mat = "plain";
  const n = grid.length - 1;
  const white: [number, number, number] = [1, 1, 1];
  const up: V3 = [0, 0, 1];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = grid[j + 1][i];
      const c = grid[j + 1][i + 1];
      const d = grid[j][i + 1];
      const e = grid[j][i];
      if (!a || !c || !d || !e) continue;
      const u0 = i / n;
      const u1 = (i + 1) / n;
      const v0 = j / n;
      const v1 = (j + 1) / n;
      b.quadUV(a, c, d, e, [u0, v1], [u1, v1], [u1, v0], [u0, v0], white, white, white, white, up);
    }
  }
  return b;
}

export const buildLizardFaceSheet = () => buildFaceGrid(LIZARD_FACE);

/** What a monkey face expression looks like on a lizard. */
const LIZARD_EYES: Record<string, EyeCell> = { open: "evil", blink: "evilBlink", wide: "evilWide", sideL: "evilWide", sideR: "evilWide", angry: "evil", squint: "evil", x: "x" };

export const lizardEye = (eye: string): EyeCell => LIZARD_EYES[eye] ?? "evil";
export const lizardMouth = (mouth: string): MouthCell => (mouth === "smile" ? "evilGrin" : (mouth as MouthCell));

/** Picks the eyes and mouth for what a monkey is doing, and blinks at natural, uneven intervals. */
export class FaceAnim {
  eye: EyeCell = "open";
  mouth: MouthCell = "smile";
  private nextBlink: number;
  private blinkStart = -10;
  private nextChange = 0;
  private flip = false;

  constructor(seed: number) {
    this.nextBlink = 1 + seed * 1.7;
  }

  update(clip: string, now: number) {
    if (now > this.nextBlink) {
      this.blinkStart = now;
      this.nextBlink = now + (Math.random() < 0.2 ? 0.28 : 2 + Math.random() * 3.4);
    }
    // Some faces flicker between two drawings at uneven moments.
    if (now > this.nextChange) {
      this.flip = !this.flip;
      this.nextChange = now + (clip === "shout" ? 0.18 + Math.random() * 0.45 : 0.7 + Math.random() * 1.6);
    }
    let eye: EyeCell = "open";
    let mouth: MouthCell = "smile";
    switch (clip) {
      case "shout":
        eye = "angry";
        mouth = this.flip ? "openA" : "openB";
        break;
      case "taunt":
        mouth = "tongue";
        break;
      case "hide":
        eye = "wide";
        mouth = "worried";
        break;
      case "nervous":
        eye = this.flip ? "sideL" : "sideR";
        mouth = "grit";
        break;
      case "draw":
        eye = "angry";
        mouth = "grit";
        break;
      case "hit":
        eye = "x";
        mouth = "openA";
        break;
    }
    const blinking = now - this.blinkStart < 0.14;
    this.eye = blinking && eye !== "x" ? "blink" : eye;
    this.mouth = mouth;
  }
}
