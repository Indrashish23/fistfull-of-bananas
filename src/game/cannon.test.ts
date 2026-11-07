import { describe, expect, it } from "vitest";
import { RUSH, RUSH_WAVES, Rush, type RushEvent, type RushInput, type RushWave } from "./rush";

const DT = 1 / 60;
const AWAY = { x: 0.02, y: 0.02 };
const basics = { camChance: 0, dodgeSlowChance: 0, duckChance: 0, pierceChance: 0, peek: false, barrelsDrop: false, ammo: Infinity, whiskeyEvery: 0, rollEvery: 0 };
const withWaves = (...waves: RushWave[]) => new Rush({ ...basics, waves });

function run(g: Rush, seconds: number, input: Partial<RushInput> = {}): RushEvent[] {
  const events: RushEvent[] = [];
  for (let i = 0; i < seconds / DT && !g.over; i++) {
    g.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false, ...input });
    events.push(...g.drainEvents());
  }
  return events;
}

/** Runs until the cannon's at this stage, leaning the right way if asked. */
function until(g: Rush, phase: string, lean = false): RushEvent[] {
  const events: RushEvent[] = [];
  for (let i = 0; i < 1200 && g.cannon?.phase !== phase; i++) {
    const move = g.cannon?.move;
    g.step(DT, { aim: AWAY, fire: false, lean: lean ? (move === "left" ? -1 : move === "right" ? 1 : 0) : 0, duck: false });
    events.push(...g.drainEvents());
  }
  return events;
}

const cannonWave: RushWave = { gap: 0.5, enemies: ["cannon", "rusher"] };

describe("the wave rhythm", () => {
  it("rests where a wave says to", () => {
    const g = withWaves({ gap: 0.1, enemies: ["rusher", 3, "rusher"] });
    run(g, 2);
    expect(g.enemies.length).toBe(1);
    run(g, 1.5);
    expect(g.enemies.length).toBe(2);
  });

  it("holds anyone else back while the cap's reached", () => {
    const g = withWaves({ gap: 0.05, cap: 2, enemies: ["rusher", "rusher", "rusher"] });
    run(g, 1);
    expect(g.enemies.length).toBe(2);
    g.enemies.pop();
    run(g, 0.2);
    expect(g.enemies.length).toBe(2);
  });

  it("gives you a breather after a hit", () => {
    const g = withWaves({ gap: 0.05, enemies: ["rusher", 0.1, "rusher"] });
    run(g, DT * 2);
    (g as unknown as { hurt(): void }).hurt();
    run(g, RUSH.mercySec - 0.2);
    expect(g.enemies.length).toBe(1);
  });

  it("brings the cannon into the later waves, and never the first", () => {
    expect(RUSH_WAVES[0]!.enemies).not.toContain("cannon");
    expect(RUSH_WAVES[1]!.enemies).toContain("cannon");
    expect(RUSH_WAVES[2]!.enemies).toContain("cannon");
  });

  it("never ends a wave on a rest", () => {
    for (const wave of RUSH_WAVES) expect(typeof wave.enemies[wave.enemies.length - 1]).toBe("string");
  });
});

