/**
 * 槽位样式解析 —— FieldSlot.style（高级字体覆写）与所在行默认的继承合并。
 * 覆写字段全部可选：缺省逐字段回退到所在行的默认（全局家族 + 主/副字重 + 主/副色）。
 * 槽位 scale 是行默认渲染字号的乘数（全局 typography.scale 的效果已包含在行基准墨迹高中，
 * 不在此重复相乘），1 = 与模板默认渲染一致。
 */
import type { FieldSlot } from '../types'
import { getFontFamily, type FontFamilyId } from '../fonts/registry'

/** 解析后的行样式：可直接供墨迹渲染消费（无可选字段） */
export interface ResolvedRowStyle {
  family: FontFamilyId
  weight: number
  italic: boolean
  color: string
  /** 字号乘数（行基准墨迹高之上再乘），1 = 跟随模板 */
  scale: number
  /** 颜色是否为用户显式覆写——尼康 Z 符号字形跟随行色的判据（缺省保持品牌色语义） */
  colorOverridden: boolean
}

/** 行的默认样式基准：字重与颜色由调用方按行位置给出（主/副行不同） */
export interface RowStyleBase {
  family: FontFamilyId
  weight: number
  color: string
}

export function resolveSlotStyle(slot: FieldSlot, base: RowStyleBase): ResolvedRowStyle {
  const s = slot.style
  // 尼康 Z 符号字体是品牌锁定字形：任何情况下不得作为行字体（高级覆写/预设手改一律回退全局家族）
  const overrideDef = s?.font ? getFontFamily(s.font) : undefined
  const family =
    overrideDef && overrideDef.group !== 'symbol' ? overrideDef.id : base.family
  return {
    // 覆写家族非法（如预设手改）时回退全局家族，渲染永不静默失败
    family,
    weight: s?.weight ?? base.weight,
    italic: s?.italic ?? false,
    color: s?.color ?? base.color,
    scale: s?.scale ?? 1,
    colorOverridden: s?.color !== undefined
  }
}
