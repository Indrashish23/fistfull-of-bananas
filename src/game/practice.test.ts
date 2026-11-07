import { describe, expect, it } from "vitest";
import { RUSH, Rush, projectToScreen } from "./rush";
import { XRAYS_BY_ZONE } from "./rules";
import { nutsPoint } from "./tutorial";

const DT = 1 / 60;
const AWAY = { x: 0.1, y: 0.1 };

describe("the tutorial's practice lizard", () => {
  it("stands still in the street on his own, with no wave and nothing else about", () => {
    const g = new Rush({ practice: true });
    expect(g.drainEvents().some((e) => e.type === "wave")).toBe(false);
    expect(g.enemies).toHaveLength(1);
    const lizard = g.enemies[0]!;
    expect(lizard.z).toBe(RUSH.practiceZ);
    expect(lizard.weapon).toBeNull();
    for (let t = 0; t < 20; t += DT) g.step(DT, { aim: AWAY, fire: false, lean: 0, duck: false });
    expect(g.enemies).toEqual([lizard]);
    expect(lizard.z).toBe(RUSH.practiceZ);
    expect(lizard.x).toBe(0);
    expect(g.hearts).toBe(RUSH.hearts);
    expect(g.whiskey).toBeNull();
    expect(g.barrels).toHaveLength(0);
  });

  it("goes down to a nut shot, with its x-ray, and the game waits there", () => {
    const g = new Rush({ practice: true });
    const lizard = g.enemies[0]!;
    const aim = projectToScreen(lizard.x, nutsPoint(lizard.x).y, lizard.z, g.cameraX, g.cameraY)!;
    g.step(DT, { aim, fire: false, lean: 0, duck: false });
    g.step(DT, { aim, fire: true, lean: 0, duck: false });
    expect(g.enemies).toHaveLength(0);
    expect(g.cam?.zone).toBe("nuts");
    expect(XRAYS_BY_ZONE.nuts).toContain(g.cam?.xray);
    for (let t = 0; t < 10; t += DT) g.step(DT, { aim, fire: false, lean: 0, duck: false });
    expect(g.cam).toBeNull();
    expect(g.phase).toBe("rush");
  });
});
