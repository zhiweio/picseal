'use client'

import { Zip, ZipDeflate } from 'fflate'

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export interface ZipEntry {
  name: string
  blob: Blob
}

/** fflate 流式封装：压缩块回调式输出，内存峰值 ≈ 单文件 */
export function createZipStream(onChunk: (chunk: Uint8Array) => void) {
  const zip = new Zip((err, chunk, final) => {
    if (err) throw err
    if (chunk) onChunk(chunk)
    if (final) ended = true
  })
  let ended = false
  return {
    async add(name: string, blob: Blob): Promise<void> {
      const file = new ZipDeflate(name, { level: 3 })
      zip.add(file)
      file.push(new Uint8Array(await blob.arrayBuffer()), true)
    },
    end(): void {
      zip.end()
    },
    get ended(): boolean {
      return ended
    }
  }
}

async function buildZip(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>,
  onChunk: (chunk: Uint8Array) => void,
  onProgress?: (done: number) => void
): Promise<void> {
  const stream = createZipStream(onChunk)
  let done = 0
  for await (const entry of entries) {
    await stream.add(entry.name, entry.blob)
    done += 1
    onProgress?.(done)
  }
  stream.end()
}

/**
 * 打包下载 ZIP。支持 File System Access 的浏览器直写磁盘（无内存峰值），
 * 其余回退为内存组装 + Blob 下载。用户取消保存框时静默返回。
 */
export async function downloadZip(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>,
  filename: string,
  onProgress?: (done: number) => void
): Promise<'fs-access' | 'download' | 'cancelled'> {
  const picker = (
    window as {
      showSaveFilePicker?: (opts?: {
        suggestedName?: string
        types?: Array<{ description: string; accept: Record<string, string[]> }>
      }) => Promise<{
        createWritable: () => Promise<{
          getWriter: () => WritableStreamDefaultWriter<Uint8Array>
          close: () => Promise<void>
        }>
      }>
    }
  ).showSaveFilePicker

  if (picker) {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }]
      })
      const writable = await handle.createWritable()
      const writer = writable.getWriter()
      await buildZip(entries, (chunk) => void writer.write(chunk), onProgress)
      await writer.close()
      return 'fs-access'
    } catch (err) {
      // AbortError = 用户取消
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      // 其他错误走下载回退
    }
  }

  const chunks: Uint8Array[] = []
  await buildZip(entries, (chunk) => chunks.push(chunk), onProgress)
  saveBlob(new Blob(chunks as BlobPart[], { type: 'application/zip' }), filename)
  return 'download'
}
