import { describe, expect, it } from 'vitest'
import { BRANDS, matchBrand, prettifyModel, resolveBrandMark } from './index'
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID, getBuiltinTemplate } from '../templates/builtin'
import { parseTemplate } from '../templates/schema'

describe('brand matching', () => {
  it('matches sony by make and transforms ILCE', () => {
    const brand = matchBrand('SONY', 'ILCE-7CM2')
    expect(brand?.id).toBe('sony')
    // 官方命名：α 系代数用罗马数字（α7C II）
    expect(prettifyModel(brand, 'ILCE-7CM2')).toBe('α7C II')
  })

  it('keeps brand prefixes in model names（semi-utils 语义，品牌是出处的一部分）', () => {
    const nikon = matchBrand('NIKON CORPORATION', 'NIKON Z 8')
    expect(prettifyModel(nikon, 'NIKON Z 8')).toBe('NIKON Z 8')
    const canon = matchBrand('Canon', 'Canon EOS R5')
    expect(prettifyModel(canon, 'Canon EOS R5')).toBe('Canon EOS R5')
    const leica = matchBrand('Leica', 'LEICA M10')
    expect(prettifyModel(leica, 'LEICA M10')).toBe('LEICA M10')
  })

  it('romanizes generation suffixes（官方命名 II/III/IV/V）', () => {
    const nikon = matchBrand('NIKON CORPORATION', 'NIKON Z 6_2')
    expect(prettifyModel(nikon, 'NIKON Z 6_2')).toBe('NIKON Z 6II')
    expect(prettifyModel(nikon, 'NIKON Z 50_2')).toBe('NIKON Z 50II')
    expect(prettifyModel(nikon, 'NIKON D850')).toBe('NIKON D850')
    expect(prettifyModel(nikon, 'NIKON Z fc')).toBe('NIKON Z fc')
    const canon = matchBrand('Canon', 'Canon EOS R6m2')
    expect(prettifyModel(canon, 'Canon EOS R6m2')).toBe('Canon EOS R6 Mark II')
    const sony = matchBrand('SONY', 'ILCE-7RM5')
    expect(prettifyModel(sony, 'ILCE-7RM5')).toBe('α7R V')
    expect(prettifyModel(sony, 'ILCE-7M4')).toBe('α7 IV')
  })

  it('matches pentax before ricoh', () => {
    expect(matchBrand('RICOH IMAGING COMPANY, LTD.', 'PENTAX K-3')?.id).toBe('pentax')
    expect(matchBrand('RICOH', 'GR III')?.id).toBe('ricoh')
  })

  it('falls back to model matching', () => {
    expect(matchBrand(undefined, 'Apple iPhone 15 Pro')?.id).toBe('apple')
  })

  it('returns undefined for unknown makers', () => {
    expect(matchBrand('ACME Corp', 'ACME-1')).toBeUndefined()
  })

  it('has a logo for every brand and a default', () => {
    for (const brand of BRANDS) {
      expect(brand.logo).toMatch(/^\/brands\//)
    }
  })

  it('wires semi-utils asset migration (R-12)', () => {
    // olympus 双配色（logoOnDark）
    expect(BRANDS.find((b) => b.id === 'olympus')?.logoOnDark).toBe('/brands/olympus-dark.png')
    // xmage 素材已接入 BRANDS
    expect(BRANDS.find((b) => b.id === 'xmage')?.logo).toBe('/brands/xmage.png')
    // 未知品牌回退走高清 default（80px 放大必虚）
    expect(matchBrand('ACME', 'X-1')).toBeUndefined()
  })
})

describe('builtin templates', () => {
  it('contains the seven presets with unique ids', () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(7)
    expect(new Set(BUILTIN_TEMPLATES.map((t) => t.id)).size).toBe(7)
    expect(getBuiltinTemplate(DEFAULT_TEMPLATE_ID)?.id).toBe(DEFAULT_TEMPLATE_ID)
    // 经典/标准横幅已合并为单模板（用户决策）
    expect(BUILTIN_TEMPLATES.some((t) => t.id === 'banner')).toBe(true)
    expect(BUILTIN_TEMPLATES.some((t) => t.id === 'mi-classic' || t.id === 'banner-pro')).toBe(false)
  })

  it('all builtins pass schema validation', () => {
    for (const template of BUILTIN_TEMPLATES) {
      const round = parseTemplate(JSON.parse(JSON.stringify(template)))
      expect(round.id).toBe(template.id)
    }
  })

  it('rejects malformed templates', () => {
    expect(() => parseTemplate({ id: 'x' })).toThrow()
    expect(() => parseTemplate({ ...getBuiltinTemplate('banner'), layout: 'bogus' })).toThrow()
  })
})

