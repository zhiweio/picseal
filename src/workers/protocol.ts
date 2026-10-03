import type { OutputSettings, PhotoMeta, WatermarkTemplate } from '@/core/types'

/** 主线程 → worker 请求 */
export type WorkerRequest =
  | {
      id: string
      kind: 'thumbnail'
      file: File
      longEdge: number
    }
  | {
      id: string
      kind: 'preview'
      file: File
      meta: PhotoMeta
      template: WatermarkTemplate
      maxLongEdge: number
      /** 重采样内核（全局配置经主线程下发） */
      resizeKernel?: 'halving' | 'pica'
    }
  | {
      id: string
      kind: 'export'
      photoId: string
      file: File
      meta: PhotoMeta
      template: WatermarkTemplate
      settings: OutputSettings
      /** 原始文件嗅探类型（EXIF 拷贝用），如 'jpeg' / 'heif' */
      sourceType: string
      index: number
      /** 重采样内核（全局配置经主线程下发） */
      resizeKernel?: 'halving' | 'pica'
    }

/** worker → 主线程响应 */
export type WorkerResponse =
  | {
      id: string
      ok: true
      kind: 'thumbnail'
      blob: Blob
      width: number
      height: number
    }
  | {
      id: string
      ok: true
      kind: 'preview'
      blob: Blob
      width: number
      height: number
    }
  | {
      id: string
      ok: true
      kind: 'export'
      blob: Blob
      /** 输出文件名建议（含扩展名） */
      filename: string
    }
  | {
      id: string
      ok: false
      error: string
    }
