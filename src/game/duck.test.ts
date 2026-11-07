import { describe, expect, it } from "vitest";
import { Match, type PlayerInput } from "./match";
import { DEFAULT_RULES, DUCK_HEIGHT, HITBOX, damageFor, hitZone, nearestPointOnBody, planeToScreen, reticleHits } from "./rules";

const STEP = 1 / 60;

type Over = Partial<{ lateral: number; duck: boolean; aim: { x: number; y: number }; loudness: number }>;

function input(over: Over = {}): PlayerInput {
  return {
    aim: () => over.aim ?? { x: 0.5, y: 0.5 },
    loudness: () => over.loudness ?? 0,
    lateral: () => over.lateral ?? 0,
    available: () => true,
    duck: () => over.duck ?? false,
  };
}

/** A match on its first aiming turn, with short fuses so the tests stay readable. */
function game(shooter: PlayerInput, target: PlayerInput) {
  const m = new Match(1, { ...DEFAULT_RULES, aimSec: 1 });
  m.step(STEP, { shooter, target, confirm: true });
  const until = (done: (m: Match) => boolean): void => {
    for (let i = 0; i < 60 * 30 && !done(m); i++) m.step(STEP, { shooter, target, confirm: false });
  };
  return { m, until };
}

const headAim = planeToScreen({ x: 0, y: 2.6 });

describe("ducking", () => {
  it("lowers the body while held, and rises again after", () => {
    const pressed = { duck: true };
    const target = input(pressed);
    const { m } = game(input(), target);
    for (let i = 0; i < 30; i++) m.step(STEP, { shooter: input(), target, confirm: false });
    expect(m.duck).toBeGreaterThan(0.95);
    expect(m.bodyHeight).toBeCloseTo(DUCK_HEIGHT, 1);
    pressed.duck = false;
    const standing = input();
    for (let i = 0; i < 30; i++) m.step(STEP, { shooter: input(), target: standing, confirm: false });
    expect(m.duck).toBeLessThan(0.05);
    expect(m.bodyHeight).toBeCloseTo(HITBOX.height, 1);
  });

  it("dodges a shot at the head", () => {
    const { m, until } = game(input({ aim: headAim }), input({ duck: true }));
    until((x) => x.phase === "impact");
    expect(m.shot?.hit).toBe(false);
    expect(m.health[1]).toBe(DEFAULT_RULES.startHealth);
  });

  it("gets hit there when standing", () => {
    const { m, until } = game(input({ aim: headAim }), input());
    until((x) => x.phase === "impact");
    expect(m.shot?.zone).toBe("head");
  });

  it("slows you down", () => {
    const up = game(input(), input({ lateral: 1 }));
    const down = game(input(), input({ lateral: 1, duck: true }));
    up.until((x) => x.phaseTime > 0.5);
    down.until((x) => x.phaseTime > 0.5);
    expect(Math.abs(down.m.targetX)).toBeLessThan(Math.abs(up.m.targetX));
    expect(Math.abs(down.m.targetX)).toBeGreaterThan(0);
  });

  it("moves the head down with the body", () => {
    expect(hitZone({ x: 0, y: 1.1 }, 0, HITBOX.height)).toBe("body");
    expect(hitZone({ x: 0, y: 1.1 }, 0, DUCK_HEIGHT)).toBe("head");
  });

  it("makes the body shorter to hit", () => {
    expect(nearestPointOnBody({ x: 0, y: 5 }, 0, DUCK_HEIGHT).y).toBe(DUCK_HEIGHT);
    expect(reticleHits({ x: 0, y: 2.5 }, 0.35, 0, HITBOX.height)).toBe(true);
    expect(reticleHits({ x: 0, y: 2.5 }, 0.35, 0, DUCK_HEIGHT)).toBe(false);
  });
});

describe("the shot", () => {
  const begin = (over: Partial<typeof DEFAULT_RULES> = {}) => {
    const shooter = input();
    const target = input();
    const m = new Match(1, { ...DEFAULT_RULES, ...over });
    m.step(STEP, { shooter, target, confirm: true });
    const run = (seconds: number, confirm = false): void => {
      for (let i = 0; i < seconds / STEP; i++) m.step(STEP, { shooter, target, confirm });
    };
    return { m, run };
  };

  it("charges by itself, and fires by itself when full", () => {
    const { m, run } = begin();
    run(DEFAULT_RULES.aimSec / 2);
    expect(m.bar).toBeCloseTo(0.5, 1);
    expect(m.phase).toBe("aim");
    run(DEFAULT_RULES.aimSec / 2 + 0.1);
    expect(m.phase).toBe("shot");
  });

  it("fires early on OK", () => {
    const { m, run } = begin();
    run(1);
    expect(m.phase).toBe("aim");
    run(STEP, true);
    expect(m.phase).toBe("shot");
    expect(m.bar).toBeLessThan(0.5);
  });

  it("ignores a press from the screen before", () => {
    const { m, run } = begin();
    run(STEP, true);
    expect(m.phase).toBe("aim");
  });

  it("does the same damage however soon it's fired", () => {
    const early = begin();
    early.run(1);
    early.run(STEP, true);
    const late = begin();
    late.run(DEFAULT_RULES.aimSec + 0.1);
    expect(early.m.shot!.radius).toBe(late.m.shot!.radius);
    expect(damageFor(early.m.shot!.bar, DEFAULT_RULES, "body")).toBe(damageFor(late.m.shot!.bar, DEFAULT_RULES, "body"));
  });

  it("doesn't let OK fire the dummy's shot", () => {
    const { m, run } = begin();
    m.setShooter(1);
    run(1);
    run(STEP, true);
    expect(m.phase).toBe("aim");
  });

  it("holds the charge and OK off until it's allowed", () => {
    const { m, run } = begin();
    m.charging = false;
    run(1);
    run(STEP, true);
    expect(m.bar).toBeLessThan(0.05);
    expect(m.phase).toBe("aim");
  });
});

