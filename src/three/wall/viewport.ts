/**
 * 响应式取景 —— 移植自 Rhine-Music-Demo viewport-layout.ts / music-camera.ts（MIT，© LBEILC / RonaldDeng）。
 * 场景与 DOM 必须一起跨越竖屏边界；取景只动相机，永不缩放卡片。
 */

/** 宽高比低于此值视为竖屏（场景与 CSS 同时消费） */
export const PORTRAIT_ASPECT = 1.05

export function isPortraitViewport(width: number, height: number): boolean {
  return Math.max(1, width) / Math.max(1, height) < PORTRAIT_ASPECT
}

export type LayoutKind = 'portrait' | 'compact' | 'desktop'

export function viewportLayout(
  width: number,
  height: number,
  coarse: boolean
): { width: number; height: number; scale: number; kind: LayoutKind } {
  width = Math.max(1, width)
  height = Math.max(1, height)
  const portrait = isPortraitViewport(width, height)
  const compact = portrait || width < 1100 || (coarse && height < 600)
  const scale = compact ? 1 : height / 1080
  return {
    width: width / scale,
    height: height / scale,
    scale,
    kind: portrait ? 'portrait' : compact ? 'compact' : 'desktop'
  }
}

/** span = 可见世界高度；detailX/Y 为屏幕比例锚点 */
export interface Framing {
  span: number
  portrait: boolean
  previewY: number
  detailX: number
  detailY: number
}

export function archiveFraming(
  width: number,
  height: number,
  span: number,
  detail: number,
  compact: boolean
): Framing {
  width = Math.max(1, width)
  height = Math.max(1, height)
  const aspect = width / height
  const portrait = isPortraitViewport(width, height)
  const baseSpan = span + (5.9 - span) * detail
  const portraitDetailSpan = Math.max(
    6.3 / aspect,
    (3.7 * height) / Math.max(100, 0.54 * height - 156)
  )
  const viewSpan = portrait
    ? Math.max(baseSpan, 8.4 / aspect + (portraitDetailSpan - 8.4 / aspect) * detail)
    : Math.max(baseSpan, (baseSpan * (16 / 9)) / aspect)
  return {
    span: viewSpan,
    portrait,
    // 竖屏的选中卡刻意放在标题与导航之上方
    previewY: portrait ? 0.36 : 0.5,
    detailX: portrait ? 0.5 : compact ? 0.27 : 550 / 1920,
    detailY: portrait ? 0.27 + 34 / height : compact ? 0.49 : 560 / 1080
  }
}

/** 横屏每侧预留头部空间，超宽屏再多一点（正 camera-right/up 移动 = 画面中墙面偏左/偏下） */
export function musicArchiveOffset(width: number, height: number): { x: number; y: number } {
  if (isPortraitViewport(width, height)) return { x: 0, y: 0 }
  const aspect = Math.max(1, width) / Math.max(1, height)
  const wide = smoothstep01((aspect - 16 / 9) / (21 / 9 - 16 / 9))
  return { x: 0.035 * wide, y: 0.08 + 0.02 * wide }
}

function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * x * (10 + x * (-15 + 6 * x))
}

/** 触摸滑动 → 主轴判定（36px 阈值、1.3:1 主次比、1400ms 上限） */
export function swipeDirection(
  dx: number,
  dy: number,
  elapsed: number
): { axis: 'lane' | 'row'; direction: 1 | -1 } | null {
  const major = Math.max(Math.abs(dx), Math.abs(dy))
  const minor = Math.min(Math.abs(dx), Math.abs(dy))
  if (major < 36 || major < minor * 1.3 || elapsed > 1400) return null
  const horizontal = Math.abs(dx) > Math.abs(dy)
  return {
    axis: horizontal ? 'lane' : 'row',
    direction: (horizontal ? dx : dy) < 0 ? 1 : -1
  }
}
