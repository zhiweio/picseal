<div align="center">

# PICSEAL

**影像档案终端 · Photo Archive Terminal**

相机品牌风格照片水印，完全在你的浏览器本地生成。
Camera-brand style photo watermarks, generated entirely in your browser.

[![License: MIT](https://img.shields.io/badge/License-MIT-8c9b7b.svg)](LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-Vitest-6e9f18.svg)](#快速开始)
[![Deploy](https://img.shields.io/badge/Deploy-Vercel-000000.svg)](#部署)

**简体中文** · [English](README.en.md)

</div>

---

PICSEAL 为照片生成相机品牌风格的信息水印 —— 机型 / 镜头 / 拍摄参数 / 时间 / 品牌 logo，参照小米·徕卡、尼康 Z、索尼等官方水印美学。解码、合成、导出全部在浏览器本地完成，**照片永不上传**。

产品主线：**导入 → 调样 → 定稿 → 批量 → 交付** —— 单张调样看效果，满意后锁定配置，整卷照片一键产出，ZIP 打包交付。

## 界面预览

**落地页 · 3D 影像档案墙** —— 暖调画廊中的磨砂玻璃档案盒，纵深巷道 + 长焦压缩视场，样片水印实渲后原位升级上墙：

![3D 影像档案墙](docs/screenshots/landing.png)

**工作室 · 单张调样** —— 8 款模板实时预览，EXIF 字段自动填充：

![工作室](docs/screenshots/studio.png)

## ✨ 特性

- **8 款内置模板**：经典横幅（小米·徕卡）/ 标准横幅 / 装裱卡片 / 雾面卡片 / Z 字红标 / 角标参数 / 图注 / 居中标识。排版度量逐项移植自 [semi-utils](https://github.com/leslievan/semi-utils) 的 WatermarkFilter：12% 底边距、30% 槽位行盒高、5% 行间距、行盒对齐、右栏贴分隔线、同一横幅共享字号（超宽自动收缩）
- **11 款水印字体**：Archivo（默认）/ Roboto / 阿里巴巴普惠体 / MiSans / Bebas Neue / Oswald / Playfair Display / 思源宋体 / 霞鹜文楷 / 得意黑 / 马善政毛笔楷书，按族分组、大小可调
- **批量生产线**：拖拽 / 粘贴 / 文件夹 / **ZIP 压缩包** 五通道导入 → 实时预览 + A/B 对比 → 预设定稿（localStorage / JSON 导入导出）→ Worker 池并行批量 → **流式 ZIP 打包下载**（边产边压，File System Access 直写磁盘优先）
- **EXIF 完整保留**：导出时把原始拍摄信息写回文件，覆盖全部输出格式（JPEG / PNG / WebP），支持跨格式（HEIC 原图 → JPEG 输出），写入时自动重置 Orientation 防止二次旋转
- **3D 影像档案墙**（落地页）：暖调画廊 + 磨砂玻璃档案盒（物理透射材质）+ 封面图集实例 + 横向纵深巷道 + 长焦压缩视场 + SSAO / 景深 / SMAA 后处理。交互与动效深度移植自 [Rhine-Music-Demo](https://github.com/RonaldDeng/Rhine-Music-Demo)（MIT）
- **节拍律动 BGM**：WebAudio 谱通量检测鼓点，墙面随节奏泛起涟漪；内置 CC0 曲目（[Komiku](https://commons.wikimedia.org/wiki/File:Komiku_-_03_-_The_road_we_use_to_travel_when_we_were_kids.ogg)），支持载入你自己的音源（仅存本地 IndexedDB），可一键关闭
- **深浅双主题 · 中英双语 · PWA** · RhineLab 终端视觉（直角 / 1px 规则线 / 双语微标签 / 650ms 变量插值切换）
- **本地优先**：零上传、零账号、离线可用；示例样片均来自 Wikimedia Commons 自由许可

## 🚀 快速开始

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

```bash
pnpm test       # Vitest 测试套件
pnpm typecheck  # tsc --noEmit
pnpm build      # 生产构建
```

> 内置样片库由 `scripts/fetch-samples.mjs` 从 Wikimedia Commons 按相机分类采集（验证 EXIF + 质量门槛 + 署名合规），仓库已含成品；如需重建：`node scripts/fetch-samples.mjs --min 45`。

## 📋 格式与能力矩阵

| 环节 | 格式 | 实现 |
|---|---|---|
| 输入解码 | JPEG / PNG / WebP / AVIF | 浏览器原生 |
| | HEIC / HEIF | Safari 原生（其余浏览器解码支持进行中） |
| 输出编码 | JPEG / PNG / WebP | Canvas 原生 |
| EXIF 读取 | JPEG / HEIF / WebP | [exifr](https://github.com/MikeKovarik/exifr)（批量 pick 快路径） |
| EXIF 写入 | JPEG / PNG / WebP | [little_exif](https://github.com/TechnikTobi/little_exif)（Rust→WASM） |

## 🏗 架构

```
rust/exif-writer/        little_exif 薄封装（wasm-bindgen，产物预构建提交）
src/core/                水印引擎（纯 TS 零 DOM，Vitest 覆盖）
  exif/ brands/ render/ templates/ export/
src/three/wall/          3D 档案墙（motion / camera / materials / atlas / scene）
src/three/audio/         节拍引擎（谱通量 onset + 低频包络）
src/workers/             OffscreenCanvas 渲染 worker + 线程池
src/stores/              Zustand：photos / settings / queue
app/[locale]/            zh / en 路由（落地页 / studio / about）
scripts/                 样片采集 / WASM 构建
```

详见 [DESIGN.md](DESIGN.md)（视觉语言与设计 token）。

## ❓ 常见问题

**批量处理的照片在刷新后还在吗？** 不在——File 句柄随页面失效，批次不持久；但你的预设（模板 + 输出配置）持久保存。

**为什么 PNG 输出体积大？** PNG 无损；社交分享建议 JPEG 92 或 WebP。

**如何使用《Welcome Home, Son》作背景音乐？** 该曲为商业版权音乐，不能随仓库分发。点击落地页右上角音乐上传按钮载入你拥有的音源文件，仅保存在你的浏览器 IndexedDB。

## 🙏 致谢

本项目站在这些优秀开源项目的肩膀上，诚挚感谢：

- **[semi-utils](https://github.com/leslievan/semi-utils)** —— 相机照片批量水印工具。PICSEAL 全部模板的排版度量（页边距比例、横幅公式、锚点体系）逐项移植自它的 `WatermarkFilter`，品牌 logo 资源与 Roboto 字体亦取自该仓库。
- **[Rhine-Music-Demo](https://github.com/RonaldDeng/Rhine-Music-Demo)**（MIT，© LBEILC / RonaldDeng，源自 [RhineLabUI](https://github.com/LBEILC/RhineLabUI)）—— 落地页 3D 档案墙的设计与动效来源：磨砂玻璃档案盒、纵深巷道、长焦压缩视场、临界阻尼弹簧、波场位移与后处理链路均移植自它的实现。
- [little_exif](https://github.com/TechnikTobi/little_exif)（MIT/Apache）· [exifr](https://github.com/MikeKovarik/exifr)（MIT）· [fflate](https://github.com/101arrowz/fflate)（MIT）· [three.js](https://github.com/mrdoob/three.js) · [Next.js](https://nextjs.org/) · [Radix UI](https://www.radix-ui.com/) · [Tailwind CSS](https://tailwindcss.com/) · [Zustand](https://github.com/pmndrs/zustand) · [Zod](https://zod.dev/)
- 字体：Archivo · Bebas Neue · Oswald · Playfair Display · Roboto · Noto Serif SC · 霞鹜文楷 · 得意黑 · 马善政毛笔楷书（均 OFL）、阿里巴巴普惠体、MiSans（免费商用授权，许可文本见 `public/fonts/licenses/`）
- 内置 BGM：Komiku（CC0，见 `public/audio/CREDITS.md`）；示例照片来自 Wikimedia Commons（署名见 [CREDITS.md](CREDITS.md)）

## 📄 License

[MIT](LICENSE) © Wang Zhiwei
