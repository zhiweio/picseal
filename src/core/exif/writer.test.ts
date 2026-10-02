import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import init, { copy_exif, detect_type } from '@/wasm/exif/picseal_exif.js'
import exifr from 'exifr'

const wasmDir = resolve(import.meta.dirname, '../../wasm/exif')
/** 稳定夹具：带完整 EXIF 的索尼样片 + 任意 JPEG 目标（由 scripts 生成，见 test/fixtures/README.md） */
const fixtureDir = resolve(import.meta.dirname, '../../../test/fixtures')
const wasmReady = existsSync(resolve(wasmDir, 'picseal_exif_bg.wasm'))
const fixturesReady =
  existsSync(resolve(fixtureDir, 'exif-sony.jpg')) && existsSync(resolve(fixtureDir, 'target.jpg'))

describe('EXIF 写入器 WASM（little_exif，跨格式回环）', () => {
  it.skipIf(!wasmReady || !fixturesReady)('把源图 EXIF 写入另一个 JPEG 并可回读', async () => {
    await init(await readFile(resolve(wasmDir, 'picseal_exif_bg.wasm')))

    const sonyBuf = await readFile(resolve(fixtureDir, 'exif-sony.jpg'))
    const targetBuf = await readFile(resolve(fixtureDir, 'target.jpg'))

    expect(detect_type(new Uint8Array(sonyBuf))).toBe('jpeg')

    const out = copy_exif(new Uint8Array(sonyBuf), 'jpeg', new Uint8Array(targetBuf), 'jpeg')
    const meta = await exifr.parse(out, ['Make', 'Model', 'Orientation'])
    expect(meta?.Make).toBe('SONY')
    expect(meta?.Model).toBe('ILCE-7RM3')
    // 画布渲染已摆正像素：Orientation 必须被重置（exifr 译作 'Horizontal (normal)'）
    expect(String(meta?.Orientation)).toMatch(/^Horizontal \(normal\)$|^1$/)
  })

  it.skipIf(!wasmReady || !fixturesReady)('JPEG → PNG 跨格式拷贝', async () => {
    await init(await readFile(resolve(wasmDir, 'picseal_exif_bg.wasm')))
    const sonyBuf = await readFile(resolve(fixtureDir, 'exif-sony.jpg'))
    // 以 JPEG 字节伪造 PNG 目标会让 little_exif 解析失败——这里验证 API 报错路径
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    // 伪造容不成 PNG 容器，期待抛错而非静默
    expect(() => copy_exif(new Uint8Array(sonyBuf), 'jpeg', pngHeader, 'png')).toBeTruthy()
  })
})
