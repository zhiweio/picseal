'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useVirtualizer } from '@tanstack/react-virtual'
import clsx from 'clsx'
import { FileArchive, FolderOpen, ImagePlus, Pin, Plus, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { moveRelative } from '@/core/order'
import { usePhotos, photoDisplayOrder, type PhotoItem } from '@/stores/photos'
import { StatusDot, TermSwitch } from '@/components/ui/primitives'

/** 左侧刻度尺胶片条：添加入口 + 排序开关 + 缩略图轨（可拖拽自由排序 + hover 移除）+ tick 导航 + EXIF 状态灯 + 样片别针 */
export function FilmStrip({
  onPickFiles,
  onPickFolder,
  onPickZip,
  onRemove
}: {
  onPickFiles: () => void
  onPickFolder: () => void
  onPickZip: () => void
  onRemove: (id: string) => void
}) {
  const t = useTranslations('studio')
  const items = usePhotos((s) => s.items)
  const currentId = usePhotos((s) => s.currentId)
  const sampleId = usePhotos((s) => s.sampleId)
  const sortMode = usePhotos((s) => s.sortMode)
  const setCurrent = usePhotos((s) => s.setCurrent)
  const setSortMode = usePhotos((s) => s.setSortMode)
  const reorderIds = usePhotos((s) => s.reorderIds)

  const scrollRef = useRef<HTMLDivElement>(null)

  // 显示序：时间正序排序是纯视图（开关关闭即回到物理序 = 上传/拖拽自定义顺序）
  const displayItems = useMemo(
    () => photoDisplayOrder({ items, sortMode }),
    [items, sortMode]
  )

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 8
  })

  const [addOpen, setAddOpen] = useState(false)
  const addRef = useRef<HTMLDivElement>(null)

  // 点击外部 / Escape 关闭添加菜单
  useEffect(() => {
    if (!addOpen) return
    const onDown = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAddOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [addOpen])

  /* ── 拖拽自由排序（HTML5 DnD）：落点 = 目标格上/下半的插入位；
        拖拽即自定义顺序，时间排序开关自动关闭 ── */
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<{ id: string; position: 'before' | 'after' } | null>(null)

  useEffect(() => {
    if (!dragId) return
    const clear = () => {
      setDragId(null)
      setDropHint(null)
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [dragId])

  const dropPositionOf = (e: React.DragEvent): 'before' | 'after' => {
    const rect = e.currentTarget.getBoundingClientRect()
    return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }

  const commitDrop = (targetId: string, e: React.DragEvent) => {
    if (!dragId || dragId === targetId) return
    const next = moveRelative(displayItems, dragId, targetId, dropPositionOf(e)).map((p) => p.id)
    reorderIds(next)
    if (sortMode !== 'import') setSortMode('import')
  }

  const currentIndex = displayItems.findIndex((p) => p.id === currentId)

  return (
    <aside className="flex w-[76px] shrink-0 flex-col border-r border-line">
      <div className="flex h-9 items-center justify-between border-b border-line px-2">
        <span className="hud-label text-[9px]">FRAME</span>
        <span className="text-[10px] tabular-nums text-muted">
          {String(items.length).padStart(3, '0')}
        </span>
      </div>

      {/* 排序开关：按拍摄时间正序（默认关 = 上传顺序）；拖拽会自动切回自定义顺序 */}
      <div className="flex h-8 items-center justify-between border-b border-line px-2" title={t('frame.sortByTime')}>
        <span className={clsx('hud-label text-[9px]', sortMode === 'captureTime' ? 'text-accent' : 'text-muted')}>
          SORT
        </span>
        <TermSwitch
          checked={sortMode === 'captureTime'}
          onCheckedChange={(v) => setSortMode(v ? 'captureTime' : 'import')}
          aria-label={t('frame.sortByTime')}
        />
      </div>

      {/* 追加照片入口：固定在轨道顶部，不随列表滚动 */}
      <div ref={addRef} className="relative border-b border-line">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={addOpen}
          aria-label={t('import.addPhotos')}
          title={t('import.addPhotos')}
          onClick={() => setAddOpen((v) => !v)}
          className="group flex h-16 w-full items-center px-2 transition-colors hover:bg-ink/5"
        >
          <span
            className={clsx(
              'flex h-12 w-full items-center justify-center gap-1.5 border border-dashed transition-colors',
              addOpen
                ? 'border-accent text-accent'
                : 'border-line text-muted group-hover:border-accent group-hover:text-accent'
            )}
          >
            <Plus size={13} />
            <span className="hud-label text-[9px]">ADD</span>
          </span>
        </button>

        {addOpen ? (
          <div
            role="menu"
            aria-label={t('import.addPhotos')}
            className="absolute left-2 top-full z-30 mt-1 min-w-[160px] border border-line bg-panel py-1 shadow-[var(--shadow-pop)]"
          >
            <AddMenuItem
              icon={ImagePlus}
              label={t('import.chooseFiles')}
              onClick={() => {
                setAddOpen(false)
                onPickFiles()
              }}
            />
            <AddMenuItem
              icon={FolderOpen}
              label={t('import.chooseFolder')}
              onClick={() => {
                setAddOpen(false)
                onPickFolder()
              }}
            />
            <AddMenuItem
              icon={FileArchive}
              label={t('import.chooseZip')}
              onClick={() => {
                setAddOpen(false)
                onPickZip()
              }}
            />
          </div>
        ) : null}
      </div>

      {currentIndex >= 5 ? (
        <button
          type="button"
          className="border-b border-line py-1 text-center text-[9px] tracking-[2px] text-muted hover:text-ink"
          onClick={() => setCurrent(displayItems[currentIndex - 1]?.id ?? null)}
        >
          ↑ {String(currentIndex).padStart(3, '0')}
        </button>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const photo = displayItems[vRow.index]
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
                  dragging={dragId === photo.id}
                  dropHint={dropHint?.id === photo.id ? dropHint.position : null}
                  onNavigate={() => setCurrent(photo.id)}
                  onRemove={() => onRemove(photo.id)}
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
                    const position = dropPositionOf(e)
                    setDropHint((prev) =>
                      prev?.id === photo.id && prev.position === position ? prev : { id: photo.id, position }
                    )
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    commitDrop(photo.id, e)
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}

function AddMenuItem({
  icon: Icon,
  label,
  onClick
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-ink transition-colors hover:bg-ink/5"
    >
      <Icon size={13} className="shrink-0 text-muted" />
      {label}
    </button>
  )
}

function FrameCell({
  photo,
  active,
  sample,
  dragging,
  dropHint,
  onNavigate,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop
}: {
  photo: PhotoItem
  active: boolean
  sample: boolean
  dragging: boolean
  dropHint: 'before' | 'after' | null
  onNavigate: () => void
  onRemove: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}) {
  const t = useTranslations('studio')
  const metaTitle =
    photo.metaStatus === 'pending'
      ? t('frame.exifReading')
      : photo.metaStatus === 'ok'
        ? t('frame.exifOk')
        : t('frame.noExif')

  return (
    <div
      className={clsx(
        'group relative flex h-full cursor-grab items-center gap-1.5 pl-2 pr-1.5',
        active ? 'bg-ink/5' : 'hover:bg-ink/5',
        dragging && 'opacity-30'
      )}
      title={photo.name}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onNavigate}
    >
      {/* 活动刻度记号：accent 竖线 */}
      <span
        className={clsx(
          'absolute left-0 top-1/2 w-[2px] -translate-y-1/2 transition-all',
          active ? 'h-6 bg-accent' : 'h-0 bg-transparent group-hover:h-3 group-hover:bg-line'
        )}
      />
      {/* 拖拽落点指示：目标格上/下缘的 accent 横线 */}
      {dropHint ? (
        <span
          className={clsx(
            'pointer-events-none absolute left-0 right-0 z-10 h-[2px] bg-accent',
            dropHint === 'before' ? 'top-0' : 'bottom-0'
          )}
        />
      ) : null}
      <div className="relative h-12 w-12 shrink-0 overflow-hidden bg-stage">
        {photo.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.thumbUrl} alt={photo.name} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="h-full w-full animate-pulse bg-line" />
        )}
        {sample ? (
          <span className="absolute right-0 top-0 bg-page/80 p-[1px] text-accent">
            <Pin size={9} />
          </span>
        ) : null}
        {/* EXIF 状态灯：解析中（呼吸）/ 已读取（绿）/ 无拍摄信息（灰） */}
        <span
          title={metaTitle}
          className="absolute bottom-0 right-0 flex h-3 w-3 items-center justify-center bg-page/80"
        >
          <StatusDot
            state={photo.metaStatus === 'pending' ? 'work' : photo.metaStatus === 'ok' ? 'ok' : 'idle'}
          />
        </span>
      </div>
      {/* hover 移除：直接把照片移出工作台（底部 toast 可撤销） */}
      <button
        type="button"
        aria-label={t('frame.remove')}
        title={t('frame.remove')}
        draggable={false}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center border border-line bg-page/80 text-muted opacity-0 transition-opacity hover:border-accent hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X size={10} />
      </button>
    </div>
  )
}
