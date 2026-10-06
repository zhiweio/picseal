import type { FontFamilyId } from './fonts/registry'

/** 归一化后的照片元数据 —— 由 EXIF 读取器产出，水印引擎消费 */
export interface PhotoMeta {
  make?: string
  model?: string
  /** 美化后的机型名：ILCE-7M4 → α7M4 */
  modelPretty?: string
  brandId?: string
  lens?: string
  /** 实际焦距 mm */
  focalLength?: number
  /** 35mm 等效焦距 mm（优先展示） */
  focal35?: number
  fNumber?: number
  /** 快门秒数 */
  exposureTime?: number
  iso?: number
  dateTimeOriginal?: Date
  gps?: { lat: number; lng: number }
  width?: number
  height?: number
}

export const EMPTY_META: PhotoMeta = Object.freeze({})

/**
 * 品牌锁定字形（仅作用于渲染「机型」信息的槽位文本）——数据驱动，
 * 新增品牌（索尼等）只需扩充 BRANDS 的 glyph 数据，渲染层零改动。
 * 锁定语义：仅字号与颜色可变，family/weight/italic 任何情况下不随用户覆写。
 */
export interface BrandGlyphMark {
  /** 品牌字标子串（如 NIKON）：大小写不敏感匹配、保留原文，以锁定样式渲染，颜色恒随行色 */
  wordmark?: { match: string; family: FontFamilyId; weight: number; italic: boolean }
  /** 符号字符切换（如尼康 Z 专用字形、索尼 α 标志）：仅当机型名匹配 modelPattern 时启用（缺省恒启用） */
  symbol?: { char: string; family: FontFamilyId; modelPattern?: RegExp }
  /**
   * 代际罗马数字段（机型名末尾的 II/III/IV/V/VI 等，如 Mark II / Z 6III / X100VI）：
   * pattern 在机型行文本上取匹配处（应末锚 $，见 brands 的 ROMAN_SUFFIX/MARK_SUFFIX 工厂）
   * 以锁定样式渲染；spacing 为数字段前额外字距（em，机身铭牌的 track-out 高级感）。
   * 各品牌机身字体均为定制（Helvetica/Univers/Eurostile 系），打包/品牌字体映射见 brands/index.ts。
   */
  numerals?: { pattern: RegExp; family: FontFamilyId; weight: number; italic?: boolean; spacing?: number }
}

/** 品牌定义：数据驱动匹配，替代旧版硬编码 switch */
export interface BrandDef {
  id: string
  /** 小写关键词，依次匹配 make / model */
  match: string[]
  name: string
  /** public 下路径 */
  logo: string
  /** 深色表面用的变体（浅色 logo） */
  logoOnDark?: string
  /** 机型名美化规则 */
  modelTransforms?: Array<{ pattern: RegExp; replace: string }>
  /** 品牌锁定字形（机型行专用，见 BrandGlyphMark） */
  glyph?: BrandGlyphMark
}

/** 槽位字体覆写：全部可选 = 跟随模板全局（typography.font/scale + 所在行的默认字重/颜色） */
export interface SlotFontStyle {
  /** 字体家族（core/fonts/registry 的 FontFamilyId） */
  font?: string
  /** 字号相对缩放 0.5–2.0，1 = 跟随模板 */
  scale?: number
  /** 字重覆写（限所选家族可用字重，见 FontFamilyDef.weights） */
  weight?: number
  /** 合成斜体（内置字体无真斜体字面，浏览器光栅器合成 oblique） */
  italic?: boolean
  /** 文字颜色 #hex */
  color?: string
}

/** 字段槽位：横幅布局的四个象限 / 角标布局的行 / 居中布局的标题与说明 */
export interface FieldSlot {
  enabled: boolean
  /** '$model' '$lens' '$param' '$datetime' '$gps' '$brand' 或字面文本 */
  content: string
  /** 高级字体覆写（缺省继承全局设置） */
  style?: SlotFontStyle
}

export type TemplateLayout = 'banner' | 'card' | 'corner' | 'center-logo'

export interface CanvasStyle {
  /** 外边距，占图宽比例 0-0.2 */
  margin: number
  /** 圆角，占图宽比例 0-0.1 */
  cornerRadius: number
  shadow: boolean
  /** none=紧贴照片；solid=纯色装裱；blur=毛玻璃装裱 */
  mount: 'none' | 'solid' | 'blur'
  /** 装裱底色（mount != none 时生效） */
  mountColor: string
  /** 画幅归一化，如 '2.35:1' '4:5'；null 保持原始 */
  aspectRatio: string | null
}

export interface BannerStyle {
  /** 横幅高度，占图宽比例 */
  heightRatio: number
  /** 横幅底色 */
  bgColor: string
  divider: boolean
  leftTop: FieldSlot
  leftBottom: FieldSlot
  rightTop: FieldSlot
  rightBottom: FieldSlot
  logo: { enabled: boolean; position: 'left' | 'right'; heightRatio: number }
  textColor: string
  subColor: string
  dividerColor: string
  /** 右栏文本对齐：贴分隔线（小米徕卡风）或分散 */
  rightAlign: 'near' | 'far'
  /** 补边画幅下横幅延展到画布全宽（缺省 false = 跟随照片宽度） */
  fullWidth?: boolean
}

export interface CornerStyle {
  position: 'bottom-right' | 'bottom-left'
  /** 文字高度，占图宽比例 */
  sizeRatio: number
  color: string
  subColor: string
  /** 文字投影，保证在亮背景可读 */
  textShadow: boolean
  /** 全部行使用副字重（semi normal2 单行 Light 语义；缺省首行主字重） */
  allSub?: boolean
  /** 亮背景自动切换黑/白（R-05）；品牌色语义强的模板（图注橙）可关闭 */
  contrastFix?: boolean
  lines: FieldSlot[]
  lineGap: number
}

export interface CenterStyle {
  /** 主标题槽位（雾面卡片的机型行） */
  title: FieldSlot
  /** 居中标识的 logo 高度，占照片高比例（≈ 底带的 1/3） */
  logoRatio: number
  /** logo/主标题下方小字 */
  caption: FieldSlot
  captionColor: string
  /** 底部渐隐遮罩，保证可读性 */
  scrim: boolean
}

export interface WatermarkTemplate {
  id: string
  /** 内置模板的 i18n key / 自定义模板的显示名 */
  name: string
  layout: TemplateLayout
  version: 1
  canvas: CanvasStyle
  banner: BannerStyle
  corner: CornerStyle
  center: CenterStyle
  typography: {
    /** 水印字体家族（见 core/fonts/registry），默认 Archivo */
    font: string
    /** 字号整体缩放 0.6-1.4 */
    scale: number
    /** 尼康 Z 款的红色标记字符等特殊处理 */
    markColor?: string
  }
  /** 元数据缺失时的占位策略：整行留空（缺省）或 '-' 占位（semi-utils 策略） */
  fieldPolicy?: 'dash' | 'hide'
}

/** 渲染选项 */
export interface RenderOptions {
  /** 输出长边上限；0 = 原始尺寸 */
  maxLongEdge: number
  /** 是否绘制水印（false 时仅做缩放/画幅处理） */
  watermark: boolean
}

export interface OutputSettings {
  format: 'jpeg' | 'png' | 'webp'
  quality: number
  keepExif: boolean
  naming: 'original' | 'datetime' | 'index'
  /** 输出长边上限；0 = 原始尺寸 */
  longEdge: number
}
