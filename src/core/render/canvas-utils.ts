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

  /** 加载任意字体文件（符号字体等非注册家族，如尼康 Z 专用字形） */
  async ensureUrl(cssName: string, url: string, weight = 400): Promise<void> {
    await this.load(cssName, weight, url)
  }

  private async load(cssName: string, weight: number, url: string): Promise<void> {
    const key = `${cssName}:${weight}:${url}`
    if (this.loaded.has(key)) return
    const res = await fetch(url)
    if (!res.ok) throw new Error(`font fetch failed: ${url}`)
    const buf = await res.arrayBuffer()
    const face = new FontFace(cssName, buf, { weight: String(weight) })
    await face.load()
    // worker 的 FontFaceSet 在 globalThis.fonts；主线程在 document.fonts（放映室引擎首次在主线程消费 FontBook）
    const fonts =
      (globalThis as unknown as { fonts?: FontFaceSet }).fonts ??
      (typeof document !== 'undefined' ? document.fonts : undefined)
    if (!fonts) throw new Error('no FontFaceSet in this context')
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
      // no-cache：协商缓存——素材更新后立即生效（logo 曾因陈旧缓存渲染旧版被压扁）
      const res = await fetch(url, { cache: 'no-cache' })
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
  /** 显式字号（px）——横幅引擎用主行 fontPx 统一主/副行尺寸；缺省按 targetHeight 推导 */
  fontPx?: number
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
 * INK_FILTER 补偿行盒与墨迹（大写高度）之差，使视觉密度对齐 semi-utils
 * （M2 校准 1.45→1.38：配合 slotRatio 0.28 整体减重，见 banner-redesign-notes R-02）。
 */
const INK_FILTER = 1.38

/**
 * capsOnly 字体（Bebas 等）的大写转换，但保护计量单位的小写书写规范：
 * 300mm f/6.3 1/1250s → 300MM F/6.3 1/1250s（mm/cm/s 跟随数字时保持小写，关 BAN-011）。
 */
export function applyCaps(text: string): string {
  return text
    .toUpperCase()
    .replace(/(\d)MM\b/g, '$1mm')
    .replace(/(\d)CM\b/g, '$1cm')
    .replace(/(\d)S\b/g, '$1s')
}

export function measureInk(
  ctx: Ctx2D,
  rawText: string,
  family: FontFamilyId,
  weight: number,
  targetHeight: number,
  fontPxOverride?: number
): InkMetrics {
  const def = getFontFamily(family)
  const text = def.capsOnly ? applyCaps(rawText) : rawText

  const probePx = fontPxOverride ?? PROBE_PX
  ctx.font = fontShorthand(def, weight, probePx)
  const probe = ctx.measureText(text || ' ')
  const fbA = probe.fontBoundingBoxAscent
  const fbD = probe.fontBoundingBoxDescent
  const probeBoxH =
    fbA + fbD > 0 ? fbA + fbD : probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent || probePx
  const fontPx = fontPxOverride ?? (targetHeight * INK_FILTER * PROBE_PX) / probeBoxH

  ctx.font = fontShorthand(def, weight, fontPx)
  const m = ctx.measureText(text || ' ')
  const fontBox = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent
  return {
    fontPx,
    width: m.width,
    height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
    boxH: fontBox > 0 ? fontBox : probeBoxH * (fontPx / probePx),
    ascent: m.fontBoundingBoxAscent > 0 ? m.fontBoundingBoxAscent : fontBox * 0.8
  }
}

/**
 * 绘制一行文本（行盒语义）。
 * @param x 锚点（align=left 时为行盒左缘；right 为右缘；center 为中线）
 * @param y 锚点 y —— anchor='top'（默认）时为行盒顶部 y，字体行盒在
 *          [y, y+targetHeight] 内垂直居中落基线，同行跨栏基线严格一致；
 *          anchor='baseline' 时 y 直接作为基线（横幅引擎按统一 fontPx 显式对齐）
 * @returns 文本推进宽
 */
export function drawInkText(
  ctx: Ctx2D,
  rawText: string,
  x: number,
  y: number,
  targetHeight: number,
  style: InkStyle,
  align: 'left' | 'right' | 'center' = 'left',
  anchor: 'top' | 'baseline' = 'top'
): number {
  if (!rawText) return 0
  const def = getFontFamily(style.family)
  const text = def.capsOnly ? applyCaps(rawText) : rawText
  const m = measureInk(ctx, text, style.family, style.weight, targetHeight, style.fontPx)

  let originX: number
  if (align === 'left') originX = x
  else if (align === 'right') originX = x - m.width
  else originX = x - m.width / 2

  ctx.font = fontShorthand(def, style.weight, m.fontPx)
  ctx.fillStyle = style.color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, originX, anchor === 'baseline' ? y : y + (targetHeight - m.boxH) / 2 + m.ascent)
  return m.width
}

