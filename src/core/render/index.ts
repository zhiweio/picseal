import type { FieldSlot, PhotoMeta, RenderOptions, WatermarkTemplate } from '../types'
import { BRANDS, DEFAULT_LOGO } from '../brands'
import { getFontFamily, MARK_SYMBOL_FONT, DEFAULT_FONT, type FontFamilyId } from '../fonts/registry'
import { drawBannerStrip, solveBannerHeight, type BannerLines, type BannerSlotStyles } from './banner'
import {
  FontBook,
  LogoBook,
  drawImageSmoothed,
  ensureContrastColor,
  parseAspectRatio,
  roundedRectPath,
  sampleLuminance,
  type Ctx2D
} from './canvas-utils'
import { needsCjk, resolveField } from './fields'
import { drawCenterStack, drawCorner, drawMount } from './overlay'
import { computeFrostedLayout } from './geometry'
import { resolveSlotStyle, type ResolvedRowStyle } from './slot-style'

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

export interface RenderedOutput {
  canvas: OffscreenCanvas
  /** 照片在输出画布中的实际绘制矩形（canvas 像素），供 A/B 原图层对位 */
  photoRect: RenderedGeometry['photoRect']
}

/**
 * 水印渲染入口 —— 输入已按 EXIF 方向摆正的位图，输出合成后的 OffscreenCanvas。
 * 纯 Canvas API，无 DOM 依赖；worker 与主线程均可运行。
 */
