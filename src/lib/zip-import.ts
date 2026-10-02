import { unzip } from 'fflate'

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|heic|heif|hif|tiff?)$/i

export interface ZipImportResult {
  files: File[]
  /** 压缩包内跳过的非图片条目数 */
  skipped: number
}

/** 保持压缩包内的相对目录结构作为导入分组信息（文件名保留原样） */
function normalizeName(path: string): string {
  return path
    .replace(/^__MACOSX\//, '')
    .split('/')
    .filter((seg) => seg && !seg.startsWith('.'))
    .join('/')
}

/**
 * 解包图片压缩包。fflate unzip 使用内部 worker 异步解压，不阻塞主线程。
 * 过滤 __MACOSX、隐藏文件与非图片条目。
 */
export function extractImagesFromZip(file: File): Promise<ZipImportResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('zip read failed'))
    reader.onload = () => {
      const buffer = new Uint8Array(reader.result as ArrayBuffer)
      unzip(
        buffer,
        { filter: (f) => !f.name.includes('__MACOSX') && IMAGE_EXT.test(f.name) },
        (err, unzipped) => {
          if (err) {
            reject(new Error('zip parse failed'))
            return
          }
          const files: File[] = []
          let skipped = 0
          for (const [path, data] of Object.entries(unzipped)) {
            if (data.length === 0) {
              skipped += 1
              continue
            }
            const name = normalizeName(path).split('/').pop()
            if (!name) {
              skipped += 1
              continue
            }
            files.push(new File([data], name))
          }
          files.sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true }))
          resolve({ files, skipped })
        }
      )
    }
    reader.readAsArrayBuffer(file)
  })
}

export function isZipFile(file: File): boolean {
  return /\.zip$/i.test(file.name) || file.type === 'application/zip'
}
