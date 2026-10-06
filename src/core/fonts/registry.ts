/**
 * 水印字体注册表 —— 数据驱动的多字体系统。
 * 全部字体 OFL / 免费商用，可随应用分发（许可见 public/fonts/licenses/）。
 * 拉丁子集 ~20-40KB/字重；CJK 子集 ~0.9-3MB，按所选家族惰性加载。
 */

export type FontFamilyId =
  | 'archivo'
  | 'roboto'
  | 'puhuiti'
  | 'misans'
  | 'bebas-neue'
  | 'oswald'
  | 'playfair'
  | 'noto-serif-sc'
  | 'lxgw-wenkai'
  | 'smiley-sans'
  | 'ma-shan-zheng'
  | 'nikon-z-symbol'
  | 'brand-sony'
  | 'brand-sony-alpha'
  | 'brand-nikon'
  | 'brand-canon'
  | 'brand-olympus'

export type FontGroup = 'sans' | 'condensed' | 'serif' | 'calligraphy' | 'symbol' | 'brand'

export interface FontFamilyDef {
  id: FontFamilyId
  /** UI 展示名 */
  name: string
  group: FontGroup
  /** FontFace 家族名（Canvas font shorthand 用） */
  cssName: string
  /** 可用字重 */
  weights: number[]
  /** 主行（机型/参数上行）推荐字重 */
  mainWeight: number
  /** 副行（镜头/日期/位置下行）推荐字重 */
  subWeight: number
  /** 拉丁子集文件（每字重） */
  latin: Record<number, string>
  /** CJK 子集（惰性） */
  cjk?: Record<number, string>
  /** 全大写字体（Bebas）——渲染时 toUpperCase */
  capsOnly?: boolean
}

const LATIN = (id: string) => (w: number) => `/fonts/wm/${id}-${w}.woff2`

