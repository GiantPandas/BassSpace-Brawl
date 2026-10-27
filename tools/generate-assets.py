#!/usr/bin/env python3
"""Generate the BassSpace Brawl starter character from reference/Simplefrank.png.

Three clay views (front, back, three-quarter) of a low-poly mascot were measured
off the reference at its 1056x992 scale and converted to metres (the full figure
spans 0.22..1.97 m, so ~264 px per metre). The read values that drive the build:

  crown            1.97   chin (into the collar) 1.29   head 0.66 wide, 0.68 tall
  eyes             z 1.54, x +-0.19, 0.09 x 0.08, 0.05 proud of the face
  brow band        z 1.65, 0.22 wide        nose 0.12 wide, z 1.50
  jacket           0.56 wide at the shoulders, 0.50 at the waist, 0.46 deep
  collar roll      0.62 wide, 0.58 deep, z 1.10..1.30
  arms             x +-0.40, sleeve r 0.12, cuffs at z 0.87, fists at z 0.80
  belt             z 0.96 with a square buckle on the front
  legs             slim: 0.21 wide at the thigh, 0.20 at the shin
  boots            0.575 long x 0.41 high (reference/shoe.png, front on the left)
  figure front     -0.44   back +0.30

The base character wears no hat; `Socket_Hat`, an empty parented to the head
bone, is exported so runtime cosmetics ride the head. There is no mouth
geometry: a strip laid on a sphere reads as a line floating over the face, so
the jaw hinge is purely runtime. The neck, hands, brow, pouch and boot panels use
`BodyColor / tintable` like the head, so they take the player's colour. The
jacket, sleeves and collar use `Jacket / tintable`. Dark parts are `Trim`, brass
buckles `Buckle`. The jacket torso is an elliptical loft; the head is a sphere
bisected at the mouth line so the runtime jaw bone lifts the upper half like a
lid. Rig: hips -> spine -> head -> jaw, spine -> armL/armR -> forearmL/forearmR,
hips -> legL/legR -> shinL/shinR -> footL/footR. Rigid weights, one bone per
vertex: a smooth bind bends the jacket at the hips and pulls cloth off the arms.
"""
import math
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)

body = bpy.data.materials.new('BodyColor / tintable')
cloth = bpy.data.materials.new('Jacket / tintable')
trim = bpy.data.materials.new('Trim / dark')
shiny = bpy.data.materials.new('Buckle / brass')
nose = bpy.data.materials.new('Nose / tintable')
eye_white = bpy.data.materials.new('EyeWhite / tintable')
eye_dark = bpy.data.materials.new('EyePupil / tintable')
for m in [body, cloth, trim, shiny, nose, eye_white, eye_dark]:
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .72
    m.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = .12
body.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.88, .76, .38, 1)
cloth.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.90, .86, .78, 1)
shiny.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .35
shiny.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.78, .62, .15, 1)
trim.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.11, .13, .16, 1)
nose.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.70, .62, .44, 1)
eye_white.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.96, .96, .96, 1)
eye_dark.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.05, .05, .07, 1)

# --- Skeleton first, so pieces can be bound while authored.
rig = bpy.data.armatures.new('FrankRig')
rig_obj = bpy.data.objects.new('FrankRig', rig)
bpy.context.collection.objects.link(rig_obj)
bpy.context.view_layer.objects.active = rig_obj
bpy.ops.object.mode_set(mode='EDIT')
edit = rig.edit_bones


def bone(name, head, tail, parent=None):
    b = edit.new(name)
    b.head = head
    b.tail = tail
    b.use_connect = bool(parent)
    if parent:
        b.parent = edit[parent]
    return b


bone('hips', (0, 0, .76), (0, .02, .92))
spine = bone('spine', (0, 0, .92), (0, .01, 1.28), 'hips')
spine.roll = .25
head = bone('head', (0, .01, 1.28), (0, -.02, 1.60), 'spine')
bone('jaw', (0, -.02, 1.60), (0, -.10, 1.75), 'head')
for sign, label in [(1, 'L'), (-1, 'R')]:
    bone('arm' + label, (sign * .40, 0, 1.22), (sign * .40, 0, .98), 'spine')
    bone('forearm' + label, (sign * .40, 0, .98), (sign * .40, 0, .76), 'arm' + label)
    bone('leg' + label, (sign * .11, 0, .76), (sign * .11, 0, .40), 'hips')
    bone('shin' + label, (sign * .11, 0, .40), (sign * .11, 0, .12), 'leg' + label)
    bone('foot' + label, (sign * .11, 0, .12), (sign * .11, -.18, .10), 'shin' + label)
