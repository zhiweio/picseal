/**
 * 影像档案墙场景 —— 交互与动效完整移植 Rhine-Music-Demo 音乐路径（MIT，© LBEILC / RonaldDeng）：
 * 焦点导航（shoulder/laneFocus/columnCamera/rail 四轨弹簧驱动整面墙滑动跟焦）
 * + 波场位移（进场扫描波 / 静止肩 / 涟漪 / 无交互漂移）+ 玻璃揭示（decryption → clarity）
 * + 59° 斜侧长焦取景 + archiveFraming 响应式 + SSAO/Bokeh/SMAA。
 * 卡片几何来自 art/build_photo_case.py 生成的 GLB（三表面分层玻璃壳）。
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
  columnStrength,
  damp,
  idleWave,
  musicSelectionWave,
  rippleEnvelope,
  returnStep,
  settlingWave,
  smooth,
  spring,
  type Spring
} from './motion'
import {
  ARRAY_AIM,
  ARCHIVE_DISTANCE,
  ARCHIVE_ELEVATION,
  ARCHIVE_SPAN,
  ARCHIVE_YAW,
  DETAIL_DISTANCE,
  DETAIL_ELEVATION,
  DETAIL_SPAN,
  DETAIL_YAW,
  MUSIC_ALBUM_SWITCH_RATE,
  MusicCameraMotion,
  MusicPlacementMotion,
  MusicPresentation,
  RAIL_REST,
  musicArchiveTracksSettled
} from './camera'
import { BASE_Y, CARD, INSPECTION_LIFT, PREVIEW_LIFT, loadCaseTemplate, type CaseTemplate } from './card'
import { CardAppearance } from './glass'
import { SelectionLighting } from './lighting'
import { configurePhotoGlass, createHeroPrintMaterial, createPrintMaterial } from './materials'
import { CoverAtlas, ATLAS_PAGE_CAPACITY } from './atlas'
import { DecryptionController, type DecryptionFrame } from './decryption'
import { archiveFraming, musicArchiveOffset, swipeDirection, viewportLayout } from './viewport'
import { ThemeTransition } from './theme-transition'

export interface WallItem {
  id: string
  url: string
  model?: string
  params?: string
  date?: string
}

/** HUD 投影器：模型空间点 → 容器 CSS 像素 */
export type HudProjector = (x: number, y: number, z: number) => { x: number; y: number } | null

export interface WallSceneOptions {
  container: HTMLElement
  items: WallItem[]
  reducedMotion: boolean
  theme: 'night' | 'day'
  quality: 'high' | 'performance'
  /** 检视卡可见性（进入 placing / 离开 returning 时触发） */
  onSelect: (index: number | null) => void
  /** 浏览焦点变化（元数据预取用，不驱动 DOM 卡显隐） */
  onSelection?: (index: number) => void
  /** 解密扫描 HUD 每帧驱动（仅在活跃相位调用） */
  onDecryption?: (frame: DecryptionFrame, project: HudProjector) => void
}

const POOL_LANES = 9
const DEPTH_ROWS = 48
const LANE_SPACING = 5.2
const ROW_SPACING = 0.62
const LANE_CENTER = (POOL_LANES - 1) / 2
const ROW_CENTER = (DEPTH_ROWS - 1) / 2
const FLOOR_Y = -4.63
const WALL_CAPACITY = POOL_LANES * DEPTH_ROWS

interface Cell {
  lane: number
  row: number
  item: number
}

interface Pulse {
  lane: number
  row: number
  time: number
}

interface OutgoingCopy {
  group: THREE.Group
  cell: Cell
  lift: Spring
  returnY: number | null
  clarity: number
}

const cellKey = (cell: Cell) => cell.lane * 100 + cell.row
const sameCell = (a: Cell, b: Cell) => a.lane === b.lane && a.row === b.row
const ease = smooth

export class ArchiveWallScene {
  /** WebGL 不可用时为 false：场景为空壳，所有方法安全 no-op */
  readonly usable: boolean = true
  private renderer!: THREE.WebGLRenderer
  private composer: EffectComposer | null = null
  private bokeh: BokehPass | null = null
  private ao: SSAOPass | null = null
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(34, 16 / 9, 5, 300)
  private cameraAim = new THREE.Vector3()
  private musicCamera = new MusicCameraMotion()
  private musicPlacement = new MusicPlacementMotion()
  private musicPresentation = new MusicPresentation()
  private decryption = new DecryptionController()
  /** 扫描 HUD 是否仍在显示；转回 waiting 时补发一帧收场，供消费者清场 */
  private hudLive = false
  private clock = new THREE.Clock()
  private opts: WallSceneOptions
  private disposed = false
  private loaded = false

  private appearance = new CardAppearance()
  private selectionLighting!: SelectionLighting
  private caseTemplate: CaseTemplate | null = null
  /** 墙面实例：每个 GLB 表面一个 InstancedMesh（固定批次） */
  private shellInstances: THREE.InstancedMesh[] = []
  /** 印刷面实例按图集页拆分（每页独立材质/纹理 + coverTile 实例属性） */
  private coverPages: Array<{
    mesh: THREE.InstancedMesh
    material: THREE.MeshLambertMaterial
    cells: number[]
  }> = []
  private atlas!: CoverAtlas
  private itemUrls!: string[]
  private cells: Cell[] = []

  private model: THREE.Group | null = null
  private modelPrint: THREE.Mesh | null = null
  private heroTexture: THREE.Texture | null = null
  private heroItem: number | null = null
  private outgoing: OutgoingCopy[] = []

  private selectedCell: Cell = { lane: LANE_CENTER, row: Math.round(ROW_CENTER), item: 0 }
  private selectedItem = 0
  private musicNavigationLift = false
  private pendingPulse: Cell | null = null
  private pulses: Pulse[] = []

  // 四轨：shoulder=行焦点，laneFocus=列焦点，columnCamera=横向轨道，rail=纵深轨道
  private shoulder: Spring = spring(0)
  private laneFocus: Spring = spring(0)
  private columnCamera: Spring = spring(0)
  private rail: Spring = spring(0)
  private lift: Spring = spring(0)
  private rotation = 0
  private targetRotation = 0
  private returnY: number | null = null
  private targetDetail = 0
  private detail = 0

  private reveal = 0
  private targetReveal = 0
  private scanTime = 22
  private scanBlend = 1
  private idleGain = 0
  private pulseGain = 1
  private lastInteraction = -10
  private musicLevel = 0
  private themeTransition: ThemeTransition | null = null

