/**
 * 影像档案墙场景 —— 交互与动效深度移植 Rhine-Music-Demo（MIT，© LBEILC / RonaldDeng）：
 * 暖调画廊 + 磨砂玻璃档案盒（transmission）+ 封面图集实例 + 横向纵深巷道 + 长焦压缩视场
 * + 波场位移 + span 驱动 FOV 相机状态机 + SSAO/Bokeh/SMAA 后处理。
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js'
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import {
  archiveWave,
  damp,
  idleWave,
  nearestOccurrence,
  returnStep,
  selectionWave,
  settlingWave,
  smooth,
  spring,
  columnStrength,
  PlacementMotion,
  type Spring
} from './motion'
import { CameraMotion, Presentation, DETAIL_ELEVATION, DETAIL_YAW, INSPECTION_LIFT, PREVIEW_LIFT } from './camera'
import { CASE, COVER, createCaseMaterials, createCoverMaterial, applyDayFinish, type CaseMaterials } from './materials'
import { CoverAtlas } from './atlas'

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

/** 横向 9 列（可循环滚动）× 纵深 48 行（雾中渐隐）—— demo archive-loop 结构 */
const LANES = [0, 1, 2, 3, 4, -2, -1, 5, 6]
const POOL_LANES = LANES.length
const DEPTH_ROWS = 48
const LANE_SPACING = 5.2
const ROW_SPACING = 0.62
const CENTER_ROW = (DEPTH_ROWS - 1) / 2
const CARD_Y = 1.85
const FLOOR_Y = -4.63

/** 长焦压缩视场（demo archive shot fov≈6°）：距离 66 + span 16 → fov ≈ 13.7° */
const ARCHIVE_YAW = THREE.MathUtils.degToRad(6)
const ARCHIVE_ELEVATION = THREE.MathUtils.degToRad(5)
const ARCHIVE_DISTANCE = 66
const ARCHIVE_SPAN = 16
const DETAIL_SPAN = 6.5
const DETAIL_DISTANCE = 12
const ARCHIVE_AIM = new THREE.Vector3(0, CARD_Y + 0.4, 0)
/** 纵深窗口整体后移，避免最近行过度逼近相机 */
const ROW_Z_OFFSET = -2.5

/** 进场波窗口（秒）：archiveWave 波前扫过后淡出 */
const BOOT_WAVE_END = 4.6

interface Pulse {
  lane: number
  row: number
  age: number
}

interface Cell {
  laneIdx: number
  rowIdx: number
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

  private cases: CaseMaterials
  private atlas: CoverAtlas
  private coverMaterial: THREE.MeshLambertMaterial
  private glassMesh: THREE.InstancedMesh
  private coverMesh: THREE.InstancedMesh
  private cells: Cell[] = []
  private itemUrls: string[]
  private hemi: THREE.HemisphereLight
  private key: THREE.DirectionalLight
  private fill: THREE.DirectionalLight
  private floor: THREE.Mesh

  private selectedGroup: THREE.Group | null = null
  private selectedCover: THREE.Mesh | null = null
  private heroTexture: THREE.Texture | null = null
  private heroItem: number | null = null

  private shoulderTarget = 0
  private shoulder: Spring = spring(0)
  private lift: Spring = spring(0)
  private idleGain: Spring = spring(0)
  private rotate: Spring = spring(0)
  private lastInteraction = -10

  private pointer = new THREE.Vector2(0, 0)
  private raycaster = new THREE.Raycaster()
  private hoveredInstance: number | null = null
  private selectedItem: number | null = null
  private selectedCell: Cell | null = null
  private pulses: Pulse[] = []
  private musicLevel = 0

  private dragPointerId: number | null = null
  private dragLastX = 0
  private dragMoved = 0
  private rotateDrag = false

