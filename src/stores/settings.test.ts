import { afterEach, describe, expect, it, vi } from 'vitest'

/** 内存版 Storage，替代浏览器 localStorage（node 测试环境） */
class MemStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
}

describe('useSettings（persist version 迁移）', () => {
  afterEach(() => {
    const g = globalThis as { localStorage?: unknown; window?: unknown }
    delete g.localStorage
    delete g.window
    vi.resetModules()
  })

  it('存量 version 0 信封（无 version 配置时期写入）经 migrate 直通后仍可加载', async () => {
    const storage = new MemStorage()
    storage.setItem(
      'picseal-settings',
      JSON.stringify({
        state: {
          output: { format: 'webp', quality: 0.5, keepExif: false, naming: 'original', longEdge: 2048 },
          presets: []
        },
        version: 0
      })
    )
    const g = globalThis as { localStorage?: unknown; window?: unknown }
    g.localStorage = storage
    // zustand 5 默认 storage getter 引用 window.localStorage，node 环境需补 window 别名
    g.window = g

    const { useSettings } = await import('./settings')
    await vi.waitFor(() => {
      if (!useSettings.persist.hasHydrated()) throw new Error('not hydrated')
    })

    expect(useSettings.getState().output.format).toBe('webp')
    expect(useSettings.getState().output.longEdge).toBe(2048)
    expect(useSettings.getState().presets).toEqual([])
  })
})
