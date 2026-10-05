'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import clsx from 'clsx'
import { ChevronDown, Download, Plus, RotateCcw, Save, Trash2, Upload, X } from 'lucide-react'
import {
  Panel,
  Row,
  SegmentedControl,
  TermButton,
  TermSlider,
  TermSwitch
} from '@/components/ui/primitives'
import { BUILTIN_TEMPLATES } from '@/core/templates/builtin'
import { FONT_FAMILIES, FONT_GROUP_LABELS, getFontFamily } from '@/core/fonts/registry'
import type { FieldSlot, SlotFontStyle, WatermarkTemplate } from '@/core/types'
import { useSettings, type SavedPreset } from '@/stores/settings'
import { usePhotos } from '@/stores/photos'
import { getRenderPool } from '@/workers/pool'
import { getResizeKernel } from '@/core/render/resize-kernel'
import { renderMiniPreview, clearMiniCache } from '@/hooks/usePreview'
import { saveBlob } from '@/lib/delivery'

const TOKEN_OPTIONS = [
  { value: '$model', key: 'model' },
  { value: '$lens', key: 'lens' },
  { value: '$param', key: 'params' },
  { value: '$datetime', key: 'datetime' },
  { value: '$gps', key: 'gps' },
  { value: '$brand', key: 'logo' }
] as const

function slotToSelect(content: string): string {
  return TOKEN_OPTIONS.some((o) => o.value === content) ? content : '__custom'
}

function SlotSelect({
  slot,
  onChange
}: {
  slot: FieldSlot
  onChange: (next: FieldSlot) => void
}) {
  const t = useTranslations('studio')
  const mode = slotToSelect(slot.content)
  return (
    <div className="flex items-center gap-2 py-1">
      <TermSwitch
        checked={slot.enabled}
        onCheckedChange={(v) => onChange({ ...slot, enabled: v })}
      />
      <select
        value={mode}
        onChange={(e) => {
          const v = e.target.value
          onChange({
            ...slot,
            enabled: slot.enabled,
            content: v === '__custom' ? (slot.content.startsWith('$') ? '' : slot.content) : v
          })
        }}
        className="h-7 min-w-0 flex-1 border border-line bg-transparent px-1.5 text-[11px] text-ink outline-none"
      >
        {TOKEN_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {t(`fields.${o.key}`)}
          </option>
        ))}
        <option value="__custom">{t('fields.custom')}</option>
      </select>
      {mode === '__custom' ? (
        <input
          value={slot.content.startsWith('$') ? '' : slot.content}
          onChange={(e) => onChange({ ...slot, enabled: slot.enabled, content: e.target.value })}
          placeholder={t('fields.custom')}
          className="h-7 w-24 border border-line bg-transparent px-1.5 text-[11px] outline-none focus:border-accent"
        />
      ) : null}
    </div>
  )
}

