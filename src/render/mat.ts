// Just enough column-major matrix math for the renderer.

export type V3 = readonly [number, number, number];
export type M4 = Float32Array;

export function identity(out: M4 = new Float32Array(16)): M4 {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

/** out = a * b. `out` may be `a` or `b`. */
export function multiply(out: M4, a: M4, b: M4): M4 {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[c * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[c * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[c * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

export function frustum(l: number, r: number, b: number, t: number, n: number, f: number): M4 {
  const m = new Float32Array(16);
  m[0] = (2 * n) / (r - l);
  m[5] = (2 * n) / (t - b);
  m[8] = (r + l) / (r - l);
  m[9] = (t + b) / (t - b);
  m[10] = -(f + n) / (f - n);
  m[11] = -1;
  m[14] = (-2 * f * n) / (f - n);
  return m;
}

export function perspective(fovYRadians: number, aspect: number, n: number, f: number): M4 {
  const t = n * Math.tan(fovYRadians / 2);
  return frustum(-t * aspect, t * aspect, -t, t, n, f);
}

export function lookAt(eye: V3, target: V3, up: V3 = [0, 1, 0]): M4 {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx;
  m[4] = xy; m[5] = yy; m[6] = zy;
  m[8] = xz; m[9] = yz; m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

/** A matrix stack that reuses its storage, so rigs don't allocate every frame. */
export class Stack {
  private items: M4[] = [identity()];
  private depth = 0;
  private scratch = new Float32Array(16);

  get top(): M4 {
    return this.items[this.depth]!;
  }

  reset(): this {
    this.depth = 0;
    identity(this.items[0]!);
    return this;
  }

  push(): this {
    const next = this.depth + 1;
    if (!this.items[next]) this.items[next] = new Float32Array(16);
    this.items[next]!.set(this.items[this.depth]!);
    this.depth = next;
    return this;
  }

  pop(): this {
    this.depth -= 1;
    return this;
  }

  translate(x: number, y: number, z: number): this {
    const m = this.top;
    m[12] += m[0]! * x + m[4]! * y + m[8]! * z;
    m[13] += m[1]! * x + m[5]! * y + m[9]! * z;
    m[14] += m[2]! * x + m[6]! * y + m[10]! * z;
    return this;
  }

  scale(x: number, y: number = x, z: number = x): this {
    const m = this.top;
    for (let i = 0; i < 3; i++) {
      m[i] = m[i]! * x;
      m[4 + i] = m[4 + i]! * y;
      m[8 + i] = m[8 + i]! * z;
    }
    return this;
  }

  /** Post-multiplies a rotation that turns column `i` toward column `j`. */
  private rotate(r: number, i: 0 | 1 | 2, j: 0 | 1 | 2): this {
    const m = this.top;
    const c = Math.cos(r), s = Math.sin(r);
    const a = i * 4, b = j * 4;
    for (let k = 0; k < 3; k++) {
      const u = m[a + k]!, v = m[b + k]!;
      m[a + k] = u * c + v * s;
      m[b + k] = v * c - u * s;
    }
    return this;
  }

  rotX(r: number): this {
    return this.rotate(r, 1, 2);
  }

  rotY(r: number): this {
    return this.rotate(r, 2, 0);
  }

  rotZ(r: number): this {
    return this.rotate(r, 0, 1);
  }

  /** The world position of the current origin. */
  position(): [number, number, number] {
    const m = this.top;
    return [m[12]!, m[13]!, m[14]!];
  }

  /** Applies an arbitrary matrix. */
  apply(other: M4): this {
    multiply(this.scratch, this.top, other);
    this.top.set(this.scratch);
    return this;
  }
}
