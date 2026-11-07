# Turns a generated model into our flat style. Tripo has no flat or toon mode, so this does it:
# reads its base colour per face, blurs out texture noise, reduces it all to a few solid colours as
# named materials, and cuts any rig down to what the engine can draw (24 bones).
#
#   blender --background --factory-startup --python lookdev/blender/tripo_flat.py -- in.glb out/flat
#     [--colors 10] [--height 5] [--forward +x] [--texture colour.png] [--max-bones 24]
#
# Writes <out>.glb, <out>.palette.json (material name to hex, for a boss's paint) and <out>.png (a
# front, three-quarter and side view). Everything is in game coordinates: y up, feet at y = 0, facing +z.
#
# Our characters' faces are flat SVG art, so a rigged model's own painted face is removed: the front of
# its head becomes one solid colour, and <out>.face.json holds a face sheet fitted to it, ready for
# buildFaceGrid. Anything sculpted into the head's shape, like a deep mouth, still needs fixing by hand.

import argparse
import json
import math
import os
import random
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_rigs  # noqa: E402
from build_bosses import Source, bake_face, chain, keep_weights  # noqa: E402
from build_rigs import bake_clip, make_armature, make_mesh  # noqa: E402

BLUR = 2
MERGE = 0.1


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_rigs.MATERIALS.clear()
    if path.lower().endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    for o in list(bpy.data.objects):
        if o.name.startswith("Icosphere"):
            bpy.data.objects.remove(o)


def study(path, max_bones):
    """Measures the model and decides which bones survive. Returns bounds and the bone plan."""
    load(path)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise SystemExit(f"Expected one mesh, found {len(meshes)}: {[m.name for m in meshes]}")
    mesh = meshes[0]
    pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    lo = Vector((min(p[i] for p in pts) for i in range(3)))
    hi = Vector((max(p[i] for p in pts) for i in range(3)))
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if not arm:
        return lo, hi, None, None
    weight = {b.name: 0.0 for b in arm.data.bones}
    names = {g.index: g.name for g in mesh.vertex_groups}
    for v in mesh.data.vertices:
        for g in v.groups:
            if names[g.group] in weight:
                weight[names[g.group]] += g.weight
    parent = {b.name: (b.parent.name if b.parent else None) for b in arm.data.bones}
    keep = set(parent)

    def kids(n):
        out = []
        for c in keep:
            q = parent[c]
            while q is not None and q not in keep:
                q = parent[q]
            if q == n:
                out.append(c)
        return out

    def removable():
        return [n for n in keep if parent[n] is not None and not kids(n)]

    # Bones that move nothing go first, then whichever leaf moves the least, merged into its parent.
    while True:
        idle = [n for n in removable() if weight[n] < 1e-6]
        if not idle:
            break
        keep.difference_update(idle)
    while len(keep) > max_bones:
        leaf = min(removable(), key=lambda n: weight[n])
        keep.discard(leaf)
        q = parent[leaf]
        while q not in keep:
            q = parent[q]
        weight[q] += weight[leaf]

    def survivor(n):
        while n is not None and n not in keep:
            n = parent[n]
        return n

    return lo, hi, keep, {"parent": parent, "survivor": survivor, "total": len(parent)}


