// A look-dev view of rush mode's art, on the game's real renderer: open the page with ?rush=1. A row of
// lizards doing each clip with its weapon, the flame suit throwing, and barrels upright and on their
// sides, drawn both ways the game could draw them.

import { flameLizardBuffer, FLAME_LIZARD, lizardBuffer, LIZARDS } from "./character";
import { buildLizardFaceSheet, lizardEye, lizardMouth } from "./faces";
import { lookAt, multiply, perspective, rotationY, rotationZ, translation } from "./gl";
import type { Mat4, V3 } from "./gl";
import { Rig } from "./gltf";
import type { ParsedGlb, Skeleton } from "./gltf";
import { hex } from "./mesh";
import { heldMatrix, loadPropBuilders } from "./props";
import type { PropName } from "./props";
import type { GpuMesh, LookState, MovingThing, Renderer } from "./renderer";

interface Actor {
  x: number;
  clip: string;
  mesh: GpuMesh;
  iris: string;
  prop?: PropName;
  rig: Rig;
}

export class RushCheck {
  /** Holds every clip at this time, when set. */
  hold: number | null = null;
  /** Where the camera looks from: wide for TV distance, or close on one x. */
  view: { eye: V3; at: V3; fov: number } = { eye: [-1, 2.6, 22], at: [-1, 1.5, 0], fov: 34 };
  private face: GpuMesh;
  private actors: Actor[];

  private constructor(
    private renderer: Renderer,
    private look: LookState,
    private props: Record<PropName, GpuMesh>,
    glb: ParsedGlb,
    skeleton: Skeleton,
  ) {
    this.face = renderer.uploadMesh(buildLizardFaceSheet());
    document.getElementById("menu")?.setAttribute("hidden", "");
    const plain = lizardBuffer(glb, LIZARDS[0]);
    const fire = flameLizardBuffer(glb);
    const plainMesh = renderer.uploadSkinned(plain.data, plain.count);
    const fireMesh = renderer.uploadSkinned(fire.data, fire.count);
    const actor = (x: number, clip: string, mesh: GpuMesh, iris: string, prop?: PropName): Actor => ({ x, clip, mesh, iris, prop, rig: new Rig(skeleton) });
    this.actors = [
      actor(-6, "throw", fireMesh, FLAME_LIZARD.iris, "molotov"),
      actor(-3.6, "run", fireMesh, FLAME_LIZARD.iris),
      actor(-1.2, "run_weapon", plainMesh, LIZARDS[0].iris, "machete"),
      actor(1.2, "swing", plainMesh, LIZARDS[0].iris, "axe"),
      actor(3.6, "run_weapon", plainMesh, LIZARDS[0].iris, "club"),
    ];
  }

  static async create(renderer: Renderer, look: LookState, glb: ParsedGlb, skeleton: Skeleton) {
    const builders = await loadPropBuilders();
    const props = Object.fromEntries(Object.entries(builders).map(([k, b]) => [k, renderer.uploadMesh(b)])) as Record<PropName, GpuMesh>;
    return new RushCheck(renderer, look, props, glb, skeleton);
  }

  frame(now: number, W: number, H: number) {
    const t = this.hold ?? now;
    const things: MovingThing[] = [];
    for (const a of this.actors) {
      const model: Mat4 = multiply(translation(a.x, 0, 0), rotationY(0.5));
      a.rig.play(a.clip, 0, { fade: 0 });
      a.rig.update(t);
      things.push({
        mesh: a.mesh,
        model,
        character: true,
        shadow: true,
        groundY: 0,
        bones: a.rig.bones,
        face: { mesh: this.face, model: multiply(model, a.rig.boneMatrix("head")), eye: lizardEye("angry"), mouth: lizardMouth("smile"), skin: hex(a.iris), plate: "blank" },
      });
      if (a.prop) things.push({ mesh: this.props[a.prop], model: heldMatrix(model, a.rig), character: true, shadow: false, toon: true });
    }
    // A barrel upright and one on its side rolling, as world props, then one more drawn in toon.
    things.push({ mesh: this.props.barrel, model: translation(-2.2, 0, 7), character: false, shadow: true });
    const rolling = multiply(multiply(translation(0.4, 0.6, 7.4), rotationY(0.5)), multiply(rotationZ(Math.PI / 2), multiply(rotationY(t * 2), translation(0, -0.7, 0))));
    things.push({ mesh: this.props.barrel, model: rolling, character: false, shadow: true });
    things.push({ mesh: this.props.barrel, model: translation(3, 0, 7), character: true, shadow: true, toon: true, groundY: 0 });
    const { eye, at, fov } = this.view;
    this.renderer.render(this.look, { eye, view: lookAt(eye, at), proj: perspective(fov, W / H, 0.5, 3000) }, [0, 0, W, H], things, { gray: false, time: t });
  }
}
