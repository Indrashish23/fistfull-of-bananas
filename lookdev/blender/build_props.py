# Rush mode's props, modelled and painted from code. Run from the repo root:
#   "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python lookdev/blender/build_props.py
#
# Writes assets/props/<name>.glb and a .blend of each. Points are in game coordinates: x right, y up, z
# toward the viewer. Paint lives in per-corner vertex colours, so wear, grime and chips stay crisp without
# extra geometry, and wood also picks up the game's grain texture through its UVs. A material is named
# after the renderer's Mat it should draw with: wood or plain. PROP_PREVIEW=<dir> renders previews there.

import math
import os
import random

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "assets", "props"))
PREVIEW = os.environ.get("PROP_PREVIEW", "")
# PROP_ONLY=a,b builds just those.
ONLY = os.environ.get("PROP_ONLY", "")


def hexc(h):
    return (int(h[1:3], 16) / 255, int(h[3:5], 16) / 255, int(h[5:7], 16) / 255)


def shade(c, k):
    return (c[0] * k, c[1] * k, c[2] * k)


def mix(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


OAK = hexc("#A8693A")
OAK_LIGHT = hexc("#C4854A")
OAK_DARK = hexc("#7E4A28")
SEAM = hexc("#2E1A10")
RED = hexc("#CE2B22")
RED_DARK = hexc("#971C18")
CREAM = hexc("#F4E7CB")
IRON = hexc("#3C3D47")
IRON_LIGHT = hexc("#6E717E")
RUST = hexc("#8A4A26")
STEEL = hexc("#9AA2AE")
STEEL_DARK = hexc("#5C6370")
EDGE = hexc("#E8EEF2")
LEATHER = hexc("#4A2A18")
BRASS = hexc("#E2A52C")
FUSE = hexc("#2A2024")
FLAME = hexc("#FF8A1E")
SPARK = hexc("#FFE14D")
GLASS = hexc("#3F8A5C")
GLASS_DARK = hexc("#28603F")
FUEL = hexc("#E89A2A")
RAG = hexc("#EFE2C2")


class Mesher:
    """One mesh with corner colours and UVs. Faces are flat unless given a smooth group."""

    def __init__(self):
        self.v = []
        self.key = {}
        self.f = []
        self.cols = []
        self.uvs = []
        self.mats = []
        self.smooth = []

    def _vert(self, p, group):
        k = (round(p[0], 4), round(p[1], 4), round(p[2], 4), group)
        if k not in self.key:
            self.key[k] = len(self.v)
            self.v.append(tuple(p))
        return self.key[k]

    def face(self, pts, color, mat="plain", uvs=None, group=None):
        """pts counter-clockwise from outside. color is one colour, or one per corner."""
        colors = color if isinstance(color[0], (tuple, list)) else [color] * len(pts)
        g = group if group is not None else id(pts)
        self.f.append(tuple(self._vert(p, g) for p in pts))
        self.cols.append(colors)
        self.uvs.append(uvs or [(p[1], p[0]) for p in pts])
        self.mats.append(mat)
        self.smooth.append(group is not None)

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    def rings(self, rows, color, mat="plain", group=None, cap_start=False, cap_end=False, uv=None):
        """Faces between rings of points, each ring listed counter-clockwise seen from the far end."""
        n = len(rows[0])
        for r in range(len(rows) - 1):
            for i in range(n):
                j = (i + 1) % n
                a, b, c, d = rows[r][i], rows[r][j], rows[r + 1][j], rows[r + 1][i]
                col = color(r, i) if callable(color) else color
                uvs = uv(r, i, j) if uv else None
                self.face([a, b, c, d], col, mat, uvs, group)
        if cap_start:
            c0 = color(0, 0) if callable(color) else color
            self.face(list(reversed(rows[0])), c0 if not isinstance(c0[0], (tuple, list)) else c0[0], mat)
        if cap_end:
            c1 = color(len(rows) - 2, 0) if callable(color) else color
            self.face(list(rows[-1]), c1 if not isinstance(c1[0], (tuple, list)) else c1[0], mat)


def circle(c, axis_u, axis_v, ru, rv, n, spin=0.0):
    return [tuple(Vector(c) + Vector(axis_u) * math.cos(spin + i / n * math.tau) * ru + Vector(axis_v) * math.sin(spin + i / n * math.tau) * rv) for i in range(n)]


def y_ring(x, y, z, ru, rv, n, spin=0.0):
    # Counter-clockwise seen from +y.
    return [(x + math.cos(spin - i / n * math.tau) * ru, y, z + math.sin(spin - i / n * math.tau) * rv) for i in range(n)]


def tube(m, pts, radii, color, sides=8, mat="plain", group=1, caps=True, flatten=1.0):
    """A tube along any path, smooth-shaded."""
    P = [Vector(p) for p in pts]
    rows = []
    for k, p in enumerate(P):
        t = (P[min(k + 1, len(P) - 1)] - P[max(k - 1, 0)]).normalized()
        ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        u = t.cross(ref).normalized()
        v = t.cross(u).normalized()
        rows.append([tuple(p + u * math.cos(-i / sides * math.tau) * radii[k] + v * math.sin(-i / sides * math.tau) * radii[k] * flatten) for i in range(sides)])
    m.rings(rows, color, mat, group, caps, caps)


# ------------------------------------------------------------------------------------- barrel

HEIGHT = 1.4


def barrel_r(y):
    k = (y - HEIGHT / 2) / (HEIGHT / 2)
    return 0.47 + 0.13 * (1 - k * k)


def on_barrel(angle, y, lift=0.0):
    r = barrel_r(y) + lift
    return (math.sin(angle) * r, y, math.cos(angle) * r)


def stencil(m, cx, cy, polys, color, lift):
    """Paints flat polygons, given in arc-length and height around (cx, cy), on the barrel's curve."""
    r0 = barrel_r(cy)
    for poly in polys:
        pts = [on_barrel(cx + a / r0, cy + b, lift) for a, b in poly]
        m.face(pts, color)


def rect(a0, b0, a1, b1):
    return [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]


def strip(a0, b0, a1, b1, w):
    # A bar of width w, from one point to another.
    dx, dy = a1 - a0, b1 - b0
    l = math.hypot(dx, dy) or 1
    nx, ny = -dy / l * w / 2, dx / l * w / 2
    return [(a0 + nx, b0 + ny), (a0 - nx, b0 - ny), (a1 - nx, b1 - ny), (a1 + nx, b1 + ny)]


def letter_t(x, h, w, t):
    return [rect(x, h / 2 - t, x + w, h / 2), rect(x + w / 2 - t / 2, -h / 2, x + w / 2 + t / 2, h / 2 - t - 0.012)]


def letter_n(x, h, w, t):
    return [rect(x, -h / 2, x + t, h / 2), rect(x + w - t, -h / 2, x + w, h / 2), strip(x + t * 0.5, h / 2 - t * 0.5, x + w - t * 0.5, -h / 2 + t * 0.5, t * 0.95)]


def skull_polys():
    """Skull and crossbones, as (polygons, colour). Sized for the painted band."""
    out = []
    for s in (-1, 1):
        out.append((strip(-s * 0.2, -0.17, s * 0.2, 0.0, 0.05), CREAM))
        for e in (-1, 1):
            cx, cy = e * s * 0.2, (-0.17 if e == 1 else 0.0)
            out.append(([(cx + math.cos(i / 6 * math.tau) * 0.04, cy + math.sin(i / 6 * math.tau) * 0.04) for i in range(6)], CREAM))
    head = [(math.cos(i / 12 * math.tau) * 0.125, 0.06 + math.sin(i / 12 * math.tau) * 0.115) for i in range(12)]
    out.append((head, CREAM))
    out.append((rect(-0.065, -0.1, 0.065, -0.03), CREAM))
    return out


def skull_details():
    # Sits above the skull: eyes, a nose and teeth, in the paint's own colour.
    out = []
    for s in (-1, 1):
        out.append([(s * 0.05 + math.cos(-i / 6 * math.tau * (1 if s > 0 else -1)) * 0.032, 0.065 + math.sin(-i / 6 * math.tau * (1 if s > 0 else -1)) * 0.036) for i in range(6)][::-1 if s < 0 else 1])
    out.append([(0, 0.02), (0.018, -0.008), (-0.018, -0.008)][::-1])
    return out


def barrel():
    m = Mesher()
    rnd = random.Random(7)
    staves = 14
    rows_y = [0.0, 0.05, 0.14, 0.27, 0.42, 0.55, 0.7, 0.85, 0.98, 1.13, 1.26, 1.35, 1.4]
    band0, band1 = 0.42, 0.98
    tone = [mix(OAK_DARK, OAK_LIGHT, rnd.random()) for _ in range(staves)]
    # Staves: each has a thin dark seam column on either side, painted rather than modelled.
    for s in range(staves):
        a0 = s / staves * math.tau
        a1 = (s + 1) / staves * math.tau
        seam = (a1 - a0) * 0.07
        cols = [a0, a0 + seam, a1 - seam, a1]
        grain_x = rnd.random() * 5
        streak = rnd.randrange(3)
        for r in range(len(rows_y) - 1):
            y0, y1 = rows_y[r], rows_y[r + 1]
            mid = (y0 + y1) / 2
            for c in range(3):
                b0, b1 = cols[c], cols[c + 1]
                # Hand painted red through the middle, worn back to the wood in chips.
                painted = band0 <= mid <= band1
                edge = 1 - min(1.0, min(mid - band0, band1 - mid) / 0.12) if painted else 0
                chip = painted and c == 1 and rnd.random() < 0.1 + edge * 0.22
                if c != 1:
                    col = SEAM if not painted else mix(SEAM, RED_DARK, 0.45)
                elif painted and not chip:
                    col = mix(RED, RED_DARK, rnd.random() * 0.75)
                else:
                    col = tone[s]
                    # Grime gathers near the hoops and the ends.
                    grime = min(abs(mid - h) for h in (0.1, 0.37, 1.03, 1.3))
                    col = shade(col, 0.72 + min(0.28, grime * 1.5))
                    if rnd.random() < 0.14:
                        col = shade(col, 0.82)
                # Rust runs down from each hoop, on some staves.
                if c == 1 and streak == 0 and (0.86 < mid < 1.0 or 0.2 < mid < 0.34):
                    col = mix(col, RUST, 0.5)
                quad = [on_barrel(b0, y0), on_barrel(b1, y0), on_barrel(b1, y1), on_barrel(b0, y1)]
                uv = [(y0 * 0.9, grain_x), (y0 * 0.9, grain_x + 0.13), (y1 * 0.9, grain_x + 0.13), (y1 * 0.9, grain_x)]
                m.face(quad, col, "wood", uv, group=1000 + s)

    # Chunky iron hoops, with a lit top edge and rusty patches.
    for (hy, hh) in ((0.1, 0.1), (0.37, 0.085), (1.03, 0.085), (1.3, 0.1)):
        n = 20
        y0, y1 = hy - hh / 2, hy + hh / 2
        out = 0.03
        rows = [[on_barrel(i / n * math.tau, y0, 0.002) for i in range(n)], [on_barrel(i / n * math.tau, y0 + 0.012, out) for i in range(n)], [on_barrel(i / n * math.tau, y1 - 0.012, out) for i in range(n)], [on_barrel(i / n * math.tau, y1, 0.002) for i in range(n)]]
        rows = [r[::1] for r in rows]

        def col(r, i, hy=hy):
            if r == 2:
                return IRON_LIGHT
            if r == 0:
                return shade(IRON, 0.6)
            return mix(IRON, RUST, 0.55) if (i * 7 + int(hy * 10)) % 6 == 0 else IRON

        for r in range(3):
            for i in range(n):
                j = (i + 1) % n
                m.face([rows[r][i], rows[r][j], rows[r + 1][j], rows[r + 1][i]], col(r, i))
        # Big rivets at the hoop's join.
        for a in (0.4, 0.4 + math.pi):
            c = on_barrel(a, hy, out + 0.006)
            v = Vector(c)
            right = Vector((math.cos(a), 0, -math.sin(a)))
            up = Vector((0, 1, 0))
            m.face([tuple(v + right * 0.024), tuple(v + up * 0.024), tuple(v - right * 0.024), tuple(v - up * 0.024)][::-1], IRON_LIGHT)

    # TNT on the front and back, stencilled in cream, with a chip through it.
    h, w, t = 0.3, 0.2, 0.062
    gap = 0.045
    x = -(w * 3 + gap * 2) / 2
    tnt = letter_t(x, h, w, t) + letter_n(x + w + gap, h, w, t) + letter_t(x + (w + gap) * 2, h, w, t)
    # Letters are flipped for the far side so they read correctly from outside.
    for centre in (0.0, math.pi):
        stencil(m, centre, 0.7, tnt, CREAM, 0.006)
    for centre in (0.0, math.pi):
        stencil(m, centre, 0.7, [rect(-0.24, 0.11, -0.17, 0.15), rect(0.1, -0.15, 0.2, -0.11)], RED_DARK, 0.009)
    # Skull and crossbones on each side, for a barrel rolling past end-on.
    for centre in (math.pi / 2, -math.pi / 2):
        for poly, c in skull_polys():
            stencil(m, centre, 0.7, [poly], c, 0.006)
        stencil(m, centre, 0.7, skull_details(), RED_DARK, 0.01)

    # The ends: a recessed head of boards, then a plug and a fuse on top.
    for (y, flip, inset) in ((1.34, False, 0.0), (0.06, True, 0.0)):
        r = barrel_r(y) - 0.012
        ring_top = 1.4 if not flip else 0.0
        n = staves
        rim_out = [on_barrel(i / n * math.tau, ring_top, 0) for i in range(n)]
        rim_in = [(math.sin(i / n * math.tau) * (r - 0.045), ring_top, math.cos(i / n * math.tau) * (r - 0.045)) for i in range(n)]
        floor = [(p[0], y, p[2]) for p in rim_in]
        for i in range(n):
            j = (i + 1) % n
            a, b, c, d = rim_out[i], rim_out[j], rim_in[j], rim_in[i]
            m.face([a, b, c, d] if not flip else [d, c, b, a], OAK_DARK, "wood")
            a, b, c, d = rim_in[i], rim_in[j], floor[j], floor[i]
            m.face([a, b, c, d] if not flip else [d, c, b, a], SEAM)
        boards = 4
        for k in range(boards):
            x0 = -r + 2 * r * k / boards
            x1 = -r + 2 * r * (k + 1) / boards
            def half(x):
                return math.sqrt(max(0.0, (r - 0.045) ** 2 - x * x))
            pts = [(x0 + 0.006, y, -half(x0 + 0.006)), (x0 + 0.006, y, half(x0 + 0.006)), (x1 - 0.006, y, half(x1 - 0.006)), (x1 - 0.006, y, -half(x1 - 0.006))]
            col = mix(OAK_DARK, OAK, (k * 37 % 10) / 10)
            m.face(pts if not flip else pts[::-1], col, "wood", [(p[2], p[0]) for p in (pts if not flip else pts[::-1])])
    plug = y_ring(0.12, 1.345, 0.08, 0.075, 0.075, 8)
    plug2 = y_ring(0.12, 1.41, 0.08, 0.065, 0.065, 8)
    m.rings([plug, plug2], BRASS, cap_end=True)
    tube(m, [(0.12, 1.41, 0.08), (0.14, 1.5, 0.1), (0.22, 1.57, 0.14), (0.3, 1.56, 0.1), (0.33, 1.63, 0.03)], [0.026, 0.024, 0.022, 0.02, 0.018], FUSE, 5, group=50, caps=False)
    # A spark on the fuse, drawn as two crossed bright stars.
    tip = Vector((0.33, 1.66, 0.03))
    for k, (u, v) in enumerate(((Vector((1, 0, 0)), Vector((0, 1, 0))), (Vector((0, 0, 1)), Vector((0, 1, 0))))):
        pts = []
        for i in range(10):
            a = i / 10 * math.tau
            r = 0.1 if i % 2 == 0 else 0.042
            pts.append(tuple(tip + u * math.cos(a) * r + v * math.sin(a) * r))
        m.face(pts, FLAME)
        m.face(pts[::-1], FLAME)
        inner = [tuple(tip + (Vector(q) - tip) * 0.5 + u.cross(v) * 0.004) for q in pts]
        m.face(inner, SPARK)
        inner2 = [tuple(tip + (Vector(q) - tip) * 0.5 - u.cross(v) * 0.004) for q in pts]
        m.face(inner2[::-1], SPARK)
    return m


# ------------------------------------------------------------------------------------ weapons


def box_taper(m, y0, y1, w0, w1, t0, t1, color, mat="plain", z0=0.0):
    """A tapered bar along +y, with flat faces."""
    a = [(-w0, y0, -t0 + z0), (w0, y0, -t0 + z0), (w0, y0, t0 + z0), (-w0, y0, t0 + z0)]
    b = [(-w1, y1, -t1 + z0), (w1, y1, -t1 + z0), (w1, y1, t1 + z0), (-w1, y1, t1 + z0)]
    for i in range(4):
        j = (i + 1) % 4
        m.face([a[j], a[i], b[i], b[j]], color, mat)
    m.face(a, color, mat)
    m.face(b[::-1], color, mat)


def handle(m, y0, y1, r, a, sides=6):
    """A plain chunky grip around the origin."""
    m.rings([y_ring(0, y0, 0, r, r * 0.85, sides), y_ring(0, y1, 0, r, r * 0.85, sides)], a, "plain", None, True, True)


def machete():
    m = Mesher()
    handle(m, -0.22, 0.17, 0.06, LEATHER)
    box_taper(m, 0.15, 0.21, 0.1, 0.1, 0.05, 0.05, BRASS)
    # A big simple chopper: a broad flat blade, with a bright bevel down its cutting side.
    spine = [(-0.08, 0.21), (-0.07, 0.85), (0.04, 1.14)]
    belly = [(0.09, 0.21), (0.19, 0.9), (0.04, 1.14)]
    t = 0.03
    for i in range(2):
        ax, ay = spine[i]
        bx, by = belly[i]
        cx, cy = belly[i + 1]
        dx, dy = spine[i + 1]
        ex, ey = ax + (bx - ax) * 0.68, ay + (by - ay) * 0.68
        fx, fy = dx + (cx - dx) * 0.68, dy + (cy - dy) * 0.68
        for z, flip in ((t, False), (-t, True)):
            q = [(ax, ay, z), (ex, ey, z), (fx, fy, z), (dx, dy, z)]
            m.face(q if not flip else q[::-1], STEEL)
            q2 = [(ex, ey, z), (bx, by, 0), (cx, cy, 0), (fx, fy, z)]
            m.face(q2 if not flip else q2[::-1], EDGE)
        m.face([(dx, dy, t), (dx, dy, -t), (ax, ay, -t), (ax, ay, t)], STEEL_DARK)
    return m


def axe():
    m = Mesher()
    # A thick wooden haft, a plain grip, and a big wedge of a head with a bright edge.
    rows = [y_ring(0, y, 0, r, r * 0.8, 6) for y, r in ((0.12, 0.058), (0.98, 0.066))]
    m.rings(rows, OAK, "wood", None, False, True)
    handle(m, -0.24, 0.14, 0.066, LEATHER)
    y0, y1 = 0.68, 0.98
    t = 0.08
    k0 = [(-0.12, y0 + 0.04), (0.14, y0 + 0.02), (0.14, y1 - 0.02), (-0.12, y1 - 0.04)]
    for sign in (1, -1):
        q0 = [(x, y, sign * t) for x, y in k0]
        q1 = [(0.14, y0 + 0.02, sign * t), (0.36, y0 - 0.1, sign * 0.02), (0.36, y1 + 0.1, sign * 0.02), (0.14, y1 - 0.02, sign * t)]
        q2 = [(0.36, y0 - 0.1, sign * 0.02), (0.46, y0 - 0.14, 0), (0.46, y1 + 0.14, 0), (0.36, y1 + 0.1, sign * 0.02)]
        for q, c in ((q0, IRON), (q1, STEEL_DARK), (q2, EDGE)):
            m.face(q if sign > 0 else q[::-1], c)
    # Closing the top, the bottom and the back of the head.
    m.face([(-0.12, y0 + 0.04, -t), (0.14, y0 + 0.02, -t), (0.14, y0 + 0.02, t), (-0.12, y0 + 0.04, t)], shade(IRON, 0.8))
    m.face([(0.14, y1 - 0.02, -t), (-0.12, y1 - 0.04, -t), (-0.12, y1 - 0.04, t), (0.14, y1 - 0.02, t)], shade(IRON, 0.8))
    m.face([(-0.12, y1 - 0.04, -t), (-0.12, y0 + 0.04, -t), (-0.12, y0 + 0.04, t), (-0.12, y1 - 0.04, t)], IRON_LIGHT)
    m.face([(0.14, y0 + 0.02, t), (0.46, y0 - 0.14, 0), (0.14, y0 + 0.02, -t)], shade(STEEL_DARK, 0.8))
    m.face([(0.14, y1 - 0.02, -t), (0.46, y1 + 0.14, 0), (0.14, y1 - 0.02, t)], shade(STEEL_DARK, 0.8))
    return m


def club():
    m = Mesher()
    handle(m, -0.24, 0.14, 0.066, LEATHER)
    # A big faceted lump of wood, with one iron band and four fat spikes.
    profile = [(0.12, 0.07), (0.55, 0.13), (0.9, 0.19), (1.08, 0.12)]
    n = 7
    rows = [[(math.cos(-i / n * math.tau) * r, y, math.sin(-i / n * math.tau) * r) for i in range(n)] for y, r in profile]
    m.rings(rows, lambda r, i: OAK if (r + i) % 2 else OAK_DARK, "wood", None, False, True)
    r = 0.178
    band = [y_ring(0, 0.76, 0, r, r, n), y_ring(0, 0.84, 0, r + 0.008, r + 0.008, n)]
    m.rings(band, IRON)
    for k in range(4):
        a = k / 4 * math.tau + 0.4
        c = Vector((math.cos(a) * 0.16, 0.93, math.sin(a) * 0.16))
        tip = c + Vector((math.cos(a), 0.2, math.sin(a))).normalized() * 0.16
        ring = circle(tuple(c), (0, 1, 0), (-math.sin(a), 0, math.cos(a)), 0.042, 0.042, 3)
        for i in range(3):
            m.face([ring[(i + 1) % 3], ring[i], tuple(tip)], STEEL if i else EDGE)
    return m


def molotov():
    m = Mesher()
    # A chunky bottle, origin at the grip around its waist: fuel in the base, glass above, a cloth rag.
    n = 6
    prof = [(-0.2, 0.135), (0.0, 0.14), (0.14, 0.135), (0.24, 0.07), (0.44, 0.066)]
    rows = [y_ring(0, y, 0, r, r, n) for y, r in prof]
    colors = [FUEL, GLASS, GLASS_DARK, GLASS]
    m.rings(rows, lambda r, i: colors[r], "plain", None, True, True)
    # The rag: one fat flopped-over lump.
    tube(m, [(0, 0.42, 0), (0, 0.58, 0), (0.1, 0.64, 0.01), (0.19, 0.5, 0.02)], [0.075, 0.08, 0.07, 0.05], RAG, 4, group=None, caps=True)
    return m


# ---------------------------------------------------------------------------------- export


def to_blender(p):
    return (p[0], -p[2], p[1])


def write(name, m):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([to_blender(v) for v in m.v], [], m.f)
    names = []
    for mat in m.mats:
        if mat not in names:
            names.append(mat)
            mesh.materials.append(bpy.data.materials.new(mat))
    mesh.polygons.foreach_set("material_index", [names.index(x) for x in m.mats])
    mesh.polygons.foreach_set("use_smooth", m.smooth)
    mesh.update()
    colors = mesh.color_attributes.new("Paint", "FLOAT_COLOR", "CORNER")
    uv = mesh.uv_layers.new(name="UVMap")
    for poly, cols, uvs in zip(mesh.polygons, m.cols, m.uvs):
        for li, c, u in zip(poly.loop_indices, cols, uvs):
            colors.data[li].color = (c[0], c[1], c[2], 1.0)
            uv.data[li].uv = (u[0], u[1])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, f"{name}.glb"),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=True,
    )
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"{name}.blend"))
    backup = os.path.join(OUT, f"{name}.blend1")
    if os.path.exists(backup):
        os.remove(backup)
    print("PROP", name, "tris", m.tris(), "kb", os.path.getsize(os.path.join(OUT, f"{name}.glb")) // 1024)
    if PREVIEW:
        render(name, obj)


def render(name, obj):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "VERTEX"
    scene.display.shading.show_shadows = False
    scene.render.resolution_x = 460
    scene.render.resolution_y = 460
    scene.world = bpy.data.worlds.new("w")
    scene.world.color = (0.55, 0.55, 0.55)
    cam = bpy.data.objects.new("c", bpy.data.cameras.new("c"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(c[i] for c in corners) for i in range(3)))
    hi = Vector((max(c[i] for c in corners) for i in range(3)))
    mid = (lo + hi) / 2
    size = (hi - lo).length
    for i, (az, el, roll) in enumerate(((20, 8, 0), (110, 22, 0), (-70, 55, 0))):
        a = math.radians(az)
        e = math.radians(el)
        cam.location = mid + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * size * 1.5
        cam.rotation_euler = (mid - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(PREVIEW, f"{name}_{i}.png")
        bpy.ops.render.render(write_still=True)
    if name == "barrel":
        # On its side, as it rolls down the street.
        obj.rotation_euler = (0, math.pi / 2, 0.5)
        bpy.context.view_layer.update()
        cam.location = Vector((0.2, -3.0, 0.7))
        cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(PREVIEW, f"{name}_3.png")
        bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------------------------- shield

SHIELD_W = 1.1
SHIELD_H = 1.4
BOARD_T = 0.05
# Each board's width share, its top and bottom edge relative to the middle, and its base tone.
BOARDS = [
    (0.92, 0.61, -0.63, 0.15),
    (1.08, 0.68, -0.69, 0.75),
    (1.0, 0.7, -0.7, 0.35),
    (1.1, 0.67, -0.68, 0.9),
    (0.9, 0.6, -0.62, 0.5),
]
SHIELD_PAINT = hexc("#B9352A")
SHIELD_PAINT_DARK = hexc("#7C2019")
FRESH_WOOD = hexc("#E2B77C")


def shield_board_columns():
    total = sum(b[0] for b in BOARDS)
    x = -SHIELD_W / 2
    out = []
    for b in BOARDS:
        w = b[0] / total * SHIELD_W
        out.append((x, x + w))
        x += w
    return out


def jag(x0, x1, y, depth, seed, teeth=4):
    """A splintered edge from x0 to x1 at height y, as points left to right."""
    r = random.Random(seed)
    pts = []
    for i in range(teeth + 1):
        u = i / teeth
        drop = depth * (r.random() if 0 < i < teeth else 0.3 + r.random() * 0.4)
        pts.append((x0 + (x1 - x0) * u, y - drop if i % 2 == 0 else y + depth * 0.35 * r.random()))
    return pts


def bullet_hole(m, x, y, z, seed, r=0.058):
    """A hole punched in the front: pale torn wood, with a dark centre."""
    rnd = random.Random(seed)
    n = 9
    outer = []
    inner = []
    for i in range(n):
        a = i / n * math.tau
        k = r * (1.0 + (0.55 if i % 2 == 0 else -0.1) * rnd.random())
        outer.append((x + math.cos(a) * k, y + math.sin(a) * k, z))
        inner.append((x + math.cos(a) * r * 0.5, y + math.sin(a) * r * 0.5, z + 0.002))
    m.face(outer, FRESH_WOOD)
    m.face(inner, SEAM)


def shield_board(m, i, x0, x1, top_edge=None, bottom=None, ox=0.0):
    """One board, painted and chipped. top_edge replaces its top with a splintered line."""
    share, top, low, tone_k = BOARDS[i]
    low = bottom if bottom is not None else low
    rnd = random.Random(30 + i)
    tone = mix(OAK_DARK, OAK_LIGHT, tone_k)
    grain = rnd.random() * 5
    z = BOARD_T / 2
    rows = 7
    gap = 0.006
    xa = x0 + gap - ox
    xb = x1 - gap - ox
    if top_edge:
        edge = [(p[0] - ox, p[1]) for p in top_edge]
    else:
        # A slightly uneven cut, so no two boards end alike.
        edge = [(xa, top), (xb, top - 0.025 + rnd.random() * 0.05)]
    y_top_l, y_top_r = edge[0][1], edge[-1][1]
    y_top = min(y_top_l, y_top_r, *[p[1] for p in edge])
    # The painted middle of the board, worn at its edges, over bare wood.
    for r in range(rows):
        y0 = low + (y_top - low) * r / rows
        y1 = low + (y_top - low) * (r + 1) / rows
        mid = (y0 + y1) / 2
        painted = -0.42 < mid < 0.46
        edge_wear = 1 - min(1.0, min(mid + 0.42, 0.46 - mid) / 0.14) if painted else 0
        chip = painted and rnd.random() < 0.12 + edge_wear * 0.4
        if painted and not chip:
            col = mix(SHIELD_PAINT, SHIELD_PAINT_DARK, rnd.random() * 0.7)
        else:
            col = shade(tone, 0.82 + rnd.random() * 0.26)
        if rnd.random() < 0.15:
            col = shade(col, 0.82)
        uv = [(y0 * 0.9, grain), (y0 * 0.9, grain + 0.16), (y1 * 0.9, grain + 0.16), (y1 * 0.9, grain)]
        m.face([(xa, y0, z), (xb, y0, z), (xb, y1, z), (xa, y1, z)], col, "wood", uv, group=2000 + i)
    # The top of the board, up to its cut or its splintered end.
    pts = [(xa, y_top, z), (xb, y_top, z)] + [(p[0], max(p[1], y_top), z) for p in reversed(edge)]
    m.face(pts, shade(tone, 0.95), "wood", [(p[1] * 0.9, grain + (p[0] - xa) * 0.7) for p in pts], group=2000 + i)
    # Back face and the edges.
    back = [(xa, low, -z), (xa, y_top, -z), (xb, y_top, -z), (xb, low, -z)]
    m.face(back, shade(tone, 0.68), "wood", [(p[1] * 0.9, grain + (p[0] - xa) * 0.7) for p in back])
    m.face([(xa, low, -z), (xa, low, z), (xa, y_top, z), (xa, y_top, -z)], shade(tone, 0.55))
    m.face([(xb, low, z), (xb, low, -z), (xb, y_top, -z), (xb, y_top, z)], shade(tone, 0.55))
    m.face([(xa, low, -z), (xb, low, -z), (xb, low, z), (xa, low, z)], shade(tone, 0.5))
    run = list(reversed(edge))
    for a, b in zip(run, run[1:]):
        # Fresh torn wood along a splintered top, plain end grain on a clean one.
        col = FRESH_WOOD if top_edge else shade(tone, 1.05)
        m.face([(a[0], a[1], z), (b[0], b[1], z), (b[0], b[1], -z), (a[0], a[1], -z)], col)


def shield_strap(m, y, x0, x1, h=0.1):
    """An iron strap across the front, with rivets and a rusty streak running down from it."""
    z = BOARD_T / 2
    dz = 0.018
    rows = [(x0, y - h / 2, z), (x1, y - h / 2, z), (x1, y - h / 2 + 0.012, z + dz), (x0, y - h / 2 + 0.012, z + dz)]
    m.face(rows, shade(IRON, 0.6))
    m.face([(x0, y - h / 2 + 0.012, z + dz), (x1, y - h / 2 + 0.012, z + dz), (x1, y + h / 2 - 0.012, z + dz), (x0, y + h / 2 - 0.012, z + dz)], IRON)
    m.face([(x0, y + h / 2 - 0.012, z + dz), (x1, y + h / 2 - 0.012, z + dz), (x1, y + h / 2, z), (x0, y + h / 2, z)], IRON_LIGHT)
    n = int((x1 - x0) / 0.21)
    for i in range(n + 1):
        cx = x0 + 0.05 + (x1 - x0 - 0.1) * (i / max(1, n))
        ring = [(cx + math.cos(a / 6 * math.tau) * 0.022, y + math.sin(a / 6 * math.tau) * 0.022, z + dz + 0.006) for a in range(6)]
        m.face(ring, IRON_LIGHT)
        if i % 2 == 0:
            m.face([(cx - 0.012, y - h / 2 - 0.09, z + 0.002), (cx + 0.012, y - h / 2 - 0.09, z + 0.002), (cx + 0.016, y - h / 2, z + 0.002), (cx - 0.016, y - h / 2, z + 0.002)], mix(RUST, SHIELD_PAINT_DARK, 0.3))


def shield_emblem(m, y, z):
    """The gang's skull, stencilled big across the boards."""
    k = 1.25
    for poly, c in skull_polys():
        m.face([(a * k, y + b * k, z) for a, b in poly], mix(c, OAK_LIGHT, 0.15))
    for poly in skull_details():
        m.face([(a * k, y + b * k, z + 0.002) for a, b in poly], SHIELD_PAINT_DARK)


def shield_back(m):
    """Two battens and a rope grip behind it, which show when it's held up close."""
    z = -BOARD_T / 2
    for y in (0.34, -0.34):
        a = (-SHIELD_W / 2 + 0.05, y - 0.05, z - 0.04)
        b = (SHIELD_W / 2 - 0.05, y + 0.05, z)
        m.face([(a[0], a[1], a[2]), (a[0], b[1], a[2]), (b[0], b[1], a[2]), (b[0], a[1], a[2])], OAK_DARK, "wood")
    tube(m, [(-0.2, 0.0, z), (-0.14, 0.0, z - 0.08), (0.14, 0.0, z - 0.08), (0.2, 0.0, z)], [0.022] * 4, shade(RAG, 0.7), 5, group=60, caps=False)


def shield_stage(stage):
    """A plank shield. 0 is whole, 1 is shot up, 2 has lost a board and is nearly done for."""
    m = Mesher()
    cols = shield_board_columns()
    for i, (x0, x1) in enumerate(cols):
        top_edge = None
        bottom = None
        if stage >= 1 and i == 1:
            top_edge = jag(x0 + 0.006, x1 - 0.006, 0.38, 0.1, 71)
        if stage >= 2 and i == 4:
            continue
        if stage >= 2 and i == 0:
            top_edge = jag(x0 + 0.006, x1 - 0.006, 0.1, 0.12, 72)
        if stage >= 2 and i == 3:
            bottom = -0.3
        shield_board(m, i, x0, x1, top_edge, bottom)
    z = BOARD_T / 2
    right = SHIELD_W / 2 + 0.01 if stage < 2 else cols[3][1]
    left = -SHIELD_W / 2 - 0.01
    shield_strap(m, 0.42 if stage == 0 else 0.3, left if stage < 2 else cols[1][0], right)
    shield_strap(m, -0.44, left, right if stage < 2 else cols[3][1] - 0.08)
    shield_emblem(m, 0.02, z + 0.003)
    if stage >= 1:
        for k, (x, y) in enumerate(((-0.2, 0.14), (0.3, -0.16), (0.05, -0.32))):
            bullet_hole(m, x, y, z + 0.007, 80 + k)
    if stage >= 2:
        for k, (x, y) in enumerate(((0.16, 0.22), (-0.34, -0.2), (0.28, 0.08), (-0.02, 0.0))):
            bullet_hole(m, x, y, z + 0.007, 90 + k, 0.07)
    shield_back(m)
    return m


def shield():
    return shield_stage(0)


def shield_shot():
    return shield_stage(1)


def shield_wrecked():
    return shield_stage(2)


def shield_plank():
    """One loose board for when it finally comes apart, centred on its own middle."""
    m = Mesher()
    (x0, x1) = shield_board_columns()[2]
    shield_board(m, 2, x0, x1, jag(x0 + 0.006, x1 - 0.006, 0.4, 0.12, 73), -0.45, ox=(x0 + x1) / 2)
    return m


# ------------------------------------------------------------------------------------- the arena

GOLD = hexc("#FFC93C")
GOLD_DARK = hexc("#C98F1E")
GOLD_LIGHT = hexc("#FFE98A")
CASH = hexc("#4E9A4A")
CASH_DARK = hexc("#2F6E3C")
CASH_LIGHT = hexc("#A8D48A")
HAY = hexc("#E8C15A")
HAY_DARK = hexc("#B8913A")
HORSE = hexc("#7A4524")
HORSE_DARK = hexc("#3A2316")
STONE = hexc("#9A8D7E")
STONE_DARK = hexc("#6B6056")
SCORCH = hexc("#3A2A20")
DIRT_DARK = hexc("#8F5A33")
BLACK = hexc("#120A06")


def block(m, c, size, rot=(0.0, 0.0, 0.0), color=OAK, mat="plain"):
    """A box at c, with half-widths size, turned by rot. Lit from above, a little, by its paint."""
    hx, hy, hz = size
    R = Matrix.Rotation(rot[1], 3, "Y") @ Matrix.Rotation(rot[0], 3, "X") @ Matrix.Rotation(rot[2], 3, "Z")
    C = Vector(c)

    def P(x, y, z):
        return tuple(C + R @ Vector((x, y, z)))

    n = P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)
    f = P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz)
    m.face(list(n), shade(color, 1.0), mat)
    m.face(list(f), shade(color, 0.7), mat)
    m.face([n[3], n[2], f[3], f[2]], shade(color, 1.16), mat)
    m.face([f[1], f[0], n[1], n[0]], shade(color, 0.55), mat)
    m.face([n[1], f[0], f[3], n[2]], shade(color, 0.84), mat)
    m.face([f[1], n[0], n[3], f[2]], shade(color, 0.84), mat)