export const FONT_FAMILIES: Record<FontFamilyId, FontFamilyDef> = {
  archivo: {
    id: 'archivo',
    name: 'Archivo · 铭牌',
    group: 'sans',
    cssName: 'Picseal Archivo',
    weights: [300, 400, 500, 600, 700, 800],
    // M2 减重校准：700 → 600（BAN-010，默认观感减重 ~15%）
    mainWeight: 600,
    subWeight: 400,
    latin: {
      300: LATIN('archivo')(300),
      400: LATIN('archivo')(400),
      500: LATIN('archivo')(500),
      600: LATIN('archivo')(600),
      700: LATIN('archivo')(700),
      800: LATIN('archivo')(800)
    }
  },
  roboto: {
    id: 'roboto',
    name: 'Roboto',
    group: 'sans',
    cssName: 'Picseal Roboto',
    weights: [300, 400, 500, 700],
    mainWeight: 700,
    subWeight: 400,
    latin: {
      300: LATIN('roboto')(300),
      400: LATIN('roboto')(400),
      500: LATIN('roboto')(500),
      700: LATIN('roboto')(700)
    }
  },
  puhuiti: {
    id: 'puhuiti',
    name: '阿里巴巴普惠体',
    group: 'sans',
    cssName: 'Picseal PuHuiTi',
    weights: [300, 700],
    mainWeight: 700,
    subWeight: 300,
    latin: { 300: '/fonts/wm/puhuiti-300.woff2', 700: '/fonts/wm/puhuiti-700.woff2' },
    cjk: { 300: '/fonts/wm/puhuiti-300.woff2', 700: '/fonts/wm/puhuiti-700.woff2' }
  },
  misans: {
    id: 'misans',
    name: 'MiSans · 小米',
    group: 'sans',
    cssName: 'Picseal MiSans',
    weights: [300, 400, 600, 700],
    mainWeight: 700,
    subWeight: 300,
    latin: {
      300: '/fonts/MiSans-Light-latin.woff2',
      400: '/fonts/MiSans-Regular-latin.woff2',
      600: '/fonts/MiSans-Demibold-latin.woff2',
      700: '/fonts/MiSans-Bold-latin.woff2'
    },
    cjk: {
      300: '/fonts/wm/MiSans-Light-cjk.woff2',
      400: '/fonts/wm/MiSans-Regular-cjk.woff2',
      600: '/fonts/wm/MiSans-Demibold-cjk.woff2',
      700: '/fonts/wm/MiSans-Bold-cjk.woff2'
    }
  },
  'bebas-neue': {
    id: 'bebas-neue',
    name: 'Bebas Neue · 镜头环',
    group: 'condensed',
    cssName: 'Picseal Bebas',
    weights: [400],
    mainWeight: 400,
    subWeight: 400,
    latin: { 400: '/fonts/wm/bebas-neue-400.woff2' },
    capsOnly: true
  },
  oswald: {
    id: 'oswald',
    name: 'Oswald',
    group: 'condensed',
    cssName: 'Picseal Oswald',
    weights: [300, 400, 500, 600],
    mainWeight: 600,
    subWeight: 300,
    latin: {
      300: LATIN('oswald')(300),
      400: LATIN('oswald')(400),
      500: LATIN('oswald')(500),
      600: LATIN('oswald')(600)
    }
  },
  playfair: {
    id: 'playfair',
    name: 'Playfair Display · 文艺',
    group: 'serif',
    cssName: 'Picseal Playfair',
    weights: [400, 700],
    mainWeight: 700,
    subWeight: 400,
    latin: { 400: '/fonts/wm/playfair-display-400.woff2', 700: '/fonts/wm/playfair-display-700.woff2' }
  },
  'noto-serif-sc': {
    id: 'noto-serif-sc',
    name: '思源宋体',
    group: 'serif',
    cssName: 'Picseal Noto Serif SC',
    weights: [400, 700],
    mainWeight: 700,
    subWeight: 400,
    latin: { 400: '/fonts/wm/noto-serif-sc-vf.woff2', 700: '/fonts/wm/noto-serif-sc-vf.woff2' },
    cjk: { 400: '/fonts/wm/noto-serif-sc-vf.woff2', 700: '/fonts/wm/noto-serif-sc-vf.woff2' }
  },
  'lxgw-wenkai': {
    id: 'lxgw-wenkai',
    name: '霞鹜文楷',
    group: 'calligraphy',
    cssName: 'Picseal WenKai',
    weights: [400],
    mainWeight: 400,
    subWeight: 400,
    latin: { 400: '/fonts/wm/lxgw-wenkai-400.woff2' },
    cjk: { 400: '/fonts/wm/lxgw-wenkai-400.woff2' }
  },
  'smiley-sans': {
    id: 'smiley-sans',
    name: '得意黑 · 斜体',
    group: 'calligraphy',
    cssName: 'Picseal Smiley Sans',
    weights: [400],
    mainWeight: 400,
    subWeight: 400,
    latin: { 400: '/fonts/wm/smiley-sans-400.woff2' },
    cjk: { 400: '/fonts/wm/smiley-sans-400.woff2' }
  },
  'ma-shan-zheng': {
    id: 'ma-shan-zheng',
    name: '马善政毛笔楷书',
    group: 'calligraphy',
    cssName: 'Picseal MaShanZheng',
    weights: [400],
    mainWeight: 400,
    subWeight: 400,
    latin: { 400: '/fonts/wm/ma-shan-zheng-400.woff2' },
    cjk: { 400: '/fonts/wm/ma-shan-zheng-400.woff2' }
  },
  /** 尼康 Z 专用符号字形（双线斜切 Z，Special Alphabets P04）——不进 UI 字体选择，仅 markSegments 消费 */
  'nikon-z-symbol': {
    id: 'nikon-z-symbol',
    name: 'Nikon Z 符号',
    group: 'symbol',
    cssName: 'Picseal NikonZSymbol',
    weights: [400],
    mainWeight: 400,
    subWeight: 400,
    latin: { 400: '/fonts/wm/special-alphabets-p04.otf' }
  },
  /* ── 品牌锁定字形字体（public/fonts/brands/，仅学习使用见 SOURCES.md；group brand 不进 UI） ── */
  'brand-sony': {
    id: 'brand-sony',
    name: 'Sony SST（官方企业字体）',
    group: 'brand',
    cssName: 'Picseal Sony SST',
    weights: [400],
    mainWeight: 400,
    subWeight: 400,
    latin: { 400: '/fonts/brands/sony-sst.woff' }
  },
  'brand-sony-alpha': {
    id: 'brand-sony-alpha',
    name: 'Sony α（官方 Alpha 标志）',
    group: 'brand',
    cssName: 'Picseal Sony Alpha',
    weights: [400],
    mainWeight: 400,
    subWeight: 400,
    // 官方 Alpha logo SVG 经 fontTools 转制的单字形字体（α，U+03B1）
    latin: { 400: '/fonts/brands/sony-alpha.ttf' }
  },
  'brand-nikon': {
    id: 'brand-nikon',
    name: 'Nikon 字标（Nexa Bold）',
    group: 'brand',
    cssName: 'Picseal Nikon Wordmark',
    weights: [400],
    mainWeight: 400,
    subWeight: 400,
    latin: { 400: '/fonts/brands/nikon-nexa-bold.woff' }
  },
  'brand-canon': {
    id: 'brand-canon',
    name: 'Canon 字标',
    group: 'brand',
    cssName: 'Picseal Canon Wordmark',
    weights: [400],
    mainWeight: 400,
    subWeight: 400,
    latin: { 400: '/fonts/brands/canon-logo.woff' }
  },
  'brand-olympus': {
    id: 'brand-olympus',
    name: 'Olympus 字标',
    group: 'brand',
    cssName: 'Picseal Olympus Wordmark',
    weights: [400],
    mainWeight: 400,
    subWeight: 400,
    latin: { 400: '/fonts/brands/olympus-logo.woff' }
  }
}

/** 尼康 Z 标字形字体（markSegments 按字符切换；仅 Z 系机型经 renderPhoto 门控启用） */
export const MARK_SYMBOL_FONT = {
  id: 'nikon-z-symbol' as FontFamilyId,
  cssName: 'Picseal NikonZSymbol',
  file: '/fonts/wm/special-alphabets-p04.otf'
} as const

export const DEFAULT_FONT: FontFamilyId = 'archivo'

export function getFontFamily(id: string | undefined): FontFamilyDef {
  return FONT_FAMILIES[(id ?? DEFAULT_FONT) as FontFamilyId] ?? FONT_FAMILIES[DEFAULT_FONT]
}

/** UI 字体分组（'symbol' / 'brand' 组不进选择器：符号与品牌锁定字形仅供渲染内部消费） */
export const FONT_GROUP_LABELS: Record<Exclude<FontGroup, 'symbol' | 'brand'>, { zh: string; en: string }> = {
  sans: { zh: '无衬线 · 铭牌', en: 'SANS' },
  condensed: { zh: '窄体 · 镜头环', en: 'CONDENSED' },
  serif: { zh: '衬线 · 文艺', en: 'SERIF' },
  calligraphy: { zh: '书法 · 艺术', en: 'CALLIGRAPHY' }
}
