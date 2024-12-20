export const BrandsList = [
  'Apple',
  'Canon',
  'Dji',
  'Fujifilm',
  'Huawei',
  'Leica',
  'Xiaomi',
  'Nikon Corporation',
  'Sony',
  // Panasonic DMC- 和 DC- 都属于 Lumix 相机系列
  'Panasonic',
  'Ricoh',
  'Olympus',
  // 影石 Insta360
  'Arashi Vision',
  '未收录',
]

// 获取品牌图标 URL
export function getBrandUrl(brand: string): string {
  return `./brand/${brand === '未收录' ? 'unknow.svg' : `${brand}.svg`}`
}
