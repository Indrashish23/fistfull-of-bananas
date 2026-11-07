# The two boss outlaws, built in the same style as the home screen's lizards. Run from the repo root:
#   "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python lookdev/blender/build_bosses.py
#
# Each boss: lofted head, shirt, baggy trousers, claws and a tail, plus a hat and weapon, on its own
# skeleton. Faces are flat art, drawn on a sheet fitted to each head (see bake_face). Poses are written
# as where things go in the world (feet, hands, barrel), solved by Poser below. Source is also used by
# tripo_flat.py, for generated models.
#
# Writes assets/bosses/<id>.glb, <id>.face.json and <id>.blend, in game coordinates: x right, y up, z
# toward the viewer, feet at y = 0. Clips: idle (close-up stance), pose, fire. Big Gat also has steal.
#
# Environment: BOSS_ONLY=gator,snake builds a subset. BOSS_PREVIEW=<dir> renders pose previews there.

import colorsys
import json
import math
import os
import re
import sys

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_rigs  # noqa: E402
from build_rigs import G, LowPart, OUT, Part, apply_pose, bake_clip, export, loft, make_armature, make_mesh, soften_in_blender, wind_outward  # noqa: E402

DIR = os.path.join(OUT, "bosses")
SRC = os.path.join(DIR, "source")
PREVIEW = os.environ.get("BOSS_PREVIEW", "")

GAME_TO_BLENDER = build_rigs.GAME_TO_BLENDER


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_rigs.MATERIALS.clear()
    bpy.context.scene.render.fps = build_rigs.FPS


# ------------------------------------------------------------------------------- source import


class Source:
    """A CC0 model as a welded Part in game coordinates, plus its bones' rest positions."""

    def __init__(self, file, scale, forward, classify, group_map=None, morphs=(), edit=None, texture=None, soft=(), blur=7):
        self.texture = texture
        self.blur = blur
        self.soft = soft
        self.scale = scale
        self.forward = forward
        self.morphs = morphs
        self.edit = edit
        self.part = Part()
        self.joints = {}
        self.tails = {}
        self.dominant = []
        if file.lower().endswith(".fbx"):
            bpy.ops.import_scene.fbx(filepath=os.path.join(SRC, file))
        else:
            bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, file))
        for o in list(bpy.data.objects):
            if o.name.startswith("Icosphere"):
                bpy.data.objects.remove(o)
        mesh = [o for o in bpy.data.objects if o.type == "MESH"][0]
        arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
        if arm:
            for b in arm.data.bones:
                self.joints[b.name] = self.to_game(arm.matrix_world @ b.head_local, {b.name: 1.0})
                self.tails[b.name] = self.to_game(arm.matrix_world @ b.tail_local, {b.name: 1.0})
        self._read(mesh, classify, group_map)
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o)
        for a in list(bpy.data.actions):
            bpy.data.actions.remove(a)
        for x in list(bpy.data.armatures):
            bpy.data.armatures.remove(x)

    def to_game(self, w, weights=None):
        s = self.scale
        p = Vector((w[0] * s, w[2] * s, -w[1] * s)) if self.forward == "-y" else Vector((w[1] * s, w[2] * s, w[0] * s))
        for (bones, origin, k) in self.morphs:
            amt = sum((weights or {}).get(b, 0.0) for b in bones)
            if amt > 0:
                o = Vector(origin)
                d = p - o
                q = o + Vector((d[0] * k[0], d[1] * k[1], d[2] * k[2]))
                p = p + (q - p) * min(1.0, amt)
        if self.edit:
            p = Vector(self.edit(p))
        return p

    def _read(self, mesh, classify, group_map):
        names = {g.index: g.name for g in mesh.vertex_groups}
        tex = None
        uv = None
        mat0 = mesh.data.materials[0] if mesh.data.materials else None
        if mat0 and mat0.use_nodes:
            for n in mat0.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image:
                    tex = tex or n.image
                if n.type == "BSDF_PRINCIPLED" and n.inputs["Base Color"].links:
                    linked = n.inputs["Base Color"].links[0].from_node
                    if linked.type == "TEX_IMAGE" and linked.image:
                        tex = linked.image
                        break
        px = None
        if self.texture and self.texture != "embedded":
            tex = bpy.data.images.load(os.path.join(SRC, self.texture))
        if tex is not None and len(mesh.data.materials) == 1:
            px = list(tex.pixels)
            uv = mesh.data.uv_layers.active.data
        W, H = tex.size if tex is not None else (0, 0)
        part = self.part
        index = {}
        remap = {}
        raw = []
        centres = []
        sums = []
        for v in mesh.data.vertices:
            src = {names[g.group]: g.weight for g in v.groups if g.weight > 0.001}
            # Source weights need not sum to 1, but morphs need the real share of each bone.
            share = sum(src.values())
            sums.append(share)
            if share > 0:
                src = {b: w / share for b, w in src.items()}
            p = self.to_game(mesh.matrix_world @ v.co, src)
            key = (round(p[0], 3), round(p[1], 3), round(p[2], 3))
            weights = {}
            for b, w in src.items():
                t = group_map(b) if group_map else b
                if t:
                    weights[t] = weights.get(t, 0.0) + w
            total = sum(weights.values())
            weights = {b: w / total for b, w in weights.items()} if total > 0 else {}
            if key in index:
                remap[v.index] = index[key]
            else:
                i = part._vert(tuple(p), weights)
                index[key] = i
                remap[v.index] = i
                self.dominant.append(max(src, key=src.get) if src else "")
        if sums:
            print("WEIGHT SUMS", "min", round(min(sums), 3), "max", round(max(sums), 3), "off by over 2%:", sum(1 for x in sums if abs(x - 1) > 0.02), "of", len(sums))
        for poly in mesh.data.polygons:
            f = []
            for i in poly.vertices:
                r = remap[i]
                if r not in f:
                    f.append(r)
            if len(f) < 3:
                continue
            rgb = None
            if px is not None:
                u = sum(uv[i].uv[0] for i in poly.loop_indices) / poly.loop_total
                t = sum(uv[i].uv[1] for i in poly.loop_indices) / poly.loop_total
                spots = [(u, t)]
                if self.texture:
                    # Painted grime is noisy: average several spots across the face.
                    spots += [((uv[i].uv[0] + u) / 2, (uv[i].uv[1] + t) / 2) for i in poly.loop_indices]
                total = [0.0, 0.0, 0.0]
                for (a, b) in spots:
                    x = int(a % 1 * W) % W
                    y = int(b % 1 * H) % H
                    o = (y * W + x) * 4
                    for k in range(3):
                        total[k] += px[o + k]
                rgb = tuple(q / len(spots) for q in total)
            slot = mesh.data.materials[poly.material_index].name if mesh.data.materials else ""
            c = Vector((0, 0, 0))
            for i in f:
                c += Vector(part.v[i])
            part.f.append(tuple(f))
            if self.texture:
                raw.append(rgb)
                centres.append(c / len(f))
                part.m.append("")
            else:
                part.m.append(classify(slot, c / len(f), rgb))
        if self.texture:
            self._paint(classify, raw, centres)
        if self.soft:
            self._tidy()

    def _neighbours(self):
        edges = {}
        for n, f in enumerate(self.part.f):
            for a, b in zip(f, f[1:] + f[:1]):
                edges.setdefault((min(a, b), max(a, b)), []).append(n)
        near = [[] for _ in self.part.f]
        for faces in edges.values():
            for a in faces:
                for b in faces:
                    if a != b:
                        near[a].append(b)
        return near

    def _paint(self, classify, raw, centres):
        """Painted grime would make every face a different colour. So colour is blurred across the
        surface first, then read: pieces come out as clean, whole regions."""
        part = self.part
        near = self._neighbours()
        # Connected pieces: a tooth, a shoulder pad, a leg.
        size = [0] * len(part.f)
        seen = [False] * len(part.f)
        for n in range(len(part.f)):
            if seen[n]:
                continue
            stack = [n]
            seen[n] = True
            members = []
            while stack:
                q = stack.pop()
                members.append(q)
                for k in near[q]:
                    if not seen[k]:
                        seen[k] = True
                        stack.append(k)
            for q in members:
                size[q] = len(members)
        soft = list(raw)
        for _ in range(self.blur):
            soft = [
                tuple((soft[n][k] * 2 + sum(soft[q][k] for q in near[n])) / (2 + len(near[n])) for k in range(3))
                for n in range(len(part.f))
            ]
        for n, f in enumerate(part.f):
            names_here = [self.dominant[i] for i in f]
            group = max(set(names_here), key=names_here.count)
            part.m[n] = classify(centres[n], soft[n], raw[n], group, size[n])

    def _tidy(self):
        """Removes speckle: a face in a soft colour takes the colour most of its neighbours have."""
        part = self.part
        near = self._neighbours()
        for _ in range(4):
            next_m = list(part.m)
            for n, m in enumerate(part.m):
                if m not in self.soft or not near[n]:
                    continue
                count = {}
                for k in near[n]:
                    if part.m[k] in self.soft:
                        count[part.m[k]] = count.get(part.m[k], 0) + 1
                count[m] = count.get(m, 0) + 1
                next_m[n] = max(count, key=count.get)
            part.m = next_m


