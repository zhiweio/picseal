/**
 * 主题过渡 —— 移植自 Rhine-Music-Demo theme-transition.ts（MIT，© LBEILC / RonaldDeng）。
 * 场景、灯光与材质调色板共用一个时钟完成主题切换。
 */
import * as THREE from 'three'

type ColorTrack = { from: THREE.Color; to: THREE.Color }
type NumberTrack = { from: number; to: number; write: (value: number) => void }

export class ThemeTransition {
  private readonly colors = new Map<THREE.Color, ColorTrack>()
  private readonly numbers = new Map<object, Map<PropertyKey, NumberTrack>>()
  private readonly startedAt = performance.now() / 1000

  constructor(private readonly duration = 0.65) {}

  color(target: THREE.Color, value: THREE.ColorRepresentation): void {
    const existing = this.colors.get(target)
    if (existing) existing.to.set(value)
    else this.colors.set(target, { from: target.clone(), to: new THREE.Color(value) })
  }

  number<T extends object, K extends keyof T>(target: T, key: K, value: number): void {
    let properties = this.numbers.get(target)
    if (!properties) this.numbers.set(target, (properties = new Map()))
    const existing = properties.get(key)
    if (existing) existing.to = value
    else
      properties.set(key, {
        from: Number(target[key]),
        to: value,
        write: (next) => {
          ;(target[key] as T[K]) = next as T[K]
        }
      })
  }

  /** 先注册全部目标再逐帧推进，避免灯光覆盖闪回基础值。 */
  update(nowSeconds: number): boolean {
    // 用 RAF 真实时钟，独立于受限的物理步长。
    const elapsed = Math.min(this.duration, Math.max(0, nowSeconds - this.startedAt))
    const t = this.duration > 0 ? elapsed / this.duration : 1
    // 对齐 music-theme.css 的 cubic-bezier(0.4, 0, 0.2, 1)：反解其横坐标，
    // 让 WebGL 场景与 DOM 用同一时序。
    let curveTime = t
    for (let step = 0; step < 6; step++) {
      const x = ((1.6 * curveTime - 1.8) * curveTime + 1.2) * curveTime
      const slope = (4.8 * curveTime - 3.6) * curveTime + 1.2
      curveTime = THREE.MathUtils.clamp(curveTime - (x - t) / slope, 0, 1)
    }
    const progress = t === 1 ? 1 : curveTime * curveTime * (3 - 2 * curveTime)
    this.apply(progress)
    return elapsed >= this.duration
  }

  finish(): void {
    this.apply(1)
  }

  private apply(progress: number): void {
    for (const [target, { from, to }] of this.colors) {
      if (progress === 1) target.copy(to)
      else target.lerpColors(from, to, progress)
    }
    for (const properties of this.numbers.values())
      for (const { from, to, write } of properties.values())
        write(progress === 1 ? to : THREE.MathUtils.lerp(from, to, progress))
  }
}
