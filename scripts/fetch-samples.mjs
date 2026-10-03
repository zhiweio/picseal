#!/usr/bin/env node
/**
 * 从 Wikimedia Commons 按相机分类采集高质量实拍样片（含真实 EXIF）。
 *
 * 扫描策略：generator=categorymembers 批量携带 imageinfo + 原始 EXIF 元数据，
 * 在下载之前就过滤掉无 EXIF / 低分辨率 / 不自由许可的候选（拒访零下载成本），
 * 只对通过门槛的候选下载缩略图并做最终校验（exifr + 熵值）。
 *
 * - 质量门槛：原图长边 ≥2000px、EXIF 含 Make/Model + 拍摄参数、
 *   sharp 全图熵值 ≥5、优先 Commons Quality/Valued/Featured 标记
 * - 丰富度：每类至多 PER_CATEGORY 张、同作者至多 PER_ARTIST 张、横竖幅约 3:1
 * - 礼貌抓取：下载间隔 ~1.2s 随机抖动，429/503 指数退避，所有请求 20s 超时
 * - 体积：长边 1600、mozjpeg q78，总量上限 MAX_TOTAL_BYTES
 * - 产出 public/samples/*.jpg + manifest.json + CREDITS.md（署名合规）
 * - 断点续传：成品已存在的直接登记计数，不重复下载
 *
 * 用法：node scripts/fetch-samples.mjs [--min N]
 */
import { writeFile, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const exifr = require('exifr')
const sharp = require('sharp')
const piexif = require('piexifjs')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'public/samples')
const minArg = process.argv.indexOf('--min')
const min = Number(minArg > -1 ? process.argv[minArg + 1] : 432)
const PER_CATEGORY = 16
const PER_ARTIST = 3
const MIN_ORIGINAL_EDGE = 2000
const MIN_ENTROPY = 5
const MAX_TOTAL_BYTES = 160 * 1024 * 1024
const THUMB_EDGE = 1600
/** 每类扫描候选上限 */
const SCAN_CAP = 250
const UA = 'picseal-samples/1.3 (https://github.com/zhiweio/picseal)'

/**
 * 相机分类清单：前段为历史已验证分类（保证续传 slug 编号一致），
 * 后段为扩充分类（更广的机身/价位/年代覆盖 → 题材与风格多样性）。
 * 空分类自动跳过。
 */
const CATEGORIES = [
  // ── 历史批次（顺序勿动，续传依赖稳定编号）──
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
  'Category:Taken with Samsung Galaxy S24 Ultra',
  // ── 扩充批次（更多品牌/机型 → 题材与风格多样性）──
  'Category:Taken with Nikon Z 9',
  'Category:Taken with Nikon Z 6 III',
  'Category:Taken with Nikon Zf',
  'Category:Taken with Nikon D780',
  'Category:Taken with Nikon D500',
  'Category:Taken with Nikon D750',
  'Category:Taken with Canon EOS R3',
  'Category:Taken with Canon EOS R8',
  'Category:Taken with Canon EOS RP',
  'Category:Taken with Canon EOS R7',
  'Category:Taken with Canon EOS R10',
  'Category:Taken with Canon EOS 5DS R',
  'Category:Taken with Canon EOS-1D X Mark II',
  'Category:Taken with Sony ILCE-9',
  'Category:Taken with Sony ILCE-9M2',
  'Category:Taken with Sony ILCE-1',
  'Category:Taken with Sony ILCE-7CR',
  'Category:Taken with Sony α7 IV',
  'Category:Taken with Leica Q3',
  'Category:Taken with Leica Q2',
  'Category:Taken with Leica M6',
  'Category:Taken with Fujifilm GFX 100S',
  'Category:Taken with Fujifilm X-H2',
  'Category:Taken with Fujifilm X-H2S',
  'Category:Taken with Fujifilm X100VI',
  'Category:Taken with Fujifilm X-E4',
  'Category:Taken with Fujifilm X-S20',
  'Category:Taken with Ricoh GR II',
  'Category:Taken with Ricoh GR IIx',
  'Category:Taken with Panasonic Lumix DC-S5II',
  'Category:Taken with Panasonic Lumix DC-GH6',
  'Category:Taken with Panasonic Lumix DC-G9',
  'Category:Taken with Panasonic Lumix DMC-GH5',
  'Category:Taken with Panasonic Lumix DMC-LX5',
  'Category:Taken with OM System OM-1 Mark II',
  'Category:Taken with Olympus E-M1 Mark III',
  'Category:Taken with Olympus E-M5 Mark III',
  'Category:Taken with Olympus PEN-F',
  'Category:Taken with Hasselblad 907X',
  'Category:Taken with Pentax K-3',
  'Category:Taken with Pentax 645Z',
  'Category:Taken with Sigma fp L',
  'Category:Taken with Apple iPhone 16 Pro',
  'Category:Taken with Apple iPhone 15 Pro Max',
  'Category:Taken with Apple iPhone 14 Pro Max',
  'Category:Taken with Apple iPhone 13 Pro',
  'Category:Taken with Google Pixel 8 Pro',
  'Category:Taken with Google Pixel 9 Pro',
  'Category:Taken with Xiaomi 14 Ultra',
  'Category:Taken with Xiaomi 13 Ultra',
  'Category:Taken with Samsung Galaxy S23 Ultra',
  'Category:Taken with Samsung Galaxy S24',
  'Category:Taken with DJI Mavic 3'
]

