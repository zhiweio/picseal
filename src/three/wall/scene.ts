/**
 * 影像档案墙场景 —— 交互与动效深度移植 Rhine-Music-Demo（MIT，© LBEILC / RonaldDeng）：
 * 弧形墙面 + 波场位移 + span 驱动 FOV 相机状态机 + SSAO/Bokeh/SMAA 后处理。
 * 渲染栈采用验证过的"深色相框 + 独立印刷面网格"组合（可靠性优先）。
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js'
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import {
  damp,
  idleWave,
  nearestOccurrence,
  selectionWave,
  settlingWave,
  spring,
  columnStrength,
  PlacementMotion,
  type Spring
} from './motion'
import { CameraMotion, Presentation, DETAIL_ELEVATION, DETAIL_YAW, INSPECTION_LIFT, PREVIEW_LIFT } from './camera'
import { CASE, PRINT } from './materials'

export interface WallItem {
  id: string
  url: string
  model?: string
  params?: string
  date?: string
}

export interface WallSceneOptions {
  container: HTMLElement
  items: WallItem[]
  reducedMotion: boolean
  theme: 'night' | 'day'
  quality: 'high' | 'performance'
  onSelect: (index: number | null) => void
}

const LANES = [0, 1, 2, 3, 4, -2, -1, 5, 6]
const POOL_ROWS = 48
const LANE_SPACING = 4.7
/** 纵向行距（卡高 + 间隙），行沿 y 堆叠 */
const ROW_SPACING = CASE.height + 0.55
/** 弧形墙：lane 离中心越远越靠后 */
const CURVE = 1.15
const CARD_BASE_Y = CASE.height / 2
/** 影子承接面（常规视野外） */
const FLOOR_Y = -14
/** 可见印刷面网格池（lanes × 可见行 + 余量） */
const PRINT_POOL = LANES.length * 4

const ARCHIVE_YAW = THREE.MathUtils.degToRad(6)
const ARCHIVE_ELEVATION = THREE.MathUtils.degToRad(9)
const ARCHIVE_DISTANCE = 30
const ARCHIVE_SPAN = CASE.height * 2.9
const DETAIL_SPAN = CASE.height * 1.5
const DETAIL_DISTANCE = 10
const ARCHIVE_AIM = new THREE.Vector3(0, CARD_BASE_Y + 1.1, 0)

interface Pulse {
  row: number
  lane: number
  age: number
}

interface Cell {
  lane: number
  row: number
  itemIndex: number
}

export class ArchiveWallScene {
  private renderer: THREE.WebGLRenderer
  private composer: EffectComposer | null = null
  private bokeh: BokehPass | null = null
  private ssao: SSAOPass | null = null
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(34, 16 / 9, 1, 400)
  private cameraMotion = new CameraMotion()
  private presentation = new Presentation()
  private placement = new PlacementMotion(1.45, 0)
  private clock = new THREE.Clock()
  private opts: WallSceneOptions

  private frameMaterial: THREE.MeshStandardMaterial
  private instances: THREE.InstancedMesh[] = []
  private cells: Cell[] = []
  private textures: Array<THREE.Texture | null> = []
  private printMaterials: Array<THREE.MeshLambertMaterial | null> = []
  private printPool: Array<{ mesh: THREE.Mesh; cell: Cell | null }> = []

  private selectedGroup: THREE.Group | null = null

  private shoulderTarget = 0
  private shoulder: Spring = spring(0)
  private laneFocus = 2
  private lift: Spring = spring(0)
  private idleGain: Spring = spring(0)
  private lastInteraction = -10

  private pointer = new THREE.Vector2(-10, -10)
  private raycaster = new THREE.Raycaster()
  private hoveredInstance: number | null = null
  private selectedItem: number | null = null
  private selectedCell: Cell | null = null
  private pulses: Pulse[] = []
  private musicLevel = 0

  private frame = 0
  private disposed = false
  private listeners: Array<[HTMLElement, string, EventListenerOrEventListenerObject]> = []
  private readonly m4 = new THREE.Matrix4()
  private readonly pos = new THREE.Vector3()
  private readonly quat = new THREE.Quaternion()
  private readonly euler = new THREE.Euler()
  private readonly one = new THREE.Vector3(1, 1, 1)

