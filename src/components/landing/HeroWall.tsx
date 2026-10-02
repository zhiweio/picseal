'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { ArchiveWall } from '@/three/archive-wall'
import { readPhotoMeta, formatParams, formatDate } from '@/core/exif/reader'
import { BUILTIN_TEMPLATES } from '@/core/templates/builtin'
import { matchBrand } from '@/core/brands'
import { getRenderPool } from '@/workers/pool'
import type { PhotoMeta } from '@/core/types'

const SAMPLES = [
  'sony', 'canon', 'nikon', 'fujifilm', 'leica', 'xiaomi', 'apple',
  'huawei', 'panasonic', 'olympus', 'ricoh', 'dji', 'insta360'
] as const

interface SampleFrame {
  id: string
  url: string
  meta: PhotoMeta
}

/**
 * 落地页 3D 影像档案墙：样片原图先上墙，水印实渲完成后渐进替换 —— 产品自我演示。
 */
export function HeroWall() {
  const t = useTranslations()
  const containerRef = useRef<HTMLDivElement>(null)
  const wallRef = useRef<ArchiveWall | null>(null)
  const [frames, setFrames] = useState<SampleFrame[]>([])
  const [selected, setSelected] = useState<number | null>(null)

  // 载入样片 + EXIF
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const loaded: SampleFrame[] = []
      for (const id of SAMPLES) {
        try {
          const res = await fetch(`/samples/${id}.jpg`)
          const blob = await res.blob()
          const meta = await readPhotoMeta(blob)
          if (cancelled) return
          blobCache.set(id, blob)
          loaded.push({ id, url: URL.createObjectURL(blob), meta })
          setFrames([...loaded])
        } catch {
          /* 单张样片失败跳过 */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 建墙
  useEffect(() => {
    if (!containerRef.current || frames.length === 0 || wallRef.current) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const wall = new ArchiveWall({
      container: containerRef.current,
      reducedMotion: reduced,
      items: frames.map((f) => ({
        url: f.url,
        model: f.meta.modelPretty,
        params: formatParams(f.meta),
        date: f.meta.dateTimeOriginal ? formatDate(f.meta.dateTimeOriginal) : undefined
      })),
      onSelect: (index) => setSelected(index)
    })
    wallRef.current = wall
    return () => {
      wall.dispose()
      wallRef.current = null
    }
  }, [frames.length === SAMPLES.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // 水印纹理渐进升级
  useEffect(() => {
    if (!wallRef.current || frames.length === 0) return
    let cancelled = false
    void (async () => {
      const pool = getRenderPool()
      const template = BUILTIN_TEMPLATES[0]! // mi-classic
      for (const frame of frames) {
        if (cancelled) return
        const blob = blobCache.get(frame.id)
        if (!blob) continue
        try {
          const res = await pool.run({
            kind: 'preview',
            file: new File([blob], `${frame.id}.jpg`, { type: 'image/jpeg' }),
            meta: frame.meta,
            template,
            maxLongEdge: 1024
          })
          if (cancelled) return
          if (res.ok && res.kind === 'preview') {
            wallRef.current?.upgradeTexture(frames.indexOf(frame), URL.createObjectURL(res.blob))
          }
        } catch {
          /* 升级失败保留原图 */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [frames.length === SAMPLES.length])

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

      {/* 底部提示 / 详情档案卡 */}
      <div className="absolute bottom-8 left-1/2 z-10 w-[min(560px,90vw)] -translate-x-1/2">
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
              [
                formatParams(selectedFrame.meta),
                selectedFrame.meta.dateTimeOriginal
                  ? formatDate(selectedFrame.meta.dateTimeOriginal)
                  : undefined
              ]
                .filter(Boolean)
                .join('  ·  ')
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
                onClick={() => {
                  wallRef.current?.select(null)
                }}
                className="h-8 border border-line px-3 text-[11px] text-muted transition-colors hover:border-ink hover:text-ink"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-center text-[11px] tracking-[2px] text-muted">
            {t('landing.browsableHint').toUpperCase()}
          </p>
        )}
      </div>
    </div>
  )
}

/** 样片原始 blob 缓存（水印升级时复用，避免重新 fetch） */
const blobCache = new Map<string, Blob>()
