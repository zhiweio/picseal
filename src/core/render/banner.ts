import type { BannerStyle, WatermarkTemplate } from '../types'
import type { FontFamilyId } from '../fonts/registry'
import {
  drawImageSmoothed,
  drawInkText,
  getInkBlock,
  measureInk,
  type Ctx2D,
  type InkMark
} from './canvas-utils'
import type { ResolvedRowStyle } from './slot-style'

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

export type BannerSlotPos = 'leftTop' | 'leftBottom' | 'rightTop' | 'rightBottom'

/** 四象限槽位解析样式表（高级字体覆写渲染载体） */
export type BannerSlotStyles = Partial<Record<BannerSlotPos, ResolvedRowStyle>>

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
  /** 四象限槽位的品牌锁定字形（仅机型槽位有值；锁定段样式任何情况下不随行覆写） */
  marks?: BannerSlotMarks
  /** 四象限槽位解析后的样式（高级字体覆写；缺省 = 模板全局，见 bannerRowStyle） */
  slotStyles?: BannerSlotStyles
}

export interface BannerBox {
  x: number
  y: number
  w: number
  h: number
}

/** 行盒 + 绘制信息：h 为该行墨迹高（主行基准 = slotH，副行 = /1.13，各含槽位字号乘数），text 为退化策略处理后的最终文本 */
export interface BannerRowBox extends BannerBox {
  text: string
}

export interface BannerLayout {
  bannerH: number
  slotH: number
  /** 收缩后主行墨迹高基准（≤ slotH；等于 slotH 表示未收缩；各槽位实际墨迹高 = 基准 × 槽位乘数） */
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
  /** 目标墨迹高（已含主/副行比与槽位字号乘数） */
  slotH: number
  /** 该行的家族/斜体（槽位覆写后的解析值） */
  family: FontFamilyId
  italic: boolean
  /** 该行的品牌锁定字形（仅机型槽位由调用方注入，其余槽位 undefined = 如常渲染） */
  mark?: InkMark
}

export type MeasureFn = (input: MeasureInput) => number

/** 四象限槽位的品牌锁定字形表（仅机型槽位有值） */
export type BannerSlotMarks = Partial<Record<BannerSlotPos, InkMark>>

/**
 * 槽位样式缺省解析（spec.slotStyles 缺省 = 模板全局）：测量、落位、绘制三处共用
 * 同一出口，杜绝口径漂移。主行（上）= mainWeight/textColor，副行（下）= subWeight/subColor。
 */
export function bannerRowStyle(
  spec: Pick<BannerSpec, 'banner' | 'family' | 'mainWeight' | 'subWeight' | 'slotStyles'>,
  pos: BannerSlotPos
): ResolvedRowStyle {
  const custom = spec.slotStyles?.[pos]
  if (custom) return custom
  const top = pos === 'leftTop' || pos === 'rightTop'
  return {
    family: spec.family,
    weight: top ? spec.mainWeight : spec.subWeight,
    italic: false,
    color: top ? spec.banner.textColor : spec.banner.subColor,
    scale: 1,
    colorOverridden: false
  }
}

/**
 * 横幅高度单一来源（geometry 与条带矩形共用，消除三处同步风险）。
 * - typography.scale 只缩放文字内容，横幅高度随内容**只增不减**：
 *   scale=1 时严格等于 heightRatio×photoH（与历史渲染像素一致）；
 *   scale>1 触发内容超界时自动扩展（BAN-004：缩放增大方向不再被收缩抵消）。
 * - 槽位字号覆写同样参与块高预估（取上/下带最大乘数），无覆写时与原公式逐项一致。
 */
export function computeBannerHeight(template: WatermarkTemplate, photoH: number): number {
  const base = photoH * template.banner.heightRatio
  const M = BANNER_METRICS
  const b = template.banner
  const top = Math.max(b.leftTop?.style?.scale ?? 1, b.rightTop?.style?.scale ?? 1)
  const bottom = Math.max(b.leftBottom?.style?.scale ?? 1, b.rightBottom?.style?.scale ?? 1)
  const blockRatio =
    M.slotRatio * top + (M.slotRatio / M.boldInkRatio) * bottom + M.middleRatio
  const block = template.typography.scale * blockRatio * base
  return Math.max(base, block / M.contentFill)
}

