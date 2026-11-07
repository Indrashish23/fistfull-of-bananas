// The guns you can own. The look lives in the scene and the rules in Rush: this is just what each one is.

export type GunModel = "revolver" | "m1911" | "thompson";
export type GunPaint = "steel" | "gold" | "ghost";

export interface GunStats {
  /** Shots before a reload. */
  ammo: number;
  /** The shortest gap between shots. */
  gapSec: number;
  /** Whether it keeps firing while OK's held down. */
  auto: boolean;
  /** Whether it reloads in one go, rather than a bullet at a time. */
  mag: boolean;
}

export interface GunDef extends GunStats {
  id: string;
  name: string;
  blurb: string;
  price: number;
  model: GunModel;
  paint: GunPaint;
}

const REVOLVER: GunStats = { ammo: 8, gapSec: 0.28, auto: false, mag: false };
const PISTOL: GunStats = { ammo: 10, gapSec: 0.22, auto: false, mag: true };
const TOMMY: GunStats = { ammo: 30, gapSec: 0.1, auto: true, mag: true };

export const GUNS: readonly GunDef[] = [
  { id: "revolver", name: "Old Reliable", blurb: "Eight shots and a good feeling.", price: 0, model: "revolver", paint: "steel", ...REVOLVER },
  { id: "golden_revolver", name: "Golden Revolver", blurb: "Shoots the same. Looks richer.", price: 500, model: "revolver", paint: "gold", ...REVOLVER },
  { id: "ghost_revolver", name: "Ghost Gun", blurb: "Nobody remembers who owned it.", price: 1200, model: "revolver", paint: "ghost", ...REVOLVER },
  { id: "pistol", name: "Steel .45", blurb: "Ten shots, and a quick new magazine.", price: 400, model: "m1911", paint: "steel", ...PISTOL },
  { id: "golden_pistol", name: "Golden Pistol", blurb: "Ten shots of pure showing off.", price: 900, model: "m1911", paint: "gold", ...PISTOL },
  { id: "tommy", name: "Tommy Gun", blurb: "Hold OK. Keep holding OK.", price: 2000, model: "thompson", paint: "steel", ...TOMMY },
  { id: "golden_tommy", name: "Golden Tommy", blurb: "Every outlaw's retirement plan.", price: 4000, model: "thompson", paint: "gold", ...TOMMY },
];

/** The gun with this id, or the revolver if there's no such gun. */
export function gunById(id: string): GunDef {
  return GUNS.find((g) => g.id === id) ?? GUNS[0]!;
}
