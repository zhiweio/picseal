'use client'

import clsx from 'clsx'

/**
 * 尼康 Z 专用字形标记（Special Alphabets P04，双线斜切 Z）。
 * Nikon 红 #e01f26 是放映室专属品牌色特例（见 DESIGN.md 放映室章节），
 * 仅用于 Z 符号与放映指示，不进入通用 token。
 */
export function NikonZMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx('leading-none text-nikon', className)}
      style={{ fontFamily: '"Picseal NikonZSymbol", "MiSans", sans-serif' }}
    >
      Z
    </span>
  )
}
