/**
 * 演示媒体 URL 解析 —— 样片 / 放映室影音 / 水印字体 / 品牌 logo / GLB / BGM
 * 这些随仓库分发的静态媒体可整体切换到对象存储 CDN（Cloudflare R2）：
 * 构建期注入 NEXT_PUBLIC_MEDIA_BASE 后，根相对路径改写为绝对 CDN URL；
 * 未设置时原样返回，本地 public/ 兜底（Docker 镜像仍自带全部媒体）。
 * 用户照片 / 作品集永远不走此路径（隐私红线：照片永不上传）。
 */
const MEDIA_BASE = (process.env.NEXT_PUBLIC_MEDIA_BASE ?? '').replace(/\/+$/, '')

export function mediaUrl(path: string): string {
  if (!MEDIA_BASE || !path.startsWith('/') || path.startsWith('/_next/')) return path
  return MEDIA_BASE + path
}