  private pointer = new THREE.Vector2(0, 0)
  private cursor = new THREE.Vector2(0, 0)
  private raycaster = new THREE.Raycaster()
  private hoveredCell: Cell | null = null
  private layoutKind = 'desktop'
  private coarsePointer = false

  private frame = 0
  private lastFrameAt = 0
  private watchdog: number | null = null
  private resizeObserver: ResizeObserver | null = null
  private listeners: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = []
  private themeWarmth = { value: 1 }
  private hemi!: THREE.HemisphereLight
  private key!: THREE.DirectionalLight
  private floor!: THREE.Mesh
  private readonly dummy = new THREE.Object3D()
  private readonly tmpV = new THREE.Vector3()
  private cellField = new Float32Array(0)
  private cellSlope = new Float32Array(0)
  private wheelAccum = 0

  constructor(opts: WallSceneOptions) {
    this.opts = opts

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: opts.quality === 'performance',
        alpha: false,
        powerPreference: 'high-performance'
      })
    } catch (error) {
      console.warn('[picseal] WebGL 不可用，照片墙降级为静态展示', error)
      this.usable = false
      this.disposed = true
      return
    }
    this.renderer = renderer
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.transmissionResolutionScale = opts.quality === 'performance' ? 0.5 : 1
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.position = 'absolute'
    this.renderer.domElement.style.inset = '0'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.renderer.domElement.style.touchAction = 'none'
    opts.container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color('#eae5e1')
    this.scene.fog = new THREE.Fog('#eae5e1', 22, 47)

    // 相机初始即取档案位姿与目标焦距：弹簧从正确值起阻尼，
    // 避免 34°→3° 的长收敛在节流页面上把"铺面"效果拉成微型墙
    const initialDirection = new THREE.Vector3(
      -Math.sin(ARCHIVE_YAW) * Math.cos(ARCHIVE_ELEVATION),
      Math.sin(ARCHIVE_ELEVATION),
      Math.cos(ARCHIVE_YAW) * Math.cos(ARCHIVE_ELEVATION)
    )
    this.camera.position.copy(ARRAY_AIM).addScaledVector(initialDirection, ARCHIVE_DISTANCE)
    this.camera.fov = THREE.MathUtils.radToDeg(
      2 * Math.atan(ARCHIVE_SPAN / (2 * ARCHIVE_DISTANCE))
    )
    this.camera.lookAt(ARRAY_AIM)
    this.cameraAim.copy(ARRAY_AIM)

    // IBL：transmission 玻璃没有环境贴图就是死玻璃
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()

    this.itemUrls = opts.items.map((i) => i.url)
    this.atlas = new CoverAtlas(this.renderer.capabilities.maxTextureSize, opts.items.length)
    this.selectionLighting = new SelectionLighting(this.scene)
    this.appearance.selectionLighting = this.selectionLighting

    // 有界静态网格：9 列 × 48 行（行主序，index = row * POOL_LANES + lane），物品循环填充
    for (let row = 0; row < DEPTH_ROWS; row += 1)
      for (let lane = 0; lane < POOL_LANES; lane += 1)
        this.cells.push({ lane, row, item: (row * POOL_LANES + lane) % opts.items.length })

    this.hemi = new THREE.HemisphereLight('#fffaf5', '#b4a18c', 0.65)
    this.scene.add(this.hemi)
    this.key = new THREE.DirectionalLight('#fff7ed', 1.4)
    this.key.position.set(-6, 14, -5)
    this.key.castShadow = true
    this.key.shadow.mapSize.set(2048, 2048)
    this.key.shadow.camera.left = -16
    this.key.shadow.camera.right = 16
    this.key.shadow.camera.top = 15
    this.key.shadow.camera.bottom = -15
    this.key.shadow.camera.near = 0.1
    this.key.shadow.camera.far = 60
    this.key.shadow.normalBias = 0.035
    this.key.shadow.radius = 4
    this.scene.add(this.key)
    const fill = new THREE.DirectionalLight('#ffffff', 0.6)
    fill.position.set(7, 8, -10)
    this.scene.add(fill)

    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshStandardMaterial({ color: '#d8c9b9', roughness: 0.95 })
    )
    this.floor.rotation.x = -Math.PI / 2
    this.floor.position.y = FLOOR_Y
    this.floor.receiveShadow = true
    this.scene.add(this.floor)

    if (opts.quality === 'high') this.buildComposer()

    this.coarsePointer = window.matchMedia('(pointer: coarse)').matches
    this.bind(opts.container)
    this.resize()
    void this.init()
  }

  /* ── 初始化 ── */

  private async init(): Promise<void> {
    try {
      this.caseTemplate = await loadCaseTemplate()
      if (this.disposed) return
      this.buildWall()
      this.loaded = true
      this.setTheme(this.opts.theme)
      // 初始焦点：中心格（轨道直接对齐，无开场摆动）
      const centerCell = this.cells[Math.round(ROW_CENTER) * POOL_LANES + Math.round(LANE_CENTER)]!
      this.selectedCell = { ...centerCell }
      this.selectedItem = centerCell.item
      this.shoulder = spring(this.selectedCell.row)
      this.laneFocus = spring(this.selectedCell.lane)
      this.columnCamera = spring(this.cellPosition(this.selectedCell).x)
      this.rail = spring(RAIL_REST - this.cellPosition(this.selectedCell).z)
      this.model!.position.copy(this.cellPosition(this.selectedCell))
      this.loadHeroTexture(centerCell.item)
      this.opts.onSelection?.(centerCell.item)
      this.pendingPulse = { ...centerCell }
      this.targetReveal = 1
      this.musicPresentation.request('archive')
      this.lastInteraction = this.clock.elapsedTime
      this.start()
    } catch (error) {
      console.error('[picseal] 照片墙初始化失败', error)
    }
  }

  private buildWall(): void {
    const count = this.cells.length
    this.cellField = new Float32Array(count)
    this.cellSlope = new Float32Array(count)
    for (const part of this.caseTemplate!.parts) {
      const material = new THREE.MeshPhysicalMaterial()
      configurePhotoGlass(part.surface, material)
      material.onBeforeCompile = (shader) => this.selectionLighting.shade(shader, part.surface)
      material.customProgramCacheKey = () => `photo-guided-glass-${part.surface}`
      const inst = new THREE.InstancedMesh(part.geometry, material, count)
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      inst.castShadow = part.surface === 'Optical_Diffuser'
      inst.receiveShadow = true
      inst.frustumCulled = false
      inst.visible = false
      this.shellInstances.push(inst)
      this.scene.add(inst)
      // 选中卡调色板（high 档）：prepare() 为实体卡克隆出带揭示着色器的独立材质
      const high = new THREE.MeshPhysicalMaterial()
      configurePhotoGlass(part.surface, high)
      this.appearance.register(part.surface, high)
    }

    // 印刷面：按图集页分组实例化
    const pageCells: number[][] = Array.from({ length: this.atlas.pageCount }, () => [])
    this.cells.forEach((cell, i) => {
      const page = Math.min(this.atlas.pageCount - 1, Math.floor(cell.item / ATLAS_PAGE_CAPACITY))
      pageCells[page]!.push(i)
    })
    const printGeoProto = new THREE.PlaneGeometry(3.72, 2.88)
    printGeoProto.translate(0.103, CARD.centerY, CARD.depth / 2 + 0.012)
    this.coverPages = pageCells.map((cells, page) => {
      const geo = printGeoProto.clone()
      const tiles = new Float32Array(cells.length * 4)
      geo.setAttribute('coverTile', new THREE.InstancedBufferAttribute(tiles, 4))
      const material = createPrintMaterial(
        this.atlas.textureOf(page)!,
        (shader) => this.selectionLighting.shadePrint(shader)
      )
      const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, cells.length))
      mesh.frustumCulled = false
      mesh.count = cells.length
      mesh.receiveShadow = true
      mesh.visible = false
      this.scene.add(mesh)
      return { mesh, material, cells }
    })
    printGeoProto.dispose()

    // 选中实体卡（常驻，换选时克隆快照为返回副本）
    this.model = this.caseTemplate!.buildAssembly()
    this.appearance.prepare(this.model)
    this.appearance.apply(this.model, 0)
    this.modelPrint = this.model.children.find((c) => c.userData.print) as THREE.Mesh
    ;(this.modelPrint.material as THREE.Material).dispose()
    this.modelPrint.material = createHeroPrintMaterial(
      placeholderTexture(),
      (shader) => this.selectionLighting.shadePrint(shader)
    )
    this.model.visible = false
    this.model.position.copy(this.cellPosition(this.selectedCell))
    this.scene.add(this.model)
  }

  private buildComposer(): void {
    const composer = new EffectComposer(this.renderer)
    composer.addPass(new RenderPass(this.scene, this.camera))
    const ao = new SSAOPass(this.scene, this.camera, 1, 1)
    ao.kernelRadius = 0.38
    ao.minDistance = 0.001
    ao.maxDistance = 0.09
    composer.addPass(ao)
    const bokeh = new BokehPass(this.scene, this.camera, { focus: 60, aperture: 0.0003, maxblur: 0.011 })
    composer.addPass(bokeh)
    composer.addPass(new SMAAPass())
    composer.addPass(new OutputPass())
    this.composer = composer
    this.bokeh = bokeh
    this.ao = ao
    // SSAO 假设不透明实体：薄透射壳只要柔和的接触提示，最暗钳到 0.78 而非纯黑
    const copy = ao.copyMaterial
    if (copy.fragmentShader.includes('gl_FragColor = opacity * texel;')) {
      copy.fragmentShader = copy.fragmentShader.replace(
        'gl_FragColor = opacity * texel;',
        'gl_FragColor = vec4(mix(vec3(1.0), texel.rgb, 0.22), texel.a);'
      )
      copy.needsUpdate = true
      ao.kernelRadius = 0.18
      ao.maxDistance = 0.035
    }
    this.key.shadow.intensity = 0.32
  }

  /* ── 图集填充 ── */

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

  private syncCoverTiles(): void {
    for (const { mesh, cells } of this.coverPages) {
      const attr = mesh.geometry.getAttribute('coverTile') as THREE.InstancedBufferAttribute
      const array = attr.array as Float32Array
      cells.forEach((cellIndex, local) => {
        const tile = this.atlas.tileOf(this.cells[cellIndex]!.item)
        if (!tile) return
        array[local * 4] = tile.offsetX
        array[local * 4 + 1] = tile.offsetY
        array[local * 4 + 2] = tile.scaleX
        array[local * 4 + 3] = tile.scaleY
      })
      attr.needsUpdate = true
    }
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

  /* ── 主题 ── */

  setTheme(theme: 'night' | 'day', animate = false): void {
    if (!this.usable) return
    const targets = new ThemeTransition()
    targets.number(this.themeWarmth, 'value', theme === 'day' ? 1 : 0)
    const background = theme === 'night' ? '#07111f' : '#eae5e1'
    targets.color(this.scene.background as THREE.Color, background)
    targets.color((this.scene.fog as THREE.Fog).color, background)
    targets.color(
      (this.floor.material as THREE.MeshStandardMaterial).color,
      theme === 'night' ? '#0b1828' : '#d8c9b9'
    )
    targets.number(this.renderer, 'toneMappingExposure', theme === 'night' ? 1.08 : 1.05)
    targets.number(this.scene, 'environmentIntensity', theme === 'night' ? 0.68 : 0.48)
    targets.color(this.key.color, theme === 'night' ? '#e5f0ff' : '#fff7ed')
    targets.number(this.key, 'intensity', theme === 'night' ? 1.7 : 1.4)
    targets.color(this.hemi.color, theme === 'night' ? '#e2eeff' : '#fffaf5')
    targets.color(this.hemi.groundColor, theme === 'night' ? '#56708c' : '#b4a18c')
    targets.number(this.hemi, 'intensity', theme === 'night' ? 0.9 : 0.65)
    this.appearance.setTheme(theme, targets)
    this.selectionLighting.setTheme(theme, this.key, targets)
    this.themeTransition = animate && !this.opts.reducedMotion && this.loaded ? targets : null
    if (!this.themeTransition) targets.finish()
  }

  /* ── 音频律动挂钩 ── */

  setMusicLevel(level: number): void {
    this.musicLevel = level
  }

  beatPulse(strength = 1): void {
    if (this.disposed || this.opts.reducedMotion) return
    this.pulses.push({ lane: this.selectedCell.lane, row: this.selectedCell.row, time: this.clock.elapsedTime })
    this.pulses = this.pulses.slice(-6)
    this.lift.velocity += 0.5 * strength
  }

  /* ── 选择与导航 ── */

  private cellPosition(cell: Cell): THREE.Vector3 {
    return this.tmpV.set(
      (cell.lane - LANE_CENTER) * LANE_SPACING,
      BASE_Y,
      (cell.row - ROW_CENTER) * ROW_SPACING
    ).clone()
  }

  private cellAt(lane: number, row: number): Cell | null {
    if (lane < 0 || lane >= POOL_LANES || row < 0 || row >= DEPTH_ROWS) return null
    return this.cells[row * POOL_LANES + lane] ?? null
  }

  setMode(mode: 'hidden' | 'archive' | 'detail'): void {
    this.musicPresentation.request(mode)
    if (mode === 'detail')
      this.decryption.enter(this.scanBlend > 0.9 && this.decryption.clarity > 0.999)
    else this.decryption.leave()
    if (mode === 'hidden') this.decryption.select()
    if (mode !== 'archive') this.pendingPulse = null
    if (mode === 'detail') this.opts.onSelect(this.selectedItem)
    else if (mode === 'archive') this.opts.onSelect(null)
    if (mode === 'detail' || mode === 'archive') this.lastInteraction = this.clock.elapsedTime
  }

  /** 检视态直接跳选（detail→detail 9 速快切：轨道移动，不重放 placement） */
  switchAlbum(itemIndex: number, cell: Cell): void {
    if (!this.loaded || !this.musicPresentation.placed) return
    this.musicNavigationLift = true
    this.select(itemIndex, cell)
    this.decryption.enter(this.decryption.clarity > 0.999)
    this.pendingPulse = null
    this.opts.onSelect(itemIndex)
  }

  /** DOM 层关闭检视（关闭按钮 / 面板事件） */
  exitDetail(): void {
    if (this.musicPresentation.holdsDetail) this.setMode('archive')
  }

  select(itemIndex: number, cell: Cell): void {
    if (!this.loaded) return
    if (!this.musicPresentation.placed) this.musicNavigationLift = false
    this.lastInteraction = this.clock.elapsedTime
    const changed = !sameCell(cell, this.selectedCell)
    if (changed) this.musicPresentation.selectionChanged()
    if (changed && this.model && this.lift.value > 0.0001) {
      // 抬起中的旧卡克隆为返回副本：带着当前 lift/旋转/清晰度回到槽位
      const group = this.model.clone(true)
      this.appearance.prepare(group)
      this.appearance.apply(group, ease(this.lift.value / 0.4))
      this.appearance.setClarity(group, this.decryption.clarity)
      const print = group.children.find((c) => c.userData.print) as THREE.Mesh | undefined
      if (print) this.snapshotPrint(print)
      this.scene.add(group)
      this.outgoing.push({
        group,
        cell: { ...this.selectedCell },
        lift: { ...this.lift },
        returnY: group.rotation.y !== 0 ? group.position.y : null,
        clarity: this.decryption.clarity
      })
      this.lift.value = 0
      this.lift.velocity = 0
    }
    this.selectedCell = cell
    this.selectedItem = cell.item
    if (changed) {
      this.decryption.select()
      this.rotation = 0
      this.targetRotation = 0
      this.returnY = null
      this.opts.onSelection?.(cell.item)
    }
    // 选回一张正在返回途中的卡：接管其状态，不重播
    const returning = this.outgoing.findIndex((o) => sameCell(o.cell, cell))
    if (returning >= 0) {
      const o = this.outgoing[returning]!
      this.lift = { ...o.lift }
      this.rotation = o.group.rotation.y
      this.returnY = o.returnY
      this.decryption.select(o.clarity)
      this.scene.remove(o.group)
      this.appearance.dispose(o.group)
      this.outgoing.splice(returning, 1)
    }
    if (this.musicNavigationLift && this.musicPresentation.placed) {
      // 检视导航移动的是货架本身；浏览涟漪会在固定检视机位下重新引入竖向晃动
      this.pendingPulse = null
    } else {
      this.pendingPulse = { ...cell }
    }
    this.targetRotation = 0
    this.loadHeroTexture(cell.item)
  }

  /** 方向键 / 滑动 / 滚轮导航：邻格步进（边界钳制） */
  navigate(axis: 'lane' | 'row', direction: 1 | -1): void {
    if (!this.loaded || this.reveal < 0.8) return
    const lane = axis === 'lane' ? this.selectedCell.lane + direction : this.selectedCell.lane
    const row = axis === 'row' ? this.selectedCell.row + direction : this.selectedCell.row
    const next = this.cellAt(lane, row)
    if (!next || sameCell(next, this.selectedCell)) return
    this.lastInteraction = this.clock.elapsedTime
    if (this.musicPresentation.placed) this.switchAlbum(next.item, next)
    else this.select(next.item, next)
  }

  private loadHeroTexture(itemIndex: number): void {
    if (this.heroItem === itemIndex) return
    this.heroItem = itemIndex
    const url = this.itemUrls[itemIndex] ?? ''
    void new THREE.TextureLoader()
      .loadAsync(url)
      .then((t) => {
        if (this.disposed || this.heroItem !== itemIndex) {
          t.dispose()
          return
        }
        t.colorSpace = THREE.SRGBColorSpace
        t.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
        this.heroTexture?.dispose()
        this.heroTexture = t
        const material = this.modelPrint?.material as THREE.MeshLambertMaterial | undefined
        if (material) {
          material.map = t
          material.needsUpdate = true
        }
      })
      .catch(() => {
        /* 高清加载失败沿用图集 */
      })
  }

  /** 返回副本的印刷面快照：当前高清纹理定格为 canvas，交换所有权不闪断 */
  private snapshotPrint(print: THREE.Mesh): void {
    const source = print.material as THREE.MeshLambertMaterial
    const image = source.map?.image as ImageBitmap | HTMLImageElement | HTMLCanvasElement | undefined
    if (!image) {
      print.material = new THREE.MeshBasicMaterial({ color: '#efeae2', toneMapped: false })
      return
    }
    // 印刷窗 3.72 × 2.88
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = Math.round(512 / (3.72 / 2.88))
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#efeae2'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    try {
      ctx.drawImage(image as CanvasImageSource, 0, 0, canvas.width, canvas.height)
    } catch {
      /* 绘制失败则留底色 */
    }
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    print.material = new THREE.MeshBasicMaterial({ map, toneMapped: false })
  }

  private emitPulse(cell: Cell): void {
    this.pulses.push({ ...cell, time: this.clock.elapsedTime })
    this.pulses = this.pulses.slice(-6)
  }

  /* ── 交互 ── */

  private bind(container: HTMLElement): void {
    const canvas = this.renderer.domElement
    const on = <E extends Event>(
      target: EventTarget,
      type: string,
      fn: (e: E) => void,
      opts?: AddEventListenerOptions
    ) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.listeners.push([target, type, fn as EventListener])
    }

    let startX = 0
    let startY = 0
    let activePointer: number | null = null
    let previousX = 0
    let started = 0
    let cancelled = false
    let dragging = false
    const pointers = new Set<number>()

    on<PointerEvent>(canvas, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      pointers.add(e.pointerId)
      if (pointers.size > 1) {
        cancelled = true
        dragging = false
        return
      }
      activePointer = e.pointerId
      cancelled = false
      previousX = e.clientX
      started = performance.now()
      startX = e.clientX
      startY = e.clientY
      canvas.setPointerCapture(e.pointerId)
      if (this.musicPresentation.placed) dragging = true
    })

    on<PointerEvent>(canvas, 'pointermove', (e) => {
      if (activePointer !== null && e.pointerId !== activePointer) return
      if (cancelled) return
      const rect = canvas.getBoundingClientRect()
      if (e.pointerType === 'mouse')
        this.pointer.set(
          (e.clientX - rect.left) / rect.width - 0.5,
          (e.clientY - rect.top) / rect.height - 0.5
        )
      if (dragging) {
        if (!this.musicPresentation.placed) {
          dragging = false
          return
        }
        // 检视态：拖拽旋转选中卡（±0.8 rad，松手指数回正）
        this.targetRotation = THREE.MathUtils.clamp(
          this.targetRotation + (e.clientX - previousX) * 0.004,
          -0.8,
          0.8
        )
        previousX = e.clientX
        return
      }
      if (e.pointerType !== 'mouse') return
      if (this.reveal < 0.8 || this.detail > 0.2 || !this.loaded) {
        this.hoveredCell = null
        canvas.style.cursor = 'default'
        return
      }
      this.cursor.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
      this.hoveredCell = this.raycastCell()
      canvas.style.cursor = this.hoveredCell ? 'pointer' : 'default'
    })

    on<PointerEvent>(canvas, 'pointerup', (e) => {
      pointers.delete(e.pointerId)
      if (e.pointerId !== activePointer) return
      activePointer = null
      const wasDragging = dragging
      dragging = false
      if (cancelled) return
      if (e.pointerType !== 'mouse' && this.detail < 0.2 && this.reveal >= 0.8 && this.loaded) {
        const swipe = swipeDirection(e.clientX - startX, e.clientY - startY, performance.now() - started)
        if (swipe) {
          this.navigate(swipe.axis, swipe.direction)
          return
        }
      }
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 6 || this.reveal < 0.8 || !this.loaded)
        return
      if (wasDragging) return
      const rect = canvas.getBoundingClientRect()
      this.cursor.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
      const hit = this.raycastCell()
      if (!hit) {
        if (this.musicPresentation.placed) this.setMode('archive')
        return
      }
      if (this.musicPresentation.placed) {
        // 检视态点其他卡：9 速快切到那张；点当前卡无操作（拖拽旋转专属）
        if (!sameCell(hit, this.selectedCell)) this.switchAlbum(hit.item, hit)
        return
      }
      // 浏览态：点哪张抽哪张（demo 交互）——先跟焦选卡再进检视
      if (!sameCell(hit, this.selectedCell)) this.select(hit.item, hit)
      this.setMode('detail')
    })

    on<PointerEvent>(canvas, 'pointercancel', (e) => {
      pointers.delete(e.pointerId)
      if (e.pointerId === activePointer) {
        activePointer = null
        cancelled = true
        dragging = false
      }
    })
    on<PointerEvent>(canvas, 'lostpointercapture', (e) => {
      pointers.delete(e.pointerId)
      if (e.pointerId === activePointer) {
        activePointer = null
        dragging = false
      }
    })
    on<Event>(canvas, 'pointerleave', () => this.pointer.set(0, 0))

    on<WheelEvent>(
      canvas,
      'wheel',
      (e) => {
        e.preventDefault()
        if (!this.musicPresentation.placed && (this.detail > 0.2 || this.reveal < 0.8)) return
        if (this.musicPresentation.placed) {
          this.setMode('archive')
          return
        }
        this.wheelAccum += e.deltaY * 0.004
        if (Math.abs(this.wheelAccum) >= 1) {
          this.navigate('lane', this.wheelAccum > 0 ? 1 : -1)
          this.wheelAccum = 0
        }
        this.lastInteraction = this.clock.elapsedTime
      },
      { passive: false }
    )

    on<KeyboardEvent>(window, 'keydown', (e) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
        return
      if (e.key === 'Escape') {
        if (this.musicPresentation.holdsDetail) this.setMode('archive')
        return
      }
      if (e.key === 'Enter' && !this.musicPresentation.placed && this.loaded) {
        this.setMode('detail')
        return
      }
      const arrows: Record<string, ['lane' | 'row', 1 | -1]> = {
        ArrowLeft: ['lane', -1],
        ArrowRight: ['lane', 1],
        ArrowUp: ['row', -1],
        ArrowDown: ['row', 1]
      }
      const nav = arrows[e.key]
      if (nav) {
        e.preventDefault()
        this.navigate(nav[0], nav[1])
      }
    })

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
  }

  private raycastCell(): Cell | null {
    this.raycaster.setFromCamera(this.cursor, this.camera)
    const targets: THREE.Object3D[] = this.coverPages.map((p) => p.mesh)
    if (this.model?.visible) targets.push(this.modelPrint!)
    const hit = this.raycaster.intersectObjects(targets, false)[0]
    if (!hit) return null
    if (hit.object === this.modelPrint) return this.selectedCell
    const page = this.coverPages.findIndex((p) => p.mesh === hit.object)
    const local = hit.instanceId ?? null
    if (page < 0 || local === null) return null
    return this.cells[this.coverPages[page]!.cells[local]!] ?? null
  }

  /* ── 每帧 ── */

  private animate = (): void => {
    if (this.disposed) return
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(this.animate)
    this.lastFrameAt = performance.now()
    const dt = Math.min(this.clock.getDelta(), 0.05)
    const time = this.clock.elapsedTime
    this.update(dt, time)
    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }

  private update(dt: number, time: number): void {
    if (!this.loaded) return
    const reduced = this.opts.reducedMotion
    const items = this.opts.items
    if (this.themeTransition && this.themeTransition.update(time)) this.themeTransition = null

    const previewLift = PREVIEW_LIFT
    const blend = 1 - Math.exp(-dt * (reduced ? 35 : 2.8))
    this.reveal = THREE.MathUtils.lerp(this.reveal, this.targetReveal, blend)
    const inspecting = this.targetDetail !== 0 && this.musicPresentation.placed
    const aligningSelection = this.musicNavigationLift && this.returnY !== null
    this.rotation = reduced
      ? inspecting
        ? this.targetRotation
        : 0
      : inspecting && !aligningSelection
        ? THREE.MathUtils.lerp(this.rotation, this.targetRotation, blend)
        : returnStep(this.rotation, dt, reduced)
    this.musicPresentation.returnWhenAligned(this.rotation === 0)
    this.targetDetail = Number(this.musicPresentation.holdsDetail)
    const presentationProgress = THREE.MathUtils.clamp(
      this.musicPlacement.update(this.targetDetail, dt, reduced),
      0,
      1
    )
    this.scanTime += dt
    this.scanBlend *= Math.exp(-dt * 3)

    const chosen = this.cellPosition(this.selectedCell)
    const selectedRow = this.selectedCell.row
    const selectedLane = this.selectedCell.lane
    const navigationLift = this.musicNavigationLift
    const detailNavigation = navigationLift && this.musicPresentation.placed
    damp(this.shoulder, selectedRow, reduced ? 35 : detailNavigation ? MUSIC_ALBUM_SWITCH_RATE : 5, dt)
    damp(this.laneFocus, selectedLane, reduced ? 35 : detailNavigation ? MUSIC_ALBUM_SWITCH_RATE : 4, dt)
    damp(this.columnCamera, chosen.x, reduced ? 35 : detailNavigation ? MUSIC_ALBUM_SWITCH_RATE : 3.7, dt)
    damp(this.rail, RAIL_REST - chosen.z, reduced ? 35 : detailNavigation ? MUSIC_ALBUM_SWITCH_RATE : 3.7, dt)
    const trackX = this.columnCamera.value

    this.pulses = this.pulses.filter((p) => time - p.time < 3.2)
    const aligningCopy = this.outgoing.some((o) => o.returnY !== null)
    const idle =
      !reduced &&
      this.targetReveal > 0 &&
      !this.targetDetail &&
      this.detail < 0.01 &&
      this.returnY === null &&
      !aligningCopy &&
      time - this.lastInteraction > 2.5
    this.idleGain = THREE.MathUtils.lerp(
      this.idleGain,
      idle ? 1 + Math.min(0.6, this.musicLevel * 1.4) : 0,
      1 - Math.exp(-dt * (idle ? 0.8 : 4))
    )
    this.pulseGain = THREE.MathUtils.lerp(
      this.pulseGain,
      this.targetDetail || this.returnY !== null || aligningCopy ? 0 : 1,
      1 - Math.exp(-dt * 8)
    )

    const field = (row: number, lane: number): number => {
      let height =
        archiveWave(row, lane, this.scanTime) * this.scanBlend +
        idleWave(row, lane, time) * this.idleGain
      if (!reduced) {
        let ripple = 0
        for (const p of this.pulses) {
          const distance = Math.hypot(row - p.row, (lane - p.lane) * 2.2)
          const age = time - p.time
          ripple += musicSelectionWave(distance, age) * rippleEnvelope(distance, age)
        }
        height += THREE.MathUtils.clamp(ripple, -0.24, 0.24) * this.pulseGain
      }
      const distance = row - this.shoulder.value
      return height + settlingWave(distance, 26.56) * columnStrength(lane, this.laneFocus.value)
    }

    const selectedBase = chosen.y + field(selectedRow, selectedLane)
    if (this.returnY !== null && this.rotation !== 0) {
      // 旋转过的卡保持高度先转正，对齐完成后才开始下落
      this.lift.value = this.returnY - selectedBase
      this.lift.velocity = 0
    } else {
      this.returnY = null
      if (navigationLift) {
        // 换卡持有独立 spring：新卡自槽位升起而前任返回，Esc 打断也保持实际高度
        const aligningNeighbor = this.outgoing.some(
          (o) => o.returnY !== null && o.cell.lane === selectedLane && Math.abs(o.cell.row - selectedRow) < 5
        )
        const liftTarget = this.musicPresentation.placed
          ? !reduced && aligningNeighbor
            ? 0
            : INSPECTION_LIFT
          : previewLift * this.targetReveal
        if (reduced) this.lift = spring(liftTarget)
        else damp(this.lift, liftTarget, detailNavigation ? MUSIC_ALBUM_SWITCH_RATE : 4.2, dt)
      } else if (presentationProgress > 0 || !this.musicPlacement.settled || this.targetDetail) {
        // 同一进度同时驱动下方 yaw/elevation/zoom/pan；浏览保留独立 lift spring 承接涟漪
        const restingLift = previewLift * this.targetReveal
        this.lift.value = THREE.MathUtils.lerp(restingLift, INSPECTION_LIFT, presentationProgress)
        this.lift.velocity =
          this.musicPlacement.velocity * (INSPECTION_LIFT - restingLift) * (1 - presentationProgress)
      } else {
        damp(
          this.lift,
          this.musicPresentation.placed
            ? INSPECTION_LIFT
            : this.outgoing.some(
                  (o) => o.returnY !== null && o.cell.lane === selectedLane && Math.abs(o.cell.row - selectedRow) < 5
                )
              ? 0
              : previewLift * this.targetReveal,
          reduced ? 35 : 4.2,
          dt
        )
      }
    }
    this.detail = presentationProgress

    this.decryption.update(dt, this.detail > 0.78 && this.lift.value > 3.3, reduced)
    const model = this.model!
    this.appearance.apply(model, ease(this.lift.value / 0.4))
    this.appearance.setClarity(model, this.decryption.clarity)

    const entryZ = -28 * (1 - this.reveal)

    // 返回副本：先转正回槽，再下落归位，最后移除
    for (let i = this.outgoing.length - 1; i >= 0; i--) {
      const o = this.outgoing[i]!
      const p = this.cellPosition(o.cell)
      const baseY = p.y + field(o.cell.row, o.cell.lane)
      o.group.rotation.y = detailNavigation && reduced ? 0 : returnStep(o.group.rotation.y, dt, reduced)
      if (detailNavigation && reduced) {
        o.returnY = null
        o.lift = spring(0)
      } else if (o.returnY !== null) {
        o.lift.value = o.returnY - baseY
        o.lift.velocity = 0
        if (o.group.rotation.y === 0) o.returnY = null
      } else damp(o.lift, 0, reduced ? 35 : detailNavigation ? MUSIC_ALBUM_SWITCH_RATE : 4.5, dt)
      o.group.position.set(p.x - trackX, baseY + o.lift.value, p.z + entryZ + this.rail.value)
      const quality = ease(o.lift.value / 0.4)
      this.appearance.apply(o.group, quality)
      o.clarity = reduced ? 0 : o.clarity * Math.exp(-dt * 9)
      this.appearance.setClarity(o.group, o.clarity)
      const { row, lane } = o.cell
      o.group.rotation.x =
        (field(row + 0.5, lane) - field(row - 0.5, lane)) * 0.024 * (1 - this.detail) * (1 - quality)
      if (o.lift.value < 0.0001 && Math.abs(o.group.rotation.y) < 0.0001) {
        this.scene.remove(o.group)
        this.appearance.dispose(o.group)
        this.outgoing.splice(i, 1)
      }
    }

    // 延迟脉冲：新卡升过大半且邻卡已低于它时才激起外扩波
    if (this.pendingPulse && !this.targetDetail && this.targetReveal) {
      const selectedY = selectedBase + this.lift.value
      const oldCardsLower = this.outgoing.every(
        (old) =>
          old.cell.lane !== selectedLane ||
          Math.abs(old.cell.row - selectedRow) > 4 ||
          old.group.position.y + 0.015 < selectedY
      )
      if (this.lift.value >= 0.35 && this.returnY === null && oldCardsLower) {
        if (!reduced) this.emitPulse(this.pendingPulse)
        this.pendingPulse = null
      }
    }

    // 阵列实例：整个货架在固定检视槽周围滑动（-trackX / rail）
    const hidden = new Set(this.outgoing.map((o) => cellKey(o.cell)))
    hidden.add(cellKey(this.selectedCell))
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i]!
      const p = this.cellPosition(cell)
      const value = field(cell.row, cell.lane)
      const slope = field(cell.row + 0.5, cell.lane) - field(cell.row - 0.5, cell.lane)
      this.cellField[i] = value
      this.cellSlope[i] = slope
      this.dummy.position.set(p.x - trackX, p.y + value, p.z + entryZ + this.rail.value)
      this.dummy.rotation.set(slope * 0.024 * (1 - this.detail), 0, 0)
      this.dummy.scale.setScalar(hidden.has(cellKey(cell)) ? 0 : 1)
      this.dummy.updateMatrix()
      for (const inst of this.shellInstances) inst.setMatrixAt(i, this.dummy.matrix)
    }
    for (const inst of this.shellInstances) inst.instanceMatrix.needsUpdate = true
    for (const { mesh, cells } of this.coverPages) {
      cells.forEach((cellIndex, local) => {
        const cell = this.cells[cellIndex]!
        const p = this.cellPosition(cell)
        this.dummy.position.set(
          p.x - trackX,
          p.y + this.cellField[cellIndex]!,
          p.z + entryZ + this.rail.value
        )
        this.dummy.rotation.set(this.cellSlope[cellIndex]! * 0.024 * (1 - this.detail), 0, 0)
        this.dummy.scale.setScalar(hidden.has(cellKey(cell)) ? 0 : 1)
        this.dummy.updateMatrix()
        mesh.setMatrixAt(local, this.dummy.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
    }

    // 选中实体卡
    model.position.set(
      chosen.x - trackX,
      selectedBase + this.lift.value,
      chosen.z + entryZ + this.rail.value
    )
    model.rotation.set(
      (field(selectedRow + 0.5, selectedLane) - field(selectedRow - 0.5, selectedLane)) *
        0.024 *
        (1 - this.detail) *
        (1 - ease(this.lift.value / 0.4)),
      this.rotation,
      0
    )
    model.visible = items.length > 0
    for (const inst of this.shellInstances) inst.visible = items.length > 0
    for (const { mesh } of this.coverPages) mesh.visible = items.length > 0

    // ── 相机 ──
    const navigationOrbit = this.musicCamera.navigation(
      this.columnCamera.velocity / LANE_SPACING,
      this.rail.velocity / ROW_SPACING,
      this.detail,
      dt,
      reduced
    )
    const yaw = ARCHIVE_YAW + navigationOrbit.yaw
    const elevation = ARCHIVE_ELEVATION + navigationOrbit.elevation
    const inspectionYaw = THREE.MathUtils.lerp(yaw, DETAIL_YAW, this.detail)
    const inspectionElevation = THREE.MathUtils.lerp(elevation, DETAIL_ELEVATION, this.detail)
    const viewDirection = new THREE.Vector3(
      -Math.sin(inspectionYaw) * Math.cos(inspectionElevation),
      Math.sin(inspectionElevation),
      Math.cos(inspectionYaw) * Math.cos(inspectionElevation)
    )
    const span = THREE.MathUtils.lerp(ARCHIVE_SPAN, DETAIL_SPAN, this.detail)
    const distance = THREE.MathUtils.lerp(ARCHIVE_DISTANCE, DETAIL_DISTANCE, this.detail)
    const width = this.renderer.domElement.clientWidth || 1
    const height = this.renderer.domElement.clientHeight || 1
    const framing = archiveFraming(width, height, span, this.detail, this.layoutKind === 'compact')
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), viewDirection).normalize()
    const up = new THREE.Vector3().crossVectors(viewDirection, right).normalize()
    const cameraAim = ARRAY_AIM.clone()
    const previewShift = new THREE.Vector3()
    const offset = musicArchiveOffset(width, height)
    previewShift.addScaledVector(right, offset.x * framing.span * (width / Math.max(1, height)))
    previewShift.addScaledVector(up, offset.y * framing.span)
    const pixelScale = height / framing.span
    if (framing.portrait) {
      // 竖屏预览机位固定：跟随 model.position 会抵消 lift/波场/轨道的运动
      const previewAim = new THREE.Vector3(
        0,
        BASE_Y + settlingWave(0, 26.56) + 0.4 + CARD.centerY,
        RAIL_REST
      )
      previewAim.addScaledVector(up, (framing.previewY - 0.5) * (height / pixelScale))
      cameraAim.copy(previewAim)
    }
    cameraAim.add(previewShift)
    // 检视锚定固定检视槽（不追 model.position：那会先追邻槽再反向）
    const detailAim = new THREE.Vector3(
      0,
      BASE_Y + settlingWave(0, 26.56) + INSPECTION_LIFT + CARD.centerY,
      RAIL_REST
    )
    const detailX = framing.portrait ? 0.5 : 0.25
    detailAim.addScaledVector(right, (0.5 - detailX) * (width / pixelScale))
    detailAim.addScaledVector(up, (framing.detailY - 0.5) * (height / pixelScale))
    cameraAim.lerp(detailAim, this.detail)

    const cameraPosition = cameraAim.clone().addScaledVector(viewDirection, distance)
    if (!reduced && !this.musicPresentation.holdsDetail) {
      cameraPosition.x += this.pointer.x * 0.12
      cameraPosition.y -= this.pointer.y * 0.12
    }
    this.musicCamera.update(this.camera, this.cameraAim, cameraPosition, cameraAim, framing.span, dt, reduced)
    const detailTarget = this.musicPresentation.holdsDetail ? 1 : 0
    const liftTarget = this.musicPresentation.holdsDetail ? INSPECTION_LIFT : previewLift * this.targetReveal
    const tracksSettled = musicArchiveTracksSettled(
      { rail: this.rail, column: this.columnCamera, shoulder: this.shoulder, lane: this.laneFocus },
      { rail: RAIL_REST - chosen.z, column: chosen.x, shoulder: selectedRow, lane: selectedLane }
    )
    this.musicPresentation.update(
      dt,
      this.musicCamera.isSettled(this.camera, this.cameraAim, cameraPosition, cameraAim, framing.span),
      this.musicPlacement.settled &&
        tracksSettled &&
        Math.abs(this.detail - detailTarget) < 0.001 &&
        Math.abs(this.lift.value - liftTarget) < 0.008 &&
        Math.abs(this.rotation) < 0.001 &&
        Math.abs(this.lift.velocity) < 0.025,
      reduced
    )
    this.targetDetail = Number(this.musicPresentation.holdsDetail)
    if (this.musicPresentation.phase === 'archive') this.musicNavigationLift = false

    // 雾锚定渲染距离（相机位置阻尼滞后于目标距离变化）
    const renderedDistance = this.camera.position.distanceTo(this.cameraAim)
    const fog = this.scene.fog as THREE.Fog
    fog.near = renderedDistance + THREE.MathUtils.lerp(5, -1, this.detail)
    fog.far = renderedDistance + THREE.MathUtils.lerp(25, 12, this.detail)

    this.selectionLighting.update(model, this.camera, dt, this.reveal > 0 && items.length > 0, reduced)

    // Bokeh 每帧跟焦：焦点锚在卡面（几何中心 + 前表面），而非实例原点
    if (this.bokeh) {
      const focusPoint = model.position.clone()
      focusPoint.y += CARD.centerY
      focusPoint.z += CARD.depth / 2
      const local = focusPoint.applyMatrix4(this.camera.matrixWorldInverse)
      const uniforms = (this.bokeh as unknown as { uniforms?: Record<string, { value?: number }> })
        .uniforms ?? {}
      if (uniforms.focus) uniforms.focus.value = Math.max(1, -local.z)
      if (uniforms.aperture)
        uniforms.aperture.value = THREE.MathUtils.lerp(0.0003, 0.0008, this.detail)
    }

    // 阴影每帧单次更新（waves 持续改写实例矩阵）
    this.key.shadow.needsUpdate = true

    if (this.opts.onDecryption) {
      const frame = this.decryption.frame
      const live = frame.phase !== 'waiting'
      // 检视被提前关闭时解密直接转 waiting：补发这最后一帧，让 HUD 清掉残影
      if (live || this.hudLive) {
        this.hudLive = live
        const canvas = this.renderer.domElement
        const rect = { w: canvas.clientWidth, h: canvas.clientHeight }
        model.updateMatrixWorld(true)
        const project: HudProjector = (x, y, z) => {
          const v = new THREE.Vector3(x, y, z).applyMatrix4(model.matrixWorld).project(this.camera)
          if (v.z > 1) return null
          return { x: ((v.x + 1) / 2) * rect.w, y: ((1 - v.y) / 2) * rect.h }
        }
        this.opts.onDecryption(frame, project)
      }
    }
  }

  /* ── 尺寸与生命周期 ── */

  resize(): void {
    if (!this.usable) return
    const parent = this.renderer.domElement.parentElement
    if (!parent) return
    const w = parent.clientWidth
    const h = parent.clientHeight
    if (w < 1 || h < 1) return
    // 长焦管线一致性：小屏按 1920×1080 适配比例同步降低 pixelRatio
    let ratio =
      Math.min(window.devicePixelRatio, 1.5) *
      Math.min(window.innerWidth / 1920, window.innerHeight / 1080)
    const megapixels = w * ratio * h * ratio
    const MP_BOUND = 8.3e6
    if (megapixels > MP_BOUND) ratio *= Math.sqrt(MP_BOUND / megapixels)
    this.renderer.setPixelRatio(ratio)
    this.renderer.setSize(w, h)
    this.composer?.setSize(w, h)
    this.ao?.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    const layout = viewportLayout(w, h, this.coarsePointer)
    this.layoutKind = layout.kind
    // CSS 与取景共同消费同一三态（始终写入，保证选择器有确定值）
    this.opts.container.dataset.layout = layout.kind
  }

  dispose(): void {
    if (!this.usable) {
      this.disposed = true
      return
    }
    this.disposed = true
    cancelAnimationFrame(this.frame)
    if (this.watchdog !== null) window.clearInterval(this.watchdog)
    this.resizeObserver?.disconnect()
    for (const [target, type, fn] of this.listeners) target.removeEventListener(type, fn)
    this.listeners = []
    const parent = this.renderer.domElement.parentElement
    this.atlas.dispose()
    for (const { material } of this.coverPages) material.dispose()
    this.heroTexture?.dispose()
    for (const o of this.outgoing) this.appearance.dispose(o.group)
    this.caseTemplate?.dispose()
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        const material = obj.material
        if (material instanceof THREE.Material) material.dispose()
      }
    })
    this.composer?.dispose()
    this.renderer.dispose()
    if (parent) parent.removeChild(this.renderer.domElement)
  }

  /** 显式启动（init 资源就绪后调用一次） */
  start(): void {
    if (this.frame !== 0) return
    this.frame = requestAnimationFrame(this.animate)
    void this.fillAtlas()
    // rAF 饥饿兜底：标签页被遮挡/节流时以低帧率维持场景推进
    this.watchdog = window.setInterval(() => {
      if (this.disposed) return
      if (performance.now() - this.lastFrameAt < 250) return
      this.animate()
    }, 1000 / 30)
  }
}

/** 1×1 白色占位纹理（印刷面加载前的底） */
function placeholderTexture(): THREE.Texture {
  const data = new Uint8Array([255, 255, 255, 255])
  const texture = new THREE.DataTexture(data, 1, 1)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}
