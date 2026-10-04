'use client'

import { useTranslations } from 'next-intl'
import clsx from 'clsx'
import { Tooltip } from '@/components/ui/Tooltip'
import { StatusDot } from '@/components/ui/primitives'
import { PORTFOLIO_THRESHOLD } from '@/lib/portfolio'
import { usePortfolio } from '@/stores/portfolio'

/** 三格墙缩影：档案墙的终端风符号（1px 描边，中格 accent 填充） */
function ArchiveMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 18 12"
      aria-hidden
      className={className}
      style={{ width: 18, height: 12 }}
    >
      <rect x="0.5" y="0.5" width="4" height="11" fill="none" stroke="currentColor" />
      <rect x="6.5" y="0.5" width="4" height="11" fill="var(--accent)" stroke="var(--accent)" />
      <rect x="12.5" y="0.5" width="4" height="11" fill="none" stroke="currentColor" />
    </svg>
  )
}

/**
 * 右上「个人档案馆」入口：镜像放映室尼康 Z 入口的形态，品牌色用主题 accent
 * 暖金（不扩散 nikon 红）。进行中显示收录计数，已入馆点亮 ok 状态灯。
 */
export function ArchiveEntry({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations('landing')
  const count = usePortfolio((s) => s.items.length)
  const committedVersion = usePortfolio((s) => s.committedVersion)
  const admitted = committedVersion > 0 && count >= PORTFOLIO_THRESHOLD

  return (
    <Tooltip label={t('archive.entryHint')} side="bottom">
      <button
        type="button"
        onClick={onOpen}
        title={t('archive.entryHint')}
        className={clsx(
          'group flex min-h-[44px] items-center gap-1.5 border bg-panel/80 px-2.5 text-[10px] tracking-[1px] text-ink backdrop-blur-sm transition-all hover:shadow-[0_0_14px_var(--accent-glow)]',
          admitted ? 'border-accent/60 hover:border-accent' : 'border-line hover:border-accent'
        )}
      >
        <ArchiveMark className="transition-transform duration-300 group-hover:scale-110" />
        <span className="hidden text-muted transition-colors group-hover:text-ink sm:inline">
          {t('archive.entry')}
        </span>
        {admitted ? (
          <StatusDot state="ok" />
        ) : count > 0 ? (
          <span className="tabular-nums text-muted">{String(count).padStart(3, '0')}</span>
        ) : null}
      </button>
    </Tooltip>
  )
}
