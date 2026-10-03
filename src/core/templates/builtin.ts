import type { BannerStyle, CanvasStyle, CenterStyle, CornerStyle, FieldSlot, WatermarkTemplate } from '../types'
import { DEFAULT_FONT } from '../fonts/registry'

const slot = (content: string, enabled = true): FieldSlot => ({ enabled, content })

const flatCanvas = (): CanvasStyle => ({
  margin: 0,
  cornerRadius: 0,
  shadow: false,
  mount: 'none',
  mountColor: '#ffffff',
  aspectRatio: null
})

const defaultBanner = (): BannerStyle => ({
  // heightRatio = 底部横幅高 / 照片高（semi-utils bottom_margin = 12% 图高）
  heightRatio: 0.12,
  bgColor: '#ffffff',
  divider: true,
  leftTop: slot('$model'),
  leftBottom: slot('$datetime'),
  rightTop: slot('$param'),
  rightBottom: slot('$gps'),
  // 官方 WatermarkFilter：logo 边长 = 文字块高（elem_height），1.0 = 贴满
  logo: { enabled: true, position: 'right', heightRatio: 1.0 },
  textColor: '#000000',
  subColor: '#242424',
  dividerColor: '#D8D8D6',
  rightAlign: 'near'
})

const defaultCorner = (): CornerStyle => ({
  position: 'bottom-right',
  // normal1：文字墨迹高 = 3% 图高
  sizeRatio: 0.03,
  color: '#ffffff',
  subColor: '#ffffff',
  textShadow: true,
  lines: [slot('$param')],
  lineGap: 0.25
})

const defaultCenter = (): CenterStyle => ({
  title: slot('$model'),
  logoRatio: 0.085,
  caption: slot('$model'),
  captionColor: '#ffffff',
  scrim: true
})

/* 1. 横幅 —— semi-utils standard1 官方骨架：机型+镜头 | logo | 参数+时间
 * （经典横幅 + 标准横幅合并为单模板，字段/字体差异由预设承载；旧预设仍按完整模板对象渲染） */
const bannerClassic: WatermarkTemplate = {
  id: 'banner',
  name: 'banner',
  layout: 'banner',
  version: 1,
  canvas: flatCanvas(),
  banner: {
    ...defaultBanner(),
    heightRatio: 0.1,
    leftBottom: slot('$lens'),
    rightBottom: slot('$datetime'),
    rightAlign: 'near'
  },
  corner: defaultCorner(),
  center: defaultCenter(),
  // 官方 standard1 观感：PuHuiTi Bold/Light 同尺寸双字重
  typography: { font: 'puhuiti', scale: 1 }
}

/* 2. 装裱卡片 —— semi-utils standard2：白边装裱 + 圆角投影 + 底部横幅（分隔线隐藏） */
const cardShadow: WatermarkTemplate = {
  id: 'card-shadow',
  name: 'card-shadow',
  layout: 'card',
  version: 1,
  canvas: {
    margin: 0.032,
    cornerRadius: 0.012,
    shadow: true,
    mount: 'solid',
    mountColor: '#ffffff',
    aspectRatio: null
  },
  banner: {
    ...defaultBanner(),
    leftTop: slot('$model'),
    leftBottom: slot('$lens'),
    rightTop: slot('$param'),
    rightBottom: slot('$datetime'),
    divider: false
  },
  corner: defaultCorner(),
  center: defaultCenter(),
  typography: { font: 'puhuiti', scale: 0.95 }
}

/* 3. 雾面卡片 —— semi-utils blur：清晰照片居中 + 模糊背景，文字列在照片下方 */
const cardBlur: WatermarkTemplate = {
  id: 'card-blur',
  name: 'card-blur',
  layout: 'card',
  version: 1,
  canvas: {
    margin: 0,
    cornerRadius: 0.02,
    shadow: true,
    mount: 'blur',
    mountColor: '#ffffff',
    // 画幅跟随原图（blur.json 裁切 135% 等比）
    aspectRatio: null
  },
  banner: defaultBanner(),
  corner: defaultCorner(),
  center: {
    ...defaultCenter(),
    title: slot('$model'),
    caption: slot('$param')
  },
  typography: { font: DEFAULT_FONT, scale: 1 }
}

/* 4. Z 字红标 —— semi-utils nikon_blur：同雾面卡片 + 机型 Z 红色高亮（仅 Z 系机型，render 门控） */
const nikonZ: WatermarkTemplate = {
  id: 'nikon-z',
  name: 'nikon-z',
  layout: 'card',
  version: 1,
  canvas: {
    margin: 0,
    cornerRadius: 0.02,
    shadow: true,
    mount: 'blur',
    mountColor: '#ffffff',
    aspectRatio: null
  },
  banner: defaultBanner(),
  corner: defaultCorner(),
  center: {
    ...defaultCenter(),
    title: slot('$model'),
    caption: slot('$param')
  },
  typography: { font: DEFAULT_FONT, scale: 1.05, markColor: '#ff0000' }
}

/* 5. 角标参数 —— semi-utils normal1：右下角一行参数（3% 图高，5% 边距） */
const cornerMinimal: WatermarkTemplate = {
  id: 'corner-minimal',
  name: 'corner-minimal',
  layout: 'corner',
  version: 1,
  canvas: flatCanvas(),
  banner: defaultBanner(),
  corner: {
    ...defaultCorner(),
    position: 'bottom-right',
    lines: [slot('$param')]
  },
  center: defaultCenter(),
  typography: { font: 'bebas-neue', scale: 1 }
}

/* 6. 图注 —— semi-utils normal2：右下角橙色单行"机型    时间"（Light、无投影） */
const caption: WatermarkTemplate = {
  id: 'caption',
  name: 'caption',
  layout: 'corner',
  version: 1,
  canvas: flatCanvas(),
  banner: defaultBanner(),
  corner: {
    ...defaultCorner(),
    position: 'bottom-right',
    // normal2：墨迹高 3% 图高
    sizeRatio: 0.03,
    color: '#e88d34',
    subColor: '#e88d34',
    // normal2 单行 Light、无投影、**橙色原样**（semi 无对比度自适应，品牌色不随背景切换）
    allSub: true,
    textShadow: false,
    contrastFix: false,
    lines: [slot('$model    $datetime')],
    lineGap: 0.3
  },
  center: defaultCenter(),
  typography: { font: 'puhuiti', scale: 1 }
}

/* 7. 居中标识 —— semi-utils center_logo：底部白带 + 仅一个品牌 logo 居中（无文字） */
const centerLogo: WatermarkTemplate = {
  id: 'center-logo',
  name: 'center-logo',
  layout: 'center-logo',
  version: 1,
  canvas: flatCanvas(),
  banner: defaultBanner(),
  corner: defaultCorner(),
  center: {
    ...defaultCenter(),
    title: slot('', false),
    // logo 高 / 照片高（= 白带高的 ~1/3，对齐 semi-utils center_logo 样张观感）
    logoRatio: 0.04,
    caption: slot('', false)
  },
  typography: { font: DEFAULT_FONT, scale: 1 }
}

export const BUILTIN_TEMPLATES: WatermarkTemplate[] = [
  bannerClassic,
  cardShadow,
  cardBlur,
  nikonZ,
  cornerMinimal,
  caption,
  centerLogo
]

export const DEFAULT_TEMPLATE_ID = 'banner'

export function getBuiltinTemplate(id: string): WatermarkTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id)
}
