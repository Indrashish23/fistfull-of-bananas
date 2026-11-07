import { describe, expect, it } from "vitest";
import { Match, type MatchEvent, type PlayerInput } from "./match";
import {
  DEFAULT_RULES,
  aimToPlane,
  ZONES,
  damageFor,
  KILLCAM,
  INTRO,
  hitZone,
  introStage,
  killCamFor,
  killCamStage,
  followToward,
  planeToScreen,
  reticleHits,
  reticleRadius,
  shapeMove,
  type Rules,
  type Vec2,
} from "./rules";

const DT = 1 / 60;

function input(over: Partial<{ aim: Vec2; loudness: number; lateral: number; available: boolean }> = {}): PlayerInput {
  return {
    aim: () => over.aim ?? { x: 0.5, y: 0.5 },
    loudness: () => over.loudness ?? 0,
    lateral: () => over.lateral ?? 0,
    available: () => over.available ?? true,
  };
}

/** The aim that puts the reticle in the middle of a target standing at x = 0. */
const ON_TARGET = planeToScreen({ x: 0, y: 1 });
const OFF_TARGET = planeToScreen({ x: 6, y: 6.5 });

function rules(over: Partial<Rules> = {}): Rules {
  return { ...DEFAULT_RULES, xrayChance: 0, ...over };
}

/** Steps until the phase changes, pressing confirm when a hand-off asks for it. */
function run(match: Match, shooter: PlayerInput, target: PlayerInput, until: (m: Match) => boolean): MatchEvent[] {
  const events: MatchEvent[] = [];
  for (let i = 0; i < 200_000 && !until(match); i++) {
    match.step(DT, { shooter, target, confirm: match.phase === "handoff" });
    events.push(...match.drainEvents());
  }
  expect(until(match)).toBe(true);
  return events;
}

function playTurn(match: Match, shooter: PlayerInput, target = input()): MatchEvent[] {
  const startShooter = match.shooter;
  const startRound = match.round;
  return run(
    match,
    shooter,
    target,
    (m) => m.phase === "results" || m.shooter !== startShooter || m.round !== startRound,
  );
}

describe("the reticle", () => {
  it("scale with the bar across the configured range", () => {
    const r = rules({ damageMin: 10, damageMax: 50, reticleMin: 0.2, reticleMax: 0.8 });
    expect(damageFor(0, r)).toBe(10);
    expect(damageFor(1, r)).toBe(50);
    expect(reticleRadius(0, r)).toBe(r.reticleMin);
    expect(reticleRadius(1, r)).toBe(r.reticleMax);
  });

  it("leaves the lane wider than the largest reticle, so dodging can work", () => {
    const r = rules();
    expect(r.laneHalfWidth * 2).toBeGreaterThan(r.reticleMax * 2);
  });
});

describe("reticle overlap", () => {
  it("hits when the circle touches the body", () => {
    expect(reticleHits({ x: 0, y: 1 }, 0.1, 0)).toBe(true);
    // Body edge at x = 0.6, reticle edge reaches 0.7.
    expect(reticleHits({ x: 1.0, y: 1 }, 0.4, 0)).toBe(true);
  });

  it("misses when the circle stops short of the body", () => {
    expect(reticleHits({ x: 1.1, y: 1 }, 0.4, 0)).toBe(false);
    expect(reticleHits({ x: 0, y: 3.5 }, 0.4, 0)).toBe(false);
  });

  it("maps screen to plane and back", () => {
    const p = aimToPlane({ x: 0.2, y: 0.7 });
    const s = planeToScreen(p);
    expect(s.x).toBeCloseTo(0.2);
    expect(s.y).toBeCloseTo(0.7);
  });
});

