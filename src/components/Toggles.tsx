'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { useLocale } from 'next-intl'
import clsx from 'clsx'
import { usePathname, useRouter } from '@/i18n/navigation'

type Theme = 'night' | 'day'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  /** 首帧与 SSR 输出对齐（高亮夜），挂载后校正为已存主题，避免水合告警 */
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const current: Theme = mounted && theme === 'day' ? 'day' : 'night'

  const apply = (next: Theme) => {
    const root = document.documentElement
    root.classList.add('theme-anim')
    setTheme(next)
    window.setTimeout(() => root.classList.remove('theme-anim'), 700)
  }

  return (
    <div className="flex border border-line" role="group" aria-label="theme">
      {(['night', 'day'] as const).map((t, i) => (
        <button
          key={t}
          type="button"
          onClick={() => apply(t)}
          className={clsx(
            'px-2.5 py-1 text-[11px] transition-colors',
            i > 0 && 'border-l border-line',
            current === t ? 'bg-ink text-page' : 'text-muted hover:text-ink'
          )}
        >
          {t === 'night' ? '夜' : '昼'}
        </button>
      ))}
    </div>
  )
}

export function LangToggle() {
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const next = locale === 'zh' ? 'en' : 'zh'

  return (
    <button
      type="button"
      onClick={() => router.replace(pathname, { locale: next })}
      className="border border-line px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-ink hover:text-ink"
    >
      {next === 'en' ? 'EN' : '中文'}
    </button>
  )
}
