import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyCaps,
  drawInkText,
  ensureContrastColor,
  markSegments,
  measureInk,
  type Ctx2D
} from './canvas-utils'

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

  it('fontPx 由行盒高线性反推（M2：INK_FILTER 1.45 → 1.38 减重）', () => {
    const m = measureInk(ctx, 'AB', 'roboto', 700, 120)
    // PROBE_PX=200 时行盒 240 → fontPx = 120 × 1.38 × 200/240
    expect(m.fontPx).toBeCloseTo((120 * 1.38 * 200) / 240)
  })

  it('fontPxOverride 显式字号：跳过行盒推导（横幅统一主/副行尺寸）', () => {
    const m = measureInk(ctx, 'AB', 'roboto', 400, 120, 123)
    expect(m.fontPx).toBe(123)
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

  it('anchor=baseline：显式基线直绘（横幅跨栏对齐）', async () => {
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
        actualBoundingBoxAscent: 145,
        actualBoundingBoxDescent: 5
      }),
      fillText: (text: string, _x: number, y: number) => {
        fills.push({ text, y })
      }
    } as unknown as Ctx2D

    drawInkText(ctx, 'SONY', 0, 777, 72, { family: 'roboto', weight: 700, color: '#000' }, 'left', 'baseline')
    drawInkText(ctx, '-', 0, 777, 72, { family: 'roboto', weight: 400, color: '#000' }, 'left', 'baseline')
    expect(fills[0]!.y).toBe(777)
    expect(fills[1]!.y).toBe(777)
  })
})

describe('applyCaps（capsOnly 单位保护，BAN-011）', () => {
  it('计量单位保持小写书写规范', () => {
    expect(applyCaps('300mm f/6.3 1/1250s ISO500')).toBe('300mm F/6.3 1/1250s ISO500')
    expect(applyCaps('24cm')).toBe('24cm')
  })
  it('非单位场景全大写', () => {
    expect(applyCaps('nikon z 8')).toBe('NIKON Z 8')
  })
})

