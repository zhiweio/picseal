# 横幅优化参照与设计方案记录（Banner Redesign Notes）

> 日期：2026-10-03 · 前置文档：[banner-layout-audit.md](banner-layout-audit.md)（picseal 现状 15 项问题清单）
> 性质：**仅记录，不改代码**。供新开任务设计完整横幅优化方案时参阅。
> 参照基准（用户指定）：**semi-utils 官方样例** `~/Projects/github/semi-utils/static/*.jpeg`（7 张，逐张人工视觉解读完毕）。
> 结论先行：semi-utils 官方样例的**比例系统与排版骨架优秀，值得继承；但它的算法没有任何宽度自适应与可读性保障，
> 且存在品牌正确性 bug。超越路径 = 继承其设计语言 + 补上它没有的自适应/兜底/正确性三层能力。**

---

## 1. semi-utils 官方样例逐张解读（设计基准）

所有样例基于同一张横幅风景照（4:3，EXIF：NIKON Z 72 / NIKKOR Z 50mm f/1.8 S / 50mm f/1.8 1/1600s ISO64 / 2026-01-10 15:56）。

### 1.1 standard1（对标 picseal 经典横幅/标准横幅）

结构（自上而下）：照片 → 白底横幅（≈12% 图高）。

- **左栏**：上行 `NIKON Z 72`（普惠体 Bold，黑），下行 `NIKKOR Z 50mm f/1.8 S`（Light，#242424）。左边距 2% 画布宽。
- **右区**：Nikon 方形黄标（高 = 两行文字块总高）→ 浅灰分隔线（高 1.1×logo）→ 右栏两行
  `50mm f/1.8 1/1600s ISO64`（Bold）/ `2026-01-10 15:56`（Light），**块状左对齐**（两行共享左缘）。
- **对齐规则**：右上行与左上行**底线对齐**、右下行与左下行底线对齐（源码 `filters.py` rt_y = lt_y + lt.height − rt.height）。
- **比例系统**（源码常量）：横幅高 12% 图高；单行文字高 = 30% 横幅高；行距（middle）= 5% 横幅高；
  通用间距 = 2% 画布宽；分隔线宽 = 0.3% 画布宽。
- **观感**：层级（Bold/Light + 黑/深灰）清晰；logo 大小恰好与文字块等高，形成"文字—符号—文字"的三段节奏；
  宽画幅下空间富余，平衡优雅。这是横幅设计语言的核心参照。

### 1.2 standard2（对标装裱卡片）

standard1 的文字横幅原样保留，照片加：更宽的白边、圆角、投影，成"装裱卡片"。横幅文字在照片下方的白边内。
亮点：装裱与信息条是同一套白色基底，整体像一张冲印照片的卡纸；投影克制。

### 1.3 blur（对标雾面卡片）

照片等比放大铺满画布后高斯模糊作为背景，清晰照片以**大圆角卡片**浮在中上部（约占画布 80% 宽），
下方两行**全画布居中**：机型行（Bold 白，字高 ≈ 参数行 1.4 倍）/ 参数行（Light 白）。无 logo、无容器。
亮点：模糊背景取自照片本身，任何照片色调都自动协调；两行居中的信息架构简单稳定。
局限：文字直接压在模糊层上，亮背景/彩色斑直接决定可读性；无任何保护。

### 1.4 nikon_blur（对标 Z 字红标）

同 blur，机型名中 **"Z" 字符红色高亮**（官方样例中 Z 是字体字符变色，与白字同字体同基线，效果自然）。
**局限**：高亮逻辑是"机型名包含 Z 即染红"，无品牌/卡口判断——喂给非 Z 机型会错误追加/高亮（我方压测已证实）。

### 1.5 normal1（对标角标参数）

照片右下角一行白色 Bold 参数 `50 mm f/1.8 1/1600s ISO64`，墨迹高 3% 图高，右边距 5% 图宽。无投影（暗背景成立）。
亮点：极简、可复用（任何模板都可叠加）。局限：亮背景下白字不可读，无自适应。

### 1.6 normal2（对标图注）

右下角橙色 (232,141,52) 一行：`{文件夹名}  {拍摄时间}`（Light，3% 图高）。语义是"这卷胶片 scan 自哪个目录"。
局限：固定橙色在暖色照片上消失（官方样例中橙色与背景亮度接近，可读性一般）；依赖"文件夹"概念。

### 1.7 center_logo（对标居中标识）

照片 + 底部白边，白边中央放品牌 logo（FUJIFILM 黑色字标，高 = 2% 图高的容器高度），无文字。
亮点：作为"纯品牌签"极简到位。局限：没有可读信息层，logo 直接压在白边上缺乏呼吸感设计。

### 1.8 设计语言提炼（semi-utils 做对的）

1. **一套贯穿的比例系统**：横幅高 12% → 行高 30% → 行距 5% → 间距 2%，全部相对化，任何分辨率下观感一致。
2. **三段式横幅节奏**：`文字块 | 符号 | 文字块`，logo 高度与文字块等高（不是更大/更小），分隔线只是"缝"不是"墙"。
3. **字重层级即信息层级**：Bold=机型/参数（主），Light=镜头/时间（辅），配合黑/#242424 两级灰。
4. **底线对齐**：左右栏每行底线对齐，比"行盒顶对齐"更符合排版直觉（大字号行与小字号行的视觉基线一致）。
5. **背景同源**（blur 族）：模糊背景取自照片，零配置获得色彩协调。
6. **一图一档的语言**：每套模板有明确的使用场景人格（社交分享/尼康粉/极简/图注/品牌签），不贪多。

---

## 2. semi-utils 算法 ↔ picseal 移植差异清单（超越的算法基础）

对照 `semi-utils/processor/filters.py` WatermarkFilter 与 `picseal/src/core/render/banner.ts` computeBannerLayout：

