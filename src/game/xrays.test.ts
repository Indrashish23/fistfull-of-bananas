import { describe, expect, it } from "vitest";
import { XRAYS_BY_ZONE, XRAY_LABEL } from "./rules";
import { RUSH, Rush, projectToScreen, type RushEnemy, type RushEvent } from "./rush";

const DT = 1 / 60;
const AWAY = { x: 0.02, y: 0.02 };
const basics = { dodgeSlowChance: 0, duckChance: 0, pierceChance: 0, peek: false, barrelsDrop: false, ammo: Infinity, whiskeyEvery: 0, rollEvery: 0 };

function run(g: Rush, seconds: number, aim = AWAY, fire = false): RushEvent[] {
  const events: RushEvent[] = [];
  for (let i = 0; i < seconds / DT && !g.over; i++) {
    g.step(DT, { aim, fire, lean: 0, duck: false });
    events.push(...g.drainEvents());
  }
  return events;
}

const make = (g: Rush): RushEnemy => (g as unknown as { makeEnemy(k: string): RushEnemy }).makeEnemy("rusher");

describe("the x-rays", () => {
  it("have at least five angles on the head, and more besides", () => {
    expect(XRAYS_BY_ZONE.head.length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(XRAY_LABEL).length).toBeGreaterThanOrEqual(8);
  });

  it("go through every shot before any repeats", () => {
    const g = new Rush(basics);
    const pick = (g as unknown as { pickXray(z: string): string }).pickXray.bind(g);
    const seen = XRAYS_BY_ZONE.head.map(() => pick("head"));
    expect(new Set(seen)).toEqual(new Set(XRAYS_BY_ZONE.head));
  });

  it("never show the same one twice running, even between rounds of them", () => {
    const g = new Rush({ ...basics, seed: 3 });
    const pick = (g as unknown as { pickXray(z: string): string }).pickXray.bind(g);
    let last = "";
    for (let i = 0; i < 60; i++) {
      const next = pick("head");
      expect(next).not.toBe(last);
      last = next;
    }
  });

  it("always give a nut shot its x-ray", () => {
    for (let i = 0; i < 8; i++) {
      const g = new Rush({ ...basics, camChance: 0.0001, seed: i + 1, waves: [{ gap: 99, enemies: ["rusher", 99, "rusher"] }] });
      run(g, DT * 2);
      const e = g.enemies[0]!;
      e.x = 0;
      e.z = -12;
      e.hatOff = true;
      e.dodger = false;
      const at = projectToScreen(e.x, 0.62, e.z, g.cameraX, g.cameraY)!;
      run(g, DT, at, true);
      expect(g.cam?.zone).toBe("nuts");
      expect(XRAYS_BY_ZONE.nuts).toContain(g.cam?.xray);
    }
  });

  it("name what they hit", () => {
    const g = new Rush({ ...basics, camChance: 1, waves: [{ gap: 99, enemies: ["rusher", 99, "rusher"] }] });
    run(g, DT * 2);
    const e = g.enemies[0]!;
    e.x = 0;
    e.z = -12;
    e.hatOff = true;
    e.dodger = false;
    const at = projectToScreen(e.x, 2, e.z, g.cameraX, g.cameraY)!;
    const events = run(g, DT, at, true);
    const scored = events.find((x) => x.type === "scored");
    expect(scored && scored.type === "scored" && scored.label).toBe(XRAY_LABEL[g.cam!.xray]);
  });
});

describe("the last kill of a wave", () => {
  const twoLeft = () => {
    const g = new Rush({ ...basics, camChance: 0, waves: [{ gap: 0.01, enemies: ["rusher", "rusher"] }, { gap: 1, enemies: ["rusher"] }] });
    run(g, 0.1);
    for (const e of g.enemies) {
      e.z = -12;
      e.dodger = false;
      e.hatOff = true;
    }
    g.enemies[0]!.x = -2;
    g.enemies[1]!.x = 2;
    return g;
  };
  const shoot = (g: Rush, e: RushEnemy) => run(g, DT, projectToScreen(e.x, 1, e.z, g.cameraX, g.cameraY)!, true);

  it("isn't slowed for anyone but the last", () => {
    const g = twoLeft();
    expect(shoot(g, g.enemies[0]!).some((x) => x.type === "lastKill")).toBe(false);
    expect(g.timeScale).not.toBe(RUSH.slowScale);
  });

  it("goes down in slow motion, and the tally waits for it", () => {
    const g = twoLeft();
    shoot(g, g.enemies[0]!);
    run(g, RUSH.fireGapSec + 0.1);
    const last = g.enemies[0]!;
    last.z = -12;
    const events = shoot(g, last);
    expect(events.some((x) => x.type === "lastKill")).toBe(true);
    run(g, 0.1);
    expect(g.timeScale).toBe(RUSH.slowScale);
    expect(g.phase).toBe("rush");
    const later = run(g, RUSH.lastKillSlowSec + 0.2);
    expect(later.some((x) => x.type === "cleared")).toBe(true);
    expect(g.timeScale).toBe(1);
  });

  it("doesn't count someone who just ran past you", () => {
    const g = new Rush({ ...basics, camChance: 0, waves: [{ gap: 1, enemies: ["golden"] }, { gap: 1, enemies: ["rusher"] }] });
    const events = run(g, 8);
    expect(events.some((x) => x.type === "goldenEscaped")).toBe(true);
    expect(events.some((x) => x.type === "lastKill")).toBe(false);
  });
});
