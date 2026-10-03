/**
 * 放映室场景 —— 浮空投影仪器 + 顺时针循环队列（与 wall/ArchiveWallScene 同套生命周期骨架）。
 *
 * 深空雾景中一台 Eumig 高精放映机（PBR 扫描件）浮空居左，镜头对准居中放大的
 * photo-case 玻璃卡（复用落地页卡装配 + 全玻璃化配方）——受映面为自发光幕面
 * （引擎画布直出，所见即所录）。照片集为顺时针滑盘：队首（右端）逐张出队、
 * 沿弧绕银幕右侧滑入片门；放映中的帧驻留片门，换片时化作光影沿光路散去
 * （永不回队尾）；谢幕时整条作品集波浪式散尽。主卡玻璃/聚光与 land 墙面
 * 完全同构（磨砂透射 + 每帧跟随聚光），光锥与尘埃止步于幕面之前。
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { configurePhotoGlass, createHeroPrintMaterial } from '../wall/materials'
import { loadCaseTemplate } from '../wall/card'
import { CardAppearance } from '../wall/glass'
import { SelectionLighting } from '../wall/lighting'
import { damp, smooth, spring, type Spring } from '../wall/motion'
import { ThemeTransition } from '../wall/theme-transition'
import { CINEMA_HEIGHT, CINEMA_WIDTH } from '../../core/cinema/timeline'
import { CINEMA_PROJECTOR_ASSET } from './asset'

export type CinemaTheme = 'night' | 'day'
export type CinemaQuality = 'performance' | 'high'

export interface CinemaSceneOptions {
  container: HTMLElement
  /** 放映引擎的主画布（1920×1080）——银幕幕面纹理源（原生 16:9） */
  screenCanvas: HTMLCanvasElement
  /** 胶片队列缩略图（时间轴顺序）；空数组则不建队列 */
  stripThumbs: Array<{ id: string; url: string }>
  theme: CinemaTheme
  quality: CinemaQuality
  reducedMotion: boolean
  onStripClick?: (index: number) => void
}

/* ── 布局常量（three 坐标）：受映卡为主角居中放大，放映机退左下，队列悬于上方深处 ── */
const CARD_POS = new THREE.Vector3(0.3, 1.62, -3.8)
const CARD_SCALE = 1.5
const PROJECTOR_POS = new THREE.Vector3(-3.8, -0.65, 1.4)
const PROJECTOR_SCALE = 1.15
/** Eumig 归一化后的镜头前脸本地位（art/prepare_projector_glb.py 计算基准） */
const LENS_LOCAL = new THREE.Vector3(-0.27, -0.15, -1.25)
/** 开机归位弧的控制点（舞台位 → 沉降 → 左下角Home） */
const RETURN_ARC_CTRL = new THREE.Vector3(-1.7, -1.25, 0.8)
const FOV = 42
const ENTER_SECONDS = 2.8
/** 队列出队飞行时长（幻灯片硬切换片瞬间的送片动效） */
const FLIGHT_SECONDS = 0.9
/** 队列 mini 卡基准缩放（photo-case 原生 4.45 宽 → ≈1.07） */
const FRAME_SCALE = 0.24
/** 片门驻留缩放（飞行末态，无缝衔接） */
const GATE_SCALE = 0.26
/** 光影消散时长 */
const DISSOLVE_SECONDS = 0.6

/**
 * 队列帧生命周期：queue（弧带槽位）→ flight（送入片门）→ gate（驻留被放映）
 * → dissolving（换片/谢幕时化作光影散去）→ gone。播放过的帧永不回队尾。
 */
type FramePhase = 'queue' | 'flight' | 'gate' | 'dissolving' | 'gone'

interface StripFrame {
  id: string
  group: THREE.Group
  photo: THREE.Mesh
  phase: FramePhase
  /** hover 抬升 */
  lift: Spring
  /** 剔除暗淡（-1）/常态（0） */
  targetLift: number
  /** 队列（重）显影的缩放（0→1） */
  spawn: Spring
  /** 出队飞行：从队首槽位滑入放映机片门 */
  flight: { from: THREE.Vector3; start: number } | null
  /** 光影消散：起点/起始缩放/起始时刻（含级联延迟） */
  dissolve: { from: THREE.Vector3; fromScale: number; start: number } | null
  /** 消散期间的克隆壳材质（共享壳不能逐帧 fade）：[mesh, 共享材质] */
  shellSwaps: Array<[THREE.Mesh, THREE.Material]>
}

interface ProjectorRig {
  root: THREE.Group
  reelSupply: THREE.Object3D | null
  reelTakeup: THREE.Object3D | null
  focusRing: THREE.Object3D | null
}

