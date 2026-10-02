# PICSEAL 设计体系 / DESIGN

视觉立场：**「莱茵生命档案终端」式的照片处理仪器** —— 照片是档案文献，EXIF 是编目数据，界面是精密终端。直角、1px 规则线、双语微标签是识别特征；落地页的 3D 影像档案墙是唯一放胆之处。

设计体系移植自 [Rhine-Music-Demo](https://github.com/LBEILC)（RhineLabUI 复刻改造项目），以下参数均取自其源码与 DESIGN.md。

## Token

### 双主题（`data-theme` 驱动）

| Token | 夜（默认） | 昼 |
|---|---|---|
| `--page` | `#08121f` 深蓝黑 | `#e8e5e1` 暖灰 |
| `--surface` | `#162234` | `#efede7` |
| `--panel` | `rgba(17,27,42,.97)` | `rgba(245,244,239,.97)` |
| `--ink` | `#e9eef2` | `#232722` |
| `--muted` | `#9caabd` | `#74786f` |
| `--line` | `rgba(208,226,243,.2)` | `rgba(42,49,42,.18)` |
| `--accent` | `#d9ad7d` 暖金 | `#b56834` 赭橙 |
| `--ok` | `#8c9b7b` | `#6d7f5c` |

**主题切换**：全部 token 经 `@property` 注册为 `<color>`，切换时在根元素上对变量本身做 650ms `cubic-bezier(.4,0,.2,1)` 过渡（`.theme-anim` 类由 ThemeToggle 短暂挂载）——渐变、边线、文字同步插值，无需两套样式。

### 字体

- **MiSans**（300/400/600/700）—— UI 与水印产物同一字体家族，界面与产物视觉同源
- Latin/数字子集 ~30KB/字重（`public/fonts/MiSans-*-latin.woff2`，pyftsubset 生成）
- 水印自定义文字的 CJK 子集 ~1.1MB/字重（`public/fonts/wm/`，GB2312 常用字），worker 内按需懒加载
- CJK UI 文本走系统栈回退（PingFang SC / HarmonyOS Sans / 微软雅黑）

### 排印

- 字阶 10 / 11 / 12 / 14 / 17 / 28px；批次大数字 28px/300/-1px 字距
- 双语微标签（`.hud-label`）：10px、letter-spacing 1.5px、大写，格式 `中文 / ENGLISH`
- eyebrow 分隔符用 `/`；全程禁用「字中点 ·」「破折号标签」「箭头链接」等生成味手法

### 形态

- 面板、输入框、按钮 **border-radius: 0**（圆角仅照片渲染内部使用）
- 1px `var(--line)` 分隔线 + `.rule-heavy`（1px `var(--ink)` 粗主规则线）
- 边框代替阴影；唯一大阴影是弹窗 `var(--shadow-pop)`
- 玻璃感仅限弹窗 scrim（`backdrop-blur(6px)` + `var(--veil)`）
- 状态灯：`.status-dot`（就绪绿灰 / 工作 accent 闪烁 / 失败 `#c25b4e`）

### 动效

- 进场 `cubic-bezier(.22,1,.36,1)`；面板 300/200ms；主题 650ms
- 数字计数 tabular-nums；进度规则线 300ms 宽度过渡
- 全链路尊重 `prefers-reduced-motion`

## 落地页：3D 影像档案墙

移植 Rhine-Music-Demo 的 WebGL 档案架范式（`src/three/archive-wall.ts`）：

- 照片如装裱在深色相框中的档案文献，InstancedMesh 式 5 列 × N 行循环阵列，雾化景深
- 样片**原图先上墙**，水印引擎实渲完成后纹理渐进替换——产品自我演示
- 交互：滚轮巡览（临界阻尼）、悬停波场抬升（damp）、点击 → 相机 dolly 至单帧 + DOM 档案卡（FRAME 003 / SONY α7RM3 / 参数）
- 仅落地页加载 three.js（dynamic import），进入工作台即卸载

## 工作台：2D 精密终端

```
┌────────────────────────────────────────────────────────────┐
│ TopBar  PICSEAL | 006 FRAMES          夜昼 EN ⌥ 输出↵     │
├─────┬──────────────────────────────────────┬───────────────┤
│胶片条│  Stage 画布舞台                       │ ControlColumn │
│tick │  对焦框角标 · A/B 对比滑块 · 缩放平移  │ 模板(实时小样) │
│状态灯│                                      │ 字段 / 样式   │
│别针 │  FRAME 001 sony.jpg α7RM3 …    [A/B] │ 预设 / 输出   │
└─────┴──────────────────────────────────────┴───────────────┘
```

- 胶片条：76px，tick 活动记号（accent 竖线）+ 队列状态灯 + 样片别针
- 批量运行层：`FRAME 042/128` 计数、accent 金色进度规则线、虚拟化逐帧状态列表（状态灯/输出文件名/体积/失败原因）
- 键盘：←/→ 翻帧

## 批次流水线

```
导入(5通道) → 缩略图+EXIF 并行流水线(worker池)
   ↓
调样(样片别针 · 全局配置 · 翻样) → 定稿(预设快照 localStorage/JSON)
   ↓
批量(确认单 → 配置冻结 → worker池 min(4,cores-1) → 逐帧状态机)
   ↓
交付(流式 ZIP: fflate ZipDeflate 边产边压; FS Access 直写优先)
```

内存纪律：主线程仅持 File 句柄 + 320px 缩略图 + EXIF 摘要；预览降采样 LRU（键 `photoId+configHash`）；输出 Blob 磁盘后端 + ZIP 流式边压边产，峰值 ≈ 单张。

## 水印渲染引擎（`src/core/`，纯 TS 零 DOM）

- `exif/`：exifr pick 快路径 + 时间长回退链（DateTimeOriginal → CreateDate → …），数据缺失显示 `-` 而非假数据
- `brands/`：数据驱动匹配（match 关键词数组按序尝试），机型美化规则（ILCE- → α、DMC- → LUMIX 等）
- `render/`：banner 四象限排版（semi-utils 比例体系）/ card 装裱 / frosted 模糊卡 / corner 角标 / center-logo，全部 Canvas API，worker 与主线程通用
- `templates/`：Zod schema 校验 + 8 内置 + JSON 导入导出
- `export/`：little_exif WASM 桥接 —— EXIF 跨格式拷贝，写入时重置 Orientation（画布已摆正像素，防止查看器二次旋转）

## 构建

- WASM 产物预构建提交（`src/wasm/exif/`）——Vercel/Docker 构建零 Rust 依赖；CI 仅在 rust/ 变更时重建
- 字体子集：`scripts/subset_fonts.py`（pyftsubset）；logo 栅格化：`scripts/rasterize-logos.mjs`（sharp，worker 的 createImageBitmap 不支持 SVG）
