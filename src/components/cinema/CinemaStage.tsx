'use client'

import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import type { CinemaScene } from '@/three/cinema/scene'

export interface CinemaHudStatus {
  t: number
  duration: number
  recording: boolean
  photoIndex: number
}

/**
 * 放映厅 3D 舞台：three 场景挂载 + 光圈开合入场 + 取景器 HUD
 * （对焦角标 / REC 红点 / timecode / 进度规则线）。
 */
export function CinemaStage({
  screenCanvas,
  stripThumbs,
  status,
  webglFailed,
  onSceneReady,
  onStripClick,
  reducedMotion
}: {
  screenCanvas: HTMLCanvasElement | null
  stripThumbs: Array<{ id: string; url: string }>
  status: CinemaHudStatus | null
  webglFailed: boolean
  onSceneReady: (scene: CinemaScene | null) => void
  onStripClick?: (index: number) => void
  reducedMotion: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CinemaScene | null>(null)
  const latestThumbsRef = useRef(stripThumbs)

  useEffect(() => {
    if (!containerRef.current || !screenCanvas || sceneRef.current) return
    let scene: CinemaScene | null = null
    void (async () => {
      const { CinemaScene: Scene } = await import('@/three/cinema/scene')
      if (!containerRef.current) return
      scene = new Scene({
        container: containerRef.current,
        screenCanvas,
        stripThumbs: [],
        theme: ((document.documentElement.dataset.theme as 'night' | 'day') ?? 'night'),
        quality: window.innerWidth < 900 || window.devicePixelRatio > 2.4 ? 'performance' : 'high',
        reducedMotion,
        onStripClick
      })
      if (!scene.usable) {
        scene.dispose()
        scene = null
        onSceneReady(null)
        return
      }
      sceneRef.current = scene
      onSceneReady(scene)
      // 场景就绪前缩略图可能已到达（竞态兜底）
      scene.setStripThumbs(latestThumbsRef.current)
    })()

    const themeObserver = new MutationObserver(() => {
      const theme = (document.documentElement.dataset.theme as 'night' | 'day') ?? 'night'
      sceneRef.current?.setTheme(theme, true)
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      themeObserver.disconnect()
      sceneRef.current?.dispose()
      sceneRef.current = null
      onSceneReady(null)
    }
    // 场景只建一次（避免 WebGL 上下文重建风暴）；胶片帧经 setStripThumbs 增量更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenCanvas])

  // 缩略图由照片流水线异步逐张产出 → 防抖合并后只重建条带组
  useEffect(() => {
    latestThumbsRef.current = stripThumbs
    const timer = window.setTimeout(() => sceneRef.current?.setStripThumbs(stripThumbs), 300)
    return () => window.clearTimeout(timer)
  }, [stripThumbs])

  const progress = status && status.duration > 0 ? Math.min(1, status.t / status.duration) : 0
  const timecode = formatTimecode(status?.t ?? 0)
  const frames = stripThumbs.length

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[#04060b]">
      {/* 光圈开合入场（相机取景 × 放映厅） */}
      <div className="iris-shutter pointer-events-none absolute inset-0 z-30" aria-hidden />

      {webglFailed ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
          <p className="text-[13px] tracking-[3px] text-muted">PICSEAL PROJECTION</p>
          <p className="max-w-[380px] px-6 text-center text-[12px] leading-relaxed text-muted">
            WebGL 不可用 · 幕面以平面模式放映
          </p>
        </div>
      ) : null}

      {/* 取景器 HUD */}
      <div className="pointer-events-none absolute inset-0 z-20">
        <FocusBracket className="left-5 top-5 border-l border-t" />
        <FocusBracket className="right-5 top-5 border-r border-t" />
        <FocusBracket className="bottom-5 left-5 border-b border-l" />
        <FocusBracket className="bottom-5 right-5 border-b border-r" />

        <div className="absolute left-12 top-6 flex items-center gap-3">
          <span className={clsx('status-dot', status ? 'work' : undefined)} />
          <span className="hud-label text-[#e9eef2]/70">PROJECTION / 放映</span>
        </div>

        <div className="absolute right-12 top-6 flex items-center gap-2 text-[11px] tabular-nums tracking-[1px] text-[#e9eef2]/80">
          {status?.recording ? (
            <>
              <span className="h-2 w-2 animate-pulse rounded-none bg-nikon" />
              <span className="text-nikon">REC</span>
            </>
          ) : status ? (
            <>
              <span className="h-2 w-2 bg-[#e9eef2]/60" />
              <span>PLAY</span>
            </>
          ) : (
            <span className="text-[#e9eef2]/50">STANDBY</span>
          )}
          <span>{timecode}</span>
        </div>

        <div className="absolute bottom-6 left-12 right-12 flex items-center gap-4">
          <div className="h-[1px] flex-1 bg-[#e9eef2]/15">
            <div
              className="h-full bg-nikon transition-[width] duration-300"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums tracking-[1px] text-[#e9eef2]/50">
            {frames > 0 && status && status.photoIndex >= 0
              ? `FRAME ${String(status.photoIndex + 1).padStart(3, '0')}/${String(frames).padStart(3, '0')}`
              : `${frames} FRAMES`}
          </span>
        </div>
      </div>
    </div>
  )
}

function FocusBracket({ className }: { className: string }) {
  return <span className={clsx('absolute h-6 w-6 border-[#e9eef2]/40', className)} aria-hidden />
}

function formatTimecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}
