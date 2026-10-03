/**
 * 卡片材质 —— 移植自 Rhine-Music-Demo music-model.ts（MIT，© LBEILC / RonaldDeng）。
 * 三表面玻璃配方（baseline/昼间双列）+ 哑光印刷面（图集实例 UV + 防漂白钳制）。
 * 关键：透明全部走 MeshPhysicalMaterial 的 transmission 通道（transparent:false），
 * 印刷面用 alphaTest 而非 transparent —— 否则会从透射缓冲中消失。
 */
import * as THREE from 'three'
import type { ThemeTransition } from './theme-transition'

export type GlassFinish = Pick<
  THREE.MeshPhysicalMaterial,
  'transmission' | 'thickness' | 'roughness' | 'attenuationDistance'
>

/** baseline = 夜间/默认；day = 昼间（更实、更雾，适配浅色背景） */
const GLASS_FINISH: Record<
  string,
  { baseline: GlassFinish; day: GlassFinish; dayColor: string }
> = {
  Frosted_Polymer: {
    baseline: { transmission: 0.96, thickness: 0.026, roughness: 0.4, attenuationDistance: 4.5 },
    day: { transmission: 0.88, thickness: 0.1, roughness: 0.48, attenuationDistance: 1.2 },
    dayColor: '#f3f0e9'
  },
  Ivory_Edges: {
    baseline: { transmission: 0.84, thickness: 0.06, roughness: 0.25, attenuationDistance: 4.5 },
    day: { transmission: 0.66, thickness: 0.1, roughness: 0.34, attenuationDistance: 1.2 },
    dayColor: '#e6ddd1'
  },
  Optical_Diffuser: {
    baseline: { transmission: 0.66, thickness: 0.035, roughness: 0.4, attenuationDistance: 4.5 },
    day: { transmission: 0.56, thickness: 0.07, roughness: 0.46, attenuationDistance: 1.2 },
    dayColor: '#eee8df'
  }
}

/** 磨砂玻璃壳的统一底色：磨砂聚合物之下是柔和的表面印刷 */
export function configurePhotoGlass(surface: string, material: THREE.MeshPhysicalMaterial): void {
  material.color.set('#fffdfa')
  material.metalness = 0
  material.envMapIntensity = 0.65
  material.ior = 1.46
  material.attenuationColor.set('#f3e9db')
  material.attenuationDistance = 4.5
  material.clearcoat = 0.16
  material.clearcoatRoughness = 0.2
  material.transparent = false
  material.opacity = 1
  const finish = GLASS_FINISH[surface]
  if (finish) Object.assign(material, finish.baseline)
  material.userData.photoShell = true
}

/** 浅色背景需要更实的体密度与可读的哑光边缘 */
export function setPhotoGlassTheme(
  surface: string,
  material: THREE.MeshPhysicalMaterial,
  day: boolean,
  transition: ThemeTransition
): void {
  const finish = GLASS_FINISH[surface]
  if (!material.userData.photoShell || !finish) return
  const target = day ? finish.day : finish.baseline
  for (const key of ['transmission', 'thickness', 'roughness', 'attenuationDistance'] as const)
    transition.number(material, key, target[key])
  if (day) transition.color(material.color, finish.dayColor)
}

/** 检视柔化磨砂但永不成抛光塑料；印刷面在本材质之前，完全独立 */
export function setPhotoGlassClarity(
  material: THREE.MeshPhysicalMaterial,
  clarity: number,
  warmth = 0
): void {
  const finish = GLASS_FINISH['Frosted_Polymer']!
  const daylight = THREE.MathUtils.clamp(warmth, 0, 1)
  material.roughness = THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(finish.baseline.roughness, finish.day.roughness, daylight),
    THREE.MathUtils.lerp(0.3, 0.44, daylight),
    THREE.MathUtils.clamp(clarity, 0, 1)
  )
}

/**
 * 印刷材质（图集 + 实例 UV）：哑光受光，但强光不漂白印刷色
 * （`outgoingLight = min(outgoingLight, diffuseColor.rgb)` 原式）；
 * coverTile 实例属性逐实例取样图集瓦片。
 */
export function createPrintMaterial(
  map: THREE.Texture,
  shadePrint?: (shader: THREE.WebGLProgramParametersWithUniforms) => void
): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    map,
    alphaTest: 0.025,
    toneMapped: false,
    fog: true
  })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', 'attribute vec4 coverTile;\n#include <common>')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = coverTile.xy + uv * coverTile.zw;')
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      'outgoingLight = min(outgoingLight, diffuseColor.rgb);\n#include <opaque_fragment>'
    )
    shadePrint?.(shader)
  }
  material.customProgramCacheKey = () => 'picseal-photo-print-v1'
  return material
}

/**
 * 选中卡的高清印刷面：与实例版同样的防漂白 + 光柱衰减，但无 coverTile
 * 实例属性（非实例网格不应声明未提供的 attribute）。
 */
export function createHeroPrintMaterial(
  map: THREE.Texture,
  shadePrint?: (shader: THREE.WebGLProgramParametersWithUniforms) => void
): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    map,
    // contain 装裱的透明边由此剔除，玻璃从照片四周透出（与墙面瓦片同观感）
    alphaTest: 0.05,
    toneMapped: false,
    fog: true
  })
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      'outgoingLight = min(outgoingLight, diffuseColor.rgb);\n#include <opaque_fragment>'
    )
    shadePrint?.(shader)
  }
  material.customProgramCacheKey = () => 'picseal-photo-print-hero-v1'
  return material
}
