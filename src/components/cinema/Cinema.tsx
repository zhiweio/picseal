'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import clsx from 'clsx'
import { ArrowLeft, Clapperboard, Download, Film, Music4, Square, Upload } from 'lucide-react'
import type { CinemaScene } from '@/three/cinema/scene'
import type { PlaybackResult, PlaybackStatus } from '@/core/cinema/engine'
import { CinemaEngine, pickRecordingMime, summarizeSpan } from '@/core/cinema/engine'
import { CINEMA_HEIGHT, CINEMA_MIN_PHOTOS, CINEMA_MAX_PHOTOS, CINEMA_WIDTH, coverCropRect, frameAt, sampleEvenly, selectPhotos } from '@/core/cinema/timeline'
import { saveBlob } from '@/lib/delivery'
import { resolveCinemaMedia, saveUserMedia, CINEMA_MEDIA_KEYS, type ResolvedCinemaMedia } from '@/lib/cinema-assets'
import { usePhotos, type PhotoItem } from '@/stores/photos'
import { useSettings } from '@/stores/settings'
import { usePreferences } from '@/stores/preferences'
import { renderMiniPreview } from '@/hooks/usePreview'
import { getRenderPool } from '@/workers/pool'
import { BigCount, Panel, StatusDot, TermButton } from '@/components/ui/primitives'
import { RemoteMediaDialog } from '@/components/ui/RemoteMediaDialog'
import { CreditsDialog } from './CreditsDialog'
import { LangToggle, ThemeToggle } from '@/components/Toggles'
import { PhotoPicker } from './PhotoPicker'

const CinemaStage = dynamic(() => import('./CinemaStage').then((m) => m.CinemaStage), { ssr: false })

type Phase = 'idle' | 'preparing' | 'running' | 'done'

