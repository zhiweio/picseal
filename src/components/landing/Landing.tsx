'use client'

import { useTranslations } from 'next-intl'
import { Cpu, Layers, Fingerprint } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { HeroWall } from './HeroWall'
import { LangToggle, ThemeToggle } from '@/components/Toggles'

/** 落地页：3D 档案墙 hero + 三段能力说明 + 模板带 + 页脚 */
export function Landing() {
  const t = useTranslations()

  return (
    <main className="min-h-screen">
      <HeroWall />

      {/* 能力三段：以内容规则线分组，非卡片阵列 */}
      <section className="mx-auto max-w-4xl px-6 py-20">
        <div className="rule-heavy mb-10 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold tracking-[1px]">{t('landing.templatesTitle')}</h2>
          <span className="hud-label">{t('landing.templatesSub')}</span>
        </div>
        <div className="grid gap-x-10 gap-y-8 sm:grid-cols-3">
          <Feature
            icon={<Cpu size={15} />}
            title={t('landing.localTitle')}
            desc={t('landing.localDesc')}
          />
          <Feature
            icon={<Layers size={15} />}
            title={t('landing.batchTitle')}
            desc={t('landing.batchDesc')}
          />
          <Feature
            icon={<Fingerprint size={15} />}
            title={t('landing.exifTitle')}
            desc={t('landing.exifDesc')}
          />
        </div>
        <div className="mt-12 flex justify-center">
          <Link
            href="/studio"
            className="flex h-11 items-center bg-ink px-8 text-[13px] font-medium tracking-[2px] text-page transition-opacity hover:opacity-85"
          >
            {t('landing.startCta').toUpperCase()}
          </Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-6 py-8">
          <div className="flex items-baseline gap-3">
            <span className="text-[13px] font-bold tracking-[3px]">PICSEAL</span>
            <span className="hud-label">PHOTO ARCHIVE TERMINAL</span>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-muted">
            <a
              href="https://github.com/zhiweio/picseal"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-ink"
            >
              {t('landing.footerRepo')}
            </a>
            <a
              href="https://github.com/zhiweio/picseal#self-hosting"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-ink"
            >
              {t('landing.footerDeploy')}
            </a>
            <ThemeToggle />
            <LangToggle />
          </div>
        </div>
      </footer>
    </main>
  )
}

function Feature({
  icon,
  title,
  desc
}: {
  icon: React.ReactNode
  title: string
  desc: string
}) {
  return (
    <article>
      <div className="mb-2 flex items-center gap-2 text-accent">
        {icon}
        <h3 className="text-[13px] font-semibold tracking-[1px] text-ink">{title}</h3>
      </div>
      <p className="text-[12px] leading-relaxed text-muted">{desc}</p>
    </article>
  )
}