def beam(m, a, b, w, t, color=OAK, mat="wood"):
    """A square-cut length of timber from a to b."""
    A, B = Vector(a), Vector(b)
    u = (B - A).normalized()
    ref = Vector((0, 1, 0)) if abs(u.y) < 0.9 else Vector((1, 0, 0))
    v = u.cross(ref).normalized()
    n = u.cross(v).normalized()

    def ring(p):
        return [tuple(p + v * sv * w + n * sn * t) for sv, sn in ((-1, -1), (1, -1), (1, 1), (-1, 1))]

    s, e = ring(A), ring(B)
    for i in range(4):
        j = (i + 1) % 4
        m.face([s[j], s[i], e[i], e[j]], shade(color, 0.72 + 0.14 * i), mat)
    m.face(s, shade(color, 0.6), mat)
    m.face(e[::-1], hexc("#E2B77C") if mat == "wood" else shade(color, 0.9), mat)


def pile_of_boards(m, rnd, cx, cz, radius, count, tall=0.5):
    """Smashed timber, thrown down any old way."""
    for _ in range(count):
        a = rnd.random() * math.tau
        d = rnd.random() * radius * 0.7
        length = 0.5 + rnd.random() * 0.75
        turn = rnd.random() * math.tau
        y0 = 0.05 + rnd.random() * tall
        lift = (rnd.random() - 0.35) * 0.5
        x, z = cx + math.cos(a) * d, cz + math.sin(a) * d
        tone = mix(OAK_DARK, OAK_LIGHT, rnd.random())
        beam(m, (x, y0, z), (x + math.cos(turn) * length, max(0.04, y0 + lift), z + math.sin(turn) * length), 0.1 + rnd.random() * 0.05, 0.03, tone)


