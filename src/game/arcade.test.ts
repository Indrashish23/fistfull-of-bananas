import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCORES,
  GRADE_BONUS,
  InitialsEntry,
  TABLE_SIZE,
  addToTable,
  gradeFor,
  loadScores,
  placeInTable,
  saveScores,
  waveReport,
} from "./arcade";

const stats = (hits: number, shots: number, bestCombo: number, heartsLost: number) => ({ kills: hits, shots, hits, bestCombo, heartsLost });

describe("grades", () => {
  it("gives an S for clean, accurate, unbroken shooting", () => {
    expect(gradeFor(stats(10, 10, 10, 0))).toBe("S");
  });

  it("gives a C for spraying and getting hurt", () => {
    expect(gradeFor(stats(3, 20, 1, 3))).toBe("C");
  });

  it("doesn't fall over if you never fired", () => {
    expect(gradeFor(stats(0, 0, 0, 0))).toBe("C");
    expect(waveReport(1, stats(0, 0, 0, 0)).accuracy).toBe(0);
  });

  it("never gets worse for better play", () => {
    const worse = gradeFor(stats(5, 10, 3, 1));
    const better = gradeFor(stats(8, 10, 8, 0));
    expect("SABC".indexOf(better)).toBeLessThanOrEqual("SABC".indexOf(worse));
  });

  it("reports the wave, its accuracy and the bonus that goes with the grade", () => {
    const r = waveReport(2, stats(6, 8, 4, 0));
    expect(r.wave).toBe(2);
    expect(r.accuracy).toBeCloseTo(0.75);
    expect(r.bonus).toBe(GRADE_BONUS[r.grade]);
  });
});

describe("the high score table", () => {
  it("finds where a score lands", () => {
    expect(placeInTable(DEFAULT_SCORES, 999999)).toBe(0);
    expect(placeInTable(DEFAULT_SCORES, 6000)).toBe(3);
    expect(placeInTable(DEFAULT_SCORES, 100)).toBe(-1);
    expect(placeInTable(DEFAULT_SCORES, 0)).toBe(-1);
  });

  it("doesn't count tying the last place", () => {
    expect(placeInTable(DEFAULT_SCORES, DEFAULT_SCORES[TABLE_SIZE - 1]!.score)).toBe(-1);
  });

  it("slots a new score in and drops the last", () => {
    const table = addToTable(DEFAULT_SCORES, { name: "AAA", score: 9000 });
    expect(table.length).toBe(TABLE_SIZE);
    expect(table[2]).toEqual({ name: "AAA", score: 9000 });
    expect(table.some((s) => s.name === DEFAULT_SCORES[TABLE_SIZE - 1]!.name)).toBe(false);
  });

  it("saves and loads", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const table = addToTable(DEFAULT_SCORES, { name: "BOB", score: 30000 });
    saveScores(storage, table);
    expect(loadScores(storage)).toEqual(table);
  });

  it("falls back to the defaults on nothing, junk or no storage at all", () => {
    expect(loadScores(null)).toEqual(DEFAULT_SCORES);
    expect(loadScores({ getItem: () => "{not json" })).toEqual(DEFAULT_SCORES);
    expect(loadScores({ getItem: () => JSON.stringify([{ nope: 1 }]) })).toEqual(DEFAULT_SCORES);
    expect(loadScores({ getItem: () => { throw new Error("blocked"); } })).toEqual(DEFAULT_SCORES);
    expect(() => saveScores({ setItem: () => { throw new Error("full"); } }, DEFAULT_SCORES)).not.toThrow();
  });
});

describe("typing your initials", () => {
  it("starts at AAA, with the letters wrapping round", () => {
    const e = new InitialsEntry();
    expect(e.name).toBe("AAA");
    e.change(-1);
    expect(e.name).toBe("ZAA");
    e.change(2);
    expect(e.name).toBe("BAA");
  });

  it("moves between letters, but not past the ends", () => {
    const e = new InitialsEntry();
    e.move(-1);
    expect(e.cursor).toBe(0);
    e.move(5);
    expect(e.cursor).toBe(2);
    e.change(1);
    expect(e.name).toBe("AAB");
  });

  it("finishes on the third OK", () => {
    const e = new InitialsEntry();
    expect(e.confirm()).toBe(false);
    expect(e.confirm()).toBe(false);
    expect(e.confirm()).toBe(true);
    expect(e.done).toBe(true);
  });
});
