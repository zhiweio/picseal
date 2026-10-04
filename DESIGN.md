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
- **个人档案馆**（右上入口，accent 暖金镜像放映室入口形态）：档案征集弹窗支持文件夹 / 多选 / 拖拽三通道批量上传，弹窗内 9×4「未竟之墙」迷你墙实时飞入显影（GSAP 编排，尊重 reduced-motion）；收录满 120 张才可「入馆」，不足则幽灵框波浪 + 扫描线 + 分档轮换鼓励语；入馆后档案墙换源为用户作品并重放入场揭示

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

## 放映室：/cinema（3D 放映厅 + 浏览器端成片）

与工作台同级，把照片放成一部作品集幻灯片：开场素材（白日梦想家片段）→ 片头卡 → **水印幻灯片蒙太奇** → 谢幕卡，配乐 Welcome Home 跟随片长淡出。纯浏览器端录制，1920×1080@30fps，优先 H.264 MP4（`MediaRecorder.isTypeSupported` 探测），Firefox 回退 WebM 并明示。

- **水印幻灯片语义**（照片 = 工作台处理后的完整作品）：装片时经共享渲染池按片预渲染 `useSettings.template` 的水印合成图（PNG blob，单张失败回退原片路径）；引擎以 contain letterbox 内接上幕（横幅/装裱完整可见、两侧影院遮幅、无 Ken Burns、无交叉溶解、无 EXIF 字幕条——**硬切一张张放**，`crossfade: 0` 零重叠时间轴）；待机海报 = 首张水印合成图同语义绘制；队列缩略图先上原片缩略、再逐片换渲染池 mini 水印小样渐进升级
- **照片门槛**：最少 16 张（不足禁用生成，文案「还差 N 张 · 继续加油 KEEP SHOOTING」），最多 48 张（超出进**手挑器**，预选按拍摄时间等距采样）；工作台 TopBar 入口按 16 张门槛启停，首页右上入口始终可用（放映室可自行上传）
- **Nikon 红特例**：`--color-nikon: #e01f26`（双主题同值，不进 `@property` 主题插值体系）。仅用于尼康 Z 专用字形（`Picseal NikonZSymbol`，Special Alphabets P04）与放映指示（REC/进度线/光圈红标）；它是放映室的品牌识别色，**不得**扩散为通用 accent。同理，个人档案馆入口用主题 accent 暖金（`--accent` + `--accent-glow` 辉光），两入口形态同构、品牌色互不混用
- **3D 浮空投影仪器**（`src/three/cinema/`，wall 场景同套生命周期骨架）：深空雾景（背景/雾与 land 夜间同一套 `#07111f` 深海军蓝——玻璃透射需要底色，纯黑会把磨砂玻璃读成黑烟色）中一台 Eumig 高精放映机（PBR 扫描件）浮空居左，镜头对准居中放大的 **photo-case 玻璃卡**——受映面 = 引擎主画布的自发光幕面（MeshBasic + toneMapped:false，**所见即所录**），16:9 画面在 4:3 装裱印刷窗内 letterbox（上下透玻璃，land 的 contain 语义）。雾每帧锚定渲染距离（land 墙面同构：受映卡永远在雾起点之前百分百清澈，队列只留轻度景深雾）。主卡玻璃与 land 墙面**完全同构**：CardAppearance 磨砂透射配方（"通透"来自 transmission 而非低粗糙度，永不成抛光塑料）+ SelectionLighting 聚光**每帧跟随相机**（高光在视空间稳定不游走，放映让位仅轻收至 0.85×——大幅让位会让播放态玻璃整卡发灰）；卡片静止、相机无永续漂移（仅入场 dolly + 阻尼指针视差）。照片集为**顺时针滑盘**：队首锚定弧带右端、槽位固定逐格右移、队尾随消耗缩短；队首出队 → 沿弧绕银幕右侧滑入片门 → **片门驻留**（微缩卡嵌在光轴近场随机身微振，"这张正被放映"）→ 换片时在片门**化作光影消散**（暖白化、沿光路轻扬、透明归零，永不回队尾）；谢幕时整条作品集自队首向队尾波浪式散尽清空（再次放映整体显影重建，中止放映亦复位）。放映模拟 = 双盘续转 + 对焦环慢旋 + **真实放映机光路**：镜头 → 幕心的暖色光束主光（SpotLight 宽锥只照玻璃与机身，画面零干扰）+ 止于近场的光锥（锥长 60%、后段自 35% 加速消散）+ 集中在镜头附近的光路尘埃（t ≤ 0.40）+ **银幕回波随影片染色**（每 0.6s 低频采样引擎画布均色与白混 55%，房间被电影"染"色——队列相框被银幕照亮的通透感来源，强度 58/range 22）+ 片门暖光；补光全部与队列隔离（rim 贴身放映机 range 12、hero 半角 0.68）；聚光放映让位仅至 0.78（beamLight 承担事件照明，玻璃总亮度守恒）。**开机仪式**（点"预览放映/生成"的开场）：放映机 ease 滑入画面中央特写 → 电机惯性起步 + 对焦环校准快旋 + 机身微振 + 片门灯白炽颤亮（加色光晕灯珠）→ 沿三点弧线丝滑归位左下角、灯随归位点亮 → 引擎即刻上片（≈4.5s，reduced-motion 跳过）；入场 = 光圈叶片开合（`--iris-r` @property mask）+ 相机由远及近 dolly；**悬浮主画面 + 滚轮推近**（raycast 命中受映卡时 cursor=zoom-in，滚轮在 [0,1] 钳制推近：半径 9.8→6.6、取景中心向卡面偏移 55%——幅度受限不遮放映机，离开即阻尼回落；开机仪式期间让位）；取景 HUD = 对焦角标 + REC + timecode + 红色进度规则线。播放结束后幕面**驻留 END 卡**（END + 多语言署名小字 `film.endCredit`，zh「PICSEAL 创作」/ en「Created with PICSEAL」），不放完就黑屏
- **版权媒体边界**：开场片段与配乐为商业版权，不随仓库分发（`public/cinema/*.mp4|m4a` gitignored）；三级来源 = 用户浏览器导入（IndexedDB）→ 本机 gitignored 文件（HEAD 探测）→ CC0 回退（开场跳过、配乐用 bgm.mp3），署名见 `public/cinema/CREDITS.md`

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

