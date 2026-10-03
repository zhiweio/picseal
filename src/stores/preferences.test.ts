import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  PREFS_STORAGE_KEY,
  readLegacyPrefs,
  seedFromLegacyPrefs
} from './preferences'

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
  clear(): void {
    this.map.clear()
  }
}

function installStorage(): MemStorage {
  const storage = new MemStorage()
  const g = globalThis as { localStorage?: unknown; window?: unknown }
  g.localStorage = storage
  // zustand 5 默认 storage getter 引用 window.localStorage，node 环境需补 window 别名
  g.window = g
  return storage
}

afterEach(() => {
  const g = globalThis as { localStorage?: unknown; window?: unknown }
  delete g.localStorage
  delete g.window
  vi.resetModules()
})

describe('readLegacyPrefs（旧散装 key 解析）', () => {
  it('全部缺失返回 null', () => {
    expect(readLegacyPrefs(() => null)).toBeNull()
  })

  it('music on/off 映射为布尔偏好', () => {
    expect(readLegacyPrefs((k) => (k === 'picseal-music' ? 'on' : null))?.musicPref).toBe(true)
    expect(readLegacyPrefs((k) => (k === 'picseal-music' ? 'off' : null))?.musicPref).toBe(false)
    expect(readLegacyPrefs((k) => (k === 'picseal-music' ? 'bogus' : null))?.musicPref).toBeUndefined()
  })

  it('cinema JSON 解析，缺省字段回 true；坏 JSON 忽略', () => {
    const onlyIntro = readLegacyPrefs((k) =>
      k === 'picseal-cinema-media' ? '{"intro":false}' : null
    )
    expect(onlyIntro?.cinemaMedia).toEqual({ intro: false, music: true })

    expect(
      readLegacyPrefs((k) => (k === 'picseal-cinema-media' ? '{broken' : null))?.cinemaMedia
    ).toBeUndefined()
  })

  it('resize kernel 只收白名单值', () => {
    expect(readLegacyPrefs((k) => (k === 'picseal-resize-kernel' ? 'pica' : null))?.resizeKernel).toBe('pica')
    expect(readLegacyPrefs((k) => (k === 'picseal-resize-kernel' ? 'bilinear' : null))?.resizeKernel).toBeUndefined()
  })
})

describe('seedFromLegacyPrefs（一次性迁移）', () => {
  it('无信封且有旧 key：播种信封并清理旧 key', () => {
    const storage = installStorage()
    storage.setItem('picseal-music', 'off')
    storage.setItem('picseal-cinema-media', '{"music":false}')
    storage.setItem('picseal-resize-kernel', 'halving')

    seedFromLegacyPrefs()

    const envelope = JSON.parse(storage.getItem(PREFS_STORAGE_KEY)!) as {
      state: Record<string, unknown>
      version: number
    }
    expect(envelope.version).toBe(1)
    expect(envelope.state).toEqual({
      musicPref: false,
      cinemaMedia: { intro: true, music: false },
      resizeKernel: 'halving'
    })
    expect(storage.getItem('picseal-music')).toBeNull()
    expect(storage.getItem('picseal-cinema-media')).toBeNull()
    expect(storage.getItem('picseal-resize-kernel')).toBeNull()
  })

  it('已有信封：只清理旧 key，不覆盖', () => {
    const storage = installStorage()
    storage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ state: { musicPref: true }, version: 1 }))
    storage.setItem('picseal-music', 'off')

    seedFromLegacyPrefs()

    const envelope = JSON.parse(storage.getItem(PREFS_STORAGE_KEY)!) as { state: { musicPref?: boolean } }
    expect(envelope.state.musicPref).toBe(true)
    expect(storage.getItem('picseal-music')).toBeNull()
  })

  it('无任何旧 key：不写信封', () => {
    const storage = installStorage()
    seedFromLegacyPrefs()
    expect(storage.getItem(PREFS_STORAGE_KEY)).toBeNull()
  })

  it('localStorage 不可用：静默跳过', () => {
    expect(() => seedFromLegacyPrefs()).not.toThrow()
  })
})

describe('usePreferences（zustand persist 水合 + merge 容错）', () => {
  async function importStore() {
    const mod = await import('./preferences')
    // persist 水合在 store 创建后的微任务完成
    await vi.waitFor(() => {
      if (!mod.usePreferences.persist.hasHydrated()) throw new Error('not hydrated')
    })
    return mod
  }

  it('合法信封水合进 store', async () => {
    installStorage().setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({
        state: { musicPref: false, cinemaMedia: { intro: false, music: true }, resizeKernel: 'halving' },
        version: 1
      })
    )
    const { usePreferences } = await importStore()

    expect(usePreferences.getState().musicPref).toBe(false)
    expect(usePreferences.getState().cinemaMedia).toEqual({ intro: false, music: true })
    expect(usePreferences.getState().resizeKernel).toBe('halving')
  })

  it('坏 JSON / 越界值回退默认值', async () => {
    installStorage().setItem(PREFS_STORAGE_KEY, '{broken')
    // 坏 JSON 走水合 catch 分支，hasHydrated 不会置位，直接等微任务落定后断言
    const { usePreferences, DEFAULT_PREFS } = await import('./preferences')
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(usePreferences.getState().musicPref).toBe(DEFAULT_PREFS.musicPref)
    expect(usePreferences.getState().cinemaMedia).toEqual(DEFAULT_PREFS.cinemaMedia)
    expect(usePreferences.getState().resizeKernel).toBe(DEFAULT_PREFS.resizeKernel)
  })

  it('动作更新写回信封（version 1）', async () => {
    const storage = installStorage()
    const { usePreferences } = await importStore()

    usePreferences.getState().toggleCinemaMedia('intro')
    usePreferences.getState().setResizeKernel('halving')

    const envelope = JSON.parse(storage.getItem(PREFS_STORAGE_KEY)!) as {
      state: { cinemaMedia: { intro: boolean }; resizeKernel: string }
      version: number
    }
    expect(envelope.version).toBe(1)
    expect(envelope.state.cinemaMedia.intro).toBe(false)
    expect(envelope.state.resizeKernel).toBe('halving')
  })
})
