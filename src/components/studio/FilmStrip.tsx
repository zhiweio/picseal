'use client'

import { useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useVirtualizer } from '@tanstack/react-virtual'
import clsx from 'clsx'
import { Pin } from 'lucide-react'
import { usePhotos, type PhotoItem } from '@/stores/photos'
import { StatusDot } from '@/components/ui/primitives'

/** 左侧刻度尺胶片条：缩略图轨 + tick 导航 + 队列状态灯 + 样片别针 */
export function FilmStrip() {
  const t = useTranslations('studio')
  const items = usePhotos((s) => s.items)
  const currentId = usePhotos((s) => s.currentId)
  const sampleId = usePhotos((s) => s.sampleId)
  const setCurrent = usePhotos((s) => s.setCurrent)
  const toggleSelected = usePhotos((s) => s.toggleSelected)

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 8
  })

  const currentIndex = items.findIndex((p) => p.id === currentId)

  return (
    <aside className="flex w-[76px] shrink-0 flex-col border-r border-line">
      <div className="flex h-9 items-center justify-between border-b border-line px-2">
        <span className="hud-label text-[9px]">FRAME</span>
        <span className="text-[10px] tabular-nums text-muted">
          {String(items.length).padStart(3, '0')}
        </span>
      </div>

      {currentIndex >= 5 ? (
        <button
          type="button"
          className="border-b border-line py-1 text-center text-[9px] tracking-[2px] text-muted hover:text-ink"
          onClick={() => setCurrent(items[currentIndex - 1]?.id ?? null)}
        >
          ↑ {String(currentIndex).padStart(3, '0')}
        </button>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const photo = items[vRow.index]
            if (!photo) return null
            return (
              <div
                key={photo.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: vRow.size,
                  transform: `translateY(${vRow.start}px)`
                }}
              >
                <FrameCell
                  photo={photo}
                  active={photo.id === currentId}
                  sample={photo.id === sampleId}
                  onNavigate={() => setCurrent(photo.id)}
                  onSelect={(v) => toggleSelected(photo.id, v)}
                  ariaLabel={t('frame.counter')}
                />
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}

function FrameCell({
  photo,
  active,
  sample,
  onNavigate,
  onSelect
}: {
  photo: PhotoItem
  active: boolean
  sample: boolean
  onNavigate: () => void
  onSelect: (v: boolean) => void
  ariaLabel: string
}) {
  return (
    <div
      className={clsx(
        'group relative flex h-full cursor-pointer items-center gap-1.5 pl-2 pr-1.5',
        active ? 'bg-ink/5' : 'hover:bg-ink/5'
      )}
      onClick={onNavigate}
    >
      {/* 活动刻度记号：accent 竖线 */}
      <span
        className={clsx(
          'absolute left-0 top-1/2 w-[2px] -translate-y-1/2 transition-all',
          active ? 'h-6 bg-accent' : 'h-0 bg-transparent group-hover:h-3 group-hover:bg-line'
        )}
      />
      <div className="relative h-12 w-12 shrink-0 overflow-hidden bg-stage">
        {photo.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.thumbUrl} alt={photo.name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full animate-pulse bg-line" />
        )}
        {sample ? (
          <span className="absolute right-0 top-0 bg-page/80 p-[1px] text-accent">
            <Pin size={9} />
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <StatusDot
          state={photo.metaStatus === 'pending' ? 'work' : photo.metaStatus === 'ok' ? 'ok' : 'idle'}
        />
        <input
          type="checkbox"
          aria-label="select for batch"
          checked={photo.selected}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onSelect(e.target.checked)}
          className="h-3 w-3 shrink-0 appearance-none border border-line checked:border-accent checked:bg-accent"
        />
      </div>
    </div>
  )
}
