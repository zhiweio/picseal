import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: [],
  headers: async () => [
    {
      source: '/samples/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]
    },
    {
      source: '/brands/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]
    },
    {
      source: '/fonts/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]
    },
    {
      source: '/wasm/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]
    }
  ]
}

export default withNextIntl(nextConfig)
