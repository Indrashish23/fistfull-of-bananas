// Binds the Verlet ragdoll to the rigged monkey. Each bone follows the frame made by a pair of
// ragdoll points: its skinning matrix is that frame now, times the inverse of the same frame
// at rest. So the mesh moves rigidly with the physics, and nothing here knows about its shape.

type Mat4 = Float32Array;

export type Point3 = readonly [number, number, number];

export interface BonePoints {
  /** Point indices the bone runs between, or "torso" / "head" for those shared frames. */
  from: number | "torso" | "head";
  to?: number;
}

export interface SkinLayout {
  /** Ragdoll point indices. */
  pelvis: number; chest: number; head: number; shL: number; shR: number;
  rest: readonly Point3[];
  /** Bone name to the points that drive it. */
  bones: Readonly<Record<string, BonePoints>>;
  /** The hat hides by scaling down about this pivot, in bind space. */
  hatPivot: Point3;
}

function sub(a: Point3, b: Point3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** A column-major frame at `o`, with Y along `ay` and X as close to `ax` as it can be. */
export function frame(o: Point3, ax: Point3, ay: Point3, out: Mat4 = new Float32Array(16)): Mat4 {
  const yl = Math.hypot(ay[0], ay[1], ay[2]) || 1;
  const yx = ay[0] / yl, yy = ay[1] / yl, yz = ay[2] / yl;
  const dot = ax[0] * yx + ax[1] * yy + ax[2] * yz;
  let xx = ax[0] - yx * dot, xy = ax[1] - yy * dot, xz = ax[2] - yz * dot;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  out[0] = xx; out[1] = xy; out[2] = xz; out[3] = 0;
  out[4] = yx; out[5] = yy; out[6] = yz; out[7] = 0;
  out[8] = xy * yz - xz * yy; out[9] = xz * yx - xx * yz; out[10] = xx * yy - xy * yx; out[11] = 0;
  out[12] = o[0]; out[13] = o[1]; out[14] = o[2]; out[15] = 1;
  return out;
}

/** a * b, for affine matrices. */
export function compose(a: Mat4, b: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
  for (let c = 0; c < 4; c++) {
    const x = b[c * 4]!, y = b[c * 4 + 1]!, z = b[c * 4 + 2]!, w = b[c * 4 + 3]!;
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r]! * x + a[4 + r]! * y + a[8 + r]! * z + a[12 + r]! * w;
    }
  }
  return out;
}

/** Inverse of a rotation-plus-translation frame. */
export function invertFrame(m: Mat4): Mat4 {
  const out = new Float32Array(16);
  out[0] = m[0]!; out[1] = m[4]!; out[2] = m[8]!;
  out[4] = m[1]!; out[5] = m[5]!; out[6] = m[9]!;
  out[8] = m[2]!; out[9] = m[6]!; out[10] = m[10]!;
  out[12] = -(m[0]! * m[12]! + m[1]! * m[13]! + m[2]! * m[14]!);
  out[13] = -(m[4]! * m[12]! + m[5]! * m[13]! + m[6]! * m[14]!);
  out[14] = -(m[8]! * m[12]! + m[9]! * m[13]! + m[10]! * m[14]!);
  out[15] = 1;
  return out;
}

/** Scales about a pivot. Used to hide a shot-off hat. */
function scaledAbout(p: Point3, sx: number, sy: number, sz: number): Mat4 {
  const m = new Float32Array(16);
  m[0] = sx; m[5] = sy; m[10] = sz; m[15] = 1;
  m[12] = p[0] * (1 - sx); m[13] = p[1] * (1 - sy); m[14] = p[2] * (1 - sz);
  return m;
}

export class RagdollSkin {
  /** MAX_BONES x 16, ready for the skinned shader. */
  readonly bones: Float32Array;
  /** The head's skinning matrix this frame, for placing star eyes on the face. */
  head: Mat4 = new Float32Array(16);
  private readonly slots: { index: number; drive: BonePoints; restInverse: Mat4; name: string }[] = [];
  private readonly current = new Float32Array(16);

  constructor(
    private readonly layout: SkinLayout,
    jointIndex: ReadonlyMap<string, number>,
    boneCount: number,
  ) {
    this.bones = new Float32Array(boneCount * 16);
    const { rest } = layout;
    const right = sub(rest[layout.shR]!, rest[layout.shL]!);
    for (const [name, index] of jointIndex) {
      const drive = layout.bones[name];
      if (!drive) throw new Error(`Bone "${name}" isn't mapped to the ragdoll`);
      this.slots.push({ index, drive, name, restInverse: invertFrame(this.frameFor(drive, rest, right, [0, 0, 1])) });
    }
  }

  private frameFor(drive: BonePoints, pt: readonly Point3[], right: Point3, viewDir: Point3): Mat4 {
    const { layout } = this;
    if (drive.from === "torso") return frame(pt[layout.pelvis]!, right, sub(pt[layout.chest]!, pt[layout.pelvis]!));
    if (drive.from === "head") {
      // The head turns about the neck toward `viewDir`, keeping the neck's own lean.
      const up = sub(pt[layout.head]!, pt[layout.chest]!);
      const across: Point3 = [
        up[1] * viewDir[2] - up[2] * viewDir[1],
        up[2] * viewDir[0] - up[0] * viewDir[2],
        up[0] * viewDir[1] - up[1] * viewDir[0],
      ];
      return frame(pt[layout.head]!, across, up);
    }
    return frame(pt[drive.from]!, right, sub(pt[drive.to!]!, pt[drive.from]!));
  }

  /**
   * Poses every bone from the ragdoll.
   * @param lookToward A point the head turns to face, so a downed body's face stays in view.
   */
  update(points: readonly Point3[], lookToward: Point3, opts: { hatOff: boolean }): void {
    const { layout, bones, current } = this;
    const right = sub(points[layout.shR]!, points[layout.shL]!);
    const viewDir = sub(lookToward, points[layout.head]!);
    for (const slot of this.slots) {
      const posed = compose(this.frameFor(slot.drive, points, right, viewDir), slot.restInverse);
      let out = posed;
      if (slot.name === "hat" && opts.hatOff) {
        out = compose(posed, scaledAbout(layout.hatPivot, 0.0001, 0.0001, 0.0001), current);
      }
      if (slot.name === "head") this.head = posed;
      bones.set(out, slot.index * 16);
    }
  }
}
