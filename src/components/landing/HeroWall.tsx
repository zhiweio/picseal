'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Volume2, VolumeX, Music4, Upload } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { NikonZMark } from '@/components/ui/NikonZMark'
import { Tooltip } from '@/components/ui/Tooltip'
import { ArchiveWallScene, type HudProjector } from '@/three/wall/scene'
import { SurfaceTransition } from '@/three/wall/surface-transition'
import { DocumentDecryption } from '@/three/wall/document-decryption'
import { SCAN_CORNERS, SCAN_FROM, SCAN_TO, type DecryptionFrame } from '@/three/wall/decryption'
import { CARD } from '@/three/wall/card'
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

/** HUD 扫描线所在的卡面 z（印刷面前沿） */
const SCAN_Z = CARD.depth / 2 + 0.03

const SVG_NS = 'http://www.w3.org/2000/svg'

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
 * 落地页 3D 影像档案墙：焦点导航 + 玻璃揭示（Rhine-Music-Demo 完全复刻）。
 * 浏览：点击任意卡 / 滑动 / 方向键整墙跟焦；点击当前卡进入检视特写，
 * 玻璃自上而下磨砂→清澈（解密揭示 + 扫描 HUD + 文字墨条擦除）。
 */
export function HeroWall() {
  const t = useTranslations()
  const containerRef = useRef<HTMLDivElement>(null)
  const calloutRef = useRef<HTMLDivElement>(null)
  const hudRef = useRef<SVGSVGElement>(null)
  const transitionRef = useRef<SurfaceTransition | null>(null)
  const docDecryptRef = useRef<DocumentDecryption | null>(null)
  const hudBeganRef = useRef(false)
  const sceneRef = useRef<ArchiveWallScene | null>(null)
  const engineRef = useRef<BeatEngine | null>(null)

  const [entries, setEntries] = useState<SampleEntry[]>([])
  const [metaMap, setMetaMap] = useState<Map<string, PhotoMeta>>(new Map())
  const [selected, setSelected] = useState<number | null>(null)
  const [browsed, setBrowsed] = useState(0)
  const [musicOn, setMusicOn] = useState(false)
  const [hasUserTrack, setHasUserTrack] = useState(false)
  const [webglFailed, setWebglFailed] = useState(false)

  /** 水印成品（itemIndex → blob URL）：实演循环与焦点预取共同填充 */
  const sealUrlsRef = useRef<Map<number, string>>(new Map())
  /** 当前检视会话是否已盖章（玻璃揭示完成时置位） */
  const sealedRef = useRef(false)
  const selectedRef = useRef<number | null>(null)

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

  /* ── 盖章：玻璃揭示完成后把印刷面替换为水印横幅成品 ── */
  const trySeal = useCallback((): void => {
    if (sealedRef.current) return
    const index = selectedRef.current
    if (index === null) return
    const url = sealUrlsRef.current.get(index)
    if (!url) return
    sealedRef.current = true
    sceneRef.current?.presentSeal(index, url)
  }, [])

  /* ── 扫描 HUD：onDecryption 每帧以投影器驱动 SVG（无 React 参与） ── */
  const applyHud = useCallback(
    (frame: DecryptionFrame, project: HudProjector) => {
      const svg = hudRef.current
      if (!svg) return
      if (frame.phase === 'clear') trySeal()
      const scanPoint = (k: number) =>
        project(
          SCAN_FROM[0] + (SCAN_TO[0] - SCAN_FROM[0]) * k,
          SCAN_FROM[1] + (SCAN_TO[1] - SCAN_FROM[1]) * k,
          SCAN_Z
        )
    while (svg.firstChild) svg.removeChild(svg.firstChild)
    svg.style.display =
      frame.phase === 'clear' || frame.phase === 'waiting' ? 'none' : 'block'
    for (const [a, b] of frame.intervals) {
      const from = scanPoint(a)
      const to = scanPoint(b)
      if (!from || !to) continue
      const line = document.createElementNS(SVG_NS, 'line')
      line.setAttribute('x1', String(from.x))
      line.setAttribute('y1', String(from.y))
      line.setAttribute('x2', String(to.x))
      line.setAttribute('y2', String(to.y))
      line.setAttribute('class', 'hud-scan-line')
      svg.append(line)
    }
    if (frame.markers > 0) {
      for (const [x, y] of SCAN_CORNERS) {
        const p = project(x, y, SCAN_Z)
        if (!p) continue
        const path = document.createElementNS(SVG_NS, 'path')
        path.setAttribute(
          'd',
          `M ${p.x - 9} ${p.y - 5} h 9 v 9 M ${p.x + 9} ${p.y + 5} h -9 v -9`
        )
        path.setAttribute('class', 'hud-scan-corner')
        path.style.opacity = String(frame.markers)
        svg.append(path)
      }
    }
    const mid = scanPoint(0.5)
    if (mid && frame.point > 0) {
      const dot = document.createElementNS(SVG_NS, 'circle')
      dot.setAttribute('cx', String(mid.x))
      dot.setAttribute('cy', String(mid.y))
      dot.setAttribute('r', '3')
      dot.setAttribute('class', 'hud-scan-point')
      dot.style.opacity = String(frame.point)
      svg.append(dot)
    }
    if (mid && frame.label > 0) {
      const text = document.createElementNS(SVG_NS, 'text')
      text.setAttribute('x', String(mid.x + 16))
      text.setAttribute('y', String(mid.y - 8))
      text.setAttribute('class', 'hud-scan-label')
      text.style.opacity = String(frame.label)
      text.textContent = 'PICSEAL // DECRYPT'
      svg.append(text)
    }
  }, [trySeal])

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
        selectedRef.current = index
        if (index !== null) sealedRef.current = false
        if (index === null) transitionRef.current?.hide()
        else transitionRef.current?.show()
      },
      onSelection: (index) => setBrowsed(index),
      onDecryption: applyHud
    })
    // WebGL 上下文创建失败（无 GPU/被禁用）时优雅降级为静态 hero，不炸整页
    if (!scene.usable) {
      scene.dispose()
      setWebglFailed(true)
      return
    }
    sceneRef.current = scene

    transitionRef.current = new SurfaceTransition(calloutRef.current, {
      enterMs: 360,
      exitMs: 240,
      direction: 'right'
    })
    transitionRef.current.hide()
    docDecryptRef.current = new DocumentDecryption()

    return () => {
      docDecryptRef.current?.dispose()
      docDecryptRef.current = null
      engineRef.current?.destroy()
      engineRef.current = null
      scene.dispose()
      sceneRef.current = null
      for (const url of sealUrlsRef.current.values()) URL.revokeObjectURL(url)
      sealUrlsRef.current.clear()
    }
  }, [entries.length, applyHud]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 详情卡文字：面板入场即快速擦除墨条（不等玻璃揭示，文字几乎立即可读） ── */
  useEffect(() => {
    if (selected === null) {
      docDecryptRef.current?.reset(null)
      hudBeganRef.current = false
      return
    }
    const id = window.setTimeout(() => {
      hudBeganRef.current = false
      docDecryptRef.current?.reset(calloutRef.current)
      docDecryptRef.current?.begin()
    }, 40)
    return () => window.clearTimeout(id)
  }, [selected])

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
            // 一渲两用：墙面图集升级 + 检视盖章的水印成品缓存
            sealUrlsRef.current.set(index, URL.createObjectURL(rendered.blob))
            sceneRef.current.upgradeItem(index, sealUrlsRef.current.get(index)!)
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

  /* ── 浏览焦点卡元数据预取（未命中缓存时） ── */
  useEffect(() => {
    const entry = entries[browsed]
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
  }, [browsed, entries, metaMap])

  /* ── 焦点卡水印成品即时预取（盖章用；实演循环按序渲染太慢，等不到当前卡） ── */
  useEffect(() => {
    const index = browsed
    const entry = entries[index]
    if (!entry || !sceneRef.current || sealUrlsRef.current.has(index)) return
    const meta = metaMap.get(entry.id)
    if (!meta) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/samples/${entry.file}`)
        const blob = await res.blob()
        const pool = getRenderPool()
        const template = {
          ...BUILTIN_TEMPLATES[0]!,
          typography: { ...BUILTIN_TEMPLATES[0]!.typography, scale: 1.35 }
        }
        const rendered = await pool.run({
          kind: 'preview',
          file: new File([blob], entry.file, { type: 'image/jpeg' }),
          meta,
          template,
          maxLongEdge: 1024
        })
        if (!cancelled && rendered.ok && rendered.kind === 'preview')
          sealUrlsRef.current.set(index, URL.createObjectURL(rendered.blob))
      } catch {
        /* 预取失败该卡不盖章（原图仍在） */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [browsed, entries, metaMap])

  /* ── 主题联动：昼夜切换时同步墙面氛围 ── */
  useEffect(() => {
    const el = document.documentElement
    const apply = () => {
      const theme = (el.dataset.theme as 'night' | 'day') ?? 'night'
      sceneRef.current?.setTheme(theme, true)
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
    <div ref={containerRef} className="relative h-[86vh] min-h-[540px] w-full overflow-hidden border-b border-line">
      {/* 3D 画布由场景插入此处（data-layout 由场景按视口三态维护） */}
      {webglFailed ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-[#efece7] to-[#e3ddd4] dark:from-[#241d15] dark:to-[#171209]">
          <p className="text-[13px] tracking-[3px] text-muted">PICSEAL ARCHIVE</p>
          <p className="max-w-[420px] px-6 text-center text-[12px] leading-relaxed text-muted">
            {t('landing.browsableHint')}
          </p>
          <Link
            href="/studio"
            className="mt-2 flex h-10 items-center bg-ink px-4 text-[11px] font-medium tracking-[1px] text-page"
          >
            {t('landing.entry')} ↗
          </Link>
        </div>
      ) : null}

      {/* 解密扫描 HUD（跟随后选中卡投影） */}
      <svg ref={hudRef} className="hud-layer pointer-events-none absolute inset-0 z-10" style={{ display: 'none' }} />

      {/* 品牌角标 */}
      <div className="pointer-events-none absolute left-6 top-6 z-20">
        <p className="text-[17px] font-bold tracking-[4px]">PICSEAL</p>
        <p className="hud-label mt-1">
          {t('brand.tagline')} / {t('brand.taglineEn')}
        </p>
      </div>

      {/* 音乐控制（右上）：默认开启，可关闭；支持载入自备音源 */}
      <div className="absolute right-6 top-6 z-20 flex items-center gap-2">
        {/* 放映室入口：尼康 Z 红标，悬浮 tooltip + 红晕 */}
        <Tooltip label={t('cinema.entryHint')} side="bottom">
          <Link
            href="/cinema"
            title={t('cinema.entryHint')}
            className="group flex min-h-[44px] items-center gap-1.5 border border-nikon/50 bg-panel/80 px-2.5 text-[10px] tracking-[1px] text-ink backdrop-blur-sm transition-all hover:border-nikon hover:shadow-[0_0_14px_rgba(224,31,38,0.35)]"
          >
            <NikonZMark className="text-[13px] transition-transform duration-300 group-hover:rotate-[8deg] group-hover:scale-110" />
            <span className="hidden text-muted transition-colors group-hover:text-ink sm:inline">
              {t('cinema.title')}
            </span>
          </Link>
        </Tooltip>
        <button
          type="button"
          onClick={() => void startMusic()}
          className="flex min-h-[44px] items-center gap-1.5 border border-line bg-panel/80 px-2.5 text-[10px] tracking-[1px] text-muted backdrop-blur-sm transition-colors hover:border-ink hover:text-ink"
          title={hasUserTrack ? 'BGM · 自备音源' : 'BGM · Komiku (CC0)'}
        >
          {musicOn ? <Volume2 size={12} className="text-accent" /> : <VolumeX size={12} />}
          {musicOn ? 'ON' : 'OFF'}
        </button>
        <label
          className="flex min-h-[44px] cursor-pointer items-center gap-1.5 border border-line bg-panel/80 px-2.5 text-[10px] tracking-[1px] text-muted backdrop-blur-sm transition-colors hover:border-ink hover:text-ink"
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

      {/* 详情档案卡：桌面右侧竖排，竖屏/紧凑为底部面板（跟随 data-layout） */}
      <div className="wall-detail-anchor pointer-events-none z-20">
        <div ref={calloutRef} className="pointer-events-auto" style={{ visibility: 'hidden' }}>
          {selectedEntry ? (
            <div className="detail-panel border border-line bg-panel p-4" style={{ boxShadow: 'var(--shadow-pop)' }}>
              <div className="rule-heavy flex items-baseline justify-between pb-2">
                <span data-doc className="text-[11px] tracking-[2px] text-muted">
                  FRAME {String((selected ?? 0) + 1).padStart(3, '0')}
                </span>
                <span data-doc className="text-[11px] text-muted">
                  {brand?.name ?? selectedMeta?.make ?? '—'}
                </span>
              </div>
              <p data-doc className="mt-2 text-[16px] font-semibold">
                {selectedMeta?.modelPretty ?? '—'}
              </p>
              <p data-doc className="mt-0.5 text-[12px] tabular-nums text-muted">
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
                  className="flex h-11 items-center bg-ink px-3 text-[11px] font-medium tracking-[1px] text-page transition-opacity hover:opacity-85"
                >
                  {t('landing.entry')} ↗
                </Link>
                <button
                  type="button"
                  onClick={() => sceneRef.current?.exitDetail()}
                  className="h-11 border border-line px-3 text-[11px] text-muted transition-colors hover:border-ink hover:text-ink"
                >
                  {t('common.close')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {!selectedEntry ? (
        <p className="pointer-events-none absolute bottom-[calc(env(safe-area-inset-bottom,0px)+18px)] left-1/2 z-20 -translate-x-1/2 text-center text-[11px] tracking-[2px] text-muted">
          {t('landing.browsableHint').toUpperCase()}
        </p>
      ) : null}
    </div>
  )
}
