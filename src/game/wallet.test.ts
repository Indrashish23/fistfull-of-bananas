import { describe, expect, it } from "vitest";
import { GUNS, gunById } from "./guns";
import { RUSH, Rush, type RushEvent, type RushInput } from "./rush";
import { WALLET_KEY, buyGun, coinsForRun, earn, equipGun, loadWallet, ownsGun, saveWallet, toggleDev } from "./wallet";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("the wallet", () => {
  it("starts with nothing but the revolver", () => {
    expect(loadWallet(memory())).toEqual({ coins: 0, owned: ["revolver"], equipped: "revolver" });
    expect(loadWallet(null).equipped).toBe("revolver");
  });

  it("survives being closed and opened again", () => {
    const store = memory();
    saveWallet(store, { coins: 750, owned: ["revolver", "tommy"], equipped: "tommy" });
    expect(loadWallet(store)).toEqual({ coins: 750, owned: ["revolver", "tommy"], equipped: "tommy" });
  });

  it("shrugs off a corrupted save, and guns that don't exist", () => {
    const bad = memory();
    bad.setItem(WALLET_KEY, "{nope");
    expect(loadWallet(bad).coins).toBe(0);
    const odd = memory();
    odd.setItem(WALLET_KEY, JSON.stringify({ coins: -5, owned: ["laser"], equipped: "laser" }));
    expect(loadWallet(odd)).toEqual({ coins: 0, owned: ["revolver"], equipped: "revolver" });
  });

  it("pays for a run, and more for winning", () => {
    expect(coinsForRun(4000, false)).toBe(100);
    expect(coinsForRun(4000, true)).toBeGreaterThan(coinsForRun(4000, false));
    expect(earn(loadWallet(null), 30).coins).toBe(30);
  });

  it("buys a gun you can afford and straps it on", () => {
    const rich = earn(loadWallet(null), gunById("tommy").price + 5);
    const bought = buyGun(rich, "tommy")!;
    expect(bought.coins).toBe(5);
    expect(bought.equipped).toBe("tommy");
    expect(buyGun(bought, "tommy")).toBeNull();
  });

  it("won't sell you what you can't pay for, or give you what you don't own", () => {
    const poor = loadWallet(null);
    expect(buyGun(poor, "golden_tommy")).toBeNull();
    expect(equipGun(poor, "golden_tommy").equipped).toBe("revolver");
    expect(buyGun(poor, "laser")).toBeNull();
  });

  it("lets dev mode use anything for free, and keeps what you really own underneath", () => {
    const start = earn(loadWallet(null), 100);
    const dev = toggleDev(start);
    for (const gun of GUNS) expect(ownsGun(dev, gun.id)).toBe(true);
    const holding = equipGun(dev, "golden_tommy");
    expect(holding.equipped).toBe("golden_tommy");
    expect(holding.coins).toBe(100);
    const back = toggleDev(holding);
    expect(back.dev).toBeUndefined();
    expect(back.equipped).toBe("revolver");
    expect(ownsGun(back, "golden_tommy")).toBe(false);
  });

  it("remembers dev mode between sessions", () => {
    const store = memory();
    saveWallet(store, equipGun(toggleDev(loadWallet(null)), "tommy"));
    const loaded = loadWallet(store);
    expect(loaded.dev).toBe(true);
    expect(loaded.equipped).toBe("tommy");
  });

  it("has the revolver free, and everything else costs something", () => {
    expect(gunById("revolver").price).toBe(0);
    for (const gun of GUNS.slice(1)) expect(gun.price).toBeGreaterThan(0);
  });
});

describe("the guns in a fight", () => {
  const DT = 1 / 60;
  const AWAY = { x: 0.02, y: 0.02 };
  const plain = { camChance: 0, dodgeSlowChance: 0, duckChance: 0, pierceChance: 0, peek: false, barrelsDrop: false, whiskeyEvery: 0, rollEvery: 0, waves: [{ gap: 99, enemies: ["rusher" as const] }] };
  const run = (g: Rush, seconds: number, input: Partial<RushInput> = {}) => {
    const events: RushEvent[] = [];
    for (let i = 0; i < seconds / DT; i++) {
      g.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false, ...input });
      events.push(...g.drainEvents());
    }
    return events;
  };
  const shots = (events: RushEvent[]) => events.filter((e) => e.type === "shot").length;

  it("gives each gun its own magazine", () => {
    expect(new Rush({ ...plain, gun: gunById("tommy") }).maxAmmo).toBe(30);
    expect(new Rush(plain).maxAmmo).toBe(RUSH.ammo);
  });

  it("keeps firing a tommy gun while OK's held, and only then", () => {
    const g = new Rush({ ...plain, gun: gunById("tommy") });
    expect(shots(run(g, 0.6, { fireHeld: true }))).toBeGreaterThan(3);
    expect(shots(run(g, 0.3))).toBe(0);
  });

  it("doesn't let the revolver fire by holding the button", () => {
    const g = new Rush(plain);
    expect(shots(run(g, 0.6, { fireHeld: true }))).toBe(0);
  });

  it("reloads a little quicker every time", () => {
    const g = new Rush(plain);
    const timeOne = () => {
      g.ammo = 0;
      for (const e of g.enemies) e.z = -39;
      let frames = 0;
      g.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false, reload: true });
      while (g.reload && frames < 500) {
        g.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false });
        for (const e of g.enemies) e.z = -39;
        frames += 1;
      }
      return frames;
    };
    const first = timeOne();
    const second = timeOne();
    const third = timeOne();
    expect(second).toBeLessThan(first);
    expect(third).toBeLessThan(second);
    for (let i = 0; i < 20; i++) timeOne();
    expect(timeOne()).toBeGreaterThan(first / (RUSH.reloadPaceMax + 0.2));
  });

  it("reloads a magazine in one go", () => {
    const g = new Rush({ ...plain, gun: gunById("tommy") });
    g.ammo = 2;
    const events = run(g, 0.7, { reload: true });
    expect(g.ammo).toBe(30);
    expect(events.filter((e) => e.type === "bulletIn").length).toBe(1);
  });
});

