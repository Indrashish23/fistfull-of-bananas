# Builds the rigged characters from code and exports them as GLB. Run headless from the repo root:
#   "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python lookdev/blender/build_rigs.py
#
# Writes lookdev/assets/monkey.glb and monkey.blend. The first-person arm is built by build_arm.py.
#
# All points below are in game coordinates: x right, y up, z toward the viewer, feet at y = 0.
# The monkey has at most 24 bones so it fits a WebGL 1 uniform budget. Colours are placeholders:
# the page repaints every material by name, which is how one model becomes four monkeys.

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
import json

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "assets"))
FPS = 24

GAME_TO_BLENDER = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))


def G(p):
    return Vector((p[0], -p[2], p[1]))


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def rot_game(x=0.0, y=0.0, z=0.0):
    """Rz * Ry * Rx in game axes, as a 3x3."""
    rx = Matrix.Rotation(x, 3, "X")
    ry = Matrix.Rotation(y, 3, "Y")
    rz = Matrix.Rotation(z, 3, "Z")
    return rz @ ry @ rx


class Part:
    """Collects one mesh's vertices, faces, material names and bone weights."""

    low = False
    # Materials that keep hard edges on a smooth body, like a gun.
    flat = ()

    def __init__(self):
        self.v = []
        self.w = []
        self.f = []
        self.m = []

    def _vert(self, p, weights):
        self.v.append(tuple(p))
        self.w.append(weights)
        return len(self.v) - 1

    def ellipsoid(self, c, r, mat, bone, segs=16, rings=10, R=None, zmin=None):
        """Outward-facing ellipsoid. zmin keeps only the front part, for lids."""
        weight_fn = bone if callable(bone) else None
        w = bone if isinstance(bone, dict) else {bone: 1.0}
        idx = []
        for i in range(rings + 1):
            th = math.pi * i / rings
            row = []
            for j in range(segs):
                ph = 2 * math.pi * j / segs
                local = Vector((math.sin(th) * math.cos(ph) * r[0], math.cos(th) * r[1], math.sin(th) * math.sin(ph) * r[2]))
                if zmin is not None:
                    local.z = max(local.z, zmin)
                if R is not None:
                    local = R @ local
                row.append(self._vert((c[0] + local.x, c[1] + local.y, c[2] + local.z), weight_fn(local) if weight_fn else w))
            idx.append(row)
        for i in range(rings):
            for j in range(segs):
                a = idx[i][j]
                b = idx[i + 1][j]
                cc = idx[i + 1][(j + 1) % segs]
                d = idx[i][(j + 1) % segs]
                self.f.append((a, d, cc, b))
                self.m.append(mat)

    def tube(self, pts, radii, mat, bones, sides=10, sub=5, squash=None):
        """Smooth round tube along a Catmull-Rom path, with rounded ends. Weights blend between
        the bone on each control point, so joints bend without tearing."""
        n = len(pts)
        P = [Vector(p) for p in pts]

        def cr(i, t):
            p0 = P[max(0, i - 1)]
            p1 = P[i]
            p2 = P[min(n - 1, i + 1)]
            p3 = P[min(n - 1, i + 2)]
            return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t)

        samples = []
        for i in range(n - 1):
            for s in range(sub):
                t = s / sub
                samples.append((cr(i, t), radii[i] + (radii[i + 1] - radii[i]) * t, i, t))
        samples.append((P[-1], radii[-1], n - 2, 1.0))

        def wt(i, t):
            a = bones[i]
            b = bones[i + 1]
            if a == b:
                return {a: 1.0}
            k = smooth(0.25, 0.75, t)
            if k <= 0.001:
                return {a: 1.0}
            if k >= 0.999:
                return {b: 1.0}
            return {a: 1 - k, b: k}

        # Rounded ends: extra rings past each end.
        first_t = (samples[1][0] - samples[0][0]).normalized()
        last_t = (samples[-1][0] - samples[-2][0]).normalized()
        r0 = radii[0]
        r1 = radii[-1]
        cap_rows = ((0.6, 0.6),) if self.low else ((0.82, 0.5), (0.5, 0.82), (0.2, 0.97))
        start_caps = [(samples[0][0] - first_t * r0 * d, r0 * s, 0, 0.0) for d, s in cap_rows]
        end_caps = [(samples[-1][0] + last_t * r1 * d, r1 * s, n - 2, 1.0) for d, s in reversed(cap_rows)]
        rows = start_caps + samples + end_caps

        normal = None
        rings = []
        for k, (p, rad, i, t) in enumerate(rows):
            nxt = rows[min(k + 1, len(rows) - 1)][0]
            prv = rows[max(k - 1, 0)][0]
            tan = (nxt - prv).normalized()
            if normal is None:
                up = Vector((0, 1, 0)) if abs(tan.y) < 0.9 else Vector((1, 0, 0))
                normal = tan.cross(up).normalized()
            else:
                normal = (normal - tan * normal.dot(tan)).normalized()
            bin_ = tan.cross(normal)
            row = []
            for s in range(sides):
                ang = 2 * math.pi * s / sides
                sq = squash or (1.0, 1.0)
                off = normal * math.cos(ang) * rad * sq[0] + bin_ * math.sin(ang) * rad * sq[1]
                row.append(self._vert(p + off, wt(i, t)))
            rings.append(row)
        for i in range(len(rings) - 1):
            for s in range(sides):
                a = rings[i][s]
                b = rings[i][(s + 1) % sides]
                c = rings[i + 1][(s + 1) % sides]
                d = rings[i + 1][s]
                self.f.append((a, b, c, d))
                self.m.append(mat)
        self.f.append(tuple(rings[-1]))
        self.m.append(mat)
        self.f.append(tuple(reversed(rings[0])))
        self.m.append(mat)

    def lathe(self, prof, mat, bone_at, sides=24, sx=1.0, sz=1.0, cz=0.0, cap=True):
        """Surface of revolution round y. prof is (radius, y), top to bottom, so it faces outward."""
        rows = []
        for (r, y) in prof:
            row = []
            w = bone_at(y)
            for s in range(sides):
                a = 2 * math.pi * s / sides
                row.append(self._vert((math.cos(a) * r * sx, y, cz + math.sin(a) * r * sz), w))
            rows.append(row)
        for i in range(len(rows) - 1):
            for s in range(sides):
                a = rows[i][s]
                d = rows[i][(s + 1) % sides]
                c = rows[i + 1][(s + 1) % sides]
                b = rows[i + 1][s]
                self.f.append((a, d, c, b))
                self.m.append(mat)
        if cap:
            self.f.append(tuple(reversed(rows[0])))
            self.m.append(mat)
            self.f.append(tuple(rows[-1]))
            self.m.append(mat)


class LowPart(Part):
    """The same shapes in chunky, simple topology, for the enemies: few sides, faceted, tiny bits simplest."""

    low = True

    def ellipsoid(self, c, r, mat, bone, segs=16, rings=10, R=None, zmin=None):
        tiny = max(r) < 0.07
        return super().ellipsoid(c, r, mat, bone, 5 if tiny else min(segs, 8), 3 if tiny else min(rings, 5), R, zmin)

    def tube(self, pts, radii, mat, bones, sides=10, sub=5, squash=None):
        tiny = max(radii) < 0.07
        return super().tube(pts, radii, mat, bones, 4 if tiny else min(sides, 6), 1 if tiny else min(sub, 2), squash)

    def lathe(self, prof, mat, bone_at, sides=24, sx=1.0, sz=1.0, cz=0.0, cap=True):
        return super().lathe(prof, mat, bone_at, min(sides, 8), sx, sz, cz, cap)


MATERIALS = {}


def material(name):
    if name in MATERIALS:
        return MATERIALS[name]
    m = bpy.data.materials.new(name)
    h = abs(hash(name))
    m.diffuse_color = (((h >> 3) % 100) / 100, ((h >> 7) % 100) / 100, ((h >> 11) % 100) / 100, 1)
    m.use_nodes = False
    MATERIALS[name] = m
    return m


def make_armature(name, bones):
    """bones: list of (name, parent, head, tail) in game coordinates."""
    data = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for (b, parent, head, tail) in bones:
        e = data.edit_bones.new(b)
        e.head = G(head)
        e.tail = G(tail)
        if parent:
            e.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def make_mesh(name, part, arm):
    mesh = bpy.data.meshes.new(name)
    verts = [G(p) for p in part.v]
    mesh.from_pydata(verts, [], part.f)
    names = []
    for m in part.m:
        if m not in names:
            names.append(m)
            mesh.materials.append(material(m))
    index = {n: i for i, n in enumerate(names)}
    mesh.polygons.foreach_set("material_index", [index[m] for m in part.m])
    mesh.polygons.foreach_set("use_smooth", [not part.low and m not in part.flat for m in part.m])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    groups = {}
    for i, w in enumerate(part.w):
        for bone, weight in w.items():
            if bone not in groups:
                groups[bone] = obj.vertex_groups.new(name=bone)
            groups[bone].add([i], weight, "REPLACE")
    obj.parent = arm
    mod = obj.modifiers.new("rig", "ARMATURE")
    mod.object = arm
    return obj


def apply_pose(arm, pose):
    """pose: {bone: {"rot": (x, y, z), "loc": (x, y, z)}} in game axes around each pivot."""
    C = GAME_TO_BLENDER
    for pb in arm.pose.bones:
        A = pb.bone.matrix_local.to_3x3()
        q = pose.get(pb.name, {})
        R = C @ rot_game(*q.get("rot", (0, 0, 0))) @ C.transposed()
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (A.inverted() @ R @ A).to_quaternion()
        pb.location = A.inverted() @ G(q.get("loc", (0, 0, 0)))


def bake_clip(arm, name, duration, fn, step=2):
    """fn(t) returns {bone: {"rot": (x, y, z), "loc": (x, y, z)}} in game axes around each pivot."""
    arm.animation_data_create()
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    arm.animation_data.action = action
    frames = max(2, round(duration * FPS))
    for frame in range(0, frames + 1, step):
        t = frame / FPS
        apply_pose(arm, fn(t))
        for pb in arm.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=frame + 1, group=pb.name)
            pb.keyframe_insert("location", frame=frame + 1, group=pb.name)
    return action


def clear_pose(arm):
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)


def export(arm, meshes, path):
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = arm
    arm.animation_data.action = None
    clear_pose(arm)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_step=1,
        export_optimize_animation_size=False,
        export_skins=True,
        export_morph=False,
        export_all_influences=False,
        export_def_bones=False,
        export_materials="EXPORT",
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
    )


# ------------------------------------------------------------------------------------ monkey