describe("turn order", () => {
  it("hands off between people and takes turns", () => {
    const m = new Match(2, rules());
    const events = run(m, input({ aim: OFF_TARGET }), input(), (x) => x.phase === "handoff");
    expect(events).toEqual([]);
    expect(m.shooter).toBe(0);

    run(m, input({ aim: OFF_TARGET }), input(), (x) => x.phase === "aim");
    run(m, input({ aim: OFF_TARGET }), input(), (x) => x.phase === "handoff");
    expect(m.shooter).toBe(1);
    expect(m.round).toBe(1);

    run(m, input({ aim: OFF_TARGET }), input(), (x) => x.phase === "aim");
    run(m, input({ aim: OFF_TARGET }), input(), (x) => x.phase === "handoff");
    expect(m.shooter).toBe(0);
    expect(m.round).toBe(2);
  });

  it("waits at the hand-off until someone confirms", () => {
    const m = new Match(2, rules());
    run(m, input(), input(), (x) => x.phase === "handoff");
    for (let i = 0; i < 600; i++) m.step(DT, { shooter: input(), target: input(), confirm: false });
    expect(m.phase).toBe("handoff");
  });

  it("skips the hand-off against a dummy", () => {
    const m = new Match(1, rules());
    const seen = new Set<string>();
    run(m, input({ aim: OFF_TARGET }), input(), (x) => {
      seen.add(x.phase);
      return x.round === 2;
    });
    expect(seen.has("handoff")).toBe(false);
    expect(m.isHuman(1)).toBe(false);
  });

  it("resets the bar and the target for each new turn", () => {
    const m = new Match(1, rules());
    const loud = input({ aim: OFF_TARGET, loudness: 1 });
    run(m, loud, input({ lateral: 1 }), (x) => x.phase === "shot");
    expect(m.bar).toBe(1);
    expect(m.targetX).toBeGreaterThan(0);
    run(m, loud, input(), (x) => x.shooter === 1);
    expect(m.bar).toBeLessThan(0.05);
    expect(Math.abs(m.targetX)).toBeLessThan(0.01);
  });
});

describe("shots", () => {
  it("fires itself when the timer ends, and damages on landing", () => {
    const r = rules();
    const m = new Match(1, r);
    const events = run(m, input({ aim: ON_TARGET, loudness: 1 }), input(), (x) => x.phase === "impact");
    expect(events.map((e) => e.type)).toEqual(["turn", "fired", "impact"]);
    expect(m.shot?.hit).toBe(true);
    expect(m.shot?.damage).toBe(r.damageMax);
    expect(m.health[1]).toBe(r.startHealth - r.damageMax);
  });

  it("does no damage until the bullet lands", () => {
    const m = new Match(1, rules());
    run(m, input({ aim: ON_TARGET }), input(), (x) => x.phase === "shot");
    expect(m.shot?.hit).toBe(true);
    expect(m.health[1]).toBe(100);
  });

  it("misses when the target has walked out of the reticle", () => {
    const m = new Match(1, rules());
    run(m, input({ aim: ON_TARGET }), input({ lateral: 1 }), (x) => x.phase === "impact");
    expect(m.shot?.hit).toBe(false);
    expect(m.health[1]).toBe(100);
  });

  it("keeps the target inside the lane", () => {
    const r = rules();
    const m = new Match(1, r);
    run(m, input(), input({ lateral: 1 }), (x) => x.phase === "shot");
    expect(m.targetX).toBe(r.laneHalfWidth);
  });

  it("lands the bullet on the body for a hit and at the aim point for a miss", () => {
    const hit = new Match(1, rules());
    run(hit, input({ aim: planeToScreen({ x: 0.8, y: 1 }), loudness: 1 }), input(), (x) => x.phase === "shot");
    expect(hit.shot?.hit).toBe(true);
    expect(hit.shot?.landing.x).toBeCloseTo(0.6);

    const miss = new Match(1, rules());
    run(miss, input({ aim: OFF_TARGET }), input(), (x) => x.phase === "shot");
    expect(miss.shot?.hit).toBe(false);
    expect(miss.shot?.landing.x).toBeCloseTo(miss.shot!.aim.x);
  });
});

