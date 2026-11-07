import { describe, expect, it } from "vitest";
import { BOSS } from "./boss";
import { BANK_STOP } from "./level";
import { PLANE, XRAYS_BY_ZONE, XRAY_LABEL, planeToScreen } from "./rules";
import {
  FLAME_OUTFIT,
  GOLDEN_OUTFIT,
  PEEK_SPOTS,
  RUSH,
  RUSH_CAM,
  RUSH_WAVES,
  Rush,
  aimAtDepth,
  projectToScreen,
  reloadTime,
  rushCamStage,
  type RushEnemy,
  type RushEvent,
  type RushInput,
} from "./rush";

const DT = 1 / 60;
const AWAY = { x: 0.02, y: 0.02 };
/** The rules on their own, without the level's extras, unless a test brings them in. */
const BASIC = [
  { gap: 1.8, enemies: ["rusher", "rusher", "thrower", "rusher"] },
  { gap: 1.4, enemies: ["thrower", "rusher", "rusher", "thrower", "rusher", "rusher"] },
  { gap: 1.1, enemies: ["rusher", "thrower", "rusher", "rusher", "thrower", "rusher", "thrower", "rusher", "rusher"] },
] as { gap: number; enemies: ("rusher" | "thrower")[] }[];
const plain = { camChance: 0, dodgeSlowChance: 0, duckChance: 0, pierceChance: 0, peek: false, barrelsDrop: false, ammo: Infinity, whiskeyEvery: 0, rollEvery: 0, waves: BASIC };

function run(g: Rush, seconds: number, input: Partial<RushInput> = {}): RushEvent[] {
  const events: RushEvent[] = [];
  for (let i = 0; i < seconds / DT; i++) {
    // Aiming at something means pressing OK too, unless a test says otherwise.
    g.step(DT, { aim: AWAY, fire: input.aim !== undefined, lean: 0, duck: false, ...input });
    events.push(...g.drainEvents());
  }
  return events;
}

function aimAt(g: Rush, e: RushEnemy, height = 1): { x: number; y: number } {
  return projectToScreen(e.x, e.y + height, e.z, g.cameraX, g.cameraY)!;
}

/** Plays like someone with perfect aim, until it reaches a phase or runs out of time. */
function play(g: Rush, until: (g: Rush) => boolean, seconds = 200): RushEvent[] {
  const events: RushEvent[] = [];
  for (let i = 0; i < seconds / DT && !until(g) && !g.over; i++) {
    const thrown = g.thrown[0];
    const enemy = [...g.enemies].sort((a, b) => b.z - a.z)[0];
    const aim = thrown
      ? projectToScreen(thrown.x, thrown.y, thrown.z, g.cameraX, g.cameraY)!
      : enemy?.kind === "boss"
        ? projectToScreen(enemy.x, enemy.y + BOSS.heartY, enemy.z, g.cameraX, g.cameraY)!
        : enemy
          ? aimAt(g, enemy)
          : AWAY;
    const move = g.wordMove;
    g.step(DT, { aim, fire: g.onTarget, lean: move === "left" ? -1 : move === "right" ? 1 : 0, duck: move === "duck" });
    events.push(...g.drainEvents());
  }
  return events;
}

describe("aiming and showing things", () => {
  it("matches the duel's plane at the same distance", () => {
    const p = aimAtDepth(planeToScreen({ x: 2, y: 1 }), PLANE.distance, 0, PLANE.cameraY);
    expect(p.x).toBeCloseTo(2);
    expect(p.y).toBeCloseTo(1);
  });

  it("projects as the opposite of aiming", () => {
    const back = aimAtDepth(projectToScreen(3, 1, -20, 1, 1.2)!, 20, 1, 1.2);
    expect(back.x).toBeCloseTo(3);
    expect(back.y).toBeCloseTo(1);
  });

  it("has nothing to show behind the camera", () => {
    expect(projectToScreen(0, 1, 1, 0, 1.2)).toBeNull();
  });
});

describe("the goons", () => {
  const spawn = (g: Rush, kind: "rusher" | "thrower"): RushEnemy => {
    const e = (g as unknown as { makeEnemy(k: string): RushEnemy }).makeEnemy(kind);
    g.enemies.push(e);
    return e;
  };

  it("come out over time, with both kinds in the waves", () => {
    const g = new Rush(plain);
    run(g, DT * 2);
    expect(g.enemies.length).toBe(1);
    run(g, BASIC[0]!.gap + 0.1);
    expect(g.enemies.length).toBe(2);
    const beats = RUSH_WAVES.flatMap((w) => w.enemies).filter((b) => typeof b === "string" && b !== "cannon");
    expect(new Set(beats)).toEqual(new Set(["rusher", "thrower", "shield", "fat", "golden"]));
  });

  it("cost a heart when a runner reaches you", () => {
    const g = new Rush(plain);
    const e = spawn(g, "rusher");
    const events = run(g, 7);
    expect(g.enemies.includes(e)).toBe(false);
    expect(events.some((x) => x.type === "struck")).toBe(true);
  });

  it("put the throwers in the flame suit, and nobody else", () => {
    const g = new Rush(plain);
    const make = g as unknown as { makeEnemy(k: string): RushEnemy };
    expect(make.makeEnemy("thrower").outfit).toBe(FLAME_OUTFIT);
    for (let i = 0; i < 12; i++) expect(make.makeEnemy("rusher").outfit).not.toBe(FLAME_OUTFIT);
  });

  it("have throwers run up the street once, then stay put and keep throwing", () => {
    const g = new Rush(plain);
    const e = spawn(g, "thrower");
    const x = e.x;
    expect(e.z).toBe(RUSH.spawnZ);
    const thrown = run(g, 4).filter((t) => t.type === "threw").length;
    expect(e.z).toBe(e.stopZ);
    const events: RushEvent[] = [];
    for (let i = 0; i < 60 * 12 && !g.over; i++) {
      events.push(...run(g, DT, { aim: AWAY }));
      for (const t of g.thrown) t.z = -30;
      expect(e.x).toBe(x);
      expect(e.z).toBe(e.stopZ);
      expect(e.y).toBe(0);
    }
    expect(thrown + events.filter((t) => t.type === "threw").length).toBeGreaterThan(1);
  });

  for (const kind of ["rusher", "shield", "fat", "golden"]) {
    it(`has a ${kind} close in on you, and stay in the frame the whole way`, () => {
      for (const start of [6, -6, 2.5]) {
        const g = new Rush({ ...plain, waves: [{ gap: 100, enemies: [] }] });
        const e = (g as unknown as { makeEnemy(k: string): RushEnemy }).makeEnemy(kind);
        e.x = start;
        e.endX = Math.max(-RUSH.closeInX, Math.min(RUSH.closeInX, start * 0.22));
        g.enemies = [e];
        let last = e.x;
        for (let i = 0; i < 60 * 20 && g.enemies.includes(e) && !g.over; i++) {
          run(g, DT);
          // Toward the middle, never away.
          expect(Math.abs(e.x)).toBeLessThanOrEqual(Math.abs(last) + 1e-6);
          last = e.x;
          // The golden goon carries on past you, so only count the way in.
          if (e.z > -4) continue;
          const seen = projectToScreen(e.x, 1, e.z, g.cameraX, g.cameraY)!;
          expect(seen.x).toBeGreaterThan(0);
          expect(seen.x).toBeLessThan(1);
        }
        expect(Math.abs(last)).toBeLessThanOrEqual(RUSH.closeInX + 0.2);
      }
    });
  }

  describe("coming out of the buildings", () => {
    const peeking = (kind: string): { g: Rush; e: RushEnemy } => {
      const g = new Rush({ ...plain, peek: true, waves: [{ gap: 100, enemies: [] }] });
      const e = (g as unknown as { makeEnemy(k: string): RushEnemy }).makeEnemy(kind);
      g.enemies = [e];
      return { g, e };
    };

    it("starts everyone out of sight, behind a corner", () => {
      for (let i = 0; i < 12; i++) {
        const { e } = peeking("rusher");
        expect(Math.abs(e.x)).toBeGreaterThan(9);
        expect(PEEK_SPOTS.some((s) => s.z === e.z && s.hide === e.x)).toBe(true);
      }
    });

    it("leans out and holds still before stepping into the street", () => {
      const { g, e } = peeking("rusher");
      const z = e.z;
      run(g, RUSH.peekLeanSec + 0.05);
      expect(Math.abs(e.x)).toBeLessThan(Math.abs(e.hideX));
      expect(e.x).toBe(e.peekX);
      expect(e.z).toBe(z);
      expect(e.peeking).toBeGreaterThan(0);
    });

    it("then steps out into the street and runs at you", () => {
      const { g, e } = peeking("rusher");
      const z = e.z;
      run(g, RUSH.peekSec * 1.3 + 1);
      expect(e.peeking).toBe(0);
      expect(e.stepTo).toBeNull();
      expect(Math.abs(e.x)).toBeLessThanOrEqual(RUSH.laneHalfWidth);
      expect(e.z).toBeGreaterThan(z);
    });

    it("never starts a runner so close that there's no time to shoot", () => {
      for (let i = 0; i < 30; i++) expect(peeking("fat").e.z).toBeLessThan(-20);
    });

    it("pays extra for catching someone peeking", () => {
      const { g, e } = peeking("rusher");
      run(g, RUSH.peekLeanSec + 0.05);
      const events = run(g, DT, { aim: aimAt(g, e, 1) });
      expect(g.enemies.includes(e)).toBe(false);
      expect(events.some((x) => x.type === "scored" && x.label === "PEEKABOO!")).toBe(true);
    });

    it("has a thrower plant their feet in the street and throw", () => {
      const { g, e } = peeking("thrower");
      e.throwIn = 0;
      const events = run(g, RUSH.peekSec * 1.3 + 3);
      expect(e.stepTo).toBeNull();
      expect(e.z).toBe(e.stopZ);
      expect(events.some((x) => x.type === "threw")).toBe(true);
    });
  });

  describe("barrels dropping in", () => {
    const dropping = (): Rush => new Rush({ ...plain, barrelsDrop: true, waves: [{ gap: 100, enemies: ["rusher"], barrels: [{ x: 1, z: -15 }, { x: -2, z: -20 }] }] });

    it("start up in the air, the later ones higher", () => {
      const g = dropping();
      expect(g.barrels[0]!.y).toBe(RUSH.barrelDropY);
      expect(g.barrels[1]!.y).toBeGreaterThan(g.barrels[0]!.y);
    });

    it("land with a thump, bounce a little, and settle", () => {
      const g = dropping();
      const events = run(g, 3);
      const landed = events.filter((e) => e.type === "barrelLanded");
      expect(landed.some((e) => e.type === "barrelLanded" && e.hard)).toBe(true);
      for (const b of g.barrels) {
        expect(b.y).toBe(0);
        expect(b.vy).toBe(0);
      }
    });

    it("can be shot on the way down", () => {
      const g = dropping();
      run(g, 0.2);
      const b = g.barrels[0]!;
      const aim = projectToScreen(b.x, b.y + 0.7, b.z, g.cameraX, g.cameraY)!;
      const events = run(g, DT, { aim, fire: true });
      expect(events.some((e) => e.type === "barrel")).toBe(true);
    });
  });

  it("keeps a burning goon heading up or down the street, not across it", () => {
    const g = new Rush(plain);
    const e = spawn(g, "rusher");
    e.z = -20;
    (g as unknown as { ignite(enemy: RushEnemy): void }).ignite(e);
    for (let i = 0; i < 60 * 2; i++) {
      run(g, DT);
      expect(Math.abs(e.burnZ)).toBeGreaterThan(Math.abs(e.burnX) * 2);
    }
  });
});

