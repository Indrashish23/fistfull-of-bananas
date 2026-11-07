// The held revolver and arm. The OBJ's separate pieces become moving parts: the cylinder, hammer
// and trigger each get a mesh and a pivot, and all of it follows the rig's gun bone. Timing lives
// here: each shot drops the hammer, then re-cocks it while the cylinder clicks round one chamber.

import type { Mat4, V3 } from "./gl";
import { multiply, rotationX, rotationZ, translation } from "./gl";
import { Rig } from "./gltf";
import { MeshBuilder } from "./mesh";
import type { Mat, RGB } from "./mesh";

type PartName = "body" | "cylinder" | "hammer" | "trigger";

export interface RevolverParts {
  builders: Record<PartName, MeshBuilder>;
  /** Cylinder spins about x through this point. */
  cylinderPivot: V3;
  /** Hammer and trigger swing about z through these points. */
  hammerPivot: V3;
  triggerPivot: V3;
  muzzle: V3;
  /** The line the cylinder swings out on, below it and along the barrel. */
  cranePivot: V3;
  /** How far the chambers sit from the middle of the cylinder, and where its back face is. */
  chamberOrbit: number;
  cylinderRear: number;
  cylinderLength: number;
}

export function buildRevolver(text: string, paint: (m: string) => { color: RGB; mat: Mat }): RevolverParts {
  const vs: V3[] = [];
  const ns: V3[] = [];
  const faces: { v: number[]; n: number[]; m: string }[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("v ")) {
      const [, x, y, z] = line.trim().split(/\s+/);
      vs.push([+x, +y, +z]);
    } else if (line.startsWith("vn ")) {
      const [, x, y, z] = line.trim().split(/\s+/);
      ns.push([+x, +y, +z]);
    } else if (line.startsWith("usemtl ")) {
      cur = line.slice(7).trim();
    } else if (line.startsWith("f ")) {
      const refs = line.trim().split(/\s+/).slice(1).map((r) => r.split("/"));
      faces.push({ v: refs.map((r) => +r[0] - 1), n: refs.map((r) => +r[2] - 1), m: cur });
    }
  }

  // Pieces that share no vertices are separate parts in the source model.
  const parent = vs.map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  for (const f of faces) for (const k of f.v.slice(1)) parent[find(f.v[0])] = find(k);
  const box = new Map<number, { x0: number; x1: number; y0: number; y1: number; z: number }>();
  vs.forEach((p, i) => {
    const r = find(i);
    const b = box.get(r) ?? { x0: 9, x1: -9, y0: 9, y1: -9, z: 0 };
    b.x0 = Math.min(b.x0, p[0]);
    b.x1 = Math.max(b.x1, p[0]);
    b.y0 = Math.min(b.y0, p[1]);
    b.y1 = Math.max(b.y1, p[1]);
    b.z = Math.max(b.z, Math.abs(p[2]));
    box.set(r, b);
  });
  const classify = (r: number): PartName => {
    const b = box.get(r)!;
    if (b.z >= 0.13) return "cylinder";
    if (b.z <= 0.035 && b.x1 < 0.35 && b.y0 > 0.25) return "hammer";
    if (b.z <= 0.035 && b.x0 > 0.3 && b.x1 < 0.6 && b.y1 < 0.3) return "trigger";
    return "body";
  };

  const make = (seed: number) => {
    const b = new MeshBuilder(seed);
    b.uvScale = [1.2, 0.6];
    return b;
  };
  const builders: Record<PartName, MeshBuilder> = { body: make(5), cylinder: make(6), hammer: make(7), trigger: make(8) };
  const bounds: Record<PartName, { x0: number; x1: number; y0: number; y1: number }> = {
    body: { x0: 9, x1: -9, y0: 9, y1: -9 },
    cylinder: { x0: 9, x1: -9, y0: 9, y1: -9 },
    hammer: { x0: 9, x1: -9, y0: 9, y1: -9 },
    trigger: { x0: 9, x1: -9, y0: 9, y1: -9 },
  };
  for (const f of faces) {
    const name = classify(find(f.v[0]));
    const b = builders[name];
    const { color, mat } = paint(f.m);
    b.mat = mat;
    for (const v of f.v) {
      const p = vs[v];
      const bb = bounds[name];
      bb.x0 = Math.min(bb.x0, p[0]);
      bb.x1 = Math.max(bb.x1, p[0]);
      bb.y0 = Math.min(bb.y0, p[1]);
      bb.y1 = Math.max(bb.y1, p[1]);
    }
    for (let i = 1; i < f.v.length - 1; i++) {
      b.triFull(vs[f.v[0]], vs[f.v[i]], vs[f.v[i + 1]], color, color, color, [ns[f.n[0]], ns[f.n[i]], ns[f.n[i + 1]]]);
    }
  }
  const c = bounds.cylinder;
  const h = bounds.hammer;
  const t = bounds.trigger;
  const body = bounds.body;
  return {
    builders,
    cylinderPivot: [0, (c.y0 + c.y1) / 2, 0],
    hammerPivot: [h.x1 - 0.01, h.y0 + 0.01, 0],
    triggerPivot: [(t.x0 + t.x1) / 2, t.y1, 0],
    muzzle: [body.x1, (c.y0 + c.y1) / 2 + 0.07, 0],
    cranePivot: [0, c.y0 - 0.01, 0],
    chamberOrbit: ((c.y1 - c.y0) / 2) * 0.6,
    cylinderRear: c.x0,
    cylinderLength: c.x1 - c.x0,
  };
}

