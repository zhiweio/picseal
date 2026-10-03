import { describe, expect, it } from 'vitest'
import type { PhotoMeta } from '../types'
import {
  CINEMA_MAX_PHOTOS,
  CINEMA_MIN_PHOTOS,
  buildTimeline,
  coverCropRect,
  frameAt,
  kenburnsPlan,
  sampleEvenly,
  selectPhotos
} from './timeline'

function photo(id: string, at?: string | number): { id: string; meta?: PhotoMeta } {
  if (at === undefined) return { id }
  const t = typeof at === 'number' ? at : new Date(at).getTime()
  return { id, meta: { dateTimeOriginal: new Date(t) } }
}

/* ───────────────────────── 选取三态与等距采样 ───────────────────────── */

describe('selectPhotos', () => {
  it('不足下限：insufficient，missing = 差额', () => {
    const r = selectPhotos([photo('a'), photo('b')])
    expect(r.status).toBe('insufficient')
    expect(r.missing).toBe(CINEMA_MIN_PHOTOS - 2)
    expect(r.selected).toEqual([])
    expect(r.sorted).toHaveLength(2)
  })

  it('恰好区间：ok，selected = 全部且按拍摄时间升序', () => {
    const items = Array.from({ length: CINEMA_MIN_PHOTOS }, (_, i) => photo(`p${i}`, `2024-01-${String((i % 28) + 1).padStart(2, '0')}T10:00:00`))
    items.reverse() // 乱序输入
    const r = selectPhotos(items)
    expect(r.status).toBe('ok')
    expect(r.selected).toHaveLength(CINEMA_MIN_PHOTOS)
    const times = r.sorted.map((p) => p.meta?.dateTimeOriginal?.getTime())
    expect([...times].sort((a, b) => a! - b!)).toEqual(times)
  })

  it('超出上限：over，等距采样预选含首尾', () => {
    const n = CINEMA_MAX_PHOTOS + 20
    const items = Array.from({ length: n }, (_, i) => photo(`p${i}`, 1_000_000 + i * 1000))
    const r = selectPhotos(items)
    expect(r.status).toBe('over')
    expect(r.selected).toHaveLength(CINEMA_MAX_PHOTOS)
    expect(r.selected[0]!.id).toBe('p0')
    expect(r.selected[r.selected.length - 1]!.id).toBe(`p${n - 1}`)
    expect(r.sorted).toHaveLength(n)
  })

  it('无 EXIF 时间者沉底且保持相对顺序（稳定排序）', () => {
    const items = [photo('noMeta-b'), photo('timed', '2024-05-01'), photo('noMeta-a')]
    const r = selectPhotos(items, { min: 0 })
    expect(r.sorted.map((p) => p.id)).toEqual(['timed', 'noMeta-b', 'noMeta-a'])
  })

  it('自定义 timeOf 优先于默认 EXIF 链', () => {
    const items = [photo('a', '2024-01-01'), photo('b', '2020-01-01')]
    const r = selectPhotos(items, { min: 0, timeOf: (p) => Number(p.id === 'a' ? 5 : 9) })
    expect(r.sorted.map((p) => p.id)).toEqual(['a', 'b'])
  })
})

describe('sampleEvenly', () => {
  it('n ≥ 长度时原样返回', () => {
    expect(sampleEvenly(['a', 'b'], 5)).toEqual(['a', 'b'])
    expect(sampleEvenly([], 3)).toEqual([])
  })

  it('n=1 取首元素', () => {
    expect(sampleEvenly(['a', 'b', 'c'], 1)).toEqual(['a'])
  })

  it('等距且严格递增不重复', () => {
    const out = sampleEvenly(Array.from({ length: 100 }, (_, i) => i), 10)
    expect(out).toHaveLength(10)
    expect(out[0]).toBe(0)
    expect(out[9]).toBe(99)
    for (let i = 1; i < out.length; i += 1) expect(out[i]!).toBeGreaterThan(out[i - 1]!)
  })
})

/* ───────────────────────── 时间轴结构 ───────────────────────── */

describe('buildTimeline', () => {
  const photos = Array.from({ length: 20 }, (_, i) => photo(`p${i}`))

  it('有开场：段序 intro→title→photo×N→outro，段间 crossfade 重叠', () => {
    const tl = buildTimeline(photos, { introSeconds: 38.8 })
    const kinds = tl.segments.map((s) => s.kind)
    expect(kinds[0]).toBe('intro')
    expect(kinds[1]).toBe('title')
    expect(kinds.filter((k) => k === 'photo')).toHaveLength(20)
    expect(kinds[kinds.length - 1]).toBe('outro')

    for (let i = 1; i < tl.segments.length; i += 1) {
      const prev = tl.segments[i - 1]!
      const seg = tl.segments[i]!
      // 后段在前段结束前切入（重叠 = crossfade），且不早于前段起点
      expect(seg.start).toBeLessThan(prev.start + prev.duration)
      expect(seg.start).toBeGreaterThanOrEqual(prev.start)
    }
  })

  it('无开场：首段为 title 且从 0 起，musicStart = 0', () => {
    const tl = buildTimeline(photos)
    expect(tl.segments[0]!.kind).toBe('title')
    expect(tl.segments[0]!.start).toBe(0)
    expect(tl.introSeconds).toBe(0)
    expect(tl.musicStart).toBe(0)
  })

  it('总时长 = 谢幕段终点；musicEnd 与 duration 一致（跟随片长）', () => {
    const tl = buildTimeline(photos, { introSeconds: 10 })
    const outro = tl.segments[tl.segments.length - 1]!
    expect(outro.kind).toBe('outro')
    expect(tl.duration).toBeCloseTo(outro.start + outro.duration, 10)
    expect(tl.musicEnd).toBe(tl.duration)
  })

  it('照片段 start 等差递推：photoSeconds - crossfade', () => {
    const tl = buildTimeline(photos, { introSeconds: 5 })
    const photoSegs = tl.segments.filter((s) => s.kind === 'photo')
    for (let i = 1; i < photoSegs.length; i += 1) {
      expect(photoSegs[i]!.start - photoSegs[i - 1]!.start).toBeCloseTo(4.5 - 0.8, 10)
    }
  })

  it('空照片列表也能产出合法时间轴（title 直连 outro）', () => {
    const tl = buildTimeline([])
    expect(tl.photoCount).toBe(0)
    expect(tl.duration).toBeGreaterThan(0)
    expect(tl.segments.map((s) => s.kind)).toEqual(['title', 'outro'])
  })
})

