/**
 * DOM 文字解密 —— 移植自 Rhine-Music-Demo document-decryption.ts（MIT，© LBEILC / RonaldDeng）。
 * 详情卡文字先被"墨条"遮盖，玻璃揭示（clarity>0）后墨条依次擦除：
 * 先短暂加速、果断离场、长尾减速，无回弹。自驱 rAF，完成后自动清理。
 */

interface Cover {
  window: HTMLElement
  ink: HTMLElement
  order: number
}

export class DocumentDecryption {
  private root: HTMLElement | null = null
  private covers: Cover[] = []
  private started: number | null = null
  private progress = 0
  private raf = 0
  private running = false

  /** 详情卡打开时重置；root 内 [data-doc] 元素逐条遮盖 */
  reset(root: HTMLElement | null, alreadyClear = false): void {
    this.stop()
    this.remove()
    this.root = root
    this.started = null
    this.progress = alreadyClear ? 1 : 0
    if (!root || this.progress === 1) return
    const targets = root.querySelectorAll<HTMLElement>('[data-doc]')
    targets.forEach((target) => {
      target.style.position = 'relative'
      const windowEl = document.createElement('span')
      windowEl.className = 'doc-redaction-window'
      windowEl.setAttribute('aria-hidden', 'true')
      const rect = target.getBoundingClientRect()
      const width = target.clientWidth || Math.round(rect.width)
      const height = target.clientHeight || Math.round(rect.height)
      windowEl.style.cssText = `left:0;top:0;width:${width}px;height:${height}px`
      const ink = document.createElement('span')
      ink.className = 'doc-redaction-ink'
      windowEl.append(ink)
      target.append(windowEl)
      this.covers.push({ window: windowEl, ink, order: this.covers.length })
    })
    this.paint()
  }

  /** clarity>0 时调用一次；自带 0.95s 扫过 + 0.22s 逐条延迟梯度 */
  begin(): void {
    if (this.running || !this.root || this.progress === 1 || this.covers.length === 0) return
    this.running = true
    this.started = performance.now() / 1000
    const tick = (): void => {
      if (!this.running) return
      const now = performance.now() / 1000
      if (this.started !== null)
        this.progress = Math.min(1, Math.max(0, (now - this.started) / 0.95))
      if (this.progress === 1) {
        this.remove()
        this.stop()
        return
      }
      this.paint()
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  private paint(): void {
    const count = Math.max(1, this.covers.length - 1)
    for (const cover of this.covers) {
      const delay = (cover.order / count) * 0.22
      const t = Math.min(1, Math.max(0, (this.progress - delay) / 0.78))
      // 短暂加速、果断离场、长尾减速；无回弹
      const eased =
        t < 0.2 ? 0.4 * (t / 0.2) ** 2 : 1 - 0.6 * ((1 - t) / 0.8) ** (16 / 3)
      cover.ink.style.transform = `translateX(${eased * 101}%)`
    }
  }

  private stop(): void {
    this.running = false
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private remove(): void {
    for (const cover of this.covers) cover.window.remove()
    this.covers = []
  }

  dispose(): void {
    this.stop()
    this.remove()
    this.root = null
    this.progress = 0
  }
}
