import { describe, expect, it } from "vitest";
import { ARM_HOME, ARM_REACH, MotionAim, cursorToScreen, smoothToward, type CursorControl } from "./motionAim";

const RANGE = [{ x: -1, y: -1 }, { x: 1, y: 1 }];

function reading(x: number, y: number, state = "active"): CursorControl[] {
  return [{ id: "right-hand-cursor", component: "vector2", state, value: { x, y }, range: RANGE }];
}

describe("mapping the arm to the screen", () => {
  it("puts a relaxed arm at the middle of the screen", () => {
    const s = cursorToScreen({ x: ARM_HOME.x, y: ARM_HOME.y }, RANGE)!;
    expect(s.x).toBeCloseTo(0.5);
    expect(s.y).toBeCloseTo(0.5);
  });

  it("reaches each edge at the arm's reach", () => {
    expect(cursorToScreen({ x: ARM_HOME.x - ARM_REACH, y: ARM_HOME.y }, RANGE)!.x).toBeCloseTo(0);
    expect(cursorToScreen({ x: ARM_HOME.x + ARM_REACH, y: ARM_HOME.y }, RANGE)!.x).toBeCloseTo(1);
  });

  it("uses each arm's own side as home", () => {
    expect(cursorToScreen({ x: -ARM_HOME.x, y: ARM_HOME.y }, RANGE, "left")!.x).toBeCloseTo(0.5);
  });

  it("moves down the screen as the hand lowers", () => {
    const low = cursorToScreen({ x: ARM_HOME.x, y: ARM_HOME.y + 0.1 }, RANGE)!;
    expect(low.y).toBeGreaterThan(0.5);
  });

  it("keeps wobble gentle: a small movement stays a small movement", () => {
    const a = cursorToScreen({ x: ARM_HOME.x, y: ARM_HOME.y }, RANGE)!;
    const b = cursorToScreen({ x: ARM_HOME.x + 0.03, y: ARM_HOME.y + 0.03 }, RANGE)!;
    expect(Math.abs(b.x - a.x)).toBeLessThan(0.05);
    expect(Math.abs(b.y - a.y)).toBeLessThan(0.05);
  });

  it("stays on screen", () => {
    const s = cursorToScreen({ x: 5, y: -5 }, RANGE)!;
    expect(s.x).toBe(1);
    expect(s.y).toBe(0);
  });

  it("rejects values it can't use", () => {
    expect(cursorToScreen(undefined, RANGE)).toBeNull();
    expect(cursorToScreen({ x: NaN, y: 0 }, RANGE)).toBeNull();
  });
});

describe("smoothing", () => {
  it("doesn't depend on the frame rate", () => {
    let fast = 0;
    for (let i = 0; i < 6; i++) fast = smoothToward(fast, 1, 1 / 60, 16);
    const slow = smoothToward(0, 1, 6 / 60, 16);
    expect(fast).toBeCloseTo(slow, 5);
  });
});

describe("motion aim", () => {
  const started = () => {
    const m = new MotionAim();
    m.attach(() => {});
    return m;
  };

  it("starts off, and isn't live until a reading arrives", () => {
    const m = new MotionAim();
    expect(m.state).toBe("off");
    expect(m.live).toBe(false);
    m.attach(() => {});
    expect(m.state).toBe("starting");
    expect(m.live).toBe(false);
  });

  it("goes live on an active reading, jumping straight to the hand", () => {
    const m = started();
    m.onControls(reading(ARM_HOME.x, ARM_HOME.y));
    expect(m.state).toBe("tracking");
    expect(m.position.x).toBeCloseTo(0.5);
  });

  it("reads only the chosen arm", () => {
    const m = started();
    m.arm = "left";
    m.onControls(reading(0.4, 0));
    expect(m.live).toBe(false);
    m.onControls([{ id: "left-hand-cursor", state: "active", value: { x: -0.6, y: 0.3 }, range: RANGE }]);
    expect(m.live).toBe(true);
  });

  it("eases toward later readings", () => {
    const m = started();
    m.onControls(reading(ARM_HOME.x, ARM_HOME.y));
    m.onControls(reading(ARM_HOME.x + 0.2, ARM_HOME.y));
    m.update(1 / 60);
    expect(m.position.x).toBeGreaterThan(0.5);
    expect(m.position.x).toBeLessThan(0.78);
  });

  it("ignores neutral and unavailable readings", () => {
    const m = started();
    m.onControls(reading(0.4, 0, "neutral"));
    m.onControls(reading(0.4, 0, "unavailable"));
    expect(m.live).toBe(false);
  });

  it("hands back to the mouse when tracking goes stale", () => {
    const m = started();
    m.onControls(reading(0.6, 0.3));
    expect(m.live).toBe(true);
    m.update(0.5);
    expect(m.live).toBe(false);
    expect(m.state).toBe("lost");
    m.onControls(reading(0.6, 0.3));
    expect(m.live).toBe(true);
  });

  it("closes its session when stopped", () => {
    let closed = 0;
    const m = new MotionAim();
    m.attach(() => { closed += 1; });
    m.stop();
    expect(closed).toBe(1);
    expect(m.state).toBe("off");
    expect(m.raw).toBeNull();
  });

  it("reports when the device can't do it", () => {
    const m = new MotionAim();
    m.markUnavailable();
    expect(m.state).toBe("unavailable");
    expect(m.on).toBe(false);
  });
});