def wheel(m, c, r, axis_turn=0.0, missing=0):
    """A wagon wheel on its side or on edge, with a few spokes gone if asked."""
    C = Vector(c)
    R = Matrix.Rotation(axis_turn, 3, "X")
    n = 9

    def at(i, k):
        a = i / n * math.tau
        return tuple(C + R @ Vector((math.cos(a) * k, math.sin(a) * k, 0)))

    for i in range(n - missing):
        beam(m, at(i, r), at(i + 1, r), 0.07, 0.05, OAK_DARK)
    for i in range(0, n - missing, 3):
        beam(m, at(i, 0.08), at(i, r), 0.035, 0.03, OAK)
    block(m, c, (0.1, 0.1, 0.1), (axis_turn, 0, 0), IRON)


def wagon_wreck():
    """A wagon on its side, its bed stove in and one wheel off."""
    m = Mesher()
    rnd = random.Random(101)
    # The bed, tipped up, with boards stove in.
    for i in range(6):
        x = -1.25 + i * 0.5
        if i == 3:
            continue
        drop = 0.2 if i == 4 else 0.0
        tone = mix(OAK_DARK, OAK_LIGHT, rnd.random())
        beam(m, (x, 0.12, 0.72), (x + 0.04, 1.2 - drop, 0.25), 0.22, 0.04, tone)
    # The side boards, one snapped.
    beam(m, (-1.5, 1.25, 0.2), (1.5, 1.25, 0.2), 0.09, 0.05, OAK_DARK)
    beam(m, (-1.5, 0.12, 0.76), (0.1, 0.12, 0.76), 0.09, 0.05, OAK_DARK)
    beam(m, (0.1, 0.12, 0.76), (0.9, 0.46, 1.1), 0.09, 0.05, OAK_DARK)
    wheel(m, (-1.1, 0.7, -0.2), 0.62)
    wheel(m, (1.65, 0.1, 0.95), 0.62, math.pi / 2, 2)
    pile_of_boards(m, rnd, 0.3, 0.9, 1.1, 6, 0.2)
    return m


