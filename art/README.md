# 模型工作区（无头 Blender 建模管线）

管线移植自 Rhine-Music-Demo 的 `art/build_music_cd.py`（MIT，© LBEILC / RonaldDeng）。
正常运行网站不需要安装 Blender；运行时资源位于 `public/assets/`。

## 命令

```sh
# 生成/更新照片档案卡（存 .blend + 导出 GLB + 生成 src/three/wall/asset.ts 指纹引用）
blender --background --python art/build_photo_case.py

# 审查渲染（出 PNG 供视觉对照，不随发布分发）
blender --background --python art/review_studio.py
```

## 管线规范

- **无头运行**：`blender --background --python`，`read_factory_settings(use_empty=True)` 空场景起步，全脚本可复现、可版本化。
- **three.js 坐标系直接建模**（X 右、Y 上、Z 前）：Blender 位置取 `(x, -z, y)`、尺寸取 `(宽, 厚, 高)`；gltf 导出器的 Z-up→Y-up 变换会精确还原 three 坐标，前端零换算。卡片中心高度 y=1.85 烘焙进几何。
- **材质即 surface 名**：`Frosted_Polymer` / `Ivory_Edges` / `Optical_Diffuser` 三个名字贯穿 Blender、GLB 与 three.js 的外观系统。Principled BSDF 只设 Base Color / Roughness / Transmission / IOR 1.46（Blender 端数值仅供审查渲染，运行时由前端 `configurePhotoGlass` 全面接管）。
- **制造感倒角**：BEVEL modifier（width 0.012–0.022、segments=2）→ 全部面 smooth → WEIGHTED_NORMAL（keep_sharp=True）→ 逐个 apply。
- **按材质合并**：同材质对象 join 为单 mesh（渲染器的固定实例批次），命名 `<Model>__<材质名>`，origin 归零。
- **GLB extras**：`obj['photoCaseShell'] = True` + `export_extras=True` → three.js 侧读 `userData` 识别壳体。
- **SHA256 指纹缓存**：导出后取 GLB SHA256 前 12 位，自动生成 `src/three/wall/asset.ts`（`?v=<digest>` 查询参数使浏览器缓存失效）。**不要手改该文件**。

## 文件

- `lib/pipeline.py`：共享管线库（`material` / `box` / `merge_by_material` / `export`）。
- `build_photo_case.py`：照片档案卡 —— 磨砂前盖板 + 后扩散板 + 左连续书脊 + 上/下/右三边框；外廓 4.45 × 3.35 × 0.14。
- `review_studio.py`：三灯棚拍审查渲染（Cycles）。
- `photo-case.blend`：生成产物；`review/`：审查 PNG（gitignore）。

新增模型：复制 `build_photo_case.py` 的结构，调 `box()` 序列与材质表，复用 `lib/pipeline.py` 与 `export()`。
