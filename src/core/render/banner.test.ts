import { describe, expect, it } from 'vitest'
import {
  BANNER_METRICS,
  bannerRowStyle,
  computeBannerHeight,
  computeBannerLayout,
  solveBannerHeight,
  type BannerLines,
  type BannerSpec,
  type MeasureFn
} from './banner'
import type { BannerStyle, WatermarkTemplate } from '../types'
import type { InkMark } from './canvas-utils'

const slot = (content: string) => ({ enabled: true, content })

const banner: BannerStyle = {
  heightRatio: 0.1,
  bgColor: '#ffffff',
  divider: true,
  leftTop: slot('$model'),
  leftBottom: slot('$datetime'),
  rightTop: slot('$param'),
  rightBottom: slot('$gps'),
  // 官方 WatermarkFilter：logo 高 = 文字块高
  logo: { enabled: true, position: 'right', heightRatio: 1.0 },
  textColor: '#000000',
  subColor: '#242424',
  dividerColor: '#D8D8D6',
  rightAlign: 'near'
}

/** strip.h 已含 typography.scale（bannerStripRect 的唯一来源语义）；y=0 便于断言 */
const strip = { x: 0, y: 0, w: 3000, h: 240 }

/** 假测量：墨迹宽 = 字符数 × 40 × (墨迹高/240)（线性于墨迹高，模拟等比字号） */
const measure: MeasureFn = ({ text, slotH }) => text.length * 40 * (slotH / 240)

const fakeLogo = { width: 100, height: 100 } as ImageBitmap

const spec = (
  overrides: Partial<BannerStyle> = {},
  logo: ImageBitmap | null = fakeLogo
): Pick<BannerSpec, 'banner' | 'family' | 'mainWeight' | 'subWeight' | 'logo'> => ({
  banner: { ...banner, ...overrides },
  family: 'archivo',
  mainWeight: 600,
  subWeight: 400,
  logo
})

const lines: BannerLines = {
  leftTop: 'NIKON Z 8',
  leftBottom: '2025-04-21 11:43',
  rightTop: '300mm f/6.3 1/1250s ISO500',
  rightBottom: "42°00'00\"N 71°00'00\"W"
}

// 派生几何（与引擎常量同步的独立推导，防引擎漂移）
const M = BANNER_METRICS
const pad = strip.w * M.paddingRatio // 60
const minGap = pad * M.minGapFactor // 30
const delimW = Math.max(1.2, strip.w * M.dividerWRatio) // 9
const slotH = strip.h * M.slotRatio // 72
const middle = strip.h * M.middleRatio // 12
const subSlotH = slotH / M.boldInkRatio // 63.7
const elemFull = slotH + subSlotH + middle // 147.7
const logoH = elemFull * banner.logo.heightRatio // 147.7（aspect=1 → w 同值）
const right = (r: { x: number; w: number }) => r.x + r.w