/** 字体家族选择（分组下拉）；allowInherit 时提供空值选项 = 跟随模板 */
function FontSelect({
  value,
  onChange,
  allowInherit,
  inheritLabel
}: {
  value: string
  onChange: (v: string) => void
  allowInherit?: boolean
  inheritLabel?: string
}) {
  const groups = Object.keys(FONT_GROUP_LABELS) as Array<keyof typeof FONT_GROUP_LABELS>
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 min-w-0 flex-1 border border-line bg-transparent px-1.5 text-[11px] outline-none"
    >
      {allowInherit ? <option value="">{inheritLabel}</option> : null}
      {groups.map((group) => (
        <optgroup key={group} label={`${FONT_GROUP_LABELS[group].zh} / ${FONT_GROUP_LABELS[group].en}`}>
          {Object.values(FONT_FAMILIES)
            .filter((f) => f.group === group)
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  )
}

/* ───────────────── 高级字体设置（逐槽位覆写，默认折叠） ───────────────── */

/** 槽位入口：字段路径随布局不同，由调用方闭包绑定读写 */
interface SlotEntry {
  key: string
  label: string
  slot: FieldSlot
  setSlot: (next: FieldSlot) => void
}

const ADV_PRESET_COLORS = ['#FFFFFF', '#111111', '#F5F0E6', '#9C9C9C', '#E88D34', '#E3001B']

const ADV_WEIGHT_KEYS: Record<number, string> = {
  300: 'advW300',
  400: 'advW400',
  500: 'advW500',
  600: 'advW600',
  700: 'advW700',
  800: 'advW800'
}

const hasStyleOverride = (style?: SlotFontStyle): boolean =>
  !!style && Object.keys(style).length > 0

function SlotStyleBlock({ entry, template }: { entry: SlotEntry; template: WatermarkTemplate }) {
  const t = useTranslations('studio')
  const style = entry.slot.style
  const overridden = hasStyleOverride(style)
  // 字重选项跟随生效家族（覆写家族或模板全局家族）
  const effDef = getFontFamily(style?.font || template.typography.font)
  const weightLabel = (w: number): string => {
    const key = ADV_WEIGHT_KEYS[w]
    return key ? t(`appearance.${key}`) : String(w)
  }

  const patchStyle = (patch: Partial<SlotFontStyle>) => {
    const next: SlotFontStyle = { ...style, ...patch }
    ;(Object.keys(next) as Array<keyof SlotFontStyle>).forEach((k) => {
      if (next[k] === undefined) delete next[k]
    })
    entry.setSlot({ ...entry.slot, style: Object.keys(next).length > 0 ? next : undefined })
  }

  return (
    <div className="border-b border-line/60 py-1.5 last:border-b-0">
      <div className="flex items-center justify-between pb-0.5">
        <span className="flex items-center gap-1.5">
          <span className={clsx('h-1.5 w-1.5', overridden ? 'bg-accent' : 'bg-line')} />
          <span className="hud-label text-[9px]">{entry.label}</span>
        </span>
        {overridden ? (
          <button
            type="button"
            aria-label={t('appearance.advClear')}
            title={t('appearance.advClear')}
            onClick={() => entry.setSlot({ ...entry.slot, style: undefined })}
            className="p-0.5 text-muted transition-colors hover:text-accent"
          >
            <X size={10} />
          </button>
        ) : null}
      </div>
      <Row label={t('appearance.advFont')}>
        <FontSelect
          value={style?.font ?? ''}
          allowInherit
          inheritLabel={t('appearance.advInherit')}
          onChange={(v) => {
            // 切换家族后字重覆写若不被新家族支持则一并清除
            const def = getFontFamily(v || template.typography.font)
            const w = style?.weight
            patchStyle({
              font: v || undefined,
              weight: w !== undefined && def.weights.includes(w) ? w : undefined
            })
          }}
        />
      </Row>
      <Row label={t('appearance.advSize')}>
        <div className="w-32">
          <TermSlider
            value={style?.scale ?? 1}
            min={0.5}
            max={2}
            step={0.05}
            onValueChange={(v) => patchStyle({ scale: v === 1 ? undefined : v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </div>
      </Row>
      <Row label={t('appearance.advWeight')}>
        <select
          value={style?.weight ?? ''}
          onChange={(e) => patchStyle({ weight: e.target.value ? Number(e.target.value) : undefined })}
          className="h-7 w-36 border border-line bg-transparent px-1.5 text-[11px] outline-none"
        >
          <option value="">{t('appearance.advInherit')}</option>
          {effDef.weights.map((w) => (
            <option key={w} value={w}>
              {weightLabel(w)}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('appearance.advItalic')}>
        <TermSwitch
          checked={style?.italic ?? false}
          onCheckedChange={(v) => patchStyle({ italic: v || undefined })}
        />
      </Row>
      <Row label={t('appearance.advColor')}>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={t('appearance.advInherit')}
            title={t('appearance.advInherit')}
            onClick={() => patchStyle({ color: undefined })}
            className={clsx(
              'relative h-4 w-4 overflow-hidden border',
              !style?.color ? 'border-accent' : 'border-line'
            )}
          >
            <span className="absolute left-1/2 top-1/2 h-[1px] w-[22px] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-line" />
          </button>
          {ADV_PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => patchStyle({ color: c })}
              className={clsx(
                'h-4 w-4 border',
                style?.color?.toUpperCase() === c ? 'border-accent' : 'border-line'
              )}
              style={{ background: c }}
            />
          ))}
          <input
            type="color"
            aria-label={t('appearance.advCustom')}
            title={t('appearance.advCustom')}
            value={style?.color ?? '#000000'}
            onChange={(e) => patchStyle({ color: e.target.value })}
            className="h-4 w-4 cursor-pointer border border-line bg-transparent p-0"
          />
        </div>
      </Row>
    </div>
  )
}

/** 高级字体区块：按布局暴露当前模板的文字槽位，逐槽位覆写字体/字号/字重/斜体/颜色 */
function AdvancedFontSection() {
  const t = useTranslations('studio')
  const template = useSettings((s) => s.template)
  const update = useSettings((s) => s.update)
  const [open, setOpen] = useState(false)

  // 居中标识布局不渲染文字，无槽位可设置
  if (template.layout === 'center-logo') return null

  const bannerActive =
    template.layout === 'banner' || (template.layout === 'card' && template.canvas.mount !== 'blur')
  const blurActive = template.layout === 'card' && template.canvas.mount === 'blur'

  const entries: SlotEntry[] = []
  if (bannerActive) {
    entries.push(
      {
        key: 'lt',
        label: t('appearance.advSlotLT'),
        slot: template.banner.leftTop,
        setSlot: (s) => update((d) => void (d.banner.leftTop = s))
      },
      {
        key: 'lb',
        label: t('appearance.advSlotLB'),
        slot: template.banner.leftBottom,
        setSlot: (s) => update((d) => void (d.banner.leftBottom = s))
      },
      {
        key: 'rt',
        label: t('appearance.advSlotRT'),
        slot: template.banner.rightTop,
        setSlot: (s) => update((d) => void (d.banner.rightTop = s))
      },
      {
        key: 'rb',
        label: t('appearance.advSlotRB'),
        slot: template.banner.rightBottom,
        setSlot: (s) => update((d) => void (d.banner.rightBottom = s))
      }
    )
  } else if (blurActive) {
    entries.push(
      {
        key: 'title',
        label: t('appearance.advModel'),
        slot: template.center.title,
        setSlot: (s) => update((d) => void (d.center.title = s))
      },
      {
        key: 'caption',
        label: t('appearance.advParams'),
        slot: template.center.caption,
        setSlot: (s) => update((d) => void (d.center.caption = s))
      }
    )
  } else {
    template.corner.lines.forEach((slot, i) => {
      entries.push({
        key: `line-${i}`,
        label: t('appearance.advRowN', { n: i + 1 }),
        slot,
        setSlot: (s) => update((d) => void (d.corner.lines[i] = s))
      })
    })
  }

  const overrideCount = entries.filter((e) => hasStyleOverride(e.slot.style)).length

  // 还原默认 = 清除全部槽位的高级覆写（横幅四槽位 + 角标行 + 居中标题/说明），全局设置不动
  const resetAll = () =>
    update((d) => {
      d.banner.leftTop.style = undefined
      d.banner.leftBottom.style = undefined
      d.banner.rightTop.style = undefined
      d.banner.rightBottom.style = undefined
      d.corner.lines.forEach((l) => {
        l.style = undefined
      })
      d.center.title.style = undefined
      d.center.caption.style = undefined
    })

  return (
    <div className="mt-1 border border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2.5 py-2 text-left transition-colors hover:bg-ink/5"
      >
        <span className="hud-label text-[9px]">
          {t('appearance.advTitle')}
          <span className="text-ink/60"> / {t('appearance.advTitleEn')}</span>
        </span>
        <span className="flex items-center gap-2">
          {overrideCount > 0 ? (
            <span className="text-[9px] tabular-nums text-accent">{overrideCount}</span>
          ) : null}
          <ChevronDown
            size={12}
            className={clsx('text-muted transition-transform duration-200', open && 'rotate-180')}
          />
        </span>
      </button>
      {open ? (
        <div className="border-t border-line px-2.5 pb-2.5 pt-1.5">
          <p className="pb-1 text-[10px] leading-relaxed text-muted/80">{t('appearance.advHint')}</p>
          {entries.map((entry) => (
            <SlotStyleBlock key={entry.key} entry={entry} template={template} />
          ))}
          <TermButton
            variant="line"
            className="mt-2 w-full justify-center"
            onClick={resetAll}
            disabled={overrideCount === 0}
          >
            <RotateCcw size={11} /> {t('appearance.advReset')}
          </TermButton>
        </div>
      ) : null}
    </div>
  )
}

/** 输出模板列表：内置 8 款 + 自定义预设，带当前照片实时小样 */
function TemplatePanel({ onClearEdit }: { onClearEdit: () => void }) {
  const t = useTranslations('studio')
  const tr = useTranslations()
  const templateId = useSettings((s) => s.templateId)
  const template = useSettings((s) => s.template)
  const useTemplate = useSettings((s) => s.useTemplate)
  const presets = useSettings((s) => s.presets)
  const items = usePhotos((s) => s.items)
  const currentId = usePhotos((s) => s.currentId)
  const photo = items.find((p) => p.id === currentId)
  const [minis, setMinis] = useState<Record<string, string>>({})

  useEffect(() => {
    clearMiniCache()
    setMinis({})
    if (!photo) return
    let cancelled = false
    void (async () => {
      for (const builtin of BUILTIN_TEMPLATES) {
        const url = await renderMiniPreview(photo, builtin)
        if (cancelled) return
        if (url) setMinis((m) => ({ ...m, [builtin.id]: url }))
      }
      for (const preset of presets) {
        const url = await renderMiniPreview(photo, preset.template)
        if (cancelled) return
        if (url) setMinis((m) => ({ ...m, [preset.id]: url }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [photo, presets])

  const edited = templateId === ''

  return (
    <Panel label={t('template.label')} labelEn={t('template.labelEn')}>
      <ul className="flex flex-col">
        {BUILTIN_TEMPLATES.map((builtin) => (
          <TemplateRow
            key={builtin.id}
            id={builtin.id}
            name={tr(`templates.${builtin.id}.name`)}
            nameEn={tr(`templates.${builtin.id}.nameEn`)}
            thumb={minis[builtin.id]}
            active={templateId === builtin.id}
            onClick={() => {
              useTemplate(builtin.id)
              onClearEdit()
            }}
          />
        ))}
        {presets.length > 0 ? (
          <li className="pb-1 pt-2">
            <span className="hud-label text-[9px]">{t('preset.custom')}</span>
          </li>
        ) : null}
        {presets.map((preset: SavedPreset) => (
          <TemplateRow
            key={preset.id}
            id={preset.id}
            name={preset.name}
            nameEn="PRESET"
            thumb={minis[preset.id]}
            active={templateId === preset.id}
            onClick={() => {
              useTemplate(preset.id)
              onClearEdit()
            }}
          />
        ))}
      </ul>
      {edited ? (
        <p className="mt-2 border-l-2 border-accent pl-2 text-[10px] text-muted">
          {t('preset.custom')} · {template.id}
        </p>
      ) : null}
    </Panel>
  )
}

function TemplateRow({
  id,
  name,
  nameEn,
  thumb,
  active,
  onClick
}: {
  id: string
  name: string
  nameEn: string
  thumb?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        data-template-id={id}
        className={clsx(
          'group flex w-full items-center gap-3 py-1.5 pl-2 pr-1 text-left transition-colors',
          active ? 'bg-ink/5' : 'hover:bg-ink/5'
        )}
      >
        <span
          className={clsx(
            'h-6 w-[2px] shrink-0 transition-all',
            active ? 'bg-accent' : 'bg-transparent group-hover:bg-line'
          )}
        />
        <span className="h-9 w-12 shrink-0 overflow-hidden bg-stage">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt={name} className="h-full w-full object-cover" />
          ) : (
            <span className="block h-full w-full animate-pulse bg-line/50" />
          )}
        </span>
        <span className="min-w-0">
          <span className={clsx('block truncate text-[12px]', active ? 'text-ink' : 'text-muted group-hover:text-ink')}>
            {name}
          </span>
          <span className="block truncate text-[9px] tracking-[1.5px] text-muted/70">
            {nameEn}
          </span>
        </span>
      </button>
    </li>
  )
}

/** 字段面板：按布局族暴露对应槽位 */
function FieldsPanel() {
  const t = useTranslations('studio')
  const template = useSettings((s) => s.template)
  const update = useSettings((s) => s.update)

  return (
    <Panel label={t('fields.label')} labelEn={t('fields.labelEn')}>
      <Row label={t('fields.missing')}>
        <SegmentedControl
          options={[
            { value: 'dash', label: t('fields.missingDash') },
            { value: 'hide', label: t('fields.missingHide') }
          ]}
          value={template.fieldPolicy ?? 'hide'}
          onChange={(v) => update((d) => void (d.fieldPolicy = v as 'dash' | 'hide'))}
        />
      </Row>
      {template.layout === 'banner' || (template.layout === 'card' && template.canvas.mount !== 'blur') ? (
        <>
          <SlotSelect
            slot={template.banner.leftTop}
            onChange={(s) => update((d) => void (d.banner.leftTop = s))}
          />
          <SlotSelect
            slot={template.banner.leftBottom}
            onChange={(s) => update((d) => void (d.banner.leftBottom = s))}
          />
          <SlotSelect
            slot={template.banner.rightTop}
            onChange={(s) => update((d) => void (d.banner.rightTop = s))}
          />
          <SlotSelect
            slot={template.banner.rightBottom}
            onChange={(s) => update((d) => void (d.banner.rightBottom = s))}
          />
          <Row label={t('fields.logo')}>
            <div className="flex items-center gap-2">
              <select
                value={template.banner.logo.position}
                onChange={(e) =>
                  update((d) => void (d.banner.logo.position = e.target.value as 'left' | 'right'))
                }
                disabled={!template.banner.logo.enabled}
                className="h-7 border border-line bg-transparent px-1.5 text-[11px] outline-none disabled:opacity-40"
              >
                <option value="left">L</option>
                <option value="right">R</option>
              </select>
              <TermSwitch
                checked={template.banner.logo.enabled}
                onCheckedChange={(v) => update((d) => void (d.banner.logo.enabled = v))}
              />
            </div>
          </Row>
        </>
      ) : null}

      {template.layout === 'card' && template.canvas.mount === 'blur' ? (
        <>
          <SlotSelect
            slot={template.center.title}
            onChange={(s) => update((d) => void (d.center.title = s))}
          />
          <SlotSelect
            slot={template.center.caption}
            onChange={(s) => update((d) => void (d.center.caption = s))}
          />
        </>
      ) : null}

      {template.layout === 'corner' ? (
        template.corner.lines.map((line, i) => (
          <SlotSelect
            key={i}
            slot={line}
            onChange={(s) => update((d) => void (d.corner.lines[i] = s))}
          />
        ))
      ) : null}

    </Panel>
  )
}

const ASPECT_OPTIONS = [
  { value: '', label: '原始' },
  { value: '4:5', label: '4:5' },
  { value: '3:4', label: '3:4' },
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '2.35:1', label: '2.35:1' }
] as const

function AppearancePanel() {
  const t = useTranslations('studio')
  const template = useSettings((s) => s.template)
  const update = useSettings((s) => s.update)

  return (
    <Panel label={t('appearance.label')} labelEn={t('appearance.labelEn')}>
      <Row label={t('appearance.font')}>
        <FontSelect
          value={template.typography.font}
          onChange={(v) => update((d) => void (d.typography.font = v))}
        />
      </Row>
      <Row label={t('appearance.scale')}>
        <div className="w-36">
          <TermSlider
            value={template.typography.scale}
            min={0.6}
            max={1.4}
            step={0.05}
            onValueChange={(v) => update((d) => void (d.typography.scale = v))}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </div>
      </Row>

      <AdvancedFontSection />

      {template.layout === 'banner' || (template.layout === 'card' && template.canvas.mount !== 'blur') ? (
        <Row label={t('appearance.bannerHeight')}>
          <div className="w-36">
            <TermSlider
              value={template.banner.heightRatio}
              min={0.05}
              max={0.16}
              step={0.005}
              onValueChange={(v) => update((d) => void (d.banner.heightRatio = v))}
              format={(v) => `${(v * 100).toFixed(1)}%`}
            />
          </div>
        </Row>
      ) : null}

      {template.layout === 'banner' || (template.layout === 'card' && template.canvas.mount !== 'blur') ? (
        <>
          <Row label={t('appearance.rightAlign')}>
            <SegmentedControl
              options={[
                { value: 'near', label: t('appearance.rightAlignNear') },
                { value: 'far', label: t('appearance.rightAlignFar') }
              ]}
              value={template.banner.rightAlign}
              onChange={(v) => update((d) => void (d.banner.rightAlign = v))}
            />
          </Row>
          <Row label={t('appearance.bannerColor')}>
            <div className="flex gap-1.5">
              {['#ffffff', '#111111', '#f5f0e6'].map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={color}
                  onClick={() => update((d) => void (d.banner.bgColor = color))}
                  className={clsx(
                    'h-4 w-4 border',
                    template.banner.bgColor === color ? 'border-accent' : 'border-line'
                  )}
                  style={{ background: color }}
                />
              ))}
            </div>
          </Row>
        </>
      ) : null}

      {template.layout === 'card' ? (
        <>
          <Row label={t('appearance.margin')}>
            <div className="w-36">
              <TermSlider
                value={template.canvas.mount === 'blur' ? 0 : template.canvas.margin}
                min={0}
                max={0.1}
                step={0.004}
                disabled={template.canvas.mount === 'blur'}
                onValueChange={(v) => update((d) => void (d.canvas.margin = v))}
                format={(v) => `${(v * 100).toFixed(1)}%`}
              />
            </div>
          </Row>
          <Row label={t('appearance.cornerRadius')}>
            <div className="w-36">
              <TermSlider
                value={template.canvas.cornerRadius}
                min={0}
                max={0.05}
                step={0.002}
                onValueChange={(v) => update((d) => void (d.canvas.cornerRadius = v))}
                format={(v) => `${(v * 100).toFixed(1)}%`}
              />
            </div>
          </Row>
          <Row label={t('appearance.shadow')}>
            <TermSwitch
              checked={template.canvas.shadow}
              onCheckedChange={(v) => update((d) => void (d.canvas.shadow = v))}
            />
          </Row>
        </>
      ) : null}

      {template.layout === 'corner' ? (
        <>
          <Row label={t('appearance.scale')}>
            <div className="w-36">
              <TermSlider
                value={template.corner.sizeRatio}
                min={0.008}
                max={0.05}
                step={0.002}
                onValueChange={(v) => update((d) => void (d.corner.sizeRatio = v))}
                format={(v) => `${(v * 100).toFixed(1)}%`}
              />
            </div>
          </Row>
        </>
      ) : null}

      {/* 装裱底色：仅在有实际补边/装裱时可生效（扁平横幅的底色走"横幅底色"） */}
      {template.canvas.mount !== 'none' || template.canvas.aspectRatio ? (
        <Row label={t('appearance.canvasColor')}>
          <div className="flex gap-1.5">
            {['#ffffff', '#111111', '#f5f0e6'].map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                onClick={() => update((d) => void (d.canvas.mountColor = color))}
                className={clsx(
                  'h-4 w-4 border',
                  template.canvas.mountColor === color ? 'border-accent' : 'border-line'
                )}
                style={{ background: color }}
              />
            ))}
          </div>
        </Row>
      ) : null}

      <Row label={t('appearance.aspectRatio')}>
        <select
          value={template.canvas.aspectRatio ?? ''}
          onChange={(e) => update((d) => void (d.canvas.aspectRatio = e.target.value || null))}
          className="h-7 border border-line bg-transparent px-1.5 text-[11px] outline-none"
        >
          {ASPECT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
    </Panel>
  )
}

function PresetPanel() {
  const t = useTranslations('studio')
  const template = useSettings((s) => s.template)
  const presets = useSettings((s) => s.presets)
  const savePreset = useSettings((s) => s.savePreset)
  const deletePreset = useSettings((s) => s.deletePreset)
  const importPresetJson = useSettings((s) => s.importPresetJson)
  const exportPresetJson = useSettings((s) => s.exportPresetJson)
  const [name, setName] = useState('')

  const fileRef = useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>

  return (
    <Panel label={t('preset.label')} labelEn={t('preset.labelEn')}>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('preset.namePlaceholder')}
          className="h-7 min-w-0 flex-1 border border-line bg-transparent px-2 text-[11px] outline-none focus:border-accent"
        />
        <TermButton
          variant="ghost"
          onClick={() => {
            if (!name.trim()) return
            savePreset(name)
            setName('')
          }}
          disabled={!name.trim()}
        >
          <Save size={12} /> {t('preset.save')}
        </TermButton>
      </div>

      {presets.length > 0 ? (
        <ul className="mt-2 flex flex-col">
          {presets.map((preset) => (
            <li key={preset.id} className="flex items-center justify-between py-1 text-[11px]">
              <span className="truncate text-muted">{preset.name}</span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={t('preset.export')}
                  className="p-1 text-muted hover:text-accent"
                  onClick={() =>
                    saveBlob(
                      new Blob([exportPresetJson(preset)], { type: 'application/json' }),
                      `${preset.name}.picseal.json`
                    )
                  }
                >
                  <Upload size={11} />
                </button>
                <button
                  type="button"
                  aria-label={t('preset.delete')}
                  className="p-1 text-muted hover:text-accent"
                  onClick={() => deletePreset(preset.id)}
                >
                  <Trash2 size={11} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return
          try {
            importPresetJson(await file.text())
          } catch {
            /* 无效预设文件，静默忽略 */
          }
          e.target.value = ''
        }}
      />
      <TermButton variant="line" className="mt-2" onClick={() => fileRef.current?.click()}>
        <Plus size={11} /> {t('preset.import')}
      </TermButton>
    </Panel>
  )
}

function ExportPanel({ onOpenBatch }: { onOpenBatch: () => void }) {
  const t = useTranslations('studio')
  const template = useSettings((s) => s.template)
  const output = useSettings((s) => s.output)
  const updateOutput = useSettings((s) => s.updateOutput)
  const items = usePhotos((s) => s.items)
  const currentId = usePhotos((s) => s.currentId)
  const photo = items.find((p) => p.id === currentId)
  const [busy, setBusy] = useState(false)
  const selectedCount = useMemo(() => items.filter((p) => p.selected).length, [items])

  const downloadCurrent = async () => {
    if (!photo || busy) return
    setBusy(true)
    try {
      const res = await getRenderPool().run({
        kind: 'export',
        photoId: photo.id,
        file: photo.file,
        meta: photo.meta ?? {},
        template,
        settings: output,
        sourceType: photo.sourceType ?? 'jpeg',
        index: 0,
        resizeKernel: getResizeKernel()
      })
      if (res.ok && res.kind === 'export') saveBlob(res.blob, res.filename)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel label={t('export.label')} labelEn={t('export.labelEn')}>
      <Row label={t('export.format')}>
        <SegmentedControl
          options={[
            { value: 'jpeg', label: 'JPG' },
            { value: 'png', label: 'PNG' },
            { value: 'webp', label: 'WEBP' }
          ]}
          value={output.format}
          onChange={(v) => updateOutput({ format: v })}
        />
      </Row>

      {output.format !== 'png' ? (
        <Row label={t('export.quality')}>
          <div className="w-36">
            <TermSlider
              value={output.quality}
              min={0.5}
              max={1}
              step={0.01}
              onValueChange={(v) => updateOutput({ quality: v })}
              format={(v) => `${Math.round(v * 100)}`}
            />
          </div>
        </Row>
      ) : null}

      <Row label={t('export.longEdge')}>
        <SegmentedControl
          options={[
            { value: '0', label: t('export.longEdgeOriginal') },
            { value: '3840', label: '4K' },
            { value: '2560', label: '2K' },
            { value: '1920', label: '1080' }
          ]}
          value={String(output.longEdge)}
          onChange={(v) => updateOutput({ longEdge: Number(v) })}
        />
      </Row>

      <Row label={t('export.keepExif')}>
        <TermSwitch
          checked={output.keepExif}
          onCheckedChange={(v) => updateOutput({ keepExif: v })}
        />
      </Row>

      <Row label={t('export.naming')}>
        <SegmentedControl
          options={[
            { value: 'original', label: t('export.namingOriginal') },
            { value: 'datetime', label: t('export.namingDate') },
            { value: 'index', label: t('export.namingIndex') }
          ]}
          value={output.naming}
          onChange={(v) => updateOutput({ naming: v })}
        />
      </Row>

      <div className="mt-3 flex flex-col gap-2">
        <TermButton variant="ghost" onClick={downloadCurrent} disabled={!photo || busy}>
          <Download size={12} /> {t('export.downloadThis')}
        </TermButton>
        <button
          type="button"
          onClick={onOpenBatch}
          disabled={items.length === 0}
          className="h-9 bg-ink text-[12px] font-medium tracking-[1px] text-page transition-opacity hover:opacity-85 disabled:opacity-40"
        >
          {selectedCount > 0
            ? t('export.batchSelected', { count: selectedCount })
            : t('export.batchRun', { count: items.length })}
        </button>
      </div>
    </Panel>
  )
}

export function ControlColumn({ onOpenBatch }: { onOpenBatch: () => void }) {
  return (
    <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-line">
      <TemplatePanel onClearEdit={() => undefined} />
      <FieldsPanel />
      <AppearancePanel />
      <PresetPanel />
      <ExportPanel onOpenBatch={onOpenBatch} />
      <div className="h-8" />
    </aside>
  )
}

export type { WatermarkTemplate }