MONKEY_BONES = [
    ("root", None, (0, 0.78, 0), (0, 0.9, 0)),
    ("spine", "root", (0, 0.9, 0), (0, 1.06, 0)),
    ("chest", "spine", (0, 1.06, 0), (0, 1.22, 0)),
    ("head", "chest", (0, 1.22, 0), (0, 1.62, 0)),
    ("hat", "head", (0, 2.1, 0), (0, 2.45, 0)),
    ("ear.L", "head", (-0.56, 1.8, 0), (-0.86, 1.8, 0)),
    ("ear.R", "head", (0.56, 1.8, 0), (0.86, 1.8, 0)),
    ("arm.L", "chest", (-0.38, 1.13, 0), (-0.66, 0.82, 0.04)),
    ("fore.L", "arm.L", (-0.66, 0.82, 0.04), (-0.76, 0.48, 0.08)),
    ("hand.L", "fore.L", (-0.76, 0.48, 0.08), (-0.8, 0.28, 0.12)),
    ("arm.R", "chest", (0.38, 1.13, 0), (0.66, 0.82, 0.04)),
    ("fore.R", "arm.R", (0.66, 0.82, 0.04), (0.76, 0.48, 0.08)),
    ("hand.R", "fore.R", (0.76, 0.48, 0.08), (0.8, 0.28, 0.12)),
    ("thigh.L", "root", (-0.2, 0.68, 0), (-0.22, 0.38, 0)),
    ("shin.L", "thigh.L", (-0.22, 0.38, 0), (-0.23, 0.08, 0)),
    ("thigh.R", "root", (0.2, 0.68, 0), (0.22, 0.38, 0)),
    ("shin.R", "thigh.R", (0.22, 0.38, 0), (0.23, 0.08, 0)),
    ("tail.1", "root", (0, 0.74, -0.24), (0, 0.56, -0.56)),
    ("tail.2", "tail.1", (0, 0.56, -0.56), (0, 0.76, -0.86)),
    ("tail.3", "tail.2", (0, 0.76, -0.86), (0, 1.2, -0.84)),
    ("sign", "root", (0, 0.95, 0.5), (0, 1.2, 0.5)),
]


def build_monkey_mesh():
    p = Part()
    # Body.
    p.ellipsoid((0, 0.66, 0), (0.33, 0.22, 0.26), "pants", "root")
    p.ellipsoid((0, 0.94, 0), (0.39, 0.36, 0.31), "fur", "spine", 18, 12)
    p.ellipsoid((0, 0.92, 0.12), (0.28, 0.3, 0.21), "belly", "spine", 14, 10)

    def chest_w(y):
        k = smooth(0.82, 1.1, y)
        return {"spine": 1 - k, "chest": k} if 0.001 < k < 0.999 else ({"chest": 1.0} if k >= 0.999 else {"spine": 1.0})

    # Poncho, with woven stripes that sit just proud of it.
    p.lathe([(0.2, 1.27), (0.28, 1.2), (0.38, 1.06), (0.46, 0.88), (0.5, 0.73), (0.48, 0.7)], "poncho", chest_w, 28, 1.0, 0.82)
    p.lathe([(0.43, 0.97), (0.447, 0.97), (0.476, 0.89), (0.46, 0.89)], "stripe", chest_w, 28, 1.0, 0.82)
    p.lathe([(0.49, 0.77), (0.507, 0.77), (0.522, 0.73), (0.505, 0.73)], "stripe", chest_w, 28, 1.0, 0.82)
    # Neck scarf with a knot.
    p.lathe([(0.2, 1.33), (0.27, 1.3), (0.31, 1.25), (0.28, 1.19), (0.2, 1.17)], "scarf", chest_w, 22, 1.0, 0.9)
    p.ellipsoid((0, 1.19, 0.28), (0.08, 0.07, 0.06), "scarf", "chest", 10, 7)

    # Head: big, round and soft.
    H = (0, 1.74, 0)
    p.ellipsoid(H, (0.65, 0.58, 0.56), "fur", "head", 32, 22)
    # The face itself is a flat vector sheet added by the page (see faces.ts).

    # Round ears with a concentric inner ring.
    for s, b in ((-1, "ear.L"), (1, "ear.R")):
        c = (s * 0.76, 1.8, -0.02)
        p.ellipsoid(c, (0.31, 0.33, 0.1), "fur", b, 24, 14)
        p.ellipsoid((c[0], c[1], c[2] + 0.045), (0.215, 0.235, 0.08), "skin", b, 20, 12)
        p.ellipsoid((c[0], c[1], c[2] + 0.075), (0.12, 0.13, 0.06), "earin", b, 16, 10)

    # Long monkey arms.
    for s, side in ((-1, "L"), (1, "R")):
        a = f"arm.{side}"
        f = f"fore.{side}"
        h = f"hand.{side}"
        p.ellipsoid((s * 0.4, 1.12, 0), (0.16, 0.15, 0.15), "poncho", a, 14, 10)
        p.tube([(s * 0.38, 1.13, 0), (s * 0.66, 0.82, 0.04), (s * 0.76, 0.48, 0.08)], [0.115, 0.1, 0.085], "fur", [a, f, h], 12, 6)
        # Hand: palm and four soft fingers with bare skin.
        pc = (s * 0.785, 0.38, 0.1)
        p.ellipsoid(pc, (0.1, 0.12, 0.085), "skin", h, 14, 10)
        for i in range(3):
            x = s * (0.72 + i * 0.058)
            p.tube([(x, 0.32, 0.12), (x + s * 0.006, 0.23, 0.14), (x + s * 0.004, 0.17, 0.12)], [0.033, 0.03, 0.027], "skin", [h, h, h], 8, 3)
        p.tube([(s * 0.72, 0.42, 0.16), (s * 0.69, 0.33, 0.2), (s * 0.7, 0.27, 0.2)], [0.034, 0.03, 0.026], "skin", [h, h, h], 8, 3)

        # Short legs in big boots.
        t = f"thigh.{side}"
        n = f"shin.{side}"
        p.tube([(s * 0.2, 0.7, 0), (s * 0.22, 0.38, 0), (s * 0.23, 0.28, 0)], [0.15, 0.125, 0.12], "pants", [t, n, n], 12, 4)
        p.lathe([(0.148, 0.44), (0.138, 0.3), (0.145, 0.1)], "boot", lambda y: {n: 1.0}, 16, 1.0, 1.0)
        for v in p.v[-48:]:
            pass
        p.ellipsoid((s * 0.23, 0.11, 0.08), (0.165, 0.11, 0.27), "boot", n, 16, 10)
        p.ellipsoid((s * 0.23, 0.02, 0.06), (0.17, 0.03, 0.28), "sole", n, 14, 6)
    # lathe builds on the y axis, so boots are placed afterward.
    return p


def loft(p, stations, mat, bone, sides=18, sub=3):
    """A smooth closed shape through (y, z, half width, half height) stations, along z, at x = 0."""
    if p.low:
        sides = min(sides, 10)
        sub = 1
    rows = []
    n = len(stations)

    def at(i, t):
        s0 = stations[max(0, i - 1)]
        s1 = stations[i]
        s2 = stations[min(n - 1, i + 1)]
        s3 = stations[min(n - 1, i + 2)]
        return tuple(0.5 * (2 * s1[k] + (s2[k] - s0[k]) * t + (2 * s0[k] - 5 * s1[k] + 4 * s2[k] - s3[k]) * t * t + (3 * s1[k] - s0[k] - 3 * s2[k] + s3[k]) * t * t * t) for k in range(4))

    for i in range(n - 1):
        for j in range(sub + (1 if i == n - 2 else 0)):
            y, z, rx, ry = at(i, j / sub)
            rx = max(rx, 0.004)
            ry = max(ry, 0.004)
            row = []
            for q in range(sides):
                a = 2 * math.pi * q / sides
                row.append(p._vert((math.cos(a) * rx, y + math.sin(a) * ry, z), {bone: 1.0}))
            rows.append(row)
    for r0, r1 in zip(rows, rows[1:]):
        for q in range(sides):
            w = (q + 1) % sides
            p.f.append((r0[q], r0[w], r1[w], r1[q]))
            p.m.append(mat)
    p.f.append(tuple(reversed(rows[0])))
    p.m.append(mat)
    p.f.append(tuple(rows[-1]))
    p.m.append(mat)


def flames(p, pts, radii, bones, height, tongues, seed, squash=1.0):
    """Paints flames up a limb, like hot-rod flames on a shoe: long tongues licking off the cuff, leaning
    round as they rise, in orange with a red heart. pts run from the cuff upward, and match the limb."""
    P = [Vector(q) for q in pts]
    samples = 18

    def along(s):
        k = s * (len(P) - 1)
        i = min(int(k), len(P) - 2)
        f = k - i
        p0, p1, p2, p3 = P[max(0, i - 1)], P[i], P[i + 1], P[min(len(P) - 1, i + 2)]
        c = 0.5 * ((2 * p1) + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f * f * f)
        r = radii[i] + (radii[i + 1] - radii[i]) * f
        return c, r, bones[i if f < 0.5 else i + 1]

    def point(theta, s, lift):
        c, r, bone = along(s)
        c2, _, _ = along(min(1.0, s + 0.03))
        c0, _, _ = along(max(0.0, s - 0.03))
        t = (c2 - c0).normalized()
        ref = Vector((0, 0, 1)) if abs(t.z) < 0.85 else Vector((1, 0, 0))
        u = t.cross(ref).normalized()
        v = u.cross(t).normalized()
        # Measure the angle from the front of the limb, so tongues are placed where they will be seen.
        o = c + (u * math.cos(theta) + v * math.sin(theta) * squash) * (r + lift)
        return tuple(o), bone, c

    def layer(mat, scale, lift, skew, phase):
        cols = 16
        rows = 2
        grid = []
        for i in range(cols + 1):
            a = i / cols * 2 * math.pi
            # Tall tongues alternate with short ones, each with a pointed tip.
            w = abs(math.sin(a * tongues / 2 + phase + seed))
            tall = 0.55 + 0.45 * abs(math.sin(a * tongues / 4 + seed * 2.3))
            h = height * scale * (0.16 + 0.84 * tall * w ** 2.6)
            col = []
            for j in range(rows + 1):
                s = h * j / rows
                # Tongues lean as they climb, so they read as licks and not spikes.
                col.append(point(a + skew * (s / max(height, 0.001)) ** 1.3, s, lift))
            grid.append(col)
        for i in range(cols):
            for j in range(rows):
                corners = [grid[x][y] for x, y in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))]
                ids = [p._vert(q[0], {q[1]: 1.0}) for q in corners]
                # Wound so the outside is the front, whichever way the limb runs. The game culls the
                # back of every face, and Blender merges two faces on the same points, so one is all it gets.
                a, b, d = (Vector(corners[k][0]) for k in (0, 1, 3))
                outward = a - corners[0][2]
                if (b - a).cross(d - a).dot(outward) < 0:
                    ids.reverse()
                p.f.append(tuple(ids))
                p.m.append(mat)

    layer("flameOrange", 1.0, 0.02, 0.9, 0.0)
    layer("flameRed", 0.56, 0.028, 0.7, 0.32)


