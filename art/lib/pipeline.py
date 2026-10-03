"""共享无头建模管线 —— 移植自 Rhine-Music-Demo art/build_music_cd.py（MIT，© LBEILC / RonaldDeng）。

管线规范：
- `blender --background --python art/build_*.py` 无头运行，空工厂场景起步；
- 直接在 three.js 坐标系建模（X 右、Y 上、Z 前）：Blender 位置取 (x, -z, y)、
  尺寸取 (宽, 厚, 高)，gltf 导出器的 Z-up→Y-up 变换会精确还原 three 坐标；
- 材质名即前端 surface 名（Frosted_Polymer / Ivory_Edges / Optical_Diffuser），
  Principled BSDF 只设 Base Color / Roughness / Transmission / IOR；
- BEVEL（0.012–0.022、segments=2）→ 全面 smooth → WEIGHTED_NORMAL（keep_sharp）
  造出"制造感"倒角；
- 按材质合并为单 mesh（渲染器固定实例批次），GLB extras 携带壳体标记；
- 导出 GLB 后取 SHA256 前 12 位生成前端资产引用（浏览器缓存失效）。
"""
import hashlib
from pathlib import Path

import bpy

# art/lib/pipeline.py → 仓库根
ROOT = Path(__file__).resolve().parents[2]


def new_scene(name: str):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = name
    return scene


def material(name: str, color, transmission: float = 0, roughness: float = 0.4, ior: float = 1.46):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    # Blender 3.x 叫 'Transmission'，4.x+ 改名 'Transmission Weight'。
    for key in ("Transmission Weight", "Transmission"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = transmission
            break
    else:
        raise RuntimeError(f"Principled BSDF 无 Transmission 输入（Blender {bpy.app.version}）")
    if "IOR" in bsdf.inputs:
        bsdf.inputs["IOR"].default_value = ior
    return mat


def box(name: str, center, dimensions, mat, bevel: float = 0.018, segments: int = 2):
    """以 three.js 坐标 (x, y, z) 与尺寸 (宽, 高, 厚) 直接建块。"""
    x, y, z = center
    w, h, d = dimensions
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (w, d, h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    mod = obj.modifiers.new("Small manufactured edge", "BEVEL")
    mod.width = bevel
    mod.segments = segments
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in obj.data.polygons:
        p.use_smooth = True
    mod = obj.modifiers.new("Weighted face normals", "WEIGHTED_NORMAL")
    mod.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def merge_by_material(scene, prefix: str, extra_key: str):
    """同材质对象 join 为单 mesh；origin 归零；GLB extras 打壳体标记。"""
    merged = []
    for mat in list(bpy.data.materials):
        objs = [
            o
            for o in scene.objects
            if o.type == "MESH" and o.data.materials and o.data.materials[0] == mat
        ]
        if not objs:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = f"{prefix}__{mat.name}"
        obj[extra_key] = True
        scene.cursor.location = (0, 0, 0)
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        merged.append(obj)
    return merged


def export(scene, blend_path: Path, glb_path: Path, asset_ts_path: Path, asset_template: str):
    """存 .blend、导 GLB、生成带 SHA256 指纹的前端资产引用。"""
    for p in (blend_path, glb_path, asset_ts_path):
        p.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_extras=True,
    )
    digest = hashlib.sha256(glb_path.read_bytes()).hexdigest()[:12]
    asset_ts_path.write_text(asset_template.format(digest=digest), encoding="utf-8")
    print(f"exported {glb_path.name} sha256:{digest} ({len(scene.objects)} meshes)")
    return digest