def crate_pile():
    """Crates off the wagon, one burst open, with strong-box iron on the corners."""
    m = Mesher()
    rnd = random.Random(102)
    for (x, y, z, s, turn) in ((-0.55, 0.45, 0.1, 0.45, 0.3), (0.5, 0.38, -0.15, 0.38, -0.5), (-0.1, 1.12, -0.05, 0.32, 0.9)):
        block(m, (x, y, z), (s, s, s), (0, turn, 0), OAK, "wood")
        for sx in (-1, 1):
            for sy in (-1, 1):
                ca, sa = math.cos(turn), math.sin(turn)
                ox, oz = sx * (s + 0.01), s + 0.01
                block(m, (x + ca * ox + sa * oz, y + sy * s * 0.86, z - sa * ox + ca * oz), (0.05, 0.05, 0.015), (0, turn, 0), IRON)
    # One's burst on the ground, with its lid off.
    block(m, (0.95, 0.12, 0.72), (0.4, 0.12, 0.4), (0, 0.5, 0), SEAM)
    for sx, sz in ((-1, 0), (1, 0), (0, 1)):
        beam(m, (0.95 + sx * 0.42, 0.03, 0.72 + sz * 0.42), (0.95 + sx * 0.62, 0.42, 0.72 + sz * 0.6), 0.34, 0.03, OAK_LIGHT)
    pile_of_boards(m, rnd, 0.2, 0.9, 1.0, 5, 0.15)
    return m


