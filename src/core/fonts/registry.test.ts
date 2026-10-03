import { describe, expect, it } from 'vitest'
import { FONT_FAMILIES, DEFAULT_FONT, getFontFamily, FONT_GROUP_LABELS } from './registry'

describe('字体注册表', () => {
  it('默认字体为 Archivo（非 MiSans）', () => {
    expect(DEFAULT_FONT).toBe('archivo')
    expect(getFontFamily(undefined).id).toBe('archivo')
    expect(getFontFamily('misans').id).toBe('misans')
    expect(getFontFamily('unknown-family').id).toBe('archivo')
  })

  it('每个家族的推荐字重都有对应字体文件', () => {
    for (const def of Object.values(FONT_FAMILIES)) {
      expect(def.latin[def.mainWeight], `${def.id} main ${def.mainWeight}`).toBeTruthy()
      expect(def.latin[def.subWeight], `${def.id} sub ${def.subWeight}`).toBeTruthy()
      expect(def.weights).toContain(def.mainWeight)
      expect(def.weights).toContain(def.subWeight)
    }
  })

  it('四族分组齐备且标签映射完整（symbol 组仅供渲染内部消费，不进 UI）', () => {
    const groups = new Set(Object.values(FONT_FAMILIES).map((f) => f.group))
    for (const group of groups) {
      if (group === 'symbol') continue
      expect(FONT_GROUP_LABELS[group]).toBeTruthy()
    }
    expect(groups.has('sans')).toBe(true)
    expect(groups.has('condensed')).toBe(true)
    expect(groups.has('serif')).toBe(true)
    expect(groups.has('calligraphy')).toBe(true)
    // 尼康 Z 专用符号字体：注册存在但不出现在 UI 分组
    expect(groups.has('symbol')).toBe(true)
    expect((FONT_GROUP_LABELS as Record<string, unknown>).symbol).toBeUndefined()
    expect(getFontFamily('nikon-z-symbol').latin[400]).toBe('/fonts/wm/special-alphabets-p04.otf')
  })

  it('CJK 家族提供 cjk 子集路径', () => {
    expect(getFontFamily('misans').cjk).toBeTruthy()
    expect(getFontFamily('lxgw-wenkai').cjk).toBeTruthy()
    expect(getFontFamily('smiley-sans').cjk).toBeTruthy()
    // 纯拉丁家族无需 cjk
    expect(getFontFamily('archivo').cjk).toBeUndefined()
  })

  it('文件路径规范（VF 家族允许同文件多字重）', () => {
    for (const def of Object.values(FONT_FAMILIES)) {
      for (const p of Object.values(def.latin)) expect(p).toMatch(/^\/fonts\//)
    }
  })
})
