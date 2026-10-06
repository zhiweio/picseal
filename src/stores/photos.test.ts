import { beforeEach, describe, expect, it } from 'vitest'
import { usePhotos, type PhotoItem } from './photos'

/** node 环境无真实 File/解码，测试只关注 remove/restore 的状态机 */
function item(id: string, thumbUrl?: string): PhotoItem {
  return {
    id,
    file: new Blob([]) as unknown as File,
    name: `${id}.jpg`,
    size: 1,
    ...(thumbUrl ? { thumbUrl } : {}),
    metaStatus: 'ok'
  }
}

const seed = () => {
  usePhotos.setState({
    items: [item('a', 'blob:a'), item('b'), item('c')],
    currentId: 'b',
    sampleId: 'a',
    importedCount: 3
  })
}

describe('usePhotos remove/restore（移除与撤销）', () => {
  beforeEach(seed)

  it('remove 移除条目；非当前张不影响 currentId/sampleId', () => {
    usePhotos.getState().remove('c')
    const s = usePhotos.getState()
    expect(s.items.map((p) => p.id)).toEqual(['a', 'b'])
    expect(s.currentId).toBe('b')
    expect(s.sampleId).toBe('a')
  })

  it('remove 当前张/样片时回退到剩余首张', () => {
    usePhotos.getState().remove('b')
    const s = usePhotos.getState()
    expect(s.items.map((p) => p.id)).toEqual(['a', 'c'])
    expect(s.currentId).toBe('a')
    expect(s.sampleId).toBe('a')
  })

  it('remove 全部后 currentId/sampleId 清空', () => {
    usePhotos.getState().remove('a')
    usePhotos.getState().remove('b')
    usePhotos.getState().remove('c')
    const s = usePhotos.getState()
    expect(s.items).toEqual([])
    expect(s.currentId).toBeNull()
    expect(s.sampleId).toBeNull()
  })

  it('remove 不释放缩略图：thumbUrl 随条目保留，供撤销窗口复原', () => {
    const a = usePhotos.getState().items[0]!
    usePhotos.getState().remove('a')
    expect(a.thumbUrl).toBe('blob:a')
  })

  it('restore 按原索引插回并恢复 current/sample 指向', () => {
    const a = usePhotos.getState().items[0]!
    usePhotos.getState().remove('a')
    usePhotos.getState().setCurrent('c')
    usePhotos.getState().restore(a, 0, { current: true, sample: true })
    const s = usePhotos.getState()
    expect(s.items.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(s.currentId).toBe('a')
    expect(s.sampleId).toBe('a')
    expect(s.items[0]!.thumbUrl).toBe('blob:a')
  })

  it('restore 索引越界时 clamp 到末尾', () => {
    const c = usePhotos.getState().items[2]!
    usePhotos.getState().remove('c')
    usePhotos.getState().restore(c, 99)
    expect(usePhotos.getState().items.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('restore 对已存在 id 幂等跳过', () => {
    const before = usePhotos.getState().items
    usePhotos.getState().restore(before[1]!, 0)
    expect(usePhotos.getState().items).toBe(before)
  })
})
