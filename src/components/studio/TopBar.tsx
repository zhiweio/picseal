'use client'

import { useTranslations } from 'next-intl'
import { Github } from 'lucide-react'
import clsx from 'clsx'
import { BigCount } from '@/components/ui/primitives'
import { LangToggle, ThemeToggle } from '@/components/Toggles'
import { NikonZMark } from '@/components/ui/NikonZMark'
import { Tooltip } from '@/components/ui/Tooltip'
import { CINEMA_MIN_PHOTOS } from '@/core/cinema/timeline'
import { useRouter } from '@/i18n/navigation'
import { usePhotos } from '@/stores/photos'
import { useQueue, queueSummary } from '@/stores/queue'

export function TopBar({ onOpenBatch }: { onOpenBatch: () => void }) {
  const t = useTranslations('studio')
  const tr = useTranslations()
  const router = useRouter()
  const items = usePhotos((s) => s.items)
  const frames = useQueue((s) => s.frames)
  const summary = queueSummary(frames)
  const doneBytes = frames.reduce((sum, f) => sum + (f.resultSize ?? 0), 0)

  const cinemaReady = items.length >= CINEMA_MIN_PHOTOS

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
      <div className="flex items-baseline gap-3">
        <span className="text-[15px] font-bold tracking-[3px]">PICSEAL</span>
        <span className="hud-label hidden sm:inline">
          {tr('brand.tagline')} / {tr('brand.taglineEn')}
        </span>
      </div>

      <div className="flex items-center gap-5">
        {frames.length > 0 ? (
          <div className="hidden items-baseline gap-4 md:flex">
            <span className="text-[11px] tabular-nums text-muted">
              {t('queue.done', { done: summary.done, failed: summary.failed })}
              {doneBytes > 0 ? ` · ${(doneBytes / 1024 / 1024).toFixed(1)} MB` : ''}
            </span>
          </div>
        ) : (
          <BigCount value={items.length} label="FRAMES" />
        )}

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LangToggle />
          <a
            href="https://github.com/zhiweio/picseal"
            target="_blank"
            rel="noreferrer"
            aria-label={tr('nav.github')}
            className="flex h-[26px] w-[26px] items-center justify-center border border-line text-muted transition-colors hover:border-ink hover:text-ink"
          >
            <Github size={13} />
          </a>
          <Tooltip
            label={
              cinemaReady
                ? tr('cinema.entryHint')
                : tr('cinema.needMore', { count: CINEMA_MIN_PHOTOS - items.length })
            }
            side="bottom"
          >
            <button
              type="button"
              onClick={() => router.push('/cinema')}
              disabled={!cinemaReady}
              title={
                cinemaReady
                  ? tr('cinema.entryHint')
                  : tr('cinema.needMore', { count: CINEMA_MIN_PHOTOS - items.length })
              }
              className={clsx(
                'flex h-[26px] items-center gap-1.5 border px-2.5 text-[11px] font-medium tracking-[1px] transition-all disabled:cursor-not-allowed disabled:opacity-40',
                cinemaReady
                  ? 'border-nikon/60 text-ink hover:border-nikon hover:shadow-[0_0_12px_rgba(224,31,38,0.35)]'
                  : 'border-line text-muted'
              )}
            >
              <NikonZMark className="text-[13px]" />
              <span className="hidden sm:inline">{tr('cinema.title')}</span>
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={onOpenBatch}
            disabled={items.length === 0}
            className="h-[26px] bg-ink px-3 text-[11px] font-medium tracking-[1px] text-page transition-opacity hover:opacity-85 disabled:opacity-40"
          >
            {t('export.label')} ↵
          </button>
        </div>
      </div>
    </header>
  )
}