describe("the cannon", () => {
  it("is wheeled out by two lizards, then warns you which way to lean", () => {
    const g = withWaves(cannonWave);
    const started = run(g, DT * 2);
    expect(started.some((e) => e.type === "cannonRollout")).toBe(true);
    expect(g.cannon?.phase).toBe("rollout");
    expect(g.enemies.filter((e) => e.crew !== 0).length).toBe(2);
    expect(g.wordMove).toBeNull();
    until(g, "warn");
    run(g, DT);
    expect(g.wordMove).toBe(g.cannon!.side < 0 ? "right" : "left");
    expect(g.cannonAlertAt).not.toBeNull();
  });

  it("holds everyone still and brings out nobody new until it's over", () => {
    const g = withWaves({ gap: 0.05, enemies: ["rusher", "cannon", "rusher", "rusher"] });
    run(g, 0.2);
    const walker = g.enemies.find((e) => e.crew === 0)!;
    const z = walker.z;
    expect(g.cannon).not.toBeNull();
    const before = g.enemies.length;
    until(g, "recover", true);
    expect(walker.z).toBe(z);
    expect(g.enemies.length).toBeLessThanOrEqual(before);
    expect(g.enemies.filter((e) => e.crew === 0).length).toBeLessThanOrEqual(1);
  });

  it("tramples whoever's in its path, on the spot, and they stay on the ball", () => {
    const g = withWaves(cannonWave);
    until(g, "roll");
    const make = g as unknown as { makeEnemy(k: string): { x: number; z: number; outfit: number; crew: number } };
    const victim = make.makeEnemy("fat");
    victim.x = g.cannon!.x;
    victim.z = g.cannon!.z + 5;
    g.enemies.push(victim as never);
    const kills = g.kills;
    const events = run(g, 0.6, { lean: g.cannon!.move === "left" ? -1 : 1 });
    expect(events.some((e) => e.type === "trampled")).toBe(true);
    expect(g.kills).toBe(kills + 1);
    expect(g.enemies.includes(victim as never)).toBe(false);
    expect(g.cannon!.stuck.map((s) => s.outfit)).toContain(victim.outfit);
    expect(events.some((e) => e.type === "scored" && e.label === "TRAMPLED!")).toBe(true);
  });

  it("sets off barrels it hits", () => {
    const g = withWaves(cannonWave);
    until(g, "roll");
    g.barrels.push({ id: 900, x: g.cannon!.x, z: g.cannon!.z + 5, roll: 0, turned: 0, y: 0, vy: 0 });
    const events = run(g, 0.6);
    expect(events.some((e) => e.type === "barrel")).toBe(true);
  });

  it("misses you if you lean away from it", () => {
    const g = withWaves(cannonWave);
    const events = until(g, "recover", true);
    expect(g.hearts).toBe(RUSH.hearts);
    expect(events.some((e) => e.type === "dodged")).toBe(true);
    expect(events.some((e) => e.type === "scored" && e.label === "DODGED!")).toBe(true);
  });

  it("costs a heart if you stay put, or lean into it", () => {
    const stay = withWaves(cannonWave);
    until(stay, "recover");
    expect(stay.hearts).toBe(RUSH.hearts - 1);
    const wrong = withWaves(cannonWave);
    until(wrong, "roll");
    run(wrong, 3, { lean: wrong.cannon!.move === "left" ? 1 : -1 });
    expect(wrong.hearts).toBe(RUSH.hearts - 1);
  });

  it("brings your view back by itself, and only then lets anyone come at you", () => {
    const g = withWaves(cannonWave);
    until(g, "recover", true);
    expect(Math.abs(g.lean)).toBeGreaterThan(RUSH.leanedAt);
    const hold = g.lean < 0 ? -1 : 1;
    const crew = g.enemies.filter((e) => e.crew !== 0);
    const z = crew[0]!.z;
    run(g, RUSH.cannonRecoverSec - 0.05, { lean: hold });
    expect(Math.abs(g.lean)).toBeLessThan(0.15);
    expect(crew[0]!.z).toBe(z);
    run(g, 0.3);
    expect(g.cannon).toBeNull();
    expect(crew[0]!.z).toBeGreaterThan(z);
    expect(crew[0]!.weapon).not.toBeNull();
    expect(g.parkedCannons.length).toBe(1);
  });

  it("doesn't let the wave end while it's still going", () => {
    const g = withWaves({ gap: 0.5, enemies: ["cannon"] });
    run(g, DT * 2);
    g.enemies = [];
    const events = until(g, "recover", true);
    expect(events.some((e) => e.type === "cleared")).toBe(false);
  });
});

describe("raising a shield", () => {
  it("is shootable until it's up, then it blocks", () => {
    const g = new Rush({ ...basics, peek: true, waves: [{ gap: 1, enemies: ["shield"] }] });
    run(g, DT * 2);
    const e = g.enemies[0]!;
    expect(e.shieldHp).toBe(RUSH.shieldHits);
    for (let i = 0; i < 600 && e.raising <= 0; i++) run(g, DT);
    expect(e.raising).toBeGreaterThan(0);
    const z = e.z;
    run(g, RUSH.shieldRaiseSec - 0.1);
    expect(e.z).toBe(z);
    run(g, 0.3);
    expect(e.z).toBeGreaterThan(z);
  });
});
