import type { MetadataRoute } from 'next'

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://picseal.zhiweio.me'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    { url: `${BASE}/zh`, lastModified: now, changeFrequency: 'monthly', priority: 1 },
    { url: `${BASE}/en`, lastModified: now, changeFrequency: 'monthly', priority: 1 },
    { url: `${BASE}/zh/studio`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${BASE}/en/studio`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 }
  ]
}
