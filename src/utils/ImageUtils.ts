import type { ExifData, ExifParamsForm } from '../types'
import moment from 'moment'
import { BrandsList } from './BrandUtils'

export const DefaultPictureExif = {
  model: 'XIAOMI 13 ULTRA',
  date: moment().format('YYYY.MM.DD HH:mm'),
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
  './exhibition/panasonic.jpg',
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
  if ((make || '') === 'Arashi Vision') {
    return 'insta360'
  }
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

// 格式化拍摄时间
export function formatDateTimeOriginal(dateTimeOriginal: string | undefined): string {
  if (!dateTimeOriginal)
    return moment().format('YYYY.MM.DD HH:mm')
  return moment(dateTimeOriginal).format('YYYY-MM-DD HH:mm')
}

export function formatModel(model: string, brand: string): string {
  const camera_model: string = model.replace(/[",]/g, '')
  if (brand === 'sony') {
    return camera_model.replace(/[",]/g, '').replace('ILCE-', 'α').toLowerCase()
  }
  if (brand === 'nikon corporation') {
    return camera_model.replace(/Z/gi, 'ℤ')
  }
  if (brand === 'panasonic') {
    if (camera_model.startsWith('DMC-') || camera_model.startsWith('DC-'))
      return `LUMIX ${camera_model}`
  }
  return camera_model
}

// 解析 EXIF 数据
export function parseExifData(data: ExifData[]): Partial<ExifParamsForm> {
  const exifValues = new Map(data.map(item => [item.tag, item.value]))
  const exifValuesWithUnit = new Map(data.map(item => [item.tag, item.value_with_unit]))
  const make: string = (exifValues.get('Make') || '').replace(/[",]/g, '')
  const brand: string = formatBrand(make || 'unknow')
  if (brand === 'unknow') {
    return DefaultPictureExif
  }

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
  exif.Make = make
  exif.Model = `${formatModel((exifValues.get('Model') || ''), brand)}`
  exif.GPSLatitude = exifValues.get('GPSLatitude') || ''
  exif.GPSLatitudeRef = exifValues.get('GPSLatitudeRef') || ''
  exif.GPSLongitude = exifValues.get('GPSLongitude') || ''
  exif.GPSLongitudeRef = exifValues.get('GPSLongitudeRef') || ''
  exif.FocalLengthIn35mmFilm = exifValuesWithUnit.get('FocalLengthIn35mmFilm') || ''
  exif.FocalLength = exifValuesWithUnit.get('FocalLength') || ''
  exif.FNumber = exifValuesWithUnit.get('FNumber') || ''
  exif.ExposureTime = exifValues.get('ExposureTime') || ''
  exif.PhotographicSensitivity = exifValues.get('PhotographicSensitivity') || ''
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
    model: exif.Model || 'PICSEAL',
    date: `${formatDateTimeOriginal(exif.DateTimeOriginal)}`,
    gps,
    device,
    brand,
  }
}

// 在组件初始化时随机选择一张照片
export function getRandomImage() {
  const randomIndex = Math.floor(Math.random() * ExhibitionImages.length)
  return ExhibitionImages[randomIndex]
}

export function dataURLtoBlob(dataURL: string): Blob {
  const byteString: string = atob(dataURL.split(',')[1])
  const mimeString: string = dataURL.split(',')[0].split(':')[1].split(';')[0]
  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)
  for (let i: number = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i)
  }
  return new Blob([ab], { type: mimeString })
}
