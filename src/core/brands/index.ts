import type { BrandDef } from '../types'
import type { InkMark } from '../render/canvas-utils'

/**
 * 代际罗马数字后缀 pattern 工厂（BrandGlyphMark.numerals 数据引用，避免各品牌重复手写）。
 * 校验合法罗马数字 I–X（拒绝 IIX/IL 等非法写法），末锚匹配机型行文本；i 兼容小写机型写法。
 */
export const ROMAN_SUFFIX = /((?:X{0,2})(?:IX|IV|V?I{0,3}))$/
/** "Mark II" 传统前缀变体（佳能/奥林巴斯等），整段（含 Mark 一词）锁定 */
export const MARK_SUFFIX = /((?:mark\s*)?(?:X{0,2})(?:IX|IV|V?I{0,3}))$/i

/*
 * 品牌锁定字形映射（数据驱动，新增/调整品牌 = 只改这里的 glyph 数据）：
 * 字体血统 → 打包/品牌字体（检索依据见 public/fonts/brands/SOURCES.md 与 docs §5.15）：
 * - Helvetica 系（canon/olympus/nikon 代际）→ archivo 700（工业 grotesque）
 * - Eurostile/DIN 科技感（sony）→ SST（官方企业字体）/ oswald 近似
 * - Univers 系（fujifilm/panasonic）→ roboto 500
 * 字标：仅接入已获取复刻字体的品牌（sony/nikon/canon/olympus）；
 * leica/hasselblad 机身用阿拉伯数字（M11/907X），无代际罗马数字 → 不配 numerals。
 */
export const BRANDS: BrandDef[] = [
  {
    id: 'sony',
    match: ['sony'],
    name: 'Sony',
    logo: '/brands/sony.png',
    logoOnDark: '/brands/sony-dark.png',
    modelTransforms: [{ pattern: /^ILCE-/, replace: 'α' }],
    // α 标志字形（官方 SVG 转制）+ SST 官方字体字标/数字
    glyph: {
      wordmark: { match: 'SONY', family: 'brand-sony', weight: 400, italic: false },
      symbol: { char: 'α', family: 'brand-sony-alpha', modelPattern: /α/ },
      numerals: { pattern: ROMAN_SUFFIX, family: 'brand-sony', weight: 400, spacing: 0.06 }
    }
  },
  {
    id: 'pentax',
    match: ['pentax', 'ricoh imaging'],
    name: 'Pentax',
    logo: '/brands/pentax.png',
    glyph: { numerals: { pattern: MARK_SUFFIX, family: 'archivo', weight: 700, spacing: 0.06 } } // K-1 Mark II / K-3 Mark III
  },
  {
    id: 'ricoh',
    match: ['ricoh'],
    name: 'Ricoh',
    logo: '/brands/ricoh.png',
    glyph: { numerals: { pattern: ROMAN_SUFFIX, family: 'archivo', weight: 700, spacing: 0.06 } } // GR II / GR III
  },
  {
    id: 'leica',
    match: ['leica'],
    name: 'Leica',
    logo: '/brands/leica.png'
    // 机身型号为阿拉伯数字传统（M11 / Q3 / SL3），无代际罗马数字
  },
  {
    id: 'nikon',
    match: ['nikon'],
    name: 'Nikon',
    logo: '/brands/nikon.png',
    // 机身铭牌锁定字形：NIKON 字标（Nexa Bold + 合成斜体 ≈ 官方定制字标观感）；
    // Z 专用字形仅 Z 系机型（R-04）；代际罗马数字（Z 6II/6III）工业 grotesque
    glyph: {
      wordmark: { match: 'NIKON', family: 'brand-nikon', weight: 400, italic: true },
      symbol: { char: 'Z', family: 'nikon-z-symbol', modelPattern: /\bZ/ },
      numerals: { pattern: ROMAN_SUFFIX, family: 'archivo', weight: 700, spacing: 0.08 }
    }
  },
  {
    id: 'canon',
    match: ['canon'],
    name: 'Canon',
    logo: '/brands/canon.png',
    glyph: {
      wordmark: { match: 'CANON', family: 'brand-canon', weight: 400, italic: false },
      numerals: { pattern: MARK_SUFFIX, family: 'archivo', weight: 700, spacing: 0.06 } // EOS R6 Mark II
    }
  },
  {
    id: 'fujifilm',
    match: ['fujifilm', 'fujitsu'],
    name: 'Fujifilm',
    logo: '/brands/fujifilm.png',
    modelTransforms: [{ pattern: /^X-/i, replace: 'X-' }],
    glyph: { numerals: { pattern: ROMAN_SUFFIX, family: 'roboto', weight: 500, spacing: 0.06 } } // X100V / X100VI
  },
  {
    id: 'panasonic',
    match: ['panasonic'],
    name: 'Panasonic',
    logo: '/brands/panasonic.png',
    modelTransforms: [{ pattern: /^(DMC|DC)-/, replace: 'LUMIX ' }],
    // S5IIX 等"代际+变体"连写：取数字后整段罗马字符（GH5 II / S5II / S5IIX）
    glyph: { numerals: { pattern: /([IVX]{2,4})$/, family: 'roboto', weight: 500, spacing: 0.06 } }
  },
  {
    id: 'olympus',
    match: ['olympus', 'om digital', 'om-digital'],
    name: 'OM SYSTEM',
    logo: '/brands/olympus.png',
    logoOnDark: '/brands/olympus-dark.png',
    glyph: {
      wordmark: { match: 'OLYMPUS', family: 'brand-olympus', weight: 400, italic: false },
      numerals: { pattern: MARK_SUFFIX, family: 'archivo', weight: 700, spacing: 0.06 } // E-M1 Mark III
    }
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

/**
 * 品牌锁定字形解析（机型行专用）：按 BrandDef.glyph 数据构建渲染标记。
 * - symbol：机型名匹配 modelPattern 时启用（如尼康仅 Z 系机型、索尼 α 标志）；
 *   color 为字符专用色（模板 typography.markColor，nikon-z 模板红 Z 语义，缺省由调用方回退行色）。
 * - wordmark / numerals：品牌字标段与代际罗马数字段，锁定样式，颜色恒随行色。
 */
export function resolveBrandMark(
  brand: BrandDef | undefined,
  modelPretty: string,
  markColor?: string
): InkMark | undefined {
  const glyph = brand?.glyph
  if (!glyph) return undefined
  const symbolActive =
    !!glyph.symbol && (!glyph.symbol.modelPattern || glyph.symbol.modelPattern.test(modelPretty))
  return {
    symbol:
      symbolActive && glyph.symbol
        ? { char: glyph.symbol.char, family: glyph.symbol.family, color: markColor }
        : undefined,
    wordmark: glyph.wordmark ? { ...glyph.wordmark } : undefined,
    numerals: glyph.numerals ? { ...glyph.numerals } : undefined
  }
}
