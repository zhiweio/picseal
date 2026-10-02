/**
 * 封面图集 —— 移植自 Rhine-Music-Demo cover-atlas.ts（MIT）。
 * 16 列瓦片网格 + 1/128 相对内缩（防串色）+ InstancedBufferAttribute UV 注入。
 */
import * as THREE from 'three'

const INSET = 1 / 128

export interface AtlasTile {
  /** UV 偏移 + 尺寸（vec4 语义：xy 偏移，zw 尺寸） */
  offset: THREE.Vector2
  scale: THREE.Vector2
}

export class CoverAtlas {
  readonly texture: THREE.Texture
  private readonly canvas: OffscreenCanvas
  private readonly ctx: OffscreenCanvasRenderingContext2D
  private readonly cols = 16
  private readonly tileSize: number
  private count = 0

  constructor(maxTextureSize: number) {
    this.tileSize = Math.min(256, Math.floor(maxTextureSize / 16))
    const rows = Math.max(1, Math.ceil(64 / this.cols))
    this.canvas = new OffscreenCanvas(this.tileSize * this.cols, this.tileSize * rows)
    this.ctx = this.canvas.getContext('2d')!
    this.ctx.fillStyle = '#000'
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

    this.texture = new THREE.Texture(this.canvas as unknown as HTMLCanvasElement)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.generateMipmaps = false
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.anisotropy = 4
    this.texture.needsUpdate = true
  }

  /** 把一张图 cover 裁切画进下一个瓦片，返回其 UV（coverTile 属性值） */
  add(image: ImageBitmap | HTMLImageElement): AtlasTile {
    const col = this.count % this.cols
    const row = Math.floor(this.count / this.cols)
    const tile = this.addAt(this.count, image)
    this.count += 1
    return tile
  }

  /** 原位替换某个瓦片（水印实渲完成后升级墙面纹理） */
  addAt(slot: number, image: ImageBitmap | HTMLImageElement): AtlasTile {
    const col = slot % this.cols
    const row = Math.floor(slot / this.cols)

    const x = col * this.tileSize
    const y = row * this.tileSize
    const inset = Math.round(this.tileSize * INSET)

    // cover 裁切：短边铺满
    const aspect = image.width / image.height
    let sx = image.width
    let sy = image.height
    if (aspect > 1) sx = image.height
    else sy = image.width
    const srcX = (image.width - sx) / 2
    const srcY = (image.height - sy) / 2

    this.ctx.drawImage(image, srcX, srcY, sx, sy, x, y, this.tileSize, this.tileSize)
    this.texture.needsUpdate = true

    const cellU = 1 / this.cols
    const cellV = 1 / Math.ceil(this.count / this.cols || 1)
    void cellV
    return {
      offset: new THREE.Vector2(x / this.canvas.width + inset / this.canvas.width, 1 - (y + this.tileSize) / this.canvas.height + inset / this.canvas.height),
      scale: new THREE.Vector2(
        (this.tileSize - inset * 2) / this.canvas.width,
        (this.tileSize - inset * 2) / this.canvas.height
      )
    }
  }
}
