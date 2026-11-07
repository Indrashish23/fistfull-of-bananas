import { describe, expect, it } from "vitest";
import { RUSH, Rush, projectToScreen, type RushEnemy, type RushEvent, type RushInput } from "./rush";

const DT = 1 / 60;
const AWAY = { x: 0.02, y: 0.02 };
const plain = { camChance: 0, dodgeSlowChance: 0, duckChance: 0, pierceChance: 0, peek: false, barrelsDrop: false, ammo: Infinity, whiskeyEvery: 0, rollEvery: 0, waves: [{ gap: 99, enemies: ["rusher" as const] }] };

function run(g: Rush, seconds: number, input: Partial<RushInput> = {}): RushEvent[] {
  const events: RushEvent[] = [];
  for (let i = 0; i < seconds / DT && !g.over; i++) {
    g.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false, ...input });
    events.push(...g.drainEvents());
  }
  return events;
}

const make = (g: Rush, kind: string): RushEnemy => {
  const e = (g as unknown as { makeEnemy(k: string): RushEnemy }).makeEnemy(kind);
  g.enemies.push(e);
  return e;
};

/** A bottle hanging at this spot in the air, not moving. */
function bottle(g: Rush) {
  const t = { id: 800, x: 2, y: 3, z: -12, vx: 0, vy: 0, vz: 0 };
  g.thrown.push(t);
  return t;
}

describe("aim assist", () => {
  const nearby = (g: Rush, t: { x: number; y: number; z: number }, off: number) => {
    const p = projectToScreen(t.x, t.y, t.z, g.cameraX, g.cameraY)!;
    return { p, aim: { x: p.x + off, y: p.y } };
  };
  const stilled = () => {
    const g = new Rush(plain);
    run(g, DT * 2);
    g.enemies = [];
    return g;
  };

  it("leaves your aim alone without it", () => {
    const g = stilled();
    const { aim } = nearby(g, bottle(g), 0.05);
    run(g, 0.5, { aim });
    expect(g.aim).toEqual(aim);
  });

  it("draws the reticle onto a bottle, and doesn't jump there", () => {
    const g = stilled();
    const { p, aim } = nearby(g, bottle(g), 0.05);
    run(g, DT, { aim, assist: 1 });
    expect(Math.abs(g.aim.x - p.x)).toBeGreaterThan(0.03);
    g.thrown[0]!.vy = RUSH.throwGravity * 0;
    for (let i = 0; i < 40; i++) {
      g.thrown[0]!.vy = 0;
      g.thrown[0]!.y = 3;
      run(g, DT, { aim, assist: 1 });
    }
    expect(Math.abs(g.aim.x - p.x)).toBeLessThan(0.02);
  });

  it("carries the reticle along with something moving", () => {
    const g = stilled();
    const e = make(g, "rusher");
    e.x = 0; e.z = -14; e.swing = -1;
    const at = projectToScreen(e.x, 1.35, e.z, g.cameraX, g.cameraY)!;
    const aim = { x: at.x + 0.02, y: at.y };
    run(g, 0.3, { aim, assist: 1 });
    const before = g.aim.y;
    run(g, 0.3, { aim, assist: 1 });
    expect(g.aim.y).not.toBe(before);
  });

  it("stays stuck to a moving target while your arm stays put", () => {
    const g = stilled();
    const t = bottle(g);
    const { aim } = nearby(g, t, 0.05);
    run(g, 0.3, { aim, assist: 1 });
    for (let i = 0; i < 40; i++) {
      t.x += 0.2;
      t.vy = 0;
      t.y = 3;
      run(g, DT, { aim, assist: 1 });
    }
    const now = projectToScreen(t.x, t.y, t.z, g.cameraX, g.cameraY)!;
    expect(Math.abs(now.x - aim.x)).toBeGreaterThan(0.1);
    expect(Math.abs(g.aim.x - now.x)).toBeLessThan(0.08);
  });

  it("holds on through a small movement of your arm", () => {
    const g = stilled();
    const t = bottle(g);
    const { p, aim } = nearby(g, t, 0.03);
    const hold = () => { t.vy = 0; t.y = 3; };
    for (let i = 0; i < 20; i++) { hold(); run(g, DT, { aim, assist: 1 }); }
    const moved = { x: aim.x + 0.05, y: aim.y };
    for (let i = 0; i < 20; i++) { hold(); run(g, DT, { aim: moved, assist: 1 }); }
    expect(Math.abs(g.aim.x - p.x)).toBeLessThan(0.04);
  });

  it("lets go once you pull well away, and doesn't grab straight back", () => {
    const g = stilled();
    const t = bottle(g);
    const { aim } = nearby(g, t, 0.03);
    const hold = () => { t.vy = 0; t.y = 3; };
    for (let i = 0; i < 20; i++) { hold(); run(g, DT, { aim, assist: 1 }); }
    const away = { x: aim.x + 0.2, y: aim.y };
    for (let i = 0; i < 30; i++) { hold(); run(g, DT, { aim: away, assist: 1 }); }
    expect(Math.abs(g.aim.x - away.x)).toBeLessThan(0.01);
    const back = { x: aim.x + 0.02, y: aim.y };
    for (let i = 0; i < 10; i++) { hold(); run(g, DT, { aim: back, assist: 1 }); }
    expect(Math.abs(g.aim.x - back.x)).toBeLessThan(0.01);
  });

  it("lets go when you shake your hand", () => {
    const g = stilled();
    const t = bottle(g);
    const { p, aim } = nearby(g, t, 0.05);
    const hold = () => { t.vy = 0; t.y = 3; };
    for (let i = 0; i < 20; i++) { hold(); run(g, DT, { aim, assist: 1 }); }
    expect(Math.abs(g.aim.x - p.x)).toBeLessThan(0.02);
    hold();
    run(g, DT, { aim, assist: 1, breakAim: true });
    for (let i = 0; i < 20; i++) { hold(); run(g, DT, { aim, assist: 1 }); }
    expect(Math.abs(g.aim.x - aim.x)).toBeLessThan(0.01);
  });

  it("drops a bullet-riddled target, and goes back to where your arm is", () => {
    const g = stilled();
    const e = make(g, "rusher");
    e.x = 0; e.z = -14;
    const at = projectToScreen(e.x, 1.35, e.z, g.cameraX, g.cameraY)!;
    const aim = { x: at.x + 0.03, y: at.y };
    run(g, 0.2, { aim, assist: 1 });
    g.enemies = [];
    run(g, 0.4, { aim, assist: 1 });
    expect(g.aim.x).toBeCloseTo(aim.x, 2);
  });

  it("gives up on an enemy for a bottle that comes into reach", () => {
    const g = stilled();
    const e = make(g, "rusher");
    e.x = 0; e.z = -14; e.swing = -1;
    const at = projectToScreen(e.x, 1.35, e.z, g.cameraX, g.cameraY)!;
    run(g, 0.1, { aim: at, assist: 1 });
    const t = { id: 801, x: 0.4, y: 1.6, z: -12, vx: 0, vy: 0, vz: 0 };
    g.thrown.push(t);
    for (let i = 0; i < 20; i++) { t.vy = 0; t.y = 1.6; t.vz = 0; e.z = -14; run(g, DT, { aim: at, assist: 1 }); }
    const now = projectToScreen(t.x, t.y, t.z, g.cameraX, g.cameraY)!;
    expect(Math.abs(g.aim.y - now.y)).toBeLessThan(0.03);
  });

  it("lands a shot on a bottle you'd have missed", () => {
    const g = stilled();
    const t = bottle(g);
    const { aim } = nearby(g, t, 0.06);
    const events = run(g, DT, { aim, assist: 1, fire: true });
    expect(events.some((e) => e.type === "shot" && e.thrown)).toBe(true);
    const without = stilled();
    const missed = run(without, DT, { aim: nearby(without, bottle(without), 0.07).aim, fire: true });
    expect(missed.some((e) => e.type === "shot" && e.thrown)).toBe(false);
  });

  it("still lets you pick your spot on someone, rather than snapping to their middle", () => {
    const g = stilled();
    const e = make(g, "rusher");
    e.x = 0; e.z = -14; e.hatOff = true;
    const head = projectToScreen(e.x, 2.6, e.z, g.cameraX, g.cameraY)!;
    const events = run(g, DT, { aim: head, assist: 1, fire: true });
    const shot = events.find((x) => x.type === "shot");
    expect(shot && shot.type === "shot" && shot.killed?.zone).toBe("head");
  });

  it("doesn't stop you lowering your arm to reload", () => {
    const g = new Rush({ ...plain, ammo: 6 });
    run(g, DT * 2);
    g.ammo = 1;
    const events = run(g, 0.1, { aim: { x: 0.5, y: 0.95 }, assist: 1 });
    expect(events.some((e) => e.type === "reloading")).toBe(true);
  });

  it("does nothing while the boss can't be hurt", () => {
    const g = stilled();
    const boss = make(g, "boss");
    g.phase = "bossCharge";
    const at = projectToScreen(boss.x, 2.5, boss.z, g.cameraX, g.cameraY)!;
    const aim = { x: at.x + 0.03, y: at.y };
    run(g, 0.5, { aim, assist: 1 });
    expect(g.aim.x).toBeCloseTo(aim.x, 3);
  });
});