describe("walking", () => {
  /** Instant response and no extra gain, so distances can be checked exactly. */
  const exact = (): Rules => rules({ moveFollowPerSec: 1e9, moveSensitivity: 1, moveDeadzone: 0 });

  it("moves at the walk speed, either way", () => {
    const r = exact();
    const m = new Match(1, r);
    run(m, input(), input(), (x) => x.phase === "aim");
    for (let i = 0; i < 30; i++) m.step(DT, { shooter: input(), target: input({ lateral: 1 }), confirm: false });
    expect(m.targetX).toBeCloseTo(r.walkSpeed * 0.5, 1);
    for (let i = 0; i < 60; i++) m.step(DT, { shooter: input(), target: input({ lateral: -1 }), confirm: false });
    expect(m.targetX).toBeCloseTo(-r.walkSpeed * 0.5, 1);
  });

  it("scales with how far the input is pushed", () => {
    const r = exact();
    const m = new Match(1, r);
    run(m, input(), input(), (x) => x.phase === "aim");
    for (let i = 0; i < 60; i++) m.step(DT, { shooter: input(), target: input({ lateral: 0.5 }), confirm: false });
    expect(m.targetX).toBeCloseTo(r.walkSpeed * 0.5, 1);
  });

  it("stops the moment the input stops, when set to instant", () => {
    const m = new Match(1, exact());
    run(m, input(), input(), (x) => x.phase === "aim");
    m.step(DT, { shooter: input(), target: input({ lateral: 1 }), confirm: false });
    const x = m.targetX;
    m.step(DT, { shooter: input(), target: input(), confirm: false });
    expect(m.targetX).toBe(x);
    expect(m.lateral).toBe(0);
  });

  it("eases in and out by default, then comes to a full stop", () => {
    const m = new Match(1, rules());
    run(m, input(), input(), (x) => x.phase === "aim");
    m.step(DT, { shooter: input(), target: input({ lateral: 1 }), confirm: false });
    expect(m.lateral).toBeGreaterThan(0);
    expect(m.lateral).toBeLessThan(1);
    for (let i = 0; i < 60; i++) m.step(DT, { shooter: input(), target: input({ lateral: 1 }), confirm: false });
    expect(m.lateral).toBeCloseTo(1, 2);
    for (let i = 0; i < 120; i++) m.step(DT, { shooter: input(), target: input(), confirm: false });
    expect(m.lateral).toBe(0);
  });

  it("can walk clear of the biggest reticle within the aim timer", () => {
    const r = rules();
    expect(r.walkSpeed * r.aimSec).toBeGreaterThan(r.reticleMax + 0.6);
  });
});

describe("shaping the movement input", () => {
  it("ignores jitter inside the deadzone", () => {
    const r = rules({ moveDeadzone: 0.1 });
    expect(shapeMove(0.09, r)).toBe(0);
    expect(shapeMove(-0.09, r)).toBe(0);
  });

  it("starts from nothing at the deadzone's edge, rather than with a jump", () => {
    const r = rules({ moveDeadzone: 0.1, moveSensitivity: 1 });
    expect(shapeMove(0.11, r)).toBeLessThan(0.02);
  });

  it("lets sensitivity make a small input count for more", () => {
    const low = rules({ moveDeadzone: 0, moveSensitivity: 1 });
    const high = rules({ moveDeadzone: 0, moveSensitivity: 2 });
    expect(shapeMove(0.3, high)).toBeCloseTo(shapeMove(0.3, low) * 2);
  });

  it("never exceeds full speed, and keeps its direction", () => {
    const r = rules({ moveDeadzone: 0, moveSensitivity: 3 });
    expect(shapeMove(1, r)).toBe(1);
    expect(shapeMove(-1, r)).toBe(-1);
  });
});

describe("aim smoothing", () => {
  it("eases toward the input, rather than jumping", () => {
    const m = new Match(1, rules());
    run(m, input({ aim: planeToScreen({ x: 0, y: 2 }) }), input(), (x) => x.phase === "aim");
    m.step(DT, { shooter: input({ aim: planeToScreen({ x: 0, y: 2 }) }), target: input(), confirm: false });
    const goal = input({ aim: planeToScreen({ x: 4, y: 2 }) });
    m.step(DT, { shooter: goal, target: input(), confirm: false });
    expect(m.aim.x).toBeGreaterThan(0);
    expect(m.aim.x).toBeLessThan(4);
    for (let i = 0; i < 90; i++) m.step(DT, { shooter: goal, target: input(), confirm: false });
    expect(m.aim.x).toBeCloseTo(4, 1);
  });

  it("takes the aim as it is on the first frame of a turn", () => {
    const m = new Match(1, rules());
    const aim = input({ aim: planeToScreen({ x: 4, y: 2 }) });
    run(m, aim, input(), (x) => x.phase === "aim");
    m.step(DT, { shooter: aim, target: input(), confirm: false });
    expect(m.aim.x).toBeCloseTo(4, 3);
  });

  it("doesn't depend on the frame rate", () => {
    let fast = 0;
    for (let i = 0; i < 6; i++) fast = followToward(fast, 1, 1 / 60, 20);
    expect(fast).toBeCloseTo(followToward(0, 1, 6 / 60, 20), 5);
  });
});

