/**
 * 影像档案墙 —— three.js 场景（移植 Rhine-Music-Demo 的档案架范式，
 * 面向落地页做了精简：无后处理栈，照片先以原图上墙，水印渲染完成后渐进替换纹理）。
 */
import * as THREE from 'three'

export interface WallItem {
  /** 水印前的原图 URL */
  url: string
  /** 水印渲染完成后的替换 URL（可选，渐进升级） */
  sealedUrl?: string
  model?: string
  params?: string
  date?: string
}

export interface ArchiveWallOptions {
  container: HTMLElement
  items: WallItem[]
  reducedMotion: boolean
  onSelect: (index: number | null) => void
}

const LANES = 5
const CARD_H = 2.6
const LANE_W = 3.6
const ROW_H = 3.4

const damp = (current: number, target: number, rate: number, dt: number): number =>
  THREE.MathUtils.damp(current, target, rate, dt)

export class ArchiveWall {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private cards: Array<{
    group: THREE.Group
    frame: THREE.Mesh
    photo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
    aspect: number
    item: WallItem
    index: number
    lift: number
    slot: number
  }> = []
  private selectedSlot: number | null = null
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2(-10, -10)
  private hovered: number | null = null
  private hoveredCard: (typeof this.cards)[number] | null = null
  private selected: number | null = null
  private scroll = 0
  private targetScroll = 0
  private cameraZ = 13
  private targetCameraZ = 13
  private clock = new THREE.Clock()
  private frame = 0
  private opts: ArchiveWallOptions
  private disposed = false
  private onPointerDown: (e: PointerEvent) => void
  private onPointerMove: (e: PointerEvent) => void
  private onWheel: (e: WheelEvent) => void
  private resizeObserver: ResizeObserver

  constructor(opts: ArchiveWallOptions) {
    this.opts = opts
    const { container } = opts

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#08121f')
    this.scene.fog = new THREE.Fog('#08121f', 16, 30)

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
    this.camera.position.set(0, 0, this.cameraZ)
    if (!opts.reducedMotion) {
      this.cameraZ = 22
      this.targetCameraZ = 13
      this.camera.position.z = this.cameraZ
    }

    const hemi = new THREE.HemisphereLight('#dfe8f2', '#2a2118', 2.4)
    this.scene.add(hemi)
    const key = new THREE.DirectionalLight('#ffe3b2', 1.6)
    key.position.set(-6, 8, 10)
    this.scene.add(key)

    this.buildCards()

    this.onPointerMove = (e: PointerEvent) => {
      const rect = this.renderer.domElement.getBoundingClientRect()
      this.pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
    }
    this.onPointerDown = () => {
      if (this.selected !== null) {
        this.select(null)
        return
      }
      if (this.hoveredCard) this.select(this.hoveredCard.index, this.hoveredCard.slot)
    }
    this.onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (this.selected !== null) this.select(null)
      this.targetScroll += e.deltaY * 0.0032
    }

