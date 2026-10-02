import exifr from 'exifr'
import { matchBrand, prettifyModel } from '../brands'
import type { PhotoMeta } from '../types'

/** exifr pick 集 —— 批量导入时只解析这些标签 */
const PICK_TAGS = [
  'Make',
  'Model',
  'LensModel',
  'FocalLength',
  'FocalLengthIn35mmFormat',
  'FNumber',
  'ExposureTime',
  'ISO',
  'DateTimeOriginal',
  'CreateDate',
  'ModifyDate',
  'DateTimeDigitized',
  'GPSLatitude',
  'GPSLongitude',
  'GPSLatitudeRef',
  'GPSLongitudeRef',
  'ExifImageWidth',
  'ExifImageHeight',
  'ImageWidth',
  'ImageHeight'
] as const

export interface RawExif {
  [key: string]: unknown
}

/**
 * 读取一张照片的 EXIF 并归一化为 PhotoMeta。
 * 纯函数式归一化与解析分离，便于单测。
 */
export async function readPhotoMeta(file: Blob): Promise<PhotoMeta> {
  let raw: RawExif | undefined
  try {
    raw = await exifr.parse(file, { pick: [...PICK_TAGS] })
  } catch {
    raw = undefined
  }
  return normalizeExif(raw, await tryImageSize(file))
}

async function tryImageSize(file: Blob): Promise<{ width?: number; height?: number }> {
  try {
    const bmp = await createImageBitmap(file)
    const size = { width: bmp.width, height: bmp.height }
    bmp.close()
    return size
  } catch {
    return {}
  }
}

const DATE_KEYS = [
  'DateTimeOriginal',
  'CreateDate',
  'DateTimeDigitized',
  'ModifyDate'
] as const

/** 时间长回退链：拍摄时间 → 创建时间 → 数字化时间 → 修改时间（semi-utils 策略） */
export function pickDateTime(raw: RawExif): Date | undefined {
  for (const key of DATE_KEYS) {
    const v = raw[key]
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v
    if (typeof v === 'string') {
      const d = new Date(v)
      if (!Number.isNaN(d.getTime())) return d
    }
  }
  return undefined
}

export function normalizeExif(raw: RawExif | undefined, size?: { width?: number; height?: number }): PhotoMeta {
  if (!raw) return { ...size }

  const make = asString(raw.Make)
  const model = asString(raw.Model)
  const brand = matchBrand(make, model)

  const gpsLat = asNumber(raw.GPSLatitude)
  const gpsLng = asNumber(raw.GPSLongitude)
  const hasGps =
    gpsLat !== undefined && gpsLng !== undefined && (gpsLat !== 0 || gpsLng !== 0)

  return {
    make,
    model,
    modelPretty: prettifyModel(brand, model) ?? model,
    brandId: brand?.id,
    lens: cleanLens(asString(raw.LensModel)),
    focalLength: asNumber(raw.FocalLength),
    focal35: asNumber(raw.FocalLengthIn35mmFormat),
    fNumber: asNumber(raw.FNumber),
    exposureTime: asNumber(raw.ExposureTime),
    iso: asNumber(raw.ISO),
    dateTimeOriginal: pickDateTime(raw),
    gps:
      hasGps && gpsLat !== undefined && gpsLng !== undefined
        ? { lat: withRef(gpsLat, asString(raw.GPSLatitudeRef), 'S'), lng: withRef(gpsLng, asString(raw.GPSLongitudeRef), 'W') }
        : undefined,
    width: asNumber(raw.ExifImageWidth) ?? asNumber(raw.ImageWidth) ?? size?.width,
    height: asNumber(raw.ExifImageHeight) ?? asNumber(raw.ImageHeight) ?? size?.height
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseFloat(v)
    if (Number.isFinite(n)) return n
  }
  if (Array.isArray(v) && typeof v[0] === 'number') return v[0]
  return undefined
}

/** 去掉镜头名里的品牌前缀和 "F..." 版本号噪声（FE 85mm F1.4 GM 保留原样，仅清理常见前缀） */
function cleanLens(lens?: string): string | undefined {
  if (!lens) return undefined
  return lens.replace(/^(SONY|Canon|NIKON|FUJIFILM|PANASONIC|OLYMPUS|OM SYSTEM)\s+/i, '').trim() || undefined
}

function withRef(value: number, ref: string | undefined, negativeRef: string): number {
  const neg = ref?.toUpperCase().startsWith(negativeRef)
  return neg ? -Math.abs(value) : value
}

/* ───────────────────────── 格式化（渲染消费） ───────────────────────── */

/** 参数串：24mm f/1.8 1/250s ISO100（等效焦距优先） */
export function formatParams(meta: PhotoMeta): string {
  const parts: string[] = []
  const focal = meta.focal35 ?? meta.focalLength
  if (focal !== undefined) parts.push(`${stripZero(focal)}mm`)
  if (meta.fNumber !== undefined) parts.push(`f/${stripZero(meta.fNumber)}`)
  if (meta.exposureTime !== undefined) parts.push(`${formatShutter(meta.exposureTime)}s`)
  if (meta.iso !== undefined) parts.push(`ISO${Math.round(meta.iso)}`)
  return parts.join(' ')
}

/** 快门：1/250 或 30″（≥1s 直接显示秒） */
export function formatShutter(seconds: number): string {
  if (seconds >= 1) return Number.isInteger(seconds) ? `${seconds}″` : `${stripZero(seconds)}″`
  const denom = Math.round(1 / seconds)
  // 常见快门档位友好化：1/253 → 1/250
  const friendly = denom <= 20 ? denom : snapDenominator(denom)
  return `1/${friendly}`
}

function snapDenominator(d: number): number {
  const standard = [30, 45, 60, 90, 125, 180, 250, 350, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000]
  let best = standard[0]!
  let bestErr = Number.POSITIVE_INFINITY
  for (const s of standard) {
    const err = Math.abs(Math.log(d / s))
    if (err < bestErr) {
      bestErr = err
      best = s
    }
  }
  return bestErr < 0.04 ? best : d
}

export function stripZero(n: number): string {
  const s = n.toFixed(1)
  return s.endsWith('.0') ? String(Math.round(n)) : s
}

/** GPS：39°54′26″N 116°23′29″E（修复旧版 match null 崩溃） */
export function formatGps(gps: { lat: number; lng: number }): string {
  return `${ddToDms(gps.lat, 'NS')} ${ddToDms(gps.lng, 'EW')}`
}

function ddToDms(dd: number, axis: 'NS' | 'EW'): string {
  const hemi = axis === 'NS' ? (dd >= 0 ? 'N' : 'S') : dd >= 0 ? 'E' : 'W'
  const abs = Math.abs(dd)
  const deg = Math.floor(abs)
  const minFloat = (abs - deg) * 60
  const min = Math.floor(minFloat)
  const sec = Math.round((minFloat - min) * 60)
  const minAdj = sec === 60 ? min + 1 : min
  const secAdj = sec === 60 ? 0 : sec
  return `${deg}°${String(minAdj).padStart(2, '0')}′${String(secAdj).padStart(2, '0')}″${hemi}`
}

const DEFAULT_DATE_FORMAT = 'YYYY-MM-dd HH:mm'

/** yyyy-MM-dd HH:mm（毫秒不展示） */
export function formatDate(date: Date, pattern: string = DEFAULT_DATE_FORMAT): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return pattern
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/dd/g, pad(date.getDate()))
    .replace(/HH/g, pad(date.getHours()))
    .replace(/mm/g, pad(date.getMinutes()))
    .replace(/ss/g, pad(date.getSeconds()))
}