def porch_wreck():
    """A length of porch brought down: its roof at a slant on snapped posts."""
    m = Mesher()
    rnd = random.Random(103)
    # The roof, in long boards, one end on the ground.
    for i in range(7):
        x = -1.5 + i * 0.5
        lift = 0.14 if i % 3 == 0 else 0.0
        tone = mix(OAK_DARK, OAK, rnd.random())
        beam(m, (x, 0.1, 1.15 + lift), (x + (rnd.random() - 0.5) * 0.1, 1.45 + lift, -0.4), 0.25, 0.035, tone)
    beam(m, (-1.75, 1.42, -0.42), (1.8, 1.48, -0.42), 0.1, 0.09, OAK_DARK)
    # What's left of the posts: one still up, one snapped, one on the floor.
    beam(m, (-1.4, 0.0, -0.45), (-1.4, 1.42, -0.42), 0.08, 0.08, OAK)
    beam(m, (1.4, 0.0, -0.45), (1.42, 0.62, -0.45), 0.08, 0.08, OAK)
    beam(m, (0.3, 0.06, -0.85), (1.45, 0.08, -1.2), 0.08, 0.08, OAK)
    # Rocks and brick from the wall behind.
    for _ in range(7):
        x, z = -1.2 + rnd.random() * 2.6, 0.9 + rnd.random() * 0.8
        s = 0.1 + rnd.random() * 0.13
        block(m, (x, s, z), (s * 1.3, s, s), (rnd.random(), rnd.random() * 3, rnd.random()), mix(STONE, STONE_DARK, rnd.random()))
    return m


def stable():
    """A horse stable, open at the front, its roof half gone, and a horse who'd like to leave."""
    m = Mesher()
    rnd = random.Random(104)
    W, D, H = 2.3, 1.2, 2.3
    # Back wall in planks, with a gap where a board's come away.
    for i in range(12):
        x = -W + (i + 0.5) * (2 * W / 12)
        top = H - abs(i - 6) * 0.015
        if i == 9:
            top = 1.35
        block(m, (x, top / 2, -D), (W / 12 - 0.012, top / 2, 0.05), (0, 0, 0), mix(OAK_DARK, OAK, rnd.random()), "wood")
    # Side walls, and the posts between the stalls.
    for sx in (-1, 1):
        block(m, (sx * W, H * 0.5, 0), (0.05, H * 0.5, D), (0, 0, 0), OAK_DARK, "wood")
    for x in (-W / 3, W / 3):
        block(m, (x, 0.65, -0.1), (0.04, 0.65, D * 0.9), (0, 0, 0), OAK, "wood")
    for x in (-W, -W / 3, W / 3, W):
        block(m, (x, H * 0.5, D), (0.09, H * 0.5, 0.09), (0, 0, 0), OAK_DARK, "wood")
    # The lintel, split, and half the roof in place at a slant.
    beam(m, (-W - 0.15, H, D), (0.5, H, D), 0.11, 0.09, OAK_DARK)
    beam(m, (0.5, H, D), (W + 0.15, H - 0.75, D + 0.15), 0.11, 0.09, OAK_DARK)
    for i in range(8):
        x = -W - 0.1 + i * 0.5
        if i == 6:
            continue
        end = 0.0 if i > 4 else -0.15
        tone = mix(OAK_DARK, OAK_LIGHT, rnd.random() * 0.5)
        beam(m, (x, H + 0.72, -D - 0.2), (x, H + 0.05 + (0.2 if i > 4 else 0), D + 0.35 + end), 0.23, 0.035, tone)
    # The stall doors: one shut, one hanging off, and a sign.
    block(m, (-W * 2 / 3, 0.62, D), (W / 3 - 0.1, 0.55, 0.04), (0, 0, 0), RED_DARK, "wood")
    beam(m, (-W + 0.1, 0.1, D + 0.05), (-W / 3 - 0.1, 1.15, D + 0.05), 0.05, 0.05, CREAM)
    block(m, (W * 2 / 3 + 0.25, 0.46, D + 0.55), (W / 3 - 0.14, 0.42, 0.04), (0.2, -0.75, 0.22), RED_DARK, "wood")
    # Hay, bales and a heap.
    for (x, y, z, sx, sy, sz, r) in ((1.55, 0.27, 0.15, 0.48, 0.27, 0.34, 0.2), (0.95, 0.27, 0.75, 0.48, 0.27, 0.34, -0.5), (1.3, 0.8, 0.3, 0.46, 0.25, 0.32, 0.6)):
        block(m, (x, y, z), (sx, sy, sz), (0, r, 0), HAY)
        block(m, (x, y, z), (sx * 0.2, sy * 1.03, sz * 1.03), (0, r, 0), HAY_DARK)
    block(m, (0.05, 0.28, 0.25), (0.46, 0.28, 0.5), (0, 0.4, 0), HAY)
    # The horse: a neck and a long face over the stall door, looking out.
    hx, hz = -W * 2 / 3, D - 0.2
    beam(m, (hx, 0.6, hz - 0.7), (hx, 1.62, hz - 0.1), 0.2, 0.17, HORSE, "plain")
    block(m, (hx, 1.75, hz + 0.1), (0.17, 0.19, 0.2), (0, 0, 0), HORSE)
    block(m, (hx, 1.56, hz + 0.42), (0.12, 0.13, 0.28), (0.2, 0, 0), HORSE)
    block(m, (hx, 1.48, hz + 0.67), (0.125, 0.09, 0.07), (0.2, 0, 0), HORSE_DARK)
    for sx in (-1, 1):
        block(m, (hx + sx * 0.12, 2.0, hz), (0.04, 0.09, 0.03), (0, 0, sx * -0.2), HORSE)
        block(m, (hx + sx * 0.175, 1.8, hz + 0.16), (0.012, 0.04, 0.04), (0, 0, 0), BLACK)
    beam(m, (hx, 2.0, hz - 0.15), (hx, 1.2, hz - 0.72), 0.05, 0.06, HORSE_DARK, "plain")
    return m


def ingot(m, cx, y, cz, turn):
    ca, sa = math.cos(turn), math.sin(turn)

    def p(x, py, z):
        return (cx + ca * x + sa * z, py, cz - sa * x + ca * z)

    w0, d0, w1, d1, h = 0.33, 0.16, 0.26, 0.1, 0.13
    b = [p(-w0, y, d0), p(w0, y, d0), p(w0, y, -d0), p(-w0, y, -d0)]
    t = [p(-w1, y + h, d1), p(w1, y + h, d1), p(w1, y + h, -d1), p(-w1, y + h, -d1)]
    for i in range(4):
        j = (i + 1) % 4
        m.face([b[i], b[j], t[j], t[i]], GOLD if i % 2 == 0 else GOLD_DARK)
    m.face(t, GOLD_LIGHT)


def gold_bars():
    """A stack of bars, and a couple knocked off it."""
    m = Mesher()
    for (x, z) in ((-0.34, 0.18), (0.34, 0.18), (-0.34, -0.18), (0.34, -0.18)):
        ingot(m, x, 0.0, z, 0.0)
    for (x, z) in ((0.0, 0.18), (0.0, -0.18)):
        ingot(m, x, 0.13, z, 0.0)
    ingot(m, 0.0, 0.26, 0.0, 0.0)
    ingot(m, 1.0, 0.0, 0.42, 0.8)
    ingot(m, -0.95, 0.0, 0.5, -0.5)
    return m