describe("ducking", () => {
  const dodger = (z = -20): { g: Rush; e: RushEnemy } => {
    const g = new Rush({ ...plain, waves: [{ gap: 100, enemies: ["rusher"] }] });
    const e = (g as unknown as { makeEnemy(k: string): RushEnemy }).makeEnemy("rusher");
    e.dodger = true;
    e.x = 0;
    e.z = z;
    g.enemies = [e];
    return { g, e };
  };

  it("happens rarely", () => {
    const g = new Rush({ ...plain, duckChance: RUSH.duckChance });
    const make = g as unknown as { makeEnemy(k: string): RushEnemy };
    const dodgers = Array.from({ length: 400 }, () => make.makeEnemy("rusher")).filter((e) => e.dodger).length;
    expect(dodgers).toBeGreaterThan(20);
    expect(dodgers).toBeLessThan(90);
  });

  it("lets a goon duck under a shot at the chest, and they survive it", () => {
    const { g, e } = dodger();
    const events = run(g, DT, { aim: aimAt(g, e, 2.2) });
    expect(events.some((x) => x.type === "ducked" && x.enemy === e)).toBe(true);
    expect(g.enemies.includes(e)).toBe(true);
    expect(e.ducking).toBeGreaterThan(0);
  });

  it("makes them waddle slowly, then stand back up and run", () => {
    const { g, e } = dodger();
    run(g, DT, { aim: aimAt(g, e, 2.2) });
    const z = e.z;
    run(g, 1);
    expect(e.z - z).toBeCloseTo(RUSH.rushSpeed * RUSH.duckSpeed, 0);
    run(g, RUSH.duckSec);
    expect(e.ducking).toBe(0);
    const stood = e.z;
    run(g, 0.5);
    expect(e.z - stood).toBeCloseTo(RUSH.rushSpeed * 0.5, 0);
  });

  it("can still be shot low down while ducked", () => {
    const { g, e } = dodger();
    run(g, DT, { aim: aimAt(g, e, 2.2) });
    run(g, RUSH.fireGapSec, { aim: aimAt(g, e, 0.6) });
    expect(g.enemies.includes(e)).toBe(false);
  });

  it("only gets one go at it", () => {
    const { g, e } = dodger();
    run(g, DT, { aim: aimAt(g, e, 2.2) });
    expect(e.dodger).toBe(false);
    run(g, RUSH.duckSec + 0.1);
    run(g, DT, { aim: aimAt(g, e, 1.2) });
    expect(g.enemies.includes(e)).toBe(false);
  });

  it("is too late once they're nearly on you", () => {
    const { g, e } = dodger(RUSH.duckBeforeZ + 1);
    run(g, DT, { aim: aimAt(g, e, 1) });
    expect(g.enemies.includes(e)).toBe(false);
  });
});

describe("thrown things", () => {
  const throwing = (): { g: Rush; e: RushEnemy } => {
    const g = new Rush(plain);
    const e = (g as unknown as { makeEnemy(k: string): RushEnemy }).makeEnemy("thrower");
    g.enemies.push(e);
    e.z = e.stopZ;
    e.throwIn = 0;
    run(g, RUSH.windupSec + 0.05);
    return { g, e };
  };

  it("wind up, then come slowly", () => {
    const { g } = throwing();
    expect(g.thrown.length).toBe(1);
    const t = g.thrown[0]!;
    const z = t.z;
    run(g, 1);
    expect(g.thrown.includes(t)).toBe(true);
    expect(t.z).toBeGreaterThan(z);
  });

  it("stay low enough to see and shoot, all the way in", () => {
    const { g } = throwing();
    const b = g.thrown[0]!;
    while (g.thrown.includes(b)) {
      const p = projectToScreen(b.x, b.y, b.z, g.cameraX, g.cameraY);
      if (p) expect(p.y).toBeGreaterThan(0.1);
      run(g, DT);
    }
  });

  it("hurt when they land", () => {
    const { g } = throwing();
    const events = run(g, RUSH.throwSec + 0.2);
    expect(events.some((e) => e.type === "smashed")).toBe(true);
    expect(g.hearts).toBeLessThan(RUSH.hearts);
  });

  it("get shot out of the air just by aiming at them", () => {
    const { g } = throwing();
    const t = g.thrown[0]!;
    run(g, 0.5);
    const aim = projectToScreen(t.x, t.y, t.z, g.cameraX, g.cameraY)!;
    const events = run(g, 0.05, { aim });
    expect(events.some((e) => e.type === "shot" && e.thrown === t)).toBe(true);
    expect(g.thrown.includes(t)).toBe(false);
    expect(g.hearts).toBe(RUSH.hearts);
    expect(g.score).toBe(RUSH.thrownPoints);
  });

  it("are never more than two at once", () => {
    const g = new Rush(plain);
    const make = g as unknown as { makeEnemy(k: string): RushEnemy };
    for (let i = 0; i < 8; i++) {
      const e = make.makeEnemy("thrower");
      e.z = e.stopZ;
      e.throwIn = 0;
      g.enemies.push(e);
    }
    let most = 0;
    for (let i = 0; i < 60 * 6 && !g.over; i++) {
      g.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false });
      g.drainEvents();
      most = Math.max(most, g.thrown.length + g.enemies.filter((e) => e.windup > 0).length);
    }
    expect(most).toBe(RUSH.maxThrown);
  });
});

