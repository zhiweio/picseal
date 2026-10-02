/**
 * 字体与位图加载 —— worker 与主线程通用（无 DOM 依赖）。
 * woff2 通过 fetch + FontFace 注册到当前全局的 FontFaceSet。
 */

export type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

const LATIN_FONTS: Array<{ weight: number; url: string }> = [
  { weight: 300, url: '/fonts/MiSans-Light-latin.woff2' },
  { weight: 400, url: '/fonts/MiSans-Regular-latin.woff2' },
  { weight: 600, url: '/fonts/MiSans-Demibold-latin.woff2' },
  { weight: 700, url: '/fonts/MiSans-Bold-latin.woff2' }
]

const CJK_FONTS: Array<{ weight: number; url: string }> = [
  { weight: 400, url: '/fonts/wm/MiSans-Regular-cjk.woff2' },
  { weight: 600, url: '/fonts/wm/MiSans-Demibold-cjk.woff2' },
  { weight: 700, url: '/fonts/wm/MiSans-Bold-cjk.woff2' }
]

export const WATERMARK_FONT = 'MiSans'

export class FontBook {
  private loaded = new Set<string>()

  async ensureBase(): Promise<void> {
    await Promise.all(LATIN_FONTS.map((f) => this.load(f.weight, f.url)))
  }

  async ensureCjk(): Promise<void> {
    await Promise.all(CJK_FONTS.map((f) => this.load(f.weight, f.url)))
  }

  private async load(weight: number, url: string): Promise<void> {
    const key = `MiSans:${weight}`
    if (this.loaded.has(key)) return
    const res = await fetch(url)
    if (!res.ok) throw new Error(`font fetch failed: ${url}`)
    const buf = await res.arrayBuffer()
    const face = new FontFace(WATERMARK_FONT, buf, { weight: String(weight) })
    await face.load()
    const fonts = (globalThis as unknown as { fonts: FontFaceSet }).fonts
    fonts.add(face)
    this.loaded.add(key)
  }
}

/** 品牌 logo 位图缓存（PNG 在 worker 中可安全 createImageBitmap） */
export class LogoBook {
  private cache = new Map<string, ImageBitmap>()

  async get(url: string): Promise<ImageBitmap | undefined> {
    const hit = this.cache.get(url)
    if (hit) return hit
    try {
      const res = await fetch(url)
      if (!res.ok) return undefined
      const blob = await res.blob()
      const bmp = await createImageBitmap(blob)
      this.cache.set(url, bmp)
      return bmp
    } catch {
      return undefined
    }
  }
}

/* ───────────────────────── 绘制工具 ───────────────────────── */

export interface TextStyle {
  size: number
  weight: number
  color: string
}

export function applyFont(ctx: Ctx2D, style: TextStyle): void {
  ctx.font = `${style.weight} ${style.size}px ${WATERMARK_FONT}, sans-serif`
}

export function measureText(ctx: Ctx2D, text: string, style: TextStyle): number {
  applyFont(ctx, style)
  return ctx.measureText(text).width
}

export function drawText(
  ctx: Ctx2D,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
  align: 'left' | 'right' | 'center' = 'left',
  baseline: CanvasTextBaseline = 'middle'
): void {
  applyFont(ctx, style)
  ctx.fillStyle = style.color
  ctx.textAlign = align
  ctx.textBaseline = baseline
  ctx.fillText(text, x, y)
}

/** 混排绘制：segments 依次排列，用于尼康 Z 红字等场景 */
export function drawSegments(
  ctx: Ctx2D,
  segments: Array<{ text: string; color: string }>,
  x: number,
  y: number,
  style: TextStyle,
  align: 'left' | 'right' | 'center' = 'left',
  baseline: CanvasTextBaseline = 'middle'
): void {
  const total = segments.reduce((w, s) => w + measureText(ctx, s.text, style), 0)
  let cursor = align === 'left' ? x : align === 'center' ? x - total / 2 : x - total
  applyFont(ctx, style)
  ctx.textAlign = 'left'
  ctx.textBaseline = baseline
  for (const seg of segments) {
    ctx.fillStyle = seg.color
    ctx.fillText(seg.text, cursor, y)
    cursor += ctx.measureText(seg.text).width
  }
}

/** roundRect 兼容封装（老 runtime 无 ctx.roundRect） */
export function roundedRectPath(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.arcTo(x + w, y, x + w, y + radius, radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius)
  ctx.lineTo(x + radius, y + h)
  ctx.arcTo(x, y + h, x, y + h - radius, radius)
  ctx.lineTo(x, y + radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.closePath()
}

/** '2.35:1' → 2.35；非法返回 undefined */
export function parseAspectRatio(spec: string | null | undefined): number | undefined {
  if (!spec) return undefined
  const m = spec.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
  if (!m) return undefined
  const w = Number.parseFloat(m[1]!)
  const h = Number.parseFloat(m[2]!)
  if (!w || !h) return undefined
  return w / h
}
