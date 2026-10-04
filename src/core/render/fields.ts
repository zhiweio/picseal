import type { BrandDef, PhotoMeta } from '../types'
import { formatDate, formatGps, formatParams } from '../exif/reader'

export interface FieldContext {
  meta: PhotoMeta
  brand?: BrandDef
}

const TOKEN_RE = /\$(?:model|lens|param|datetime|gps|brand)/g

/**
 * 解析字段槽位内容：'$model' 等令牌 → 元数据文本；字面文本原样输出。
 * 复合内容（如 "$model    $datetime"，semi-utils normal2 的"段名+时间"一行式）
 * 逐令牌解析、字面间隔保留。令牌缺失时按策略显示 '-' 或留空（R-06），缺省留空。
 */
export function resolveField(
  content: string,
  ctx: FieldContext,
  policy: 'dash' | 'hide' = 'hide'
): string {
  const missing = policy === 'hide' ? '' : '-'
  const tokens = content.match(TOKEN_RE)
  if (tokens && tokens.join('') !== content.trim()) {
    return content.replace(TOKEN_RE, (t) => resolveField(t, ctx, policy))
  }
  switch (content) {
    case '$model':
      return ctx.meta.modelPretty ?? missing
    case '$lens':
      return ctx.meta.lens ?? missing
    case '$param':
      return formatParams(ctx.meta) || missing
    case '$datetime':
      return ctx.meta.dateTimeOriginal ? formatDate(ctx.meta.dateTimeOriginal) : missing
    case '$gps':
      return ctx.meta.gps ? formatGps(ctx.meta.gps) : missing
    case '$brand':
      return ctx.brand?.name ?? ''
    default:
      return content
  }
}

/** 解析一组槽位为非空文本行 */
export function resolveLines(
  slots: Array<{ enabled: boolean; content: string }>,
  ctx: FieldContext,
  policy: 'dash' | 'hide' = 'hide'
): string[] {
  return slots
    .filter((s) => s.enabled)
    .map((s) => resolveField(s.content, ctx, policy).trim())
    .filter((t) => t.length > 0)
}

/** 文本是否需要 CJK 字体（拉丁子集覆盖之外的字符） */
const LATIN_ONLY =
  /^[\u0000-\u024F\u2000-\u206F\u2100-\u214F\u2460-\u24FF\u3000-\u3004\uFF01-\uFF65]*$/

export function needsCjk(text: string): boolean {
  return !LATIN_ONLY.test(text)
}
