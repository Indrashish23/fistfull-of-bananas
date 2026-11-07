// A small glTF 2.0 (GLB) reader for skinned characters: geometry, up to 4 bone weights per
// vertex, skeleton and clips. Materials come through by name so the page can paint them, which
// lets one model become several differently coloured characters.

import { identity, multiply } from "./gl";
import type { Mat4 } from "./gl";
import type { RGB } from "./mesh";

export const SKIN_VERTEX_BYTES = 28;
export const MAX_BONES = 24;

export interface Paint {
  color: RGB;
  unlit?: boolean;
}

interface Channel {
  node: number;
  path: "translation" | "rotation" | "scale";
  times: Float32Array;
  values: Float32Array;
}

export interface Clip {
  name: string;
  duration: number;
  channels: Channel[];
}

interface Trs {
  t: Float32Array;
  r: Float32Array;
  s: Float32Array;
}

export class Skeleton {
  nodeCount = 0;
  parents: number[] = [];
  order: number[] = [];
  rest: Trs[] = [];
  joints: number[] = [];
  jointIndex = new Map<string, number>();
  ibm: Float32Array = new Float32Array(0);
  clips = new Map<string, Clip>();
  nodeByName = new Map<string, number>();
}

export interface ParsedGlb {
  json: any;
  bin: ArrayBuffer;
}

export function parseGlb(buffer: ArrayBuffer): ParsedGlb {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB file");
  let o = 12;
  let json: any = null;
  let bin: ArrayBuffer | null = null;
  while (o < buffer.byteLength) {
    const len = view.getUint32(o, true);
    const type = view.getUint32(o + 4, true);
    const body = buffer.slice(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === 0x004e4942) bin = body;
    o += 8 + len;
  }
  if (!json || !bin) throw new Error("GLB is missing a chunk");
  return { json, bin };
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readAccessor(g: ParsedGlb, index: number): { data: Float32Array | Uint16Array | Uint8Array | Uint32Array; size: number; count: number; norm: boolean } {
  const a = g.json.accessors[index];
  const bv = g.json.bufferViews[a.bufferView];
  const offset = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const size = COMPONENTS[a.type];
  const n = a.count * size;
  let data: Float32Array | Uint16Array | Uint8Array | Uint32Array;
  switch (a.componentType) {
    case 5126:
      data = new Float32Array(g.bin.slice(offset, offset + n * 4));
      break;
    case 5123:
      data = new Uint16Array(g.bin.slice(offset, offset + n * 2));
      break;
    case 5121:
      data = new Uint8Array(g.bin.slice(offset, offset + n));
      break;
    case 5125:
      data = new Uint32Array(g.bin.slice(offset, offset + n * 4));
      break;
    default:
      throw new Error(`Unsupported component type ${a.componentType}`);
  }
  return { data, size, count: a.count, norm: !!a.normalized };
}

export function readSkeleton(g: ParsedGlb): Skeleton {
  const s = new Skeleton();
  const nodes = g.json.nodes as any[];
  s.nodeCount = nodes.length;
  s.parents = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => {
    (n.children ?? []).forEach((c: number) => (s.parents[c] = i));
    s.nodeByName.set(n.name, i);
    s.rest.push({
      t: new Float32Array(n.translation ?? [0, 0, 0]),
      r: new Float32Array(n.rotation ?? [0, 0, 0, 1]),
      s: new Float32Array(n.scale ?? [1, 1, 1]),
    });
  });
  // Parents before children.
  const visited = new Array(nodes.length).fill(false);
  const visit = (i: number) => {
    if (visited[i]) return;
    if (s.parents[i] >= 0) visit(s.parents[i]);
    visited[i] = true;
    s.order.push(i);
  };
  nodes.forEach((_, i) => visit(i));

  const skin = g.json.skins[0];
  s.joints = skin.joints;
  skin.joints.forEach((n: number, i: number) => s.jointIndex.set(nodes[n].name, i));
  s.ibm = readAccessor(g, skin.inverseBindMatrices).data as Float32Array;
  if (s.joints.length > MAX_BONES) throw new Error(`${s.joints.length} bones, limit ${MAX_BONES}`);

  for (const anim of g.json.animations ?? []) {
    const channels: Channel[] = [];
    let duration = 0;
    let start = Infinity;
    for (const c of anim.channels) {
      const path = c.target.path;
      if (path !== "translation" && path !== "rotation" && path !== "scale") continue;
      const sampler = anim.samplers[c.sampler];
      const times = readAccessor(g, sampler.input).data as Float32Array;
      const values = readAccessor(g, sampler.output).data as Float32Array;
      start = Math.min(start, times[0]);
      channels.push({ node: c.target.node, path, times, values });
    }
    for (const ch of channels) {
      const shifted = new Float32Array(ch.times.length);
      for (let i = 0; i < shifted.length; i++) shifted[i] = ch.times[i] - start;
      ch.times = shifted;
      duration = Math.max(duration, shifted[shifted.length - 1]);
    }
    s.clips.set(anim.name, { name: anim.name, duration, channels });
  }
  return s;
}

