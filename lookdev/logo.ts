// The game's logo, as generated SVG: a heavy black die-cut sticker, hand-cut wedge letters on a
// staggered baseline, a shouting cowboy monkey and a bunch of bananas. The letterforms are drawn
// here as polygons, so there is no font behind them.

type Pt = [number, number];
interface Glyph {
  outer: Pt[];
  holes?: Pt[][];
}

/** Letters sit on a 0..140 tall grid. Strokes flare out at the ends, as if cut with a chisel. */
const G: Record<string, Glyph> = {
  R: {
    outer: [[-2, 0], [74, 0], [102, 18], [102, 62], [80, 77], [110, 140], [64, 140], [44, 86], [38, 86], [42, 140], [-2, 140], [8, 70]],
    holes: [[[38, 27], [64, 27], [64, 53], [38, 57]]],
  },
  A: {
    outer: [[30, 0], [74, 0], [112, 140], [68, 140], [62, 114], [38, 114], [30, 140], [-8, 140]],
    holes: [[[44, 88], [57, 88], [50, 44]]],
  },
  G: {
    outer: [[14, 0], [100, -3], [102, 36], [62, 30], [40, 30], [40, 108], [62, 112], [62, 90], [48, 90], [50, 62], [104, 60], [98, 140], [14, 140], [-2, 122], [-2, 16]],
  },
  E: {
    outer: [[-2, 0], [102, -3], [94, 30], [42, 28], [42, 56], [86, 53], [82, 84], [42, 84], [42, 110], [104, 107], [96, 141], [-2, 140], [8, 70]],
  },
  B: {
    outer: [[-2, 0], [80, 0], [102, 16], [102, 54], [88, 68], [106, 84], [106, 124], [86, 140], [-2, 140], [8, 70]],
    holes: [[[38, 27], [64, 27], [64, 53], [38, 55]], [[38, 83], [66, 83], [66, 113], [38, 113]]],
  },
  I: { outer: [[-4, 0], [62, 0], [50, 70], [62, 140], [-4, 140], [8, 70]] },
  T: { outer: [[-8, -2], [110, -4], [114, 38], [74, 30], [66, 70], [74, 140], [28, 140], [36, 70], [28, 30], [-12, 38]] },
  S: {
    outer: [[14, 0], [102, -3], [96, 32], [44, 28], [42, 50], [88, 52], [104, 68], [104, 124], [88, 140], [-2, 142], [6, 106], [60, 112], [60, 84], [16, 84], [-2, 68], [-2, 14]],
  },
  H: {
    outer: [[-3, 0], [44, 0], [38, 54], [64, 54], [58, 0], [106, 0], [96, 70], [106, 140], [58, 140], [64, 86], [38, 86], [44, 140], [-3, 140], [8, 70]],
  },
  O: {
    outer: [[18, 0], [86, 0], [104, 18], [104, 122], [86, 140], [18, 140], [-2, 122], [-2, 18]],
    holes: [[[40, 28], [62, 28], [62, 112], [40, 112]]],
  },
  W: {
    outer: [[-8, 0], [36, 0], [40, 82], [58, 18], [78, 18], [94, 82], [98, 0], [142, 0], [116, 140], [76, 140], [67, 86], [58, 140], [18, 140]],
  },
  D: {
    outer: [[-3, 0], [78, 0], [104, 22], [104, 118], [78, 140], [-3, 140], [8, 70]],
    holes: [[[40, 28], [60, 28], [63, 112], [40, 112]]],
  },
  N: {
    outer: [[-3, 0], [42, 0], [66, 68], [62, 0], [108, 0], [97, 70], [108, 140], [66, 140], [42, 70], [46, 140], [-3, 140], [8, 70]],
  },
  F: {
    outer: [[-2, 0], [102, -3], [94, 30], [42, 28], [42, 58], [86, 55], [82, 86], [42, 86], [46, 140], [-2, 140], [8, 70]],
  },
  U: {
    outer: [[-3, 0], [44, 0], [38, 70], [40, 108], [62, 108], [64, 70], [58, 0], [106, 0], [96, 70], [104, 122], [86, 140], [18, 140], [0, 122], [8, 70]],
  },
  L: { outer: [[-3, 0], [44, 0], [38, 70], [42, 107], [100, 104], [94, 141], [-3, 140], [8, 70]] },
};

const poly = (pts: Pt[]) => `M${pts.map((p) => `${p[0]} ${p[1]}`).join("L")}Z`;

function glyphPath(ch: string) {
  const g = G[ch];
  return poly(g.outer) + (g.holes ?? []).map(poly).join("");
}

function widthOf(ch: string) {
  const xs = G[ch].outer.map((p) => p[0]);
  return Math.max(...xs) - Math.min(...xs);
}

/** Same tiny offsets every time: a letter's rotation and hop, so nothing sits quite level. */
const WOBBLE: Pt[] = [[-4, 2], [3, -5], [-2, 6], [4, -2], [-3, 4], [2, -6], [-4, 3], [3, 1]];

