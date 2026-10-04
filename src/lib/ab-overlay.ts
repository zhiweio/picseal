import type { WatermarkTemplate } from '@/core/types'

/** A/B 对位的画布信息：预览输出尺寸 + 照片实际绘制矩形（canvas 像素） */
export interface OverlayBox {
  width: number
  height: number
  photoRect: { x: number; y: number; w: number; h: number }
}

export interface ABOverlayStyle {
  left: string
  top: string
  width: string
  height: string
  objectFit: 'fill'
  clipPath: string
  borderRadius: string
}

const round4 = (v: number): number => Number(v.toFixed(4))
const pct = (v: number): string => `${round4(v)}%`
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/**
 * A/B 原图层样式：原图按渲染管线输出的 photoRect 精确覆盖照片区域。
 * 分割线右侧的画布装饰（横幅条/模糊背景/装裱底/补边）是水印新增物，
 * 原图中不存在 —— 由调用方在原图层之下垫模板 mountColor 底色遮蔽，
 * 呈现为"未印水印的同一张衬纸"，任何滑块位置整幅图都完整闭合。
 * 分割线位置（compare，占整幅画布宽的百分比）换算到图层局部坐标后再裁切，
 * 保证扫过装饰区时两侧始终是一条连续直线。
 */
export function abOverlayStyle(
  box: OverlayBox,
  compare: number,
  template: WatermarkTemplate
): ABOverlayStyle {
  const { width, height, photoRect: r } = box
  const frosted = template.layout === 'card' && template.canvas.mount === 'blur'
  // 圆角与渲染管线一致：雾面卡片 = 比例 × 照片高（未配置时 2% 兜底），其余 = 比例 × 画布宽
  const radiusRatio =
    template.canvas.cornerRadius > 0 ? template.canvas.cornerRadius : frosted ? 0.02 : 0
  return {
    left: pct((r.x / width) * 100),
    top: pct((r.y / height) * 100),
    width: pct((r.w / width) * 100),
    height: pct((r.h / height) * 100),
    objectFit: 'fill',
    clipPath: `inset(0 0 0 ${pct(clamp01(((compare / 100) * width - r.x) / r.w) * 100)})`,
    borderRadius: `${round4(radiusRatio * (frosted ? r.h : width))}px`
  }
}
