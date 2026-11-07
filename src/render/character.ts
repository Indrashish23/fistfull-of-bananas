// The low-poly hat the x-ray kill cam and a shot-off hat use. The characters themselves are the
// rigged monkeys from lookdev/assets.

import type { Mesh, Renderer } from "./gl";
import type { Stack, V3 } from "./mat";
import type { Meshes } from "./meshes";

export interface Palette {
  skin: V3;
  shirt: V3;
  poncho: V3;
  accent: V3;
  pants: V3;
  boots: V3;
  hat: V3;
  band: V3;
  hair: V3;
}

const OUTLINE = 0.035;

/** A hat that has come off its owner, tumbling through the air. */
export function drawLooseHat(r: Renderer, m: Meshes, s: Stack, c: Palette): void {
  s.push();
  s.translate(0, 0.36, -0.02).rotX(-0.1);
  part(r, m.hex, s, 0, 0.04, 0, 1.86, 0.09, 1.56, c.hat, OUTLINE);
  // The brim's upturned sides.
  for (const side of [-1, 1] as const) {
    s.push();
    s.translate(side * 0.8, 0.14, 0).rotZ(side * -0.55);
    part(r, m.cube, s, 0, 0, 0, 0.42, 0.075, 0.9, c.hat);
    s.pop();
  }
  part(r, m.crown, s, 0, 0.41, 0, 1.02, 0.66, 0.92, c.hat, OUTLINE);
  part(r, m.hex, s, 0, 0.16, 0, 1.0, 0.15, 0.9, c.band);
  s.pop();
}

function part(
  r: Renderer,
  mesh: Mesh,
  s: Stack,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  color: V3,
  outline?: number,
): void {
  s.push();
  s.translate(x, y, z).scale(sx, sy, sz);
  r.draw(mesh, s.top, color, { outline });
  s.pop();
}