export async function renderPhoto(input: RenderInput): Promise<RenderedOutput> {
  const { photo, meta, template, options } = input
  // 尼康 Z 符号字体是品牌锁定字形（仅 markSegments 消费），任何情况下不得作为正文字体——
  // 预设手改 typography.font 指向符号家族时回退默认字体
  const rawFontDef = getFontFamily(template.typography.font)
  const fontDef = rawFontDef.group === 'symbol' ? getFontFamily(DEFAULT_FONT) : rawFontDef

  const brand = meta.brandId ? BRANDS.find((b) => b.id === meta.brandId) : undefined
  const lines = resolveAllLines(template, { meta, brand })

  // Z 字形门控（R-04/R-12）：仅尼康 Z 系机型使用官方特殊 Z 字形；
  // markColor（红）仅在模板声明时叠加，横幅白底默认正文色（尼康官方风）
  const nikonZ = brand?.id === 'nikon' && /\bZ/i.test(meta.modelPretty ?? '')
  const markColor = nikonZ ? template.typography.markColor : undefined
  const zMark = nikonZ ? { color: template.typography.markColor, family: MARK_SYMBOL_FONT.id } : undefined
  // 符号字体加载失败不阻断渲染：Z 退回正文字体呈现
  if (nikonZ) {
    await input.fonts.ensureUrl(MARK_SYMBOL_FONT.cssName, MARK_SYMBOL_FONT.file).catch((err: unknown) => {
      console.warn('[picseal] Z symbol font load failed, Z falls back to body font:', err)
    })
  }

  const hasBannerStrip =
    template.layout === 'banner' ||
    template.layout === 'center-logo' ||
    (template.layout === 'card' && template.canvas.mount !== 'blur')
  const wantsLogo =
    (hasBannerStrip && template.banner.logo.enabled) || template.layout === 'center-logo'
  const logoUrl = wantsLogo ? (brand?.logo ?? DEFAULT_LOGO) : undefined
  const centerLogoUrl =
    template.layout === 'center-logo' ? (brand?.logoOnDark ?? brand?.logo ?? DEFAULT_LOGO) : undefined
  const logo = logoUrl ? ((await input.logoBook.get(logoUrl)) ?? null) : null
  const centerLogo = centerLogoUrl ? ((await input.logoBook.get(centerLogoUrl)) ?? null) : null

  // ── 槽位样式解析（高级字体覆写）：活跃槽位逐行合并默认，收集涉及家族统一加载 ──
  // familyCjk：家族 → 该家族实际渲染的文本是否需要 CJK 子集（避免跨家族超取多 MB 子集）
  const familyCjk = new Map<FontFamilyId, boolean>()
  const noteFamily = (fam: FontFamilyId, text: string) => {
    familyCjk.set(fam, (familyCjk.get(fam) ?? false) || needsCjk(text))
  }
  let bannerSlotStyles: BannerSlotStyles | undefined
  let cornerLineStyles: ResolvedRowStyle[] | undefined
  let modelStyle: ResolvedRowStyle | undefined
  let paramsStyle: ResolvedRowStyle | undefined

  if (hasBannerStrip && !lines.bannerEmpty) {
    const mk = (slot: FieldSlot, text: string, weight: number, color: string) => {
      if (!text) return undefined
      const r = resolveSlotStyle(slot, { family: fontDef.id, weight, color })
      noteFamily(r.family, text)
      return r
    }
    bannerSlotStyles = {
      leftTop: mk(
        template.banner.leftTop,
        lines.banner.leftTop,
        fontDef.mainWeight,
        template.banner.textColor
      ),
      leftBottom: mk(
        template.banner.leftBottom,
        lines.banner.leftBottom,
        fontDef.subWeight,
        template.banner.subColor
      ),
      rightTop: mk(
        template.banner.rightTop,
        lines.banner.rightTop,
        fontDef.mainWeight,
        template.banner.textColor
      ),
      rightBottom: mk(
        template.banner.rightBottom,
        lines.banner.rightBottom,
        fontDef.subWeight,
        template.banner.subColor
      )
    }
  }

  if (template.layout === 'corner') {
    const top = (i: number) => i === 0 && !template.corner.allSub
    cornerLineStyles = []
    lines.cornerSlots.forEach((slot, i) => {
      const r = resolveSlotStyle(slot, {
        family: fontDef.id,
        weight: top(i) ? fontDef.mainWeight : fontDef.subWeight,
        color: top(i) ? template.corner.color : template.corner.subColor
      })
      noteFamily(r.family, lines.corner[i] ?? '')
      cornerLineStyles!.push(r)
    })
  }

  if (template.layout === 'card' && template.canvas.mount === 'blur') {
    if (lines.centerTitle) {
      modelStyle = resolveSlotStyle(template.center.title, {
        family: fontDef.id,
        weight: fontDef.mainWeight,
        color: '#ffffff'
      })
      noteFamily(modelStyle.family, lines.centerTitle)
    }
    if (lines.centerCaption) {
      paramsStyle = resolveSlotStyle(template.center.caption, {
        family: fontDef.id,
        weight: fontDef.subWeight,
        color: '#ffffff'
      })
      noteFamily(paramsStyle.family, lines.centerCaption)
    }
  }

  // 全局家族先行加载（槽位字体的回退目标）；字体加载失败不阻断渲染（A11）：
  // 槽位家族失败回退全局家族，全局失败由 canvas 的 ", sans-serif" 兜底链呈现
  await input.fonts.ensureFamily(fontDef.id, familyCjk.get(fontDef.id) ?? false).catch((err: unknown) => {
    console.warn('[picseal] watermark font load failed, canvas falls back to system font:', err)
  })
  for (const [fam, cjk] of familyCjk) {
    if (fam === fontDef.id) continue
    try {
      await input.fonts.ensureFamily(fam, cjk)
    } catch (err) {
      console.warn(`[picseal] slot font load failed: ${fam}, fallback to template font`, err)
      const substitute = (st: ResolvedRowStyle | undefined) => {
        if (st?.family === fam) st.family = fontDef.id
      }
      for (const st of Object.values(bannerSlotStyles ?? {})) substitute(st)
      cornerLineStyles?.forEach(substitute)
      substitute(modelStyle)
      substitute(paramsStyle)
      if (cjk) {
        familyCjk.set(fontDef.id, true)
        await input.fonts.ensureFamily(fontDef.id, true).catch(() => undefined)
      }
    }
  }

  const typography = {
    family: fontDef.id,
    mainWeight: fontDef.mainWeight,
    subWeight: fontDef.subWeight,
    scale: template.typography.scale
  }

  // 居中标识：横幅（白带）高度固定官方比例（12% 照片高），不参与文字 solve——
  // 该模板只渲染居中 logo，若按四行文字反解会把白带压缩到 logo 放不下的尺寸
  const isCenterLogo = template.layout === 'center-logo'
  const bannerH = isCenterLogo
    ? photo.height * template.banner.heightRatio
    : hasBannerStrip
      ? solveBannerHeight(
          template,
          photo.width,
          photo.height,
          lines.banner,
          fontDef.id,
          fontDef.mainWeight,
          fontDef.subWeight,
          zMark,
          logo ? logo.width / logo.height : 1,
          bannerSlotStyles
        )
      : 0

  const geometry = computeGeometry(photo, template, bannerH)
  const s = computeScale(geometry, options.maxLongEdge)
  const g = scaleGeometry(geometry, s)
  const bannerHScaled = bannerH * s

  const canvas = makeCanvas(g.width, g.height)
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D

  switch (template.layout) {
    case 'banner':
      return {
        canvas,
        photoRect: drawFlatWithBanner(
          ctx,
          photo,
          template,
          lines,
          logo,
          g,
          typography,
          zMark,
          bannerHScaled,
          bannerSlotStyles
        )
      }
    case 'card':
      if (template.canvas.mount === 'blur') {
        return {
          canvas,
          photoRect: drawFrostedCard(
            ctx,
            photo,
            template,
            lines,
            g,
            s,
            typography,
            zMark,
            modelStyle,
            paramsStyle
          )
        }
      }
      return {
        canvas,
        photoRect: drawMountedCard(
          ctx,
          photo,
          template,
          lines,
          logo,
          g,
          typography,
          zMark,
          bannerHScaled,
          bannerSlotStyles
        )
      }
    case 'corner':
      return {
        canvas,
        photoRect: drawFlatWithCorner(ctx, photo, template, lines, g, typography, cornerLineStyles)
      }
    case 'center-logo':
      return { canvas, photoRect: drawFlatWithCenterLogo(ctx, photo, template, logo, g, bannerHScaled) }
  }
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
  /** 与 corner 一一对应的活跃槽位（供槽位样式解析按行取覆写） */
  cornerSlots: FieldSlot[]
  centerTitle: string
  centerCaption: string
  allText: string[]
}

