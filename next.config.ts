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
    // 本地兜底路径的 immutable 缓存（生产可整体切到 R2 CDN，见 docs/media-cdn.md）；
    // 内容更新必须换文件名（样片名/GLB 的 ?v= 哈希），否则客户端拿不到新资源
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
      source: '/cinema/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]
    },
    {
      source: '/audio/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]
    },
    {
      source: '/assets/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]
    }
  ]
}

export default withNextIntl(nextConfig)
