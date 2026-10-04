'use client'

import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import type { PhotoItem } from '@/stores/photos'
import { moveRelative, orderByIds } from '@/core/order'
import { CINEMA_MAX_PHOTOS, CINEMA_MIN_PHOTOS } from '@/core/cinema/timeline'
import { TermButton, TermSwitch } from '@/components/ui/primitives'

/** 手挑选片器：勾选参与剪辑的照片（预选按基准序等距采样），支持拖拽缩略图自定义放映顺序 */
export function PhotoPicker({
  open,
  onClose,
  items,
  preselected,
  sortByTime,
  onToggleSortByTime,
  onCustomized,
  onConfirm
}: {
  open: boolean
  onClose: () => void
  /** 候选（已按当前基准序：拍摄时间正序 / 导入顺序，片单序在前） */
  items: PhotoItem[]
  preselected: Set<string>
  /** 拍摄时间排序开关（状态在放映室，默认开） */
  sortByTime: boolean
  onToggleSortByTime: (v: boolean) => void
  /** 用户拖拽出自定义顺序后回调（放映室据此自动关闭时间排序开关） */
  onCustomized: () => void
  onConfirm: (ids: string[]) => void
}) {
  const t = useTranslations('cinema')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselected))
  /** 弹窗内自定义顺序（全量 id 序）；拖拽生效，切换排序开关时清空回基准序 */
  const [customOrder, setCustomOrder] = useState<string[] | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const gridItems = useMemo(
    () => (customOrder ? orderByIds(items, customOrder) : items),
    [items, customOrder]
  )

  useEffect(() => {
    if (!dragId) return
    const clear = () => {
      setDragId(null)
      setOverId(null)
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [dragId])

  const count = selected.size
  const canConfirm = count >= CINEMA_MIN_PHOTOS && count <= CINEMA_MAX_PHOTOS

  if (!open) return null

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < CINEMA_MAX_PHOTOS) next.add(id)
      return next
    })
  }

  /** 切换基准序：清自定义顺序，回到新基准（拍摄时间 / 导入序） */
  const handleToggleSort = (v: boolean) => {
    setCustomOrder(null)
    setDragId(null)
    setOverId(null)
    onToggleSortByTime(v)
  }

  /** 落点 = 被拖图顶替目标格位置（目标后移）；顺序有实际变化才记为自定义 */
  const handleDrop = (targetId: string, e: React.DragEvent) => {
    e.preventDefault()
    if (dragId && dragId !== targetId) {
      const before = gridItems.map((p) => p.id)
      const next = moveRelative(gridItems, dragId, targetId, 'before').map((p) => p.id)
      if (next.some((id, i) => id !== before[i])) {
        setCustomOrder(next)
        onCustomized()
      }
    }
    setDragId(null)
    setOverId(null)
  }

  // 放映顺序 = 网格序过滤选中；角标显示每张在成片中的位次
  const orderNumbers = new Map<string, number>()
  for (const photo of gridItems) {
    if (selected.has(photo.id)) orderNumbers.set(photo.id, orderNumbers.size + 1)
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
            <label
              className="flex items-center gap-2 text-[11px] text-muted transition-colors hover:text-ink"
              title={t('picker.sortByTime')}
            >
              <span className="hidden sm:inline">{t('picker.sortByTime')}</span>
              <TermSwitch
                checked={sortByTime}
                onCheckedChange={handleToggleSort}
                aria-label={t('picker.sortByTime')}
              />
            </label>
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
            {gridItems.map((photo) => {
              const active = selected.has(photo.id)
              const isOver = overId === photo.id && dragId !== photo.id
              return (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => toggle(photo.id)}
                  draggable
                  onDragStart={(e) => {
                    setDragId(photo.id)
                    e.dataTransfer.effectAllowed = 'move'
                    // Firefox 需要 setData 才允许发起拖拽
                    e.dataTransfer.setData('text/plain', photo.id)
                  }}
                  onDragOver={(e) => {
                    if (!dragId || dragId === photo.id) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    setOverId(photo.id)
                  }}
                  onDrop={(e) => handleDrop(photo.id, e)}
                  className={clsx(
                    'group relative aspect-[4/3] cursor-grab overflow-hidden border transition-colors',
                    active ? 'border-accent' : 'border-line opacity-45 hover:opacity-80',
                    dragId === photo.id && 'opacity-30',
                    isOver && 'border-accent ring-1 ring-accent'
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
                    <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center bg-accent px-[3px] text-[9px] font-bold tabular-nums text-page">
                      {String(orderNumbers.get(photo.id) ?? 0).padStart(2, '0')}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-line px-5 py-3">
          <span className="text-[11px] text-muted">
            {customOrder ? t('picker.orderNoteCustom') : t('picker.orderNote')}
          </span>
          <div className="flex gap-2">
            <TermButton variant="ghost" onClick={onClose}>
              {t('picker.cancel')}
            </TermButton>
            <TermButton
              variant="solid"
              disabled={!canConfirm}
              onClick={() => onConfirm(gridItems.filter((p) => selected.has(p.id)).map((p) => p.id))}
            >
              {t('picker.confirm', { count })}
            </TermButton>
          </div>
        </footer>
      </div>
    </div>
  )
}