const BAD_LICENSE = /fair use|non-free/i
const QUALITY_MARK = /quality images|valued images|featured pictures/i

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** 下载间隔：基础 900ms + 0-700ms 抖动 */
const politeSleep = () => sleep(900 + Math.floor(Math.random() * 700))
/** 带超时的 fetch：慢连接直接放弃（防止整条流水线卡死） */
function fetchWithTimeout(url, ms = 20000) {
  return fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(ms) })
}

async function api(params) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let res
    try {
      res = await fetchWithTimeout('https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ format: 'json', action: 'query', ...params }))
    } catch {
      await sleep(3000)
      continue
    }
    if (res.status === 429 || res.status === 503) {
      const wait = 6000 * (attempt + 1)
      console.error(`  [rate-limit] ${res.status}, wait ${wait / 1000}s`)
      await sleep(wait)
      continue
    }
    const text = await res.text()
    if (text.startsWith('<')) {
      if (attempt === 0) console.error('  HTML response:', text.slice(0, 200).replace(/\n/g, ' '))
      await sleep(4000)
      continue
    }
    return JSON.parse(text)
  }
  return {}
}

/** 在 imageinfo 的原始 metadata 树里递归找 EXIF 标签（下载前预检 Make/Model） */
function collectTags(node, out) {
  if (!Array.isArray(node)) return
  for (const item of node) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.name === 'string') out.set(item.name, item.value)
    if (Array.isArray(item.value)) collectTags(item.value, out)
  }
}

/**
 * 每类候选流：generator=categorymembers 批量携带 imageinfo（含 extmetadata
 * 许可/作者 + 原始 metadata EXIF 预检），按 pageid 恢复稳定顺序（续传依赖）。
 */
async function* categoryCandidates(category) {
  let gcmcontinue
  let collected = 0
  do {
    const params = {
      generator: 'categorymembers',
      gcmtitle: category,
      gcmtype: 'file',
      gcmlimit: '50',
      prop: 'imageinfo',
      iiprop: 'url|size|extmetadata|metadata',
      iiurlwidth: String(THUMB_EDGE)
    }
    if (gcmcontinue) params.gcmcontinue = gcmcontinue
    const data = await api(params)
    const pages = Object.values(data.query?.pages ?? {})
    pages.sort((a, b) => (a.pageid ?? 0) - (b.pageid ?? 0))
    for (const page of pages) {
      if (collected >= SCAN_CAP) return
      if (!/\.jpe?g$/i.test(page.title ?? '')) continue
      const info = page.imageinfo?.[0]
      if (!info?.thumburl) continue
      collected += 1
      const tags = new Map()
      collectTags(info.metadata, tags)
      yield { title: page.title, info, tags }
    }
    gcmcontinue = data.continue?.gcmcontinue
  } while (gcmcontinue)
}

/** Commons 质量标记（Quality/Valued/Featured Images） */
function isQualityImage(meta) {
  return QUALITY_MARK.test(String(meta.Categories?.value ?? ''))
}

/** 'n/d' 字符串 → [n, d]（piexif 有理数）；已为数组/数值则原样返回 */
function toRational(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'number') return [value, 1]
  const m = String(value).match(/^(-?\d+)\/(\d+)$/)
  if (m) return [Number(m[1]), Number(m[2])]
  const n = Number(value)
  return Number.isFinite(n) ? [Math.round(n * 100), 100] : undefined
}

/**
 * 用 Commons 原始 EXIF 元数据合成标准 EXIF 段并注入重编码 JPEG。
 * Commons 缩略图会剥离 EXIF，但原始文件的 metadata 完整 —— 像素来自缩略图、
 * EXIF 来自原图，经 piexifjs 写成规范结构（兼容 little_exif 回读）。
 * Orientation 恒为 1（sharp 已按 EXIF 摆正像素）。
 */
