import type { PhotoMeta, RenderOptions, WatermarkTemplate } from '../types'
import { BRANDS, DEFAULT_LOGO } from '../brands'
import { getFontFamily } from '../fonts/registry'
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
import { computeFrostedLayout } from './geometry'

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
  const fontDef = getFontFamily(template.typography.font)

  const brand = meta.brandId ? BRANDS.find((b) => b.id === meta.brandId) : undefined
  const lines = resolveAllLines(template, { meta, brand })
  if (lines.allText.some(needsCjk)) await input.fonts.ensureFamily(fontDef.id, true)
  else await input.fonts.ensureFamily(fontDef.id, false)

  const hasBannerStrip =
    template.layout === 'banner' ||
    (template.layout === 'card' && template.canvas.mount !== 'blur')
  const wantsLogo =
    (hasBannerStrip && template.banner.logo.enabled) || template.layout === 'center-logo'
  const logoUrl = wantsLogo ? (brand?.logo ?? DEFAULT_LOGO) : undefined
  const centerLogoUrl =
    template.layout === 'center-logo' ? (brand?.logoOnDark ?? brand?.logo ?? DEFAULT_LOGO) : undefined
  const logo = logoUrl ? ((await input.logoBook.get(logoUrl)) ?? null) : null
  const centerLogo = centerLogoUrl ? ((await input.logoBook.get(centerLogoUrl)) ?? null) : null

  const geometry = computeGeometry(photo, template)
  const s = computeScale(geometry, options.maxLongEdge)
  const g = scaleGeometry(geometry, s)

  const canvas = makeCanvas(g.width, g.height)
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D

  const typography = {
    family: fontDef.id,
    mainWeight: fontDef.mainWeight,
    subWeight: fontDef.subWeight,
    scale: template.typography.scale
  }

  switch (template.layout) {
    case 'banner':
      drawFlatWithBanner(ctx, photo, template, lines, logo, g, typography)
      break
    case 'card':
      if (template.canvas.mount === 'blur') {
        drawFrostedCard(ctx, photo, template, lines, g, s, typography)
      } else {
        drawMountedCard(ctx, photo, template, lines, logo, g, typography)
      }
      break
    case 'corner':
      drawFlatWithCorner(ctx, photo, template, lines, g, typography)
      break
    case 'center-logo':
      drawFlatWithCenterLogo(ctx, photo, template, lines, g, centerLogo, typography)
      break
  }

  return canvas
}