describe('markSegments（尼康品牌字形：Z 符号 + NIKON 字标）', () => {
  it('符号字符段携带符号字体 family 与专用色', () => {
    const segs = markSegments('NIKON Z 8', '#ffffff', {
      symbol: { char: 'Z', family: 'nikon-z-symbol', color: '#ff0000' }
    })
    expect(segs).toHaveLength(3)
    expect(segs[0]).toEqual({ text: 'NIKON ', color: '#ffffff' })
    expect(segs[1]).toEqual({ text: 'Z', color: '#ff0000', family: 'nikon-z-symbol' })
    expect(segs[2]).toEqual({ text: ' 8', color: '#ffffff' })
  })
  it('无 symbol（非 Z 系门控）时 Z 保持正文呈现', () => {
    const segs = markSegments('Z8', '#fff', {})
    expect(segs).toEqual([{ text: 'Z8', color: '#fff' }])
  })
  it('符号字符数据驱动：任意 char 皆可（为其他品牌预留）', () => {
    const segs = markSegments('α7R V', '#fff', { symbol: { char: 'α', family: 'archivo' } })
    expect(segs[0]).toEqual({ text: 'α', color: '#fff', family: 'archivo' })
    expect(segs[1]).toEqual({ text: '7R V', color: '#fff' })
  })
  it('NIKON 字标段：锁定 family/weight/italic，颜色跟随行色', () => {
    const segs = markSegments('NIKON Z 8', '#111111', {
      symbol: { char: 'Z', family: 'nikon-z-symbol', color: '#ff0000' },
      wordmark: { match: 'NIKON', family: 'archivo', weight: 800, italic: true }
    })
    expect(segs).toHaveLength(4)
    expect(segs[0]).toEqual({ text: 'NIKON', color: '#111111', family: 'archivo', weight: 800, italic: true })
    expect(segs[1]).toEqual({ text: ' ', color: '#111111' })
    expect(segs[2]).toEqual({ text: 'Z', color: '#ff0000', family: 'nikon-z-symbol' })
    expect(segs[3]).toEqual({ text: ' 8', color: '#111111' })
  })
  it('字标匹配大小写不敏感且保留原文', () => {
    const segs = markSegments('Nikon D850', '#000', {
      wordmark: { match: 'NIKON', family: 'archivo', weight: 800, italic: true }
    })
    expect(segs[0]).toMatchObject({ text: 'Nikon', weight: 800, italic: true })
    expect(segs[1]).toEqual({ text: ' D850', color: '#000' })
  })
  it('无字标无符号时退化为单段正文', () => {
    expect(markSegments('NIKON D850', '#000', {})).toEqual([{ text: 'NIKON D850', color: '#000' }])
  })
  it('NIKKOR 不含 NIKON 字标，不误匹配', () => {
    const segs = markSegments('NIKKOR Z 50mm', '#000', {
      symbol: { char: 'Z', family: 'nikon-z-symbol' },
      wordmark: { match: 'NIKON', family: 'archivo', weight: 800, italic: true }
    })
    // 'NIKKOR' 前缀 NIK 不满足 NIKON；Z 切换符号字体
    expect(segs[0]).toEqual({ text: 'NIKKOR ', color: '#000' })
    expect(segs[1]).toEqual({ text: 'Z', color: '#000', family: 'nikon-z-symbol' })
  })
  it('代际数字段：三类锁定段共存（字标 + 符号 + 数字含 gapBefore）', () => {
    const segs = markSegments('NIKON Z 6III', '#111', {
      symbol: { char: 'Z', family: 'nikon-z-symbol', color: '#ff0000' },
      wordmark: { match: 'NIKON', family: 'brand-nikon', weight: 400, italic: true },
      numerals: { pattern: /((?:X{0,2})(?:IX|IV|V?I{0,3}))$/, family: 'archivo', weight: 700, spacing: 0.08 }
    })
    expect(segs).toHaveLength(5)
    expect(segs[0]).toEqual({ text: 'NIKON', color: '#111', family: 'brand-nikon', weight: 400, italic: true })
    expect(segs[1]).toEqual({ text: ' ', color: '#111' })
    expect(segs[2]).toEqual({ text: 'Z', color: '#ff0000', family: 'nikon-z-symbol' })
    expect(segs[3]).toEqual({ text: ' 6', color: '#111' })
    expect(segs[4]).toEqual({
      text: 'III',
      color: '#111',
      family: 'archivo',
      weight: 700,
      italic: false,
      gapBefore: 0.08
    })
  })
  it('代际数字：无后缀机型不产生数字段', () => {
    const segs = markSegments('NIKON D850', '#000', {
      numerals: { pattern: /((?:X{0,2})(?:IX|IV|V?I{0,3}))$/, family: 'archivo', weight: 700 }
    })
    expect(segs).toEqual([{ text: 'NIKON D850', color: '#000' }])
  })
  it('代际数字：非法罗马写法（IIL）不匹配', () => {
    const segs = markSegments('CAM BODY IIL', '#000', {
      numerals: { pattern: /((?:X{0,2})(?:IX|IV|V?I{0,3}))$/, family: 'archivo', weight: 700 }
    })
    expect(segs).toEqual([{ text: 'CAM BODY IIL', color: '#000' }])
  })
})

