/**
 * 放映室时间轴 —— 纯逻辑，零 DOM / 零 canvas 依赖（绘制薄层在 engine）。
 *
 * 结构：开场视频段 → 片头卡 → 照片×N（Ken Burns 推拉 + 交叉溶解）→ 谢幕卡。
 * 段与段以 CROSSFADE 重叠排布；frameAt(t) 产出有序图层（含透明度与裁剪参数），
 * engine 只做 drawImage / fillText。照片选取三态（不足 / 恰好 / 超量）与
 * 等距采样（手挑器预选）也在此层，vitest 直测。
 */
import type { PhotoMeta } from '../types'
import { captureTimeOf, stableTimeSort } from '../order'

/* ───────────────────────── 常量（成片规格，用户已拍板） ───────────────────────── */

/** 参与剪辑的照片下限：不足则禁用生成，鼓励继续拍摄 */
export const CINEMA_MIN_PHOTOS = 16
/** 参与剪辑的照片上限：超出进手挑器，等距采样预选 */
export const CINEMA_MAX_PHOTOS = 48
/** 成片规格：1920×1080 @30fps */
export const CINEMA_WIDTH = 1920
export const CINEMA_HEIGHT = 1080
export const CINEMA_FPS = 30

/** 单张照片时长（秒）与相邻照片交叉溶解宽度（秒） */
export const CINEMA_PHOTO_SECONDS = 4.5
export const CINEMA_CROSSFADE = 0.8
/** 片头卡 / 谢幕卡时长 */
export const CINEMA_TITLE_SECONDS = 4
export const CINEMA_OUTRO_SECONDS = 6
/** 配乐淡入 / 淡出（秒）—— 跟随片长策略 */
export const CINEMA_MUSIC_FADE_IN = 1.6
export const CINEMA_MUSIC_FADE_OUT = 3.2

/* ───────────────────────── 照片选取 ───────────────────────── */

export interface CinemaPhoto {
  id: string
  meta?: PhotoMeta
}

export type SelectionStatus = 'insufficient' | 'ok' | 'over'

export interface SelectionResult<T> {
  status: SelectionStatus
  /** 基准序完整列表（默认拍摄时间升序，无 EXIF 时间者按原相对顺序沉底；order:'import' 时保持原序） */
  sorted: T[]
  /** over 时为等距采样的上限预选（手挑器起点），否则同 sorted */
  selected: T[]
  /** 距下限还差几张（insufficient 时 >0） */
  missing: number
}

export interface SelectionOptions {
  min?: number
  max?: number
  /** 基准序：captureTime = 拍摄时间升序（默认），import = 保持导入 / 工作台传入顺序 */
  order?: 'captureTime' | 'import'
  /** 时间戳（毫秒）；NaN 表示无时间，排在有时间者之后 */
  timeOf?: (item: CinemaPhoto) => number
}

/** 选取三态：不足（missing>0）/ 恰好 / 超量（selected=等距采样预选） */
export function selectPhotos<T extends CinemaPhoto>(items: readonly T[], opts: SelectionOptions = {}): SelectionResult<T> {
  const min = opts.min ?? CINEMA_MIN_PHOTOS
  const max = opts.max ?? CINEMA_MAX_PHOTOS
  const timeOf = opts.timeOf ?? ((item: CinemaPhoto) => captureTimeOf(item.meta))
  const ordered = opts.order === 'import' ? [...items] : stableTimeSort(items, timeOf)

  // 稳定排序：拍摄时间升序（order:'import' 时保持原序）；NaN 沉底且保持导入相对顺序
  const sorted = ordered

  if (sorted.length < min) {
    return { status: 'insufficient', sorted, selected: [], missing: min - sorted.length }
  }
  if (sorted.length > max) {
    return { status: 'over', sorted, selected: sampleEvenly(sorted, max), missing: 0 }
  }
  return { status: 'ok', sorted, selected: sorted, missing: 0 }
}

/** 等距采样：首尾必含，中间按比例取点（手挑器预选） */
export function sampleEvenly<T>(sorted: readonly T[], n: number): T[] {
  if (n <= 0) return []
  if (n >= sorted.length) return [...sorted]
  if (n === 1) return [sorted[0]!]
  const out: T[] = []
  for (let i = 0; i < n; i += 1) {
    out.push(sorted[Math.round((i * (sorted.length - 1)) / (n - 1))]!)
  }
  return out
}

/* ───────────────────────── Ken Burns ───────────────────────── */

