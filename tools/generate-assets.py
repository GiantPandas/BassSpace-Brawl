"""Bare-head low-poly multiplayer mascot 'Frank', authored in Blender. Run with
blender --background --factory-startup --python tools/generate-assets.py
Regenerates assets-source/blender/yellow_visor_mascot.blend and
public/models/yellow_visor_mascot.glb. Model faces -Y in Blender (Z-up);
glTF flips it to +Z. Body colour is never baked: 'BodyColor / tintable' and
'Jacket / tintable' carry the player palette at runtime, everything else
keeps its designed colour. The head ships bare with a clean dome; 'Socket_Hat'
rides the head bone as the runtime hat socket added by scene.ts, and no hat,
cap, brim, visor, proxy or fitting geometry is ever exported."""
import bpy, bmesh, math
from mathutils import Matrix
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def material(name,color,roughness=.55,metal=0.):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1)
    bs=m.node_tree.nodes.get('Principled BSDF')
    if bs:bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=roughness;bs.inputs['Metallic'].default_value=metal
    return m
# Player-coloured surfaces (runtime overwrites these; no fixed skin tone baked in).
body=material('BodyColor / tintable',(.85,.55,.10));cloth=material('Jacket / tintable',(.75,.52,.10))
nose=material('Nose / tintable',(.72,.52,.34))
eye_white=material('EyeWhite',(.96,.95,.90),.25);eye_pupil=material('EyePupil',(.04,.04,.05),.15)
trim=material('Trim',(.05,.06,.08),.45);shiny=material('Buckle / metal',(.42,.34,.18),.3,.8)
pants=material('Trousers',(.09,.10,.12));boots=material('Boots / ochre',(.66,.45,.18))
# The model ships bare-headed; hats are runtime cosmetics hung on Socket_Hat by
# scene.ts, never GLB geometry.
# The head is close to a perfect sphere (the reference head ball measures ~0.66 in all
# three axes on the 2.0 m figure): the first pass was 0.70 wide x 0.62 deep, which read
# as a narrow egg. Bottom sits at 1.31 inside the jacket neck, dome top z 1.97.
HEAD=(0,-.02,1.64);HEAD_SIZE=(.66,.66,.66);JAW_LINE=1.52;HINGE=(0,.20,JAW_LINE)
bpy.ops.object.armature_add();rig=bpy.context.object;rig.name='CommonRoomRig';bpy.ops.object.mode_set(mode='EDIT');rig.data.edit_bones.remove(rig.data.edit_bones[0])
bones={
 'hips':((0,0,.76),(0,0,.93),None),'spine':((0,0,.93),(0,0,1.32),'hips'),
 'head':((0,0,1.32),(0,0,JAW_LINE),'spine'),
 'jaw':(HINGE,(HINGE[0],HINGE[1],1.90),'head'),
 'armL':((.26,0,1.27),(.26,0,1.00),'spine'),'armR':((-.26,0,1.27),(-.26,0,1.00),'spine'),
 'forearmL':((.26,0,1.00),(.26,0,.76),'armL'),'forearmR':((-.26,0,1.00),(-.26,0,.76),'armR'),
 'legL':((.13,0,.76),(.13,0,.42),'hips'),'legR':((-.13,0,.76),(-.13,0,.42),'hips'),
 'shinL':((.13,0,.42),(.13,0,.11),'legL'),'shinR':((-.13,0,.42),(-.13,0,.11),'legR'),
 'footL':((.13,0,.11),(.13,-.18,.11),'shinL'),'footR':((-.13,0,.11),(-.13,-.18,.11),'shinR')}
for name,(h,t,parent) in bones.items():
  b=rig.data.edit_bones.new(name);b.head=h;b.tail=t
  if parent:b.parent=rig.data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
def finish(o,name,size,mat,bone,rot=(0,0,0)):
  o.name=name
  if size:o.dimensions=size
  bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  if any(rot):
    o.rotation_euler=rot;bpy.ops.object.transform_apply(location=False,rotation=True,scale=False)
  for f in o.data.polygons:f.use_smooth=True
  if mat:o.data.materials.append(mat)
  group=o.vertex_groups.new(name=bone);group.add(list(range(len(o.data.vertices))),1,'REPLACE')
  mod=o.modifiers.new('Rig','ARMATURE');mod.object=rig;o.parent=rig
  return o
def ball(name,p,size,mat,bone,segments=16,rings=8,rot=(0,0,0)):
  bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=.5,location=p)
  return finish(bpy.context.object,name,size,mat,bone,rot)
