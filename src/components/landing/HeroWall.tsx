'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { RemoteMediaDialog } from '@/components/ui/RemoteMediaDialog'
import { usePreferences } from '@/stores/preferences'
import { readPhotoMeta, formatParams, formatDate } from '@/core/exif/reader'
import { BUILTIN_TEMPLATES } from '@/core/templates/builtin'
import { matchBrand } from '@/core/brands'
import { sortByCaptureTime } from '@/core/order'
import { ArchiveEntry } from '@/components/landing/ArchiveEntry'
import { ArchiveIntakeModal } from '@/components/landing/ArchiveIntakeModal'
import { getRenderPool } from '@/workers/pool'
import type { PhotoMeta } from '@/core/types'
import { PORTFOLIO_WALL_CAP } from '@/lib/portfolio'
import { usePortfolio, type PortfolioItem } from '@/stores/portfolio'

/** 内置兜底样片；若 public/samples/manifest.json 存在则优先使用采集样片库 */
const FALLBACK_SAMPLES = [
  'sony', 'canon', 'nikon', 'fujifilm', 'leica', 'xiaomi', 'apple',
  'huawei', 'panasonic', 'olympus', 'ricoh', 'dji', 'insta360'
] as const

/** 墙面格位上限（9 lanes × 48 rows） */
const WALL_CAPACITY = 432

/** HUD 扫描线所在的卡面 z（印刷面前沿） */
const SCAN_Z = CARD.depth / 2 + 0.03

/** 详情卡等待元数据的上限：超时后允许占位内容上屏（弱网/解析失败兜底） */
const PANEL_META_GRACE_MS = 600

/** 元数据预取去重（进行中）与失败负缓存：404 样片不随 metaMap 更新被反复拉取 */
const metaInFlight = new Map<string, Promise<PhotoMeta | null>>()
const metaFailed = new Set<string>()

async function fetchMeta(item: WallItem): Promise<PhotoMeta | null> {
  if (item.kind === 'portfolio') {
    if (!item.file) {
      // 恢复会话无原片句柄，直接进负缓存避免被反复重取
      metaFailed.add(item.id)
      return null
    }
    try {
      return await readPhotoMeta(item.file)
    } catch {
      metaFailed.add(item.id)
      return null
    }
  }
  if (metaFailed.has(item.id)) return null
  let pending = metaInFlight.get(item.id)
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch(item.url)
        if (!res.ok) throw new Error(String(res.status))
        return await readPhotoMeta(await res.blob())
      } catch {
        metaFailed.add(item.id)
        return null
      }
    })()
    metaInFlight.set(item.id, pending)
    void pending.finally(() => metaInFlight.delete(item.id)).catch(() => undefined)
  }
  return pending
}

const SVG_NS = 'http://www.w3.org/2000/svg'

interface SampleEntry {
  id: string
  file: string
}

/** 墙面显示项：样片走 URL，作品集走缩略图 blob URL（file 仅会话内存在） */
interface WallItem {
  id: string
  name: string
  url: string
  file?: File
  kind: 'sample' | 'portfolio'
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

  const [sampleList, setSampleList] = useState<SampleEntry[]>([])
  /** 档案征集弹窗开关（个人档案馆入口） */
  const [archiveOpen, setArchiveOpen] = useState(false)
  /** 入馆版本号：>0 表示档案墙以用户作品为源（store 内保证满门槛才会递增） */
  const portfolioCommitted = usePortfolio((s) => s.committedVersion)
  const [metaMap, setMetaMap] = useState<Map<string, PhotoMeta>>(new Map())
  const [selected, setSelected] = useState<number | null>(null)
  /** 悬停卡（桌面端提前预取详情卡元数据，让面板打开即完整） */
  const [hovered, setHovered] = useState<number | null>(null)
  /** 自选中起是否已过元数据宽限期（定时器只随 selected 重启，metaMap 高频更新不打断） */
  const [metaGraceElapsed, setMetaGraceElapsed] = useState(false)
  /** 详情卡已放行上屏；一旦打开保持到退出检视（快切不回退成空面板） */
  const [panelOpen, setPanelOpen] = useState(false)
  const [browsed, setBrowsed] = useState(0)
  const [musicOn, setMusicOn] = useState(false)
  const [hasUserTrack, setHasUserTrack] = useState(false)
  const [bgmOpen, setBgmOpen] = useState(false)
  const [webglFailed, setWebglFailed] = useState(false)