def lay_on(p, tree, rows, mat, weight, back=False, lift=0.012):
    """A flat strip lying on a surface, so straps and ties can't float: rows are (x, y, half width)."""
    z0, dz = (-5.0, 1.0) if back else (5.0, -1.0)
    grid = []
    for (x, y, half) in rows:
        row = []
        for u in (x - half, x, x + half):
            hit = tree.ray_cast(Vector((u, y, z0)), Vector((0, 0, dz)))
            z = hit[0][2] if hit[0] is not None else 0.0
            row.append(p._vert((u, y, z - dz * lift), weight(y) if callable(weight) else weight))
        grid.append(row)
    for r0, r1 in zip(grid, grid[1:]):
        for k in range(2):
            # rows run top to bottom, so this order faces outward from the front.
            face = (r0[k], r1[k], r1[k + 1], r0[k + 1])
            p.f.append(tuple(reversed(face)) if back else face)
            p.m.append(mat)


def wind_outward(p):
    """Every closed piece must face out: the game culls back faces, so one wound inward shows its far
    wall through its near side. Open sheets, like flames and straps, keep the winding they were given."""
    parent = list(range(len(p.v)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for f in p.f:
        for v in f[1:]:
            parent[find(v)] = find(f[0])
    pieces = {}
    for n, f in enumerate(p.f):
        pieces.setdefault(find(f[0]), []).append(n)
    flipped = 0
    for faces in pieces.values():
        edges = {}
        for n in faces:
            f = p.f[n]
            for a, b in zip(f, f[1:] + f[:1]):
                key = (min(a, b), max(a, b))
                edges[key] = edges.get(key, 0) + 1
        if any(c != 2 for c in edges.values()):
            continue
        verts = {i for n in faces for i in p.f[n]}
        mid = sum((Vector(p.v[i]) for i in verts), Vector((0, 0, 0))) / len(verts)
        volume = 0.0
        for n in faces:
            f = p.f[n]
            a = Vector(p.v[f[0]]) - mid
            for k in range(1, len(f) - 1):
                volume += a.dot((Vector(p.v[f[k]]) - mid).cross(Vector(p.v[f[k + 1]]) - mid))
        if volume < 0:
            flipped += 1
            for n in faces:
                p.f[n] = tuple(reversed(p.f[n]))
    return flipped


def build_lizard_mesh(flame=False):
    """The home screen's little gangster lizards, on the monkey's bones so every clip, sign pose and
    ragdoll still fits. Soft and round: a big round head with a slight point, a pear of a body, stubby
    limbs and mitten hands. Eyes, mouth and every other facial detail are flat SVG art on a sheet fitted
    to the head (see bake_lizard_face), so the head itself stays smooth."""
    p = Part()

    def chest_w(y):
        k = smooth(0.82, 1.1, y)
        return {"spine": 1 - k, "chest": k} if 0.001 < k < 0.999 else ({"chest": 1.0} if k >= 0.999 else {"spine": 1.0})

    # A pear of a body in a shirt, with a soft collar.
    start = len(p.f)
    p.lathe([(0.1, 1.34), (0.2, 1.3), (0.27, 1.22), (0.31, 1.1), (0.33, 0.98), (0.33, 0.86), (0.3, 0.74), (0.25, 0.68)], "poncho", chest_w, 18, 1.0, 0.84)
    tree = BVHTree.FromPolygons([Vector(v) for v in p.v], [p.f[n] for n in range(start, len(p.f))], all_triangles=False)
    p.ellipsoid((0, 1.28, 0), (0.25, 0.065, 0.22), "belly", "chest", 16, 8)
    # Suspenders and a little tie, lying on the shirt.
    for s in (-1, 1):
        strap = [(s * 0.17, 1.27, 0.024), (s * 0.19, 1.12, 0.024), (s * 0.2, 0.98, 0.024), (s * 0.18, 0.84, 0.024)]
        lay_on(p, tree, strap, "stripe", chest_w)
        lay_on(p, tree, strap, "stripe", chest_w, back=True)
    lay_on(p, tree, [(0, 1.24, 0.03), (0, 1.16, 0.036), (0, 1.03, 0.07), (0, 0.95, 0.004)], "scarf", chest_w)
    knot = tree.ray_cast(Vector((0, 1.23, 5.0)), Vector((0, 0, -1)))[0]
    p.ellipsoid((0, 1.23, knot[2] + 0.015), (0.055, 0.045, 0.035), "scarf", "chest", 10, 6)

    # Round trousers.
    p.ellipsoid((0, 0.72, 0), (0.35, 0.235, 0.29), "pants", "root", 18, 10)

    # A big round head with just a slight point, sitting straight on the body.
    p.tube([(0, 1.2, 0), (0, 1.42, 0)], [0.2, 0.22], "fur", ["chest", "head"], 12, 2)
    loft(p, [(1.74, -0.56, 0.02, 0.02), (1.74, -0.5, 0.27, 0.25), (1.74, -0.3, 0.52, 0.46), (1.74, -0.02, 0.63, 0.54), (1.72, 0.24, 0.58, 0.5), (1.67, 0.46, 0.4, 0.35), (1.61, 0.66, 0.2, 0.17), (1.58, 0.82, 0.07, 0.06), (1.57, 0.88, 0.01, 0.01)], "fur", "head", 20, 2)

    # A short fat tail, curling up to a soft tip.
    pts = [(0, 0.66, -0.16), (0.1, 0.42, -0.46), (0.36, 0.3, -0.72), (0.66, 0.42, -0.84), (0.84, 0.68, -0.74)]
    p.tube(pts, [0.2, 0.17, 0.13, 0.085, 0.025], "fur", ["root", "tail.1", "tail.2", "tail.3", "tail.3"], 10, 4)

    for s, side in ((-1, "L"), (1, "R")):
        a = f"arm.{side}"
        f = f"fore.{side}"
        h = f"hand.{side}"
        # A soft sleeve and cuff, and a mitten of a hand around the weapon grip, with three little claws.
        p.tube([(s * 0.33, 1.14, 0), (s * 0.66, 0.82, 0.04), (s * 0.75, 0.54, 0.075)], [0.115, 0.105, 0.095], "poncho", [a, f, f], 10, 4)
        p.tube([(s * 0.745, 0.55, 0.073), (s * 0.757, 0.49, 0.08)], [0.112, 0.112], "belly", [f, f], 10, 1)
        p.ellipsoid((s * 0.785, 0.36, 0.105), (0.13, 0.135, 0.12), "fur", h, 12, 8)
        for (x, z, lean) in ((0.7, 0.13, -0.03), (0.785, 0.16, 0.0), (0.87, 0.13, 0.03)):
            p.tube([(s * x, 0.27, z), (s * (x + lean), 0.18, z + 0.02)], [0.042, 0.014], "sole", [h, h], 6, 1)

        # Stubby round legs, and big soft feet with three little claws.
        t = f"thigh.{side}"
        n = f"shin.{side}"
        p.tube([(s * 0.2, 0.7, 0), (s * 0.24, 0.46, 0.01), (s * 0.23, 0.22, 0)], [0.19, 0.19, 0.145], "pants", [t, t, n], 12, 3)
        if flame:
            flames(p, [(s * 0.23, 0.22, 0), (s * 0.24, 0.46, 0.01), (s * 0.2, 0.7, 0)], [0.145, 0.19, 0.19], [n, n, t], 0.62, 4, 0.6 + s)
            flames(p, [(s * 0.75, 0.54, 0.075), (s * 0.66, 0.82, 0.04), (s * 0.33, 1.14, 0)], [0.095, 0.105, 0.115], [f, f, a], 0.62, 3, 1.4 + s)
        p.ellipsoid((s * 0.23, 0.1, 0.09), (0.155, 0.1, 0.215), "fur", n, 12, 8)
        for dx in (-0.09, 0.0, 0.09):
            p.tube([(s * 0.23 + dx, 0.07, 0.27), (s * 0.23 + dx * 1.25, 0.035, 0.37)], [0.038, 0.014], "sole", [n, n], 6, 1)
    if flame:
        # Flames off the shirt hem too, climbing the body.
        flames(p, [(0, 0.84, 0), (0, 0.94, 0), (0, 1.06, 0), (0, 1.2, 0)], [0.33, 0.34, 0.32, 0.28], ["spine", "spine", "spine", "chest"], 0.5, 5, 2.2, 0.84)
    build_hat(p, 1.04, 0.88)
    print("LIZARD pieces turned to face out:", wind_outward(p), "tris", sum(len(f) - 2 for f in p.f))
    return p


def bake_lizard_face(p):
    """Fits the flat face to the lizard's head: rays from the front onto every head-bone face, on a
    grid the page draws. Art's eyes sit 46% down and 14% each side, and its mouth 70% down, so this
    puts big eyes on the round of the head and the mouth where it comes to its point."""
    verts = [Vector(v) for v in p.v]
    head = [f for f in p.f if all(max(p.w[i], key=p.w[i].get) == "head" for i in f)]
    tree = BVHTree.FromPolygons(verts, head, all_triangles=False)
    eye_x, eye_y, mouth_y = 0.21, 1.86, 1.6
    half = eye_x / 0.28
    span = (eye_y - mouth_y) / 0.24
    top = eye_y + span * 0.46
    n = 32
    grid = []
    for j in range(n + 1):
        y = top - span * j / n
        row = []
        for i in range(n + 1):
            x = (i / n * 2 - 1) * half
            hit = tree.ray_cast(Vector((x, y, 5.0)), Vector((0, 0, -1)))
            row.append(None if hit[0] is None else [round(x, 4), round(y, 4), round(hit[0][2] + 0.012, 4)])
        grid.append(row)
    path = os.path.normpath(os.path.join(OUT, "..", "lizardFaceData.ts"))
    with open(path, "w", encoding="utf8", newline="") as fh:
        fh.write("// Generated by blender/build_rigs.py: the lizard's face sheet, fitted to its head. Null is off the head.\n")
        fh.write("export const LIZARD_FACE: (null | [number, number, number])[][] = " + json.dumps(grid, separators=(",", ":")) + ";\n")
    print("LIZARD_FACE points", sum(1 for r in grid for c in r if c), "of", (n + 1) ** 2)


def place_boots(p):
    """Boot shafts were lathed at x = 0: slide each onto its leg."""
    moved = []
    for i, (x, y, z) in enumerate(p.v):
        w = p.w[i]
        if len(w) == 1 and ("shin.L" in w or "shin.R" in w) and abs(x) < 0.16 and 0.09 < y < 0.45 and abs(z) < 0.16:
            s = -1 if "shin.L" in w else 1
            moved.append((i, (x + s * 0.225, y, z)))
    for i, v in moved:
        p.v[i] = v


def build_hat(p, rx=1.06, rz=0.84):
    """Crown and curled brim."""
    by = 2.1
    sides = 12 if p.low else 40
    rows = 2 if p.low else 5
    grid_top = []
    grid_bot = []

    def edge(a, k):
        c = math.cos(a)
        s = math.sin(a)
        curl = 0.3 * (c * c) * (k ** 3)
        dip = 0.05 * (s * s) * (k ** 2)
        return (c * rx * k, by + curl - dip, s * rz * k)

    for r in range(rows + 1):
        k = 0.42 + (1 - 0.42) * r / rows
        rt = []
        rb = []
        for j in range(sides):
            a = 2 * math.pi * j / sides
            e = edge(a, k)
            rt.append(p._vert((e[0], e[1] + 0.025, e[2]), {"hat": 1.0}))
            rb.append(p._vert((e[0], e[1] - 0.025, e[2]), {"hat": 1.0}))
        grid_top.append(rt)
        grid_bot.append(rb)
    for r in range(rows):
        for j in range(sides):
            n = (j + 1) % sides
            p.f.append((grid_top[r][j], grid_top[r][n], grid_top[r + 1][n], grid_top[r + 1][j]))
            p.m.append("hat")
            p.f.append((grid_bot[r][j], grid_bot[r + 1][j], grid_bot[r + 1][n], grid_bot[r][n]))
            p.m.append("hatunder")
    for j in range(sides):
        n = (j + 1) % sides
        p.f.append((grid_top[rows][j], grid_top[rows][n], grid_bot[rows][n], grid_bot[rows][j]))
        p.m.append("hat")
    hb = lambda y: {"hat": 1.0}
    p.lathe([(0.47, by + 0.14), (0.49, by + 0.02)], "band", hb, 28, 1.0, 0.92)
    p.lathe([(0.2, by + 0.54), (0.33, by + 0.52), (0.42, by + 0.4), (0.46, by + 0.14), (0.47, by)], "hat", hb, 28, 1.0, 0.86)
    # Pinched crown top.
    p.ellipsoid((0, by + 0.53, 0), (0.2, 0.03, 0.15), "hatdent", "hat", 16, 6)


# ------------------------------------------------------------------------------- weights

# Which bones each body part may blend into. Head and hat stay rigid, because a big round head
# that squashes reads as broken. Everything between them bends softly.
BLEND = {
    "root": ["root", "spine", "thigh.L", "thigh.R", "tail.1"],
    "spine": ["root", "spine", "chest"],
    # No arms here: the poncho and chest stay rigid, or a raised arm drags the whole torso's skin.
    "chest": ["spine", "chest", "head"],
    "arm.L": ["chest", "arm.L", "fore.L"],
    "fore.L": ["arm.L", "fore.L", "hand.L"],
    "hand.L": ["fore.L", "hand.L"],
    "arm.R": ["chest", "arm.R", "fore.R"],
    "fore.R": ["arm.R", "fore.R", "hand.R"],
    "hand.R": ["fore.R", "hand.R"],
    "thigh.L": ["root", "thigh.L", "shin.L"],
    "shin.L": ["thigh.L", "shin.L"],
    "thigh.R": ["root", "thigh.R", "shin.R"],
    "shin.R": ["thigh.R", "shin.R"],
    "tail.1": ["root", "tail.1", "tail.2"],
    "tail.2": ["tail.1", "tail.2", "tail.3"],
    "tail.3": ["tail.2", "tail.3"],
    "ear.L": ["head", "ear.L"],
    "ear.R": ["head", "ear.R"],
    "head": ["head"],
    "hat": ["hat"],
}

# Some neighbours get less pull, so a lolling head doesn't drag the scarf out of shape.
PULL = {"head": 0.15, "tail.1": 0.5}


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.dot(ab), 1e-6)))
    return (a + ab * t - p).length


