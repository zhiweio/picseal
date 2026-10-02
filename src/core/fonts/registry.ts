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

export type FontGroup = 'sans' | 'condensed' | 'serif' | 'calligraphy'

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
    mainWeight: 700,
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
  }
}

export const DEFAULT_FONT: FontFamilyId = 'archivo'

export function getFontFamily(id: string | undefined): FontFamilyDef {
  return FONT_FAMILIES[(id ?? DEFAULT_FONT) as FontFamilyId] ?? FONT_FAMILIES[DEFAULT_FONT]
}

export const FONT_GROUP_LABELS: Record<FontGroup, { zh: string; en: string }> = {
  sans: { zh: '无衬线 · 铭牌', en: 'SANS' },
  condensed: { zh: '窄体 · 镜头环', en: 'CONDENSED' },
  serif: { zh: '衬线 · 文艺', en: 'SERIF' },
  calligraphy: { zh: '书法 · 艺术', en: 'CALLIGRAPHY' }
}
