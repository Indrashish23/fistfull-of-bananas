// The arcade's side of a run: grades, the bonus they pay, the high score table and typing in your initials.
// No DOM here, apart from the storage handed in.

export type Grade = "S" | "A" | "B" | "C";

export interface RunStats {
  kills: number;
  shots: number;
  /** Shots that hit something worth hitting. */
  hits: number;
  bestCombo: number;
  heartsLost: number;
}

export interface WaveReport extends RunStats {
  /** Which wave, from 1. */
  wave: number;
  accuracy: number;
  grade: Grade;
  bonus: number;
}

export const GRADE_BONUS: Record<Grade, number> = { S: 1000, A: 500, B: 250, C: 100 };

/** Out of 100: most of it's aim, then keeping a combo going, then not getting hit. */
export function gradeScore(stats: RunStats): number {
  const accuracy = stats.shots > 0 ? stats.hits / stats.shots : 0;
  const combo = Math.min(stats.bestCombo, 10) / 10;
  const clean = stats.heartsLost === 0 ? 1 : stats.heartsLost === 1 ? 0.5 : 0;
  return accuracy * 50 + combo * 30 + clean * 20;
}

export function gradeFor(stats: RunStats): Grade {
  const score = gradeScore(stats);
  return score >= 85 ? "S" : score >= 68 ? "A" : score >= 48 ? "B" : "C";
}

export function waveReport(wave: number, stats: RunStats): WaveReport {
  const grade = gradeFor(stats);
  return {
    ...stats,
    wave,
    accuracy: stats.shots > 0 ? stats.hits / stats.shots : 0,
    grade,
    bonus: GRADE_BONUS[grade],
  };
}

export interface HighScore {
  name: string;
  score: number;
}

export const TABLE_SIZE = 5;

/** Who's on the board before anyone's played. */
export const DEFAULT_SCORES: readonly HighScore[] = [
  { name: "GAT", score: 20000 },
  { name: "DOC", score: 12000 },
  { name: "MAE", score: 8000 },
  { name: "ZEK", score: 5000 },
  { name: "OLE", score: 2500 },
];

/** Where this score would land in the table, or -1 if it doesn't make it. */
export function placeInTable(table: readonly HighScore[], score: number): number {
  if (score <= 0) return -1;
  const at = table.findIndex((s) => score > s.score);
  if (at >= 0) return at;
  return table.length < TABLE_SIZE ? table.length : -1;
}

export function addToTable(table: readonly HighScore[], entry: HighScore): HighScore[] {
  const at = placeInTable(table, entry.score);
  if (at < 0) return [...table];
  return [...table.slice(0, at), entry, ...table.slice(at)].slice(0, TABLE_SIZE);
}

const STORE_KEY = "ragebait.highscores.v1";

/** Reads the table. Private windows and broken saves just get the defaults. */
export function loadScores(storage: Pick<Storage, "getItem"> | null): HighScore[] {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(STORE_KEY) ?? "null");
    if (!Array.isArray(saved)) return [...DEFAULT_SCORES];
    const table = saved.filter((s): s is HighScore =>
      typeof s?.name === "string" && typeof s?.score === "number" && Number.isFinite(s.score));
    return table.length > 0 ? table.slice(0, TABLE_SIZE) : [...DEFAULT_SCORES];
  } catch {
    return [...DEFAULT_SCORES];
  }
}

export function saveScores(storage: Pick<Storage, "setItem"> | null, table: readonly HighScore[]): void {
  try {
    storage?.setItem(STORE_KEY, JSON.stringify(table));
  } catch {
    // Nowhere to keep it, so it lasts as long as this screen does.
  }
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Three letters with a remote: up and down change one, left and right move, and OK locks it in. */
export class InitialsEntry {
  readonly letters = [0, 0, 0];
  cursor = 0;

  get done(): boolean {
    return this.cursor >= this.letters.length;
  }

  get name(): string {
    return this.letters.map((i) => LETTERS[i]).join("");
  }

  change(by: number): void {
    if (this.done) return;
    const i = this.letters[this.cursor]! + by;
    this.letters[this.cursor] = ((i % LETTERS.length) + LETTERS.length) % LETTERS.length;
  }

  move(by: number): void {
    if (this.done) return;
    this.cursor = Math.min(this.letters.length - 1, Math.max(0, this.cursor + by));
  }

  /** OK: on to the next letter. Returns whether that was the last. */
  confirm(): boolean {
    this.cursor += 1;
    return this.done;
  }
}