export interface KenBurns {
  zoomFrom: number
  zoomTo: number
  panFromX: number
  panFromY: number
  panToX: number
  panToY: number
}

/** 推/拉交替 + 横向缓移相位循环：偶数段推近、奇数段拉远，平移方向四段一轮回 */
export function kenburnsPlan(index: number): KenBurns {
  const push = index % 2 === 0
  const drift = [0, 1, 0, -1][index % 4] ?? 0
  const zoomFrom = push ? 1.05 : 1.16
  const zoomTo = push ? 1.16 : 1.05
  const panBase = drift * 0.35
  return {
    zoomFrom,
    zoomTo,
    panFromX: -panBase,
    panFromY: 0,
    panToX: panBase,
    panToY: drift === 0 ? -0.12 : 0
  }
}

export interface KenburnsState {
  zoom: number
  panX: number
  panY: number
}

/** smoothstep 缓动的插值（p 已夹取 0-1） */
export function kenburnsAt(kb: KenBurns, p: number): KenburnsState {
  const e = p * p * (3 - 2 * p)
  return {
    zoom: kb.zoomFrom + (kb.zoomTo - kb.zoomFrom) * e,
    panX: kb.panFromX + (kb.panToX - kb.panFromX) * e,
    panY: kb.panFromY + (kb.panToY - kb.panFromY) * e
  }
}

export interface CropRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

/**
 * cover 裁剪矩形（Ken Burns 数学）：以 viewW×viewH 的画幅在图中取 cover 基准框，
 * zoom（≥1）向内收窄，pan ∈ [-1,1] 把中心移向可用松弛的两侧（自动夹回界内）。
 */
export function coverCropRect(
  imgW: number,
  imgH: number,
  viewW: number,
  viewH: number,
  zoom: number,
  panX: number,
  panY: number
): CropRect {
  const z = Math.max(1, zoom)
  const viewAspect = viewW / viewH
  // zoom=1 时的满幅 cover 基准框
  const baseW = imgW / imgH > viewAspect ? imgH * viewAspect : imgW
  const baseH = baseW / viewAspect
  const sw = Math.min(imgW, baseW / z)
  const sh = Math.min(imgH, baseH / z)
  const slackX = (imgW - sw) / 2
  const slackY = (imgH - sh) / 2
  const sx = imgW / 2 + panX * slackX - sw / 2
  const sy = imgH / 2 + panY * slackY - sh / 2
  return {
    sx: Math.min(Math.max(sx, 0), imgW - sw),
    sy: Math.min(Math.max(sy, 0), imgH - sh),
    sw,
    sh
  }
}

/* ───────────────────────── 时间轴 ───────────────────────── */

export interface PhotoCaption {
  title: string
  sub: string
}

export interface TimelinePhoto extends CinemaPhoto {
  caption?: PhotoCaption
}

export interface SegmentBase {
  start: number
  duration: number
}

export interface IntroSegment extends SegmentBase {
  kind: 'intro'
}

export interface TitleSegment extends SegmentBase {
  kind: 'title'
}

export interface PhotoSegment extends SegmentBase {
  kind: 'photo'
  /** 在 photos 数组中的序号（Ken Burns 相位与胶片帧联动用） */
  index: number
  photo: TimelinePhoto
  kb: KenBurns
}

export interface OutroSegment extends SegmentBase {
  kind: 'outro'
}

export type Segment = IntroSegment | TitleSegment | PhotoSegment | OutroSegment

export interface CinemaTimeline {
  segments: Segment[]
  /** 成片总时长（秒） */
  duration: number
  photoCount: number
  /** 配乐起点（片头卡开始）/ 终点（谢幕结束）—— 跟随片长策略 */
  musicStart: number
  musicEnd: number
  /** 开场段时长（0 = 无开场素材） */
  introSeconds: number
}

export interface TimelineOptions {
  /** 开场视频时长；0/缺省 = 无素材，跳过开场 */
  introSeconds?: number
  photoSeconds?: number
  crossfade?: number
  titleSeconds?: number
  outroSeconds?: number
}