def cash():
    """Bundles of bills, and loose ones all over."""
    m = Mesher()
    rnd = random.Random(105)

    def bundle(x, y, z, turn):
        block(m, (x, y + 0.05, z), (0.3, 0.05, 0.15), (0, turn, 0), CASH)
        block(m, (x, y + 0.052, z), (0.07, 0.053, 0.153), (0, turn, 0), CREAM)

    for (x, y, z, t) in ((0, 0, 0, 0.2), (0.05, 0.1, 0.02, -0.1), (-0.02, 0.2, -0.02, 0.35), (0.72, 0, 0.3, -0.7), (-0.7, 0, 0.32, 0.9)):
        bundle(x, y, z, t)
    for _ in range(11):
        a = rnd.random() * math.tau
        d = 0.4 + rnd.random() * 1.1
        x, z = math.cos(a) * d, math.sin(a) * d
        turn = rnd.random() * math.tau
        ca, sa = math.cos(turn), math.sin(turn)
        y = 0.03 + rnd.random() * 0.03

        def p(u, v, lift=0.0):
            return (x + ca * u + sa * v, y + lift, z - sa * u + ca * v)

        m.face([p(-0.28, 0.13), p(0.28, 0.13, 0.05), p(0.28, -0.13, 0.05), p(-0.28, -0.13)], CASH_LIGHT if rnd.random() < 0.4 else CASH)
        m.face([p(-0.07, 0.07, 0.015), p(0.07, 0.07, 0.03), p(0.07, -0.07, 0.03), p(-0.07, -0.07, 0.015)], CASH_DARK)
    return m


def vault_door():
    """The bank's vault door, blown clean off: a thick steel disc lying flat, origin at its middle."""
    m = Mesher()
    n = 14
    r = 1.05
    bottom = y_ring(0, 0.0, 0, r, r, n)
    top = y_ring(0, 0.3, 0, r, r, n)
    top_in = y_ring(0, 0.3, 0, r * 0.82, r * 0.82, n)
    plate = y_ring(0, 0.38, 0, r * 0.78, r * 0.78, n)
    m.rings([bottom, top], lambda r_, i: STEEL_DARK if i % 2 else STEEL)
    m.rings([top, top_in], STEEL)
    m.rings([top_in, plate], STEEL_DARK)
    m.rings([plate, plate], STEEL, cap_end=True)
    for i in range(n):
        a = i / n * math.tau
        block(m, (math.cos(a) * r * 0.91, 0.34, math.sin(a) * r * 0.91), (0.045, 0.05, 0.045), (0, a, 0), BRASS)
    # The wheel.
    block(m, (0, 0.46, 0), (0.1, 0.1, 0.1), (0, 0.4, 0), BRASS)
    for i in range(3):
        a = i / 3 * math.pi + 0.4
        dx, dz = math.cos(a) * 0.46, math.sin(a) * 0.46
        beam(m, (-dx, 0.5, -dz), (dx, 0.5, dz), 0.035, 0.035, BRASS, "plain")
    # Scorched, and a dent.
    block(m, (0.42, 0.385, -0.35), (0.24, 0.006, 0.18), (0, 0.5, 0), SCORCH)
    return m


def jagged(rnd, cx, cy, rx, ry, n, spike=0.32):
    out = []
    for i in range(n):
        a = i / n * math.tau
        k = 1 + (spike if i % 2 == 0 else -spike * 0.6) * (0.4 + rnd.random() * 0.6)
        out.append((cx + math.cos(a) * rx * k, cy + math.sin(a) * ry * k))
    return out


def fan(m, centre, pts, z, color):
    """A jagged shape on the wall, as a fan of triangles so it can dent inward."""
    c = (centre[0], centre[1], z)
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        m.face([c, (a[0], a[1], z), (b[0], b[1], z)], color)


def bank_ruin():
    """Blown open. This goes over the bank's real front: the wall's at z 0 and the street's toward +z.
    The middle of the bank's front is at x 0, and its walls run to about x 4.5 either side."""
    m = Mesher()
    rnd = random.Random(106)
    # The great hole where the door was: torn timber round a black inside, with the vault showing.
    centre = (0.0, 1.8)
    outer = jagged(rnd, 0.0, 1.8, 2.5, 2.2, 22, 0.24)
    inner = [(centre[0] + (p[0] - centre[0]) * 0.82, centre[1] + (p[1] - centre[1]) * 0.82) for p in outer]
    fan(m, centre, [(p[0], max(0.0, p[1])) for p in outer], 0.05, hexc("#E2B77C"))
    fan(m, centre, [(p[0], max(0.0, p[1])) for p in inner], 0.08, BLACK)
    # Inside: the empty vault, shelves of gold, and a glint of it left.
    block(m, (0, 1.65, 0.1), (1.35, 1.32, 0.01), (0, 0, 0), SCORCH)
    for y in (0.75, 1.5, 2.25):
        block(m, (0, y, 0.13), (1.25, 0.04, 0.03), (0, 0, 0), STONE_DARK)
        for i in range(5):
            if (i + int(y * 4)) % 2:
                continue
            block(m, (-1 + i * 0.5, y + 0.1, 0.14), (0.17, 0.065, 0.03), (0, 0, 0), GOLD)
    # Smashed boards hanging across the edges.
    for (ax, ay, bx, by, w) in ((-2.3, 3.5, -1.2, 2.5, 0.13), (-2.5, 2.4, -1.5, 1.7, 0.12), (2.4, 3.4, 1.4, 3.05, 0.13), (2.1, 2.2, 1.45, 1.1, 0.12), (-0.7, 4.1, -0.4, 3.0, 0.13), (0.6, 4.05, 1.0, 3.25, 0.12)):
        beam(m, (ax, ay, 0.16), (bx, by, 0.3), w, 0.03, mix(OAK_DARK, OAK_LIGHT, rnd.random()))
    # The window's in as well, and the wall's cracked up to the sign, which has lost a corner.
    win = (3.05, 2.05)
    fan(m, win, jagged(rnd, win[0], win[1], 0.95, 1.2, 12, 0.3), 0.06, BLACK)
    beam(m, (2.3, 1.2, 0.2), (3.8, 2.9, 0.2), 0.1, 0.03, OAK_LIGHT)
    win2 = (-3.15, 2.1)
    fan(m, win2, jagged(rnd, win2[0], win2[1], 0.8, 0.95, 12, 0.34), 0.06, BLACK)
    beam(m, (-3.9, 1.5, 0.2), (-2.4, 2.7, 0.2), 0.1, 0.03, OAK)
    for (pts, c) in (
        ([(1.1, 3.9), (1.45, 4.35), (1.25, 4.7), (1.72, 5.15), (1.5, 5.45), (1.62, 5.36), (1.95, 5.0), (1.48, 4.65), (1.72, 4.3), (1.25, 3.85)], (1.45, 4.5)),
        ([(-1.5, 4.0), (-1.72, 4.45), (-1.5, 4.8), (-1.65, 4.85), (-1.9, 4.45), (-1.66, 3.95)], (-1.65, 4.4)),
    ):
        fan(m, c, pts, 0.1, BLACK)
    fan(m, (2.65, 5.25), [(2.0, 4.45), (2.6, 4.75), (3.05, 4.4), (3.1, 6.0), (1.95, 6.0), (2.3, 5.4)], 0.1, BLACK)
    # Scorch marks up the wall.
    for (x, y, rx, ry) in ((-1.4, 3.95, 0.5, 0.42), (1.2, 4.0, 0.42, 0.34), (-3.5, 3.1, 0.34, 0.34)):
        fan(m, (x, y), jagged(rnd, x, y, rx, ry, 10, 0.4), 0.045, SCORCH)
    # Rubble, heaped out in front of it.
    pile_of_boards(m, rnd, 0.0, 1.0, 3.6, 20, 0.4)
    for _ in range(16):
        x, z = -2.9 + rnd.random() * 5.8, 0.25 + rnd.random() * 1.6
        s = 0.12 + rnd.random() * 0.2
        block(m, (x, s * 0.8, z), (s * 1.3, s, s * 1.1), (rnd.random(), rnd.random() * 3, rnd.random()), mix(STONE, STONE_DARK, rnd.random()))
    # The fallen door, flat on the heap.
    beam(m, (-0.8, 0.3, 1.45), (0.5, 0.42, 2.15), 0.58, 0.05, hexc("#2F3DA8"))
    return m


def arena_floor():
    """The ground, cratered where the blast went off: a scuffed disc with a dark ring round its edge and
    cracks running out from the middle. Radius is one: the game scales it to fit."""
    m = Mesher()
    rnd = random.Random(107)
    n = 28

    def ring(r, y):
        return y_ring(0, y, 0, r, r, n)

    m.rings([ring(1.0, 0.0), ring(0.9, 0.0)], lambda r_, i: DIRT_DARK if i % 3 else SCORCH)
    # Broken patches of scorch, inside.
    for _ in range(9):
        a = rnd.random() * math.tau
        d = 0.2 + rnd.random() * 0.62
        s = 0.05 + rnd.random() * 0.08
        cx, cz = math.cos(a) * d, math.sin(a) * d
        pts = [(cx + math.cos(-i / 8 * math.tau) * s * (0.7 + rnd.random() * 0.6), 0.0, cz + math.sin(-i / 8 * math.tau) * s * (0.7 + rnd.random() * 0.6)) for i in range(8)]
        m.face(pts, DIRT_DARK)
    # Cracks out from the middle.
    for i in range(7):
        a = i / 7 * math.tau + rnd.random() * 0.4
        x, z, w = 0.0, 0.0, 0.03
        for _ in range(4):
            a += (rnd.random() - 0.5) * 0.9
            nx, nz = x + math.cos(a) * 0.2, z + math.sin(a) * 0.2
            px, pz = -math.sin(a) * w, math.cos(a) * w
            m.face([(x - px, 0.002, z - pz), (nx - px * 0.6, 0.002, nz - pz * 0.6), (nx + px * 0.6, 0.002, nz + pz * 0.6), (x + px, 0.002, z + pz)][::-1], SCORCH)
            x, z, w = nx, nz, w * 0.7
    return m