/**
 * 横幅排版 v3 —— 墨迹盒语义（semi-utils WatermarkFilter 同构）：
 * 一切行高 = 墨迹高（Bold 行 = Light × 1.13），测量/绘制全部基于墨迹位图；
 * 宽度分配与退化策略：固定项预算 → 三级退化（缩字 0.7× → 辅行截断 → 主行截断）
 * → 最小间隙（结构性禁止叠压）→ 降级布局（右栏空隐藏分隔线/单行垂直居中/紧凑模式）。
 * 槽位字号覆写是行基准墨迹高之上的乘数：同带内墨迹底线对齐（矮行底部上移），
 * 官方比例语义在全默认（乘数皆 1）时逐项保持。
 */
export function computeBannerLayout(
  strip: { x: number; y: number; w: number; h: number },
  lines: BannerLines,
  spec: Pick<
    BannerSpec,
    'banner' | 'family' | 'mainWeight' | 'subWeight' | 'logo' | 'transparentBg' | 'slotStyles' | 'marks'
  >,
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

  const isTopPos = (pos: BannerSlotPos) => pos === 'leftTop' || pos === 'rightTop'
  /** 行墨迹高 = 主/副基准 × 槽位字号乘数 */
  const rowH = (pos: BannerSlotPos, mainH: number) =>
    (isTopPos(pos) ? mainH : subOf(mainH)) * bannerRowStyle(spec, pos).scale
  const topScale = Math.max(
    bannerRowStyle(spec, 'leftTop').scale,
    bannerRowStyle(spec, 'rightTop').scale
  )
  const bottomScale = Math.max(
    bannerRowStyle(spec, 'leftBottom').scale,
    bannerRowStyle(spec, 'rightBottom').scale
  )

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
  const elemFull = slotH * topScale + subOf(slotH) * bottomScale + middle
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
      rightLogo = { x: 0, y: 0, w: Math.min(slotH * topScale * aspect, maxW), h: slotH * topScale }
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

  // ── 需求测量与三级退化（各行墨迹高独立：主/副行比 × 槽位字号乘数） ──
  const rowMarkOf = (pos: BannerSlotPos) => spec.marks?.[pos]
  const measureRow = (pos: BannerSlotPos, text: string, mainH: number) => {
    const st = bannerRowStyle(spec, pos)
    return measure({
      text,
      weight: st.weight,
      family: st.family,
      italic: st.italic,
      slotH: rowH(pos, mainH),
      mark: rowMarkOf(pos)
    })
  }
  const measureAll = (mainH: number, src: BannerLines = lines) => ({
    lt: src.leftTop ? measureRow('leftTop', src.leftTop, mainH) : 0,
    lb: src.leftBottom ? measureRow('leftBottom', src.leftBottom, mainH) : 0,
    rt: src.rightTop ? measureRow('rightTop', src.rightTop, mainH) : 0,
    rb: src.rightBottom ? measureRow('rightBottom', src.rightBottom, mainH) : 0
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
    const fit = (text: string, pos: BannerSlotPos, maxW: number): string => {
      if (!text) return ''
      const st = bannerRowStyle(spec, pos)
      const probe = (cand: string) =>
        measure({ text: cand, weight: st.weight, family: st.family, italic: st.italic, slotH: rowH(pos, lineH) })
      if (probe(text) <= maxW) return text
      if (maxW <= 0) return ''
      let lo = 0
      let hi = text.length
      let best = ''
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const cand = (text.slice(0, mid).trimEnd() + (mid > 0 ? '…' : '')).trim()
        if (!cand) return ''
        if (probe(cand) <= maxW) {
          best = cand
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      return best
    }
    texts.leftBottom = fit(lines.leftBottom, 'leftBottom', budgetL)
    texts.leftTop = fit(lines.leftTop, 'leftTop', budgetL)
    texts.rightBottom = fit(lines.rightBottom, 'rightBottom', budgetR)
    texts.rightTop = fit(lines.rightTop, 'rightTop', budgetR)
    w = measureAll(lineH, texts)
    truncated = true
  }
  const maxL = Math.max(w.lt, w.lb)
  const maxR = Math.max(w.rt, w.rb)

  // ── 纵向：实际行块（按启用行）在条带内垂直居中；同带墨迹底线对齐（矮行底部上移，BAN 官方语义） ──
  const topBand = Math.max(
    lines.leftTop ? rowH('leftTop', lineH) : 0,
    lines.rightTop ? rowH('rightTop', lineH) : 0
  )
  const bottomBand = Math.max(
    lines.leftBottom ? rowH('leftBottom', lineH) : 0,
    lines.rightBottom ? rowH('rightBottom', lineH) : 0
  )
  const blockH = (rowsTop ? topBand : 0) + (rowsTop && rowsBottom ? middle : 0) + (rowsBottom ? bottomBand : 0)
  const elemH = Math.max(blockH, topBand)
  const blockTop = strip.y + (bannerH - blockH) / 2
  const rowY = (pos: BannerSlotPos) =>
    isTopPos(pos)
      ? blockTop + topBand - rowH(pos, lineH)
      : blockTop + (rowsTop ? topBand + middle : 0) + bottomBand - rowH(pos, lineH)

  // ── 右栏与堆叠落位（自右向左，结构性保证不相交） ──
  const rightColLeft = x1 - maxR
  const rt: BannerRowBox = {
    x: banner.rightAlign === 'near' ? rightColLeft : x1 - w.rt,
    y: rowY('rightTop'),
    w: w.rt,
    h: rowH('rightTop', lineH),
    text: texts.rightTop
  }
  const rb: BannerRowBox = {
    x: banner.rightAlign === 'near' ? rightColLeft : x1 - w.rb,
    y: rowY('rightBottom'),
    w: w.rb,
    h: rowH('rightBottom', lineH),
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

  const lt: BannerRowBox = { x: leftX, y: rowY('leftTop'), w: w.lt, h: rowH('leftTop', lineH), text: texts.leftTop }
  const lb: BannerRowBox = { x: leftX, y: rowY('leftBottom'), w: w.lb, h: rowH('leftBottom', lineH), text: texts.leftBottom }

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
 * slotStyles：四象限槽位解析样式（高级字体覆写），与落位/绘制同口径参与判定。
 */
export function solveBannerHeight(
  template: WatermarkTemplate,
  photoW: number,
  photoH: number,
  lines: BannerLines,
  family: FontFamilyId,
  mainWeight: number,
  subWeight: number,
  marks?: BannerSlotMarks,
  logoAspect = 1,
  slotStyles?: BannerSlotStyles
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
        family,
        mainWeight,
        subWeight,
        // 与渲染同宽高比的合成 logo：预算必须包含 logo 占位（否则 solve 偏乐观导致截断）
        logo: logoAspect > 0 ? ({ width: logoAspect, height: 1 } as unknown as ImageBitmap) : null,
        slotStyles,
        marks
      },
      (input) => {
        const block = getInkBlock(input.family, input.weight, input.text, template.banner.textColor, input.mark, input.italic)
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
 * 各行按槽位解析样式（家族/字重/斜体/颜色）取墨迹位图，测量与绘制同口径。
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

  const measure = ({ text, weight, family, italic, slotH, mark }: MeasureInput) => {
    const block = getInkBlock(family, weight, text, banner.textColor, mark, italic)
    if (block) return block.naturalW * (slotH / block.naturalH)
    return measureInk(ctx, text, family, weight, slotH, undefined, italic).width
  }
  const layout = computeBannerLayout(strip, lines, spec, measure, inkScale)

  const drawRow = (row: BannerRowBox, pos: BannerSlotPos) => {
    if (!row.text) return
    const st = bannerRowStyle(spec, pos)
    // 品牌锁定字形（仅机型槽位有 mark）：行色被显式覆写时符号字符跟随行色（颜色可改），
    // 字标颜色恒随行色；家族/字重/斜体在 getInkBlock 内永远锁定——任何情况下官方字形
    const baseMark = spec.marks?.[pos]
    const mark =
      baseMark && st.colorOverridden
        ? {
            ...baseMark,
            symbol: baseMark.symbol ? { ...baseMark.symbol, color: st.color } : undefined
          }
        : baseMark
    const block = getInkBlock(st.family, st.weight, row.text, st.color, mark, st.italic)
    if (block) {
      const w = row.w > 0 ? row.w : block.naturalW * (row.h / block.naturalH)
      drawImageSmoothed(ctx, block.canvas, row.x, row.y, w, row.h)
      return
    }
    drawInkText(
      ctx,
      row.text,
      row.x,
      row.y,
      row.h,
      { family: st.family, weight: st.weight, color: st.color, italic: st.italic },
      'left'
    )
  }

  drawRow(layout.rt, 'rightTop')
  drawRow(layout.rb, 'rightBottom')
  drawRow(layout.lt, 'leftTop')
  drawRow(layout.lb, 'leftBottom')

  if (layout.logo) {
    // logo 位图 2048 级 → 目标 ~126px（16×），必须渐进半缩否则边缘锯齿
    drawImageSmoothed(ctx, spec.logo!, layout.logo.x, layout.logo.y, layout.logo.w, layout.logo.h)
  }

  if (layout.divider) {
    ctx.fillStyle = banner.dividerColor
    ctx.fillRect(layout.divider.x, layout.divider.y, layout.divider.w, layout.divider.h)
  }

}
