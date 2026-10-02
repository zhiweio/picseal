#!/usr/bin/env node
/**
 * 水印字体产物构建：
 * - 拉丁族：直接拷贝 @fontsource 的 latin woff2（每字重 ~20-40KB）
 * - CJK 族：从官方源 TTF/OTF 做 GB2312+latin 子集 → woff2（~1-1.5MB，惰性加载）
 * - 许可文件归档到 public/fonts/licenses/
 *
 * CJK 源文件（不入库）放在 $PICSEAL_FONT_SRC（默认 /tmp/fontsrc）：
 *   LXGWWenKai-Regular.ttf  https://github.com/lxgw/LxgwWenKai/releases
 *   MaShanZheng-Regular.ttf https://github.com/google/fonts/tree/main/ofl/mashanzheng
 *   NotoSerifSC.ttf         https://github.com/google/fonts/tree/main/ofl/notoserifsc（可变字重）
 *   SmileySans-Oblique.ttf  https://github.com/atelier-anchor/smiley-sans/releases
 *   AlibabaPuHuiTi-2-{45-Light,85-Bold}.otf  free-commercial（阿里普惠体）
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import iconv from 'iconv-lite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const wmDir = resolve(root, 'public/fonts/wm')
const licDir = resolve(root, 'public/fonts/licenses')
const fontSrc = process.env.PICSEAL_FONT_SRC ?? '/tmp/fontsrc'
const fontsource = resolve(root, 'node_modules/@fontsource')

mkdirSync(wmDir, { recursive: true })
mkdirSync(licDir, { recursive: true })

/* ── 拉丁族：fontsource latin woff2 直拷 ── */
const latinCopies = [
  ['archivo', { 300: 300, 400: 400, 500: 500, 600: 600, 700: 700, 800: 800 }],
  ['roboto', { 300: 300, 400: 400, 500: 500, 700: 700 }],
  ['bebas-neue', { 400: 400 }],
  ['oswald', { 300: 300, 400: 400, 500: 500, 600: 600 }],
  ['playfair-display', { 400: 400, 700: 700 }]
]
for (const [pkg, weights] of latinCopies) {
  const filesDir = resolve(fontsource, pkg, 'files')
  if (!existsSync(filesDir)) {
    console.warn(`skip ${pkg} (@fontsource/${pkg} not installed)`)
    continue
  }
  for (const [ourWeight, srcWeight] of Object.entries(weights)) {
    const src = resolve(filesDir, `${pkg}-latin-${srcWeight}-normal.woff2`)
    if (existsSync(src)) {
      copyFileSync(src, resolve(wmDir, `${pkg}-${ourWeight}.woff2`))
    } else {
      console.warn(`missing ${pkg} weight ${srcWeight}`)
    }
  }
}

/* ── CJK 族：pyftsubset GB2312+latin → woff2 ── */
const GB_RANGES = (() => {
  const codes = []
  for (let hi = 0xb0; hi < 0xf8; hi += 1) {
    for (let lo = 0xa1; lo < 0xff; lo += 1) {
      const ch = iconv.decode(Buffer.from([hi, lo]), 'gb2312')
      if (ch.length === 1 && ch !== '\uFFFD') {
        codes.push(`U+${ch.codePointAt(0).toString(16).toUpperCase()}`)
      }
    }
  }
  return codes.join(',')
})()
const LATIN_RANGES =
  'U+0020-007E,U+00A0-00FF,U+0391-03C9,U+2000-206F,U+2100-214F,U+2460-24FF,U+3000-3004,U+FF01-FF65'

function subset(source, out, extra = []) {
  if (!existsSync(source)) {
    console.warn(`skip ${out} (source not found: ${source})`)
    return
  }
  execSync(
    [
      'pyftsubset', source,
      `--output-file=${resolve(wmDir, out)}`,
      '--flavor=woff2',
      `--unicodes=${LATIN_RANGES},${GB_RANGES}`,
      '--layout-features=*',
      '--no-hinting',
      ...extra
    ].join(' '),
    { stdio: 'pipe' }
  )
  const kb = Math.round(readFileSync(resolve(wmDir, out)).byteLength / 1024)
  console.log(`${out} ${kb}KB`)
}

const src = (f) => resolve(fontSrc, f)
const semi = (f) => resolve('/Users/wangzhiwei/Projects/github/semi-utils/config/fonts', f)

subset(src('SmileySans-Oblique.ttf'), 'smiley-sans-400.woff2')
subset(src('LXGWWenKai-Regular.ttf'), 'lxgw-wenkai-400.woff2')
subset(src('MaShanZheng-Regular.ttf'), 'ma-shan-zheng-400.woff2')
// NotoSerifSC 为可变字体：pyftsubset 直接保留变化轴，单文件覆盖 400-900
{
  const source = src('NotoSerifSC.ttf')
  if (existsSync(source)) {
    execSync(
      `pyftsubset ${source} --output-file=${resolve(wmDir, 'noto-serif-sc-vf.woff2')} ` +
      `--flavor=woff2 --unicodes=${LATIN_RANGES},${GB_RANGES} --layout-features=* --no-hinting`,
      { stdio: 'pipe' }
    )
    console.log(`noto-serif-sc-vf.woff2 ${Math.round(readFileSync(resolve(wmDir, 'noto-serif-sc-vf.woff2')).byteLength / 1024)}KB`)
  }
}
subset(semi('AlibabaPuHuiTi-2-45-Light.otf'), 'puhuiti-300.woff2')
subset(semi('AlibabaPuHuiTi-2-85-Bold.otf'), 'puhuiti-700.woff2')
subset(semi('Roboto-Light.ttf'), 'roboto-300.woff2')
subset(semi('Roboto-Regular.ttf'), 'roboto-400.woff2')
subset(semi('Roboto-Medium.ttf'), 'roboto-500.woff2')
subset(semi('Roboto-Bold.ttf'), 'roboto-700.woff2')

/* ── 许可归档 ── */
const licCopy = (from, to) => {
  if (existsSync(from)) copyFileSync(from, resolve(licDir, to))
  else console.warn(`license missing: ${from}`)
}
licCopy(resolve(fontsource, 'archivo/LICENSE'), 'OFL-Archivo.txt')
licCopy(resolve(fontsource, 'bebas-neue/LICENSE'), 'OFL-BebasNeue.txt')
licCopy(resolve(fontsource, 'oswald/LICENSE'), 'OFL-Oswald.txt')
licCopy(resolve(fontsource, 'playfair-display/LICENSE'), 'OFL-PlayfairDisplay.txt')
licCopy(resolve(fontsource, 'roboto/LICENSE'), 'Roboto-License.txt')
licCopy(src('OFL.txt'), 'OFL-SmileySans.txt')
licCopy(resolve(root, 'public/fonts/MiSans-license.pdf'), 'MiSans-license.pdf')

console.log('fonts build done → public/fonts/wm')
