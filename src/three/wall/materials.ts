/**
 * 卡片材质 —— 移植自 Rhine-Music-Demo music-model.ts / scene.ts（MIT，© LBEILC / RonaldDeng）。
 * 磨砂玻璃壳（MeshPhysicalMaterial transmission）+ 封面图集平面（哑光印刷，
 * 注入防漂白钳制），照片悬浮于玻璃前面、四周露出透明玻璃边框。
 */
import * as THREE from 'three'

/** 档案盒尺寸（demo MUSIC_MODEL：4.45 × 3.35 × 0.14） */
export const CASE = { width: 4.45, height: 3.35, depth: 0.14 }
/** 照片装裱窗：悬浮于玻璃前面，四周留玻璃透明边（demo 封面 +0.012 偏移同款） */
export const COVER = { width: 3.72, height: 2.88, z: CASE.depth / 2 + 0.012 }

export interface CaseMaterials {
  /** 阵列磨砂玻璃壳 */
  frosted: THREE.MeshPhysicalMaterial
  /** 选中卡的 hero 玻璃（更高透度、更薄） */
  hero: THREE.MeshPhysicalMaterial
  dispose(): void
}

/**
 * 阵列版磨砂玻璃（demo scene.ts 阵列 Frosted_Polymer 参数）：
 * transmission 0.78 / roughness 0.28 / clearcoat 0.3 —— 通透但保留磨砂质感。
 * instanced 网格无法递归采样屏幕空间透射，无需再分部位。
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

  const hero = new THREE.MeshPhysicalMaterial({
    color: '#f8f4ee',
    metalness: 0,
    roughness: 0.21,
    transmission: 0.9,
    thickness: 0.12,
    ior: 1.46,
    attenuationColor: new THREE.Color('#eee6df'),
    attenuationDistance: 2,
    clearcoat: 0.3,
    clearcoatRoughness: 0.22,
    envMapIntensity: 0.65
  })

  return {
    frosted,
    hero,
    dispose() {
      frosted.dispose()
      hero.dispose()
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
}

/**
 * 封面印刷材质（图集 + 实例 UV）：哑光受光，但强光不漂白印刷色
 * （注入 `outgoingLight = min(outgoingLight, diffuseColor.rgb)`，demo 原式）；
 * coverTile 实例属性逐实例取样图集瓦片（demo cover-atlas.ts 原式）。
 */
export function createCoverMaterial(map: THREE.Texture): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    map,
    transparent: true,
    alphaTest: 0.02,
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
  }
  material.customProgramCacheKey = () => 'picseal-cover-v2'
  return material
}
