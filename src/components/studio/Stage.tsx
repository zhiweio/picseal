'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import clsx from 'clsx'
import { usePhotos } from '@/stores/photos'
import { useSettings } from '@/stores/settings'
import { usePreview } from '@/hooks/usePreview'
import { abOverlayStyle } from '@/lib/ab-overlay'
import { formatDate } from '@/core/exif/reader'

/** 中央画布舞台：预览 + 对焦框角标 + A/B 对比滑块 + 缩放平移 */
export function Stage() {
  const t = useTranslations()
  const items = usePhotos((s) => s.items)
  const currentId = usePhotos((s) => s.currentId)
  const photo = items.find((p) => p.id === currentId)
  const template = useSettings((s) => s.template)

  const { preview, rendering, invalidate } = usePreview(photo, template)
  const [compare, setCompare] = useState(55)
  const [comparing, setComparing] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)

  const originalUrl = useMemo(() => {
    if (!photo || !comparing) return null
    return URL.createObjectURL(photo.file)
  }, [photo, comparing])

  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl)
    }
  }, [originalUrl])

  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [currentId])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((z) => Math.min(6, Math.max(0.5, z * (e.deltaY > 0 ? 0.92 : 1.08))))
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    setPan({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y })
  }
  const onPointerUp = () => {
    dragRef.current = null
  }

  if (!photo) {
    return <div className="flex-1 bg-stage" />
  }

  const meta = photo.meta
  const overlayStyle =
    comparing && originalUrl && preview ? abOverlayStyle(preview, compare, template) : null

  return (
    <div
      ref={stageRef}
      className="relative flex-1 overflow-hidden bg-stage"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => {
        setZoom(1)
        setPan({ x: 0, y: 0 })
      }}
    >
      {/* 渲染中指示：顶部 accent 细线 */}
      {rendering ? (
        <div className="absolute left-0 top-0 z-20 h-[2px] w-full overflow-hidden">
          <div className="h-full w-1/3 animate-[slide_1.1s_ease-in-out_infinite] bg-accent" />
        </div>
      ) : null}
      <style>{`@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}`}</style>

      {/* 预览画布（含对焦框角标） */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="relative transition-transform duration-100"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.url}
              alt={photo.name}
              draggable={false}
              onError={invalidate}
              className="max-h-[calc(100vh-8rem)] max-w-[72vw] select-none object-contain shadow-[0_12px_60px_rgba(0,0,0,0.35)]"
            />
          ) : (
            <div className="flex h-[420px] w-[560px] items-center justify-center bg-line/30">
              <span className="hud-label animate-pulse">{t('common.loading').toUpperCase()}</span>
            </div>
          )}

          {overlayStyle && originalUrl ? (
            <>
              {/* 分割线右侧垫装裱底色：与处理后画布的衬纸同色，原图区外呈"未印水印的纸面"
                  而非深色空洞；圆角缺口两侧颜色也因此一致 */}
              <div
                className="absolute inset-0"
                style={{
                  backgroundColor: template.canvas.mountColor,
                  clipPath: `inset(0 0 0 ${compare}%)`
                }}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={originalUrl}
                alt="original"
                draggable={false}
                className="absolute select-none"
                style={overlayStyle}
              />
              <div
                className="absolute inset-y-0 z-10 w-[1px] bg-accent"
                style={{ left: `${compare}%` }}
              >
                <span className="absolute left-1/2 top-1/2 h-8 w-[3px] -translate-x-1/2 -translate-y-1/2 bg-accent" />
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* 对焦框角标（取景器 vernacular，装饰性但点题） */}
      {preview ? <FocusCorners zoom={zoom} /> : null}

      {/* 底部档案条：FRAME 编码 + 拍摄数据（Fragment Mono 语义用 tabular MiSans） */}
      <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between border-t border-line bg-panel/90 px-4 py-1.5 backdrop-blur-sm">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] tracking-[2px] text-muted">FRAME</span>
          <span className="text-[13px] tabular-nums">
            {String((items.findIndex((p) => p.id === photo.id) ?? 0) + 1).padStart(3, '0')}
          </span>
          <span className="max-w-[220px] truncate text-[11px] text-muted">{photo.name}</span>
        </div>
        <div className="hidden items-center gap-4 text-[11px] tabular-nums text-muted md:flex">
          {meta?.modelPretty ? <span>{meta.modelPretty}</span> : null}
          {meta?.lens ? <span>{meta.lens}</span> : null}
          {meta?.focal35 ? <span>{meta.focal35}mm</span> : null}
          {meta?.dateTimeOriginal ? <span>{formatDate(meta.dateTimeOriginal)}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setComparing((v) => !v)}
            className={clsx(
              'border px-2 py-0.5 text-[10px] tracking-[1px] transition-colors',
              comparing
                ? 'border-accent text-accent'
                : 'border-line text-muted hover:border-ink hover:text-ink'
            )}
          >
            A/B
          </button>
          <span className="w-10 text-right text-[10px] tabular-nums text-muted">
            {Math.round(zoom * 100)}%
          </span>
        </div>
      </div>

      {/* 对比滑块拖动区 */}
      {comparing ? (
        <input
          type="range"
          min={2}
          max={98}
          value={compare}
          onChange={(e) => setCompare(Number(e.target.value))}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="compare"
          className="absolute bottom-12 left-1/2 z-20 w-1/2 -translate-x-1/2 accent-[var(--accent)]"
        />
      ) : null}
    </div>
  )
}

function FocusCorners({ zoom }: { zoom: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        className="pointer-events-none relative h-[calc(100vh-10rem)] w-[calc(72vw-2rem)]"
        style={{ transform: `scale(${zoom})` }}
      >
        {(['left-0 top-0 border-l border-t', 'right-0 top-0 border-r border-t', 'bottom-0 left-0 border-b border-l', 'bottom-0 right-0 border-b border-r'] as const).map(
          (pos) => (
            <span
              key={pos}
              className={clsx('absolute h-4 w-4 border-muted/50', pos)}
            />
          )
        )}
      </div>
    </div>
  )
}
