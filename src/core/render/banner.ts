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
  typographyScale: number
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
 * 全部坐标为墨迹盒（ink box）语义：{x, y} 是墨迹左上角。
 *
 * - bannerH = photoH × heightRatio（bottom_margin = 12% 图高）
 * - 槽位墨迹高 = bannerH × 0.30；middle = bannerH × 0.05；common = strip.w × 0.02
 * - 文本块在 margin 区内垂直居中（elem_margin）
 * - 上行底线对齐（rt 底 = lt 底）、下行底线对齐（rb 底 = lb 底）
 * - rightAlign near：rt.x = rb.x = min(两行右对齐 x)，右栏成块贴分隔线
 * - logo 高 = elemH（宽按比例，宽 logo 钳制不超过 strip 宽 1/4）、位于分隔线左侧
 * - 分隔线高 = elemH × 1.1、宽 = max(1.2, strip.w × 0.003)、y = footer + elemMargin − elemH × 0.05
 */
export function computeBannerLayout(
  strip: { x: number; y: number; w: number; h: number },
  photoH: number,
  lines: BannerLines,
  spec: Pick<BannerSpec, 'banner' | 'typographyScale' | 'mainWeight' | 'subWeight' | 'logo'>,
  measure: MeasureFn
): BannerLayout {
  const { banner } = spec
  const bannerH = photoH * banner.heightRatio * spec.typographyScale
  const slotH = bannerH * 0.3
  const middle = bannerH * 0.05
  const common = strip.w * 0.02

  const wLT = lines.leftTop ? measure({ text: lines.leftTop, weight: spec.mainWeight, slotH }) : 0
  const wLB = lines.leftBottom ? measure({ text: lines.leftBottom, weight: spec.subWeight, slotH }) : 0
  const wRT = lines.rightTop ? measure({ text: lines.rightTop, weight: spec.mainWeight, slotH }) : 0
  const wRB = lines.rightBottom ? measure({ text: lines.rightBottom, weight: spec.subWeight, slotH }) : 0

  const ltH = lines.leftTop ? slotH : slotH
  const lbH = slotH
  const rtH = slotH
  const rbH = slotH

  const elemH = Math.max(ltH + lbH, rtH + rbH) + middle
  const elemMargin = (bannerH - elemH) / 2
  const footerY = strip.y + (strip.h - bannerH) / 2 + elemMargin

  // 左栏（logo 在左时右移一个 logo 位）
  const leftLogoW =
    spec.logo && banner.logo.position === 'left' ? leftLogoBox(spec.logo, bannerH, strip.w).w : 0
  const leftX = strip.x + leftLogoW + common

  const lt: BannerBox = { x: leftX, y: footerY + lbH + middle, w: wLT, h: ltH }
  const lb: BannerBox = { x: leftX, y: footerY, w: wLB, h: lbH }

  // 右栏
  const rightEnd = strip.x + strip.w
  const rtFarX = rightEnd - wRT - common
  const rbFarX = rightEnd - wRB - common
  const nearX = Math.min(rtFarX, rbFarX)
  const rt: BannerBox = {
    x: banner.rightAlign === 'near' ? nearX : rtFarX,
    y: lt.y + ltH - rtH,
    w: wRT,
    h: rtH
  }
  const rb: BannerBox = {
    x: banner.rightAlign === 'near' ? nearX : rbFarX,
    y: lb.y + lbH - rbH,
    w: wRB,
    h: rbH
  }

  // 分隔线 + logo（semi-utils：logo 在分隔线左侧）
  const maxRightW = Math.max(wRT, wRB)
  const delimW = banner.divider ? Math.max(1.2, strip.w * 0.003) : 0
  let divider: BannerBox | null = null
  let logo: BannerBox | null = null

  if (banner.logo.position === 'right') {
    const delimX = rightEnd - maxRightW - 2 * common - delimW
    if (banner.divider && delimW > 0) {
      divider = { x: delimX, y: footerY - elemH * 0.05, w: delimW, h: elemH * 1.1 }
    }
    if (spec.logo) {
      const box = rightLogoBox(spec.logo, elemH, strip.w)
      logo = { x: delimX - common - box.w, y: footerY + (elemH - box.h) / 2, w: box.w, h: box.h }
    }
  } else if (spec.logo) {
    const box = leftLogoBox(spec.logo, bannerH, strip.w)
    logo = { x: strip.x, y: footerY + (bannerH - box.h) / 2, w: box.w, h: box.h }
    if (banner.divider && delimW > 0) {
      divider = { x: strip.x + box.w + common, y: footerY - elemH * 0.05, w: delimW, h: elemH * 1.1 }
    }
  }

  return { bannerH, slotH, elemH, elemMargin, lt, lb, rt, rb, logo, divider }
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

/** 绘制横幅：按 computeBannerLayout 的墨迹盒落位 */
export function drawBannerStrip(
  ctx: Ctx2D,
  strip: { x: number; y: number; w: number; h: number },
  photoH: number,
  lines: BannerLines,
  spec: BannerSpec
): void {
  const { banner } = spec

  if (!spec.transparentBg) {
    ctx.fillStyle = banner.bgColor
    ctx.fillRect(strip.x, strip.y, strip.w, strip.h)
  }

  const layout = computeBannerLayout(strip, photoH, lines, spec, ({ text, weight, slotH }) =>
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
