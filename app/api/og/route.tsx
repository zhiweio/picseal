import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export function GET(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#08121f',
          padding: 64
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ color: '#e9eef2', fontSize: 56, fontWeight: 700, letterSpacing: 10, margin: 0 }}>
            PICSEAL
          </p>
          <p style={{ color: '#9caabd', fontSize: 24, letterSpacing: 4, margin: 0 }}>
            影像档案终端 / PHOTO ARCHIVE
          </p>
        </div>
        <p style={{ color: '#d9ad7d', fontSize: 28, margin: 0 }}>
          你的照片，配上它的出处 — 批量 · 本地 · EXIF 保留
        </p>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
