/**
 * 封面图集 —— 移植自 Rhine-Music-Demo cover-atlas.ts（MIT，© LBEILC / RonaldDeng）。
 * 16 列瓦片网格：照片 contain-fit 进瓦片（等比完整显示，余量透明露出玻璃），
 * 1/128 相对内缩防串色，独立透明瓦片边距因此关闭 mipmap（LinearFilter）。
 * 实例侧通过 vec4 coverTile 属性取样（materials.createCoverMaterial 注入）。
 */
import * as THREE from 'three'

const INSET = 1 / 128
/** 瓦片内照片边距（比例），四周透出玻璃边框 */
const PHOTO_MARGIN = 0.04

export interface AtlasTile {
  offsetX: number
  offsetY: number
  scaleX: number
  scaleY: number
}

export class CoverAtlas {
  readonly texture: THREE.Texture
  readonly canvas: OffscreenCanvas
  private readonly ctx: OffscreenCanvasRenderingContext2D
  private readonly cols = 16
  private readonly rows: number
  private readonly tileSize: number
  private readonly tiles: Array<AtlasTile | null> = []

  constructor(maxTextureSize: number, capacity = 64) {
    this.tileSize = Math.min(256, Math.floor(maxTextureSize / 16))
    this.rows = Math.max(1, Math.ceil(capacity / this.cols))
    this.canvas = new OffscreenCanvas(this.tileSize * this.cols, this.tileSize * this.rows)
    this.ctx = this.canvas.getContext('2d')!

    this.texture = new THREE.Texture(this.canvas as unknown as HTMLCanvasElement)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.generateMipmaps = false
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.anisotropy = 4
    this.texture.needsUpdate = true
  }

  /** 把一张图 contain-fit 画进指定瓦片（原位替换用于水印升级） */
  set(slot: number, image: ImageBitmap | HTMLImageElement): AtlasTile {
    const col = slot % this.cols
    const row = Math.floor(slot / this.cols)
    const x = col * this.tileSize
    const y = row * this.tileSize
    const inset = Math.round(this.tileSize * INSET)
    const margin = Math.round(this.tileSize * PHOTO_MARGIN)
    const inner = this.tileSize - margin * 2

    // 透明底（玻璃从照片周围透出）
    this.ctx.clearRect(x, y, this.tileSize, this.tileSize)

    // contain-fit：完整显示照片，不裁切
    const aspect = image.width / image.height
    let dw = inner
    let dh = inner
    if (aspect > 1) dh = inner / aspect
    else dw = inner * aspect
    this.ctx.drawImage(image, x + (this.tileSize - dw) / 2, y + (this.tileSize - dh) / 2, dw, dh)
    this.texture.needsUpdate = true

    const tile: AtlasTile = {
      offsetX: (x + inset) / this.canvas.width,
      offsetY: 1 - (y + this.tileSize - inset) / this.canvas.height,
      scaleX: (this.tileSize - inset * 2) / this.canvas.width,
      scaleY: (this.tileSize - inset * 2) / this.canvas.height
    }
    this.tiles[slot] = tile
    return tile
  }

  tileOf(slot: number): AtlasTile | null {
    return this.tiles[slot] ?? null
  }

  dispose(): void {
    this.texture.dispose()
  }
}
