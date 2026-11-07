import { describe, expect, it } from "vitest";
import { ARCADE_PALETTE, LUT_SIZE, buildPaletteLut, nearestColor } from "./post";

const parse = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

describe("the arcade palette", () => {
  const palette = ARCADE_PALETTE.map(parse);

  it("keeps a colour that's already in the palette", () => {
    for (const c of palette) expect(nearestColor(c[0], c[1], c[2], palette)).toEqual(c);
  });

  it("keeps black, white and hot fire close to what they were", () => {
    const off = (r: number, g: number, b: number) => {
      const c = nearestColor(r, g, b, palette);
      return Math.hypot(c[0] - r, c[1] - g, c[2] - b);
    };
    expect(off(0, 0, 0)).toBeLessThan(30);
    expect(off(255, 255, 255)).toBe(0);
    expect(off(255, 138, 30)).toBe(0);
  });

  it("bakes a table holding only palette colours, in the layout the shader reads", () => {
    const lut = buildPaletteLut(ARCADE_PALETTE, 8);
    expect(lut.length).toBe(8 * 8 * 8 * 4);
    const allowed = new Set(palette.map((c) => c.join()));
    for (let i = 0; i < lut.length; i += 4) {
      expect(allowed.has(`${lut[i]},${lut[i + 1]},${lut[i + 2]}`)).toBe(true);
      expect(lut[i + 3]).toBe(255);
    }
    // Pure red is at slice blue 0, row green 0, last across: the shader's (b * size + r, g).
    const at = (r: number, g: number, b: number) => (g * 8 * 8 + b * 8 + r) * 4;
    const red = at(7, 0, 0);
    expect([lut[red], lut[red + 1], lut[red + 2]]).toEqual([...nearestColor(255, 0, 0, palette)]);
    expect(LUT_SIZE).toBe(32);
  });
});