def paint_weights(part, bones):
    """First pass, by distance to each allowed bone: a vertex midway along a limb belongs to that
    bone, and one at a joint is shared evenly. Blender's smoothing then softens it (see below)."""
    seg = {name: (Vector(head), Vector(tail)) for (name, _, head, tail) in bones}
    out = []
    for p, w in zip(part.v, part.w):
        main = max(w, key=w.get)
        allowed = BLEND.get(main, [main])
        if len(allowed) == 1:
            out.append({main: 1.0})
            continue
        pv = Vector(p)
        raw = {}
        for b in allowed:
            d = seg_dist(pv, *seg[b])
            raw[b] = ((1.0 if b == main else PULL.get(b, 1.0)) / (d + 0.025)) ** 5
        top = sorted(raw.items(), key=lambda kv: -kv[1])[:3]
        total = sum(v for _, v in top)
        out.append({b: v / total for b, v in top})
    return out


def write_weights(obj, weights):
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    groups = {}
    for i, w in enumerate(weights):
        for bone, weight in w.items():
            if bone not in groups:
                groups[bone] = obj.vertex_groups.new(name=bone)
            groups[bone].add([i], weight, "REPLACE")


def soften_in_blender(obj):
    """Blender's own weight tools: smooth along the surface, keep the top 4, normalise."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.object.vertex_group_smooth(group_select_mode="ALL", factor=0.5, repeat=4, expand=0.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)


def limp(t, T=8.0):
    """A collapsed, floppy body: every joint near its limit, the way a ragdoll lands."""
    w = lambda r, sd: wobble(t, T, r, sd)
    return {
        "root": {"rot": (0.35 * w(0.25, 1.0), 0.15 * w(0.25, 2.0), 0.3 * w(0.25, 3.0))},
        "spine": {"rot": (0.5 + 0.28 * w(0.25, 4.0), 0, 0.28 * w(0.25, 5.0))},
        "chest": {"rot": (0.4 + 0.28 * w(0.25, 6.0), 0, 0.22 * w(0.25, 7.0))},
        "head": {"rot": (0.55 * w(0.25, 8.0), 0.5 * w(0.25, 9.0), 0.5 * w(0.25, 10.0))},
        "arm.L": {"rot": (-1.1 + 0.9 * w(0.25, 11.0), 0, -1.3 + 0.9 * w(0.25, 12.0))},
        "fore.L": {"rot": (-1.15 - 0.85 * abs(w(0.25, 13.0)), 0, 0)},
        "hand.L": {"rot": (0.7 * w(0.25, 14.0), 0, 0.5 * w(0.25, 15.0))},
        "arm.R": {"rot": (-1.1 + 0.9 * w(0.25, 16.0), 0, 1.3 + 0.9 * w(0.25, 17.0))},
        "fore.R": {"rot": (-1.15 - 0.85 * abs(w(0.25, 18.0)), 0, 0)},
        "hand.R": {"rot": (0.7 * w(0.25, 19.0), 0, 0.5 * w(0.25, 20.0))},
        "thigh.L": {"rot": (-1.0 + 0.5 * w(0.25, 21.0), 0, -0.45 + 0.3 * w(0.25, 22.0))},
        "shin.L": {"rot": (1.3 + 0.75 * abs(w(0.25, 23.0)), 0, 0)},
        "thigh.R": {"rot": (-1.0 + 0.5 * w(0.25, 24.0), 0, 0.45 + 0.3 * w(0.25, 25.0))},
        "shin.R": {"rot": (1.3 + 0.75 * abs(w(0.25, 26.0)), 0, 0)},
        "tail.1": {"rot": (0.6 * w(0.25, 27.0), 0.7 * w(0.25, 28.0), 0)},
        "tail.2": {"rot": (0.6 * w(0.25, 29.0), 0.8 * w(0.25, 30.0), 0)},
        "tail.3": {"rot": (0.6 * w(0.25, 31.0), 0.8 * w(0.25, 32.0), 0)},
        "ear.L": {"rot": (0, 0, 0.3 * w(0.25, 33.0))},
        "ear.R": {"rot": (0, 0, 0.3 * w(0.25, 34.0))},
    }


def stretch_report(arm, obj, label):
    """Measures how badly the skin deforms across extreme poses. Near 1.0 means nothing tore."""
    me0 = obj.data
    rest = [(me0.vertices[e.vertices[0]].co.copy(), me0.vertices[e.vertices[1]].co.copy()) for e in me0.edges]
    worst = 1.0
    bad = 0
    total = 0
    for k in range(9):
        apply_pose(arm, limp(k * 0.95))
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = obj.evaluated_get(dg)
        me = ev.to_mesh()
        for e, (a, b) in zip(me.edges, rest):
            r0 = (a - b).length
            if r0 < 0.004:
                continue
            r = (me.vertices[e.vertices[0]].co - me.vertices[e.vertices[1]].co).length / r0
            total += 1
            if r > 1.8:
                bad += 1
            worst = max(worst, r)
        ev.to_mesh_clear()
    clear_pose(arm)
    bpy.context.view_layer.update()
    return {"label": label, "worst_stretch": round(worst, 2), "edges_over_1.8x_pct": round(100 * bad / max(total, 1), 2)}


T_SIDE = ("L", "R")


def wobble(t, T, rate, seed=0.0):
    """Uneven motion, -1..1, around `rate` Hz. Layered sines at unrelated speeds never settle into
    an obvious beat. Every layer does a whole number of cycles in T, so the clip still loops."""
    total = 0.0
    weight = 0.0
    for mult, amp, ph in ((1.0, 1.0, 0.0), (0.61, 0.8, 1.9), (1.73, 0.55, 4.1), (0.37, 0.6, 2.7)):
        cycles = max(1, round(rate * mult * T))
        total += math.sin(2 * math.pi * cycles * t / T + ph + seed * (1 + mult)) * amp
        weight += amp
    return total / weight * 1.35


def spells(t, T, seed=0.0):
    """0..1: comes and goes every few seconds, so a shake arrives in fits rather than constantly."""
    return smooth(-0.15, 0.45, wobble(t, T, 0.24, seed))


def reach(side, wrist, tip=None, hand=None, pole=None):
    """Two-bone IK for an arm, in the chest's own space. The wrist goes to wrist, and the hand points at tip,
    or is held at the world rotation hand. Returns the pose, and the hand's world rotation."""
    sg = 1 if side == "R" else -1
    bones = {n: (Vector(h), Vector(t)) for (n, _, h, t) in MONKEY_BONES}
    sh, el = bones[f"arm.{side}"]
    _, wr = bones[f"fore.{side}"]
    _, ti = bones[f"hand.{side}"]
    L1, L2 = (el - sh).length, (wr - el).length
    t = Vector(wrist)
    v = t - sh
    d = min(max(v.length, abs(L1 - L2) + 1e-3), (L1 + L2) * 0.998)
    n = v.normalized()
    a = (L1 * L1 - L2 * L2 + d * d) / (2 * d)
    lift = math.sqrt(max(0.0, L1 * L1 - a * a))
    p = Vector(pole or (sg * 1.0, -0.4, -0.45))
    perp = (p - n * p.dot(n)).normalized()
    joint = sh + n * a + perp * lift
    end = sh + n * d
    R1 = (el - sh).normalized().rotation_difference((joint - sh).normalized()).to_matrix()
    W2 = (wr - el).normalized().rotation_difference((end - joint).normalized()).to_matrix()
    if hand is None:
        aim = (Vector(tip) - end).normalized() if tip else (ti - wr).normalized()
        hand = (ti - wr).normalized().rotation_difference(aim).to_matrix()
    R2 = R1.inverted() @ W2
    R3 = W2.inverted() @ hand

    def euler(m):
        e = m.to_euler("XYZ")
        return (e.x, e.y, e.z)

    return {f"arm.{side}": {"rot": euler(R1)}, f"fore.{side}": {"rot": euler(R2)}, f"hand.{side}": {"rot": euler(R3)}}, hand


