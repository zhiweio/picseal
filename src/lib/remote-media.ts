'use client'

/**
 * 网络素材导入 —— 校验先行、受控下载：
 * ① 仅接受 https:// 直链（http 明文会被混合内容策略拦截，也与「本地处理」隐私立场冲突）
 * ② 响应头先校验（可达性 / 类型 / 大小），全部通过才开始读正文；正文流式读取另有大小熔断
 *    —— 任何一步失败都不产生可用产物，调用方绝不会把半成品写进 IndexedDB
 * 错误码 → 用户文案的映射在 RemoteMediaDialog（i18n），本模块只抛 RemoteMediaError。
 */

export type RemoteMediaKind = 'audio' | 'video'

export type RemoteMediaErrorCode =
  | 'invalid-url'
  | 'unreachable'
  | 'timeout'
  | 'not-found'
  | 'server-error'
  | 'bad-type'
  | 'too-large'

export class RemoteMediaError extends Error {
  constructor(
    readonly code: RemoteMediaErrorCode,
    readonly status?: number
  ) {
    super(
      status !== undefined && code === 'server-error'
        ? `remote media: ${code} (HTTP ${status})`
        : `remote media: ${code}`
    )
    this.name = 'RemoteMediaError'
  }
}

/** 大小上限：配乐 30 MB、开场视频 256 MB（文案见 messages.*.mediaUrl.limit*） */
export const REMOTE_MEDIA_LIMIT_BYTES: Record<RemoteMediaKind, number> = {
  audio: 30 * 1024 * 1024,
  video: 256 * 1024 * 1024
}

/** 响应头等待上限：连不上就尽快报错，不等整段下载 */
const HEADER_TIMEOUT_MS = 15_000

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac'])
const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.mov'])

/** 取路径末段扩展名（小写、带点）；无扩展名或形似版本号片段时返回空串 */
function extOf(path: string): string {
  const file = path.split('/').pop() ?? ''
  const dot = file.lastIndexOf('.')
  if (dot <= 0) return ''
  const ext = file.slice(dot).toLowerCase()
  return /^\.[a-z0-9]{2,8}$/.test(ext) ? ext : ''
}

/**
 * 响应类型判定：标准 MIME 直接放行（容忍参数与大小写）；
 * 源站常见的 octet-stream / 缺失交给扩展名兜底。
 * 音频额外放行 video/mp4 —— 相当一部分 CDN 会把 m4a 标成 MP4 容器。
 */
export function judgeContentType(kind: RemoteMediaKind, contentType: string | null, path: string): boolean {
  const type = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (type.startsWith(kind === 'audio' ? 'audio/' : 'video/')) return true
  if (kind === 'audio' && type === 'application/ogg') return true
  if (kind === 'audio' && type === 'video/mp4') return AUDIO_EXTS.has(extOf(path))
  if (type === '' || type === 'application/octet-stream' || type === 'binary/octet-stream') {
    return (kind === 'audio' ? AUDIO_EXTS : VIDEO_EXTS).has(extOf(path))
  }
  return false
}

/** 仅接受 https:// 直链；拒绝 http / data: / javascript: 与带凭据（user:pass@）的 URL */
export function validateMediaUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new RemoteMediaError('invalid-url')
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new RemoteMediaError('invalid-url')
  }
  return url
}

/** HTTP 状态 → 错误码：410 与 404 同义；其余 4xx（403 防盗链、过期签名等）归入不可达 */
export function classifyStatus(status: number): RemoteMediaErrorCode {
  if (status === 404 || status === 410) return 'not-found'
  if (status >= 500) return 'server-error'
  return 'unreachable'
}

export interface FetchRemoteMediaOptions {
  /**
   * 调用方中止信号（如关闭弹窗）。外部中止以原始 AbortError 冒出，
   * 不翻译成 RemoteMediaError —— 由调用方按 aborted 静默处理。
   */
  signal?: AbortSignal
}

/**
 * fetch / 流读取失败的归一：
 * 超时与大小熔断已是 RemoteMediaError 原样冒出；外部中止（关闭弹窗等）以原始
 * AbortError 冒出（调用方按 aborted 静默）；其余（DNS 失败 / CORS 拦截 / 断流）归入不可达。
 */
function isExternalAbort(controller: AbortController): boolean {
  return controller.signal.aborted && !(controller.signal.reason instanceof RemoteMediaError)
}

/** 校验并下载网络素材：返回的 Blob 已过全部检查，可直接落盘 IndexedDB */
export async function fetchRemoteMedia(
  rawUrl: string,
  kind: RemoteMediaKind,
  options?: FetchRemoteMediaOptions
): Promise<Blob> {
  const url = validateMediaUrl(rawUrl)
  const limit = REMOTE_MEDIA_LIMIT_BYTES[kind]
  const external = options?.signal

  const controller = new AbortController()
  const onExternalAbort = () => controller.abort(external?.reason)
  external?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    if (external?.aborted) throw external.reason ?? new DOMException('Aborted', 'AbortError')

    let res: Response
    const headerTimer = setTimeout(
      () => controller.abort(new RemoteMediaError('timeout')),
      HEADER_TIMEOUT_MS
    )
    try {
      res = await fetch(url, { signal: controller.signal })
    } catch (e) {
      // 响应头超时以 RemoteMediaError('timeout') 作为 abort reason 原样冒出
      if (e instanceof RemoteMediaError) throw e
      if (isExternalAbort(controller)) throw controller.signal.reason
      throw new RemoteMediaError('unreachable') // DNS 失败 / CORS 拦截 / 连接重置
    } finally {
      clearTimeout(headerTimer)
    }

    if (!res.ok) throw new RemoteMediaError(classifyStatus(res.status), res.status)
    if (!judgeContentType(kind, res.headers.get('content-type'), url.pathname)) {
      throw new RemoteMediaError('bad-type')
    }
    const declared = Number(res.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > limit) throw new RemoteMediaError('too-large')

    try {
      return await readBody(res, kind, limit, controller)
    } catch (e) {
      if (e instanceof RemoteMediaError) throw e
      if (isExternalAbort(controller)) throw controller.signal.reason
      throw new RemoteMediaError('unreachable') // 正文传输中途断开
    }
  } finally {
    external?.removeEventListener('abort', onExternalAbort)
  }
}

async function readBody(
  res: Response,
  kind: RemoteMediaKind,
  limit: number,
  controller: AbortController
): Promise<Blob> {
  const type = res.headers.get('content-type') ?? ''
  if (!res.body) {
    // 无流的极端环境退化为整读，超限靠字节数兜底
    const buf = await res.arrayBuffer()
    if (buf.byteLength > limit) throw new RemoteMediaError('too-large')
    return new Blob([buf], { type })
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      controller.abort(new RemoteMediaError('too-large'))
      throw new RemoteMediaError('too-large')
    }
    chunks.push(value)
  }
  // 网络分块必然是普通 ArrayBuffer 背书的 Uint8Array，收窄以满足 BlobPart 的严格类型
  return new Blob(chunks as BlobPart[], { type })
}