function line(word: string, x: number, y: number, scale: number, gap: number) {
  const parts: string[] = [];
  let cursor = x;
  [...word].forEach((ch, i) => {
    const [rot, hop] = WOBBLE[i % WOBBLE.length];
    const w = widthOf(ch) * scale;
    const cx = w / 2;
    const cy = 70 * scale;
    parts.push(
      `<path fill-rule="evenodd" d="${glyphPath(ch)}" transform="translate(${cursor + 8 * scale} ${y + hop}) rotate(${rot} ${cx} ${cy}) scale(${scale})"/>`,
    );
    cursor += w + gap;
  });
  return parts.join("");
}

const INK = "#110A06";
const CREAM = "#FFF7E6";
const GOLD = "#FFC33D";
const RED = "#E8483A";

/** The emblem: a monkey in a cowboy hat, mid-shout. */
const EMBLEM = `
  <g transform="translate(120 -62) rotate(-7)">
    <g fill="${INK}" stroke="${INK}" stroke-width="20" stroke-linejoin="round">
      <circle cx="-112" cy="-6" r="42"/>
      <circle cx="112" cy="-6" r="42"/>
      <ellipse cx="0" cy="-8" rx="104" ry="96"/>
      <path d="M-206 -86 C-150 -58 -112 -66 -84 -80 L-74 -162 C-54 -190 -20 -176 0 -166 C20 -176 54 -190 74 -162 L84 -80 C112 -66 150 -58 206 -86 C186 -24 110 -30 0 -30 C-110 -30 -186 -24 -206 -86Z"/>
    </g>
    <path d="M-79 -92 L-76 -118 C-30 -106 30 -106 76 -118 L79 -92 C30 -80 -30 -80 -79 -92Z" fill="${RED}"/>
    <g fill="${GOLD}">
      <ellipse cx="-44" cy="6" rx="34" ry="38"/>
      <ellipse cx="44" cy="6" rx="34" ry="38"/>
      <circle cx="-112" cy="-4" r="20"/>
      <circle cx="112" cy="-4" r="20"/>
    </g>
    <g fill="${INK}">
      <ellipse cx="-38" cy="10" rx="14" ry="18"/>
      <ellipse cx="38" cy="10" rx="14" ry="18"/>
      <path d="M-82 -30 L-10 -14 L-16 -2 L-84 -16Z"/>
      <path d="M82 -30 L10 -14 L16 -2 L84 -16Z"/>
    </g>
  </g>
`;

const BANANA = "#FFD93D";
const BANANA_SHADE = "#E59B1C";
const STEM = "#6B4A1E";

/** One banana, from its stem at the origin to its tip: a fat top curve and a flatter belly. */
const BANANA_BODY = "M0 0 C60 -34 168 -14 206 70 C164 34 76 30 0 24Z";
const BANANA_RIDGE = "M14 8 C78 -8 160 10 196 62";

/** The other emblem: a bunch of three, fanned out from one stem, for the fistful. */
function bunch(fill: string, ink: boolean): string {
  const fan = [-38, -12, 14];
  return fan
    .map((turn) => {
      const body = `<path d="${BANANA_BODY}"/>`;
      const detail = ink ? "" : `<path d="${BANANA_RIDGE}" fill="none" stroke="${BANANA_SHADE}" stroke-width="7" stroke-linecap="round"/><circle cx="204" cy="69" r="8" fill="${STEM}"/>`;
      return `<g transform="rotate(${turn})" fill="${fill}">${body}${detail}</g>`;
    })
    .join("") + `<rect x="-38" y="-6" width="44" height="30" rx="6" fill="${ink ? fill : STEM}"/>`;
}

const BUNCH = `
  <g transform="translate(700 -118) rotate(12)">
    <g stroke="${INK}" stroke-width="22" stroke-linejoin="round" transform="translate(4 9)">${bunch(INK, true)}</g>
    <g stroke="${INK}" stroke-width="16" stroke-linejoin="round">${bunch(INK, true)}</g>
    ${bunch(BANANA, false)}
  </g>
`;

export function logoSvg(): string {
  const words = line("FISTFULL", 10, 14, 1, 6) + line("BANANAS", 140, 150, 0.9, 6);
  const of = line("OF", 14, 196, 0.52, 4);
  const cut = (body: string) => `
      <g fill="${INK}" stroke="${INK}" stroke-width="34" stroke-linejoin="miter" stroke-miterlimit="3" transform="translate(4 9)">${body}</g>
      <g fill="${INK}" stroke="${INK}" stroke-width="27" stroke-linejoin="miter" stroke-miterlimit="3">${body}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-110 -240 1110 590" role="img" aria-label="Fistfull of Bananas">
    <g transform="rotate(-4 450 150)">
      ${EMBLEM}
      ${BUNCH}
      ${cut(words + of)}
      <g fill="${CREAM}">${words}</g>
      <g fill="${GOLD}">${of}</g>
    </g>
  </svg>`;
}