## 客户端持久化（无后端，全部本地；零裸用 localStorage）

- **应用状态**（水印预设 + 输出设置）：zustand `persist` 中间件 → `localStorage['picseal-settings']`（version+migrate、zod 校验 merge，坏数据静默回默认）
- **用户偏好**（音乐自动起播 / 放映室片头配乐开关 / 重采样内核）：zustand `persist` → `localStorage['picseal-prefs']`（收编原 `picseal-music`、`picseal-cinema-media`、`picseal-resize-kernel` 三个散装 key，首次加载自动迁移并清理）
- **主题**（夜/昼）：next-themes → `localStorage['picseal-theme']`（`data-theme` attribute，自带无闪烁内联脚本与跨标签页同步）
- 照片本体**永不持久化**（内存纪律见上）；隐私模式下各库自动容错回默认值
- **个人档案馆例外**（landing 作品集）：仅持久化 ≤320px 缩略图 + EXIF 摘要至 IndexedDB（`picseal-portfolio.thumbs`，idb-keyval），原片 File 句柄只在会话内存活；入口提供「清空档案馆」
- **大文件 Blob**（用户自备音源、放映室导入素材）：idb-keyval → IndexedDB（KV 语义；DB/Store 沿用 `picseal-audio.track`、`picseal-cinema.media`，老数据免迁移）

## 水印渲染引擎（`src/core/`，纯 TS 零 DOM）

- `exif/`：exifr pick 快路径 + 时间长回退链（DateTimeOriginal → CreateDate → …），数据缺失显示 `-` 而非假数据
- `brands/`：数据驱动匹配（match 关键词数组按序尝试），机型美化规则（ILCE- → α、DMC- → LUMIX 等）
- `render/`：banner 四象限排版（semi-utils 比例体系）/ card 装裱 / frosted 模糊卡 / corner 角标 / center-logo，全部 Canvas API，worker 与主线程通用
- `templates/`：Zod schema 校验 + 8 内置 + JSON 导入导出
- `export/`：little_exif WASM 桥接 —— EXIF 跨格式拷贝，写入时重置 Orientation（画布已摆正像素，防止查看器二次旋转）

## 构建

- WASM 产物预构建提交（`src/wasm/exif/`）——Vercel/Docker 构建零 Rust 依赖；CI 仅在 rust/ 变更时重建
- 字体子集：`scripts/subset_fonts.py`（pyftsubset）；logo 栅格化：`scripts/rasterize-logos.mjs`（sharp，worker 的 createImageBitmap 不支持 SVG）
