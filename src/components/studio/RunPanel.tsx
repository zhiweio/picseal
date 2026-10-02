'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import clsx from 'clsx'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Download, Pause, Play, X } from 'lucide-react'
import { StatusDot, TermButton } from '@/components/ui/primitives'
import { downloadZip, type ZipEntry } from '@/lib/delivery'
import { queueSummary, useQueue } from '@/stores/queue'
import { usePhotos } from '@/stores/photos'
import { useSettings } from '@/stores/settings'

/** 批量运行面板：定稿确认 → 进度规则线 + 逐帧状态列表 → 打包交付 */
export function RunPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('studio')
  const tr = useTranslations()
  const frames = useQueue((s) => s.frames)
  const snapshot = useQueue((s) => s.snapshot)
  const items = usePhotos((s) => s.items)
  const template = useSettings((s) => s.template)
  const output = useSettings((s) => s.output)
  const [scope, setScope] = useState<'all' | 'selected'>('all')

  const selected = items.filter((p) => p.selected)
  const scopePhotos = scope === 'selected' && selected.length > 0 ? selected : items

  const start = () => {
    useQueue.getState().start(
      scopePhotos,
      template,
      output,
      `${tr(`templates.${template.id}.name`, { defaultMessage: template.id })} · ${output.format.toUpperCase()}${
        output.longEdge ? ` · ${output.longEdge}px` : ''
      }${output.keepExif ? ' · EXIF' : ''}`
    )
  }

  const hasRun = frames.length > 0 || snapshot !== null

  return (
    <div
      className={clsx(
        'fixed inset-0 z-50 items-center justify-center bg-veil backdrop-blur-[6px]',
        open ? 'flex' : 'hidden'
      )}
    >
      <div
        className="flex max-h-[82vh] w-[min(680px,92vw)] flex-col border border-line bg-panel"
        style={{ boxShadow: 'var(--shadow-pop)' }}
      >
        <header className="rule-heavy flex items-center justify-between px-5 py-3">
          <div className="flex items-baseline gap-3">
            <h2 className="hud-label">
              {t('queue.label')} <span className="text-ink/60">/ {t('queue.labelEn')}</span>
            </h2>
            {snapshot ? <span className="text-[11px] text-muted">{snapshot.label}</span> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('queue.close')}
            className="text-muted transition-colors hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        {hasRun ? <RunView onClose={onClose} /> : <StartView scope={scope} setScope={setScope} onStart={start} />}
      </div>
    </div>
  )
}

