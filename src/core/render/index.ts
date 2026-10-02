import type { PhotoMeta, RenderOptions, WatermarkTemplate } from '../types'
import { BRANDS, DEFAULT_LOGO } from '../brands'
import { drawBannerStrip, type BannerLines } from './banner'
import {
  FontBook,
  LogoBook,
  parseAspectRatio,
  roundedRectPath,
  type Ctx2D
} from './canvas-utils'
import { needsCjk, resolveField } from './fields'
import { drawCenterLogo, drawCenterStack, drawCorner, drawMount } from './overlay'

export interface RenderInput {
  photo: ImageBitmap
  meta: PhotoMeta
  template: WatermarkTemplate
  logoBook: LogoBook
  fonts: FontBook
  options: RenderOptions
}

export interface RenderedGeometry {
  width: number
  height: number
  photoRect: { x: number; y: number; w: number; h: number }
}

/**
 * 水印渲染入口 —— 输入已按 EXIF 方向摆正的位图，输出合成后的 OffscreenCanvas。
 * 纯 Canvas API，无 DOM 依赖；worker 与主线程均可运行。
 */
export async function renderPhoto(input: RenderInput): Promise<OffscreenCanvas> {
  const { photo, meta, template, options } = input
  await input.fonts.ensureBase()

  const brand = meta.brandId ? BRANDS.find((b) => b.id === meta.brandId) : undefined
  const lines = resolveAllLines(template, { meta, brand })
  if (lines.allText.some(needsCjk)) await input.fonts.ensureCjk()

  const hasBannerStrip =
    template.layout === 'banner' ||
    (template.layout === 'card' && template.canvas.mount !== 'blur')
  const wantsLogo =
    (hasBannerStrip && template.banner.logo.enabled) || template.layout === 'center-logo'
  const logoUrl = wantsLogo ? (brand?.logo ?? DEFAULT_LOGO) : undefined
  const centerLogoUrl =
    template.layout === 'center-logo' ? (brand?.logoOnDark ?? brand?.logo ?? DEFAULT_LOGO) : undefined
  const logo = logoUrl ? ((await input.logoBook.get(logoUrl)) ?? null) : null
  const centerLogo = centerLogoUrl
    ? ((await input.logoBook.get(centerLogoUrl)) ?? null)
    : null

  const geometry = computeGeometry(photo, template)
  const s = computeScale(geometry, options.maxLongEdge)
  const g = scaleGeometry(geometry, s)

  const canvas = makeCanvas(g.width, g.height)
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D

  switch (template.layout) {
    case 'banner':
      drawFlatWithBanner(ctx, photo, template, lines, logo, g)
      break
    case 'card':
      if (template.canvas.mount === 'blur') {
        await drawFrostedCard(ctx, photo, template, lines, g)
      } else {
        drawMountedCard(ctx, photo, template, lines, logo, g)
      }
      break
    case 'corner':
      drawFlatWithCorner(ctx, photo, template, lines, g)
      break
    case 'center-logo':
      drawFlatWithCenterLogo(ctx, photo, template, lines, g, centerLogo)
      break
  }

  return canvas
}

type ResolvedLines = {
  banner: BannerLines
  bannerEmpty: boolean
  corner: string[]
  centerTitle: string
  centerCaption: string
  allText: string[]
}

function resolveAllLines(
  template: WatermarkTemplate,
  fieldCtx: Parameters<typeof resolveField>[1]
): ResolvedLines {
  const b = template.banner
  const banner: BannerLines = {
    leftTop: b.leftTop.enabled ? resolveField(b.leftTop.content, fieldCtx) : '',
    leftBottom: b.leftBottom.enabled ? resolveField(b.leftBottom.content, fieldCtx) : '',
    rightTop: b.rightTop.enabled ? resolveField(b.rightTop.content, fieldCtx) : '',
    rightBottom: b.rightBottom.enabled ? resolveField(b.rightBottom.content, fieldCtx) : ''
  }
  const bannerEmpty =
    !banner.leftTop && !banner.leftBottom && !banner.rightTop && !banner.rightBottom

  const corner = template.corner.lines
    .filter((l) => l.enabled)
    .map((l) => resolveField(l.content, fieldCtx).trim())
    .filter((t) => t.length > 0)

  const centerTitle = template.center.title.enabled
    ? resolveField(template.center.title.content, fieldCtx)
    : ''
  const centerCaption = template.center.caption.enabled
    ? resolveField(template.center.caption.content, fieldCtx)
    : ''

  return {
    banner,
    bannerEmpty,
    corner,
    centerTitle,
    centerCaption,
    allText: [
      banner.leftTop,
      banner.leftBottom,
      banner.rightTop,
      banner.rightBottom,
      ...corner,
      centerTitle,
      centerCaption
    ]
  }
}

