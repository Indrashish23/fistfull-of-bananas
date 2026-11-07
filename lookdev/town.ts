// Lays the kit out into the town. World axes match the game: the shooter stands at the origin
// looking down -z, the target walks x = -4.6..4.6 at z = -14.

import type { Direction } from "./directions";
import {
  barrel,
  boardRun,
  building,
  cactus,
  churchAtEnd,
  cloud,
  crate,
  hitchingPost,
  paletteToRGB,
  rock,
  rockMass,
  streetOffset,
  telegraphLine,
  trough,
  tuft,
  wagon,
  waterTower,
  windmill,
} from "./kit";
import type { BuildingSpec, Colors, Kit } from "./kit";
import { MeshBuilder, mix, mul } from "./mesh";
import type { RGB } from "./mesh";

export interface TownMeshes {
  casters: MeshBuilder;
  receivers: MeshBuilder;
  foliage: MeshBuilder;
  glow: MeshBuilder;
  /** Two cloud layers, which drift at different speeds. */
  cloudsFar: MeshBuilder;
  cloudsNear: MeshBuilder;
}

const SPECS: BuildingSpec[] = [
  // Right side (+x), near to far.
  { side: 1, z: 46, w: 8, wall: "wallC", top: "curve", sign: "SMITH" },
  { side: 1, z: 36, w: 9, wall: "wallD", top: "pediment", sign: "COFFINS" },
  { side: 1, z: 24, w: 11, stories: 2, kind: "hotel", wall: "wallB", top: "flat", peak: 1.5, sign: "ROOMS", roofProp: "chimney" },
  { side: 1, z: 13, w: 9, wall: "wallA", top: "arch", sign: "TAILOR" },
  { side: 1, z: 3, w: 8.5, wall: "wallD", top: "stepped", sign: "BATHS", roofProp: "tank" },
  { side: 1, z: -7.5, w: 9, wall: "wallC", top: "stepped", sign: "ASSAY", blade: "ASSAY" },
  { side: 1, z: -23, w: 14, stories: 2, kind: "saloon", wall: "wallSaloon", top: "arch", peak: 1.9, sign: "SALOON", blade: "SALOON" },
  { side: 1, z: -37.5, w: 9, kind: "bank", wall: "wallBank", top: "pediment", peak: 1.8, sign: "BANK", blade: "BANK" },
  { side: 1, z: -47.5, w: 7, wall: "wallA", top: "flat", sign: "BARBER" },
  { side: 1, z: -60, w: 12, stories: 2, kind: "hotel", wall: "wallB", top: "stepped", peak: 1.6, sign: "HOTEL", blade: "HOTEL", roofProp: "chimney" },
  { side: 1, z: -72, w: 7.5, wall: "wallD", top: "curve", sign: "TONICS" },

  // Left side (-x), near to far.
  { side: -1, z: 45, w: 8, wall: "wallD", top: "flat", sign: "NEWS" },
  { side: -1, z: 35, w: 9, wall: "wallB", top: "curve", sign: "BOOTS" },
  { side: -1, z: 24, w: 11, stories: 2, wall: "wallA", top: "pediment", peak: 1.7, sign: "BOARDING" },
  { side: -1, z: 13, w: 9.5, wall: "wallC", top: "arch", peak: 1.7, sign: "CIGARS", roofProp: "tank" },
  { side: -1, z: 2.5, w: 9, wall: "wallD", top: "flat", sign: "DOCTOR", blade: "DOCTOR" },
  { side: -1, z: -8, w: 9, wall: "wallB", top: "stepped", sign: "GUNS", blade: "GUNS" },
  { side: -1, z: -22.5, w: 11, kind: "sheriff", wall: "wallSheriff", top: "stepped", peak: 1.4, sign: "SHERIFF", blade: "SHERIFF" },
  { side: -1, z: -36, w: 13, kind: "store", wall: "wallStore", top: "curve", peak: 1.8, sign: "GENERAL STORE", blade: "STORE", roofProp: "chimney" },
  { side: -1, z: -47.5, w: 7, wall: "wallC", top: "pediment", sign: "WIRES" },
  { side: -1, z: -57, w: 9, wall: "wallA", top: "flat", sign: "FEED", roofProp: "tank" },
  { side: -1, z: -71, w: 13, kind: "barn", wall: "wallBarn", top: "pediment", peak: 2.8, sign: "LIVERY", blade: "LIVERY" },
];