def column(name,p,size,mat,bone,taper=.90,verts=6,round_ends=.35,rot=(0,0,0)):
  """A tapered barrel whose rims are rounded off, so every silhouette edge reads as a curve."""
  bpy.ops.mesh.primitive_cone_add(vertices=verts,radius1=.5,radius2=.5*taper,depth=1,location=p);o=bpy.context.object
  mod=o.modifiers.new('Rounded ends','BEVEL');mod.width=.5*min(1,taper)*round_ends;mod.segments=1;mod.limit_method='ANGLE';mod.angle_limit=math.radians(30)
  bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
  return finish(o,name,size,mat,bone,rot)
def capsule(name,p,size,mat,bone,round_ends=.45,verts=6,rot=(0,0,0)):
  """A barrel with both rims rounded off: a cartoon finger, thumb, the nose bridge.
  Six sides and one bevel segment: rounded enough to read as a finger at the game
  camera, cheap enough to keep the whole model inside the browser budget."""
  bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=.5,depth=1,location=p);o=bpy.context.object
  mod=o.modifiers.new('Round ends','BEVEL');mod.width=.5*min(1,round_ends);mod.segments=1;mod.limit_method='ANGLE'
  bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
  return finish(o,name,size,mat,bone,rot)
def ring(name,p,size,mat,bone,maj=20,minor=3,rot=(0,0,0)):
  """A flattened torus band: collars, cuffs, belts and neck cowls. Three minor
  segments read as a rounded band at game scale; four was pure cost."""
  bpy.ops.mesh.primitive_torus_add(major_radius=.5,minor_radius=.06,location=p,major_segments=maj,minor_segments=minor)
  return finish(bpy.context.object,name,size,mat,bone,rot)
def plate(name,p,size,mat,bone,bevel=.012,rot=(0,0,0),seg=1):
  """A soft-edged panel: pouches, buckles, zipper tape and boot parts."""
  bpy.ops.mesh.primitive_cube_add(location=p);o=bpy.context.object
  if bevel:
    mod=o.modifiers.new('Soften','BEVEL');mod.width=bevel;mod.segments=seg;mod.limit_method='ANGLE'
    bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
  return finish(o,name,size,mat,bone,rot)
def sphere_cut(name,p,size,mat,bone,co,no,keep,segments=16,rings=9):
  """A sphere sliced by a plane; the cut face is filled. keep=True keeps the
  side the plane normal points toward (dot(p-co,no) > 0)."""
  bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=.5,location=p)
  o=bpy.context.object;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  bm=bmesh.new();bm.from_mesh(o.data)
  cut=bmesh.ops.bisect_plane(bm,geom=bm.verts[:]+bm.edges[:]+bm.faces[:],dist=1e-5,plane_co=co,plane_no=no,clear_inner=keep,clear_outer=not keep)
  for f in bm.faces:f.smooth=True
  rim=[e for e in cut['geom_cut'] if isinstance(e,bmesh.types.BMEdge)]
  for f in bmesh.ops.holes_fill(bm,edges=rim,sides=0)['faces']:f.smooth=False
  bm.to_mesh(o.data);bm.free();o.data.update()
  return finish(o,name,None,mat,bone)
def head_half(name,upper,bone):
  """One half of the skull, capped with a flat disc at the cut (body-colored,
  the jaw seam ring hides the seam line itself). Broad forehead, tapered lower
  face, rear pressed flat against the hood; the crown is a clean dome for hats."""
  bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=12,radius=.5,location=HEAD)
  o=bpy.context.object;o.dimensions=HEAD_SIZE;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  bm=bmesh.new();bm.from_mesh(o.data)
  # No taper: the head is a true sphere, so the front silhouette is round. The
  # earlier taper (x .85+.15t, y .93+.07t, back .88+.12(1-t)) narrowed it top and
  # bottom into an egg, which is exactly what a front view shows.
  cut=bmesh.ops.bisect_plane(bm,geom=bm.verts[:]+bm.edges[:]+bm.faces[:],dist=1e-5,plane_co=(0,0,JAW_LINE-HEAD[2]),plane_no=(0,0,1),clear_inner=upper,clear_outer=not upper)
  for f in bm.faces:f.smooth=True
  rim=[e for e in cut['geom_cut'] if isinstance(e,bmesh.types.BMEdge)]
  for f in bmesh.ops.holes_fill(bm,edges=rim,sides=0)['faces']:f.smooth=False
  bm.to_mesh(o.data);bm.free();o.data.update()
  o.name=name;o.data.materials.append(body)
  group=o.vertex_groups.new(name=bone);group.add(list(range(len(o.data.vertices))),1,'REPLACE')
  mod=o.modifiers.new('Rig','ARMATURE');mod.object=rig;o.parent=rig
  return o
