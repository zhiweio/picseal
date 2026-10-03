import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  // dev 与生产各用独立产物目录：next dev 会清理/改写 .next/server 下的
  // 生产 chunks，若共用目录，正在运行的 next start 会报 Cannot find module
  distDir: process.env.NODE_ENV === 'production' ? '.next' : '.next-dev',
  // standalone 产物仅供 Docker 镜像使用（Dockerfile 里 COPY .next/standalone）；
  // 本地构建保持默认输出，next start 才能直接运行
  ...(process.env.BUILD_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
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
