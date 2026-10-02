'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Volume2, VolumeX, Music4, Upload } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { ArchiveWallScene } from '@/three/wall/scene'
import { SurfaceTransition } from '@/three/wall/surface-transition'
import { BeatEngine, loadUserTrack, saveUserTrack } from '@/three/audio/beat'
import { readPhotoMeta, formatParams, formatDate } from '@/core/exif/reader'
import { BUILTIN_TEMPLATES } from '@/core/templates/builtin'
import { matchBrand } from '@/core/brands'
import { getRenderPool } from '@/workers/pool'
import type { PhotoMeta } from '@/core/types'

/** 内置兜底样片；若 public/samples/manifest.json 存在则优先使用采集样片库 */
const FALLBACK_SAMPLES = [
  'sony', 'canon', 'nikon', 'fujifilm', 'leica', 'xiaomi', 'apple',
  'huawei', 'panasonic', 'olympus', 'ricoh', 'dji', 'insta360'
] as const

interface SampleEntry {
  id: string
  file: string
}

async function loadSampleList(): Promise<Array<{ id: string; file: string }>> {
  try {
      const res = await fetch('/samples/manifest.json', { cache: 'no-cache' })
    if (res.ok) {
      const manifest = (await res.json()) as SampleEntry[]
      if (Array.isArray(manifest) && manifest.length >= 4) return manifest.slice(0, 48)
    }
  } catch {
    /* manifest 缺失走兜底 */
  }
  return FALLBACK_SAMPLES.map((id) => ({ id, file: `${id}.jpg` }))
}

interface SampleFrame {
  id: string
  blob: Blob
  url: string
  meta: PhotoMeta
}

/**
 * 落地页 3D 影像档案墙：玻璃卡片箱 + 波场丝滑动效（Rhine-Music-Demo 移植），
 * 样片原图先上墙、水印实渲后渐进升级纹理；背景音乐节拍驱动波场律动。
 */
