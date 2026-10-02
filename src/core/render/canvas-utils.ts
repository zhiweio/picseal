/**
 * 字体加载与文本绘制 —— worker 与主线程通用（无 DOM 依赖）。
 *
 * 墨迹文本（ink text）：semi-utils 的 rich_text 先把文字裁切到墨迹包围盒
 * 再缩放到目标高度（光学对齐）；Canvas 等价实现 = 用 TextMetrics 的
 * actualBoundingBox* 测墨迹盒，按目标墨迹高反推 fontPx 后绘制。
 */
import { getFontFamily, type FontFamilyId } from '../fonts/registry'

export type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

const PROBE_PX = 200

export class FontBook {
  private loaded = new Set<string>()

  /** 加载一个家族的拉丁子集（全部推荐字重），需要中文时再加载 CJK 子集 */
  async ensureFamily(familyId: FontFamilyId, needCjk: boolean): Promise<void> {
    const def = getFontFamily(familyId)
    const jobs: Array<Promise<void>> = []
    for (const weight of def.weights) {
      const latinFile = def.latin[weight]
      if (latinFile) jobs.push(this.load(def.cssName, weight, latinFile))
      const cjkFile = def.cjk?.[weight]
      if (needCjk && cjkFile && cjkFile !== latinFile) {
        jobs.push(this.load(def.cssName, weight, cjkFile))
      }
    }
    await Promise.all(jobs)
  }

  private async load(cssName: string, weight: number, url: string): Promise<void> {
    const key = `${cssName}:${weight}:${url}`
    if (this.loaded.has(key)) return
    const res = await fetch(url)
    if (!res.ok) throw new Error(`font fetch failed: ${url}`)
    const buf = await res.arrayBuffer()
    const face = new FontFace(cssName, buf, { weight: String(weight) })
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

/* ───────────────────────── 墨迹文本 ───────────────────────── */

export interface InkStyle {
  family: FontFamilyId
  weight: number
  color: string
  caps?: boolean
}

export interface InkMetrics {
  /** 达到目标墨迹高所需的 fontPx */
  fontPx: number
  /** 墨迹宽（px） */
  width: number
  /** 墨迹高（px） */
  height: number
  /** 墨迹顶到基线的距离 */
  ascent: number
  /** 对齐点到墨迹左缘的距离（Canvas actualBoundingBoxLeft 语义） */
  left: number
}

function fontShorthand(def: { cssName: string }, weight: number, px: number): string {
  return `${weight} ${px}px "${def.cssName}", sans-serif`
}

/** 测量一行文字的墨迹盒，返回按目标墨迹高缩放后的精确度量 */
export function measureInk(
  ctx: Ctx2D,
  rawText: string,
  family: FontFamilyId,
  weight: number,
  targetHeight: number
): InkMetrics {
  const def = getFontFamily(family)
  const text = def.capsOnly ? rawText.toUpperCase() : rawText

  ctx.font = fontShorthand(def, weight, PROBE_PX)
  const probe = ctx.measureText(text || ' ')
  const probeInkH = probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent
  const fontPx = probeInkH > 0 ? (targetHeight * PROBE_PX) / probeInkH : targetHeight

  ctx.font = fontShorthand(def, weight, fontPx)
  const m = ctx.measureText(text || ' ')
  const width = m.actualBoundingBoxLeft + m.actualBoundingBoxRight
  const height = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
  return { fontPx, width, height, ascent: m.actualBoundingBoxAscent, left: m.actualBoundingBoxLeft }
}

/**
 * 绘制一行墨迹对齐文本。
 * @param x 锚点（align=left 时为墨迹左缘；right 为墨迹右缘；center 为墨迹中线）
 * @param yTop 墨迹顶部 y
 * @returns 墨迹宽
 */
export function drawInkText(
  ctx: Ctx2D,
  rawText: string,
  x: number,
  yTop: number,
  targetHeight: number,
  style: InkStyle,
  align: 'left' | 'right' | 'center' = 'left'
): number {
  if (!rawText) return 0
  const def = getFontFamily(style.family)
  const text = def.capsOnly ? rawText.toUpperCase() : rawText
  const m = measureInk(ctx, text, style.family, style.weight, targetHeight)

  let originX: number
  if (align === 'left') originX = x + m.left
  else if (align === 'right') originX = x + m.left - m.width
  else originX = x + m.left - m.width / 2

  ctx.font = fontShorthand(def, style.weight, m.fontPx)
  ctx.fillStyle = style.color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, originX, yTop + m.ascent)
  return m.width
}

/** 混排绘制（等高行内多段异色，用于尼康 Z 红字）：段间以字符串拼接测量 */
export function drawInkSegments(
  ctx: Ctx2D,
  segments: Array<{ text: string; color: string }>,
  x: number,
  yTop: number,
  targetHeight: number,
  style: InkStyle,
  align: 'left' | 'right' | 'center' = 'left'
): number {
  const widths = segments.map((s) => measureInk(ctx, s.text, style.family, style.weight, targetHeight).width)
  const total = widths.reduce((a, b) => a + b, 0)
  let cursor = align === 'left' ? x : align === 'right' ? x - total : x - total / 2
  segments.forEach((seg, i) => {
    drawInkText(ctx, seg.text, cursor, yTop, targetHeight, { ...style, color: seg.color }, 'left')
    cursor += widths[i]!
  })
  return total
}

/** 把文本中的高亮字符（默认 'Z'）换色为段 —— 尼康 Z 款 */
export function markSegments(
  text: string,
  baseColor: string,
  markColor: string,
  markChar = 'Z'
): Array<{ text: string; color: string }> {
  const segments: Array<{ text: string; color: string }> = []
  for (const ch of text) {
    const last = segments[segments.length - 1]
    const color = ch === markChar ? markColor : baseColor
    if (last && last.color === color) last.text += ch
    else segments.push({ text: ch, color })
  }
  return segments
}

/* ───────────────────────── 几何工具 ───────────────────────── */

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