describe("dead-eye", () => {
  const DT = 1 / 60;
  const AWAY = { x: 0.02, y: 0.02 };
  const plain = { camChance: 0, dodgeSlowChance: 0, duckChance: 0, pierceChance: 0, peek: false, barrelsDrop: false, whiskeyEvery: 0, rollEvery: 0, ammo: Infinity, waves: [{ gap: 99, enemies: ["rusher" as const] }] };
  const ready = () => {
    const g = new Rush(plain);
    g.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false });
    g.deadEye = 1;
    g.enemies[0]!.z = -14;
    return g;
  };

  it("starts by itself once there's someone to use it on, and waits until there is", () => {
    const empty = ready();
    empty.enemies = [];
    empty.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false });
    expect(empty.deadEyeLeft).toBe(0);
    expect(empty.deadEyeReady).toBe(true);
    const g = ready();
    g.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false });
    expect(g.deadEyeLeft).toBeGreaterThan(0);
  });

  it("cuts a reload short, so it isn't wasted", () => {
    const g = new Rush({ ...plain, ammo: 8 });
    g.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false });
    g.enemies[0]!.z = -14;
    g.ammo = 0;
    g.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false, reload: true });
    expect(g.reload).not.toBeNull();
    g.deadEye = 1;
    g.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false });
    expect(g.reload).toBeNull();
    expect(g.ammo).toBe(8);
  });

  it("locks on, so all you have to do is press OK, wherever your arm is", () => {
    const g = ready();
    const kills = g.kills;
    g.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false });
    expect(g.deadEyeLeft).toBeGreaterThan(0);
    g.step(DT, { aim: AWAY, fire: true, lean: 0, duck: false });
    expect(g.kills).toBe(kills + 1);
  });

  it("goes for the head, and over the top of a shield", () => {
    const g = ready();
    const make = g as unknown as { makeEnemy(k: string): (typeof g.enemies)[number] };
    const shield = make.makeEnemy("shield");
    shield.x = 0; shield.z = -10;
    g.enemies = [shield];
    g.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false });
    g.step(DT, { aim: AWAY, fire: true, lean: 0, duck: false });
    expect(g.enemies).not.toContain(shield);
  });

  it("gives you the bottle first", () => {
    const g = ready();
    const t = { id: 700, x: 1, y: 3, z: -6, vx: 0, vy: 0, vz: 0 };
    g.thrown.push(t);
    g.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false });
    g.step(DT, { aim: AWAY, fire: true, lean: 0, duck: false });
    expect(g.thrown).not.toContain(t);
    expect(g.enemies.length).toBe(1);
  });
});

describe("the heart pickup", () => {
  const DT = 1 / 60;
  const plain = { camChance: 0, dodgeSlowChance: 0, duckChance: 0, pierceChance: 0, peek: false, barrelsDrop: false, rollEvery: 0, ammo: Infinity, whiskeyEvery: 0.1, waves: [{ gap: 99, enemies: ["rusher" as const] }] };
  const run = (g: Rush, seconds: number) => {
    for (let i = 0; i < seconds / DT; i++) g.step(DT, { aim: { x: 0.02, y: 0.02 }, fire: false, lean: 0, duck: false });
  };

  it("lands on the ground, and waits there for a good while", () => {
    const g = new Rush(plain);
    g.hearts = 2;
    run(g, 0.2);
    const w = g.whiskey!;
    run(g, RUSH.whiskeyFlightSec + 0.1);
    expect(g.whiskey).toBe(w);
    expect(w.y).toBeCloseTo(RUSH.whiskeyRestY);
    const x = w.x;
    run(g, RUSH.whiskeySec - RUSH.whiskeyFlightSec - 1);
    expect(g.whiskey).toBe(w);
    expect(w.x).toBe(x);
    expect(RUSH.whiskeySec).toBeGreaterThanOrEqual(8);
  });
});
