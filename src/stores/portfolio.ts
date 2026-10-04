'use client'

import { create } from 'zustand'
import { readPhotoMeta } from '@/core/exif/reader'
import type { PhotoMeta } from '@/core/types'
import { getRenderPool } from '@/workers/pool'
import type { WorkerResponse } from '@/workers/protocol'
import {
  PORTFOLIO_THRESHOLD,
  PORTFOLIO_WALL_CAP,
  dedupeKeyOf,
  filterPortfolioFiles
} from '@/lib/portfolio'
import { clearPortfolioStore, loadPortfolioAll, savePortfolioThumb } from '@/lib/portfolio-assets'

export type PortfolioMetaStatus = 'pending' | 'ok' | 'none'

export interface PortfolioItem {
  id: string
  name: string
  size: number
  /** 原片句柄，仅会话内有效（IndexedDB 只存缩略图；恢复会话无此字段） */
  file?: File
  thumbUrl?: string
  thumbW?: number
  thumbH?: number
  meta?: PhotoMeta
  metaStatus: PortfolioMetaStatus
  /** 收录顺序（持久化后跨会话稳定） */
  seq: number
}

interface PortfolioState {
  items: PortfolioItem[]
  /** IndexedDB 恢复完成（无论有没有历史档案） */
  hydrated: boolean
  /** 入馆版本号：>0 表示档案墙当前以用户作品为源；追加录入重新入馆时递增 */
  committedVersion: number
  /** 缩略图流水线在途数量（入馆提交等它清零再落版本号） */
  pendingThumbs: number
  /** 已请求入馆、等待流水线清零 */
  commitRequested: boolean
  /** 本会话累计跳过数（非图片 + 重复） */
  skippedCount: number
  hydrate: () => Promise<void>
  addFiles: (files: File[]) => Promise<void>
  commit: () => void
  clear: () => Promise<void>
}

let seq = 0

export const usePortfolio = create<PortfolioState>((set, get) => {
  /** 在途缩略图结算：清零且有挂起的入馆请求时落版本号（档案墙随之重建） */
  const settlePending = (n = 1): void => {
    set((s) => {
      const pendingThumbs = Math.max(0, s.pendingThumbs - n)
      const flush = s.commitRequested && pendingThumbs === 0
      return {
        pendingThumbs,
        commitRequested: false,
        committedVersion: flush ? s.committedVersion + 1 : s.committedVersion
      }
    })
  }

  return {
    items: [],
    hydrated: false,
    committedVersion: 0,
    pendingThumbs: 0,
    commitRequested: false,
    skippedCount: 0,

    hydrate: async () => {
      if (get().hydrated) return
      try {
        const loaded = await loadPortfolioAll()
        if (loaded.length === 0) {
          set({ hydrated: true })
          return
        }
        const items: PortfolioItem[] = loaded.map(({ id, record }) => {
          seq = Math.max(seq, record.seq)
          return {
            id,
            name: record.name,
            size: record.size,
            thumbUrl: URL.createObjectURL(record.blob),
            thumbW: record.width,
            thumbH: record.height,
            meta: record.meta,
            metaStatus: record.meta
              ? Object.keys(record.meta).length > 2
                ? 'ok'
                : 'none'
              : 'none',
            seq: record.seq
          }
        })
        set((s) => ({
          items,
          hydrated: true,
          committedVersion: items.length >= PORTFOLIO_THRESHOLD ? Math.max(s.committedVersion, 1) : s.committedVersion
        }))
      } catch {
        set({ hydrated: true })
      }
    },

    addFiles: async (files) => {
      const existing = new Set(get().items.map((i) => dedupeKeyOf(i)))
      const { accepted, skipped, duplicates } = filterPortfolioFiles(files, existing)
      if (accepted.length === 0) {
        if (skipped + duplicates > 0)
          set((s) => ({ skippedCount: s.skippedCount + skipped + duplicates }))
        return
      }

      const stamped: PortfolioItem[] = accepted.map((file) => {
        seq += 1
        return {
          id: `f${seq}_${file.name}`,
          name: file.name,
          size: file.size,
          file,
          metaStatus: 'pending',
          seq
        }
      })
      set((s) => ({
        items: [...s.items, ...stamped],
        skippedCount: s.skippedCount + skipped + duplicates,
        pendingThumbs: s.pendingThumbs + stamped.length
      }))

      const startPos = get().items.length - stamped.length
      // 超出墙容量的尾部只计数不出缩略图（门槛 120 远小于容量，仅极端大批量触达）
      const overCap = stamped.reduce(
        (acc, _, offset) => acc + (startPos + offset >= PORTFOLIO_WALL_CAP ? 1 : 0),
        0
      )
      if (overCap > 0) settlePending(overCap)

      const pool = getRenderPool()
      for (const [offset, item] of stamped.entries()) {
        if (startPos + offset >= PORTFOLIO_WALL_CAP || !item.file) continue
        const exists = (): boolean => get().items.some((p) => p.id === item.id)

        void pool
          .run({ kind: 'thumbnail', file: item.file, longEdge: 320 })
          .then(async (res: WorkerResponse) => {
            if (!exists() || !(res.ok && res.kind === 'thumbnail')) {
              settlePending()
              return
            }
            const thumbUrl = URL.createObjectURL(res.blob)
            let meta: PhotoMeta | undefined
            let metaStatus: PortfolioMetaStatus = 'none'
            try {
              meta = await readPhotoMeta(item.file!)
              metaStatus = Object.keys(meta).length > 2 ? 'ok' : 'none'
            } catch {
              /* 元数据失败不影响收录 */
            }
            if (!exists()) {
              URL.revokeObjectURL(thumbUrl)
              settlePending()
              return
            }
            set((s) => ({
              items: s.items.map((p) =>
                p.id === item.id
                  ? { ...p, thumbUrl, thumbW: res.width, thumbH: res.height, meta, metaStatus }
                  : p
              )
            }))
            void savePortfolioThumb(item.id, {
              seq: item.seq,
              name: item.name,
              size: item.size,
              blob: res.blob,
              width: res.width,
              height: res.height,
              meta
            }).catch(() => undefined)
            settlePending()
          })
          .catch(() => {
            settlePending()
          })
      }
    },

    commit: () => {
      const s = get()
      if (s.items.length < PORTFOLIO_THRESHOLD || s.commitRequested) return
      if (s.pendingThumbs === 0) {
        set({ committedVersion: s.committedVersion + 1 })
        return
      }
      set({ commitRequested: true })
    },

    clear: async () => {
      for (const p of get().items) {
        if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl)
      }
      set({
        items: [],
        committedVersion: 0,
        pendingThumbs: 0,
        commitRequested: false,
        skippedCount: 0
      })
      await clearPortfolioStore().catch(() => undefined)
    }
  }
})
