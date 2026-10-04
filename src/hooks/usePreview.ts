'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { WatermarkTemplate } from '@/core/types'
import type { PhotoItem } from '@/stores/photos'
import { BlobUrlCache } from '@/lib/preview-cache'
import { getRenderPool } from '@/workers/pool'
import { getResizeKernel } from '@/core/render/resize-kernel'

export interface PreviewResult {
  url: string
  width: number
  height: number
  /** 照片在输出画布中的实际绘制矩形（canvas 像素），A/B 原图层对位用 */
  photoRect: { x: number; y: number; w: number; h: number }
}

/** 预览结果 LRU：键 photoId+templateJson，最多 12 条；URL 由缓存独占管理 */
const cache = new BlobUrlCache<PreviewResult>({
  max: 12,
  getUrl: (v) => v.url
})

function cacheKey(photo: PhotoItem, template: WatermarkTemplate): string {
  return `${photo.id}|${JSON.stringify(template)}`
}

export function clearPreviewCache(): void {
  cache.clear()
}

/**
 * 实时预览管线：防抖 160ms + 代际戳丢弃过期结果 + LRU 缓存。
 * 返回 null 表示首帧尚未就绪（调用方显示占位）。
 * invalidate：图片加载失败（URL 失效）时踢出缓存并强制重渲染的自愈路径。
 */
export function usePreview(
  photo: PhotoItem | undefined,
  template: WatermarkTemplate,
  maxLongEdge = 2560
): { preview: PreviewResult | null; rendering: boolean; invalidate: () => void } {
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [rendering, setRendering] = useState(false)
  const [nonce, setNonce] = useState(0)
  const generation = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!photo) {
      setPreview(null)
      setRendering(false)
      return
    }

    const key = cacheKey(photo, template)
    const cached = cache.get(key)
    if (cached) {
      setPreview(cached)
      setRendering(false)
      return
    }

    setRendering(true)
    const gen = (generation.current += 1)

    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void getRenderPool()
        .run({
          kind: 'preview',
          file: photo.file,
          meta: photo.meta ?? {},
          template,
          maxLongEdge,
          resizeKernel: getResizeKernel()
        })
        .then((res) => {
          if (gen !== generation.current) return // 过期结果丢弃
          if (res.ok && res.kind === 'preview') {
            const value = {
              url: URL.createObjectURL(res.blob),
              width: res.width,
              height: res.height,
              photoRect: res.photoRect
            }
            cache.set(key, value)
            setPreview(value)
          }
          if (gen === generation.current) setRendering(false)
        })
        .catch(() => {
          if (gen === generation.current) setRendering(false)
        })
    }, 160)

    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [photo, template, maxLongEdge, nonce])

  const invalidate = useCallback(() => {
    if (!photo) return
    cache.delete(cacheKey(photo, template))
    setPreview(null)
    setNonce((n) => n + 1)
  }, [photo, template])

  return { preview, rendering, invalidate }
}

/** 模板小样（模板列表的实时缩略渲染），独立轻缓存；淘汰不吊销（缩略图被面板长期持有） */
const miniCache = new BlobUrlCache<string>({
  max: 24,
  getUrl: (v) => v,
  revokeOnEvict: false
})

export async function renderMiniPreview(
  photo: PhotoItem,
  template: WatermarkTemplate,
  longEdge = 220
): Promise<string | undefined> {
  const key = `${photo.id}|${template.id}|mini`
  const hit = miniCache.get(key)
  if (hit) return hit
  try {
    const res = await getRenderPool().run({
      kind: 'preview',
      file: photo.file,
      meta: photo.meta ?? {},
      template,
      maxLongEdge: longEdge
    })
    if (res.ok && res.kind === 'preview') {
      const url = URL.createObjectURL(res.blob)
      miniCache.set(key, url)
      return url
    }
  } catch {
    return undefined
  }
  return undefined
}

export function clearMiniCache(): void {
  miniCache.clear()
}