export class CinemaScene {
  usable = true
  private disposed = false
  private readonly opts: CinemaSceneOptions
  private readonly renderer!: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 120)
  private composer: EffectComposer | null = null
  private bokeh: BokehPass | null = null
  private readonly clock = new THREE.Clock()
  private frame = 0
  private lastFrameAt = 0
  private watchdog: number | null = null
  private resizeObserver: ResizeObserver | null = null
  private listeners: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = []

  private screenTexture: THREE.CanvasTexture | null = null
  /** 落地页同款：磨砂→清澈揭示 + 抬升调色板；光柱散射着色 */
  private readonly appearance = new CardAppearance()
  private projecting = false
  private beamMaterial: THREE.ShaderMaterial | null = null
  private dustMaterial: THREE.ShaderMaterial | null = null
  private hemi!: THREE.HemisphereLight
  private key!: THREE.DirectionalLight
  private selectionLighting: SelectionLighting | null = null

  private card: THREE.Group | null = null
  private cardPrint: THREE.Mesh | null = null
  private screenBounce: THREE.PointLight | null = null
  private gateLight: THREE.PointLight | null = null
  /** 放映光束主光：镜头 → 幕心，玻璃棱边的真实照明来源（放映时淡入） */
  private beamLight: THREE.SpotLight | null = null
  /** SelectionLighting 聚光的主题基准强度（放映时让位压暗） */
  private spotBase = 1
  /** 银幕回波染色：低频采样引擎画布均色（8×8 离屏），让房间被电影"染"色 */
  private frameSampleCanvas: HTMLCanvasElement | null = null
  private frameSampleAt = 0
  private readonly frameSampleColor = new THREE.Color('#fff0e0')
  private projector: ProjectorRig | null = null
  private strips: StripFrame[] = []
  /** 循环队列：当前放映帧不在其中（它在幕上） */
  private queueIds: string[] = []
  private activeId: string | null = null
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointerNdc = new THREE.Vector2(2, 2)
  private hovered = -1
  private activeStrip = -1
  private stripClick: ((index: number) => void) | null = null
  private pointerDownAt: { x: number; y: number; t: number } | null = null
  /** 主画面悬浮：滚轮推近的触发面（悬浮时 cursor = zoom-in） */
  private cardHovered = false
  /** 滚轮推近（0-1 归一化，悬浮时滚动调节，离开即回落） */
  private zoomTarget = 0
  private zoom = 0

  /** 相机轨道：入场 dolly + 轨道漂移 + 指针视差（临界阻尼） */
  private enterT = 0
  private readonly parallaxYaw = spring(0)
  private readonly parallaxElev = spring(0)
  private readonly camAim = new THREE.Vector3(0.3, 1.6, -1.8)
  private readonly baseYaw = -0.14
  private readonly lensWorld = new THREE.Vector3()

  /* ── 开机仪式：放映机居中 → 启动（盘起转/片门灯白炽颤亮）→ 丝滑归位 → 开灯投影 ── */
  private bootPhase: 'idle' | 'enter' | 'boot' | 'return' = 'idle'
  private bootT = 0
  /** 开机期间接管双盘转速（电机惯性起步）；null = 常规转速 */
  private bootSpin: number | null = null
  /** 0=常规取景，1=舞台特写取景（对准居中的放映机） */
  private bootCamMix = 0
  private bootResolve: (() => void) | null = null
  private readonly projectorHome = PROJECTOR_POS.clone()
  /** 舞台位：画面中央、受映卡之前（卡退为背景） */
  private readonly projectorStage = new THREE.Vector3(0.35, 0.42, -0.15)
  private readonly bootAim = new THREE.Vector3(0.35, 0.9, -0.15)
  private readonly bootAimEff = new THREE.Vector3()
  /** 悬浮滚轮推近时的取景中心（camAim → CARD_POS 的阻尼插值） */
  private readonly zoomAim = new THREE.Vector3()
  /** 片门灯珠（加色光晕）：白炽颤亮/放映常亮的可读光源 */
  private lampGlow: THREE.Sprite | null = null
  private musicLevel = 0
  private themeTransition: ThemeTransition | null = null

  private readonly tmpColor = new THREE.Color()
  private readonly tmpV = new THREE.Vector3()
  private readonly tmpV2 = new THREE.Vector3()

  constructor(opts: CinemaSceneOptions) {
    this.opts = opts
    this.stripClick = opts.onStripClick ?? null

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: opts.quality === 'performance',
        alpha: false,
        powerPreference: 'high-performance'
      })
    } catch (error) {
      console.warn('[picseal] WebGL 不可用，放映室降级为平面展示', error)
      this.usable = false
      this.disposed = true
      return
    }
    this.renderer = renderer
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    this.renderer.transmissionResolutionScale = opts.quality === 'performance' ? 0.5 : 1
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.position = 'absolute'
    this.renderer.domElement.style.inset = '0'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.renderer.domElement.style.touchAction = 'none'
    opts.container.appendChild(this.renderer.domElement)

    // 夜配色与 land 完全一致（#07111f 深海军蓝）：玻璃透射需要背景有底色，
    // 纯黑背景会让磨砂玻璃读成"黑烟色"——land 通透感的一半来自这层夜蓝
    this.scene.background = new THREE.Color('#07111f')
    this.scene.fog = new THREE.Fog('#07111f', 9, 28)

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()

    this.buildLights()
    if (opts.quality === 'high') this.buildComposer()

    this.camera.position.set(-2.2, 2.9, 14.8)
    this.camera.lookAt(this.camAim)

    this.setTheme(opts.theme, false)
    this.bind(opts.container)
    this.resize()
    void this.loadScene()
    this.start()
  }

  /* ── 灯光：落地页同款 SelectionLighting（弹簧聚光 + 光柱散射）+ 放映机专属补光 ── */

  private buildLights(): void {
    // hemi 天/地色与 land 一致（地色给卡底那层冷蓝反光，不再是近黑）
    this.hemi = new THREE.HemisphereLight('#e2eeff', '#56708c', 0.3)
    this.scene.add(this.hemi)
    this.key = new THREE.DirectionalLight('#e5f0ff', 0.42)
    this.key.position.set(-6, 9, 5)
    this.scene.add(this.key)
    // 落地页的光影主角：弹簧跟随聚光 + 邻近散射（hemi/key/env 的主题值由其 setTheme 接管）
    this.selectionLighting = new SelectionLighting(this.scene)
    this.appearance.selectionLighting = this.selectionLighting

    // 冷侧逆光：勾出机身右缘高光轮廓。紧贴放映机右前低位（range 12）——
    // 悬于高处的队列弧带在射程外，不再被冷光打出滑动亮边。
    const rim = new THREE.PointLight('#bcd4ff', 45, 12, 2)
    rim.position.set(-1.5, 0.6, 3.5)
    this.scene.add(rim)
    // 机身专属软主光：从左前上方打亮塔身与盘面（半角收窄到 0.68，半影不扫队列）
    const hero = new THREE.SpotLight('#f4ecff', 60 * 64, 0, 0.68, 0.7, 2)
    hero.position.set(-6.5, 5.5, 5.5)
    hero.target.position.copy(PROJECTOR_POS).add(new THREE.Vector3(0, 0.4, 0))
    hero.castShadow = false
    this.scene.add(hero, hero.target)
    // 机身前脸补光（静态点光：不随时间/相机移动，不会产生游走高光）
    const front = new THREE.PointLight('#fff2e4', 40, 11, 2)
    front.position.set(-1.4, 2.6, 0.8)
    this.scene.add(front)
    // 片门暖光：帧被光吞没的位置
    const gate = new THREE.PointLight('#ffd9a0', 0, 5, 2)
    this.scene.add(gate)
    this.gateLight = gate
    // 放映光束主光：镜头 → 幕心的真实光路照明。只照玻璃与机身（幕面是
    // 自发光 MeshBasic，画面零干扰）；角度匹配近场锥体，放映时淡入。钨丝暖
    const beam = new THREE.SpotLight('#ffe3b8', 0, 0, 0.32, 0.6, 2)
    beam.castShadow = false
    this.scene.add(beam, beam.target)
    this.beamLight = beam
    // 片门灯珠：径向渐变加色光晕，挂在镜头前——白炽颤亮/放映常亮一眼可读
    const glowCanvas = document.createElement('canvas')
    glowCanvas.width = glowCanvas.height = 64
    const gctx = glowCanvas.getContext('2d')!
    const grad = gctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(255,244,216,1)')
    grad.addColorStop(0.35, 'rgba(255,212,148,0.55)')
    grad.addColorStop(1, 'rgba(255,188,116,0)')
    gctx.fillStyle = grad
    gctx.fillRect(0, 0, 64, 64)
    const glowTex = new THREE.CanvasTexture(glowCanvas)
    glowTex.colorSpace = THREE.SRGBColorSpace
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        opacity: 0
      })
    )
    glow.scale.setScalar(0.85)
    this.scene.add(glow)
    this.lampGlow = glow
  }

  private buildComposer(): void {
    const composer = new EffectComposer(this.renderer)
    composer.addPass(new RenderPass(this.scene, this.camera))
    const bokeh = new BokehPass(this.scene, this.camera, { focus: 11, aperture: 0.00016, maxblur: 0.005 })
    composer.addPass(bokeh)
    composer.addPass(new SMAAPass())
    composer.addPass(new OutputPass())
    this.composer = composer
    this.bokeh = bokeh
  }

  /* ── 异步装配：影院银幕 + 放映机 + 光锥尘埃 + 循环队列 ── */

  private async loadScene(): Promise<void> {
    try {
      await Promise.all([this.buildCard(), this.loadProjector()])
      if (this.disposed) return
      this.buildBeam()
      void this.buildStrip(this.opts.stripThumbs)
      this.opts.stripThumbs = []
    } catch (error) {
      console.warn('[picseal] 放映室布景加载失败', error)
    }
  }

  /** 受映面 = 落地页 photo-case 玻璃卡（全玻璃化配方）；印刷位为自发光幕面 */
  private async buildCard(): Promise<void> {
    const template = await loadCaseTemplate()
    if (this.disposed) {
      template.dispose()
      return
    }
    const card = template.buildAssembly()
    this.card = card
    // 落地页选中卡同款：三表面注册高配调色板 → prepare 注入揭示/有界磨砂着色 → 常驻"已抬起 + 全清澈"。
    // land 的"通透"来自 transmission 透射而非低粗糙度：表面永远磨砂（roughness ≥0.3，
    // 永不成抛光塑料），因此高光柔和稳定 —— 这是 land 卡平静质感的全部来源。
    // 不带任何场景专属玻璃覆盖、不做一次性静态聚光：聚光每帧跟随相机（见 update），
    // 与 land 墙面完全同构。
    for (const part of template.parts) {
      const high = new THREE.MeshPhysicalMaterial()
      configurePhotoGlass(part.surface, high)
      this.appearance.register(part.surface, high)
    }
    this.appearance.prepare(card)
    this.appearance.apply(card, 1)
    this.appearance.setClarity(card, 1)

    card.scale.setScalar(CARD_SCALE)
    card.position.copy(CARD_POS)
    // 装配几何中心高 1.85 已烘焙 → 拉回使卡片视觉中心落在 CARD_POS
    card.position.y -= 1.7 * CARD_SCALE
    // 近正面微偏（land 检视卡构图）：大偏转会让巨幅玻璃呈斜置"黑板"观感
    card.rotation.x = -0.02
    card.rotation.y = 0.05
    this.scene.add(card)

    const texture = new THREE.CanvasTexture(this.opts.screenCanvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    this.screenTexture = texture

    // 印刷位 = 自发光幕面（真实放映：画面即光源，引擎画布原色直出、观影纯净）。
    // 引擎画面为原生 16:9 而装裱印刷窗为 4:3：印刷面按 16:9 内接高缩放，
    // 上下留白透出玻璃装裱（land 的 contain 语义——照片完整、四周透玻璃）
    this.cardPrint = card.children.find((c) => c.userData.print) as THREE.Mesh | undefined ?? null
    if (this.cardPrint) {
      ;(this.cardPrint.material as THREE.Material).dispose()
      this.cardPrint.material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
      this.cardPrint.geometry.computeBoundingBox()
      const box = this.cardPrint.geometry.boundingBox!
      const printW = box.max.x - box.min.x
      const printH = box.max.y - box.min.y
      if (printW > 0 && printH > 0) {
        const sy = (printW * (CINEMA_HEIGHT / CINEMA_WIDTH)) / printH
        this.cardPrint.scale.y = sy
        // 顶点已烘焙进装配空间：绕原点缩放会把画面带中心从 centerY 挪到 centerY·sy，补回
        this.cardPrint.position.y += ((box.min.y + box.max.y) / 2) * (1 - sy)
      }
    }

    // 银幕反弹光：放映时幕面"照亮房间"——回波是队列相框的真实光源
    // （被银幕照亮 = 玻璃通透），随影片染色
    const bounce = new THREE.PointLight('#fff0e0', 0, 22, 2)
    bounce.position.copy(CARD_POS).add(new THREE.Vector3(0, 0, 1.4))
    this.scene.add(bounce)
    this.screenBounce = bounce
  }

  private async loadProjector(): Promise<void> {
    // Eumig 高精 GLB（art/prepare_projector_glb.py 归一化）：保留层级与原始 PBR 材质，
    // 仅提升环境反射强度；旋转件按归一化时的命名钩子查找（盘轴沿 X，绕自身 X 自转）。
    const gltf = await new GLTFLoader().loadAsync(CINEMA_PROJECTOR_ASSET)
    if (this.disposed) return
    const root = gltf.scene
    const rig: ProjectorRig = { root, reelSupply: null, reelTakeup: null, focusRing: null }
    root.traverse((object) => {
      const name = object.name ?? ''
      if (!rig.reelSupply && name.includes('ReelSupply')) rig.reelSupply = object
      else if (!rig.reelTakeup && name.includes('ReelTakeup')) rig.reelTakeup = object
      else if (!rig.focusRing && name.includes('FocusRing')) rig.focusRing = object
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) {
          if (material && 'envMapIntensity' in material) {
            ;(material as THREE.MeshStandardMaterial).envMapIntensity = 1.1
          }
        }
      }
    })

    // 机身整体朝向银幕（3/4 前侧视角面向相机），镜头锥指向幕心
    root.position.copy(PROJECTOR_POS)
    root.scale.setScalar(PROJECTOR_SCALE)
    const lensGuess = LENS_LOCAL.clone().multiplyScalar(PROJECTOR_SCALE).add(PROJECTOR_POS)
    const aim = CARD_POS.clone().sub(lensGuess).normalize()
    root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), aim)
    this.lensWorld
      .copy(LENS_LOCAL)
      .multiplyScalar(PROJECTOR_SCALE)
      .applyQuaternion(root.quaternion)
      .add(PROJECTOR_POS)
    this.scene.add(root)
    this.projector = rig
  }

  /* ── 光锥 + 尘埃（镜头 → 幕心，幕前收束） ── */

  private buildBeam(): void {
    const start = this.lensWorld.clone()
    const end = CARD_POS.clone()
    const dir = end.clone().sub(start)
    const length = dir.length()
    dir.normalize()
    const mid = start.clone().add(end).multiplyScalar(0.5)
    // 光影消散的行进方向（镜头 → 幕心）：播完的帧化作光影沿光路散去
    this.beamDir.copy(dir)

    const uniforms = {
      uIntensity: { value: 0.5 },
      uWarm: { value: new THREE.Color('#ffe8c4') }
    }
    // 收界：投影几何决定了"朝银幕汇聚"的任何元素在后段都会落入卡片的屏幕
    // 投影区 —— 锥体止于全程 60%、后段自 35% 起加速消散，视觉上是"镜头旁
    // 的光轴 + 近场薄雾"，不再斜穿卡片边缘、不再把光洒上画面
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.06, length * 0.6, 64, 1, true),
      new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec2 vUvBeam;
          varying vec3 vNormalW;
          varying vec3 vViewDir;
          void main() {
            vUvBeam = uv;
            vNormalW = normalize(mat3(modelMatrix) * normal);
            vec4 world = modelMatrix * vec4(position, 1.0);
            vViewDir = normalize(cameraPosition - world.xyz);
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUvBeam;
          varying vec3 vNormalW;
          varying vec3 vViewDir;
          uniform float uIntensity;
          uniform vec3 uWarm;
          void main() {
            // 真实投影的薄雾：近镜头可见、后段过半即加速收束淡出（幕不泛光、不越卡面）
            float axial = pow(1.0 - vUvBeam.y, 1.35);
            float approach = smoothstep(1.0, 0.35, vUvBeam.y);
            float grazing = 1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir)));
            float alpha = axial * approach * (0.14 + 0.6 * grazing) * uIntensity;
            gl_FragColor = vec4(uWarm * alpha, alpha);
          }
        `
      })
    )
    beam.position.copy(mid)
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone())
    this.scene.add(beam)
    this.beamMaterial = beam.material as THREE.ShaderMaterial
    // 放映光束主光锥角：覆盖整卡玻璃框（半对角 ~4.2 + 余量），幕面本体是
    // 自发光不受光——宽锥只照亮玻璃与机身，画面零干扰
    if (this.beamLight) this.beamLight.angle = Math.atan(4.7 / length)

    const count = 300
    const positions = new Float32Array(count * 3)
    const seeds = new Float32Array(count)
    const perpA = new THREE.Vector3(0, 0, 1).cross(dir).normalize()
    const perpB = dir.clone().cross(perpA).normalize()
    for (let i = 0; i < count; i += 1) {
      // 分布止步于光路前段（t ≤ 0.40，投影上完全落在卡片屏幕区外）、扩散半径
      // ≤ 0.55：尘埃只在镜头附近的近场光柱里浮动（真实放映的尘埃也集中在
      // 片门附近），不会飘成"画面上的 bokeh 污点"
      const t = 0.04 + 0.36 * Math.sqrt(Math.random())
      const radius = THREE.MathUtils.lerp(0.06, 0.55, t) * Math.sqrt(Math.random())
      const angle = Math.random() * Math.PI * 2
      const p = start
        .clone()
        .addScaledVector(dir, length * t)
        .addScaledVector(perpA, Math.cos(angle) * radius)
        .addScaledVector(perpB, Math.sin(angle) * radius)
      positions[i * 3] = p.x
      positions[i * 3 + 1] = p.y
      positions[i * 3 + 2] = p.z
      seeds[i] = Math.random()
    }
    const dustGeo = new THREE.BufferGeometry()
    dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
    const dust = new THREE.Points(
      dustGeo,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0.45 },
          uWarm: { value: new THREE.Color('#ffe9c8') }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute float aSeed;
          uniform float uTime;
          varying float vTwinkle;
          void main() {
            vec3 p = position;
            p.y += sin(uTime * 0.22 + aSeed * 6.2831) * 0.12;
            p.x += sin(uTime * 0.16 + aSeed * 12.56) * 0.08;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = (1.4 + 2.6 * fract(aSeed * 7.31)) * (110.0 / max(1.0, -mv.z));
            vTwinkle = 0.45 + 0.55 * sin(uTime * (0.5 + aSeed * 1.7) + aSeed * 40.0);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uIntensity;
          uniform vec3 uWarm;
          varying float vTwinkle;
          void main() {
            float d = length(gl_PointCoord - vec2(0.5));
            float mask = smoothstep(0.5, 0.12, d);
            gl_FragColor = vec4(uWarm, mask * vTwinkle * uIntensity * 0.3);
          }
        `
      })
    )
    dust.frustumCulled = false
    this.scene.add(dust)
    this.dustMaterial = dust.material as THREE.ShaderMaterial
  }

  /* ── 循环队列（顺时针滑盘逻辑）：mini photo-case 玻璃帧悬于幕上方深处 ── */

  /** 光路方向（buildBeam 时定）：光影消散的行进轴 */
  private readonly beamDir = new THREE.Vector3(0, 0, -1)

  /** 队列共享的三表面玻璃材质（落地页墙阵列同款配方：configurePhotoGlass + 光柱散射着色） */
  private stripShellMaterials: Map<string, THREE.MeshPhysicalMaterial> = new Map()

  private shellMaterial(surface: string): THREE.MeshPhysicalMaterial {
    const hit = this.stripShellMaterials.get(surface)
    if (hit) return hit
    const material = new THREE.MeshPhysicalMaterial()
    configurePhotoGlass(surface, material)
    material.onBeforeCompile = (shader) => this.selectionLighting?.shade(shader, surface)
    material.customProgramCacheKey = () => `cinema-strip-shell-${surface}`
    this.stripShellMaterials.set(surface, material)
    return material
  }

  /** 队列弧带槽位（t ∈ [0,1]，t=0 左端 / t=1 右端）：悬于银幕上方深处，屏占小不遮幕 */
  private arcSlot(t: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(
      -5.3 + 10.3 * t,
      6.4 - 1.5 * smooth(t) + 0.5 * Math.sin(t * Math.PI),
      -8.4 - 1.4 * Math.sin(t * Math.PI)
    )
  }

  /**
   * 顺时针传送带的槽位映射：队首（下一张放映）锚定弧带右端，其余帧向左依次
   * 排开；槽位固定不重铺 —— 帧逐格向右推进、队尾随消耗缩短，播放过的帧
   * 不回队（在片门化作光影散去），整条带子朝一个方向流转。
   */
  private queueSlot(k: number, total: number, out: THREE.Vector3): THREE.Vector3 {
    const t = total > 1 ? 1 - k / (total - 1) : 1
    return this.arcSlot(t, out)
  }

  private frameById(id: string): StripFrame | undefined {
    return this.strips.find((f) => f.id === id)
  }

  private async buildStrip(thumbs: CinemaSceneOptions['stripThumbs']): Promise<void> {
    this.clearStrip()
    if (thumbs.length === 0) return
    const template = await loadCaseTemplate()
    if (this.disposed) return
    const loader = new THREE.TextureLoader()
    thumbs.forEach((thumb, index) => {
      const group = template.buildAssembly()
      for (const child of group.children) {
        const mesh = child as THREE.Mesh
        const surface = mesh.userData.surface as string | undefined
        if (surface) {
          ;(mesh.material as THREE.Material).dispose()
          mesh.material = this.shellMaterial(surface)
        } else if (mesh.userData.print) {
          ;(mesh.material as THREE.Material).dispose()
          mesh.material = createHeroPrintMaterial(
            new THREE.Texture(),
            (shader) => this.selectionLighting?.shadePrint(shader)
          )
        }
      }
      group.scale.setScalar(FRAME_SCALE)
      group.position.y -= 1.85 * FRAME_SCALE
      // 顺时针：index 0（首张放映）在弧带右端（队首），依次向左排开
      this.queueSlot(index, thumbs.length, this.tmpV)
      group.position.add(this.tmpV)
      group.lookAt(0.3, 1.9, 9.6)
      this.scene.add(group)

      const photo = group.children.find((c) => c.userData.print) as THREE.Mesh
      this.strips.push({
        id: thumb.id,
        group,
        photo,
        phase: 'queue',
        lift: spring(0),
        targetLift: 0,
        spawn: spring(1),
        flight: null,
        dissolve: null,
        shellSwaps: []
      })
      loader.load(
        thumb.url,
        (texture) => {
          if (this.disposed) {
            texture.dispose()
            return
          }
          texture.colorSpace = THREE.SRGBColorSpace
          const print = photo.material as THREE.MeshLambertMaterial
          print.map = texture
          print.needsUpdate = true
        },
        undefined,
        () => {
          /* 单帧加载失败保留底色 */
        }
      )
    })
    this.queueIds = this.strips.map((f) => f.id)
    this.activeId = null
  }

  private clearStrip(): void {
    for (const frame of this.strips) {
      // 先还原共享壳（消散克隆壳随帧销毁）
      this.restoreShells(frame)
      this.scene.remove(frame.group)
      frame.group.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return
        obj.geometry.dispose()
        const material = obj.material
        // 共享壳材质（stripShellMaterials）不随单帧销毁
        if (material instanceof THREE.Material && !this.stripShellMaterials.has(material.name)) {
          if (this.stripShellMaterials.get((obj.userData as { surface?: string }).surface ?? '') === material) return
          const map = (material as THREE.MeshLambertMaterial).map
          map?.dispose()
          material.dispose()
        }
      })
    }
    this.strips = []
    this.queueIds = []
    this.activeId = null
  }

  /* ── 对外驱动面 ── */

  setProjecting(value: boolean): void {
    this.projecting = value
    if (!value && this.bootPhase !== 'idle') this.finishBoot(true)
    if (this.screenTexture) this.screenTexture.needsUpdate = true
  }

  /**
   * 开机仪式（预览放映的开场动效）：放映机滑到画面中央 → 电机起步、双盘起转、
   * 片门灯白炽颤亮 → 沿弧线丝滑归位左下角 → 亮灯投影。归位段内部即点亮
   * （beam/反弹光随归位淡入），resolve 时放映机已就位、灯已亮，引擎即刻上片。
   * reduced-motion 直接跳过。
   */
  bootProjector(): Promise<void> {
    if (this.disposed || this.opts.reducedMotion || !this.projector) return Promise.resolve()
    if (this.bootPhase !== 'idle') return Promise.resolve()
    return new Promise((resolve) => {
      this.bootResolve = resolve
      this.bootPhase = 'enter'
      this.bootT = 0
    })
  }

  private finishBoot(snapHome: boolean): void {
    this.bootPhase = 'idle'
    this.bootSpin = null
    this.bootCamMix = 0
    this.bootT = 0
    if (snapHome && this.projector) this.projector.root.position.copy(this.projectorHome)
    const resolve = this.bootResolve
    this.bootResolve = null
    resolve?.()
  }

  /** 开机仪式状态机（update 每帧驱动；时长 ≈ 0.85 + 2.1 + 1.5 = 4.45s） */
  private updateBoot(dt: number): void {
    if (this.bootPhase === 'idle') return
    const root = this.projector!.root
    const BOOT_ENTER = 0.85
    const BOOT_RUN = 2.1
    const BOOT_BACK = 1.5
    this.bootT += dt
    if (this.bootPhase === 'enter') {
      // 居中登台：ease-in-out 滑到画面中央，相机随之拉近
      const p = smooth(Math.min(1, this.bootT / BOOT_ENTER))
      root.position.lerpVectors(this.projectorHome, this.projectorStage, p)
      this.bootCamMix = p
      if (this.bootT >= BOOT_ENTER) {
        this.bootPhase = 'boot'
        this.bootT = 0
      }
      return
    }
    if (this.bootPhase === 'boot') {
      const p = Math.min(1, this.bootT / BOOT_RUN)
      // 电机惯性起步：先窜半拍再稳到巡航转速（轻微过冲回落）
      const spinUp = Math.min(1, p * 1.35)
      this.bootSpin = 2.4 * smooth(spinUp) * (1 + 0.22 * Math.exp(-p * 5) * Math.sin(p * 42))
      root.position.copy(this.projectorStage)
      this.bootCamMix = 1 - 0.06 * smooth(p)
      // 片门灯白炽启动：颤两下再稳住（钨丝升温的意象），灯珠同步明暗
      if (this.gateLight) {
        const warm = smooth(Math.min(1, p / 0.75))
        const flicker = p < 0.82 ? 0.22 + 0.78 * Math.abs(Math.sin(p * 34 + Math.sin(p * 11) * 1.6)) : 1
        this.gateLight.position.copy(this.lensWorldOf(this.tmpV))
        this.gateLight.intensity = 3.2 * warm * flicker
      }
      if (this.lampGlow) {
        const lamp = this.lampGlow.material as THREE.SpriteMaterial
        this.lampGlow.position.copy(this.lensWorldOf(this.tmpV))
        lamp.opacity = Math.min(1, (this.gateLight?.intensity ?? 0) / 3.2)
        this.lampGlow.scale.setScalar(0.75 + 0.55 * lamp.opacity)
      }
      if (this.bootT >= BOOT_RUN) {
        this.bootPhase = 'return'
        this.bootT = 0
        this.setProjecting(true) // 归位段亮灯：beam/反弹光/聚光让位随归位淡入
      }
      return
    }
    // return：沿三点弧线丝滑归位（先沉后升），相机拉回常规取景
    const p = smooth(Math.min(1, this.bootT / BOOT_BACK))
    const q = 1 - p
    this.tmpV
      .copy(this.projectorStage)
      .multiplyScalar(q * q)
      .addScaledVector(RETURN_ARC_CTRL, 2 * q * p)
      .addScaledVector(this.projectorHome, p * p)
    root.position.copy(this.tmpV)
    this.bootCamMix = 1 - p
    if (this.bootT >= BOOT_BACK) this.finishBoot(false)
  }

  /** 镜头的当前世界位（开机时放映机会移动，片门灯要跟着走） */
  private lensWorldOf(out: THREE.Vector3): THREE.Vector3 {
    if (!this.projector) return out.copy(this.lensWorld)
    this.projector.root.updateMatrixWorld()
    return out.copy(LENS_LOCAL).multiplyScalar(PROJECTOR_SCALE).applyMatrix4(this.projector.root.matrixWorld)
  }

  /** 引擎画布在场景外被更新（如待机海报）后，通知幕面纹理重传 */
  markScreenDirty(): void {
    if (this.screenTexture) this.screenTexture.needsUpdate = true
  }

  /** 引擎画布低频采样：8×8 均色 → 回波染色（与白混 55%，柔和不过饱和） */
  private sampleFrameColor(): void {
    const src = this.opts.screenCanvas
    if (!this.frameSampleCanvas) {
      this.frameSampleCanvas = document.createElement('canvas')
      this.frameSampleCanvas.width = this.frameSampleCanvas.height = 8
    }
    const ctx = this.frameSampleCanvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    try {
      ctx.drawImage(src, 0, 0, 8, 8)
      const data = ctx.getImageData(0, 0, 8, 8).data
      let r = 0
      let g = 0
      let b = 0
      const n = data.length / 4
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]!
        g += data[i + 1]!
        b += data[i + 2]!
      }
      this.tmpColor.setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace)
      this.frameSampleColor.set('#ffffff').lerp(this.tmpColor, 0.45)
    } catch {
      /* 画布不可读时保持上一帧染色 */
    }
  }

  /**
   * 队列驱动（顺时针滑盘）：photoIndex → 队首出队、送入片门；上一帧在片门处
   * 化作光影消散（永不回队尾）；-1 且已有帧上过幕 = 谢幕，整条作品集波浪式散去。
   */
  setActiveStrip(index: number): void {
    this.activeStrip = index
    if (index < 0) {
      if (this.activeId) this.dissolveAll()
      return
    }
    const frame = this.strips[index]
    if (!frame || frame.id === this.activeId) return
    const prev = this.activeId ? this.frameById(this.activeId) : undefined
    if (prev && prev !== frame) this.beginDissolve(prev)
    this.queueIds = this.queueIds.filter((id) => id !== frame.id)
    this.activeId = frame.id
    if (this.opts.reducedMotion) {
      frame.phase = 'gone'
      frame.group.visible = false
      return
    }
    if (frame.phase !== 'queue') {
      // 异常态复位（如重建后立即放映）：从队首槽位重新出队
      this.restoreShells(frame)
      frame.group.visible = true
      this.queueSlot(0, this.strips.length, this.tmpV)
      frame.group.position.copy(this.tmpV)
    }
    frame.phase = 'flight'
    frame.flight = { from: frame.group.position.clone(), start: this.clock.elapsedTime }
  }

  /** 谢幕清场：片门驻留帧即刻散去，剩余队列自队首向队尾波浪式化作光影 */
  private dissolveAll(): void {
    const gate = this.activeId ? this.frameById(this.activeId) : undefined
    if (gate) this.beginDissolve(gate)
    this.queueIds.forEach((id, k) => {
      const frame = this.frameById(id)
      if (frame) this.beginDissolve(frame, 0.12 + k * 0.08)
    })
    this.queueIds = []
    this.activeId = null
  }

  /** 单帧开始消散（delay 用于谢幕级联）；共享壳换克隆壳以支持独立淡出 */
  private beginDissolve(frame: StripFrame, delay = 0): void {
    if (frame.phase === 'gone' || frame.phase === 'dissolving') return
    if (this.opts.reducedMotion) {
      frame.phase = 'gone'
      frame.dissolve = null
      frame.group.visible = false
      return
    }
    frame.flight = null
    frame.phase = 'dissolving'
    frame.dissolve = {
      from: frame.group.position.clone(),
      fromScale: frame.group.scale.x,
      start: this.clock.elapsedTime + delay
    }
    frame.group.visible = true
    for (const child of frame.group.children) {
      const mesh = child as THREE.Mesh
      const surface = mesh.userData.surface as string | undefined
      const shared = surface ? this.stripShellMaterials.get(surface) : undefined
      if (shared && mesh.material === shared) {
        const ghost = shared.clone()
        ghost.transparent = true
        ghost.emissive.set('#2a1d0c')
        mesh.material = ghost
        frame.shellSwaps.push([mesh, shared])
      } else if (mesh.userData.print) {
        ;(mesh.material as THREE.MeshLambertMaterial).transparent = true
      }
    }
  }

  /** 还原共享壳材质（销毁消散克隆壳） */
  private restoreShells(frame: StripFrame): void {
    for (const [mesh, shared] of frame.shellSwaps) {
      const ghost = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (ghost && !Array.isArray(ghost) && ghost !== shared) ghost.dispose()
      mesh.material = shared
    }
    frame.shellSwaps = []
  }

  /** 重建整条队列（再次放映 / 中止复位）：全体归位、显影入场 */
  resetQueue(): void {
    if (this.disposed) return
    this.queueIds = this.strips.map((f) => f.id)
    this.activeId = null
    this.strips.forEach((frame, k) => {
      this.restoreShells(frame)
      const print = frame.photo.material as THREE.MeshLambertMaterial
      print.transparent = false
      print.opacity = 1
      print.color.set('#ffffff')
      frame.phase = 'queue'
      frame.flight = null
      frame.dissolve = null
      frame.group.visible = true
      frame.spawn = spring(0)
      this.queueSlot(k, this.strips.length, this.tmpV)
      frame.group.position.copy(this.tmpV)
      frame.group.scale.setScalar(FRAME_SCALE * 0.4)
    })
  }

  setStripSelection(ids: Set<string>): void {
    for (const frame of this.strips) frame.targetLift = ids.has(frame.id) ? 0 : -1
  }

  setStripThumbs(thumbs: CinemaSceneOptions['stripThumbs']): void {
    if (this.disposed) return
    void this.buildStrip(thumbs)
  }

  setMusicLevel(level: number): void {
    this.musicLevel = level
  }

  setTheme(theme: CinemaTheme, animate: boolean): void {
    if (!this.usable) return
    const night = theme === 'night'
    const targets = new ThemeTransition()
    // 放映室是暗室：昼/夜两档背景统一用 land 夜间底色（#07111f 深海军蓝）——
    // 玻璃透射需要背景有底色，纯黑/深灰黑都会把磨砂玻璃读成"黑烟色"
    targets.color(this.scene.background as THREE.Color, '#07111f')
    targets.color((this.scene.fog as THREE.Fog).color, '#07111f')
    targets.color(this.key.color, night ? '#e5f0ff' : '#dfe9ff')
    targets.number(this.renderer, 'toneMappingExposure', night ? 1.18 : 1.22)
    // 落地页同款主题联动：玻璃调色板 + hemi/key/env/弹簧聚光全部由两套系统驱动
    this.appearance.setTheme(theme, targets)
    this.selectionLighting?.setTheme(theme, this.key, targets)
    this.spotBase = this.selectionLighting?.spot.intensity ?? 1
    this.themeTransition = animate && !this.opts.reducedMotion ? targets : null
    if (!this.themeTransition) targets.finish()
  }

  /* ── 交互 ── */

  private bind(container: HTMLElement): void {
    const el = this.renderer.domElement
    this.on(el, 'pointermove', (event) => {
      const e = event as PointerEvent
      const rect = el.getBoundingClientRect()
      this.pointerNdc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
    })
    this.on(el, 'pointerleave', () => {
      this.pointerNdc.set(2, 2)
      // 离开画布即退出悬浮，推近平滑回落
      this.cardHovered = false
      this.zoomTarget = 0
    })
    // 悬浮主画面 + 滚轮：受限推近（幅度钳制在 [0,1]，不遮放映机）
    this.on(
      el,
      'wheel',
      (event) => {
        if (!this.cardHovered) return
        event.preventDefault()
        const e = event as WheelEvent
        this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget - e.deltaY * 0.0011, 0, 1)
      },
      { passive: false }
    )
    this.on(el, 'pointerdown', (event) => {
      const e = event as PointerEvent
      this.pointerDownAt = { x: e.clientX, y: e.clientY, t: performance.now() }
    })
    this.on(el, 'pointerup', (event) => {
      const e = event as PointerEvent
      const down = this.pointerDownAt
      this.pointerDownAt = null
      if (!down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      if (moved < 6 && performance.now() - down.t < 600 && this.hovered >= 0) {
        this.stripClick?.(this.hovered)
      }
    })
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
  }

  private on(target: EventTarget, type: string, fn: EventListenerOrEventListenerObject, options?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, options)
    this.listeners.push([target, type, fn])
  }

  private updateHover(): void {
    const candidates = this.strips.filter((f) => f.phase === 'queue')
    let next = -1
    if (candidates.length > 0) {
      this.raycaster.setFromCamera(this.pointerNdc, this.camera)
      const hits = this.raycaster.intersectObjects(
        candidates.map((s) => s.group),
        true
      )
      const hitId = hits.length > 0 ? hits[0]!.object.parent : null
      next = hits.length > 0 ? this.strips.findIndex((s) => s.group === hitId) : -1
    }
    // 主画面悬浮（队列未命中时才检测）：滚轮推近的触发面
    let cardHit = false
    if (next === -1 && this.card && this.bootPhase === 'idle') {
      this.raycaster.setFromCamera(this.pointerNdc, this.camera)
      cardHit = this.raycaster.intersectObject(this.card, true).length > 0
    }
    if (next !== this.hovered || cardHit !== this.cardHovered) {
      this.hovered = next
      this.renderer.domElement.style.cursor = next >= 0 ? 'pointer' : cardHit ? 'zoom-in' : 'default'
    }
    this.cardHovered = cardHit
    if (!cardHit) this.zoomTarget = 0
  }

  /* ── 帧循环 ── */

  private update(dt: number, time: number): void {
    const reduced = this.opts.reducedMotion

    // 开机仪式状态机（居中 → 启动 → 归位；相机/转速/片门灯由其接管）
    this.updateBoot(dt)

    // 入场 dolly + 指针视差（临界阻尼）。无永续轨道漂移——land 的相机在静止时
    // 纹丝不动，磨砂玻璃上的反射因此稳定不游走；场景的生命力来自放映本身。
    this.enterT = reduced ? 1 : Math.min(1, this.enterT + dt / ENTER_SECONDS)
    const enter = smooth(this.enterT)
    damp(this.parallaxYaw, reduced ? 0 : this.pointerNdc.x * 0.08, 6, dt)
    damp(this.parallaxElev, reduced ? 0 : -this.pointerNdc.y * 0.045, 6, dt)
    // 悬浮主画面滚轮推近（临界阻尼跟随；幅度受限——推太近巨卡会遮住放映机）
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 5)
    const zoomE = smooth(this.zoom)
    const yaw = this.baseYaw + this.parallaxYaw.value
    let radius = THREE.MathUtils.lerp(15, 9.8, enter)
    let elev = THREE.MathUtils.lerp(2.9, 2.0, enter) + this.parallaxElev.value
    let aim: THREE.Vector3 = this.camAim
    if (zoomE > 0.001 && this.bootCamMix === 0) {
      radius = THREE.MathUtils.lerp(radius, 6.6, zoomE)
      elev = THREE.MathUtils.lerp(elev, 1.7, zoomE)
      this.zoomAim.copy(this.camAim).lerp(CARD_POS, 0.55 * zoomE)
      aim = this.zoomAim
    }
    if (this.bootCamMix > 0) {
      // 开机特写取景：对准居中的放映机并拉近，结束再丝滑交回常规取景
      const m = smooth(this.bootCamMix)
      this.bootAimEff.copy(this.camAim).lerp(this.bootAim, m)
      aim = this.bootAimEff
      radius = THREE.MathUtils.lerp(radius, 6.2, m)
      elev = THREE.MathUtils.lerp(elev, 1.5, m)
    }
    this.camera.position.set(Math.sin(yaw) * radius, elev, Math.cos(yaw) * radius)
    this.camera.lookAt(aim)
    // 主卡静止（位姿 buildCard 一次定死）：受映幕不动，反射与光影才平静

    // 雾锚定渲染距离（land 墙面同款，wall/scene.update 同构）：受映卡永远
    // 清澈不被雾洗灰，队列（在卡后方 ~5.5）只留轻度景深雾 —— 静态雾会把
    // 主卡洗掉 ~30% 亮度、队列洗掉 ~50%，整卡发灰就是"和 land 不一样"的来源
    const focusDistance = this.camera.position.distanceTo(CARD_POS)
    const fog = this.scene.fog as THREE.Fog
    fog.near = focusDistance + 3.2
    fog.far = focusDistance + 19

    if (this.projecting && this.screenTexture) this.screenTexture.needsUpdate = true

    // 放映模拟：双盘续转（放映提速）+ 对焦环慢旋 + 机身微振
    // 开机期间转速由 updateBoot 接管（电机惯性起步）；微振随启动而来
    const spin = this.bootSpin ?? (this.projecting ? 2.1 : 0.55)
    const booting = this.bootPhase === 'boot' || this.bootPhase === 'return'
    const vibe = (this.projecting || booting) && !reduced ? 0.004 * Math.sin(time * 46) : 0
    if (this.projector) {
      // Eumig 盘轴沿 X：绕自身 X 自转（供/收反向，收片盘稍慢显机械差速）
      if (this.projector.reelSupply) this.projector.reelSupply.rotation.x -= spin * dt
      if (this.projector.reelTakeup) this.projector.reelTakeup.rotation.x += spin * dt * 0.78
      // 开机时对焦环做一次校准快旋
      const focusSpin = (this.projecting ? 0.5 : 0.14) + (this.bootPhase === 'boot' ? 1.6 : 0)
      if (this.projector.focusRing) this.projector.focusRing.rotation.x += focusSpin * dt
      this.projector.root.rotation.z = vibe
      // 待机浮动只在不开机时叠加（开机各阶段的位姿由 updateBoot 驱动）
      if (this.bootPhase === 'idle') {
        this.projector.root.position.y =
          PROJECTOR_POS.y + (reduced ? 0 : 0.03 * Math.sin(time * 0.42 + 0.7))
      }
    }

    // 光锥 / 尘埃 / 聚光（待机克制——光锥经 Bokeh 模糊后极易糊成光斑）
    const flicker = 1 + this.musicLevel * 0.22 + Math.sin(time * 19.3) * 0.018
    if (this.beamMaterial) {
      const target = (this.projecting ? 0.25 : 0.05) * flicker
      this.beamMaterial.uniforms.uIntensity!.value += (target - this.beamMaterial.uniforms.uIntensity!.value) * Math.min(1, dt * 4)
    }
    if (this.dustMaterial) {
      this.dustMaterial.uniforms.uTime!.value = reduced ? 0 : time
      const target = (this.projecting ? 0.28 : 0.1) * flicker
      this.dustMaterial.uniforms.uIntensity!.value += (target - this.dustMaterial.uniforms.uIntensity!.value) * Math.min(1, dt * 4)
    }
    // 主卡聚光每帧跟随相机（与 land 墙面同构）：高光在视空间稳定，环绕/视差
    // 时整体平移而不游走。放映让位至 0.78：beamLight 承担事件照明后总玻璃
    // 亮度守恒（大幅让位会让播放态玻璃整卡发灰"黑板化"）
    if (this.card) this.selectionLighting?.update(this.card, this.camera, dt, true, reduced)
    if (this.selectionLighting) {
      const target = this.spotBase * (this.projecting ? 0.78 : 1)
      this.selectionLighting.spot.intensity +=
        (target - this.selectionLighting.spot.intensity) * Math.min(1, dt * 3)
    }
    if (this.screenBounce) {
      const target = this.projecting ? 58 : 0
      this.screenBounce.intensity += (target - this.screenBounce.intensity) * Math.min(1, dt * 3)
      // 银幕回波随影片染色：低频采样引擎画布均色（与白混 55% 防过饱和）——
      // 真实放映厅里房间会被银幕"染"成当前画面的颜色，队列相框随之泛微光
      if (this.projecting && time - this.frameSampleAt > 0.6) {
        this.frameSampleAt = time
        this.sampleFrameColor()
      }
      this.screenBounce.color.lerp(this.frameSampleColor, Math.min(1, dt * 2))
    }
    // 片门灯：开机 boot 段由 updateBoot 直接驱动（白炽颤亮），其余走常规淡入；
    // 灯珠（加色光晕）始终跟随镜头，放映时常亮
    if (this.gateLight && this.bootPhase !== 'boot') {
      const target = this.projecting ? 2.4 : 0
      this.gateLight.position.copy(this.lensWorld)
      this.gateLight.intensity += (target - this.gateLight.intensity) * Math.min(1, dt * 5)
    }
    if (this.lampGlow && this.bootPhase !== 'boot') {
      const lamp = this.lampGlow.material as THREE.SpriteMaterial
      this.lampGlow.position.copy(this.lensWorld)
      const target = this.projecting ? 0.5 : 0
      lamp.opacity += (target - lamp.opacity) * Math.min(1, dt * 4)
      this.lampGlow.scale.setScalar(0.75 + 0.25 * lamp.opacity)
    }
    // 放映光束主光：镜头 → 幕心的真实光路（玻璃棱边亮线的来源）；位置永远
    // 跟随镜头（开机归位途中即已点亮），强度随放映淡入。色温偏钨丝暖
    if (this.beamLight) {
      this.beamLight.position.copy(this.lensWorld)
      this.beamLight.target.position.copy(CARD_POS)
      const target = this.projecting ? 90 : 0
      this.beamLight.intensity += (target - this.beamLight.intensity) * Math.min(1, dt * 4)
    }

    this.updateHover()
    this.updateQueue(dt, time)

    if (this.themeTransition && this.themeTransition.update(performance.now() / 1000)) {
      this.themeTransition = null
    }

    // Bokeh 对焦幕面
    if (this.bokeh) {
      const uniforms = (this.bokeh as unknown as { uniforms?: Record<string, { value?: number }> }).uniforms ?? {}
      this.tmpV.copy(CARD_POS).applyMatrix4(this.camera.matrixWorldInverse)
      if (uniforms.focus) uniforms.focus.value = Math.max(1, -this.tmpV.z)
    }
  }

  /**
   * 队列动效（顺时针滑盘）：槽位固定、帧逐格向队首（右端）推进；出队帧沿弧线
   * 绕银幕右侧滑入片门；放映中的帧驻留片门（微缩嵌在镜头前，随机身微振）；
   * 换片/谢幕的帧化作光影沿光路散去。无每帧 bob 摆动——队列像 land 的货架
   * 一样平静，只在真正的事件里动。
   */
  private updateQueue(dt: number, time: number): void {
    const reduced = this.opts.reducedMotion
    const total = this.strips.length
    const lerp = 1 - Math.exp(-6 * dt)

    // 队列槽位推进（指数平滑 = 临界阻尼手感）
    this.queueIds.forEach((id, k) => {
      const frame = this.frameById(id)
      if (!frame) return
      this.queueSlot(k, total, this.tmpV)
      frame.group.position.lerp(this.tmpV, reduced ? 1 : lerp)
      damp(frame.spawn, 1, 5, dt)
      this.styleFrame(frame, time, reduced, dt)
    })

    // 出队飞行 / 片门驻留（同一时刻至多一帧）
    const active = this.activeId ? this.frameById(this.activeId) : undefined
    if (active) {
      if (active.phase === 'flight' && active.flight) {
        const p = Math.min(1, (time - active.flight.start) / FLIGHT_SECONDS)
        const e = smooth(p)
        // 控制点：槽位与片门之间偏右抬升的弧顶（顺时针 sweep，绕银幕右侧入场）
        this.tmpV.copy(active.flight.from).lerp(this.lensWorld, 0.45)
        this.tmpV.x += 1.9
        this.tmpV.y += 0.9
        const a = this.tmpV2.copy(active.flight.from).lerp(this.tmpV, e)
        active.group.position.copy(a.lerp(this.lensWorld, e))
        active.group.scale.setScalar(FRAME_SCALE * (1 - (1 - GATE_SCALE) * e))
        const mat = active.photo.material as THREE.MeshLambertMaterial
        mat.color.lerp(this.tmpColor.set('#ffe8c8'), Math.min(1, dt * 6 * e))
        if (p >= 1) {
          active.flight = null
          active.phase = 'gate'
        }
      } else if (active.phase === 'gate') {
        // 片门驻留：胶片正被放映——微缩卡紧贴镜头片门（偏移必须极小：
        // 透视下沿光轴走 0.5+ 就会"悬浮"到画面中央喧宾夺主），随机身微振
        this.lensWorldOf(this.tmpV)
        this.tmpV.addScaledVector(this.beamDir, 0.14)
        const jitter = reduced ? 0 : 0.004 * Math.sin(time * 46)
        active.group.position.set(this.tmpV.x, this.tmpV.y + jitter, this.tmpV.z)
        active.group.scale.setScalar(FRAME_SCALE * GATE_SCALE)
        const mat = active.photo.material as THREE.MeshLambertMaterial
        mat.color.lerp(this.tmpColor.set('#ffe8c8'), Math.min(1, dt * 4))
      }
    }

    // 光影消散：暖白化 → 沿光路轻扬 → 透明归零（级联帧到点前保持原位）
    for (const frame of this.strips) {
      if (frame.phase !== 'dissolving' || !frame.dissolve) continue
      if (time < frame.dissolve.start) continue
      const e = smooth(Math.min(1, (time - frame.dissolve.start) / DISSOLVE_SECONDS))
      frame.group.position
        .copy(frame.dissolve.from)
        .addScaledVector(this.beamDir, 0.9 * e)
      frame.group.position.y += 0.25 * e
      frame.group.scale.setScalar(frame.dissolve.fromScale * (1 + 0.18 * e))
      const mat = frame.photo.material as THREE.MeshLambertMaterial
      mat.color.lerp(this.tmpColor.set('#fff3dc'), Math.min(1, dt * 8))
      mat.opacity = 1 - e
      for (const [mesh] of frame.shellSwaps) {
        ;(mesh.material as THREE.MeshPhysicalMaterial).opacity = 1 - e
      }
      if (e >= 1) {
        frame.phase = 'gone'
        frame.dissolve = null
        frame.group.visible = false
        this.restoreShells(frame)
        mat.transparent = false
        mat.opacity = 1
        mat.color.set('#ffffff')
      }
    }
  }

  /** 队列帧样式：hover 抬升 / 剔除暗淡 / 显影缩放（无呼吸 bob） */
  private styleFrame(frame: StripFrame, time: number, reduced: boolean, dt: number): void {
    void time
    let liftTarget = 0
    let colorTarget = '#ffffff'
    if (frame.targetLift < 0) {
      liftTarget = -0.06
      colorTarget = '#3d4350'
    }
    const stripIndex = this.strips.indexOf(frame)
    if (stripIndex === this.hovered) liftTarget = 0.15
    damp(frame.lift, liftTarget, 9, dt)
    frame.group.position.y += frame.lift.value
    const mat = frame.photo.material as THREE.MeshLambertMaterial
    mat.color.lerp(this.tmpColor.set(colorTarget), Math.min(1, dt * 6))
    const spawnScale = 0.4 + 0.6 * frame.spawn.value
    frame.group.scale.setScalar(FRAME_SCALE * (1 + Math.max(0, frame.lift.value) * 0.3) * spawnScale)
  }

  private animate = (): void => {
    if (this.disposed) return
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(this.animate)
    const dt = Math.min(this.clock.getDelta(), 0.05)
    this.lastFrameAt = performance.now()
    this.update(dt, this.clock.elapsedTime)
    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }

  /* ── 尺寸与生命周期 ── */

  resize(): void {
    if (!this.usable) return
    const parent = this.renderer.domElement.parentElement
    if (!parent) return
    const w = parent.clientWidth
    const h = parent.clientHeight
    if (w < 1 || h < 1) return
    let ratio =
      Math.min(window.devicePixelRatio, 1.5) * Math.min(window.innerWidth / 1920, window.innerHeight / 1080)
    const megapixels = w * ratio * h * ratio
    const MP_BOUND = 8.3e6
    if (megapixels > MP_BOUND) ratio *= Math.sqrt(MP_BOUND / megapixels)
    this.renderer.setPixelRatio(ratio)
    this.renderer.setSize(w, h)
    this.composer?.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  start(): void {
    if (this.frame !== 0) return
    this.frame = requestAnimationFrame(this.animate)
    this.watchdog = window.setInterval(() => {
      if (this.disposed) return
      if (performance.now() - this.lastFrameAt < 250) return
      this.animate()
    }, 1000 / 30)
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
    this.screenTexture?.dispose()
    this.frameSampleCanvas = null
    if (this.lampGlow) {
      this.lampGlow.material.map?.dispose()
      this.lampGlow.material.dispose()
      this.scene.remove(this.lampGlow)
      this.lampGlow = null
    }
    if (this.card) this.appearance.dispose(this.card)
    this.clearStrip()
    for (const material of this.stripShellMaterials.values()) material.dispose()
    this.stripShellMaterials.clear()
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        obj.geometry.dispose()
        const material = obj.material
        if (material instanceof THREE.Material) material.dispose()
      }
    })
    this.composer?.dispose()
    this.renderer.dispose()
    const parent = this.renderer.domElement.parentElement
    if (parent) parent.removeChild(this.renderer.domElement)
  }
}