/* ───────────────────────── 几何计算 ───────────────────────── */

function computeGeometry(photo: ImageBitmap, template: WatermarkTemplate): RenderedGeometry {
  const pW = photo.width
  const pH = photo.height
  const { canvas } = template
  const aspect = parseAspectRatio(canvas.aspectRatio)

  if (template.layout === 'banner') {
    const bannerH = pW * template.banner.heightRatio
    return extendToAspect(
      { width: pW, height: pH + bannerH, photoRect: { x: 0, y: 0, w: pW, h: pH } },
      aspect,
      canvas.mountColor
    )
  }

  if (template.layout === 'card') {
    if (canvas.mount === 'blur') {
      const radius = pW * canvas.cornerRadius
      void radius
      // 雾面卡片：外框按画幅比例，照片作为模糊背景 cover
      const target = aspect ?? pW / pH
      let w = pW
      let h = pW / target
      if (h < pH) {
        h = pH
        w = pH * target
      }
      return { width: w, height: h, photoRect: { x: 0, y: 0, w, h } }
    }
    const m = pW * canvas.margin
    const bannerH = pW * template.banner.heightRatio
    return extendToAspect(
      {
        width: pW + m * 2,
        height: pH + m * 2 + bannerH,
        photoRect: { x: m, y: m, w: pW, h: pH }
      },
      aspect,
      canvas.mountColor
    )
  }

  // corner / center-logo：纯叠加
  return extendToAspect(
    { width: pW, height: pH, photoRect: { x: 0, y: 0, w: pW, h: pH } },
    aspect,
    canvas.mountColor
  )
}

/** 宽高比归一化：内容居中，不足的方向补底色（semi-utils margin_with_ratio 策略） */
function extendToAspect(
  geo: RenderedGeometry,
  aspect: number | undefined,
  _fill: string
): RenderedGeometry {
  if (!aspect) return geo
  const current = geo.width / geo.height
  if (Math.abs(current - aspect) < 0.001) return geo
  if (current > aspect) {
    const h = geo.width / aspect
    const dy = (h - geo.height) / 2
    return {
      width: geo.width,
      height: h,
      photoRect: { ...geo.photoRect, y: geo.photoRect.y + dy }
    }
  }
  const w = geo.height * aspect
  const dx = (w - geo.width) / 2
  return {
    width: w,
    height: geo.height,
    photoRect: { ...geo.photoRect, x: geo.photoRect.x + dx }
  }
}

function computeScale(geo: RenderedGeometry, maxLongEdge: number): number {
  if (!maxLongEdge) return 1
  const long = Math.max(geo.width, geo.height)
  return Math.min(1, maxLongEdge / long)
}

function scaleGeometry(geo: RenderedGeometry, s: number): RenderedGeometry {
  return {
    width: Math.round(geo.width * s),
    height: Math.round(geo.height * s),
    photoRect: {
      x: geo.photoRect.x * s,
      y: geo.photoRect.y * s,
      w: geo.photoRect.w * s,
      h: geo.photoRect.h * s
    }
  }
}

function makeCanvas(w: number, h: number): OffscreenCanvas {
  return new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)))
}

/* ───────────────────────── 各布局绘制 ───────────────────────── */

function fillBackdrop(ctx: Ctx2D, g: RenderedGeometry, color: string): void {
  ctx.fillStyle = color
  ctx.fillRect(0, 0, g.width, g.height)
}

function drawPhotoRounded(
  ctx: Ctx2D,
  photo: ImageBitmap,
  rect: RenderedGeometry['photoRect'],
  radius: number,
  shadowPx: number
): void {
  ctx.save()
  if (shadowPx > 0) {
    ctx.shadowColor = 'rgba(0,0,0,0.3)'
    ctx.shadowBlur = shadowPx
    ctx.shadowOffsetY = shadowPx * 0.3
  }
  if (radius > 0) {
    roundedRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius)
    ctx.fillStyle = '#000'
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.clip()
  }
  ctx.drawImage(photo, rect.x, rect.y, rect.w, rect.h)
  ctx.restore()
}

function bannerStripRect(g: RenderedGeometry, t: WatermarkTemplate) {
  return {
    x: g.photoRect.x,
    y: g.photoRect.y + g.photoRect.h,
    w: g.photoRect.w,
    h: g.photoRect.w * t.banner.heightRatio
  }
}