  /** 水印成品（itemIndex → blob URL）：实演循环与焦点预取共同填充 */
  const sealUrlsRef = useRef<Map<number, string>>(new Map())
  /** 当前检视会话是否已盖章（玻璃揭示完成时置位） */
  const sealedRef = useRef(false)
  const selectedRef = useRef<number | null>(null)
  /** 最近一次元数据就绪的检视内容（快切时暂留上屏，防占位闪跳） */
  const lastReadyRef = useRef<{ index: number; entry: WallItem; meta: PhotoMeta } | null>(null)

  /* ── 样片清单（仅 manifest，秒级） ── */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await loadSampleList()
      if (!cancelled && list.length > 0) setSampleList(list)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /* ── 档案馆恢复：IndexedDB 缩略图（与样片清单并行；已入馆则晚到后重建墙面） ── */
  useEffect(() => {
    void usePortfolio.getState().hydrate()
  }, [])

  const openArchive = useCallback(() => setArchiveOpen(true), [])
  const closeArchive = useCallback(() => setArchiveOpen(false), [])

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

  /* ── 已入馆判定与墙面显示清单：入馆后取作品集缩略图，否则样片。
     档案墙按 EXIF 拍摄时间正序陈列（无时间者按收录序沉底）；入馆提交等
     元数据流水线清零才落版本号，排序时 meta 已就绪。
     依赖刻意收窄：录入中的 items 变化不重建，重新入馆（版本号递增）才生效 ── */
  const admitted = portfolioCommitted > 0
  const wallKey = admitted ? `portfolio:${portfolioCommitted}` : 'samples'
  const wallItems: WallItem[] = useMemo(() => {
    if (admitted) {
      return sortByCaptureTime(usePortfolio.getState().items)
        .slice(0, PORTFOLIO_WALL_CAP)
        .filter((i): i is PortfolioItem & { thumbUrl: string } => Boolean(i.thumbUrl))
        .map((i) => ({ id: i.id, name: i.name, url: i.thumbUrl, file: i.file, kind: 'portfolio' }))
    }
    return sampleList.map((e) => ({
      id: e.id,
      name: e.file,
      url: `/samples/${e.file}`,
      kind: 'sample'
    }))
  }, [admitted, portfolioCommitted, sampleList]) // eslint-disable-line react-hooks/exhaustive-deps
  const hasWall = wallItems.length > 0

