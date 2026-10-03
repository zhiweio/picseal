/**
 * 相机运动与呈现状态机 —— 移植自 Rhine-Music-Demo music-camera.ts（MIT，© LBEILC / RonaldDeng）。
 * position / aim / span 全部带速度临界阻尼（rate 9），FOV 每帧由 span 与实际渲染
 * 距离反解 —— 消除分别阻尼产生的 scale pulse。取景常量：档案墙静止于 59° 偏航 /
 * 25° 仰角 / 距离 140 / span 7.33（fov≈3° 长焦），检视态 8° / 20° / 72 / 5.9。
 */
import * as THREE from 'three'
import { damp, spring, type Spring } from './motion'

export const ARCHIVE_YAW = THREE.MathUtils.degToRad(59)
export const ARCHIVE_ELEVATION = THREE.MathUtils.degToRad(25)
export const ARCHIVE_DISTANCE = 140
export const ARCHIVE_SPAN = 7.33
export const DETAIL_YAW = THREE.MathUtils.degToRad(8)
export const DETAIL_ELEVATION = THREE.MathUtils.degToRad(20)
export const DETAIL_DISTANCE = 72
export const DETAIL_SPAN = 5.9
export const ARRAY_AIM = new THREE.Vector3(-1.091, -0.045, 0.481)
/** 检视槽的固定 z（阵列轨道围绕它滑动） */
export const RAIL_REST = -2.17
/** detail→detail 专辑快切速率 */
export const MUSIC_ALBUM_SWITCH_RATE = 9

type TrackKey = 'rail' | 'column' | 'shoulder' | 'lane'

export function musicArchiveTracksSettled(
  tracks: Record<TrackKey, Spring>,
  targets: Record<TrackKey, number>
): boolean {
  return (['rail', 'column', 'shoulder', 'lane'] as const).every(
    (key) =>
      Math.abs(tracks[key].value - targets[key]) < 0.008 && Math.abs(tracks[key].velocity) < 0.025
  )
}

/** 单一 entry/return 进度同时驱动 lift、视角与位移（1.45/1.05 ≈ 1.38s，C² 连续） */
export class MusicPlacementMotion {
  value = 0
  velocity = 0
  acceleration = 0
  private target = 0
  private readonly duration = 1.45 / 1.05
  private elapsed = this.duration
  private coefficients: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0]

  get settled(): boolean {
    return this.elapsed >= this.duration
  }

  update(target: number, dt: number, reduced: boolean): number {
    if (reduced) {
      this.target = this.value = target
      this.velocity = this.acceleration = 0
      this.elapsed = this.duration
      return this.value
    }
    if (target !== this.target) {
      this.target = target
      this.elapsed = 0
      const t = this.duration
      const distance = target - this.value - this.velocity * t - (this.acceleration * t * t) / 2
      const velocity = -this.velocity - this.acceleration * t
      const acceleration = -this.acceleration
      this.coefficients = [
        this.value,
        this.velocity,
        this.acceleration / 2,
        (10 * distance - 4 * velocity * t + (acceleration * t * t) / 2) / t ** 3,
        (-15 * distance + 7 * velocity * t - acceleration * t * t) / t ** 4,
        (6 * distance - 3 * velocity * t + (acceleration * t * t) / 2) / t ** 5
      ]
    }
    this.elapsed = Math.min(this.elapsed + Math.max(0, dt), this.duration)
    if (this.settled) {
      this.value = this.target
      this.velocity = this.acceleration = 0
    } else {
      const [a, b, c, d, e, f] = this.coefficients
      const t = this.elapsed
      this.value = a + b * t + c * t * t + d * t ** 3 + e * t ** 4 + f * t ** 5
      this.velocity = b + 2 * c * t + 3 * d * t * t + 4 * e * t ** 3 + 5 * f * t ** 4
      this.acceleration = 2 * c + 6 * d * t + 12 * e * t * t + 20 * f * t ** 3
    }
    return this.value
  }
}

export type PresentationPhase =
  | 'hidden'
  | 'returning-array'
  | 'archive'
  | 'placing'
  | 'presented'
  | 'returning-center'

/** 一次运动完成呈现；只有手动旋转过的卡需要对齐驻留 */
export class MusicPresentation {
  phase: PresentationPhase = 'hidden'
  private settledFor = 0

  request(mode: 'hidden' | 'archive' | 'detail'): void {
    const previous = this.phase
    if (mode === 'hidden') this.phase = 'hidden'
    else if (mode === 'detail') {
      if (this.phase !== 'placing' && this.phase !== 'presented') this.phase = 'placing'
    } else if (this.phase !== 'archive' && this.phase !== 'returning-array') {
      this.phase = this.phase === 'hidden' ? 'returning-array' : 'returning-center'
    }
    if (this.phase !== previous) this.settledFor = 0
  }

  /** 浏览中换选：检视姿态保持，readiness 重等；不重置移动中的轨道与速度 */
  selectionChanged(): void {
    if (this.phase === 'placing' || this.phase === 'presented') {
      this.phase = 'placing'
      this.settledFor = 0
    } else if (this.phase === 'archive' || this.phase === 'returning-array') {
      this.phase = 'returning-array'
      this.settledFor = 0
    }
  }

  get holdsDetail(): boolean {
    return this.phase === 'placing' || this.phase === 'presented' || this.phase === 'returning-center'
  }

