// Procedural low-poly primitives, all centred on the origin with flat normals.

import type { Mesh, Renderer } from "./gl";

type P = [number, number, number];

class Builder {
  positions: number[] = [];
  normals: number[] = [];

  /** Adds a triangle, wound counter-clockwise from outside. */
  tri(a: P, b: P, c: P): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nx, ny, nz);
    }
  }

  quad(a: P, b: P, c: P, d: P): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
}

function cube(): Builder {
  const b = new Builder();
  const s = 0.5;
  b.quad([-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]);
  b.quad([s, -s, -s], [-s, -s, -s], [-s, s, -s], [s, s, -s]);
  b.quad([s, -s, s], [s, -s, -s], [s, s, -s], [s, s, s]);
  b.quad([-s, -s, -s], [-s, -s, s], [-s, s, s], [-s, s, -s]);
  b.quad([-s, s, s], [s, s, s], [s, s, -s], [-s, s, -s]);
  b.quad([-s, -s, -s], [s, -s, -s], [s, -s, s], [-s, -s, s]);
  return b;
}

/** A tapered cylinder along Y, height 1. Radius 0.5 at the bottom, `top` x 0.5 above. */
function taper(sides: number, top: number): Builder {
  const b = new Builder();
  const ring = (i: number, r: number, y: number): P => {
    const a = (i / sides) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  const R = 0.5;
  const T = 0.5 * top;
  for (let i = 0; i < sides; i++) {
    const j = i + 1;
    if (top > 0) {
      b.quad(ring(j, R, -0.5), ring(i, R, -0.5), ring(i, T, 0.5), ring(j, T, 0.5));
      b.tri([0, 0.5, 0], ring(j, T, 0.5), ring(i, T, 0.5));
    } else {
      b.tri(ring(j, R, -0.5), ring(i, R, -0.5), [0, 0.5, 0]);
    }
    b.tri([0, -0.5, 0], ring(i, R, -0.5), ring(j, R, -0.5));
  }
  return b;
}

/** An icosphere of diameter 1. Flat-shaded, so it reads as chunky low-poly. */
function ball(subdivisions: number): Builder {
  const t = (1 + Math.sqrt(5)) / 2;
  const v: P[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  let faces: [P, P, P][] = (
    [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ] as const
  ).map(([a, b, c]) => [v[a]!, v[b]!, v[c]!]);

  const onBall = (p: P): P => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return [(p[0] / l) * 0.5, (p[1] / l) * 0.5, (p[2] / l) * 0.5];
  };
  const mid = (a: P, b: P): P => onBall([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);

  faces = faces.map(([a, b, c]) => [onBall(a), onBall(b), onBall(c)]);
  for (let s = 0; s < subdivisions; s++) {
    faces = faces.flatMap(([a, b, c]) => {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]] as [P, P, P][];
    });
  }
  const b = new Builder();
  for (const [p, q, r] of faces) b.tri(p, q, r);
  return b;
}

/** A chunky five-pointed star in the XY plane, for the stunned halo and muzzle flash. */
function star(points: number, inner: number): Builder {
  const b = new Builder();
  const depth = 0.12;
  const at = (i: number, z: number): P => {
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.5 : 0.5 * inner;
    return [Math.cos(a) * r, Math.sin(a) * r, z];
  };
  const n = points * 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    b.tri([0, 0, depth], at(i, 0), at(j, 0));
    b.tri([0, 0, -depth], at(j, 0), at(i, 0));
  }
  return b;
}

export interface Shard {
  mesh: Mesh;
  /** Which way this piece faces, from the middle of the ball. */
  dir: [number, number, number];
  /** Its own middle, so it can tumble about itself. */
  centroid: [number, number, number];
}

/**
 * A ball of diameter 1, broken into solid wedge-shaped pieces that fit back together.
 * Faces go to the nearest of `count` evenly spread directions.
 */