function resolveAllLines(
  template: WatermarkTemplate,
  fieldCtx: Parameters<typeof resolveField>[1]
): ResolvedLines {
  const policy = template.fieldPolicy ?? 'hide'
  const b = template.banner
  const banner: BannerLines = {
    leftTop: b.leftTop.enabled ? resolveField(b.leftTop.content, fieldCtx, policy) : '',
    leftBottom: b.leftBottom.enabled ? resolveField(b.leftBottom.content, fieldCtx, policy) : '',
    rightTop: b.rightTop.enabled ? resolveField(b.rightTop.content, fieldCtx, policy) : '',
    rightBottom: b.rightBottom.enabled ? resolveField(b.rightBottom.content, fieldCtx, policy) : ''
  }
  const bannerEmpty =
    !banner.leftTop && !banner.leftBottom && !banner.rightTop && !banner.rightBottom

  const corner: string[] = []
  const cornerSlots: FieldSlot[] = []
  template.corner.lines.forEach((l) => {
    if (!l.enabled) return
    const text = resolveField(l.content, fieldCtx, policy).trim()
    if (text.length === 0) return
    corner.push(text)
    cornerSlots.push(l)
  })

  const centerTitle = template.center.title.enabled
    ? resolveField(template.center.title.content, fieldCtx, policy)
    : ''
  const centerCaption = template.center.caption.enabled
    ? resolveField(template.center.caption.content, fieldCtx, policy)
    : ''

  return {
    banner,
    bannerEmpty,
    corner,
    cornerSlots,
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

function computeGeometry(photo: ImageBitmap, template: WatermarkTemplate, bannerH: number): RenderedGeometry {
  const pW = photo.width
  const pH = photo.height
  const { canvas } = template
  const aspect = parseAspectRatio(canvas.aspectRatio)

  if (template.layout === 'banner') {
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

  if (template.layout === 'center-logo') {
    // semi-utils center_logo 实测：上/左/右细白边 = 2% 照片高，底部宽白带 = banner 高（logo 居中）
    const thin = pH * 0.02
    return extendToAspect(
      {
        width: pW + thin * 2,
        height: pH + thin + bannerH,
        photoRect: { x: thin, y: thin, w: pW, h: pH }
      },
      aspect,
      canvas.mountColor
    )
  }

  // corner：纯叠加
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

/** 横幅条带：紧贴照片下方；高度 = solveBannerHeight 单一结果（调用方已按渲染缩放换算） */
function bannerStripRect(g: RenderedGeometry, t: WatermarkTemplate, bannerH: number) {
  const fullWidth =
    t.layout === 'center-logo' || (!!t.banner.fullWidth && g.width > g.photoRect.w)
  return {
    x: fullWidth ? 0 : g.photoRect.x,
    y: g.photoRect.y + g.photoRect.h,
    w: fullWidth ? g.width : g.photoRect.w,
    h: bannerH
  }
}

function drawFlatWithBanner(
  ctx: Ctx2D,
  photo: ImageBitmap,
  t: WatermarkTemplate,
  lines: ResolvedLines,
  logo: ImageBitmap | null,
  g: RenderedGeometry,
  typography: Typography,
  zMark: { color?: string; family: ReturnType<typeof getFontFamily>['id'] } | undefined,
  bannerH: number,
  slotStyles?: BannerSlotStyles
): RenderedGeometry['photoRect'] {
  fillBackdrop(ctx, g, t.canvas.mountColor)
  const radius = g.width * t.canvas.cornerRadius
  drawPhotoRounded(ctx, photo, g.photoRect, radius, 0)
  if (!lines.bannerEmpty) {
    drawBannerStrip(
      ctx,
      bannerStripRect(g, t, bannerH),
      lines.banner,
      {
        banner: t.banner,
        family: typography.family,
        mainWeight: typography.mainWeight,
        subWeight: typography.subWeight,
        logo,
        mark: zMark,
        slotStyles
      },
      Math.min(1, typography.scale)
    )
  }
  return g.photoRect
}

function drawMountedCard(
  ctx: Ctx2D,
  photo: ImageBitmap,
  t: WatermarkTemplate,
  lines: ResolvedLines,
  logo: ImageBitmap | null,
  g: RenderedGeometry,
  typography: Typography,
  zMark: { color?: string; family: ReturnType<typeof getFontFamily>['id'] } | undefined,
  bannerH: number,
  slotStyles?: BannerSlotStyles
): RenderedGeometry['photoRect'] {
  fillBackdrop(ctx, g, t.canvas.mountColor)
  const radius = g.width * t.canvas.cornerRadius
  drawPhotoRounded(ctx, photo, g.photoRect, radius, t.canvas.shadow ? g.width * 0.012 : 0)
  if (!lines.bannerEmpty) {
    drawBannerStrip(
      ctx,
      bannerStripRect(g, t, bannerH),
      lines.banner,
      {
        banner: t.banner,
        family: typography.family,
        mainWeight: typography.mainWeight,
        subWeight: typography.subWeight,
        logo,
        transparentBg: true,
        mark: zMark,
        slotStyles
      },
      Math.min(1, typography.scale)
    )
  }
  return g.photoRect
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
  typography: Typography,
  zMark?: { color?: string; family: ReturnType<typeof getFontFamily>['id'] },
  modelStyle?: ResolvedRowStyle,
  paramsStyle?: ResolvedRowStyle
): RenderedGeometry['photoRect'] {
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

  // 3. 文字列（照片下方）—— 绘制前采样文字区亮度，对比不足自动切换黑/白（R-05）
  const textTop = dy + S(Math.min(layout.modelY, layout.paramsY))
  const textH = S(Math.abs(layout.paramsY - layout.modelY) + layout.modelH) + 8
  const textLuma = sampleLuminance(ctx, g.width * 0.3, textTop, g.width * 0.4, textH)
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
      mark: zMark,
      // 槽位覆写色并入对比度解析（R-05）：无覆写时保持白色基准
      modelColor: ensureContrastColor(modelStyle?.color ?? '#ffffff', textLuma),
      paramsColor: ensureContrastColor(paramsStyle?.color ?? '#ffffff', textLuma),
      modelStyle,
      paramsStyle
    }
  )
  // 实际绘制的清晰照片矩形（135% 构图内居中），非 g.photoRect
  return photoRect
}

function drawFlatWithCorner(
  ctx: Ctx2D,
  photo: ImageBitmap,
  t: WatermarkTemplate,
  lines: ResolvedLines,
  g: RenderedGeometry,
  typography: Typography,
  lineStyles?: ResolvedRowStyle[]
): RenderedGeometry['photoRect'] {
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
    typography.subWeight,
    lineStyles
  )
  return g.photoRect
}

/** 居中标识 —— semi-utils center_logo 语义：白底横幅带 + 仅一个品牌 logo 居中（无文字/无遮罩） */
function drawFlatWithCenterLogo(
  ctx: Ctx2D,
  photo: ImageBitmap,
  t: WatermarkTemplate,
  logo: ImageBitmap | null,
  g: RenderedGeometry,
  bannerH: number
): RenderedGeometry['photoRect'] {
  fillBackdrop(ctx, g, t.canvas.mountColor)
  const radius = g.width * t.canvas.cornerRadius
  drawPhotoRounded(ctx, photo, g.photoRect, radius, 0)
  const strip = bannerStripRect(g, t, bannerH)
  ctx.fillStyle = t.banner.bgColor
  ctx.fillRect(strip.x, strip.y, strip.w, strip.h)
  if (logo) {
    // logo 高 = center.logoRatio × 照片高（官方 center_height = vh(2)），带内水平垂直居中
    const logoH = g.photoRect.h * t.center.logoRatio
    const logoW = logoH * (logo.width / logo.height)
    drawImageSmoothed(ctx, logo, g.width / 2 - logoW / 2, strip.y + (strip.h - logoH) / 2, logoW, logoH)
  }
  return g.photoRect
}

function supportsFilter(ctx: Ctx2D): boolean {
  return typeof (ctx as OffscreenCanvasRenderingContext2D).filter === 'string'
}
