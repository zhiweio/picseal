import { describe, expect, it } from 'vitest'
import { BUILTIN_TEMPLATES } from '../core/templates/builtin'
import { abOverlayStyle } from './ab-overlay'

const tpl = (id: string) => {
  const t = BUILTIN_TEMPLATES.find((x) => x.id === id)
  if (!t) throw new Error(`template not found: ${id}`)
  return t
}

describe('abOverlayStyle（A/B 原图层按 photoRect 对位）', () => {
  it('banner：照片区 = 顶部满宽，横幅条不设原图；圆角为 0', () => {
    // 照片 6000×4000 + 10% 横幅 → 画布 6000×4400
    const s = abOverlayStyle(
      { width: 6000, height: 4400, photoRect: { x: 0, y: 0, w: 6000, h: 4000 } },
      55,
      tpl('banner')
    )
    expect(s.left).toBe('0%')
    expect(s.top).toBe('0%')
    expect(s.width).toBe('100%')
    expect(s.height).toBe('90.9091%')
    expect(s.clipPath).toBe('inset(0 0 0 55%)')
    expect(s.borderRadius).toBe('0px')
    expect(s.objectFit).toBe('fill')
  })

  it('card-shadow：原图落在装裱白边内，圆角 = 比例 × 画布宽', () => {
    // margin 3.2% → m=192；画布 6384×(192+4000+192+400)=6384×4784
    const s = abOverlayStyle(
      { width: 6384, height: 4784, photoRect: { x: 192, y: 192, w: 6000, h: 4000 } },
      50,
      tpl('card-shadow')
    )
    expect(s.left).toBe('3.0075%')
    expect(s.top).toBe('4.0134%')
    expect(s.clipPath).toBe('inset(0 0 0 50%)')
    expect(s.borderRadius).toBe('76.608px')
  })

  it('card-blur：原图落在 135% 构图内居中的清晰照片上，圆角 = 比例 × 照片高', () => {
    // 6000×4000 → 画布 8100×5400；文字列使清晰照片上移，photoRect 非整幅
    const s = abOverlayStyle(
      { width: 8100, height: 5400, photoRect: { x: 1050, y: 400, w: 6000, h: 4000 } },
      30,
      tpl('card-blur')
    )
    expect(s.left).toBe('12.963%')
    expect(s.width).toBe('74.0741%')
    expect(s.clipPath).toBe('inset(0 0 0 23%)')
    expect(s.borderRadius).toBe('80px')
  })

  it('center-logo：原图避开细白边与底部 logo 白带', () => {
    // thin = 2% 照片高 = 80；画布 6160×(80+4000+480)=6160×4560
    const s = abOverlayStyle(
      { width: 6160, height: 4560, photoRect: { x: 80, y: 80, w: 6000, h: 4000 } },
      55,
      tpl('center-logo')
    )
    expect(s.left).toBe('1.2987%')
    expect(s.top).toBe('1.7544%')
    expect(s.width).toBe('97.4026%')
    expect(s.height).toBe('87.7193%')
  })

  it('corner：画布 = 照片尺寸，图层满幅、裁切等于分割线（回归）', () => {
    const s = abOverlayStyle(
      { width: 6000, height: 4000, photoRect: { x: 0, y: 0, w: 6000, h: 4000 } },
      55,
      tpl('corner-minimal')
    )
    expect(s.left).toBe('0%')
    expect(s.top).toBe('0%')
    expect(s.width).toBe('100%')
    expect(s.height).toBe('100%')
    expect(s.clipPath).toBe('inset(0 0 0 55%)')
  })

  it('画幅补边（pillarbox）：分割线在照片区左侧时原图整体可见', () => {
    // 照片 4000×3000 + 横幅 300 → 内容 4000×3300，补边到 1.5 → 画布 4950×3300
    const box = { width: 4950, height: 3300, photoRect: { x: 475, y: 0, w: 4000, h: 3000 } }
    const atStart = abOverlayStyle(box, 2, tpl('banner'))
    expect(atStart.clipPath).toBe('inset(0 0 0 0%)')
    const atEnd = abOverlayStyle(box, 98, tpl('banner'))
    expect(atEnd.clipPath).toBe('inset(0 0 0 100%)')
    const mid = abOverlayStyle(box, 50, tpl('banner'))
    // (0.5×4950 − 475) / 4000 = 50%
    expect(mid.clipPath).toBe('inset(0 0 0 50%)')
  })

  it('画幅补边（letterbox）：top 随 photoRect 下移', () => {
    // 照片 6000×4000 + 横幅 600 → 内容 6000×4600，补边到 1:1 → 画布 6000×6000
    const s = abOverlayStyle(
      { width: 6000, height: 6000, photoRect: { x: 0, y: 1000, w: 6000, h: 4000 } },
      55,
      tpl('banner')
    )
    expect(s.top).toBe('16.6667%')
    expect(s.height).toBe('66.6667%')
  })

  it('全部内置模板：输出均为合法百分比且无 NaN', () => {
    const box = { width: 6000, height: 4600, photoRect: { x: 0, y: 0, w: 6000, h: 4000 } }
    for (const t of BUILTIN_TEMPLATES) {
      for (const compare of [2, 50, 98]) {
        const s = abOverlayStyle(box, compare, t)
        for (const v of [s.left, s.top, s.width, s.height]) {
          const n = Number.parseFloat(v)
          expect(n).toBeGreaterThanOrEqual(0)
          expect(n).toBeLessThanOrEqual(100)
          expect(Number.isNaN(n)).toBe(false)
        }
        const inset = Number.parseFloat(s.clipPath.replace('inset(0 0 0 ', '').replace('%)', ''))
        expect(inset).toBeGreaterThanOrEqual(0)
        expect(inset).toBeLessThanOrEqual(100)
      }
    }
  })
})