bpy.ops.object.mode_set(mode='OBJECT')


def finish(o, name, size, mat, bone_name=None, rot=None):
    o.name = name
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if rot:
        o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bpy.ops.object.shade_smooth()
    o.data.materials.append(mat)
    if bone_name:
        group = o.vertex_groups.new(name=bone_name)
        group.add(list(range(len(o.data.vertices))), 1, 'REPLACE')
        mod = o.modifiers.new('Rig', 'ARMATURE')
        mod.object = rig_obj
        # Cloth follows the nearest chain, not a strict parent: jacket vertices
        # near the waist go to hips, sleeves follow arms, legs bind to legs.
        if bone_name == 'hips':
            for v in o.data.vertices:
                if v.co.z > .95:
                    group.add([v.index], 0, 'REPLACE')
        elif bone_name == 'spine':
            for v in o.data.vertices:
                if v.co.z < .86:
                    group.add([v.index], .35, 'REPLACE')
                elif v.co.z > 1.30:
                    group.add([v.index], .2, 'REPLACE')
        elif bone_name.startswith('leg') or bone_name.startswith('shin'):
            for v in o.data.vertices:
                if v.co.z > .80:
                    group.add([v.index], .45, 'REPLACE')
        # A rigid bind follows the hips in world space, so geometry parented to
        # a limb bone drifts when that bone moves. Parenting the piece to the
        # armature lets it follow the bone in the rest pose; the modifier then
        # deforms it exactly with the animation.
        o.parent = rig_obj
    return o


def ball(name, p, size, mat, bone_name, segments=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=.5, location=p)
    return finish(bpy.context.object, name, size, mat, bone_name)


def column(name, p, size, mat, bone_name, taper=1, verts=8, round_ends=0, rot=None):
    """A vertical capsule or tapered cylinder: limbs, torso sections, ears."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=.5, depth=1, location=p)
    o = bpy.context.object
    if taper != 1:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        for v in bm.verts:
            if v.co.z > 0:
                v.co.x *= taper
                v.co.y *= taper
        bm.to_mesh(o.data)
        bm.free()
    if round_ends > 0:
        mod = o.modifiers.new('Round ends', 'BEVEL')
        mod.width = .5 * min(1, round_ends)
        mod.segments = 1
        mod.limit_method = 'ANGLE'
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o, name, size, mat, bone_name, rot)


def capsule(name, p, size, mat, bone_name, round_ends=.45, rot=None):
    return column(name, p, size, mat, bone_name, verts=6, round_ends=round_ends, rot=rot)


def ring(name, p, size, mat, bone_name, maj=20, minor=3, rot=(0, 0, 0)):
    """A flattened torus band: the rolled collar, cuffs, belts and hem ridges."""
    bpy.ops.mesh.primitive_torus_add(major_radius=.5, minor_radius=.12, location=p, major_segments=maj, minor_segments=minor)
    return finish(bpy.context.object, name, size, mat, bone_name, rot)


def plate(name, p, size, mat, bone_name, bevel=.012, rot=(0, 0, 0), seg=1):
    """A soft-edged panel: pouches, buckles, straps and boot parts."""
    bpy.ops.mesh.primitive_cube_add(location=p)
    o = bpy.context.object
    if bevel:
        mod = o.modifiers.new('Soften', 'BEVEL')
        mod.width = bevel
        mod.segments = seg
        mod.limit_method = 'ANGLE'
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o, name, size, mat, bone_name, rot)


def mesh_object(name, verts, faces, mat, bone_name, smooth=True):
    """A hand-authored mesh bound to a bone: the jacket loft, boot, ribbons."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    o.name = name
    o.data.materials.append(mat)
    if smooth:
        for f in o.data.polygons:
            f.use_smooth = True
    group = o.vertex_groups.new(name=bone_name)
    group.add(list(range(len(o.data.vertices))), 1, 'REPLACE')
    mod = o.modifiers.new('Rig', 'ARMATURE')
    mod.object = rig_obj
    o.parent = rig_obj
    return o


HEAD = (0, -.02, 1.63)
HEAD_SIZE = (.66, .64, .68)  # measured front view: 0.66 wide, crown 1.97, chin 1.29
JAW_LINE = 1.46
profile = [(.72, .275, .215), (.86, .265, .208), (1.00, .252, .200),
           (1.14, .238, .188), (1.26, .215, .172), (1.34, .172, .140)]