  private frame = 0
  private lastFrameAt = 0
  private watchdog: number | null = null
  private disposed = false
  private listeners: Array<[HTMLElement, string, EventListenerOrEventListenerObject]> = []
  private readonly m4 = new THREE.Matrix4()
  private readonly pos = new THREE.Vector3()
  private readonly quat = new THREE.Quaternion()
  private readonly euler = new THREE.Euler()
  private readonly one = new THREE.Vector3(1, 1, 1)

  constructor(opts: WallSceneOptions) {
    this.opts = opts

    this.renderer = new THREE.WebGLRenderer({
      // 高画质路径由 SMAA 兜底抗锯齿；性能路径直接开 MSAA
      antialias: opts.quality === 'performance',
      alpha: false,
      powerPreference: 'high-performance'
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    opts.container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color('#eae5e1')
    this.scene.fog = new THREE.Fog('#eae5e1', 40, 90)

    // IBL：transmission 玻璃没有环境贴图就是死玻璃（demo archive-lighting 同款）
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()

    this.cases = createCaseMaterials()
    this.itemUrls = opts.items.map((i) => i.url)

    // 索引：列 × 深度行，物品按行主序铺满网格
    const count = POOL_LANES * DEPTH_ROWS
    for (let laneIdx = 0; laneIdx < POOL_LANES; laneIdx += 1) {
      for (let rowIdx = 0; rowIdx < DEPTH_ROWS; rowIdx += 1) {
        this.cells.push({
          laneIdx,
          rowIdx,
          itemIndex: (rowIdx * POOL_LANES + laneIdx) % opts.items.length
        })
      }
    }

    const glassGeo = new THREE.BoxGeometry(CASE.width, CASE.height, CASE.depth)
    this.glassMesh = new THREE.InstancedMesh(glassGeo, this.cases.frosted, count)
    this.glassMesh.frustumCulled = false
    this.glassMesh.castShadow = true
    this.scene.add(this.glassMesh)

    const coverGeo = new THREE.PlaneGeometry(COVER.width, COVER.height)
    coverGeo.translate(0, 0, COVER.z)
    const coverTiles = new Float32Array(count * 4)
    coverGeo.setAttribute('coverTile', new THREE.InstancedBufferAttribute(coverTiles, 4))
    this.atlas = new CoverAtlas(this.renderer.capabilities.maxTextureSize, Math.max(16, opts.items.length))
    this.coverMaterial = createCoverMaterial(this.atlas.texture)
    this.coverMesh = new THREE.InstancedMesh(coverGeo, this.coverMaterial, count)
    this.coverMesh.frustumCulled = false
    this.scene.add(this.coverMesh)

    this.hemi = new THREE.HemisphereLight('#fffaf5', '#b49b80', 0.65)
    this.scene.add(this.hemi)
    this.key = new THREE.DirectionalLight('#fff4e5', 1.4)
    this.key.position.set(-8, 14, 6)
    this.key.castShadow = true
    this.key.shadow.mapSize.set(2048, 2048)
    this.key.shadow.camera.left = -18
    this.key.shadow.camera.right = 18
    this.key.shadow.camera.top = 16
    this.key.shadow.camera.bottom = -16
    this.key.shadow.camera.near = 0.1
    this.key.shadow.camera.far = 60
    this.key.shadow.normalBias = 0.035
    this.key.shadow.bias = -0.0003
    this.key.shadow.intensity = 0.32
    this.scene.add(this.key)
    this.fill = new THREE.DirectionalLight('#ffffff', 0.6)
    this.fill.position.set(7, 8, -10)
    this.scene.add(this.fill)

    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshStandardMaterial({ color: '#d8c9b9', roughness: 0.95 })
    )
    this.floor.rotation.x = -Math.PI / 2
    this.floor.position.y = FLOOR_Y
    this.floor.receiveShadow = true
    this.scene.add(this.floor)

    if (opts.quality === 'high') this.buildComposer()
    this.setTheme(opts.theme)

    this.bind(opts.container)
    this.resize()
    void this.fillAtlas()
    this.frame = requestAnimationFrame(this.animate)
    // rAF 饥饿兜底：标签页被遮挡/节流时以低帧率维持场景推进（前台 rAF 正常时自动闲置）
    this.watchdog = window.setInterval(() => {
      if (this.disposed) return
      if (performance.now() - this.lastFrameAt < 250) return
      this.animate()
    }, 1000 / 30)
  }

  /* ── 场景搭建 ── */

  /** 封面图集逐张填充（blob URL → ImageBitmap → contain-fit 瓦片） */
  private async fillAtlas(): Promise<void> {
    for (let i = 0; i < this.itemUrls.length; i += 1) {
      if (this.disposed) return
      try {
        const res = await fetch(this.itemUrls[i]!)
        const bmp = await createImageBitmap(await res.blob())
        if (this.disposed) {
          bmp.close()
          return
        }
        this.atlas.set(i, bmp)
        bmp.close()
        this.syncCoverTiles()
      } catch {
        /* 单张失败留空瓦片（透明） */
      }
    }
  }

  /** 把图集瓦片同步到全部实例的 coverTile 属性 */
  private syncCoverTiles(): void {
    const attr = this.coverMesh.geometry.getAttribute('coverTile') as THREE.InstancedBufferAttribute
    const array = attr.array as Float32Array
    this.cells.forEach((cell, i) => {
      const tile = this.atlas.tileOf(cell.itemIndex)
      if (!tile) return
      array[i * 4] = tile.offsetX
      array[i * 4 + 1] = tile.offsetY
      array[i * 4 + 2] = tile.scaleX
      array[i * 4 + 3] = tile.scaleY
    })
    attr.needsUpdate = true
  }

  private buildComposer(): void {
    const composer = new EffectComposer(this.renderer)
    composer.addPass(new RenderPass(this.scene, this.camera))
    const ssao = new SSAOPass(this.scene, this.camera, 1, 1)
    ssao.kernelRadius = 0.4
    ssao.minDistance = 0.001
    ssao.maxDistance = 0.09
    composer.addPass(ssao)
    const bokeh = new BokehPass(this.scene, this.camera, { focus: 60, aperture: 0.0003, maxblur: 0.011 })
    composer.addPass(bokeh)
    composer.addPass(new SMAAPass(1, 1))
    composer.addPass(new OutputPass())
    this.composer = composer
    this.bokeh = bokeh
    this.ssao = ssao
  }

  /* ── 主题 ── */

  setTheme(theme: 'night' | 'day'): void {
    const day = theme === 'day'
    const bg = day ? '#eae5e1' : '#241d15'
    ;(this.scene.background as THREE.Color).set(bg)
    ;(this.scene.fog as THREE.Fog).color.set(bg)
    this.renderer.toneMappingExposure = day ? 1.0 : 1.08
    this.scene.environmentIntensity = day ? 0.5 : 0.68
    this.hemi.intensity = day ? 0.65 : 0.9
    this.key.intensity = day ? 1.4 : 1.7
    ;(this.floor.material as THREE.MeshStandardMaterial).color.set(day ? '#d8c9b9' : '#2d2519')
    if (day) applyDayFinish(this.cases)
    else {
      // 恢复夜间通用值（createCaseMaterials 的初始参数）
      this.cases.frosted.transmission = 0.78
      this.cases.frosted.roughness = 0.28
      this.cases.frosted.thickness = 0.28
      this.cases.frosted.attenuationColor.set('#d4c7b4')
      this.cases.frosted.attenuationDistance = 1.2
      this.cases.frosted.color.set('#fff7ed')
    }
  }

  /* ── 音频律动挂钩 ── */

  setMusicLevel(level: number): void {
    this.musicLevel = level
  }

  /** 节拍 onset → 焦点列注入涟漪 + 选中卡微弹 */
  beatPulse(strength = 1): void {
    if (this.disposed) return
    this.pulses.push({ lane: Math.round(this.shoulder.value), row: CENTER_ROW, age: 0 })
    if (this.pulses.length > 6) this.pulses.shift()
    this.lift.velocity += 0.5 * strength
  }

  /** 水印实渲完成后原位重绘图集瓦片（产品自我演示） */
  upgradeItem(itemIndex: number, url: string): void {
    if (this.disposed) return
    this.itemUrls[itemIndex] = url
    void (async () => {
      try {
        const res = await fetch(url)
        const bmp = await createImageBitmap(await res.blob())
        if (this.disposed) {
          bmp.close()
          return
        }
        this.atlas.set(itemIndex, bmp)
        bmp.close()
        this.syncCoverTiles()
      } catch {
        /* 升级失败保留原图 */
      }
    })()
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
      if (this.dragPointerId !== e.pointerId) return
      const dx = e.clientX - this.dragLastX
      this.dragLastX = e.clientX
      this.dragMoved += Math.abs(dx)
      if (this.rotateDrag) {
        // 检视态：拖拽旋转选中卡（demo ±0.8 rad，松手指数回正）
        this.rotate.value = THREE.MathUtils.clamp(this.rotate.value + dx * 0.004, -0.8, 0.8)
      } else if (this.presentation.interactive && this.placement.value < 0.2) {
        this.shoulderTarget += dx * 0.008
        this.lastInteraction = this.clock.elapsedTime
      }
    })