| # | 项 | semi-utils（源头） | picseal（移植现状） | 判定 |
|---|---|---|---|---|
| A1 | 左置 logo 几何 | 边长 = bottom_margin 的正方形，**顶对齐 footer**（y = footer_start_y） | 高 0.9×bannerH，y 在 footerY 上再次居中（双重偏移）→ 底部溢出被裁 | picseal 移植引入 bug（审计 BAN-003） |
| A2 | 右置 logo 高度 | **elem_height（两行块总高）**，顶对齐文本块 | slotH（单行高）垂直居中；`banner.logo.heightRatio` 配置未消费 | 两家不同；semi-utils 的 logo 存在感更强，官方样例的三段节奏依赖它 |
| A3 | 右栏对齐 | x 各自右对齐（far）；`right_alignment=left` 时取 min 成块（near）；y 每行与左栏**底线对齐** | near/far 等价实现；行盒**顶对齐**（近似基线） | 等价，但 picseal 的 INK_FILTER 行盒使顶对齐≠底线对齐，长/短行混排时有视觉基线漂移 |
| A4 | 超宽处理 | **完全没有**（直接溢出/叠压） | 收缩 lineH（下限 0.5×）+ available/textNeeded 预算 | picseal 领先，但下限触发后仍叠压、且左栏↔logo 间隙可为 0（BAN-001/002） |
| A5 | 文本渲染 | 生成 RGBA 文本图块 → paste | canvas 直接绘制 + INK_FILTER=1.45 墨迹补偿 | picseal 更精细（-、°′″ 等低矮字符不撑行盒），保留 |
| A6 | 横幅宽度 | 画布含 left/right_margin，横幅可宽于照片 | 横幅 = 照片宽度 | picseal 收窄；画幅补边时 semi-utils 横幅延展全宽的做法值得评估（审计 BAN-009） |
| A7 | 品牌 logo 匹配 | `logo文件名 stem ∈ Make小写`；**leica_logo.png 匹配不上 LEICA → None → 崩溃** | 数据驱动 BRANDS 表 | picseal 正确；semi-utils 的 leica 缺陷是反向教训 |
| A8 | Z 高亮 | 机型名含 "Z" 即高亮，无品牌判断 | 同样无品牌判断（nikon-z 模板对非 Z 机型整体回退 blur） | 两家都不完整；超越点见 R-04 |
| A9 | 字段缺失 | 显示 '-'（jinja default） | 显示 '-' | 一致；但两家都没有"隐藏/居中"策略（审计 BAN-012/006） |
| A10 | 参数串 | jinja 模板拼接，空格为字面量 | formatParams 代码拼接 | picseal 更稳；官方样例参数间距正常 |
| A11 | 字体路径解析 | `load_font` 把模板的 `fonts/X.otf` 拼成 `config/fonts/fonts/X.otf`（不存在）→ **静默回退 PIL 内置位图字体（~11px）再放大 6 倍** → 显式指定 font_path 的行（机型/参数，Bold）严重虚化；镜头/时间行恰好没有 font_path，走 fallback 链命中真实字体才清晰 | picseal 走 FontFace/Canvas 按最终字号绘制 | **semi-utils 当前代码+模板组合下的真 bug**（官方样例应是旧版模板生成）。教训：字体解析失败必须显式报错，绝不能静默降级 |
| A12 | 文字渲染方式 | 512px 渲染 → trim → LANCZOS 缩到槽位高（Bold ×1.13），大比例缩放产生灰晕；Bold 行再加 1.13 放大系数加剧虚化 | canvas 按最终字号直接绘制 | picseal 天然正确；semi-utils 正确做法是按目标字号原生渲染（生成器已改，见 F6） |
| A13 | 红 Z 字体 | 模板指定 `SpecialAlphabets P04 Regular.otf`，**该字体文件不在 config/fonts 中** → 回退位图字体 → 红 Z 残缺斑驳 | picseal 用同一字体染色（drawInkSegments） | picseal 正确；引用字体必须随包分发并校验存在 |
| A14 | 大横幅高度下的上限约束 | 无：横幅高度调大时 logo/字号线性放大，16% 档实测 logo 遮挡机型名、左右栏文字叠印、长镜头越界裁切（R4 变体 FAIL 实证） | picseal 有收缩（但有 0.5 下限叠压与零间隙问题） | 两家都需要"总量约束 + 上限"设计（R-01） |

### 2.5 参照图批量生成与验收（v2，最终版）

生成驱动 `semi-utils/_audit/run_audit.py`（`uv run python _audit/run_audit.py` 复现），包含 7 项配置级修正：

| # | 修正 | 动机（缺陷实证） |
|---|---|---|
| F1 | 横幅高度按照片自适应：复用官方 rich_text 管线实测槽位宽度，反解最大可容纳高度（12% → 4.5% 搜索），横幅照片保持官方 12% | 官方固定 12% 在竖幅上需 2297px 宽 vs 实际 1500px，必然溢出（数值实证） |
| F2 | 品牌 logo 等比缩放 + 宽度钳制 0.28 画布宽 + 垂直居中 | 官方把 logo 强制 resize 成正方形，SONY/FUJIFILM/Canon 宽字标拉伸变形 |
| F3 | 红 Z 仅在机型名含 Z 时渲染，其余机型纯白机型名 | 官方模板 partition('Z') 对无 Z 机型无条件追加红 Z（信息造假） |
| F4 | center_logo 高度显式传入（≈3.8% 图高，对齐官方样例比例） | 模板键 `center_height` 与代码读取的 `center_logo_height` 不匹配，logo 回退为整条横幅 |
| F5 | 徕卡 logo 品牌前缀二次匹配 | `leica_logo.png` 的 stem 不满足官方 `stem in brand` 匹配 → None → 崩溃 |
| F6 | 文字按目标图块高**原生字号渲染**（探针定字号，一次成形无缩放）；字体路径修正（根目录 / fonts_dir+basename 双候选） | A11 位图字体放大虚化 + A12 缩放灰晕——用户实测反馈"机型和参数模糊、时间镜头正确"的直接根因 |
| F7 | 红 Z 用 PuHuiTi Bold 染色渲染 | A13 SpecialAlphabets 字体缺失导致红 Z 残缺 |

**验收结论**（4 路视觉逐张验收，标准 = 官方样例效果）：

- standard1 / standard2：**26/26 PASS**——四行文字锐利、无重叠裁切、logo 等高无变形、竖幅照片（自适应 10.75% 横幅）观感与横幅照片一致。
- blur / nikon_blur：**26/26 PASS**（红 Z 修复后复验通过）——两行居中、参数空格正常、红 Z 完整实心且仅出现在 Z 机型。
- normal1 / normal2：**26/26 PASS**——右下角位置、边距、文字锐利；浅色背景上白/橙字对比度偏弱为样式固有（官方样例同样如此）。
- center_logo：**13/13 PASS**——全品牌 logo 存在、居中、比例对齐官方样例。
- R 变体 12 组（参数行为演示）：R1 左 logo 中性偏不推荐（方标贴边贴满）；R2 右栏分散对齐**观感更优（建议 picseal 采纳为默认 far 对齐的候选）**；R3 5% 矮横幅拥挤失去呼吸感；**R4 16% 固定横幅 2 张 FAIL（logo 遮挡机型名、左右栏叠印、长镜头越界）——这是"无总量上限约束"的直接实证，是 R-01 的核心论据**。

遗留备注：sony-ilce-7rm4-01.jpg 的 EXIF 机型实为 ILCE-7RM2（素材数据问题，非渲染缺陷）；部分样张无镜头 EXIF → 镜头行显示 "-"（semi-utils 预期行为）。

---

## 3. 优化方案记录（目标：继承设计语言 × 超越 semi-utils）

以下每条 = 动机（对官方样例/压测的证据）+ 设计原则 + 算法要点 + 验收标准。供新任务直接拆解。

