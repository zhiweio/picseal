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

/** 墙面格位上限（9 lanes × 48 rows） */
const WALL_CAPACITY = 432

interface SampleEntry {
  id: string
  file: string
}

async function loadSampleList(): Promise<Array<SampleEntry>> {
  try {
    const res = await fetch('/samples/manifest.json', { cache: 'no-cache' })
    if (res.ok) {
      const manifest = (await res.json()) as SampleEntry[]
      if (Array.isArray(manifest) && manifest.length >= 4) return manifest.slice(0, WALL_CAPACITY)
    }
  } catch {
    /* manifest 缺失走兜底 */
  }
  return FALLBACK_SAMPLES.map((id) => ({ id, file: `${id}.jpg` }))
}

/**
 * 落地页 3D 影像档案墙：磨砂玻璃档案盒 + 纵深巷道丝滑动效（Rhine-Music-Demo 移植）。
 * 流式加载：manifest 就绪即建墙，封面图集按到达顺序逐张上墙；
 * 元数据懒加载（选中才取 EXIF）；样片水印实渲后渐进升级墙面纹理。
 */
export function HeroWall() {
  const t = useTranslations()
  const containerRef = useRef<HTMLDivElement>(null)
  const calloutRef = useRef<HTMLDivElement>(null)
  const transitionRef = useRef<SurfaceTransition | null>(null)
  const sceneRef = useRef<ArchiveWallScene | null>(null)
  const engineRef = useRef<BeatEngine | null>(null)

  const [entries, setEntries] = useState<SampleEntry[]>([])
  const [metaMap, setMetaMap] = useState<Map<string, PhotoMeta>>(new Map())
  const [selected, setSelected] = useState<number | null>(null)
  const [musicOn, setMusicOn] = useState(false)
  const [hasUserTrack, setHasUserTrack] = useState(false)

  /* ── 样片清单（仅 manifest，秒级） ── */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await loadSampleList()
      if (!cancelled && list.length > 0) setEntries(list)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /* ── 场景构建（manifest 就绪即建；封面由场景自行流式填充） ── */
  useEffect(() => {
    if (!containerRef.current || entries.length === 0 || sceneRef.current) return
    const scene = new ArchiveWallScene({
      container: containerRef.current,
      items: entries.map((e) => ({ id: e.id, url: `/samples/${e.file}` })),
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
  }, [entries.length]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 水印实渲 → 原位升级墙面纹理；顺带缓存 EXIF（详情卡懒加载秒开） ── */
  useEffect(() => {
    if (entries.length === 0 || !sceneRef.current) return
    let cancelled = false
    const metas = new Map(metaMap)
    void (async () => {
      const pool = getRenderPool()
      const template = {
        ...BUILTIN_TEMPLATES[0]!,
        typography: { ...BUILTIN_TEMPLATES[0]!.typography, scale: 1.35 }
      }
      for (const [index, entry] of entries.entries()) {
        if (cancelled || !sceneRef.current) return
        try {
          const res = await fetch(`/samples/${entry.file}`)
          const blob = await res.blob()
          const meta = await readPhotoMeta(blob)
          if (cancelled) return
          if (!metas.has(entry.id)) {
            metas.set(entry.id, meta)
            setMetaMap(new Map(metas))
          }
          const rendered = await pool.run({
            kind: 'preview',
            file: new File([blob], entry.file, { type: 'image/jpeg' }),
            meta,
            template,
            maxLongEdge: 1024
          })
          if (cancelled) return
          if (rendered.ok && rendered.kind === 'preview') {
            sceneRef.current.upgradeItem(index, URL.createObjectURL(rendered.blob))
          }
        } catch {
          /* 单张失败保留原图 */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [entries.length]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 选中卡元数据懒加载（未命中缓存时） ── */
  useEffect(() => {
    if (selected === null) return
    const entry = entries[selected]
    if (!entry || metaMap.has(entry.id)) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/samples/${entry.file}`)
        const meta = await readPhotoMeta(await res.blob())
        if (!cancelled) setMetaMap((prev) => new Map(prev).set(entry.id, meta))
      } catch {
        /* 读取失败保持占位 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selected, entries, metaMap])

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

  const selectedEntry = selected !== null ? entries[selected] : undefined
  const selectedMeta = selectedEntry ? metaMap.get(selectedEntry.id) : undefined
  const brand = selectedMeta ? matchBrand(selectedMeta.make, selectedMeta.model) : undefined

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
          {selectedEntry ? (
            <div className="border border-line bg-panel p-4" style={{ boxShadow: 'var(--shadow-pop)' }}>
              <div className="rule-heavy flex items-baseline justify-between pb-2">
                <span className="text-[11px] tracking-[2px] text-muted">
                  FRAME {String((selected ?? 0) + 1).padStart(3, '0')}
                </span>
                <span className="text-[11px] text-muted">
                  {brand?.name ?? selectedMeta?.make ?? '—'}
                </span>
              </div>
              <p className="mt-2 text-[16px] font-semibold">
                {selectedMeta?.modelPretty ?? '—'}
              </p>
              <p className="mt-0.5 text-[12px] tabular-nums text-muted">
                {[
                  selectedMeta ? formatParams(selectedMeta) : undefined,
                  selectedMeta?.dateTimeOriginal
                    ? formatDate(selectedMeta.dateTimeOriginal)
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
        {!selectedEntry ? (
          <p className="text-center text-[11px] tracking-[2px] text-muted">
            {t('landing.browsableHint').toUpperCase()}
          </p>
        ) : null}
      </div>
    </div>
  )
}
