import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatGps,
  formatParams,
  formatShutter,
  normalizeExif,
  pickDateTime
} from './reader'

describe('formatShutter', () => {
  it('formats fast shutters as fractions', () => {
    expect(formatShutter(1 / 250)).toBe('1/250')
  })

  it('snaps near-standard denominators', () => {
    expect(formatShutter(1 / 253)).toBe('1/250')
  })

  it('keeps odd denominators honest', () => {
    expect(formatShutter(1 / 137)).toBe('1/137')
  })

  it('formats long exposures in seconds', () => {
    expect(formatShutter(30)).toBe('30″')
    expect(formatShutter(1)).toBe('1″')
    expect(formatShutter(2.5)).toBe('2.5″')
  })
})

describe('formatParams', () => {
  it('joins available fields with 35mm equivalent preferred', () => {
    expect(
      formatParams({ focal35: 24, focalLength: 12, fNumber: 1.8, exposureTime: 1 / 250, iso: 100 })
    ).toBe('24mm f/1.8 1/250s ISO100')
  })

  it('falls back to actual focal length', () => {
    expect(formatParams({ focalLength: 50 })).toBe('50mm')
  })

  it('returns empty string without data', () => {
    expect(formatParams({})).toBe('')
  })

  it('trims trailing .0 on focal and aperture', () => {
    expect(formatParams({ focal35: 50, fNumber: 2.0 })).toBe('50mm f/2')
  })
})

describe('formatGps', () => {
  it('formats DMS with hemispheres', () => {
    expect(formatGps({ lat: 39.907, lng: 116.391 })).toBe(
      '39°54′25″N 116°23′28″E'
    )
  })

  it('handles southern and western hemispheres', () => {
    expect(formatGps({ lat: -33.86, lng: -151.2 })).toBe(
      '33°51′36″S 151°12′00″W'
    )
  })
})

describe('formatDate', () => {
  it('formats default pattern', () => {
    expect(formatDate(new Date(2024, 0, 9, 8, 5))).toBe('2024-01-09 08:05')
  })
})

describe('pickDateTime', () => {
  it('follows the fallback chain', () => {
    const original = new Date(2023, 5, 1, 12, 0)
    const created = new Date(2023, 5, 2, 12, 0)
    expect(pickDateTime({ DateTimeOriginal: original, CreateDate: created })).toBe(original)
    expect(pickDateTime({ CreateDate: created })).toBe(created)
  })

  it('rejects invalid dates', () => {
    expect(pickDateTime({ DateTimeOriginal: new Date(NaN) })).toBeUndefined()
    expect(pickDateTime({})).toBeUndefined()
  })
})

describe('normalizeExif', () => {
  it('maps brand and prettifies model', () => {
    const meta = normalizeExif({
      Make: 'SONY',
      Model: 'ILCE-7M4',
      FocalLengthIn35mmFormat: 85,
      FNumber: 1.8,
      ExposureTime: 1 / 250,
      ISO: 100
    })
    expect(meta.brandId).toBe('sony')
    // α7M 系官方名不带 M，代数用罗马数字（α7 IV）
    expect(meta.modelPretty).toBe('α7 IV')
  })

  it('matches panasonic LUMIX transform', () => {
    const meta = normalizeExif({ Make: 'Panasonic', Model: 'DMC-GX85' })
    expect(meta.modelPretty).toBe('LUMIX GX85')
  })

  it('keeps brand prefix and romanizes generations（semi-utils 语义）', () => {
    // 品牌前缀保留（CameraModelName 原样展示）
    expect(normalizeExif({ Make: 'NIKON CORPORATION', Model: 'NIKON Z 8' }).modelPretty).toBe('NIKON Z 8')
    // 代际下划线后缀 → 罗马数字
    expect(normalizeExif({ Make: 'NIKON CORPORATION', Model: 'NIKON Z 6_2' }).modelPretty).toBe('NIKON Z 6II')
    expect(normalizeExif({ Make: 'NIKON CORPORATION', Model: 'NIKON Z 50_2' }).modelPretty).toBe('NIKON Z 50II')
    expect(normalizeExif({ Make: 'Canon', Model: 'Canon EOS R6m2' }).modelPretty).toBe('Canon EOS R6 Mark II')
    expect(normalizeExif({ Make: 'SONY', Model: 'ILCE-7RM5' }).modelPretty).toBe('α7R V')
    expect(normalizeExif({ Make: 'SONY', Model: 'ILCE-7CM2' }).modelPretty).toBe('α7C II')
    // 非代数数字不受影响
    expect(normalizeExif({ Make: 'NIKON CORPORATION', Model: 'NIKON D850' }).modelPretty).toBe('NIKON D850')
    expect(normalizeExif({ Make: 'NIKON CORPORATION', Model: 'NIKON Z fc' }).modelPretty).toBe('NIKON Z fc')
  })

  it('returns size only when exif missing', () => {
    expect(normalizeExif(undefined, { width: 100, height: 50 })).toEqual({
      width: 100,
      height: 50
    })
  })

  it('reads gps with reference signs', () => {
    const meta = normalizeExif({
      GPSLatitude: 33.86,
      GPSLatitudeRef: 'S',
      GPSLongitude: 151.2,
      GPSLongitudeRef: 'E'
    })
    expect(meta.gps).toEqual({ lat: -33.86, lng: 151.2 })
  })
})
