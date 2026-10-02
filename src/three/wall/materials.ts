/**
 * 卡片材质 —— 移植自 Rhine-Music-Demo music-model.ts（MIT）。
 * 玻璃壳三部位 MeshPhysicalMaterial（transmission 玻璃）+
 * 封面 MeshLambertMaterial（哑光印刷，注入防漂白钳制）。
 */
import * as THREE from 'three'

/** 印刷面尺寸（案例盒 4.45×3.35×0.14，封面 2.98×2.98 悬浮于玻璃前） */
export const CASE = { width: 4.45, height: 3.35, depth: 0.14 }
export const PRINT = { width: 3.9, height: 2.7, z: CASE.depth / 2 + 0.012 }

/** 照片 cover 裁切进方形印刷窗的 UV（atlas tile 内） */
export function coverUV(aspect: number): { sx: number; sy: number } {
  // aspect = 图片宽/高；印刷窗为方形 → 长边铺满、短边居中裁切
  if (aspect >= 1) return { sx: 1, sy: 1 / aspect }
  return { sx: aspect, sy: 1 }
}

export interface CaseMaterials {
  frosted: THREE.MeshPhysicalMaterial
  edges: THREE.MeshPhysicalMaterial
  diffuser: THREE.MeshPhysicalMaterial
  /** 仅 diffuser 投射阴影（demo 同款） */
  dispose(): void
}

/**
 * 阵列版玻璃三部位（demo scene.ts L272-371 的参数）。
 * 夜间通用值；昼间由 setTheme 调整 transmission/roughness/color。
 */
export function createCaseMaterials(): CaseMaterials {
  const frosted = new THREE.MeshPhysicalMaterial({
    color: '#fff7ed',
    metalness: 0,
    roughness: 0.28,
    transmission: 0.78,
    thickness: 0.28,
    ior: 1.46,
    attenuationColor: new THREE.Color('#d4c7b4'),
    attenuationDistance: 1.2,
    clearcoat: 0.3,
    clearcoatRoughness: 0.25,
    envMapIntensity: 0.65
  })

  const edges = new THREE.MeshPhysicalMaterial({
    color: '#fff5e9',
    metalness: 0,
    roughness: 0.38,
    transmission: 0,
    envMapIntensity: 0.65
  })

  const diffuser = new THREE.MeshPhysicalMaterial({
    color: '#cbb69c',
    metalness: 0,
    roughness: 0.4,
    transmission: 0.66,
    thickness: 0.035,
    ior: 1.46,
    envMapIntensity: 0.65
  })

  return {
    frosted,
    edges,
    diffuser,
    dispose() {
      frosted.dispose()
      edges.dispose()
      diffuser.dispose()
    }
  }
}

/** 昼间主题的玻璃参数回调（demo configureMusicGlass 的 day 列） */
export function applyDayFinish(m: CaseMaterials): void {
  m.frosted.transmission = 0.88
  m.frosted.roughness = 0.48
  m.frosted.thickness = 0.1
  m.frosted.attenuationColor = new THREE.Color('#f3e9db')
  m.frosted.attenuationDistance = 4.5
  m.frosted.color = new THREE.Color('#f3f0e9')
  m.edges.transmission = 0
  m.edges.roughness = 0.34
  m.edges.color = new THREE.Color('#e6ddd1')
  m.diffuser.transmission = 0.56
  m.diffuser.roughness = 0.46
}

/**
 * 封面印刷材质：哑光受光（接受光照与阴影），但强光不漂白印刷色。
 * 注入 `outgoingLight = min(outgoingLight, diffuseColor.rgb)`（demo 原式）。
 */
export function createPrintMaterial(map: THREE.Texture | null): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    map,
    alphaTest: 0.025,
    toneMapped: false,
    fog: true
  })
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      'outgoingLight = min(outgoingLight, diffuseColor.rgb);\n#include <opaque_fragment>'
    )
  }
  material.customProgramCacheKey = () => 'picseal-print-v1'
  return material
}
