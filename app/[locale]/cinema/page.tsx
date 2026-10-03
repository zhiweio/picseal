import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Cinema } from '@/components/cinema/Cinema'

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'cinema' })
  return { title: t('title') }
}

export default function CinemaPage() {
  return <Cinema />
}
