/**
 * 照片顺序 —— 纯逻辑，零 DOM / 零 React。
 *
 * 拍摄时间升序是档案馆 / 工作台候选栏 / 放映室共用的基准序：稳定排序，
 * 无 EXIF 时间者按原相对顺序沉底。自定义顺序（拖拽排序）以 id 全序表达。
 */
import type { PhotoMeta } from './types'

/** 拍摄时间戳（毫秒）；无 EXIF 时间返回 NaN（排序时沉底） */
export function captureTimeOf(meta?: PhotoMeta): number {
  const t = meta?.dateTimeOriginal?.getTime()
  return t === undefined || Number.isNaN(t) ? Number.NaN : t
}

/** 稳定时间升序：NaN 沉底且保持原相对顺序 */
export function stableTimeSort<T>(items: readonly T[], timeOf: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, t: timeOf(item) }))
    .sort((a, b) => {
      const aNaN = Number.isNaN(a.t)
      const bNaN = Number.isNaN(b.t)
      if (aNaN && bNaN) return a.index - b.index
      if (aNaN) return 1
      if (bNaN) return -1
      return a.t - b.t || a.index - b.index
    })
    .map((e) => e.item)
}

/** 按 EXIF 拍摄时间（meta.dateTimeOriginal）升序的稳定排序 */
export function sortByCaptureTime<T extends { meta?: PhotoMeta }>(items: readonly T[]): T[] {
  return stableTimeSort(items, (item) => captureTimeOf(item.meta))
}

/** 按 id 全序取物：ids 未覆盖的条目按原相对顺序垫在后面 */
export function orderByIds<T extends { id: string }>(items: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const head: T[] = []
  for (const id of ids) {
    const item = byId.get(id)
    if (item) {
      head.push(item)
      byId.delete(id)
    }
  }
  return [...head, ...items.filter((item) => byId.has(item.id))]
}

/** 拖拽落点计算：把 fromId 移到 toId 的 position 侧；id 无效或相同则原样返回 */
export function moveRelative<T extends { id: string }>(
  items: readonly T[],
  fromId: string,
  toId: string,
  position: 'before' | 'after'
): T[] {
  if (fromId === toId) return [...items]
  const from = items.findIndex((item) => item.id === fromId)
  if (from < 0) return [...items]
  const dragged = items[from]!
  const rest = items.filter((_, i) => i !== from)
  const to = rest.findIndex((item) => item.id === toId)
  if (to < 0) return [...items]
  const at = position === 'before' ? to : to + 1
  return [...rest.slice(0, at), dragged, ...rest.slice(at)]
}
