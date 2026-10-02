# PICSEAL — 影像档案终端 / PHOTO ARCHIVE

**隐私优先的浏览器内照片水印工作室**：为照片生成相机品牌风格的信息水印（机型 / 镜头 / 参数 / 时间 / 品牌 logo），参照小米·徕卡、尼康 Z 等官方水印美学。所有处理在你的浏览器本地完成，**照片永不上传**。

```
导入 → 调样 → 定稿 → 批量 → 交付
```

单张调样看效果，满意后锁定配置，整卷照片一键产出，ZIP 打包交付。

## 特性

- **8 款内置模板**：经典横幅（小米·徕卡）/ 标准横幅 / 装裱卡片 / 雾面卡片 / Z 字红标 / 角标参数 / 图注 / 居中标识，全部支持字段显隐、自定义文字、缩放、画幅归一化等微调
- **批量生产线**：单张调样 → 保存预设 → 一键处理全部 → 流式 ZIP 打包下载；worker 池并行渲染，支持暂停 / 取消 / 失败重试
- **导入五通道**：拖拽 / 粘贴 / 多选 / 文件夹 / ZIP 压缩包
- **EXIF 完整保留**：导出时把原始拍摄信息写回文件，支持 **JPEG / PNG / WebP** 全部输出格式（跨格式复制，如 HEIC 原图 → JPEG 输出；写入时自动重置 Orientation 防止二次旋转）
- **~17 个品牌库**：Sony / Canon / Nikon / Fujifilm / Leica / Panasonic / Olympus / Ricoh / Pentax / Hasselblad / Apple / Huawei / Honor / Xiaomi / DJI / Insta360，数据驱动匹配，机型名自动美化（ILCE-7M4 → α7M4）
- **RhineLab 档案终端视觉**：直角 / 1px 规则线 / 双语微标签 / 深浅双主题（650ms 变量插值切换）
- **中英双语**、响应式、PWA 可安装

## 格式能力矩阵

| 环节 | 格式 | 实现 |
|---|---|---|
| 输入解码 | JPEG / PNG / WebP / AVIF | 浏览器原生 |
| | HEIC / HEIF | Safari 原生（其他浏览器解码支持进行中） |
| 输出编码 | JPEG / PNG / WebP | Canvas 原生 |
| EXIF 读取 | JPEG / HEIF / WebP | exifr（批量 pick 快路径） |
| EXIF 写入 | JPEG / PNG / WebP | little_exif（Rust→WASM，见下） |

## 技术栈

Next.js 15 (App Router) · TypeScript strict · Tailwind CSS v4 · Radix · Zustand · Zod · exifr · fflate · three.js（落地页影像档案墙）· **little_exif → WASM**（EXIF 写入）· OffscreenCanvas + Web Worker 渲染管线

## 开发

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # Vitest 核心引擎单测
pnpm typecheck    # tsc --noEmit
pnpm build        # 生产构建
```

## 部署

### Vercel（推荐）

零配置：导入仓库即可。WASM 产物已预构建提交在 `src/wasm/exif/`，**构建不需要 Rust 工具链**。

### Docker 自托管

```bash
docker run -p 3000:3000 zhiweio/picseal
# 或
docker compose up -d
```

镜像多阶段构建自 `output: 'standalone'`，打开 `http://localhost:3000` 即用。

## EXIF WASM 产物（仅维护者）

`rust/exif-writer/` 是 [little_exif](https://github.com/TechnikTobi/little_exif) 的 wasm-bindgen 薄封装（API：`copy_exif` / `detect_type`）。修改 Rust 代码后：

```bash
pnpm build:wasm   # 需要 wasm-pack；产物写入 src/wasm/exif/ 并提交
```

CI（`.github/workflows/rebuild-wasm.yml`）可在 rust/ 变更时自动重建产物。

## 设计

视觉语言源自 [RhineLabUI](https://github.com/LBEILC)（莱茵生命档案终端）：照片是档案文献，EXIF 是编目数据。设计 token、动效参数与 3D 档案墙范式均移植自该体系。详见 [DESIGN.md](DESIGN.md)。

## License

MIT © Wang Zhiwei
