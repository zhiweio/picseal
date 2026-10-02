/// <reference lib="webworker" />
import { BUILTIN_TEMPLATES } from '@/core/templates/builtin'
import type { OutputSettings, PhotoMeta, WatermarkTemplate } from '@/core/types'
import { FontBook, LogoBook } from '@/core/render/canvas-utils'
import { renderPhoto } from '@/core/render'
import { copyExif, type ImageType } from '@/core/exif/writer'
import type { WorkerRequest, WorkerResponse } from './protocol'

const fonts = new FontBook()
const logos = new LogoBook()

/** worker 内置模板兜底：主线程传来的 template 引用已结构化克隆，无需查表；保留常量引入以校验体积 */
void BUILTIN_TEMPLATES

function post(response: WorkerResponse, transfer: Transferable[] = []): void {
  ;(self as unknown as Worker).postMessage(response, transfer)
}

async function decode(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' })
}

function canvasToBlob(canvas: OffscreenCanvas, format: string, quality: number): Promise<Blob> {
  return canvas.convertToBlob({ type: `image/${format}`, quality })
}

function extOf(format: OutputSettings['format']): string {
  return format === 'jpeg' ? 'jpg' : format
}

async function handleThumbnail(id: string, file: File, longEdge: number): Promise<void> {
  const bitmap = await decode(file)
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 })
  post({ id, ok: true, kind: 'thumbnail', blob, width: w, height: h })
}

async function handlePreview(
  id: string,
  file: File,
  meta: PhotoMeta,
  template: WatermarkTemplate,
  maxLongEdge: number
): Promise<void> {
  const bitmap = await decode(file)
  const canvas = await renderPhoto({
    photo: bitmap,
    meta,
    template,
    logoBook: logos,
    fonts,
    options: { maxLongEdge, watermark: true }
  })
  bitmap.close()
  const blob = await canvasToBlob(canvas, 'jpeg', 0.82)
  post({ id, ok: true, kind: 'preview', blob, width: canvas.width, height: canvas.height })
}

function outputName(
  file: File,
  meta: PhotoMeta,
  settings: OutputSettings,
  index: number
): string {
  const base = file.name.replace(/\.[^.]+$/, '')
  const stem =
    settings.naming === 'original'
      ? base
      : settings.naming === 'datetime'
        ? meta.dateTimeOriginal
          ? meta.dateTimeOriginal.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15)
          : base
        : String(index + 1).padStart(4, '0')
  return `${stem}.${extOf(settings.format)}`
}

async function handleExport(req: Extract<WorkerRequest, { kind: 'export' }>): Promise<void> {
  const { id, file, meta, template, settings } = req
  const bitmap = await decode(file)
  const canvas = await renderPhoto({
    photo: bitmap,
    meta,
    template,
    logoBook: logos,
    fonts,
    options: { maxLongEdge: settings.longEdge, watermark: true }
  })
  bitmap.close()

  let blob = await canvasToBlob(canvas, settings.format, settings.quality)
  let filename = outputName(file, meta, settings, req.index)

  if (settings.keepExif) {
    try {
      const sourceBuf = await file.arrayBuffer()
      const withExif = await copyExif(
        sourceBuf,
        req.sourceType as ImageType,
        await blob.arrayBuffer(),
        settings.format
      )
      blob = new Blob([withExif], { type: blob.type })
    } catch {
      // EXIF 写入失败不阻断导出：降级为无 EXIF 文件
    }
  }

  post({ id, ok: true, kind: 'export', blob, filename })
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  void (async () => {
    try {
      switch (req.kind) {
        case 'thumbnail':
          await handleThumbnail(req.id, req.file, req.longEdge)
          break
        case 'preview':
          await handlePreview(req.id, req.file, req.meta, req.template, req.maxLongEdge)
          break
        case 'export':
          await handleExport(req)
          break
      }
    } catch (err) {
      post({
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  })()
})
