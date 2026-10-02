import { describe, expect, it } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { createZipStream } from './delivery'

describe('流式 ZIP（fflate 封装）', () => {
  it('多文件打包可解压回环', async () => {
    const chunks: Uint8Array[] = []
    const stream = createZipStream((chunk) => chunks.push(chunk))

    const files: Array<{ name: string; content: string }> = [
      { name: 'a.jpg', content: 'hello-a' },
      { name: 'b/b.jpg', content: 'hello-b-longer-content' },
      { name: '中文/图片.jpg', content: 'cjk-filename-content' }
    ]
    for (const f of files) {
      await stream.add(f.name, new Blob([f.content]))
    }
    stream.end()
    expect(stream.ended).toBe(true)

    const zipBytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
    let offset = 0
    for (const c of chunks) {
      zipBytes.set(c, offset)
      offset += c.length
    }

    const unzipped = unzipSync(zipBytes)
    expect(Object.keys(unzipped).sort()).toEqual(['a.jpg', 'b/b.jpg', '中文/图片.jpg'])
    expect(new TextDecoder().decode(unzipped['a.jpg']!)).toBe('hello-a')
    expect(new TextDecoder().decode(unzipped['中文/图片.jpg']!)).toBe('cjk-filename-content')
  })

  it('fflate 基线：zipSync 产物为 ZIP 魔数（sanity）', () => {
    const reference = zipSync({ 'x.txt': new Uint8Array([1, 2, 3]) })
    expect(reference[0]).toBe('P'.charCodeAt(0))
  })
})
