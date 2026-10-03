import type { BannerStyle, WatermarkTemplate } from '../types'
import type { FontFamilyId } from '../fonts/registry'
import { drawImageSmoothed, drawInkText, getInkBlock, measureInk, type Ctx2D } from './canvas-utils'

/* ───────────────────────── 横幅排印系统常量（semi-utils 官方值） ─────────────────────────
 * 全部相对条带宽/高；与 semi-utils static/standard1.json + WatermarkFilter 常量一一同构：
 * bottom_margin 12% → 行墨迹 30% → 行距 5% → 间距 2%；Bold 墨迹 = Light × 1.13。
 */
export const BANNER_METRICS = {
  /** 主行墨迹高 / 横幅高 */
  slotRatio: 0.3,
  /** Bold 行墨迹 / Light 行墨迹（官方 rich_text 的 is_bold ×1.13） */
  boldInkRatio: 1.13,
  /** 行距 / 横幅高 */
  middleRatio: 0.05,
  /** 安全边距 / 条带宽 */
  paddingRatio: 0.02,
  /** 元素间最小间隙 = padding × factor（结构上禁止零间距叠压，BAN-001/002） */
  minGapFactor: 0.5,
  /** 分隔线宽 / 条带宽 */
  dividerWRatio: 0.003,
  /** 右置 logo 宽度钳制 / 条带宽 */
  rightLogoMaxWRatio: 0.28,
  /** 左置 logo 高 / 横幅高（扁平横幅：semi-utils side = 整个 bottom_margin，贴合上下） */
  leftLogoHRatio: 1.0,
  /** 左置 logo 高 / 横幅高（装裱卡片：靠左垂直居中、不贴合，保持排版舒适） */
  cardLeftLogoHRatio: 0.62,
  /** 左置 logo 宽度钳制 / 条带宽 */
  leftLogoMaxWRatio: 0.3,
  /** 字号收缩下限（触底后进入截断档） */
  shrinkFloor: 0.7,
  /** 文字块占横幅高的目标比例（computeBannerHeight 自适应扩展用） */
  contentFill: 0.72
} as const

export interface BannerLines {
  leftTop: string
  leftBottom: string
  rightTop: string
  rightBottom: string
}

export interface BannerSpec {
  banner: BannerStyle
  family: FontFamilyId
  mainWeight: number
  subWeight: number
  logo: ImageBitmap | null
  /** 卡片装裱内嵌时背景透明 */
  transparentBg?: boolean
  /** 尼康 Z 专用字形：机型行中的 Z 用符号字体渲染（color 缺省 = 正文色，尼康官方风） */
  mark?: { color?: string; family: FontFamilyId }
}

export interface BannerBox {
  x: number
  y: number
  w: number
  h: number
}

/** 行盒 + 绘制信息：h 为该行墨迹高（Bold 行 = Light × 1.13），text 为退化策略处理后的最终文本 */
export interface BannerRowBox extends BannerBox {
  text: string
}

export interface BannerLayout {
  bannerH: number
  slotH: number
  /** 收缩后主行墨迹高（≤ slotH；等于 slotH 表示未收缩）；副行 = lineH / boldInkRatio */
  lineH: number
  elemH: number
  /** 文字块顶相对条带顶的偏移（单行时即垂直居中结果） */
  elemMargin: number
  lt: BannerRowBox
  lb: BannerRowBox
  rt: BannerRowBox
  rb: BannerRowBox
  logo: BannerBox | null
  divider: BannerBox | null
  /** 是否触发了截断档 */
  truncated: boolean
}

export interface MeasureInput {
  text: string
  weight: number
  /** 目标墨迹高（主行 = slotH，副行 = slotH / boldInkRatio） */
  slotH: number
}

export type MeasureFn = (input: MeasureInput) => number

/**
 * 横幅高度单一来源（geometry 与条带矩形共用，消除三处同步风险）。
 * - typography.scale 只缩放文字内容，横幅高度随内容**只增不减**：
 *   scale=1 时严格等于 heightRatio×photoH（与历史渲染像素一致）；
 *   scale>1 触发内容超界时自动扩展（BAN-004：缩放增大方向不再被收缩抵消）。
 */
export function computeBannerHeight(template: WatermarkTemplate, photoH: number): number {
  const base = photoH * template.banner.heightRatio
  const M = BANNER_METRICS
  const blockRatio = M.slotRatio + M.slotRatio / M.boldInkRatio + M.middleRatio
  const block = template.typography.scale * blockRatio * base
  return Math.max(base, block / M.contentFill)
}

