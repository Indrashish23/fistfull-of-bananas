// The look directions. Everything that differs between looks is data here: palette, light,
// sky and how the building kit behaves.

export interface Palette {
  skyZenith: string;
  skyMid: string;
  skyHorizon: string;
  sunDisc: string;
  sunGlow: string;
  fog: string;
  street: string;
  streetRut: string;
  streetEdge: string;
  sandPatch: string;
  darkDirt: string;
  desert: string;
  desertFar: string;
  mesaA: string;
  mesaB: string;
  mesaC: string;
  mesaTop: string;
  wallSaloon: string;
  wallSheriff: string;
  wallStore: string;
  wallBank: string;
  wallBarn: string;
  wallA: string;
  wallB: string;
  wallC: string;
  wallD: string;
  church: string;
  trim: string;
  trimDark: string;
  roof: string;
  boards: string;
  post: string;
  glass: string;
  glint: string;
  windowLit: string;
  doorway: string;
  door: string;
  sign: string;
  signText: string;
  signAlt: string;
  signAltText: string;
  bulb: string;
  awningA: string;
  awningB: string;
  bunting: string;
  /** Cool painted accent: doors, frames. The complement that makes the warm wood look warm. */
  accent: string;
  metal: string;
  brass: string;
  barrel: string;
  band: string;
  canvas: string;
  hay: string;
  water: string;
  cactus: string;
  cactusDark: string;
  rock: string;
  scrub: string;
  twig: string;
  leaf: string;
  cloud: string;
  cloudShade: string;
}

export interface Light {
  /** Degrees. 0 is the far end of the street (ahead of the shooter), 90 is +x, 180 behind. */
  azimuth: number;
  elevation: number;
  sun: string;
  sunGain: number;
  /** Below 1 lifts grazing surfaces. Essential when the sun is low. */
  sunCurve: number;
  /** 0 = smooth. Above 0 = number of cel steps for the sun term. */
  bands: number;
  ambientSky: string;
  ambientGround: string;
  ambientGain: number;
  fogDensity: number;
  fogMax: number;
  /** Extra light from behind the camera on characters only, so they always read. */
  charFill: string;
  charFillGain: number;
  /** Stylised character shading: a soft two-tone ramp between these, with no cast shadows. */
  charLight: string;
  charShade: string;
  charRim: string;
  /** Additive full-screen radial wash around the sun: the cheap stand-in for bloom and haze. */
  washGain: number;
  washRadius: number;
}

export interface SkyStyle {
  /** 0 = smooth gradient. Above 0 = posterised into that many bands. */
  bands: number;
  /** Elevation in degrees where horizon has become mid, and mid has become zenith. */
  midAt: number;
  zenithAt: number;
  /** Angular radius of the sun disc in degrees. */
  sunSize: number;
  /** Angular radius of the glow around it. */
  glowSize: number;
  glowGain: number;
  clouds: "billows" | "streaks" | "puffy";
}

export interface KitStyle {
  /** "h" = overlapping horizontal planks with dark gaps, "v" = upright boards, "panel" = painted block. */
  planks: "h" | "v" | "panel";
  plankH: number;
  /** Random brightness between neighbouring planks. */
  tintVar: number;
  trimT: number;
  trimH: number;
  /** How crooked things are: rooflines tilt, planks overshoot, posts lean. 0 is square-built. */
  wonk: number;
  heightMul: number;
  windowMul: number;
  stripedAwnings: boolean;
  /** Round log posts instead of square ones. */
  logPosts: boolean;
  /** Multiplier on post, barrel and rail thickness. */
  chunk: number;
  /** Which building tops to swap, to give each look its own silhouette. */
  topMap: Partial<Record<TopKind, TopKind>>;
  /** Share of windows glowing warm from inside. */
  litWindows: number;
  /** Strength of lamp and sign glow cards. */
  glow: number;
  dust: number;
  /** Strength of the wind ribbons, sand veils and blowing ground sand, 0..1. */
  wind: number;
  /** Contrast of the sand and dirt patches on the street, 0..1. */
  patchiness: number;
  /** Solid colours only: no random brightness between neighbouring pieces. */
  flatColor?: boolean;
}

