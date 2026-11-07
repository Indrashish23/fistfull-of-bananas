# Turns the downloaded first-person arm into the shooter's monkey arm. Run from the repo root:
#   "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python lookdev/blender/build_arm.py
#
# Source: assets/fps_arm_source/ (CC0, see SOURCE.md). The script keeps the right forearm and hand,
# closes the fingers round the revolver's real grip and trigger, makes that pose the rest pose,
# thickens the hand to suit the toy style, paints it by region and adds the clips.
# Everything is positioned in the revolver's own space: barrel +x, up +y, shooter's right +z.

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_rigs import FPS, G, OUT, bake_clip, export, material, smooth  # noqa: E402

SOURCE = os.path.join(OUT, "fps_arm_source", "FPS_ARMS_RIG_1.fbx")

# The revolver's grip, measured from the OBJ.
GRIP_TOP = G((0.05, 0.0, 0.0))
GRIP_AX = G(Vector((-0.42, -0.91, 0.0)).normalized())
GRIP_FWD = G(Vector((0.91, -0.42, 0.0)).normalized())
SIDE = G((0, 0, 1))
GRIP_HALF_U = 0.165
GRIP_HALF_Z = 0.085


def gp(h, u, z):
    return GRIP_TOP + GRIP_AX * h + GRIP_FWD * u + SIDE * z


# The hand fills the gap between the top of the grip and its bottom.
PALM_WIDTH = 0.45
# Elbow toward wrist. Close to in line with the barrel, as in reference photos of a real grip:
# the hand high on the backstrap and the barrel low, so the recoil runs straight back up the arm.
FOREARM_DIR = G(Vector((1.0, 0.36, -0.38)).normalized())
FINGER_R = 0.062

KEEP = {"forearm.R", "hand.R"}
for f in ("index", "middle", "ring", "pinky"):
    KEEP.add(f"palm_{f}.R")
    for i in (1, 2, 3):
        KEEP.add(f"f_{f}.0{i}.R")
for i in (1, 2, 3):
    KEEP.add(f"thumb.0{i}.R")