describe('computeBannerLayout v3（墨迹盒语义，semi-utils 同构）', () => {
  it('比例系统：主行墨迹 30%、副行 = 主行 / 1.13、logo 高 = 文字块高', () => {
    const layout = computeBannerLayout(strip, lines, spec(), measure)
    expect(layout.bannerH).toBe(strip.h)
    expect(layout.slotH).toBeCloseTo(slotH)
    // 主行（上排）墨迹高 = slotH；副行（下排）= slotH / 1.13
    expect(layout.lt.h).toBeCloseTo(slotH)
    expect(layout.lb.h).toBeCloseTo(subSlotH)
    expect(layout.rb.h / layout.rt.h).toBeCloseTo(1 / M.boldInkRatio)
    // logo 贴满文字块高（官方 elem_height）
    expect(layout.logo!.h).toBeCloseTo(logoH)
  })

  it('墨迹底跨栏对齐：上/下行左右栏墨迹底 y 相等', () => {
    const layout = computeBannerLayout(strip, lines, spec(), measure)
    expect(layout.lt.y + layout.lt.h).toBe(layout.rt.y + layout.rt.h)
    expect(layout.lb.y + layout.lb.h).toBe(layout.rb.y + layout.rb.h)
  })

  it('单行内容垂直居中（BAN-006）', () => {
    const layout = computeBannerLayout(strip, { ...lines, leftBottom: '', rightTop: '', rightBottom: '' }, spec(), measure)
    expect(layout.lb.w).toBe(0)
    expect(layout.rt.w).toBe(0)
    const blockTop = (strip.h - layout.lineH) / 2
    expect(layout.lt.y).toBeCloseTo(blockTop)
  })

  it('rightAlign near：右栏共享同一左缘', () => {
    const layout = computeBannerLayout(strip, lines, spec(), measure)
    expect(layout.rt.x).toBe(layout.rb.x)
    const maxR = Math.max(layout.rt.w, layout.rb.w)
    expect(layout.rt.x).toBeCloseTo(strip.w - pad - maxR)
  })

  it('rightAlign far：各行分别右对齐', () => {
    const layout = computeBannerLayout(strip, lines, spec({ rightAlign: 'far' }), measure)
    expect(layout.rt.x).toBeCloseTo(strip.w - pad - layout.rt.w)
    expect(layout.rb.x).toBeCloseTo(strip.w - pad - layout.rb.w)
  })

  it('结构性无叠压：左栏/右堆叠/右栏按序排列且保底 minGap（默认参数，BAN-001/002）', () => {
    const layout = computeBannerLayout(strip, lines, spec(), measure)
    const leftColRight = Math.max(right(layout.lt), right(layout.lb))
    expect(layout.logo).not.toBeNull()
    expect(layout.divider).not.toBeNull()
    expect(layout.logo!.x).toBeGreaterThanOrEqual(leftColRight + minGap)
    expect(layout.divider!.x).toBeGreaterThanOrEqual(right(layout.logo!) + pad)
    expect(layout.rt.x).toBeGreaterThanOrEqual(right(layout.divider!) + pad)
  })

  it('右栏全空：分隔线隐藏，logo 贴右内边距（BAN-005）', () => {
    const layout = computeBannerLayout(strip, { ...lines, rightTop: '', rightBottom: '' }, spec(), measure)
    expect(layout.divider).toBeNull()
    expect(layout.logo).not.toBeNull()
    expect(right(layout.logo!)).toBeCloseTo(strip.w - pad)
  })

  it('logo 关闭：无 logo 且分隔线贴右栏左侧', () => {
    const layout = computeBannerLayout(strip, lines, spec({}, null), measure)
    expect(layout.logo).toBeNull()
    expect(layout.divider).not.toBeNull()
    expect(right(layout.divider!)).toBeCloseTo(layout.rt.x - pad)
  })

  it('divider=false：无分隔线，logo 与右栏之间保留 padding', () => {
    const layout = computeBannerLayout(strip, lines, spec({ divider: false }), measure)
    expect(layout.divider).toBeNull()
    const maxR = Math.max(layout.rt.w, layout.rb.w)
    expect(layout.logo!.x + layout.logo!.w).toBeCloseTo(strip.w - pad - maxR - pad)
  })

  it('装裱卡片左 logo：不贴合、靠左垂直居中（用户反馈）', () => {
    const cardSpec = { ...spec({ logo: { enabled: true, position: 'left', heightRatio: 1.0 } }), transparentBg: true }
    const layout = computeBannerLayout(strip, lines, cardSpec, measure)
    const h = strip.h * M.cardLeftLogoHRatio
    expect(layout.logo!.h).toBeCloseTo(h)
    expect(layout.logo!.y).toBeCloseTo(strip.y + (strip.h - h) / 2)
    expect(layout.lt.x).toBe(layout.logo!.x + layout.logo!.w + pad + delimW + pad)
  })

  it('左 logo 分支：相对条带顶居中（BAN-003），分隔线右侧保足 padding', () => {
    const leftSpec = spec({ logo: { enabled: true, position: 'left', heightRatio: 1.0 } })
    const layout = computeBannerLayout(strip, lines, leftSpec, measure)
    const h = strip.h * M.leftLogoHRatio
    expect(h).toBeCloseTo(strip.h)
    expect(layout.logo!.h).toBeCloseTo(strip.h)
    expect(layout.logo!.y).toBe(strip.y)
    expect(layout.lt.x).toBeCloseTo(layout.logo!.x + layout.logo!.w + pad + delimW + pad)
    expect(layout.divider!.x + delimW).toBeCloseTo(layout.lt.x - pad)
  })

  it('右 logo 高度消费 banner.logo.heightRatio', () => {
    const a = computeBannerLayout(strip, lines, spec(), measure)
    const b = computeBannerLayout(strip, lines, spec({ logo: { enabled: true, position: 'right', heightRatio: 0.8 } }), measure)
    expect(a.logo!.h).toBeCloseTo(elemFull)
    expect(b.logo!.h).toBeCloseTo(elemFull * 0.8)
  })

  it('宽字标等比钳制：logo 宽不超过 0.28 条带宽', () => {
    const wide = { width: 10000, height: 100 } as ImageBitmap
    const layout = computeBannerLayout(strip, lines, spec({}, wide), measure)
    expect(layout.logo!.w).toBeLessThanOrEqual(strip.w * M.rightLogoMaxWRatio)
  })

  it('三级退化：超宽先缩字（下限 0.7），触底后截断加省略号且不叠压', () => {
    const longLines: BannerLines = {
      ...lines,
      leftTop: 'N'.repeat(9),
      leftBottom: 'D'.repeat(16),
      rightTop: 'P'.repeat(400),
      rightBottom: 'G'.repeat(21)
    }
    const layout = computeBannerLayout(strip, longLines, spec(), measure)
    expect(layout.lineH).toBeCloseTo(slotH * M.shrinkFloor)
    expect(layout.truncated).toBe(true)
    expect(layout.rt.text.endsWith('…')).toBe(true)
    const leftColRight = Math.max(right(layout.lt), right(layout.lb))
    const rightColLeft = Math.min(layout.rt.x, layout.rb.x)
    expect(leftColRight).toBeLessThanOrEqual(rightColLeft - minGap)
    expect(right(layout.rt)).toBeLessThanOrEqual(strip.w - pad + 0.5)
  })

  it('未触底的收缩不需要截断', () => {
    const mid: BannerLines = { ...lines, rightTop: 'P'.repeat(250) }
    const layout = computeBannerLayout(strip, mid, spec(), measure)
    expect(layout.truncated).toBe(false)
    expect(layout.lineH).toBeLessThan(slotH)
    expect(layout.lineH).toBeGreaterThanOrEqual(slotH * M.shrinkFloor)
  })
})