export type TopKind = "flat" | "stepped" | "arch" | "pediment" | "curve";

export interface ColorPair {
  a: string;
  b: string;
  note: string;
}

export interface Direction {
  id: string;
  name: string;
  tagline: string;
  /** The complementary pairs this look is built on. Shown on the materials board. */
  colorStory: ColorPair[];
  palette: Palette;
  light: Light;
  sky: SkyStyle;
  kit: KitStyle;
}

export const DIRECTIONS: Direction[] = [
  {
    id: "haze",
    name: "Dust Haze",
    tagline: "Hot, bright and hazy. Orange sand and timber against a teal sky and cool shadows.",
    colorStory: [
      { a: "#D9762F", b: "#1F8FA8", note: "Sand and timber against sky and shadow" },
      { a: "#C8352C", b: "#2E9E6B", note: "Outlaw red against cactus green" },
      { a: "#FFC33D", b: "#3D4FC4", note: "Lit signs against deep blue paint" },
    ],
    palette: {
      skyZenith: "#1C87B8",
      skyMid: "#7CCBD8",
      skyHorizon: "#FFEBD2",
      sunDisc: "#FFFFFF",
      sunGlow: "#FFF1CC",
      fog: "#FFD3A3",
      street: "#C98A52",
      streetRut: "#B97C48",
      streetEdge: "#A9683A",
      sandPatch: "#F4D6A4",
      darkDirt: "#A9693A",
      desert: "#E2A766",
      desertFar: "#F2C48C",
      mesaA: "#B9502A",
      mesaB: "#C9653A",
      mesaC: "#A34526",
      mesaTop: "#E08E58",
      wallSaloon: "#9A5128",
      wallSheriff: "#7E4522",
      wallStore: "#A85E2E",
      wallBank: "#B8764A",
      wallBarn: "#7A3A22",
      wallA: "#8D4E27",
      wallB: "#A05C30",
      wallC: "#74401F",
      wallD: "#B06A38",
      church: "#E7BE92",
      trim: "#C98A4E",
      trimDark: "#4A2715",
      roof: "#6E3A20",
      boards: "#A5602F",
      post: "#7C4522",
      glass: "#3A2A28",
      glint: "#E8B080",
      windowLit: "#FFB640",
      doorway: "#2A170F",
      door: "#6A3A1E",
      sign: "#3A2013",
      signText: "#FFC33D",
      signAlt: "#E8B24A",
      signAltText: "#3A2013",
      bulb: "#FFE9A0",
      awningA: "#B2452A",
      awningB: "#8E5A2E",
      bunting: "#A7C24A",
      accent: "#1E8C93",
      metal: "#5C4A42",
      brass: "#F2B23E",
      barrel: "#8E5228",
      band: "#3A2A22",
      canvas: "#F3DFB8",
      hay: "#E8BE58",
      water: "#7FBFD0",
      cactus: "#4E9A58",
      cactusDark: "#2F7350",
      rock: "#BC7A4C",
      scrub: "#9DB04A",
      twig: "#8A5E30",
      leaf: "#E0562A",
      cloud: "#FFFFFF",
      cloudShade: "#CFE3F0",
    },
    light: {
      azimuth: 15,
      elevation: 25,
      sun: "#FFE3B0",
      sunGain: 0.84,
      sunCurve: 0.62,
      bands: 0,
      ambientSky: "#B79EA6",
      ambientGround: "#D97A42",
      ambientGain: 0.62,
      fogDensity: 0.0038,
      fogMax: 0.72,
      charFill: "#FFE6C8",
      charFillGain: 0.26,
      charLight: "#FFF4E2",
      charShade: "#D9B7AC",
      charRim: "#FFD9A0",
      washGain: 0.2,
      washRadius: 0.62,
    },
    sky: { bands: 0, midAt: 9, zenithAt: 42, sunSize: 3.2, glowSize: 16, glowGain: 0.6, clouds: "billows" },
    kit: {
      planks: "h",
      plankH: 0.42,
      tintVar: 0.13,
      trimT: 0.12,
      trimH: 0.2,
      wonk: 1,
      heightMul: 1,
      windowMul: 1,
      stripedAwnings: false,
      logPosts: true,
      chunk: 1.45,
      topMap: {},
      litWindows: 0.35,
      glow: 0.7,
      dust: 0.8,
      wind: 1,
      patchiness: 1,
    },
  },
  {
    id: "golden",
    name: "Golden Standoff",
    tagline: "The same town at sundown. Gold light against violet shade, lamps coming on.",
    colorStory: [
      { a: "#FFA94D", b: "#5B3FA8", note: "Sunlight against violet shade" },
      { a: "#FFC052", b: "#2C2358", note: "Lit windows against the dusk sky" },
      { a: "#E8603A", b: "#2F9C8E", note: "Hot earth against teal paint" },
    ],
    palette: {
      skyZenith: "#2C2358",
      skyMid: "#B83F6B",
      skyHorizon: "#FFA94D",
      sunDisc: "#FFF0B8",
      sunGlow: "#FFC766",
      fog: "#F59A50",
      street: "#D88F52",
      streetRut: "#C47C44",
      streetEdge: "#A96238",
      sandPatch: "#EDAE6C",
      darkDirt: "#A9603A",
      desert: "#C97B44",
      desertFar: "#DE8A48",
      mesaA: "#7C2F46",
      mesaB: "#993D45",
      mesaC: "#58243F",
      mesaTop: "#C85A42",
      wallSaloon: "#7E3024",
      wallSheriff: "#6E4630",
      wallStore: "#74603E",
      wallBank: "#94683E",
      wallBarn: "#62291F",
      wallA: "#7C4A2C",
      wallB: "#8C5E34",
      wallC: "#5A4436",
      wallD: "#74422C",
      church: "#D9B58A",
      trim: "#D8A868",
      trimDark: "#3A1F1E",
      roof: "#3E2424",
      boards: "#855434",
      post: "#54321F",
      glass: "#2A2440",
      glint: "#FFB45A",
      windowLit: "#FFC052",
      doorway: "#1E121C",
      door: "#4A2A1C",
      sign: "#2A1616",
      signText: "#FFC766",
      signAlt: "#E6BE84",
      signAltText: "#3A1D1C",
      bulb: "#FFEFB0",
      awningA: "#6E3B2C",
      awningB: "#5A2F28",
      bunting: "#D8704A",
      accent: "#2F7C86",
      metal: "#4A4048",
      brass: "#E8A83E",
      barrel: "#70431F",
      band: "#2E2024",
      canvas: "#EBC79A",
      hay: "#E0A540",
      water: "#E9925A",
      cactus: "#3F6650",
      cactusDark: "#2F4F44",
      rock: "#8E5040",
      scrub: "#8A7240",
      twig: "#6E4428",
      leaf: "#E8603A",
      cloud: "#F4687A",
      cloudShade: "#7C2F6E",
    },
    light: {
      azimuth: 7,
      elevation: 10,
      sun: "#FFC383",
      sunGain: 0.92,
      sunCurve: 0.5,
      bands: 0,
      ambientSky: "#7C5CA8",
      ambientGround: "#B0603E",
      ambientGain: 0.74,
      fogDensity: 0.0034,
      fogMax: 0.7,
      charFill: "#FFB98A",
      charFillGain: 0.34,
      charLight: "#FFE4BE",
      charShade: "#B79AC0",
      charRim: "#FFB060",
      washGain: 0.26,
      washRadius: 0.6,
    },
    sky: { bands: 0, midAt: 13, zenithAt: 44, sunSize: 4.4, glowSize: 22, glowGain: 0.85, clouds: "streaks" },
    kit: {
      planks: "h",
      plankH: 0.42,
      tintVar: 0.12,
      trimT: 0.12,
      trimH: 0.2,
      wonk: 1,
      heightMul: 1,
      windowMul: 1,
      stripedAwnings: false,
      logPosts: true,
      chunk: 1.45,
      topMap: {},
      litWindows: 0.75,
      glow: 1.3,
      dust: 0.6,
      wind: 0.8,
      patchiness: 0.8,
    },
  },
  {
    id: "toybox",
    name: "Toybox Noon",
    tagline: "Painted wooden toy town. Candy colours, square-built, clean cel light.",
    colorStory: [
      { a: "#F08A3C", b: "#4E9CD0", note: "Orange paint against blue sky" },
      { a: "#D13F2E", b: "#2BA39A", note: "Red saloon against teal store" },
      { a: "#FFD24A", b: "#7A4FC4", note: "Yellow trim against violet accents" },
    ],
    palette: {
      skyZenith: "#1F86DB",
      skyMid: "#5DBCF0",
      skyHorizon: "#CFF0EE",
      sunDisc: "#FFFBE0",
      sunGlow: "#FFF6C8",
      fog: "#D6EBDD",
      street: "#E0AE74",
      streetRut: "#CF9A62",
      streetEdge: "#C78F58",
      sandPatch: "#F2CE96",
      darkDirt: "#CC9860",
      desert: "#EBC48A",
      desertFar: "#F0CF9A",
      mesaA: "#D9663F",
      mesaB: "#EE8A52",
      mesaC: "#BF4F36",
      mesaTop: "#F7B277",
      wallSaloon: "#D13F2E",
      wallSheriff: "#E9B23A",
      wallStore: "#2BA39A",
      wallBank: "#F3E4BE",
      wallBarn: "#B8392C",
      wallA: "#4E9CD0",
      wallB: "#F08A3C",
      wallC: "#7DBB5E",
      wallD: "#E98BA0",
      church: "#FBF5E4",
      trim: "#FFF3D4",
      trimDark: "#7A4726",
      roof: "#8C5230",
      boards: "#BC8148",
      post: "#FFF3D4",
      glass: "#2C5C7C",
      glint: "#BFEBFA",
      windowLit: "#FFD24A",
      doorway: "#2E1E17",
      door: "#7A4726",
      sign: "#FFF3D4",
      signText: "#2B1D14",
      signAlt: "#2B1D14",
      signAltText: "#FFD24A",
      bulb: "#FFF3B0",
      awningA: "#E8483A",
      awningB: "#FFF6E0",
      bunting: "#FFD24A",
      accent: "#2BA39A",
      metal: "#5F6B73",
      brass: "#FFC93C",
      barrel: "#B87333",
      band: "#4A3424",
      canvas: "#FFF8E6",
      hay: "#F0C94A",
      water: "#47B5E0",
      cactus: "#3FA653",
      cactusDark: "#2F8A45",
      rock: "#C9926A",
      scrub: "#8FAD4E",
      twig: "#9A6F3E",
      leaf: "#E8483A",
      cloud: "#FFFFFF",
      cloudShade: "#BFE0F2",
    },
    light: {
      azimuth: 150,
      elevation: 58,
      sun: "#FFF4D8",
      sunGain: 0.62,
      sunCurve: 1,
      bands: 3,
      ambientSky: "#BFD9F0",
      ambientGround: "#E3B98E",
      ambientGain: 0.62,
      fogDensity: 0.0016,
      fogMax: 0.55,
      charFill: "#FFF4E0",
      charFillGain: 0.12,
      charLight: "#FFFFFF",
      charShade: "#CFD8EC",
      charRim: "#FFFFFF",
      washGain: 0,
      washRadius: 1,
    },
    sky: { bands: 0, midAt: 9, zenithAt: 36, sunSize: 3.2, glowSize: 12, glowGain: 0.45, clouds: "puffy" },
    kit: {
      planks: "panel",
      plankH: 0.9,
      tintVar: 0.018,
      trimT: 0.3,
      trimH: 0.4,
      wonk: 0,
      heightMul: 0.94,
      windowMul: 1.22,
      stripedAwnings: true,
      logPosts: false,
      chunk: 1.5,
      topMap: { arch: "stepped", curve: "stepped" },
      litWindows: 0,
      glow: 0.2,
      dust: 0,
      wind: 0.55,
      patchiness: 0.45,
    },
  },
];
