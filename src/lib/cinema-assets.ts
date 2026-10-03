'use client'

/**
 * 放映室媒体解析 —— 三级来源：
 * ① 浏览器 IndexedDB 的用户导入（「载入本地素材」，仅存本地）
 * ② 仓库自带的 public/cinema/ 素材（来自网络，仅作演示，侵删；HEAD 探测）
 * ③ CC0 回退：开场跳过、配乐用落地页 bgm.mp3
 * 详见 public/cinema/CREDITS.md。
 */

const DB_NAME = 'picseal-cinema'
const STORE = 'media'

export const CINEMA_MEDIA_KEYS = {
  intro: 'intro',
  music: 'music'
} as const

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadUserMedia(key: string): Promise<Blob | undefined> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      tx.onsuccess = () => resolve(tx.result instanceof Blob ? tx.result : undefined)
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    return undefined
  }
}

export async function saveUserMedia(key: string, blob: Blob): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, key)
    tx.onsuccess = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function urlExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

export interface ResolvedCinemaMedia {
  introUrl?: string
  musicUrl: string
  /** 配乐是否为 CC0 回退（非 Welcome Home） */
  musicFallback: boolean
  /** 用户导入与本地文件的 objectURL（组件卸载时统一 revoke） */
  objectUrls: string[]
}

const INTRO_BUNDLED = '/cinema/intro.mp4'
const MUSIC_BUNDLED = '/cinema/welcome-home.m4a'
const MUSIC_FALLBACK = '/audio/bgm.mp3'

export async function resolveCinemaMedia(): Promise<ResolvedCinemaMedia> {
  const objectUrls: string[] = []
  let introUrl: string | undefined
  let musicUrl: string | undefined

  const [userIntro, userMusic] = await Promise.all([
    loadUserMedia(CINEMA_MEDIA_KEYS.intro),
    loadUserMedia(CINEMA_MEDIA_KEYS.music)
  ])
  if (userIntro) {
    introUrl = URL.createObjectURL(userIntro)
    objectUrls.push(introUrl)
  } else if (await urlExists(INTRO_BUNDLED)) {
    introUrl = INTRO_BUNDLED
  }

  if (userMusic) {
    musicUrl = URL.createObjectURL(userMusic)
    objectUrls.push(musicUrl)
  } else if (await urlExists(MUSIC_BUNDLED)) {
    musicUrl = MUSIC_BUNDLED
  }

  let musicFallback = false
  if (!musicUrl) {
    musicUrl = MUSIC_FALLBACK
    musicFallback = true
  }
  return { introUrl, musicUrl, musicFallback, objectUrls }
}
