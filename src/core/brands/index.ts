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
    logo: '/brands/pentax.png'
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
    logo: '/brands/leica.png'
  },
  {
    id: 'nikon',
    match: ['nikon'],
    name: 'Nikon',
    logo: '/brands/nikon.png'
  },
  {
    id: 'canon',
    match: ['canon'],
    name: 'Canon',
    logo: '/brands/canon.png'
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
    logo: '/brands/olympus.png',
    logoOnDark: '/brands/olympus-dark.png'
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
    id: 'xmage',
    match: ['xmage', 'sigma'],
    name: 'sigma',
    logo: '/brands/xmage.png'
  },
  {
    id: 'hasselblad',
    match: ['hasselblad'],
    name: 'Hasselblad',
    logo: '/brands/hasselblad.png'
  }
]

export const DEFAULT_LOGO = '/brands/default-hd.png'

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

/** 罗马数字（代际后缀：Z 6II / Mark II / α7R V —— 官方命名均用罗马数字） */
function roman(n: number): string {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][n] ?? String(n)
}

/**
 * 代际数字罗马化（品牌感知）：
 * - Nikon：EXIF "NIKON Z 6_2" → 官方 "NIKON Z 6II"（下划线代数后缀）
 * - Canon："Canon EOS R6m2" → 官方 "Canon EOS R6 Mark II"
 * - Sony："ILCE-7RM5" → 官方 "α7R V"（α7M4 → α7 IV，M 系官方名不带 M）
 */
function romanizeGeneration(brandId: string | undefined, s: string): string {
  if (!s) return s
  if (brandId === 'nikon') {
    return s.replace(/(\d) ([0-9])$/, (_m, body: string, gen: string) => body + roman(Number(gen)))
  }
  if (brandId === 'canon') {
    return s.replace(/m([2-9])$/i, (_m, gen: string) => ` Mark ${roman(Number(gen))}`)
  }
  if (brandId === 'sony') {
    // EXIF 的 M 是代数标记（ILCE-7RM5 / 7M4 / 7CM2）：删除 M，代数罗马化（官方 α7R V / α7 IV / α7C II）
    return s.replace(/^α7([A-Z]*)M([2-5])$/, (_m, letters: string, gen: string) => `α7${letters} ${roman(Number(gen))}`)
  }
  return s
}

/**
 * 应用品牌美化规则并清理通用噪声（下划线、多余空格）。
 * 品牌前缀保留在机型名中（semi-utils 语义：CameraModelName 原样展示——
 * "NIKON Z 8"/"Canon EOS R5"/"LEICA M10"，品牌信息是出处的一部分，不剥离）。
 */
export function prettifyModel(brand: BrandDef | undefined, model?: string): string | undefined {
  if (!model) return undefined
  let out = model.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  for (const rule of brand?.modelTransforms ?? []) {
    out = out.replace(rule.pattern, rule.replace)
  }
  out = romanizeGeneration(brand?.id, out)
  return out.trim() || undefined
}