/** 混排绘制（等高行内多段异色/异字体，用于尼康 Z 专用字形）：同 fontPx 下逐段测宽推进。
 *  异字体段按主字体大写字高归一字号（符号字体的字形度量与正文不同，
 *  否则同行的 Z 会偏大偏低——用户实测反馈），基线锚定保证同行基线严格一致。
 */
export function drawInkSegments(
  ctx: Ctx2D,
  segments: Array<{ text: string; color: string; family?: FontFamilyId }>,
  x: number,
  y: number,
  targetHeight: number,
  style: InkStyle,
  align: 'left' | 'right' | 'center' = 'left',
  anchor: 'top' | 'baseline' = 'top'
): number {
  const metrics = segments.map((seg) => {
    const fam = seg.family ?? style.family
    const m = measureInk(ctx, seg.text, fam, style.weight, targetHeight, style.fontPx)
    if (!seg.family || seg.family === style.family) return { w: m.width, px: style.fontPx }
    const main = measureInk(ctx, 'M', style.family, style.weight, targetHeight, style.fontPx)
    const scale = m.height > 0 && main.height > 0 ? main.height / m.height : 1
    return { w: m.width * scale, px: (style.fontPx ?? m.fontPx) * scale }
  })
  const total = metrics.reduce((a, m) => a + m.w, 0)
  let cursor = align === 'left' ? x : align === 'right' ? x - total : x - total / 2
  segments.forEach((seg, i) => {
    drawInkText(
      ctx,
      seg.text,
      cursor,
      y,
      targetHeight,
      { ...style, color: seg.color ?? style.color, family: seg.family ?? style.family, fontPx: metrics[i]!.px },
      'left',
      anchor
    )
    cursor += metrics[i]!.w
  })
  return total
}

