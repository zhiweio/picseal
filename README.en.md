<div align="center">

# PICSEAL

**Photo Archive Terminal · 影像档案终端**

Camera-brand style photo watermarks, generated entirely in your browser.
相机品牌风格照片水印，完全在你的浏览器本地生成。

[![License: MIT](https://img.shields.io/badge/License-MIT-8c9b7b.svg)](LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-Vitest-6e9f18.svg)](#quick-start)
[![Deploy](https://img.shields.io/badge/Deploy-Vercel-000000.svg)](#deployment)

[简体中文](README.md) · **English**

</div>

---

PICSEAL adds camera-brand style info watermarks — body / lens / exposure params / date / brand logo — to your photos, following the official watermark aesthetics of Xiaomi·Leica, Nikon Z, Sony and others. Decoding, composition and export all happen locally in your browser. **Photos never leave your device.**

The pipeline: **Import → Tune → Lock → Batch → Deliver** — preview a single frame, lock the preset once you're happy, then produce the whole roll in one click and deliver as a ZIP. Your best shots can then go to the **Projection Room** — a tuned Nikon Z mode — and become a one-click collection film scored with the "Nikon anthem", ready to upload to Bilibili.

## Preview

**Landing · 3D photo archive wall** — a night-ink gallery filled wall-to-wall with frosted-glass archive cases; scroll to browse, the pointer raises a wave field, hovering lifts a drawer:

![3D photo archive wall](docs/screenshots/landing.png)

Click any frame to pull it out for inspection — the sample is rendered with a real watermark banner, annotated with body / exposure / date, one click into the studio:

![Frame inspection](docs/screenshots/landing-open.png)

**Studio · single-frame tuning** — 7 live templates with automatic EXIF field fill:

![Studio](docs/screenshots/studio.png)

**Projection Room · tuned Nikon Z mode** — a classic *The Secret Life of Walter Mitty* clip opens the film, the "Nikon anthem" scores it, and a Nikon-red END card closes; a floating Eumig projector throws the circular film strip onto a frosted-glass photo-case screen along a real light path. One-click 1920×1080 MP4 export, ready for Bilibili:

![Projection Room](docs/screenshots/cinema.png)

## ✨ Features

- **7 built-in templates**: Banner / Mounted Card / Frosted Card / Z Mark / Corner Data / Caption / Center Mark. Layout metrics ported item-by-item from [semi-utils](https://github.com/leslievan/semi-utils)' `WatermarkFilter`: 12% bottom margin, 30% slot line-box height, 5% line gap, line-box alignment, right column hugs the divider, one shared font size per banner (auto shrink on overflow); pluggable resize kernel — pica (WebGL Lanczos) + unsharp sharpening (default) or progressive halving — keeps small type and brand logos crisp
- **11 watermark font families**: Archivo (default) / Roboto / Alibaba PuHuiTi / MiSans / Bebas Neue / Oswald / Playfair Display / Noto Serif SC / LXGW WenKai / Smiley Sans / Ma Shan Zheng calligraphy, grouped by family with adjustable size
- **Batch pipeline**: drag / paste / folder / **ZIP archive** import → live preview + A/B compare → preset lock (localStorage / JSON import & export) → parallel worker pool → **streamed ZIP download** (compress while producing, File System Access direct write first)
- **Full EXIF preservation**: original capture metadata is written back on export across all output formats (JPEG / PNG / WebP), cross-format supported (HEIC original → JPEG output), Orientation reset on write to prevent double rotation
- **3D projection room · tuned Nikon Z mode**: pick 16–48 photos (pre-selected at even spacing by capture time, manually adjustable) and cut a one-click collection film scored with the "Nikon anthem" (Radical Face — *Welcome Home*) — Nikon red (the same accent as the Z Mark) tints the title / END cards and the REC HUD, every frame keeps its real watermark banner, and a classic *The Secret Life of Walter Mitty* clip opens the film. A floating Eumig projector throws the circular film strip onto a frosted-glass photo-case screen along a real light path; **one-click 1920×1080 MP4 export** (12 Mbps, WebM fallback), straight to Bilibili. The opening clip and soundtrack ship with the repo (demo only, all rights with their owners, see `public/cinema/CREDITS.md`); swap in your own media (stored in IndexedDB only) or fall back to a CC0 track automatically
- **3D photo archive wall** (landing): night-ink / warm dual-theme gallery + full-frame array of frosted-glass archive cases (physical transmission materials) + pointer-following wave & hover lift + tap-to-inspect with a focus-slide transition (the inspected frame is rendered with a real watermark banner) + SSAO / depth-of-field / SMAA post-processing. Interaction and motion deeply ported from [Rhine-Music-Demo](https://github.com/RonaldDeng/Rhine-Music-Demo) (MIT)
- **Beat-synced BGM**: WebAudio spectral-flux onset detection ripples the wall to the beat; ships with a CC0 track ([Komiku — Childhood scene](https://commons.wikimedia.org/wiki/File:Komiku_-_01_-_Childhood_scene.ogg)), and you can load your own audio (stored locally in IndexedDB)
- **Dark & light themes · bilingual (zh/en) · PWA** · RhineLab terminal visual language (square corners / 1px rules / bilingual micro labels / 650ms color interpolation)
- **Local-first**: zero uploads, zero accounts, works offline; sample photos come from Wikimedia Commons under free licenses

## 🚀 Quick Start

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

```bash
pnpm test       # Vitest suite
pnpm typecheck  # tsc --noEmit
pnpm build      # production build
```

> The bundled sample library is collected from Wikimedia Commons by `scripts/fetch-samples.mjs` (per-camera categories, EXIF validation, quality gates, proper attribution). The repo ships 160 finished samples; to rebuild: `node scripts/fetch-samples.mjs`.

## 🐳 Deployment

**Vercel** (zero config): the repo ships [`vercel.json`](vercel.json) (Next.js framework preset, region hkg1); import and go:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/zhiweio/picseal)

**Docker**: GitHub Actions builds a **multi-arch image (amd64 / arm64)** and pushes it to Docker Hub on every published tag (e.g. `1.0.0`) — see [docker-build.yml](.github/workflows/docker-build.yml). Use the prebuilt image directly:

```bash
docker run -d -p 3000:3000 zhiweio/picseal:latest
```

or the bundled [`docker-compose.yml`](docker-compose.yml):

```bash
docker compose up -d
```

To build locally: `docker build -t picseal .`

## 📋 Format Matrix

| Stage | Formats | Implementation |
|---|---|---|
| Input decode | JPEG / PNG / WebP / AVIF | browser native |
| | HEIC / HEIF | Safari native (broader support in progress) |
| Output encode | JPEG / PNG / WebP | Canvas native |
| Film export | 1080p MP4 (WebM fallback) | MediaRecorder (Projection Room "record & download", 12 Mbps) |
| EXIF read | JPEG / HEIF / WebP | [exifr](https://github.com/MikeKovarik/exifr) (batch pick fast path) |
| EXIF write | JPEG / PNG / WebP | [little_exif](https://github.com/TechnikTobi/little_exif) (Rust→WASM) |

## 🏗 Architecture

```
rust/exif-writer/        little_exif thin wrapper (wasm-bindgen, prebuilt artifacts committed)
src/core/                watermark engine (pure TS, zero DOM, covered by Vitest)
  exif/ brands/ render/ templates/ export/ cinema/
src/three/wall/          3D archive wall (motion / camera / materials / atlas / scene)
src/three/cinema/        projection-room 3D stage (projector / light path / film queue)
src/three/audio/         beat engine (spectral-flux onset + bass envelope)
src/workers/             OffscreenCanvas render workers + thread pool
src/stores/              Zustand: photos / settings / queue / preferences (persist)
app/[locale]/            zh / en routes (landing / studio / cinema / about)
scripts/                 sample collection / WASM build
```

See [DESIGN.md](DESIGN.md) for the visual language and design tokens.

## ❓ FAQ

**Are batched photos still there after a refresh?** No — File handles die with the page and batches are not persisted; but your presets (template + output config) persist.

**Why are PNG exports large?** PNG is lossless; for social sharing prefer JPEG 92 or WebP.

**Can I use "Welcome Home, Son" as BGM?** The wall BGM accepts audio you own — use the upload button at the top-right of the landing page; it stays in your browser's IndexedDB. The opening clip (*The Secret Life of Walter Mitty* fan edit) and soundtrack (Radical Face — *Welcome Home*) bundled with the Projection Room are for demo purposes only, and all rights remain with their owners (see `public/cinema/CREDITS.md`); you can also load your own media in the room or disable them entirely.

## 🙏 Acknowledgements

This project stands on the shoulders of these excellent open-source projects — many thanks:

- **[semi-utils](https://github.com/leslievan/semi-utils)** — batch camera watermark tool. Every layout metric in PICSEAL's templates (margin ratios, the banner formula, the anchor system) is ported from its `WatermarkFilter`; brand logo assets and the Roboto font also come from that repo.
- **[Rhine-Music-Demo](https://github.com/RonaldDeng/Rhine-Music-Demo)** (MIT, © LBEILC / RonaldDeng, based on [RhineLabUI](https://github.com/LBEILC/RhineLabUI)) — the design and motion source of the landing page's 3D archive wall: frosted-glass archive cases, deep lanes, long-lens compressed FOV, critically-damped springs, wave-field displacement and the post-processing chain are all ported from its implementation.
- [little_exif](https://github.com/TechnikTobi/little_exif) (MIT/Apache) · [exifr](https://github.com/MikeKovarik/exifr) (MIT) · [fflate](https://github.com/101arrowz/fflate) (MIT) · [pica](https://github.com/nodeca/pica) · [idb-keyval](https://github.com/jakearchibald/idb-keyval) · [three.js](https://github.com/mrdoob/three.js) · [Next.js](https://nextjs.org/) · [Radix UI](https://www.radix-ui.com/) · [Tailwind CSS](https://tailwindcss.com/) · [Zustand](https://github.com/pmndrs/zustand) · [Zod](https://zod.dev/)
- Fonts: Archivo · Bebas Neue · Oswald · Playfair Display · Roboto · Noto Serif SC · LXGW WenKai · Smiley Sans · Ma Shan Zheng (all OFL), Alibaba PuHuiTi, MiSans (free commercial license, see `public/fonts/licenses/`)
- Bundled BGM: Komiku (CC0, see `public/audio/CREDITS.md`); Projection Room demo media: opening clip from *The Secret Life of Walter Mitty* (2013), a fan edit © 20th Century Fox, and the soundtrack *Welcome Home* — Radical Face © Bear Tree Records (sourced from the web for demo only; will be removed upon request, see `public/cinema/CREDITS.md`); sample photos from Wikimedia Commons (attribution in [CREDITS.md](CREDITS.md))

## 📄 License

[MIT](LICENSE) © Wang Zhiwei
