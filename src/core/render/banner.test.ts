import { describe, expect, it } from 'vitest'
import { computeBannerLayout, type MeasureFn } from './banner'
import type { BannerStyle } from '../types'

const slot = (content: string) => ({ enabled: true, content })

const banner: BannerStyle = {
  heightRatio: 0.12,
  bgColor: '#ffffff',
  divider: true,
  leftTop: slot('$model'),
  leftBottom: slot('$datetime'),
  rightTop: slot('$param'),
  rightBottom: slot('$gps'),
  logo: { enabled: true, position: 'right', heightRatio: 0.82 },
  textColor: '#000000',
  subColor: '#242424',
  dividerColor: '#D8D8D6',
  rightAlign: 'near'
}

/** strip.h 已含 typography.scale（bannerStripRect 的唯一来源语义）；y=0 便于断言 */
const strip = { x: 0, y: 0, w: 3000, h: 240 }

/** 假测量：每字符 40px × (slotH/240)（线性于行盒高，模拟等比字号） */
const measure: MeasureFn = ({ text, slotH }) => text.length * 40 * (slotH / 240)

describe('computeBannerLayout（semi-utils WatermarkFilter 公式）', () => {
  it('bannerH = strip.h（条带高度唯一来源，字号缩放由 strip 携带）', () => {
    const layout = computeBannerLayout(strip, { leftTop: 'AB', leftBottom: 'CD', rightTop: 'EF', rightBottom: 'GH' }, { banner, mainWeight: 700, subWeight: 400, logo: null }, measure)
    expect(layout.bannerH).toBe(strip.h)
    expect(layout.slotH).toBeCloseTo(strip.h * 0.3)
  })

  it('文本块在条带内垂直居中，scale≠1 时文字块不会越出条带', () => {
    // 关键回归：历史上 strip 不含 scale 导致 footerY 负偏移、文字漂到照片上
    for (const h of [120, 240, 360]) {
      const layout = computeBannerLayout({ ...strip, h }, { leftTop: 'AB', leftBottom: 'CD', rightTop: 'EF', rightBottom: 'GH' }, { banner, mainWeight: 700, subWeight: 400, logo: null }, measure)
      expect(layout.lt.y).toBeGreaterThanOrEqual(0)
      expect(layout.rb.y + layout.rb.h).toBeLessThanOrEqual(h)
    }
    const layout = computeBannerLayout(strip, { leftTop: 'AB', leftBottom: 'CD', rightTop: 'EF', rightBottom: 'GH' }, { banner, mainWeight: 700, subWeight: 400, logo: null }, measure)
    const middle = strip.h * 0.05
    const elemH = layout.slotH * 2 + middle
    expect(layout.elemH).toBeCloseTo(elemH)
    expect(layout.lt.y).toBeCloseTo((strip.h - elemH) / 2)
    expect(layout.lb.y).toBeCloseTo((strip.h - elemH) / 2 + layout.slotH + middle)
  })

  it('上/下行盒顶分别对齐（同 fontPx ⇒ 基线对齐）', () => {
    const layout = computeBannerLayout(strip, { leftTop: 'AB', leftBottom: 'CD', rightTop: 'EF', rightBottom: 'GH' }, { banner, mainWeight: 700, subWeight: 400, logo: null }, measure)
    expect(layout.rt.y).toBe(layout.lt.y)
    expect(layout.rb.y).toBe(layout.lb.y)
  })

  it('rightAlign near：右栏共享同一 x（块状贴分隔线）', () => {
    const lines = { leftTop: 'AB', leftBottom: 'CD', rightTop: 'EFGHIJ', rightBottom: 'KLMN' }
    const layout = computeBannerLayout(strip, lines, { banner, mainWeight: 700, subWeight: 400, logo: null }, measure)
    expect(layout.rt.x).toBe(layout.rb.x)
    expect(layout.rt.x).toBe(strip.w - (6 * 40 * 72) / 240 - strip.w * 0.02)
  })

  it('rightAlign far：各行分别右对齐', () => {
    const lines = { leftTop: 'AB', leftBottom: 'CD', rightTop: 'EFGHIJ', rightBottom: 'KLMN' }
    const farBanner = { ...banner, rightAlign: 'far' as const }
    const layout = computeBannerLayout(strip, lines, { banner: farBanner, mainWeight: 700, subWeight: 400, logo: null }, measure)
    expect(layout.rt.x).toBe(strip.w - (6 * 40 * 72) / 240 - strip.w * 0.02)
    expect(layout.rb.x).toBe(strip.w - (4 * 40 * 72) / 240 - strip.w * 0.02)
  })

  it('左栏起点 = 2% 画布宽（无左 logo）', () => {
    const layout = computeBannerLayout(strip, { leftTop: 'AB', leftBottom: 'CD', rightTop: 'EF', rightBottom: 'GH' }, { banner, mainWeight: 700, subWeight: 400, logo: null }, measure)
    expect(layout.lt.x).toBeCloseTo(strip.w * 0.02)
  })

  it('分隔线 = max(1.2, 0.3% 条带宽) × 1.1 elemH，位于右栏左侧', () => {
    const fakeLogo = { width: 100, height: 100 } as ImageBitmap
    const layout = computeBannerLayout(strip, { leftTop: 'AB', leftBottom: 'CD', rightTop: 'EF', rightBottom: 'GH' }, { banner, mainWeight: 700, subWeight: 400, logo: fakeLogo }, measure)
    expect(layout.divider).not.toBeNull()
    expect(layout.divider!.w).toBeCloseTo(Math.max(1.2, strip.w * 0.003))
    expect(layout.divider!.h).toBeCloseTo(layout.elemH * 1.1)
    expect(layout.logo!.x + layout.logo!.w).toBeCloseTo(layout.divider!.x - strip.w * 0.02)
  })

  it('超宽收缩：文本行超宽时行盒缩小并装回条带', () => {
    // 每字符 800px 的超长行，远超条带可用宽
    const wide: MeasureFn = ({ text }) => text.length * 800
    const lines = { leftTop: 'AAAA', leftBottom: 'BBBB', rightTop: 'CCCCCCCC', rightBottom: 'DDDD' }
    const layout = computeBannerLayout(strip, lines, { banner, mainWeight: 700, subWeight: 400, logo: null }, wide)
    expect(layout.lineH).toBeLessThan(layout.slotH)
    expect(layout.lineH).toBeGreaterThanOrEqual(layout.slotH * 0.5)
    // 行盒仍在各自槽位内垂直居中，文本块整体不越界
    expect(layout.lt.y).toBeGreaterThanOrEqual(0)
    expect(layout.rb.y + layout.rb.h).toBeLessThanOrEqual(strip.h)
    expect(layout.rt.y).toBe(layout.lt.y)
    expect(layout.rb.y).toBe(layout.lb.y)
  })
})
