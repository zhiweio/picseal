import { getTranslations } from 'next-intl/server'

export default async function AboutPage({
  params
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'landing' })

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="rule-heavy pb-3 text-[20px] font-bold tracking-[1px]">PICSEAL</h1>
      <p className="mt-6 text-[13px] leading-relaxed text-muted">{t('heroSub')}</p>
      <div className="mt-10 grid gap-6 text-[13px] leading-relaxed text-muted">
        <p>{t('localDesc')}</p>
        <p>{t('batchDesc')}</p>
        <p>{t('exifDesc')}</p>
      </div>
      <p className="mt-12 text-[11px] tracking-[2px] text-muted/70">
        MI · LEICA · NIKON · SONY · FUJIFILM — CAMERA WATERMARK AESTHETICS
      </p>
    </main>
  )
}
