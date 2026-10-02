import type { BannerStyle, BrandDef } from '../types'
import { drawText, measureText, type Ctx2D, type TextStyle } from './canvas-utils'

export interface BannerLines {
  leftTop: string
  leftBottom: string
  rightTop: string
  rightBottom: string
}

export interface BannerSpec {
  banner: BannerStyle
  typographyScale: number
  brand?: BrandDef
  logo: ImageBitmap | null
  /** 卡片装裱内嵌时背景透明 */
  transparentBg?: boolean
}

interface ColumnStyle {
  size: number
  color: string
}

/**
 * 底部横幅四象限排版（picseal mi-classic / semi-utils standard1 的 Canvas 实现）。
 * 结构：[pad][左栏][logo][分隔线][右栏][pad]，logo position=left 时移到最左。
 * 右栏 rightAlign='near' 贴分隔线（小米徕卡官方风），'far' 贴右缘。
 */
export function drawBannerStrip(
  ctx: Ctx2D,
  strip: { x: number; y: number; w: number; h: number },
  lines: BannerLines,
  spec: BannerSpec
): void {
  const { banner, logo } = spec
  const scale = spec.typographyScale

  if (!spec.transparentBg) {
    ctx.fillStyle = banner.bgColor
    ctx.fillRect(strip.x, strip.y, strip.w, strip.h)
  }

  const padX = strip.h * banner.paddingX
  const gap = strip.h * 0.32
  const main: ColumnStyle = { size: strip.h * 0.33 * scale, color: banner.textColor }
  const sub: ColumnStyle = { size: strip.h * 0.235 * scale, color: banner.subColor }

  const leftW = columnWidth(ctx, lines.leftTop, main, lines.leftBottom, sub)
  const rightW = columnWidth(ctx, lines.rightTop, main, lines.rightBottom, sub)

  const logoH = logo ? strip.h * banner.logo.heightRatio : 0
  const logoW = logo ? logoH * (logo.width / logo.height) : 0
  const dividerW = banner.divider ? Math.max(1.2, strip.w * 0.0012) : 0
  const innerW = strip.w - padX * 2

  // 右栏布局：near = 左对齐紧跟分隔线；far = 贴右缘
  let cursorLeft: number
  let dividerX: number
  let logoX: number
  let rightColX: number

  if (banner.logo.position === 'left') {
    cursorLeft = padX
    logoX = cursorLeft
    dividerX = logo ? logoX + logoW + gap : cursorLeft
    rightColX = strip.w - padX - rightW
  } else {
    cursorLeft = padX
    const leftEnd = cursorLeft + leftW
    logoX = leftEnd + gap
    dividerX = logo ? logoX + logoW + gap * 0.9 : leftEnd + gap
    rightColX = banner.rightAlign === 'near' ? dividerX + dividerW + gap : strip.w - padX - rightW
  }

  // 底色横条内先画右栏（near 时紧贴分隔线），再画 logo/分隔线/左栏
  const cy = strip.y + strip.h / 2
  const drawColumn = (
    top: string,
    bottom: string,
    styleTop: ColumnStyle,
    styleBottom: ColumnStyle,
    x: number,
    align: 'left' | 'right'
  ) => {
    const hasTop = top.length > 0
    const hasBottom = bottom.length > 0
    if (hasTop) {
      const ty = hasBottom ? strip.y + strip.h * 0.375 : cy
      drawText(ctx, top, x, ty, { ...styleTop, weight: 600 }, align)
    }
    if (hasBottom) {
      const by = hasTop ? strip.y + strip.h * 0.7 : cy
      drawText(ctx, bottom, x, by, { ...styleBottom, weight: 400 }, align)
    }
  }

  drawColumn(lines.rightTop, lines.rightBottom, main, sub, rightColX, 'left')
  drawColumn(lines.leftTop, lines.leftBottom, main, sub, cursorLeft, 'left')

  if (logo && logoW > 0) {
    const logoY = cy - logoH / 2
    ctx.drawImage(logo, logoX, logoY, logoW, logoH)
  }

  if (banner.divider && dividerW > 0) {
    ctx.fillStyle = banner.dividerColor
    const top = strip.y + strip.h * 0.22
    const h = strip.h * 0.56
    ctx.fillRect(dividerX, top, dividerW, h)
  }

  void innerW
}

function columnWidth(
  ctx: Ctx2D,
  top: string,
  topStyle: ColumnStyle,
  bottom: string,
  bottomStyle: ColumnStyle
): number {
  const wTop = top ? measureText(ctx, top, { size: topStyle.size, weight: 600, color: topStyle.color }) : 0
  const wBottom = bottom
    ? measureText(ctx, bottom, { size: bottomStyle.size, weight: 400, color: bottomStyle.color })
    : 0
  return Math.max(wTop, wBottom)
}
