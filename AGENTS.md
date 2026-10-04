# AGENTS.md — PICSEAL 开发指引

相机品牌风格照片水印工具，解码 / 合成 / 导出全部在浏览器本地完成，**照片永不上传**——任何改动不得引入把用户照片发往网络的路径。

技术栈：Next.js 15（App Router）+ React 19 + TypeScript strict + Tailwind 4 + Zustand + next-intl。包管理器固定 pnpm（`packageManager` 字段锁定，勿用 npm/yarn）。

## 常用命令

```bash
pnpm dev          # 开发服务器 localhost:3000
pnpm test         # Vitest 全量测试（test:watch 可 watch）
pnpm typecheck    # tsc --noEmit —— 提交前必跑
pnpm build        # 生产构建
pnpm build:wasm   # 重建 EXIF WASM 产物（需本机 wasm-pack，平时不用）
```

注意：`pnpm lint`（next lint）当前不可用——eslint 未安装。验证改动用 `pnpm typecheck` + `pnpm test`。

## 架构边界

- `src/core/` 水印引擎（brands / templates / render / exif / fonts / export / cinema）：**纯 TS、零 DOM、零 React**，测试跑在 node 环境（vitest `environment: 'node'`）。不得反向依赖 app / components / three。测试与源码同目录 `*.test.ts`。
- `src/wasm/exif/` 是 **wasm-pack 预构建产物，直接提交入库**（Rust 源在 `rust/exif-writer/`，是 little_exif 薄封装）。不要手改产物；仅当 rust/ 变更时 `pnpm build:wasm` 重建。应用构建永不依赖 Rust 工具链，`rust/` 已排除出 tsconfig。
- `src/three/` 落地页 3D 档案墙 + 放映室（cinema）。three.js 仅落地页 dynamic import，进工作台即卸载——不要把它提升为全局依赖。
- `src/workers/` OffscreenCanvas 渲染 worker + 线程池；`protocol.ts` 是主线程 ↔ worker 的消息契约，改协议两侧同步改。
- `src/stores/` Zustand + persist 持久化（含 legacy localStorage key 迁移，媒体文件走 IndexedDB）。
- `app/[locale]/` zh / en 双语路由（landing / studio / cinema / about）。`middleware.ts` 是 next-intl 中间件，matcher 已排除 `/api`。
- `messages/zh.json` 与 `messages/en.json` **必须同步更新**（next-intl 文案）。

## 设计与代码规范

- 视觉唯一依据 [DESIGN.md](DESIGN.md)（RhineLab 终端风）：`border-radius: 0`、1px `var(--line)` 规则线、双语微标签（`中文 / ENGLISH`）、状态灯 `.status-dot`；禁用字中点「·」、破折号标签、箭头链接等生成味手法。主题经 CSS 变量 + `data-theme` 切换，夜色默认，650ms token 插值，动效全程尊重 `prefers-reduced-motion`。
- 8 款模板的横幅排版度量逐项移植自 semi-utils 的 `WatermarkFilter`。改横幅 / 模板排版前先读 `docs/banner-redesign-notes.md`（设计方案与参照基准），勿凭感觉重排。
- tsconfig 开启 `noUncheckedIndexedAccess`，索引访问需判空。

## 构建陷阱

- dev 与生产用**不同产物目录**：`next dev` 写 `.next-dev`，生产写 `.next`——避免运行中的 `next start` 因 chunks 被改写而报 Cannot find module。不要合并两者。
- Docker 镜像需 `BUILD_STANDALONE=1 pnpm build`（standalone 输出供 Dockerfile COPY）；本地构建保持默认输出，`next start` 才能直接运行。
- `/samples` `/brands` `/fonts` `/cinema` `/audio` `/assets` 静态资源带 immutable 缓存头；更新这些目录的内容时要换文件名（带版本/哈希），否则用户拿不到新资源。
- 演示媒体可整体走 Cloudflare R2 CDN（`media.zhiweio.me`）：构建期注入 `NEXT_PUBLIC_MEDIA_BASE` 生效，不设置则用 `public/` 本地兜底；媒体 URL 一律经 `src/core/media-url.ts` 的 `mediaUrl()` 解析，勿写死绝对 CDN 地址。媒体变更后跑 `pnpm sync:media --apply` 同步到桶，详见 [docs/media-cdn.md](docs/media-cdn.md)。
- 字体子集由 `scripts/build-fonts.mjs` + `subset_fonts.py` 生成，产物在 `public/fonts/`，许可文本在 `public/fonts/licenses/`。

## 内置样片

样片库由 `scripts/fetch-samples.mjs` 从 Wikimedia Commons 采集（验证 EXIF + 质量门槛 + 署名合规），成品已入库；如需重建：`node scripts/fetch-samples.mjs --min 45`。样片署名见 [CREDITS.md](CREDITS.md)，新增样片须维持署名合规。