    on<PointerEvent>('pointerdown', (e) => {
      this.dragPointerId = e.pointerId
      this.dragLastX = e.clientX
      this.dragMoved = 0
      this.rotateDrag = this.presentation.state === 'presented'
    })

    on<PointerEvent>('pointerup', () => {
      const wasClick = this.dragMoved < 6
      const rotating = this.rotateDrag
      this.dragPointerId = null
      this.rotateDrag = false
      if (!wasClick || rotating) return
      if (this.hoveredInstance !== null && this.presentation.interactive && this.placement.value < 0.2) {
        const cell = this.cells[this.hoveredInstance]
        if (cell) this.select(cell.itemIndex, cell)
        return
      }
      if (this.presentation.state === 'presented') this.select(null)
    })

    on<WheelEvent>(
      'wheel',
      (e) => {
        e.preventDefault()
        if (this.presentation.state === 'presented' || this.presentation.state === 'placing') {
          this.select(null)
          return
        }
        this.shoulderTarget += e.deltaY * 0.005
        this.lastInteraction = this.clock.elapsedTime
      },
      { passive: false }
    )

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
    this.pulses.push({ lane: nextCell?.laneIdx ?? 4, row: nextCell?.rowIdx ?? CENTER_ROW, age: 0 })
    this.presentation.request('detail')
    this.placement.set(1, this.opts.reducedMotion)
    this.opts.onSelect(itemIndex)
  }

  /* ── 每帧 ── */

  private animate = (): void => {
    if (this.disposed) return
    // 看门狗触发时先撤销挂起的 rAF，保证只有一条动画链
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(this.animate)
    this.lastFrameAt = performance.now()
    const dt = Math.min(this.clock.getDelta(), 0.05)
    const time = this.clock.elapsedTime
    const detail = this.placement.value
    const reduced = this.opts.reducedMotion
    const rates = reduced ? 35 : 1

    damp(this.shoulder, this.shoulderTarget, reduced ? 35 : 3.7, dt)
    this.placement.update(dt)

    const liftTarget =
      this.selectedItem !== null
        ? INSPECTION_LIFT
        : this.hoveredInstance !== null && this.presentation.state === 'archive'
          ? PREVIEW_LIFT
          : 0
    damp(this.lift, liftTarget, (this.selectedItem !== null ? 9 : 4.2) * rates, dt)

    // 检视旋转：非拖拽时指数回正（demo returnStep）
    if (!this.rotateDrag) this.rotate.value = returnStep(this.rotate.value, dt, reduced)

    const idleTarget = time - this.lastInteraction > 2.5 ? 1 : 0
    damp(this.idleGain, idleTarget * (1 + this.musicLevel * 1.4), reduced ? 35 : 0.8, dt)

    // 相机：archive/detail 姿态插值 + 指针视差 + 微呼吸
    const yaw = THREE.MathUtils.lerp(ARCHIVE_YAW, DETAIL_YAW, detail) + Math.sin(time * 0.11) * 0.01 * (1 - detail)
    const elevation = THREE.MathUtils.lerp(ARCHIVE_ELEVATION, DETAIL_ELEVATION, detail)
    const distance = THREE.MathUtils.lerp(ARCHIVE_DISTANCE, DETAIL_DISTANCE, detail)
    const span = THREE.MathUtils.lerp(ARCHIVE_SPAN, DETAIL_SPAN, detail)

    let aim = ARCHIVE_AIM.clone()
    if (this.selectedItem !== null && this.selectedCell) {
      const pos = this.cellWorldPosition(this.selectedCell)
      aim = new THREE.Vector3(pos.x * 0.92, pos.y + CASE.height / 2, pos.z + this.lift.value * 0.95)
    }

    const dir = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(yaw) * Math.cos(elevation)
    )
    const cam = this.cameraMotion
    cam.position.targetPosition.copy(aim).addScaledVector(dir, distance)
    cam.position.targetPosition.x += this.pointer.x * 0.5 * (1 - detail)
    cam.position.targetPosition.y += this.pointer.y * 0.3 * (1 - detail)
    cam.aim.targetAim.copy(aim)
    cam.targetSpan = span
    cam.update(this.camera, dt, reduced ? 35 : 9)

    // 雾锚定相机距离（demo 原式：雾始终贴着墙面）
    const renderedDistance = this.camera.position.distanceTo(cam.aim.value)
    const fog = this.scene.fog as THREE.Fog
    fog.near = renderedDistance + THREE.MathUtils.lerp(4, -1, detail)
    fog.far = renderedDistance + THREE.MathUtils.lerp(22, 12, detail)

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

    // ── 档案盒实例（波场位移，玻璃与封面共享矩阵）──
    const idleGainValue = Math.max(0, Math.min(1.6, this.idleGain.value))
    const selectedSlot =
      this.selectedCell && this.selectedItem !== null ? this.cells.indexOf(this.selectedCell) : -1
    const bootWave = (1 - smooth((time - BOOT_WAVE_END + 1.5) / 1.5)) * smooth((time - 0.15) / 0.4)

    this.cells.forEach((cell, i) => {
      const laneDelta = nearestOccurrence(cell.laneIdx, Math.round(this.shoulder.value), POOL_LANES) - cell.laneIdx
      const logicalLane = cell.laneIdx + laneDelta
      const dLanes = logicalLane - this.shoulder.value

      const x = dLanes * LANE_SPACING
      const z = (cell.rowIdx - CENTER_ROW) * ROW_SPACING + ROW_Z_OFFSET
      const y = CARD_Y

      const cStrength = columnStrength(logicalLane, this.shoulder.value, detail)
      let field =
        settlingWave(dLanes * LANE_SPACING, 26.56) * cStrength +
        idleWave(cell.rowIdx, cell.laneIdx, time, idleGainValue * 0.12) +
        archiveWave(cell.rowIdx, logicalLane, time) * bootWave * 0.55
      for (const pulse of this.pulses) {
        // 距离按世界尺度折算（列距 5.2，行距 0.62）
        const d = Math.hypot(dLanes, (cell.rowIdx - pulse.row) * (ROW_SPACING / LANE_SPACING))
        field += selectionWave(d, pulse.age) * cStrength
      }

      const slope =
        (settlingWave(dLanes * LANE_SPACING + LANE_SPACING / 2, 26.56) -
          settlingWave(dLanes * LANE_SPACING - LANE_SPACING / 2, 26.56)) *
        0.02 *
        (1 - detail)

      const hide = i === selectedSlot ? 0.0001 : 1
      this.pos.set(x, y + Math.max(-0.3, field), z + field * 0.22)
      this.euler.set(slope, 0, 0)
      this.quat.setFromEuler(this.euler)
      this.one.setScalar(hide)
      this.m4.compose(this.pos, this.quat, this.one)
      this.glassMesh.setMatrixAt(i, this.m4)
      this.coverMesh.setMatrixAt(i, this.m4)
    })

    this.glassMesh.instanceMatrix.needsUpdate = true
    this.coverMesh.instanceMatrix.needsUpdate = true

    this.updateHover()
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
    const laneDelta = nearestOccurrence(cell.laneIdx, Math.round(this.shoulder.value), POOL_LANES) - cell.laneIdx
    const dLanes = cell.laneIdx + laneDelta - this.shoulder.value
    return new THREE.Vector3(
      dLanes * LANE_SPACING,
      CARD_Y,
      (cell.rowIdx - CENTER_ROW) * ROW_SPACING + ROW_Z_OFFSET
    )
  }

  private updateHover(): void {
    if (this.placement.value > 0.2 || this.presentation.state !== 'archive') {
      this.hoveredInstance = null
      this.renderer.domElement.style.cursor = this.rotateDrag ? 'grabbing' : 'grab'
      return
    }
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObject(this.coverMesh, false)
    const id = hits.length > 0 ? (hits[0]!.instanceId ?? null) : null
    this.hoveredInstance = id
    this.renderer.domElement.style.cursor = id !== null ? 'pointer' : 'grab'
  }

  /** 选中实体卡：隐藏该格位实例，用独立 Group 承接 hero 玻璃 + 专属高清纹理 */
  private updateSelectedGroup(): void {
    if (this.selectedItem === null || !this.selectedCell) {
      if (this.selectedGroup) {
        this.scene.remove(this.selectedGroup)
        this.selectedGroup = null
        this.selectedCover = null
      }
      if (this.heroTexture) {
        this.heroTexture.dispose()
        this.heroTexture = null
        this.heroItem = null
      }
      return
    }

    if (!this.selectedGroup) {
      const group = new THREE.Group()
      const box = new THREE.BoxGeometry(CASE.width, CASE.height, CASE.depth)
      group.add(new THREE.Mesh(box, this.cases.hero))
      const coverGeo = new THREE.PlaneGeometry(COVER.width, COVER.height)
      coverGeo.translate(0, 0, COVER.z)
      this.selectedCover = new THREE.Mesh(
        coverGeo,
        new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, toneMapped: false })
      )
      group.add(this.selectedCover)
      this.scene.add(group)
      this.selectedGroup = group
    }

    if (this.heroItem !== this.selectedItem) {
      this.heroItem = this.selectedItem
      const url = this.itemUrls[this.selectedItem] ?? ''
      new THREE.TextureLoader().load(url, (t) => {
        if (this.disposed || this.heroItem !== this.selectedItem) {
          t.dispose()
          return
        }
        t.colorSpace = THREE.SRGBColorSpace
        this.heroTexture?.dispose()
        this.heroTexture = t
        const material = this.selectedCover?.material as THREE.MeshLambertMaterial | undefined
        if (material) {
          material.map = t
          material.needsUpdate = true
        }
      })
    }

    this.selectedGroup.position.copy(this.cellWorldPosition(this.selectedCell))
    this.selectedGroup.position.z += this.lift.value
    this.selectedGroup.rotation.y = this.rotate.value
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
    if (this.watchdog !== null) window.clearInterval(this.watchdog)
    for (const [target, type, fn] of this.listeners) target.removeEventListener(type, fn)
    this.listeners = []
    const box = this.renderer.domElement.parentElement
    this.atlas.dispose()
    this.coverMaterial.dispose()
    this.heroTexture?.dispose()
    this.cases.dispose()
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        const material = obj.material
        if (material instanceof THREE.Material) material.dispose()
      }
    })
    this.composer?.dispose()
    this.renderer.dispose()
    box?.removeChild(this.renderer.domElement)
  }
}
