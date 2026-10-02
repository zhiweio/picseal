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
}

/** 字段槽位：横幅布局的四个象限 / 角标布局的行 */
export interface FieldSlot {
  enabled: boolean
  /** '$model' '$lens' '$param' '$datetime' '$gps' '$brand' 或字面文本 */
  content: string
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
}

export interface CornerStyle {
  position: 'bottom-right' | 'bottom-left'
  /** 文字高度，占图宽比例 */
  sizeRatio: number
  color: string
  subColor: string
  /** 文字投影，保证在亮背景可读 */
  textShadow: boolean
  lines: FieldSlot[]
  lineGap: number
}

export interface CenterStyle {
  /** 主标题槽位（雾面卡片的机型行） */
  title: FieldSlot
  /** logo 高度，占图宽比例 */
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
