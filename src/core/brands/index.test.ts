import { describe, expect, it } from 'vitest'
import { BRANDS, matchBrand, prettifyModel } from './index'
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