def prof(z):
    if z <= profile[0][0]:
        return profile[0][1], profile[0][2]
    for k in range(len(profile) - 1):
        za, ra, rb = profile[k]
        zb, rc, rd = profile[k + 1]
        if z <= zb:
            f = (z - za) / (zb - za)
            return ra + (rc - ra) * f, rb + (rd - rb) * f
    return profile[-1][1], profile[-1][2]


def front(z, x=0.):
    """The jacket's front (negative-Y) surface at height z, offset for x across
    the chest. Straps and pouches are laid here so they hug the coat."""
    rx, ry = prof(z)
    u = max(-.99, min(.99, x / rx))
    return -(ry * math.sqrt(max(0., 1 - u * u))) - .008


def head_front(z, x=0.):
    """The skull's front surface at height z. Features laid here hug the head
    instead of floating over it."""
    R = HEAD_SIZE[0] / 2
    u = max(-.99, min(.99, x / R))
    dz = (z - HEAD[2]) / (HEAD_SIZE[2] / 2)
    return HEAD[1] - (HEAD_SIZE[1] / 2) * math.sqrt(max(0., 1 - u * u - dz * dz))


def head_half(name, upper, bone_name):
    """One half of the skull, capped flat at the cut (body-coloured; the jaw seam
    hides the cut line). A true sphere: the reference's front view is a circle,
    and a taper toward the chin reads as an egg in exactly that view."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12, radius=.5, location=HEAD)
    o = bpy.context.object
    o.dimensions = HEAD_SIZE
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    cut = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5,
                                 plane_co=(0, 0, JAW_LINE - HEAD[2]), plane_no=(0, 0, 1),
                                 clear_inner=upper, clear_outer=not upper)
    for f in bm.faces:
        f.smooth = True
    rim = [e for e in cut['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
    for f in bmesh.ops.holes_fill(bm, edges=rim, sides=0)['faces']:
        f.smooth = False
    bm.to_mesh(o.data)
    bm.free()
    return finish(o, name, HEAD_SIZE, body, bone_name)


def ribbon(name, p1, p2, w, mat, bone_name):
    """A strap painted along the jacket's front surface between two (x,z) points.
    Plating a rotated box floats off the elliptical chest; walking the surface
    keeps the ribbon flush, and the two straps cross in an X like the reference."""
    NS = 8
    verts = []
    for i in range(NS + 1):
        s = i / NS
        x = p1[0] + (p2[0] - p1[0]) * s
        z = p1[1] + (p2[1] - p1[1]) * s
        y = front(z, x) - .014
        verts += [(x - w / 2, y, z), (x + w / 2, y, z)]
    faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(NS)]
    return mesh_object(name, verts, faces, mat, bone_name, smooth=False)


# --- Face: two dark eyes with a white sclera behind them, a brow band and a
# round nose, all seated ON the sphere. Measured from Simplefrank's front view:
# eyes z 1.72 at x +-0.13, brow z 1.82, nose z 1.56. The face sits in the upper
# half of the head, just clear of the collar roll.
for sign in [1, -1]:
    ball('Eye white.' + ('L' if sign > 0 else 'R'), (sign * .13, head_front(1.72, sign * .13) - .012, 1.72),
         (.115, .060, .095), eye_white, 'jaw', segments=10, rings=6)
    ball('Pupil.' + ('L' if sign > 0 else 'R'), (sign * .13, head_front(1.72, sign * .13) - .062, 1.72),
         (.075, .050, .075), eye_dark, 'jaw', segments=8, rings=5)
plate('Brow', (0, head_front(1.82) - .012, 1.82), (.24, .050, .040), body, 'jaw', bevel=.012)
ball('Nose', (0, -.300, 1.56), (.19, .19, .20), nose, 'jaw', segments=10, rings=7)
head_half('Cranium', True, 'jaw')
head_half('Jawbowl', False, 'head')
for sign in [1, -1]:
    ball('Ear.' + ('L' if sign > 0 else 'R'), (sign * .31, -.02, 1.66), (.075, .085, .115), body, 'jaw', segments=8, rings=5)
# Neck, mostly hidden inside the collar roll so the head reads as set into it.
column('Neck', (0, -.01, 1.36), (.150, .150, .240), body, 'head', taper=.92, verts=6, round_ends=.25)

# --- Jacket torso: an elliptical loft, one closed smooth mesh. Smooth normals
# give the jacket a continuous surface; the flat caps are the hem and neck.
vertices = [(rx * math.cos(i / 12 * 2 * math.pi), ry * math.sin(i / 12 * 2 * math.pi), z)
            for z, rx, ry in profile for i in range(12)]
faces = []
for j in range(len(profile) - 1):
    for i in range(12):
        faces.append((j * 12 + i, j * 12 + (i + 1) % 12, (j + 1) * 12 + (i + 1) % 12, (j + 1) * 12 + i))
faces += [tuple(reversed(range(12))), tuple((len(profile) - 1) * 12 + i for i in range(12))]
mesh_object('Jacket torso', vertices, faces, cloth, 'spine')
# Collar roll: the reference's most distinct garment — a thick rolled tube around
# the neck just under the nose (0.72 x 0.68, z 1.25..1.45), jacket cloth so
# it tints with the player. A brass square clasp rides its front.
ring('Collar roll', (0, .010, 1.350), (.720, .680, .200), cloth, 'spine', maj=24, minor=6)
plate('Collar clasp', (0, -.325, 1.350), (.085, .055, .085), shiny, 'spine', bevel=.010)
# Bunched hood behind the collar: one bulk sunk into the jacket's shoulders so it
# reads as folded cloth attached to the garment. Its top stays under the crown
# line, so hats sit on the dome without hitting the hood.
ball('Hood', (0, .18, 1.10), (.40, .24, .20), cloth, 'spine', segments=12, rings=7)
plate('Hood drape', (0, .21, .98), (.44, .12, .28), cloth, 'spine', bevel=.03, seg=2)
# Belt: the band wraps the waist contour proud of the jacket, buckle at the front.
plate('Belt', (0, .006, .955), (.545, .465, .085), trim, 'hips', bevel=.018, seg=2)
plate('Buckle', (0, -.255, .955), (.110, .040, .110), shiny, 'hips', bevel=.010)
# One wide crossbody band from the shoulder to the opposite hip plus a short
# companion strap, and the square pouch with a dark flap on the chest, as in the
# reference. The front view puts the pouch on the viewer's right: world +x.
ribbon('Strap', (-.235, 1.230), (.185, .900), .125, trim, 'spine')
ribbon('Strap short', (.250, 1.200), (.075, 1.010), .070, trim, 'spine')
plate('Chest pocket', (.200, front(1.105, .200) - .030, 1.105), (.130, .060, .115), body, 'spine', bevel=.020, seg=2)
plate('Pocket flap', (.200, front(1.160, .200) - .034, 1.160), (.125, .045, .030), trim, 'spine', bevel=.010)
plate('Pocket stamp', (.200, front(1.105, .200) - .062, 1.075), (.038, .018, .038), trim, 'spine', bevel=.004)
plate('Hem band', (0, .006, .755), (.560, .475, .070), trim, 'hips', bevel=.016, seg=2)
# --- Arms: the reference hangs them just outside the coat, ending at the belt.
for sign, label in [(1, 'L'), (-1, 'R')]:
    ball('Shoulder.' + label, (sign * .300, 0, 1.200), (.120, .120, .120), cloth, 'arm' + label, segments=8, rings=5)
    column('Sleeve.' + label, (sign * .330, 0, 1.060), (.115, .115, .270), cloth, 'arm' + label, taper=.94, verts=6)
    column('Forearm.' + label, (sign * .355, 0, .910), (.100, .100, .230), cloth, 'forearm' + label, taper=.92, verts=6)
    ring('Cuff.' + label, (sign * .355, 0, .850), (.128, .128, .045), trim, 'forearm' + label, maj=12, minor=4)
    plate('Palm.' + label, (sign * .355, -.015, .790), (.100, .110, .110), body, 'forearm' + label, bevel=.035)
    capsule('Thumb.' + label, (sign * .315, -.055, .755), (.048, .056, .090), body, 'forearm' + label, rot=(0, sign * -.35, 0))
    # One rounded knuckle mass under the palm front: three finger capsules read as
    # a comb of lumps at game scale, so the glove is a single blob plus the thumb.
    ball('Knuckles.' + label, (sign * .355, -.046, .738), (.095, .090, .076), body, 'forearm' + label, segments=10, rings=6)

# --- Legs: the reference's limbs are chunky tubes with a clear gap between them.
for sign, label in [(1, 'L'), (-1, 'R')]:
    column('Thigh.' + label, (sign * .145, 0, .570), (.105, .110, .340), cloth, 'leg' + label, taper=.90, verts=7)
    ball('Knee.' + label, (sign * .145, 0, .400), (.112, .116, .105), cloth, 'shin' + label, segments=8, rings=5)
    column('Shin.' + label, (sign * .145, 0, .255), (.090, .095, .300), cloth, 'shin' + label, taper=.90, verts=7)
# Boots, measured from the isolated reference shoe (reference/shoe.png, front on
# the left): 0.575 m long, 0.41 m high. The bright panels ride BodyColor /
# tintable so the boot takes the player's colour like the head and jacket; sole,
# toe cap, band, cuff and heel stay dark. BOOT is the side silhouette as
# (y,z,rx): the loft below IS that outline, so the side view reads as the shoe.
BOOT = [(-.30, .105, .105), (-.35, .160, .102), (-.26, .235, .098), (-.16, .30, .090),
        (-.10, .37, .110), (-.05, .415, .110), (.07, .415, .110), (.12, .37, .106),
        (.13, .26, .094), (.16, .15, .104), (.16, .105, .105)]
for sign, label in [(1, 'L'), (-1, 'R')]:
    plate('Sole.' + label, (sign * .155, -.1125, .045), (.215, .560, .090), trim, 'foot' + label, bevel=.025, seg=2)
    ball('Toe cap.' + label, (sign * .155, -.300, .115), (.185, .145, .115), trim, 'foot' + label, segments=8, rings=5)
    plate('Heel.' + label, (sign * .155, .120, .085), (.185, .085, .095), trim, 'foot' + label, bevel=.012, seg=2)
    # The profile is walked clockwise in the YZ plane and faces wind
    # (L_i,R_i,R_{i+1},L_{i+1}) so normals face outward; both ends are capped with
    # the profile polygon, or the side view looks down an open barrel.
    verts = []
    for y, z, rx in BOOT:
        verts += [(sign * .155 - rx, y, z), (sign * .155 + rx, y, z)]
    n = len(BOOT)
    faces = [(2 * i, 2 * i + 1, 2 * ((i + 1) % n) + 1, 2 * ((i + 1) % n)) for i in range(n)]
    faces.append(tuple(2 * i for i in range(n)))
    faces.append(tuple(2 * i + 1 for i in reversed(range(n))))
    mesh_object('Boot.' + label, verts, faces, body, 'foot' + label)
    # Dark strap + brass buckle across the instep only, and a dark cuff on the
    # shaft's top edge (the profile top runs y -0.05..0.07 at z 0.415).
    plate('Band.' + label, (sign * .155, -.162, .265), (.205, .120, .042), trim, 'foot' + label, bevel=.012, seg=2)
    plate('Buckle.' + label, (sign * .155, -.245, .265), (.062, .022, .062), shiny, 'foot' + label, bevel=.008)
    ring('Boot cuff.' + label, (sign * .155, .01, .412), (.235, .125, .075), trim, 'foot' + label, maj=14, minor=5)

# Hat socket: an empty on the crown, parented to the head bone so runtime hats
# ride the head. Hat bases are authored 0.05-0.10 below the socket origin.
sock = bpy.data.objects.new('Socket_Hat', None)
bpy.context.collection.objects.link(sock)
sock.location = (0, -.02, 1.965)
bpy.context.view_layer.update()
pb = rig_obj.pose.bones['head']
tail = rig_obj.matrix_world @ pb.matrix @ Matrix.Translation((0, pb.length, 0))
sock.parent = rig_obj
sock.parent_type = 'BONE'
sock.parent_bone = 'head'
sock.matrix_parent_inverse = tail.inverted()
bpy.context.view_layer.update()

# --- Actions exported as glTF clips. Head and jaw stay unkeyed so the runtime
# aims them from look-pitch and voice loudness.
DRIVEN = {'head', 'jaw'}
rig_obj.animation_data_create()
for name in ['Idle', 'Walk', 'Sprint', 'Crouch', 'Jump', 'Hold']:
    action = bpy.data.actions.new(name)
    rig_obj.animation_data.action = action
    for frame in [1, 4, 7, 10, 13, 16, 19, 22, 25]:
        phase = (frame - 1) / 24 * 2 * math.pi
        for b in rig_obj.pose.bones:
            b.rotation_mode = 'XYZ'
            b.rotation_euler = (0, 0, 0)
            b.location = (0, 0, 0)
        if name in ['Walk', 'Sprint', 'Crouch']:
            amount = .72 if name == 'Sprint' else .46 if name == 'Walk' else .16
            bounce = .035 if name == 'Sprint' else .022 if name == 'Walk' else .012
            rig_obj.pose.bones['hips'].location.y = -math.cos(phase * 2) * bounce
            rig_obj.pose.bones['hips'].rotation_euler.z = -math.sin(phase) * (.055 if name == 'Sprint' else .035)
            rig_obj.pose.bones['spine'].rotation_euler.y = math.cos(phase) * (.035 if name == 'Sprint' else .022)
            rig_obj.pose.bones['spine'].rotation_euler.z = math.sin(phase) * (.075 if name == 'Sprint' else .045)
            for label, sign in [('L', 1), ('R', -1)]:
                swing = math.cos(phase) * amount * sign
                lift = max(0, -math.sin(phase) * sign)
                push = max(0, math.sin(phase) * sign)
                rig_obj.pose.bones['leg' + label].rotation_euler.x = swing
                rig_obj.pose.bones['shin' + label].rotation_euler.x = lift * amount * .9 + .06
                rig_obj.pose.bones['foot' + label].rotation_euler.x = -swing * .32 - lift * amount * .28 + push * amount * .18
                rig_obj.pose.bones['arm' + label].rotation_euler.x = -swing * .72
                rig_obj.pose.bones['arm' + label].rotation_euler.z = -sign * .045
                rig_obj.pose.bones['forearm' + label].rotation_euler.x = -.16 - lift * .20
            if name == 'Crouch':
                rig_obj.pose.bones['hips'].location.y = -.327 - math.cos(phase * 2) * bounce
                rig_obj.pose.bones['spine'].rotation_euler.x = -.12
                for label, sign in [('L', 1), ('R', -1)]:
                    swing = math.cos(phase) * amount * sign
                    rig_obj.pose.bones['leg' + label].rotation_euler.x = -1.04 + swing
                    rig_obj.pose.bones['shin' + label].rotation_euler.x = 2.08 - swing * .5
                    rig_obj.pose.bones['foot' + label].rotation_euler.x = 1.04 + swing * .5
                    rig_obj.pose.bones['arm' + label].rotation_euler.x = -.25 - swing * .5
                    rig_obj.pose.bones['forearm' + label].rotation_euler.x = -.4
        if name == 'Idle':
            rig_obj.pose.bones['spine'].rotation_euler.y = math.sin(phase) * .015
        if name == 'Jump':
            rig_obj.pose.bones['legL'].rotation_euler.x = .3
            rig_obj.pose.bones['legR'].rotation_euler.x = -.2
        if name == 'Hold':
            rig_obj.pose.bones['armL'].rotation_euler.x = -1.1
            rig_obj.pose.bones['armR'].rotation_euler.x = -1.1
        for b in rig_obj.pose.bones:
            if b.name not in DRIVEN:
                b.keyframe_insert('rotation_euler', frame=frame)
                b.keyframe_insert('location', frame=frame)
    action.use_fake_user = True
rig_obj.animation_data.action = None
for b in rig_obj.pose.bones:
    b.rotation_euler = (0, 0, 0)
    b.location = (0, 0, 0)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 25

# Merge rigidly weighted pieces to reduce draw calls; keep the armature, the
# socket and the material groups.
bpy.ops.object.select_all(action='DESELECT')
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for m in meshes:
    m.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
bpy.context.object.name = 'FrankMesh'
tris = sum(len(p.vertices) - 2 for p in bpy.context.object.data.polygons)
bpy.ops.object.select_all(action='SELECT')
# Blender persists the last directory from every file-browser area in the .blend;
# clear it so the committed source never carries the generating user's home path.
for screen in bpy.data.screens:
    for area in screen.areas:
        for space in area.spaces:
            if space.type == 'FILE_BROWSER':
                space.params.directory = b'/tmp/friendslop-base/generated-assets'
(ROOT / 'assets-source/blender').mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets-source/blender/yellow_visor_mascot.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/models/yellow_visor_mascot.glb'), export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='ACTIONS')
print(f'Generated Simplefrank mascot: {tris} triangles, six animation clips, BodyColor/Jacket tint split, Socket_Hat on the head bone.')
