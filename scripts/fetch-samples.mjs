#!/usr/bin/env node
/**
 * 从 Wikimedia Commons 按相机分类采集高质量实拍样片（含真实 EXIF）。
 * - 质量门槛：原图长边 ≥2000px、sharp 熵值 ≥5（过滤低质/扫描件）、
 *   优先 Commons Quality/Valued/Featured 标记
 * - 丰富度：每类至多 3 张、同作者至多 2 张、横竖幅配比约 2:1、品牌覆盖优先
 * - sharp 重编码（长边 2048、quality 80）控制体积（总量上限 ~32MB）
 * - 产出 public/samples/*.jpg + manifest.json + CREDITS.md（署名合规）
 *
 * 用法：node scripts/fetch-samples.mjs [--min N]
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const exifr = require('exifr')
const sharp = require('sharp')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'public/samples')
const minArg = process.argv.indexOf('--min')
const min = Number(minArg > -1 ? process.argv[minArg + 1] : 45)
const PER_CATEGORY = 3
const PER_ARTIST = 2
const MIN_ORIGINAL_EDGE = 2000
const MIN_ENTROPY = 5
const MAX_TOTAL_BYTES = 32 * 1024 * 1024
const THUMB_EDGE = 2048
const UA = 'picseal-samples/1.1 (https://github.com/zhiweio/picseal)'

/** 相机分类清单：品牌覆盖优先，横竖幅不限 */
const CATEGORIES = [
  // 以下分类名均经 Commons API allcategories 前缀枚举核实
  'Category:Taken with Nikon Z 8',
  'Category:Taken with Nikon Z 6II',
  'Category:Taken with Nikon Z 7II',
  'Category:Taken with Nikon D850',
  'Category:Taken with Canon EOS R6 Mark II',
  'Category:Taken with Canon EOS R6',
  'Category:Taken with Canon EOS R5',
  'Category:Taken with Canon EOS 5D Mark IV',
  'Category:Taken with Canon EOS 5D Mark III',
  'Category:Taken with Leica M11',
  'Category:Taken with Leica M10',
  'Category:Taken with Sony ILCE-7M3',
  'Category:Taken with Sony ILCE-7M4',
  'Category:Taken with Sony ILCE-7RM3',
  'Category:Taken with Sony ILCE-7RM4',
  'Category:Taken with Sony ILCE-7RM5',
  'Category:Taken with Sony α7 III',
  'Category:Taken with Fujifilm X-T5',
  'Category:Taken with Fujifilm X100V',
  'Category:Taken with Fujifilm X-T4',
  'Category:Taken with Fujifilm X-Pro3',
  'Category:Taken with Ricoh GR III',
  'Category:Taken with Ricoh GR IIIx',
  'Category:Taken with Panasonic Lumix DC-S5',
  'Category:Taken with Panasonic Lumix DC-S1R',
  'Category:Taken with OM System OM-1',
  'Category:Taken with Hasselblad X2D 100C',
  'Category:Taken with Hasselblad X1D II 50C',
  'Category:Taken with Pentax K-3 III',
  'Category:Taken with Pentax K-1',
  'Category:Taken with Apple iPhone 15 Pro',
  'Category:Taken with Apple iPhone 14 Pro',
  'Category:Taken with Samsung Galaxy S24 Ultra'
]

const BAD_LICENSE = /fair use|non-free/i
const QUALITY_MARK = /quality images|valued images|featured pictures/i

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(params) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch('https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ format: 'json', action: 'query', ...params }), { headers: { 'User-Agent': UA } })
    if (res.status === 429 || res.status === 503) {
      await sleep(4000 * (attempt + 1))
      continue
    }
    const text = await res.text()
    if (text.startsWith('<')) {
      if (attempt === 0) console.error('  HTML response:', text.slice(0, 200).replace(/\n/g, ' '))
      await sleep(3500)
      continue
    }
    return JSON.parse(text)
  }
  return {}
}

async function* members(category) {
  let token
  do {
    const params = { list: 'categorymembers', cmtitle: category, cmtype: 'file', cmlimit: '50' }
    if (token) params.cmcontinue = token
    const data = await api(params)
    const list = data.query?.categorymembers ?? []
    console.error(`  [${category}] members=${list.length}${data.error ? ' error=' + data.error.info : ''}`)
    for (const m of list) yield m.title
    token = data.continue?.cmcontinue
  } while (token)
}