function StartView({
  scope,
  setScope,
  onStart
}: {
  scope: 'all' | 'selected'
  setScope: (v: 'all' | 'selected') => void
  onStart: () => void
}) {
  const t = useTranslations('studio')
  const tr = useTranslations()
  const items = usePhotos((s) => s.items)
  const template = useSettings((s) => s.template)
  const output = useSettings((s) => s.output)
  const selected = items.filter((p) => p.selected)
  const scopePhotos = scope === 'selected' && selected.length > 0 ? selected : items

  return (
    <div className="px-5 py-5">
      <h3 className="mb-3 text-[14px] font-semibold">{t('queue.confirmTitle')}</h3>
      <div className="flex flex-col gap-1.5">
        <label className="flex cursor-pointer items-center gap-2 text-[12px]">
          <input
            type="radio"
            checked={scope === 'all'}
            onChange={() => setScope('all')}
            className="h-3 w-3 accent-[var(--accent)]"
          />
          {t('queue.scopeAll', { count: items.length })}
        </label>
        {selected.length > 0 ? (
          <label className="flex cursor-pointer items-center gap-2 text-[12px]">
            <input
              type="radio"
              checked={scope === 'selected'}
              onChange={() => setScope('selected')}
              className="h-3 w-3 accent-[var(--accent)]"
            />
            {t('queue.scopeSelected', { count: selected.length })}
          </label>
        ) : null}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 border border-line p-3 text-[11px]">
        <div className="flex justify-between">
          <dt className="text-muted">{t('template.label')}</dt>
          <dd>{tr(`templates.${template.id}.name`, { defaultMessage: template.id })}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">{t('export.format')}</dt>
          <dd className="tabular-nums">
            {output.format.toUpperCase()}
            {output.longEdge ? ` · ${output.longEdge}px` : ''}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">{t('export.quality')}</dt>
          <dd className="tabular-nums">{Math.round(output.quality * 100)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">{t('export.keepExif')}</dt>
          <dd>{output.keepExif ? '✓' : '—'}</dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={onStart}
        disabled={scopePhotos.length === 0}
        className="mt-4 h-9 w-full bg-ink text-[12px] font-medium tracking-[1px] text-page transition-opacity hover:opacity-85 disabled:opacity-40"
      >
        {t('queue.start')} · {scopePhotos.length} FRAMES
      </button>
    </div>
  )
}

function RunView({ onClose }: { onClose: () => void }) {
  const t = useTranslations('studio')
  const frames = useQueue((s) => s.frames)
  const running = useQueue((s) => s.running)
  const paused = useQueue((s) => s.paused)
  const startedAt = useQueue((s) => s.startedAt)
  const packing = useQueue((s) => s.packing)
  const packedCount = useQueue((s) => s.packedCount)
  const pause = useQueue((s) => s.pause)
  const resume = useQueue((s) => s.resume)
  const cancel = useQueue((s) => s.cancel)
  const retryFailed = useQueue((s) => s.retryFailed)
  const setPacking = useQueue((s) => s.setPacking)
  const reset = useQueue((s) => s.reset)

  const summary = queueSummary(frames)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [running])

  // ETA：按已完成吞吐线性外推
  const eta = useMemo(() => {
    if (!running || !startedAt || summary.done === 0) return null
    const elapsed = (now - startedAt) / 1000
    const rate = summary.done / elapsed
    if (rate <= 0 || summary.pending === 0) return null
    const secs = Math.round(summary.pending / rate)
    return secs > 90 ? `${Math.round(secs / 60)} min` : `${secs} s`
  }, [running, startedAt, now, summary.done, summary.pending])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: frames.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 12
  })

  const packZip = async () => {
    const doneFrames = frames.filter((f) => f.status === 'done' && f.blob)
    if (doneFrames.length === 0) return
    setPacking(true, 0)
    try {
      const used = new Set<string>()
      const entries: ZipEntry[] = doneFrames.map((f, i) => {
        let name = f.filename ?? f.name
        if (used.has(name)) name = `${String(i + 1).padStart(4, '0')}_${name}`
        used.add(name)
        return { name, blob: f.blob! }
      })
      await downloadZip(entries, `picseal_${new Date().toISOString().slice(0, 10)}.zip`, (n) =>
        setPacking(true, n)
      )
    } finally {
      setPacking(false)
    }
  }

  const progress = summary.total > 0 ? (summary.settled / summary.total) * 100 : 0
  const allSettled = !running

  return (
    <>
      <div className="px-5 pt-4">
        <div className="flex items-baseline justify-between text-[11px] tabular-nums text-muted">
          <span className="text-[13px] text-ink">
            FRAME {String(summary.settled).padStart(3, '0')}
            <span className="text-muted"> / {String(summary.total).padStart(3, '0')}</span>
          </span>
          <span>
            {t('queue.done', { done: summary.done, failed: summary.failed })}
            {eta ? ` · ${t('queue.eta', { time: eta })}` : ''}
          </span>
        </div>
        <div className="mt-2 h-[2px] w-full bg-line">
          <div
            className="h-full bg-accent transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div ref={scrollRef} className="mx-5 mt-3 min-h-0 flex-1 overflow-y-auto border border-line">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const frame = frames[vRow.index]
            if (!frame) return null
            return (
              <div
                key={frame.photoId}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: vRow.size,
                  transform: `translateY(${vRow.start}px)`
                }}
                className="flex items-center gap-2 border-b border-line/60 px-3 text-[11px]"
              >
                <StatusDot
                  state={
                    frame.status === 'done'
                      ? 'ok'
                      : frame.status === 'rendering'
                        ? 'work'
                        : frame.status === 'failed'
                          ? 'fail'
                          : 'idle'
                  }
                />
                <span className="w-8 shrink-0 tabular-nums text-muted">
                  {String(vRow.index + 1).padStart(3, '0')}
                </span>
                <span className="min-w-0 flex-1 truncate">{frame.name}</span>
                {frame.filename ? (
                  <span className="hidden max-w-[180px] truncate text-muted sm:block">
                    → {frame.filename}
                  </span>
                ) : null}
                {frame.resultSize ? (
                  <span className="w-16 shrink-0 text-right tabular-nums text-muted">
                    {(frame.resultSize / 1024 / 1024).toFixed(1)}M
                  </span>
                ) : null}
                {frame.error ? (
                  <span className="max-w-[160px] shrink-0 truncate text-[10px] text-[#c25b4e]">
                    {t('queue.failedReason', { reason: frame.error })}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
        <div className="flex gap-2">
          {running ? (
            <TermButton variant="ghost" onClick={paused ? resume : pause}>
              {paused ? <Play size={12} /> : <Pause size={12} />}
              {paused ? t('queue.resume') : t('queue.pause')}
            </TermButton>
          ) : null}
          {running || summary.pending > 0 ? (
            <TermButton variant="line" onClick={cancel}>
              {t('queue.cancel')}
            </TermButton>
          ) : null}
          {allSettled && summary.failed > 0 ? (
            <TermButton variant="ghost" onClick={retryFailed}>
              {t('queue.retry')} ({summary.failed})
            </TermButton>
          ) : null}
        </div>
        <div className="flex gap-2">
          {summary.done > 0 ? (
            <TermButton variant="solid" onClick={packZip} disabled={packing}>
              <Download size={12} />
              {packing
                ? `${t('queue.downloading')} ${packedCount}/${summary.done}`
                : t('queue.downloadZip')}
            </TermButton>
          ) : null}
          {allSettled ? (
            <TermButton
              variant="line"
              onClick={() => {
                reset()
                onClose()
              }}
            >
              {t('queue.close')}
            </TermButton>
          ) : null}
        </div>
      </footer>
    </>
  )
}
