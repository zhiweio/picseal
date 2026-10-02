'use client'

import { useEffect, useRef, useState } from 'react'
import type { WatermarkTemplate } from '@/core/types'
import type { PhotoItem } from '@/stores/photos'
import { getRenderPool } from '@/workers/pool'

export interface PreviewResult {
  url: string
  width: number
  height: number
}

/** 预览结果 LRU：键 photoId+templateJson，最多 12 条 */
const cache = new Map<string, PreviewResult>()
const CACHE_MAX = 12

function cacheKey(photo: PhotoItem, template: WatermarkTemplate): string {
  return `${photo.id}|${JSON.stringify(template)}`
}

function cacheGet(key: string): PreviewResult | undefined {
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
  }
  return hit
}

function cacheSet(key: string, value: PreviewResult): void {
  cache.set(key, value)
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) {
      const stale = cache.get(oldest)
      if (stale) URL.revokeObjectURL(stale.url)
      cache.delete(oldest)
    }
  }
}

export function clearPreviewCache(): void {
  for (const item of cache.values()) URL.revokeObjectURL(item.url)
  cache.clear()
}

/**
 * 实时预览管线：防抖 160ms + 代际戳丢弃过期结果 + LRU 缓存。
 * 返回 null 表示首帧尚未就绪（调用方显示占位）。
 */
export function usePreview(
  photo: PhotoItem | undefined,
  template: WatermarkTemplate,
  maxLongEdge = 2200
): { preview: PreviewResult | null; rendering: boolean } {
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [rendering, setRendering] = useState(false)
  const generation = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!photo) {
      setPreview(null)
      setRendering(false)
      return
    }

    const key = cacheKey(photo, template)
    const cached = cacheGet(key)
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
          maxLongEdge
        })
        .then((res) => {
          if (gen !== generation.current) return // 过期结果丢弃
          if (res.ok && res.kind === 'preview') {
            if (urlRef.current) URL.revokeObjectURL(urlRef.current)
            const url = URL.createObjectURL(res.blob)
            urlRef.current = url
            const value = { url, width: res.width, height: res.height }
            cacheSet(key, value)
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
  }, [photo, template, maxLongEdge])

  return { preview, rendering }
}

/** 模板小样（模板列表的实时缩略渲染），独立轻缓存 */
const miniCache = new Map<string, string>()

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
      if (miniCache.size > 24) {
        const oldest = miniCache.keys().next().value
        if (oldest) {
          const stale = miniCache.get(oldest)
          if (stale) URL.revokeObjectURL(stale)
          miniCache.delete(oldest)
        }
      }
      return url
    }
  } catch {
    return undefined
  }
  return undefined
}

export function clearMiniCache(): void {
  for (const url of miniCache.values()) URL.revokeObjectURL(url)
  miniCache.clear()
}
