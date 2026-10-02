#!/usr/bin/env node
/**
 * 把 public/brands/*.svg 栅格化为 worker 安全的 PNG（createImageBitmap 不支持 SVG）。
 * 输出 512px 高、保留原始宽高比、透明背景。首次修改品牌 logo 后运行一次并提交产物。
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(root, 'public/brands')

const svgs = (await readdir(dir)).filter((f) => f.endsWith('.svg'))

for (const file of svgs) {
  const name = file.replace(/\.svg$/, '')
  const svg = await readFile(resolve(dir, file))
  const buffer = await sharp(svg, { density: 300 })
    .resize({ height: 512, fit: 'inside' })
    .png()
    .toBuffer()
  await writeFile(resolve(dir, `${name}.png`), buffer)
  const meta = await sharp(buffer).metadata()
  console.log(`${name}.png ${meta.width}x${meta.height}`)
}
