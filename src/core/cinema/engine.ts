'use client'

/**
 * 放映室放映/录制引擎（主线程 DOM —— 需 captureStream 与 three CanvasTexture 共享画布）。
 *
 * 时间轴数学在 ./timeline（纯函数，vitest 直测）；本文件只做"薄绘制"：
 * drawImage(video|bitmap) + fillText，外加 WebAudio 音频图（开场原声 + 配乐
 * 淡入淡出）与 MediaRecorder 封装。1920×1080 主画布同时是 3D 幕面纹理源 ——
 * 所见即所录。
 */
import type { WatermarkTemplate } from '../types'
import { formatDate, formatParams } from '../exif/reader'
import { MARK_SYMBOL_FONT } from '../fonts/registry'
import {
  drawInkSegments,
  drawInkText,
  ensureContrastColor,
  FontBook,
  sampleLuminance,
  type Ctx2D
} from '../render/canvas-utils'
import {
  buildTimeline,
  CINEMA_HEIGHT,
  CINEMA_MUSIC_FADE_IN,
  CINEMA_MUSIC_FADE_OUT,
  CINEMA_WIDTH,
  coverCropRect,
  frameAt,
  type CinemaTimeline,
  type TimelinePhoto
} from './timeline'
import { getRenderPool } from '../../workers/pool'

export { CINEMA_WIDTH, CINEMA_HEIGHT }

/** 与 timeline.CinemaPhoto 对齐的引擎输入（PhotoItem 天然满足） */
export interface EnginePhotoInput {
  id: string
  file: File
  meta?: { dateTimeOriginal?: Date; model?: string; make?: string; modelPretty?: string; focal35?: number; focalLength?: number; fNumber?: number; exposureTime?: number; iso?: number; width?: number; height?: number }
}

export interface CinemaTexts {
  /** 片头卡主标（如「作品集」） */
  titleMain: string
  /** 片头卡副标（hud 风，如 A PHOTO COLLECTION） */
  titleSub: string
  /** 片头卡角落信息（张数 / 日期跨度） */
  titleInfo: string
  /** 谢幕主字（FIN） */
  outroMain: string
  /** 谢幕统计行 */
  outroSub: string
  /** 谢幕部署名（PICSEAL PROJECTION ROOM） */
  outroCredit: string
}

export interface CinemaMedia {
  /** 开场视频 URL（缺省跳过开场段） */
  introUrl?: string
  /** 开场视频时长（秒，引擎会以 video.duration 实测校准） */
  introDuration?: number
  /** 配乐 URL（缺省静默放映；调用方已按版权策略与用户开关解析） */
  musicUrl?: string
}

/** 装片选项：传入工作台模板即以"水印幻灯片"放映（完整作品 letterbox 上幕） */
export interface EnginePrepareOptions {
  template?: WatermarkTemplate | null
}

/** 预渲染的水印合成图（渲染池 preview 产物：PNG blob + 画幅） */
interface WatermarkFrame {
  blob: Blob
  width: number
  height: number
}

export type EngineState = 'idle' | 'running' | 'done'

export interface PlaybackStatus {
  t: number
  duration: number
  segmentKind: CinemaTimeline['segments'][number]['kind']
  photoIndex: number
  recording: boolean
}

export interface PlaybackResult {
  blob?: Blob
  mime: string
  ext: 'mp4' | 'webm'
}

/** MediaRecorder 容器探测：优先 H.264 MP4，回退 VP9/Opus WebM */
export function pickRecordingMime(): { mime: string; ext: 'mp4' | 'webm' } {
  const candidates: Array<{ mime: string; ext: 'mp4' | 'webm' }> = [
    { mime: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' }
  ]
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime)) return c
  }
  return { mime: 'video/webm', ext: 'webm' }
}

const INK = '#f2efe8'
const MUTED = '#9caabd'
const NIKON_RED = '#e01f26'
const STAGE_BLACK = '#07090d'
/** Ken Burns 最大缩放下的源图长边预算（1920×1.16+ 余量） */
const DECODE_LONG_EDGE = 2300
const BITMAP_CACHE = 4