### R-01 宽度自适应分配引擎（对应审计 BAN-001/002，最高优先）

- **动机**：官方样例的三段节奏在宽画幅上成立，但 semi-utils 算法无任何宽度处理；picseal 的收缩公式存在
  零间隙边界与 0.5 下限叠压。压测图中"logo 压字、左右栏叠印"全部源于此。
- **原则**：排版引擎应保证**任何输入下不重叠**，退化路径可预期、可配置。
- **算法要点**（建议在 `computeBannerLayout` 重构为显式宽度分配）：
  1. 固定项先行：logo 宽、分隔线宽、安全边距（common_spacing × N 处）从总宽中扣除，得到左右栏文本预算。
  2. 左右栏按 `max(上行, 下行)` 各自申请宽度；总和 ≤ 预算 → 按 near/far 落位，**剩余空间按比例分配为间隙**
     （左栏↔logo 间隙 ≥ 0.5×common，永不贴零）。
  3. 超预算 → 逐级退化：a) 两栏按剩余比例收缩字号（下限提高到 0.7×）；b) 仍超 → 下行（辅助信息）截断加 `…`；
     c) 仍超 → 主行截断。截断必须保住分隔线两侧最小间隙。
  4. 竖幅窄幅特例：可用宽度 < 阈值（如 25% 画布宽）时切换"紧凑模式"——logo 缩至单行高或隐藏、分隔线隐藏、
     必要时双栏变单栏（上行为主、下行并入或隐藏）。
- **验收**：13 张测试样张 × 全参数矩阵下，自动检测无任何字符级重叠（可用像素投影/元素盒相交断言），并截图人工复核。
- **实证**：R4 变体（固定 16% 高横幅、无上限约束）实测 logo 遮挡机型名、左右栏叠印、长镜头越界（见 2.5 节验收）——
  "调大参数即崩坏"是 semi-utils 与 picseal 共同的隐患，总量约束与上限是横幅引擎的必备能力。

### R-02 比例系统升级为"可调的排印比例尺"

- **动机**：官方比例（12%/30%/5%/2%）在 10–16% 横幅高度档位上表现良好，但 picseal 的 scale 滑块与横幅高度耦合
  导致"增大无效"（审计 BAN-004），且 logo 高度行为不一致（A2）。
- **原则**：字号、行距、logo、间距应从**同一个基准字号**派生（模数化），缩放只动模数，不动各元素间的比例关系。
- **算法要点**：
  1. 定义模数 `M = bannerH × k`（k 为每模板的类型系数，如 0.24–0.30）；上行 = M，下行 = M × 0.72，
     middle = M × 0.35，logo = 2 行高 + middle（即官方的 elem_height 节奏），间距 = M × 0.5（下限 12px@2000px）。
  2. `typography.scale` 只缩放 M 并允许横幅高度随内容变化（或反向：横幅高固定、字号由 scale 独立驱动，二选一，
     推荐"字号驱动、横幅高度自适应内容"以修复 BAN-004）。
  3. 主行/副行字重默认 600/400（审计 BAN-010 的粗大问题），Archivo 下 600 的铭牌感更精致；
     模板内保留"strong/normal"语义，不再硬编码 700。
- **验收**：scale 0.6/1.0/1.4 三档渲染宽度呈线性比例（±5%）；默认档与官方 standard1 并排对比不落下风。

### R-03 底线对齐 + 行盒语义修正

- **动机**：官方样例左右栏底线对齐是观感端正的关键之一（A3）；picseal 的 INK_FILTER 行盒顶对齐在混排时基线漂移。
- **算法要点**：绘制时记录每行 `ascent`，左右栏按 `lineBottom` 对齐（drawInkText 已返回 ascent，改用底部锚点）。
- **验收**：左 Bold 上行与右 Bold 上行基线像素差 ≤ 1px（混排 `-`、`°′″` 时同样成立）。

### R-04 品牌正确性层（反向借鉴 A7/A8）

- **动机**：semi-utils 的 leica logo 匹配崩溃与"逢机型就贴红 Z"是信息正确性硬伤；水印是"出处声明"，正确性 > 花活。
- **要点**：1) Z/红标高亮仅在 `brandId=nikon && modelPretty 含 Z` 时生效；2) 机型名美化统一走 BRANDS 的
  modelTransforms（Canon EOS R6m2 → EOS R6 Mark II、ILCE-7RM5 → α7R V 这类规范化 picseal 已有基础）；
  3) logo 匹配失败时降级为文字品牌名（$brand），绝不渲染占位块。
- **验收**：13 张样张 × 全模板：品牌名、机型名、logo 三者与 EXIF 一致。

### R-05 可读性保障层（对应审计 BAN-007；semi-utils 完全没有）

- **要点**：1) 叠印在照片上的文字（corner/caption/center 族）默认开细描边（1.5% 字高的深色描边或投影）；
  2) 渲染前对文字覆盖区做亮度采样，对比度 < 4.5:1 时自动切换文字颜色（白↔黑）或加深 scrim；
  3) caption 的固定橙色改为"主题色 + 自动可读修正"。
- **验收**：blur/nikon_blur/caption 在亮背景样张（sony-7rm4 亮灰、x-pro3 亮金）上对比度达标。

### R-06 空字段与单行的优雅降级（对应审计 BAN-005/006/012）

- **要点**：1) 任一栏为空 → 分隔线隐藏、logo 回退到该侧安全边距处；2) 仅剩单行 → 在两行块内垂直居中；
  3) 提供"缺失字段：'-' / 隐藏"全局开关，默认隐藏（更干净，也更符合"不展示假数据"的产品语义）。
- **验收**：无 GPS 的 8 张样张不再出现孤立 "-"；单行配置垂直居中。

### R-07 参数串的 micro-typography（细节超越点）

- **动机**：官方样例参数行 `50mm f/1.8 1/1600s ISO64` 的可读性很大程度来自词距与字重节奏；semi-utils/picseal
  都用等宽空格硬拼。
- **要点**：1) 数值与单位之间用薄空格（U+2009 或手动 0.25em）；2) 焦距/快门/ISO 用 tabular figures（数字等宽）；
  3) 光圈 `f/1.8` 的斜杠两侧不加大空格；4) Bebas Neue 等 capsOnly 字体对 `mm/f/s/ISO` 豁免大写（审计 BAN-011）。
- **验收**：参数行在任意字体下无粘连、无单位大写化。

### R-08 画幅与横幅的一体化（对应审计 BAN-009）

- **要点**：1) 画幅补边时提供"横幅延展全宽"选项（semi-utils 行为，补边与横幅同色时浑然一体）；
  2) 内边距取 `max(2% 画布宽, 24px@2000px)`；3) 补边色与 mountColor/banner 联动（同时修复审计 BAN-008
  "底色控件对横幅无效"）。
