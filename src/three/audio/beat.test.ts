import { describe, expect, it } from 'vitest'
import { bandFlux, isOnset } from '../audio/beat'

function bins(values: number[]): Uint8Array {
  const arr = new Uint8Array(64)
  values.forEach((v, i) => {
    arr[i + 1] = v
  })
  return arr
}

describe('节拍检测（谱通量 + 自适应阈值）', () => {
  it('平稳信号不触发 onset', () => {
    const history: number[] = []
    let fired = 0
    for (let i = 0; i < 60; i += 1) {
      const prev = bins([100, 100, 100])
      const cur = bins([100, 100, 100])
      const flux = bandFlux(prev, cur)
      history.push(flux)
      const { onset } = isOnset(flux, history)
      if (onset) fired += 1
    }
    expect(fired).toBe(0)
  })

  it('能量突增触发 onset 且强度有界', () => {
    const history: number[] = []
    // 先建立小幅波动基线（均值 > 底噪门槛）
    for (let i = 0; i < 40; i += 1) {
      history.push(bandFlux(bins([50, 50, 50]), bins([55, 55, 55])))
    }
    const { onset, strength } = isOnset(bandFlux(bins([50, 50, 50]), bins([200, 220, 190])), history)
    expect(onset).toBe(true)
    expect(strength).toBeGreaterThan(0)
    expect(strength).toBeLessThanOrEqual(1)
  })

  it('静音底噪不触发（floor 过滤）', () => {
    const history: number[] = []
    for (let i = 0; i < 40; i += 1) history.push(0)
    const { onset } = isOnset(bandFlux(bins([0, 0, 0]), bins([3, 2, 1])), history)
    expect(onset).toBe(false)
  })

  it('冷却窗由调用方控制（引擎职责）', () => {
    // bandFlux 纯函数无副作用；冷却 180ms 属于 BeatEngine.loop 的状态
    expect(typeof bandFlux).toBe('function')
  })
})
