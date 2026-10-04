'use client'

import { clear, createStore, del, entries, set, type UseStore } from 'idb-keyval'
import type { PhotoMeta } from '@/core/types'

/**
 * 个人档案馆持久化 —— 仅缩略图（≤320px JPEG）与 EXIF 摘要，全部留在本机 IndexedDB。
 * 原片 File 句柄只在会话内存活（见 src/stores/portfolio.ts），刷新后无原片也能重建档案墙。
 */

const DB_NAME = 'picseal-portfolio'
const STORE = 'thumbs'

export interface PortfolioThumbRecord {
  /** 收录顺序（跨会话稳定排序） */
  seq: number
  name: string
  size: number
  blob: Blob
  width: number
  height: number
  meta?: PhotoMeta
}

let thumbStore: UseStore | undefined
/** 懒创建：模块在 SSR 也会求值，避免服务端触碰 indexedDB（同 cinema-assets 模式） */
function store(): UseStore {
  thumbStore ??= createStore(DB_NAME, STORE)
  return thumbStore
}

export async function savePortfolioThumb(id: string, record: PortfolioThumbRecord): Promise<void> {
  await set(id, record, store())
}

export async function loadPortfolioAll(): Promise<Array<{ id: string; record: PortfolioThumbRecord }>> {
  const all = (await entries(store())) as Array<[IDBValidKey, PortfolioThumbRecord]>
  return all
    .filter(([, record]) => record && typeof record.blob === 'object' && record.blob instanceof Blob)
    .map(([id, record]) => ({ id: String(id), record }))
    .sort((a, b) => a.record.seq - b.record.seq)
}

export async function removePortfolioThumb(id: string): Promise<void> {
  await del(id, store())
}

export async function clearPortfolioStore(): Promise<void> {
  await clear(store())
}
