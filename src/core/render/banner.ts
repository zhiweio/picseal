import type { BannerStyle } from '../types'
import type { FontFamilyId } from '../fonts/registry'
import { drawInkText, measureInk, type Ctx2D } from './canvas-utils'

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
}

export interface BannerBox {
  x: number
  y: number
  w: number
  h: number
}

export interface BannerLayout {
  bannerH: number
  slotH: number
  /** 超宽收缩后的实际行盒高（≤ slotH；1 表示未收缩） */
  lineH: number
  elemH: number
  elemMargin: number
  lt: BannerBox
  lb: BannerBox
  rt: BannerBox
  rb: BannerBox
  logo: BannerBox | null
  divider: BannerBox | null
}

export interface MeasureInput {
  text: string
  weight: number
  slotH: number
}

export type MeasureFn = (input: MeasureInput) => number

/**
 * semi-utils WatermarkFilter 的排版公式移植（filters.py L251-360）。
 * 全部坐标为行盒（line box）语义：{x, y} 是行盒左上角。
 *
 * - bannerH = strip.h（条带高度已含 typography.scale，唯一来源，杜绝单位错位）
 * - 槽位行盒高 = bannerH × 0.30；middle = bannerH × 0.05；common = strip.w × 0.02
 * - 文本块在条带内垂直居中（elem_margin）
 * - 上行同行盒顶对齐、下行同行盒顶对齐（同 fontPx ⇒ 基线对齐）
 * - rightAlign near：rt.x = rb.x = min(两行右对齐 x)，右栏成块贴分隔线
 * - 左/右 logo、分隔线不参与收缩；文本行超宽时按比例收缩行盒（下限 0.5×）
 */
export function computeBannerLayout(
  strip: { x: number; y: number; w: number; h: number },
  lines: BannerLines,
  spec: Pick<BannerSpec, 'banner' | 'mainWeight' | 'subWeight' | 'logo'>,
  measure: MeasureFn
): BannerLayout {
  const { banner } = spec
  const bannerH = strip.h
  const slotH = bannerH * 0.3
  const middle = bannerH * 0.05
  const common = strip.w * 0.02

  const leftLogo = spec.logo && banner.logo.position === 'left'
    ? leftLogoBox(spec.logo, bannerH, strip.w)
    : null
  const leftLogoW = leftLogo?.w ?? 0
  const rightLogo = spec.logo && banner.logo.position === 'right'
    ? rightLogoBox(spec.logo, slotH, strip.w)
    : null
  const delimW = banner.divider ? Math.max(1.2, strip.w * 0.003) : 0

  const measureAll = (h: number) => ({
    wLT: lines.leftTop ? measure({ text: lines.leftTop, weight: spec.mainWeight, slotH: h }) : 0,
    wLB: lines.leftBottom ? measure({ text: lines.leftBottom, weight: spec.subWeight, slotH: h }) : 0,
    wRT: lines.rightTop ? measure({ text: lines.rightTop, weight: spec.mainWeight, slotH: h }) : 0,
    wRB: lines.rightBottom ? measure({ text: lines.rightBottom, weight: spec.subWeight, slotH: h }) : 0
  })

  // 固定占宽（logo/分隔线/间距），超宽时只收缩文本
  const leftFixed = leftLogoW + (leftLogoW > 0 ? common : 0)
  const rightFixed =
    (banner.logo.position === 'right' && spec.logo
      ? rightLogo!.w + (banner.divider ? 1 : 0) * delimW + 3 * common
      : banner.divider
        ? delimW + 2 * common
        : common)
  const available = Math.max(0, strip.w - leftFixed - rightFixed)

  const first = measureAll(slotH)
  const textNeeded = Math.max(first.wLT, first.wLB) + Math.max(first.wRT, first.wRB)
  const shrink = textNeeded > available
    ? Math.max(0.5, available / textNeeded)
    : 1
  const lineH = slotH * shrink
  const w = shrink < 1 ? measureAll(lineH) : first

  const elemH = slotH * 2 + middle
  const elemMargin = (bannerH - elemH) / 2
  // 文本块顶（y 向下坐标：上行在上、下行在下）
  const footerY = strip.y + elemMargin
  // 收缩后行盒在各自槽位内垂直居中
  const topY = footerY + (slotH - lineH) / 2
  const bottomY = footerY + slotH + middle + (slotH - lineH) / 2

  // 左栏（logo 在左时右移一个 logo 位）
  const leftX = strip.x + leftLogoW + common
  const lt: BannerBox = { x: leftX, y: topY, w: w.wLT, h: lineH }
  const lb: BannerBox = { x: leftX, y: bottomY, w: w.wLB, h: lineH }

  // 右栏：上/下行分别与左栏行盒顶对齐（同 fontPx ⇒ 等价底线对齐）
  const rightEnd = strip.x + strip.w
  const rtFarX = rightEnd - w.wRT - common
  const rbFarX = rightEnd - w.wRB - common
  const nearX = Math.min(rtFarX, rbFarX)
  const rt: BannerBox = {
    x: banner.rightAlign === 'near' ? nearX : rtFarX,
    y: topY,
    w: w.wRT,
    h: lineH
  }
  const rb: BannerBox = {
    x: banner.rightAlign === 'near' ? nearX : rbFarX,
    y: bottomY,
    w: w.wRB,
    h: lineH
  }

  // 分隔线 + logo（semi-utils：logo 在分隔线左侧）
  const maxRightW = Math.max(w.wRT, w.wRB)
  let divider: BannerBox | null = null
  let logo: BannerBox | null = null

  if (banner.logo.position === 'right') {
    const delimX = rightEnd - maxRightW - 2 * common - delimW
    if (banner.divider && delimW > 0) {
      divider = { x: delimX, y: footerY - elemH * 0.05, w: delimW, h: elemH * 1.1 }
    }
    if (rightLogo) {
      logo = {
        x: delimX - common - rightLogo.w,
        y: footerY + (elemH - rightLogo.h) / 2,
        w: rightLogo.w,
        h: rightLogo.h
      }
    }
  } else if (leftLogo) {
    logo = { x: strip.x, y: footerY + (bannerH - leftLogo.h) / 2, w: leftLogo.w, h: leftLogo.h }
    if (banner.divider && delimW > 0) {
      divider = { x: strip.x + leftLogo.w + common, y: footerY - elemH * 0.05, w: delimW, h: elemH * 1.1 }
    }
  }

  return { bannerH, slotH, lineH, elemH, elemMargin, lt, lb, rt, rb, logo, divider }
}