/** 把文本中的高亮字符（默认 'Z'）换色/换字体为段 —— 尼康 Z 款 */
export function markSegments(
  text: string,
  baseColor: string,
  markColor: string,
  markChar = 'Z',
  markFamily?: FontFamilyId
): Array<{ text: string; color: string; family?: FontFamilyId }> {
  const segments: Array<{ text: string; color: string; family?: FontFamilyId }> = []
  for (const ch of text) {
    const last = segments[segments.length - 1]
    const isMark = ch === markChar
    const color = isMark ? markColor : baseColor
    const family = isMark ? markFamily : undefined
    if (last && last.color === color && last.family === family) last.text += ch
    else segments.push({ text: ch, color, family })
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

/* ───────────────────────── 叠印文字可读性（R-05） ───────────────────────── */

/**
 * 采样矩形区域的平均亮度（0-1，Rec.709）。
 * 通过 8×8 临时画布降采样取均值；环境不支持 getImageData（如 node 测试 mock）时返回 null，
 * 调用方应把 null 视为"不干预"。
 */
export function sampleLuminance(ctx: Ctx2D, x: number, y: number, w: number, h: number): number | null {
  try {
    const canvas = (ctx as { canvas?: CanvasImageSource }).canvas
    if (!canvas || typeof ctx.getImageData !== 'function' || w <= 0 || h <= 0) return null
    const sw = 8
    const sh = 8
    const tmp = new OffscreenCanvas(sw, sh)
    const tctx = tmp.getContext('2d')
    if (!tctx) return null
    tctx.drawImage(canvas, x, y, w, h, 0, 0, sw, sh)
    const data = tctx.getImageData(0, 0, sw, sh).data
    let sum = 0
    let n = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 128) continue
      sum += (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255
      n++
    }
    return n ? sum / n : null
  } catch {
    return null
  }
}

/** 十六进制颜色 → 亮度（0-1）；解析失败返回 0（按黑处理） */
export function colorLuminance(hex: string): number {
  const m = hex.match(/^#([0-9a-f]{6})$/i)
  if (!m) return 0
  const v = Number.parseInt(m[1]!, 16)
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255
}

/**
 * 叠印文字的对比度保障：背景亮度与文字亮度过于接近时切换为黑/白。
 * 阈值 0.32（≈WCAG 对比度 4.5:1 的亮度差近似）；采样不可用时原样返回。
 */
export function ensureContrastColor(baseColor: string, bgLuma: number | null): string {
  if (bgLuma === null) return baseColor
  const fg = colorLuminance(baseColor)
  if (Math.abs(bgLuma - fg) >= 0.32) return baseColor
  return bgLuma > 0.5 ? '#1a1a1a' : '#ffffff'
}

/* ───────────────────────── 墨迹位图（semi-utils RichTextGenerator 语义） ─────────────────────────
 * Pillow 管线的 Canvas 等价移植：大字号超采样绘制 → 扫描墨迹包围盒精确裁切 →
 * drawImage 高质量降采样到目标墨迹高。排版（宽度/对齐/行高）全部基于墨迹盒，
 * 与 semi-utils 完全同构；浏览器光栅器的 hinting 差异被超采样消除。
 */

export interface InkSegment {
  text: string
  color: string
  /** 异字体段（尼康 Z 符号字形），自动按主字体大写字高归一 */
  family?: FontFamilyId
}

export interface InkBlock {
  /** 裁切到墨迹边界的位图（超采样分辨率） */
  canvas: OffscreenCanvas
  /** 位图高对应的"自然墨迹高"（最终分辨率 px；绘制按 targetInkH/naturalH 等比缩放） */
  naturalH: number
  /** 位图宽对应的"自然墨迹宽"（px） */
  naturalW: number
}

const INK_SS = 4
let inkScratch: OffscreenCanvasRenderingContext2D | null = null
const inkBlockCache = new Map<string, InkBlock | null>()
const INK_CACHE_MAX = 256

function inkScratchCtx(): OffscreenCanvasRenderingContext2D | null {
  if (inkScratch) return inkScratch
  try {
    const canvas = new OffscreenCanvas(8, 8)
    inkScratch = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null
    return inkScratch
  } catch {
    return null
  }
}

/** 构建（带缓存）一行文字的墨迹位图；环境不支持时返回 null（调用方走 drawInkText 回退） */
export function getInkBlock(
  family: FontFamilyId,
  weight: number,
  text: string,
  color: string,
  mark?: { color?: string; family: FontFamilyId }
): InkBlock | null {
  const key = `${family}|${weight}|${color}|${mark?.color ?? ''}|${mark?.family ?? ''}|${text}`
  const hit = inkBlockCache.get(key)
  if (hit !== undefined) return hit

  const block = buildInkBlock(family, weight, text, color, mark)
  if (inkBlockCache.size >= INK_CACHE_MAX) {
    const first = inkBlockCache.keys().next().value
    if (first !== undefined) inkBlockCache.delete(first)
  }
  inkBlockCache.set(key, block)
  return block
}

function buildInkBlock(
  family: FontFamilyId,
  weight: number,
  text: string,
  color: string,
  mark?: { color?: string; family: FontFamilyId }
): InkBlock | null {
  try {
    const scratch = inkScratchCtx()
    if (!scratch || typeof OffscreenCanvas === 'undefined') return null
    const def = getFontFamily(family)
    const normalized = def.capsOnly ? applyCaps(text) : text
    if (!normalized) return null

    // 1. 超采样测量与绘制（大字号消除 hinting 差异）
    const px = 100 * INK_SS
    const segments: InkSegment[] = mark && normalized.includes('Z')
      ? markSegments(normalized, color, mark.color ?? color, 'Z', mark.family)
      : [{ text: normalized, color }]

    // 逐段字号：异字体段按主字体大写字高归一（符号 Z 字形度量与正文不同）
    scratch.font = fontShorthand(def, weight, px)
    const capProbe = scratch.measureText('M')
    const capH = capProbe.actualBoundingBoxAscent > 0 ? capProbe.actualBoundingBoxAscent : px * 0.72
    const widths = segments.map((seg) => {
      const segDef = getFontFamily(seg.family ?? family)
      scratch.font = fontShorthand(segDef, weight, px)
      let w = scratch.measureText(seg.text).width
      if (seg.family && seg.family !== family) {
        const sym = scratch.measureText(seg.text)
        const symCap = sym.actualBoundingBoxAscent > 0 ? sym.actualBoundingBoxAscent : px
        w *= capH / symCap
      }
      return w
    })
    const totalW = widths.reduce((a, b) => a + b, 0)
    if (totalW <= 0) return null

    const ascent = capProbe.fontBoundingBoxAscent > 0 ? capProbe.fontBoundingBoxAscent : px * 0.8
    const descent = capProbe.fontBoundingBoxDescent > 0 ? capProbe.fontBoundingBoxDescent : px * 0.2
    const pad = Math.ceil(px * 0.05)
    const canvas = new OffscreenCanvas(Math.ceil(totalW) + pad * 2, Math.ceil(ascent + descent))
    const c = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null
    if (!c) return null
    c.textBaseline = 'alphabetic'
    let cursor = pad
    segments.forEach((seg, i) => {
      const segDef = getFontFamily(seg.family ?? family)
      let segPx = px
      if (seg.family && seg.family !== family) {
        scratch.font = fontShorthand(segDef, weight, px)
        const sym = scratch.measureText(seg.text)
        const symCap = sym.actualBoundingBoxAscent > 0 ? sym.actualBoundingBoxAscent : px
        segPx = px * (capH / symCap)
      }
      c.font = fontShorthand(segDef, weight, segPx)
      c.fillStyle = seg.color ?? color
      c.fillText(seg.text, cursor, pad + ascent)
      cursor += widths[i]!
    })

    // 2. 只做水平裁切（去掉左右侧留白）；**垂直保留完整字体盒**（上伸+下伸）——
    //    semi-utils standard1 的 rich_text 无 trim：height 作用于字体盒，墨迹只占盒内
    //    ~62%，行与行因此自带呼吸空间（官方样例"舒适间隙"的来源）。垂直裁到墨迹
    //    会把文字放大 ~1.6 倍并吃光行距（第二轮实测教训）。
    const image = c.getImageData(0, 0, canvas.width, canvas.height)
    let left = canvas.width
    let right = -1
    for (let x = 0; x < canvas.width; x++) {
      for (let y = 0; y < canvas.height; y++) {
        if (image.data[(y * canvas.width + x) * 4 + 3]! > 8) {
          if (x < left) left = x
          if (x > right) right = x
          break
        }
      }
    }
    if (right < left) return null

    // 3. 水平裁切；垂直保持字体盒全高（画布高度即 ascent+descent，无垂直 pad）
    const inkW = right - left + 1
    const boxH = Math.ceil(ascent + descent)
    const trimmed = new OffscreenCanvas(inkW, boxH)
    const tc = trimmed.getContext('2d') as OffscreenCanvasRenderingContext2D | null
    if (!tc) return null
    tc.drawImage(canvas, -left, 0)

    return { canvas: trimmed, naturalH: boxH / INK_SS, naturalW: inkW / INK_SS }
  } catch {
    return null
  }
}

/**
 * 渐进式半缩降采样绘制 —— Pillow LANCZOS 的 Canvas 等价物：
 * 浏览器 drawImage 在 >2× 单步缩小走 mipmap/线性采样，细笔画会欠采样
 * （锯齿+发虚）；每次恰 2× 的半缩走高质量全核平均，多级叠加后密度与
 * Pillow LANCZOS 观感一致。放大或 ≤2× 缩小直接一次绘制。
 */
export function drawImageSmoothed(
  ctx: Ctx2D,
  src: OffscreenCanvas | ImageBitmap,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): void {
  const sw = 'width' in src ? Number(src.width) : 0
  const sh = 'height' in src ? Number(src.height) : 0
  if (!(dw > 0) || !(dh > 0) || sw <= 0 || sh <= 0) return
  if (sw <= dw * 2 && sh <= dh * 2) {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src, dx, dy, dw, dh)
    return
  }
  try {
    let cur: OffscreenCanvas | ImageBitmap = src
    let cw = sw
    let ch = sh
    while (cw > dw * 2 && ch > dh * 2) {
      const nw = Math.max(1, Math.floor(cw / 2))
      const nh = Math.max(1, Math.floor(ch / 2))
      const t = new OffscreenCanvas(nw, nh)
      const tc = t.getContext('2d') as OffscreenCanvasRenderingContext2D | null
      if (!tc) break
      tc.imageSmoothingEnabled = true
      tc.imageSmoothingQuality = 'high'
      tc.drawImage(cur, 0, 0, nw, nh)
      cur = t
      cw = nw
      ch = nh
    }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(cur, dx, dy, dw, dh)
  } catch {
    ctx.drawImage(src, dx, dy, dw, dh)
  }
}

/** 清空墨迹位图缓存（测试用） */
export function clearInkBlockCache(): void {
  inkBlockCache.clear()
}