    container.addEventListener('pointermove', this.onPointerMove)
    container.addEventListener('pointerdown', this.onPointerDown)
    container.addEventListener('wheel', this.onWheel, { passive: false })

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.animate()
  }

  private buildCards(): void {
    const frameMat = new THREE.MeshStandardMaterial({
      color: '#1c232e',
      roughness: 0.42,
      metalness: 0.35
    })
    const rowsNeeded = Math.ceil((this.opts.items.length * 1.6) / LANES)
    let slot = 0

    for (let row = 0; row < rowsNeeded; row += 1) {
      for (let lane = 0; lane < LANES; lane += 1) {
        const index = slot % this.opts.items.length
        const item = this.opts.items[index]!
        // 原图先以 3:2 占位上墙，onload 后按真实比例修正，水印纹理完成后渐进替换
        const aspect = 1.5
        const img = new Image()
        img.src = item.url
        img.decoding = 'async'
        void img
            .decode()
            .then(() => {
              const ratio = img.naturalWidth / img.naturalHeight
              if (!Number.isFinite(ratio) || ratio <= 0) return
              for (const card of this.cards) {
                if (card.index === index) {
                  card.aspect = ratio
                  this.applyCardGeometry(card)
                }
              }
            })
            .catch(() => undefined)

        const group = new THREE.Group()
        const frame = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.08), frameMat)
        const photo = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ color: '#22303f', toneMapped: false })
        )
        photo.position.z = 0.045
        group.add(frame, photo)
        this.scene.add(group)

        const card = { group, frame, photo, aspect, item, index, lift: 0, slot }
        this.cards.push(card)
        this.applyCardGeometry(card)
        slot += 1
      }
    }
  }

  private applyCardGeometry(card: (typeof this.cards)[number]): void {
    const h = CARD_H
    const w = CARD_H * card.aspect
    card.frame.scale.set(w + 0.18, h + 0.18, 1)
    card.photo.scale.set(w, h, 1)
  }

  /** 水印渲染完成后替换纹理（同一底片可能上墙多张，全部升级） */
  upgradeTexture(index: number, url: string): void {
    new THREE.TextureLoader().load(url, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      if (this.disposed) return
      const ratio = texture.image.width / texture.image.height
      for (const card of this.cards) {
        if (card.index !== index) continue
        const old = card.photo.material.map
        card.photo.material.map = texture
        card.photo.material.color.set('#ffffff')
        card.photo.material.needsUpdate = true
        old?.dispose()
        if (Number.isFinite(ratio) && ratio > 0) {
          card.aspect = ratio
          this.applyCardGeometry(card)
        }
      }
    })
  }

  setTheme(theme: 'night' | 'day'): void {
    const bg = theme === 'night' ? '#08121f' : '#e8e5e1'
    ;(this.scene.background as THREE.Color).set(bg)
    ;(this.scene.fog as THREE.Fog).color.set(bg)
  }

  select(index: number | null, slot?: number): void {
    this.selected = index
    this.selectedSlot = index === null ? null : (slot ?? this.selectedSlot)
    this.opts.onSelect(index)
    this.targetCameraZ = index === null ? 13 : 6.2
  }

  private resize(): void {
    const parent = this.renderer.domElement.parentElement
    if (!parent) return
    const w = parent.clientWidth
    const h = parent.clientHeight
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private cardPosition(card: (typeof this.cards)[number], time: number): THREE.Vector3 {
    const row = Math.floor(card.slot / LANES)
    const lane = card.slot % LANES
    const totalRows = Math.ceil(this.cards.length / LANES)
    const wallH = totalRows * ROW_H

    let y = -row * ROW_H + this.scroll
    y = ((((y + wallH / 2) % wallH) + wallH) % wallH) - wallH / 2

    const laneOffset = (lane - (LANES - 1) / 2) * LANE_W
    const jitter = Math.sin(time * 0.4 + card.slot * 1.7) * 0.02
    return new THREE.Vector3(laneOffset, y + jitter, 0)
  }

  private animate = (): void => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.animate)
    const dt = Math.min(this.clock.getDelta(), 0.05)
    const time = this.clock.elapsedTime

    this.scroll = damp(this.scroll, this.targetScroll, 6, dt)
    this.cameraZ = damp(this.cameraZ, this.targetCameraZ, 4.5, dt)

    // 相机跟随选中卡（按点击的实际卡位）
    let camX = 0
    let camY = this.scroll * 0.35
    if (this.selected !== null && this.selectedSlot !== null) {
      const pos = this.cards.find((c) => c.slot === this.selectedSlot)?.group.position
      if (pos) {
        camX = pos.x * 0.72
        camY = pos.y
      }
    }
    this.camera.position.x = damp(this.camera.position.x, camX, 5, dt)
    this.camera.position.y = damp(this.camera.position.y, camY, 5, dt)
    this.camera.position.z = this.cameraZ
    this.camera.lookAt(this.camera.position.x * 0.4, this.camera.position.y, 0)

    // 悬停拾取
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const meshes = this.cards.map((c) => c.photo)
    const hits = this.raycaster.intersectObjects(meshes, false)
    const hitCard =
      this.selected === null
        ? this.cards.find((c) => c.photo === hits[0]?.object) ?? null
        : null
    this.hoveredCard = hitCard
    this.hovered = hitCard ? hitCard.index : null
    this.renderer.domElement.style.cursor = this.hovered !== null ? 'pointer' : 'grab'

    for (const card of this.cards) {
      const target = this.selected === card.index ? 1.05 : this.hovered === card.index ? 0.35 : 0
      card.lift = damp(card.lift, target, 8, dt)
      const pos = this.cardPosition(card, time)
      pos.z = card.lift
      // 选中卡放大呼吸感
      const scale = 1 + card.lift * 0.06
      card.group.scale.setScalar(scale)
      card.group.position.copy(pos)
    }

    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    const container = this.renderer.domElement.parentElement
    if (container) {
      container.removeEventListener('pointermove', this.onPointerMove)
      container.removeEventListener('pointerdown', this.onPointerDown)
      container.removeEventListener('wheel', this.onWheel)
    }
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        const mat = obj.material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat.dispose()
      }
    })
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