/** Interleaves the mesh, painted by material name. */
export function readSkinnedMesh(g: ParsedGlb, paint: (material: string) => Paint, meshName?: string): { data: ArrayBuffer; count: number; triangles: number } {
  const mesh = meshName === undefined ? g.json.meshes[0] : (g.json.meshes as any[]).find((m) => m.name === meshName);
  if (!mesh) throw new Error(`The model has no mesh called "${meshName}"`);
  const prims = mesh.primitives as any[];
  let count = 0;
  for (const p of prims) count += g.json.accessors[p.indices].count;
  const data = new ArrayBuffer(count * SKIN_VERTEX_BYTES);
  const view = new DataView(data);
  let o = 0;
  const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (const p of prims) {
    const matName = g.json.materials[p.material]?.name ?? "";
    const pt = paint(matName);
    const pos = readAccessor(g, p.attributes.POSITION).data;
    const nor = readAccessor(g, p.attributes.NORMAL).data;
    const jAcc = readAccessor(g, p.attributes.JOINTS_0);
    const wAcc = readAccessor(g, p.attributes.WEIGHTS_0);
    const idx = readAccessor(g, p.indices).data;
    const wScale = wAcc.data instanceof Uint8Array ? 1 / 255 : wAcc.data instanceof Uint16Array ? 1 / 65535 : 1;
    for (let k = 0; k < idx.length; k++) {
      const v = idx[k];
      view.setFloat32(o, pos[v * 3], true);
      view.setFloat32(o + 4, pos[v * 3 + 1], true);
      view.setFloat32(o + 8, pos[v * 3 + 2], true);
      view.setInt8(o + 12, Math.round(nor[v * 3] * 127));
      view.setInt8(o + 13, Math.round(nor[v * 3 + 1] * 127));
      view.setInt8(o + 14, Math.round(nor[v * 3 + 2] * 127));
      view.setInt8(o + 15, pt.unlit ? 127 : 0);
      view.setUint8(o + 16, byte(pt.color[0]));
      view.setUint8(o + 17, byte(pt.color[1]));
      view.setUint8(o + 18, byte(pt.color[2]));
      view.setUint8(o + 19, 255);
      for (let j = 0; j < 4; j++) {
        view.setUint8(o + 20 + j, jAcc.data[v * 4 + j]);
        view.setUint8(o + 24 + j, byte(wAcc.data[v * 4 + j] * wScale));
      }
      o += SKIN_VERTEX_BYTES;
    }
  }
  return { data, count, triangles: count / 3 };
}

function sampleInto(ch: Channel, t: number, out: Float32Array) {
  const size = ch.path === "rotation" ? 4 : 3;
  const times = ch.times;
  const last = times.length - 1;
  if (t <= times[0]) {
    for (let i = 0; i < size; i++) out[i] = ch.values[i];
    return;
  }
  if (t >= times[last]) {
    for (let i = 0; i < size; i++) out[i] = ch.values[last * size + i];
    return;
  }
  // Keys are evenly spaced because they were baked, so the index is a direct lookup.
  const f = (t / times[last]) * last;
  const a = Math.min(last - 1, Math.floor(f));
  const k = f - a;
  let flip = 1;
  if (size === 4) {
    let d = 0;
    for (let i = 0; i < 4; i++) d += ch.values[a * 4 + i] * ch.values[(a + 1) * 4 + i];
    if (d < 0) flip = -1;
  }
  for (let i = 0; i < size; i++) {
    out[i] = ch.values[a * size + i] * (1 - k) + ch.values[(a + 1) * size + i] * flip * k;
  }
  if (size === 4) normalize4(out);
}

