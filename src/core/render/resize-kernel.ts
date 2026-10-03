/**
 * 重采样内核全局配置（主线程）——"渐进半缩"与 "pica Lanczos" 双内核自由切换。
 * 经 localStorage 持久化；worker 侧通过渲染请求逐次下发（worker 无 localStorage）。
 * 实时读取：切换后下一次渲染即生效，无需刷新。
 */
export type ResizeKernel = 'halving' | 'pica'

const KEY = 'picseal-resize-kernel'
const VALID: ResizeKernel[] = ['halving', 'pica']

export function getResizeKernel(): ResizeKernel {
  try {
    const v = globalThis.localStorage?.getItem(KEY) as ResizeKernel | null
    if (v && VALID.includes(v)) return v
  } catch {
    /* localStorage 不可用（隐私模式等） */
  }
  return 'pica'
}

export function setResizeKernel(k: ResizeKernel): void {
  try {
    globalThis.localStorage?.setItem(KEY, k)
  } catch {
    /* 忽略 */
  }
}
