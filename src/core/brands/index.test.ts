import { describe, expect, it } from 'vitest'
import { BRANDS, matchBrand, prettifyModel } from './index'
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID, getBuiltinTemplate } from '../templates/builtin'
import { parseTemplate } from '../templates/schema'

describe('brand matching', () => {
  it('matches sony by make and transforms ILCE', () => {
    const brand = matchBrand('SONY', 'ILCE-7CM2')
    expect(brand?.id).toBe('sony')
    expect(prettifyModel(brand, 'ILCE-7CM2')).toBe('α7CM2')
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
})

describe('builtin templates', () => {
  it('contains the eight presets with unique ids', () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(8)
    expect(new Set(BUILTIN_TEMPLATES.map((t) => t.id)).size).toBe(8)
    expect(getBuiltinTemplate(DEFAULT_TEMPLATE_ID)?.id).toBe(DEFAULT_TEMPLATE_ID)
  })

  it('all builtins pass schema validation', () => {
    for (const template of BUILTIN_TEMPLATES) {
      const round = parseTemplate(JSON.parse(JSON.stringify(template)))
      expect(round.id).toBe(template.id)
    }
  })

  it('rejects malformed templates', () => {
    expect(() => parseTemplate({ id: 'x' })).toThrow()
    expect(() => parseTemplate({ ...getBuiltinTemplate('mi-classic'), layout: 'bogus' })).toThrow()
  })
})