# Jacket torso profile: hem, hip, chest, shoulder, neck taper, collar stub.
profile=[(.80,.245,.185),(.92,.268,.196),(1.05,.278,.204),(1.18,.290,.208),(1.30,.242,.172),(1.40,.170,.124)]
def prof(z):
  if z<=profile[0][0]:return profile[0][1],profile[0][2]
  for k in range(len(profile)-1):
    za,ra,rb=profile[k];zb,rc,rd=profile[k+1]
    if z<=zb:
      f=(z-za)/(zb-za);return ra+(rc-ra)*f,rb+(rd-rb)*f
  return profile[-1][1],profile[-1][2]
def front(z,x=0.):
  """The jacket's front (negative-Y) surface at height z, offset for x across the chest."""
  rx,ry=prof(z);u=max(-.99,min(.99,x/rx));return -(ry*math.sqrt(max(0.,1-u*u)))-.008
def head_front(z,x):
  """The skull's front surface at height z, offset for x across the face. The head is
  a sphere, so this is the ellipsoid's own front — anything laid here hugs the head
  instead of floating over it. The mouth band that used this was removed: any strip
  laid on a sphere reads as a line floating over it (the user's arrow 2)."""
  R=HEAD_SIZE[0]/2
  u=max(-.99,min(.99,x/R))
  dz=(z-HEAD[2])/R
  return HEAD[1]-R*math.sqrt(max(0.,1-u*u-dz*dz))
# --- Face: half-lidded googly eyes, unimpressed pupils, bulbous nose.
# The eyes sit close together and protrude from the face; the eyelid shell is a
# sphere cap cut above the eyeball centre, so the upper ~40% of each eye reads as
# a body-coloured lid (no cap shadow to lean on). The jaw seam ring is sized to the
# head at the mouth line: a slim dark band at the split, not a hoop around it.
for sign,label in [(1,'L'),(-1,'R')]:
  ball('Eyeball.'+label,(sign*.111,-.311,1.620),(.193,.156,.231),eye_white,'jaw',segments=10,rings=6)
  sphere_cut('Eyelid.'+label,(sign*.111,-.304,1.642),(.209,.174,.243),body,'jaw',(0,0,1.680),(0,0,1),True,segments=10,rings=6)
  ball('Pupil.'+label,(sign*.091,-.378,1.600),(.073,.042,.075),eye_pupil,'jaw',segments=8,rings=4)
# The nose is a tapered barrel buried in the skull: its sides sit inside the sphere
# and its front protrudes, so it grows out of the face. A root ball added behind the
# base read as a second lump under the nose (the user's arrow 1) and is gone.
column('Nose',(0,-.294,1.500),(.130,.130,.180),nose,'jaw',taper=.62,verts=8,round_ends=.5,rot=(-.14,0,0))
# Head halves ride the rig: jaw carries the cranium, eyes and nose.
head_half('Cranium',True,'jaw');head_half('Jawbowl',False,'head')
# --- Clothing: one coherent jacket, bunched hood, sleeves, cuffs.
vertices=[(rx*math.cos(i/12*2*math.pi),ry*math.sin(i/12*2*math.pi),z) for z,rx,ry in profile for i in range(12)]
faces=[]
for j in range(len(profile)-1):
  for i in range(12):faces.append((j*12+i,j*12+(i+1)%12,(j+1)*12+(i+1)%12,(j+1)*12+i))
