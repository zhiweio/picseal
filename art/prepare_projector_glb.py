"""Eumig 放映机 GLB 归一化 —— 消费外部高精模型（~/Downloads/eumig_film_projector.glb）。

用 `blender --background --python art/prepare_projector_glb.py` 运行（源文件路径可用
EUMIG_SRC 环境变量覆盖）。处理内容：

- **保留**原模型层级与 PBR 材质/贴图（扫描件的质感来源），不做材质重映射；
- 包一层 `EumigProjector` 空物体统一缩放 6×（0.39m 实物 → 2.34 单位英雄件）并几何居中；
- 部件改名对齐运行时旋转钩子：`Reel.001→ReelSupply`、`Reel.002→ReelTakeup`、
  `Focusing_Knob→FocusRing`（盘轴沿 X：three 里绕自身 X 自转）；
- Blender +Y 前端经 glTF Z-up→Y-up 映射为 three -Z —— 与场景镜头朝向约定一致；
- 导出 GLB + SHA256 指纹 → src/three/cinema/asset.ts（勿手改）。

PICSEAL_REVIEW=1 时出 EEVEE 3/4 审查渲染（art/review/，gitignored）。
"""
import hashlib
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))

from pipeline import ROOT

import bpy
from mathutils import Vector

# 默认取 4K 版（几何与普通版相同，贴图为 3×4096²）：导出时 WebP 重编码控体积
SRC = os.environ.get("EUMIG_SRC", os.path.expanduser("~/Downloads/eumig_film_projector_4k.glb"))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "Picseal_Eumig_Projector"
bpy.ops.import_scene.gltf(filepath=SRC)

imported = list(scene.objects)
if not imported:
    raise SystemExit("GLB 导入为空")

# ── 部件改名（运行时旋转钩子）：空物体与其网格子件一起改 ──
RENAMES = (("Reel.001", "ReelSupply"), ("Reel.002", "ReelTakeup"), ("Focusing_Knob", "FocusRing"))
for obj in imported:
    for old, new in RENAMES:
        if old in obj.name:
            obj.name = obj.name.replace(old, new)

# ── 统一包装：缩放 6× + 几何居中（保留内部层级与部件局部轴） ──
SCALE = 6.0
wrapper = bpy.data.objects.new("EumigProjector", None)
scene.collection.objects.link(wrapper)
tops = [o for o in imported if o.parent is None or o.parent not in imported]
for o in tops:
    o.parent = wrapper  # keep transform

# 世界包围盒中心（改父级前计算）
box_min = Vector((1e9, 1e9, 1e9))
box_max = Vector((-1e9, -1e9, -1e9))
for o in imported:
    if o.type != "MESH":
        continue
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        box_min = Vector(map(min, box_min, w))
        box_max = Vector(map(max, box_max, w))
center = (box_min + box_max) / 2

wrapper.scale = (SCALE, SCALE, SCALE)
wrapper.location = (-center.x * SCALE, -center.y * SCALE, -center.z * SCALE)

lens_blender = Vector((-0.045, 0.215, 0.17))  # 机身前脸/片门附近（目测估算，供 asset.ts 注释）
print(f"normalized size: {(box_max - box_min) * SCALE}")
print(f"lens three-local ≈ ({lens_blender.x * SCALE:.2f}, {(lens_blender.z - center.z) * SCALE:.2f}, {-(lens_blender.y - center.y) * SCALE:.2f})")

# ── 审查渲染 ──
if os.environ.get("PICSEAL_REVIEW") == "1":
    review_dir = ROOT / "art/review"
    review_dir.mkdir(parents=True, exist_ok=True)
    cam_data = bpy.data.cameras.new("ReviewCam")
    cam_data.lens = 55
    cam = bpy.data.objects.new("ReviewCam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (2.4, -2.8, 1.4)  # 前脸（+Y）3/4 视角
    cam.rotation_euler = (-cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    lights = []
    for name, size, energy, loc in [
        ("Key", 512, 900, (-3.0, -2.0, 3.4)),
        ("Rim", 256, 600, (2.8, 3.0, -1.6)),
        ("Fill", 128, 220, (0, 3.2, 2.6)),
    ]:
        light = bpy.data.lights.new(name, "AREA")
        light.size = size
        light.energy = energy
        obj = bpy.data.objects.new(name, light)
        obj.location = loc
        scene.collection.objects.link(obj)
        lights.append(obj)
    world = bpy.data.worlds.new("ReviewWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.025, 0.035, 1)
    scene.world = world
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 860
    scene.render.filepath = str(review_dir / "eumig-review.png")
    bpy.ops.render.render(write_still=True)
    print(f"review render → {scene.render.filepath}")
    bpy.data.objects.remove(cam, do_unlink=True)
    for obj in lights:
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.worlds.remove(world)
    scene.camera = None

# ── 导出（保留层级/材质/贴图） ──
blend_path = ROOT / "art/eumig-projector.blend"
glb_path = ROOT / "public/assets/cinema-projector.glb"
asset_ts = ROOT / "src/three/cinema/asset.ts"
bpy.ops.object.select_all(action="SELECT")
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
# 贴图重编码：4K PNG(21MB) → WebP 高质量（保细节、控首屏体积；WebP 保留 alpha）
export_kwargs = dict(
    filepath=str(glb_path), export_format="GLB", use_selection=True, export_apply=False, export_extras=True
)
try:
    bpy.ops.export_scene.gltf(export_image_format="WEBP", export_webp_quality=88, **export_kwargs)
except Exception:
    try:
        bpy.ops.export_scene.gltf(export_image_format="JPEG", export_jpeg_quality=88, **export_kwargs)
    except Exception:
        bpy.ops.export_scene.gltf(**export_kwargs)
digest = hashlib.sha256(glb_path.read_bytes()).hexdigest()[:12]
asset_ts.parent.mkdir(parents=True, exist_ok=True)
# 与 art/build_cinema_screen.py 共写 asset.ts：各自只重写自己那行，保留对方指纹
import re as _re
existing = asset_ts.read_text(encoding="utf-8") if asset_ts.exists() else ""
_m = _re.search(r'CINEMA_SCREEN_ASSET = "[^?]+\.glb\?v=([0-9a-f]+)"', existing)
lines = "// Generated by art/prepare_projector_glb.py & art/build_cinema_screen.py; do not edit by hand.\n"
lines += f'export const CINEMA_PROJECTOR_ASSET = "/assets/cinema-projector.glb?v={digest}";\n'
if _m:
    lines += f'export const CINEMA_SCREEN_ASSET = "/assets/cinema-screen.glb?v={_m.group(1)}";\n'
asset_ts.write_text(lines, encoding="utf-8")
rotating = [o.name for o in scene.objects if any(k in o.name for k in ("ReelSupply", "ReelTakeup", "FocusRing"))]
print(f"eumig sha256:{digest}  rotating hooks: {rotating}")