describe("shooting", () => {
  it("fires on a press when the reticle's on someone", () => {
    const g = new Rush(plain);
    run(g, DT * 2);
    const e = g.enemies[0]!;
    const events: RushEvent[] = [];
    for (let i = 0; i < 12 && g.kills === 0; i++) events.push(...run(g, DT, { aim: aimAt(g, e) }));
    expect(g.kills).toBe(1);
    expect(events.some((x) => x.type === "shot" && x.killed?.enemy === e)).toBe(true);
  });

  it("never fires by itself, even with the reticle on someone", () => {
    const g = new Rush(plain);
    run(g, DT * 2);
    const e = g.enemies[0]!;
    const events: RushEvent[] = [];
    for (let i = 0; i < 60 && g.enemies.includes(e); i++) events.push(...run(g, DT, { aim: aimAt(g, e), fire: false }));
    expect(events.some((x) => x.type === "shot")).toBe(false);
    expect(g.onTarget).toBe(true);
    expect(g.kills).toBe(0);
  });

  it("doesn't fire by itself at empty street", () => {
    const g = new Rush(plain);
    expect(run(g, 0.5).some((e) => e.type === "shot")).toBe(false);
  });

  it("still fires on OK, even at nothing", () => {
    const g = new Rush(plain);
    expect(run(g, DT, { fire: true }).some((e) => e.type === "shot" && e.killed === null)).toBe(true);
  });

  it("limits how fast the gun fires", () => {
    const g = new Rush(plain);
    const shots = run(g, 1, { fire: true }).filter((e) => e.type === "shot").length;
    expect(shots).toBeLessThanOrEqual(4);
    expect(shots).toBeGreaterThanOrEqual(3);
  });

  it("scores more for a headshot", () => {
    const score = (height: number): number => {
      const g = new Rush(plain);
      run(g, DT * 2);
      const e = g.enemies[0]!;
      for (let i = 0; i < 12 && g.kills === 0; i++) run(g, DT, { aim: aimAt(g, e, height) });
      return g.score;
    };
    expect(score(1.9)).toBeGreaterThan(score(0.2));
  });
});

describe("the bullet cam", () => {
  const killOne = (g: Rush): RushEvent[] => {
    run(g, DT * 2);
    const e = g.enemies[0]!;
    const events: RushEvent[] = [];
    for (let i = 0; i < 12 && g.kills === 0; i++) events.push(...run(g, DT, { aim: aimAt(g, e) }));
    return events;
  };

  it("runs through the bullet, the x-ray, the ragdoll and the way back", () => {
    expect(rushCamStage(0).name).toBe("bullet");
    expect(rushCamStage(RUSH_CAM.bulletSec).name).toBe("xray");
    expect(rushCamStage(RUSH_CAM.bulletSec + RUSH_CAM.xraySec).name).toBe("ragdoll");
    const back = rushCamStage(RUSH_CAM.bulletSec + RUSH_CAM.xraySec + RUSH_CAM.ragdollSec + 0.1);
    expect(back.name).toBe("back");
    expect(back.u).toBeGreaterThan(0);
  });

  it("holds the game still while it plays, then hands it back", () => {
    const g = new Rush({ ...plain, camChance: 1 });
    const events = killOne(g);
    expect(events.some((e) => e.type === "shot" && e.killed?.cam)).toBe(true);
    expect(g.cam).not.toBeNull();
    run(g, 1);
    expect(g.enemies.length).toBe(0);
    run(g, RUSH_CAM.bulletSec + RUSH_CAM.xraySec + RUSH_CAM.ragdollSec + RUSH_CAM.backSec);
    expect(g.cam).toBeNull();
  });

  it("doesn't play on an unlucky roll", () => {
    const g = new Rush(plain);
    killOne(g);
    expect(g.cam).toBeNull();
  });

  it("can't play back to back", () => {
    const g = new Rush({ ...plain, camChance: 1 });
    killOne(g);
    run(g, RUSH_CAM.bulletSec + RUSH_CAM.xraySec + RUSH_CAM.ragdollSec + RUSH_CAM.backSec + 0.1);
    (g as unknown as { sinceCam: number }).sinceCam = 0;
    g.kills = 0;
    while (g.enemies.length === 0) run(g, DT);
    const e = g.enemies[0]!;
    for (let i = 0; i < 12 && g.kills === 0; i++) run(g, DT, { aim: aimAt(g, e) });
    expect(g.kills).toBe(1);
    expect(g.cam).toBeNull();
  });
});

