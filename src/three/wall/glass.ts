/**
 * 玻璃外观系统 —— 移植自 Rhine-Music-Demo glass-reveal.ts / appearance.ts（MIT，© LBEILC / RonaldDeng）。
 * 三件事：
 * 1) 有界磨砂 LOD：three 的 mipmap 规则让磨砂模糊随视口缩小而变大，这里把磨砂足迹
 *    钳制在投影卡高的 1.6% 内（跨屏尺寸一致的雾感）；
 * 2) 玻璃揭示：一条羽化的"清澈锋面"自卡顶向卡底推进（roughness 0.42 → 0.025），
 *    这就是"完全透明 + 磨砂"共存的核心质感；
 * 3) CardAppearance：墙面副本（quality 0）↔ 抬起卡（quality 1）的连续外观插值，
 *    clarity 驱动揭示进度与检视柔化。
 */
import * as THREE from 'three'
import { CARD } from './card'
import { setPhotoGlassClarity, setPhotoGlassTheme } from './materials'
import { ThemeTransition } from './theme-transition'
import type { SelectionLighting } from './lighting'

type Surface = THREE.MeshPhysicalMaterial
type Palette = { high: Surface; low?: Surface }

/** 一条羽化的清澈锋面自顶向底推进；端点分别是全磨砂/全清澈（含边缘） */
const FEATHER = 0.12
export const FROSTED_ROUGHNESS = 0.42
export const CLEAR_ROUGHNESS = 0.025
const FROST_SPAN = 0.016

export const frostedTransmissionGLSL = `
float archiveTransmissionLod(float roughness, float ior, vec2 samplerSize) {
  float nativeLod = log2(samplerSize.x) * roughness * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
  float strength = clamp((roughness - ${CLEAR_ROUGHNESS}) / ${FROSTED_ROUGHNESS - CLEAR_ROUGHNESS}, 0.0, 1.0);
  float panelPixels = length(vArchiveProjectedAxis * samplerSize);
  float clearLod = log2(samplerSize.x) * ${CLEAR_ROUGHNESS} * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
  float boundedLod = log2(max(exp2(clearLod), panelPixels * ${FROST_SPAN} * pow(strength, 1.15)));
  return mix(nativeLod, min(nativeLod, boundedLod), archiveQuality);
}`

export const glassRevealGLSL = `
float glassRevealAtHeight(float progress, float height) {
  float edge = 1.0 - ${1 + 2 * FEATHER} * clamp(progress, 0.0, 1.0);
  return smoothstep(edge, edge + ${2 * FEATHER}, clamp(height, 0.0, 1.0));
}`

export function glassRevealAtHeight(progress: number, height: number): number {
  const edge = 1 - (1 + 2 * FEATHER) * Math.max(0, Math.min(1, progress))
  const x = Math.max(0, Math.min(1, (Math.max(0, Math.min(1, height)) - edge) / (2 * FEATHER)))
  return x * x * (3 - 2 * x)
}

/** 卡片几何 y ∈ [centerY - h/2, centerY + h/2] → 归一化高度 0..1 */
const BASE_Y = CARD.centerY - CARD.height / 2
const HALF_HEIGHT = CARD.height / 2

/**
 * 阵列与选中卡共享几何；在一张 mesh 上随抬起连续变形表面属性，
 * 透明壳体在画质切换时永不重叠。
 */
export class CardAppearance {
  selectionLighting?: SelectionLighting
  private palettes = new Map<string, Palette>()
  private warmth = { value: 1 }

  register(name: string, high: Surface, low?: Surface): void {
    // 在任何插值之前恰好捕获一次未上主题的调色板。
    for (const mat of [high, low])
      if (mat) {
        mat.userData.dayColor ??= mat.color.clone()
        mat.userData.dayAttenuation ??= mat.attenuationColor?.clone()
      }
    this.palettes.set(name, { high, low })
  }