/** 放映室：把工作台照片剪成一部作品集电影（开场素材 + 配乐 + Ken Burns 蒙太奇） */
export function Cinema() {
  const t = useTranslations('cinema')
  const items = usePhotos((s) => s.items)
  const addFiles = usePhotos((s) => s.addFiles)
  /** 工作台横幅模板（全局持久化）：放映室以"水印幻灯片"语义消费 */
  const template = useSettings((s) => s.template)

  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState<PlaybackStatus | null>(null)
  const [result, setResult] = useState<PlaybackResult | null>(null)
  const [media, setMedia] = useState<ResolvedCinemaMedia | null>(null)
  /** 片头/配乐启用开关（preferences store 持久化，默认均启用） */
  const mediaToggles = usePreferences((s) => s.cinemaMedia)
  const toggleMedia = usePreferences((s) => s.toggleCinemaMedia)
  const [pickerOpen, setPickerOpen] = useState(false)
  /** 片单（有序 id 数组：顺序即放映顺序；null = 未手挑） */
  const [picked, setPicked] = useState<string[] | null>(null)
  /** 基准序开关：进放映室时片库已有照片（工作台带来 / 本会话导入过）默认关——
      尊重既有的上传或工作台拖拽顺序；空库起片默认开（拍摄时间正序） */
  const [sortByTime, setSortByTime] = useState(() => usePhotos.getState().items.length === 0)
  /** 更换素材弹窗目标（本地文件 / https 直链合并弹窗；null = 关闭） */
  const [mediaSlot, setMediaSlot] = useState<'intro' | 'music' | null>(null)
  const [creditsOpen, setCreditsOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [webglFailed, setWebglFailed] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const engineRef = useRef<CinemaEngine | null>(null)
  const sceneRef = useRef<CinemaScene | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hasSceneRef = useRef(false)
  const mediaUrlsRef = useRef<string[]>([])
  const endCreditRef = useRef('')
  endCreditRef.current = t('film.endCredit')
  const reducedMotion = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  /* ── 引擎与媒体生命周期 ── */

  useEffect(() => {
    const engine = new CinemaEngine()
    engine.onTick = (s) => {
      setStatus(s)
      // 片头/开场段 photoIndex=-1 不驱动队列（-1 的"谢幕散场"语义只属于
      // onDone/停止——tick 里传会把整条队列在片头就提前散光）
      if (s.photoIndex >= 0) sceneRef.current?.setActiveStrip(s.photoIndex)
    }
    engine.onDone = (res) => {
      sceneRef.current?.setProjecting(false)
      sceneRef.current?.setActiveStrip(-1)
      setPhase('done')
      setStatus(null)
      // 幕面驻留 END 卡（小字署名随语言），不放完就黑屏
      engineRef.current?.drawEndCard(endCreditRef.current)
      sceneRef.current?.markScreenDirty()
      if (res.blob) {
        setResult(res)
        const date = new Date()
        const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
        saveBlob(res.blob, `picseal-projection-${stamp}.${res.ext}`)
      }
    }
    engineRef.current = engine
    // dev-only 验证钩子：帧泵 + 画布像素直读（截图表面/webview 挂起时的人工验收通道）
    if (process.env.NODE_ENV === 'development') {
      let sceneTime: number | null = null
      const debugApi = {
        engine: () => engineRef.current,
        scene: () => sceneRef.current,
        /** 场景归位并进入放映态（跳过卡住的开机仪式） */
        prep: () => {
          const scene = sceneRef.current
          if (!scene) return false
          if ((scene as unknown as { bootPhase: string }).bootPhase !== 'idle') {
            ;(scene as unknown as { finishBoot: (snap: boolean) => void }).finishBoot(true)
          }
          scene.setProjecting(true)
          sceneTime = null
          return true
        },
        /** 按影片时间驱动引擎绘制并推进队列状态机（photoIndex 切换） */
        drive: (t: number) => {
          const engine = engineRef.current
          const timeline = engine?.timelineSnapshot
          if (!engine || !timeline) return null
          const plan = frameAt(timeline, Math.max(0, t))
          ;(engine as unknown as { draw: (t: number, plan: unknown) => void }).draw(t, plan)
          const top = plan.layers[plan.layers.length - 1]
          const index = top && top.seg.kind === 'photo' ? top.seg.index : -1
          sceneRef.current?.setActiveStrip(index)
          return { kind: top?.seg.kind ?? 'none', photoIndex: index, layers: plan.layers.length, fade: plan.fadeToBlack, finished: plan.finished }
        },
        /** 确定性步进场景（n 帧 × 1/60s，独立虚拟时钟） */
        step: (n: number) => {
          const scene = sceneRef.current as unknown as {
            clock: { elapsedTime: number }
            update: (dt: number, time: number) => void
          } | null
          if (!scene) return null
          if (sceneTime === null) sceneTime = scene.clock.elapsedTime
          for (let i = 0; i < Math.max(1, n); i += 1) {
            sceneTime += 1 / 60
            scene.update(1 / 60, sceneTime)
          }
          return sceneTime
        },
        /** 场景帧泵：渲染当前状态并返回画布 dataURL */
        pump: () => {
          const scene = sceneRef.current as unknown as {
            composer: { render: () => void } | null
            renderer: { render: (s: unknown, c: unknown) => void; domElement: HTMLCanvasElement }
            scene: unknown
            camera: unknown
          } | null
          if (!scene) return null
          if (scene.composer) scene.composer.render()
          else scene.renderer.render(scene.scene, scene.camera)
          return scene.renderer.domElement.toDataURL('image/png')
        }
      }
      ;(window as unknown as { __cinemaDebug?: unknown }).__cinemaDebug = debugApi
    }
    void resolveCinemaMedia().then((m) => {
      mediaUrlsRef.current = m.objectUrls
      setMedia(m)
    })
    return () => {
      engine.dispose()
      engineRef.current = null
      for (const url of mediaUrlsRef.current) URL.revokeObjectURL(url)
      mediaUrlsRef.current = []
    }
  }, [])

  /* ── 选取三态与当前片单 ── */

  const selection = useMemo(
    () => selectPhotos(items, { order: sortByTime ? 'captureTime' : 'import' }),
    [items, sortByTime]
  )
  /** 片单实体（保持 picked 的自定义顺序；id 可能在照片被移除后失效，静默过滤） */
  const pickedItems = useMemo(() => {
    if (!picked) return null
    const byId = new Map(items.map((p) => [p.id, p]))
    return picked.map((id) => byId.get(id)).filter((p): p is PhotoItem => Boolean(p))
  }, [items, picked])
  const activeItems = pickedItems ?? selection.selected

  /** 切换基准序：保留已选集合，片单按新基准序重排（不丢用户勾选） */
  const toggleSortByTime = useCallback((v: boolean) => {
    setSortByTime(v)
    setPicked((prev) => {
      if (!prev) return prev
      const keep = new Set(prev)
      const base = selectPhotos(usePhotos.getState().items, { order: v ? 'captureTime' : 'import' }).sorted
      return base.filter((p) => keep.has(p.id)).map((p) => p.id)
    })
  }, [])

  /** 选片器候选序：已有片单时片单在前、未选者按基准序垫底（重开弹窗不丢已排顺序） */
  const pickerBase = useMemo(() => {
    if (!pickedItems || !picked) return selection.sorted
    const pickedSet = new Set(picked)
    return [...pickedItems, ...selection.sorted.filter((p) => !pickedSet.has(p.id))]
  }, [picked, pickedItems, selection])

  const insufficient = selection.status === 'insufficient'
  const over = selection.status === 'over'
  const ready = !insufficient && activeItems.length >= CINEMA_MIN_PHOTOS

  /* ── 队列缩略图：先以原片缩略即时上墙，再逐片换成水印小样（渐进升级） ── */

  const [stripThumbs, setStripThumbs] = useState<Array<{ id: string; url: string }>>([])

  useEffect(() => {
    const base = activeItems
      .map((p) => ({ id: p.id, url: p.thumbUrl ?? '' }))
      .filter((s) => s.url !== '')
    setStripThumbs(base)
    if (base.length === 0 || phase === 'preparing' || phase === 'running') return
    let cancelled = false
    void (async () => {
      for (const photo of activeItems) {
        if (cancelled) return
        try {
          const url = await renderMiniPreview(photo, template)
          if (cancelled || !url) continue
          setStripThumbs((prev) => prev.map((s) => (s.id === photo.id ? { id: s.id, url } : s)))
        } catch {
          /* 单片失败保留原片缩略 */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeItems, template, phase])

  /* ── 受映卡待机海报：首张的水印合成图完整内接（letterbox），失败回退原片封面。
      done 阶段不覆盖——幕面驻留 END 卡 ── */

  useEffect(() => {
    if (activeItems.length === 0 || phase === 'preparing' || phase === 'running' || phase === 'done') return
    const canvas = engineRef.current?.canvas
    const first = activeItems[0]
    if (!canvas || !first) return
    let cancelled = false
    const drawContain = (bmp: ImageBitmap) => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#07090d'
      ctx.fillRect(0, 0, CINEMA_WIDTH, CINEMA_HEIGHT)
      const scale = Math.min(CINEMA_WIDTH / bmp.width, CINEMA_HEIGHT / bmp.height)
      const w = bmp.width * scale
      const h = bmp.height * scale
      ctx.drawImage(bmp, (CINEMA_WIDTH - w) / 2, (CINEMA_HEIGHT - h) / 2, w, h)
    }
    void (async () => {
      try {
        // 水印海报与放映同源：渲染池 preview（与引擎预渲染一致）
        const res = await getRenderPool().run({
          kind: 'preview',
          file: first.file,
          meta: first.meta ?? {},
          template,
          maxLongEdge: CINEMA_WIDTH
        })
        if (cancelled) return
        if (res.ok && res.kind === 'preview') {
          const bmp = await createImageBitmap(res.blob)
          if (cancelled) {
            bmp.close()
            return
          }
          drawContain(bmp)
          bmp.close()
          sceneRef.current?.markScreenDirty()
          return
        }
        throw new Error('watermark poster render failed')
      } catch {
        try {
          const bmp = await createImageBitmap(first.file)
          if (cancelled) {
            bmp.close()
            return
          }
          const ctx = canvas.getContext('2d')
          if (ctx) {
            const crop = coverCropRect(bmp.width, bmp.height, CINEMA_WIDTH, CINEMA_HEIGHT, 1, 0, 0)
            ctx.drawImage(bmp, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, CINEMA_WIDTH, CINEMA_HEIGHT)
          }
          bmp.close()
          sceneRef.current?.markScreenDirty()
        } catch {
          /* 海报失败保持画布原样 */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeItems, phase, template])

  /* ── 放映 / 录制 ── */

  const run = useCallback(
    async (record: boolean) => {
      const engine = engineRef.current
      if (!engine || !media) return
      if (over && !picked) {
        setPickerOpen(true)
        setNotice(t('overLimit', { max: CINEMA_MAX_PHOTOS }))
        return
      }
      setPhase('preparing')
      setResult(null)
      const texts = {
        titleMain: t('film.titleMain'),
        titleSub: t('film.titleSub'),
        titleInfo: summarizeSpan(activeItems),
        outroMain: t('film.outroMain'),
        outroSub: summarizeSpan(activeItems),
        outroCredit: 'PICSEAL PROJECTION ROOM'
      }
      try {
        await engine.prepare(
          activeItems,
          texts,
          {
            introUrl: mediaToggles.intro ? media.introUrl : undefined,
            musicUrl: mediaToggles.music ? media.musicUrl : undefined
          },
          { template }
        )
        sceneRef.current?.setStripSelection(new Set(activeItems.map((p) => p.id)))
        // 谢幕消散后的队列整体重建（显影入场），再进入开机仪式
        sceneRef.current?.resetQueue()
        // 开机仪式：放映机居中 → 启动 → 归位 → 亮灯；resolve 后即刻上片
        await sceneRef.current?.bootProjector()
        sceneRef.current?.setProjecting(true)
        setPhase('running')
        await engine.play(record)
      } catch (error) {
        console.error('[picseal] 放映启动失败', error)
        setPhase('idle')
        sceneRef.current?.setProjecting(false)
      }
    },
    [activeItems, media, mediaToggles, over, picked, t, template]
  )

  const stop = useCallback(async () => {
    setPhase('idle')
    setStatus(null)
    sceneRef.current?.setProjecting(false)
    // 中止 ≠ 谢幕：队列整体复位显影，货架恢复可浏览
    sceneRef.current?.resetQueue()
    await engineRef.current?.stop(false)
  }, [])

  /* ── 上传 / 导入 ── */

  const onUpload = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return
      void addFiles(Array.from(files))
    },
    [addFiles]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      onUpload(e.dataTransfer.files)
    },
    [onUpload]
  )

  /** 落盘 → 重新解析素材 → 上状态；失败上抛（弹窗靠它内联报错），成功出「素材已载入」提示 */
  const importMediaStrict = useCallback(
    async (key: string, blob: Blob) => {
      await saveUserMedia(key, blob)
      for (const url of mediaUrlsRef.current) URL.revokeObjectURL(url)
      const next = await resolveCinemaMedia()
      mediaUrlsRef.current = next.objectUrls
      setMedia(next)
      setNotice(t('media.loaded'))
    },
    [t]
  )

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4200)
    return () => window.clearTimeout(timer)
  }, [notice])

  const onSceneReady = useCallback((scene: CinemaScene | null) => {
    if (scene) {
      hasSceneRef.current = true
      setWebglFailed(false)
    } else if (!hasSceneRef.current) {
      setWebglFailed(true)
    }
    sceneRef.current = scene
  }, [])

  const recordingFormat = useMemo(() => {
    if (typeof MediaRecorder === 'undefined') return { mime: '', ext: 'webm' as const }
    return pickRecordingMime()
  }, [])

  const busy = phase === 'preparing' || phase === 'running'

  return (
    <div
      className="flex h-dvh flex-col bg-page"
      onDragOver={(e) => {
        if (items.length === 0) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {/* 顶栏 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <div className="flex items-baseline gap-3">
          <Link
            href="/studio"
            className="flex h-[26px] items-center gap-1.5 border border-line px-2 text-[11px] tracking-[1px] text-muted transition-colors hover:border-ink hover:text-ink"
          >
            <ArrowLeft size={12} />
            {t('back')}
          </Link>
          <span className="text-[15px] font-bold tracking-[3px]">PICSEAL</span>
          <span className="hud-label hidden sm:inline">
            {t('title')} / {t('titleEn')}
          </span>
        </div>
        <div className="flex items-center gap-5">
          <BigCount value={activeItems.length} label="REELS" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LangToggle />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 放映厅舞台 */}
        <main className="relative min-w-0 flex-1">
          {items.length === 0 ? (
            <div
              className={clsx(
                'absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 transition-colors',
                dragOver && 'bg-accent/5'
              )}
            >
              <Film size={28} className="text-muted" strokeWidth={1.25} />
              <div className="text-center">
                <p className="text-[17px] font-semibold">{t('empty.title')}</p>
                <p className="mt-2 max-w-[400px] px-6 text-[12px] leading-relaxed text-muted">
                  {t('empty.hint', { min: CINEMA_MIN_PHOTOS })}
                </p>
              </div>
              <TermButton variant="solid" className="h-9 px-4" onClick={() => fileInputRef.current?.click()}>
                <Upload size={13} />
                {t('empty.pick')}
              </TermButton>
              <p className="hud-label text-muted">{t('empty.drop')}</p>
            </div>
          ) : (
            <CinemaStage
              screenCanvas={engineRef.current?.canvas ?? null}
              stripThumbs={stripThumbs}
              status={status}
              webglFailed={webglFailed}
              onSceneReady={onSceneReady}
              reducedMotion={reducedMotion.current}
            />
          )}

          {notice ? (
            <div className="absolute bottom-6 left-1/2 z-40 -translate-x-1/2 border border-line bg-panel px-4 py-2 text-[11px] text-ink" style={{ boxShadow: 'var(--shadow-pop)' }}>
              {notice}
            </div>
          ) : null}
        </main>

        {/* 控制列 */}
        <aside className="hidden w-[320px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface/40 md:flex">
          <Panel label={t('projection.label')} labelEn={t('projection.labelEn')}>
            <div className="mb-3 flex items-center justify-between text-[12px]">
              <span className="flex items-center gap-2">
                <StatusDot state={busy ? 'work' : ready ? 'ok' : 'idle'} />
                <span className="text-muted">{t('projection.frames', { count: activeItems.length })}</span>
              </span>
              {insufficient ? (
                <span className="text-[11px] text-accent">
                  {t('needMore', { count: selection.missing })}
                </span>
              ) : null}
            </div>

            {insufficient ? (
              <p className="border border-line px-3 py-2.5 text-[11px] leading-relaxed text-muted">
                {t('needMoreLong', { count: selection.missing })}
                <span className="mt-1 block hud-label">{t('needMoreEn')}</span>
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <TermButton variant="ghost" disabled={!ready || busy} onClick={() => void run(false)}>
                  <Clapperboard size={13} />
                  {t('preview')}
                </TermButton>
                <TermButton variant="solid" disabled={!ready || busy} onClick={() => void run(true)}>
                  <Download size={13} />
                  {t('record')}
                </TermButton>
                {busy ? (
                  <TermButton variant="line" onClick={() => void stop()}>
                    <Square size={11} />
                    {t('stop')}
                  </TermButton>
                ) : null}
                {phase === 'running' && status?.recording ? (
                  <p className="text-[11px] leading-relaxed text-muted">{t('recording')}</p>
                ) : null}
              </div>
            )}

            {result?.blob ? (
              <div className="mt-3 border border-line p-3">
                <p className="hud-label mb-1.5">{t('done')}</p>
                <p className="text-[11px] tabular-nums text-muted">
                  {(result.blob.size / 1024 / 1024).toFixed(1)} MB · {result.ext.toUpperCase()} · 1920×1080
                </p>
                <TermButton
                  variant="ghost"
                  className="mt-2 w-full"
                  onClick={() => {
                    const date = new Date()
                    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
                    saveBlob(result.blob!, `picseal-projection-${stamp}.${result.ext}`)
                  }}
                >
                  <Download size={12} />
                  {t('downloadAgain')}
                </TermButton>
                {result.ext === 'webm' ? (
                  <p className="mt-2 text-[10px] leading-relaxed text-muted">{t('formatNote')}</p>
                ) : null}
              </div>
            ) : null}
          </Panel>

          <Panel label={t('reel.label')} labelEn={t('reel.labelEn')}>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span>{t('reel.count', { count: items.length })}</span>
                <span className="tabular-nums">
                  {CINEMA_MIN_PHOTOS}-{CINEMA_MAX_PHOTOS}
                </span>
              </div>
              <TermButton
                variant="ghost"
                disabled={items.length === 0 || busy}
                onClick={() => setPickerOpen(true)}
              >
                <Film size={13} />
                {t('pick')}
              </TermButton>
              {over ? <p className="text-[11px] leading-relaxed text-muted">{t('overLimit', { max: CINEMA_MAX_PHOTOS })}</p> : null}
              {picked ? (
                <TermButton variant="line" disabled={busy} onClick={() => setPicked(null)}>
                  {t('reel.reset')}
                </TermButton>
              ) : null}
            </div>
          </Panel>

          <Panel label={t('media.label')} labelEn={t('media.labelEn')}>
            <div className="flex flex-col gap-2.5 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-2">
                  <StatusDot state={media?.introUrl && mediaToggles.intro ? 'ok' : 'idle'} />
                  <span className={clsx('truncate', media?.introUrl && mediaToggles.intro ? 'text-ink' : 'text-muted')}>
                    {!mediaToggles.intro
                      ? t('media.introDisabled')
                      : media?.introUrl
                        ? t('media.introReady')
                        : t('media.introMissing')}
                  </span>
                </p>
                <MediaSwitch on={mediaToggles.intro} onToggle={() => toggleMedia('intro')} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-2">
                  <StatusDot state={media && mediaToggles.music ? 'ok' : 'idle'} />
                  <span className={clsx('truncate', media && mediaToggles.music ? 'text-ink' : 'text-muted')}>
                    {!mediaToggles.music
                      ? t('media.musicDisabled')
                      : media?.musicFallback
                        ? t('media.musicFallback')
                        : t('media.musicMain')}
                  </span>
                </p>
                <MediaSwitch on={mediaToggles.music} onToggle={() => toggleMedia('music')} />
              </div>
              {/* 更换素材：与 landing 更换背景音乐一致 —— 点击开合并弹窗（本地文件 / https 直链，校验失败内联提示） */}
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setMediaSlot('intro')}
                  className="flex h-8 flex-1 items-center justify-center gap-1.5 border border-line text-[11px] text-muted transition-colors hover:border-ink hover:text-ink"
                >
                  <Upload size={11} />
                  {t('media.loadIntro')}
                </button>
                <button
                  type="button"
                  onClick={() => setMediaSlot('music')}
                  className="flex h-8 flex-1 items-center justify-center gap-1.5 border border-line text-[11px] text-muted transition-colors hover:border-ink hover:text-ink"
                >
                  <Music4 size={11} />
                  {t('media.loadMusic')}
                </button>
              </div>
              <p className="text-[10px] leading-relaxed text-muted">
                {t('media.creditNote')}{' '}
                <button
                  type="button"
                  onClick={() => setCreditsOpen(true)}
                  className="underline underline-offset-2 transition-colors hover:text-ink"
                >
                  {t('media.credit')}
                </button>
              </p>
            </div>
          </Panel>
        </aside>
      </div>

      {/* 移动端控制条（md 以下控制列隐藏，保留核心动作） */}
      {items.length > 0 ? (
        <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-2 md:hidden">
          <span className="flex items-center gap-2 text-[11px] text-muted">
            <StatusDot state={busy ? 'work' : ready ? 'ok' : 'idle'} />
            {t('projection.frames', { count: activeItems.length })}
          </span>
          <TermButton variant="solid" disabled={!ready || busy} onClick={() => void run(true)}>
            <Download size={12} />
            {t('record')}
          </TermButton>
        </footer>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,image/tiff"
        multiple
        hidden
        onChange={(e) => onUpload(e.target.files)}
      />

      <PhotoPicker
        key={pickerOpen ? 'open' : 'closed'}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        items={pickerBase}
        preselected={
          picked
            ? new Set(picked)
            : new Set((over ? sampleEvenly(selection.sorted, CINEMA_MAX_PHOTOS) : selection.sorted).map((p) => p.id))
        }
        sortByTime={sortByTime}
        onToggleSortByTime={toggleSortByTime}
        onCustomized={() => setSortByTime(false)}
        onConfirm={(ids) => {
          setPicked(ids)
          setPickerOpen(false)
        }}
      />

      {/* 更换素材弹窗（开场视频 / 配乐共用：本地文件 + https 网络直链，错误内联提示） */}
      <RemoteMediaDialog
        key={mediaSlot ?? 'media-closed'}
        open={mediaSlot !== null}
        kind={mediaSlot === 'music' ? 'audio' : 'video'}
        title={mediaSlot === 'music' ? t('media.dialogMusicTitle') : t('media.dialogIntroTitle')}
        titleEn={mediaSlot === 'music' ? t('media.dialogMusicTitleEn') : t('media.dialogIntroTitleEn')}
        onClose={() => setMediaSlot(null)}
        onImported={(blob) =>
          importMediaStrict(mediaSlot === 'music' ? CINEMA_MEDIA_KEYS.music : CINEMA_MEDIA_KEYS.intro, blob)
        }
        localFile={{
          accept: mediaSlot === 'music' ? 'audio/*' : 'video/mp4,video/quicktime',
          label: mediaSlot === 'music' ? t('media.localMusicPick') : t('media.localIntroPick'),
          onPick: (file) =>
            importMediaStrict(mediaSlot === 'music' ? CINEMA_MEDIA_KEYS.music : CINEMA_MEDIA_KEYS.intro, file)
        }}
      />

      {/* 版权说明预览（站内渲染 markdown，取代新开裸链接） */}
      <CreditsDialog open={creditsOpen} onClose={() => setCreditsOpen(false)} />
    </div>
  )
}

/** 素材启用开关：显示当前状态，点击切换（开/关） */
function MediaSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const t = useTranslations('cinema')
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={clsx(
        'shrink-0 border px-1.5 py-0.5 text-[10px] tracking-[1px] transition-colors',
        on ? 'border-ink/50 text-ink hover:border-ink' : 'border-line text-muted hover:text-ink'
      )}
    >
      {on ? t('media.on') : t('media.off')}
    </button>
  )
}
