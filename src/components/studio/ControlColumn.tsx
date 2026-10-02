'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import clsx from 'clsx'
import { Download, Plus, Save, Trash2, Upload } from 'lucide-react'
import {
  Panel,
  Row,
  SegmentedControl,
  TermButton,
  TermSlider,
  TermSwitch
} from '@/components/ui/primitives'
import { BUILTIN_TEMPLATES } from '@/core/templates/builtin'
import { FONT_FAMILIES, FONT_GROUP_LABELS, type FontGroup } from '@/core/fonts/registry'
import type { FieldSlot, WatermarkTemplate } from '@/core/types'
import { useSettings, type SavedPreset } from '@/stores/settings'
import { usePhotos } from '@/stores/photos'
import { getRenderPool } from '@/workers/pool'
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
          onChange={(e) => onChange({ enabled: slot.enabled, content: e.target.value })}
          placeholder={t('fields.custom')}
          className="h-7 w-24 border border-line bg-transparent px-1.5 text-[11px] outline-none focus:border-accent"
        />
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

      {template.layout === 'center-logo' ? (
        <SlotSelect
          slot={template.center.caption}
          onChange={(s) => update((d) => void (d.center.caption = s))}
        />
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

  const fontGroups = Object.keys(FONT_GROUP_LABELS) as FontGroup[]

  return (
    <Panel label={t('appearance.label')} labelEn={t('appearance.labelEn')}>
      <Row label={t('appearance.font')}>
        <select
          value={template.typography.font}
          onChange={(e) => update((d) => void (d.typography.font = e.target.value))}
          className="h-7 min-w-0 flex-1 border border-line bg-transparent px-1.5 text-[11px] outline-none"
        >
          {fontGroups.map((group) => (
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

      {template.layout === 'banner' || (template.layout === 'card' && template.canvas.mount !== 'blur') ? (
        <Row label={t('export.label')}>
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
        index: 0
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