/**
 * 横幅排版 v3 —— 墨迹盒语义（semi-utils WatermarkFilter 同构）：
 * 一切行高 = 墨迹高（Bold 行 = Light × 1.13），测量/绘制全部基于墨迹位图；
 * 宽度分配与退化策略：固定项预算 → 三级退化（缩字 0.7× → 辅行截断 → 主行截断）
 * → 最小间隙（结构性禁止叠压）→ 降级布局（右栏空隐藏分隔线/单行垂直居中/紧凑模式）。
 */
export function computeBannerLayout(
  strip: { x: number; y: number; w: number; h: number },
  lines: BannerLines,
  spec: Pick<BannerSpec, 'banner' | 'mainWeight' | 'subWeight' | 'logo' | 'transparentBg'>,
  measure: MeasureFn,
  /** 墨迹缩放乘数（typography.scale<1 时缩小文字；横幅不变） */
  inkScale = 1
): BannerLayout {
  const { banner } = spec
  const M = BANNER_METRICS
  const bannerH = strip.h
  // 文字始终与横幅等比（官方 slot = 30% × margin）；inkScale 服务 scale<1
  const slotH = bannerH * M.slotRatio * inkScale
  const middle = bannerH * M.middleRatio
  const pad = strip.w * M.paddingRatio
  const minGap = pad * M.minGapFactor
  const delimW = banner.divider ? delimWidth(strip.w, banner) : 0
  const aspect = spec.logo ? spec.logo.width / spec.logo.height : 1
  // 副行（Light）墨迹高：主行 / 1.13
  const subOf = (mainInkH: number) => mainInkH / M.boldInkRatio

  const rowsTop = !!(lines.leftTop || lines.rightTop)
  const rowsBottom = !!(lines.leftBottom || lines.rightBottom)
  const hasRight = !!(lines.rightTop || lines.rightBottom)

  // ── 左 logo（固定预算）：扁平横幅贴合上下（官方 side = margin）；装裱卡片靠左垂直居中 ──
  let leftLogo: BannerBox | null = null
  if (spec.logo && banner.logo.position === 'left') {
    const hRatio = spec.transparentBg ? M.cardLeftLogoHRatio : M.leftLogoHRatio
    let h = bannerH * hRatio
    let w = h * aspect
    const maxW = strip.w * M.leftLogoMaxWRatio
    if (w > maxW) {
      w = maxW
      h = w / aspect
    }
    leftLogo = { x: strip.x, y: strip.y + (bannerH - h) / 2, w, h }
  }

  // ── 右 logo（尺寸依赖双行块高，先按双行满档估算） ──
  const elemFull = slotH + subOf(slotH) + middle
  let rightLogo: BannerBox | null = null
  if (spec.logo && banner.logo.position === 'right') {
    let h = elemFull * banner.logo.heightRatio
    let w = h * aspect
    const maxW = strip.w * M.rightLogoMaxWRatio
    if (w > maxW) {
      w = maxW
      h = w / aspect
    }
    if (w > strip.w * 0.18) {
      // 紧凑模式：横幅过窄时 logo 退到单行墨迹高
      rightLogo = { x: 0, y: 0, w: Math.min(slotH * aspect, maxW), h: slotH }
    } else {
      rightLogo = { x: 0, y: 0, w, h }
    }
  }

  // ── 可用宽：固定项（左栏起点/logo/分隔线/安全边距）先行扣减 ──
  const leftX = leftLogo
    ? strip.x + leftLogo.w + pad + (delimW > 0 ? delimW + pad : 0)
    : strip.x + pad
  const x1 = strip.x + strip.w - pad
  const showDivider = delimW > 0 && (hasRight || !!leftLogo)
  const rightStackW =
    (rightLogo && !leftLogo ? rightLogo.w + pad : 0) + (showDivider && !leftLogo ? delimW + pad : 0)
  const gapLR = hasRight || (rightLogo && !leftLogo) ? minGap : 0
  const available = Math.max(0, x1 - leftX - rightStackW - gapLR)

  // ── 需求测量与三级退化（主/副行墨迹高不同） ──
  const measureAll = (mainH: number, src: BannerLines = lines) => ({
    lt: src.leftTop ? measure({ text: src.leftTop, weight: spec.mainWeight, slotH: mainH }) : 0,
    lb: src.leftBottom ? measure({ text: src.leftBottom, weight: spec.subWeight, slotH: subOf(mainH) }) : 0,
    rt: src.rightTop ? measure({ text: src.rightTop, weight: spec.mainWeight, slotH: mainH }) : 0,
    rb: src.rightBottom ? measure({ text: src.rightBottom, weight: spec.subWeight, slotH: subOf(mainH) }) : 0
  })

  const first = measureAll(slotH)
  const demand0 = Math.max(first.lt, first.lb) + Math.max(first.rt, first.rb)
  let scale = demand0 > available && demand0 > 0 ? Math.max(M.shrinkFloor, available / demand0) : 1
  let lineH = slotH * scale
  let w = scale < 1 ? measureAll(lineH) : first
  let truncated = false
  const texts: BannerLines = { ...lines }

  // 截断档：缩字触底仍溢出时，按需求比例分配列预算，逐行截断加省略号
  const overflow = Math.max(w.lt, w.lb) + Math.max(w.rt, w.rb) - available
  if (overflow > 0.5 && scale <= M.shrinkFloor + 1e-9) {
    scale = M.shrinkFloor
    lineH = slotH * scale
    w = measureAll(lineH)
    const demand = Math.max(1, Math.max(w.lt, w.lb) + Math.max(w.rt, w.rb))
    const budgetL = available * (Math.max(w.lt, w.lb) / demand)
    const budgetR = Math.max(0, available - budgetL)
    const fit = (text: string, weight: number, maxW: number, rowH: number): string => {
      if (!text) return ''
      if (measure({ text, weight, slotH: rowH }) <= maxW) return text
      if (maxW <= 0) return ''
      let lo = 0
      let hi = text.length
      let best = ''
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const cand = (text.slice(0, mid).trimEnd() + (mid > 0 ? '…' : '')).trim()
        if (!cand) return ''
        if (measure({ text: cand, weight, slotH: rowH }) <= maxW) {
          best = cand
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      return best
    }
    texts.leftBottom = fit(lines.leftBottom, spec.subWeight, budgetL, subOf(lineH))
    texts.leftTop = fit(lines.leftTop, spec.mainWeight, budgetL, lineH)
    texts.rightBottom = fit(lines.rightBottom, spec.subWeight, budgetR, subOf(lineH))
    texts.rightTop = fit(lines.rightTop, spec.mainWeight, budgetR, lineH)
    w = measureAll(lineH, texts)
    truncated = true
  }
  const maxL = Math.max(w.lt, w.lb)
  const maxR = Math.max(w.rt, w.rb)

  // ── 纵向：实际行块（按启用行）在条带内垂直居中（单行自动居中，BAN-006） ──
  const topInkH = lineH
  const bottomInkH = subOf(lineH)
  const blockH = (rowsTop ? topInkH : 0) + (rowsTop && rowsBottom ? middle : 0) + (rowsBottom ? bottomInkH : 0)
  const elemH = Math.max(blockH, lineH)
  const blockTop = strip.y + (bannerH - blockH) / 2
  const topY = blockTop
  const bottomY = blockTop + (rowsTop ? topInkH + middle : 0)

  // ── 右栏与堆叠落位（自右向左，结构性保证不相交） ──
  const rightColLeft = x1 - maxR
  const rt: BannerRowBox = {
    x: banner.rightAlign === 'near' ? rightColLeft : x1 - w.rt,
    y: topY,
    w: w.rt,
    h: topInkH,
    text: texts.rightTop
  }
  const rb: BannerRowBox = {
    x: banner.rightAlign === 'near' ? rightColLeft : x1 - w.rb,
    y: bottomY,
    w: w.rb,
    h: bottomInkH,
    text: texts.rightBottom
  }

  let divider: BannerBox | null = null
  let logo: BannerBox | null = null
  if (leftLogo) {
    // 左 logo 布局：分隔线在 logo 与左栏文字之间（左栏文字左缘已含 delimW + pad）
    if (showDivider) {
      divider = { x: leftX - pad - delimW, y: blockTop - blockH * 0.05, w: delimW, h: blockH * 1.1 }
    }
    logo = leftLogo
  } else {
    // 右 logo / 无 logo 布局：堆叠自右向左落位
    let stackRight = (hasRight ? rightColLeft : x1) - (hasRight ? pad : 0)
    if (showDivider) {
      divider = { x: stackRight - delimW, y: blockTop - blockH * 0.05, w: delimW, h: blockH * 1.1 }
      stackRight = divider.x - pad
    }
    if (rightLogo) {
      const h = rightLogo.h === elemFull * banner.logo.heightRatio ? elemH * banner.logo.heightRatio : rightLogo.h
      logo = {
        x: stackRight - rightLogo.w,
        y: blockTop + (blockH - h) / 2,
        w: rightLogo.w,
        h
      }
    }
  }

  const lt: BannerRowBox = { x: leftX, y: topY, w: w.lt, h: topInkH, text: texts.leftTop }
  const lb: BannerRowBox = { x: leftX, y: bottomY, w: w.lb, h: bottomInkH, text: texts.leftBottom }

  return {
    bannerH,
    slotH,
    lineH,
    elemH,
    elemMargin: blockTop - strip.y,
    lt,
    lb,
    rt,
    rb,
    logo,
    divider,
    truncated
  }
}

function delimWidth(stripW: number, banner: BannerStyle): number {
  return banner.divider ? Math.max(1.2, stripW * BANNER_METRICS.dividerWRatio) : 0
}

/**
 * 横幅高度自适应（semi-utils 生成器 F1 的正式移植）：
 * 固定 heightRatio 在竖幅/长文本上必然溢出（宽度需求 > 条带宽），
 * 用墨迹位图实测槽位宽度，从官方比例向下搜索第一个可容纳的档位（步进 0.25% 图高，
 * 下限 4.5%）；横幅照片装得下时保持官方比例。宽度与高度线性关系，墨迹位图缓存下开销极低。
 */
export function solveBannerHeight(
  template: WatermarkTemplate,
  photoW: number,
  photoH: number,
  lines: BannerLines,
  family: FontFamilyId,
  mainWeight: number,
  subWeight: number,
  mark?: { color?: string; family: FontFamilyId },
  logoAspect = 1
): number {
  const M = BANNER_METRICS
  const officialRatio = template.banner.heightRatio
  const scale = template.typography.scale
  const inkScale = Math.min(1, scale)

  // 判定直接复用排版引擎本身（单一口径，杜绝 solve 与落位的宽度漂移）：
  // 以候选横幅高跑一次 computeBannerLayout（文字 ∝ 横幅高），未触发截断档即可容纳
  const fits = (bannerH: number): boolean => {
    const layout = computeBannerLayout(
      { x: 0, y: 0, w: photoW, h: bannerH },
      lines,
      {
        banner: template.banner,
        mainWeight,
        subWeight,
        // 与渲染同宽高比的合成 logo：预算必须包含 logo 占位（否则 solve 偏乐观导致截断）
        logo: logoAspect > 0 ? ({ width: logoAspect, height: 1 } as unknown as ImageBitmap) : null
      },
      (input) => {
        const block = getInkBlock(family, input.weight, input.text, template.banner.textColor, mark)
        if (block) return block.naturalW * (input.slotH / block.naturalH)
        return input.text.length * input.slotH * 0.55
      },
      inkScale
    )
    return !layout.truncated
  }

  // 起点 = computeBannerHeight（官方比例 与 scale 内容增长 取大者，BAN-004 语义）
  const startH = computeBannerHeight(template, photoH)
  if (fits(startH)) return startH
  let bannerH = startH
  while (bannerH / photoH > 0.045) {
    bannerH -= 0.0025 * photoH
    if (fits(bannerH)) return bannerH
  }
  return 0.045 * photoH
}

/**
 * 绘制横幅：全部行以墨迹位图（超采样裁切）落位——semi-utils 的 Canvas 等价实现；
 * 环境不支持 OffscreenCanvas 时回退 drawInkText 行盒绘制。
 */
export function drawBannerStrip(
  ctx: Ctx2D,
  strip: { x: number; y: number; w: number; h: number },
  lines: BannerLines,
  spec: BannerSpec,
  inkScale = 1
): void {
  const { banner } = spec

  if (!spec.transparentBg) {
    ctx.fillStyle = banner.bgColor
    ctx.fillRect(strip.x, strip.y, strip.w, strip.h)
  }

  const measure = ({ text, weight, slotH }: MeasureInput) => {
    const block = getInkBlock(spec.family, weight, text, banner.textColor, spec.mark)
    if (block) return block.naturalW * (slotH / block.naturalH)
    return measureInk(ctx, text, spec.family, weight, slotH).width
  }
  const layout = computeBannerLayout(strip, lines, spec, measure, inkScale)

  const drawRow = (row: BannerRowBox, weight: number, color: string) => {
    if (!row.text) return
    const block = getInkBlock(spec.family, weight, row.text, color, spec.mark)
    if (block) {
      const w = row.w > 0 ? row.w : block.naturalW * (row.h / block.naturalH)
      drawImageSmoothed(ctx, block.canvas, row.x, row.y, w, row.h)
      return
    }
    drawInkText(ctx, row.text, row.x, row.y, row.h, { family: spec.family, weight, color }, 'left')
  }

  drawRow(layout.rt, spec.mainWeight, banner.textColor)
  drawRow(layout.rb, spec.subWeight, banner.subColor)
  drawRow(layout.lt, spec.mainWeight, banner.textColor)
  drawRow(layout.lb, spec.subWeight, banner.subColor)

  if (layout.logo) {
    // logo 位图 2048 级 → 目标 ~126px（16×），必须渐进半缩否则边缘锯齿
    drawImageSmoothed(ctx, spec.logo!, layout.logo.x, layout.logo.y, layout.logo.w, layout.logo.h)
  }

  if (layout.divider) {
    ctx.fillStyle = banner.dividerColor
    ctx.fillRect(layout.divider.x, layout.divider.y, layout.divider.w, layout.divider.h)
  }

}