/** 右置 logo：高 = elemH，宽按比例，宽 logo 钳制不超过 strip 宽 1/4 */
function rightLogoBox(logo: ImageBitmap, elemH: number, stripW: number): BannerBox {
  const aspect = logo.width / logo.height
  let h = elemH
  let w = h * aspect
  const maxW = stripW * 0.25
  if (w > maxW) {
    w = maxW
    h = w / aspect
  }
  return { x: 0, y: 0, w, h }
}

/** 左置 logo（semi-utils：充满 footer 高；宽 logo 适配高度） */
function leftLogoBox(logo: ImageBitmap, bannerH: number, stripW: number): BannerBox {
  const aspect = logo.width / logo.height
  let h = bannerH * 0.9
  let w = h * aspect
  const maxW = stripW * 0.3
  if (w > maxW) {
    w = maxW
    h = w / aspect
  }
  return { x: 0, y: 0, w, h }
}

/** 绘制横幅：按 computeBannerLayout 的行盒落位 */
export function drawBannerStrip(
  ctx: Ctx2D,
  strip: { x: number; y: number; w: number; h: number },
  lines: BannerLines,
  spec: BannerSpec
): void {
  const { banner } = spec

  if (!spec.transparentBg) {
    ctx.fillStyle = banner.bgColor
    ctx.fillRect(strip.x, strip.y, strip.w, strip.h)
  }

  const layout = computeBannerLayout(strip, lines, spec, ({ text, weight, slotH }) =>
    measureInk(ctx, text, spec.family, weight, slotH).width
  )

  const draw = (text: string, box: BannerBox, weight: number, color: string) => {
    if (!text) return
    drawInkText(ctx, text, box.x, box.y, box.h, { family: spec.family, weight, color }, 'left')
  }

  draw(lines.rightTop, layout.rt, spec.mainWeight, banner.textColor)
  draw(lines.rightBottom, layout.rb, spec.subWeight, banner.subColor)
  draw(lines.leftTop, layout.lt, spec.mainWeight, banner.textColor)
  draw(lines.leftBottom, layout.lb, spec.subWeight, banner.subColor)

  if (layout.logo) {
    ctx.drawImage(spec.logo!, layout.logo.x, layout.logo.y, layout.logo.w, layout.logo.h)
  }

  if (layout.divider) {
    ctx.fillStyle = banner.dividerColor
    ctx.fillRect(layout.divider.x, layout.divider.y, layout.divider.w, layout.divider.h)
  }
}