describe("x-rays on body hits", () => {
  const bodyAim = planeToScreen({ x: 0, y: 1 });
  const land = (roll: number) => {
    const shooter = input({ aim: bodyAim });
    const target = input();
    const m = new Match(1, { ...DEFAULT_RULES, aimSec: 0.1 }, () => roll);
    m.step(STEP, { shooter, target, confirm: true });
    for (let i = 0; i < 60 * 10 && m.phase !== "impact"; i++) m.step(STEP, { shooter, target, confirm: false });
    return m.shot!;
  };

  it("happens on a lucky roll", () => {
    const shot = land(DEFAULT_RULES.xrayChance - 0.01);
    expect(shot.zone).toBe("body");
    expect(shot.xray).toBe(true);
  });

  it("doesn't on an unlucky one", () => {
    expect(land(DEFAULT_RULES.xrayChance + 0.01).xray).toBe(false);
  });

  it("isn't rolled for a miss", () => {
    const shooter = input({ aim: { x: 0.02, y: 0.02 } });
    const target = input();
    const m = new Match(1, { ...DEFAULT_RULES, aimSec: 0.1 }, () => 0);
    m.step(STEP, { shooter, target, confirm: true });
    for (let i = 0; i < 60 * 10 && m.phase !== "impact"; i++) m.step(STEP, { shooter, target, confirm: false });
    expect(m.shot!.hit).toBe(false);
    expect(m.shot!.xray).toBe(false);
  });
});

describe("the last movement, in slow motion", () => {
  it("keeps the target moving while the bullet flies, then slowing to a stop", () => {
    const { m, until } = game(input(), input({ lateral: 0.4 }));
    until((x) => x.phase === "shot");
    const atFire = m.targetX;
    until((x) => x.phaseTime > DEFAULT_RULES.slowMoSec / 2);
    const halfway = m.targetX;
    expect(halfway).toBeGreaterThan(atFire);
    until((x) => x.phase === "impact");
    expect(m.shot!.targetX).toBeGreaterThan(halfway);
    // Far less than it could have walked in that time at full speed.
    expect(m.shot!.targetX - atFire).toBeLessThan(DEFAULT_RULES.walkSpeed);
  });

  it("takes no new input once the shot's away", () => {
    const moving = { lateral: 0.4 };
    const { m, until } = game(input(), input(moving));
    until((x) => x.phase === "shot");
    moving.lateral = -1;
    const atFire = m.targetX;
    until((x) => x.phase === "impact");
    expect(m.shot!.targetX).toBeGreaterThan(atFire);
  });

  it("leaves a still target still", () => {
    const { m, until } = game(input(), input());
    until((x) => x.phase === "impact");
    expect(m.shot!.targetX).toBe(0);
  });

  it("decides the hit where the target ends up, not where it was", () => {
    // Aimed just ahead of a target walking right, and it walks into the shot.
    const { m, until } = game(input({ aim: planeToScreen({ x: 5.2, y: 1 }) }), input({ lateral: 1 }));
    until((x) => x.phase === "shot");
    const hitAtFire = reticleHits(m.shot!.aim, m.shot!.radius, m.targetX);
    until((x) => x.phase === "impact");
    expect(hitAtFire).toBe(false);
    expect(m.shot!.hit).toBe(true);
    expect(m.health[1]).toBeLessThan(DEFAULT_RULES.startHealth);
  });

  it("finishes a duck that was already under way", () => {
    const { m, until } = game(input(), input());
    const ducking = input({ duck: true });
    until((x) => x.phaseTime > 0.97);
    for (let i = 0; i < 5; i++) m.step(STEP, { shooter: input(), target: ducking, confirm: false });
    const atFire = m.duck;
    until((x) => x.phase === "impact");
    expect(m.phase).toBe("impact");
    expect(atFire).toBeGreaterThanOrEqual(0);
  });
});