describe('尼康 Z 符号字形锁定（字号/颜色可变；字体/字重/斜体任何情况下不可变）', () => {
  it('drawInkSegments：行级字重/斜体覆写不得污染异字体段，Z 恒为符号字体自身主字重非斜体', async () => {
    const { drawInkSegments } = await import('./canvas-utils')
    const fills: Array<{ text: string; font: string }> = []
    const ctx = {
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      measureText: (text: string) => ({
        width: text.length * 100,
        fontBoundingBoxAscent: 190,
        fontBoundingBoxDescent: 50,
        actualBoundingBoxAscent: 145,
        actualBoundingBoxDescent: 5
      }),
      fillText: function (this: { font: string }, text: string) {
        fills.push({ text, font: this.font })
      }
    } as unknown as Ctx2D & { fillText: (t: string) => void }

    // 行级覆写：Light(300) + 斜体 —— 正文段应遵循，Z 段不得
    drawInkSegments(
      ctx,
      [
        { text: 'NIKON ', color: '#ffffff' },
        { text: 'Z', color: '#ff0000', family: 'nikon-z-symbol' },
        { text: ' 8', color: '#ffffff' }
      ],
      0,
      100,
      72,
      { family: 'roboto', weight: 300, color: '#ffffff', italic: true },
      'left'
    )
    expect(fills).toHaveLength(3)
    // 正文段：行的字重/斜体生效
    expect(fills[0]!.font).toMatch(/^italic 300 \d+(\.\d+)?px "Picseal Roboto", sans-serif$/)
    expect(fills[2]!.font).toMatch(/^italic 300 \d+(\.\d+)?px "Picseal Roboto", sans-serif$/)
    // Z 段：恒为符号字体自身 mainWeight(400)、非斜体——任何行级覆写都不生效
    expect(fills[1]!.font).toMatch(/^400 \d+(\.\d+)?px "Picseal NikonZSymbol", sans-serif$/)
  })

  it('drawInkSegments：品牌字标段以显式锁定样式渲染，行级覆写不影响', async () => {
    const { drawInkSegments } = await import('./canvas-utils')
    const fills: Array<{ text: string; font: string }> = []
    const ctx = {
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      measureText: (text: string) => ({
        width: text.length * 100,
        fontBoundingBoxAscent: 190,
        fontBoundingBoxDescent: 50,
        actualBoundingBoxAscent: 145,
        actualBoundingBoxDescent: 5
      }),
      fillText: function (this: { font: string }, text: string) {
        fills.push({ text, font: this.font })
      }
    } as unknown as Ctx2D

    // 行样式：普惠体 300 非斜体；NIKON 字标段锁定 Archivo 800 斜体
    drawInkSegments(
      ctx,
      [
        { text: 'NIKON', color: '#000000', family: 'archivo', weight: 800, italic: true },
        { text: ' D850', color: '#000000' }
      ],
      0,
      100,
      72,
      { family: 'puhuiti', weight: 300, color: '#000000' },
      'left'
    )
    expect(fills).toHaveLength(2)
    // 字标段：显式锁定的家族/字重/斜体
    expect(fills[0]!.font).toMatch(/^italic 800 \d+(\.\d+)?px "Picseal Archivo", sans-serif$/)
    // 正文段：行样式
    expect(fills[1]!.font).toMatch(/^300 \d+(\.\d+)?px "Picseal PuHuiTi", sans-serif$/)
  })

  it('drawInkSegments：数字段前置字距（gap）推进后续落笔位置', async () => {
    const { drawInkSegments } = await import('./canvas-utils')
    const draws: Array<{ text: string; x: number; font: string }> = []
    const ctx = {
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      measureText: (text: string) => ({
        width: text.length * 100,
        fontBoundingBoxAscent: 190,
        fontBoundingBoxDescent: 50,
        actualBoundingBoxAscent: 145,
        actualBoundingBoxDescent: 5
      }),
      fillText: function (this: { font: string }, text: string, x: number) {
        draws.push({ text, x, font: this.font })
      }
    } as unknown as Ctx2D

    drawInkSegments(
      ctx,
      [
        { text: 'Z 6', color: '#000' },
        { text: 'III', color: '#000', family: 'archivo', weight: 700, italic: false, gapBefore: 0.1 }
      ],
      0,
      100,
      100,
      { family: 'roboto', weight: 400, color: '#000' },
      'left'
    )
    expect(draws).toHaveLength(2)
    // 段 0：正文，x = 0
    expect(draws[0]!.text).toBe('Z 6')
    expect(draws[0]!.x).toBe(0)
    // 段 1：数字段，落笔 x = 前段宽(300) + gap(0.1 × 100) = 310，锁定 Archivo 700
    expect(draws[1]!.text).toBe('III')
    expect(draws[1]!.x).toBe(310)
    expect(draws[1]!.font).toMatch(/^700 \d+(\.\d+)?px "Picseal Archivo", sans-serif$/)
  })

  it('drawInkText 整行直绘时斜体随 style（非混排路径不受锁定影响）', async () => {
    const { drawInkText } = await import('./canvas-utils')
    const fonts: string[] = []
    const ctx = {
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      measureText: (text: string) => ({
        width: text.length * 100,
        fontBoundingBoxAscent: 190,
        fontBoundingBoxDescent: 50,
        actualBoundingBoxAscent: 145,
        actualBoundingBoxDescent: 5
      }),
      fillText: function (this: { font: string }, text: string) {
        fonts.push(this.font)
      }
    } as unknown as Ctx2D
    drawInkText(ctx, 'NIKON Z 8', 0, 100, 72, { family: 'roboto', weight: 300, color: '#fff', italic: true }, 'left')
    expect(fonts[0]).toMatch(/^italic 300 \d+(\.\d+)?px "Picseal Roboto", sans-serif$/)
  })
})

describe('ensureContrastColor（叠印可读性，R-05）', () => {
  it('亮背景 + 白字 → 切换深色', () => {
    expect(ensureContrastColor('#ffffff', 0.92)).toBe('#1a1a1a')
  })
  it('暗背景 + 白字 → 保持', () => {
    expect(ensureContrastColor('#ffffff', 0.1)).toBe('#ffffff')
  })
  it('采样不可用（null）→ 原样返回', () => {
    expect(ensureContrastColor('#e88d34', null)).toBe('#e88d34')
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