describe("hit zones", () => {
  it("reads the head, the nuts and the rest of the body", () => {
    expect(hitZone({ x: 0, y: 2.3 }, 0)).toBe("head");
    expect(hitZone({ x: 0.1, y: 0.62 }, 0)).toBe("nuts");
    expect(hitZone({ x: 0, y: 1 }, 0)).toBe("body");
    expect(hitZone({ x: 0, y: 0.3 }, 0)).toBe("body");
  });

  it("uses the target's position, not the middle of the lane", () => {
    expect(hitZone({ x: 3.1, y: 0.62 }, 3)).toBe("nuts");
    expect(hitZone({ x: 0.1, y: 0.62 }, 3)).toBe("body");
  });

  it("doesn't count the hips as the nuts", () => {
    expect(hitZone({ x: ZONES.nutsHalfWidth + 0.05, y: 0.62 }, 0)).toBe("body");
    expect(hitZone({ x: 0, y: ZONES.nutsToY + 0.05 }, 0)).toBe("body");
    expect(hitZone({ x: 0, y: ZONES.nutsFromY - 0.05 }, 0)).toBe("body");
  });

  it("makes head and nuts hit harder than the body", () => {
    const r = rules();
    expect(damageFor(1, r, "head")).toBe(Math.round(r.damageMax * r.headMultiplier));
    expect(damageFor(1, r, "nuts")).toBe(Math.round(r.damageMax * r.nutsMultiplier));
    expect(damageFor(1, r, "body")).toBe(r.damageMax);
    expect(damageFor(1, r, "head")).toBeGreaterThan(damageFor(1, r, "nuts"));
  });

  it("records the zone on the shot and applies its damage", () => {
    const r = rules();
    const head = new Match(1, r);
    run(head, input({ aim: planeToScreen({ x: 0, y: 2.3 }), loudness: 1 }), input(), (x) => x.phase === "impact");
    expect(head.shot?.zone).toBe("head");
    expect(head.health[1]).toBe(r.startHealth - Math.round(r.damageMax * r.headMultiplier));

    const nuts = new Match(1, r);
    run(nuts, input({ aim: planeToScreen({ x: 0, y: 0.62 }), loudness: 1 }), input(), (x) => x.phase === "impact");
    expect(nuts.shot?.zone).toBe("nuts");
    expect(nuts.health[1]).toBe(r.startHealth - Math.round(r.damageMax * r.nutsMultiplier));
  });

  it("has no zone for a miss", () => {
    const m = new Match(1, rules());
    run(m, input({ aim: OFF_TARGET }), input(), (x) => x.phase === "shot");
    expect(m.shot?.zone).toBeNull();
  });
});

describe("the intro", () => {
  it("shows one player, then the other, then both", () => {
    expect(introStage(0)).toBe("first");
    expect(introStage(INTRO.firstSec)).toBe("second");
    expect(introStage(INTRO.secondSec)).toBe("versus");
  });

  it("holds the versus shot before the match starts", () => {
    expect(rules().introSec).toBeGreaterThan(INTRO.secondSec + 1);
  });
});

