/**
 * 封面图集 —— 移植自 Rhine-Music-Demo cover-atlas.ts（MIT，© LBEILC / RonaldDeng）。
 * 分页瓦片网格：每页 16×16 = 256 格（页面纹理恰为 4096×4096，兼容全部 GPU），
 * 432 张样片 → 2 页。照片 contain-fit 进瓦片（等比完整显示，余量透明露出玻璃），
 * 1/128 相对内缩防串色，独立透明瓦片边距因此关闭 mipmap（LinearFilter）。
 * 实例侧通过 vec4 coverTile 属性（含页索引分流到对应实例网格）取样。
 */
import * as THREE from 'three'

const INSET = 1 / 128
const PAGE_COLS = 16
const PAGE_ROWS = 16
/** 每页瓦片容量：16×16 = 256（页面纹理 4096×4096） */
export const ATLAS_PAGE_CAPACITY = PAGE_COLS * PAGE_ROWS
/** 瓦片内照片边距（比例），四周透出玻璃边框 */
const PHOTO_MARGIN = 0.04

export interface AtlasTile {
  /** 瓦片所在页 */
  page: number
  offsetX: number
  offsetY: number
  scaleX: number
  scaleY: number
}

interface AtlasPage {
  canvas: OffscreenCanvas
  ctx: OffscreenCanvasRenderingContext2D
  texture: THREE.Texture
}

export class CoverAtlas {
  private readonly pages: AtlasPage[] = []
  private readonly tileSize: number
  private readonly tiles: Array<AtlasTile | null> = []

  constructor(maxTextureSize: number, capacity: number) {
    // 16 列 × tileSize 必须落在 maxTextureSize 内
    this.tileSize = Math.min(256, Math.floor(maxTextureSize / PAGE_COLS))
    const pageCount = Math.max(1, Math.ceil(capacity / ATLAS_PAGE_CAPACITY))
    for (let p = 0; p < pageCount; p += 1) this.pages.push(this.createPage())
  }

  get pageCount(): number {
    return this.pages.length
  }

  private createPage(): AtlasPage {
    const canvas = new OffscreenCanvas(this.tileSize * PAGE_COLS, this.tileSize * PAGE_ROWS)
    const ctx = canvas.getContext('2d')!
    const texture = new THREE.Texture(canvas as unknown as HTMLCanvasElement)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.generateMipmaps = false
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.anisotropy = 4
    texture.needsUpdate = true
    return { canvas, ctx, texture }
  }

  textureOf(page: number): THREE.Texture | undefined {
    return this.pages[page]?.texture
  }

  /** 把一张图 contain-fit 画进指定瓦片（原位替换用于水印升级） */
  set(slot: number, image: ImageBitmap | HTMLImageElement): AtlasTile {
    const page = Math.floor(slot / ATLAS_PAGE_CAPACITY)
    const atlasPage = this.pages[page]
    if (!atlasPage) throw new Error(`atlas page ${page} out of range`)
    const index = slot % ATLAS_PAGE_CAPACITY
    const col = index % PAGE_COLS
    const row = Math.floor(index / PAGE_COLS)
    const x = col * this.tileSize
    const y = row * this.tileSize
    const inset = Math.round(this.tileSize * INSET)
    const margin = Math.round(this.tileSize * PHOTO_MARGIN)
    const inner = this.tileSize - margin * 2

    // 透明底（玻璃从照片周围透出）
    atlasPage.ctx.clearRect(x, y, this.tileSize, this.tileSize)

    // contain-fit：完整显示照片，不裁切
    const aspect = image.width / image.height
    let dw = inner
    let dh = inner
    if (aspect > 1) dh = inner / aspect
    else dw = inner * aspect
    atlasPage.ctx.drawImage(image, x + (this.tileSize - dw) / 2, y + (this.tileSize - dh) / 2, dw, dh)
    atlasPage.texture.needsUpdate = true

    const tile: AtlasTile = {
      page,
      offsetX: (x + inset) / atlasPage.canvas.width,
      offsetY: 1 - (y + this.tileSize - inset) / atlasPage.canvas.height,
      scaleX: (this.tileSize - inset * 2) / atlasPage.canvas.width,
      scaleY: (this.tileSize - inset * 2) / atlasPage.canvas.height
    }
    this.tiles[slot] = tile
    return tile
  }

  tileOf(slot: number): AtlasTile | null {
    return this.tiles[slot] ?? null
  }

  dispose(): void {
    for (const page of this.pages) page.texture.dispose()
  }
}