faces+=[tuple(reversed(range(12))),tuple((len(profile)-1)*12+i for i in range(12))]
mesh=bpy.data.meshes.new('Jacket torso');mesh.from_pydata(vertices,[],faces);mesh.update()
o=bpy.data.objects.new('Jacket torso',mesh);bpy.context.collection.objects.link(o)
o.data.materials.append(cloth)
for f in o.data.polygons:f.use_smooth=True
group=o.vertex_groups.new(name='spine');group.add(list(range(len(o.data.vertices))),1,'REPLACE')
mod=o.modifiers.new('Rig','ARMATURE');mod.object=rig;o.parent=rig
# Hood: one rounded cloth bulk sunk into the jacket shoulders behind the neck, so
# it reads as folded fabric attached to the garment — no loose ball behind the head.
# It only reaches ~0.15 past the jacket's own back surface; a bulk that reached
# 0.27 read as a lump bolted to the coat. Its top stays under the crown line, so
# hats sit on the dome without hitting the hood.
ball('Hood',(0,.16,1.28),(.42,.34,.28),cloth,'spine',segments=12,rings=7)
# Collar: the dark neck opening. Sized inside the head cross-section at its height, so
# it reads as a shadowed collar around the neck and never pokes out as dark specks.
ring('Collar',(0,0,1.36),(.30,.27,.040),trim,'spine',maj=12,minor=3)
# Zipper tape: dark, thin, sunk into the jacket front so it reads as stitching,
# not a floating brass strip; the small brass pull is the only shine on it.
plate('Zipper',(0,front(1.05),1.050),(.018,.010,.260),trim,'spine',bevel=0)
ball('Zipper pull',(0,front(1.21)+.010,1.222),(.030,.020,.045),shiny,'spine',segments=6,rings=4)
# --- Arms: rounded shoulders, tapered sleeves, dark cuffs, cartoon hands.
# Sleeve and forearm columns overlap so the elbow reads as one continuous limb.
for sign,label in [(1,'L'),(-1,'R')]:
  ball('Shoulder.'+label,(sign*.255,0,1.255),(.150,.150,.150),cloth,'arm'+label,segments=8,rings=5)
  column('Sleeve.'+label,(sign*.26,0,1.128),(.140,.140,.270),cloth,'arm'+label,taper=.92,verts=6)
  column('Forearm.'+label,(sign*.26,0,.895),(.125,.125,.240),cloth,'forearm'+label,taper=.90,verts=6)
  ring('Cuff.'+label,(sign*.26,0,.785),(.150,.150,.045),trim,'forearm'+label,maj=10,minor=3)
  plate('Palm.'+label,(sign*.26,-.015,.665),(.105,.115,.110),body,'forearm'+label,bevel=.035)
  capsule('Thumb.'+label,(sign*.205,-.055,.625),(.050,.058,.095),body,'forearm'+label,round_ends=.5,rot=(0,sign*-.35,0))
  # Fingers hang below the palm, spread across its own width so the hand reads as a
  # rounded glove at the game camera: the earlier set ran past the palm's outer edge
  # and read as a blocky comb sticking out sideways.
  for fx,fy,fz in [(.235,-.035,.555),(.260,-.039,.549),(.285,-.035,.553)]:
    capsule('Finger.'+label,(sign*fx,fy,fz),(.046,.052,.120),body,'forearm'+label,round_ends=.45)
# --- Crossbody strap: a ribbon hugging the jacket from right shoulder to left hip.
def strap(name):
  p1=(-.185,1.295);p2=(.215,.835);NS=10;verts=[]
  for i in range(NS+1):
    s=i/NS;x=p1[0]+(p2[0]-p1[0])*s;z=p1[1]+(p2[1]-p1[1])*s
    rx,ry=prof(z)
    u=max(-.97,min(.97,x/rx));y=-ry*math.sqrt(1-u*u)-.011
    nx2,ny2=x/(rx*rx),y/(ry*ry);L=math.hypot(nx2,ny2);nx,ny=nx2/L,ny2/L
    dx=(p2[0]-p1[0])/NS;dz=(p2[1]-p1[1])/NS
    wx,wy,wz=-dz*ny,dz*nx,dx*ny
    LW=math.sqrt(wx*wx+wy*wy+wz*wz) or 1;wx,wy,wz=wx/LW*.033,wy/LW*.033,wz/LW*.033
    verts+=[(x+wx,y+wy+.004,z+wz),(x-wx,y-wy-.004,z-wz)]
  faces=[(2*i,2*i+1,2*(i+1)+1,2*(i+1)) for i in range(NS)]
  mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
  o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o)
  o.name=name;o.data.materials.append(trim)
  for f in o.data.polygons:f.use_smooth=True
  group=o.vertex_groups.new(name='spine');group.add(list(range(len(o.data.vertices))),1,'REPLACE')
  mod=o.modifiers.new('Rig','ARMATURE');mod.object=rig;o.parent=rig
  return o