- **验收**：2.35:1 与 16:9 下横幅不再孤立于中部窄条；深色底色配置在横幅上可见。

### R-09 雾面卡片族的补强（对标官方 blur 的强项）

- **要点**：1) 保留"同源模糊背景 + 圆角卡片"（官方最值得继承的资产）；2) 文字列加 R-05 的对比度自适应；
  3) 红色 Z 用字体染色（picseal 的 drawInkSegments 已是字符级，优于 semi-utils 的位图观感——保持并只做品牌判断）；
  4) 文字列垂直节奏按 R-02 模数化，修复"重心偏上"。

### R-10 模板人格收敛（产品层建议）

- 官方 7 套模板各有明确人格；picseal 8 套中"经典横幅/标准横幅"差异过小（仅字段映射与字体不同）。
  建议合并为"横幅（三段节奏）"单模板 + 字段/字体预设，把开发精力集中在 R-01/02 的引擎上；
  保留 normal1/normal2 作为"角标族"，center_logo 作为"品牌签族"。

### R-11 文字渲染保真与字体健壮性（来自 A11/A12/A13 的教训）

- **动机**：semi-utils 当前代码因字体路径双重拼接静默回退位图字体再放大，导致 Bold 行（机型/参数）全部虚化
  （在第一批参照图中实测确认）；512px 渲染 + LANCZOS 强缩引入灰晕；红 Z 因引用字体缺失而残缺。
- **picseal 现状**：canvas 按最终字号直接绘制 + FontFace 加载，天然规避——**保持，不得引入"渲染后缩放"环节**。
- **要点**：1) 字体加载失败必须显式报错或回退到明确声明的替代字体，禁止静默降级到位图/默认字体；
  2) 随包分发的字体在启动时校验存在性与加载成功；3) 水印文字禁止"先大后缩"的重采样路径；
  4) 数字/单位建议 tabular figures（与 R-07 呼应）。
- **验收**：全模板全字号档位下文字边缘无灰晕/重影；字体缺失时有可控的可见回退。

### R-12 素材迁移：品牌 Logo 全量替换 + 尼康 Z 专用字体（用户指定决策）

**决策 1 · Logo 全部改用 semi-utils 的 `config/logos` 素材。（已执行完毕：`public/brands/` 扁平化、仅 png）**

最终状态（M0 落地，2026-10-03）：

- **semi-utils 17 素材全部以代码兼容命名落位根目录**：nikon/canon/fujifilm/sony/leica（←leica_logo）/hasselblad/pentax/ricoh/olympus（←olympus_blue_gold）/panasonic/panasonic2/apple/default/dji（←DJI.jpg 转 png）/xmage/olympus-dark（←olympus_white_gold，供 logoOnDark）/sony-dark（←sony_dark）。旧 512px 素材已被高分辨率版覆盖。
- **补充保留**（semi-utils 无对应、BRANDS 表引用中）：insta360.png（用户指定）、huawei.png、honor.png、xiaomi.png。注：哈苏 semi-utils 侧本就有 hasselblad.png。
- **保留 default-hd.png**（原 512×512）：default.png 为 semi-utils 80×80 占位，未知品牌回退时若用 80px 放大必虚；M3 将 DEFAULT_LOGO 指向 default-hd.png。
- **已删除**：全部 14 个 `.svg`（代码零引用）、`semi-utils/` 暂存目录。旧素材可从 git 历史回滚。
- **历史疑点（修复任务核对）**：原 honor.png 与 semi-utils xmage.png 字节一致（283512B），疑为历史误配——BRANDS 中 honor 条目的素材需要在接入 xmage 时一并核对。
- 渲染约束：素材尺寸跨度大（80–6667px），横幅引擎必须按高度等比缩放 + 宽度钳制（F2 教训已内置，M1 引擎实现）。

**决策 2 · 尼康 Z 系列机型使用 Z 专用字体 `SpecialAlphabets P04 Regular`。**

