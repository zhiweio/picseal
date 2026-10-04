/**
 * 个人档案馆（landing 作品集上墙）纯逻辑：入馆门槛、文件过滤、迷你墙格位、鼓励语分档。
 * 零依赖、零 DOM，node 环境可直测；File 由 stores/portfolio.ts 入库（缩略图 + EXIF，仅本地）。
 */

/** 入馆门槛：收录满该数量才允许用用户作品替换档案墙 */
export const PORTFOLIO_THRESHOLD = 120

/** 档案墙格位上限（9 lanes × 48 rows，与 HeroWall 的 WALL_CAPACITY 一致） */
export const PORTFOLIO_WALL_CAP = 432

/** 迷你墙：9 列 × 4 行，呼应档案墙 POOL_LANES = 9；行主序即墙面格位顺序 */
export const MINI_WALL_COLS = 9
export const MINI_WALL_ROWS = 4
export const MINI_WALL_SLOTS = MINI_WALL_COLS * MINI_WALL_ROWS

/** 与 src/stores/photos.ts 的 SUPPORTED_EXT 同源的白名单（landing 不引 store 依赖，单独维护） */
const SUPPORTED_EXT = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'avif',
  'heic',
  'heif',
  'hif',
  'tif',
  'tiff'
])

export function isSupportedImageName(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return ext.length > 0 && SUPPORTED_EXT.has(ext)
}

export function dedupeKeyOf(file: { name: string; size: number }): string {
  return `${file.name}:${file.size}`
}

export interface PortfolioFileVerdict<T extends { name: string; size: number }> {
  accepted: T[]
  /** 非支持图片格式被跳过的数量 */
  skipped: number
  /** 与已有收录或本批内重复（name + size）的数量 */
  duplicates: number
}

/** 只依赖 name/size 结构，泛型保留传入元素的原类型（File 等） */
export function filterPortfolioFiles<T extends { name: string; size: number }>(
  files: Iterable<T>,
  existingKeys: Iterable<string> = []
): PortfolioFileVerdict<T> {
  const seen = new Set(existingKeys)
  const accepted: T[] = []
  let skipped = 0
  let duplicates = 0
  for (const file of files) {
    if (!isSupportedImageName(file.name)) {
      skipped += 1
      continue
    }
    const key = dedupeKeyOf(file)
    if (seen.has(key)) {
      duplicates += 1
      continue
    }
    seen.add(key)
    accepted.push(file)
  }
  return { accepted, skipped, duplicates }
}

/* ── 鼓励语：按进度分档，同档内逐次轮换 ──
   返回值对应 messages 的 landing.archive.encourage{n}（n 从 1 起） */

export type ProgressTier = 'start' | 'mid' | 'sprint'

const TIER_POOLS: Record<ProgressTier, number[]> = {
  start: [1, 2],
  mid: [3, 4, 5],
  sprint: [6, 7]
}

export function progressTier(count: number): ProgressTier {
  const ratio = count / PORTFOLIO_THRESHOLD
  if (ratio < 0.3) return 'start'
  if (ratio < 0.75) return 'mid'
  return 'sprint'
}

/** attemptSeq 为本次会话内被拒次数（0 起始），同档内逐次轮换 */
export function encouragementIndex(count: number, attemptSeq: number): number {
  const pool = TIER_POOLS[progressTier(count)]!
  return pool[((attemptSeq % pool.length) + pool.length) % pool.length]!
}

/** 迷你墙实格数（其余为幽灵格） */
export function miniWallFilled(count: number): number {
  return Math.min(count, MINI_WALL_SLOTS)
}

export function isAdmissible(count: number): boolean {
  return count >= PORTFOLIO_THRESHOLD
}
