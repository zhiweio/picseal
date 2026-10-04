'use client'

import { create } from 'zustand'
import { readPhotoMeta } from '@/core/exif/reader'
import type { PhotoMeta } from '@/core/types'
import { sortByCaptureTime } from '@/core/order'
import { getRenderPool } from '@/workers/pool'
import type { WorkerResponse } from '@/workers/protocol'

export type MetaStatus = 'pending' | 'ok' | 'none'

/** 候选栏排序模式：import = 上传顺序（默认），captureTime = 拍摄时间正序 */
export type PhotoSortMode = 'import' | 'captureTime'

export interface PhotoItem {
  id: string
  file: File
  name: string
  size: number
  /** 缩略图 objectURL（320px），主线程生成 */
  thumbUrl?: string
  thumbW?: number
  thumbH?: number
  meta?: PhotoMeta
  metaStatus: MetaStatus
  /** 扩展名嗅探的类型（EXIF 拷贝用） */
  sourceType?: string
  selected: boolean
}

/** 应用支持的输入格式（解码能力见 README 格式矩阵） */
const SUPPORTED_EXT: Record<string, string> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  avif: 'heif', // isobmff 家族，EXIF 拷贝按 heif 处理
  heic: 'heif',
  heif: 'heif',
  hif: 'heif',
  tif: 'tiff',
  tiff: 'tiff'
}

export function sourceTypeOf(name: string): string | undefined {
  return SUPPORTED_EXT[name.toLowerCase().split('.').pop() ?? '']
}

interface PhotosState {
  items: PhotoItem[]
  currentId: string | null
  /** 样片（调样基准），默认第一张 */
  sampleId: string | null
  importing: boolean
  importedCount: number
  /** 候选栏排序模式（会话级，默认上传顺序；仅影响显示序，items 物理序由上传/拖拽决定） */
  sortMode: PhotoSortMode
  addFiles: (files: File[]) => Promise<ImportedSummary>
  remove: (id: string) => void
  clear: () => void
  setCurrent: (id: string | null) => void
  toggleSelected: (id: string, value?: boolean) => void
  selectAll: (value: boolean) => void
  setSortMode: (mode: PhotoSortMode) => void
  /** 以给定 id 全序重排 items（拖拽自定义顺序；id 集合必须与 items 一致） */
  reorderIds: (ids: string[]) => void
  current: () => PhotoItem | undefined
}

/** 候选栏显示序：captureTime 模式按拍摄时间正序（无时间沉底），否则保持物理序 */
export function photoDisplayOrder(state: { items: PhotoItem[]; sortMode: PhotoSortMode }): PhotoItem[] {
  return state.sortMode === 'captureTime' ? sortByCaptureTime(state.items) : state.items
}

export interface ImportedSummary {
  added: number
  skipped: number
}

let seq = 0

export const usePhotos = create<PhotosState>((set, get) => ({
  items: [],
  currentId: null,
  sampleId: null,
  importing: false,
  importedCount: 0,
  sortMode: 'import',

  addFiles: async (files) => {
    const pool = getRenderPool()
    const accepted: PhotoItem[] = []
    let skipped = 0

    for (const file of files) {
      const type = sourceTypeOf(file.name)
      if (!type) {
        skipped += 1
        continue
      }
      seq += 1
      accepted.push({
        id: `p${seq}_${file.name}`,
        file,
        name: file.name,
        size: file.size,
        metaStatus: 'pending',
        sourceType: type,
        selected: false
      })
    }

    if (accepted.length === 0) {
      return { added: 0, skipped }
    }

    set((state) => {
      const isFirstBatch = state.items.length === 0
      return {
        items: [...state.items, ...accepted],
        importing: true,
        importedCount: state.importedCount + accepted.length,
        currentId: isFirstBatch ? accepted[0]!.id : state.currentId,
        sampleId: isFirstBatch ? accepted[0]!.id : state.sampleId
      }
    })

    // 缩略图 + EXIF 解析流水线（worker 池并行，FIFO）
    for (const item of accepted) {
      const exists = () => get().items.some((p) => p.id === item.id)
      if (!exists()) continue

      void pool
        .run({ kind: 'thumbnail', file: item.file, longEdge: 320 })
        .then((res: WorkerResponse) => {
          if (res.ok && res.kind === 'thumbnail' && exists()) {
            set((state) => ({
              items: state.items.map((p) =>
                p.id === item.id
                  ? { ...p, thumbUrl: URL.createObjectURL(res.blob), thumbW: res.width, thumbH: res.height }
                  : p
              )
            }))
          }
        })
        .catch(() => {
          /* 缩略图失败不阻断导入，列表占位显示 */
        })

      void readPhotoMeta(item.file)
        .then((meta) => {
          if (!exists()) return
          set((state) => ({
            items: state.items.map((p) =>
              p.id === item.id
                ? { ...p, meta, metaStatus: Object.keys(meta).length > 2 ? 'ok' : 'none' }
                : p
            )
          }))
        })
        .catch(() => {
          if (!exists()) return
          set((state) => ({
            items: state.items.map((p) =>
              p.id === item.id ? { ...p, metaStatus: 'none' } : p
            )
          }))
        })
    }

    set({ importing: false })
    return { added: accepted.length, skipped }
  },

  remove: (id) =>
    set((state) => {
      const items = state.items.filter((p) => p.id !== id)
      const removed = state.items.find((p) => p.id === id)
      if (removed?.thumbUrl) URL.revokeObjectURL(removed.thumbUrl)
      const currentId =
        state.currentId === id ? (items[0]?.id ?? null) : state.currentId
      const sampleId = state.sampleId === id ? (items[0]?.id ?? null) : state.sampleId
      return { items, currentId, sampleId }
    }),

  clear: () => {
    for (const p of get().items) {
      if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl)
    }
    set({ items: [], currentId: null, sampleId: null, importedCount: 0 })
  },

  setCurrent: (id) => set({ currentId: id }),

  toggleSelected: (id, value) =>
    set((state) => ({
      items: state.items.map((p) =>
        p.id === id ? { ...p, selected: value ?? !p.selected } : p
      )
    })),

  selectAll: (value) =>
    set((state) => ({ items: state.items.map((p) => ({ ...p, selected: value })) })),

  setSortMode: (mode) => set({ sortMode: mode }),

  reorderIds: (ids) =>
    set((state) => {
      if (ids.length !== state.items.length) return state
      const wanted = new Set(ids)
      if (state.items.some((p) => !wanted.has(p.id))) return state
      const byId = new Map(state.items.map((p) => [p.id, p]))
      return { items: ids.map((id) => byId.get(id)!) }
    }),

  current: () => {
    const state = get()
    return state.items.find((p) => p.id === state.currentId)
  }
}))