  prepare(group: THREE.Group): void {
    for (const child of group.children) {
      const mesh = child as THREE.Mesh
      const name = mesh.userData.surface as string
      const palette = this.palettes.get(name)
      if (!palette) continue
      const mat = palette.high.clone()
      const amount = { value: 0 }
      const clarity = { value: 0 }
      mesh.material = mat
      mesh.userData.appearance = amount
      mesh.userData.glassClarity = clarity
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.archiveQuality = amount
        shader.uniforms.archiveClarity = clarity
        shader.uniforms.archiveWarmth = this.warmth
        shader.fragmentShader =
          'uniform float archiveQuality;\nuniform float archiveClarity;\nuniform float archiveWarmth;\n' +
          shader.fragmentShader
        if (name === 'Frosted_Polymer') {
          shader.vertexShader =
            'varying float vArchiveHeight;\nvarying vec2 vArchiveProjectedAxis;\n' + shader.vertexShader
          shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>\nvArchiveHeight = (position.y - ${BASE_Y}) / ${CARD.height};`
          )
          shader.fragmentShader =
            'varying float vArchiveHeight;\nvarying vec2 vArchiveProjectedAxis;\n' +
            glassRevealGLSL +
            shader.fragmentShader
          shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `#include <project_vertex>\nvArchiveProjectedAxis = ${HALF_HEIGHT} * vec2(projectionMatrix[0][0] * modelViewMatrix[1][0], projectionMatrix[1][1] * modelViewMatrix[1][1]) / max(0.0001, abs(mvPosition.z));`
          )
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <transmission_pars_fragment>',
            frostedTransmissionGLSL +
              '\n' +
              THREE.ShaderChunk.transmission_pars_fragment.replace(
                'float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );',
                'float lod = archiveTransmissionLod(roughness, ior, transmissionSamplerSize);'
              )
          )
          // 高度渐变暖色 tint：夜冷顶 / 暖底，昼间还原
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <color_fragment>',
            `#include <color_fragment>
vec3 archiveTint = mix(mix(vec3(0.68, 0.76, 0.86), vec3(1.0), smoothstep(0.1, 1.0, vArchiveHeight)), mix(vec3(0.40, 0.30, 0.20), vec3(1.0, 0.98, 0.94), smoothstep(0.1, 1.0, vArchiveHeight)), archiveWarmth);
diffuseColor.rgb *= mix(archiveTint, vec3(1.0), archiveQuality);`
          )
          // 揭示：磨砂粗糙度被锋面替换为清澈
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
roughnessFactor = mix(mix(0.28, ${FROSTED_ROUGHNESS}, archiveQuality), 0.025, glassRevealAtHeight(archiveClarity, vArchiveHeight));`
          )
        }
        this.selectionLighting?.shade(shader, name)
      }
      mat.customProgramCacheKey = () =>
        `photo-surface-clarity-${name}-${Boolean(palette.low)}`
    }
  }

  setClarity(group: THREE.Group, value: number): void {
    const clarity = THREE.MathUtils.clamp(value, 0, 1)
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.userData.glassClarity) return
      child.userData.glassClarity.value = clarity
      if (child.userData.surface === 'Frosted_Polymer')
        setPhotoGlassClarity(child.material as Surface, clarity, this.warmth.value)
    })
  }

  apply(group: THREE.Group, value: number): void {
    for (const child of group.children) {
      const mesh = child as THREE.Mesh
      const palette = this.palettes.get(mesh.userData.surface)
      if (!palette) {
        if (mesh.userData.print) continue
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = value
        continue
      }
      mesh.userData.appearance.value = value
      const { high, low } = palette
      if (!low) continue
      const mat = mesh.material as Surface
      mat.color.copy(low.color).lerp(high.color, value)
      if (mat.attenuationColor && low.attenuationColor && high.attenuationColor) {
        mat.attenuationColor.copy(low.attenuationColor).lerp(high.attenuationColor, value)
        mat.attenuationDistance = THREE.MathUtils.lerp(
          low.attenuationDistance,
          high.attenuationDistance,
          value
        )
      }
      for (const key of [
        'roughness',
        'metalness',
        'transmission',
        'thickness',
        'clearcoat',
        'clearcoatRoughness'
      ] as const) {
        mat[key] = THREE.MathUtils.lerp(low[key] ?? 0, high[key] ?? 0, value)
      }
      // 过渡全程保持同一 transmission shader/pass
      if (high.transmission > 0) mat.transmission = Math.max(0.000001, mat.transmission)
    }
  }

  setTheme(theme: 'night' | 'day', transition?: ThemeTransition): void {
    const targets = transition ?? new ThemeTransition()
    targets.number(this.warmth, 'value', theme === 'day' ? 1 : 0)
    for (const [name, palette] of this.palettes) {
      for (const mat of [palette.high, palette.low]) {
        if (!mat) continue
        if (theme === 'day') {
          targets.color(mat.color, mat.userData.dayColor)
          if (mat.userData.dayAttenuation) targets.color(mat.attenuationColor, mat.userData.dayAttenuation)
        } else if (['Frosted_Polymer', 'Ivory_Edges'].includes(name)) {
          targets.color(mat.color, '#f6fbff')
          if (mat.attenuationColor) targets.color(mat.attenuationColor, '#dceafd')
        } else if (name === 'Optical_Diffuser') {
          targets.color(mat.color, '#c6d6e5')
        }
        setPhotoGlassTheme(name, mat, theme === 'day', targets)
      }
    }
    if (!transition) targets.finish()
  }

  dispose(group: THREE.Group): void {
    for (const child of group.children) {
      const mesh = child as THREE.Mesh
      const mat = mesh.material as THREE.MeshBasicMaterial
      if (mesh.userData.print) mesh.userData.printDisposed = true
      if (!mesh.userData.surface) mat.map?.dispose()
      mat.dispose()
    }
  }
}
