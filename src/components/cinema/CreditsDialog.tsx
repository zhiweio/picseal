'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { RefreshCw, X } from 'lucide-react'
import { parseMarkdown, type MdBlock, type MdInline } from '@/lib/markdown'
import { StatusDot, TermButton } from '@/components/ui/primitives'

/**
 * Markdown 版权说明预览弹窗：拉取 public/ 下第一方 .md 并按产品设计语言渲染，
 * 取代「新开标签页看裸文本」。解析在 src/lib/markdown.ts（零依赖、纯数据），
 * 此处只做 JSX 映射 —— 全程不使用 dangerouslySetInnerHTML。
 */

function Inline({ nodes }: { nodes: MdInline[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.kind) {
          case 'text':
            return <span key={i}>{node.value}</span>
          case 'code':
            return (
              <code key={i} className="border border-line bg-surface px-1 font-mono text-[10px] text-ink">
                {node.value}
              </code>
            )
          case 'bold':
            return (
              <strong key={i} className="font-semibold text-ink">
                <Inline nodes={node.children} />
              </strong>
            )
          case 'italic':
            return (
              <em key={i}>
                <Inline nodes={node.children} />
              </em>
            )
          case 'link':
            return (
              <a
                key={i}
                href={node.href}
                target={node.href.startsWith('/') ? undefined : '_blank'}
                rel="noreferrer"
                className="underline underline-offset-2 transition-colors hover:text-ink"
              >
                <Inline nodes={node.children} />
              </a>
            )
        }
      })}
    </>
  )
}

function Blocks({ blocks }: { blocks: MdBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'heading':
            return block.level <= 1 ? (
              <h3 key={i} className="rule-heavy pb-2 pt-1 text-[14px] font-bold tracking-[1px] text-ink">
                <Inline nodes={block.children} />
              </h3>
            ) : (
              <h4 key={i} className="hud-label pt-4">
                <Inline nodes={block.children} />
              </h4>
            )
          case 'paragraph':
            return (
              <p key={i} className="whitespace-pre-line text-[11px] leading-relaxed text-muted">
                <Inline nodes={block.children} />
              </p>
            )
          case 'list':
            return (
              <ul key={i} className="flex flex-col gap-1.5">
                {block.items.map((item, j) => (
                  <li key={j} className="border-l border-line pl-3 text-[11px] leading-relaxed text-muted">
                    {block.ordered ? (
                      <span className="mr-1.5 tabular-nums text-ink/60">{j + 1}.</span>
                    ) : null}
                    <Inline nodes={item} />
                  </li>
                ))}
              </ul>
            )
          case 'code':
            return (
              <pre key={i} className="overflow-x-auto border border-line bg-surface p-3 font-mono text-[10px] leading-relaxed text-muted">
                {block.value}
              </pre>
            )
        }
      })}
    </>
  )
}

export function CreditsDialog({ open, onClose, file = '/cinema/CREDITS.md' }: {
  open: boolean
  onClose: () => void
  /** 第一方 markdown 路径（默认放映室媒体版权说明） */
  file?: string
}) {
  const t = useTranslations('cinema')
  const common = useTranslations('common')
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'error'; blocks?: MdBlock[] }>({
    status: 'loading'
  })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setState({ status: 'loading' })
    fetch(file, { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.text()
      })
      .then((text) => {
        if (!cancelled) setState({ status: 'ok', blocks: parseMarkdown(text) })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [open, file, reloadKey])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-veil backdrop-blur-[6px]">
      <div
        className="flex max-h-[86vh] w-[min(640px,94vw)] flex-col border border-line bg-panel"
        style={{ boxShadow: 'var(--shadow-pop)' }}
      >
        <header className="rule-heavy flex items-center justify-between px-5 py-3">
          <h2 className="hud-label">
            {t('media.credit')} <span className="text-ink/60">/ {t('media.creditTitleEn')}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={common('close')}
            className="text-muted transition-colors hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {state.status === 'loading' ? (
            <p className="flex items-center gap-2 text-[11px] text-muted">
              <StatusDot state="work" />
              {common('loading')}…
            </p>
          ) : state.status === 'error' ? (
            <div className="flex flex-col items-start gap-3">
              <p className="flex items-center gap-2 text-[11px] text-[#c25b4e]">
                <StatusDot state="fail" />
                {t('media.creditLoadFailed')}
              </p>
              <TermButton variant="ghost" onClick={() => setReloadKey((k) => k + 1)}>
                <RefreshCw size={11} />
                {t('media.retry')}
              </TermButton>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Blocks blocks={state.blocks ?? []} />
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-line px-5 py-3">
          <span className="font-mono text-[10px] text-muted">{file}</span>
          <TermButton variant="ghost" onClick={onClose}>
            {common('close')}
          </TermButton>
        </footer>
      </div>
    </div>
  )
}
