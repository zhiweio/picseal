'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID, getBuiltinTemplate } from '@/core/templates/builtin'
import { parseTemplate } from '@/core/templates/schema'
import type { OutputSettings, WatermarkTemplate } from '@/core/types'

export interface SavedPreset {
  id: string
  name: string
  savedAt: number
  template: WatermarkTemplate
}

const presetArraySchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    savedAt: z.number(),
    template: z.unknown()
  })
)

export const DEFAULT_OUTPUT: OutputSettings = {
  format: 'jpeg',
  quality: 0.92,
  keepExif: true,
  naming: 'original',
  longEdge: 0
}

interface SettingsState {
  /** 当前工作模板（内置或预设的编辑副本） */
  template: WatermarkTemplate
  templateId: string
  output: OutputSettings
  presets: SavedPreset[]
  /** 模板结构变更（不可变更新，mutator 直接改副本） */
  update: (mutator: (draft: WatermarkTemplate) => void) => void
  updateOutput: (patch: Partial<OutputSettings>) => void
  useTemplate: (id: string) => void
  savePreset: (name: string) => SavedPreset
  deletePreset: (id: string) => void
  replaceFromPreset: (preset: SavedPreset) => void
  importPresetJson: (json: string) => SavedPreset
  exportPresetJson: (preset: SavedPreset) => string
}

function cloneTemplate(template: WatermarkTemplate): WatermarkTemplate {
  return JSON.parse(JSON.stringify(template)) as WatermarkTemplate
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      template: cloneTemplate(getBuiltinTemplate(DEFAULT_TEMPLATE_ID)!),
      templateId: DEFAULT_TEMPLATE_ID,
      output: DEFAULT_OUTPUT,
      presets: [],

      update: (mutator) =>
        set((state) => {
          const draft = cloneTemplate(state.template)
          mutator(draft)
          return { template: draft, templateId: '' }
        }),

      updateOutput: (patch) => set((state) => ({ output: { ...state.output, ...patch } })),

      useTemplate: (id) => {
        const preset = get().presets.find((p) => p.id === id)
        if (preset) {
          set({ template: cloneTemplate(preset.template), templateId: preset.id })
          return
        }
        const builtin = getBuiltinTemplate(id)
        if (builtin) {
          set({ template: cloneTemplate(builtin), templateId: builtin.id })
        }
      },

      savePreset: (name) => {
        const preset: SavedPreset = {
          id: `u${Date.now().toString(36)}`,
          name: name.trim() || '未命名',
          savedAt: Date.now(),
          template: cloneTemplate(get().template)
        }
        set((state) => ({ presets: [preset, ...state.presets].slice(0, 50) }))
        return preset
      },

      deletePreset: (id) =>
        set((state) => ({
          presets: state.presets.filter((p) => p.id !== id),
          templateId: state.templateId === id ? '' : state.templateId
        })),

      replaceFromPreset: (preset) =>
        set({ template: cloneTemplate(preset.template), templateId: preset.id }),

      importPresetJson: (json) => {
        const raw = JSON.parse(json) as Record<string, unknown>
        const template = parseTemplate(
          (raw.template as WatermarkTemplate) ?? raw
        )
        const preset: SavedPreset = {
          id: `u${Date.now().toString(36)}`,
          name: template.name || '导入预设',
          savedAt: Date.now(),
          template
        }
        set((state) => ({ presets: [preset, ...state.presets].slice(0, 50) }))
        return preset
      },

      exportPresetJson: (preset) =>
        JSON.stringify(
          { app: 'picseal', kind: 'preset', version: 1, template: preset.template },
          null,
          2
        )
    }),
    {
      name: 'picseal-settings',
      partialize: (state) => ({
        output: state.output,
        presets: state.presets
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<{ output: OutputSettings; presets: unknown }>
        let presets: SavedPreset[] = []
        if (Array.isArray(p.presets)) {
          const parsed = presetArraySchema.safeParse(p.presets)
          if (parsed.success) {
            presets = parsed.data.flatMap((item) => {
              try {
                return [
                  {
                    ...item,
                    template: parseTemplate(item.template)
                  } satisfies SavedPreset
                ]
              } catch {
                return []
              }
            })
          }
        }
        return {
          ...current,
          output: { ...DEFAULT_OUTPUT, ...(p.output ?? {}) },
          presets
        }
      }
    }
  )
)

export function allTemplateChoices(): Array<{ id: string; name: string; builtin: boolean }> {
  return [
    ...BUILTIN_TEMPLATES.map((t) => ({ id: t.id, name: t.id, builtin: true })),
  ]
}
