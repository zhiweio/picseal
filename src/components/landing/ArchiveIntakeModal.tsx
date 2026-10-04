'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { useTranslations } from 'next-intl'
import clsx from 'clsx'
import { FolderOpen, Images, X } from 'lucide-react'
import gsap from 'gsap'
import { BigCount, StatusDot, TermButton } from '@/components/ui/primitives'
import {
  MINI_WALL_COLS,
  MINI_WALL_SLOTS,
  PORTFOLIO_THRESHOLD,
  PORTFOLIO_WALL_CAP,
  encouragementIndex
} from '@/lib/portfolio'
import { usePortfolio } from '@/stores/portfolio'

const IMAGE_ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/tiff',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.heic',
  '.heif',
  '.hif',
  '.tif',
  '.tiff'
].join(',')

/** webkitdirectory / directory 是非标准属性，经 props 展开绕开 JSX 类型检查 */
const DIRECTORY_PROPS = {
  webkitdirectory: 'true',
  directory: 'true'
} as unknown as InputHTMLAttributes<HTMLInputElement>

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 收集拖拽内容：支持整个文件夹（webkitGetAsEntry 递归遍历），回退为普通文件列表 */
async function collectDroppedFiles(dt: DataTransfer): Promise<File[]> {
  const entryItems = Array.from(dt.items ?? []).map((item) =>
    typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
  )
  if (entryItems.length === 0 || entryItems.every((entry) => entry === null)) {
    return Array.from(dt.files ?? [])
  }
  const files: File[] = []
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) =>
        (entry as FileSystemFileEntry).file(resolve, () => resolve(null))
      )
      if (file) files.push(file)
      return
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      const readBatch = (): Promise<FileSystemEntry[]> =>
        new Promise((resolve) => reader.readEntries((batch) => resolve(batch), () => resolve([])))
      let batch = await readBatch()
      while (batch.length > 0) {
        for (const child of batch) await walk(child)
        batch = await readBatch()
      }
    }
  }
  for (const entry of entryItems) {
    if (entry) await walk(entry)
  }
  return files
}

/**
 * 档案征集弹窗：三条录入通道（文件夹 / 多选 / 拖拽）+ 9×4「未竟之墙」迷你墙。
 * 收录满 PORTFOLIO_THRESHOLD 才可入馆；不足点入馆触发拒绝动效（幽灵框波浪 +
 * 扫描线 + 鼓励语印章），鼓励继续拍摄。全部动效尊重 prefers-reduced-motion。
 */
