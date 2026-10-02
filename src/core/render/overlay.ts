import type { CenterStyle, CornerStyle } from '../types'
import {
  drawSegments,
  drawText,
  measureText,
  roundedRectPath,
  type Ctx2D,
  type TextStyle
} from './canvas-utils'

/** 角标排版：底部一行或多行（semi-utils normal1/normal2） */
export function drawCorner(
  ctx: Ctx2D,
  width: number,
  height: number,
  lines: string[],
  corner: CornerStyle,
  typographyScale: number
): void {
  if (lines.length === 0) return
  const size = width * corner.sizeRatio * typographyScale
  const inset = width * 0.035
  const lineH = size * (1 + corner.lineGap)
  const startX = corner.position === 'bottom-right' ? width - inset : inset
  const align = corner.position === 'bottom-right' ? 'right' : 'left'
  const shadow = corner.textShadow
    ? { shadowColor: 'rgba(0,0,0,0.45)', shadowBlur: size * 0.4, shadowOffsetY: size * 0.06 }
    : undefined

  if (shadow) {
    ctx.shadowColor = shadow.shadowColor
    ctx.shadowBlur = shadow.shadowBlur
    ctx.shadowOffsetY = shadow.shadowOffsetY
  }

  lines.forEach((text, i) => {
    const style: TextStyle = {
      size,
      weight: i === 0 ? 600 : 400,
      color: i === 0 ? corner.color : corner.subColor
    }
    const y = height - inset - (lines.length - 1 - i) * lineH
    drawText(ctx, text, startX, y, style, align, 'alphabetic')
  })

  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
}

/** 居中标识：底部 scrim + 中央 logo + 小字（semi-utils center_logo） */
export function drawCenterLogo(
  ctx: Ctx2D,
  width: number,
  height: number,
  logo: ImageBitmap | null,
  caption: string,
  center: CenterStyle,
  typographyScale: number,
  markColor?: string
): void {
  if (center.scrim) {
    const scrimH = height * 0.3
    const grad = ctx.createLinearGradient(0, height - scrimH, 0, height)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, 'rgba(0,0,0,0.38)')
    ctx.fillStyle = grad
    ctx.fillRect(0, height - scrimH, width, scrimH)
  }

  const cy = height * 0.86
  if (logo && center.logoRatio > 0) {
    const logoH = width * center.logoRatio
    const logoW = logoH * (logo.width / logo.height)
    ctx.drawImage(logo, width / 2 - logoW / 2, cy - logoH - height * 0.012, logoW, logoH)
  }

  if (caption) {
    const size = width * 0.022 * typographyScale
    const style: TextStyle = { size, weight: 400, color: center.captionColor }
    const capY = cy + height * 0.03
    if (markColor) {
      drawMarked(ctx, caption, width / 2, capY, style, markColor)
    } else {
      drawText(ctx, caption, width / 2, capY, style, 'center', 'middle')
    }
  }
}

/** 雾面卡片中央文字：机型（含 Z 红标）+ 参数（semi-utils blur / nikon_blur） */
export function drawCenterStack(
  ctx: Ctx2D,
  width: number,
  height: number,
  top: string,
  bottom: string,
  opts: { scale: number; markColor?: string }
): void {
  const mainSize = width * 0.052 * opts.scale
  const subSize = width * 0.028 * opts.scale
  const mainStyle: TextStyle = { size: mainSize, weight: 700, color: '#ffffff' }
  const subStyle: TextStyle = { size: subSize, weight: 400, color: 'rgba(255,255,255,0.92)' }

  const hasTop = top.length > 0
  const hasBottom = bottom.length > 0
  const groupH = (hasTop ? mainSize : 0) + (hasTop && hasBottom ? mainSize * 0.55 : 0) + (hasBottom ? subSize : 0)
  let y = height / 2 - groupH / 2 + mainSize / 2

  if (hasTop) {
    if (opts.markColor) {
      drawMarked(ctx, top, width / 2, y, mainStyle, opts.markColor)
    } else {
      drawText(ctx, top, width / 2, y, mainStyle, 'center', 'middle')
    }
  }
  if (hasBottom) {
    y += (hasTop ? mainSize * 0.55 + subSize / 2 : 0)
    drawText(ctx, bottom, width / 2, y, subStyle, 'center', 'middle')
  }
}

/** 把文本中的高亮字符（默认 'Z'）用 markColor 绘制 —— 尼康 Z 款 */
export function drawMarked(
  ctx: Ctx2D,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
  markColor: string,
  markChar = 'Z'
): void {
  const segments: Array<{ text: string; color: string }> = []
  for (const ch of text) {
    const last = segments[segments.length - 1]
    const color = ch === markChar ? markColor : style.color
    if (last && last.color === color) last.text += ch
    else segments.push({ text: ch, color })
  }
  drawSegments(ctx, segments, x, y, style, 'center', 'middle')
}

/** 装裱底板（白边/圆角/投影） */
export function drawMount(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  color: string,
  shadowPx: number
): void {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.28)'
  ctx.shadowBlur = shadowPx
  ctx.shadowOffsetY = shadowPx * 0.35
  ctx.fillStyle = color
  roundedRectPath(ctx, x, y, w, h, radius)
  ctx.fill()
  ctx.restore()
}
