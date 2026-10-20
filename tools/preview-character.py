"""Render orthographic preview passes of the committed mascot .blend.
Pass 1 (default): frames 1..10 -> artifacts/character-previews/prev-0001.png etc.
Pass 2 (env WIRE=1): renders the wireframe-style frame into 11-wireframe.png.
Run with:
  blender --background --factory-startup assets-source/blender/yellow_visor_mascot.blend --python tools/preview-character.py
  WIRE=1 blender ... same ...
"""
import bpy,os,math
from mathutils import Vector
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'artifacts/character-previews'
BASE.mkdir(parents=True,exist_ok=True)
import re
vers=[int(d.name[1:]) for d in BASE.iterdir() if d.is_dir() and re.fullmatch(r'v\d+',d.name)]
loose=[p for p in BASE.glob('*.png')]
if loose:
  v1=BASE/'v1';v1.mkdir(exist_ok=True)
  for p in loose:os.rename(p,v1/p.name)
  vers.append(1)
ver=int(os.environ['VER']) if os.environ.get('VER') else (max(vers) if vers else 0)+1
OUT=BASE/f'v{ver}'
print('PREVIEW_VERSION',ver)
OUT.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene
try:scene.render.engine='BLENDER_EEVEE'
except Exception:pass
try:scene.update_render_engine()
except Exception:pass
scene.render.resolution_x=760
scene.render.resolution_y=760
scene.render.film_transparent=False
scene.render.image_settings.file_format='PNG'
if scene.world is None:
  w=bpy.data.worlds.new('Studio')
  try:scene.world=w
  except Exception:bpy.context.world=w
else:w=scene.world
try:w.background_color=(.42,.42,.44,1)
except Exception:
  bg=[x for x in w.node_tree.nodes if 'Background' in x.name]
  if bg:bg[0].inputs['Color'].default_value=(.42,.42,.44,1)
def area(name,loc,energy,size):
  lamp=bpy.data.lights.new(name,'AREA');lamp.energy=energy;lamp.size=size
  o=bpy.data.objects.new(name,lamp);bpy.context.collection.objects.link(o)
  o.location=loc
  o.rotation_euler=(Vector(loc).to_track_quat('-Z','Y').to_euler())
  return o
area('Key',(2.4,-3.4,4.2),2600,5.);area('Fill',(-3.6,-2.4,1.7),1100,6.);area('Rim',(-1.6,3.8,3.2),1600,4.)
# Views: (name, camera loc, target, ortho lens)
T=(0,0,1.04)
views=[('01-front',(0,-6,1.04),T,2.3),('02-back',(0,6,1.04),T,2.3),
('03-left',(-6,0,1.04),T,2.3),('04-right',(6,0,1.04),T,2.3),
('05-three-quarter',(-4.3,-4.3,2.3),(0,0,1.05),2.3),('06-head-top',(0,0,6),(0,-.02,1.97),.9),
('07-face-closeup',(0,-3,1.58),(0,-.20,1.55),.68),('08-hood-closeup',(1.9,1.9,1.55),(0,.14,1.36),1.0),
('09-strap-pouch',(-1.6,-2.6,1.00),(.08,0,.95),.8),('10-boots',(-1.3,-2.2,.28),(0,0,.14),.65),
('11-wireframe',(-4.3,-4.3,2.3),(0,0,1.05),2.3)]
wire=os.environ.get('WIRE')=='1'
cam=bpy.data.cameras.new('Cam');cam.type='ORTHO'
ce=bpy.data.objects.new('Cam',cam);bpy.context.collection.objects.link(ce)
scene.camera=ce
n=0
for i,(nm,loc,tgt,wd) in enumerate(views):
  if wire and not nm.startswith('11'):continue
  if (not wire) and nm.startswith('11'):continue
  n+=1
  f=11 if wire else n
  ce.location=loc
  ce.rotation_euler=(Vector(loc)-Vector(tgt)).to_track_quat('Z','Y').to_euler()
  cam.ortho_scale=wd
  ce.keyframe_insert('location',frame=f)
  ce.keyframe_insert('rotation_euler',frame=f)
  ce.data.keyframe_insert('ortho_scale',frame=f)
if wire:
  # Dark edges over flat grey body: wireframe factor mixes black emission over Principled.
  wm=bpy.data.materials.new('Wire')
  nodes=wm.node_tree.nodes
  wf=nodes.new('ShaderNodeWireframe');emi=nodes.new('ShaderNodeEmission')
  emi.inputs['Color'].default_value=(0.02,0.02,0.03,1);emi.inputs['Strength'].default_value=1.
  pri=nodes.new('ShaderNodeBsdfPrincipled');pri.inputs['Base Color'].default_value=(.55,.56,.58,1)
  mix=nodes.new('ShaderNodeMixShader')
  out=[x for x in nodes if x.type=='OUTPUT_MATERIAL'][0]
  wm.node_tree.links.new(pri.outputs[0],mix.inputs[1]);wm.node_tree.links.new(emi.outputs[0],mix.inputs[2])
  wm.node_tree.links.new(wf.outputs['Factor'],mix.inputs[0])
  wm.node_tree.links.new(mix.outputs[0],out.inputs['Surface'])
  for obj in scene.objects:
    if obj.type=='MESH':
      obj.data.materials.clear();obj.data.materials.append(wm)
try:scene.update_render_engine()
except Exception:pass
scene.render.filepath=str(OUT/'prev-')
if wire:
  scene.frame_start=11;scene.frame_end=11
  bpy.ops.render.render(animation=True)
  src=OUT/'prev-0011.png'
  print('OUTFILES',[p.name for p in OUT.iterdir()])
  if src.exists():os.replace(src,OUT/'11-wireframe.png')
else:
  scene.frame_start=1;scene.frame_end=10
  bpy.ops.render.render(animation=True)
names=[v[0] for v in views if (wire)==v[0].startswith('11')]
if not wire:
  import time
  for i,nm in enumerate(v for v in names if not v.startswith('11')):
    src=OUT/f'prev-{i+1:04d}.png'
    if src.exists():os.replace(src,OUT/f'{nm}.png')
print('preview pass done; files:',sorted(p.name for p in OUT.glob('*.png')))