export function ArchiveIntakeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('landing')
  const tc = useTranslations('common')
  const items = usePortfolio((s) => s.items)
  const committedVersion = usePortfolio((s) => s.committedVersion)
  const pendingThumbs = usePortfolio((s) => s.pendingThumbs)
  const commitRequested = usePortfolio((s) => s.commitRequested)
  const skippedCount = usePortfolio((s) => s.skippedCount)

  const panelRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<HTMLDivElement>(null)
  const scanRef = useRef<HTMLDivElement>(null)
  const stampRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef<Array<HTMLDivElement | null>>([])
  const animatedIdsRef = useRef<Set<string>>(new Set())
  const attemptRef = useRef(0)
  const prevCountRef = useRef(0)
  const awaitingCommitRef = useRef(false)
  const versionAtAwaitRef = useRef(0)

  const [dragOver, setDragOver] = useState(false)
  const [displayCount, setDisplayCount] = useState(0)
  const [encourageSeq, setEncourageSeq] = useState(0)
  const [confirmingClear, setConfirmingClear] = useState(false)

  const count = items.length
  /** 数量达标（120 是入馆下限，非上限）：点亮计数标签与入馆按钮 */
  const eligible = count >= PORTFOLIO_THRESHOLD
  const encourageN = encouragementIndex(count, encourageSeq)
  const encourageZh = t(`archive.encourage${encourageN}`)
  const encourageEn = t(`archive.encourage${encourageN}En`)
  const preparing = commitRequested && pendingThumbs > 0

  /* ── 计数滚动：BigCount 数值向最新收录数缓动；弹窗隐藏期间直接同步
    （打开时从当前值起滚，避免从 0 假滚），reduce 时直落 ── */
  useEffect(() => {
    if (!open || prefersReducedMotion()) {
      prevCountRef.current = count
      setDisplayCount(count)
      return
    }
    const obj = { v: prevCountRef.current }
    const tween = gsap.to(obj, {
      v: count,
      duration: 0.6,
      ease: 'power2.out',
      snap: { v: 1 },
      onUpdate: () => setDisplayCount(Math.round(obj.v)),
      onComplete: () => setDisplayCount(count)
    })
    prevCountRef.current = count
    return () => {
      tween.kill()
    }
  }, [count, open])

  /* ── a11y：ESC 关闭 + body 滚动锁定 + 焦点移入/归还 ── */
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  /* ── 入馆挂起（缩略图流水线未清零）：版本号落定时自动关闭 ── */
  useEffect(() => {
    if (!awaitingCommitRef.current || committedVersion === versionAtAwaitRef.current) return
    awaitingCommitRef.current = false
    onClose()
  }, [committedVersion, onClose])

  /** 新缩略图显影：从计数区飞入格位 + 灰度转彩色（FLIP） */
  const animateIn = useCallback((el: HTMLImageElement, index: number): void => {
    if (prefersReducedMotion()) return
    const slotRect = el.getBoundingClientRect()
    if (slotRect.width === 0) return
    const sourceRect = sourceRef.current?.getBoundingClientRect()
    const dx = sourceRect ? sourceRect.left - slotRect.left : 0
    const dy = sourceRect ? sourceRect.top - slotRect.top : 0
    gsap.fromTo(
      el,
      { x: dx, y: dy, scale: 0.3, opacity: 0, filter: 'grayscale(1) brightness(1.5)' },
      {
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
        filter: 'grayscale(0) brightness(1)',
        duration: 0.6,
        delay: Math.min(index * 0.02, 0.4),
        ease: 'power2.out',
        clearProps: 'all'
      }
    )
  }, [])

  /** 拒绝动效：幽灵框自最后实格起波浪闪烁 + 扫描线掠过 + 鼓励语印章 */
  const reject = useCallback((): void => {
    attemptRef.current += 1
    setEncourageSeq(attemptRef.current)
    if (prefersReducedMotion()) return
    const ghosts = slotRefs.current.filter((el, i) => el && !items[i]?.thumbUrl)
    const tl = gsap.timeline()
    if (ghosts.length > 0) {
      tl.fromTo(
        ghosts,
        { borderColor: 'var(--line)', backgroundColor: 'rgba(0,0,0,0)' },
        {
          borderColor: 'var(--accent)',
          backgroundColor: 'var(--accent-glow)',
          duration: 0.28,
          stagger: { each: 0.035, from: 0 },
          yoyo: true,
          repeat: 1,
          ease: 'power1.inOut'
        },
        0
      )
    }
    if (scanRef.current) {
      tl.fromTo(
        scanRef.current,
        { top: '-2%', opacity: 0 },
        { top: '102%', opacity: 1, duration: 0.7, ease: 'power1.inOut' },
        0.05
      ).to(scanRef.current, { opacity: 0, duration: 0.15 })
    }
    if (stampRef.current) {
      tl.fromTo(
        stampRef.current,
        { opacity: 0, scale: 1.18 },
        { opacity: 1, scale: 1, duration: 0.32, ease: 'power3.out' },
        0.35
      ).to(stampRef.current, { opacity: 0, duration: 0.3 }, '+=1.4')
    }
  }, [items])

  const onAdmit = (): void => {
    if (count < PORTFOLIO_THRESHOLD) {
      reject()
      return
    }
    usePortfolio.getState().commit()
    if (usePortfolio.getState().commitRequested) {
      // 缩略图流水线未清零：留在弹窗展示「整理档案中」，版本号落定后自动关闭
      awaitingCommitRef.current = true
      versionAtAwaitRef.current = committedVersion
      return
    }
    onClose()
  }

  const onClear = async (): Promise<void> => {
    if (!confirmingClear) {
      setConfirmingClear(true)
      window.setTimeout(() => setConfirmingClear(false), 3000)
      return
    }
    setConfirmingClear(false)
    animatedIdsRef.current.clear()
    attemptRef.current = 0
    setEncourageSeq(0)
    prevCountRef.current = 0
    await usePortfolio.getState().clear()
  }

  const ingest = (list: FileList | null): void => {
    if (!list || list.length === 0) return
    void usePortfolio.getState().addFiles(Array.from(list))
  }

  return (
    <div
      className={clsx(
        'fixed inset-0 z-50 items-center justify-center bg-veil backdrop-blur-[6px]',
        open ? 'flex' : 'hidden'
      )}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        void collectDroppedFiles(e.dataTransfer).then((files) => {
          if (files.length > 0) void usePortfolio.getState().addFiles(files)
        })
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative flex max-h-[86vh] w-[min(880px,94vw)] flex-col border border-line bg-panel outline-none"
        style={{ boxShadow: 'var(--shadow-pop)' }}
      >
        <header className="rule-heavy flex items-center justify-between px-5 py-3">
          <div className="flex items-baseline gap-3">
            <h2 className="hud-label">
              {t('archive.modalTitle')} <span className="text-ink/60">/ {t('archive.modalTitleEn')}</span>
            </h2>
            {committedVersion > 0 ? (
              <span className="text-[11px] text-muted">{t('archive.appendTag')}</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tc('close')}
            className="text-muted transition-colors hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[300px_minmax(0,1fr)]">
          {/* 左栏：录入通道 + 计数 + 鼓励语 */}
          <section className="border-b border-line px-5 py-5 md:border-b-0 md:border-r">
            <div className="flex flex-col gap-2">
              <TermButton
                variant="ghost"
                onClick={() => document.getElementById('archive-folder-input')?.click()}
                className="h-9 w-full justify-start"
              >
                <FolderOpen size={13} />
                {t('archive.pickFolder')}
              </TermButton>
              <TermButton
                variant="ghost"
                onClick={() => document.getElementById('archive-photos-input')?.click()}
                className="h-9 w-full justify-start"
              >
                <Images size={13} />
                {t('archive.pickPhotos')}
              </TermButton>
            </div>
            <input
              id="archive-folder-input"
              type="file"
              hidden
              multiple
              accept={IMAGE_ACCEPT}
              {...DIRECTORY_PROPS}
              onChange={(e) => {
                ingest(e.target.files)
                e.target.value = ''
              }}
            />
            <input
              id="archive-photos-input"
              type="file"
              hidden
              multiple
              accept={IMAGE_ACCEPT}
              onChange={(e) => {
                ingest(e.target.files)
                e.target.value = ''
              }}
            />

            <p className="mt-3 text-[11px] leading-relaxed text-muted">{t('archive.dropHint')}</p>
            {skippedCount > 0 ? (
              <p className="mt-1 text-[11px] text-muted">
                {t('archive.skipNote', { count: skippedCount })}
              </p>
            ) : null}

            <div ref={sourceRef} className="mt-5 border-t border-line pt-4">
              <BigCount
                value={displayCount}
                label={eligible ? t('archive.thresholdReady') : `/ ${PORTFOLIO_THRESHOLD}`}
              />
              <div className="mt-2 flex items-center gap-2">
                <StatusDot state={eligible ? 'ok' : pendingThumbs > 0 ? 'work' : 'idle'} />
                <span className="text-[11px] text-muted">
                  {eligible
                    ? t('archive.admitReady')
                    : pendingThumbs > 0
                      ? t('archive.processing')
                      : t('archive.collected')}
                </span>
              </div>
              {count > PORTFOLIO_WALL_CAP ? (
                <p className="mt-2 text-[11px] leading-relaxed text-muted tabular-nums">
                  {t('archive.overCap', { cap: PORTFOLIO_WALL_CAP, count: count - PORTFOLIO_WALL_CAP })}
                </p>
              ) : null}
              {eligible ? null : (
                <>
                  <p className="mt-3 text-[12px] text-accent">{encourageZh}</p>
                  <p className="hud-label mt-0.5">{encourageEn}</p>
                  <p className="mt-2 text-[11px] text-muted">
                    {t('archive.admitHint', { count: PORTFOLIO_THRESHOLD })}
                  </p>
                </>
              )}
            </div>

            <div className="mt-5 flex border-t border-line pt-4">
              <TermButton variant="line" onClick={() => void onClear()} disabled={count === 0}>
                {confirmingClear ? t('archive.clearConfirm') : t('archive.clear')}
              </TermButton>
            </div>
          </section>

          {/* 右栏：未竟之墙（9 × 4，行主序即墙面格位顺序） */}
          <section className="px-5 py-5">
            <div className="relative overflow-hidden border border-line p-2">
              <div
                className="grid gap-1.5"
                style={{ gridTemplateColumns: `repeat(${MINI_WALL_COLS}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: MINI_WALL_SLOTS }, (_, i) => {
                  const item = items[i]
                  const thumb = item?.thumbUrl
                  return (
                    <div
                      key={i}
                      ref={(el) => {
                        slotRefs.current[i] = el
                      }}
                      className={clsx(
                        'relative aspect-[4/3] overflow-hidden',
                        thumb ? 'border border-line' : 'border border-dashed border-line/80'
                      )}
                    >
                      {thumb ? (
                        <img
                          ref={(el) => {
                            if (!el || animatedIdsRef.current.has(item!.id)) return
                            animatedIdsRef.current.add(item!.id)
                            animateIn(el, i)
                          }}
                          src={thumb}
                          alt={item!.name}
                          draggable={false}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center text-[9px] tabular-nums text-muted/60">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              {/* 拒绝动效：扫描线（呼应 hero 解密扫描 HUD） */}
              <div
                ref={scanRef}
                className="pointer-events-none absolute left-0 right-0 h-[2px] bg-accent opacity-0"
                style={{ top: '-2%' }}
              />
              {/* 拒绝动效：鼓励语印章 */}
              <div
                ref={stampRef}
                className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 opacity-0"
              >
                <p className="border border-accent bg-panel/90 px-3 py-1.5 text-[12px] tracking-[2px] text-accent">
                  {t('archive.toGo', { count: Math.max(0, PORTFOLIO_THRESHOLD - count) })}
                </p>
                <p className="hud-label bg-panel/90 px-2 py-0.5">
                  {encourageZh} <span className="text-ink/60">/ {encourageEn}</span>
                </p>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="hud-label shrink-0">
                {t('archive.wallPreview')}{' '}
                <span className="text-ink/60">/ {t('archive.wallPreviewEn')}</span>
              </span>
              <span className="text-right text-[11px] tabular-nums text-muted">
                {t('archive.wallCapacity', { total: PORTFOLIO_WALL_CAP, count: MINI_WALL_SLOTS })}
              </span>
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <span className="hud-label">
            {t('archive.entry')} <span className="text-ink/60">/ {t('archive.entryEn')}</span>
          </span>
          <div className="flex gap-2">
            <TermButton variant="line" onClick={onClose}>
              {tc('close')}
            </TermButton>
            <TermButton
              variant={eligible ? 'solid' : 'ghost'}
              onClick={onAdmit}
              disabled={preparing}
              className={clsx(
                eligible
                  ? 'bg-accent text-page hover:opacity-85'
                  : 'text-muted hover:border-accent hover:text-accent'
              )}
            >
              {preparing ? t('archive.preparing') : t('archive.admit')}
            </TermButton>
          </div>
        </footer>

        {dragOver ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border border-dashed border-accent bg-veil/60">
            <p className="hud-label">{t('archive.dropHint')}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
