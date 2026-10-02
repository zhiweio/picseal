'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import clsx from 'clsx'
import { usePathname, useRouter } from '@/i18n/navigation'

type Theme = 'night' | 'day'

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('night')

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme | undefined) ?? 'night'
    setTheme(current)
  }, [])

  const apply = (next: Theme) => {
    const root = document.documentElement
    root.classList.add('theme-anim')
    root.dataset.theme = next
    try {
      localStorage.setItem('picseal-theme', next)
    } catch {
      /* private mode */
    }
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
            theme === t ? 'bg-ink text-page' : 'text-muted hover:text-ink'
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