  constructor(opts: WallSceneOptions) {
    this.opts = opts

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    opts.container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color('#07111f')
    this.scene.fog = new THREE.Fog('#07111f', 30, 60)

    this.frameMaterial = new THREE.MeshStandardMaterial({
      color: '#1c232e',
      roughness: 0.42,
      metalness: 0.35
    })

    this.buildLights()
    this.buildFloor()
    this.buildInstances()
    this.buildPrintPool()

    if (opts.quality === 'high') this.buildComposer()
    this.setTheme(opts.theme)

    this.bind(opts.container)
    this.resize()
    this.frame = requestAnimationFrame(this.animate)
  }

  /* ── 场景搭建 ── */

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight('#e2eeff', '#56708c', 0.9))

    const key = new THREE.DirectionalLight('#e5f0ff', 1.7)
    key.position.set(-8, 14, 12)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -20
    key.shadow.camera.right = 20
    key.shadow.camera.top = 20
    key.shadow.camera.bottom = -20
    key.shadow.camera.near = 0.1
    key.shadow.camera.far = 60
    key.shadow.normalBias = 0.02
    this.scene.add(key)

    const fill = new THREE.DirectionalLight('#ffffff', 0.5)
    fill.position.set(7, 6, 14)
    this.scene.add(fill)
  }

  private buildFloor(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshStandardMaterial({ color: '#0b1828', roughness: 0.95 })
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = FLOOR_Y
    floor.receiveShadow = true
    this.scene.add(floor)
  }

  /** 相框箱体：9 lanes × 48 rows 实例化 */
  private buildInstances(): void {
    const count = LANES.length * POOL_ROWS
    const box = new THREE.BoxGeometry(CASE.width, CASE.height, CASE.depth)
    for (let laneIdx = 0; laneIdx < LANES.length; laneIdx += 1) {
      for (let rowIdx = 0; rowIdx < POOL_ROWS; rowIdx += 1) {
        const itemIndex = (laneIdx * POOL_ROWS + rowIdx) % this.opts.items.length
        this.cells.push({ lane: LANES[laneIdx]!, row: rowIdx, itemIndex })
      }
    }
    for (let i = 0; i < 3; i += 1) {
      const mesh = new THREE.InstancedMesh(box, this.frameMaterial, count)
      mesh.frustumCulled = false
      this.scene.add(mesh)
      this.instances.push(mesh)
    }
  }

  /**
   * 印刷面池：可见格位约 lanes×4，网格复用。
   * 每个独立底片一个共享材质（map 指向其纹理），网格按需指派。
   */
  private buildPrintPool(): void {
    this.opts.items.forEach((item, itemIndex) => {
      const texture = new THREE.TextureLoader().load(item.url)
      texture.colorSpace = THREE.SRGBColorSpace
      this.textures[itemIndex] = texture
      this.printMaterials[itemIndex] = new THREE.MeshLambertMaterial({
        map: texture,
        toneMapped: false
      })
    })

    const geo = new THREE.PlaneGeometry(PRINT.width, PRINT.height)
    for (let i = 0; i < PRINT_POOL; i += 1) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }))
      mesh.frustumCulled = false
      this.scene.add(mesh)
      this.printPool.push({ mesh, cell: null })
    }
  }

  private buildComposer(): void {
    const composer = new EffectComposer(this.renderer)
    composer.addPass(new RenderPass(this.scene, this.camera))
    const ssao = new SSAOPass(this.scene, this.camera, 1, 1)
    ssao.kernelRadius = 0.18
    ssao.minDistance = 0.001
    ssao.maxDistance = 0.035
    composer.addPass(ssao)
    const bokeh = new BokehPass(this.scene, this.camera, { focus: 25, aperture: 0.0003, maxblur: 0.011 })
    composer.addPass(bokeh)
    composer.addPass(new SMAAPass(1, 1))
    composer.addPass(new OutputPass())
    this.composer = composer
    this.bokeh = bokeh
    this.ssao = ssao
  }

  /* ── 主题 ── */

  setTheme(theme: 'night' | 'day'): void {
    const bg = theme === 'night' ? '#07111f' : '#b9c7cc'
    ;(this.scene.background as THREE.Color).set(bg)
    ;(this.scene.fog as THREE.Fog).color.set(bg)
    this.renderer.toneMappingExposure = theme === 'night' ? 1.08 : 1.0
    const floor = this.scene.children.find(
      (c) => c instanceof THREE.Mesh && Math.abs(c.rotation.x + Math.PI / 2) < 0.01
    ) as THREE.Mesh | undefined
    if (floor) {
      ;(floor.material as THREE.MeshStandardMaterial).color.set(theme === 'night' ? '#0b1828' : '#8fa3b0')
    }
    this.frameMaterial.color.set(theme === 'night' ? '#1c232e' : '#d9d2c6')
  }

  /* ── 音频律动挂钩 ── */

  setMusicLevel(level: number): void {
    this.musicLevel = level
  }

  /** 节拍 onset → 焦点列注入涟漪 + 选中卡微弹 */
  beatPulse(strength = 1): void {
    if (this.disposed) return
    this.pulses.push({ row: this.shoulder.value, lane: this.laneFocus, age: 0 })
    if (this.pulses.length > 6) this.pulses.shift()
    this.lift.velocity += 0.5 * strength
  }

  /** 水印实渲完成后升级某底片的印刷纹理（产品自我演示） */
  upgradeItem(itemIndex: number, url: string): void {
    if (this.disposed) return
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace
      const old = this.textures[itemIndex]
      this.textures[itemIndex] = t
      const material = this.printMaterials[itemIndex]
      if (material) {
        material.map = t
        material.needsUpdate = true
      }
      old?.dispose()
    })
  }

  /* ── 交互 ── */

  private bind(container: HTMLElement): void {
    const on = <E extends Event>(type: string, fn: (e: E) => void, opts?: AddEventListenerOptions) => {
      container.addEventListener(type, fn as EventListener, opts)
      this.listeners.push([container, type, fn as EventListener])
    }

    on<PointerEvent>('pointermove', (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect()
      this.pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
    })

    on<WheelEvent>(
      'wheel',
      (e) => {
        e.preventDefault()
        if (this.presentation.state === 'presented' || this.presentation.state === 'placing') {
          this.select(null)
          return
        }
        this.shoulderTarget -= e.deltaY * 0.004
        this.lastInteraction = this.clock.elapsedTime
      },
      { passive: false }
    )

    on<PointerEvent>('pointerdown', () => {
      if (this.hoveredInstance !== null && this.presentation.interactive && this.placement.value < 0.2) {
        const cell = this.cells[this.hoveredInstance]
        if (cell) this.select(cell.itemIndex, cell)
        return
      }
      if (this.presentation.state === 'presented') this.select(null)
    })

    on<KeyboardEvent>('keydown', (e) => {
      if (this.presentation.state === 'presented' && e.key === 'Escape') this.select(null)
    })
  }

  /** 选中：placement 驱动相机与 lift 的单一运动 */
  select(itemIndex: number | null, cell?: Cell): void {
    if (this.disposed) return
    if (itemIndex === null) {
      if (this.selectedItem === null) return
      this.selectedItem = null
      this.selectedCell = null
      this.presentation.request('archive')
      this.placement.set(0, this.opts.reducedMotion)
      this.opts.onSelect(null)
      return
    }
    const nextCell = cell ?? this.cells.find((c) => c.itemIndex === itemIndex) ?? null
    this.selectedItem = itemIndex
    this.selectedCell = nextCell
    this.pulses.push({ row: nextCell?.row ?? 0, lane: nextCell?.lane ?? 2, age: 0 })
    this.presentation.request('detail')
    this.placement.set(1, this.opts.reducedMotion)
    this.opts.onSelect(itemIndex)
  }

  /* ── 每帧 ── */

  private animate = (): void => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.animate)
    const dt = Math.min(this.clock.getDelta(), 0.05)
    const time = this.clock.elapsedTime
    const detail = this.placement.value
    const reduced = this.opts.reducedMotion
    const rates = reduced ? 35 : 1

    damp(this.shoulder, this.shoulderTarget, reduced ? 35 : 4, dt)
    this.placement.update(dt)

    const liftTarget =
      this.selectedItem !== null
        ? INSPECTION_LIFT
        : this.hoveredInstance !== null && this.presentation.state === 'archive'
          ? PREVIEW_LIFT
          : 0
    damp(this.lift, liftTarget, (this.selectedItem !== null ? 9 : 4.2) * rates, dt)

    const idleTarget = time - this.lastInteraction > 2.5 ? 1 : 0
    damp(this.idleGain, idleTarget * (1 + this.musicLevel * 1.4), reduced ? 35 : 0.8, dt)

    // 相机：archive/detail 姿态插值 + 指针视差 + 微呼吸
    const yaw = THREE.MathUtils.lerp(ARCHIVE_YAW, DETAIL_YAW, detail) + Math.sin(time * 0.11) * 0.01 * (1 - detail)
    const elevation = THREE.MathUtils.lerp(ARCHIVE_ELEVATION, DETAIL_ELEVATION, detail)
    const distance = THREE.MathUtils.lerp(ARCHIVE_DISTANCE, DETAIL_DISTANCE, detail)
    const span = THREE.MathUtils.lerp(ARCHIVE_SPAN, DETAIL_SPAN, detail)

    let aim = ARCHIVE_AIM.clone()
    aim.y += this.shoulder.value * ROW_SPACING * 0.92
    if (this.selectedItem !== null && this.selectedCell) {
      const pos = this.cellWorldPosition(this.selectedCell)
      aim = new THREE.Vector3(pos.x * 0.92, pos.y + CASE.height / 2, pos.z + this.lift.value * 0.8)
    }

    const dir = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(yaw) * Math.cos(elevation)
    )
    const cam = this.cameraMotion
    cam.position.targetPosition.copy(aim).addScaledVector(dir, distance)
    cam.position.targetPosition.x += this.pointer.x * 0.35 * (1 - detail)
    cam.position.targetPosition.y += this.pointer.y * 0.22 * (1 - detail)
    cam.aim.targetAim.copy(aim)
    cam.targetSpan = span
    cam.update(this.camera, dt, reduced ? 35 : 9)

    // 雾锚定相机距离
    const renderedDistance = this.camera.position.distanceTo(cam.aim.value)
    const fog = this.scene.fog as THREE.Fog
    fog.near = renderedDistance + (6 - 3 * detail)
    fog.far = renderedDistance + (26 - 14 * detail)

    // Bokeh 每帧跟焦
    if (this.bokeh) {
      const focusPoint =
        this.selectedCell && this.selectedGroup
          ? this.selectedGroup.position.clone()
          : new THREE.Vector3(0, aim.y, 0)
      const local = focusPoint.applyMatrix4(this.camera.matrixWorldInverse)
      const uniforms = (this.bokeh as unknown as { uniforms?: Record<string, { value?: number } | undefined> })
        .uniforms ?? {}
      if (uniforms.focus) uniforms.focus.value = Math.max(1, -local.z)
      if (uniforms.aperture) uniforms.aperture.value = THREE.MathUtils.lerp(0.0003, 0.0008, detail)
    }

    // 脉冲推进
    for (const pulse of this.pulses) pulse.age += dt
    while (this.pulses.length > 0 && this.pulses[0]!.age > 3.2) this.pulses.shift()

    // ── 相框实例（波场位移）──
    const idleGainValue = Math.max(0, Math.min(1.6, this.idleGain.value))
    const selectedSlot =
      this.selectedCell && this.selectedItem !== null ? this.cells.indexOf(this.selectedCell) : -1
    const shoulderRow = Math.round(this.shoulder.value)

    this.cells.forEach((cell, i) => {
      const rowDelta = nearestOccurrence(cell.row, shoulderRow, POOL_ROWS) - cell.row
      const logicalRow = cell.row + rowDelta
      if (Math.abs(logicalRow - shoulderRow) > 5) {
        // 远行：拖到远处隐藏，不逐帧细化
        this.pos.set(0, 1e6, 0)
        this.one.setScalar(0.0001)
        this.euler.set(0, 0, 0)
        this.quat.setFromEuler(this.euler)
        this.m4.compose(this.pos, this.quat, this.one)
        for (const mesh of this.instances) mesh.setMatrixAt(i, this.m4)
        return
      }

      const relRow = cell.row + rowDelta
      const laneOffset = cell.lane - 2
      const x = laneOffset * LANE_SPACING
      const z = -(Math.abs(laneOffset) ** 1.5) * CURVE
      const y = CARD_BASE_Y + (relRow - this.shoulder.value) * ROW_SPACING

      const cStrength = columnStrength(cell.lane, this.laneFocus, detail)
      let field =
        settlingWave(cell.row - this.shoulder.value, 26.56) * cStrength +
        idleWave(cell.row, cell.lane, time, idleGainValue * 0.12)
      for (const pulse of this.pulses) {
        const d = Math.hypot(cell.row - pulse.row, (cell.lane - pulse.lane) * 2.2)
        field += selectionWave(d, pulse.age) * cStrength
      }

      const slope =
        (settlingWave(cell.row + 0.5 - this.shoulder.value, 26.56) -
          settlingWave(cell.row - 0.5 - this.shoulder.value, 26.56)) *
        0.02 *
        (1 - detail)

      const hide = i === selectedSlot ? 0.0001 : 1
      this.pos.set(x, y + Math.max(-0.3, field), z + field * 0.22)
      this.euler.set(slope, 0, 0)
      this.quat.setFromEuler(this.euler)
      this.one.setScalar(hide)
      this.m4.compose(this.pos, this.quat, this.one)
      for (const mesh of this.instances) mesh.setMatrixAt(i, this.m4)
    })

    for (const mesh of this.instances) mesh.instanceMatrix.needsUpdate = true

    this.updateHover()
    this.updatePrintPool()
    this.updateSelectedGroup()

    this.presentation.update(
      dt,
      cam.settled(),
      Math.abs(this.lift.value - liftTarget) < 0.008 && Math.abs(this.lift.velocity) < 0.025,
      () => undefined
    )

    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }

  private cellWorldPosition(cell: Cell): THREE.Vector3 {
    const rowDelta = nearestOccurrence(cell.row, Math.round(this.shoulder.value), POOL_ROWS) - cell.row
    const relRow = cell.row + rowDelta
    const laneOffset = cell.lane - 2
    return new THREE.Vector3(
      laneOffset * LANE_SPACING,
      CARD_BASE_Y + (relRow - this.shoulder.value) * ROW_SPACING,
      -(Math.abs(laneOffset) ** 1.5) * CURVE
    )
  }

  private updateHover(): void {
    if (this.placement.value > 0.2 || this.presentation.state !== 'archive') {
      this.hoveredInstance = null
      this.renderer.domElement.style.cursor = 'grab'
      return
    }
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObject(this.instances[0]!, false)
    const id = hits.length > 0 ? (hits[0]!.instanceId ?? null) : null
    this.hoveredInstance = id
    this.renderer.domElement.style.cursor = id !== null ? 'pointer' : 'grab'
  }

  /** 印刷面池：把可见格位指派给池网格（含波场位移） */
  private updatePrintPool(): void {
    const shoulderRow = this.shoulder.value
    const idleGainValue = Math.max(0, Math.min(1.6, this.idleGain.value))
    const selectedSlot =
      this.selectedCell && this.selectedItem !== null ? this.cells.indexOf(this.selectedCell) : -1

    const assignments: Array<{ cell: Cell; x: number; y: number; z: number }> = []
    for (const cell of this.cells) {
      const rowDelta = nearestOccurrence(cell.row, Math.round(shoulderRow), POOL_ROWS) - cell.row
      const relRow = cell.row + rowDelta
      if (Math.abs(relRow - shoulderRow) > 3) continue
      if (this.cells.indexOf(cell) === selectedSlot) continue
      const laneOffset = cell.lane - 2
      const x = laneOffset * LANE_SPACING
      const y = CARD_BASE_Y + (relRow - shoulderRow) * ROW_SPACING
      const z = -(Math.abs(laneOffset) ** 1.5) * CURVE + 0.085

      const cStrength = columnStrength(cell.lane, this.laneFocus, this.placement.value)
      let field =
        settlingWave(cell.row - shoulderRow, 26.56) * cStrength +
        idleWave(cell.row, cell.lane, this.clock.elapsedTime, idleGainValue * 0.12)
      for (const pulse of this.pulses) {
        const d = Math.hypot(cell.row - pulse.row, (cell.lane - pulse.lane) * 2.2)
        field += selectionWave(d, pulse.age) * cStrength
      }

      assignments.push({ cell, x, y: y + Math.max(-0.3, field), z: z + field * 0.22 })
    }

    assignments.sort(
      (a, b) => Math.abs(a.y - this.camera.position.y) - Math.abs(b.y - this.camera.position.y)
    )

    this.printPool.forEach((slot, poolIndex) => {
      const assignment = assignments[poolIndex]
      if (!assignment) {
        ;(slot.mesh.material as THREE.MeshBasicMaterial).visible = false
        slot.cell = null
        return
      }
      slot.cell = assignment.cell
      const material =
        this.printMaterials[assignment.cell.itemIndex] ?? new THREE.MeshBasicMaterial({ visible: false })
      slot.mesh.material = material
      slot.mesh.position.set(assignment.x, assignment.y, assignment.z)
      // 纹理比例 → cover 装裱窗（PRINT 尺寸为基准）
      const texture = (material as THREE.MeshLambertMaterial).map
      const aspect = texture?.image ? (texture.image as HTMLImageElement).width / (texture.image as HTMLImageElement).height : 1.5
      const windowRatio = PRINT.width / PRINT.height
      let sx = 1
      let sy = 1
      if (aspect > windowRatio) sx = windowRatio / aspect
      else sy = aspect / windowRatio
      slot.mesh.scale.set(sx, sy, 1)
      ;(material as THREE.MeshLambertMaterial).visible = true
    })
  }

  /** 选中实体卡：隐藏该格位实例，用独立 Group 承接 lift（沿 +z 出墙） */
  private updateSelectedGroup(): void {
    if (this.selectedItem === null || !this.selectedCell) {
      if (this.selectedGroup) {
        this.scene.remove(this.selectedGroup)
        this.selectedGroup = null
      }
      return
    }

    if (!this.selectedGroup) {
      const group = new THREE.Group()
      const box = new THREE.BoxGeometry(CASE.width, CASE.height, CASE.depth)
      for (let i = 0; i < 3; i += 1) group.add(new THREE.Mesh(box, this.frameMaterial))
      const material =
        this.printMaterials[this.selectedItem] ?? new THREE.MeshBasicMaterial({ visible: false })
      const print = new THREE.Mesh(new THREE.PlaneGeometry(PRINT.width, PRINT.height), material)
      print.position.z = PRINT.z
      group.add(print)
      this.scene.add(group)
      this.selectedGroup = group
    }

    this.selectedGroup.position.copy(this.cellWorldPosition(this.selectedCell))
    this.selectedGroup.position.z += this.lift.value
  }

  resize(): void {
    const parent = this.renderer.domElement.parentElement
    if (!parent) return
    const w = parent.clientWidth
    const h = parent.clientHeight
    this.renderer.setSize(w, h)
    this.composer?.setSize(w, h)
    this.ssao?.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    for (const [target, type, fn] of this.listeners) target.removeEventListener(type, fn)
    this.listeners = []
    const box = this.renderer.domElement.parentElement
    for (const t of this.textures) t?.dispose()
    for (const m of this.printMaterials) m?.dispose()
    this.frameMaterial.dispose()
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose()
    })
    this.composer?.dispose()
    this.renderer.dispose()
    box?.removeChild(this.renderer.domElement)
  }
}