/** 组装时间轴：段间以 crossfade 重叠，musicStart 起于片头卡 */
export function buildTimeline(photos: readonly TimelinePhoto[], opts: TimelineOptions = {}): CinemaTimeline {
  const intro = Math.max(0, opts.introSeconds ?? 0)
  const photoDur = opts.photoSeconds ?? CINEMA_PHOTO_SECONDS
  const xfade = Math.min(opts.crossfade ?? CINEMA_CROSSFADE, photoDur / 2, intro || Infinity)
  const titleDur = opts.titleSeconds ?? CINEMA_TITLE_SECONDS
  const outroDur = opts.outroSeconds ?? CINEMA_OUTRO_SECONDS

  const segments: Segment[] = []
  let cursor = 0

  if (intro > 0) {
    segments.push({ kind: 'intro', start: 0, duration: intro })
    cursor = intro
  }

  const title: TitleSegment = { kind: 'title', start: Math.max(0, cursor - (intro > 0 ? xfade : 0)), duration: titleDur }
  segments.push(title)
  const musicStart = title.start

  cursor = title.start
  photos.forEach((photo, index) => {
    const seg: PhotoSegment = {
      kind: 'photo',
      start: cursor + (index === 0 ? titleDur - xfade : photoDur - xfade),
      duration: photoDur,
      index,
      photo,
      kb: kenburnsPlan(index)
    }
    segments.push(seg)
    cursor = seg.start
  })
  const lastPhotoEnd = photos.length > 0 ? cursor + photoDur : title.start + titleDur

  segments.push({ kind: 'outro', start: lastPhotoEnd - xfade, duration: outroDur })

  return {
    segments,
    duration: lastPhotoEnd - xfade + outroDur,
    photoCount: photos.length,
    musicStart,
    musicEnd: lastPhotoEnd - xfade + outroDur,
    introSeconds: intro
  }
}

/* ───────────────────────── 取帧 ───────────────────────── */

export interface DrawLayer {
  seg: Segment
  /** 图层透明度（0-1），交叉溶解由此驱动 */
  alpha: number
  /** photo 段的字幕透明度（与图层独立：进场后浮现、出场前隐去） */
  captionAlpha: number
  /** photo 段的 Ken Burns 当前状态（intro/title/outro 段无意义） */
  kb?: KenburnsState
}

export interface DrawPlan {
  layers: DrawLayer[]
  /** 谢幕尾部的渐隐至黑（0-1） */
  fadeToBlack: number
  finished: boolean
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

const FIRST_FADE = 0.5
const CAPTION_IN = 0.5
const CAPTION_RAMP = 0.35
const OUTRO_FADE = 0.9

/** t 时刻的绘制计划：与时间轴重叠的段各成一图层，按 start 升序（后段盖上） */
export function frameAt(timeline: CinemaTimeline, t: number): DrawPlan {
  if (t < 0 || t >= timeline.duration) {
    return { layers: [], fadeToBlack: t >= timeline.duration ? 1 : 0, finished: t >= timeline.duration }
  }
  const xfade = timeline.segments.length > 1 ? minOverlap(timeline) : 0
  const layers: DrawLayer[] = []
  for (const seg of timeline.segments) {
    const fadeIn = seg.start > 0 ? xfade : FIRST_FADE
    const inWindow = t >= seg.start - fadeIn && t < seg.start + seg.duration
    if (!inWindow) continue
    const alpha = t < seg.start ? clamp01((t - (seg.start - fadeIn)) / fadeIn) : 1
    let captionAlpha = 0
    let kb: KenburnsState | undefined
    if (seg.kind === 'photo') {
      const p = clamp01((t - seg.start) / seg.duration)
      kb = kenburnsAt(seg.kb, p)
      const local = t - seg.start
      const outAt = seg.duration - CAPTION_IN
      captionAlpha =
        Math.min(clamp01((local - CAPTION_IN) / CAPTION_RAMP), clamp01((outAt - local) / CAPTION_RAMP))
    }
    layers.push({ seg, alpha, captionAlpha, kb })
  }
  const outro = timeline.segments[timeline.segments.length - 1]
  const fadeToBlack =
    outro?.kind === 'outro'
      ? clamp01((t - (outro.start + outro.duration - OUTRO_FADE)) / OUTRO_FADE)
      : 0
  return { layers, fadeToBlack, finished: false }
}

/** 段间实际重叠宽度（首段前导淡入不计） */
function minOverlap(timeline: CinemaTimeline): number {
  let overlap = Number.POSITIVE_INFINITY
  const first = timeline.segments[0]
  let prevEnd = first ? first.start + first.duration : 0
  for (const seg of timeline.segments.slice(1)) {
    overlap = Math.min(overlap, Math.max(0, prevEnd - seg.start))
    prevEnd = seg.start + seg.duration
  }
  return Number.isFinite(overlap) ? overlap : 0
}
