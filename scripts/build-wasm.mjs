#!/usr/bin/env node
/**
 * 重建 EXIF 写入器 WASM 产物（需本机 wasm-pack；CI 在 rust/ 变更时自动执行）。
 * 产物提交进仓库，应用构建永不依赖 Rust 工具链。
 */
import { execSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const crate = resolve(root, 'rust/exif-writer')
const outDir = resolve(root, 'src/wasm/exif')

if (!existsSync(crate)) {
  console.error('rust/exif-writer not found')
  process.exit(1)
}

execSync('wasm-pack build --target web --out-dir ../../src/wasm/exif --scope picseal', {
  cwd: crate,
  stdio: 'inherit'
})

// wasm-pack 产物内的 .gitignore 会阻止产物入库，包描述文件亦无必要
for (const name of ['.gitignore', 'package.json']) {
  rmSync(resolve(outDir, name), { force: true })
}

console.log('wasm artifact refreshed at src/wasm/exif')