describe("being attacked", () => {
  const close = () => {
    const g = new Rush(plain);
    run(g, DT * 2);
    const e = g.enemies[0]!;
    e.z = RUSH.strikeZ - 0.2;
    return { g, e };
  };

  it("stops in front of you and warns you, before it costs a heart", () => {
    const { g, e } = close();
    const events = run(g, 0.1);
    expect(events.some((x) => x.type === "strikeWindup")).toBe(true);
    expect(e.z).toBe(RUSH.strikeZ);
    expect(g.attackers).toContain(e);
    run(g, RUSH.strikeWindupSec - 0.2);
    expect(g.hearts).toBe(RUSH.hearts);
    expect(g.enemies).toContain(e);
  });

  it("then lands one blow, and goes", () => {
    const { g, e } = close();
    run(g, 0.05 + RUSH.strikeWindupSec + 0.05);
    expect(g.hearts).toBe(RUSH.hearts - 1);
    expect(g.attackers).not.toContain(e);
    const later = run(g, RUSH.strikeRecoverSec + 0.1);
    expect(g.hearts).toBe(RUSH.hearts - 1);
    expect(g.enemies).not.toContain(e);
    expect(later.some((x) => x.type === "strikeDone")).toBe(true);
  });

  it("can be shot during the wind-up, and then you keep your heart", () => {
    const { g, e } = close();
    run(g, 0.2);
    const at = projectToScreen(e.x, 1.2, e.z, g.cameraX, g.cameraY)!;
    run(g, DT, { aim: at, fire: true });
    expect(g.enemies).not.toContain(e);
    run(g, 1.5);
    expect(g.hearts).toBe(RUSH.hearts);
  });

  it("gives big fellas and shield carriers the same wind-up", () => {
    for (const kind of ["fat", "shield"]) {
      const g = new Rush(plain);
      run(g, DT * 2);
      g.enemies = [];
      const e = make(g, kind);
      e.z = RUSH.strikeZ - 0.1;
      run(g, 0.2);
      expect(e.swing).toBeGreaterThanOrEqual(0);
      expect(g.hearts).toBe(RUSH.hearts);
    }
  });
});
