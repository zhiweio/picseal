'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { HardDrive, Link2, X } from 'lucide-react'
import { RemoteMediaError, fetchRemoteMedia, type RemoteMediaKind } from '@/lib/remote-media'
import { StatusDot, TermButton } from '@/components/ui/primitives'

/**
 * 网络素材导入弹窗：https 直链校验 + 受控下载，错误内联回显（红状态灯 + 原因）。
 * landing 传 localFile 渲染「本地文件」段（合并弹窗）；cinema 只用链接段。
 * 调用方以 key={open ? 'open' : 'closed'} 重挂载重置内部状态（与 PhotoPicker 一致）。
 */
export function RemoteMediaDialog({
  open,
  kind,
  title,
  titleEn,
  onClose,
  onImported,
  localFile
}: {
  open: boolean
  kind: RemoteMediaKind
  title: string
  titleEn: string
  onClose: () => void
  /** 校验下载完成后的落盘/应用；抛错会回显到内联错误行 */
  onImported: (blob: Blob) => Promise<void> | void
  localFile?: {
    accept: string
    label: string
    onPick: (file: File) => Promise<void> | void
  }
}) {
  const t = useTranslations('mediaUrl')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  if (!open) return null

  const kindLabel = kind === 'audio' ? t('kindAudio') : t('kindVideo')
  const limitLabel = kind === 'audio' ? t('limitAudio') : t('limitVideo')

  /** RemoteMediaError → 用户可读文案；其余（落盘失败等）透出调用方抛出的 message */
  const describe = (err: unknown): string => {
    if (err instanceof RemoteMediaError) {
      switch (err.code) {
        case 'invalid-url':
          return t('error.invalidUrl')
        case 'unreachable':
          return t('error.unreachable')
        case 'timeout':
          return t('error.timeout')
        case 'not-found':
          return t('error.notFound')
        case 'server-error':
          return t('error.serverError', { status: err.status ?? 0 })
        case 'bad-type':
          return t('error.badType', { kind: kindLabel })
        case 'too-large':
          return t('error.tooLarge', { limit: limitLabel })
      }
    }
    if (err instanceof Error && err.message) return err.message
    return t('error.unknown')
  }

  const handleClose = () => {
    abortRef.current?.abort()
    onClose()
  }

  const runImport = async (): Promise<void> => {
    if (busy || !url.trim()) return
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setError(null)
    try {
      const blob = await fetchRemoteMedia(url, kind, { signal: controller.signal })
      await onImported(blob)
      onClose()
    } catch (err) {
      if (controller.signal.aborted) return // 用户关闭弹窗主动中止，静默
      setError(describe(err))
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  const pickLocal = async (file: File): Promise<void> => {
    if (!localFile || busy) return
    setError(null)
    try {
      await localFile.onPick(file)
      onClose()
    } catch (err) {
      setError(describe(err))
    }
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    void runImport()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-veil backdrop-blur-[6px]">
      <div
        className="flex max-h-[86vh] w-[min(560px,94vw)] flex-col border border-line bg-panel"
        style={{ boxShadow: 'var(--shadow-pop)' }}
      >
        <header className="rule-heavy flex items-center justify-between px-5 py-3">
          <h2 className="hud-label">
            {title} <span className="text-ink/60">/ {titleEn}</span>
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('cancel')}
            className="text-muted transition-colors hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        {/* footer 置于 form 内：submit 按钮（与输入框回车）统一走 onSubmit，避免点「校验并导入」无响应 */}
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {localFile ? (
              <section className="border-b border-line px-5 py-4">
                <p className="hud-label">
                  01 · {t('localLabel')} <span className="text-ink/60">/ {t('localLabelEn')}</span>
                </p>
                <label className="mt-2.5 flex h-9 cursor-pointer items-center justify-center gap-1.5 border border-line text-[12px] text-muted transition-colors hover:border-ink hover:text-ink">
                  <HardDrive size={12} />
                  {localFile.label}
                  <input
                    type="file"
                    accept={localFile.accept}
                    hidden
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void pickLocal(file)
                    }}
                  />
                </label>
              </section>
            ) : null}

            <section className="px-5 py-4">
              <p className="hud-label">
                {localFile ? '02' : '01'} · {t('urlLabel')}{' '}
                <span className="text-ink/60">/ {t('urlLabelEn')}</span>
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <Link2 size={13} className="shrink-0 text-muted" />
                <input
                  type="url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value)
                    if (error) setError(null)
                  }}
                  placeholder={kind === 'audio' ? t('placeholderAudio') : t('placeholderVideo')}
                  disabled={busy}
                  autoFocus
                  spellCheck={false}
                  className="h-9 w-full border border-line bg-surface px-3 font-mono text-[12px] text-ink outline-none transition-colors placeholder:text-muted/50 focus:border-ink"
                />
              </div>
              {error ? (
                <p className="mt-2.5 flex items-center gap-2 text-[11px] text-[#c25b4e]">
                  <StatusDot state="fail" />
                  {error}
                </p>
              ) : null}
              <p className="mt-2.5 text-[10px] leading-relaxed text-muted">{t('hint')}</p>
            </section>
          </div>

          <footer className="flex items-center justify-between border-t border-line px-5 py-3">
            <span className="hud-label">
              {kind === 'audio' ? 'AUDIO' : 'VIDEO'} ≤ {limitLabel}
            </span>
            <div className="flex gap-2">
              <TermButton variant="ghost" onClick={handleClose} disabled={busy}>
                {t('cancel')}
              </TermButton>
              <TermButton variant="solid" type="submit" disabled={busy || url.trim().length === 0}>
                {busy ? t('importing') : t('import')}
              </TermButton>
            </div>
          </footer>
        </form>
      </div>
    </div>
  )
}
