import { describe, expect, it } from 'vitest'
import { parseTemplate } from './schema'
import { getBuiltinTemplate } from './builtin'
import type { WatermarkTemplate } from '../types'

const base = (): WatermarkTemplate => JSON.parse(JSON.stringify(getBuiltinTemplate('banner')))

describe('templateSchema（槽位高级字体覆写字段）', () => {
  it('内置模板基线解析通过', () => {
    expect(() => parseTemplate(base())).not.toThrow()
  })

  it('旧模板（无 style 字段）解析通过，style 保持未定义', () => {
    const t = parseTemplate(base())
    expect(t.banner.leftTop.style).toBeUndefined()
  })

  it('槽位覆写 roundtrip：解析后逐字段保真', () => {
    const t = base()
    t.banner.leftTop.style = { font: 'puhuiti', scale: 1.5, weight: 300, italic: true, color: '#ff0000' }
    t.corner.lines[0]!.style = { scale: 0.8 }
    const parsed = parseTemplate(JSON.parse(JSON.stringify(t)))
    expect(parsed.banner.leftTop.style).toEqual({
      font: 'puhuiti',
      scale: 1.5,
      weight: 300,
      italic: true,
      color: '#ff0000'
    })
    expect(parsed.corner.lines[0]!.style).toEqual({ scale: 0.8 })
  })

  it('非法颜色被拒绝', () => {
    const t = base()
    t.banner.leftTop.style = { color: 'red' }
    expect(() => parseTemplate(t)).toThrow()
  })

  it('字号超出 0.5–2 被拒绝', () => {
    const t = base()
    t.banner.leftTop.style = { scale: 2.5 }
    expect(() => parseTemplate(t)).toThrow()
    t.banner.leftTop.style = { scale: 0.3 }
    expect(() => parseTemplate(t)).toThrow()
  })

  it('字重非整数或越界被拒绝', () => {
    const t = base()
    t.banner.leftTop.style = { weight: 350.5 }
    expect(() => parseTemplate(t)).toThrow()
    t.banner.leftTop.style = { weight: 50 }
    expect(() => parseTemplate(t)).toThrow()
  })

  it('非法字体家族被拒绝', () => {
    const t = base()
    t.banner.leftTop.style = { font: 'comic-sans' }
    expect(() => parseTemplate(JSON.parse(JSON.stringify(t)))).toThrow()
  })
})
