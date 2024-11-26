import type { ExifData, ExifParamsForm } from '../types'
import moment from 'moment'
import { BrandsList } from './BrandUtils'

export const DefaultPictureExif = {
  model: 'XIAOMI 13 ULTRA',
  date: moment().format('YYYY.MM.DD HH:mm:ss'),
  gps: `41°12'47"N 124°00'16"W`,
  device: '75mm f/1.8 1/33s ISO800',
  brand: 'leica',
  brand_url: './brand/leica.svg',
  scale: 0.8,
  fontSize: 'normal',
  fontWeight: 'bold',
  fontFamily: 'misans',
}

export const ExhibitionImages = [
  './exhibition/apple.jpg',
  './exhibition/canon.jpg',
  './exhibition/dji.jpg',
  './exhibition/fujifilm.jpg',
  './exhibition/huawei.jpg',
  './exhibition/leica.jpg',
  './exhibition/xiaomi.jpg',
  './exhibition/nikon.jpg',
  './exhibition/sony.jpg',
]

// 格式化 GPS 数据
export function formatGPS(gps: string | undefined, gpsRef: string | undefined): string {
  if (!gps)
    return ''
  const [degrees, minutes, seconds, dir] = gps
    .match(/(\d+\.?\d*)|([NSWE]$)/gim)
    .map(item => (!Number.isNaN(Number(item)) ? `${~~item}`.padStart(2, '0') : item))
  if (gpsRef)
    return `${degrees}°${minutes}'${seconds}"${gpsRef}`
  else if (dir)
    return `${degrees}°${minutes}'${seconds}"${dir}`
  else return `${degrees}°${minutes}'${seconds}"`
}

// 格式化品牌
export function formatBrand(make: string | undefined): string {
  const brand = (make || '').toLowerCase()
  for (const b of BrandsList.map(b => b.toLowerCase())) {
    if (brand.includes(b)) {
      return b
    }
  }
  return brand
}

// 格式化曝光时间
export function formatExposureTime(exposureTime: string | undefined): string {
  if (!exposureTime)
    return ''
  const [numerator, denominator] = exposureTime.split('/').filter(Boolean).map(item => Math.floor(Number(item)))
  return [numerator, denominator].join('/')
}

// 解析 EXIF 数据
export function parseExifData(data: ExifData[]): Partial<ExifParamsForm> {
  const exif = {
    GPSLatitude: '',
    GPSLatitudeRef: '',
    GPSLongitude: '',
    GPSLongitudeRef: '',
    FocalLengthIn35mmFilm: '',
    FocalLength: '',
    FNumber: '',
    ExposureTime: '',
    PhotographicSensitivity: '',
    Model: '',
    Make: '',
    DateTimeOriginal: '',
  }
  const exifValues = new Map(data.map(item => [item.tag, item.value]))
  const exifValuesWithUnit = new Map(data.map(item => [item.tag, item.value_with_unit]))

  exif.GPSLatitude = exifValues.get('GPSLatitude') || ''
  exif.GPSLatitudeRef = exifValues.get('GPSLatitudeRef') || ''
  exif.GPSLongitude = exifValues.get('GPSLongitude') || ''
  exif.GPSLongitudeRef = exifValues.get('GPSLongitudeRef') || ''
  exif.FocalLengthIn35mmFilm = exifValuesWithUnit.get('FocalLengthIn35mmFilm') || ''
  exif.FocalLength = exifValuesWithUnit.get('FocalLength') || ''
  exif.FNumber = exifValuesWithUnit.get('FNumber') || ''
  exif.ExposureTime = exifValues.get('ExposureTime') || ''
  exif.PhotographicSensitivity = exifValues.get('PhotographicSensitivity') || ''
  exif.Model = exifValues.get('Model') || ''
  exif.Make = exifValues.get('Make') || ''
  exif.DateTimeOriginal = exifValues.get('DateTimeOriginal') || ''

  const gps = `${formatGPS(exif.GPSLatitude, exif.GPSLatitudeRef)} ${formatGPS(exif.GPSLongitude, exif.GPSLongitudeRef)}`
  const device = [
    `${(exif.FocalLengthIn35mmFilm || exif.FocalLength).replace(/\s+/g, '')}`,
    exif.FNumber?.split('/')?.map((n, i) => (i ? (+n).toFixed(1) : n)).join('/'),
    exif.ExposureTime ? `${formatExposureTime(exif.ExposureTime)}s` : '',
    exif.PhotographicSensitivity ? `ISO${exif.PhotographicSensitivity}` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return {
    model: exif.Model || 'Unknown Model',
    date: exif.DateTimeOriginal || moment().format('YYYY.MM.DD HH:mm:ss'),
    gps,
    device,
    brand: `${formatBrand(exif.Make)}`,
  }
}

// 在组件初始化时随机选择一张照片
export function getRandomImage() {
  const randomIndex = Math.floor(Math.random() * ExhibitionImages.length)
  return ExhibitionImages[randomIndex]
}
