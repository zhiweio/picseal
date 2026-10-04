import { afterEach, describe, expect, it, vi } from 'vitest'

describe('mediaUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('未设置 NEXT_PUBLIC_MEDIA_BASE 时原样返回（本地兜底，行为与现状一致）', async () => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE', '')
    const { mediaUrl } = await import('./media-url')
    expect(mediaUrl('/samples/sony-ilce-7m3-02.jpg')).toBe('/samples/sony-ilce-7m3-02.jpg')
    expect(mediaUrl('/audio/bgm.mp3')).toBe('/audio/bgm.mp3')
  })

  it('设置后把根相对路径改写为 CDN 绝对 URL，容忍尾斜杠', async () => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE', 'https://media.zhiweio.me/')
    const { mediaUrl } = await import('./media-url')
    expect(mediaUrl('/samples/a.jpg')).toBe('https://media.zhiweio.me/samples/a.jpg')
    expect(mediaUrl('/fonts/wm/mi-sans-400.woff2')).toBe(
      'https://media.zhiweio.me/fonts/wm/mi-sans-400.woff2'
    )
  })

  it('绝对 URL、blob: 与非根相对路径透传不改写', async () => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE', 'https://media.zhiweio.me')
    const { mediaUrl } = await import('./media-url')
    expect(mediaUrl('https://example.com/x.jpg')).toBe('https://example.com/x.jpg')
    expect(mediaUrl('blob:http://localhost/uuid')).toBe('blob:http://localhost/uuid')
    expect(mediaUrl('samples/a.jpg')).toBe('samples/a.jpg')
  })

  it('_next 构建产物不改写（由 Next 自身分发）', async () => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE', 'https://media.zhiweio.me')
    const { mediaUrl } = await import('./media-url')
    expect(mediaUrl('/_next/static/chunks/app.js')).toBe('/_next/static/chunks/app.js')
  })
})