export function HeroWall() {
  const t = useTranslations()
  const containerRef = useRef<HTMLDivElement>(null)
  const calloutRef = useRef<HTMLDivElement>(null)
  const transitionRef = useRef<SurfaceTransition | null>(null)
  const sceneRef = useRef<ArchiveWallScene | null>(null)
  const engineRef = useRef<BeatEngine | null>(null)
  const blobCacheRef = useRef(new Map<string, Blob>())

  const [frames, setFrames] = useState<SampleFrame[]>([])
  /** 全部样片加载完成（建墙/水印升级的唯一门） */
  const [samplesReady, setSamplesReady] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [musicOn, setMusicOn] = useState(false)
  const [hasUserTrack, setHasUserTrack] = useState(false)

  /* ── 样片加载（manifest 优先，原图 + EXIF） ── */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await loadSampleList()
      const loaded: SampleFrame[] = []
      for (const entry of list) {
        try {
          const res = await fetch(`/samples/${entry.file}`)
          const blob = await res.blob()
          const meta = await readPhotoMeta(blob)
          if (cancelled) return
          blobCacheRef.current.set(entry.id, blob)
          loaded.push({ id: entry.id, blob, url: URL.createObjectURL(blob), meta })
          setFrames([...loaded])
        } catch {
          /* 单张失败跳过 */
        }
      }
      if (!cancelled && loaded.length > 0) setSamplesReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /* ── 场景构建（全部样片就绪后一次） ── */
  useEffect(() => {
    if (!containerRef.current || !samplesReady || sceneRef.current) return
    const scene = new ArchiveWallScene({
      container: containerRef.current,
      items: frames.map((f) => ({
        id: f.id,
        url: f.url,
        model: f.meta.modelPretty,
        params: formatParams(f.meta),
        date: f.meta.dateTimeOriginal ? formatDate(f.meta.dateTimeOriginal) : undefined
      })),
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      theme: ((document.documentElement.dataset.theme as 'night' | 'day') ?? 'night'),
      quality: window.innerWidth < 900 || window.innerWidth * window.devicePixelRatio > 3200 ? 'performance' : 'high',
      onSelect: (index) => {
        setSelected(index)
        if (index === null) transitionRef.current?.hide()
        else transitionRef.current?.show()
      }
    })
    sceneRef.current = scene

    transitionRef.current = new SurfaceTransition(calloutRef.current, {
      enterMs: 360,
      exitMs: 240,
      direction: 'right'
    })
    transitionRef.current.hide()

    const onResize = () => scene.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      engineRef.current?.destroy()
      engineRef.current = null
      scene.dispose()
      sceneRef.current = null
    }
  }, [samplesReady]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 主题联动：昼夜切换时同步墙面氛围 ── */
  useEffect(() => {
    const el = document.documentElement
    const apply = () => {
      const theme = (el.dataset.theme as 'night' | 'day') ?? 'night'
      sceneRef.current?.setTheme(theme)
    }
    const observer = new MutationObserver(apply)
    observer.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  /* ── 水印实渲 → 原位升级墙面纹理（产品自我演示） ── */
  useEffect(() => {
    if (!samplesReady || !sceneRef.current) return
    let cancelled = false
    void (async () => {
      const pool = getRenderPool()
      const template = {
        ...BUILTIN_TEMPLATES[0]!,
        typography: { ...BUILTIN_TEMPLATES[0]!.typography, scale: 1.35 }
      }
      for (const [index, frame] of frames.entries()) {
        if (cancelled || !sceneRef.current) return
        try {
          const res = await pool.run({
            kind: 'preview',
            file: new File([frame.blob], `${frame.id}.jpg`, { type: 'image/jpeg' }),
            meta: frame.meta,
            template,
            maxLongEdge: 1024
          })
          if (cancelled) return
          if (res.ok && res.kind === 'preview') {
            sceneRef.current.upgradeItem(index, URL.createObjectURL(res.blob))
          }
        } catch {
          /* 升级失败保留原图 */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [samplesReady, frames.length]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 背景音乐 + 节拍律动 ── */
  const startMusic = useCallback(async (): Promise<boolean> => {
    if (!engineRef.current) {
      const engine = new BeatEngine({
        defaultSrc: '/audio/bgm.mp3',
        onBeat: (strength) => sceneRef.current?.beatPulse(strength),
        onLevel: (level) => sceneRef.current?.setMusicLevel(level)
      })
      engineRef.current = engine
      // 用户自备音源优先
      const userTrack = await loadUserTrack().catch(() => null)
      if (userTrack) {
        await engine.setTrack(userTrack)
        setHasUserTrack(true)
      }
    }
    try {
      const playing = await engineRef.current.toggle()
      setMusicOn(playing)
      try {
        localStorage.setItem('picseal-music', playing ? 'on' : 'off')
      } catch {
        /* private mode */
      }
      return playing
    } catch {
      return false
    }
  }, [])

  // 默认开启：首个手势（滚轮/点击/按键）自动起播（浏览器自动播放策略）
  useEffect(() => {
    let armed = true
    const pref = (() => {
      try {
        return localStorage.getItem('picseal-music') ?? 'on'
      } catch {
        return 'on'
      }
    })()
    if (pref !== 'on') {
      setMusicOn(false)
      return
    }
    const gesture = (): void => {
      if (!armed) return
      armed = false
      void startMusic()
      window.removeEventListener('pointerdown', gesture)
      window.removeEventListener('wheel', gesture)
      window.removeEventListener('keydown', gesture)
    }
    window.addEventListener('pointerdown', gesture, { once: true })
    window.addEventListener('wheel', gesture, { once: true, passive: true })
    window.addEventListener('keydown', gesture, { once: true })
    return () => {
      armed = false
      window.removeEventListener('pointerdown', gesture)
      window.removeEventListener('wheel', gesture)
      window.removeEventListener('keydown', gesture)
    }
  }, [startMusic])

  const onPickUserTrack = async (file: File | undefined): Promise<void> => {
    if (!file) return
    await saveUserTrack(file).catch(() => undefined)
    setHasUserTrack(true)
    if (engineRef.current) {
      await engineRef.current.setTrack(file)
      if (!engineRef.current.playing) await startMusic()
    }
  }

  const selectedFrame = selected !== null ? frames[selected] : undefined
  const brand = selectedFrame ? matchBrand(selectedFrame.meta.make, selectedFrame.meta.model) : undefined

  return (
    <div className="relative h-[86vh] min-h-[540px] w-full overflow-hidden border-b border-line">
      <div ref={containerRef} className="absolute inset-0" />

      {/* 品牌角标 */}
      <div className="pointer-events-none absolute left-6 top-6 z-10">
        <p className="text-[17px] font-bold tracking-[4px]">PICSEAL</p>
        <p className="hud-label mt-1">
          {t('brand.tagline')} / {t('brand.taglineEn')}
        </p>
      </div>

      {/* 音乐控制（右上）：默认开启，可关闭；支持载入自备音源 */}
      <div className="absolute right-6 top-6 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void startMusic()}
          className="flex items-center gap-1.5 border border-line bg-panel/80 px-2.5 py-1 text-[10px] tracking-[1px] text-muted backdrop-blur-sm transition-colors hover:border-ink hover:text-ink"
          title={hasUserTrack ? 'BGM · 自备音源' : 'BGM · Komiku (CC0)'}
        >
          {musicOn ? <Volume2 size={12} className="text-accent" /> : <VolumeX size={12} />}
          {musicOn ? 'ON' : 'OFF'}
        </button>
        <label
          className="flex cursor-pointer items-center gap-1.5 border border-line bg-panel/80 px-2.5 py-1 text-[10px] tracking-[1px] text-muted backdrop-blur-sm transition-colors hover:border-ink hover:text-ink"
          title="载入你自己的音乐（如 Radical Face — Welcome Home, Son），仅存本地浏览器"
        >
          <Music4 size={12} />
          <Upload size={10} />
          <input
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => void onPickUserTrack(e.target.files?.[0])}
          />
        </label>
      </div>

      {/* 底部提示 / 详情档案卡（SurfaceTransition 可打断过渡） */}
      <div className="pointer-events-none absolute bottom-8 left-1/2 z-10 w-[min(560px,90vw)] -translate-x-1/2">
        <div ref={calloutRef} className="pointer-events-auto" style={{ visibility: 'hidden' }}>
          {selectedFrame ? (
            <div className="border border-line bg-panel p-4" style={{ boxShadow: 'var(--shadow-pop)' }}>
              <div className="rule-heavy flex items-baseline justify-between pb-2">
                <span className="text-[11px] tracking-[2px] text-muted">
                  FRAME {String((selected ?? 0) + 1).padStart(3, '0')}
                </span>
                <span className="text-[11px] text-muted">
                  {brand?.name ?? selectedFrame.meta.make ?? '—'}
                </span>
              </div>
              <p className="mt-2 text-[16px] font-semibold">
                {selectedFrame.meta.modelPretty ?? '—'}
              </p>
              <p className="mt-0.5 text-[12px] tabular-nums text-muted">
                {[
                  formatParams(selectedFrame.meta),
                  selectedFrame.meta.dateTimeOriginal
                    ? formatDate(selectedFrame.meta.dateTimeOriginal)
                    : undefined
                ]
                  .filter(Boolean)
                  .join('  ·  ')}
              </p>
              <div className="mt-3 flex gap-2">
                <Link
                  href="/studio"
                  className="flex h-8 items-center bg-ink px-3 text-[11px] font-medium tracking-[1px] text-page transition-opacity hover:opacity-85"
                >
                  {t('landing.entry')} ↗
                </Link>
                <button
                  type="button"
                  onClick={() => sceneRef.current?.select(null)}
                  className="h-8 border border-line px-3 text-[11px] text-muted transition-colors hover:border-ink hover:text-ink"
                >
                  {t('common.close')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        {!selectedFrame ? (
          <p className="text-center text-[11px] tracking-[2px] text-muted">
            {t('landing.browsableHint').toUpperCase()}
          </p>
        ) : null}
      </div>
    </div>
  )
}