describe('computeBannerHeight（横幅高度单一来源）', () => {
  const t = (scale: number, heightRatio = 0.1): WatermarkTemplate =>
    ({ banner: { heightRatio }, typography: { scale } }) as unknown as WatermarkTemplate

  it('scale=1 时严格等于 heightRatio×photoH（历史渲染一致）', () => {
    expect(computeBannerHeight(t(1), 2200)).toBeCloseTo(220)
  })

  it('scale>1 内容超界时自动扩展（BAN-004）', () => {
    const h = computeBannerHeight(t(1.4), 2200)
    expect(h).toBeGreaterThan(220)
    const blockRatio = M.slotRatio + M.slotRatio / M.boldInkRatio + M.middleRatio
    expect(h).toBeCloseTo((1.4 * blockRatio * 220) / M.contentFill)
  })

  it('scale<1 只缩内容不缩横幅（只增不减）', () => {
    expect(computeBannerHeight(t(0.6), 2200)).toBeCloseTo(220)
  })

  it('槽位字号覆写参与块高预估：scale=1 + 槽位放大时横幅增长；无覆写时不变', () => {
    const slot = (scale?: number) => ({ enabled: true, content: '$model', ...(scale ? { style: { scale } } : {}) })
    const plain = { banner: { heightRatio: 0.1 }, typography: { scale: 1 } } as unknown as WatermarkTemplate
    expect(computeBannerHeight(plain, 2200)).toBeCloseTo(220)
    const grown = {
      banner: { heightRatio: 0.1, leftTop: slot(1.5), leftBottom: slot(), rightTop: slot(), rightBottom: slot(2) },
      typography: { scale: 1 }
    } as unknown as WatermarkTemplate
    const h = computeBannerHeight(grown, 2200)
    expect(h).toBeGreaterThan(220)
    const blockRatio = M.slotRatio * 1.5 + (M.slotRatio / M.boldInkRatio) * 2 + M.middleRatio
    expect(h).toBeCloseTo((blockRatio * 220) / M.contentFill)
  })
})

