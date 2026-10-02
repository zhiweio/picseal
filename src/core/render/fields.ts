import type { BrandDef, PhotoMeta } from '../types'
import { formatDate, formatGps, formatParams } from '../exif/reader'

export interface FieldContext {
  meta: PhotoMeta
  brand?: BrandDef
}

/**
 * 解析字段槽位内容：'$model' 等令牌 → 元数据文本；字面文本原样输出。
 * 令牌对应数据缺失时显示 '-'（semi-utils 策略），不展示假数据。
 */
export function resolveField(content: string, ctx: FieldContext): string {
  switch (content) {
    case '$model':
      return ctx.meta.modelPretty ?? '-'
    case '$lens':
      return ctx.meta.lens ?? '-'
    case '$param':
      return formatParams(ctx.meta) || '-'
    case '$datetime':
      return ctx.meta.dateTimeOriginal ? formatDate(ctx.meta.dateTimeOriginal) : '-'
    case '$gps':
      return ctx.meta.gps ? formatGps(ctx.meta.gps) : '-'
    case '$brand':
      return ctx.brand?.name ?? ''
    default:
      return content
  }
}

/** 解析一组槽位为非空文本行 */
export function resolveLines(
  slots: Array<{ enabled: boolean; content: string }>,
  ctx: FieldContext
): string[] {
  return slots
    .filter((s) => s.enabled)
    .map((s) => resolveField(s.content, ctx).trim())
    .filter((t) => t.length > 0)
}

/** 文本是否需要 CJK 字体（拉丁子集覆盖之外的字符） */
const LATIN_ONLY =
  /^[\u0000-\u024F\u2000-\u206F\u2100-\u214F\u2460-\u24FF\u3000-\u3004\uFF01-\uFF65]*$/

export function needsCjk(text: string): boolean {
  return !LATIN_ONLY.test(text)
}