/** Commons 质量标记（Quality/Valued/Featured Images） */
function isQualityImage(meta) {
  return QUALITY_MARK.test(String(meta.Categories?.value ?? ''))
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const credits = []
  const perCat = {}
  const perArtist = {}
  const seenTitles = new Set()
  let landscape = 0
  let portrait = 0
  let totalBytes = 0
  let got = 0

  outer: for (const category of CATEGORIES) {
    if (got >= min || totalBytes > MAX_TOTAL_BYTES) break
    // 品牌键来自分类名（Taken with Sony α7 III → sony）
    const brandKey = category
      .replace(/^Category:Taken with /i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .split('-')[0]
    const brandSlug = category
      .replace(/^Category:Taken with /i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')

    let seen = 0
    for await (const title of members(category)) {
      if (seen > 40 || got >= min || totalBytes > MAX_TOTAL_BYTES) break
      if (perCat[brandSlug] >= PER_CATEGORY) break
      seen += 1
      if (seenTitles.has(title)) continue
      seenTitles.add(title)
      await sleep(500)
      if (!/\.(jpe?g)$/i.test(title)) continue

      try {
        const data = await api({
          titles: title,
          prop: 'imageinfo',
          iiprop: 'url|size|extmetadata',
          iiurlwidth: String(THUMB_EDGE)
        })
        const page = Object.values(data.query?.pages ?? {})[0]
        const info = page?.imageinfo?.[0]
        if (!info?.thumburl) continue
        const meta = info.extmetadata ?? {}
        const license = (meta.LicenseShortName?.value ?? '').toString()
        if (BAD_LICENSE.test(license)) continue
        // 质量门槛 1：原图分辨率
        if (Math.max(info.width ?? 0, info.height ?? 0) < MIN_ORIGINAL_EDGE) continue

        const artist = (meta.Artist?.value ?? 'Unknown').replace(/<[^>]+>/g, '').trim().slice(0, 120) || 'Unknown'
        if ((perArtist[artist] ?? 0) >= PER_ARTIST) continue

        // 断点续传：成品已存在（含 EXIF）则直接登记，跳过下载与重编码
        const aspect = (info.width ?? 1) / (info.height ?? 1)
        const isPortrait = aspect < 0.95
        const quality = isQualityImage(meta)
        const nextIndex = (perCat[brandSlug] ?? 0) + 1
        const slug = `${brandSlug}-${String(nextIndex).padStart(2, '0')}`
        const existing = resolve(outDir, `${slug}.jpg`)
        if (existsSync(existing)) {
          const exif = await exifr.parse(await readFile(existing), [
            'Make', 'Model', 'LensModel', 'FocalLength', 'FocalLengthIn35mmFormat',
            'FNumber', 'ExposureTime', 'ISO', 'DateTimeOriginal', 'CreateDate'
          ])
          if (exif?.Make && exif?.Model) {
            perCat[brandSlug] = nextIndex
            perArtist[artist] = (perArtist[artist] ?? 0) + 1
            if (isPortrait) portrait += 1
            else landscape += 1
            credits.push({
              file: `${slug}.jpg`,
              sourceTitle: title,
              brandKey,
              license,
              licenseUrl: meta.LicenseUrl?.value ?? '',
              artist,
              descriptionUrl: info.descriptionurl ?? '',
              model: String(exif.Model),
              entropy: '-',
              quality
            })
            got += 1
            console.log(`= ${slug}.jpg  ${exif.Make} ${exif.Model}  (resumed) [${got}/${min}]`)
            continue
          }
        }

        let res = await fetch(info.thumburl, { headers: { 'User-Agent': UA } })
        if (res.status === 429 || res.status === 503) {
          await sleep(2500)
          res = await fetch(info.thumburl, { headers: { 'User-Agent': UA } })
        }
        if (!res.ok) continue
        const buf = Buffer.from(await res.arrayBuffer())

        const exif = await exifr.parse(buf, [
          'Make', 'Model', 'LensModel', 'FocalLength', 'FocalLengthIn35mmFormat',
          'FNumber', 'ExposureTime', 'ISO', 'DateTimeOriginal', 'CreateDate'
        ])
        if (!exif?.Make || !exif?.Model) continue
        if (!exif.FNumber && !exif.ExposureTime && !exif.ISO) continue

        const img = sharp(buf, { failOn: 'none' })
        const stats = await img.stats()
        // 质量门槛 2：全图熵值（低熵多为纯色/文档/翻拍）；字段缺失视为不达标
        const entropy = Number(stats.entropy)
        if (!Number.isFinite(entropy) || (entropy < MIN_ENTROPY && !quality)) continue

        // 丰富度：横竖幅配比约 2:1（比例失衡时软性偏好评）
        const portraitQuota = Math.floor(min / 3)
        if (isPortrait && portrait >= portraitQuota && !quality && got < min - 6) continue

        const out = await img
          .rotate()
          .withMetadata()
          .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer()
        if (totalBytes + out.length > MAX_TOTAL_BYTES) break outer
        await writeFile(resolve(outDir, `${slug}.jpg`), out)
        totalBytes += out.length

        perCat[brandSlug] = (perCat[brandSlug] ?? 0) + 1
        perArtist[artist] = (perArtist[artist] ?? 0) + 1
        if (isPortrait) portrait += 1
        else landscape += 1

        credits.push({
          file: `${slug}.jpg`,
          sourceTitle: title,
          brandKey,
          license,
          licenseUrl: meta.LicenseUrl?.value ?? '',
          artist,
          descriptionUrl: info.descriptionurl ?? '',
          model: String(exif.Model),
          entropy: entropy.toFixed(2),
          quality
        })
        got += 1
        console.log(`+ ${slug}.jpg  ${exif.Make} ${exif.Model}  (${license}${quality ? ', ★quality' : ''}, H${entropy.toFixed(1)}${isPortrait ? ', 竖' : ''}) [${got}/${min}]`)
      } catch (err) {
        // 单张失败忽略
        void err
      }
    }
  }

  // manifest（顺序即墙面顺序）
  const manifest = credits.map((c) => ({ id: c.file.replace('.jpg', ''), file: c.file }))
  await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  // CREDITS.md
  const lines = [
    '# 示例照片署名 / Sample Photo Credits',
    '',
    '以下照片来自 Wikimedia Commons（各自标注的自由许可），用于产品演示样片。',
    'Photos below are from Wikimedia Commons under their respective free licenses, used as demo samples.',
    '',
    '| 文件 | 相机 | 作者 | 许可 | 来源 |',
    '|---|---|---|---|---|'
  ]
  for (const c of credits) {
    lines.push(`| ${c.file} | ${c.model} | ${c.artist} | [${c.license}](${c.licenseUrl}) | [Commons](${c.descriptionUrl}) |`)
  }
  await writeFile(resolve(root, 'CREDITS.md'), lines.join('\n') + '\n')
  console.log(`done: ${got} samples, ${(totalBytes / 1024 / 1024).toFixed(1)}MB, landscape ${landscape} / portrait ${portrait}`)
}

await main()