type Typography = {
  family: ReturnType<typeof getFontFamily>['id']
  mainWeight: number
  subWeight: number
  scale: number
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
    const bannerH = pH * template.banner.heightRatio * template.typography.scale
    return extendToAspect(
      { width: pW, height: pH + bannerH, photoRect: { x: 0, y: 0, w: pW, h: pH } },
      aspect,
      canvas.mountColor
    )
  }

  if (template.layout === 'card') {
    if (canvas.mount === 'blur') {
      // 雾面卡片：裁切 135%（含文字列），画幅跟随原图；显式比例时居中补边
      return extendToAspect(
        { width: pW * 1.35, height: pH * 1.35, photoRect: { x: 0, y: 0, w: pW, h: pH } },
        aspect,
        canvas.mountColor
      )
    }
    const m = pW * canvas.margin
    const bannerH = pH * template.banner.heightRatio * template.typography.scale
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
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = shadowPx
    ctx.shadowOffsetY = shadowPx * 0.25
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

/** 横幅条带：紧贴照片下方；高度唯一来源（含 typography.scale） */
function bannerStripRect(g: RenderedGeometry, t: WatermarkTemplate) {
  return {
    x: g.photoRect.x,
    y: g.photoRect.y + g.photoRect.h,
    w: g.photoRect.w,
    h: g.photoRect.h * t.banner.heightRatio * t.typography.scale
  }
}

function drawFlatWithBanner(
  ctx: Ctx2D,
  photo: ImageBitmap,
  t: WatermarkTemplate,
  lines: ResolvedLines,
  logo: ImageBitmap | null,
  g: RenderedGeometry,
  typography: Typography
): void {
  fillBackdrop(ctx, g, t.canvas.mountColor)
  const radius = g.width * t.canvas.cornerRadius
  drawPhotoRounded(ctx, photo, g.photoRect, radius, 0)
  if (!lines.bannerEmpty) {
    drawBannerStrip(
      ctx,
      bannerStripRect(g, t),
      lines.banner,
      {
        banner: t.banner,
        family: typography.family,
        mainWeight: typography.mainWeight,
        subWeight: typography.subWeight,
        logo
      }
    )
  }
}

function drawMountedCard(
  ctx: Ctx2D,
  photo: ImageBitmap,
  t: WatermarkTemplate,
  lines: ResolvedLines,
  logo: ImageBitmap | null,
  g: RenderedGeometry,
  typography: Typography
): void {
  fillBackdrop(ctx, g, t.canvas.mountColor)
  const radius = g.width * t.canvas.cornerRadius
  drawPhotoRounded(ctx, photo, g.photoRect, radius, t.canvas.shadow ? g.width * 0.012 : 0)
  if (!lines.bannerEmpty) {
    drawBannerStrip(
      ctx,
      bannerStripRect(g, t),
      lines.banner,
      {
        banner: t.banner,
        family: typography.family,
        mainWeight: typography.mainWeight,
        subWeight: typography.subWeight,
        logo,
        transparentBg: true
      }
    )
  }
}

/**
 * 雾面卡片 —— blur.json 管线的 Canvas 移植：
 * 清晰照片（圆角+投影）居中，机型/参数文字在其下方，
 * 整体叠于 2× 放大的模糊背景上，画布即 135% 裁切结果。
 * computeFrostedLayout 契约：入参为未缩放照片像素，绘制时统一乘 s（仅一次）；
 * 画幅被 extendToAspect 扩展时，135% 构图在最终画布内整体居中。
 */
function drawFrostedCard(
  ctx: Ctx2D,
  photo: ImageBitmap,
  t: WatermarkTemplate,
  lines: ResolvedLines,
  g: RenderedGeometry,
  s: number,
  typography: Typography
): void {
  const model = lines.centerTitle || lines.centerCaption
  const params = lines.centerCaption !== model ? lines.centerCaption : ''
  const layout = computeFrostedLayout(photo.width, photo.height, !!model, !!params, {
    radiusRatio: t.canvas.cornerRadius > 0 ? t.canvas.cornerRadius : 0.02
  })

  const S = (v: number) => v * s
  // 135% 构图在最终画布中的居中偏移（比例扩展产生的补边由底色填充）
  const dx = (g.width - layout.out.w * s) / 2
  const dy = (g.height - layout.out.h * s) / 2

  fillBackdrop(ctx, g, t.canvas.mountColor)

  // 1. 背景：2× 放大的模糊原图（ctx.filter 不可用时降采样回退）
  ctx.save()
  ctx.translate(dx, dy)
  const blurPx = Math.max(2, g.photoRect.h * 0.05)
  if (supportsFilter(ctx)) {
    ctx.filter = `blur(${blurPx}px)`
    ctx.drawImage(
      photo,
      S(layout.backdrop.x),
      S(layout.backdrop.y),
      S(layout.backdrop.w),
      S(layout.backdrop.h)
    )
    ctx.filter = 'none'
  } else {
    const tinyW = Math.max(8, Math.round(g.photoRect.w / 40))
    const tiny = new OffscreenCanvas(tinyW, Math.max(8, Math.round((tinyW * photo.height) / photo.width)))
    const tctx = tiny.getContext('2d')!
    tctx.drawImage(photo, 0, 0, tiny.width, tiny.height)
    ctx.drawImage(tiny, S(layout.backdrop.x), S(layout.backdrop.y), S(layout.backdrop.w), S(layout.backdrop.h))
  }
  ctx.restore()

  // 2. 清晰照片：圆角 + 投影，居中
  const photoRect = {
    x: dx + S(layout.photo.x),
    y: dy + S(layout.photo.y),
    w: S(layout.photo.w),
    h: S(layout.photo.h)
  }
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = Math.max(2, g.photoRect.h * 0.02)
  ctx.fillStyle = '#000'
  roundedRectPath(ctx, photoRect.x, photoRect.y, photoRect.w, photoRect.h, S(layout.radius))
  ctx.fill()
  ctx.shadowColor = 'transparent'
  roundedRectPath(ctx, photoRect.x, photoRect.y, photoRect.w, photoRect.h, S(layout.radius))
  ctx.clip()
  ctx.drawImage(photo, photoRect.x, photoRect.y, photoRect.w, photoRect.h)
  ctx.restore()

  // 3. 文字列（照片下方）
  drawCenterStack(
    ctx,
    g.width / 2,
    dy + S(layout.modelY),
    dy + S(layout.paramsY),
    model,
    params,
    {
      family: typography.family,
      mainWeight: typography.mainWeight,
      subWeight: typography.subWeight,
      modelH: S(layout.modelH),
      paramsH: S(layout.paramsH),
      markColor: t.typography.markColor
    }
  )
}

function drawFlatWithCorner(
  ctx: Ctx2D,
  photo: ImageBitmap,
  t: WatermarkTemplate,
  lines: ResolvedLines,
  g: RenderedGeometry,
  typography: Typography
): void {
  fillBackdrop(ctx, g, t.canvas.mountColor)
  const radius = g.width * t.canvas.cornerRadius
  drawPhotoRounded(ctx, photo, g.photoRect, radius, 0)
  drawCorner(
    ctx,
    g.width,
    g.height,
    lines.corner,
    t.corner,
    typography.family,
    typography.scale,
    typography.mainWeight,
    typography.subWeight
  )
}

function drawFlatWithCenterLogo(
  ctx: Ctx2D,
  photo: ImageBitmap,
  t: WatermarkTemplate,
  lines: ResolvedLines,
  g: RenderedGeometry,
  logo: ImageBitmap | null,
  typography: Typography
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
    typography.family,
    typography.scale,
    typography.subWeight,
    t.typography.markColor
  )
}

function supportsFilter(ctx: Ctx2D): boolean {
  return typeof (ctx as OffscreenCanvasRenderingContext2D).filter === 'string'
}
