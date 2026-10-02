import { defineRouting } from 'next-intl/routing'

export const locales = ['zh', 'en'] as const
export type Locale = (typeof locales)[number]

export const routing = defineRouting({
  locales,
  defaultLocale: 'zh',
  localePrefix: 'always'
})