function hash(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function vnoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const stepT = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function terrainY(x: number, z: number): number {
  const sx = x - streetOffset(z);
  const away = stepT(26, 80, Math.abs(sx)) + stepT(-105, -170, z) + stepT(70, 140, z);
  if (away <= 0) return 0;
  return Math.min(1, away) * (vnoise(x * 0.018, z * 0.018) * 6 + vnoise(x * 0.06, z * 0.06) * 1.2 - 1.2);
}

/** The ground mesh only carries shape and a soft macro tint; the shader paints the material. */
function buildGround(k: Kit) {
  const { b, P } = k;
  b.mat = "ground";
  const xs: number[] = [];
  const half = [0, 1.5, 3, 4.5, 6, 7.4, 9.5, 12, 16, 22, 30, 42, 60, 90, 140, 220, 340, 520, 800];
  for (let i = half.length - 1; i > 0; i--) xs.push(-half[i]);
  xs.push(...half);
  const zs: number[] = [];
  for (let z = -130; z <= 90; z += 3) zs.push(z);
  for (let z = -160, d = 30; z > -1000; d *= 1.45, z -= d) zs.unshift(z);
  for (let z = 120, d = 30; z < 1000; d *= 1.45, z += d) zs.push(z);

  const white: RGB = [1, 1, 1];
  const farRatio: RGB = [
    Math.min(1, P.desertFar[0] / P.sandPatch[0]),
    Math.min(1, P.desertFar[1] / P.sandPatch[1]),
    Math.min(1, P.desertFar[2] / P.sandPatch[2]),
  ];
  const tint = (x: number, z: number): RGB => {
    const sx = Math.abs(x - streetOffset(z));
    const far = stepT(30, 260, Math.hypot(sx, z + 10));
    const mottle = vnoise(x * 0.05, z * 0.05);
    return mul(mix(white, farRatio, far), 0.84 + mottle * 0.16);
  };
  for (let iz = 0; iz < zs.length - 1; iz++) {
    for (let ix = 0; ix < xs.length - 1; ix++) {
      const x0 = xs[ix];
      const x1 = xs[ix + 1];
      const z0 = zs[iz];
      const z1 = zs[iz + 1];
      b.quadUV(
        [x0, terrainY(x0, z1), z1],
        [x1, terrainY(x1, z1), z1],
        [x1, terrainY(x1, z0), z0],
        [x0, terrainY(x0, z0), z0],
        [x0, z1],
        [x1, z1],
        [x1, z0],
        [x0, z0],
        tint(x0, z1),
        tint(x1, z1),
        tint(x1, z0),
        tint(x0, z0),
      );
    }
  }
  b.mat = "wood";
}

function addStreetDressing(k: Kit, P: Colors) {
  const { b } = k;

  // Loose boards laid over the mud, well clear of the duel lane.
  boardRun(k, 2.4, 6.6, 9, 3.6, 0.08);
  boardRun(k, -3.8, -2.5, 5, 2.4, -0.2);
  boardRun(k, 1.5 + streetOffset(-44), -44, 9, 3.2, -0.06);
  boardRun(k, -2.5 + streetOffset(-29), -29, 6, 2.6, 0.12);

  // Plants: thick along the street edges, sparse in the street, never on the duel lane.
  for (let i = 0; i < 460; i++) {
    const z = b.rng.range(-95, 52);
    const edge = b.rng.next() < 0.72;
    const x = edge ? b.rng.pick([-1, 1]) * b.rng.range(5.8, 7.5) : b.rng.range(-5.5, 5.5);
    if (Math.abs(x) < 5.8 && z < -8 && z > -20) continue;
    const roll = b.rng.next();
    const cell = roll < 0.5 ? 0 : roll < 0.75 ? 1 : roll < 0.9 ? 3 : 2;
    const tone = cell === 2 ? mix(P.twig, P.scrub, 0.2) : b.rng.next() < 0.25 ? mix(P.scrub, P.hay, 0.55) : P.scrub;
    tuft(k, x + streetOffset(z), z, b.rng.range(0.32, 0.75), tone, cell);
  }
  // Bigger plants and stones in the near street, for the opening view.
  for (const [x, z, s, cell] of [
    [-6.0, 10.2, 1.0, 0],
    [5.2, 10.4, 0.9, 1],
    [6.6, 7, 1.1, 0],
    [-3.7, 10.6, 0.7, 3],
    [1.2, 11.6, 0.55, 1],
    [-7, 6, 1.1, 2],
    [7.1, 3, 0.9, 2],
    [-1.3, 8.9, 0.55, 0],
  ] as const) {
    tuft(k, x, z, s, undefined, cell);
  }
  for (const [x, z, s] of [
    [-4.5, 10.9, 0.3],
    [5.7, 9.2, 0.42],
    [-1.6, 12, 0.18],
    [3.4, 11.8, 0.22],
    [-7, 3.5, 0.5],
    [-2.8, 9.8, 0.14],
    [0.5, 10.4, 0.1],
  ] as const) {
    rock(k, x, z, s);
  }
  // Fallen leaves: tiny specks of the sky's complement that catch the eye up close.
  b.mat = "plain";
  for (let i = 0; i < 120; i++) {
    const x = b.rng.range(-7.5, 7.5);
    const z = b.rng.range(0, 13);
    const s = b.rng.range(0.05, 0.11);
    const a = b.rng.range(0, 6.28);
    const y = 0.03;
    const c = b.jitter(P.leaf, 0.2);
    b.tri(
      [x + Math.cos(a) * s, y, z + Math.sin(a) * s],
      [x + Math.cos(a + 2.2) * s, y, z + Math.sin(a + 2.2) * s],
      [x + Math.cos(a + 4.2) * s, y, z + Math.sin(a + 4.2) * s],
      c,
    );
  }
  b.mat = "wood";

  // Street furniture: all at |x| >= 6.2, so a duellist never walks through it.
  hitchingPost(k, 6.75, -30, 6);
  hitchingPost(k, -6.75, -28, 5);
  hitchingPost(k, 6.75, -9, 4);
  trough(k, 6.75, -17);
  trough(k, -6.75 + streetOffset(-41), -41);
  const deckB = (x: number, z: number, s = 1) => barrel(k, x, 0.42, z, s);
  deckB(8.1, -15.5);
  deckB(8.3, -14.6, 0.9);
  deckB(-8.1, -17);
  deckB(-8.2, -16, 0.85);
  deckB(8.0, 7);
  deckB(-8.0, 7.5);
  deckB(-8.3, 8.4, 0.9);
  crate(k, -8.2, 0.42, -29.5, 0.8, 0.2);
  crate(k, -8.3, 1.22, -29.4, 0.6, 0.6);
  crate(k, -8, 0.42, -40, 1, 0.1);
  barrel(k, -7, 0, 9.2, 1.1);
  crate(k, 8.2, 0.42, 9, 0.9, 0.3);

  // Wagons parked along the boardwalk.
  wagon(k, -6.6 + streetOffset(-34), -34, true, 0.03);
  wagon(k, 6.4 + streetOffset(-52), -52, false, -0.14);
  wagon(k, 6.4, 22, true, Math.PI - 0.05);

  // Skyline pieces behind the rows.
  waterTower(k, -21 + streetOffset(-44), -44);
  windmill(k, 22, -46);
  waterTower(k, 25 + streetOffset(-66), -66);
  windmill(k, -22, 28);
  // Far enough down the road to stand behind the great bank, not in front of it.
  churchAtEnd(k, -8 + streetOffset(-125), -125);

  telegraphLine(
    k,
    [
      [-7.6 + streetOffset(-62), -62],
      [-7.5 + streetOffset(-44), -44],
      [-7.5, -26],
      [-7.5, -8.2],
      [-7.5, 8],
      [-7.5, 28],
    ],
    8.6,
  );

  // Cacti and rocks past the town and in the gaps between buildings.
  const cacti: [number, number, number][] = [
    [-17, -90, 4.6],
    [15, -102, 3.8],
    [6, -120, 3.4],
    [-27, -112, 4.2],
    [27, -94, 5],
    [36, -20, 4.8],
    [-34, -38, 5.4],
    [-32, 18, 4.5],
    [31, 26, 4.4],
    [-12, 72, 4.6],
    [14, 78, 3.8],
    [-6.7, 14.8, 2.6],
    [7, -2.5, 2.2],
    [-6.9, -46.5, 2.3],
  ];
  cacti.forEach(([x, z, h], i) => {
    const off = z < -25 ? streetOffset(z) : 0;
    cactus(k, x + off, z, h, i * 1.7);
  });
  for (let i = 0; i < 60; i++) {
    const side = b.rng.pick([-1, 1]);
    const x = side * b.rng.range(22, 70);
    const z = b.rng.range(-120, 80);
    rock(k, x + (z < -25 ? streetOffset(z) : 0), z, b.rng.range(0.4, 1.8));
    tuft(k, x + b.rng.range(-2, 2), z + b.rng.range(-2, 2), b.rng.range(0.6, 1.2), undefined, b.rng.pick([0, 1, 2]));
  }
}

function addLandscape(k: Kit) {
  // A bluff close behind the right-hand row: gives the street a rock wall to lean on.
  rockMass(k, 54, -18, 22, 40, 26, 6);
  rockMass(k, 78, -92, 34, 42, 38, 7);
  rockMass(k, 52, -158, 22, 28, 24, 5);
  // Distant landmarks at the far end of the street.
  rockMass(k, -90, -280, 66, 42, 44, 7);
  rockMass(k, 118, -340, 58, 46, 62, 7);
  rockMass(k, -210, -440, 96, 60, 56, 6);
  rockMass(k, 240, -520, 110, 60, 62, 6);
  rockMass(k, 10, -520, 70, 40, 34, 5);
  // A spire: a small tall butte that gives the vista something to point at.
  rockMass(k, 44, -260, 9, 8, 46, 7, 10);
  // Behind the reverse (target) camera.
  rockMass(k, -60, 240, 46, 38, 42, 7);
  rockMass(k, 80, 310, 62, 40, 56, 7);
  rockMass(k, -210, 400, 90, 60, 60, 7);
  rockMass(k, -70, 80, 18, 20, 16, 5);
}

/** Clouds span CLOUD_SPAN along x, so a layer can wrap around without anyone seeing a seam. */
export const CLOUD_SPAN = 3000;

function addClouds(far: Kit, near: Kit, d: Direction) {
  const z = -900;
  const add = (k: Kit, x: number, y: number, s: number, flat: number, puffs: number) => {
    for (const shift of [0, CLOUD_SPAN / 2]) {
      cloud(k, x + shift - CLOUD_SPAN / 4, y, z, s, flat, puffs);
      cloud(k, x + shift - CLOUD_SPAN / 4 + 130, y * 0.92, -z, s * 0.9, flat, puffs);
    }
  };
  switch (d.sky.clouds) {
    case "billows":
      add(near, 230, 250, 170, 0.8, 5);
      add(far, 580, 340, 140, 0.7, 4);
      add(far, -360, 340, 150, 0.55, 5);
      add(near, -40, 460, 130, 0.5, 4);
      add(far, 60, 190, 150, 0.42, 4);
      add(near, -660, 200, 120, 0.42, 3);
      break;
    case "streaks":
      for (const [i, x, y, s] of [
        [0, -420, 120, 200],
        [1, -120, 86, 150],
        [0, 260, 150, 250],
        [1, 560, 95, 180],
        [0, -650, 210, 240],
        [1, 40, 245, 260],
        [0, 440, 300, 210],
        [1, -300, 340, 280],
      ] as const) {
        add(i ? near : far, x, y, s, 0.07, 5);
      }
      break;
    case "puffy":
      for (const [i, x, y, s] of [
        [0, -300, 250, 70],
        [1, -90, 340, 58],
        [0, 170, 280, 80],
        [1, 420, 340, 62],
        [0, -530, 370, 76],
        [1, 620, 240, 66],
      ] as const) {
        add(i ? near : far, x, y, s, 0.72, 4);
      }
      break;
  }
}

export function buildTown(d: Direction): TownMeshes {
  MeshBuilder.solidColors = !!d.kit.flatColor;
  const P = paletteToRGB(d.palette);
  const casters = new MeshBuilder(1337);
  const receivers = new MeshBuilder(4242);
  const foliage = new MeshBuilder(2024);
  const glow = new MeshBuilder(9);
  glow.unlit = true;
  glow.fog = 0;
  glow.mat = "plain";
  const cloudsFar = new MeshBuilder(31);
  const cloudsNear = new MeshBuilder(32);

  const rec: Kit = { b: receivers, fol: foliage, glow, P, S: d.kit };
  const kit: Kit = { b: casters, fol: foliage, glow, P, S: d.kit };

  buildGround(rec);
  for (const s of SPECS) building(kit, s);
  addStreetDressing(kit, P);
  addLandscape(rec);
  addClouds({ ...rec, b: cloudsFar }, { ...rec, b: cloudsNear }, d);
  MeshBuilder.solidColors = false;
  return { casters, receivers, foliage, glow, cloudsFar, cloudsNear };
}