def monkey_clips(arm):
    def S(rate, t, ph=0.0):
        return math.sin(2 * math.pi * rate * t + ph)

    def base(t, per):
        """Shared life: breath, tail, bobble, hat lag. per is the loop length."""
        k = lambda hz: max(1, round(hz * per)) / per
        b = S(k(0.33), t)
        head = (S(k(0.17), t) * 0.04, S(k(0.17), t, 1.2) * 0.1, S(k(0.33), t, 0.4) * 0.05)
        return {
            "spine": {"rot": (b * 0.018, 0, 0)},
            "chest": {"rot": (b * 0.018, 0, 0)},
            "head": {"rot": head},
            "hat": {"rot": (0, 0, -S(k(0.33), t, -0.2) * 0.035)},
            "ear.L": {"rot": (0, 0, S(k(0.17), t, 0.6) * 0.05)},
            "ear.R": {"rot": (0, 0, -S(k(0.17), t, 1.2) * 0.05)},
            "tail.1": {"rot": (0, S(k(0.17), t) * 0.28, 0)},
            "tail.2": {"rot": (S(k(0.33), t) * 0.1, S(k(0.17), t, -0.7) * 0.42, 0)},
            "tail.3": {"rot": (0, S(k(0.17), t, -1.4) * 0.5, 0)},
            "arm.L": {"rot": (0, 0, -0.04 - b * 0.02)},
            "arm.R": {"rot": (0, 0, 0.04 + b * 0.02)},
            "fore.L": {"rot": (-0.18, 0, 0)},
            "fore.R": {"rot": (-0.18, 0, 0)},
            "root": {"loc": (0, b * 0.006, 0)},
        }

    # Slow idle.
    bake_clip(arm, "idle", 6.0, lambda t: base(t, 6.0))

    # Crab walk: one big side-to-side cycle every second.
    def crab(t):
        p = base(t, 2.0)
        c = 2 * math.pi * t
        step = math.sin(c)
        lift = abs(math.cos(c))
        p["root"] = {"loc": (0, lift * 0.08 - 0.03, 0), "rot": (0.08, 0, step * 0.07)}
        p["spine"] = {"rot": (0.12, 0, -step * 0.06)}
        p["head"] = {"rot": (-0.06, 0, step * 0.13)}
        p["hat"] = {"rot": (0, 0, -step * 0.1), "loc": (0, (1 - lift) * 0.03, 0)}
        p["thigh.L"] = {"rot": (-0.35, 0, -0.3 - step * 0.38)}
        p["shin.L"] = {"rot": (0.48 + max(0, step) * 0.4, 0, 0.28 + step * 0.3)}
        p["thigh.R"] = {"rot": (-0.35, 0, 0.3 - step * 0.38)}
        p["shin.R"] = {"rot": (0.48 + max(0, -step) * 0.4, 0, -0.28 + step * 0.3)}
        p["arm.L"] = {"rot": (-0.25, 0, -0.6 - step * 0.28)}
        p["fore.L"] = {"rot": (-0.5, 0, -0.1)}
        p["arm.R"] = {"rot": (-0.25, 0, 0.6 - step * 0.28)}
        p["fore.R"] = {"rot": (-0.5, 0, 0.1)}
        p["tail.1"] = {"rot": (0, -step * 0.55, 0)}
        p["tail.2"] = {"rot": (0.2, -step * 0.65, 0)}
        return p

    bake_clip(arm, "crab", 2.0, crab, 1)

    # Shout: mouth a black hole, tongue out, fists out, shaking with rage in uneven fits.
    def shout(t):
        T = 7.0
        p = base(t, T)
        rage = 0.75 + 0.25 * wobble(t, T, 0.22, 1.0)
        fit = spells(t, T, 0.4)
        shake = wobble(t, T, 2.4, 2.0) * 0.022 * (0.25 + 0.75 * fit)
        shake2 = wobble(t, T, 1.9, 5.0) * 0.022 * (0.25 + 0.75 * fit)
        lean = wobble(t, T, 0.3, 3.0)
        p["root"] = {"rot": (-0.1 + lean * 0.03, 0, shake * 0.5), "loc": (0, abs(shake2) * 0.25, 0)}
        p["spine"] = {"rot": (-0.12 - lean * 0.04, 0, shake)}
        p["chest"] = {"rot": (-0.05, 0, 0)}
        p["head"] = {"rot": (-0.1 + shake2, shake + lean * 0.06, shake * 1.5)}
        p["hat"] = {"rot": (-0.1, 0, shake * 2), "loc": (0, 0.04 + abs(wobble(t, T, 1.3, 8.0)) * 0.05 * fit, 0)}
        p["arm.L"] = {"rot": (-0.1, 0, -1.2 - rage * 0.25 + shake2 * 2)}
        p["fore.L"] = {"rot": (-0.5, 0, -1.2)}
        p["arm.R"] = {"rot": (-0.1, 0, 1.2 + rage * 0.25 + shake * 2)}
        p["fore.R"] = {"rot": (-0.5, 0, 1.2)}
        p["thigh.L"] = {"rot": (0, 0, -0.18)}
        p["shin.L"] = {"rot": (0.05, 0, 0.18)}
        p["thigh.R"] = {"rot": (0, 0, 0.18)}
        p["shin.R"] = {"rot": (0.05, 0, -0.18)}
        p["tail.1"] = {"rot": (-0.5, shake * 4, 0)}
        p["tail.2"] = {"rot": (-0.5, shake2 * 6, 0)}
        return p

    bake_clip(arm, "shout", 7.0, shout, 2)

    # Taunt: hands by the ears, tongue out, swaying unhurriedly and not quite in time.
    def taunt(t):
        T = 8.0
        p = base(t, T)
        sway = wobble(t, T, 0.42, 1.0)
        hop = abs(wobble(t, T, 0.42, 1.0)) * 0.7
        waggle = wobble(t, T, 1.0, 2.0)
        p["root"] = {"rot": (0, 0, sway * 0.08), "loc": (0, hop * 0.045, 0)}
        p["spine"] = {"rot": (0, 0, -sway * 0.05)}
        p["head"] = {"rot": (0.04, sway * 0.16, -sway * 0.18)}
        for s, side in ((-1, "L"), (1, "R")):
            p[f"arm.{side}"] = {"rot": (-0.25, 0, s * (2.15 + sway * s * 0.07))}
            p[f"fore.{side}"] = {"rot": (0.3, 0, s * 1.15)}
            p[f"hand.{side}"] = {"rot": (wobble(t, T, 1.1, 3.0 + s) * 0.3, 0, 0)}
        p["ear.L"] = {"rot": (0, 0, -wobble(t, T, 0.7, 6.0) * 0.1)}
        p["ear.R"] = {"rot": (0, 0, wobble(t, T, 0.7, 7.0) * 0.1)}
        p["thigh.L"] = {"rot": (-0.1, 0, -0.14 - sway * 0.08)}
        p["thigh.R"] = {"rot": (-0.1, 0, 0.14 - sway * 0.08)}
        p["tail.1"] = {"rot": (-0.2, sway * 0.5, 0)}
        p["tail.2"] = {"rot": (0, wobble(t, T, 0.42, 3.0) * 0.7, 0)}
        return p

    bake_clip(arm, "taunt", 8.0, taunt, 2)

    # Hide: crouched behind the raised sign, trembling in fits, peeking at uneven moments.
    def hide(t):
        T = 12.0
        p = base(t, T)
        peek = smooth(0.32, 0.72, wobble(t, T, 0.14, 1.0))
        fit = spells(t, T, 2.0)
        shiver = wobble(t, T, 2.1, 3.0) * 0.013 * (0.2 + 0.8 * fit) * (1 - peek * 0.5)
        shiver2 = wobble(t, T, 1.7, 6.0) * 0.013 * (0.2 + 0.8 * fit) * (1 - peek * 0.5)
        drop = -0.52 + peek * 0.2
        p["root"] = {"loc": (shiver, drop, -0.26), "rot": (0.0, 0, shiver2)}
        p["spine"] = {"rot": (0.08 - peek * 0.04, 0, shiver * 1.5)}
        p["chest"] = {"rot": (0.04, 0, 0)}
        p["head"] = {"rot": (-0.12, wobble(t, T, 0.3, 4.0) * 0.26 * peek, shiver2 * 2)}
        p["hat"] = {"rot": (0.1, 0, shiver * 3), "loc": (0, abs(shiver2) * 1.5, 0)}
        for s, side in ((-1, "L"), (1, "R")):
            p[f"thigh.{side}"] = {"rot": (-1.2, 0, s * 0.32)}
            p[f"shin.{side}"] = {"rot": (1.7, 0, -s * 0.2)}
            p[f"arm.{side}"] = {"rot": (-1.05, 0, s * 0.62)}
            p[f"fore.{side}"] = {"rot": (-0.95, 0, -s * 0.45)}
        p["ear.L"] = {"rot": (0, 0, 0.3)}
        p["ear.R"] = {"rot": (0, 0, -0.3)}
        p["tail.1"] = {"rot": (0.5, 0, 0)}
        p["tail.2"] = {"rot": (0.3, shiver2 * 8, 0)}
        p["sign"] = {"loc": (shiver * 0.5, 0.86 - peek * 0.3, 0.56)}
        return p

    bake_clip(arm, "hide", 12.0, hide, 2)

    # Nervous: knees knocking in fits, wringing hands, glancing about and gulping now and then.
    def nervous(t):
        T = 10.0
        p = base(t, T)
        fit = spells(t, T, 4.0)
        knock = wobble(t, T, 1.5, 1.0) * (0.2 + 0.8 * fit)
        glance = max(-1, min(1, wobble(t, T, 0.2, 2.0) * 1.5))
        gulp = max(0.0, wobble(t, T, 0.18, 6.0)) ** 5
        shiver = wobble(t, T, 2.2, 3.0) * 0.009 * (0.2 + 0.8 * fit)
        p["root"] = {"loc": (shiver, -0.04 + gulp * 0.03, 0), "rot": (0.05, 0, shiver)}
        p["spine"] = {"rot": (0.1, 0, shiver)}
        p["chest"] = {"rot": (0.06, 0, 0), "loc": (0, 0.012 + gulp * 0.02, 0)}
        p["head"] = {"rot": (0.04 - gulp * 0.1, glance * 0.34, shiver * 2)}
        p["hat"] = {"rot": (0, 0, shiver * 2)}
        p["ear.L"] = {"rot": (0, 0, 0.16)}
        p["ear.R"] = {"rot": (0, 0, -0.16)}
        for s, side in ((-1, "L"), (1, "R")):
            wring = wobble(t, T, 0.8, 5.0 + s)
            p[f"thigh.{side}"] = {"rot": (-0.22, 0, -s * 0.07 + knock * 0.05)}
            p[f"shin.{side}"] = {"rot": (0.3, 0, s * 0.1 - knock * 0.06)}
            p[f"arm.{side}"] = {"rot": (-0.55 + wring * 0.03, 0, s * 0.26)}
            p[f"fore.{side}"] = {"rot": (-0.82, 0, -s * 0.55)}
            p[f"hand.{side}"] = {"rot": (wring * 0.16, 0, -s * 0.2)}
        p["tail.1"] = {"rot": (0.3, wobble(t, T, 0.6, 8.0) * 0.24, 0)}
        p["tail.2"] = {"rot": (0.1, wobble(t, T, 0.9, 9.0) * 0.32, 0)}
        return p

    bake_clip(arm, "nervous", 10.0, nervous, 2)

    # Draw: lift, level, one shot, lower.
    def draw(t):
        T = 2.4
        p = base(t, T)
        ease = smooth(0.0, 0.4, t) * (1 - smooth(1.9, 2.4, t))
        kick = math.exp(-(t - 1.1) * 12) if t > 1.1 else 0.0
        p["spine"] = {"rot": (0.04, -0.28 * ease, 0)}
        p["head"] = {"rot": (0.02, 0.32 * ease, 0.05 * ease)}
        p["arm.R"] = {"rot": (-1.45 * ease - kick * 0.42, -0.08 * ease, 0.3 - 0.14 * ease)}
        p["fore.R"] = {"rot": (-0.18 + 0.15 * ease - kick * 0.46, 0, 0)}
        p["thigh.L"] = {"rot": (0, 0, -0.2)}
        p["thigh.R"] = {"rot": (0, 0, 0.2)}
        return p

    bake_clip(arm, "draw", 2.4, draw, 1)

    # Hit: whipped back, arms flung, hat in the air and back on.
    def hit(t):
        T = 2.0
        u = min(1.0, t / T)
        p = base(t, T)
        out = math.sin(min(1, u * 3.2) * math.pi * 0.5)
        settle = (1 - u) ** 2
        v = out * (0.35 + 0.65 * settle)
        p["root"] = {"rot": (-0.22 * v, 0, 0)}
        p["spine"] = {"rot": (-0.5 * v, 0, 0)}
        p["chest"] = {"rot": (-0.32 * v, 0, 0)}
        p["head"] = {"rot": (-0.68 * v + math.sin(u * 24) * 0.14 * settle, 0, math.sin(u * 18) * 0.2 * settle)}
        for s, side in ((-1, "L"), (1, "R")):
            p[f"arm.{side}"] = {"rot": (-0.8 * v, 0, s * 1.85 * v)}
            p[f"fore.{side}"] = {"rot": (-0.55 * v, 0, 0)}
        p["thigh.L"] = {"rot": (-0.65 * v, 0, -0.18 * v)}
        p["shin.L"] = {"rot": (0.72 * v, 0, 0)}
        p["thigh.R"] = {"rot": (-0.14 * v, 0, 0.18 * v)}
        p["shin.R"] = {"rot": (0.42 * v, 0, 0)}
        p["tail.1"] = {"rot": (-0.8 * v, math.sin(u * 14) * 0.6 * settle, 0)}
        p["tail.2"] = {"rot": (-0.7 * v, math.sin(u * 20) * 0.7 * settle, 0)}
        p["sign"] = {"rot": (0.35 * v, 0, 0.26 * v)}
        h = max(0.0, 4 * u * (1 - u))
        p["hat"] = {"rot": (u * 6.283, 0, math.sin(u * 6) * 0.36 * settle), "loc": (0, h * 1.2, -h * 0.45)}
        return p

    bake_clip(arm, "hit", 2.0, hit, 1)

    # A heavy, deliberate forward walk: one full cycle of two steps.
    def walk(t):
        T = 1.6
        p = base(t, T)
        c = 2 * math.pi * t / T
        step = math.sin(c)
        p["root"] = {"loc": (0, abs(math.cos(c)) * 0.05 - 0.02, 0), "rot": (0.05, step * 0.08, step * 0.03)}
        p["spine"] = {"rot": (0.04, -step * 0.09, 0)}
        p["head"] = {"rot": (0.02, step * 0.04, -step * 0.03)}
        p["thigh.L"] = {"rot": (-step * 0.55, 0, 0)}
        p["shin.L"] = {"rot": (max(0.0, step) * 0.8 + 0.08, 0, 0)}
        p["thigh.R"] = {"rot": (step * 0.55, 0, 0)}
        p["shin.R"] = {"rot": (max(0.0, -step) * 0.8 + 0.08, 0, 0)}
        p["arm.L"] = {"rot": (step * 0.42, 0, -0.08)}
        p["fore.L"] = {"rot": (-0.3, 0, 0)}
        p["arm.R"] = {"rot": (-step * 0.42, 0, 0.08)}
        p["fore.R"] = {"rot": (-0.3, 0, 0)}
        p["tail.1"] = {"rot": (0, -step * 0.2, 0)}
        p["tail.2"] = {"rot": (0, -step * 0.3, 0)}
        return p

    bake_clip(arm, "walk", 1.6, walk, 1)

    # Brings a revolver up beside his face, and thumbs the hammer back.
    def cock(t):
        T = 2.0
        p = base(t, T)
        up = smooth(0.0, 0.35, t)
        thumb = math.exp(-(t - 0.62) * 14) if t > 0.62 else 0.0
        p["spine"] = {"rot": (0.04, -0.2 * up, 0)}
        p["head"] = {"rot": (0.1 * up, 0.14 * up, -0.05 * up)}
        p["arm.R"] = {"rot": (-0.22 * up, 0.1 * up, 0.24 + 0.62 * up)}
        p["fore.R"] = {"rot": (-1.42 * up + thumb * 0.1, 0, 0.3 * up)}
        p["thigh.L"] = {"rot": (0, 0, -0.2)}
        p["thigh.R"] = {"rot": (0, 0, 0.2)}
        return p

    bake_clip(arm, "cock", 2.0, cock, 1)

    # A real run. Contact at full stride, down over the planted leg, push off, then airborne with the
    # legs split. Two hops per cycle, a strong forward lean, big arm pumps, and the tail counter-swinging.
    RUN = 0.6

    def run_body(t, weapon=False):
        c = 2 * math.pi * t / RUN
        s = math.sin(c)
        co = math.cos(c)
        lean = 0.4 if not weapon else 0.34
        p = {}
        p["root"] = {"loc": (0, abs(s) * 0.17 - 0.08, 0), "rot": (lean, s * 0.16, co * 0.04)}
        p["spine"] = {"rot": (0.05, -s * 0.2, 0)}
        p["chest"] = {"rot": (0.05, -s * 0.14, 0)}
        p["head"] = {"rot": (-lean * 0.95, s * 0.1, -co * 0.03)}
        p["hat"] = {"rot": (-0.1 - abs(s) * 0.12, 0, s * 0.05), "loc": (0, abs(co) * 0.03, 0)}
        p["ear.L"] = {"rot": (0, 0, abs(s) * 0.12)}
        p["ear.R"] = {"rot": (0, 0, -abs(s) * 0.12)}
        # Thighs swing about a line tipped back by the lean, so the legs stay under him.
        p["thigh.L"] = {"rot": (-1.0 * s - lean + 0.12, 0, -0.05)}
        p["shin.L"] = {"rot": (0.25 + 1.6 * max(0.0, co) ** 1.3, 0, 0)}
        p["thigh.R"] = {"rot": (1.0 * s - lean + 0.12, 0, 0.05)}
        p["shin.R"] = {"rot": (0.25 + 1.6 * max(0.0, -co) ** 1.3, 0, 0)}
        p["arm.L"] = {"rot": (1.05 * s - 0.15, 0, -0.2)}
        p["fore.L"] = {"rot": (-1.35 + co * 0.2, 0, 0)}
        if not weapon:
            p["arm.R"] = {"rot": (-1.05 * s - 0.15, 0, 0.2)}
            p["fore.R"] = {"rot": (-1.35 - co * 0.2, 0, 0)}
        else:
            # Heavier: the weapon is carried up by the shoulder, bouncing with each stride.
            p["arm.R"] = {"rot": (-0.95 + abs(s) * 0.14, -0.1, 0.38)}
            p["fore.R"] = {"rot": (-1.55 + abs(co) * 0.16, 0, 0)}
        p["tail.1"] = {"rot": (-0.32, s * 0.42, 0)}
        p["tail.2"] = {"rot": (co * 0.14, math.sin(c - 0.7) * 0.5, 0)}
        p["tail.3"] = {"rot": (0, math.sin(c - 1.4) * 0.6, 0)}
        return p

    bake_clip(arm, "run", RUN, lambda t: run_body(t), 1)
    bake_clip(arm, "run_weapon", RUN, lambda t: run_body(t, True), 1)

    # A big overhead chop: rear back, drive down through the target, follow through, recover.
    def swing(t):
        T = 0.62
        p = base(t, T)
        up = smooth(0.0, 0.2, t)
        chop = smooth(0.2, 0.31, t)
        rec = smooth(0.44, T, t)
        high = up * (1 - chop)
        through = chop * (1 - rec)
        p["root"] = {"loc": (0, -0.1 * through + 0.03 * high, 0.09 * through - 0.03 * high), "rot": (0.1 * through - 0.05 * high, 0.14 * high - 0.1 * through, 0)}
        p["spine"] = {"rot": (0.48 * through - 0.24 * high, 0.26 * high - 0.2 * through, 0)}
        p["chest"] = {"rot": (0.26 * through - 0.14 * high, 0.14 * high - 0.1 * through, 0)}
        p["head"] = {"rot": (-0.5 * through + 0.22 * high, -0.2 * high + 0.1 * through, 0)}
        # Out to the side and the wrist cocked, so the weapon stands up clear of the big hat.
        p["arm.R"] = {"rot": (-2.3 * high - 0.5 * through - 0.1 * rec, -0.1 * high, 0.82 * high + 0.12)}
        p["fore.R"] = {"rot": (-0.55 * high - 0.15 * through - 0.18 * rec, 0, 0)}
        p["hand.R"] = {"rot": (1.15 * high - 0.2 * through, 0, 0)}
        p["arm.L"] = {"rot": (-0.6 * high + 0.55 * through, 0, -0.42 * high - 0.3 * through - 0.05)}
        p["fore.L"] = {"rot": (-0.9 * high - 0.3, 0, 0)}
        p["thigh.L"] = {"rot": (-0.2 * high - 0.72 * through, 0, -0.16)}
        p["shin.L"] = {"rot": (0.2 * high + 0.5 * through, 0, 0)}
        p["thigh.R"] = {"rot": (0.28 * through + 0.05 * high, 0, 0.16)}
        p["shin.R"] = {"rot": (0.18 * through, 0, 0)}
        p["hat"] = {"rot": (-0.2 * through + 0.1 * high, 0, 0), "loc": (0, 0.05 * chop * (1 - smooth(0.31, 0.44, t)), 0)}
        p["tail.1"] = {"rot": (-0.2 * through, -0.3 * high + 0.3 * through, 0)}
        p["tail.2"] = {"rot": (0, -0.4 * high + 0.45 * through, 0)}
        p["tail.3"] = {"rot": (0, -0.5 * high + 0.6 * through, 0)}
        return p

    bake_clip(arm, "swing", 0.62, swing, 1)

    # An overhand throw: turn side-on with the arm cocked behind the head and the other arm pointing,
    # then whip through. The bottle leaves at THROW_RELEASE.
    THROW_RELEASE = 0.5

    def throw(t):
        T = 1.0
        p = base(t, T)
        wind = smooth(0.0, 0.38, t)
        whip = smooth(0.42, 0.6, t)
        rec = smooth(0.72, T, t)
        back = wind * (1 - whip)
        through = whip * (1 - rec)
        p["root"] = {"loc": (0, -0.08 * back - 0.05 * through, -0.06 * back + 0.1 * through), "rot": (-0.1 * back + 0.14 * through, 0.12 * back - 0.3 * through, 0)}
        p["spine"] = {"rot": (-0.22 * back + 0.34 * through, 0.16 * back - 0.42 * through, 0)}
        p["chest"] = {"rot": (-0.12 * back + 0.2 * through, 0.1 * back - 0.26 * through, 0)}
        p["head"] = {"rot": (0.2 * back - 0.36 * through, -0.26 * back + 0.56 * through, 0)}
        # Held out wide of the hat on the wind-up, so the bottle shows against the sky.
        p["arm.R"] = {"rot": (-2.3 * back - 0.75 * through, -0.3 * through, 0.14 - 0.62 * back)}
        p["fore.R"] = {"rot": (-0.95 * back - 0.25 * through - 0.18 * rec, 0, 0)}
        p["hand.R"] = {"rot": (0.9 * back, 0, 0)}
        # The other arm aims at the target, then swings down and back.
        p["arm.L"] = {"rot": (-1.5 * back + 0.5 * through, 0.2 * back, -0.22 * back - 0.25 * through - 0.05)}
        p["fore.L"] = {"rot": (-0.1 * back - 0.8 * through - 0.18, 0, 0)}
        p["thigh.L"] = {"rot": (-0.55 * back - 0.72 * through, 0, -0.18)}
        p["shin.L"] = {"rot": (0.3 * back + 0.4 * through, 0, 0)}
        p["thigh.R"] = {"rot": (0.12 * back + 0.4 * through, 0, 0.18)}
        p["shin.R"] = {"rot": (0.4 * back + 0.25 * through, 0, 0)}
        p["hat"] = {"rot": (0.12 * back - 0.2 * through, 0, 0)}
        p["tail.1"] = {"rot": (0, -0.4 * back + 0.4 * through, 0)}
        p["tail.2"] = {"rot": (0, -0.45 * back + 0.5 * through, 0)}
        p["tail.3"] = {"rot": (0, -0.55 * back + 0.65 * through, 0)}
        return p

    bake_clip(arm, "throw", 1.0, throw, 1)

    # Ducked right down and waddling like a penguin: squatting on short quick steps, the whole body
    # rocking from foot to foot, arms stuck out to the sides and flapping, tail wagging for balance.
    WADDLE = 0.5

    def waddle(t):
        c = 2 * math.pi * t / WADDLE
        s = math.sin(c)
        co = math.cos(c)
        hunch = 0.36
        p = {}
        p["root"] = {"loc": (s * 0.05, -0.22 + abs(co) * 0.035, 0), "rot": (hunch, s * 0.06, s * 0.2)}
        p["spine"] = {"rot": (0.12, 0, -s * 0.05)}
        p["chest"] = {"rot": (0.14, 0, -s * 0.05)}
        # The head comes back up to look at you, and sinks into the shoulders.
        p["head"] = {"rot": (-hunch - 0.2, -s * 0.05, -s * 0.13), "loc": (0, -0.09, 0)}
        p["hat"] = {"rot": (0.05, 0, s * 0.1)}
        p["ear.L"] = {"rot": (0, 0, -0.12 + s * 0.1)}
        p["ear.R"] = {"rot": (0, 0, 0.12 + s * 0.1)}
        # Each foot lifts only when the weight has rocked off it.
        lift_l = max(0.0, s)
        lift_r = max(0.0, -s)
        p["thigh.L"] = {"rot": (-1.0 - hunch - lift_l * 0.32, 0, -0.26)}
        p["shin.L"] = {"rot": (1.3 + lift_l * 0.32, 0, 0.1)}
        p["thigh.R"] = {"rot": (-1.0 - hunch - lift_r * 0.32, 0, 0.26)}
        p["shin.R"] = {"rot": (1.3 + lift_r * 0.32, 0, -0.1)}
        # Stiff little wings.
        flap = math.sin(c * 2) * 0.12
        p["arm.L"] = {"rot": (-0.1, 0, -0.72 - flap)}
        p["fore.L"] = {"rot": (-0.05, 0, -0.1)}
        p["hand.L"] = {"rot": (0, 0, -0.35 - flap * 1.6)}
        p["arm.R"] = {"rot": (-0.1, 0, 0.72 + flap)}
        p["fore.R"] = {"rot": (-0.05, 0, 0.1)}
        p["hand.R"] = {"rot": (0, 0, 0.35 + flap * 1.6)}
        p["tail.1"] = {"rot": (-0.2, s * 0.5, 0)}
        p["tail.2"] = {"rot": (0, math.sin(c - 0.7) * 0.55, 0)}
        p["tail.3"] = {"rot": (0, math.sin(c - 1.4) * 0.65, 0)}
        return p

    bake_clip(arm, "waddle", WADDLE, waddle, 1)

    # A shield's carried low at the left side, with its face outward, then swung up in front in both hands.
    # The arms are placed by IK, so its edges really sit in the hands, whatever the rest of the body does.
    MARCH = 0.72
    UP_L, UP_R = Vector((-0.62, 1.04, 0.44)), Vector((0.62, 1.04, 0.44))
    TIP_L, TIP_R = Vector((-0.5, 1.04, 0.64)), Vector((0.5, 1.04, 0.64))
    DOWN_L = Vector((-0.74, 0.8, -0.1))
    HANG_R = Vector((0.68, 0.62, 0.12))
    _, HAND_UP = reach("L", UP_L, TIP_L)
    HAND_DOWN = Matrix.Rotation(-0.85, 3, "Y") @ HAND_UP

    def shield_arms(p, u=1.0, drive=0.0, bob=0.0, right=True):
        """u is how far up the shield is: 0 at the side, 1 in front. drive is a hit pushing it back at him."""
        hit = Vector((0, 0.02 * drive + bob, -0.16 * drive))
        hand = HAND_DOWN.to_quaternion().slerp(HAND_UP.to_quaternion(), u).to_matrix()
        # It swings out and around on the way up, rather than cutting through him.
        swing = Vector((-0.12, 0.0, 0.2)) * math.sin(u * math.pi)
        pose, _ = reach("L", DOWN_L.lerp(UP_L, u) + swing + hit, hand=hand)
        p.update(pose)
        if right:
            k = smooth(0.45, 1.0, u)
            pose, _ = reach("R", HANG_R.lerp(UP_R, k) + hit * k, HANG_R.lerp(TIP_R, k) + Vector((0, -0.2 * (1 - k), 0)) + hit * k)
            p.update(pose)

    def shield_walk(t):
        c = 2 * math.pi * t / MARCH
        s = math.sin(c)
        co = math.cos(c)
        lean = 0.15
        p = {}
        p["root"] = {"loc": (0, abs(s) * 0.05 - 0.06, 0), "rot": (lean, s * 0.05, co * 0.025)}
        p["spine"] = {"rot": (0.04, -s * 0.05, 0)}
        p["chest"] = {"rot": (0.04, -s * 0.03, 0)}
        p["head"] = {"rot": (-lean - 0.07, s * 0.02, 0)}
        p["hat"] = {"rot": (-abs(s) * 0.05, 0, s * 0.03)}
        p["thigh.L"] = {"rot": (-0.62 * s - lean + 0.04, 0, -0.06)}
        p["shin.L"] = {"rot": (0.15 + 0.95 * max(0.0, co) ** 1.3, 0, 0)}
        p["thigh.R"] = {"rot": (0.62 * s - lean + 0.04, 0, 0.06)}
        p["shin.R"] = {"rot": (0.15 + 0.95 * max(0.0, -co) ** 1.3, 0, 0)}
        shield_arms(p, 1.0, 0.0, abs(s) * 0.02)
        p["tail.1"] = {"rot": (-0.2, s * 0.25, 0)}
        p["tail.2"] = {"rot": (0, math.sin(c - 0.7) * 0.3, 0)}
        p["tail.3"] = {"rot": (0, math.sin(c - 1.4) * 0.4, 0)}
        return p

    bake_clip(arm, "shield_walk", MARCH, shield_walk, 1)

    # A bullet hits the shield: it's driven back into the chest, the body rocks back, then he
    # shoves it out again and comes on.
    def shield_hit(t):
        T = 0.42
        hit = smooth(0.0, 0.05, t) * (1 - smooth(0.1, T, t))
        p = shield_walk(0.0)
        p["root"] = {"loc": (0, -0.06 - hit * 0.04, -hit * 0.16), "rot": (0.15 - hit * 0.3, 0, hit * 0.06)}
        p["spine"] = {"rot": (0.04 - hit * 0.12, 0, 0)}
        p["chest"] = {"rot": (0.04 - hit * 0.1, 0, 0)}
        p["head"] = {"rot": (-0.22 + hit * 0.42, 0, -hit * 0.08)}
        p["hat"] = {"rot": (-hit * 0.2, 0, 0), "loc": (0, hit * 0.06, 0)}
        p["thigh.L"] = {"rot": (-0.12 + hit * 0.25, 0, -0.1)}
        p["thigh.R"] = {"rot": (-0.32 - hit * 0.2, 0, 0.1)}
        p["shin.R"] = {"rot": (0.3 + hit * 0.25, 0, 0)}
        shield_arms(p, 1.0, hit)
        return p

    bake_clip(arm, "shield_hit", 0.42, shield_hit, 1)

    # Running with it down at his side, the free arm pumping.
    def shield_carry(t):
        p = run_body(t)
        shield_arms(p, 0.0, 0.0, abs(math.sin(2 * math.pi * t / RUN)) * 0.03, right=False)
        return p

    bake_clip(arm, "shield_carry", RUN, shield_carry, 1)

    # Standing about with it, waiting his moment.
    def shield_idle(t):
        T = 2.0
        p = base(t, T)
        shield_arms(p, 0.0, 0.0, math.sin(2 * math.pi * t / T) * 0.015, right=False)
        return p

    bake_clip(arm, "shield_idle", 2.0, shield_idle, 2)

    # The lift: a dip to get under its weight, a heave up and across, past the mark, and a settle behind it.
    def shield_raise(t):
        T = 0.6
        u = smooth(0.06, 0.38, t)
        over = smooth(0.34, 0.42, t) * (1 - smooth(0.42, T, t))
        dip = smooth(0.0, 0.1, t) * (1 - smooth(0.1, 0.3, t))
        settle = smooth(0.36, 0.44, t) * (1 - smooth(0.44, T, t))
        p = shield_walk(0.0)
        p["root"] = {"loc": (0, -0.06 - dip * 0.08 - settle * 0.05, 0), "rot": (0.15 + dip * 0.1 + settle * 0.07, -0.16 * (1 - u), 0)}
        p["chest"] = {"rot": (0.04 + dip * 0.06, -0.14 * (1 - u), 0)}
        p["head"] = {"rot": (-0.22 - dip * 0.1, 0.1 * (1 - u), 0)}
        shield_arms(p, u, 0.0, over * 0.06)
        return p

    bake_clip(arm, "shield_raise", 0.6, shield_raise, 1)

    # Heaving a cannon along, shoulders down and both hands on it.
    def push_cannon(t):
        T = 0.8
        c = 2 * math.pi * t / T
        s, co = math.sin(c), math.cos(c)
        lean = 0.5
        p = base(t, T)
        p["root"] = {"loc": (0, abs(s) * 0.05 - 0.12, 0), "rot": (lean, s * 0.06, 0)}
        p["spine"] = {"rot": (0.08, -s * 0.05, 0)}
        p["chest"] = {"rot": (0.08, -s * 0.04, 0)}
        p["head"] = {"rot": (-lean - 0.1, 0, 0)}
        p["thigh.L"] = {"rot": (-0.7 * s - lean + 0.1, 0, -0.05)}
        p["shin.L"] = {"rot": (0.25 + 1.1 * max(0.0, co), 0, 0)}
        p["thigh.R"] = {"rot": (0.7 * s - lean + 0.1, 0, 0.05)}
        p["shin.R"] = {"rot": (0.25 + 1.1 * max(0.0, -co), 0, 0)}
        for side, sg in (("L", -1), ("R", 1)):
            pose, _ = reach(side, (sg * 0.44, 1.0, 0.58), (sg * 0.36, 1.0, 0.8))
            p.update(pose)
        p["tail.1"] = {"rot": (-0.2, s * 0.3, 0)}
        p["tail.2"] = {"rot": (0, math.sin(c - 0.7) * 0.3, 0)}
        return p

    bake_clip(arm, "push_cannon", 0.8, push_cannon, 1)

    # Flattened on a cannonball: spread out like a star.
    def splat(t):
        return {
            "arm.L": {"rot": (0, 0, -1.25)},
            "fore.L": {"rot": (0, 0, -0.4)},
            "arm.R": {"rot": (0, 0, 1.25)},
            "fore.R": {"rot": (0, 0, 0.4)},
            "thigh.L": {"rot": (0, 0, -0.7)},
            "thigh.R": {"rot": (0, 0, 0.7)},
            "tail.1": {"rot": (-0.8, 0, 0)},
        }

    bake_clip(arm, "splat", 0.2, splat, 2)

    # Peeking round the corner of a building: leaning out from the hips with one hand on the wall, eyes
    # on you, darting back a touch and leaning out again. Baked for the right side of the street, where
    # the lean goes to the character's own right-hand screen side, and mirrored for the left.
    PEEK = 1.2

    def peek_right(t):
        u = t / PEEK
        # Out, a nervous little duck back in, then out again.
        lean = 0.8 + 0.2 * math.sin(u * math.tau) - 0.32 * smooth(0.42, 0.5, u) * (1 - smooth(0.6, 0.72, u))
        p = base(t, PEEK)
        p["root"] = {"loc": (-0.12 * lean, -0.05, 0), "rot": (0.04, -0.14 * lean, 0.36 * lean)}
        p["spine"] = {"rot": (0.02, 0, 0.1 * lean)}
        p["chest"] = {"rot": (0.02, -0.06 * lean, 0.1 * lean)}
        # The head stays nearly level, and looks you in the eye.
        p["head"] = {"rot": (0.02, 0.1 * lean + math.sin(u * math.tau * 2) * 0.05, -0.34 * lean)}
        p["hat"] = {"rot": (0, 0, 0.05 * lean)}
        # The near hand on the corner, the other held back.
        p["arm.L"] = {"rot": (-1.25, 0.1, -0.5 - 0.15 * lean)}
        p["fore.L"] = {"rot": (-0.95, 0, 0)}
        p["hand.L"] = {"rot": (0.3, 0, 0)}
        p["arm.R"] = {"rot": (0.28, 0, 0.22)}
        p["fore.R"] = {"rot": (-0.5, 0, 0)}
        p["thigh.L"] = {"rot": (-0.2, 0, -0.34 * lean)}
        p["shin.L"] = {"rot": (0.34, 0, 0)}
        p["thigh.R"] = {"rot": (0.06, 0, -0.26 * lean)}
        p["shin.R"] = {"rot": (0.1, 0, 0)}
        p["tail.1"] = {"rot": (0, 0.3 * lean, 0)}
        return p

    def mirrored(pose):
        out = {}
        for name, q in pose.items():
            if name.endswith(".L"):
                other = name[:-2] + ".R"
            elif name.endswith(".R"):
                other = name[:-2] + ".L"
            else:
                other = name
            rx, ry, rz = q.get("rot", (0, 0, 0))
            lx, ly, lz = q.get("loc", (0, 0, 0))
            out[other] = {"rot": (rx, -ry, -rz), "loc": (-lx, ly, lz)}
        return out

    # A molotov thrower with nothing to do yet: feet planted wide, bottle held up by the shoulder and
    # tossed lightly in the hand, weight rocking from foot to foot, looking right at you.
    STANCE = 1.6

    def idle_molotov(t):
        c = 2 * math.pi * t / STANCE
        s = math.sin(c)
        toss = max(0.0, math.sin(c * 2)) ** 2
        p = base(t, STANCE)
        p["root"] = {"loc": (s * 0.035, -0.05 + abs(math.cos(c)) * 0.012, 0), "rot": (0.04, s * 0.06, s * 0.035)}
        p["spine"] = {"rot": (0.03, -s * 0.03, -s * 0.02)}
        p["chest"] = {"rot": (0.03, -s * 0.03, -s * 0.02)}
        p["head"] = {"rot": (-0.05, -s * 0.05, -s * 0.03)}
        p["thigh.L"] = {"rot": (-0.1, 0, -0.26)}
        p["shin.L"] = {"rot": (0.18, 0, 0.06)}
        p["thigh.R"] = {"rot": (-0.1, 0, 0.26)}
        p["shin.R"] = {"rot": (0.18, 0, -0.06)}
        # The throwing arm cocked, with a little toss of the bottle.
        p["arm.R"] = {"rot": (-1.2 - toss * 0.1, 0, 0.62)}
        p["fore.R"] = {"rot": (-1.15 - toss * 0.32, 0, 0)}
        p["hand.R"] = {"rot": (0.45 - toss * 0.2, 0, 0)}
        # The other hand on the hip.
        p["arm.L"] = {"rot": (0.2, 0, -0.72)}
        p["fore.L"] = {"rot": (-1.3, 0.3, 0)}
        p["tail.1"] = {"rot": (-0.1, s * 0.3, 0)}
        p["tail.2"] = {"rot": (0, math.sin(c - 0.7) * 0.36, 0)}
        p["tail.3"] = {"rot": (0, math.sin(c - 1.4) * 0.44, 0)}
        return p

    bake_clip(arm, "idle_molotov", STANCE, idle_molotov, 2)

    bake_clip(arm, "peek_r", PEEK, peek_right, 2)
    bake_clip(arm, "peek_l", PEEK, lambda t: mirrored(peek_right(t)), 2)

    # Arm-only poses for carrying a sign. The page layers these over any other clip.
    # The sign's on two short handles. The hands hold those, below the board, so they can't go through it.
    def hold_low(t):
        T = 6.0
        p = {"sign": {"rot": (0, 0, wobble(t, T, 0.2, 1.0) * 0.012), "loc": (0, 0.2 + wobble(t, T, 0.25, 2.0) * 0.008, 0)}}
        for s, side in ((-1, "L"), (1, "R")):
            pose, _ = reach(side, (s * 0.5, 0.62, 0.5), (s * 0.5, 0.68, 0.7))
            p.update(pose)
        return p

    bake_clip(arm, "hold_low", 6.0, hold_low, 3)

    def hold_high(t):
        T = 6.0
        sw = wobble(t, T, 0.3, 3.0)
        bob = wobble(t, T, 0.35, 4.0)
        p = {"sign": {"rot": (0, 0, sw * 0.012), "loc": (sw * 0.015, 1.42 + bob * 0.02, 0.1)}}
        for s, side in ((-1, "L"), (1, "R")):
            # Elbows out and hands up beside the face, gripping the handles under the board.
            pose, _ = reach(side, (s * 0.5, 1.68 + bob * 0.02, 0.52), (s * 0.5, 1.86 + bob * 0.02, 0.66), pole=(s * 1.0, -0.6, -0.3))
            p.update(pose)
        return p

    bake_clip(arm, "hold_high", 6.0, hold_high, 3)

    # For judging the weights: a limp body at the extremes a ragdoll reaches.
    bake_clip(arm, "ragdoll", 8.0, limp, 2)


