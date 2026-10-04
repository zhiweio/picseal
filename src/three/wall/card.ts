/**
 * 卡片装配 —— GLB 模板加载与实体构建（几何由 art/build_photo_case.py 程序化生成，
 * 管线参照 Rhine-Music-Demo build_music_cd.py）。GLB 几何已烘焙在 three.js 最终坐标
 * （中心高度 1.85），前端零归一化；材质名即 surface 名。
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { PHOTO_CASE_ASSET } from './asset'
import { mediaUrl } from '@/core/media-url'
import { configurePhotoGlass } from './materials'

export const CARD = {
  width: 4.45,
  height: 3.35,
  depth: 0.14,
  centerX: 0,
  centerY: 1.85,
  centerZ: 0
} as const

/** 照片装裱窗：悬浮于前盖板玻璃前方，四周留玻璃边 */
export const PRINT = {
  width: 3.72,
  height: 2.88,
  x: 0.103,
  y: CARD.centerY,
  z: CARD.depth / 2 + 0.012
} as const

/** 浏览态当前卡的常抬高度（demo MUSIC_PREVIEW_LIFT） */
export const PREVIEW_LIFT = 0.9
/** 检视态抬升：卡高 + 0.12（demo MUSIC_INSPECTION_LIFT） */
export const INSPECTION_LIFT = CARD.height + 0.12
/** 墙面基线：实例原点的静止 y（卡片几何自带 +1.85 中心高度） */
export const BASE_Y = -4.6

export interface CasePart {
  surface: string
  geometry: THREE.BufferGeometry
}

export interface CaseTemplate {
  parts: CasePart[]
  /** 构建一张可独立驱动材质的选中卡实体（含印刷面占位 mesh，userData.print） */
  buildAssembly(): THREE.Group
  dispose(): void
}

let templatePromise: Promise<CaseTemplate> | null = null

export function loadCaseTemplate(): Promise<CaseTemplate> {
  templatePromise ??= new GLTFLoader()
    .loadAsync(mediaUrl(PHOTO_CASE_ASSET))
    .then((gltf) => {
      gltf.scene.updateMatrixWorld(true)
      const parts: CasePart[] = []
      gltf.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        const surface = (object.material as THREE.Material).name.replace(/\.\d+$/, '')
        parts.push({
          surface,
          geometry: object.geometry.clone().applyMatrix4(object.matrixWorld)
        })
      })
      const surfaces = new Set(parts.map((p) => p.surface))
      for (const required of ['Frosted_Polymer', 'Ivory_Edges', 'Optical_Diffuser'])
        if (!surfaces.has(required)) throw new Error(`photo-case.glb 缺少 ${required} 表面`)
      // bbox 断言：几何必须已在 three 最终坐标（宽 4.45 / 高 3.35 / 厚 0.14，中心 1.85）
      const box = new THREE.Box3()
      for (const part of parts) box.expandByObject(new THREE.Mesh(part.geometry))
      const size = box.getSize(new THREE.Vector3())
      const expected = new THREE.Vector3(CARD.width, CARD.height, CARD.depth)
      if (size.distanceTo(expected) > 0.1)
        throw new Error(`photo-case.glb 尺寸异常：${size.toArray()} ≠ ${expected.toArray()}`)
      return {
        parts,
        buildAssembly(): THREE.Group {
          const group = new THREE.Group()
          for (const part of parts) {
            const material = new THREE.MeshPhysicalMaterial()
            configurePhotoGlass(part.surface, material)
            const mesh = new THREE.Mesh(part.geometry, material)
            mesh.userData.surface = part.surface
            mesh.userData.photoShell = true
            // 只有后扩散板投影：玻璃自身投影会污染透射观感（demo 同规则）
            mesh.castShadow = part.surface === 'Optical_Diffuser'
            mesh.receiveShadow = true
            group.add(mesh)
          }
          const print = new THREE.Mesh(
            printGeometry(),
            new THREE.MeshLambertMaterial({ color: '#ffffff', toneMapped: false })
          )
          print.userData.print = true
          print.receiveShadow = true
          group.add(print)
          return group
        },
        dispose(): void {
          for (const part of parts) part.geometry.dispose()
          printGeometryShared?.dispose()
          printGeometryShared = null
        }
      }
    })
    .catch((error) => {
      templatePromise = null
      throw error
    })
  return templatePromise
}

let printGeometryShared: THREE.PlaneGeometry | null = null

function printGeometry(): THREE.PlaneGeometry {
  printGeometryShared ??= new THREE.PlaneGeometry(PRINT.width, PRINT.height)
  const geo = printGeometryShared.clone()
  geo.translate(PRINT.x, PRINT.y, PRINT.z)
  return geo
}
