import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Studio } from '@/components/studio/Studio'

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'studio' })
  return { title: t('title') }
}

export default function StudioPage() {
  return <Studio />
}