def select_only(*objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def trim_to_right_arm(arm, mesh):
    """Deletes the left arm and everything above the elbow, then the bones that drove them."""
    groups = {g.index: g.name for g in mesh.vertex_groups}
    drop = []
    for v in mesh.data.vertices:
        total_keep = 0.0
        total = 0.0
        for g in v.groups:
            total += g.weight
            if groups[g.group] in KEEP:
                total_keep += g.weight
        if total == 0 or total_keep / total < 0.5:
            drop.append(v.index)
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in drop], context="VERTS")
    bm.to_mesh(mesh.data)
    bm.free()
    mesh.data.update()

    for g in list(mesh.vertex_groups):
        if g.name not in KEEP:
            mesh.vertex_groups.remove(g)

    select_only(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for b in list(eb):
        if b.name in KEEP:
            p = b.parent
            while p is not None and p.name not in KEEP:
                p = p.parent
            b.use_connect = False
            b.parent = p
    for b in list(eb):
        if b.name not in KEEP:
            eb.remove(b)
    bpy.ops.object.mode_set(mode="OBJECT")


def aim(pb, target):
    """Turns a bone so it points at a target, keeping its head where it is."""
    bpy.context.view_layer.update()
    head = pb.matrix.translation.copy()
    cur = pb.matrix.to_3x3()
    d = (cur @ Vector((0, 1, 0))).normalized()
    t = (target - head).normalized()
    q = d.rotation_difference(t).to_matrix()
    m = (q @ cur).to_4x4()
    m.translation = head
    pb.matrix = m
    bpy.context.view_layer.update()


def wrap_finger(arm, name):
    """Walks a finger round the grip, one bone length at a time, so it hugs the shape."""
    bones = [arm.pose.bones[f"f_{name}.0{i}.R"] for i in (1, 2, 3)]
    bpy.context.view_layer.update()
    k = bones[0].matrix.translation
    h = (k - GRIP_TOP).dot(GRIP_AX)
    c = GRIP_TOP + GRIP_AX * h
    a = GRIP_HALF_U + FINGER_R
    b = GRIP_HALF_Z + FINGER_R
    theta = 0.95
    for pb in bones:
        head = pb.matrix.translation
        hu = (head - c).dot(GRIP_FWD)
        hz = (head - c).dot(SIDE)
        length = pb.bone.length
        t = theta
        pick = None
        while t > -math.pi:
            u = a * math.cos(t)
            z = b * math.sin(t)
            if math.hypot(u - hu, z - hz) >= length:
                pick = (t, u, z)
                break
            t -= 0.02
        if pick is None:
            pick = (t, a * math.cos(t), b * math.sin(t))
        theta = pick[0] - 0.02
        aim(pb, c + GRIP_FWD * pick[1] + SIDE * pick[2])


def pose_on_gun(arm):
    bones = arm.data.bones
    w = bones["hand.R"].head_local
    m = bones["f_middle.01.R"].head_local
    i = bones["f_index.01.R"].head_local
    p = bones["f_pinky.01.R"].head_local
    palm_len = (m - w).length

    # Frames: fingers forward, then across the knuckles toward the little finger.
    x_h = (m - w).normalized()
    a_h = (p - i)
    a_h = (a_h - x_h * a_h.dot(x_h)).normalized()
    n_h = x_h.cross(a_h)
    # Hand tilted so the knuckles sit forward and the heel wraps the back of the grip.
    # The up-the-grip term drops the wrist's thumb side, instead of it humping up over the grip.
    x_t = (GRIP_FWD * 0.86 - SIDE * 0.42 - GRIP_AX * 0.42).normalized()
    a_t = (GRIP_AX - x_t * GRIP_AX.dot(x_t)).normalized()
    n_t = x_t.cross(a_t)
    frame = lambda x, y, z: Matrix((x, y, z)).transposed()
    R_hand = frame(x_t, a_t, n_t) @ frame(x_h, a_h, n_h).inverted()

    # Wrist placed so the middle knuckle sits just forward of the grip's centreline, outside it.
    w_t = gp(0.07, 0.17, GRIP_HALF_Z + 0.075) - x_t * palm_len

    fore = arm.pose.bones["forearm.R"]
    fb = bones["forearm.R"]
    flen = (fb.head_local - w).length
    A = fb.matrix_local.to_3x3()
    d = (A @ Vector((0, 1, 0))).normalized()
    R = d.rotation_difference(FOREARM_DIR).to_matrix()
    mat = (R @ A).to_4x4()
    mat.translation = w_t - FOREARM_DIR * flen
    fore.matrix = mat
    bpy.context.view_layer.update()

    hand = arm.pose.bones["hand.R"]
    mat = (R_hand @ bones["hand.R"].matrix_local.to_3x3()).to_4x4()
    mat.translation = w_t
    hand.matrix = mat
    bpy.context.view_layer.update()

    # Three fingers close round the grip.
    for f in ("middle", "ring", "pinky"):
        wrap_finger(arm, f)

    # Trigger finger reaches forward along the frame and hooks the trigger.
    pts = [G((0.3, 0.05, 0.14)), G((0.44, 0.0, 0.05)), G((0.42, -0.03, -0.07))]
    for n, t in zip((1, 2, 3), pts):
        aim(arm.pose.bones[f"f_index.0{n}.R"], t)

    # Thumb starts at the back of the grip, comes round the backstrap to the far side, and lies
    # forward along the frame. Each step is on the outside of the grip, so it can't pass through.
    # The tip ends high on the frame, just under the hammer, ready to cock it.
    pts = [gp(0.03, -0.24, -0.05), G((0.02, 0.17, -0.17)), G((0.26, 0.27, -0.135))]
    for n, t in zip((1, 2, 3), pts):
        aim(arm.pose.bones[f"thumb.0{n}.R"], t)


def bake_pose_as_rest(arm, mesh):
    select_only(mesh)
    mod = next(m for m in mesh.modifiers if m.type == "ARMATURE")
    bpy.ops.object.modifier_apply(modifier=mod.name)
    select_only(arm)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    mod = mesh.modifiers.new("rig", "ARMATURE")
    mod.object = arm


def dominant(v, names):
    best = None
    bw = 0.0
    for g in v.groups:
        if g.weight > bw:
            bw = g.weight
            best = names[g.group]
    return best


def chunk_up(mesh):
    """Thicker fingers and a meatier hand: the toy version of a realistic arm."""
    names = {g.index: g.name for g in mesh.vertex_groups}
    mesh.data.update()
    me = mesh.data
    normals = [v.normal.copy() for v in me.vertices]
    for v in me.vertices:
        d = dominant(v, names)
        if d is None:
            continue
        if d.startswith("f_") or d.startswith("thumb"):
            k = 0.017
        elif d.startswith("palm") or d in ("hand.R", "thumb.01.R"):
            k = 0.016
        else:
            k = 0.03
        v.co += normals[v.index] * k


def paint(arm, mesh):
    """Bare skin on the fingers, fur on the hand and forearm, then a sleeve."""
    names = {g.index: g.name for g in mesh.vertex_groups}
    me = mesh.data
    me.materials.clear()
    mats = ["skin", "fur", "sleeve", "cuff"]
    for n in mats:
        me.materials.append(material(n))
    index = {n: i for i, n in enumerate(mats)}
    bones = arm.data.bones
    wrist = bones["hand.R"].head_local
    elbow = bones["forearm.R"].head_local
    along = (elbow - wrist)
    span = along.length
    along = along.normalized()
    out = []
    for poly in me.polygons:
        bucket = {}
        c = Vector((0, 0, 0))
        for vi in poly.vertices:
            v = me.vertices[vi]
            c += v.co
            d = dominant(v, names)
            bucket[d] = bucket.get(d, 0) + 1
        c /= len(poly.vertices)
        d = max(bucket, key=bucket.get)
        if d == "forearm.R":
            t = (c - wrist).dot(along) / span
            out.append(index["sleeve"] if t > 0.5 else index["cuff"] if t > 0.44 else index["fur"])
        elif d.startswith("palm") or d in ("hand.R", "thumb.01.R"):
            # All fur, so the only skin-to-fur line is the clean one at the finger bases.
            out.append(index["fur"])
        else:
            out.append(index["skin"])
    me.polygons.foreach_set("material_index", out)
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.update()


def finish_rig(arm):
    """Adds the bone the gun follows, and gives the bones plain names."""
    select_only(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    g = eb.new("gun")
    g.head = gp(0.1, 0, 0)
    g.tail = gp(0.0, 0, 0)
    g.parent = eb["hand.R"]
    bpy.ops.object.mode_set(mode="OBJECT")
    renames = {"forearm.R": "forearm", "hand.R": "hand"}
    for f in ("index", "middle", "ring", "pinky"):
        renames[f"palm_{f}.R"] = f"palm.{f}"
        for i in (1, 2, 3):
            renames[f"f_{f}.0{i}.R"] = f"{f}.{i}"
    for i in (1, 2, 3):
        renames[f"thumb.0{i}.R"] = f"thumb.{i}"
    for a, b in renames.items():
        arm.data.bones[a].name = b


def clips(arm):
    fingers = ("middle", "ring", "pinky")

    def hold(t):
        T = 5.0
        b = math.sin(2 * math.pi * t / T)
        return {
            "forearm": {"rot": (0, 0, b * 0.012), "loc": (0, b * 0.012, 0)},
            "thumb.2": {"rot": (0, math.sin(2 * math.pi * t / T + 1) * 0.012, 0)},
        }

    bake_clip(arm, "hold", 5.0, hold, 2)

    def fire(t):
        pull = smooth(0.0, 0.03, t) * (1 - smooth(0.14, 0.34, t))
        kick = smooth(0.03, 0.07, t) * math.exp(-max(0, t - 0.07) * 6.8)
        p = {
            "forearm": {"rot": (0, 0, kick * 0.2), "loc": (-kick * 0.2, kick * 0.03, 0)},
            "hand": {"rot": (0, 0, kick * 0.32)},
            "index.2": {"rot": (0, -pull * 0.28, 0)},
            "index.3": {"rot": (0, -pull * 0.34, 0)},
            "thumb.2": {"rot": (0, kick * 0.05, 0)},
        }
        for f in fingers:
            p[f"{f}.2"] = {"rot": (0, pull * 0.05, 0)}
        return p

    bake_clip(arm, "fire", 0.75, fire, 1)
    cock_clip(arm)


def cock_clip(arm):
    """The thumb comes up onto the hammer's spur, by 0.35s, then drags it back, by 0.9s. The hammer
    itself turns in the page: 0.72 radians about its pivot, as GunAction does, so they stay together."""
    pivot = Vector((0.248, 0.332))
    spur = Vector((0.1, 0.45))
    action = bpy.data.actions.new("cock")
    action.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = action
    bones = arm.pose.bones
    bpy.context.view_layer.update()
    rest_knuckle = bones["thumb.3"].matrix.translation.copy()
    rest_tip = rest_knuckle + bones["thumb.3"].matrix.to_3x3() @ Vector((0, arm.data.bones["thumb.3"].length, 0))
    for frame in range(0, FPS + 1):
        t = frame / FPS
        for pb in bones:
            pb.rotation_mode = "QUATERNION"
            pb.matrix_basis = Matrix.Identity(4)
        reach = smooth(0.0, 0.35, t)
        angle = 0.72 * smooth(0.35, 0.9, t)
        d = spur - pivot
        at = Vector((pivot.x + d.x * math.cos(angle) - d.y * math.sin(angle), pivot.y + d.x * math.sin(angle) + d.y * math.cos(angle)))
        tip = rest_tip.lerp(G((at.x, at.y + 0.015, -0.005)), reach)
        knuckle = rest_knuckle.lerp(G((at.x - 0.08, at.y - 0.06, -0.13)), reach)
        aim(bones["thumb.2"], knuckle)
        aim(bones["thumb.3"], tip)
        for pb in bones:
            pb.keyframe_insert("rotation_quaternion", frame=frame + 1, group=pb.name)
            pb.keyframe_insert("location", frame=frame + 1, group=pb.name)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    bpy.ops.import_scene.fbx(filepath=SOURCE, use_anim=False)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")
    print("BONE_PARENTS", {b.name: b.parent.name if b.parent else None for b in arm.data.bones if b.name in KEEP})

    select_only(arm, mesh)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    trim_to_right_arm(arm, mesh)

    # Size the hand to the grip.
    i = arm.data.bones["f_index.01.R"].head_local
    p = arm.data.bones["f_pinky.01.R"].head_local
    s = PALM_WIDTH / (p - i).length
    arm.scale = (s, s, s)
    bpy.context.view_layer.update()
    select_only(arm, mesh)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    pose_on_gun(arm)
    bake_pose_as_rest(arm, mesh)
    chunk_up(mesh)
    paint(arm, mesh)
    finish_rig(arm)

    select_only(mesh)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)

    clips(arm)
    mesh.name = "FpsArm"
    arm.name = "FpsRig"
    export(arm, [mesh], os.path.join(OUT, "fps_arm.glb"))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "fps_arm.blend"))
    mesh.data.calc_loop_triangles()
    print("ARM_REPORT", {"tris": len(mesh.data.loop_triangles), "bones": len(arm.data.bones), "size": os.path.getsize(os.path.join(OUT, "fps_arm.glb"))})


if __name__ == "__main__":
    main()