describe("the boss", () => {
  const toBoss = (options: typeof plain = plain): Rush => {
    const g = new Rush(options);
    play(g, (x) => x.phase === "bossShoot");
    expect(g.phase).toBe("bossShoot");
    return g;
  };

  it("arrives after the last wave, with hearts intact for good aim", () => {
    const g = toBoss();
    expect(g.enemies.length).toBe(1);
    expect(g.enemies[0]!.kind).toBe("boss");
    expect(g.hearts).toBe(RUSH.hearts);
  });

  /** Stops him moving, with his heart showing or not. */
  const pinned = (g: Rush, heart: boolean) => {
    // Lets the gun come back round from the last shot it took getting here.
    run(g, RUSH.fireGapSec + DT);
    const boss = g.enemies[0]!;
    boss.x = 0;
    boss.y = 0;
    boss.ducking = 0;
    const brain = g.brain!;
    if (heart) brain.reveal();
    else brain.loosen();
    brain.react = () => {};
    return boss;
  };
  const heartAim = (g: Rush, boss: RushEnemy) => projectToScreen(boss.x, boss.y + BOSS.heartY, boss.z, g.cameraX, g.cameraY)!;

  it("shrugs off anything but the heart, and the bullet ricochets", () => {
    const g = toBoss();
    const boss = pinned(g, false);
    const hp = g.bossHp;
    const events = run(g, DT, { aim: aimAt(g, boss, 0.6) });
    expect(g.bossHp).toBe(hp);
    expect(g.enemies.includes(boss)).toBe(true);
    expect(events.some((e) => e.type === "bossRicochet")).toBe(true);
    expect(events.some((e) => e.type === "bossHurt")).toBe(false);
  });

  it("still ricochets off the rest of him while his heart's showing", () => {
    const g = toBoss();
    const boss = pinned(g, true);
    const hp = g.bossHp;
    const events = run(g, DT, { aim: aimAt(g, boss, 0.4) });
    expect(g.bossHp).toBe(hp);
    expect(events.some((e) => e.type === "bossRicochet")).toBe(true);
  });

  it("takes a chunk out of him through the heart", () => {
    const g = toBoss();
    const boss = pinned(g, true);
    const hp = g.bossHp;
    const events = run(g, DT, { aim: heartAim(g, boss) });
    expect(hp - g.bossHp).toBe(BOSS.heartDamage);
    expect(events.some((e) => e.type === "bossHurt" && e.heart)).toBe(true);
    expect(events.some((e) => e.type === "scored" && e.label === "HEART!")).toBe(true);
  });

  it("doesn't count the heart unless it's showing", () => {
    const g = toBoss();
    const boss = pinned(g, false);
    const hp = g.bossHp;
    const events = run(g, DT, { aim: heartAim(g, boss) });
    expect(g.bossHp).toBe(hp);
    expect(events.some((e) => e.type === "bossRicochet")).toBe(true);
  });

  it("takes several good shots to the heart to go down", () => {
    expect(BOSS.hp / BOSS.heartDamage).toBeGreaterThanOrEqual(10);
  });

  it("keeps moving through your turn, and never leaves the arena", () => {
    const g = toBoss();
    const boss = g.enemies[0]!;
    const seen = new Set<string>();
    const xs = new Set<number>();
    for (let i = 0; i < 60 * RUSH.shootTimeSec && g.phase === "bossShoot"; i++) {
      run(g, DT);
      seen.add(g.brain!.move);
      xs.add(Math.round(boss.x));
      expect(Math.abs(boss.x)).toBeLessThanOrEqual(BOSS.arenaHalf + 1e-6);
      expect(boss.y).toBeGreaterThanOrEqual(0);
    }
    expect(xs.size).toBeGreaterThan(3);
    expect(seen.has("reveal")).toBe(true);
    expect(seen.size).toBeGreaterThan(3);
  });

  it("shows his heart once in your turn, says so, and attacks the moment he covers it", () => {
    const g = toBoss();
    const events: RushEvent[] = [];
    for (let i = 0; i < 60 * 20 && g.phase !== "bossCharge"; i++) events.push(...run(g, DT));
    expect(events.filter((e) => e.type === "bossReveal").length).toBe(1);
    expect(g.phase).toBe("bossCharge");
    expect(g.heartOpen).toBe(false);
    const revealedAt = events.findIndex((e) => e.type === "bossReveal");
    const chargedAt = events.findIndex((e) => e.type === "bossCharge");
    expect(chargedAt).toBeGreaterThan(revealedAt);
  });

  it("warns you, then fires, and can't be hurt from the warning on", () => {
    const g = toBoss();
    const events = run(g, RUSH.shootTimeSec + 0.1);
    expect(events.some((e) => e.type === "bossCharge")).toBe(true);
    expect(g.phase).toBe("bossCharge");
    expect(g.brain!.move).toBe("charge");
    expect(g.bossInvulnerable).toBe(true);
    expect(g.canShoot).toBe(true);
  });

  it("bounces your shots off while he's invulnerable", () => {
    const g = toBoss();
    run(g, RUSH.shootTimeSec + 0.1);
    const boss = g.enemies[0]!;
    const hp = g.bossHp;
    const events = run(g, DT, { aim: aimAt(g, boss, 1) });
    expect(g.bossHp).toBe(hp);
    expect(events.some((e) => e.type === "bossBlocked")).toBe(true);
    expect(events.some((e) => e.type === "bossHurt")).toBe(false);
  });

  it("only blocks when you actually shoot him", () => {
    const g = toBoss();
    const events = run(g, RUSH.shootTimeSec + 0.2);
    expect(events.some((e) => e.type === "bossBlocked")).toBe(false);
  });

  it("switches to dodging time after the warning, with the gun down", () => {
    const g = toBoss();
    const events = run(g, RUSH.shootTimeSec + BOSS.chargeSec + 0.1);
    expect(events.some((e) => e.type === "dodgeTime")).toBe(true);
    expect(g.phase).toBe("bossDodge");
    expect(g.canShoot).toBe(false);
    expect(run(g, 0.1, { fire: true }).some((e) => e.type === "shot")).toBe(false);
  });

  const dodging = (over = plain): Rush => {
    const g = toBoss(over);
    run(g, RUSH.shootTimeSec + BOSS.chargeSec + 0.1);
    return g;
  };
  const poseFor = (move: string): Partial<RushInput> => ({
    lean: move === "left" ? -1 : move === "right" ? 1 : 0,
    duck: move === "duck",
  });
  const toArrival = (g: Rush, input: Partial<RushInput>): RushEvent[] =>
    run(g, RUSH.warnSec + RUSH.attackSec - g.prompt!.t + 0.05, input);

  it("shows the word well before the attack comes", () => {
    const g = dodging();
    const prompt = g.prompt!;
    expect(["left", "right", "duck"]).toContain(prompt.move);
    expect(g.attackAt(prompt)).toBeNull();
    run(g, RUSH.warnSec + 0.05);
    expect(g.attackAt(prompt)).not.toBeNull();
  });

  it("spins up on each word, then opens fire", () => {
    const g = dodging();
    expect(g.brain!.move).toBe("charge");
    const events = run(g, RUSH.warnSec + 0.05);
    expect(g.brain!.move).toBe("fire");
    expect(events.some((e) => e.type === "bossFire")).toBe(true);
  });

  it("goes past if you do what the word says", () => {
    const g = dodging();
    const events = toArrival(g, poseFor(g.prompt!.move));
    expect(events.some((e) => e.type === "dodged")).toBe(true);
    expect(g.hearts).toBe(RUSH.hearts);
  });

  it("hits if you don't", () => {
    const g = dodging();
    const events = toArrival(g, {});
    expect(events.some((e) => e.type === "struck")).toBe(true);
    expect(g.hearts).toBe(RUSH.hearts - 1);
  });

  it("hits if you go the wrong way", () => {
    const g = dodging();
    const wrong = g.prompt!.move === "left" ? { lean: 1 } : { lean: -1 };
    toArrival(g, g.prompt!.move === "duck" ? wrong : wrong);
    expect(g.hearts).toBe(RUSH.hearts - 1);
  });

  it("never asks for the same move twice in a row", () => {
    const g = dodging();
    const moves: string[] = [g.prompt!.move];
    for (let i = 0; i < RUSH.dodgesPerRound - 1; i++) {
      const before = g.prompt!;
      while (g.prompt === before) run(g, DT, poseFor(before.move));
      moves.push(g.prompt!.move);
    }
    for (let i = 1; i < moves.length; i++) expect(moves[i]).not.toBe(moves[i - 1]);
  });

  it("goes back to shooting time after the round", () => {
    const g = dodging();
    const events: RushEvent[] = [];
    for (let i = 0; i < 60 * 30 && g.phase === "bossDodge"; i++) {
      events.push(...run(g, DT, poseFor(g.prompt!.move)));
    }
    expect(g.phase).toBe("bossShoot");
    expect(events.some((e) => e.type === "shootTime")).toBe(true);
  });

  it("can go past in slow motion when you're already clear", () => {
    const g = dodging({ ...plain, dodgeSlowChance: 1 });
    const pose = poseFor(g.prompt!.move);
    run(g, RUSH.warnSec + RUSH.attackSec * 0.6, pose);
    expect(g.timeScale).toBe(RUSH.slowScale);
  });

  it("doesn't slow down if you haven't moved", () => {
    const g = dodging({ ...plain, dodgeSlowChance: 1 });
    run(g, RUSH.warnSec + RUSH.attackSec * 0.6);
    expect(g.timeScale).toBe(1);
  });

  it("leans and lowers the view", () => {
    const g = new Rush(plain);
    run(g, 0.5, { lean: 1, duck: true });
    expect(g.cameraX).toBeCloseTo(RUSH.leanReach, 1);
    expect(g.cameraY).toBeCloseTo(PLANE.cameraY - RUSH.duckDrop, 1);
  });

  it("wins with a final bullet cam when the boss goes down", () => {
    const g = new Rush(plain);
    const events = play(g, (x) => x.phase === "won", 400);
    expect(g.phase).toBe("won");
    expect(events.some((e) => e.type === "shot" && e.killed?.enemy.kind === "boss" && e.killed.cam)).toBe(true);
    expect(events.filter((e) => e.type === "ended")).toEqual([{ type: "ended", won: true }]);
  });
});

