import { beforeEach, describe, expect, it, vi } from 'vitest'
import { measureInk, type Ctx2D } from './canvas-utils'

/**
 * 模拟 Canvas 度量：字体行盒固定（fontBoundingBox 与字符串无关），
 * 墨迹盒随字符串变化 —— 复现 '-' 等低矮字符的历史爆字号场景。
 */
function makeCtx() {
  const metricsFor = (text: string) => ({
    width: text.length * 100,
    // 字体行盒：固定 240/200 @ PROBE_PX=200（Roboto 类字体典型值）
    fontBoundingBoxAscent: 190,
    fontBoundingBoxDescent: 50,
    // 墨迹盒：随字符串剧烈变化
    actualBoundingBoxAscent: text === '-' ? 18 : 145,
    actualBoundingBoxDescent: text === '-' ? 0 : 5,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: text.length * 100
  })
  const ctx = {
    font: '',
    measureText: (text: string) => metricsFor(text)
  }
  return ctx as unknown as Ctx2D & { font: string }
}

describe('measureInk（字体行盒定字号）', () => {
  let ctx: ReturnType<typeof makeCtx>
  beforeEach(() => {
    ctx = makeCtx()
  })

  it('同一 banner 内所有行共享同一 fontPx —— 与字符串无关', () => {
    const a = measureInk(ctx, 'SONY ILCE-7M4', 'roboto', 700, 72)
    const b = measureInk(ctx, 'f/2.8 1/250s ISO100', 'roboto', 400, 72)
    expect(a.fontPx).toBe(b.fontPx)
  })

  it("'-' 占位符不会把字号撑爆（历史 bug：低矮墨迹 → fontPx 膨胀数倍）", () => {
    const dash = measureInk(ctx, '-', 'roboto', 400, 72)
    const model = measureInk(ctx, 'ILCE-7M4', 'roboto', 400, 72)
    expect(dash.fontPx).toBe(model.fontPx)
    expect(dash.fontPx).toBeLessThan(200)
  })

  it('fontPx 由行盒高线性反推', () => {
    const m = measureInk(ctx, 'AB', 'roboto', 700, 120)
    // PROBE_PX=200 时行盒 240 → fontPx = 120 × 1.45 × 200/240
    expect(m.fontPx).toBeCloseTo((120 * 1.45 * 200) / 240)
  })
})

describe('drawInkText 行盒语义', () => {
  it('同行跨栏基线一致：不同墨迹的行共享同一基线偏移', async () => {
    const { drawInkText } = await import('./canvas-utils')
    const fills: Array<{ text: string; y: number }> = []
    const ctx = {
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      measureText: (text: string) => ({
        width: text.length * 100,
        fontBoundingBoxAscent: 190,
        fontBoundingBoxDescent: 50,
        actualBoundingBoxAscent: text === '-' ? 18 : 145,
        actualBoundingBoxDescent: text === '-' ? 0 : 5
      }),
      fillText: (text: string, _x: number, y: number) => {
        fills.push({ text, y })
      }
    } as unknown as Ctx2D

    drawInkText(ctx, 'SONY ILCE-7M4', 0, 1000, 72, { family: 'roboto', weight: 700, color: '#000' }, 'left')
    drawInkText(ctx, '-', 0, 1000, 72, { family: 'roboto', weight: 700, color: '#000' }, 'left')
    expect(fills).toHaveLength(2)
    // 行盒语义：基线 = yTop + (targetH - boxH)/2 + fontAscent，与字符串墨迹无关
    expect(fills[0]!.y).toBe(fills[1]!.y)
    expect(fills[0]!.y).toBe(1000 + (72 - 240) / 2 + 190)
  })
})

describe('BlobUrlCache（URL 生命周期）', () => {
  const urls = new Map<string, string>()
  const revoked: string[] = []
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((_blob: Blob) => {
        const u = `blob:mock-${urls.size}`
        urls.set(u, u)
        return u
      }),
      revokeObjectURL: vi.fn((u: string) => {
        revoked.push(u)
        urls.delete(u)
      })
    })
    urls.clear()
    revoked.length = 0
  })

  it('命中缓存不吊销 URL，淘汰才吊销', async () => {
    const { BlobUrlCache } = await import('@/lib/preview-cache')
    const cache = new BlobUrlCache<{ url: string }>({ max: 2, getUrl: (v) => v.url })
    cache.set('a', { url: 'blob:a' })
    cache.set('b', { url: 'blob:b' })
    cache.get('a') // 触碰 a，b 成为最旧
    cache.set('c', { url: 'blob:c' }) // 淘汰 b
    expect(revoked).toEqual(['blob:b'])
    expect(cache.get('a')?.url).toBe('blob:a')
    expect(revoked).toEqual(['blob:b']) // 命中不吊销
  })

  it('delete 与 clear 释放对应 URL', async () => {
    const { BlobUrlCache } = await import('@/lib/preview-cache')
    const cache = new BlobUrlCache<{ url: string }>({ max: 4, getUrl: (v) => v.url })
    cache.set('a', { url: 'blob:a' })
    cache.set('b', { url: 'blob:b' })
    cache.delete('a')
    expect(revoked).toEqual(['blob:a'])
    cache.clear()
    expect(revoked).toEqual(['blob:a', 'blob:b'])
    expect(cache.size).toBe(0)
  })

  it('revokeOnEvict=false 时淘汰不吊销（被外部长期引用的轻缓存）', async () => {
    const { BlobUrlCache } = await import('@/lib/preview-cache')
    const cache = new BlobUrlCache<string>({ max: 1, getUrl: (v) => v, revokeOnEvict: false })
    cache.set('a', 'blob:a')
    cache.set('b', 'blob:b') // a 被淘汰但不吊销，仅从缓存移除
    expect(revoked).toEqual([])
    cache.clear() // 只清剩余的 b
    expect(revoked).toEqual(['blob:b'])
  })
})
