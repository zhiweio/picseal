'use client'

import { create } from 'zustand'
import type { OutputSettings, WatermarkTemplate } from '@/core/types'
import { getRenderPool, TaskCancelled } from '@/workers/pool'
import type { WorkerResponse } from '@/workers/protocol'
import { sourceTypeOf, usePhotos, type PhotoItem } from '@/stores/photos'

export type FrameStatus = 'pending' | 'rendering' | 'done' | 'failed' | 'cancelled'

export interface QueueFrame {
  photoId: string
  name: string
  status: FrameStatus
  filename?: string
  blob?: Blob
  resultSize?: number
  error?: string
}

interface QueueState {
  frames: QueueFrame[]
  running: boolean
  paused: boolean
  /** 冻结的配置快照 —— 批次运行期间 UI 锁定依据 */
  snapshot: { template: WatermarkTemplate; settings: OutputSettings; label: string } | null
  startedAt: number | null
  finishedAt: number | null
  /** 打包下载进度 */
  packing: boolean
  packedCount: number

  start: (photos: PhotoItem[], template: WatermarkTemplate, settings: OutputSettings, label: string) => void
  pause: () => void
  resume: () => void
  cancel: () => void
  retryFailed: () => void
  reset: () => void
  setPacking: (packing: boolean, count?: number) => void
}

export function queueSummary(frames: QueueFrame[]) {
  const done = frames.filter((f) => f.status === 'done').length
  const failed = frames.filter((f) => f.status === 'failed').length
  const pending = frames.filter(
    (f) => f.status === 'pending' || f.status === 'rendering'
  ).length
  const settled = done + failed
  return { done, failed, pending, total: frames.length, settled }
}

function findPhoto(id: string): PhotoItem | undefined {
  return usePhotos.getState().items.find((p) => p.id === id)
}

export const useQueue = create<QueueState>((set, get) => {
  const updateFrame = (photoId: string, patch: Partial<QueueFrame>) =>
    set((state) => ({
      frames: state.frames.map((f) => (f.photoId === photoId ? { ...f, ...patch } : f))
    }))

  const runOne = (
    photo: PhotoItem,
    template: WatermarkTemplate,
    settings: OutputSettings,
    index: number
  ): Promise<void> => {
    updateFrame(photo.id, { status: 'rendering', error: undefined })
    return getRenderPool()
      .run({
        kind: 'export',
        photoId: photo.id,
        file: photo.file,
        meta: photo.meta ?? {},
        template,
        settings,
        sourceType: photo.sourceType ?? sourceTypeOf(photo.name) ?? 'jpeg',
        index
      })
      .then((res: WorkerResponse) => {
        if (res.ok && res.kind === 'export') {
          updateFrame(photo.id, {
            status: 'done',
            blob: res.blob,
            filename: res.filename,
            resultSize: res.blob.size
          })
        } else {
          updateFrame(photo.id, { status: 'failed', error: 'unexpected response' })
        }
      })
      .catch((err: Error) => {
        updateFrame(photo.id, {
          status: err instanceof TaskCancelled ? 'cancelled' : 'failed',
          error: err instanceof TaskCancelled ? undefined : err.message
        })
      })
  }

  const settleIfIdle = () => {
    const busy = get().frames.some((f) => f.status === 'rendering' || f.status === 'pending')
    if (!busy) set({ running: false, finishedAt: Date.now() })
  }

  return {
    frames: [],
    running: false,
    paused: false,
    snapshot: null,
    startedAt: null,
    finishedAt: null,
    packing: false,
    packedCount: 0,

    start: (photos, template, settings, label) => {
      if (photos.length === 0) return
      set({
        frames: photos.map((p) => ({ photoId: p.id, name: p.name, status: 'pending' })),
        running: true,
        paused: false,
        finishedAt: null,
        startedAt: Date.now(),
        snapshot: { template, settings, label }
      })

      // 全部派发进池（池内 FIFO 排队），完成/失败逐帧更新
      void Promise.all(
        photos.map((photo, index) => runOne(photo, template, settings, index))
      ).then(() => {
        set({ running: false, finishedAt: Date.now() })
      })
    },

    pause: () => {
      const pendingIds = new Set(
        get().frames.filter((f) => f.status === 'pending').map((f) => f.photoId)
      )
      getRenderPool().cancelQueued(
        (req) => req.kind === 'export' && pendingIds.has(req.photoId)
      )
      set({ paused: true })
      set((state) => ({
        frames: state.frames.map((f) =>
          f.status === 'pending' ? { ...f, status: 'cancelled' } : f
        )
      }))
      settleIfIdle()
    },

    resume: () => set({ paused: false }),

    cancel: () => {
      getRenderPool().cancelQueued((req) => req.kind === 'export')
      set((state) => ({
        frames: state.frames.map((f) =>
          f.status === 'pending' || f.status === 'rendering'
            ? { ...f, status: 'cancelled' }
            : f
        )
      }))
      settleIfIdle()
    },

    retryFailed: () => {
      const state = get()
      const snapshot = state.snapshot
      if (!snapshot) return
      const failedFrames = state.frames.filter((f) => f.status === 'failed')
      if (failedFrames.length === 0) return

      set((s) => ({
        running: true,
        finishedAt: null,
        frames: s.frames.map((f) =>
          f.status === 'failed' ? { ...f, status: 'pending', error: undefined } : f
        )
      }))

      void Promise.all(
        failedFrames.map((frame, i) => {
          const photo = findPhoto(frame.photoId)
          if (!photo) {
            updateFrame(frame.photoId, { status: 'failed', error: 'photo not found' })
            return Promise.resolve()
          }
          return runOne(photo, snapshot.template, snapshot.settings, i)
        })
      ).then(() => {
        set({ running: false, finishedAt: Date.now() })
      })
    },

    reset: () =>
      set({
        frames: [],
        running: false,
        paused: false,
        snapshot: null,
        startedAt: null,
        finishedAt: null,
        packing: false,
        packedCount: 0
      }),

    setPacking: (packing, count) =>
      set((state) => ({ packing, packedCount: count ?? state.packedCount }))
  }
})