strap('Strap')
plate('Strap slide',(0,front(1.10)+.004,1.065),(.040,.014,.030),shiny,'spine',bevel=0,rot=(-.30,0,0))
# Utility pouch on the lower strap: compact, flap and badge on its front face.
plate('Pouch',(.150,front(.90,.15)-.012,.905),(.155,.070,.195),trim,'spine',bevel=.018,seg=2)
plate('Pouch flap',(.150,front(.90,.15)-.018,.955),(.145,.050,.090),trim,'spine',bevel=.010)
plate('Pouch clasp',(.150,front(.90,.15)-.046,.905),(.040,.020,.050),shiny,'spine',bevel=0)
plate('Pouch badge',(.104,front(.90,.15)-.042,.932),(.030,.012,.030),boots,'spine',bevel=0)
# Belt and buckle: the band wraps the waist contour, buckle proud of the front.
ring('Belt',(0,.006,.840),(.450,.340,.075),trim,'hips',maj=14,minor=3)
plate('Buckle',(0,front(.840)+.010,.840),(.075,.030,.090),shiny,'hips',bevel=.010)
# Trousers: pelvis block plus two tapered legs, clear of each other for walking.
# The block stays inside the jacket tube (its bevel corners poked through the hem as
# dark prongs when it was taller), so only the trousers show below the coat.
plate('Pelvis',(0,.006,.800),(.30,.26,.16),pants,'hips',bevel=.04,seg=2)
for sign,label in [(1,'L'),(-1,'R')]:
  column('Thigh.'+label,(sign*.14,0,.590),(.145,.150,.340),pants,'leg'+label,taper=.88,verts=6)
  ball('Knee.'+label,(sign*.14,0,.420),(.155,.160,.155),pants,'shin'+label,segments=8,rings=5)
  column('Shin.'+label,(sign*.14,0,.260),(.135,.140,.300),pants,'shin'+label,taper=.88,verts=6)
# Boots: measured from the reference side view, each boot is ~0.21 of the figure's
# height in length and ~0.16 in height — much chunkier than the first pass. Thick dark
# sole, tall ochre upper, rubber toe cap wrapping the front, a dark strap band buckled
# over the instep, and an ankle collar sized to the upper's own width (not the shin's)
# so it reads as a band on the boot, not a ring floating around the leg.
for sign,label in [(1,'L'),(-1,'R')]:
  plate('Sole.'+label,(sign*.13,-.060,.030),(.245,.430,.060),trim,'foot'+label,bevel=.022,seg=2)
  plate('Upper.'+label,(sign*.13,-.055,.175),(.230,.350,.230),boots,'foot'+label,bevel=.060,seg=2)
  ball('Toe cap.'+label,(sign*.13,-.225,.090),(.215,.150,.140),trim,'foot'+label,segments=8,rings=5)
  plate('Strap.'+label,(sign*.13,-.055,.205),(.252,.372,.048),trim,'foot'+label,bevel=.012,seg=2)
  plate('Buckle.'+label,(sign*.13,-.185,.205),(.042,.048,.072),shiny,'foot'+label,bevel=.008)
  ring('Boot collar.'+label,(sign*.13,-.030,.290),(.215,.335,.050),trim,'foot'+label,maj=10,minor=3)
  plate('Heel.'+label,(sign*.13,.125,.075),(.205,.100,.070),trim,'foot'+label,bevel=.012,seg=2)
