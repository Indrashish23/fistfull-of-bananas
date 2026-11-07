import { describe, expect, it } from "vitest";
import { RUSH, Rush, projectToScreen, type RushInput } from "./rush";
import { SETTINGS_KEY, loadSettings, nextAimLevel, saveSettings, type AimLevel } from "./settings";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("the settings", () => {
  it("start on soft, and survive being closed and opened", () => {
    const store = memory();
    expect(loadSettings(store).aimLevel).toBe("soft");
    saveSettings(store, { aimLevel: "hard" });
    expect(loadSettings(store).aimLevel).toBe("hard");
  });

  it("shrug off a corrupted save, or a level that doesn't exist", () => {
    const store = memory();
    store.setItem(SETTINGS_KEY, "{nope");
    expect(loadSettings(store).aimLevel).toBe("soft");
    store.setItem(SETTINGS_KEY, JSON.stringify({ aimLevel: "aimbot" }));
    expect(loadSettings(store).aimLevel).toBe("soft");
  });

  it("wrap round at both ends", () => {
    expect(nextAimLevel("hard", 1)).toBe("off");
    expect(nextAimLevel("off", -1)).toBe("hard");
    expect(nextAimLevel("soft", 1)).toBe("normal");
  });
});

describe("the aim levels", () => {
  const DT = 1 / 60;
  const AWAY = { x: 0.02, y: 0.02 };
  const fight = (aimLevel: AimLevel) => {
    const g = new Rush({ camChance: 0, dodgeSlowChance: 0, duckChance: 0, pierceChance: 0, peek: false, barrelsDrop: false, ammo: Infinity, whiskeyEvery: 0, rollEvery: 0, waves: [{ gap: 99, enemies: ["rusher"] }], aimLevel });
    const step = (input: Partial<RushInput> = {}) => g.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false, assist: 1, ...input });
    step();
    const e = g.enemies[0]!;
    e.x = 0;
    e.z = -14;
    return { g, e, step };
  };
  /** How far the reticle ends up from your arm, held near someone. */
  const pull = (level: AimLevel, off: number) => {
    const { g, e, step } = fight(level);
    const at = projectToScreen(e.x, 1.35, e.z, g.cameraX, g.cameraY)!;
    const aim = { x: at.x + off, y: at.y };
    for (let i = 0; i < 40; i++) {
      e.z = -14;
      step({ aim });
    }
    return Math.abs(g.aim.x - aim.x);
  };

  it("gives no help at all when it's off", () => {
    expect(pull("off", 0.03)).toBe(0);
  });

  it("gets stronger with every level", () => {
    const soft = pull("soft", 0.03);
    const normal = pull("normal", 0.03);
    const hard = pull("hard", 0.03);
    expect(soft).toBeGreaterThan(0);
    expect(normal).toBeGreaterThan(soft);
    expect(hard).toBeGreaterThan(normal);
  });

  it("grabs from further away the higher it's set", () => {
    expect(pull("soft", 0.05)).toBe(0);
    expect(pull("hard", 0.05)).toBeGreaterThan(0);
  });

  it("takes a bigger move to pull free the higher it's set", () => {
    const held = (level: AimLevel) => {
      const { g, e, step } = fight(level);
      const at = projectToScreen(e.x, 1.35, e.z, g.cameraX, g.cameraY)!;
      const aim = { x: at.x + 0.02, y: at.y };
      for (let i = 0; i < 20; i++) { e.z = -14; step({ aim }); }
      const moved = { x: aim.x + 0.08, y: aim.y };
      for (let i = 0; i < 30; i++) { e.z = -14; step({ aim: moved }); }
      return Math.abs(g.aim.x - moved.x) > 0.005;
    };
    expect(held("soft")).toBe(false);
    expect(held("hard")).toBe(true);
    expect(RUSH.ammo).toBeGreaterThan(0);
  });
});