describe("the kill cam", () => {
  it("only plays for headshots and nut shots", () => {
    const r = rules();
    expect(killCamFor("head", r)).toBe(r.killCamSec);
    expect(killCamFor("nuts", r)).toBe(r.killCamSec);
    expect(killCamFor("body", r)).toBe(0);
    expect(killCamFor("body", r, true)).toBe(r.killCamSec);
    expect(killCamFor(null, r)).toBe(0);
  });

  it("runs impact frame, approach, shatter, then the knockdown", () => {
    const r = rules();
    expect(killCamStage(0, "head", r)).toBe("frame");
    expect(killCamStage(KILLCAM.frameSec, "head", r)).toBe("approach");
    expect(killCamStage(KILLCAM.contactSec, "head", r)).toBe("shatter");
    expect(killCamStage(r.killCamSec, "head", r)).toBe("over");
  });

  it("is over at once for a body hit or a miss", () => {
    const r = rules();
    expect(killCamStage(0, "body", r)).toBe("over");
    expect(killCamStage(0, null, r)).toBe("over");
  });

  it("swaps light and dark inside the impact frame only once", () => {
    expect(KILLCAM.frameSwapSec).toBeGreaterThan(0);
    expect(KILLCAM.frameSwapSec).toBeLessThan(KILLCAM.frameSec);
  });

  function impactLength(aim: Vec2): number {
    const m = new Match(1, rules());
    run(m, input({ aim, loudness: 1 }), input(), (x) => x.phase === "impact");
    let seconds = 0;
    while (m.phase === "impact") {
      m.step(DT, { shooter: input(), target: input(), confirm: false });
      seconds += DT;
    }
    return seconds;
  }

  it("adds its time to the turn without shortening the knockdown", () => {
    const r = rules();
    expect(impactLength(planeToScreen({ x: 0, y: 2.3 }))).toBeCloseTo(r.impactSec + r.killCamSec, 1);
    expect(impactLength(planeToScreen({ x: 0, y: 0.62 }))).toBeCloseTo(r.impactSec + r.killCamSec, 1);
    expect(impactLength(ON_TARGET)).toBeCloseTo(r.impactSec, 1);
  });

  it("doesn't change the damage or when it lands", () => {
    const m = new Match(1, rules());
    run(m, input({ aim: planeToScreen({ x: 0, y: 2.3 }), loudness: 1 }), input(), (x) => x.phase === "impact");
    expect(m.health[1]).toBeLessThan(100);
    expect(m.phaseTime).toBeLessThan(0.1);
  });
});

describe("suspension", () => {
  it("freezes the aim timer while an input is unavailable", () => {
    const m = new Match(1, rules());
    run(m, input(), input(), (x) => x.phase === "aim");
    const before = m.phaseTime;
    const held = input({ available: false, loudness: 1 });
    for (let i = 0; i < 600; i++) m.step(DT, { shooter: held, target: input(), confirm: false });
    expect(m.phase).toBe("aim");
    expect(m.suspended).toBe(true);
    expect(m.phaseTime).toBe(before);
    expect(m.bar).toBe(0);
  });
});

describe("how a match ends", () => {
  const hitHard = input({ aim: ON_TARGET, loudness: 1 });
  const hitNothing = input({ aim: OFF_TARGET });

  it("gives the second shooter a reply before checking for a knockout", () => {
    const m = new Match(2, rules({ startHealth: 10 }));
    playTurn(m, hitHard);
    expect(m.health[1]).toBe(0);
    expect(m.phase).not.toBe("results");
    expect(m.shooter).toBe(1);
  });

  it("ends in a draw when both players go down in one round", () => {
    const m = new Match(2, rules({ startHealth: 10 }));
    playTurn(m, hitHard);
    playTurn(m, hitHard);
    expect(m.phase).toBe("results");
    expect(m.winner).toBe("draw");
  });

  it("names the winner when only one player goes down", () => {
    const m = new Match(2, rules({ startHealth: 10 }));
    playTurn(m, hitHard);
    const events = playTurn(m, hitNothing);
    expect(m.winner).toBe(0);
    expect(events.at(-1)).toEqual({ type: "results", winner: 0 });
  });

  it("stops at the round limit, with the healthier player winning", () => {
    const m = new Match(2, rules({ maxRounds: 2 }));
    playTurn(m, hitHard);
    playTurn(m, hitNothing);
    expect(m.round).toBe(2);
    playTurn(m, hitNothing);
    playTurn(m, hitNothing);
    expect(m.phase).toBe("results");
    expect(m.winner).toBe(0);
  });

  it("draws at the round limit when health is level", () => {
    const m = new Match(2, rules({ maxRounds: 1 }));
    playTurn(m, hitNothing);
    playTurn(m, hitNothing);
    expect(m.winner).toBe("draw");
  });
});
