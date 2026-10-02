import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { setRequestLocale, getMessages } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import '../globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#08121f' },
    { media: '(prefers-color-scheme: light)', color: '#e8e5e1' }
  ]
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

const THEME_INIT = `(function(){try{var t=localStorage.getItem('picseal-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: day)').matches?'day':'night'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='night'}})()`

export default async function LocaleLayout({
  children,
  params
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!routing.locales.includes(locale as never)) notFound()
  setRequestLocale(locale)
  const messages = await getMessages()

  return (
    <html lang={locale} data-theme="night" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <link
          rel="preload"
          href="/fonts/MiSans-Regular-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/MiSans-Demibold-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return {
    title: {
      default: 'PICSEAL — 影像档案终端',
      template: '%s · PICSEAL'
    },
    description:
      locale === 'zh'
        ? '相机品牌风格信息水印，在浏览器本地生成。照片不上传，批量处理，EXIF 完整保留。'
        : 'Camera-style info watermarks, generated entirely in your browser. No uploads, batch processing, EXIF preserved.',
    applicationName: 'PICSEAL',
    appleWebApp: { capable: true, title: 'PICSEAL' }
  }
}