describe("fire bottles", () => {
  const scene = (distance: number) => {
    const g = new Rush(plain);
    const make = g as unknown as { makeEnemy(k: string): RushEnemy };
    const thrower = make.makeEnemy("thrower");
    thrower.z = thrower.stopZ = -20;
    thrower.x = 0;
    thrower.throwIn = 0;
    g.enemies.push(thrower);
    run(g, RUSH.windupSec + 0.05);
    const t = g.thrown[0]!;
    const bystander = make.makeEnemy("rusher");
    bystander.x = t.x + distance;
    bystander.z = t.z;
    g.enemies.push(bystander);
    const events = run(g, 0.05, { aim: projectToScreen(t.x, t.y, t.z, g.cameraX, g.cameraY)! });
    return { g, bystander, events };
  };

  it("set light to goons near where they're shot", () => {
    const { bystander, events } = scene(1);
    expect(bystander.burning).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "ignited" && e.enemy === bystander)).toBe(true);
    expect(events.some((e) => e.type === "fireBurst" && e.caught > 0)).toBe(true);
  });

  it("don't reach goons further away", () => {
    expect(scene(RUSH.fireRadius + 1).bystander.burning).toBe(0);
  });

  it("leave fuel burning on the street, which lights anyone running through it", () => {
    const { g } = scene(50);
    expect(g.fires.length).toBe(1);
    const fire = g.fires[0]!;
    const runner = (g as unknown as { makeEnemy(k: string): RushEnemy }).makeEnemy("rusher");
    runner.x = fire.x;
    runner.z = fire.z - 3;
    g.enemies.push(runner);
    run(g, 0.5);
    expect(runner.burning).toBeGreaterThan(0);
  });

  it("burn out after a while", () => {
    const { g } = scene(50);
    run(g, RUSH.firePatchSec + 0.1);
    expect(g.fires.length).toBe(0);
  });

  it("leave someone burning, running around at random, and then down, with points", () => {
    const { g, bystander } = scene(1);
    const x = bystander.x;
    const z = bystander.z;
    run(g, 1);
    expect(Math.hypot(bystander.x - x, bystander.z - z)).toBeGreaterThan(0.2);
    const kills = g.kills;
    const events = run(g, RUSH.burnSec);
    expect(events.some((e) => e.type === "burnedDown" && e.enemy === bystander)).toBe(true);
    expect(g.kills).toBeGreaterThan(kills);
  });

  it("don't let a burning goon reach you", () => {
    const { g, bystander } = scene(1);
    const hearts = g.hearts;
    bystander.z = -5;
    run(g, 1.5);
    expect(g.hearts).toBe(hearts);
  });

  it("spread when someone on fire runs into someone else", () => {
    const { g, bystander } = scene(1);
    const other = (g as unknown as { makeEnemy(k: string): RushEnemy }).makeEnemy("fat");
    other.x = bystander.x;
    other.z = bystander.z;
    g.enemies.push(other);
    run(g, DT * 2);
    expect(other.burning).toBeGreaterThan(0);
  });
});

describe("scoring where it happens", () => {
  it("says how many points landed, and where, with a word for a headshot", () => {
    const g = new Rush(plain);
    run(g, DT * 2);
    const e = g.enemies[0]!;
    const events: RushEvent[] = [];
    for (let i = 0; i < 12 && g.kills === 0; i++) events.push(...run(g, DT, { aim: aimAt(g, e, 1.9) }));
    const scored = events.find((x) => x.type === "scored");
    expect(scored?.type === "scored" && scored.label).toBe("HEADSHOT!");
    expect(scored?.type === "scored" && scored.points).toBe(g.score);
    expect(scored?.type === "scored" && scored.x).toBe(e.x);
  });

  it("has no word for a plain body hit", () => {
    const g = new Rush(plain);
    run(g, DT * 2);
    const e = g.enemies[0]!;
    const events: RushEvent[] = [];
    for (let i = 0; i < 12 && g.kills === 0; i++) events.push(...run(g, DT, { aim: aimAt(g, e, 0.2) }));
    const scored = events.find((x) => x.type === "scored");
    expect(scored?.type === "scored" && scored.label).toBe("");
  });

  it("freezes for a moment on a kill, then carries on", () => {
    const g = new Rush(plain);
    run(g, DT * 2);
    const e = g.enemies[0]!;
    for (let i = 0; i < 12 && g.kills === 0; i++) run(g, DT, { aim: aimAt(g, e) });
    expect(g.timeScale).toBe(0);
    run(g, RUSH.hitStopSec + DT);
    expect(g.timeScale).toBe(1);
  });
});

describe("how often the bullet cam comes up", () => {
  it("is common, but never back to back", () => {
    expect(RUSH.camChance).toBeGreaterThanOrEqual(0.2);
    expect(RUSH.camChance).toBeLessThan(0.5);
    expect(RUSH.camGapSec).toBeGreaterThanOrEqual(5);
  });

  it("names what it hit, even in the body", () => {
    const g = new Rush({ ...plain, camChance: 1, waves: [{ gap: 100, enemies: ["rusher"] }] });
    run(g, DT * 2);
    const e = g.enemies[0]!;
    (g as unknown as { sinceCam: number }).sinceCam = 99;
    const events = run(g, DT, { aim: aimAt(g, e, 1.05) });
    expect(g.cam).not.toBeNull();
    expect(events.some((x) => x.type === "scored" && x.label === XRAY_LABEL[g.cam!.xray])).toBe(true);
    expect(XRAYS_BY_ZONE.body).toContain(g.cam!.xray);
  });
});

describe("a bullet going through", () => {
  const lined = (chance: number) => {
    const g = new Rush({ ...plain, pierceChance: chance, waves: [{ gap: 100, enemies: ["rusher"] }] });
    const make = g as unknown as { makeEnemy(k: string): RushEnemy };
    const front = make.makeEnemy("rusher");
    const back = make.makeEnemy("rusher");
    front.x = front.endX = back.x = back.endX = 0;
    front.z = -12;
    back.z = -20;
    g.enemies = [front, back];
    return { g, front, back };
  };

  it("takes down whoever's behind, for double points", () => {
    const { g, front, back } = lined(1);
    const events = run(g, DT, { aim: aimAt(g, front, 1) });
    expect(g.enemies.includes(front)).toBe(false);
    expect(g.enemies.includes(back)).toBe(false);
    expect(events.some((x) => x.type === "pierced" && x.next?.enemy === back)).toBe(true);
    expect(events.some((x) => x.type === "scored" && x.label === "PIERCED!")).toBe(true);
    expect(g.kills).toBe(2);
  });

  it("leaves them alone when the bullet stops inside", () => {
    const { g, front, back } = lined(0);
    const events = run(g, DT, { aim: aimAt(g, front, 1) });
    expect(g.enemies.includes(front)).toBe(false);
    expect(g.enemies.includes(back)).toBe(true);
    expect(events.some((x) => x.type === "pierced")).toBe(false);
  });

  it("carries on down the street if nobody's behind", () => {
    const { g, front, back } = lined(1);
    g.enemies = [front];
    const events = run(g, DT, { aim: aimAt(g, front, 1) });
    expect(events.some((x) => x.type === "pierced" && x.next === null)).toBe(true);
    expect(back.z).toBe(-20);
  });

  it("is stopped by a shield", () => {
    const { g, front, back } = lined(1);
    back.shieldHp = 3;
    run(g, DT, { aim: aimAt(g, front, 1) });
    expect(g.enemies.includes(back)).toBe(true);
    expect(back.shieldHp).toBe(3);
  });
});

describe("combos", () => {
  const kill = (g: Rush): void => {
    while (g.enemies.length === 0) run(g, DT);
    const e = g.enemies[0]!;
    for (let i = 0; i < 40 && g.enemies.includes(e); i++) run(g, DT, { aim: aimAt(g, e) });
  };

  it("build the multiplier with kills in a row, and tell you", () => {
    const g = new Rush(plain);
    expect(g.multiplier).toBe(1);
    const k = g as unknown as { addKill(p: number): void };
    k.addKill(0);
    k.addKill(0);
    expect(g.multiplier).toBe(1);
    k.addKill(0);
    expect(g.multiplier).toBe(2);
    expect(g.drainEvents().some((e) => e.type === "combo" && e.multiplier === 2)).toBe(true);
  });

  it("multiply the score", () => {
    const g = new Rush(plain);
    const k = g as unknown as { addKill(p: number): void };
    k.addKill(100);
    k.addKill(100);
    k.addKill(100);
    const before = g.score;
    k.addKill(100);
    expect(g.score - before).toBe(200);
  });

  it("run out if you stop killing", () => {
    const g = new Rush(plain);
    kill(g);
    expect(g.combo).toBe(1);
    run(g, RUSH.comboSec + 0.1);
    expect(g.combo).toBe(0);
  });

  it("break when you get hurt", () => {
    const g = new Rush(plain);
    (g as unknown as { addKill(p: number): void }).addKill(0);
    (g as unknown as { hurt(): void }).hurt();
    expect(g.combo).toBe(0);
  });
});

