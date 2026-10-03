'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'

export type ResizeKernel = 'halving' | 'pica'

export const DEFAULT_PREFS = {
  musicPref: true,
  cinemaMedia: { intro: true, music: true },
  resizeKernel: 'pica'
} as const

/** 偏好项持久化信封键（收编原 picseal-music / picseal-cinema-media / picseal-resize-kernel） */
export const PREFS_STORAGE_KEY = 'picseal-prefs'

const LEGACY_KEYS = ['picseal-music', 'picseal-cinema-media', 'picseal-resize-kernel'] as const

export interface PreferencesState {
  /** 首页背景音乐自动起播偏好（原 picseal-music：'on' | 'off'） */
  musicPref: boolean
  /** 放映室片头/配乐启用开关（原 picseal-cinema-media） */
  cinemaMedia: { intro: boolean; music: boolean }
  /** 预览/导出重采样内核（原 picseal-resize-kernel） */
  resizeKernel: ResizeKernel
  setMusicPref: (on: boolean) => void
  toggleCinemaMedia: (key: 'intro' | 'music') => void
  setResizeKernel: (kernel: ResizeKernel) => void
}

const persistedPrefsSchema = z.object({
  musicPref: z.boolean().optional(),
  cinemaMedia: z
    .object({ intro: z.boolean().default(true), music: z.boolean().default(true) })
    .optional(),
  resizeKernel: z.enum(['halving', 'pica']).optional()
})

/**
 * 纯函数：从旧散装 key 读出偏好快照。任一旧 key 存在即返回（缺失字段留空，
 * 由 merge 的 zod 容错补默认）；全部缺失返回 null。无法解析的值直接忽略。
 */
export function readLegacyPrefs(
  getItem: (key: string) => string | null
): Partial<Omit<PreferencesState, 'setMusicPref' | 'toggleCinemaMedia' | 'setResizeKernel'>> | null {
  const music = getItem('picseal-music')
  const cinema = getItem('picseal-cinema-media')
  const kernel = getItem('picseal-resize-kernel')
  if (music == null && cinema == null && kernel == null) return null

  const snapshot: Partial<Omit<PreferencesState, 'setMusicPref' | 'toggleCinemaMedia' | 'setResizeKernel'>> = {}
  if (music === 'on') snapshot.musicPref = true
  if (music === 'off') snapshot.musicPref = false
  if (cinema) {
    try {
      const parsed = JSON.parse(cinema) as { intro?: unknown; music?: unknown }
      snapshot.cinemaMedia = {
        intro: typeof parsed.intro === 'boolean' ? parsed.intro : true,
        music: typeof parsed.music === 'boolean' ? parsed.music : true
      }
    } catch {
      /* 坏 JSON 视为无此偏好 */
    }
  }
  if (kernel === 'halving' || kernel === 'pica') snapshot.resizeKernel = kernel
  return snapshot
}

/**
 * 一次性迁移：老版本的三个独立 key → picseal-prefs 信封。须在 store 创建前
 * 同步执行（persist 的水合在创建后的微任务里读 storage）。已存在信封则只清旧 key。
 */
export function seedFromLegacyPrefs(): void {
  try {
    const storage = globalThis.localStorage
    if (!storage) return
    if (storage.getItem(PREFS_STORAGE_KEY) == null) {
      const snapshot = readLegacyPrefs((k) => storage.getItem(k))
      if (snapshot) {
        storage.setItem(
          PREFS_STORAGE_KEY,
          JSON.stringify({ state: snapshot, version: 1 })
        )
      }
    }
    for (const key of LEGACY_KEYS) storage.removeItem(key)
  } catch {
    /* localStorage 不可用（隐私模式等），store 走默认值 */
  }
}

if (typeof window !== 'undefined') seedFromLegacyPrefs()

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      musicPref: DEFAULT_PREFS.musicPref,
      cinemaMedia: { ...DEFAULT_PREFS.cinemaMedia },
      resizeKernel: DEFAULT_PREFS.resizeKernel,

      setMusicPref: (on) => set({ musicPref: on }),

      toggleCinemaMedia: (key) =>
        set((state) => ({
          cinemaMedia: { ...state.cinemaMedia, [key]: !state.cinemaMedia[key] }
        })),

      setResizeKernel: (kernel) => set({ resizeKernel: kernel })
    }),
    {
      name: PREFS_STORAGE_KEY,
      version: 1,
      partialize: (state) => ({
        musicPref: state.musicPref,
        cinemaMedia: state.cinemaMedia,
        resizeKernel: state.resizeKernel
      }),
      migrate: (persisted) => persisted,
      merge: (persisted, current) => {
        const parsed = persistedPrefsSchema.safeParse(persisted)
        if (!parsed.success) return current
        const next = { ...current }
        if (parsed.data.musicPref !== undefined) next.musicPref = parsed.data.musicPref
        if (parsed.data.cinemaMedia !== undefined) next.cinemaMedia = parsed.data.cinemaMedia
        if (parsed.data.resizeKernel !== undefined) next.resizeKernel = parsed.data.resizeKernel
        return next
      }
    }
  )
)
