'use client'

import type { ReactNode } from 'react'
import clsx from 'clsx'

/**
 * CSS-only 悬浮提示 —— 直角 + 1px 规则线 + bg-panel，遵循设计体系
 * （无第三方弹层依赖；同时建议触发元素自带原生 title 兜底）。
 */
export function Tooltip({
  label,
  side = 'bottom',
  children,
  className
}: {
  label: ReactNode
  side?: 'top' | 'bottom'
  children: ReactNode
  className?: string
}) {
  return (
    <span className={clsx('group/tip relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={clsx(
          'pointer-events-none invisible absolute left-1/2 z-50 w-max max-w-[240px] -translate-x-1/2 border border-line bg-panel px-2.5 py-1.5 text-left text-[11px] leading-relaxed text-ink opacity-0 transition-opacity duration-200 group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100',
          side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'
        )}
      >
        {label}
      </span>
    </span>
  )
}
