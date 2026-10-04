import { describe, expect, it } from 'vitest'
import type { PhotoMeta } from './types'
import { captureTimeOf, moveRelative, orderByIds, sortByCaptureTime, stableTimeSort } from './order'

function photo(id: string, at?: string | number): { id: string; meta?: PhotoMeta } {
  if (at === undefined) return { id }
  const t = typeof at === 'number' ? at : new Date(at).getTime()
  return { id, meta: { dateTimeOriginal: new Date(t) } }
}

describe('captureTimeOf', () => {
  it('无 meta / 无时间 / 非法时间均返回 NaN', () => {
    expect(Number.isNaN(captureTimeOf(undefined))).toBe(true)
    expect(Number.isNaN(captureTimeOf({}))).toBe(true)
  })

  it('有时间返回毫秒时间戳', () => {
    expect(captureTimeOf({ dateTimeOriginal: new Date('2024-05-01T10:00:00') })).toBe(
      new Date('2024-05-01T10:00:00').getTime()
    )
  })
})

describe('sortByCaptureTime / stableTimeSort', () => {
  it('按时间升序；无时间者沉底且保持原相对顺序', () => {
    const items = [photo('late', '2024-05-01'), photo('noMeta-b'), photo('early', '2020-01-01'), photo('noMeta-a')]
    expect(sortByCaptureTime(items).map((p) => p.id)).toEqual(['early', 'late', 'noMeta-b', 'noMeta-a'])
  })

  it('同时间戳保持原相对顺序（稳定）', () => {
    const items = [photo('a', 1000), photo('b', 1000), photo('c', 500), photo('d', 1000)]
    expect(stableTimeSort(items, (p) => (p.meta?.dateTimeOriginal?.getTime() ?? Number.NaN)).map((p) => p.id)).toEqual([
      'c',
      'a',
      'b',
      'd'
    ])
  })

  it('空列表与全无时间列表原样返回', () => {
    expect(sortByCaptureTime([])).toEqual([])
    const items = [photo('a'), photo('b')]
    expect(sortByCaptureTime(items).map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('不修改输入数组', () => {
    const items = [photo('b', '2024-01-01'), photo('a', '2020-01-01')]
    sortByCaptureTime(items)
    expect(items.map((p) => p.id)).toEqual(['b', 'a'])
  })
})

describe('orderByIds', () => {
  it('按 ids 顺序重排；未覆盖条目按原相对顺序垫底', () => {
    const items = [photo('a'), photo('b'), photo('c'), photo('d')]
    expect(orderByIds(items, ['c', 'a']).map((p) => p.id)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('未知 id 被忽略；重复 id 只出现一次', () => {
    const items = [photo('a'), photo('b')]
    expect(orderByIds(items, ['x', 'b', 'b', 'a', 'x']).map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('全量 ids 等价于精确重排', () => {
    const items = [photo('a'), photo('b'), photo('c')]
    expect(orderByIds(items, ['c', 'b', 'a']).map((p) => p.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('moveRelative', () => {
  const items = [photo('a'), photo('b'), photo('c'), photo('d')]

  it('before：插到目标之前（目标后移）', () => {
    expect(moveRelative(items, 'd', 'b', 'before').map((p) => p.id)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('after：插到目标之后', () => {
    expect(moveRelative(items, 'a', 'c', 'after').map((p) => p.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('同 id / 未知 id 原样返回', () => {
    expect(moveRelative(items, 'a', 'a', 'before').map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(moveRelative(items, 'x', 'b', 'before').map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(moveRelative(items, 'a', 'x', 'before').map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('不修改输入数组', () => {
    moveRelative(items, 'a', 'd', 'before')
    expect(items.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})
