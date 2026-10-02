import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PICSEAL — 影像档案终端',
    short_name: 'PICSEAL',
    description:
      '相机品牌风格信息水印，在浏览器本地生成。照片不上传，批量处理，EXIF 完整保留。',
    start_url: '/zh/studio',
    display: 'standalone',
    background_color: '#08121f',
    theme_color: '#08121f',
    lang: 'zh'
  }
}