# Neck, mostly hidden inside the collar: head reads as connected, not floating.
column('Neck',(0,-.01,1.360),(.140,.140,.200),body,'head',taper=.92,verts=6,round_ends=.25)
# Hat socket: an empty on the crown, parented to the head bone so any future
# hat rides the head. The socket origin sits on the skull dome; hat bases are
# authored 0.05-0.10 units below it to overlap the head. The head is a ~0.66
# sphere, dome top z 1.97, hat line z ~1.80.
sock=bpy.data.objects.new('Socket_Hat',None);bpy.context.collection.objects.link(sock)
sock.location=(0,-.02,1.965);bpy.context.view_layer.update()
pb=rig.pose.bones['head']
tail=rig.matrix_world@pb.matrix@Matrix.Translation((0,pb.length,0))
sock.parent=rig;sock.parent_type='BONE';sock.parent_bone='head'
sock.matrix_parent_inverse=tail.inverted()
bpy.context.view_layer.update()
# Explicit actions exported as glTF clips. Head and jaw stay unkeyed so the
# runtime can aim them from look-pitch and voice loudness. Locomotion reuses
# the proven contact/down/passing/up poses tuned to these bone heights.
DRIVEN={'head','jaw'}
rig.animation_data_create()
for name in ['Idle','Walk','Sprint','Crouch','Jump','Hold']:
  action=bpy.data.actions.new(name);rig.animation_data.action=action
  for frame in [1,4,7,10,13,16,19,22,25]:
    phase=(frame-1)/24*2*math.pi
    for bone in rig.pose.bones:
      bone.rotation_mode='XYZ';bone.rotation_euler=(0,0,0);bone.location=(0,0,0)
    if name in ['Walk','Sprint','Crouch']:
      amount=.72 if name=='Sprint' else .46 if name=='Walk' else .16
      bounce=.035 if name=='Sprint' else .022 if name=='Walk' else .012
      rig.pose.bones['hips'].location.y=-math.cos(phase*2)*bounce
      rig.pose.bones['hips'].location.x=math.cos(phase)*(.018 if name=='Sprint' else .012)
      rig.pose.bones['hips'].rotation_euler.z=-math.sin(phase)*(.055 if name=='Sprint' else .035)
      rig.pose.bones['spine'].rotation_euler.y=math.cos(phase)*(.035 if name=='Sprint' else .022)
      rig.pose.bones['spine'].rotation_euler.z=math.sin(phase)*(.075 if name=='Sprint' else .045)
      for label,sign in [('L',1),('R',-1)]:
        swing=math.cos(phase)*amount*sign
        lift=max(0,-math.sin(phase)*sign)
        push=max(0,math.sin(phase)*sign)
        rig.pose.bones['leg'+label].rotation_euler.x=swing
        rig.pose.bones['shin'+label].rotation_euler.x=lift*amount*.9+.06
        rig.pose.bones['foot'+label].rotation_euler.x=-swing*.32-lift*amount*.28+push*amount*.18
        rig.pose.bones['arm'+label].rotation_euler.x=-swing*.72
        rig.pose.bones['arm'+label].rotation_euler.z=-sign*.045
        rig.pose.bones['forearm'+label].rotation_euler.x=-.16-lift*.20
      if name=='Crouch':
        rig.pose.bones['hips'].location.y=-.327-math.cos(phase*2)*bounce
        rig.pose.bones['spine'].rotation_euler.x=-.12
        for label,sign in [('L',1),('R',-1)]:
          swing=math.cos(phase)*amount*sign
          rig.pose.bones['leg'+label].rotation_euler.x=-1.04+swing
          rig.pose.bones['shin'+label].rotation_euler.x=2.08-swing*.5
          rig.pose.bones['foot'+label].rotation_euler.x=1.04+swing*.5
          rig.pose.bones['arm'+label].rotation_euler.x=-.25-swing*.5
          rig.pose.bones['forearm'+label].rotation_euler.x=-.4
    if name=='Idle':rig.pose.bones['spine'].rotation_euler.y=math.sin(phase)*.015
    if name=='Jump':
      rig.pose.bones['legL'].rotation_euler.x=.3;rig.pose.bones['legR'].rotation_euler.x=-.2
    if name=='Hold':
      rig.pose.bones['armL'].rotation_euler.x=-1.1;rig.pose.bones['armR'].rotation_euler.x=-1.1
    for bone in rig.pose.bones:
      if bone.name not in DRIVEN:
        bone.keyframe_insert('rotation_euler',frame=frame);bone.keyframe_insert('location',frame=frame)
  action.use_fake_user=True
rig.animation_data.action=None
for bone in rig.pose.bones:bone.rotation_euler=(0,0,0);bone.location=(0,0,0)
bpy.context.scene.frame_start=1;bpy.context.scene.frame_end=25
# Merge rigidly weighted pieces to reduce draw calls; preserve the armature,
# the socket, and the material groups.
bpy.ops.object.select_all(action='DESELECT')
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in meshes:o.select_set(True)
bpy.context.view_layer.objects.active=meshes[0]
bpy.ops.object.join()
bpy.context.object.name='FrankMesh'
tris=sum(len(p.vertices)-2 for p in bpy.context.object.data.polygons)
bpy.ops.object.select_all(action='SELECT')
# Blender persists the last directory from every file-browser area in the .blend.
# Clear it so the committed source never contains the generating user's home path.
for screen in bpy.data.screens:
  for area in screen.areas:
    for space in area.spaces:
      if space.type=='FILE_BROWSER':space.params.directory=b'/tmp/friendslop-base/generated-assets'
(ROOT/'assets-source/blender').mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets-source/blender/yellow_visor_mascot.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/yellow_visor_mascot.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS')
print(f'Generated bare-head mascot Frank: {tris} triangles, six animation clips, BodyColor/Jacket tint split, Socket_Hat on the head bone.')
