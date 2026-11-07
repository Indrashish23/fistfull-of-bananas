import { describe, expect, it } from "vitest";
import { SHOUT_FIRE_LEVEL, SHOUT_GAP_SEC, SHOUT_REARM_LEVEL, ShoutTrigger } from "./shoutTrigger";

const DT = 1 / 60;

describe("shooting with a shout", () => {
  it("stays quiet below the level", () => {
    expect(new ShoutTrigger().update(SHOUT_FIRE_LEVEL - 0.01, DT)).toBe(false);
  });

  it("fires as a shout gets loud", () => {
    expect(new ShoutTrigger().update(SHOUT_FIRE_LEVEL, DT)).toBe(true);
  });

  it("fires once, however long the shout lasts", () => {
    const t = new ShoutTrigger();
    t.update(1, DT);
    for (let i = 0; i < 300; i++) expect(t.update(1, DT)).toBe(false);
  });

  it("fires again after the voice drops", () => {
    const t = new ShoutTrigger();
    t.update(1, DT);
    t.update(SHOUT_REARM_LEVEL, SHOUT_GAP_SEC + 0.1);
    expect(t.update(1, DT)).toBe(true);
  });

  it("needs a real drop, not just a dip", () => {
    const t = new ShoutTrigger();
    t.update(1, DT);
    t.update(SHOUT_REARM_LEVEL + 0.1, SHOUT_GAP_SEC + 0.1);
    expect(t.update(1, DT)).toBe(false);
  });

  it("can't fire again straight away, even after a drop", () => {
    const t = new ShoutTrigger();
    t.update(1, DT);
    t.update(0, DT);
    expect(t.update(1, DT)).toBe(false);
  });
});