- 判定条件：`brandId === 'nikon'` 且机型名含 Z 系列（Z 8 / Z 6II / Z fc 等）；**无 Z 机型不得使用**（semi-utils 的无条件追加是反面教材，见 F3）。
- 渲染语义：机型名中的 Z 字符改用该字体渲染并染品牌红（`typography.markColor`），替代 picseal 现行的"同字体染红"——P04 的 Z 为**双线斜切造型，与尼康官方 Z 标一致**（已渲染验证）。
- 资源：已下载并装入 `public/fonts/wm/special-alphabets-p04.otf`（OpenType，6.8KB，family "SpecialAlphabets P04"）。
  来源：[WFonts specialalphabets 包](https://www.wfonts.com/font/specialalphabets)（直链 `static.wfonts.com/download/data/2016/07/12/specialalphabets/SpecialAlphabetsP04.otf`；整包含 P01–P10，按需扩充）。
- 落地要点：注册到字体注册表（符号字体，不参与正文排版，需在 `markSegments` 渲染链路里按字符切换字体）；**商用许可需在启用前核查**（Special Alphabets 为免费符号字体族，license 条款待确认并随包归档）。
- 关联：审计文档 2.5 节 F3/F7（semi-utils 红 Z 的两个缺陷——无条件追加、字体文件缺失导致残缺——picseal 分别以判定条件与字体落库规避）。

---

## 4. 建议的方案设计顺序（给后续任务）

1. **引擎**：R-01 + R-02 + R-03（同在 computeBannerLayout/drawInkText，一起重写 + 补单测：宽度分配、间隙断言、
   截断省略、底线对齐、scale 线性度）。
2. **素材**：R-12（Logo 切换 semi-utils 素材 + 尼康 Z 专用字体接入——素材已就位，独立 PR）。
3. **正确性**：R-04（小改动，独立 PR）。
4. **观感**：R-05 → R-06 → R-07 → R-11（互相独立，可并行）。
5. **画幅与产品**：R-08 → R-09 → R-10。
6. 全程用本仓库 `docs/screenshots/banner-audit/` 的 A/B 系列截图（现状）与
   `semi-utils-ref/`（官方效果参照）做前后对比验收；最终以官方样例 7 张做并排审美评审。

## 5. 实施记录（2026-10-03，M0–M6 全部落地）

方案获批后已实施完毕，验收全部通过。改动摘要：

**M0 素材**：`public/brands/` 扁平化仅 png——semi-utils 17 素材全量落位（含 panasonic2、olympus-dark、xmage、DJI→dji.png、leica_logo→leica.png）、补充保留 insta360/huawei/honor/xiaomi、保留 default-hd.png、删除全部 svg 与暂存目录。

**M1 引擎**（`src/core/render/banner.ts` 重写）：常量命名化（BANNER_METRICS）；computeBannerLayout v2 显式宽度分配（固定项预算 → 三级退化缩字 0.7×/辅行截断/主行截断 → 最小间隙 → 降级布局：右栏空隐藏分隔线/单行垂直居中/紧凑模式）；logo 几何修正（消费 logo.heightRatio、左 logo 相对 strip 居中、文字起点右移 pad）；`computeBannerHeight` 横幅高度单一来源（geometry 两处 + bannerStripRect 共用）；`drawInkText` 增 baseline 锚定 + InkStyle.fontPx 统一字号；绘制基线按真实字体度量校正（墨迹居中自适配字体）。

**M2 减重**：slotRatio 0.30→0.28、INK_FILTER 1.45→1.38、Archivo mainWeight 700→600（puhuiti 保持 700 = 官方 Bold 观感）。

**M3 品牌/Z 标**：olympus logoOnDark、xmage 条目、DEFAULT_LOGO→default-hd.png；`nikon-z-symbol` 符号字体注册（SpecialAlphabets P04，双线斜切 Z，已渲染验证）；markSegments/drawInkSegments 支持 per-segment family；renderPhoto 门控 `brandId==='nikon' && /\bZ/i.test(model)` 才启用 markColor（无 Z 机型绝不渲染红 Z）；许可状态归档 `public/fonts/licenses/README.md`（待核查项已标注 + 回退路径保留）。

**M4 字段/可读性/UI**：`fieldPolicy: 'dash'|'hide'`（optional，旧预设兼容）；sampleLuminance + ensureContrastColor 接入 corner/centerStack/centerLogo；UI 三控件（缺失字段策略、右栏对齐 near/far、横幅底色）+ 高度滑杆标签修正 + 装裱底色仅 mount!=='none' 显示；i18n zh/en 对称新增。

**M5**：`banner.fullWidth`（optional）横幅随补边延展全宽；雾面卡文字列验证本就结构居中（computeFrostedLayout 列居中设计），未改。

**模板合并**：8→7，`banner`（$model/$lens | $param/$datetime，puhuiti，near）替代 mi-classic + banner-pro；DEFAULT_TEMPLATE_ID='banner'；i18n 同步；旧预设按完整对象继续可渲染（schema 兼容）。

**测试与验收**：`pnpm test` 79/79 ✅、`pnpm typecheck` ✅（banner.test.ts 重写扩充至 17 用例：无叠压矩阵/最小间隙/三级退化与省略号/左 logo 几何/空右栏/单行居中/logo 钳制/heightRatio 消费/computeBannerHeight 线性；canvas-utils 新增 baseline/caps/segments family/contrast 用例；brands roundtrip 守门新字段）。浏览器矩阵 P01–P12（`docs/screenshots/banner-audit/post-fix/`）逐项销号：P01 竖幅无叠压（对照旧 A01 压字）、P02 标识 L 完整、P05 单行墨迹中心量化 0.500、P07 红 Z 双线字形 + P08 非尼康无标、P09 隐藏缺失无孤立 '-'、P10 长镜头名省略号兜底（对照旧 B21 叠印）。审计 15 项销项表见 banner-layout-audit.md 顶部。

**遗留（后续任务）**：BAN-009 全宽横幅 UI 入口与最小边距精调；SpecialAlphabets 商用许可核查；honor/xmage 素材同字节疑点；截断省略号的信息分级策略可再细化（当前辅行先截、主行兜底）。

### 5.1 第二轮细节精修（2026-10-03，用户验收反馈闭环）

大问题修复后的细节差距（对照 semi-utils 与用户截图）全部修复：

1. **品牌名保留**：删除 modelTransforms 中的品牌剥离规则（NIKON/Canon/Leica/PENTAX），机型名恢复 semi-utils 语义（CameraModelName 原样展示）——"Z 8" → "NIKON Z 8"、"EOS R5" → "Canon EOS R5"、"M10" → "LEICA M10"。品牌是出处的一部分，不剥离；α/LUMIX 美化保留。
2. **代际数字罗马化**（官方命名均用罗马数字）：Nikon `Z 6_2 → Z 6II`、`Z 50_2 → Z 50II`；Canon `R6m2 → R6 Mark II`；Sony `ILCE-7RM5 → α7R V`、`ILCE-7M4 → α7 IV`（EXIF 的 M 是代数标记：删除后罗马化，α7M 系官方名不带 M）。D850/Z fc/α6400 不受影响。
3. **尼康 Z 专用字形全模板覆盖**：横幅（含装裱卡）机型行接入 markSegments（BannerSpec.mark）；门控从"markColor 存在才启用"改为"`brandId==='nikon' && 机型含 Z` 即启用"——横幅白底 Z 用正文色特殊字形（尼康官方风），nikon-z 模板保持红色；card-blur 无红也用特殊字形。
4. **同行等高对齐**：drawInkSegments 对异字体段按主字体大写字高归一字号（符号 Z 字形度量与正文不同导致偏大偏低——用户截图问题），基线锚定保证同行基线严格一致。
5. **预览画质**：maxLongEdge 2200→2560、预览 JPEG 质量 0.82→0.9（导出仍原图尺寸）。

测试 103/103 ✅（新增品牌保留/罗马化/等高用例）；浏览器验收 `post-fix/P13–P15`：P13 横幅 "NIKON Z 8" 黑色特殊 Z、P14 雾面卡红 Z 与 NIKON/8 等高、P15 "Canon EOS R6 Mark II"。

### 5.2 第三轮：InkBlock 墨迹渲染内核（2026-10-03，用户追问"如何真正达到 semi-utils 效果"）

**深入分析结论**（回答"semi-utils 是不是全 Pillow / 前端是否天生缺陷"）：
- semi-utils 是 **100% Pillow + NumPy**：`RichTextGenerator` 用 512px 超采样渲染文字 → NumPy `TrimFilter` 扫描**墨迹包围盒**精确裁切 → LANCZOS 缩放到目标墨迹高（Bold ×1.13）。WatermarkFilter 排版的全部对象是**裁到墨迹边界的位图**（行高=墨迹高、跨栏墨迹底对齐、logo 边长=文字块高），没有字体度量/行盒/基线换算。
- 前端 Canvas **不是天生缺陷**：差距在于我们此前用"字体行盒度量 + 直接最终字号绘制"近似，而 semi-utils 是"墨迹盒 + 超采样位图"。Canvas 完全可以同构复刻。

**实施（横幅路径切换为墨迹盒语义）**：
1. `canvas-utils.getInkBlock`：4× 超采样绘制 → getImageData 扫描墨迹 bbox 裁切 → LRU 缓存（256）；退化保护（'-' 等低矮字符按大写字高为基准，避免巨杠）；异字体段（尼康 Z 符号）按大写字高归一。
2. `computeBannerLayout` v3：slotRatio 回归官方 **0.30**；**Bold 墨迹 = Light × 1.13**（官方 rich_text is_bold 语义，主行视觉大于副行的关键）；跨栏按**墨迹底线**对齐；宽度分配引擎复用（测量源换成墨迹位图宽）。
3. **solveBannerHeight（F1 正式移植）**：渲染期按墨迹位图实测宽度反解横幅高度（官方比例向下搜索、下限 4.5%），判定**直接复用 computeBannerLayout 本身**（单一口径——曾因 solve 简化预算与落位口径漂移导致截断，已结构性消除）；logo 宽高比参与预算。
4. **文字 ∝ 横幅**：slotH = 横幅高 × 30%（scale≥1 时横幅随内容增长→文字等比增大；solve 收窄竖幅横幅→文字等比缩小，与参照行为一致）；scale<1 作为墨迹乘数（横幅不变、文字缩小）。slotHOverride 临时方案已移除。
5. `banner.logo.heightRatio` 默认 0.82→**1.0**（官方：logo 贴满文字块高）。

**验证**：测试 103/103 ✅（banner.test 改造为墨迹语义：Bold 1.13 比、墨迹底跨栏对齐、logo=elemH、slotH=0.30、截断/钳制/单行/空栏全保留）。浏览器验收 `post-fix/P16/P18`：P16 竖幅 Z8 **无截断**（此前 ISO…/5.… 被截）、完整四行 + 特殊 Z + 满高 logo；P18 长镜头名横幅 **α7R V + 完整 "FE 70-200mm F2.8 GM OSS II + 1.4X Teleconverter"**、SONY 宽字标等比。与 `semi-utils-ref-bands/R1|R2` 并排观感一致。

### 5.3 第四轮：垂直字体盒修正（用户验收反馈：logo 压扁、行间隙不舒适）

定量对照（R2 参照 vs 实现）发现两处根因，同源于一个语义错误：
- **参照** rich_text **无 trim**（standard1 未设 trim 字段）：height 作用于**整个字体盒**（上伸+下伸），墨迹只占盒内 ~62%，行与行自带呼吸空间（实测行间隙 42px）。
- **我们的 InkBlock 垂直裁到墨迹**：文字放大 ~1.6 倍 → 行间隙仅 8px（"没有足够舒适的间隙"），solve 被迫把横幅压到 0.067 → logo 随 elemH 缩小（0.45×banner）且视觉"压扁"。

**修复**：`buildInkBlock` 只做**水平**裁切（去侧留白），垂直保留完整字体盒（ascent+descent）；退化保护分支移除（字体盒基准天然覆盖 '-' 等低矮字符）。

**修复后实测**（P16）：行墨迹 34/37px、**行间隙 37px**（参照 42，同量级）；logo 126×126 **aspect 1.000**（参照 155×155 / 0.689，我们 0.615，同为满高方形不变形）；P18 索尼宽字标等比、α7R V 罗马化、长镜头名完整。P16/P17/P18 见 `post-fix/`。

### 5.4 雾面卡文字列墨迹化（用户验收反馈：blur/nikon_blur 两行间隙对齐）

blur.json 的文字槽位带 `trim: true`——**墨迹语义**：机型/参数墨迹高各 3% 图高、concat 间距 = 3% 图高（ink:gap = 1:1:1）。`drawCenterStack` 改为 InkBlock 绘制（超采样 + 精确墨迹高），布局比例 0.03/0.03/0.03 即为官方值无需调整；红 Z 符号字形与背景亮度自适应颜色保留。实测（P19/P20）：墨迹与间隙均为 3% 图高，两行间隙舒适度与 `semi-utils-ref-bands/blur` 一致；nikon-z 模板红 Z 完整。

### 5.5 左置 logo 语义分层（用户验收反馈：贴合 vs 舒适）

- **扁平横幅（banner）**：左 logo **贴合横幅上下与左缘**（semi-utils WatermarkFilter 语义：side = 整个 bottom_margin），leftLogoHRatio 0.86 → **1.0**（P21 与 R1 参照一致）。
- **装裱卡片（transparentBg）**：logo **不贴合**，改为靠左垂直居中、尺寸舒适（cardLeftLogoHRatio = 0.62，新增 BANNER_METRICS 常量；按 spec.transparentBg 区分两种比例）。P22 索尼宽标等比、α7R V、长镜头名完整。
- solve 口径修正：oracle 与渲染的 slotH 语义统一（去掉 slotHOverride，slot = bannerH × slotRatio；inkScale = min(1, scale) 双侧传入），消除装裱卡片横幅高度与 logo 尺寸的口径漂移。
- 测试 104/104 ✅（新增装裱卡舒适模式用例）。
- **陈旧缓存修复**：用户反馈"索尼 logo 离左太远/压扁"实为 LogoBook 命中浏览器 HTTP 缓存的**旧版 2852×512 索尼素材**（aspect 5.57 → 宽钳制后视觉扁平 + 位置异常）；`LogoBook.get` 改为 `fetch(url, { cache: 'no-cache' })`（协商缓存），素材更新即时生效。修复后实测（P22）：BM 2048×1366、绘制 205×136（aspect 1.507 真实比例）、x=47 贴左、垂直居中。

### 5.6 居中标识重构（用户验收反馈：对齐 center_logo 参照）

按 `semi-utils-ref-bands/center_logo` 重写该模板：
- **结构**：照片四周细白边（上/左/右 = 2% 照片高）+ 底部宽白带（12% 照片高），**仅一个品牌 logo 居中**于白带——无文字、无遮罩、不叠印照片（旧版是 scrim + logo + 机型文字叠印在照片上，已废弃）。
- **几何**：computeGeometry 新增 center-logo 分支；bannerStripRect 对该布局延展全宽；横幅高度固定 12% 照片高，**不参与文字 solve**（曾因模板继承 defaultBanner 的启用文字槽位被 solve 压缩到 logo 放不下——该模板不渲染文字，solve 不适用）。
- **logo 尺寸**：center.logoRatio = 0.04（4% 照片高 ≈ 白带高的 1/3，对齐参照观感）；居中标识 UI 的 caption 槽位移除。
- 验证：P23 及实时页面，结构/比例与 `center_logo` 参照一致；测试 104/104 ✅。

### 5.7 清晰度与图注（用户验收反馈：全模板文字发糊有锯齿、图注样式对齐 normal2）

1. **预览管线改无损 PNG**：预览 blob 此前为 JPEG q0.9（4:2:0 色度抽样）——文字边缘发糊+锯齿感的元凶（semi-utils 参照为 quality 95 + 无色度抽样）。`render.worker` 预览改 `image/png` 无损输出（本地 blob，尺寸可接受）；导出仍按用户所选格式/质量。
2. **图注按 normal2 语义重做**：右下角**单行橙色**（232,141,52）、Light 字重、无投影——“机型 + 间隔 + 时间”一行式。为此 `resolveField` 新增**复合令牌**支持（`"$model    $datetime"` 逐令牌解析、字面间隔保留，单令牌行为不变）；`CornerStyle.allSub`（全行副字重）贯通 types/schema/drawCorner。caption 模板：position bottom-right、sizeRatio 0.03、textShadow false、allSub true、lines `["$model    $datetime"]`、字体普惠体（官方 normal2 回退链首选 AlibabaPuHuiTi Light）。
3. 验证：P24（实时页面）单行橙色右下、文字锐利；测试 104/104 ✅。
4. **logo 消失修复**（用户验收反馈：pica 内核后所有横幅 logo 不显示）：`drawImageSmoothed` 的 pica 分支在 worker 内对 **ImageBitmap 源**（logo）初始化/缩放失败返回 null 时直接跳过绘制——logo 全部丢失（文字块为 OffscreenCanvas 源不受影响）。修复：pica 仅用于 OffscreenCanvas 源；**ImageBitmap（logo）走渐进半缩**；pica 失败一律回退半缩而非丢弃。实测 logo 恢复 ✓（提交 385ef9d）。

### 5.8 清晰度内核：渐进式半缩降采样（用户验收反馈：仍模糊有锯齿，要求深入对比源码）

**机理结论**（semi-utils 源码 vs 浏览器渲染）：semi 的精致来自 `512px 渲染 → 单次 Pillow LANCZOS`——LANCZOS 是真正的窗口 sinc 重采样，任意缩小比例都做全核加权平均；而浏览器 `drawImage` 在 **>2× 单步缩小**走 mipmap/线性采样路径，不做全核重采样——我们 400px 墨迹块直接落位 66px（7×）、logo 2048→126（16×），细笔画欠采样即"锯齿+发虚"。**Canvas 不是天生缺陷，是我们漏掉了重采样步骤**；Pillow 类前端库（pica/WebGL Lanczos）可作后备，但零依赖的**渐进式半缩**（每次恰 2× 高质量平均，多级叠加）即可达到同量级观感。

**实施**：`canvas-utils.drawImageSmoothed`（源反复半缩至 ≤2× 目标再落位，异常回退单步）；接入横幅行/雾面卡行/各 logo 绘制（logo 16× 缩小同样受益）；导出默认质量 0.92→0.96。预览保持无损 PNG + 2560。

**验证**：与 `R2-standard1-faralign` 同倍率放大并排比对，笔画密度与边缘平滑度同量级（/tmp 对照图）；测试 104+ ✅。若后续仍觉不足，`drawImageSmoothed` 内核可单点替换为 pica Lanczos。

### 5.9 双重采样内核：pica 接入 + 全局配置切换（用户要求实测定默认）

`drawImageSmoothed` 内核化：`ResizeKernel = 'halving' | 'pica'`，全局配置经 preferences store（zustand persist，`localStorage['picseal-prefs']` 信封内 `state.resizeKernel`；主线程 `resize-kernel.ts` 过程式门面实时读取；原 `picseal-resize-kernel` 散装 key 已迁移收编）→ 渲染请求逐次下发（protocol preview/export 可选字段）→ worker `setResizeKernel` + `await ensureResizeKernelReady()`（动态 `import('pica')`，`createCanvas` 用 OffscreenCanvas，worker 安全）。

**pica 异步落位竞态**：pica.resize 为 Promise，直接绘制会与 convertToBlob 竞态丢字——`picaDraws` pending 队列 + `flushPicaDraws()`，worker 转 blob 前 await。

**A/B 实测**（nikon-z8 横幅三联：REF/HALVING/PICA，`post-fix/P25-ab-kernel-compare.jpg`）：两内核在同渲染尺度下**观感一致**——笔画密度、边缘平滑、logo 细节均达参照水准。**默认取 halving**（零依赖、同步确定性、无 WebGL 依赖；pica 为异步路径需 flush 防竞态），pica 经 devtools 写 `localStorage['picseal-prefs']` 信封（`state.resizeKernel='pica'`）随时可选；`drawImageSmoothed` 接口已隔离，内核替换为单点改动。测试 107/107 ✅。：首验发现图注被渲染成黑色——R-05 的亮度自适应在亮背景上把橙(232,141,52)切成了深色。新增 `CornerStyle.contrastFix`（缺省开），图注模板设 `contrastFix: false` 保留品牌橙原样（semi normal2 源码即无条件橙色）；其余模板的自动对比度保障不受影响。实测橙色单行右下 ✓。

### 5.10 逐槽位高级字体覆写（2026-10-05，studio 功能增强）

**需求**：studio「样式」面板新增「高级字体 / ADVANCED TYPE」区块（默认折叠），对当前布局的每个文字槽位独立设置字体（家族）、字号（相对缩放 0.5–2.0）、字重（限所选家族可用字重）、斜体（合成 oblique）、颜色（6 预设色板 + 自定义取色）；一键「还原默认」清除全部覆写。

**数据模型**：`FieldSlot.style?: SlotFontStyle`（`{ font?, scale?, weight?, italic?, color? }` 全可选）——一处 schema 变更同时覆盖横幅四象限、`corner.lines[]`、`center.title/caption` 三类槽位；schema optional 向后兼容（旧预设照常解析），worker 收到完整模板对象故协议零改动。

**渲染语义**（叠加在官方比例系统之上，不破坏既有度量）：
1. **槽位字号乘数**：行墨迹高 = 主/副行基准（slotH 或 /1.13）× 槽位 scale。全局 `typography.scale` 的效果已含在行基准内（slotH 的 inkScale 与横幅增长），槽位 scale 不与之重复相乘，1 = 与模板默认渲染一致。
2. **同带墨迹底线对齐保持**：带高 = 带内启用行最大墨迹高，矮行 `y = bandTop + bandH − rowH`——延续官方左右栏底线对齐语义（5.2 节）。
3. **横幅高度增长**（`computeBannerHeight`）：块高预估计入上/下带最大乘数（`slotRatio×top + slotRatio/1.13×bottom + middleRatio`）；无覆写时与旧公式逐项相等，scale=1 且无覆写严格等于 heightRatio×photoH 的不变量保持（BAN-004 只增不减）。
4. **三级退化管线不动**：收缩/截断逐行按各自墨迹高参与测量与预算分配，`solveBannerHeight` 的 fits 判定与落位同口径（slotStyles 贯通传入）。
5. **斜体**：内置字体均无真斜体字面，`italic` 走 Canvas font shorthand 由光栅器合成 oblique；预览与导出同走 worker canvas，表现一致。`getInkBlock` 缓存键追加 italic 位。
6. **颜色/字重/家族逐行化**：横幅 `drawRow` 按槽位解析样式取墨迹位图；`drawCorner` 底锚累加公式在乘数全 1 时与固定行距逐像素一致；`drawCenterStack` 颜色由调用方合并槽位色并完成对比度解析（R-05 保持，用户色也过 `ensureContrastColor`）。
7. **字体加载**：`renderPhoto` 收集全部活跃槽位涉及家族统一 `ensureFamily`（CJK 判定沿用全局文本）；槽位覆写家族非法（预设手改）时回退全局家族，渲染永不静默失败（A11 教训）。

**UI**（ControlColumn）：`FontSelect` 复用组件（分组下拉 + 「跟随模板」空值项）；`AdvancedFontSection` 按布局暴露槽位组（横幅四象限 / 雾面卡机型+参数 / 角标行 N；center-logo 无文字不显示）；每槽位覆写指示点 + 单槽清除；折叠头带覆写计数，展开动画经全局 prefers-reduced-motion 规则自动降级。**顺带修复**：`SlotSelect` 改内容时重建 slot 对象丢附加字段的 bug（改 spread 保留 `style`）。

**验证**：`pnpm typecheck` ✅、`pnpm test` 210/210 ✅（banner.test 扩至 27 用例：槽位乘数行高/底线对齐/测量传参/收缩截断联动/computeBannerHeight 增长与不变量/solve 不截断；新增 slot-style.test 5 用例、schema.test 7 用例 roundtrip 与非法值拒绝）。

### 5.11 槽位字体加载失败的渲染韧性（2026-10-05，用户反馈"Z字红标/角标参数/图注高级字体不生效"修复）

**排查结论**：三个模板（card+blur 的 drawCenterStack 路径、corner 的 drawCorner 路径）与横幅路径的槽位样式消费链路经浏览器逐模板实测**均正确生效**（字体/字号/字重/斜体/颜色全部可见变化）。真实根因在加载层：`renderPhoto` 中任一 `ensureFamily` 字体拉取失败（dev 服务器重启/编译窗口/网络瞬断——高级字体设置让槽位可引用全新家族，拉取面成倍扩大）会让整个渲染抛错，而 `usePreview` 对 `ok:false`/reject **静默保留旧预览帧**——表现即"设置无法生效"且所有后续调整全部无响应，直至改回已加载字体或刷新页面。

**修复**（A11"禁止静默降级"的工程化落地——降级必须可见而非杀死渲染）：
1. `renderPhoto` 字体加载改为韧性路径：全局家族先行加载（槽位家族的回退目标）；槽位家族失败 → console.warn + 已解析样式的该家族回退为模板全局家族；全局家族失败 → canvas `", sans-serif"` 兜底链呈现。尼康 Z 符号字体失败同理退回正文字体。渲染从此不因字体问题中断。
2. CJK 子集按**家族实际渲染的文本**判定（familyCjk 映射），替代旧的全局"任一文本非拉丁则所有家族都拉 CJK"——消除逐槽位字体带来的多 MB 跨家族超取拖慢首帧。
3. `usePreview` 对渲染失败不再完全静默：console.warn 留诊断线索（保留旧帧的 UI 行为不变——闪烁比冻结更伤体验的取舍）。

**验证**：停掉 dev 服务器（全字体拉取失败的最坏场景）后改槽位字体+颜色，预览仍持续更新（回退字体 + 颜色原样生效，contrastFix:false 模板可见黑色文字）——修复前该场景预览必然冻结；服务器恢复后正常路径逐模板复测无回归。`pnpm typecheck` ✅、210/210 ✅。

### 5.12 尼康 Z 符号字形锁定（2026-10-06，用户指定：字号/颜色可改，字体/字体样式任何情况下不可改）

**决策**：尼康 Z 符号字体（SpecialAlphabets P04 双线斜切 Z，R-12）是品牌锁定元素——高级字体覆写（及任何未来行级样式机制）对它的作用域限定为**字号与颜色**；字体家族、字重、斜体在任何情况下不得生效。

**实现**（三层防线 + 颜色语义收紧）：
1. **拒绝作为行字体**（`resolveSlotStyle` + `renderPhoto`）：槽位 `style.font` 指向 symbol 组家族一律回退全局家族；`typography.font`（全局）被预设手改为符号家族时回退 `DEFAULT_FONT`。UI 字体选择器本就排除 symbol 组，此为预设导入/手改 JSON 的纵深防御。
2. **混排段锁定**（`buildInkBlock`/`drawInkSegments` 的 `segStyleOf`）：异字体段（Z 符号）永远以该字体**自身 mainWeight、非斜体**测量与绘制——行级字重/斜体覆写只作用于正文段。墨迹位图与直绘回退两条路径同口径。
3. **颜色跟随行色**（新增 `ResolvedRowStyle.colorOverridden`）：行色被用户**显式覆写**时，Z 符号随行色（"颜色可以改"）；未覆写时保持模板品牌色语义（nikon-z 模板红 Z / 官方白底正文色 Z）不变。
4. 字号随行：Z 在行墨迹块内按大写字高归一，行 scale 缩放自然带动 Z 等比变化，无需特判。

**验证**：`pnpm typecheck` ✅、214/214 ✅（slot-style 新增符号家族拒绝与 colorOverridden 判据用例；canvas-utils 新增 drawInkSegments 锁定用例——行级 300+斜体覆写下正文段 `italic 300 Roboto`、Z 段恒为 `400 NikonZSymbol`）。无 Z 系机身样片，mark 门控的浏览器端到端以非 Z 机型无标回归替代（单元测试覆盖字形锁定）。


## 6. 环境与产物索引

- 参照基准（审美）：`~/Projects/github/semi-utils/static/*.jpeg`（7 张官方样例，未改动）。
- 批量参照图（已达到官方效果，供逐张对照）：`docs/screenshots/banner-audit/semi-utils-ref{,-bands}/`
  （103 组 = 7 模板 × 13 张主系列 91 组 + R1–R4 参数变体 12 组；每含全图与底部 22% 特写；
  standard1/standard2 目录内 `manifest.json` 记录每张照片的自适应横幅高度）。
  **主系列 91 组经 4 路视觉逐张验收全部 PASS；R4 变体的 FAIL 为"无上限约束"的保留实证。**
- 修复后验收截图：`docs/screenshots/banner-audit/post-fix/`（P01–P12，逐项销号证据）。
- 生成脚本：`~/Projects/github/semi-utils/_audit/run_audit.py`（含 F1–F7 修正说明，可复现）；
  依赖：`uv sync` + `brew install exiftool`。
- 现状审计：[banner-layout-audit.md](banner-layout-audit.md)（15 项问题 + A/B 系列截图 68 组 + 修复销项表）。
- 素材与字体（已落地）：`public/brands/` 仅 png（semi-utils 全量 + 补充 4 + default-hd）；
  `public/fonts/wm/special-alphabets-p04.otf`（尼康 Z 专用字体，已验证 Z 字形，许可待核查）。
- 本文档修订记录：v2 增补 A11–A14、2.5 节生成与验收、R-11、R-01 实证论据；v3 增补 R-12（素材迁移）；
  v4 增补 §5 实施记录（M0–M6 全部落地）。