def subdivide(part, levels):
    """Smooths a low-poly body. Materials and bone weights carry over."""
    mesh = bpy.data.meshes.new("sub")
    mesh.from_pydata([G(v) for v in part.v], [], part.f)
    names = []
    for m in part.m:
        if m not in names:
            names.append(m)
            mesh.materials.append(build_rigs.material(m))
    index = {n: i for i, n in enumerate(names)}
    mesh.polygons.foreach_set("material_index", [index[m] for m in part.m])
    mesh.update()
    obj = bpy.data.objects.new("sub", mesh)
    bpy.context.collection.objects.link(obj)
    groups = {}
    for i, w in enumerate(part.w):
        for bone, weight in w.items():
            if bone not in groups:
                groups[bone] = obj.vertex_groups.new(name=bone)
            groups[bone].add([i], weight, "REPLACE")
    mod = obj.modifiers.new("sub", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    gname = {g.index: g.name for g in obj.vertex_groups}
    part.v = [(v.co[0], v.co[2], -v.co[1]) for v in obj.data.vertices]
    part.w = [{gname[g.group]: g.weight for g in v.groups if g.weight > 0.003} for v in obj.data.vertices]
    part.f = [tuple(q.vertices) for q in obj.data.polygons]
    part.m = [names[q.material_index] for q in obj.data.polygons]
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(mesh)


def bbox(part, bone, min_weight=0.5):
    """Bounds of the vertices that mostly follow one bone."""
    pts = [Vector(p) for p, w in zip(part.v, part.w) if w.get(bone, 0) >= min_weight]
    lo = Vector((min(p[i] for p in pts) for i in range(3)))
    hi = Vector((max(p[i] for p in pts) for i in range(3)))
    return lo, hi


def heat_weights(part, bones):
    """Rig an unrigged model: Blender's bone-heat weights, with distance as the fallback."""
    arm = make_armature("tmpRig", bones)
    obj = make_mesh("tmpMesh", part, arm)
    obj.parent = None
    obj.modifiers.clear()
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    names = {g.index: g.name for g in obj.vertex_groups}
    seg = {n: (Vector(h), Vector(t)) for (n, _, h, t) in bones}
    misses = 0
    out = []
    for i, v in enumerate(obj.data.vertices):
        w = {names[g.group]: g.weight for g in v.groups if g.weight > 0.01}
        if not w or sum(w.values()) < 0.01:
            misses += 1
            p = Vector(part.v[i])
            near = min(seg, key=lambda n: build_rigs.seg_dist(p, *seg[n]))
            w = {near: 1.0}
        total = sum(w.values())
        out.append({b: x / total for b, x in w.items()})
    part.w = out
    print("HEAT", "verts", len(out), "fallback", misses)
    bpy.data.objects.remove(obj)
    bpy.data.objects.remove(arm)


def merge(part, g, pos=(0, 0, 0), rot=None):
    """Adds a locally built Part into part, moved to pos."""
    base = len(part.v)
    R = rot if rot is not None else Matrix.Identity(3)
    P = Vector(pos)
    for v, w in zip(g.v, g.w):
        part._vert(tuple(P + R @ Vector(v)), dict(w))
    for f, m in zip(g.f, g.m):
        part.f.append(tuple(i + base for i in f))
        part.m.append(m)


# ------------------------------------------------------------------------------------ the poser


class Poser:
    """Forward kinematics plus aiming and two-bone IK in world space. Output is apply_pose's format."""

    def __init__(self, bones):
        self.parent = {n: p for (n, p, _, _) in bones}
        self.rest = {n: Vector(h) for (n, _, h, _) in bones}
        self.dir = {n: (Vector(t) - Vector(h)).normalized() for (n, _, h, t) in bones}
        self.seg = {n: (Vector(t) - Vector(h)).length for (n, _, h, t) in bones}
        self.R = {}
        self.loc = {}

    def world_R(self, b):
        m = Matrix.Identity(3)
        chain = []
        while b:
            chain.append(b)
            b = self.parent[b]
        for n in reversed(chain):
            m = m @ self.R.get(n, Matrix.Identity(3))
        return m

    def world_P(self, b):
        p = self.parent[b]
        if not p:
            return self.rest[b] + self.loc.get(b, Vector((0, 0, 0)))
        return self.world_P(p) + self.world_R(p) @ (self.rest[b] - self.rest[p] + self.loc.get(b, Vector((0, 0, 0))))

    def _set_world(self, b, W):
        p = self.parent[b]
        self.R[b] = W if not p else self.world_R(p).inverted() @ W

    def rot(self, b, x=0.0, y=0.0, z=0.0):
        self.R[b] = build_rigs.rot_game(x, y, z)

    def aim(self, b, world_dir, roll=0.0):
        """Turns a bone so it points along world_dir, by the shortest arc from its rest direction."""
        to = Vector(world_dir).normalized()
        W = self.dir[b].rotation_difference(to).to_matrix()
        if roll:
            W = Matrix.Rotation(roll, 3, to) @ W
        self._set_world(b, W)

    def face(self, b, W):
        self._set_world(b, W)

    def level(self, b, yaw=0.0):
        """Holds a bone at its rest orientation in the world, as a flat foot does."""
        self._set_world(b, Matrix.Rotation(yaw, 3, "Y"))

    def place(self, b, pos):
        """Moves a bone's head to a world position."""
        p = self.parent[b]
        P = Vector(pos)
        if not p:
            self.loc[b] = P - self.rest[b]
            return
        self.loc[b] = self.world_R(p).inverted() @ (P - self.world_P(p)) - (self.rest[b] - self.rest[p])

    def ik(self, upper, lower, target, pole):
        """Two-bone IK: lower's far end reaches target, and the joint bends toward pole."""
        hip = self.world_P(upper)
        t = Vector(target)
        L1 = (self.rest[lower] - self.rest[upper]).length
        L2 = self.seg[lower]
        v = t - hip
        d = min(max(v.length, abs(L1 - L2) + 1e-3), (L1 + L2) * 0.998)
        n = v.normalized()
        a = (L1 * L1 - L2 * L2 + d * d) / (2 * d)
        h = math.sqrt(max(0.0, L1 * L1 - a * a))
        perp = Vector(pole) - n * Vector(pole).dot(n)
        perp = perp.normalized() if perp.length > 1e-5 else Vector((0, 0, 1))
        joint = hip + n * a + perp * h
        end = hip + n * d
        # The upper bone's own direction may differ from hip-to-joint, as source bones are not always aligned.
        self.aim(upper, joint - hip)
        self.aim(lower, end - joint)
        return end

    def out(self):
        pose = {}
        for n in self.parent:
            q = {}
            if n in self.R:
                e = self.R[n].to_euler("XYZ")
                q["rot"] = (e.x, e.y, e.z)
            if n in self.loc:
                q["loc"] = tuple(self.loc[n])
            if q:
                pose[n] = q
        return pose


def chain(names_heads, tail_of=None):
    """(name, parent, head) rows to bone rows, with each tail at its first child or set by tail_of."""
    tail_of = tail_of or {}
    rows = []
    for (n, parent, head) in names_heads:
        head = tuple(head)
        if n in tail_of:
            tail = tuple(tail_of[n])
        else:
            kids = [h for (c, q, h) in names_heads if q == n and tuple(h) != head]
            if kids:
                tail = tuple(kids[0])
            else:
                par = next((h for (c, _, h) in names_heads if c == parent), None)
                d = (Vector(head) - Vector(par)) if par is not None else Vector((0, 0.2, 0))
                if d.length < 1e-4:
                    d = Vector((0, 0.2, 0))
                tail = tuple(Vector(head) + d.normalized() * 0.2)
        rows.append((n, parent, head, tail))
    return rows


# ----------------------------------------------------------------------------------- shared kit


def cyl(p, a, b, r0, r1, mat, bone, sides=16, caps=True):
    """A straight cylinder with flat ends, a to b."""
    if p.low:
        sides = min(sides, 8)
    A = V(a)
    B = V(b)
    n = (B - A).normalized()
    u = n.orthogonal().normalized()
    w = n.cross(u)
    rows = []
    for (c, r) in ((A, r0), (B, r1)):
        row = []
        for i in range(sides):
            t = 2 * math.pi * i / sides
            row.append(p._vert(tuple(c + (u * math.cos(t) + w * math.sin(t)) * r), {bone: 1.0}))
        rows.append(row)
    for i in range(sides):
        j = (i + 1) % sides
        p.f.append((rows[0][i], rows[0][j], rows[1][j], rows[1][i]))
        p.m.append(mat)
    if caps:
        p.f.append(tuple(rows[1]))
        p.m.append(mat)
        p.f.append(tuple(reversed(rows[0])))
        p.m.append(mat)


def bake_face(part, half, top, span, n=24, bone="head"):
    """Fits a flat face sheet to the head: rays from the front onto every head-bone face. Art's eyes
    sit 46% down the sheet and 14% each side of centre, and its mouth 70% down."""
    verts = [Vector(v) for v in part.v]
    head = [f for f in part.f if all(part.w[i] and max(part.w[i], key=part.w[i].get) == bone for i in f)]
    tree = BVHTree.FromPolygons(verts, head, all_triangles=False)
    grid = []
    for j in range(n + 1):
        y = top - span * j / n
        row = []
        for i in range(n + 1):
            x = (i / n * 2 - 1) * half
            hit = tree.ray_cast(Vector((x, y, 50.0)), Vector((0, 0, -1)))
            row.append(None if hit[0] is None else [round(x, 4), round(y, 4), round(hit[0][2] + 0.016, 4)])
        grid.append(row)
    return grid


def hat(p, y, r, mat, band, bone="head", x=0.0, z=0.0, crown=0.5, crown_r=0.55, curl=0.0, tilt=0.0):
    """A soft cowboy hat of any size. Curl lifts the brim's sides; tilt rolls it over one eye."""
    n = 28
    w = {bone: 1.0}
    thick = r * 0.022

    def T(px, py, pz):
        return (x + px * math.cos(tilt) - py * math.sin(tilt), y + px * math.sin(tilt) + py * math.cos(tilt), z + pz)

    tops = []
    bottoms = []
    for k in (0.4, 0.7, 1.0):
        top = []
        bottom = []
        for i in range(n):
            a = 2 * math.pi * i / n
            c = math.cos(a)
            s = math.sin(a)
            lift = curl * c * c * k * k
            top.append(p._vert(T(c * r * k, lift + thick, s * r * 0.85 * k), w))
            bottom.append(p._vert(T(c * r * k, lift - thick, s * r * 0.85 * k), w))
        tops.append(top)
        bottoms.append(bottom)
    for q in range(2):
        for i in range(n):
            j = (i + 1) % n
            p.f.append((tops[q][i], tops[q + 1][i], tops[q + 1][j], tops[q][j]))
            p.m.append(mat)
            p.f.append((bottoms[q][i], bottoms[q][j], bottoms[q + 1][j], bottoms[q + 1][i]))
            p.m.append(mat)
    for i in range(n):
        j = (i + 1) % n
        p.f.append((tops[2][i], bottoms[2][i], bottoms[2][j], tops[2][j]))
        p.m.append(mat)
    rings = []
    for (f, h) in ((1.02, 0.0), (1.0, 0.3), (0.95, 0.62), (0.82, 0.9), (0.5, 1.0)):
        ring = []
        for i in range(n):
            a = 2 * math.pi * i / n
            ring.append(p._vert(T(math.cos(a) * r * crown_r * f, crown * h, math.sin(a) * r * crown_r * f * 0.85), w))
        rings.append(ring)
    for q, m in enumerate((band, mat, mat, mat)):
        for i in range(n):
            j = (i + 1) % n
            p.f.append((rings[q][i], rings[q + 1][i], rings[q + 1][j], rings[q][j]))
            p.m.append(m)
    p.f.append(tuple(rings[0]))
    p.m.append(band)
    p.f.append(tuple(reversed(rings[-1])))
    p.m.append(mat)


def minigun():
    g = LowPart()
    for i in range(6):
        a = i / 6 * 2 * math.pi
        bx = math.cos(a) * 0.17
        by = math.sin(a) * 0.17
        g.tube([(bx, by, 0.5), (bx, by, 2.5)], [0.06, 0.056], "gunmetal", ["barrels", "barrels"], 8, 1)
    for z in (1.0, 1.75, 2.36):
        cyl(g, (0, 0, z), (0, 0, z + 0.1), 0.27, 0.27, "steel", "barrels", 14)
        # Studs on the rings, so you can see them turning.
        for i in range(3):
            a = i / 3 * 2 * math.pi + 0.5
            g.ellipsoid((math.cos(a) * 0.27, math.sin(a) * 0.27, z + 0.05), (0.05, 0.05, 0.06), "brass", "barrels", 6, 4)
    cyl(g, (0, 0, -0.1), (0, 0, 0.62), 0.36, 0.3, "steel", "gun", 14)
    g.ellipsoid((-0.08, -0.62, 0.1), (0.48, 0.42, 0.48), "drum", "gun", 16, 10)
    g.tube([(-0.25, -0.26, 0.2), (-0.1, -0.1, 0.25)], [0.09, 0.09], "brass", ["gun", "gun"], 8, 1)
    g.tube([(0, 0.32, -0.3), (0, 0.46, 0.3)], [0.05, 0.05], "wood", ["gun", "gun"], 8, 1)
    return g


def sawed_off():
    g = LowPart()
    for s in (-1, 1):
        g.tube([(s * 0.058, 0.04, 0.0), (s * 0.058, 0.04, 0.82)], [0.066, 0.066], "gunmetal", ["gun", "gun"], 10, 1)
        g.ellipsoid((s * 0.058, 0.04, 0.82), (0.042, 0.042, 0.012), "ink", "gun", 8, 4)
    g.tube([(0, 0.0, 0.06), (0, -0.07, -0.3), (0, -0.28, -0.62)], [0.08, 0.08, 0.12], "wood", ["gun"] * 3, 10, 4, squash=(0.75, 1.0))
    g.tube([(0, -0.03, 0.05), (0, -0.05, 0.42)], [0.075, 0.065], "wood", ["gun", "gun"], 8, 1)
    return g


def crossbow():
    g = LowPart()
    g.tube([(0, 0, -0.75), (0, 0, 1.1)], [0.11, 0.085], "wood", ["gun", "gun"], 8, 1)
    bow = []
    for i in range(9):
        k = (i - 4) / 4
        bow.append((k * 1.45, 0.0, 0.95 - abs(k) ** 1.6 * 0.6))
    g.tube(bow, [0.08, 0.075, 0.07, 0.065, 0.065, 0.065, 0.07, 0.075, 0.08], "gunmetal", ["gun"] * 9, 6, 2)
    g.tube([(-1.42, 0.04, 0.36), (0, 0.04, -0.2), (1.42, 0.04, 0.36)], [0.018, 0.018, 0.018], "ink", ["gun"] * 3, 4, 1)
    g.tube([(0, 0.13, -0.2), (0, 0.13, 1.5)], [0.034, 0.034], "steel", ["gun", "gun"], 6, 1)
    g.tube([(0, 0.13, 1.5), (0, 0.13, 1.82)], [0.1, 0.004], "brass", ["gun", "gun"], 6, 1)
    return g


def long_rifle():
    g = LowPart()
    g.tube([(0, 0.02, 0.15), (0, 0.02, 3.1)], [0.05, 0.04], "gunmetal", ["gun", "gun"], 8, 1)
    g.tube([(0, 0, 0.2), (0, -0.08, -0.35), (0, -0.28, -0.85)], [0.08, 0.075, 0.13], "wood", ["gun"] * 3, 8, 4, squash=(0.7, 1.0))
    g.tube([(0, -0.03, 0.15), (0, -0.03, 1.4)], [0.068, 0.056], "wood", ["gun", "gun"], 8, 1)
    g.tube([(0, 0.18, 0.3), (0, 0.18, 1.1)], [0.05, 0.05], "steel", ["gun", "gun"], 8, 1)
    return g


# ------------------------------------------------------------------------------- build and bake


def keep_weights(obj):
    """For a model with hand-made weights: only what the engine needs, nothing blurred."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)


def stretch_by_material(name, arm, obj):
    """How far each material's edges stretch in every clip. Rigid things should stay near 1."""
    me0 = obj.data
    edge_mat = {}
    for poly in me0.polygons:
        m = me0.materials[poly.material_index].name
        for k in poly.edge_keys:
            edge_mat.setdefault(k, m)
    rest = [(tuple(sorted(e.vertices)), me0.vertices[e.vertices[0]].co.copy(), me0.vertices[e.vertices[1]].co.copy()) for e in me0.edges]
    stats = {}
    bad_edges = {}

    def G_inv(q):
        return (q[0], q[2], -q[1])

    def vert_groups(o, key):
        names = {g.index: g.name for g in o.vertex_groups}
        return [{names[g.group]: round(g.weight, 2) for g in o.data.vertices[i].groups} for i in key]

    for clip, fn in PREVIEW_POSES.items():
        for k in range(5):
            apply_pose(arm, fn(k * 0.24))
            bpy.context.view_layer.update()
            ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            me = ev.to_mesh()
            for e, (key, a, b) in zip(me.edges, rest):
                r0 = (a - b).length
                if r0 < 0.01:
                    continue
                r = (me.vertices[e.vertices[0]].co - me.vertices[e.vertices[1]].co).length / r0
                row = stats.setdefault(edge_mat.get(key, "?"), [0, 0, 1.0])
                row[0] += 1
                if r > 1.35 or r < 0.65:
                    row[1] += 1
                row[2] = max(row[2], r)
                if r > 2.0:
                    bad_edges.setdefault(key, (round(r, 2), clip, edge_mat.get(key), [round(x, 2) for x in G_inv(a)], [round(x, 2) for x in G_inv(b)], vert_groups(obj, key)))
            ev.to_mesh_clear()
    build_rigs.clear_pose(arm)
    bpy.context.view_layer.update()
    print("BADCOUNT", name, len(bad_edges))
    print("STRETCH", name, {m: f"{100 * v[1] / max(v[0], 1):.1f}% off, worst {v[2]:.2f}x" for m, v in sorted(stats.items())})


def finish(name, part, bones, clips, soften=True, face=None):
    print("BOSS", name, "pieces turned to face out:", wind_outward(part))
    arm = make_armature(f"{name}Rig", bones)
    mesh = make_mesh(name, part, arm)
    if soften:
        soften_in_blender(mesh)
    else:
        keep_weights(mesh)
    clips(arm)
    stretch_by_material(name, arm, mesh)
    os.makedirs(DIR, exist_ok=True)
    export(arm, [mesh], os.path.join(DIR, f"{name}.glb"))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(DIR, f"{name}.blend"))
    if os.path.exists(os.path.join(DIR, f"{name}.blend1")):
        os.remove(os.path.join(DIR, f"{name}.blend1"))
    with open(os.path.join(DIR, f"{name}.face.json"), "w", encoding="utf8") as fh:
        json.dump(face, fh, separators=(",", ":"))
    print("BOSS", name, "tris", sum(len(f) - 2 for f in part.f), "bones", len(bones), "kb", os.path.getsize(os.path.join(DIR, f"{name}.glb")) // 1024)
    if PREVIEW:
        preview(name, arm, mesh)


def paint_for(name):
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bosses.ts"), encoding="utf8").read()
    shared = dict(re.findall(r'(\w+): "#([0-9A-Fa-f]{6})"', src[src.index("const SHARED") : src.index("export const BOSSES")]))
    block = src[src.index(f'id: "{name}"') :]
    block = block[: block.index("\n  },") if "\n  }," in block else block.index("\n};")]
    shared.update(dict(re.findall(r'(\w+): "#([0-9A-Fa-f]{6})"', block)))
    return shared


def preview(name, arm, mesh):
    paint = paint_for(name)
    for m in mesh.data.materials:
        h = paint.get(m.name, "FF00FF")
        c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
        m.diffuse_color = (*[x ** 2.2 for x in c], 1)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = False
    scene.render.resolution_x = 700
    scene.render.resolution_y = 800
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("w")
    scene.world.color = (0.5, 0.5, 0.5)
    cam = bpy.data.objects.new("c", bpy.data.cameras.new("c"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    for clip, fn in PREVIEW_POSES.items():
        apply_pose(arm, fn(0.4))
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = mesh.evaluated_get(dg)
        vs = [ev.matrix_world @ v.co for v in ev.to_mesh().vertices]
        ev.to_mesh_clear()
        lo = Vector((min(v[i] for v in vs) for i in range(3)))
        hi = Vector((max(v[i] for v in vs) for i in range(3)))
        mid = (lo + hi) / 2
        size = (hi - lo).length
        for i, (az, el) in enumerate(((20, 8), (70, 12))):
            a = math.radians(az)
            e = math.radians(el)
            # In Blender axes the viewer is at -y; az turns toward the character's left (+x).
            cam.location = mid + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * size * 1.5
            cam.rotation_euler = (mid - cam.location).to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = os.path.join(PREVIEW, f"{name}_{clip}_{i}.png")
            bpy.ops.render.render(write_still=True)
        if clip == "idle":
            head = arm.matrix_world @ arm.pose.bones["head"].head
            cam.location = head + Vector((1.4, -5.0, 0.8))
            cam.rotation_euler = (head + Vector((0, 0, 0.3)) - cam.location).to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = os.path.join(PREVIEW, f"{name}_head.png")
            bpy.ops.render.render(write_still=True)
            cam.location = head + Vector((5.2, -1.6, 0.4))
            cam.rotation_euler = (head + Vector((0, -0.7, 0.2)) - cam.location).to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = os.path.join(PREVIEW, f"{name}_head2.png")
            bpy.ops.render.render(write_still=True)
        print("PREVIEW", name, clip, "bounds", [round(x, 2) for x in lo], [round(x, 2) for x in hi])


PREVIEW_POSES = {}


def lerp_v(a, b, u):
    return a + (b - a) * u


def clips_from(arm, table):
    """table: {clip: (duration, fn(t))}. Previews each."""
    PREVIEW_POSES.clear()
    for clip, (dur, fn) in table.items():
        bake_clip(arm, clip, dur, fn, 2)
        PREVIEW_POSES[clip] = fn


def sway(t, T, cycles, amt, ph=0.0):
    return math.sin(2 * math.pi * cycles * t / T + ph) * amt


V = Vector

# --------------------------------------------------------------------------------- the kit


def skeleton(j, sides, tail, gun0, sack0=None, barrels=False):
    """The shared bone rows. j: root, spine, chest, neck, head, crown. sides: shoulder, elbow, wrist,
    fingers, hip, knee, ankle and toe for the left, mirrored for the right. tail: four points."""
    rows = [
        ("root", None, j["root"]),
        ("spine", "root", j["spine"]),
        ("chest", "spine", j["chest"]),
        ("neck", "chest", j["neck"]),
        ("head", "neck", j["head"]),
        ("tail.1", "root", tail[0]),
        ("tail.2", "tail.1", tail[1]),
        ("tail.3", "tail.2", tail[2]),
    ]
    tails = {"head": j["crown"], "tail.3": tail[3]}

    def m(p, sg):
        return (p[0] * sg, p[1], p[2])

    for side, sg in (("L", 1), ("R", -1)):
        rows += [
            (f"arm.{side}", "chest", m(sides["shoulder"], sg)),
            (f"fore.{side}", f"arm.{side}", m(sides["elbow"], sg)),
            (f"hand.{side}", f"fore.{side}", m(sides["wrist"], sg)),
            (f"thigh.{side}", "root", m(sides["hip"], sg)),
            (f"shin.{side}", f"thigh.{side}", m(sides["knee"], sg)),
            (f"foot.{side}", f"shin.{side}", m(sides["ankle"], sg)),
        ]
        tails[f"hand.{side}"] = m(sides["fingers"], sg)
        tails[f"foot.{side}"] = m(sides["toe"], sg)
    rows.append(("gun", "chest", gun0))
    tails["gun"] = (gun0[0], gun0[1], gun0[2] + 1)
    if barrels:
        rows.append(("barrels", "gun", (gun0[0], gun0[1], gun0[2] + 0.02)))
        tails["barrels"] = (gun0[0], gun0[1], gun0[2] + 1)
    if sack0:
        rows.append(("sack", "chest", sack0))
        tails["sack"] = (sack0[0], sack0[1] + 1, sack0[2])
    return chain(rows, tails)


def arms(p, sides, sleeve, cuff, skin, claw, thick, finger=1.0):
    """Soft sleeves, cuffs, and a round mitten of a hand with three little claws."""
    for side, sg in (("L", 1), ("R", -1)):
        a, f, h = f"arm.{side}", f"fore.{side}", f"hand.{side}"
        sh = V((sides["shoulder"][0] * sg, sides["shoulder"][1], sides["shoulder"][2]))
        el = V((sides["elbow"][0] * sg, sides["elbow"][1], sides["elbow"][2]))
        wr = V((sides["wrist"][0] * sg, sides["wrist"][1], sides["wrist"][2]))
        tip = V((sides["fingers"][0] * sg, sides["fingers"][1], sides["fingers"][2]))
        p.tube([tuple(sh), tuple(el), tuple(wr)], list(thick), sleeve, [a, f, f], 12, 5)
        p.tube([tuple(wr + (el - wr).normalized() * 0.05), tuple(wr - (el - wr).normalized() * 0.03)], [thick[2] * 1.16, thick[2] * 1.16], cuff, [f, h], 12, 1)
        palm = wr.lerp(tip, 0.42)
        k = finger
        p.tube([tuple(wr), tuple(palm)], [thick[2] * 0.8, thick[2]], skin, [h, h], 12, 2)
        p.ellipsoid(tuple(palm), (thick[2] * 1.35, thick[2] * 1.4, thick[2] * 1.25), skin, h, 14, 10)
        along = (tip - wr).normalized()
        for off in (-1, 0, 1):
            root = palm + along * thick[2] * 1.1 + V((sg * off * thick[2] * 0.75, 0, off * off * -0.02 * k))
            end = root + (along + V((sg * off * 0.2, 0, 0.1))) * 0.13 * k
            p.tube([tuple(root), tuple(end)], [0.055 * k, 0.018 * k], claw, [h, h], 8, 1)


def legs(p, sides, pants, radii, skin, claw, foot):
    """Round trousers, soft feet and three little claws."""
    for side, sg in (("L", 1), ("R", -1)):
        t, n, f = f"thigh.{side}", f"shin.{side}", f"foot.{side}"
        hp = (sides["hip"][0] * sg, sides["hip"][1], sides["hip"][2])
        kn = (sides["knee"][0] * sg, sides["knee"][1], sides["knee"][2])
        an = (sides["ankle"][0] * sg, sides["ankle"][1], sides["ankle"][2])
        mid = ((hp[0] + kn[0]) / 2 + sg * radii[1] * 0.14, (hp[1] + kn[1]) / 2, (hp[2] + kn[2]) / 2 + 0.02)
        low = ((kn[0] + an[0]) / 2, (kn[1] + an[1]) / 2, (kn[2] + an[2]) / 2)
        p.tube([hp, mid, kn, low, an], list(radii), pants, [t, t, n, n, n], 14, 4)
        p.tube([an, (an[0], an[1] - foot * 0.7, an[2] + foot * 0.2)], [foot * 0.6, foot * 0.85], skin, [f, f], 10, 2)
        heel = (an[0], foot * 0.78, an[2] + foot * 0.85)
        p.ellipsoid(heel, (foot * 1.12, foot * 0.78, foot * 1.65), skin, f, 14, 10)
        for dx in (-1, 0, 1):
            root = (heel[0] + sg * dx * foot * 0.62, foot * 0.42, heel[2] + foot * 1.32)
            p.tube([root, (root[0] + sg * dx * foot * 0.16, foot * 0.28, root[2] + foot * 0.5)], [foot * 0.26, foot * 0.09], claw, [f, f], 8, 1)


def tail_with_spots(p, pts, radii, mat, spot, spots):
    bones = ["root", "tail.1", "tail.2", "tail.3", "tail.3", "tail.3"][: len(pts)]
    p.tube(pts, radii, mat, bones, 14, 6)
    for (q, r, b) in spots:
        p.ellipsoid(q, (r, r * 0.8, r * 1.2), spot, b, 8, 6)


# ----------------------------------------------------------------------------------------- gator


def gator():
    """Big Gat: a killer in a black suit. Huge spiked shoulders over a narrow waist, massive arms, a heavy
    brow and tusks on a broad snout, ammo belts across the chest, and spikes down the back and tail.
    Eyes and most of the teeth are SVG."""
    clear_scene()
    p = Part()
    p.flat = ("gunmetal", "steel", "wood", "drum", "ink")
    j = {"root": (0, 1.72, 0), "spine": (0, 2.2, 0.04), "chest": (0, 2.85, 0.02), "neck": (0, 3.62, 0.02), "head": (0, 4.08, 0.0), "crown": (0, 5.05, 0.0)}
    sides = {
        "shoulder": (1.34, 3.5, 0.0), "elbow": (2.0, 2.62, 0.2), "wrist": (2.1, 1.72, 0.42), "fingers": (2.12, 1.02, 0.56),
        "hip": (0.5, 1.66, 0.0), "knee": (0.62, 1.02, 0.12), "ankle": (0.62, 0.36, 0.0), "toe": (0.62, 0.05, 0.75),
    }
    tail = [(0, 1.62, -0.55), (0.42, 1.0, -1.55), (1.2, 0.68, -2.4), (2.25, 0.95, -2.95)]
    gun0 = (-3.2, 2.6, 2.5)
    sack0 = (3.2, 5.2, -0.6)
    bones = skeleton(j, sides, tail, gun0, sack0, barrels=True)

    def torso_w(y):
        k = build_rigs.smooth(1.95, 2.75, y)
        if k <= 0.001:
            return {"root": 1.0}
        if k >= 0.999:
            return {"chest": 1.0}
        return {"spine": 1.0 - abs(k - 0.5) * 0.8, "root" if k < 0.5 else "chest": abs(k - 0.5) * 0.8}

    # A big suit, straining over the gut: open jacket, white shirt, wide tie, lapels, pocket square.
    # A great wedge of a torso, wide at the shoulders and narrow at the belt.
    p.lathe([(0.5, 3.9), (1.1, 3.76), (1.5, 3.38), (1.5, 2.9), (1.22, 2.3), (0.96, 1.78), (0.82, 1.5)], "suit", torso_w, 28, 1.0, 0.95)
    p.ellipsoid((0, 2.55, 0.62), (0.72, 1.15, 0.66), "shirt", "spine", 22, 16)
    p.tube([(0, 3.44, 1.08), (0, 3.0, 1.28), (0, 2.45, 1.32), (0, 2.12, 1.25)], [0.07, 0.14, 0.17, 0.012], "band", ["chest", "chest", "spine", "spine"], 10, 4, squash=(1.0, 0.25))
    p.ellipsoid((0, 3.46, 1.08), (0.12, 0.09, 0.07), "band", "chest", 10, 7)
    for sg in (-1, 1):
        p.tube([(sg * 0.24, 3.66, 0.72), (sg * 0.66, 2.86, 1.16), (sg * 0.62, 2.2, 1.14), (sg * 0.32, 1.78, 0.96)], [0.09, 0.16, 0.13, 0.05], "lapel", ["chest", "chest", "spine", "root"], 10, 5, squash=(1.0, 0.28))
        p.tube([(sg * 0.14, 3.62, 0.86), (sg * 0.3, 3.36, 1.02)], [0.06, 0.03], "shirt", ["chest", "chest"], 8, 2, squash=(1.0, 0.3))
    # Ammo belts, crossed over the chest, stuffed with big rounds.
    for sg in (-1, 1):
        path = [(sg * 1.3, 3.62, 0.72), (sg * 0.66, 3.12, 1.26), (-sg * 0.1, 2.56, 1.42), (-sg * 0.72, 2.02, 1.18), (-sg * 0.92, 1.74, 0.82)]
        p.tube(path, [0.11, 0.17, 0.18, 0.17, 0.11], "belt", ["chest", "chest", "spine", "root", "root"], 10, 4, squash=(1.0, 0.24))
        for i in range(7):
            u = (i + 0.5) / 7
            k = u * (len(path) - 1)
            a = path[int(k)]
            b = path[min(int(k) + 1, len(path) - 1)]
            f = k - int(k)
            at = tuple(a[n] + (b[n] - a[n]) * f for n in range(3))
            bone = "chest" if at[1] > 2.75 else "spine" if at[1] > 2.1 else "root"
            p.ellipsoid((at[0], at[1], at[2] + 0.07), (0.075, 0.13, 0.06), "brass", bone, 8, 5)
    # Belt and buckle under the gut.
    cyl(p, (0, 1.72, 0), (0, 1.56, 0), 0.92, 0.9, "belt", "root", 26, caps=False)
    p.ellipsoid((0, 1.58, 0.84), (0.2, 0.15, 0.06), "brass", "root", 12, 8)
    p.ellipsoid((0, 1.55, 0), (0.86, 0.3, 0.7), "suit", "root", 18, 12)
    # A huge round head with a broad, rounded snout, sitting right on the shoulders.
    p.tube([(0, 3.5, 0), (0, 3.9, 0), (0, 4.2, 0)], [0.6, 0.6, 0.6], "hide", ["chest", "neck", "head"], 16, 3)
    loft(p, [(4.5, -1.12, 0.03, 0.03), (4.5, -1.02, 0.6, 0.55), (4.5, -0.6, 1.14, 1.0), (4.48, -0.1, 1.35, 1.12), (4.42, 0.4, 1.28, 1.02), (4.3, 0.85, 1.06, 0.74), (4.2, 1.25, 0.92, 0.48), (4.16, 1.55, 0.72, 0.3), (4.15, 1.72, 0.36, 0.14), (4.14, 1.78, 0.02, 0.02)], "hide", "head", 26, 2)
    # The hat's low and flat, pulled down over the eyes.
    hat(p, bbox(p, "head")[1][1] - 0.62, 1.9, "hat", "band", z=-0.14, crown=0.62, crown_r=0.5, curl=0.3, tilt=-0.13)
    arms(p, sides, "suit", "shirt", "hide", "claw", (0.62, 0.56, 0.46), 2.4)
    legs(p, sides, "suit", (0.54, 0.6, 0.5, 0.42, 0.34), "hide", "claw", 0.4)
    # Armour on the shoulders, spiked.
    for side, sg in (("L", 1), ("R", -1)):
        bone = f"arm.{side}"
        cx = sides["shoulder"][0] * sg
        cy = sides["shoulder"][1]
        p.ellipsoid((cx + sg * 0.14, cy + 0.14, 0), (0.78, 0.5, 0.74), "steel", bone, 12, 8)
        p.ellipsoid((cx + sg * 0.12, cy - 0.16, 0), (0.84, 0.16, 0.8), "gunmetal", bone, 12, 6)
        for (ox, oy, oz, tx, ty, tz) in ((0.1, 0.5, 0.0, 0.34, 1.12, 0.02), (0.56, 0.32, 0.3, 1.18, 0.76, 0.5), (0.56, 0.32, -0.3, 1.18, 0.76, -0.5), (-0.28, 0.44, 0.34, -0.3, 0.98, 0.62)):
            base = (cx + sg * ox, cy + oy, oz)
            tip = (cx + sg * tx, cy + ty, tz)
            p.tube([base, tip], [0.2, 0.012], "brass", [bone, bone], 7, 1)
    pts = [(0, 1.75, -0.45), (0.3, 1.0, -1.45), (1.05, 0.62, -2.35), (2.1, 0.78, -2.92), (2.86, 1.34, -2.82), (2.92, 1.92, -2.45)]
    tail_with_spots(p, pts, [0.72, 0.58, 0.42, 0.28, 0.14, 0.012], "hide", "spot", [((0.5, 1.4, -1.7), 0.22, "tail.1"), ((1.32, 0.98, -2.6), 0.17, "tail.2"), ((2.3, 1.1, -3.0), 0.12, "tail.3")])
    # Spikes down the spine and along the tail.
    for (y, z, r, ln, bone) in ((3.66, -0.86, 0.2, 0.62, "chest"), (3.12, -1.28, 0.22, 0.72, "chest"), (2.56, -1.14, 0.2, 0.62, "spine"), (2.0, -0.92, 0.17, 0.5, "root")):
        p.tube([(0, y, z), (0, y + ln * 0.35, z - ln)], [r, 0.012], "spot", [bone, bone], 6, 1)
    for (q, n, r, ln, bone) in (((0.3, 1.5, -1.4), (0.2, 0.9, -0.5), 0.17, 0.5, "tail.1"), ((0.72, 1.05, -2.05), (0.3, 0.9, -0.5), 0.14, 0.44, "tail.1"), ((1.42, 0.98, -2.72), (0.25, 0.95, -0.3), 0.11, 0.36, "tail.2"), ((2.2, 1.08, -3.05), (0.2, 1.0, -0.1), 0.08, 0.3, "tail.3")):
        p.tube([q, (q[0] + n[0] * ln, q[1] + n[1] * ln, q[2] + n[2] * ln)], [r, 0.01], "spot", [bone, bone], 6, 1)
    merge(p, minigun(), gun0)
    face = bake_face(p, 1.9, 5.86, 2.3, n=36)
    # On top of the face sheet: a heavy angry brow and a pair of tusks up out of the lower jaw.
    for sg in (-1, 1):
        p.tube([(sg * 1.06, 5.36, 0.3), (sg * 0.62, 5.12, 0.74), (sg * 0.16, 4.86, 1.08)], [0.22, 0.2, 0.1], "spot", ["head", "head", "head"], 8, 3)
        p.tube([(sg * 0.68, 3.82, 1.02), (sg * 0.78, 4.28, 1.16), (sg * 0.72, 4.66, 1.2)], [0.15, 0.1, 0.012], "tooth", ["head", "head", "head"], 7, 3)

    pz = Poser(bones)
    rest = pz.rest

    def stance(t, T_, recoil=0.0, walk=None):
        b = sway(t, T_, 2, 0.05)
        pz.R.clear()
        pz.loc.clear()
        swing = walk if walk is not None else 0.0
        pz.place("root", rest["root"] + V((0.04, -0.28 + b + abs(math.sin(swing)) * 0.08, 0.1)))
        pz.aim("root", (0.05, 0.95, 0.12))
        pz.aim("spine", (0.02, 0.95, 0.18))
        pz.aim("chest", (-0.08 + sway(t, T_, 1, 0.03), 0.92, 0.28))
        pz.aim("neck", (-0.05, 0.88, 0.32))
        pz.face("head", Matrix.Rotation(-0.22 + sway(t, T_, 1, 0.04, 1.0), 3, "Y") @ Matrix.Rotation(0.04 + sway(t, T_, 2, 0.02), 3, "X"))
        tp = sway(t, T_, 1, 0.14, 0.6)
        pz.aim("tail.1", (0.3, -0.6, -0.72))
        pz.aim("tail.2", (0.72 + tp, -0.3, -0.62))
        pz.aim("tail.3", (0.85 + tp, 0.1, -0.5))
        if walk is None:
            tl = rest["foot.L"] + V((0.4, 0, 0.72))
            tr = rest["foot.R"] + V((-0.5, 0, -0.5))
            yl, yr = 0.3, -0.35
        else:
            k = math.sin(swing)
            tl = rest["foot.L"] + V((0.1, max(0.0, math.cos(swing)) * 0.45, k * 0.75))
            tr = rest["foot.R"] + V((-0.1, max(0.0, -math.cos(swing)) * 0.45, -k * 0.75))
            yl, yr = 0.15, -0.15
        pz.ik("thigh.L", "shin.L", tl, (0.25, 0, 1))
        pz.ik("thigh.R", "shin.R", tr, (-0.25, 0, 1))
        pz.level("foot.L", yl)
        pz.level("foot.R", yr)
        chest = pz.world_P("chest")
        gun = chest + V((-1.95, -0.95, 1.6 - recoil))
        if recoil:
            gun = gun + V((sway(t, 1, 8, 0.03), sway(t, 1, 11, 0.03), 0))
        pz.place("gun", gun)
        pz.aim("gun", (-0.16, -0.03 + recoil * 0.05, 1))
        pz.ik("arm.R", "fore.R", gun + V((0.02, 0.32, 0.0)), (-1, -0.5, -0.5))
        pz.aim("hand.R", (-0.05, 0.1, 1))
        # A great fist hanging ready.
        pz.place("sack", chest + V((2.45, 1.3, -0.8)))
        pz.ik("arm.L", "fore.L", chest + V((2.2, -1.05 + sway(t, T_, 2, 0.03, 0.8), 0.55)), (1, 0.2, -0.6))
        pz.aim("hand.L", (0.05, -0.75, 0.6))
        return pz.out()

    def act(lean=0.0, crouch=0.0, rise=0.0, fwd=0.0, shift=0.0, back=0.0, fl=(0.4, 0, 0.72), fr=(-0.5, 0, -0.5), yl=0.3, yr=-0.35,
            gun_at=(-1.95, -0.95, 1.6), gun_dir=(-0.16, -0.03, 1), spin=0.0, head=(0.04, -0.22, 0.0), tail=0.0,
            arm_l=None, hand_l=(0.05, -0.75, 0.6), sack_at=(2.45, 1.3, -0.8), breath=0.0):
        """One whole pose, from what the body's doing. Lean is toward the right of the screen, and fwd
        tips the top of the body toward you. The feet are offsets from where they rest."""
        pz.R.clear()
        pz.loc.clear()
        pz.place("root", rest["root"] + V((0.04 + shift, -0.28 - crouch + rise + breath, 0.1 + back)))
        pz.aim("root", (0.05 + lean * 0.6, 0.95, 0.12 + fwd * 0.6))
        pz.aim("spine", (0.02 + lean * 0.8, 0.95, 0.18 + fwd))
        pz.aim("chest", (-0.08 + lean, 0.92, 0.28 + fwd))
        pz.aim("neck", (-0.05 + lean * 0.5, 0.88, 0.32 + fwd * 0.4))
        pz.face("head", Matrix.Rotation(head[2], 3, "Z") @ Matrix.Rotation(head[1], 3, "Y") @ Matrix.Rotation(head[0], 3, "X"))
        pz.aim("tail.1", (0.3 + tail * 0.5, -0.6, -0.72))
        pz.aim("tail.2", (0.72 + tail, -0.3, -0.62))
        pz.aim("tail.3", (0.85 + tail * 1.2, 0.1, -0.5))
        pz.ik("thigh.L", "shin.L", rest["foot.L"] + V(fl), (0.25, 0, 1))
        pz.ik("thigh.R", "shin.R", rest["foot.R"] + V(fr), (-0.25, 0, 1))
        pz.level("foot.L", yl)
        pz.level("foot.R", yr)
        chest = pz.world_P("chest")
        gun = chest + V(gun_at)
        pz.place("gun", gun)
        pz.aim("gun", gun_dir)
        pz.rot("barrels", z=spin)
        pz.ik("arm.R", "fore.R", gun + V((0.02, 0.32, 0.0)), (-1, -0.5, -0.5))
        pz.aim("hand.R", (-0.05, 0.1, 1))
        pz.place("sack", chest + V(sack_at))
        pz.ik("arm.L", "fore.L", chest + V(arm_l if arm_l else (2.2, -1.05, 0.55)), (1, 0.2, -0.6))
        pz.aim("hand.L", hand_l)
        return pz.out()

    # Held out in front and level, right at you. Close to the middle of his body, so it reads as a threat.
    AIMED = (-1.5, -0.55, 1.75)
    AIM_DIR = (0.2, -0.02, 1)

    def strafe(t, T_, sg):
        c = 2 * math.pi * t / T_
        s, co = math.sin(c), math.cos(c)
        # Big sideways steps, one foot crossing to meet the other, with a bounce in each.
        return act(
            lean=sg * 0.26,
            rise=abs(s) * 0.16 - 0.1,
            shift=sg * 0.1,
            fl=(sg * s * 0.62 + 0.15, max(0.0, co) * 0.55, 0.1),
            fr=(-sg * s * 0.62 - 0.15, max(0.0, -co) * 0.55, -0.1),
            yl=0.15,
            yr=-0.15,
            tail=-sg * (0.3 + s * 0.12),
            head=(0.04, -0.1 - sg * 0.1, -sg * 0.1),
            spin=0,
            breath=abs(co) * 0.03,
        )

    def dash(t, T_, sg):
        k = build_rigs.smooth(0, 0.3, t / T_)
        # Low and thrown right over, the trailing leg flung out.
        return act(
            lean=sg * (0.2 + k * 0.6),
            crouch=0.28 + k * 0.22,
            fwd=0.3,
            shift=sg * 0.25,
            fl=((0.95 if sg > 0 else -0.25) * sg, 0.05 if sg > 0 else 0.45, 0.12),
            fr=((-0.25 if sg > 0 else 0.95) * sg, 0.45 if sg > 0 else 0.05, -0.12),
            yl=0.2,
            yr=-0.2,
            tail=-sg * 0.7,
            gun_at=(-1.8, -0.5, 1.0),
            head=(0.1, 0.0, -sg * 0.3),
        )

    def jump(t):
        T_ = 1.0
        crouch = build_rigs.smooth(0, 0.1, t) * (1 - build_rigs.smooth(0.1, 0.2, t)) + build_rigs.smooth(0.82, 0.92, t) * (1 - build_rigs.smooth(0.92, T_, t))
        air = build_rigs.smooth(0.14, 0.3, t) * (1 - build_rigs.smooth(0.74, 0.86, t))
        stretch = build_rigs.smooth(0.12, 0.2, t) * (1 - build_rigs.smooth(0.3, 0.45, t))
        return act(
            crouch=crouch * 0.9,
            rise=stretch * 0.25,
            fwd=air * 0.2,
            # Knees up at the top, feet spread to land.
            fl=(0.45, air * 1.15, 0.35 + air * 0.5),
            fr=(-0.45, air * 1.15, 0.2 + air * 0.5),
            yl=0.2,
            yr=-0.2,
            tail=-air * 0.5,
            gun_at=(-2.1, -0.4 + air * 0.9, 1.2),
            gun_dir=(-0.3, 0.3 - air * 0.5, 1),
            arm_l=(2.5, -0.9 + air * 1.5, 0.3),
            hand_l=(0.2, -0.3 + air * 0.8, 0.5),
            head=(0.1 + crouch * 0.15, -0.15, 0.0),
        )

    def land(t):
        T_ = 0.8
        sink = (1 - build_rigs.smooth(0.05, T_, t))
        return act(
            crouch=sink * 1.0,
            fwd=sink * 0.45,
            fl=(0.7, 0, 0.7),
            fr=(-0.7, 0, -0.3),
            gun_at=(-2.25, -1.25 - sink * 0.2, 1.2),
            head=(0.2 * sink - 0.05, -0.1, 0.0),
            tail=-0.15 * sink,
        )

    def duck(t):
        T_ = 1.0
        b = sway(t, T_, 1, 0.03)
        return act(
            crouch=1.08 + b,
            fwd=0.55,
            fl=(0.75, 0, 0.5),
            fr=(-0.75, 0, -0.2),
            gun_at=(-1.7, -0.5, 1.2),
            gun_dir=(0.1, 0.12, 1),
            head=(-0.2, sway(t, T_, 1, 0.12), 0.0),
            tail=sway(t, T_, 1, 0.25),
        )

    def spinning(t, T_, turns):
        return 2 * math.pi * turns * t / T_

    def charge(t):
        T_ = 1.3
        u = t / T_
        # Spinning up from nothing, faster and faster, and shaking harder as it does.
        spin = 2 * math.pi * 9 * u * u
        rock = build_rigs.smooth(0, 0.25, u)
        shake = u * u * 0.05
        jit = math.sin(t * 90) * shake
        return act(
            crouch=rock * 0.32,
            back=-0.08 * rock,
            lean=jit,
            fl=(0.6, 0, 0.75),
            fr=(-0.6, 0, -0.55),
            gun_at=(lerp_v(-1.95, AIMED[0], rock) + jit, lerp_v(-0.95, AIMED[1], rock) + jit, lerp_v(1.6, AIMED[2], rock)),
            gun_dir=AIM_DIR,
            spin=spin,
            head=(0.14 * rock, -0.18, 0.0),
            tail=-0.2 * rock,
        )

    def fire(t):
        T_ = 0.5
        kick = abs(math.sin(2 * math.pi * 6 * t / T_))
        jit = math.sin(2 * math.pi * 11 * t / T_) * 0.03
        return act(
            crouch=0.32 + kick * 0.03,
            back=-0.08 - kick * 0.06,
            lean=jit,
            fl=(0.6, 0, 0.75),
            fr=(-0.6, 0, -0.55),
            gun_at=(AIMED[0] + jit, AIMED[1] + jit, AIMED[2] - kick * 0.1),
            gun_dir=AIM_DIR,
            # Three whole turns, so it loops without a jump.
            spin=spinning(t, T_, 3),
            head=(0.14, -0.18, jit * 2),
            tail=-0.2,
        )

    def flinch(t):
        T_ = 0.35
        h = build_rigs.smooth(0, 0.05, t) * (1 - build_rigs.smooth(0.08, T_, t))
        return act(
            fwd=-0.32 * h,
            rise=0.05 * h,
            back=-0.2 * h,
            gun_at=(-2.2, -0.75, 1.3),
            head=(-0.35 * h, -0.22, 0.12 * h),
            tail=0.25 * h,
        )

    def reveal(t):
        T_ = 1.6
        # Throws his arms wide and his chest out, and roars at the sky, heart and all.
        open_ = build_rigs.smooth(0, 0.2, t) * (1 - build_rigs.smooth(T_ - 0.15, T_, t))
        b = sway(t, T_, 3, 0.03)
        return act(
            fwd=-0.2 * open_,
            rise=0.05 * open_ + b,
            fl=(0.65, 0, 0.5),
            fr=(-0.65, 0, -0.3),
            gun_at=(-1.95 - open_ * 1.0, -0.95 + open_ * 0.5, 1.6 - open_ * 1.2),
            gun_dir=(-0.8 * open_ - 0.16, 0.45 * open_, 1 - 0.3 * open_),
            arm_l=(2.2 + open_ * 0.7, -1.05 + open_ * 1.9, 0.55 - open_ * 0.6),
            hand_l=(0.3 * open_ + 0.05, -0.75 + open_ * 1.3, 0.6 - open_ * 0.5),
            head=(-0.42 * open_, -0.22 + open_ * 0.2, 0.0),
            tail=sway(t, T_, 3, 0.2),
        )

    def challenge(t):
        T_ = 2.4
        up = build_rigs.smooth(0.05, 0.35, t) * (1 - build_rigs.smooth(T_ - 0.25, T_, t))
        # Three jabs of the finger: you. You. You.
        jab = max(0.0, math.sin(2 * math.pi * 1.6 * (t - 0.4))) if t > 0.4 else 0.0
        return act(
            fwd=0.12 * up + 0.05 * jab * up,
            lean=-0.04 * up,
            gun_at=(-2.3, -1.25, 0.75),
            gun_dir=(-0.3, -0.25, 1),
            # The free hand straight out at you.
            arm_l=(lerp_v(2.2, 0.85, up), lerp_v(-1.05, 0.0 + jab * 0.08 * up, up), lerp_v(0.55, 2.3 + jab * 0.25 * up, up)),
            hand_l=(0.03 * up + 0.05 * (1 - up), -0.75 * (1 - up), up + 0.6 * (1 - up)),
            head=(0.05 + jab * 0.05 * up, -0.05, -0.05 * up),
            tail=sway(t, T_, 2, 0.15),
        )

    def clips(arm):
        clips_from(
            arm,
            {
                "idle": (4.0, lambda t: stance(t, 4.0)),
                "pose": (4.0, lambda t: stance(t + 1.0, 4.0)),
                "steal": (1.4, lambda t: stance(t, 1.4, walk=2 * math.pi * t / 1.4)),
                "strafe_r": (0.5, lambda t: strafe(t, 0.5, 1)),
                "strafe_l": (0.5, lambda t: strafe(t, 0.5, -1)),
                "dash_r": (0.3, lambda t: dash(t, 0.3, 1)),
                "dash_l": (0.3, lambda t: dash(t, 0.3, -1)),
                "jump": (1.0, jump),
                "land": (0.8, land),
                "duck": (1.0, duck),
                "flinch": (0.35, flinch),
                "reveal": (1.6, reveal),
                "challenge": (2.4, challenge),
            },
        )
        # The gun's spin needs every frame, or it would turn the wrong way between them.
        bake_clip(arm, "charge", 1.3, charge, 1)
        bake_clip(arm, "fire", 0.5, fire, 1)

    finish("gator", p, bones, clips, face=face)


# ----------------------------------------------------------------------------------------- snake


def snake():
    """Sal Sidewinder: tall and sly in a sharp suit. A short neck, a big round head with a soft point, and
    a long tail ending in a rattle. Eyes and tongue are SVG."""
    clear_scene()
    p = Part()
    p.flat = ("gunmetal", "steel", "wood", "drum", "ink")
    j = {"root": (0, 1.98, 0), "spine": (0, 2.34, 0), "chest": (0, 2.82, 0), "neck": (0, 3.34, 0), "head": (0, 3.86, 0.05), "crown": (0, 4.9, 0.0)}
    sides = {
        "shoulder": (0.5, 3.12, 0.0), "elbow": (0.88, 2.42, 0.06), "wrist": (0.98, 1.74, 0.14), "fingers": (1.02, 1.34, 0.2),
        "hip": (0.26, 1.92, 0.0), "knee": (0.33, 1.14, 0.1), "ankle": (0.33, 0.32, 0.0), "toe": (0.33, 0.05, 0.6),
    }
    tail = [(0, 1.84, -0.28), (0.16, 1.18, -0.86), (0.72, 0.62, -1.42), (1.62, 0.5, -1.92)]
    gun0 = (-2.8, 2.6, 2.3)
    bones = skeleton(j, sides, tail, gun0)

    def torso_w(y):
        k = build_rigs.smooth(2.1, 2.7, y)
        if k <= 0.001:
            return {"root": 1.0}
        if k >= 0.999:
            return {"chest": 1.0}
        return {"spine": 1.0 - abs(k - 0.5), "root" if k < 0.5 else "chest": abs(k - 0.5)}

    # A sharp, narrow suit: fitted jacket, white shirt, thin tie and long lapels.
    p.lathe([(0.2, 3.34), (0.4, 3.22), (0.54, 3.0), (0.5, 2.6), (0.45, 2.2), (0.47, 1.86)], "suit", torso_w, 24, 1.15, 0.74)
    p.ellipsoid((0, 2.86, 0.2), (0.27, 0.52, 0.25), "shirt", "chest", 14, 12)
    p.tube([(0, 3.2, 0.36), (0, 2.85, 0.45), (0, 2.5, 0.41)], [0.05, 0.075, 0.008], "band", ["chest", "chest", "spine"], 8, 3, squash=(1.0, 0.3))
    p.ellipsoid((0, 3.22, 0.35), (0.06, 0.05, 0.04), "band", "chest", 8, 6)
    for sg in (-1, 1):
        p.tube([(sg * 0.12, 3.32, 0.2), (sg * 0.27, 2.92, 0.42), (sg * 0.2, 2.38, 0.42), (sg * 0.08, 2.06, 0.38)], [0.04, 0.08, 0.05, 0.02], "lapel", ["chest", "chest", "spine", "root"], 8, 4, squash=(1.0, 0.3))
    p.ellipsoid((0.33, 2.96, 0.34), (0.08, 0.05, 0.03), "shirt", "chest", 8, 5)
    p.ellipsoid((0, 2.0, 0), (0.37, 0.2, 0.28), "suit", "root", 18, 10)
    # A short neck into a big round head that comes to a soft point.
    p.tube([(0, 3.2, 0.0), (0, 3.5, -0.02), (0, 3.9, 0.0)], [0.34, 0.36, 0.42], "scale", ["chest", "neck", "head"], 14, 3)
    loft(p, [(4.25, -0.84, 0.03, 0.03), (4.25, -0.72, 0.52, 0.48), (4.25, -0.34, 0.98, 0.86), (4.22, 0.06, 1.1, 0.9), (4.15, 0.4, 0.97, 0.74), (4.07, 0.7, 0.64, 0.46), (4.02, 0.92, 0.3, 0.2), (4.0, 1.03, 0.02, 0.02)], "scale", "head", 24, 2)
    hat(p, bbox(p, "head")[1][1] - 0.4, 1.38, "hat", "band", z=-0.1, crown=0.78, crown_r=0.46, curl=0.18, tilt=0.1)
    arms(p, sides, "suit", "shirt", "scale", "claw", (0.2, 0.18, 0.16), 1.05)
    legs(p, sides, "suit", (0.3, 0.32, 0.27, 0.22, 0.17), "scale", "claw", 0.2)
    pts = [(0, 1.84, -0.2), (0.14, 1.14, -0.82), (0.7, 0.58, -1.42), (1.6, 0.45, -1.92), (2.4, 0.8, -2.12), (2.56, 1.34, -1.94)]
    tail_with_spots(p, pts, [0.3, 0.26, 0.2, 0.15, 0.1, 0.05], "scale", "diamond", [((0.6, 0.86, -1.42), 0.12, "tail.2"), ((1.6, 0.6, -1.98), 0.095, "tail.3")])
    # The rattle.
    for i in range(3):
        k = i / 2
        p.ellipsoid((2.56 - k * 0.1, 1.42 + i * 0.2, -1.92 + k * 0.12), (0.1 - k * 0.03, 0.1 - k * 0.02, 0.1 - k * 0.03), "rattle", "tail.3", 8, 5)
    merge(p, crossbow(), gun0)
    face = bake_face(p, 1.3, 5.2, 1.7, n=36)

    pz = Poser(bones)
    rest = pz.rest

    def stance(t, T_, recoil=0.0):
        b = sway(t, T_, 2, 0.04)
        pz.R.clear()
        pz.loc.clear()
        pz.place("root", rest["root"] + V((0.16, -0.3 + b, 0.1)))
        pz.aim("root", (0.14, 0.97, -0.06))
        pz.aim("spine", (0.06, 0.97, -0.14))
        pz.aim("chest", (-0.1, 0.96, -0.04))
        pz.aim("neck", (0.12 + sway(t, T_, 1, 0.04), 0.82, 0.42 - b))
        pz.face("head", Matrix.Rotation(-0.26 + sway(t, T_, 1, 0.05, 1.2), 3, "Y") @ Matrix.Rotation(0.12 + b, 3, "X") @ Matrix.Rotation(0.1, 3, "Z"))
        tp = sway(t, T_, 1, 0.16, 0.3)
        pz.aim("tail.1", (0.26, -0.72, -0.64))
        pz.aim("tail.2", (0.72 + tp, -0.5, -0.5))
        pz.aim("tail.3", (0.86 + tp, 0.02, -0.5))
        pz.ik("thigh.L", "shin.L", rest["foot.L"] + V((0.18, 0, 0.95)), (0.2, 0, 1))
        pz.ik("thigh.R", "shin.R", rest["foot.R"] + V((-0.3, 0, -0.5)), (-0.2, 0, 1))
        pz.level("foot.L", 0.2)
        pz.level("foot.R", -0.35)
        chest = pz.world_P("chest")
        # The crossbow carried low across the body in both hands, aimed past the viewer.
        aim = V((-0.42, 0.04 + recoil, 0.9)).normalized()
        grip = chest + V((-0.34, -0.5, 0.72 - recoil))
        pz.place("gun", grip)
        pz.aim("gun", aim, 0.14)
        pz.ik("arm.R", "fore.R", grip + V((0.08, -0.08, -0.1)), (-1, -0.7, -0.4))
        pz.aim("hand.R", aim)
        pz.ik("arm.L", "fore.L", grip + aim * 0.72 + V((0, -0.08, 0)), (1, -0.8, -0.2))
        pz.aim("hand.L", aim)
        return pz.out()

    def clips(arm):
        clips_from(
            arm,
            {
                "idle": (4.0, lambda t: stance(t, 4.0)),
                "pose": (4.0, lambda t: stance(t + 0.7, 4.0)),
                "fire": (1.0, lambda t: stance(t, 1.0, recoil=0.22 * (1 - t) ** 2)),
            },
        )

    finish("snake", p, bones, clips, face=face)


# ----------------------------------------------------------------------------------------- bird


def bird():
    """Judge Buzzard: lanky and funereal. Thin legs in soft talons, a long black coat, a big round bald
    head on a white ruff, a short hooked beak and a tall judge's hat. Eyes are SVG."""
    clear_scene()
    p = Part()
    p.flat = ("gunmetal", "steel", "wood", "drum", "ink")
    j = {"root": (0, 2.42, 0), "spine": (0, 2.8, 0), "chest": (0, 3.2, 0), "neck": (0, 3.72, 0), "head": (0, 4.42, 0.04), "crown": (0, 5.05, 0.0)}
    sides = {
        "shoulder": (0.5, 3.5, 0.0), "elbow": (0.98, 2.76, -0.04), "wrist": (1.1, 2.02, 0.08), "fingers": (1.14, 1.58, 0.14),
        "hip": (0.22, 2.36, 0.0), "knee": (0.28, 1.34, 0.14), "ankle": (0.28, 0.32, -0.08), "toe": (0.28, 0.05, 0.52),
    }
    tail = [(0, 2.34, -0.34), (0, 1.9, -0.66), (0, 1.36, -0.86), (0, 0.86, -0.98)]
    gun0 = (-2.9, 3.0, 2.0)
    bones = skeleton(j, sides, tail, gun0)

    def torso_w(y):
        k = build_rigs.smooth(2.55, 3.15, y)
        if k <= 0.001:
            return {"root": 1.0}
        if k >= 0.999:
            return {"chest": 1.0}
        return {"spine": 1.0 - abs(k - 0.5), "root" if k < 0.5 else "chest": abs(k - 0.5)}

    # Long black coat, a white shirt front, and tails.
    p.lathe([(0.18, 3.72), (0.36, 3.6), (0.54, 3.34), (0.5, 2.9), (0.42, 2.5), (0.48, 2.2)], "coat", torso_w, 24, 1.15, 0.76)
    p.ellipsoid((0, 3.08, 0.27), (0.17, 0.46, 0.13), "shirt", "chest", 12, 10)
    p.ellipsoid((0, 2.36, 0), (0.42, 0.25, 0.3), "coat", "root", 16, 10)
    for sg in (-1, 1):
        p.tube([(sg * 0.3, 2.45, -0.1), (sg * 0.42, 1.9, -0.28), (sg * 0.36, 1.3, -0.46), (sg * 0.24, 0.9, -0.56)], [0.2, 0.24, 0.2, 0.05], "coat", ["root", "tail.1", "tail.2", "tail.3"], 10, 4, squash=(1.0, 0.3))
    # Short breeches, then bare stick legs.
    for side, sg in (("L", 1), ("R", -1)):
        t, n, f = f"thigh.{side}", f"shin.{side}", f"foot.{side}"
        hp, kn, an = (sg * 0.22, 2.36, 0), (sg * 0.28, 1.34, 0.14), (sg * 0.28, 0.32, -0.08)
        p.tube([hp, (sg * 0.27, 1.9, 0.08), (sg * 0.28, 1.5, 0.13)], [0.19, 0.21, 0.13], "pants", [t, t, n], 12, 4)
        p.tube([(sg * 0.28, 1.56, 0.13), kn, an], [0.12, 0.11, 0.1], "leg", [t, n, n], 10, 4)
        heel = (an[0], 0.13, an[2] + 0.1)
        p.ellipsoid(heel, (0.17, 0.12, 0.21), "leg", f, 12, 8)
        for dx in (-1, 0, 1):
            root = (heel[0] + sg * dx * 0.08, 0.1, heel[2] + 0.1)
            knuckle = (root[0] + sg * dx * 0.18, 0.06, root[2] + 0.32)
            p.tube([root, knuckle], [0.07, 0.055], "leg", [f, f], 8, 2)
            p.tube([knuckle, (knuckle[0] + sg * dx * 0.05, 0.03, knuckle[2] + 0.13)], [0.05, 0.018], "claw", [f, f], 8, 1)
        # A back talon.
        p.tube([(heel[0], 0.08, heel[2] - 0.14), (heel[0], 0.03, heel[2] - 0.32)], [0.05, 0.018], "claw", [f, f], 8, 1)
    # A soft white ruff, a big round bald head, and a short hooked beak in two parts.
    p.tube([(0, 3.62, 0), (0, 3.9, 0.0), (0, 4.2, 0.04)], [0.2, 0.2, 0.24], "bare", ["chest", "neck", "head"], 12, 3)
    ring = V((0, 3.72, 0))
    for i in range(7):
        a = i / 7 * 2 * math.pi
        p.ellipsoid(tuple(ring + V((math.cos(a) * 0.38, 0, math.sin(a) * 0.34))), (0.28, 0.19, 0.26), "ruff", "chest", 12, 8)
    p.ellipsoid((0, 4.6, 0.02), (0.8, 0.74, 0.76), "bare", "head", 26, 18)
    p.tube([(0, 4.52, 0.62), (0, 4.52, 0.94), (0, 4.4, 1.2)], [0.25, 0.18, 0.04], "beak", ["head"] * 3, 14, 3)
    p.tube([(0, 4.32, 0.6), (0, 4.28, 0.92)], [0.16, 0.04], "beak2", ["head"] * 2, 12, 2)
    # A tall judge's hat, slightly crooked.
    hat(p, 5.16, 1.2, "hat", "band", z=-0.06, crown=0.95, crown_r=0.44, curl=0.08, tilt=0.03)
    # Ragged wing feathers along coat sleeves.
    arms(p, sides, "coat", "shirt", "leg", "claw", (0.19, 0.17, 0.14), 1.05)
    for side, sg in (("L", 1), ("R", -1)):
        sh = V((sides["shoulder"][0] * sg, sides["shoulder"][1], sides["shoulder"][2]))
        el = V((sides["elbow"][0] * sg, sides["elbow"][1], sides["elbow"][2]))
        wr = V((sides["wrist"][0] * sg, sides["wrist"][1], sides["wrist"][2]))
        for i in range(4):
            k = i / 3
            root = sh.lerp(el, k * 2) if k < 0.5 else el.lerp(wr, (k - 0.5) * 2)
            bone = f"arm.{side}" if k < 0.5 else f"fore.{side}"
            length = 0.9 - abs(k - 0.4) * 0.6
            out = V((sg * (0.55 + k * 0.1), -0.72, -0.2)).normalized()
            mat = "feather" if i % 2 == 0 else "feather2"
            p.tube([tuple(root), tuple(root + out * length * 0.55), tuple(root + out * length)], [0.12, 0.2, 0.02], mat, [bone] * 3, 6, 2, squash=(1.0, 0.25))
    # A fan of tail feathers below the coat.
    for i in range(3):
        k = i - 1
        a0 = (k * 0.2, 2.2, -0.3)
        a1 = (k * 0.42, 1.55, -0.6)
        a2 = (k * 0.6, 0.92, -0.86)
        p.tube([a0, a1, a2], [0.09, 0.16, 0.02], "feather" if i % 2 else "feather2", ["tail.1", "tail.2", "tail.3"], 6, 3, squash=(1.0, 0.25))
    merge(p, long_rifle(), gun0)
    face = bake_face(p, 1.1, 5.4, 1.25, n=36)

    pz = Poser(bones)
    rest = pz.rest

    def stance(t, T_, recoil=0.0):
        b = sway(t, T_, 2, 0.03)
        pz.R.clear()
        pz.loc.clear()
        pz.place("root", rest["root"] + V((0.08, -0.46 + b, 0.1)))
        pz.aim("root", (0.05, 0.92, 0.3))
        pz.aim("spine", (-0.05, 0.86, 0.46))
        pz.aim("chest", (-0.12, 0.76, 0.6))
        pz.aim("neck", (-0.06, 0.74, 0.66 - b))
        pz.face("head", Matrix.Rotation(-0.28, 3, "Y") @ Matrix.Rotation(0.1 + b, 3, "X"))
        pz.aim("tail.1", (0.06, -0.72, -0.68))
        pz.aim("tail.2", (0.14, -0.84, -0.52))
        pz.aim("tail.3", (0.2, -0.86, -0.46))
        pz.ik("thigh.L", "shin.L", rest["foot.L"] + V((0.3, 0, 1.15)), (0.3, 0, 1))
        pz.ik("thigh.R", "shin.R", rest["foot.R"] + V((-0.45, 0, -1.15)), (-0.25, 0, 1))
        pz.level("foot.L", 0.35)
        pz.level("foot.R", -0.55)
        chest = pz.world_P("chest")
        # Rifle shouldered, aimed down at the viewer.
        butt = chest + V((-0.42, 0.32, 0.14 - recoil))
        aim = V((0.2, -0.2 + recoil * 0.5, 1)).normalized()
        grip = butt + aim * 0.85
        pz.place("gun", grip)
        pz.aim("gun", aim)
        pz.ik("arm.R", "fore.R", grip + V((0, -0.08, -0.25)), (-1, -0.8, -0.2))
        pz.aim("hand.R", aim)
        pz.ik("arm.L", "fore.L", grip + aim * 1.0 + V((0, -0.08, 0)), (1, -0.9, -0.2))
        pz.aim("hand.L", aim)
        return pz.out()

    def clips(arm):
        clips_from(
            arm,
            {
                "idle": (4.0, lambda t: stance(t, 4.0)),
                "pose": (4.0, lambda t: stance(t + 1.7, 4.0)),
                "fire": (1.0, lambda t: stance(t, 1.0, recoil=0.2 * (1 - t) ** 2)),
            },
        )

    finish("bird", p, bones, clips, face=face)



if __name__ == "__main__":
    only = os.environ.get("BOSS_ONLY", "")
    for build in (gator, snake, bird):
        if not only or build.__name__ in only.split(","):
            build()
