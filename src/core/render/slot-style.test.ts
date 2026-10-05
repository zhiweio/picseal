import { describe, expect, it } from 'vitest'
import { resolveSlotStyle } from './slot-style'
import type { FieldSlot } from '../types'

const base = {
  family: 'archivo' as const,
  weight: 600,
  color: '#000000'
}

const slot = (style?: FieldSlot['style']): FieldSlot => ({ enabled: true, content: '$model', style })

describe('resolveSlotStyle（槽位样式继承解析）', () => {
  it('无覆写：逐字段回退到行默认', () => {
    expect(resolveSlotStyle(slot(), base)).toEqual({
      family: 'archivo',
      weight: 600,
      italic: false,
      color: '#000000',
      scale: 1,
      colorOverridden: false
    })
  })

  it('部分覆写：未声明字段逐项继承', () => {
    expect(resolveSlotStyle(slot({ color: '#ff0000' }), base)).toEqual({
      family: 'archivo',
      weight: 600,
      italic: false,
      color: '#ff0000',
      scale: 1,
      colorOverridden: true
    })
    expect(resolveSlotStyle(slot({ weight: 300, italic: true }), base)).toEqual({
      family: 'archivo',
      weight: 300,
      italic: true,
      color: '#000000',
      scale: 1,
      colorOverridden: false
    })
  })

  it('字号乘数：覆写生效于行基准（1 = 跟随模板，不与全局缩放重复相乘）', () => {
    expect(resolveSlotStyle(slot({ scale: 1.5 }), base).scale).toBe(1.5)
    expect(resolveSlotStyle(slot({ scale: 0.5 }), base).scale).toBe(0.5)
  })

  it('覆写家族非法（预设手改）时回退全局家族，渲染不静默失败', () => {
    expect(resolveSlotStyle(slot({ font: 'not-a-font' }), base).family).toBe('archivo')
    expect(resolveSlotStyle(slot({ font: 'puhuiti' }), base).family).toBe('puhuiti')
  })

  it('尼康 Z 符号字体不得作为行字体（品牌锁定字形，任何覆写一律回退全局家族）', () => {
    expect(resolveSlotStyle(slot({ font: 'nikon-z-symbol' }), base).family).toBe('archivo')
    // 即便同时覆写字重/斜体，家族仍回退
    const r = resolveSlotStyle(slot({ font: 'nikon-z-symbol', weight: 300, italic: true }), base)
    expect(r.family).toBe('archivo')
    expect(r.weight).toBe(300)
    expect(r.italic).toBe(true)
  })

  it('colorOverridden 仅在显式声明颜色时为真（Z 符号跟随行色的判据）', () => {
    expect(resolveSlotStyle(slot({ scale: 2 }), base).colorOverridden).toBe(false)
    expect(resolveSlotStyle(slot({ color: '#123456' }), base).colorOverridden).toBe(true)
  })

  it('空 style 对象等同无覆写', () => {
    expect(resolveSlotStyle(slot({}), base)).toEqual(resolveSlotStyle(slot(), base))
  })
})
