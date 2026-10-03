"""审查渲染：给 photo-case.blend 打灯出图，供视觉模型与参考截图对照。

用 `blender --background --python art/review_studio.py` 运行；
输出 art/review/photo-case-review-<视角>.png（不随发布分发）。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))

from pipeline import ROOT

import bpy

BLEND = ROOT / "art/photo-case.blend"
OUT = ROOT / "art/review"
OUT.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=str(BLEND))
scene = bpy.context.scene

# Cycles 才能真实渲染 transmission 玻璃；探测可用引擎（4.x EEVEE 命名不稳定）。
for engine in ("CYCLES", "BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
if scene.render.engine == "CYCLES":
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    scene.cycles.device = "CPU"

# 柔和暖调棚灯（近似 RoomEnvironment IBL）
world = bpy.data.worlds.new("Review")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.92, 0.90, 0.87, 1)
bg.inputs[1].default_value = 1.0
scene.world = world

def area_light(name, position, size, energy):
    light_data = bpy.data.lights.new(name, "AREA")
    light_data.size = size
    light_data.energy = energy
    obj = bpy.data.objects.new(name, light_data)
    obj.location = position
    scene.collection.objects.link(obj)
    return obj

area_light("Key", (5.0, -4.0, 6.5), 5.0, 400)
area_light("Fill", (-5.0, -5.5, 2.5), 6.0, 120)
area_light("Rim", (-2.5, 5.0, 4.0), 4.0, 200)

camera_data = bpy.data.cameras.new("Review Camera")
camera_data.lens = 85
camera = bpy.data.objects.new("Review Camera", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
track = camera.constraints.new("TRACK_TO")
track.target = bpy.data.objects.new("Aim", None)
track.target.location = (0.1, 0, 1.85)
scene.collection.objects.link(track.target)

scene.render.resolution_x = 1200
scene.render.resolution_y = 900
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"

# 视角直接用 Blender 坐标（three 坐标 (x,y,z) → Blender (x,-z,y)）
views = {
    # 正面稍偏右上的 3/4 视角（对照参考详情截图）
    "front34": (6.2, -5.2, 4.6),
    # 侧 45°：看分层与书脊厚度（对照浏览态斜侧视角）
    "side": (7.6, 1.2, 3.2),
    # 背面 3/4：后扩散板
    "back34": (-6.0, -5.0, 4.6),
}
for name, position in views.items():
    camera.location = position
    scene.render.filepath = str(OUT / f"photo-case-review-{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"rendered {name}")
print("review renders complete")
