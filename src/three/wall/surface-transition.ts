/**
 * SurfaceTransition —— 移植自 Rhine-Music-Demo ui-transitions.ts（MIT）。
 * WAAPI 实现，可打断、速度续接：重入时从 getComputedStyle 采样当前值作为起始帧。
 */
export const ENTER_EASE = 'cubic-bezier(0.22,1,0.36,1)'
export const EXIT_EASE = 'cubic-bezier(0.4,0,1,1)'

export interface SurfaceOptions {
  enterMs?: number
  exitMs?: number
  /** 进场位移方向 */
  direction?: 'up' | 'right'
  fadeSelector?: string[]
}

export class SurfaceTransition {
  private element: HTMLElement | null = null
  private animations: Animation[] = []
  private revision = 0
  private open = false
  private opts: Required<SurfaceOptions>

  constructor(element: HTMLElement | null, opts: SurfaceOptions = {}) {
    this.element = element
    this.opts = {
      enterMs: opts.enterMs ?? 300,
      exitMs: opts.exitMs ?? 200,
      direction: opts.direction ?? 'up',
      fadeSelector: opts.fadeSelector ?? []
    }
  }

  setElement(el: HTMLElement | null): void {
    this.element = el
  }

  private sample(el: HTMLElement): { opacity: string; transform: string } {
    const s = getComputedStyle(el)
    return { opacity: s.opacity, transform: s.transform === 'none' ? '' : s.transform }
  }

  show(): void {
    this.open = true
    const el = this.element
    if (!el || this.reducedMotion()) {
      if (el) el.style.visibility = 'visible'
      return
    }
    const revision = (this.revision += 1)
    for (const anim of this.animations) anim.cancel()
    this.animations = []

    const from = this.sample(el)
    const dx = this.opts.direction === 'right' ? 36 : 12
    const dy = this.opts.direction === 'right' ? 0 : 12
    const enter = el.animate(
      [
        { opacity: from.opacity || '0', transform: `${from.transform} translate(${dx}px, ${dy}px)` },
        { opacity: '1', transform: 'translate(0, 0)' }
      ],
      { duration: this.opts.enterMs, easing: ENTER_EASE, fill: 'both' }
    )
    this.animations.push(enter)
    el.style.visibility = 'visible'
    enter.onfinish = () => {
      if (revision === this.revision) el.dataset.transition = 'open'
    }
  }

  hide(): void {
    this.open = false
    const el = this.element
    if (!el || this.reducedMotion()) {
      if (el) el.style.visibility = 'hidden'
      return
    }
    const revision = (this.revision += 1)
    for (const anim of this.animations) anim.cancel()
    this.animations = []

    const from = this.sample(el)
    const dx = this.opts.direction === 'right' ? 52 : 8
    const dy = this.opts.direction === 'right' ? 0 : 8
    const exit = el.animate(
      [
        { opacity: from.opacity || '1', transform: `${from.transform} translate(0, 0)` },
        { opacity: '0', transform: `translate(${dx}px, ${dy}px)` }
      ],
      { duration: this.opts.exitMs, easing: EXIT_EASE, fill: 'both' }
    )
    this.animations.push(exit)
    exit.onfinish = () => {
      if (revision === this.revision) {
        el.style.visibility = 'hidden'
        el.dataset.transition = 'closed'
      }
    }
  }

  toggle(): void {
    if (this.open) this.hide()
    else this.show()
  }

  private reducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  get isOpen(): boolean {
    return this.open
  }
}

