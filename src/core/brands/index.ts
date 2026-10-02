import type { BrandDef } from '../types'

/**
 * 品牌数据库 —— 数据驱动匹配。
 * logo 资产来自 picseal 原项目（SVG）与 semi-utils（PNG，哈苏/宾得/荣耀）。
 * match 顺序即匹配优先级：pentax 的 make 是 "RICOH IMAGING"，必须排在 ricoh 之前。
 */
export const BRANDS: BrandDef[] = [
  {
    id: 'sony',
    match: ['sony'],
    name: 'Sony',
    logo: '/brands/sony.png',
    logoOnDark: '/brands/sony-dark.png',
    modelTransforms: [{ pattern: /^ILCE-/, replace: 'α' }]
  },
  {
    id: 'pentax',
    match: ['pentax', 'ricoh imaging'],
    name: 'Pentax',
    logo: '/brands/pentax.png',
    modelTransforms: [{ pattern: /^PENTAX\s*/, replace: '' }]
  },
  {
    id: 'ricoh',
    match: ['ricoh'],
    name: 'Ricoh',
    logo: '/brands/ricoh.png'
  },
  {
    id: 'leica',
    match: ['leica'],
    name: 'Leica',
    logo: '/brands/leica.png',
    modelTransforms: [{ pattern: /^Leica\s*/i, replace: '' }]
  },
  {
    id: 'nikon',
    match: ['nikon'],
    name: 'Nikon',
    logo: '/brands/nikon.png',
    modelTransforms: [
      { pattern: /^NIKON\s*/i, replace: '' },
      { pattern: /^Z(\d)/, replace: 'Z $1' }
    ]
  },
  {
    id: 'canon',
    match: ['canon'],
    name: 'Canon',
    logo: '/brands/canon.png',
    modelTransforms: [
      { pattern: /^Canon\s*/i, replace: '' },
      { pattern: /^EOS-?/i, replace: 'EOS ' }
    ]
  },
  {
    id: 'fujifilm',
    match: ['fujifilm', 'fujitsu'],
    name: 'Fujifilm',
    logo: '/brands/fujifilm.png',
    modelTransforms: [{ pattern: /^X-/i, replace: 'X-' }]
  },
  {
    id: 'panasonic',
    match: ['panasonic'],
    name: 'Panasonic',
    logo: '/brands/panasonic.png',
    modelTransforms: [{ pattern: /^(DMC|DC)-/, replace: 'LUMIX ' }]
  },
  {
    id: 'olympus',
    match: ['olympus', 'om digital', 'om-digital'],
    name: 'OM SYSTEM',
    logo: '/brands/olympus.png'
  },
  {
    id: 'apple',
    match: ['apple'],
    name: 'Apple',
    logo: '/brands/apple.png',
    modelTransforms: [{ pattern: /^iPhone\s*/i, replace: 'iPhone ' }]
  },
  {
    id: 'huawei',
    match: ['huawei'],
    name: 'HUAWEI',
    logo: '/brands/huawei.png'
  },
  {
    id: 'honor',
    match: ['honor'],
    name: 'HONOR',
    logo: '/brands/honor.png'
  },
  {
    id: 'xiaomi',
    match: ['xiaomi', 'redmi'],
    name: 'Xiaomi',
    logo: '/brands/xiaomi.png',
    modelTransforms: [{ pattern: /^M\d{4}[A-Z]\d?[A-Z]*/i, replace: 'Xiaomi' }]
  },
  {
    id: 'dji',
    match: ['dji'],
    name: 'DJI',
    logo: '/brands/dji.png'
  },
  {
    id: 'insta360',
    match: ['insta360', 'arashi vision'],
    name: 'Insta360',
    logo: '/brands/insta360.png'
  },
  {
    id: 'hasselblad',
    match: ['hasselblad'],
    name: 'Hasselblad',
    logo: '/brands/hasselblad.png'
  }
]

export const DEFAULT_LOGO = '/brands/default.png'

/** 按 make → model 顺序做包含匹配，返回品牌或 undefined */
export function matchBrand(make?: string, model?: string): BrandDef | undefined {
  const hay1 = (make ?? '').toLowerCase()
  const hay2 = (model ?? '').toLowerCase()
  if (hay1) {
    for (const brand of BRANDS) {
      if (brand.match.some((kw) => hay1.includes(kw))) return brand
    }
  }
  if (hay2) {
    for (const brand of BRANDS) {
      if (brand.match.some((kw) => hay2.includes(kw))) return brand
    }
  }
  return undefined
}

/** 应用品牌美化规则并清理通用噪声（下划线、多余空格） */
export function prettifyModel(brand: BrandDef | undefined, model?: string): string | undefined {
  if (!model) return undefined
  let out = model.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  for (const rule of brand?.modelTransforms ?? []) {
    out = out.replace(rule.pattern, rule.replace)
  }
  return out.trim() || undefined
}