export class CinemaEngine {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private fonts = new FontBook()
  private timeline: CinemaTimeline | null = null
  private photos: EnginePhotoInput[] = []
  private texts: CinemaTexts | null = null
  private video: HTMLVideoElement | null = null
  private audio: AudioContext | null = null
  private musicBuffer: AudioBuffer | null = null
  private bus: GainNode | null = null
  private monitor: GainNode | null = null
  private recordDest: MediaStreamAudioDestinationNode | null = null
  private musicSource: AudioBufferSourceNode | null = null
  private videoSource: MediaElementAudioSourceNode | null = null
  private bitmaps = new Map<string, ImageBitmap>()
  private bitmapOrder: string[] = []
  /** 水印幻灯片模式：照片以完整作品 contain 内接上幕（无 Ken Burns/字幕/转场） */
  private watermarkMode = false
  private watermarks = new Map<string, WatermarkFrame>()
  private frame = 0
  private t0 = 0
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private recording = false
  state: EngineState = 'idle'
  onTick: ((status: PlaybackStatus) => void) | null = null
  onDone: ((result: PlaybackResult) => void) | null = null

  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement('canvas')
    this.canvas.width = CINEMA_WIDTH
    this.canvas.height = CINEMA_HEIGHT
    const ctx = this.canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('2D context unavailable')
    this.ctx = ctx
    this.paintIdle()
  }

  /* ───────────────────────── 装片 ───────────────────────── */

  /**
   * 组装时间轴与字体。开场视频的时长以 <video> 元数据实测为准（探测值可能有出入）。
   * 传入模板时先经渲染池预渲染每张的水印合成图（幻灯片语义：完整作品 letterbox、
   * 硬切换片、无 Ken Burns/字幕）。返回实际使用的开场秒数（0 = 无素材）。
   */
  async prepare(
    photos: EnginePhotoInput[],
    texts: CinemaTexts,
    media: CinemaMedia,
    options?: EnginePrepareOptions
  ): Promise<number> {
    await this.fonts.ensureFamily('misans', true)
    await this.fonts.ensureFamily('archivo', false)
    await this.fonts.ensureUrl(MARK_SYMBOL_FONT.cssName, MARK_SYMBOL_FONT.file)

    // 画面源可能从原片切到水印合成（或反向）：旧缓存位图全部失效
    for (const bmp of this.bitmaps.values()) bmp.close()
    this.bitmaps.clear()
    this.bitmapOrder = []
    this.watermarks.clear()
    this.watermarkMode = Boolean(options?.template)
    if (options?.template) await this.prerenderWatermarks(photos, options.template)

    let introSeconds = 0
    if (media.introUrl) {
      const video = await this.loadVideo(media.introUrl)
      this.video = video
      introSeconds = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (media.introDuration ?? 0)
    }

    this.photos = photos
    this.texts = texts
    // crossfade 0 = 幻灯片硬切（照片段零重叠，frameAt 恒单层）
    this.timeline = buildTimeline(toTimelinePhotos(photos, texts), { introSeconds, crossfade: 0 })

    if (media.musicUrl) {
      this.musicBuffer = await this.decodeMusic(media.musicUrl)
    } else {
      this.musicBuffer = null
    }
    this.paintIdle()
    return introSeconds
  }

  /** 渲染池按片预渲染水印合成图；单张失败回退原片路径（帧语义不变） */
  private async prerenderWatermarks(photos: EnginePhotoInput[], template: WatermarkTemplate): Promise<void> {
    const pool = getRenderPool()
    const results = await Promise.allSettled(
      photos.map((photo) =>
        pool.run({
          kind: 'preview',
          file: photo.file,
          meta: photo.meta ?? {},
          template,
          maxLongEdge: CINEMA_WIDTH
        })
      )
    )
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.ok && result.value.kind === 'preview') {
        this.watermarks.set(photos[index]!.id, {
          blob: result.value.blob,
          width: result.value.width,
          height: result.value.height
        })
      }
    })
  }

  private async loadVideo(url: string): Promise<HTMLVideoElement> {
    const video = document.createElement('video')
    video.src = url
    video.playsInline = true
    video.crossOrigin = 'anonymous'
    video.preload = 'auto'
    await new Promise<void>((resolve, reject) => {
      const ok = () => resolve()
      video.addEventListener('loadedmetadata', ok, { once: true })
      video.addEventListener('error', () => reject(new Error(`intro video load failed: ${url}`)), { once: true })
    })
    return video
  }

  private async decodeMusic(url: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const buf = await res.arrayBuffer()
      this.audio = this.audio ?? new AudioContext()
      return await this.audio.decodeAudioData(buf)
    } catch {
      return null
    }
  }

  /* ───────────────────────── 放映 / 录制 ───────────────────────── */

  get duration(): number {
    return this.timeline?.duration ?? 0
  }

  get timelineSnapshot(): CinemaTimeline | null {
    return this.timeline
  }

  /** 开始放映（record=true 时同时录制）。必须在用户手势里调用（音频策略）。 */
  async play(record: boolean): Promise<void> {
    if (!this.timeline || this.state === 'running') return
    await this.stop()

    this.audio = this.audio ?? new AudioContext()
    const ctx = this.audio
    if (ctx.state === 'suspended') await ctx.resume()

    this.bus = ctx.createGain()
    this.monitor = ctx.createGain()
    this.bus.connect(this.monitor).connect(ctx.destination)
    if (record) {
      this.recordDest = ctx.createMediaStreamDestination()
      this.bus.connect(this.recordDest)
    }

    // 开场视频原声入图（经图后扬声器与录制轨共用）
    if (this.video) {
      this.videoSource = ctx.createMediaElementSource(this.video)
      this.videoSource.connect(this.bus)
    }

    // 影片时钟 t0：先定钟，再按钟排配乐（留 0.15s 提前量吸收 play() 唤醒，起步黑场）
    this.t0 = ctx.currentTime + 0.15
    if (this.video) {
      this.video.currentTime = 0
      void this.video.play()
    }

    // 配乐：片头卡起、谢幕落，跟随片长
    if (this.musicBuffer && this.timeline) {
      const startAt = this.timeline.musicStart
      const available = this.musicBuffer.duration
      const hardEnd = this.timeline.musicStart + available
      const effEnd = Math.min(this.timeline.musicEnd, hardEnd)
      const fadeOut = Math.min(CINEMA_MUSIC_FADE_OUT, Math.max(0.1, effEnd - startAt - CINEMA_MUSIC_FADE_IN))
      const source = ctx.createBufferSource()
      source.buffer = this.musicBuffer
      const gain = ctx.createGain()
      source.connect(gain).connect(this.bus)
      const when = this.t0 + startAt
      const holdFrom = when + CINEMA_MUSIC_FADE_IN
      const holdTo = when + Math.max(CINEMA_MUSIC_FADE_IN, effEnd - startAt - fadeOut)
      gain.gain.setValueAtTime(0, when)
      gain.gain.linearRampToValueAtTime(1, holdFrom)
      gain.gain.setValueAtTime(1, holdTo)
      gain.gain.linearRampToValueAtTime(0, holdTo + fadeOut)
      source.start(when)
      this.musicSource = source
    }

    if (record) {
      const { mime } = pickRecordingMime()
      const stream = this.canvas.captureStream(30)
      const tracks = [...stream.getVideoTracks()]
      if (this.recordDest) tracks.push(...this.recordDest.stream.getAudioTracks())
      this.chunks = []
      this.recorder = new MediaRecorder(new MediaStream(tracks), {
        mimeType: mime,
        videoBitsPerSecond: 12_000_000,
        audioBitsPerSecond: 192_000
      })
      this.recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data)
      }
      this.recorder.start(1000)
      this.recording = true
    }

    this.state = 'running'
    this.frame = requestAnimationFrame(this.tick)
  }

  /** 停止放映；录制中则收尾产出 Blob（onDone 回调，save=false 时丢弃半截成片） */
  async stop(save = true): Promise<void> {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.musicSource?.stop()
    this.musicSource = null
    if (this.video && !this.video.paused) this.video.pause()
    if (this.recorder && this.recorder.state !== 'inactive') {
      const rec = this.recorder
      await new Promise<void>((resolve) => {
        rec.addEventListener('stop', () => resolve(), { once: true })
        rec.stop()
      })
      if (this.recording && save) {
        const { mime, ext } = pickRecordingMime()
        const blob = new Blob(this.chunks, { type: mime })
        this.onDone?.({ blob, mime, ext })
      }
    }
    this.recorder = null
    this.recording = false
    this.videoSource?.disconnect()
    this.videoSource = null
    this.state = this.timeline ? 'done' : 'idle'
  }

  dispose(): void {
    void this.stop()
    for (const bmp of this.bitmaps.values()) bmp.close()
    this.bitmaps.clear()
    this.bitmapOrder = []
    this.watermarks.clear()
    this.video?.removeAttribute('src')
    this.video?.load()
    this.video = null
    void this.audio?.close()
    this.audio = null
  }

  setMonitorVolume(v: number): void {
    if (this.monitor) this.monitor.gain.value = v
  }

  /* ───────────────────────── 帧循环 ───────────────────────── */

  private tick = (): void => {
    if (this.state !== 'running' || !this.timeline) return
    const t = (this.audio?.currentTime ?? performance.now() / 1000) - this.t0
    const plan = frameAt(this.timeline, t)
    this.draw(t, plan)
    const top = plan.layers[plan.layers.length - 1]
    this.onTick?.({
      t,
      duration: this.timeline.duration,
      segmentKind: top?.seg.kind ?? 'outro',
      photoIndex: top?.seg.kind === 'photo' ? top.seg.index : -1,
      recording: this.recording
    })
    if (plan.finished) {
      void this.stop()
      return
    }
    this.frame = requestAnimationFrame(this.tick)
  }

  private draw(t: number, plan: ReturnType<typeof frameAt>): void {
    const { ctx } = this
    ctx.globalAlpha = 1
    ctx.fillStyle = STAGE_BLACK
    ctx.fillRect(0, 0, CINEMA_WIDTH, CINEMA_HEIGHT)

    for (const layer of plan.layers) {
      const seg = layer.seg
      if (seg.kind === 'intro' && this.video) {
        ctx.globalAlpha = layer.alpha
        ctx.drawImage(this.video, 0, 0, CINEMA_WIDTH, CINEMA_HEIGHT)
      } else if (seg.kind === 'photo') {
        const bmp = this.bitmapFor(seg.photo.id, seg.index)
        if (!bmp) continue
        ctx.globalAlpha = layer.alpha
        if (this.watermarkMode) {
          // 水印幻灯片：完整作品 contain 内接（横幅/装裱完整可见，两侧影院遮幅）
          const scale = Math.min(CINEMA_WIDTH / bmp.width, CINEMA_HEIGHT / bmp.height)
          const w = bmp.width * scale
          const h = bmp.height * scale
          ctx.drawImage(bmp, (CINEMA_WIDTH - w) / 2, (CINEMA_HEIGHT - h) / 2, w, h)
        } else if (layer.kb) {
          const crop = coverCropRect(bmp.width, bmp.height, CINEMA_WIDTH, CINEMA_HEIGHT, layer.kb.zoom, layer.kb.panX, layer.kb.panY)
          ctx.drawImage(bmp, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, CINEMA_WIDTH, CINEMA_HEIGHT)
          // 水印模式字幕条停用：横幅已承载型号/参数叙事
          if (layer.captionAlpha > 0.01 && layer.alpha >= 0.999 && seg.photo.caption) {
            this.drawCaption(seg.photo.caption, layer.captionAlpha)
          }
        }
      } else if (seg.kind === 'title') {
        ctx.globalAlpha = layer.alpha
        this.drawTitleCard(t - seg.start)
      } else if (seg.kind === 'outro') {
        ctx.globalAlpha = layer.alpha
        this.drawOutroCard()
      }
    }

    // 放映机闪烁（照片/卡片段；开场视频保留自身影调）
    const inProjection = plan.layers.some((l) => l.seg.kind !== 'intro')
    if (inProjection) {
      const flicker = 0.014 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 21))
      ctx.globalAlpha = 1
      ctx.fillStyle = `rgba(4,5,8,${flicker.toFixed(4)})`
      ctx.fillRect(0, 0, CINEMA_WIDTH, CINEMA_HEIGHT)
    }
    if (plan.fadeToBlack > 0) {
      ctx.globalAlpha = plan.fadeToBlack
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, CINEMA_WIDTH, CINEMA_HEIGHT)
    }
    ctx.globalAlpha = 1
  }

  /* ───────────────────────── 惰性解码（LRU） ───────────────────────── */

  private bitmapFor(id: string, index: number): ImageBitmap | undefined {
    const hit = this.bitmaps.get(id)
    if (hit) {
      const order = this.bitmapOrder.indexOf(id)
      if (order >= 0) this.bitmapOrder.splice(order, 1)
      this.bitmapOrder.push(id)
      return hit
    }
    const photo = this.photos.find((p) => p.id === id)
    if (photo) void this.decodePhoto(photo)
    void this.prefetchAhead(index)
    return undefined
  }

  private async prefetchAhead(index: number): Promise<void> {
    for (const photo of [this.photos[index + 1], this.photos[index + 2]]) {
      if (photo && !this.bitmaps.has(photo.id)) await this.decodePhoto(photo)
    }
  }

  private async decodePhoto(photo: EnginePhotoInput): Promise<void> {
    if (this.bitmaps.has(photo.id)) return
    try {
      // 水印合成图直接解码（PNG 已是正向位；横幅随图完整）
      const wm = this.watermarks.get(photo.id)
      const bmp = wm ? await createImageBitmap(wm.blob) : await this.decodeRawPhoto(photo)
      if (this.bitmaps.has(photo.id)) {
        bmp.close()
        return
      }
      this.bitmaps.set(photo.id, bmp)
      this.bitmapOrder.push(photo.id)
      while (this.bitmapOrder.length > BITMAP_CACHE) {
        const evict = this.bitmapOrder.shift()
        if (evict) {
          this.bitmaps.get(evict)?.close()
          this.bitmaps.delete(evict)
        }
      }
    } catch {
      /* 解码失败：该段黑场过渡，不中断放映 */
    }
  }

  /** 原片路径：EXIF 正向解码 + 超长边降采样 */
  private async decodeRawPhoto(photo: EnginePhotoInput): Promise<ImageBitmap> {
    const { width, height } = photo.meta ?? {}
    if (width && height && Math.max(width, height) > DECODE_LONG_EDGE) {
      const scale = DECODE_LONG_EDGE / Math.max(width, height)
      return createImageBitmap(photo.file, {
        imageOrientation: 'from-image',
        resizeWidth: Math.max(1, Math.round(width * scale)),
        resizeHeight: Math.max(1, Math.round(height * scale)),
        resizeQuality: 'high'
      })
    }
    return createImageBitmap(photo.file, { imageOrientation: 'from-image' })
  }

  /* ───────────────────────── 卡片与字幕（薄绘制层） ───────────────────────── */

  private paintIdle(): void {
    const { ctx } = this
    ctx.globalAlpha = 1
    ctx.fillStyle = STAGE_BLACK
    ctx.fillRect(0, 0, CINEMA_WIDTH, CINEMA_HEIGHT)
    ctx.fillStyle = NIKON_RED
    ctx.fillRect(CINEMA_WIDTH / 2 - 1, CINEMA_HEIGHT / 2 - 56, 2, 48)
  }

  private hud(ctx: Ctx2D, text: string, x: number, y: number, px = 24, color = MUTED, align: 'left' | 'center' = 'left'): void {
    ctx.save()
    if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${Math.round(px * 0.28)}px`
    ctx.font = `300 ${px}px "Picseal Archivo", sans-serif`
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(text.toUpperCase(), x, y)
    ctx.restore()
  }

  private drawTitleCard(local: number): void {
    const { ctx, texts } = this
    if (!texts) return
    this.hud(ctx, 'PICSEAL / PROJECTION ROOM', 96, 96, 24)
    ctx.fillStyle = 'rgba(208,226,243,0.25)'
    ctx.fillRect(96, 116, CINEMA_WIDTH - 192, 1)
    this.hud(ctx, texts.titleSub, 96, CINEMA_HEIGHT - 84, 22)

    const cx = CINEMA_WIDTH / 2
    ctx.fillStyle = NIKON_RED
    ctx.fillRect(cx - 28, CINEMA_HEIGHT / 2 - 128, 56, 3)
    drawInkText(ctx, texts.titleMain, cx, CINEMA_HEIGHT / 2 - 60, 110, { family: 'misans', weight: 600, color: INK }, 'center')
    drawInkText(ctx, texts.titleInfo, cx, CINEMA_HEIGHT / 2 + 90, 30, { family: 'misans', weight: 300, color: MUTED }, 'center')
  }

  private drawOutroCard(): void {
    const { ctx, texts } = this
    if (!texts) return
    const cx = CINEMA_WIDTH / 2
    drawInkText(ctx, texts.outroMain, cx, CINEMA_HEIGHT / 2 - 70, 150, { family: 'archivo', weight: 300, color: INK }, 'center')
    ctx.fillStyle = NIKON_RED
    ctx.fillRect(cx - 28, CINEMA_HEIGHT / 2 + 6, 56, 3)
    drawInkText(ctx, texts.outroSub, cx, CINEMA_HEIGHT / 2 + 50, 34, { family: 'misans', weight: 400, color: INK }, 'center')
    this.hud(ctx, texts.outroCredit, cx, CINEMA_HEIGHT / 2 + 130, 22, MUTED, 'center')
  }

  /** 播放结束的幕面驻留画面：END 大字（电影剧终意象，固定英文）
   *  + 多语言署名小字——其中 "PICSEAL" 标品牌红 */
  drawEndCard(credit: string): void {
    const { ctx } = this
    ctx.globalAlpha = 1
    ctx.fillStyle = STAGE_BLACK
    ctx.fillRect(0, 0, CINEMA_WIDTH, CINEMA_HEIGHT)
    const cx = CINEMA_WIDTH / 2
    drawInkText(ctx, 'END', cx, CINEMA_HEIGHT / 2 - 150, 230, { family: 'archivo', weight: 300, color: INK }, 'center')
    ctx.fillStyle = NIKON_RED
    ctx.fillRect(cx - 34, CINEMA_HEIGHT / 2 + 84, 68, 3)
    const segments: Array<{ text: string; color: string }> = []
    const marker = 'PICSEAL'
    const idx = credit.indexOf(marker)
    if (idx >= 0) {
      if (idx > 0) segments.push({ text: credit.slice(0, idx), color: MUTED })
      segments.push({ text: marker, color: NIKON_RED })
      const rest = credit.slice(idx + marker.length)
      if (rest) segments.push({ text: rest, color: MUTED })
    } else {
      segments.push({ text: credit, color: MUTED })
    }
    drawInkSegments(ctx, segments, cx, CINEMA_HEIGHT / 2 + 126, 26, { family: 'misans', weight: 300, color: MUTED }, 'center')
  }

  private drawCaption(caption: { title: string; sub: string }, alpha: number): void {
    const { ctx } = this
    const x = 96
    const blockH = 150
    const topY = CINEMA_HEIGHT - 96 - blockH

    const gradient = ctx.createLinearGradient(0, CINEMA_HEIGHT - 320, 0, CINEMA_HEIGHT)
    gradient.addColorStop(0, 'rgba(5,7,10,0)')
    gradient.addColorStop(1, 'rgba(5,7,10,0.55)')
    ctx.globalAlpha = alpha
    ctx.fillStyle = gradient
    ctx.fillRect(0, CINEMA_HEIGHT - 320, CINEMA_WIDTH, 320)

    const luma = sampleLuminance(ctx, 0, topY, Math.min(1200, CINEMA_WIDTH), blockH)
    const ink = ensureContrastColor(INK, luma)
    ctx.fillStyle = NIKON_RED
    ctx.fillRect(x, topY, 44, 2)
    drawInkText(ctx, caption.title, x, topY + 18, 42, { family: 'misans', weight: 600, color: ink })
    drawInkText(ctx, caption.sub, x, topY + 78, 24, { family: 'archivo', weight: 300, color: ink })
    ctx.globalAlpha = 1
  }
}

/* ───────────────────────── 装配辅助 ───────────────────────── */

function toTimelinePhotos(photos: EnginePhotoInput[], texts: CinemaTexts): TimelinePhoto[] {
  return photos.map((photo) => ({
    id: photo.id,
    meta: photo.meta,
    caption: photoCaption(photo)
  }))
}

/** 字幕：机型行 + 参数/日期行（数据缺失显示 '-'，不造假） */
export function photoCaption(photo: EnginePhotoInput): { title: string; sub: string } {
  const meta = photo.meta ?? {}
  const title = meta.modelPretty ?? meta.model ?? meta.make ?? '—'
  const parts = [formatParams(meta)]
  const date = meta.dateTimeOriginal ? formatDate(meta.dateTimeOriginal, 'YYYY.MM.dd') : ''
  const sub = [parts[0] || '-', date].filter(Boolean).join('  ·  ')
  return { title, sub }
}

export function summarizeSpan(photos: EnginePhotoInput[]): string {
  const times = photos
    .map((p) => p.meta?.dateTimeOriginal?.getTime())
    .filter((t): t is number => t !== undefined && !Number.isNaN(t))
    .sort((a, b) => a - b)
  if (times.length === 0) return `${photos.length}`
  const from = formatDate(new Date(times[0]!), 'YYYY.MM.dd')
  const to = formatDate(new Date(times[times.length - 1]!), 'YYYY.MM.dd')
  return times.length === 1 || from === to ? `${photos.length} · ${from}` : `${photos.length} · ${from} - ${to}`
}
