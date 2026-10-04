import { describe, expect, it } from 'vitest'
import {
  MINI_WALL_SLOTS,
  PORTFOLIO_THRESHOLD,
  PORTFOLIO_WALL_CAP,
  dedupeKeyOf,
  encouragementIndex,
  filterPortfolioFiles,
  isAdmissible,
  isSupportedImageName,
  miniWallFilled,
  progressTier
} from './portfolio'

describe('isSupportedImageName', () => {
  it('放行支持的图片扩展名（大小写不敏感）', () => {
    expect(isSupportedImageName('a.JPG')).toBe(true)
    expect(isSupportedImageName('b.heic')).toBe(true)
    expect(isSupportedImageName('c.Tiff')).toBe(true)
  })

  it('拒绝非图片与无扩展名', () => {
    expect(isSupportedImageName('notes.txt')).toBe(false)
    expect(isSupportedImageName('raw.dng')).toBe(false)
    expect(isSupportedImageName('noext')).toBe(false)
  })
})

describe('filterPortfolioFiles', () => {
  it('过滤非图片、批内去重并对既有收录去重', () => {
    const existing = [dedupeKeyOf({ name: 'old.jpg', size: 1 })]
    const verdict = filterPortfolioFiles(
      [
        { name: 'a.jpg', size: 10 },
        { name: 'a.jpg', size: 10 },
        { name: 'old.jpg', size: 1 },
        { name: 'b.png', size: 20 },
        { name: 'skip.txt', size: 30 }
      ],
      existing
    )
    expect(verdict.accepted).toEqual([
      { name: 'a.jpg', size: 10 },
      { name: 'b.png', size: 20 }
    ])
    expect(verdict.duplicates).toBe(2)
    expect(verdict.skipped).toBe(1)
  })

  it('空输入返回零计数', () => {
    const verdict = filterPortfolioFiles([])
    expect(verdict.accepted).toHaveLength(0)
    expect(verdict.skipped).toBe(0)
    expect(verdict.duplicates).toBe(0)
  })
})

describe('progressTier / encouragementIndex', () => {
  it('按门槛进度分档（30% / 75% 边界）', () => {
    expect(progressTier(0)).toBe('start')
    expect(progressTier(35)).toBe('start')
    expect(progressTier(36)).toBe('mid')
    expect(progressTier(89)).toBe('mid')
    expect(progressTier(90)).toBe('sprint')
    expect(progressTier(PORTFOLIO_THRESHOLD)).toBe('sprint')
  })

  it('同档内逐次轮换且不越界', () => {
    const first = encouragementIndex(10, 0)
    const second = encouragementIndex(10, 1)
    expect(first).toBe(1)
    expect(second).toBe(2)
    // 起步档池只有两句，第 3 次被拒回到第一句
    expect(encouragementIndex(10, 2)).toBe(1)
    // 中程档
    expect(encouragementIndex(60, 0)).toBe(3)
    expect(encouragementIndex(60, 3)).toBe(3)
    // 冲刺档
    expect(encouragementIndex(110, 0)).toBe(6)
    expect(encouragementIndex(110, 1)).toBe(7)
  })
})

describe('miniWallFilled / isAdmissible', () => {
  it('迷你墙实格数钳制在格位总数', () => {
    expect(miniWallFilled(0)).toBe(0)
    expect(miniWallFilled(7)).toBe(7)
    expect(miniWallFilled(1000)).toBe(MINI_WALL_SLOTS)
  })

  it('入馆门槛判定', () => {
    expect(isAdmissible(PORTFOLIO_THRESHOLD - 1)).toBe(false)
    expect(isAdmissible(PORTFOLIO_THRESHOLD)).toBe(true)
  })

  it('墙容量大于门槛（门槛先达成）', () => {
    expect(PORTFOLIO_WALL_CAP).toBeGreaterThan(PORTFOLIO_THRESHOLD)
  })
})
