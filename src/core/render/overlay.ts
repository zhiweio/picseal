import type { CenterStyle, CornerStyle } from '../types'
import { MARK_SYMBOL_FONT, type FontFamilyId } from '../fonts/registry'
import {
  drawImageSmoothed,
  drawInkSegments,
  drawInkText,
  ensureContrastColor,
  getInkBlock,
  markSegments,
  roundedRectPath,
  sampleLuminance,
  type Ctx2D
} from './canvas-utils'

/**
 * 角标排版 —— semi-utils normal1/normal2 锚点移植：
 * normal1：文字墨迹高 = 3% 图高，右下对齐，边距 5% 图高；
 * normal2：右缘锚定 93% 图宽、底线 95% 图高，墨迹高 2% 图高。
 * 首行主字重主色，其余行副字重副色。
 * 绘制前采样文字区亮度，对比不足自动切换黑/白（R-05，BAN-007）。
 */
export function drawCorner(
  ctx: Ctx2D,
  width: number,
  height: number,
  lines: string[],
  corner: CornerStyle,
  family: FontFamilyId,
  typographyScale: number,
  mainWeight: number,
  subWeight: number
): void {
  if (lines.length === 0) return
  const size = height * corner.sizeRatio * typographyScale
  const insetY = height * 0.05
  const anchorX = corner.position === 'bottom-right' ? width * 0.93 : width * 0.07
  const align = corner.position === 'bottom-right' ? 'right' : 'left'
  const lineGap = size * (1 + corner.lineGap)
  const shadow = corner.textShadow
    ? { shadowColor: 'rgba(0,0,0,0.45)', shadowBlur: size * 0.4, shadowOffsetY: size * 0.06 }
    : undefined

  // 品牌色语义强的模板（图注橙）可关闭自动切换（contrastFix=false）
  let mainColor = corner.color
  let subColor = corner.subColor
  if (corner.contrastFix !== false) {
    const sampleX = corner.position === 'bottom-right' ? width * 0.45 : width * 0.05
    const luma = sampleLuminance(ctx, sampleX, height * 0.84, width * 0.5, height * 0.1)
    mainColor = ensureContrastColor(corner.color, luma)
    subColor = ensureContrastColor(corner.subColor, luma)
  }

  if (shadow) {
    ctx.shadowColor = shadow.shadowColor
    ctx.shadowBlur = shadow.shadowBlur
    ctx.shadowOffsetY = shadow.shadowOffsetY
  }

  lines.forEach((text, i) => {
    const weight = i === 0 && !corner.allSub ? mainWeight : subWeight
    const color = i === 0 ? mainColor : subColor
    // 底线锚定：最末行行盒底 = height − insetY，向上逐行排
    const lineBottom = height - insetY - (lines.length - 1 - i) * lineGap
    drawInkText(ctx, text, anchorX, lineBottom - size, size, { family, weight, color }, align)
  })

  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
}

/** 居中标识：底部 scrim + 中央 logo + 小字（semi-utils center_logo 的照片内变体） */
export function drawCenterLogo(
  ctx: Ctx2D,
  width: number,
  height: number,
  logo: ImageBitmap | null,
  caption: string,
  center: CenterStyle,
  family: FontFamilyId,
  typographyScale: number,
  subWeight: number,
  mark?: { color?: string; family: FontFamilyId }
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
    const capY = cy + height * 0.03
    const luma = sampleLuminance(ctx, width * 0.3, capY, width * 0.4, size * 1.4)
    const captionColor = ensureContrastColor(center.captionColor, luma)
    if (mark && caption.includes('Z')) {
      drawInkSegments(
        ctx,
        markSegments(caption, captionColor, mark.color ?? captionColor, 'Z', mark.family),
        width / 2,
        capY,
        size,
        { family, weight: subWeight, color: captionColor },
        'center'
      )
    } else {
      drawInkText(ctx, caption, width / 2, capY, size, { family, weight: subWeight, color: captionColor }, 'center')
    }
  }
}

/**
 * 雾面卡片中央文字列 —— blur.json 的文字部分：
 * 机型（Bold）+ 参数（Light），**墨迹语义**（blur.json trim:true：行高 = 墨迹高，
 * 行间距 = 墨迹间隙，官方 blur 样例 ink:gap = 1:1:1）。
 * 绘制走 InkBlock 超采样位图；颜色由调用方按背景亮度解析后传入（R-05）。
 */
export function drawCenterStack(
  ctx: Ctx2D,
  centerX: number,
  modelY: number,
  paramsY: number,
  model: string,
  params: string,
  opts: {
    family: FontFamilyId
    mainWeight: number
    subWeight: number
    modelH: number
    paramsH: number
    mark?: { color?: string; family: FontFamilyId }
    modelColor?: string
    paramsColor?: string
  }
): void {
  const modelColor = opts.modelColor ?? '#ffffff'
  const paramsColor = opts.paramsColor ?? '#ffffff'

  const drawLine = (text: string, y: number, inkH: number, weight: number, color: string, markOn: boolean) => {
    if (!text) return
    const mark = markOn && opts.mark ? opts.mark : undefined
    const block = getInkBlock(opts.family, weight, text, color, mark)
    if (block) {
      const w = block.naturalW * (inkH / block.naturalH)
      drawImageSmoothed(ctx, block.canvas, centerX - w / 2, y, w, inkH)
      return
    }
    const style = { family: opts.family, weight, color }
    if (mark) {
      drawInkSegments(
        ctx,
        markSegments(text, color, mark.color ?? color, 'Z', mark.family),
        centerX,
        y,
        inkH,
        style,
        'center'
      )
    } else {
      drawInkText(ctx, text, centerX, y, inkH, style, 'center')
    }
  }

  drawLine(model, modelY, opts.modelH, opts.mainWeight, modelColor, true)
  drawLine(params, paramsY, opts.paramsH, opts.subWeight, paramsColor, true)
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