function normalize4(q: Float32Array) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= l;
  q[1] /= l;
  q[2] /= l;
  q[3] /= l;
}

function compose(t: Float32Array, q: Float32Array, s: Float32Array): Mat4 {
  const m = new Float32Array(16);
  const [x, y, z, w] = q;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  m[0] = (1 - 2 * (yy + zz)) * s[0];
  m[1] = 2 * (xy + wz) * s[0];
  m[2] = 2 * (xz - wy) * s[0];
  m[4] = 2 * (xy - wz) * s[1];
  m[5] = (1 - 2 * (xx + zz)) * s[1];
  m[6] = 2 * (yz + wx) * s[1];
  m[8] = 2 * (xz + wy) * s[2];
  m[9] = 2 * (yz - wx) * s[2];
  m[10] = (1 - 2 * (xx + yy)) * s[2];
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  m[15] = 1;
  return m;
}

/** Turns a bone so its length points along a world direction, under a parent with this world matrix. */
function aimLocal(parent: Mat4, d: [number, number, number], out: Float32Array) {
  const dot = (o: number) => parent[o] * d[0] + parent[o + 1] * d[1] + parent[o + 2] * d[2];
  const n = Math.hypot(dot(0), dot(4), dot(8)) || 1;
  const x = dot(0) / n;
  const y = dot(4) / n;
  const z = dot(8) / n;
  // The shortest turn from the bone's own +y to that direction.
  out[0] = z;
  out[1] = 0;
  out[2] = -x;
  out[3] = 1 + y;
  normalize4(out);
}

/** One animated instance of a skeleton: plays a clip and crossfades into the next one. */
export class Rig {
  bones: Float32Array;
  private skel: Skeleton;
  private cur: Trs[];
  private prev: Trs[];
  private tmp = new Float32Array(4);
  private clip: Clip | null = null;
  private clipStart = 0;
  private loop = true;
  private fade = 0;
  private fadeStart = 0;
  private world: Mat4[];
  /** Set a node's local scale after the clip, for things like blinking. */
  scaleOverride = new Map<number, [number, number, number]>();
  private aims = new Map<number, [number, number, number]>();
  private layer: { nodes: Set<number>; low: Clip; high: Clip; mix: number; weight: number } | null = null;
  private tmpT = new Float32Array(3);
  private tmpR = new Float32Array(4);
  clipName = "";

  constructor(skel: Skeleton) {
    this.skel = skel;
    this.bones = new Float32Array(MAX_BONES * 16);
    const clone = () =>
      skel.rest.map((r) => ({ t: r.t.slice(), r: r.r.slice(), s: r.s.slice() }));
    this.cur = clone();
    this.prev = clone();
    this.world = skel.rest.map(() => identity());
  }

  /** Holds a bone pointing along a world direction after the clip, for a one-off pose. */
  aimBone(name: string, direction: [number, number, number]) {
    this.aims.set(this.skel.nodeByName.get(name)!, direction);
  }

  /** Switches clip with a crossfade. Offset keeps out-of-step characters out of step. */
  play(name: string, now: number, opts: { fade?: number; loop?: boolean; offset?: number } = {}) {
    if (this.clipName === name) return;
    const clip = this.skel.clips.get(name);
    if (!clip) throw new Error(`No clip named ${name}`);
    this.prev = this.cur.map((r) => ({ t: r.t.slice(), r: r.r.slice(), s: r.s.slice() }));
    this.clip = clip;
    this.clipName = name;
    this.clipStart = now - (opts.offset ?? 0);
    this.loop = opts.loop ?? true;
    this.fade = opts.fade ?? 0.3;
    this.fadeStart = now;
  }

  /**
   * Layers a pose over chosen bones only, whatever clip is playing, so a monkey can carry a sign
   * and still do its act with the rest of its body. high blends low to high; weight fades it in.
   */
  setLayer(bones: string[], low: string, high: string, mix: number, weight: number) {
    const a = this.skel.clips.get(low);
    const b = this.skel.clips.get(high);
    if (!a || !b) throw new Error(`No clips named ${low} / ${high}`);
    const nodes = new Set(bones.map((n) => this.skel.nodeByName.get(n)!));
    this.layer = { nodes, low: a, high: b, mix, weight };
  }

