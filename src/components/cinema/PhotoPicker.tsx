'use client'

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { useTranslations } from 'next-intl'
import { Check, X } from 'lucide-react'
import type { PhotoItem } from '@/stores/photos'
import { CINEMA_MAX_PHOTOS, CINEMA_MIN_PHOTOS } from '@/core/cinema/timeline'
import { TermButton } from '@/components/ui/primitives'

/** 手挑选片器：勾选参与剪辑的照片（预选 = 拍摄时间等距采样） */
export function PhotoPicker({
  open,
  onClose,
  items,
  preselected,
  onConfirm
}: {
  open: boolean
  onClose: () => void
  /** 已按拍摄时间排序的候选 */
  items: PhotoItem[]
  preselected: Set<string>
  onConfirm: (ids: string[]) => void
}) {
  const t = useTranslations('cinema')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselected))

  const count = selected.size
  const canConfirm = count >= CINEMA_MIN_PHOTOS && count <= CINEMA_MAX_PHOTOS

  const sortedItems = useMemo(() => items, [items])

  if (!open) return null

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < CINEMA_MAX_PHOTOS) next.add(id)
      return next
    })
  }

  return (
    <div className={clsx('fixed inset-0 z-50 flex items-center justify-center bg-veil backdrop-blur-[6px]')}>
      <div
        className="flex max-h-[86vh] w-[min(880px,94vw)] flex-col border border-line bg-panel"
        style={{ boxShadow: 'var(--shadow-pop)' }}
      >
        <header className="rule-heavy flex items-center justify-between px-5 py-3">
          <h2 className="hud-label">
            {t('picker.label')} <span className="text-ink/60">/ {t('picker.labelEn')}</span>
          </h2>
          <div className="flex items-center gap-4">
            <span
              className={clsx(
                'text-[12px] tabular-nums',
                count > 48 ? 'text-[#c25b4e]' : count < 16 ? 'text-muted' : 'text-ink'
              )}
            >
              {t('picker.count', { count, max: CINEMA_MAX_PHOTOS })}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('picker.close')}
              className="text-muted transition-colors hover:text-ink"
            >
              <X size={15} />
            </button>
          </div>
        </header>

        <p className="border-b border-line px-5 py-2 text-[11px] text-muted">
          {t('picker.hint', { min: CINEMA_MIN_PHOTOS, max: CINEMA_MAX_PHOTOS })}
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
            {sortedItems.map((photo) => {
              const active = selected.has(photo.id)
              return (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => toggle(photo.id)}
                  className={clsx(
                    'group relative aspect-[4/3] overflow-hidden border transition-colors',
                    active ? 'border-accent' : 'border-line opacity-45 hover:opacity-80'
                  )}
                  title={photo.name}
                >
                  {photo.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.thumbUrl} alt={photo.name} className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-surface text-[10px] text-muted">
                      {photo.name.slice(0, 8)}
                    </span>
                  )}
                  {active ? (
                    <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center bg-accent text-page">
                      <Check size={11} />
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-line px-5 py-3">
          <span className="text-[11px] text-muted">{t('picker.orderNote')}</span>
          <div className="flex gap-2">
            <TermButton variant="ghost" onClick={onClose}>
              {t('picker.cancel')}
            </TermButton>
            <TermButton
              variant="solid"
              disabled={!canConfirm}
              onClick={() => onConfirm([...selected])}
            >
              {t('picker.confirm', { count })}
            </TermButton>
          </div>
        </footer>
      </div>
    </div>
  )
}