def cluster(colors, k):
    """k-means over face colours, then merges colours too close to tell apart."""
    random.seed(1)
    pts = np.array(colors, dtype=np.float32)
    k = min(k, len(pts))
    centres = pts[random.sample(range(len(pts)), k)]
    for _ in range(14):
        near = ((pts[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2).argmin(axis=1)
        for i in range(k):
            if (near == i).any():
                centres[i] = pts[near == i].mean(axis=0)
    # Merge the closest pair, weighted by size, until every colour is distinct.
    sizes = [int((near == i).sum()) for i in range(k)]
    groups = [[i] for i in range(k)]
    cent = [centres[i].copy() for i in range(k)]
    while len(cent) > 1:
        best = None
        for a in range(len(cent)):
            for b in range(a + 1, len(cent)):
                d = float(np.linalg.norm(cent[a] - cent[b]))
                if best is None or d < best[0]:
                    best = (d, a, b)
        if best[0] > MERGE:
            break
        _, a, b = best
        total = sizes[a] + sizes[b]
        if total:
            cent[a] = (cent[a] * sizes[a] + cent[b] * sizes[b]) / total
        sizes[a] = total
        groups[a] += groups[b]
        del cent[b], sizes[b], groups[b]
    which = {i: g for g, members in enumerate(groups) for i in members}
    return [which[int(i)] for i in near], cent, sizes


def to_hex(c):
    return "#%02X%02X%02X" % tuple(int(round(max(0.0, min(1.0, float(x))) * 255)) for x in c)


def render_sheet(obj, palette, out):
    for m in obj.data.materials:
        h = palette[m.name][1:]
        c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
        m.diffuse_color = (*[x**2.2 for x in c], 1)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "FLAT"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = False
    scene.render.resolution_x = 500
    scene.render.resolution_y = 640
    scene.world = bpy.data.worlds.new("w")
    scene.world.color = (0.62, 0.62, 0.62)
    cam = bpy.data.objects.new("c", bpy.data.cameras.new("c"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    mid = sum(corners, Vector((0, 0, 0))) / 8
    size = (Vector(obj.bound_box[6]) - Vector(obj.bound_box[0])).length
    views = []
    for i, az in enumerate((0, 40, 90)):
        a = math.radians(az)
        # In Blender axes the viewer of a game-space front is at -y.
        cam.location = mid + Vector((math.sin(a), -math.cos(a), 0.1)) * size * 1.55
        cam.rotation_euler = (mid - cam.location).to_track_quat("-Z", "Y").to_euler()
        frame = f"{out}_view{i}.png"
        scene.render.filepath = frame
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(frame)
        views.append(np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4))
        bpy.data.images.remove(img)
        os.remove(frame)
    sheet = np.hstack(views)
    pic = bpy.data.images.new("sheet", sheet.shape[1], sheet.shape[0], alpha=True)
    pic.pixels = sheet.ravel().tolist()
    pic.filepath_raw = f"{out}.png"
    pic.file_format = "PNG"
    pic.save()


def clear_face(part, bones):
    """Paints out the model's own eyes and mouth, and fits our flat face sheet to its head."""
    heads = [b for b in bones if "head" in b.lower()]
    if not heads:
        print("FLAT no head bone found, so no face sheet")
        return None
    bone = min(heads, key=len)
    owned = [i for i, w in enumerate(part.w) if w and max(w, key=w.get) == bone]
    if not owned:
        print("FLAT head bone", bone, "moves nothing, so no face sheet")
        return None
    pts = [part.v[i] for i in owned]
    lo = [min(p[k] for p in pts) for k in range(3)]
    hi = [max(p[k] for p in pts) for k in range(3)]
    height = hi[1] - lo[1]
    width = hi[0] - lo[0]
    # The sheet's art has its eyes 46% down and its mouth 70% down, each eye 14% off centre.
    eye_y = lo[1] + height * 0.62
    mouth_y = lo[1] + height * 0.3
    span = (eye_y - mouth_y) / 0.24
    top = eye_y + span * 0.46
    half = width * 0.9
    mid_z = (lo[2] + hi[2]) / 2
    owned_set = set(owned)
    count = {}
    front = []
    for n, f in enumerate(part.f):
        if not all(i in owned_set for i in f):
            continue
        c = [sum(part.v[i][k] for i in f) / len(f) for k in range(3)]
        count[part.m[n]] = count.get(part.m[n], 0) + 1
        if c[2] > mid_z and lo[1] + height * 0.08 < c[1] < hi[1] - height * 0.08:
            front.append(n)
    colour = max(count, key=count.get)
    for n in front:
        part.m[n] = colour
    return {"grid": bake_face(part, half, top, span, bone=bone), "bone": bone, "colour": colour}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("out")
    ap.add_argument("--colors", type=int, default=10)
    ap.add_argument("--height", type=float, default=5.0)
    ap.add_argument("--forward", default="+x")
    ap.add_argument("--texture", default="")
    ap.add_argument("--max-bones", type=int, default=24)
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    path = os.path.abspath(args.input)
    out = os.path.abspath(args.out)

    lo, hi, keep, plan = study(path, args.max_bones)
    scale = args.height / (hi[2] - lo[2])
    centre = (lo + hi) / 2
    if args.forward == "-y":
        off = Vector((centre[0] * scale, lo[2] * scale, -centre[1] * scale))
    else:
        off = Vector((centre[1] * scale, lo[2] * scale, centre[0] * scale))

    def edit(p):
        return (p[0] - off[0], p[1] - off[1], p[2] - off[2])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_rigs.MATERIALS.clear()
    colours = []

    def classify(c, soft, raw, group, size):
        colours.append(soft)
        return "c0"

    group_map = plan["survivor"] if plan else None
    src = Source(path, scale, args.forward, classify, group_map, edit=edit, texture=os.path.abspath(args.texture) if args.texture else "embedded", blur=BLUR)
    part = src.part
    labels, cent, sizes = cluster(colours, args.colors)
    order = sorted(range(len(cent)), key=lambda i: -sizes[i])
    name = {g: f"c{i}" for i, g in enumerate(order)}
    part.m = [name[g] for g in labels]
    palette = {name[g]: to_hex(cent[g]) for g in order}
    src.soft = tuple(palette)
    src._tidy()

    face = clear_face(part, keep) if plan else None

    if plan:
        rows = []
        done = set()
        pending = [n for n in plan["parent"] if n in keep]

        def kept_parent(n):
            return plan["survivor"](plan["parent"][n])

        while pending:
            for n in list(pending):
                q = kept_parent(n)
                if q is None or q in done:
                    rows.append((n, q, tuple(src.joints[n])))
                    done.add(n)
                    pending.remove(n)
        bones = chain(rows)
        arm = make_armature("rig", bones)
        obj = make_mesh("model", part, arm)
        keep_weights(obj)
        bake_clip(arm, "idle", 1.0, lambda t: {}, 12)
        build_rigs.export(arm, [obj], out + ".glb")
        print("FLAT bones", plan["total"], "->", len(bones))
    else:
        mesh = bpy.data.meshes.new("model")
        mesh.from_pydata([build_rigs.G(v) for v in part.v], [], part.f)
        names = list(palette)
        for n in names:
            mesh.materials.append(build_rigs.material(n))
        mesh.polygons.foreach_set("material_index", [names.index(m) for m in part.m])
        mesh.polygons.foreach_set("use_smooth", [True] * len(part.f))
        mesh.update()
        obj = bpy.data.objects.new("model", mesh)
        bpy.context.collection.objects.link(obj)
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.ops.export_scene.gltf(filepath=out + ".glb", export_format="GLB", use_selection=True, export_yup=True, export_materials="EXPORT", export_texcoords=False)
        print("FLAT unrigged: run the rig step before this can go in the game")
    with open(out + ".palette.json", "w", encoding="utf8") as fh:
        json.dump(palette, fh, indent=2)
    if face:
        with open(out + ".face.json", "w", encoding="utf8") as fh:
            json.dump(face["grid"], fh, separators=(",", ":"))
        print("FLAT face sheet on bone", face["bone"], "in", face["colour"])
    render_sheet(obj, palette, out)
    tris = sum(len(f) - 2 for f in part.f)
    print("FLAT tris", tris, "colours", len(palette), palette)
    print("FLAT wrote", out + ".glb")


main()
