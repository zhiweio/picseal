/**
 * 重采样内核全局配置（主线程）——"渐进半缩"与 "pica Lanczos" 双内核自由切换。
 * 持久化收敛到 preferences store（picseal-prefs，zustand persist）；本模块保留
 * 过程式 API：预览/导出等非 React 调用点以 getState 即时读取，worker 侧通过
 * 渲染请求逐次下发（worker 无 localStorage）。实时读取：切换后下一次渲染即生效。
 */
import { usePreferences, type ResizeKernel } from '@/stores/preferences'

export type { ResizeKernel }

export function getResizeKernel(): ResizeKernel {
  return usePreferences.getState().resizeKernel
}

export function setResizeKernel(k: ResizeKernel): void {
  usePreferences.getState().setResizeKernel(k)
}
