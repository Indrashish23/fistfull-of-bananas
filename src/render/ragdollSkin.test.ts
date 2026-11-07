import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MONKEY_LAYOUT, P, REST, Ragdoll } from "./ragdoll";
import { RagdollSkin, compose, frame, invertFrame } from "./ragdollSkin";

const JOINTS = new Map(Object.keys(MONKEY_LAYOUT.bones).map((name, i) => [name, i]));
const BONES = JOINTS.size;

function apply(m: Float32Array, p: readonly [number, number, number]): [number, number, number] {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}

function boneMatrix(skin: RagdollSkin, name: string): Float32Array {
  const i = JOINTS.get(name)!;
  return skin.bones.slice(i * 16, i * 16 + 16);
}

function closeTo(a: readonly number[], b: readonly number[], digits = 4): void {
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));
}

const CAMERA = [0, 1, 30] as const;

describe("binding the ragdoll to the rig", () => {
  it("covers every bone in the monkey model", () => {
    const glb = readFileSync("lookdev/assets/monkey.glb");
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
    const names: string[] = json.skins[0].joints.map((i: number) => json.nodes[i].name);
    for (const name of names) expect(JOINTS.has(name), name).toBe(true);
  });

  it("leaves the mesh exactly where it is when the body is at rest", () => {
    const skin = new RagdollSkin(MONKEY_LAYOUT, JOINTS, BONES);
    skin.update(REST, [0, REST[P.head]![1], 30], { hatOff: false });
    for (const name of JOINTS.keys()) {
      closeTo(apply(boneMatrix(skin, name), [0.3, 1.1, 0.2]), [0.3, 1.1, 0.2]);
    }
  });

  it("moves every bone with the body when the whole body moves", () => {
    const moved = REST.map((p) => [p[0] + 2, p[1], p[2] - 5] as [number, number, number]);
    const skin = new RagdollSkin(MONKEY_LAYOUT, JOINTS, BONES);
    skin.update(moved, [2, moved[P.head]![1], 25], { hatOff: false });
    for (const name of ["root", "chest", "head", "arm.L", "shin.R"]) {
      closeTo(apply(boneMatrix(skin, name), [0, 1, 0]), [2, 1, -5]);
    }
  });

  it("carries a limb's bind position to its ragdoll point", () => {
    const rag = new Ragdoll(0, 0, 1);
    rag.hit({ zone: "body", landing: { x: 0, y: 1, z: 0 }, power: 1 });
    rag.settle(1.5);
    const skin = new RagdollSkin(MONKEY_LAYOUT, JOINTS, BONES);
    skin.update(rag.points, CAMERA, { hatOff: false });
    closeTo(apply(boneMatrix(skin, "shin.L"), REST[P.knL]!), rag.points[P.knL]!, 3);
    closeTo(apply(boneMatrix(skin, "arm.R"), REST[P.shR]!), rag.points[P.shR]!, 3);
    closeTo(apply(boneMatrix(skin, "root"), REST[P.pelvis]!), rag.points[P.pelvis]!, 3);
  });

  it("doesn't stretch or squash the mesh", () => {
    const rag = new Ragdoll(0, 0, 1);
    rag.hit({ zone: "head", landing: { x: 0.2, y: 1.8, z: 0 }, power: 1 });
    rag.settle(2);
    const skin = new RagdollSkin(MONKEY_LAYOUT, JOINTS, BONES);
    skin.update(rag.points, CAMERA, { hatOff: false });
    const m = boneMatrix(skin, "thigh.R");
    expect(Math.hypot(m[0]!, m[1]!, m[2]!)).toBeCloseTo(1, 4);
    expect(Math.hypot(m[4]!, m[5]!, m[6]!)).toBeCloseTo(1, 4);
    expect(Math.hypot(m[8]!, m[9]!, m[10]!)).toBeCloseTo(1, 4);
  });

  it("turns the face toward the viewer after a faceplant", () => {
    const rag = new Ragdoll(0, 0, 1);
    rag.hit({ zone: "nuts", landing: { x: 0, y: 0.62, z: 0 }, power: 1 });
    rag.settle(3);
    const skin = new RagdollSkin(MONKEY_LAYOUT, JOINTS, BONES);
    const eye: [number, number, number] = [6, 3, rag.points[P.head]![2]];
    skin.update(rag.points, eye, { hatOff: false });
    const head = boneMatrix(skin, "head");
    const face = [head[8]!, head[9]!, head[10]!];
    const at = rag.points[P.head]!;
    const to = [eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]];
    const l = Math.hypot(to[0]!, to[1]!, to[2]!);
    expect((face[0]! * to[0]! + face[1]! * to[1]! + face[2]! * to[2]!) / l).toBeGreaterThan(0.2);
  });

  it("makes the hat vanish when it comes off, and only then", () => {
    const skin = new RagdollSkin(MONKEY_LAYOUT, JOINTS, BONES);
    skin.update(REST, [0, 1.8, 30], { hatOff: false });
    expect(Math.abs(boneMatrix(skin, "hat")[0]!)).toBeGreaterThan(0.9);
    skin.update(REST, [0, 1.8, 30], { hatOff: true });
    expect(Math.abs(boneMatrix(skin, "hat")[0]!)).toBeLessThan(0.001);
    expect(Math.abs(boneMatrix(skin, "head")[0]!)).toBeGreaterThan(0.9);
  });
});

describe("frames", () => {
  it("inverts cleanly", () => {
    const f = frame([1, 2, 3], [1, 0.2, 0], [0.1, 1, 0.3]);
    closeTo(apply(compose(f, invertFrame(f)), [4, 5, 6]), [4, 5, 6]);
  });

  it("keeps Y on the requested axis", () => {
    const f = frame([0, 0, 0], [1, 0, 0], [0, 0, 2]);
    closeTo([f[4]!, f[5]!, f[6]!], [0, 0, 1]);
  });
});
