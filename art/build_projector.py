"""英雄放映机 —— 浮空投影仪器。用 `blender --background --python art/build_projector.py` 运行。

工法移植自 Rhine-Music-Demo build_archive.py 的精密仪器语汇：
- 十材质词汇（磨砂玻璃塔 / 钛机架 / 香槟金点缀 / 透镜光学 / 碳墨胶片 …）；
- 微细节密度：刻字铭牌、镭雕散热栅、校准标线、镀金轴帽、滚花对焦环、走片段；
- ReelSupply / ReelTakeup / FocusRing 导出为独立命名对象（烘焙世界变换、原点归轴心，
  运行时直接绕 three-Z 自转），其余静态件按材质合并；
- three 坐标系直建（X 右 Y 上 Z 前），镜头朝 -Z；原点取塔身中心（浮空仪器，无底座）。

PICSEAL_REVIEW=1 时在导出前用 EEVEE 出 3/4 视角审查渲染（art/review/，gitignored）。
"""
import hashlib
import os
import sys
from math import atan2, pi, sin, cos
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))

from pipeline import ROOT, box, material, new_scene

import bpy

scene = new_scene("Picseal_Cinema_Projector")

# Blender 端数值仅供审查渲染；three.js 运行时按材质名接管。
frost = material("Frosted_Polymer", (0.96, 0.95, 0.92), 0.38, 0, 0.86)
titanium = material("Titanium_Fasteners", (0.30, 0.32, 0.35), 0.24, 0.9)
gold = material("Champagne_Index", (0.78, 0.58, 0.32), 0.26, 0.95)
housing = material("Optical_Diffuser", (0.14, 0.15, 0.17), 0.6, 0.2)
edge = material("Optical_Edges", (0.38, 0.40, 0.44), 0.22, 0.7)
lens_glass = material("Subsurface_Optics", (0.75, 0.78, 0.80), 0.06, 0, 0.92)
ink = material("Carbon_Ink", (0.045, 0.046, 0.05), 0.72, 0)
paper = material("Printed_Label", (0.90, 0.88, 0.84), 0.65)
ceramic = material("Internal_Ceramic", (0.55, 0.54, 0.52), 0.5, 0.06)


def finish(obj, bevel=0.012):
    mod = obj.modifiers.new("Precision radiused edge", "BEVEL")
    mod.width = bevel
    mod.segments = 2
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in obj.data.polygons:
        p.use_smooth = True
    mod = obj.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
    mod.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def cyl(name, x, y, z, radius, depth, mat, bevel=0.008, segments=64):
    """three 坐标圆柱，轴沿 Z（朝观众的圆盘/镜筒）。"""
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=depth, vertices=segments, location=(x, -z, y), rotation=(pi / 2, 0, 0)
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return finish(obj, bevel)


