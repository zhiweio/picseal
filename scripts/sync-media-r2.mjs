#!/usr/bin/env node
/**
 * 同步演示媒体到 Cloudflare R2 —— 样片 / 水印字体 / 品牌 logo / 放映室影音 / BGM / GLB。
 * 凭据从环境变量或 .env.r2 读取（CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / R2_BUCKET），
 * 走 Cloudflare REST 对象端点 + API token Bearer 认证（S3 端点需 SigV4 签名，不适用），零外部依赖。
 *
 * 用法：
 *   pnpm sync:media            # dry-run，仅列出将要上传的对象与元数据
 *   pnpm sync:media --apply    # 实际上传（远端 ETag == 本地 MD5 时跳过）
 *
 * 缓存策略与 docs/media-cdn.md 一致：
 *   媒体文件 immutable 一年；manifest.json / CREDITS.md 走 no-cache 保新鲜。
 *   内容更新必须换文件名（项目既有规则），否则 CDN 与浏览器都不会取新资源。
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')

/** 纳入同步的目录（桶内 key 与 public/ 下相对路径一一对应） */
const SYNC_DIRS = ['samples', 'fonts', 'brands', 'cinema', 'audio', 'assets']
const SKIP_FILES = new Set(['.DS_Store'])

/** 需要保持新鲜的清单/署名文件：CDN 不缓存，每次回源校验 */
function isNoCache(key) {
  return key === 'samples/manifest.json' || key.endsWith('/CREDITS.md')
}

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
}

const apply = process.argv.includes('--apply')
const force = process.argv.includes('--force')

/* ── 凭据：进程 env 优先，其次 .env.r2（本地私密文件，gitignore） ── */
function loadEnvFile(path) {
  const vars = {}
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) vars[m[1]] = m[2]
    }
  } catch {
    /* 文件不存在时仅用进程 env */
  }
  return vars
}

const envFile = loadEnvFile(join(ROOT, '.env.r2'))
const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? envFile.CLOUDFLARE_API_TOKEN
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? envFile.CLOUDFLARE_ACCOUNT_ID
const BUCKET = process.env.R2_BUCKET ?? envFile.R2_BUCKET ?? 'picseal-media'

if (!TOKEN || !ACCOUNT) {
  console.error('缺少 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID（写入 .env.r2 或导出到环境）')
  process.exit(1)
}

const API = 'https://api.cloudflare.com/client/v4'

function objectUrl(key) {
  return `${API}/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`
}

/** 拉取桶内全部对象的 {key → etag}（分页遍历；ETag 即单段 PUT 的 MD5） */
async function remoteEtags() {
  const map = new Map()
  let cursor = ''
  for (;;) {
    const url =
      `${API}/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects?per_page=1000` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
    if (!res.ok) throw new Error(`list objects HTTP ${res.status}`)
    const body = await res.json()
    if (!body.success) throw new Error(`list objects failed: ${JSON.stringify(body.errors)}`)
    for (const obj of body.result ?? []) map.set(obj.key, obj.etag?.replace(/"/g, ''))
    cursor = body.result_info?.cursor ?? ''
    if (!cursor) return map
  }
}

/* ── 收集文件 ── */
async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_FILES.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

const files = []
for (const dir of SYNC_DIRS) {
  files.push(...(await walk(join(PUBLIC, dir))))
}

function extOf(path) {
  const i = path.lastIndexOf('.')
  return i < 0 ? '' : path.slice(i).toLowerCase()
}

function cacheControlFor(key) {
  return isNoCache(key) ? 'no-cache' : 'public, max-age=31536000, immutable'
}

function contentTypeFor(key) {
  return CONTENT_TYPES[extOf(key)] ?? 'application/octet-stream'
}

async function uploadOne(job) {
  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(objectUrl(job.key), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': job.contentType,
          'Cache-Control': job.cacheControl
        },
        body: job.buffer
      })
      if (res.ok) return
      lastErr = new Error(`HTTP ${res.status} ${res.statusText} ${(await res.text()).slice(0, 200)}`)
      // 4xx（除 429）重试无意义，直接失败
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, attempt * 1000))
  }
  throw lastErr
}

/* ── 主流程 ── */
const jobs = []
let totalBytes = 0
for (const file of files) {
  const key = relative(PUBLIC, file).split('\\').join('/')
  const buffer = await readFile(file)
  const md5 = createHash('md5').update(buffer).digest('hex')
  const info = await stat(file)
  totalBytes += info.size
  jobs.push({
    key,
    file,
    buffer,
    md5,
    size: info.size,
    contentType: contentTypeFor(key),
    cacheControl: cacheControlFor(key)
  })
}

// 远端清单失败（网络/权限抖动）时退化为全量上传
const remote = force ? new Map() : await remoteEtags().catch(() => new Map())
const pending = jobs.filter((j) => remote.get(j.key) !== j.md5)
const unchanged = jobs.length - pending.length

console.log(
  `桶 ${BUCKET}（media 自定义域）｜扫描 ${jobs.length} 个文件 ${(totalBytes / 1048576).toFixed(1)}MB` +
    (unchanged ? `｜远端已一致 ${unchanged} 个` : '')
)
if (!apply) {
  for (const j of pending) {
    console.log(
      `  [dry] ${j.key} (${(j.size / 1024).toFixed(0)}KB) ${j.contentType.split(';')[0]} ← ${j.cacheControl}`
    )
  }
  console.log(`\ndry-run 完成：${pending.length} 个待上传。加 --apply 实际执行。`)
  process.exit(0)
}

let done = 0
let failed = 0
const CONCURRENCY = 8
const queue = [...pending]
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const job = queue.shift()
      if (!job) return
      try {
        await uploadOne(job)
        done++
        process.stdout.write(`\r上传 ${done}/${pending.length}  ${job.key}`)
      } catch (err) {
        failed++
        console.error(`\n失败 ${job.key}: ${err.message}`)
      }
    }
  })
)
console.log(
  failed
    ? `\n完成：成功 ${done}，失败 ${failed}（重跑本脚本可断点续传，已上传对象会跳过）`
    : `\n完成：${done} 个对象已就位。`
)
process.exit(failed ? 1 : 0)