describe('brand glyph marks（品牌锁定字形，数据驱动）', () => {
  it('nikon glyph 数据完整：NIKON 字标（Nexa）+ Z 符号（Z 系门控）+ 代际数字', () => {
    const nikon = BRANDS.find((b) => b.id === 'nikon')
    expect(nikon?.glyph?.wordmark).toEqual({
      match: 'NIKON',
      family: 'brand-nikon',
      weight: 400,
      italic: true
    })
    expect(nikon?.glyph?.symbol).toEqual({
      char: 'Z',
      family: 'nikon-z-symbol',
      modelPattern: /\bZ/
    })
    expect(nikon?.glyph?.numerals).toMatchObject({
      family: 'archivo',
      weight: 700,
      spacing: 0.08
    })
  })

  it('resolveBrandMark：Z 系机型 → 符号 + 字标 + 数字；D850 → 字标 + 数字（无符号）', () => {
    const nikon = BRANDS.find((b) => b.id === 'nikon')
    const z8 = resolveBrandMark(nikon, 'NIKON Z 8', '#ff0000')
    expect(z8?.symbol).toEqual({ char: 'Z', family: 'nikon-z-symbol', color: '#ff0000' })
    expect(z8?.wordmark).toMatchObject({ match: 'NIKON' })
    expect(z8?.numerals).toMatchObject({ family: 'archivo', weight: 700 })
    const d850 = resolveBrandMark(nikon, 'NIKON D850')
    // R-04 门控：无 Z 机型不得使用符号 Z 字形
    expect(d850?.symbol).toBeUndefined()
    expect(d850?.wordmark).toMatchObject({ match: 'NIKON' })
    expect(d850?.numerals).toMatchObject({ family: 'archivo' })
  })

  it('resolveBrandMark：索尼（α 符号 + SST 字标/数字）与佳能（Mark II 数字）', () => {
    const sony = BRANDS.find((b) => b.id === 'sony')
    const a7rv = resolveBrandMark(sony, 'α7R V')
    expect(a7rv?.symbol).toEqual({ char: 'α', family: 'brand-sony-alpha', color: undefined })
    expect(a7rv?.wordmark).toMatchObject({ match: 'SONY', family: 'brand-sony' })
    expect(a7rv?.numerals).toMatchObject({ family: 'brand-sony' })
    const canon = BRANDS.find((b) => b.id === 'canon')
    const r6ii = resolveBrandMark(canon, 'Canon EOS R6 Mark II')
    expect(r6ii?.wordmark).toMatchObject({ match: 'CANON', family: 'brand-canon' })
    expect(r6ii?.numerals).toMatchObject({ family: 'archivo', weight: 700 })
  })

  it('resolveBrandMark：无 glyph 品牌（leica/hasselblad 阿拉伯数字传统）返回 undefined', () => {
    const leica = BRANDS.find((b) => b.id === 'leica')
    expect(resolveBrandMark(leica, 'LEICA M11')).toBeUndefined()
    const hasselblad = BRANDS.find((b) => b.id === 'hasselblad')
    expect(resolveBrandMark(hasselblad, 'X2D 100C')).toBeUndefined()
    expect(resolveBrandMark(undefined, 'NIKON Z 8')).toBeUndefined()
  })

  it('glyph 数据快照：所有声明 glyph 的品牌字段结构合法', () => {
    for (const brand of BRANDS) {
      const g = brand.glyph
      if (!g) continue
      if (g.wordmark) {
        expect(g.wordmark.match.length).toBeGreaterThan(0)
        expect(g.wordmark.weight).toBeGreaterThan(0)
      }
      if (g.symbol) {
        expect(g.symbol.char.length).toBe(1)
      }
      if (g.numerals) {
        expect(g.numerals.pattern.source).toContain('$')
        expect(g.numerals.weight).toBeGreaterThan(0)
        expect(g.numerals.spacing ?? 0).toBeLessThan(0.3)
      }
    }
  })
})