/* ───────────────────────── 取帧 ───────────────────────── */

describe('frameAt', () => {
  const photos = Array.from({ length: 18 }, (_, i) => photo(`p${i}`))
  const tl = buildTimeline(photos, { introSeconds: 12 })

  it('t<0 空图层；t≥总时长 finished 且全黑', () => {
    expect(frameAt(tl, -1).layers).toEqual([])
    const end = frameAt(tl, tl.duration + 0.1)
    expect(end.finished).toBe(true)
    expect(end.fadeToBlack).toBe(1)
  })

  it('段中部：单图层满透明，photo 段带 Ken Burns 状态与字幕', () => {
    const seg = tl.segments.find((s) => s.kind === 'photo')!
    const mid = frameAt(tl, seg.start + 2)
    expect(mid.layers).toHaveLength(1)
    const layer = mid.layers[0]!
    expect(layer.alpha).toBe(1)
    expect(layer.kb).toBeDefined()
    expect(layer.captionAlpha).toBeGreaterThan(0)
  })

  it('交叉溶解窗口：两图层叠加且 alpha 和近似单调过渡', () => {
    const title = tl.segments[1]!
    const t = title.start + title.duration - 0.8 - 0.4 // photo[0] 淡入窗口中点附近
    const plan = frameAt(tl, t)
    expect(plan.layers.map((l) => l.seg.kind)).toEqual(['title', 'photo'])
    expect(plan.layers[1]!.alpha).toBeGreaterThan(0)
    expect(plan.layers[1]!.alpha).toBeLessThan(1)
  })

  it('谢幕尾部渐隐至黑', () => {
    const outro = tl.segments[tl.segments.length - 1]!
    expect(frameAt(tl, outro.start + outro.duration - 0.1).fadeToBlack).toBeGreaterThan(0.8)
    expect(frameAt(tl, outro.start + outro.duration - 2).fadeToBlack).toBe(0)
  })
})

/* ───────────────────────── Ken Burns 裁剪 ───────────────────────── */

describe('coverCropRect', () => {
  it('zoom=1、pan=0 时为满幅 cover 基准框（宽图贴高裁宽、长图贴宽裁高）', () => {
    const landscape = coverCropRect(6000, 3000, 1920, 1080, 1, 0, 0)
    expect(landscape.sh).toBe(3000)
    expect(landscape.sw / landscape.sh).toBeCloseTo(1920 / 1080, 6)
    expect(landscape.sx + landscape.sw / 2).toBeCloseTo(3000, 6)

    const portrait = coverCropRect(3000, 6000, 1920, 1080, 1, 0, 0)
    expect(portrait.sw).toBe(3000)
    expect(portrait.sh).toBeCloseTo(3000 / (1920 / 1080), 6)
  })

  it('zoom 收窄裁剪框且保持画幅比；pan 在松弛内平移并夹回界内', () => {
    const base = coverCropRect(6000, 4000, 1920, 1080, 1, 0, 0)
    const r = coverCropRect(6000, 4000, 1920, 1080, 1.16, 1, 1)
    expect(r.sw / r.sh).toBeCloseTo(1920 / 1080, 6)
    expect(r.sw).toBeLessThan(base.sw) // 收窄
    expect(r.sx).toBeGreaterThanOrEqual(0)
    expect(r.sy).toBeGreaterThanOrEqual(0)
    expect(r.sx + r.sw).toBeLessThanOrEqual(6000 + 1e-6)
    expect(r.sy + r.sh).toBeLessThanOrEqual(4000 + 1e-6)
  })

  it('极端 pan 下裁剪框仍完整落在图内（clamp）', () => {
    for (const pan of [-2, 0, 2]) {
      const r = coverCropRect(2400, 1600, 1920, 1080, 1.1, pan, -pan)
      expect(r.sx).toBeGreaterThanOrEqual(-1e-9)
      expect(r.sy).toBeGreaterThanOrEqual(-1e-9)
      expect(r.sx + r.sw).toBeLessThanOrEqual(2400 + 1e-9)
      expect(r.sy + r.sh).toBeLessThanOrEqual(1600 + 1e-9)
    }
  })
})

describe('kenburnsPlan', () => {
  it('推拉交替：偶数推近（zoom 升）、奇数拉远（zoom 降）', () => {
    expect(kenburnsPlan(0).zoomTo).toBeGreaterThan(kenburnsPlan(0).zoomFrom)
    expect(kenburnsPlan(1).zoomTo).toBeLessThan(kenburnsPlan(1).zoomFrom)
    expect(kenburnsPlan(2).zoomTo).toBeGreaterThan(kenburnsPlan(2).zoomFrom)
  })
})