  private applyLayer(now: number) {
    const L = this.layer;
    if (!L || L.weight <= 0) return;
    const { tmpT, tmpR, tmp } = this;
    const blendIn = (clip: Clip, k: number) => {
      if (k <= 0) return;
      const t = now % clip.duration;
      for (const ch of clip.channels) {
        if (ch.path === "scale" || !L.nodes.has(ch.node)) continue;
        const target = this.cur[ch.node];
        if (ch.path === "translation") {
          sampleInto(ch, t, tmpT);
          for (let j = 0; j < 3; j++) target.t[j] += (tmpT[j] - target.t[j]) * k;
        } else {
          sampleInto(ch, t, tmpR);
          let d = 0;
          for (let j = 0; j < 4; j++) d += tmpR[j] * target.r[j];
          const flip = d < 0 ? -1 : 1;
          for (let j = 0; j < 4; j++) tmp[j] = target.r[j] + (tmpR[j] * flip - target.r[j]) * k;
          normalize4(tmp);
          target.r.set(tmp);
        }
      }
    };
    blendIn(L.low, L.weight);
    blendIn(L.high, L.weight * L.mix);
  }

  /** 0..1 through a one-shot clip. */
  progress(now: number) {
    if (!this.clip) return 1;
    return Math.min(1, (now - this.clipStart) / this.clip.duration);
  }

  update(now: number) {
    const { skel, cur, prev, tmp } = this;
    for (let i = 0; i < skel.nodeCount; i++) {
      cur[i].t.set(skel.rest[i].t);
      cur[i].r.set(skel.rest[i].r);
      cur[i].s.set(skel.rest[i].s);
    }
    if (this.clip) {
      let t = now - this.clipStart;
      t = this.loop ? t % this.clip.duration : Math.min(t, this.clip.duration);
      for (const ch of this.clip.channels) {
        if (ch.path === "scale") continue;
        const target = cur[ch.node];
        sampleInto(ch, t, ch.path === "translation" ? target.t : target.r);
      }
    }
    const w = this.fade > 0 ? Math.min(1, (now - this.fadeStart) / this.fade) : 1;
    if (w < 1) {
      const k = w * w * (3 - 2 * w);
      for (let i = 0; i < skel.nodeCount; i++) {
        const c = cur[i];
        const p = prev[i];
        for (let j = 0; j < 3; j++) c.t[j] = p.t[j] + (c.t[j] - p.t[j]) * k;
        let d = 0;
        for (let j = 0; j < 4; j++) d += p.r[j] * c.r[j];
        const flip = d < 0 ? -1 : 1;
        for (let j = 0; j < 4; j++) tmp[j] = p.r[j] * flip + (c.r[j] - p.r[j] * flip) * k;
        normalize4(tmp);
        c.r.set(tmp);
      }
    }
    this.applyLayer(now);
    for (const [node, sc] of this.scaleOverride) cur[node].s.set(sc);
    for (const i of skel.order) {
      const parent = skel.parents[i];
      const aim = this.aims.get(i);
      if (aim && parent >= 0) aimLocal(this.world[parent], aim, cur[i].r);
      const local = compose(cur[i].t, cur[i].r, cur[i].s);
      this.world[i] = parent < 0 ? local : multiply(this.world[parent], local);
    }
    skel.joints.forEach((node, j) => {
      const ibm = skel.ibm.subarray(j * 16, j * 16 + 16) as unknown as Mat4;
      this.bones.set(multiply(this.world[node], ibm), j * 16);
    });
  }

  /** Where a bone is in the model's space, and which way it faces. */
  boneWorld(name: string): Mat4 {
    return this.world[this.skel.nodeByName.get(name)!].slice() as Mat4;
  }

  /** A bone's skinning matrix: moves points in bind space to where the bone has put them. */
  boneMatrix(name: string): Mat4 {
    const j = this.skel.jointIndex.get(name);
    if (j === undefined) throw new Error(`No bone named ${name}`);
    return this.bones.slice(j * 16, j * 16 + 16) as Mat4;
  }
}