describe("hat shots", () => {
  const withGoon = (): { g: Rush; e: RushEnemy } => {
    const g = new Rush(plain);
    run(g, DT * 2);
    return { g, e: g.enemies[0]! };
  };

  it("take the hat off, without hurting, and score", () => {
    const { g, e } = withGoon();
    const events = run(g, 0.05, { aim: aimAt(g, e, 2.75) });
    expect(e.hatOff).toBe(true);
    expect(g.enemies.includes(e)).toBe(true);
    expect(g.kills).toBe(0);
    expect(g.score).toBe(RUSH.hatPoints);
    expect(events.some((x) => x.type === "hat")).toBe(true);
  });

  it("make them stop to grab it, then carry on", () => {
    const { g, e } = withGoon();
    run(g, 0.05, { aim: aimAt(g, e, 2.75) });
    const z = e.z;
    run(g, RUSH.hatGrabSec / 2);
    expect(e.z).toBe(z);
    run(g, RUSH.hatGrabSec);
    expect(e.z).toBeGreaterThan(z);
  });

  it("can only come off once", () => {
    const { g, e } = withGoon();
    run(g, 0.05, { aim: aimAt(g, e, 2.75) });
    run(g, RUSH.fireGapSec + 0.1, { aim: aimAt(g, e, 2.75) });
    expect(g.enemies.includes(e)).toBe(false);
    expect(g.kills).toBe(1);
  });
});

describe("barrels", () => {
  const withBarrel = (): Rush => new Rush({
    ...plain,
    waves: [{ gap: 1, enemies: ["rusher", "rusher"], barrels: [{ x: 0, z: -20 }, { x: 3, z: -22 }, { x: -20, z: -20 }] }],
  });
  const aimAtBarrel = (g: Rush, i: number) => projectToScreen(g.barrels[i]!.x, 0.7, g.barrels[i]!.z, g.cameraX, g.cameraY)!;

  it("are set out for the wave", () => {
    expect(withBarrel().barrels.length).toBe(3);
    expect(new Rush({ ...plain, waves: BASIC }).barrels.length).toBe(0);
    expect(new Rush().barrels.length).toBe(RUSH_WAVES[0]!.barrels!.length);
  });

  it("take out everyone close, and set off other barrels close enough", () => {
    const g = withBarrel();
    const make = g as unknown as { makeEnemy(k: string): RushEnemy };
    const near = make.makeEnemy("rusher");
    near.x = 1.5;
    near.z = -24;
    const far = make.makeEnemy("rusher");
    far.x = -6;
    far.z = -35;
    g.enemies.push(near, far);
    const events = run(g, 0.05, { aim: aimAtBarrel(g, 0) });
    expect(events.filter((e) => e.type === "barrel").length).toBe(2);
    expect(g.enemies.includes(near)).toBe(false);
    expect(g.enemies.includes(far)).toBe(true);
    expect(g.barrels.length).toBe(1);
  });
});

describe("getting around barrels", () => {
  const withBarrelAhead = (kind: string, offset: number): { g: Rush; e: RushEnemy; x: number; z: number } => {
    const x = 1;
    const z = -20;
    const g = new Rush({ ...plain, waves: [{ gap: 100, enemies: ["rusher"], barrels: [{ x, z }] }] });
    const e = (g as unknown as { makeEnemy(k: string): RushEnemy }).makeEnemy(kind);
    e.x = x + offset;
    e.z = z - 8;
    g.enemies = [e];
    return { g, e, x, z };
  };

  for (const kind of ["rusher", "shield", "fat"]) {
    for (const offset of [0, 0.3, -0.4]) {
      it(`a ${kind} coming at ${offset} never runs through one`, () => {
        const { g, e, x, z } = withBarrelAhead(kind, offset);
        let closest = Infinity;
        for (let i = 0; i < 60 * 8 && e.z < z + 3; i++) {
          run(g, DT);
          closest = Math.min(closest, Math.hypot(e.x - x, e.z - z));
        }
        expect(e.z).toBeGreaterThan(z);
        expect(closest).toBeGreaterThan(RUSH.barrelHalfWidth + 0.4);
      });
    }
  }

  it("leaves someone not heading for it alone", () => {
    const { g, e } = withBarrelAhead("rusher", 4);
    const x = e.x;
    e.endX = x;
    run(g, 1);
    expect(e.x).toBeCloseTo(x);
  });
});

describe("barrels rolling out of the saloons", () => {
  const rolling = (): Rush => new Rush({ ...plain, rollEvery: 1, waves: [{ gap: 100, enemies: ["rusher"] }] });

  it("come out from the side of the street and cross it", () => {
    const g = rolling();
    g.enemies = [];
    (g as unknown as { spawned: number }).spawned = 0;
    const events = run(g, 1.1);
    expect(events.some((e) => e.type === "barrelRolled")).toBe(true);
    const b = g.barrels.find((x) => x.roll !== 0)!;
    expect(Math.abs(b.x)).toBeGreaterThan(RUSH.laneHalfWidth);
    const x = b.x;
    run(g, 0.5);
    expect(Math.abs(b.x)).toBeLessThan(Math.abs(x));
    expect(b.turned).not.toBe(0);
  });

  it("set themselves off when they roll into a goon", () => {
    const g = new Rush({ ...plain, waves: [{ gap: 100, enemies: ["rusher"] }] });
    const make = g as unknown as { makeEnemy(k: string): RushEnemy };
    const e = make.makeEnemy("fat");
    e.x = 0;
    e.z = -20;
    g.enemies = [e];
    g.barrels = [{ id: 99, x: -2, z: -20, roll: RUSH.rollSpeed, turned: 0, y: 0, vy: 0 }];
    const events: RushEvent[] = [];
    for (let i = 0; i < 60 && g.enemies.includes(e); i++) {
      const step = run(g, DT);
      events.push(...step);
      (g as unknown as { stepRolling(d: number): void }).stepRolling(0);
    }
    expect(events.some((x) => x.type === "barrel")).toBe(true);
    expect(g.enemies.includes(e)).toBe(false);
  });

  it("can be shot, like any other", () => {
    const g = new Rush({ ...plain, waves: [{ gap: 100, enemies: ["rusher"] }] });
    g.barrels = [{ id: 99, x: 0, z: -15, roll: 0.1, turned: 0, y: 0, vy: 0 }];
    const events = run(g, 0.05, { aim: projectToScreen(0, 0.7, -15, g.cameraX, g.cameraY)! });
    expect(events.some((x) => x.type === "barrel")).toBe(true);
  });

  it("go away when they reach the other side", () => {
    const g = new Rush({ ...plain, waves: [{ gap: 100, enemies: ["rusher"] }] });
    g.barrels = [{ id: 99, x: RUSH.rollEndX - 0.05, z: -15, roll: RUSH.rollSpeed, turned: 0, y: 0, vy: 0 }];
    run(g, 0.2);
    expect(g.barrels.length).toBe(0);
  });
});

describe("weapons", () => {
  it("are carried by every runner, and only by runners", () => {
    const g = new Rush(plain);
    const make = g as unknown as { makeEnemy(k: string): RushEnemy };
    const seen = new Set<string | null>();
    for (let i = 0; i < 30; i++) seen.add(make.makeEnemy("rusher").weapon);
    expect(seen).toEqual(new Set(["machete", "axe", "club"]));
    expect(make.makeEnemy("thrower").weapon).toBeNull();
    expect(make.makeEnemy("fat").weapon).toBeNull();
  });

  it("swing once a runner's reached you", () => {
    const g = new Rush(plain);
    const e = (g as unknown as { makeEnemy(k: string): RushEnemy }).makeEnemy("rusher");
    e.z = RUSH.strikeZ - 6;
    g.enemies = [e];
    expect(e.swing).toBe(-1);
    run(g, 1.1);
    expect(e.swing).toBeGreaterThanOrEqual(0);
  });
});

