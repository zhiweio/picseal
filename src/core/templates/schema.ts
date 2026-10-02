import { z } from 'zod'
import type { WatermarkTemplate } from '../types'

const fieldSlotSchema = z.object({
  enabled: z.boolean(),
  content: z.string().max(80)
})

export const templateSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(48),
  layout: z.enum(['banner', 'card', 'corner', 'center-logo']),
  version: z.literal(1),
  canvas: z.object({
    margin: z.number().min(0).max(0.2),
    cornerRadius: z.number().min(0).max(0.1),
    shadow: z.boolean(),
    mount: z.enum(['none', 'solid', 'blur']),
    mountColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$|^rgba?\(.+\)$/),
    aspectRatio: z.string().regex(/^\d+(\.\d+)?:\d+(\.\d+)?$/).nullable()
  }),
  banner: z.object({
    heightRatio: z.number().min(0.04).max(0.3),
    bgColor: z.string(),
    paddingX: z.number().min(0.2).max(3),
    divider: z.boolean(),
    leftTop: fieldSlotSchema,
    leftBottom: fieldSlotSchema,
    rightTop: fieldSlotSchema,
    rightBottom: fieldSlotSchema,
    logo: z.object({
      enabled: z.boolean(),
      position: z.enum(['left', 'right']),
      heightRatio: z.number().min(0.3).max(1.4)
    }),
    textColor: z.string(),
    subColor: z.string(),
    dividerColor: z.string(),
    rightAlign: z.enum(['near', 'far'])
  }),
  corner: z.object({
    position: z.enum(['bottom-right', 'bottom-left']),
    sizeRatio: z.number().min(0.008).max(0.08),
    color: z.string(),
    subColor: z.string(),
    textShadow: z.boolean(),
    lines: z.array(fieldSlotSchema).max(4),
    lineGap: z.number().min(0).max(2)
  }),
  center: z.object({
    title: fieldSlotSchema,
    logoRatio: z.number().min(0.02).max(0.4),
    caption: fieldSlotSchema,
    captionColor: z.string(),
    scrim: z.boolean()
  }),
  typography: z.object({
    scale: z.number().min(0.6).max(1.4),
    markColor: z.string().optional()
  })
})

export function parseTemplate(json: unknown): WatermarkTemplate {
  return templateSchema.parse(json) as WatermarkTemplate
}

/** 用户自定义模板的存储格式 */
export interface PresetFile {
  app: 'picseal'
  kind: 'preset'
  version: 1
  template: WatermarkTemplate
}