function injectExif(jpeg, tags) {
  const str = (v) => (v === undefined || v === null ? undefined : String(v))
  const zeroth = {
    [piexif.ImageIFD.Make]: str(tags.get('Make')),
    [piexif.ImageIFD.Model]: str(tags.get('Model')),
    [piexif.ImageIFD.Orientation]: 1,
    [piexif.ImageIFD.Software]: 'PICSEAL'
  }
  const exifIfd = {}
  const dtOriginal = str(tags.get('DateTimeOriginal'))
  if (dtOriginal) exifIfd[piexif.ExifIFD.DateTimeOriginal] = dtOriginal
  const lens = str(tags.get('LensModel'))
  if (lens) exifIfd[piexif.ExifIFD.LensModel] = lens
  const focal = toRational(tags.get('FocalLength'))
  if (focal) exifIfd[piexif.ExifIFD.FocalLength] = focal
  const focal35 = toRational(tags.get('FocalLengthIn35mmFormat'))
  if (focal35) exifIfd[piexif.ExifIFD.FocalLengthIn35mmFilm] = focal35
  const fNumber = toRational(tags.get('FNumber'))
  if (fNumber) exifIfd[piexif.ExifIFD.FNumber] = fNumber
  const exposure = toRational(tags.get('ExposureTime'))
  if (exposure) exifIfd[piexif.ExifIFD.ExposureTime] = exposure
  const iso = Number(tags.get('ISOSpeedRatings'))
  if (Number.isFinite(iso) && iso > 0) exifIfd[piexif.ExifIFD.ISOSpeedRatings] = iso
  exifIfd[piexif.ExifIFD.ExifVersion] = '0232'

  const dict = { '0th': zeroth, Exif: exifIfd }
  const bytes = piexif.dump(dict)
  return Buffer.from(piexif.insert(bytes, jpeg.toString('binary')), 'binary')
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

    let scanned = 0
    for await (const { title, info, tags } of categoryCandidates(category)) {
      if (got >= min || totalBytes > MAX_TOTAL_BYTES) break
      if (perCat[brandSlug] >= PER_CATEGORY) break
      if (seenTitles.has(title)) continue
      seenTitles.add(title)
      scanned += 1
      if (scanned % 50 === 0) console.error(`  [${brandSlug}] scanned ${scanned}, got ${got}/${min}`)

      try {
        const meta = info.extmetadata ?? {}
        const license = (meta.LicenseShortName?.value ?? '').toString()
        if (BAD_LICENSE.test(license)) continue
        // 质量门槛 1：原图分辨率（下载前即可判定）
        if (Math.max(info.width ?? 0, info.height ?? 0) < MIN_ORIGINAL_EDGE) continue
        // 门槛 2：原始 EXIF 含 Make/Model + 拍摄参数（下载前预检，废候选零下载）
        const rawMake = tags.get('Make')
        const rawModel = tags.get('Model')
        if (!rawMake || !rawModel) continue
        const hasParams = ['FNumber', 'ExposureTime', 'ISOSpeedRatings', 'ShutterSpeedValue', 'ExposureBiasValue', 'FocalLength']
          .some((k) => tags.has(k))
        if (!hasParams) continue

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

        // 竖幅配额软约束（质量图豁免）
        const portraitQuota = Math.floor(min / 4)
        if (isPortrait && portrait >= portraitQuota && !quality && got < min - 20) continue

        await politeSleep()
        let res = await fetchWithTimeout(info.thumburl)
        if (res.status === 429 || res.status === 503) {
          console.error('  [rate-limit] thumbnail, wait 10s')
          await sleep(10000)
          res = await fetchWithTimeout(info.thumburl)
        }
        if (!res.ok) continue
        const buf = Buffer.from(await res.arrayBuffer())

        const img = sharp(buf, { failOn: 'none' })
        const stats = await img.stats()
        // 质量门槛 3：全图熵值（低熵多为纯色/文档/翻拍）；字段缺失视为不达标
        const entropy = Number(stats.entropy)
        if (!Number.isFinite(entropy) || (entropy < MIN_ENTROPY && !quality)) continue

        // 缩略图像素 + 原图 EXIF（Commons 缩略图剥 EXIF，由原始 metadata 合成标准结构）
        const out = injectExif(
          await img
            .rotate()
            .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 78, mozjpeg: true })
            .toBuffer(),
          tags
        )
        if (totalBytes + out.length > MAX_TOTAL_BYTES) break outer

        // 写盘前校验：合成 EXIF 必须可回读
        const exif = await exifr.parse(out, [
          'Make', 'Model', 'LensModel', 'FocalLength', 'FocalLengthIn35mmFormat',
          'FNumber', 'ExposureTime', 'ISO', 'DateTimeOriginal', 'CreateDate'
        ]).catch(() => null)
        if (!exif?.Make || !exif?.Model) {
          console.error(`  - ${title.replace(/^File:/, '').slice(0, 60)} (exif synth failed)`)
          continue
        }
        await writeFile(resolve(outDir, `${slug}.jpg`), out)
        totalBytes += out.length

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

  // 汇总：以磁盘实际文件为准
  const files = (await readdir(outDir)).filter((f) => f.endsWith('.jpg'))
  let diskBytes = 0
  for (const f of files) diskBytes += (await stat(resolve(outDir, f))).size
  console.log(`done: ${got} registered, ${files.length} files on disk, ${(diskBytes / 1024 / 1024).toFixed(1)}MB total, landscape ${landscape} / portrait ${portrait}`)
}

await main()
