/**
 * Blob URL 的 LRU 缓存 —— URL 生命周期的唯一拥有者。
 *
 * 关键约束：**只在淘汰或清空时 revoke**。调用方拿到 url 后可能长期持有
 * （如 React state / <img src>），命中缓存绝不能吊销，否则切回旧模板时
 * 预览图加载失败且无自愈路径（历史 bug：切换横幅样式后图片消失）。
 */
export class BlobUrlCache<V> {
  private map = new Map<string, V>()

  constructor(
    private readonly opts: {
      max: number
      getUrl: (value: V) => string
      /** 淘汰时是否 revoke（被外部长期引用的轻缓存可关闭，仅 clear 时释放） */
      revokeOnEvict?: boolean
    }
  ) {}

  get size(): number {
    return this.map.size
  }

  /** 命中并提升为最近使用；绝不吊销 */
  get(key: string): V | undefined {
    const hit = this.map.get(key)
    if (hit) {
      this.map.delete(key)
      this.map.set(key, hit)
    }
    return hit
  }

  /** 写入并按容量淘汰最旧项（淘汰即吊销，除非 revokeOnEvict=false） */
  set(key: string, value: V): void {
    this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.opts.max) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.delete(oldest)
    }
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  /** 显式删除单条（吊销其 URL） */
  delete(key: string): void {
    const stale = this.map.get(key)
    if (stale === undefined) return
    if (this.opts.revokeOnEvict !== false) URL.revokeObjectURL(this.opts.getUrl(stale))
    this.map.delete(key)
  }

  /** 删除键前缀匹配的全部条目（照片移除时按 photoId 清缓存），返回删除条数 */
  deleteByPrefix(prefix: string): number {
    let removed = 0
    for (const key of [...this.map.keys()]) {
      if (key.startsWith(prefix)) {
        this.delete(key)
        removed += 1
      }
    }
    return removed
  }

  /** 清空并释放全部 URL */
  clear(): void {
    for (const value of this.map.values()) {
      URL.revokeObjectURL(this.opts.getUrl(value))
    }
    this.map.clear()
  }
}