# -------------------------------------------------------------------------------------- main


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    os.makedirs(OUT, exist_ok=True)

    arm_m = make_armature("MonkeyRig", MONKEY_BONES)
    part = build_monkey_mesh()
    place_boots(part)
    build_hat(part)
    mesh_m = make_mesh("Monkey", part, arm_m)
    before = stretch_report(arm_m, mesh_m, "before")
    write_weights(mesh_m, paint_weights(part, MONKEY_BONES))
    soften_in_blender(mesh_m)
    after = stretch_report(arm_m, mesh_m, "after")
    print("WEIGHT_REPORT", before, after)
    # The lizard shares this skeleton and every clip. The monkey must stay the file's first mesh.
    liz = build_lizard_mesh()
    mesh_l = make_mesh("Reptile", liz, arm_m)
    bake_lizard_face(liz)
    write_weights(mesh_l, paint_weights(liz, MONKEY_BONES))
    soften_in_blender(mesh_l)
    # The molotov throwers: the same lizard in a yellow suit with hot-rod flames.
    fire = build_lizard_mesh(flame=True)
    mesh_f = make_mesh("ReptileFlame", fire, arm_m)
    write_weights(mesh_f, paint_weights(fire, MONKEY_BONES))
    soften_in_blender(mesh_f)
    monkey_clips(arm_m)
    export(arm_m, [mesh_m, mesh_l, mesh_f], os.path.join(OUT, "monkey.glb"))
    # Everything that reads the first mesh expects the monkey, and the exporter sorts meshes by name.
    with open(os.path.join(OUT, "monkey.glb"), "rb") as fh:
        head = fh.read(20)
        doc = json.loads(fh.read(int.from_bytes(head[12:16], "little")))
    order = [m["name"] for m in doc["meshes"]]
    if order[0] != "Monkey":
        raise SystemExit(f"monkey.glb must list the monkey first, but its meshes are {order}")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "monkey.blend"))
    report = {"monkey_tris": sum(len(f) - 2 for f in part.f), "monkey_bones": len(MONKEY_BONES)}

    print("RIG_REPORT", report)
    print("monkey.glb", os.path.getsize(os.path.join(OUT, "monkey.glb")))


if __name__ == "__main__":
    main()
