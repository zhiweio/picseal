/**
 * 波场与运动学纯函数 —— 移植自 Rhine-Music-Demo（MIT，© LBEILC / RonaldDeng）
 * 的 src/motion.ts 与 music-camera.ts，参数保持一致以复现其丝滑动效。
 */

/** 五次 smootherstep：C² 连续的 0→1 */
export function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * x * (10 + x * (-15 + 6 * x))
}

/** 高斯波包 */
export function bell(x: number, width: number): number {
  return Math.exp(-0.5 * (x / width) * (x / width))
}

/** 临界阻尼弹簧状态（value + velocity） */
export interface Spring {
  value: number
  velocity: number
}

export function spring(value = 0): Spring {
  return { value, velocity: 0 }
}

/**
 * 精确临界阻尼积分 —— 全场景统一弹簧（demo motion.ts L121-127 原式）。
 * rate 越大跟随越快；reduced-motion 场景把 rate 提到 35。
 */
export function damp(s: Spring, target: number, rate: number, dt: number): void {
  const delta = s.value - target
  const impulse = s.velocity + rate * delta
  const decay = Math.exp(-rate * dt)
  s.value = target + (delta + impulse * dt) * decay
  s.velocity = (s.velocity - rate * impulse * dt) * decay
}

/**
 * 进场扫描波（参考胶片 05:00 时间轴）：
 * 斜向波前 + 前进/返回两道波，波包带肩与尾谷 —— 连续波面而非独立 tween。
 */
export function archiveWave(row: number, lane: number, time: number): number {
  const phase = row + (lane - 2) * 0.65
  const first = 3 + time * 19
  const returning = 32 - (time - 2.3) * 24
  const packet = (d: number) => 2.5 * bell(d, 3.8) - 0.58 * bell(d - 6, 3.5)
  return packet(phase - first) + packet(phase - returning)
}

/** 静止波场：卡片被选中/导航后 shelf 归位的余波 */
export function settlingWave(distance: number, time: number): number {
  const age = time - 25.05 - Math.abs(distance) * 0.065
  const envelope = Math.max(-0.42, 2.15 - 0.17 * (Math.sqrt(distance * distance + 1) - 1))
  const rise = smooth(age / 0.62)
  const ring = Math.sin(age * 5.1) * Math.exp(-age * 1.3)
  return envelope * (rise + 0.18 * ring * smooth(age / 0.16))
}

/** 选中列的强度权重（亮度/波幅随 lane 距离衰减） */
export function columnStrength(lane: number, focus: number, placement = 1): number {
  return 1 + (0.25 + 0.75 * bell(lane - focus, 0.55) - 1) * smooth(placement)
}

/** 无交互漂移（<3% 卡高；2.5s 无交互后淡入） */
export function idleWave(
  row: number,
  lane: number,
  time: number,
  gain: number
): number {
  const wave =
    0.075 * Math.sin((2 * Math.PI * time) / 8 + row * 0.3 - lane * 0.45) +
    0.027 * Math.sin((2 * Math.PI * time) / 13 - row * 0.17 + lane * 0.3)
  return wave * gain
}

/** 点击/节拍脉冲：起点零斜率、余弦相位随距离展开 */
export function selectionWave(distance: number, age: number): number {
  if (age < 0 || age > 3.2) return 0
  return (
    0.32 *
    smooth(age / 0.46) *
    Math.exp(-age * 1.35) *
    Math.cos((distance - age * 5.5) * 0.58) *
    bell(distance - age * 5.5, 3.4)
  )
}

/** 脉冲包络（正半余弦 → 波纹前后缘零速） */
export function rippleEnvelope(distance: number, age: number): number {
  return smooth(distance / 2.5) * Math.max(0, Math.cos((distance - age * 8) * 0.58))
}

/** 回位旋转衰减 */
export function returnStep(angle: number, dt: number, reduced: boolean): number {
  const next = angle * Math.exp(-dt * (reduced ? 35 : 7))
  return Math.abs(next) <= 0.001 ? 0 : next
}

/** 最近出现位置：把无界逻辑坐标折叠到中心附近（循环池 wrap） */
export function nearestOccurrence(value: number, center: number, period: number): number {
  return value + Math.floor((center - value + period / 2) / period) * period
}

/**
 * 单进度五次多项式运动（demo MusicPlacementMotion）：
 * 1.45s、C² 连续；换目标时保留当前位置/速度/加速度，运动永远平滑衔接。
 * progress ∈ [0,1] 同时驱动 lift / yaw / elevation / span —— 单一运动。
 */
export class PlacementMotion {
  value = 0
  private coefficients: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0]
  private elapsed = 0
  private targetValue = 0
  private readonly duration: number

  constructor(duration = 1.45, initial = 0) {
    this.duration = duration
    this.targetValue = initial
    this.value = initial
    this.coefficients = [initial, 0, 0, 0, 0, 0]
  }

  get target(): number {
    return this.targetValue
  }

  get settled(): boolean {
    return this.elapsed >= this.duration
  }

  set(target: number, reduced = false): void {
    if (reduced) {
      this.targetValue = target
      this.value = target
      this.elapsed = this.duration
      this.coefficients = [target, 0, 0, 0, 0, 0]
      return
    }
    if (target === this.targetValue) return
    this.targetValue = target
    this.elapsed = 0
    const t = this.duration
    const a = this.value
    const velocity = this.derivative()
    const acceleration = this.secondDerivative()
    const distance = target - a - velocity * t - (acceleration * t * t) / 2
    const b = -velocity - acceleration * t
    const c = -acceleration
    this.coefficients = [
      a,
      b,
      c / 2,
      (10 * distance - 4 * b * t + (c * t * t) / 2) / t ** 3,
      (-15 * distance + 7 * b * t - c * t * t) / t ** 4,
      (6 * distance - 3 * b * t + (c * t * t) / 2) / t ** 5
    ] as [number, number, number, number, number, number]
  }

  private derivative(): number {
    const t = this.elapsed
    const [a, b, c, d, e, f] = this.coefficients
    void a
    return b + 2 * c * t + 3 * d * t * t + 4 * e * t ** 3 + 5 * f * t ** 4
  }

  private secondDerivative(): number {
    const t = this.elapsed
    const [, b, c, d, e, f] = this.coefficients
    void b
    return 2 * c + 6 * d * t + 12 * e * t * t + 20 * f * t ** 3
  }

  update(dt: number): number {
    if (this.elapsed < this.duration) {
      this.elapsed = Math.min(this.duration, this.elapsed + dt)
      const t = this.elapsed
      const [a, b, c, d, e, f] = this.coefficients
      this.value = a + (b ?? 0) * t + (c ?? 0) * t * t + (d ?? 0) * t ** 3 + (e ?? 0) * t ** 4 + (f ?? 0) * t ** 5
    } else {
      this.value = this.targetValue
    }
    return this.value
  }
}
