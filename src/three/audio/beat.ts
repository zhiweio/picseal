/**
 * 背景音乐 + 节拍引擎。
 * WebAudio AnalyserNode → 低频能量包络 + 谱通量 onset 检测（拍手/鼓点），
 * 输出 {level, onBeat} 供 3D 波场耦合。对任意曲目生效（含用户自备音源）。
 *
 * 自动播放策略：需在用户手势后 start()；默认开启偏好持久化到 preferences store。
 * 用户自备音源（如 Radical Face《Welcome Home, Son》）存 IndexedDB，仅本地。
 */

import { createStore, del, get, set, type UseStore } from 'idb-keyval'
import { mediaUrl } from '@/core/media-url'

export interface BeatEngineOptions {
  /** 默认内置曲目 URL */
  defaultSrc?: string
  onBeat?: (strength: number) => void
  onLevel?: (level: number) => void
  onStateChange?: (playing: boolean) => void
}

const BASS_BIN_COUNT = 12 // ~0-500Hz @ fftSize 1024 / 44.1kHz
const ONSET_COOLDOWN_MS = 180

/** 低频段谱通量（正增量之和） */
export function bandFlux(prev: Uint8Array, cur: Uint8Array, bins = BASS_BIN_COUNT): number {
  let flux = 0
  for (let i = 1; i <= bins; i += 1) {
    const delta = (cur[i] ?? 0) - (prev[i] ?? 0)
    if (delta > 0) flux += delta
  }
  return flux
}

/** 自适应阈值 onset 判定：能量突增 + 滑动均值/方差门槛 + 低通底噪过滤 */
export function isOnset(
  flux: number,
  history: number[],
  opts: { sensitivity?: number; floor?: number } = {}
): { onset: boolean; strength: number } {
  if (history.length === 0) return { onset: false, strength: 0 }
  const mean = history.reduce((a, b) => a + b, 0) / history.length
  const variance = history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length
  const threshold = mean + (opts.sensitivity ?? 1.6) * Math.sqrt(variance) + 4
  if (flux > threshold && mean > (opts.floor ?? 2)) {
    return { onset: true, strength: Math.min(1, (flux - mean) / 220) }
  }
  return { onset: false, strength: 0 }
}

export class BeatEngine {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private audio: HTMLAudioElement | null = null
  private source: MediaElementAudioSourceNode | null = null
  private raf = 0
  private freq: Uint8Array<ArrayBuffer> = new Uint8Array(0)
  private prevFreq: Uint8Array<ArrayBuffer> = new Uint8Array(0)
  private fluxHistory: number[] = []
  private lastOnset = 0
  private level = 0

  onBeat: ((strength: number) => void) | null
  onLevel: ((level: number) => void) | null
  onStateChange: ((playing: boolean) => void) | null
  playing = false

  constructor(private opts: BeatEngineOptions = {}) {
    this.onBeat = opts.onBeat ?? null
    this.onLevel = opts.onLevel ?? null
    this.onStateChange = opts.onStateChange ?? null
  }

  /** 惰性创建音频图（必须在用户手势内首次调用） */
  private ensureGraph(): void {
    if (this.ctx) return
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctx()
    this.audio = new Audio()
    this.audio.loop = true
    this.audio.crossOrigin = 'anonymous'
    this.audio.src = this.opts.defaultSrc ?? mediaUrl('/audio/bgm.mp3')
    this.source = this.ctx.createMediaElementSource(this.audio)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.analyser.smoothingTimeConstant = 0.5
    this.source.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)
    this.freq = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount))
    this.prevFreq = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount))
    this.audio.addEventListener('play', () => {
      this.playing = true
      this.onStateChange?.(true)
    })
    this.audio.addEventListener('pause', () => {
      this.playing = false
      this.onStateChange?.(false)
    })
  }

  async start(): Promise<void> {
    this.ensureGraph()
    if (this.ctx!.state === 'suspended') await this.ctx!.resume()
    await this.audio!.play()
    if (!this.raf) this.loop()
  }

  pause(): void {
    this.audio?.pause()
  }

  async toggle(): Promise<boolean> {
    if (this.playing) {
      this.pause()
      return false
    }
    await this.start()
    return true
  }

  /** 载入用户自备音源（Blob 持久化由调用方经 IndexedDB 处理） */
  setTrack(blob: Blob): Promise<void> {
    this.ensureGraph()
    const url = URL.createObjectURL(blob)
    const previous = this.audio!.src
    this.audio!.src = url
    if (this.playing) return this.audio!.play().then(() => undefined)
    void previous
    return Promise.resolve()
  }

  private loop = (): void => {
    if (!this.analyser || !this.ctx) return
    this.raf = requestAnimationFrame(this.loop)
    const analyser = this.analyser

    this.prevFreq.set(this.freq)
    analyser.getByteFrequencyData(this.freq)

    // 低频能量包络（平滑上升、缓慢衰减）
    let bass = 0
    for (let i = 1; i <= BASS_BIN_COUNT; i += 1) bass += this.freq[i] ?? 0
    bass /= BASS_BIN_COUNT * 255
    this.level = bass > this.level ? this.level + (bass - this.level) * 0.4 : this.level + (bass - this.level) * 0.06
    this.onLevel?.(this.level)

    // 谱通量 onset（低频段）：能量突增 + 自适应阈值 + 冷却窗
    const flux = bandFlux(this.prevFreq, this.freq)
    this.fluxHistory.push(flux)
    if (this.fluxHistory.length > 43) this.fluxHistory.shift()
    const now = performance.now()
    const { onset, strength } = isOnset(flux, this.fluxHistory)
    if (onset && now - this.lastOnset > ONSET_COOLDOWN_MS) {
      this.lastOnset = now
      this.onBeat?.(strength)
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.audio?.pause()
    this.audio?.remove()
    void this.ctx?.close()
    this.ctx = null
    this.playing = false
  }
}

/* ── 用户自备音源持久化（IndexedDB via idb-keyval，仅本地；DB/Store 名沿用旧版，老数据免迁移） ── */

let trackStore: UseStore | undefined
/** 懒创建：client 模块在 SSR 也会求值，避免服务端触碰 indexedDB */
function userTrackStore(): UseStore {
  trackStore ??= createStore('picseal-audio', 'track')
  return trackStore
}

export async function saveUserTrack(blob: Blob): Promise<void> {
  await set('user', blob, userTrackStore())
}

export async function loadUserTrack(): Promise<Blob | null> {
  const blob = await get('user', userTrackStore())
  return blob instanceof Blob ? blob : null
}

export async function clearUserTrack(): Promise<void> {
  await del('user', userTrackStore())
}
