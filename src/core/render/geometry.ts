/**
 * 雾面卡片几何 —— semi-utils static/blur.json 管线的纯函数移植。
 *
 * 管线：清晰照片(圆角 2%h + 投影 1%h) + 机型(3%h Bold) + 参数(3%h Light)
 *       垂直拼接（间距 3%h）→ 居中叠于 2× 放大的模糊背景 → 裁切 135%vw×135%vh、
 *       窗口上移 3%vh。照片始终清晰居中，四角为雾面背景。
 *
 * 全部输入输出以"照片像素"为单位（调用方统一乘渲染缩放）。
 */

export interface FrostedLayout {
  /** 最终画布尺寸（= 135% 照片） */
  out: { w: number; h: number }
  /** 2× 模糊背景的绘制位置与尺寸 */
  backdrop: { x: number; y: number; w: number; h: number }
  /** 清晰照片位置（含左右留白居中） */
  photo: { x: number; y: number; w: number; h: number }
  /** 机型行墨迹顶部 y（居中锚点为 x = out.w/2） */
  modelY: number
  /** 参数行墨迹顶部 y */
  paramsY: number
  modelH: number
  paramsH: number
  /** 照片圆角半径 */
  radius: number
}

export interface FrostedOptions {
  /** 机型行墨迹高，比例占照片高（默认 0.03） */
  modelHRatio?: number
  /** 参数行墨迹高（默认 0.03） */
  paramsHRatio?: number
  /** 行间距（默认 0.03） */
  spacingRatio?: number
  /** 圆角（默认 0.02） */
  radiusRatio?: number
  /** 裁切倍率（默认 1.35） */
  crop?: number
  /** 裁切窗口垂直偏移，负值上移（默认 −0.03） */
  cropOffsetY?: number
  /** 背景放大倍率（默认 2） */
  backdropScale?: number
}

export function computeFrostedLayout(
  pw: number,
  ph: number,
  hasModel: boolean,
  hasParams: boolean,
  opts: FrostedOptions = {}
): FrostedLayout {
  const modelHRatio = opts.modelHRatio ?? 0.03
  const paramsHRatio = opts.paramsHRatio ?? 0.03
  const spacingRatio = opts.spacingRatio ?? 0.03
  const radiusRatio = opts.radiusRatio ?? 0.02
  const crop = opts.crop ?? 1.35
  const cropOffsetY = opts.cropOffsetY ?? -0.03
  const backdropScale = opts.backdropScale ?? 2

  const modelH = ph * modelHRatio
  const paramsH = ph * paramsHRatio
  const spacing = ph * spacingRatio

  const outW = pw * crop
  const outH = ph * crop

  // 背景：2× 放大的模糊原图，窗口居中 + 垂直偏移（offset 负值 = 窗口上移）
  const backdropW = pw * backdropScale
  const backdropH = ph * backdropScale
  const backdropX = -(backdropW - outW) / 2
  const backdropY = -(backdropH - outH) / 2 - ph * cropOffsetY

  // 主体列：[清晰照片, 机型, 参数]
  const columnH =
    ph + (hasModel ? spacing + modelH : 0) + (hasParams ? spacing + paramsH : 0)
  const photo = {
    x: (outW - pw) / 2,
    y: (outH - columnH) / 2,
    w: pw,
    h: ph
  }

  return {
    out: { w: outW, h: outH },
    backdrop: { x: backdropX, y: backdropY, w: backdropW, h: backdropH },
    photo,
    modelY: photo.y + ph + (hasModel ? spacing : 0),
    paramsY: photo.y + ph + (hasModel ? spacing + modelH + spacing : 0),
    modelH,
    paramsH,
    radius: ph * radiusRatio
  }
}