def taper(name, x, y, z, r_base, r_tip, depth, mat):
    """轴沿 Z 的圆台（镜筒锥鼻）。"""
    bpy.ops.mesh.primitive_cone_add(
        radius1=r_base, radius2=r_tip, depth=depth, vertices=64, location=(x, -z, y), rotation=(pi / 2, 0, 0)
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return finish(obj, 0.006)


def dome(name, x, y, z, radius, mat):
    """前镜片玻璃半球。"""
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=radius, segments=48, ring_count=24, location=(x, -z, y), rotation=(pi / 2, 0, 0)
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return finish(obj, 0.004)


def tick(name, x, y, z, w, h, d, mat, angle):
    """绕 Z 旋转放置的刻度/滚花齿（不倒角：微米级细节靠密度）。"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (w, d, h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler = (0, 0, angle)
    obj.data.materials.append(mat)
    return obj


def label(name, body, x, y, z, size, mat=ink, spacing=1.05):
    """塔身铭牌刻字（FONT 曲线，导出前转 mesh）。"""
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    curve.size = size
    curve.extrude = 0.002
    curve.space_character = spacing
    curve.align_x = "CENTER"
    obj = bpy.data.objects.new(name, curve)
    scene.collection.objects.link(obj)
    obj.location = (x, -z, y)
    obj.rotation_euler = (pi / 2, 0, 0)
    curve.materials.append(mat)
    return obj


def join_baked(objects, name, origin_three):
    """join → 烘焙全部变换到几何 → 原点归轴心（three 坐标传入）。

    产物恒为：identity 旋转 + 原点在指定轴心，运行时直接绕自身 Z 旋转即可。
    """
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    scene.cursor.location = (origin_three[0], -origin_three[2], origin_three[1])
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    obj["cinemaProp"] = True
    return obj


# ───────────────────────── 构图：玻璃塔骨干 + 双盘前脸 + 镜头组朝 -Z ─────────────────────────

# 1) 磨砂玻璃主塔 + 钛背脊 + 上下钛帽（金线收边）
box("Frosted tower", (0, 0.1, 0.1), (0.52, 1.8, 0.4), frost, 0.016)
box("Titanium spine", (0, 0.1, 0.34), (0.6, 1.92, 0.1), titanium, 0.014)
box("Titanium crown", (0, 1.05, 0.1), (0.62, 0.1, 0.46), titanium, 0.012)
box("Titanium foot", (0, -0.84, 0.1), (0.62, 0.12, 0.46), titanium, 0.012)
box("Crown gold line", (0, 1.02, -0.13), (0.5, 0.012, 0.012), gold, 0.003)
box("Foot gold line", (0, -0.79, -0.13), (0.5, 0.012, 0.012), gold, 0.003)

# 2) 背脊镭雕散热栅 + 校准标线
for i in range(9):
    box("Laser etched vent", (0, 0.62 - i * 0.16, 0.4), (0.3, 0.02, 0.012), edge, 0.002)
for i in range(15):
    w = 0.05 if i % 5 == 0 else 0.024
    box("Calibration mark", (-0.26, -0.6 + i * 0.075, 0.4), (w, 0.008, 0.012), gold, 0.002)

# 3) 塔身铭牌（印刷底 + 刻字）
box("Serial label plate", (0, -0.52, -0.105), (0.34, 0.22, 0.012), paper, 0.003)
label("Company label", "PICSEAL", 0, -0.47, -0.116, 0.075, ink)
label("Model label", "PROJECTION P16", 0, -0.56, -0.116, 0.034, ceramic)
box("Label rule", (0, -0.505, -0.116), (0.3, 0.004, 0.004), ink, 0.001)

# 4) 胶片盘（可旋转件）：磨砂玻璃盘 + 碳墨缠卷 + 三辐金 + 钛缘环 + 金轴毂


def build_reel(name, y, radius):
    parts = [
        cyl(f"{name} glass disc", 0, y, -0.2, radius, 0.028, frost, 0.006),
        cyl(f"{name} film coil", 0, y, -0.21, radius * 0.56, 0.052, ink, 0.004),
        cyl(f"{name} rim", 0, y, -0.2, radius + 0.008, 0.016, titanium, 0.004),
        cyl(f"{name} hub", 0, y, -0.24, 0.075, 0.09, gold, 0.005),
    ]
    for k in range(3):
        angle = k * 2 * pi / 3
        parts.append(
            tick(
                f"{name} spoke",
                sin(angle) * radius * 0.62,
                y + cos(angle) * radius * 0.62,
                -0.21,
                0.05,
                radius * 1.1,
                0.024,
                gold,
                angle,
            )
        )
    return join_baked(parts, name, (0, y, -0.2))


reel_supply = build_reel("ReelSupply", 0.82, 0.5)
reel_takeup = build_reel("ReelTakeup", -0.52, 0.4)

# 盘臂与外侧轴帽（静态）
box("Reel strut top", (0, 0.55, -0.16), (0.16, 0.42, 0.1), titanium, 0.01)
box("Reel strut bottom", (0, -0.18, -0.16), (0.16, 0.42, 0.1), titanium, 0.01)
cyl("Hub cap top", 0, 0.82, -0.3, 0.045, 0.03, gold, 0.004)
cyl("Hub cap bottom", 0, -0.52, -0.3, 0.045, 0.03, gold, 0.004)

# 5) 镜头组（朝 -Z）：基座环 → 镜筒 → 滚花对焦环（可旋转）→ 锥鼻 → 前玻璃半球
cyl("Lens base ring", 0, 0.02, -0.34, 0.155, 0.1, titanium, 0.008)
cyl("Lens barrel", 0, 0.02, -0.52, 0.125, 0.26, edge, 0.006)
cyl("Lens inner bore", 0, 0.02, -0.62, 0.088, 0.18, housing, 0.004)

focus_parts = [cyl("Focus ring body", 0, 0.02, -0.5, 0.142, 0.12, titanium, 0.006)]
for k in range(56):
    angle = k * 2 * pi / 56
    focus_parts.append(
        tick("Focus knurl", sin(angle) * 0.142, 0.02 + cos(angle) * 0.142, -0.5, 0.014, 0.12, 0.012, gold, angle)
    )
focus_ring = join_baked(focus_parts, "FocusRing", (0, 0.02, -0.5))
tick("Focus index", 0, 0.172, -0.5, 0.05, 0.008, 0.01, gold, 0)  # 机身侧基准长刻线（静态）

taper("Lens nose cone", 0, 0.02, -0.72, 0.115, 0.085, 0.14, edge)
dome("Front element", 0, 0.02, -0.8, 0.082, lens_glass)

# 6) 片门组件（镜头上方的小钛块 + 玻璃窗 + 四颗金螺钉）
box("Film gate", (0, 0.26, -0.34), (0.2, 0.24, 0.16), titanium, 0.01)
box("Gate window", (0, 0.26, -0.425), (0.09, 0.13, 0.01), lens_glass, 0.002)
for sx in (-1, 1):
    for sy in (-1, 1):
        cyl("Gate screw", sx * 0.07, 0.26 + sy * 0.08, -0.43, 0.011, 0.014, gold, 0.002)

# 7) 走片段（碳墨细带：供片盘 → 片门 → 收片盘）
RIBBON = [
    ((0.18, 1.18, -0.2), (0.13, 0.44, -0.36)),
    ((0.13, 0.44, -0.36), (0.09, 0.3, -0.4)),
    ((0.07, 0.14, -0.4), (0.05, -0.28, -0.36)),
    ((0.05, -0.28, -0.36), (0.12, -0.82, -0.2)),
]
for i, ((x0, y0, z0), (x1, y1, z1)) in enumerate(RIBBON):
    cx, cy, cz = (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2
    length = ((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2) ** 0.5 + 0.03
    seg = box(f"Film ribbon {i}", (cx, cy, cz), (0.09, length, 0.014), ink, 0.003)
    seg.rotation_euler = (0, 0, -(pi / 2 - atan2(y1 - y0, x1 - x0)))
# 盘缘缠卷暗示
cyl("Feed coil hint", 0, 0.82, -0.19, 0.53, 0.008, ink, 0.002)
cyl("Take coil hint", 0, -0.52, -0.19, 0.43, 0.008, ink, 0.002)

# 8) FONT 曲线转 mesh + 烘焙残余修改器
bpy.ops.object.select_all(action="SELECT")
for o in list(scene.objects):
    bpy.context.view_layer.objects.active = o
    if o.type in ("FONT", "CURVE"):
        bpy.ops.object.convert(target="MESH")
    for m in list(o.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception:
            pass

# ───────────────────────── 审查渲染（EEVEE 3/4 视角，不入库） ─────────────────────────
if os.environ.get("PICSEAL_REVIEW") == "1":
    review_dir = ROOT / "art/review"
    review_dir.mkdir(parents=True, exist_ok=True)
    cam_data = bpy.data.cameras.new("ReviewCam")
    cam_data.lens = 55
    cam = bpy.data.objects.new("ReviewCam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (1.9, 2.4, 0.9)  # three (1.9, 0.9, -2.4)
    cam.rotation_euler = (-cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    lights = []
    for name, size, energy, loc in [
        ("Key", 512, 900, (-2.2, -1.6, 2.4)),
        ("Rim", 256, 600, (2.4, -2.0, -1.2)),
        ("Fill", 128, 220, (0, 2.5, -2.5)),
    ]:
        light = bpy.data.lights.new(name, "AREA", )
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
    scene.render.filepath = str(review_dir / "projector-review.png")
    bpy.ops.render.render(write_still=True)
    print(f"review render → {scene.render.filepath}")
    bpy.data.objects.remove(cam, do_unlink=True)
    for obj in lights:
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.worlds.remove(world)
    scene.camera = None

# ───────────────────────── 静态件按材质合并 → 导出 ─────────────────────────
# 注意：join 会移除被并入的对象，必须按材质名迭代、每轮现查 scene.objects，避免悬空引用。
ROTATING = {"ReelSupply", "ReelTakeup", "FocusRing"}
mat_names = list(
    dict.fromkeys(
        o.data.materials[0].name
        for o in scene.objects
        if o.type == "MESH" and o.name not in ROTATING and o.data.materials
    )
)
for mat_name in mat_names:
    mat = bpy.data.materials[mat_name]
    objs = [
        o
        for o in scene.objects
        if o.type == "MESH" and o.name not in ROTATING and o.data.materials and o.data.materials[0] == mat
    ]
    if not objs:
        continue
    if len(objs) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        merged = bpy.context.object
        merged.name = f"Projector__{mat_name}"
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        scene.cursor.location = (0, 0, 0)
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        merged["cinemaProp"] = True
    else:
        objs[0]["cinemaProp"] = True

blend_path = ROOT / "art/cinema-projector.blend"
glb_path = ROOT / "public/assets/cinema-projector.glb"
asset_ts = ROOT / "src/three/cinema/asset.ts"
bpy.ops.object.select_all(action="SELECT")
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
bpy.ops.export_scene.gltf(
    filepath=str(glb_path), export_format="GLB", use_selection=True, export_apply=True, export_extras=True
)
digest = hashlib.sha256(glb_path.read_bytes()).hexdigest()[:12]
asset_ts.parent.mkdir(parents=True, exist_ok=True)
asset_ts.write_text(
    "// Generated by art/build_projector.py; changes invalidate the browser asset cache.\n"
    f'export const CINEMA_PROJECTOR_ASSET = "/assets/cinema-projector.glb?v={digest}";\n',
    encoding="utf-8",
)
print(f"projector sha256:{digest}  exported objects: {[o.name for o in scene.objects if o.type == 'MESH']}")
