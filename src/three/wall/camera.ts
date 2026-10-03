/**
 * 相机运动与状态机 —— 移植自 Rhine-Music-Demo music-camera.ts（MIT）。
 * 核心：position / aim / span 全部带速度临界阻尼（rate 9），
 * FOV 每帧由 span 与实际渲染距离反解 —— 消除分别阻尼产生的 scale pulse。
 */
import * as THREE from 'three'
import { damp, spring, type Spring } from './motion'

export const PREVIEW_LIFT = 0.9
export const INSPECTION_LIFT = 4.05

/** detail 检视姿态（相对 archive）：接近平视（避免俯瞰背后的卡组顶面），轻微偏航 */
export const DETAIL_ELEVATION = THREE.MathUtils.degToRad(9)
export const DETAIL_YAW = THREE.MathUtils.degToRad(6)



export class CameraMotion {
  readonly position = {
    value: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    targetPosition: new THREE.Vector3()
  }
  readonly aim = {
    value: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    targetAim: new THREE.Vector3()
  }
  readonly span: Spring = spring(10.8)
  targetSpan = 10.8

  /** settled 判据（demo：位置 <0.035、aim <0.006、span <0.008、速度 <0.09/0.035/0.035） */
  settled(): boolean {
    const dp = this.position.velocity.length()
    const da = this.aim.velocity.length()
    const ds = Math.abs(this.span.velocity)
    return (
      dp < 0.09 &&
      da < 0.035 &&
      ds < 0.035 &&
      this.position.value.distanceTo(this.position.targetPosition) < 0.035 &&
      this.aim.value.distanceTo(this.aim.targetAim) < 0.006 &&
      Math.abs(this.span.value - this.targetSpan) < 0.008
    )
  }

  /** 每帧：各分量独立临界阻尼 + FOV 由 span/距离反解 */
  update(camera: THREE.PerspectiveCamera, dt: number, rate = 9): void {
    const p = this.position
    const a = this.aim
    for (const axis of ['x', 'y', 'z'] as const) {
      const ps = spring(p.value[axis])
      ps.velocity = p.velocity[axis]
      damp(ps, p.targetPosition[axis], rate, dt)
      p.value[axis] = ps.value
      p.velocity[axis] = ps.velocity

      const as = spring(a.value[axis])
      as.velocity = a.velocity[axis]
      damp(as, a.targetAim[axis], rate, dt)
      a.value[axis] = as.value
      a.velocity[axis] = as.velocity
    }

    damp(this.span, this.targetSpan, rate, dt)

    camera.position.copy(p.value)
    camera.lookAt(a.value)
    const distance = Math.max(1, camera.position.distanceTo(a.value))
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(0.1, this.span.value) / (2 * distance)))
    camera.updateProjectionMatrix()
  }

  /** 从外部相机状态接管（进场动画结束时采样，速度有限差分续接） */
  observe(camera: THREE.PerspectiveCamera, aim: THREE.Vector3, dt: number): void {
    this.position.value.copy(camera.position)
    this.aim.value.copy(aim)
    if (dt > 0) {
      this.position.velocity.copy(camera.position).sub(this.position.targetPosition).multiplyScalar(1 / dt)
      this.aim.velocity.copy(aim).sub(this.aim.targetAim).multiplyScalar(1 / dt)
    }
    const distance = Math.max(1, camera.position.distanceTo(aim))
    this.span.value = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
  }
}

export type PresentationState =
  | 'hidden'
  | 'returning-array'
  | 'archive'
  | 'placing'
  | 'presented'
  | 'returning-center'

/**
 * 场景级状态机：hidden → returning-array → archive → placing → presented → returning-center。
 * 迁移需要相机与 lift 双重 settled 且驻留 0.08s（demo 同门槛）。
 */
export class Presentation {
  state: PresentationState = 'archive'
  private settledFor = 0

  request(next: 'archive' | 'detail'): void {
    if (next === 'detail' && this.state !== 'placing' && this.state !== 'presented') {
      this.state = 'placing'
      this.settledFor = 0
    } else if (next === 'archive' && this.state !== 'archive' && this.state !== 'returning-array') {
      this.state = this.state === 'hidden' ? 'returning-array' : 'returning-center'
      this.settledFor = 0
    }
  }

  update(
    dt: number,
    camSettled: boolean,
    liftSettled: boolean,
    onSettled: (state: 'archive' | 'presented') => void
  ): void {
    if (camSettled && liftSettled) this.settledFor += dt
    else this.settledFor = 0

    if (this.settledFor >= 0.08) {
      if (this.state === 'placing') {
        this.state = 'presented'
        this.settledFor = 0
        onSettled('presented')
      } else if (this.state === 'returning-array') {
        this.state = 'archive'
        this.settledFor = 0
        onSettled('archive')
      } else if (this.state === 'returning-center') {
        this.state = 'archive'
        this.settledFor = 0
        onSettled('archive')
      }
    }
  }

  /** 档案浏览是否可交互（placing 早期不可点） */
  get interactive(): boolean {
    return this.state === 'archive' || this.state === 'presented' || this.state === 'placing'
  }
}
