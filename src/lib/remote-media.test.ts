import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RemoteMediaError,
  REMOTE_MEDIA_LIMIT_BYTES,
  classifyStatus,
  fetchRemoteMedia,
  judgeContentType,
  validateMediaUrl,
  type RemoteMediaErrorCode
} from './remote-media'

/** 断言抛出指定 code 的 RemoteMediaError */
function expectCode(fn: () => unknown, code: RemoteMediaErrorCode): void {
  try {
    fn()
    expect.fail(`expected RemoteMediaError(${code})`)
  } catch (e) {
    expect(e).toBeInstanceOf(RemoteMediaError)
    expect((e as RemoteMediaError).code).toBe(code)
  }
}

async function expectCodeAsync(fn: () => Promise<unknown>, code: RemoteMediaErrorCode): Promise<void> {
  await expect(fn()).rejects.toMatchObject({ code })
}

describe('validateMediaUrl', () => {
  it('接受合法 https 直链', () => {
    expect(validateMediaUrl('https://example.com/music.mp3').hostname).toBe('example.com')
    expect(validateMediaUrl('  https://example.com/a.mp3?x=1 ').protocol).toBe('https:')
  })

  it.each([
    '',
    'music.mp3',
    'http://example.com/a.mp3',
    'ftp://example.com/a.mp3',
    'javascript:alert(1)',
    'data:audio/mpeg;base64,AAAA',
    'https://'
  ])('拒绝非法链接 %s', (raw) => {
    expectCode(() => validateMediaUrl(raw), 'invalid-url')
  })

  it('拒绝带凭据的 URL', () => {
    expectCode(() => validateMediaUrl('https://user:pass@example.com/a.mp3'), 'invalid-url')
  })
})

describe('judgeContentType', () => {
  it('标准 MIME 直接放行（容忍参数与大小写）', () => {
    expect(judgeContentType('audio', 'audio/mpeg', '/a.mp3')).toBe(true)
    expect(judgeContentType('audio', 'Audio/MPEG; charset=binary', '/a.mp3')).toBe(true)
    expect(judgeContentType('video', 'video/quicktime', '/i.mov')).toBe(true)
    expect(judgeContentType('video', 'video/x-m4v', '/i.m4v')).toBe(true)
    expect(judgeContentType('audio', 'application/ogg', '/song')).toBe(true)
  })

  it('交叉类型不误放', () => {
    expect(judgeContentType('video', 'audio/mpeg', '/i.mp4')).toBe(false)
    expect(judgeContentType('audio', 'text/html', '/a.mp3')).toBe(false)
  })

  it('octet-stream / 缺失 → 扩展名兜底', () => {
    expect(judgeContentType('audio', 'application/octet-stream', '/t/trk.m4a')).toBe(true)
    expect(judgeContentType('audio', null, '/t/trk.OPUS')).toBe(true)
    expect(judgeContentType('audio', 'application/octet-stream', '/t/trk.txt')).toBe(false)
    expect(judgeContentType('video', null, '/t/intro.mp4')).toBe(true)
    expect(judgeContentType('video', 'application/octet-stream', '/t/page.htm')).toBe(false)
  })

  it('m4a 常被 CDN 标成 video/mp4 —— 音频侧带音频扩展名时放行', () => {
    expect(judgeContentType('audio', 'video/mp4', '/t/w.m4a')).toBe(true)
    expect(judgeContentType('video', 'video/mp4', '/t/w.m4a')).toBe(true)
  })
})

describe('classifyStatus', () => {
  it('404/410 → not-found，5xx → server-error，其余 → unreachable', () => {
    expect(classifyStatus(404)).toBe('not-found')
    expect(classifyStatus(410)).toBe('not-found')
    expect(classifyStatus(500)).toBe('server-error')
    expect(classifyStatus(503)).toBe('server-error')
    expect(classifyStatus(403)).toBe('unreachable')
    expect(classifyStatus(418)).toBe('unreachable')
  })
})

describe('fetchRemoteMedia', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const neverAbortedFetch = (): ReturnType<typeof vi.fn> =>
    vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })
    )

  it('校验通过并返回 Blob', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('audiodata', { status: 200, headers: { 'content-type': 'audio/mpeg' } }))
    )
    const blob = await fetchRemoteMedia('https://example.com/a.mp3', 'audio')
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBe(9)
  })

  it('404 → not-found；500 → server-error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await expectCodeAsync(() => fetchRemoteMedia('https://example.com/a.mp3', 'audio'), 'not-found')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })))
    await expectCodeAsync(() => fetchRemoteMedia('https://example.com/a.mp3', 'audio'), 'server-error')
  })

  it('类型不符 → bad-type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    )
    await expectCodeAsync(() => fetchRemoteMedia('https://example.com/a.mp3', 'audio'), 'bad-type')
  })

  it('URL 非法直接抛 invalid-url，不发起请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expectCodeAsync(() => fetchRemoteMedia('http://example.com/a.mp3', 'audio'), 'invalid-url')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Content-Length 超限 → too-large（读正文前拦截）', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('', {
          status: 200,
          headers: {
            'content-type': 'video/mp4',
            'content-length': String(REMOTE_MEDIA_LIMIT_BYTES.video + 1)
          }
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    await expectCodeAsync(() => fetchRemoteMedia('https://example.com/i.mp4', 'video'), 'too-large')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('流式读取超限 → too-large（大小熔断）', async () => {
    const big = new Uint8Array(REMOTE_MEDIA_LIMIT_BYTES.audio + 1)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(big, { status: 200, headers: { 'content-type': 'application/octet-stream' } })
      )
    )
    await expectCodeAsync(() => fetchRemoteMedia('https://example.com/a.flac', 'audio'), 'too-large')
  })

  it('网络异常 → unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )
    await expectCodeAsync(() => fetchRemoteMedia('https://example.com/a.mp3', 'audio'), 'unreachable')
  })

  it('响应头超时 → timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', neverAbortedFetch())
    const pending = expect(fetchRemoteMedia('https://example.com/a.mp3', 'audio')).rejects.toMatchObject({
      code: 'timeout'
    })
    await vi.advanceTimersByTimeAsync(15_000)
    await pending
  })

  it('外部中止：以原始 AbortError 冒出，不误报 unreachable', async () => {
    vi.stubGlobal('fetch', neverAbortedFetch())
    const controller = new AbortController()
    const pending = expect(
      fetchRemoteMedia('https://example.com/a.mp3', 'audio', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await pending
  })
})