def stake():
    """One splintered stake of the ring's fence, with a broken rail on it. Stands on its origin."""
    m = Mesher()
    beam(m, (0, -0.1, 0), (0.03, 1.15, 0), 0.1, 0.1, OAK_DARK)
    for sx in (-1, 1):
        beam(m, (0.04, 1.15, 0), (0.04 + sx * 0.06, 1.42, sx * 0.03), 0.05, 0.05, hexc("#E2B77C"))
    beam(m, (0, 0.82, 0.1), (0.72, 0.68, 0.14), 0.07, 0.03, OAK)
    beam(m, (0, 0.42, 0.1), (-0.5, 0.54, 0.14), 0.07, 0.03, OAK_LIGHT)
    return m


# --------------------------------------------------------------------------- the cannon and coliseum

BRICK = hexc("#B9A07E")
BRICK_DARK = hexc("#94795C")
STONE_PALE = hexc("#D6C6A6")
LIT = hexc("#FFD35A")
SUIT_BLUE = hexc("#3D4FC4")
SUIT_NAVY = hexc("#262F7A")
SUIT_ORANGE = hexc("#FF8A3C")
HAT_DARK = hexc("#26222E")
LIZ_A = hexc("#2F9E3A")
LIZ_B = hexc("#6FCB32")
LIZ_C = hexc("#1F7A4A")
LIZ_D = hexc("#A4D62E")
PAPER = hexc("#EEDFB8")


def side_wheel(m, x, y, z, r):
    """A big spoked wheel on the side of something, turning about x."""
    n = 10

    def at(i, k):
        a = i / n * math.tau
        return (x, y + math.sin(a) * k, z + math.cos(a) * k)

    for i in range(n):
        beam(m, at(i, r), at(i + 1, r), 0.09, 0.1, OAK_DARK)
    for i in range(0, n, 2):
        beam(m, at(i, 0.1), at(i, r), 0.045, 0.045, OAK)
    block(m, (x, y, z), (0.13, 0.15, 0.15), (0, 0, 0), IRON)


def cannon():
    """A field cannon on a wooden carriage, pointing along +z. Stands on its origin."""
    m = Mesher()
    for sx in (-1, 1):
        side_wheel(m, sx * 0.72, 0.72, 0.1, 0.72)
        # The carriage's cheeks, sloping down to the trail behind.
        beam(m, (sx * 0.34, 0.78, 0.5), (sx * 0.24, 0.16, -1.65), 0.09, 0.16, OAK_DARK)
    block(m, (0, 0.72, 0.1), (0.72, 0.07, 0.07), (0, 0, 0), IRON)
    block(m, (0, 0.92, -0.1), (0.26, 0.09, 0.42), (0, 0, 0), OAK)
    # The barrel, fat at the breech and flared at the mouth.
    pts = [(0, 1.02, -0.92), (0, 1.14, -0.72), (0, 1.16, -0.2), (0, 1.2, 0.55), (0, 1.24, 1.38), (0, 1.25, 1.62)]
    tube(m, pts, [0.06, 0.34, 0.33, 0.27, 0.25, 0.32], IRON, 10, group=70, caps=True)
    for (z, r) in ((-0.42, 0.37), (0.45, 0.31), (1.46, 0.34)):
        y = 1.16 + (z + 0.42) * 0.045
        tube(m, [(0, y, z - 0.05), (0, y, z + 0.05)], [r, r], BRASS, 10, group=71, caps=False)
    # The dark inside of its mouth.
    m.face([(math.cos(-i / 10 * math.tau) * 0.21, 1.25 + math.sin(-i / 10 * math.tau) * 0.21, 1.63) for i in range(10)][::-1], BLACK)
    # A knob at the back, and the fuse.
    m.rings([y_ring(0, 1.15, -0.95, 0.09, 0.09, 6), y_ring(0, 1.15, -0.95, 0.09, 0.09, 6)], BRASS)
    block(m, (0, 1.02, -1.02), (0.1, 0.1, 0.1), (0, 0, 0), BRASS)
    beam(m, (0.05, 1.46, -0.5), (0.13, 1.62, -0.6), 0.02, 0.02, FUSE, "plain")
    return m