  /* ── 详情卡过渡 + 文字墨条：mount 一次，不随墙面换源重建 ── */
  useEffect(() => {
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
      transitionRef.current = null
    }
  }, [])

  /* ── 场景构建（按 wallKey 换源重建：样片 ↔ 用户作品，入场揭示随重建重放） ── */
  useEffect(() => {
    const container = containerRef.current
    if (!container || !hasWall) return
    // 旧场景先退场：撤销未消费的盖章成品、释放 WebGL 资源
    for (const url of sealUrlsRef.current.values()) URL.revokeObjectURL(url)
    sealUrlsRef.current.clear()
    sceneRef.current?.dispose()
    sceneRef.current = null
    setSelected(null)
    selectedRef.current = null
    sealedRef.current = false
    setPanelOpen(false)
    lastReadyRef.current = null
    setMetaMap(new Map())

    const scene = new ArchiveWallScene({
      container,
      items: wallItems.map((w) => ({ id: w.id, url: w.url })),
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      theme: ((document.documentElement.dataset.theme as 'night' | 'day') ?? 'night'),
      quality: window.innerWidth < 900 || window.innerWidth * window.devicePixelRatio > 3200 ? 'performance' : 'high',
      onSelect: (index) => {
        setSelected(index)
        selectedRef.current = index
        if (index !== null) sealedRef.current = false
      },
      onSelection: (index) => setBrowsed(index),
      onHover: (index) => setHovered(index),
      onDecryption: applyHud
    })
    // WebGL 上下文创建失败（无 GPU/被禁用）时优雅降级为静态 hero，不炸整页
    if (!scene.usable) {
      scene.dispose()
      setWebglFailed(true)
      return
    }
    setWebglFailed(false)
    sceneRef.current = scene

    return () => {
      scene.dispose()
      if (sceneRef.current === scene) sceneRef.current = null
    }
  }, [wallKey, hasWall, applyHud]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 元数据宽限：自选中起计时，只随 selected 重启（水印循环的高频 metaMap
     更新不得清掉重排定时器，否则慢加载卡的面板永远等不到放行）；
     退出检视同步清零，避免下次打开吃到上一次的残留宽限 ── */
  useEffect(() => {
    if (selected === null) {
      setMetaGraceElapsed(false)
      return
    }
    setMetaGraceElapsed(false)
    const id = window.setTimeout(() => setMetaGraceElapsed(true), PANEL_META_GRACE_MS)
    return () => window.clearTimeout(id)
  }, [selected])

  /* ── 面板闸：元数据就绪或宽限过后才放行上屏（占位文本不再先跳出来）；
     打开后保持到退出检视，检视间快切不回退成空面板 ── */
  useEffect(() => {
    if (selected === null) {
      setPanelOpen(false)
      return
    }
    if (panelOpen) return
    const item = wallItems[selected]
    if (!item) return
    if (metaMap.has(item.id) || metaGraceElapsed) setPanelOpen(true)
  }, [selected, wallItems, metaMap, metaGraceElapsed, panelOpen])

  /* ── 面板入场/退场跟随闸：show 推迟到内容完整时，空面板不再滑入 ── */
  useEffect(() => {
    if (selected === null) transitionRef.current?.hide()
    else if (panelOpen) transitionRef.current?.show()
  }, [selected, panelOpen])

  /* ── 详情卡文字：面板入场即快速擦除墨条（不等玻璃揭示，文字几乎立即可读） ── */
  useEffect(() => {
    if (selected === null || !panelOpen) {
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
  }, [selected, panelOpen])

  /* ── 水印实渲 → 原位升级墙面纹理；顺带缓存 EXIF（详情卡懒加载秒开）。
     样片走 URL 取图；作品集走会话内原片句柄（恢复会话无原片，保留缩略图纹理） ── */
  useEffect(() => {
    if (!hasWall || !sceneRef.current) return
    let cancelled = false
    const metas = new Map(metaMap)
    void (async () => {
      const pool = getRenderPool()
      const template = {
        ...BUILTIN_TEMPLATES[0]!,
        typography: { ...BUILTIN_TEMPLATES[0]!.typography, scale: 1.35 }
      }
      for (const [index, item] of wallItems.entries()) {
        if (cancelled || !sceneRef.current) return
        try {
          let blob: Blob
          let meta = metas.get(item.id)
          if (item.kind === 'sample') {
            const res = await fetch(item.url)
            blob = await res.blob()
            meta = await readPhotoMeta(blob)
          } else if (item.file) {
            blob = item.file
            if (!meta) meta = await readPhotoMeta(item.file)
          } else {
            continue
          }
          if (cancelled) return
          if (meta && !metas.has(item.id)) {
            metas.set(item.id, meta)
            setMetaMap(new Map(metas))
          }
          const rendered = await pool.run({
            kind: 'preview',
            file: blob instanceof File ? blob : new File([blob], item.name, { type: 'image/jpeg' }),
            meta: meta ?? ({} as PhotoMeta),
            template,
            maxLongEdge: 1024
          })
          if (cancelled) return
          if (rendered.ok && rendered.kind === 'preview') {
            // 一渲两用：墙面图集升级 + 检视盖章的水印成品缓存
            const sealUrl = URL.createObjectURL(rendered.blob)
            sealUrlsRef.current.set(index, sealUrl)
            sceneRef.current.upgradeItem(index, sealUrl)
          }
        } catch {
          /* 单张失败保留原图 */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [wallKey, hasWall]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 焦点/悬停卡元数据预取（未命中缓存时）：悬停即取，详情卡打开时多半已就绪；
     404/解析失败的样片进负缓存，不随 metaMap 更新被反复拉取 ── */
  useEffect(() => {
    const indices = [...new Set([browsed, hovered].filter((i): i is number => i !== null))]
    const pending = indices.filter((i) => {
      const item = wallItems[i]
      return item && !metaMap.has(item.id) && !metaFailed.has(item.id)
    })
    if (pending.length === 0) return
    let cancelled = false
    void (async () => {
      for (const index of pending) {
        if (cancelled) return
        const item = wallItems[index]
        if (!item) continue
        const meta = await fetchMeta(item)
        if (!meta || cancelled) continue
        setMetaMap((prev) => (prev.has(item.id) ? prev : new Map(prev).set(item.id, meta)))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [browsed, hovered, wallKey, hasWall, metaMap]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 焦点卡水印成品即时预取（盖章用；实演循环按序渲染太慢，等不到当前卡） ── */
  useEffect(() => {
    const index = browsed
    const item = wallItems[index]
    if (!item || !sceneRef.current || sealUrlsRef.current.has(index)) return
    const meta = metaMap.get(item.id)
    if (!meta) return
    let cancelled = false
    void (async () => {
      try {
        let blob: Blob
        if (item.kind === 'sample') {
          const res = await fetch(item.url)
          blob = await res.blob()
        } else if (item.file) {
          blob = item.file
        } else {
          return
        }
        const pool = getRenderPool()
        const template = {
          ...BUILTIN_TEMPLATES[0]!,
          typography: { ...BUILTIN_TEMPLATES[0]!.typography, scale: 1.35 }
        }
        const rendered = await pool.run({
          kind: 'preview',
          file: blob instanceof File ? blob : new File([blob], item.name, { type: 'image/jpeg' }),
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
  }, [browsed, wallKey, hasWall, metaMap]) // eslint-disable-line react-hooks/exhaustive-deps

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
      usePreferences.getState().setMusicPref(playing)
      return playing
    } catch {
      return false
    }
  }, [])

  // 默认开启：首个手势（滚轮/点击/按键）自动起播（浏览器自动播放策略）
  useEffect(() => {
    let armed = true
    if (!usePreferences.getState().musicPref) {
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

  /** 本地文件 / 网络链接共用：落盘 IndexedDB + 立即接管播放；落盘失败上抛给弹窗内联提示 */
  const applyUserTrack = async (blob: Blob): Promise<void> => {
    await saveUserTrack(blob).catch(() => {
      throw new Error(t('mediaUrl.error.saveFailed'))
    })
    setHasUserTrack(true)
    if (engineRef.current) {
      await engineRef.current.setTrack(blob)
      if (!engineRef.current.playing) await startMusic()
    }
  }

  const selectedItem = selected !== null ? wallItems[selected] : undefined
  const selectedMeta = selectedItem ? metaMap.get(selectedItem.id) : undefined

  /* ── 检视间快切保持：新卡元数据未到（且未过宽限）时沿用上一张就绪内容，
     避免占位文本闪现与高度跳变；元数据到达后随墨条重扫一次性换新 ── */
  useEffect(() => {
    if (selected === null) {
      lastReadyRef.current = null
      return
    }
    if (selectedItem && selectedMeta)
      lastReadyRef.current = { index: selected, entry: selectedItem, meta: selectedMeta }
  }, [selected, selectedItem, selectedMeta])

  const holdReady =
    selectedItem && !selectedMeta && !metaGraceElapsed ? lastReadyRef.current : null
  const shownEntry = (selectedMeta ? selectedItem : holdReady?.entry) ?? selectedItem
  const shownMeta = selectedMeta ?? holdReady?.meta
  const shownIndex = selectedMeta ? selected : (holdReady?.index ?? selected)
  const brand = shownMeta ? matchBrand(shownMeta.make, shownMeta.model) : undefined

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
      {/* 个人档案馆入口：作品集批量上传，满门槛入馆换墙（镜像放映室入口形态，accent 暖金） */}
      <ArchiveEntry onOpen={openArchive} />
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
          title={t(hasUserTrack ? 'landing.bgm.sourceUser' : 'landing.bgm.sourceDefault')}
        >
          {musicOn ? <Volume2 size={12} className="text-accent" /> : <VolumeX size={12} />}
          {musicOn ? 'ON' : 'OFF'}
        </button>
        {/* 更换音源：合并弹窗（本地文件 / https 网络直链，校验失败内联提示） */}
        <button
          type="button"
          onClick={() => setBgmOpen(true)}
          className="flex min-h-[44px] items-center gap-1.5 border border-line bg-panel/80 px-2.5 text-[10px] tracking-[1px] text-muted backdrop-blur-sm transition-colors hover:border-ink hover:text-ink"
          title={t('landing.bgm.buttonHint')}
        >
          <Music4 size={12} />
          <Upload size={10} />
        </button>
      </div>

      {/* 详情档案卡：桌面右侧竖排，竖屏/紧凑为底部面板（跟随 data-layout）。
          面板闸放行（panelOpen）才上屏：元数据未到时面板整体延后，而非占位先跳 */}
      <div className="wall-detail-anchor pointer-events-none z-20">
        <div ref={calloutRef} className="pointer-events-auto" style={{ visibility: 'hidden' }}>
          {shownEntry && panelOpen ? (
            <div className="detail-panel border border-line bg-panel p-4" style={{ boxShadow: 'var(--shadow-pop)' }}>
              <div className="rule-heavy flex items-baseline justify-between pb-2">
                <span data-doc className="text-[11px] tracking-[2px] text-muted">
                  FRAME {String((shownIndex ?? 0) + 1).padStart(3, '0')}
                </span>
                <span data-doc className="text-[11px] text-muted">
                  {brand?.name ?? shownMeta?.make ?? ''}
                </span>
              </div>
              {shownMeta?.modelPretty ? (
                <p data-doc className="mt-2 text-[16px] font-semibold">
                  {shownMeta.modelPretty}
                </p>
              ) : null}
              <p data-doc className="mt-0.5 text-[12px] tabular-nums text-muted">
                {[
                  shownMeta ? formatParams(shownMeta) : undefined,
                  shownMeta?.dateTimeOriginal
                    ? formatDate(shownMeta.dateTimeOriginal)
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

      {!(selectedItem && panelOpen) ? (
        <p className="pointer-events-none absolute bottom-[calc(env(safe-area-inset-bottom,0px)+18px)] left-1/2 z-20 -translate-x-1/2 text-center text-[11px] tracking-[2px] text-muted">
          {t('landing.browsableHint').toUpperCase()}
        </p>
      ) : null}

      {/* 档案征集弹窗：作品集批量上传（文件夹 / 多选 / 拖拽），满 120 张入馆换墙 */}
      <ArchiveIntakeModal open={archiveOpen} onClose={closeArchive} />

      {/* 更换背景音乐弹窗：本地文件 + https 网络音源（校验失败在弹窗内联提示） */}
      <RemoteMediaDialog
        key={bgmOpen ? 'bgm-open' : 'bgm-closed'}
        open={bgmOpen}
        kind="audio"
        title={t('landing.bgm.title')}
        titleEn={t('landing.bgm.titleEn')}
        onClose={() => setBgmOpen(false)}
        onImported={applyUserTrack}
        localFile={{
          accept: 'audio/*',
          label: t('landing.bgm.localPick'),
          onPick: (file) => applyUserTrack(file)
        }}
      />
    </div>
  )
}
