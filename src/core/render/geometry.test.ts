import { describe, expect, it } from 'vitest'
import { computeFrostedLayout } from './geometry'

describe('computeFrostedLayout（semi-utils blur.json 管线）', () => {
  const pw = 3000
  const ph = 2000

  it('画布 = 135% 照片尺寸', () => {
    const layout = computeFrostedLayout(pw, ph, true, true)
    expect(layout.out.w).toBeCloseTo(pw * 1.35)
    expect(layout.out.h).toBeCloseTo(ph * 1.35)
  })

  it('清晰照片居中、文字列在照片下方（间距 3% 高）', () => {
    const layout = computeFrostedLayout(pw, ph, true, true)
    expect(layout.photo.x).toBeCloseTo((layout.out.w - pw) / 2)
    const spacing = ph * 0.03
    expect(layout.modelY).toBeCloseTo(layout.photo.y + ph + spacing)
    expect(layout.paramsY).toBeCloseTo(layout.modelY + ph * 0.03 + spacing)
  })

  it('主体列整体在画布内垂直居中', () => {
    const layout = computeFrostedLayout(pw, ph, true, true)
    const columnH = ph + ph * 0.03 + ph * 0.03 + ph * 0.03 + ph * 0.03
    expect(layout.photo.y).toBeCloseTo((layout.out.h - columnH) / 2)
  })

  it('背景 = 2× 放大且覆盖窗口（含 -3%h 上移偏移）', () => {
    const layout = computeFrostedLayout(pw, ph, true, true)
    expect(layout.backdrop.w).toBeCloseTo(pw * 2)
    expect(layout.backdrop.h).toBeCloseTo(ph * 2)
    // 窗口在背景内的 y = (2-1.35)/2·ph − 0.03ph → 背景 y = −0.295ph
    expect(layout.backdrop.y).toBeCloseTo(-0.295 * ph)
    expect(layout.backdrop.x).toBeCloseTo(-0.325 * pw)
  })

  it('模糊背景完全覆盖 135% 窗口（不留透明缝隙，画幅扩展时同理）', () => {
    for (const [w, h] of [[pw, ph], [1000, 4000], [4000, 1000]] as const) {
      const layout = computeFrostedLayout(w, h, true, true)
      expect(layout.backdrop.x).toBeLessThanOrEqual(0)
      expect(layout.backdrop.y).toBeLessThanOrEqual(0)
      expect(layout.backdrop.x + layout.backdrop.w).toBeGreaterThanOrEqual(layout.out.w)
      expect(layout.backdrop.y + layout.backdrop.h).toBeGreaterThanOrEqual(layout.out.h)
    }
  })

  it('无文字行时照片独占主体列', () => {
    const layout = computeFrostedLayout(pw, ph, false, false)
    expect(layout.photo.y).toBeCloseTo((layout.out.h - ph) / 2)
    expect(layout.modelY).toBeCloseTo(layout.photo.y + ph)
  })

  it('圆角 = 2% 照片高（可覆写）', () => {
    expect(computeFrostedLayout(pw, ph, true, true).radius).toBeCloseTo(ph * 0.02)
    expect(computeFrostedLayout(pw, ph, true, true, { radiusRatio: 0.05 }).radius).toBeCloseTo(ph * 0.05)
  })
})
