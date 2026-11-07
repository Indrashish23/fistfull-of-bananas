# Renders our current characters as reference sheets for Tripo: front, left, back and right on white,
# in their real flat colours and at rest. Run from the repo root:
#   "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python lookdev/blender/tripo_refs.py
#
# Writes lookdev/tripo/refs/<id>/<view>.png. Weapons and the sack are left out, since they float away
# from the body at rest and are added in build_bosses.py anyway. Faces are left off on purpose too: the
# game draws them as flat art, so a generated model works best with a clean head.

import math
import os
import re

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
LOOKDEV = os.path.normpath(os.path.join(HERE, ".."))
OUT = os.path.join(LOOKDEV, "tripo", "refs")
VIEWS = (("front", 0), ("left", 90), ("back", 180), ("right", 270))


def boss_paint(name):
    src = open(os.path.join(LOOKDEV, "bosses.ts"), encoding="utf8").read()
    colours = dict(re.findall(r'(\w+): "#([0-9A-Fa-f]{6})"', src[src.index("const SHARED") : src.index("export const BOSSES")]))
    block = src[src.index(f'id: "{name}"') :]
    block = block[: block.index("\n  },")]
    colours.update(re.findall(r'(\w+): "#([0-9A-Fa-f]{6})"', block))
    return colours


def lizard_paint():
    src = open(os.path.join(LOOKDEV, "character.ts"), encoding="utf8").read()
    row = src[src.index("export const LIZARDS") :]
    row = row[row.index("= [") :]
    row = row[row.index("{") : row.index("}")]
    c = dict(re.findall(r'(\w+): "#([0-9A-Fa-f]{6})"', row))
    fur = [int(c["fur"][i : i + 2], 16) for i in (0, 2, 4)]
    skin = [int(c["skin"][i : i + 2], 16) for i in (0, 2, 4)]
    hat = [int(c["hat"][i : i + 2], 16) for i in (0, 2, 4)]
    to_hex = lambda v: "%02X%02X%02X" % tuple(int(x) for x in v)  # noqa: E731
    c.update(
        belly=to_hex([s + (f - s) * 0.2 for s, f in zip(skin, fur)]),
        earin=to_hex([s + (f - s) * 0.45 for s, f in zip(skin, fur)]),
        spot=to_hex([f * 0.68 for f in fur]),
        boot="57301A",
        sole="2A170D",
        hatunder=to_hex([h * 0.62 for h in hat]),
        hatdent=to_hex([h * 0.8 for h in hat]),
    )
    return c


def render(name, glb, paint, mesh_name=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    # The importer adds an icosphere for showing bones; it isn't part of the character.
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        if o.name.startswith("Icosphere") or (mesh_name and mesh_name not in (o.name, o.data.name)):
            bpy.data.objects.remove(o)
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")
    # Drop what floats at rest, by the bone it follows.
    names = {g.index: g.name for g in mesh.vertex_groups}
    drop = set()
    for v in mesh.data.vertices:
        if v.groups:
            top = max(v.groups, key=lambda g: g.weight)
            if names[top.group] in ("gun", "sack"):
                drop.add(v.index)
    if drop:
        import bmesh

        bm = bmesh.new()
        bm.from_mesh(mesh.data)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for i in drop], context="VERTS")
        bm.to_mesh(mesh.data)
        bm.free()
    for m in mesh.data.materials:
        h = paint.get(m.name)
        if not h:
            raise SystemExit(f"{name}: material {m.name} has no colour")
        m.diffuse_color = (*[(int(h[i : i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4)], 1)

    # Rest pose, whatever the file's first clip says.
    for o in bpy.data.objects:
        if o.type == "ARMATURE":
            if o.animation_data:
                o.animation_data.action = None
            for pb in o.pose.bones:
                pb.matrix_basis.identity()
    bpy.context.view_layer.update()
    ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    pts = [ev.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    lo = Vector((min(p[i] for p in pts) for i in range(3)))
    hi = Vector((max(p[i] for p in pts) for i in range(3)))
    mid = (lo + hi) / 2
    size = (hi - lo).length

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "FLAT"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = False
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.world = bpy.data.worlds.new("w")
    scene.world.color = (1, 1, 1)
    data = bpy.data.cameras.new("c")
    data.type = "ORTHO"
    data.ortho_scale = size * 1.04
    cam = bpy.data.objects.new("c", data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    os.makedirs(os.path.join(OUT, name), exist_ok=True)
    for view, az in VIEWS:
        a = math.radians(az)
        # The character faces -y in Blender. Its left is +x, so the left view looks from +x.
        cam.location = mid + Vector((math.sin(a), -math.cos(a), 0)) * size * 2
        cam.rotation_euler = (mid - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(OUT, name, f"{view}.png")
        bpy.ops.render.render(write_still=True)
    print("REFS", name, [round(x, 2) for x in hi - lo])


if __name__ == "__main__":
    assets = os.path.join(LOOKDEV, "assets")
    for boss in ("gator", "snake", "bird"):
        render(boss, os.path.join(assets, "bosses", f"{boss}.glb"), boss_paint(boss))
    render("lizard", os.path.join(assets, "monkey.glb"), lizard_paint(), "Reptile")