function shards(r: Renderer, count: number): Shard[] {
  const seeds: P[] = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - ((i + 0.5) / count) * 2;
    const ring = Math.sqrt(1 - y * y);
    const a = i * 2.399963;
    seeds.push([Math.cos(a) * ring, y, Math.sin(a) * ring]);
  }
  const whole = ball(1);
  const groups: Builder[] = seeds.map(() => new Builder());
  const middles: P[] = seeds.map(() => [0, 0, 0]);
  const counts = seeds.map(() => 0);
  for (let i = 0; i < whole.positions.length; i += 9) {
    const a: P = [whole.positions[i]!, whole.positions[i + 1]!, whole.positions[i + 2]!];
    const b: P = [whole.positions[i + 3]!, whole.positions[i + 4]!, whole.positions[i + 5]!];
    const c: P = [whole.positions[i + 6]!, whole.positions[i + 7]!, whole.positions[i + 8]!];
    const mx = a[0] + b[0] + c[0], my = a[1] + b[1] + c[1], mz = a[2] + b[2] + c[2];
    let best = 0;
    let bestDot = -Infinity;
    seeds.forEach((seed, s) => {
      const d = seed[0] * mx + seed[1] * my + seed[2] * mz;
      if (d > bestDot) { bestDot = d; best = s; }
    });
    const group = groups[best]!;
    const o: P = [0, 0, 0];
    group.tri(a, b, c);
    // Walls back to the middle, so pieces look solid once they come apart.
    group.tri(b, a, o);
    group.tri(c, b, o);
    group.tri(a, c, o);
    const middle = middles[best]!;
    middle[0] += mx / 3; middle[1] += my / 3; middle[2] += mz / 3;
    counts[best] = counts[best]! + 1;
  }
  const out: Shard[] = [];
  groups.forEach((group, s) => {
    const n = counts[s]!;
    if (n === 0) return;
    const middle = middles[s]!;
    const centroid: [number, number, number] = [middle[0] / n * 0.75, middle[1] / n * 0.75, middle[2] / n * 0.75];
    const l = Math.hypot(centroid[0], centroid[1], centroid[2]) || 1;
    out.push({
      mesh: r.createMesh(group.positions, group.normals),
      dir: [centroid[0] / l, centroid[1] / l, centroid[2] / l],
      centroid,
    });
  });
  return out;
}

/** A flat square on the ground plane, facing up. */
function ground(): Builder {
  const b = new Builder();
  const s = 0.5;
  b.quad([-s, 0, s], [s, 0, s], [s, 0, -s], [-s, 0, -s]);
  return b;
}

/** A flat disc on the ground, for blob shadows. */
function disc(sides: number): Builder {
  const b = new Builder();
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    b.tri([0, 0, 0], [Math.cos(a1) * 0.5, 0, Math.sin(a1) * 0.5], [Math.cos(a0) * 0.5, 0, Math.sin(a0) * 0.5]);
  }
  return b;
}

export interface Meshes {
  cube: Mesh;
  cylinder: Mesh;
  /** A hexagonal cylinder, cheaper and chunkier. */
  hex: Mesh;
  cone: Mesh;
  /** The crown of a cowboy hat. */
  crown: Mesh;
  /** A poncho, wide at the bottom. */
  poncho: Mesh;
  mesa: Mesh;
  ball: Mesh;
  /** Low detail, for small things like eyes and hands. */
  smallBall: Mesh;
  star: Mesh;
  flash: Mesh;
  ground: Mesh;
  disc: Mesh;
  /** A breakable ball, for the skull and the walnuts. */
  shards: Shard[];
  /** The same ball in many more pieces, for a skull that really goes to bits. */
  fineShards: Shard[];
}

export function createMeshes(r: Renderer): Meshes {
  const make = (b: Builder) => r.createMesh(b.positions, b.normals);
  return {
    cube: make(cube()),
    cylinder: make(taper(12, 1)),
    hex: make(taper(6, 1)),
    cone: make(taper(8, 0)),
    crown: make(taper(8, 0.72)),
    poncho: make(taper(8, 0.56)),
    mesa: make(taper(7, 0.72)),
    ball: make(ball(2)),
    smallBall: make(ball(1)),
    star: make(star(5, 0.46)),
    flash: make(star(8, 0.34)),
    ground: make(ground()),
    disc: make(disc(16)),
    shards: shards(r, 14),
    fineShards: shards(r, 40),
  };
}
