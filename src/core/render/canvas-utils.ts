/**
 * 字体加载与文本绘制 —— worker 与主线程通用（无 DOM 依赖）。
 *
 * 文本度量：semi-utils 以"元素高度"定字号；Canvas 等价实现按字体行盒
 * （fontBoundingBox，只随字体/字号变化、与字符串无关）反推 fontPx，
 * 同一横幅/文字列内所有行共享同一字号，行盒内垂直居中落基线。
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
  /** 达到目标行盒高所需的 fontPx（由字体行盒推得，与字符串无关） */
  fontPx: number
  /** 文本推进宽（px） */
  width: number
  /** 墨迹高（px，actualBoundingBoxAscent+Descent，随字符串变化） */
  height: number
  /** 字体行盒高（px，fontBoundingBoxAscent+Descent，同字体同字号恒定） */
  boxH: number
  /** 字体行盒顶到基线的距离（px） */
  ascent: number
}

function fontShorthand(def: { cssName: string }, weight: number, px: number): string {
  return `${weight} ${px}px "${def.cssName}", sans-serif`
}

/**
 * semi-utils 以"元素高"定字号；Canvas 等价实现按字体行盒（fontBoundingBox，
 * 只依赖字体与字号、与字符串无关）反推 fontPx —— 同一横幅内所有行天然共享
 * 同一 fontPx，'-' 等低矮占位符不会把字号撑爆。
 * INK_FILTER 补偿行盒与墨迹（大写高度）之差，使视觉密度对齐 semi-utils。
 */
const INK_FILTER = 1.45

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
  const fbA = probe.fontBoundingBoxAscent
  const fbD = probe.fontBoundingBoxDescent
  const probeBoxH =
    fbA + fbD > 0 ? fbA + fbD : probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent || PROBE_PX
  const fontPx = (targetHeight * INK_FILTER * PROBE_PX) / probeBoxH

  ctx.font = fontShorthand(def, weight, fontPx)
  const m = ctx.measureText(text || ' ')
  const fontBox = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent
  return {
    fontPx,
    width: m.width,
    height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
    boxH: fontBox > 0 ? fontBox : probeBoxH * (fontPx / PROBE_PX),
    ascent: m.fontBoundingBoxAscent > 0 ? m.fontBoundingBoxAscent : fontBox * 0.8
  }
}

/**
 * 绘制一行文本（行盒语义）。
 * @param x 锚点（align=left 时为行盒左缘；right 为右缘；center 为中线）
 * @param yTop 行盒顶部 y —— 字体行盒在 [yTop, yTop+targetHeight] 内垂直居中落基线，
 *             同行跨栏基线严格一致（真正的"行对齐"，不随单行墨迹漂移）
 * @returns 文本推进宽
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
  if (align === 'left') originX = x
  else if (align === 'right') originX = x - m.width
  else originX = x - m.width / 2

  ctx.font = fontShorthand(def, style.weight, m.fontPx)
  ctx.fillStyle = style.color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, originX, yTop + (targetHeight - m.boxH) / 2 + m.ascent)
  return m.width
}

/** 混排绘制（等高行内多段异色，用于尼康 Z 红字）：同 fontPx 下逐段测宽推进 */
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