function drawFlatWithBanner(
  ctx: Ctx2D,
  photo: ImageBitmap,
  t: WatermarkTemplate,
  lines: ResolvedLines,
  logo: ImageBitmap | null,
  g: RenderedGeometry
): void {
  fillBackdrop(ctx, g, t.canvas.mountColor)
  const radius = g.width * t.canvas.cornerRadius
  drawPhotoRounded(ctx, photo, g.photoRect, radius, 0)
  if (!lines.bannerEmpty) {
    drawBannerStrip(
      ctx,
      bannerStripRect(g, t),
      lines.banner,
      { banner: t.banner, typographyScale: t.typography.scale, logo }
    )
  }
}

function drawMountedCard(
  ctx: Ctx2D,
  photo: ImageBitmap,
  t: WatermarkTemplate,
  lines: ResolvedLines,
  logo: ImageBitmap | null,
  g: RenderedGeometry
): void {
  fillBackdrop(ctx, g, t.canvas.mountColor)
  const radius = g.width * t.canvas.cornerRadius
  drawPhotoRounded(ctx, photo, g.photoRect, radius, t.canvas.shadow ? g.width * 0.012 : 0)
  if (!lines.bannerEmpty) {
    drawBannerStrip(
      ctx,
      bannerStripRect(g, t),
      lines.banner,
      { banner: t.banner, typographyScale: t.typography.scale, logo, transparentBg: true }
    )
  }
}

async function drawFrostedCard(
  ctx: Ctx2D,
  photo: ImageBitmap,
  t: WatermarkTemplate,
  lines: ResolvedLines,
  g: RenderedGeometry
): Promise<void> {
  const radius = g.width * t.canvas.cornerRadius

  if (t.canvas.shadow) {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = g.width * 0.015
    ctx.shadowOffsetY = g.width * 0.006
    ctx.fillStyle = '#111'
    roundedRectPath(ctx, 0, 0, g.width, g.height, radius)
    ctx.fill()
    ctx.restore()
  }

  ctx.save()
  roundedRectPath(ctx, 0, 0, g.width, g.height, radius)
  ctx.clip()

  // 背景：cover 放大 + 高斯模糊（ctx.filter 不可用时用缩放回退）
  const cover = coverRect(photo.width, photo.height, g.width, g.height)
  ctx.imageSmoothingEnabled = true
  const blurPx = g.width * 0.02
  if (supportsFilter(ctx)) {
    ctx.filter = `blur(${blurPx}px)`
    ctx.drawImage(photo, cover.x, cover.y, cover.w, cover.h)
    ctx.filter = 'none'
  } else {
    const tiny = Math.max(8, Math.round(g.width / 48))
    const tmp = new OffscreenCanvas(tiny, Math.round((tiny * photo.height) / photo.width))
    const tctx = tmp.getContext('2d')!
    tctx.drawImage(photo, 0, 0, tmp.width, tmp.height)
    ctx.drawImage(tmp, cover.x, cover.y, cover.w, cover.h)
  }
  // 轻压暗保证文字对比
  ctx.fillStyle = 'rgba(0,0,0,0.16)'
  ctx.fillRect(0, 0, g.width, g.height)
  ctx.restore()

  const title = lines.centerTitle || lines.centerCaption
  const caption = lines.centerCaption !== title ? lines.centerCaption : ''
  drawCenterStack(ctx, g.width, g.height, title, caption, {
    scale: t.typography.scale,
    markColor: t.typography.markColor
  })
}

function drawFlatWithCorner(
  ctx: Ctx2D,
  photo: ImageBitmap,
  t: WatermarkTemplate,
  lines: ResolvedLines,
  g: RenderedGeometry
): void {
  fillBackdrop(ctx, g, t.canvas.mountColor)
  const radius = g.width * t.canvas.cornerRadius
  drawPhotoRounded(ctx, photo, g.photoRect, radius, 0)
  drawCorner(ctx, g.width, g.height, lines.corner, t.corner, t.typography.scale)
}

function drawFlatWithCenterLogo(
  ctx: Ctx2D,
  photo: ImageBitmap,
  t: WatermarkTemplate,
  lines: ResolvedLines,
  g: RenderedGeometry,
  logo: ImageBitmap | null
): void {
  fillBackdrop(ctx, g, t.canvas.mountColor)
  const radius = g.width * t.canvas.cornerRadius
  drawPhotoRounded(ctx, photo, g.photoRect, radius, 0)
  drawCenterLogo(
    ctx,
    g.width,
    g.height,
    logo,
    lines.centerCaption,
    t.center,
    t.typography.scale,
    t.typography.markColor
  )
}

function coverRect(srcW: number, srcH: number, dstW: number, dstH: number) {
  const scale = Math.max(dstW / srcW, dstH / srcH)
  const w = srcW * scale
  const h = srcH * scale
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h }
}

function supportsFilter(ctx: Ctx2D): boolean {
  return typeof (ctx as OffscreenCanvasRenderingContext2D).filter === 'string'
}