  get placed(): boolean {
    return this.phase === 'placing' || this.phase === 'presented'
  }

  /** 未手动旋转时全部轨道在返回首帧即反转；旋转过的卡先转正再落位 */
  returnWhenAligned(aligned: boolean): void {
    if (this.phase === 'returning-center' && aligned) {
      this.phase = 'returning-array'
      this.settledFor = 0
    }
  }

  update(dt: number, cameraSettled: boolean, liftSettled: boolean, reduced: boolean): void {
    this.settledFor =
      cameraSettled && liftSettled ? this.settledFor + Math.max(0, dt) : 0
    if (!cameraSettled || !liftSettled || (!reduced && this.settledFor < 0.08)) return
    const previous = this.phase
    if (this.phase === 'placing') this.phase = 'presented'
    else if (this.phase === 'returning-array') this.phase = 'archive'
    if (previous !== this.phase) this.settledFor = 0
  }
}

/** 带连续速度的相机推轨；span 描述可见世界高度 */
export class MusicCameraMotion {
  private positionVelocity = new THREE.Vector3()
  private aimVelocity = new THREE.Vector3()
  private lastPosition = new THREE.Vector3()
  private lastAim = new THREE.Vector3()
  private span: Spring = spring(0)
  private yaw: Spring = spring(0)
  private elevation: Spring = spring(0)
  private initialized = false

  /** 参考在落定前会"巡航"过货架；小幅轨道跟随实际轨道速度，不会抵消卡片抬升 */
  navigation(
    laneSpeed: number,
    rowSpeed: number,
    detail: number,
    dt: number,
    reduced: boolean
  ): { yaw: number; elevation: number } {
    const yaw = THREE.MathUtils.clamp(laneSpeed / 2.5, -1, 1) * 0.018 * (1 - detail)
    const elevation = THREE.MathUtils.clamp(rowSpeed / 3, -1, 1) * 0.006 * (1 - detail)
    if (reduced) {
      this.yaw.value = this.yaw.velocity = this.elevation.value = this.elevation.velocity = 0
    } else {
      damp(this.yaw, yaw, 6, dt)
      damp(this.elevation, elevation, 6, dt)
    }
    return { yaw: this.yaw.value, elevation: this.elevation.value }
  }

  /** 直接跟随编排好的开场，携带其速度进入浏览 */
  observe(camera: THREE.PerspectiveCamera, aim: THREE.Vector3, dt: number): void {
    const span = 2 * camera.position.distanceTo(aim) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    if (this.initialized && dt > 0) {
      this.positionVelocity.copy(camera.position).sub(this.lastPosition).divideScalar(dt)
      this.aimVelocity.copy(aim).sub(this.lastAim).divideScalar(dt)
      this.span.velocity = (span - this.span.value) / dt
    }
    this.span.value = span
    this.remember(camera, aim)
  }

  update(
    camera: THREE.PerspectiveCamera,
    aim: THREE.Vector3,
    targetPosition: THREE.Vector3,
    targetAim: THREE.Vector3,
    targetSpan: number,
    dt: number,
    reduced: boolean
  ): void {
    if (!this.initialized) this.observe(camera, aim, 0)
    if (reduced) {
      camera.position.copy(targetPosition)
      aim.copy(targetAim)
      this.positionVelocity.set(0, 0, 0)
      this.aimVelocity.set(0, 0, 0)
      this.span.value = targetSpan
      this.span.velocity = 0
    } else {
      for (const axis of ['x', 'y', 'z'] as const) {
        const position = { value: camera.position[axis], velocity: this.positionVelocity[axis] }
        const focus = { value: aim[axis], velocity: this.aimVelocity[axis] }
        damp(position, targetPosition[axis], 9, dt)
        damp(focus, targetAim[axis], 9, dt)
        camera.position[axis] = position.value
        this.positionVelocity[axis] = position.velocity
        aim[axis] = focus.value
        this.aimVelocity[axis] = focus.velocity
      }
      damp(this.span, targetSpan, 9, dt)
    }
    // 焦距匹配实际渲染距离：position 与独立阻尼的 FOV 分头到位时不会产生 scale pulse
    const distance = Math.max(1, camera.position.distanceTo(aim))
    camera.fov = THREE.MathUtils.radToDeg(
      2 * Math.atan(Math.max(0.1, this.span.value) / (2 * distance))
    )
    camera.lookAt(aim)
    this.remember(camera, aim)
  }

  isSettled(
    camera: THREE.PerspectiveCamera,
    aim: THREE.Vector3,
    targetPosition: THREE.Vector3,
    targetAim: THREE.Vector3,
    targetSpan: number
  ): boolean {
    return (
      camera.position.distanceTo(targetPosition) < 0.035 &&
      aim.distanceTo(targetAim) < 0.006 &&
      Math.abs(this.span.value - targetSpan) < 0.008 &&
      this.positionVelocity.length() < 0.09 &&
      this.aimVelocity.length() < 0.035 &&
      Math.abs(this.span.velocity) < 0.035
    )
  }

  private remember(camera: THREE.PerspectiveCamera, aim: THREE.Vector3): void {
    this.lastPosition.copy(camera.position)
    this.lastAim.copy(aim)
    this.initialized = true
  }
}