describe("reloading", () => {
  const armed = (): Rush => new Rush({ ...plain, ammo: 6 });

  /** Fires every shot, stopping before the press that would start a reload. */
  const emptied = (): Rush => {
    const g = armed();
    for (let i = 0; i < 300 && g.ammo > 0; i++) run(g, DT, { fire: true });
    return g;
  };

  it("runs out after six shots", () => {
    const g = armed();
    let shots = 0;
    for (let i = 0; i < 300 && g.ammo > 0; i++) shots += run(g, DT, { fire: true }).filter((e) => e.type === "shot").length;
    expect(shots).toBe(6);
    expect(g.ammo).toBe(0);
    expect(g.reload).toBeNull();
  });

  it("clicks and reloads by itself when you shoot it empty", () => {
    const g = emptied();
    const events = run(g, RUSH.fireGapSec + DT, { fire: true });
    expect(events.some((e) => e.type === "empty")).toBe(true);
    expect(events.some((e) => e.type === "reloading" && e.bullets === 6)).toBe(true);
    expect(g.reload).not.toBeNull();
  });

  it("can't fire while reloading", () => {
    const g = emptied();
    run(g, RUSH.fireGapSec + DT, { fire: true });
    expect(run(g, reloadTime(6) / 2, { fire: true }).some((e) => e.type === "shot")).toBe(false);
  });

  it("puts the bullets in one at a time, then closes", () => {
    const g = emptied();
    const events = run(g, reloadTime(6) + 0.1, { reload: true, fire: false });
    const bullets = events.filter((e) => e.type === "bulletIn");
    expect(bullets.length).toBe(6);
    expect(bullets.map((e) => (e.type === "bulletIn" ? e.loaded : 0))).toEqual([1, 2, 3, 4, 5, 6]);
    const order = events.map((e) => e.type).filter((t) => ["reloading", "bulletIn", "reloadClosing", "reloaded"].includes(t));
    expect(order[0]).toBe("reloading");
    expect(order.slice(-2)).toEqual(["reloadClosing", "reloaded"]);
    expect(g.ammo).toBe(6);
  });

  it("fills the ammo one bullet at a time", () => {
    const g = emptied();
    run(g, DT, { reload: true, fire: false });
    run(g, RUSH.reloadOpenSec + RUSH.reloadBulletSec * 2.5, { fire: false });
    expect(g.ammo).toBe(2);
  });

  it("only loads what's missing, and that's quicker", () => {
    const g = armed();
    run(g, DT, { fire: true });
    run(g, RUSH.fireGapSec + DT, { fire: true });
    expect(g.ammo).toBe(4);
    run(g, DT, { reload: true, fire: false });
    const events = run(g, reloadTime(2) + 0.05, { fire: false });
    expect(events.filter((e) => e.type === "bulletIn").length).toBe(2);
    expect(events.some((e) => e.type === "reloaded")).toBe(true);
    expect(g.ammo).toBe(6);
  });

  it("reloads when you lower your arm", () => {
    const g = emptied();
    const events = run(g, reloadTime(6) + 0.05, { aim: { x: 0.5, y: RUSH.reloadFromY + 0.02 }, fire: false });
    expect(events.some((e) => e.type === "reloading")).toBe(true);
    expect(events.some((e) => e.type === "reloaded")).toBe(true);
    expect(g.ammo).toBe(6);
  });

  it("reloads on the key too", () => {
    const g = armed();
    run(g, DT, { fire: true });
    run(g, DT, { reload: true, fire: false });
    run(g, reloadTime(1) + 0.05, { fire: false });
    expect(g.ammo).toBe(6);
  });

  it("doesn't start with a full gun", () => {
    const g = armed();
    expect(run(g, 0.5, { aim: { x: 0.5, y: 0.98 }, fire: false }).some((e) => e.type === "reloading")).toBe(false);
  });

  it("doesn't count an arm that's lowered as being on a target", () => {
    const g = armed();
    run(g, DT, { aim: { x: 0.5, y: 0.98 }, fire: false });
    expect(g.onTarget).toBe(false);
  });
});

describe("dead-eye", () => {
  const full = (): Rush => {
    const g = new Rush({ ...plain, ammo: 6 });
    const k = g as unknown as { addKill(p: number): void };
    for (let i = 0; i < RUSH.deadEyeKills; i++) k.addKill(0);
    return g;
  };

  it("fills up with kills, and tells you", () => {
    const g = full();
    expect(g.deadEye).toBe(1);
    expect(g.deadEyeReady).toBe(true);
    expect(g.drainEvents().some((e) => e.type === "deadEyeReady")).toBe(true);
  });

  it("doesn't start before it's full", () => {
    const g = new Rush(plain);
    run(g, 0.5);
    expect(g.deadEye).toBeLessThan(1);
    expect(g.deadEyeLeft).toBe(0);
  });

  it("takes twice the kills it used to", () => {
    expect(RUSH.deadEyeKills).toBe(16);
  });

  it("slows the world, fires fast without using ammo, then ends", () => {
    const g = full();
    run(g, DT * 3);
    expect(g.deadEyeLeft).toBeGreaterThan(0);
    expect(g.timeScale).toBe(RUSH.deadEyeScale);
    const ammo = g.ammo;
    const shots = run(g, 1, { fire: true }).filter((e) => e.type === "shot").length;
    expect(shots).toBeGreaterThan(5);
    expect(g.ammo).toBe(ammo);
    const events = run(g, RUSH.deadEyeSec);
    expect(events.some((e) => e.type === "deadEyeEnd")).toBe(true);
    expect(g.timeScale).toBe(1);
    expect(g.deadEye).toBe(0);
  });
});

describe("special goons", () => {
  const spawn = (kind: string): { g: Rush; e: RushEnemy } => {
    const g = new Rush(plain);
    const e = (g as unknown as { makeEnemy(k: string): RushEnemy }).makeEnemy(kind);
    g.enemies.push(e);
    return { g, e };
  };

  it("shields block a shot at the middle, and let one over the top through", () => {
    const { g, e } = spawn("shield");
    const events = run(g, 0.05, { aim: aimAt(g, e, 1) });
    expect(events.some((x) => x.type === "blocked")).toBe(true);
    expect(g.enemies.includes(e)).toBe(true);
    run(g, RUSH.fireGapSec, { aim: aimAt(g, e, 2.1) });
    expect(g.enemies.includes(e)).toBe(false);
  });

  it("shields wear down with each shot, then break, leaving the goon open", () => {
    const { g, e } = spawn("shield");
    const shoot = () => run(g, RUSH.fireGapSec + DT, { aim: aimAt(g, e, 1) });
    expect(e.shieldHp).toBe(RUSH.shieldHits);
    const events = [...shoot()];
    expect(e.shieldHp).toBeLessThan(RUSH.shieldHits);
    while (e.shieldHp > 0) events.push(...shoot());
    expect(events.filter((x) => x.type === "blocked").length).toBe(RUSH.shieldHits - 1);
    expect(events.filter((x) => x.type === "shieldBroke").length).toBe(1);
    expect(events.some((x) => x.type === "scored" && x.label === "SHIELD BROKEN!")).toBe(true);
    expect(g.enemies.includes(e)).toBe(true);
    shoot();
    expect(g.enemies.includes(e)).toBe(false);
  });

  it("speeds a goon up once their shield's gone", () => {
    const { g, e } = spawn("shield");
    let z = e.z;
    run(g, 0.5);
    const slow = e.z - z;
    e.shieldHp = 0;
    z = e.z;
    run(g, 0.5);
    expect(e.z - z).toBeGreaterThan(slow);
  });

  it("knocks a shield goon back with each block", () => {
    const { g, e } = spawn("shield");
    const z = e.z;
    run(g, DT, { aim: aimAt(g, e, 1) });
    expect(e.z).toBeLessThan(z);
  });

  it("fat goons take three body shots", () => {
    const { g, e } = spawn("fat");
    run(g, 0.05, { aim: aimAt(g, e, 0.2) });
    expect(e.hp).toBe(RUSH.fatHits - 1);
    run(g, RUSH.fireGapSec, { aim: aimAt(g, e, 0.2) });
    expect(e.hp).toBe(RUSH.fatHits - 2);
    run(g, RUSH.fireGapSec, { aim: aimAt(g, e, 0.2) });
    expect(g.enemies.includes(e)).toBe(false);
  });

  it("fat goons still go down to one headshot", () => {
    const { g, e } = spawn("fat");
    run(g, 0.05, { aim: aimAt(g, e, 2.2) });
    expect(g.enemies.includes(e)).toBe(false);
  });

  it("golden goons sprint down the street and past you, without hurting you", () => {
    const { g, e } = spawn("golden");
    expect(e.outfit).toBe(GOLDEN_OUTFIT);
    const hearts = g.hearts;
    const events: RushEvent[] = [];
    while (g.enemies.includes(e)) events.push(...run(g, 0.1));
    expect(events.some((x) => x.type === "goldenEscaped")).toBe(true);
    expect(g.hearts).toBe(hearts);
  });

  it("golden goons are worth a lot", () => {
    const { g, e } = spawn("golden");
    e.x = 0;
    run(g, 0.05, { aim: aimAt(g, e) });
    expect(g.score).toBe(RUSH.goldenPoints);
  });
});

