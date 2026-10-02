/**
 * EXIF 写入桥接 —— little_exif WASM（预构建产物 src/wasm/exif/，提交进仓库）。
 * 产物重建：cd rust/exif-writer && pnpm build:wasm
 */

export type ImageType = 'jpeg' | 'png' | 'webp' | 'heif' | 'tiff' | 'jxl'

type ExifModule = {
  copy_exif: (
    source: Uint8Array,
    sourceType: string,
    target: Uint8Array,
    targetType: string
  ) => Uint8Array
  detect_type: (bytes: Uint8Array) => string
}

let modulePromise: Promise<ExifModule> | null = null

async function loadModule(): Promise<ExifModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const mod = await import('@/wasm/exif/picseal_exif')
      await mod.default()
      return mod as unknown as ExifModule
    })()
  }
  return modulePromise
}

/** 把源文件 EXIF 拷贝进目标字节（跨格式）。失败抛错，由调用方决定降级策略。 */
export async function copyExif(
  source: ArrayBuffer,
  sourceType: ImageType,
  target: ArrayBuffer,
  targetType: ImageType
): Promise<ArrayBuffer> {
  const mod = await loadModule()
  const result = mod.copy_exif(
    new Uint8Array(source),
    sourceType,
    new Uint8Array(target),
    targetType
  )
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) as ArrayBuffer
}

/** 文件头嗅探类型，未知返回 undefined */
export async function detectType(bytes: ArrayBuffer): Promise<ImageType | undefined> {
  const mod = await loadModule()
  const t = mod.detect_type(new Uint8Array(bytes))
  return (t || undefined) as ImageType | undefined
}

export function isExifSupported(format: string): format is ImageType {
  return ['jpeg', 'png', 'webp'].includes(format)
}