/** An empty chamber: a dark disc of radius one, facing back along -x. */
export function buildChamber(): MeshBuilder {
  const b = new MeshBuilder(10);
  b.mat = "plain";
  const dark: RGB = [0.07, 0.06, 0.06];
  const sides = 8;
  const at = (i: number): V3 => [0, Math.cos((i / sides) * Math.PI * 2), Math.sin((i / sides) * Math.PI * 2)];
  for (let i = 0; i < sides; i++) b.tri([0, 0, 0], at(i + 1), at(i), dark);
  return b;
}

/** A cartridge along +x, one long and one wide, with its rim at the origin. Scale it to fit. */
export function buildBullet(): MeshBuilder {
  const b = new MeshBuilder(9);
  b.mat = "plain";
  const brass: RGB = [0.86, 0.63, 0.25];
  const copper: RGB = [0.72, 0.36, 0.18];
  const rim: RGB = [0.68, 0.48, 0.18];
  const sides = 6;
  const rings: [number, number, RGB][] = [[0, 1.2, rim], [0.05, 1.2, rim], [0.06, 1, brass], [0.68, 1, brass], [0.7, 0.92, copper], [0.88, 0.62, copper], [1, 0.14, copper]];
  const at = (r: [number, number, RGB], i: number): V3 => {
    const a = (i / sides) * Math.PI * 2;
    return [r[0], Math.cos(a) * r[1], Math.sin(a) * r[1]];
  };
  for (let g = 0; g < rings.length - 1; g++) {
    for (let i = 0; i < sides; i++) {
      const color = rings[g + 1]![2];
      b.tri(at(rings[g]!, i), at(rings[g + 1]!, i), at(rings[g + 1]!, i + 1), color);
      b.tri(at(rings[g]!, i), at(rings[g + 1]!, i + 1), at(rings[g]!, i + 1), color);
    }
  }
  // The back of the case, with a dark primer in the middle: it's the end you look at.
  for (let i = 0; i < sides; i++) b.tri([0, 0, 0], at(rings[0]!, i + 1), at(rings[0]!, i), rim);
  return b;
}

export const CHAMBERS = 6;
export const CHAMBER = (Math.PI * 2) / CHAMBERS;
/** How far the cylinder swings out of the frame, in radians. */
const CYLINDER_SWING = -1.45;

const ease = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Fired-state timing. All angles are in the gun's own space. */
export class GunAction {
  fired = -10;
  reloadAt = -10;
  /** Chambers fired so far. The cylinder advances one per shot. */
  shots = 0;
  /** 0..1 how far the cylinder's swung out, and how far it's turned while bullets go in. */
  open = 0;
  loadSpin = 0;
  private spinBase = 0;

  shoot(now: number) {
    this.fired = now;
    this.shots++;
  }

  reload(now: number) {
    this.reloadAt = now;
    this.spinBase = this.shots * CHAMBER;
    this.shots = 0;
  }

  get reloading() {
    return this.reloadAt;
  }

  /** Hammer's angle back from the fired position. */
  hammer(now: number) {
    const t = now - this.fired;
    const fall = 1 - ease(0, 0.03, t);
    const recock = ease(0.26, 0.46, t);
    return 0.72 * Math.max(fall, recock);
  }

  trigger(now: number) {
    const t = now - this.fired;
    return -0.5 * ease(-0.03, 0.02, t) * (1 - ease(0.18, 0.4, t));
  }

  /** Cylinder rotation about x. It clicks on during the re-cock, and spins fast on reload. */
  cylinder(now: number) {
    const t = now - this.fired;
    const stepping = ease(0.26, 0.46, t);
    let a = (Math.max(0, this.shots - 1) + stepping * (this.shots > 0 ? 1 : 0)) * CHAMBER;
    const r = now - this.reloadAt;
    if (r < 1.1) a += (this.spinBase + (1 - ease(0, 1.1, r)) * -Math.PI * 6) * 1;
    return a;
  }

  /** Flourish while reloading: 0..1 up, flip and back. */
  flourish(now: number) {
    const r = now - this.reloadAt;
    return ease(0, 0.25, r) * (1 - ease(0.85, 1.2, r));
  }

  partMatrices(now: number, parts: RevolverParts, base: Mat4): Record<PartName, Mat4> {
    const about = (p: V3, rot: Mat4) => multiply(multiply(translation(p[0], p[1], p[2]), rot), translation(-p[0], -p[1], -p[2]));
    // Swung out on its crane first, then turned about its own middle.
    const swung = multiply(base, about(parts.cranePivot, rotationX(this.open * CYLINDER_SWING)));
    return {
      body: base,
      cylinder: multiply(swung, about(parts.cylinderPivot, rotationX(this.cylinder(now) + this.loadSpin))),
      hammer: multiply(base, about(parts.hammerPivot, rotationZ(this.hammer(now)))),
      trigger: multiply(base, about(parts.triggerPivot, rotationZ(this.trigger(now)))),
    };
  }
}

export type { Rig };