describe("whiskey", () => {
  const hurtGame = (): Rush => {
    const g = new Rush({ ...plain, whiskeyEvery: 1 });
    g.hearts = 2;
    return g;
  };

  it("doesn't come while your hearts are full", () => {
    const g = new Rush({ ...plain, whiskeyEvery: 0.5, waves: [{ gap: 100, enemies: ["rusher"] }] });
    g.enemies = [];
    run(g, 1);
    expect(g.whiskey).toBeNull();
  });

  it("sails across when you're hurt, and gives a heart back when shot", () => {
    const g = hurtGame();
    run(g, 2);
    const w = g.whiskey!;
    expect(w).not.toBeNull();
    const events = run(g, 0.05, { aim: projectToScreen(w.x, w.y, w.z, g.cameraX, g.cameraY)! });
    expect(events.some((e) => e.type === "healed")).toBe(true);
    expect(g.hearts).toBeGreaterThanOrEqual(3);
    expect(g.whiskey).toBeNull();
  });

  it("flies off if you miss it", () => {
    const g = hurtGame();
    run(g, 2);
    const w = g.whiskey;
    run(g, RUSH.whiskeySec);
    expect(g.whiskey).not.toBe(w);
  });
});

describe("the level's sequence", () => {
  const kindsUntil = (done: (g: Rush) => boolean): { g: Rush; events: RushEvent[] } => {
    const g = new Rush(plain);
    return { g, events: play(g, done, 400) };
  };

  it("rests, rides to the bank, drops the boss, stares it down, and only then fights", () => {
    const { g, events } = kindsUntil((x) => x.phase === "bossShoot");
    const order = events
      .filter((e) => ["cleared", "travel", "arena", "bossArrives", "bossLanded", "challenge", "faceoff", "shootTime"].includes(e.type))
      .map((e) => e.type)
      .slice(-7);
    expect(order).toEqual(["travel", "arena", "bossArrives", "bossLanded", "challenge", "faceoff", "shootTime"]);
    expect(g.enemies[0]!.kind).toBe("boss");
  });

  it("has no boss, and no staredown, during the waves", () => {
    const g = new Rush(plain);
    const events = play(g, (x) => x.phase === "clear");
    expect(g.phase).toBe("clear");
    expect(events.some((e) => e.type === "faceoff" || e.type === "bossArrives")).toBe(false);
  });

  it("rides the camera up the street, with nobody to shoot on the way", () => {
    const g = new Rush(plain);
    play(g, (x) => x.phase === "travel");
    expect(g.phase).toBe("travel");
    expect(g.railZ).toBe(0);
    expect(g.canShoot).toBe(false);
    run(g, 1.6);
    expect(g.railZ).toBeLessThan(0);
    expect(g.travelT).toBeGreaterThan(0);
  });

  it("ends the ride turned to face the bank", () => {
    const g = new Rush(plain);
    play(g, (x) => x.phase === "arena");
    expect(g.railYaw).toBeCloseTo(BANK_STOP.yaw);
    expect(g.railX).toBeCloseTo(BANK_STOP.x);
    expect(g.railZ).toBeCloseTo(BANK_STOP.z);
    expect(g.travelT).toBe(0);
  });

  it("drops the boss from the roof down to the street", () => {
    const g = new Rush(plain);
    play(g, (x) => x.phase === "bossDrop");
    const boss = g.enemies[0]!;
    expect(boss.y).toBeGreaterThan(RUSH.bossRoofY * 0.8);
    expect(g.canShoot).toBe(false);
    play(g, (x) => x.phase === "faceoff");
    expect(g.enemies[0]!.y).toBe(0);
    expect(g.enemies[0]!.z).toBe(RUSH.bossZ);
  });

  it("can skip the staredown with OK, but not by accident", () => {
    const g = new Rush(plain);
    play(g, (x) => x.phase === "faceoff");
    run(g, DT, { fire: true });
    expect(g.phase).toBe("faceoff");
    run(g, 0.5);
    run(g, DT, { fire: true });
    expect(g.phase).toBe("bossShoot");
  });

  it("gives you a full gun for the fight", () => {
    const g = new Rush({ ...plain, ammo: 6 });
    g.ammo = 1;
    (g as unknown as { enterStage(s: { kind: string }): void }).enterStage({ kind: "boss" });
    expect(g.ammo).toBe(6);
  });
});

describe("losing", () => {
  it("ends when the hearts run out, then does nothing more", () => {
    const g = new Rush(plain);
    run(g, 90);
    expect(g.phase).toBe("lost");
    expect(g.hearts).toBe(0);
    expect(g.enemies).toEqual([]);
    expect(g.thrown).toEqual([]);
    const score = g.score;
    run(g, 1, { fire: true });
    expect(g.score).toBe(score);
  });
});

describe("the score sheet", () => {
  const oneRunner = () => {
    const g = new Rush({ ...plain, ammo: 99, waves: [{ gap: 100, enemies: ["rusher"] }, { gap: 100, enemies: ["rusher"] }] });
    run(g, DT * 2);
    return { g, e: g.enemies[0]! };
  };

  it("counts shots, hits and kills, and reports them when the wave's clear", () => {
    const { g, e } = oneRunner();
    run(g, DT, { fire: true });
    run(g, RUSH.fireGapSec + DT, { aim: aimAt(g, e, 1), fire: true });
    const cleared = run(g, 1).concat(g.drainEvents()).find((x) => x.type === "cleared");
    const report = cleared?.type === "cleared" ? cleared.report : g.summary;
    expect(report.shots).toBe(2);
    expect(report.hits).toBe(1);
    expect(report.kills).toBe(1);
  });

  it("pays the wave's bonus into the score, and says so", () => {
    const { g, e } = oneRunner();
    const events = run(g, DT, { aim: aimAt(g, e, 1), fire: true });
    events.push(...run(g, RUSH.lastKillSlowSec + 1));
    const cleared = events.find((x) => x.type === "cleared");
    expect(cleared?.type).toBe("cleared");
    if (cleared?.type !== "cleared") return;
    expect(cleared.report.bonus).toBeGreaterThan(0);
    expect(events.some((x) => x.type === "scored" && x.points === cleared.report.bonus)).toBe(true);
    expect(g.score).toBeGreaterThanOrEqual(cleared.report.bonus);
  });

  it("starts each wave's report fresh, while the run's keeps counting", () => {
    const { g, e } = oneRunner();
    run(g, DT, { aim: aimAt(g, e, 1), fire: true });
    run(g, 5 + RUSH.lastKillSlowSec);
    const second = g.enemies[0]!;
    expect(second).toBeDefined();
    const events = run(g, DT, { aim: aimAt(g, second, 1), fire: true });
    events.push(...run(g, RUSH.lastKillSlowSec + 1));
    const cleared = events.find((x) => x.type === "cleared");
    if (cleared?.type !== "cleared") throw new Error("the second wave should have cleared");
    expect(cleared.report.kills).toBe(1);
    expect(g.summary.kills).toBe(2);
  });

  it("holds a headshot longer than a body shot", () => {
    expect(RUSH.hitStopHeadSec).toBeGreaterThan(RUSH.hitStopSec);
  });
});