describe('槽位样式（高级字体覆写）', () => {
  const scaleSlot = (scale: number) => ({ enabled: true, content: '$model', style: { scale } })
  const styleSpec = (
    slotStyles: BannerSpec['slotStyles'],
    overrides: Partial<BannerStyle> = {}
  ) => ({ ...spec(overrides), slotStyles })

  it('槽位字号乘数：上行行高 = slotH × scale，下行 = subSlotH × scale', () => {
    const layout = computeBannerLayout(
      strip,
      lines,
      styleSpec({ leftTop: { ...bannerRowStyle(spec(), 'leftTop'), scale: 1.5 } }),
      measure
    )
    expect(layout.lt.h).toBeCloseTo(slotH * 1.5)
    expect(layout.rt.h).toBeCloseTo(slotH)
    expect(layout.lb.h).toBeCloseTo(subSlotH)
  })

  it('同带墨迹底线对齐保持：左行放大后与右行墨迹底齐平，块高随最大行增长', () => {
    const layout = computeBannerLayout(
      strip,
      lines,
      styleSpec({ leftTop: { ...bannerRowStyle(spec(), 'leftTop'), scale: 1.5 } }),
      measure
    )
    expect(layout.lt.y + layout.lt.h).toBeCloseTo(layout.rt.y + layout.rt.h)
    expect(layout.rt.y).toBeCloseTo(layout.lt.y + layout.lt.h - layout.rt.h)
  })

  it('下行放大：带内底线对齐 + 块高 = 上带 + middle + 下带最大值', () => {
    const layout = computeBannerLayout(
      strip,
      lines,
      styleSpec({
        leftBottom: { ...bannerRowStyle(spec(), 'leftBottom'), scale: 2 },
        rightBottom: { ...bannerRowStyle(spec(), 'rightBottom'), scale: 1 }
      }),
      measure
    )
    expect(layout.lb.h).toBeCloseTo(subSlotH * 2)
    expect(layout.rb.h).toBeCloseTo(subSlotH)
    expect(layout.lb.y + layout.lb.h).toBeCloseTo(layout.rb.y + layout.rb.h)
    const blockH = slotH + middle + subSlotH * 2
    expect(layout.elemMargin).toBeCloseTo((strip.h - blockH) / 2)
  })

  it('测量收到每行解析后的家族/字重/斜体', () => {
    const seen: Array<{ text: string; family: string; weight: number; italic: boolean }> = []
    const spy: MeasureFn = (input) => {
      seen.push({ text: input.text, family: input.family, weight: input.weight, italic: input.italic })
      return measure(input)
    }
    computeBannerLayout(
      strip,
      lines,
      styleSpec({
        rightTop: { family: 'bebas-neue', weight: 400, italic: true, color: '#ff0000', scale: 1, colorOverridden: true },
        leftBottom: { ...bannerRowStyle(spec(), 'leftBottom'), italic: true }
      }),
      spy
    )
    const rt = seen.find((s) => s.text === lines.rightTop)
    expect(rt).toMatchObject({ family: 'bebas-neue', weight: 400, italic: true })
    const lb = seen.find((s) => s.text === lines.leftBottom)
    expect(lb).toMatchObject({ family: 'archivo', weight: 400, italic: true })
    const lt = seen.find((s) => s.text === lines.leftTop)
    expect(lt).toMatchObject({ family: 'archivo', weight: 600, italic: false })
  })

  it('全默认（无 slotStyles）时退回模板全局：主/副字重与家族', () => {
    const layout = computeBannerLayout(strip, lines, spec(), measure)
    expect(layout.rt.h).toBeCloseTo(slotH)
    expect(layout.rb.h).toBeCloseTo(subSlotH)
  })

  it('槽位放大参与收缩与截断判定：放大右上行会更早触底', () => {
    const mid: BannerLines = { ...lines, rightTop: 'P'.repeat(250) }
    const plain = computeBannerLayout(strip, mid, spec(), measure)
    const scaled = computeBannerLayout(
      strip,
      mid,
      styleSpec({ rightTop: { ...bannerRowStyle(spec(), 'rightTop'), scale: 1.6 } }),
      measure
    )
    expect(scaled.lineH).toBeLessThan(plain.lineH)
    expect(scaled.truncated).toBe(true)
    expect(scaled.rt.h).toBeCloseTo(slotH * M.shrinkFloor * 1.6)
  })

  it('solveBannerHeight：槽位放大后返回的高度渲染不截断', () => {
    const template = {
      banner: { ...banner, leftTop: scaleSlot(1.4), leftBottom: scaleSlot(1), rightTop: scaleSlot(1), rightBottom: scaleSlot(1) },
      typography: { scale: 1 }
    } as unknown as WatermarkTemplate
    const h = solveBannerHeight(template, strip.w, 2200, lines, 'archivo', 600, 400, undefined, 1, {
      leftTop: { family: 'archivo', weight: 600, italic: false, color: banner.textColor, scale: 1.4, colorOverridden: false }
    })
    const layout = computeBannerLayout(
      { x: 0, y: 0, w: strip.w, h: h },
      lines,
      { ...spec(), slotStyles: { leftTop: { family: 'archivo', weight: 600, italic: false, color: banner.textColor, scale: 1.4, colorOverridden: false } } },
      measure
    )
    expect(layout.truncated).toBe(false)
  })

  it('bannerRowStyle 缺省回退：主行 mainWeight/textColor、副行 subWeight/subColor', () => {
    expect(bannerRowStyle(spec(), 'leftTop')).toEqual({
      family: 'archivo',
      weight: 600,
      italic: false,
      color: banner.textColor,
      scale: 1,
      colorOverridden: false
    })
    expect(bannerRowStyle(spec(), 'rightBottom')).toEqual({
      family: 'archivo',
      weight: 400,
      italic: false,
      color: banner.subColor,
      scale: 1,
      colorOverridden: false
    })
  })

  it('槽位门控：marks 仅含 leftTop（机型槽位）时，测量只对左上行携带 mark', () => {
    const brandMark: InkMark = {
      symbol: { char: 'Z', family: 'nikon-z-symbol', color: '#ff0000' },
      wordmark: { match: 'NIKON', family: 'archivo', weight: 800, italic: true }
    }
    const seen: Array<{ text: string; mark: unknown }> = []
    const spy: MeasureFn = (input) => {
      seen.push({ text: input.text, mark: input.mark })
      return measure(input)
    }
    computeBannerLayout(strip, lines, { ...spec(), marks: { leftTop: brandMark } }, spy)
    const lt = seen.find((s) => s.text === lines.leftTop)
    const lb = seen.find((s) => s.text === lines.leftBottom)
    const rt = seen.find((s) => s.text === lines.rightTop)
    // 机型槽位携带 mark；其余槽位（镜头/参数/时间）如常渲染——NIKKOR Z 的 Z 不切换符号字形
    expect(lt?.mark).toEqual(brandMark)
    expect(lb?.mark).toBeUndefined()
    expect(rt?.mark).toBeUndefined()
  })
})