def cannonball():
    """A great iron ball of radius one, painted so you can see it rolling at you."""
    m = Mesher()
    sides, rows = 12, 8

    def ring(j):
        lat = -math.pi / 2 + (j / rows) * math.pi
        r, y = math.cos(lat), math.sin(lat)
        return [(math.cos(-i / sides * math.tau) * r, y, math.sin(-i / sides * math.tau) * r) for i in range(sides)]

    grid = [ring(j) for j in range(rows + 1)]
    for j in range(rows):
        for i in range(sides):
            k = (i + 1) % sides
            a, b, c, d = grid[j][i], grid[j][k], grid[j + 1][k], grid[j + 1][i]
            band = j in (3, 4) and (i // 2) % 2 == 0
            pale = (i // 3 + j // 2) % 2 == 0
            col = RED if band else (IRON_LIGHT if pale else IRON)
            if j == 0:
                m.face([a, c, d], col)
            elif j == rows - 1:
                m.face([a, b, c], col)
            else:
                m.face([a, b, c, d], col)
    return m


PIXELS = {
    "B": ["1110", "1001", "1001", "1110", "1001", "1001", "1110"],
    "A": ["0110", "1001", "1001", "1111", "1001", "1001", "1001"],
    "N": ["1001", "1101", "1101", "1011", "1011", "1001", "1001"],
    "K": ["1001", "1010", "1100", "1100", "1010", "1001", "1001"],
}


def grand_bank():
    """The great bank that closes off the block: stone and columns, far bigger than anything else in town.
    Its front wall is at z 0, its steps come out toward +z, and it's 24 wide and about 12 tall."""
    m = Mesher()
    rnd = random.Random(201)
    W, H = 12.0, 8.6
    # The wall, in courses of stone.
    rows = 9
    for r in range(rows):
        y0, y1 = H * r / rows, H * (r + 1) / rows
        block(m, (0, (y0 + y1) / 2, -0.6), (W, (y1 - y0) / 2 - 0.01, 0.6), (0, 0, 0), mix(BRICK, BRICK_DARK, rnd.random() * 0.6))
    # Steps.
    for i, (d, inset) in enumerate(((2.9, 0.0), (2.2, 0.4), (1.5, 0.8))):
        block(m, (0, 0.17 + i * 0.32, d / 2), (W - inset, 0.17, d / 2), (0, 0, 0), mix(STONE_PALE, STONE, i * 0.3))
    # Windows, lit from inside, both sides of the blast.
    for x in (-9.9, -7.0, 7.0, 9.9):
        for y in (2.5, 5.9):
            block(m, (x, y, 0.03), (0.72, 1.05, 0.03), (0, 0, 0), HORSE_DARK)
            block(m, (x, y, 0.07), (0.58, 0.9, 0.03), (0, 0, 0), LIT)
            block(m, (x, y, 0.1), (0.04, 0.9, 0.02), (0, 0, 0), HORSE_DARK)
            block(m, (x, y, 0.1), (0.58, 0.04, 0.02), (0, 0, 0), HORSE_DARK)
    # Columns. Two on the right have come down, and lie in pieces on the steps.
    for x, top in ((-11.1, 8.7), (-8.45, 8.7), (-5.6, 8.7), (5.6, 3.9), (8.45, 6.2), (11.1, 8.7)):
        tube(m, [(x, 0.95, 1.55), (x, top, 1.55)], [0.5, 0.42], STONE_PALE, 9, group=int(80 + x), caps=True)
        block(m, (x, 1.1, 1.55), (0.62, 0.15, 0.62), (0, 0, 0), STONE)
        if top > 8:
            block(m, (x, top - 0.06, 1.55), (0.6, 0.16, 0.6), (0, 0, 0), STONE)
    tube(m, [(4.6, 1.42, 2.3), (2.8, 1.25, 3.5)], [0.46, 0.46], STONE_PALE, 9, group=95, caps=True)
    tube(m, [(9.2, 1.42, 2.8), (10.9, 1.35, 3.6)], [0.42, 0.42], STONE_PALE, 9, group=96, caps=True)
    # The great beam across the top, with the name on it, and the roof's point above.
    block(m, (0, 9.65, 0.75), (W + 0.3, 1.1, 1.75), (0, 0, 0), STONE_PALE)
    block(m, (0, 8.62, 0.8), (W + 0.4, 0.13, 1.85), (0, 0, 0), STONE)
    block(m, (0, 10.78, 0.8), (W + 0.5, 0.14, 1.9), (0, 0, 0), STONE)
    px = 0.25
    x0 = -((4 * 4 + 3) * px) / 2
    for li, letter in enumerate("BANK"):
        for ry, row in enumerate(PIXELS[letter]):
            for rx, on in enumerate(row):
                if on == "1":
                    x = x0 + (li * 5 + rx + 0.5) * px
                    y = 10.5 - (ry + 0.5) * px
                    block(m, (x, y, 2.54), (px / 2 - 0.006, px / 2 - 0.006, 0.05), (0, 0, 0), GOLD)
    z = 2.65
    apex = (0.0, 13.0, z)
    l, r = (-W - 0.4, 10.92, z), (W + 0.4, 10.92, z)
    m.face([l, r, apex], BRICK)
    m.face([(-W - 0.4, 10.92, -1.2), (0.0, 13.0, -1.2), apex, l], BRICK_DARK)
    m.face([(W + 0.4, 10.92, -1.2), r, apex, (0.0, 13.0, -1.2)], BRICK_DARK)
    # A gold star in the point of it.
    star = [(math.cos(i / 10 * math.tau + math.pi / 2) * (0.7 if i % 2 == 0 else 0.3), 11.85 + math.sin(i / 10 * math.tau + math.pi / 2) * (0.7 if i % 2 == 0 else 0.3), z + 0.03) for i in range(10)]
    fan(m, (0.0, 11.85), [(p[0], p[1]) for p in star], z + 0.03, GOLD)
    # Blast damage up the wall, and a bite out of the roof.
    for (x, y, rx, ry) in ((4.5, 7.4, 1.0, 0.8), (-4.7, 7.6, 0.8, 0.7), (6.8, 8.2, 0.7, 0.5)):
        fan(m, (x, y), jagged(rnd, x, y, rx, ry, 10, 0.4), 0.02, SCORCH)
    fan(m, (8.6, 11.3), jagged(rnd, 8.6, 11.3, 1.5, 0.75, 10, 0.3), z + 0.02, BLACK)
    return m


def stand():
    """One section of the bleachers: three rows of bench going up and back. Origin at the middle of its
    front edge, on the ground, and it faces +z."""
    m = Mesher()
    rnd = random.Random(202)
    w = 3.1
    for i in range(3):
        y = 0.75 + i * 0.8
        z = -0.5 - i * 1.0
        block(m, (0, y, z), (w, 0.08, 0.42), (0, 0, 0), mix(OAK, OAK_LIGHT, rnd.random()), "wood")
        block(m, (0, y - 0.36, z + 0.38), (w, 0.32, 0.04), (0, 0, 0), OAK_DARK, "wood")
        for x in (-w + 0.15, 0, w - 0.15):
            block(m, (x, y / 2, z), (0.08, y / 2, 0.08), (0, 0, 0), OAK_DARK)
    # The rail along the back, hung with bunting.
    for x in (-w + 0.1, w - 0.1):
        block(m, (x, 2.5, -3.1), (0.08, 2.5, 0.08), (0, 0, 0), OAK_DARK)
    block(m, (0, 4.3, -3.1), (w, 0.06, 0.05), (0, 0, 0), OAK_DARK)
    for i in range(7):
        x = -w + 0.45 + i * 0.86
        col = RED if i % 2 == 0 else CREAM
        m.face([(x - 0.26, 4.25, -3.04), (x, 3.75, -3.04), (x + 0.26, 4.25, -3.04)], col)
        m.face([(x + 0.26, 4.25, -3.06), (x, 3.75, -3.06), (x - 0.26, 4.25, -3.06)], shade(col, 0.7))
    return m


def crowd():
    """Lizards packed onto one section of the bleachers. Kept apart from it, so they can bounce."""
    m = Mesher()
    rnd = random.Random(203)
    skins = (LIZ_A, LIZ_B, LIZ_C, LIZ_D)
    suits = (SUIT_BLUE, SUIT_ORANGE, SUIT_NAVY, SUIT_BLUE)
    hats = (HAT_DARK, SUIT_NAVY, OAK_DARK, CREAM)
    for row in range(3):
        y = 0.83 + row * 0.8
        z = -0.5 - row * 1.0
        for i in range(5):
            x = -2.5 + i * 1.25 + (rnd.random() - 0.5) * 0.3
            skin = skins[rnd.randrange(4)]
            # A round body, and a big round head like theirs in the street, with eyes you can see from far off.
            m.rings([y_ring(x, y, z, 0.2, 0.17, 6), y_ring(x, y + 0.46, z, 0.28, 0.21, 6), y_ring(x, y + 0.62, z, 0.14, 0.12, 6)], suits[rnd.randrange(4)], cap_end=True)
            hy = y + 0.92
            m.rings([y_ring(x, hy - 0.3, z, 0.18, 0.16, 7), y_ring(x, hy - 0.08, z, 0.38, 0.34, 7), y_ring(x, hy + 0.2, z, 0.28, 0.26, 7)], skin, cap_start=True, cap_end=True)
            for sx in (-0.13, 0.13):
                block(m, (x + sx, hy + 0.04, z + 0.33), (0.08, 0.075, 0.015), (0, 0, 0), LIT)
                block(m, (x + sx, hy + 0.03, z + 0.345), (0.035, 0.04, 0.01), (0, 0, 0), HAT_DARK)
            hat = hats[rnd.randrange(4)]
            m.rings([y_ring(x, hy + 0.19, z, 0.52, 0.42, 8), y_ring(x, hy + 0.23, z, 0.52, 0.42, 8)], hat, cap_start=True, cap_end=True)
            m.rings([y_ring(x, hy + 0.23, z, 0.26, 0.24, 7), y_ring(x, hy + 0.5, z, 0.2, 0.18, 7)], hat, cap_end=True)
            # Half of them have a fist in the air.
            if i % 2 == row % 2:
                beam(m, (x + 0.24, y + 0.4, z), (x + 0.42, y + 1.05, z + 0.05), 0.06, 0.06, skin)
    return m


def fence():
    """A length of rodeo fence, 3.2 long, standing on its origin and facing +z."""
    m = Mesher()
    rnd = random.Random(204)
    for x in (-1.6, 1.6):
        beam(m, (x, -0.1, 0), (x, 1.75, 0), 0.11, 0.11, OAK_DARK)
    for y, drop in ((0.5, -0.03), (1.0, 0.04), (1.5, 0.0)):
        beam(m, (-1.72, y, 0.13), (1.72, y + drop, 0.13), 0.09, 0.035, mix(OAK, OAK_LIGHT, rnd.random()))
    return m


def poster():
    """A wanted poster on a nail, for the fence."""
    m = Mesher()
    block(m, (0, 0, 0), (0.38, 0.5, 0.012), (0, 0, 0.04), PAPER)
    block(m, (0, 0.33, 0.016), (0.28, 0.07, 0.006), (0, 0, 0.04), SEAM)
    # A rough head, with a hat on it.
    m.face([(math.cos(i / 10 * math.tau) * 0.19, -0.02 + math.sin(i / 10 * math.tau) * 0.17, 0.016) for i in range(10)], LIZ_A)
    block(m, (0, 0.14, 0.018), (0.25, 0.02, 0.005), (0, 0, 0), HAT_DARK)
    block(m, (0, 0.2, 0.018), (0.12, 0.06, 0.005), (0, 0, 0), HAT_DARK)
    block(m, (0, -0.34, 0.016), (0.22, 0.05, 0.006), (0, 0, 0.04), RED)
    return m


def torch():
    """A tall post with an iron basket at the top. The game lights it."""
    m = Mesher()
    beam(m, (0, 0, 0), (0, 4.0, 0), 0.12, 0.12, OAK_DARK)
    beam(m, (-0.4, 0.0, 0.4), (0, 1.1, 0), 0.05, 0.05, OAK)
    beam(m, (0.4, 0.0, -0.4), (0, 1.1, 0), 0.05, 0.05, OAK)
    m.rings([y_ring(0, 4.0, 0, 0.16, 0.16, 8), y_ring(0, 4.35, 0, 0.42, 0.42, 8)], IRON, cap_start=True, cap_end=False)
    m.face(y_ring(0, 4.2, 0, 0.32, 0.32, 8), BLACK)
    return m


def heart():
    """A real heart, roughly a unit tall each way from the middle: two chambers, its big vessels and veins."""
    m = Mesher()
    flesh = hexc("#D8201A")
    deep = hexc("#A8241C")
    vessel = hexc("#F2681A")
    vein = hexc("#6E1712")
    tube(m, [(-0.04, -1.0, 0.0), (-0.16, -0.72, 0.02), (-0.28, -0.32, 0.03), (-0.33, 0.06, 0.02), (-0.3, 0.36, 0.0), (-0.22, 0.52, -0.02)], [0.03, 0.27, 0.5, 0.6, 0.5, 0.24], flesh, 12, group=1)
    tube(m, [(0.1, -0.74, 0.0), (0.24, -0.42, 0.0), (0.36, -0.06, 0.0), (0.4, 0.22, 0.0), (0.34, 0.44, -0.02)], [0.04, 0.3, 0.46, 0.46, 0.2], flesh, 12, group=2)
    # The big arch out of the top, and the two smaller vessels beside it.
    tube(m, [(-0.08, 0.3, -0.02), (-0.1, 0.72, -0.04), (0.04, 0.98, -0.06), (0.32, 1.02, -0.08), (0.56, 0.82, -0.08)], [0.25, 0.22, 0.2, 0.18, 0.15], vessel, 10, group=3)
    tube(m, [(0.24, 0.3, 0.18), (0.24, 0.62, 0.26), (0.34, 0.8, 0.34)], [0.17, 0.15, 0.13], deep, 8, group=4)
    tube(m, [(-0.48, 0.28, -0.1), (-0.66, 0.54, -0.14), (-0.74, 0.78, -0.18)], [0.15, 0.12, 0.1], deep, 8, group=5)
    # Veins running down the front, so it reads as flesh rather than a valentine.
    tube(m, [(0.02, 0.46, 0.42), (-0.04, 0.1, 0.57), (-0.14, -0.28, 0.52), (-0.13, -0.66, 0.26)], [0.045, 0.05, 0.04, 0.02], vein, 6, group=6)
    tube(m, [(-0.04, 0.1, 0.57), (-0.4, -0.06, 0.55), (-0.56, -0.28, 0.32)], [0.035, 0.03, 0.015], vein, 6, group=7)
    tube(m, [(-0.09, -0.1, 0.56), (0.24, -0.24, 0.42), (0.36, -0.46, 0.26)], [0.03, 0.03, 0.015], vein, 6, group=8)
    return m


for name, build in (
    ("barrel", barrel),
    ("machete", machete),
    ("axe", axe),
    ("club", club),
    ("molotov", molotov),
    ("shield", shield),
    ("shield_shot", shield_shot),
    ("shield_wrecked", shield_wrecked),
    ("shield_plank", shield_plank),
    ("wagon_wreck", wagon_wreck),
    ("crate_pile", crate_pile),
    ("porch_wreck", porch_wreck),
    ("stable", stable),
    ("gold_bars", gold_bars),
    ("cash", cash),
    ("vault_door", vault_door),
    ("bank_ruin", bank_ruin),
    ("arena_floor", arena_floor),
    ("stake", stake),
    ("cannon", cannon),
    ("cannonball", cannonball),
    ("grand_bank", grand_bank),
    ("stand", stand),
    ("crowd", crowd),
    ("fence", fence),
    ("poster", poster),
    ("torch", torch),
    ("heart", heart),
):
    if not ONLY or name in ONLY.split(","):
        write(name, build())
