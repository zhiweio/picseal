/**
 * 波场与运动学纯函数 —— 移植自 Rhine-Music-Demo src/motion.ts（MIT，© LBEILC / RonaldDeng）。
 * 全部参数保持一致以复现其丝滑动效；时间轴锚点沿用参考视频 05:00 帧约定。
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

/** 精确临界阻尼积分 —— 全场景统一弹簧（demo 原式） */
export function damp(s: Spring, target: number, rate: number, dt: number): void {
  const delta = s.value - target
  const impulse = s.velocity + rate * delta
  const decay = Math.exp(-rate * dt)
  s.value = target + (delta + impulse * dt) * decay
  s.velocity = (s.velocity - rate * impulse * dt) * decay
}

/**
 * 进场扫描波（参考视频时间轴，scene 侧 scanTime 自 22 起步）：
 * 斜向波前 + 前进/返回两道波，波包带肩与尾谷 —— 连续波面而非独立 tween。
 */
export function archiveWave(row: number, lane: number, time: number): number {
  const t = time - 22
  const phase = row + (lane - 2) * 0.65
  const enter = smooth(t / 0.32)
  const first = 3 + t * 19
  const returning = 32 - (t - 2.3) * 24
  const packet = (d: number) => 2.5 * bell(d, 3.8) - 0.58 * bell(d - 6, 3.5)
  return (
    enter *
    (packet(phase - first) * (1 - smooth((t - 2.15) / 0.65)) +
      packet(phase - returning) * smooth((t - 2.17) / 0.32) * (1 - smooth((t - 3.5) / 0.85)))
  )
}

/**
 * 静止波肩：选中/导航后落在焦点卡周围的阶梯落差（"档案架被抽出一份"的静止形态）。
 * distance 以行距为单位；26.56 为参考时间轴的静止锚点 —— 常量调用即得静止肩形。
 */
export function settlingWave(distance: number, time: number): number {
  const age = time - 25.05 - Math.abs(distance) * 0.065
  const envelope = Math.max(-0.42, 2.15 - 0.17 * (Math.sqrt(distance * distance + 1) - 1))
  const rise = smooth(age / 0.62)
  const ring = age > 0 ? Math.sin(age * 5.1) * Math.exp(-age * 1.3) : 0
  return envelope * (rise + 0.18 * ring * smooth(age / 0.16))
}

/** 选中列的强度权重（波幅随 lane 距中心衰减） */
export function columnStrength(lane: number, focus: number, progress = 1): number {
  const selected = 0.25 + 0.75 * bell(lane - focus, 0.55)
  return 1 + (selected - 1) * smooth(progress)
}

/** 无交互漂移（<3% 卡高；2.5s 无交互后由 scene 侧增益淡入） */
export function idleWave(row: number, lane: number, time: number): number {
  return (
    0.075 * Math.sin((time * Math.PI * 2) / 8 + row * 0.3 - lane * 0.45) +
    0.027 * Math.sin((time * Math.PI * 2) / 13 - row * 0.17 + lane * 0.3)
  )
}

/** 导航/节拍脉冲：起点零斜率、余弦相位随距离展开（music 变体，幅值温和） */
export function musicSelectionWave(distance: number, age: number): number {
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

/** 回位旋转衰减：保持高度直到转正，再开始下落（对齐后归零） */
export function returnStep(angle: number, dt: number, reduced = false): number {
  const next = angle * Math.exp(-dt * (reduced ? 35 : 7))
  return Math.abs(next) <= 0.001 ? 0 : next
}
