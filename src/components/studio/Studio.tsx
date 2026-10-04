'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import clsx from 'clsx'
import { FolderOpen, Github, ImagePlus } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { TopBar } from './TopBar'
import { FilmStrip } from './FilmStrip'
import { Stage } from './Stage'
import { ControlColumn } from './ControlColumn'
import { RunPanel } from './RunPanel'
import { usePhotos, photoDisplayOrder } from '@/stores/photos'
import { extractImagesFromZip, isZipFile } from '@/lib/zip-import'
import { clearPreviewCache } from '@/hooks/usePreview'

/** 工作台：导入 → 调样 → 定稿 → 批量 → 交付 */
export function Studio() {
  const t = useTranslations('studio')
  const tr = useTranslations()
  const items = usePhotos((s) => s.items)
  const sortMode = usePhotos((s) => s.sortMode)
  const addFiles = usePhotos((s) => s.addFiles)
  const setCurrent = usePhotos((s) => s.setCurrent)
  const [runOpen, setRunOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  // 键盘翻帧与左侧候选栏同序（时间排序开启时跟随显示序）
  const orderedItems = useMemo(() => photoDisplayOrder({ items, sortMode }), [items, sortMode])

  const importFiles = useCallback(
    async (fileList: File[]) => {
      const images: File[] = []
      const zips: File[] = []
      for (const file of fileList) {
        if (isZipFile(file)) zips.push(file)
        else images.push(file)
      }
      for (const zip of zips) {
        if (zip.size > 2 * 1024 ** 3) {
          setNotice(t('import.zipTooLarge'))
        }
        try {
          const { files } = await extractImagesFromZip(zip)
          images.push(...files)
        } catch {
          setNotice(`${zip.name}: parse failed`)
        }
      }
      if (images.length > 0) {
        const appending = usePhotos.getState().items.length > 0
        const { added } = await addFiles(images)
        // 追加到已有队列时给出反馈；首次导入画面本身切换到工作台，无需提示
        if (appending && added > 0) setNotice(t('import.appended', { count: added }))
      }
    },
    [addFiles, t]
  )

  // 全区域拖放 + 粘贴导入
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer?.types.includes('Files')) setDragging(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length > 0) void importFiles(files)
    }
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length > 0) void importFiles(files)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
    }
  }, [importFiles])

  // 键盘：←/→ 翻帧
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (runOpen) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const index = orderedItems.findIndex((p) => p.id === usePhotos.getState().currentId)
        const next =
          e.key === 'ArrowLeft'
            ? orderedItems[Math.max(0, index - 1)]
            : orderedItems[Math.min(orderedItems.length - 1, index + 1)]
        if (next) setCurrent(next.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [orderedItems, runOpen, setCurrent])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex h-screen flex-col">
      <TopBar onOpenBatch={() => setRunOpen(true)} />

      <div className="flex min-h-0 flex-1">
        {items.length > 0 ? (
          <FilmStrip
            onPickFiles={() => fileInputRef.current?.click()}
            onPickFolder={() => folderInputRef.current?.click()}
            onPickZip={() => zipInputRef.current?.click()}
          />
        ) : null}
        {items.length > 0 ? (
          <>
            <Stage />
            <ControlColumn onOpenBatch={() => setRunOpen(true)} />
          </>
        ) : (
          <EmptyStage
            dragging={dragging}
            onPick={() => fileInputRef.current?.click()}
            onPickFolder={() => folderInputRef.current?.click()}
            onPickZip={() => zipInputRef.current?.click()}
          />
        )}
      </div>

      <footer className="flex h-9 shrink-0 items-center justify-between border-t border-line px-4">
        <Link
          href="/"
          className="text-[11px] font-bold tracking-[3px] transition-opacity hover:opacity-70"
        >
          PICSEAL
        </Link>
        <a
          href="https://github.com/zhiweio/picseal"
          target="_blank"
          rel="noreferrer"
          aria-label={tr('nav.github')}
          className="flex h-[22px] w-[22px] items-center justify-center border border-line text-muted transition-colors hover:border-ink hover:text-ink"
        >
          <Github size={12} />
        </a>
      </footer>

      {/* 拖放遮罩 */}
      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-veil">
          <div className="border border-dashed border-accent px-10 py-6">
            <span className="hud-label text-[13px] text-accent">
              {t('import.drop')} / DROP FRAMES
            </span>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 border border-line bg-panel px-4 py-2 text-[12px] shadow-[var(--shadow-pop)]">
          {notice}
        </div>
      ) : null}

      <RunPanel open={runOpen} onClose={() => setRunOpen(false)} />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,.tif,.tiff"
        hidden
        onChange={(e) => {
          void importFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error 非标准目录选择属性
        webkitdirectory="true"
        hidden
        onChange={(e) => {
          void importFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          void importFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </div>
  )
}

function EmptyStage({
  dragging,
  onPick,
  onPickFolder,
  onPickZip
}: {
  dragging: boolean
  onPick: () => void
  onPickFolder: () => void
  onPickZip: () => void
}) {
  const t = useTranslations('studio')
  const tr = useTranslations()
  return (
    <div className="flex flex-1 items-center justify-center bg-stage">
      <div
        className={clsx(
          'flex flex-col items-center gap-5 border px-16 py-14 transition-colors',
          dragging ? 'border-accent' : 'border-line'
        )}
      >
        <span className="text-[17px] font-semibold">{t('import.drop')}</span>
        <p className="max-w-[340px] text-center text-[12px] leading-relaxed text-muted">
          {t('import.dropOr')}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onPick}
            className="flex h-9 items-center gap-2 bg-ink px-4 text-[12px] font-medium text-page transition-opacity hover:opacity-85"
          >
            <ImagePlus size={13} /> {t('import.chooseFiles')}
          </button>
          <button
            type="button"
            onClick={onPickFolder}
            className="flex h-9 items-center gap-2 border border-line px-4 text-[12px] text-ink transition-colors hover:border-ink"
          >
            <FolderOpen size={13} /> {t('import.chooseFolder')}
          </button>
          <button
            type="button"
            onClick={onPickZip}
            className="flex h-9 items-center gap-2 border border-line px-4 text-[12px] text-ink transition-colors hover:border-ink"
          >
            {t('import.chooseZip')}
          </button>
        </div>
        <span className="hud-label text-[9px]">{tr('landing.startCta').toUpperCase()}</span>
      </div>
    </div>
  )
}
