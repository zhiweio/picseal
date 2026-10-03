/**
 * 选中卡照明 —— 移植自 Rhine-Music-Demo music-lighting.ts（MIT，© LBEILC / RonaldDeng）。
 * WebGL 透射无法在玻璃层间传播光：这里用有界的暖散射项近似书脊→面板的光传输，
 * 外加一盏弹簧跟随的侧逆光聚光灯。印刷面（shadePrint）只分享移动光柱、绝不发光。
 */
import * as THREE from 'three'
import { CARD } from './card'
import { ThemeTransition } from './theme-transition'

export class SelectionLighting {
  readonly spot = new THREE.SpotLight('#ffe3b2', 180 * 64, 0, 0.32, 0.95, 2)
  private readonly aim = new THREE.Vector3()
  private readonly anchor = new THREE.Vector3()
  private readonly offset = new THREE.Vector3()
  private readonly anchorVelocity = new THREE.Vector3()
  private readonly columnVelocity = new THREE.Vector3()
  private initialized = false
  private readonly column = { value: new THREE.Vector3() }
  private readonly scatterColor = { value: new THREE.Color('#ffdba3') }
  private readonly scatterStrength = { value: 1 }
  private readonly printAmbient = { value: 0.5 }
  private readonly shellBounds = { value: new THREE.Vector4(
    CARD.centerX - CARD.width / 2,
    CARD.centerY - CARD.height / 2,
    CARD.centerY + CARD.height / 2,
    1 / CARD.height
  ) }
  private readonly edgeFalloff = { value: new THREE.Vector2(1.7, 24) }

  constructor(private readonly scene: THREE.Scene) {
    this.spot.name = 'Selected photo soft key'
    // 现有柔和接触阴影已足够；局部主光不再为整面玻璃阵列追加第二次阴影渲染。
    this.spot.castShadow = false
    this.spot.visible = false
    scene.add(this.spot, this.spot.target)
  }

  setTheme(theme: 'night' | 'day', key: THREE.DirectionalLight, transition?: ThemeTransition): void {
    const night = theme === 'night'
    const targets = transition ?? new ThemeTransition()
    targets.number(this.scene, 'environmentIntensity', night ? 0.16 : 0.25)
    targets.number(key, 'intensity', night ? 0.3 : 0.45)
    for (const child of this.scene.children) {
      if (child instanceof THREE.HemisphereLight)
        targets.number(child, 'intensity', night ? 0.21 : 0.32)
      if (child instanceof THREE.DirectionalLight && child !== key)
        targets.number(child, 'intensity', 0.045)
    }
    targets.color(this.spot.color, night ? '#dbe9ff' : '#ffe3b2')
    targets.number(this.spot, 'intensity', (night ? 130 : 180) * 64)
    targets.color(this.scatterColor.value, night ? '#cee5ff' : '#ffdba3')
    targets.number(this.scatterStrength, 'value', night ? 0.85 : 1)
    // 夜间邻居封面保持可读：光柱之外的印刷面不能压成黑块（对齐 demo 的货架观感）
    targets.number(this.printAmbient, 'value', night ? 0.34 : 0.5)
    if (!transition) targets.finish()
  }

  /** 印刷面分享移动光柱：扩散光只衰减、绝不加白（实例原点取世界变换，换 mesh 不换曝光） */
  shadePrint(shader: THREE.WebGLProgramParametersWithUniforms): void {
    shader.uniforms.photoPrintLightColumn = this.column
    shader.uniforms.photoPrintAmbient = this.printAmbient
    shader.vertexShader = 'varying vec3 vPhotoPrintOrigin;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec4 photoPrintOrigin = vec4(0.0, 0.0, 0.0, 1.0);
      #ifdef USE_INSTANCING
        photoPrintOrigin = instanceMatrix * photoPrintOrigin;
      #endif
      vPhotoPrintOrigin = (modelMatrix * photoPrintOrigin).xyz;`
    )
    shader.fragmentShader =
      'varying vec3 vPhotoPrintOrigin;\nuniform vec3 photoPrintLightColumn;\nuniform float photoPrintAmbient;\n' +
      shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `// 低位的局部主光只照亮邻近行列；抬起的封面留在光里、邻卡落入影中。
      vec3 printDistance = (vPhotoPrintOrigin - photoPrintLightColumn) / vec3(6.0, 3.35, 5.5);
      float printLight = exp(-dot(printDistance, printDistance));
      outgoingLight *= mix(photoPrintAmbient, 1.0, printLight);
      #include <opaque_fragment>`
    )
  }

  /** 实例、抬起卡与返回副本共用；无额外渲染 pass。 */
  shade(shader: THREE.WebGLProgramParametersWithUniforms, surface: string): void {
    if (surface === 'Photo_Print') return
    shader.uniforms.photoLightColumn = this.column
    shader.uniforms.photoScatterColor = this.scatterColor
    shader.uniforms.photoScatterStrength = this.scatterStrength
    shader.uniforms.photoShellBounds = this.shellBounds
    shader.uniforms.photoEdgeFalloff = this.edgeFalloff
    const declarations = 'varying vec3 vPhotoLocal;\nvarying vec3 vPhotoOrigin;\n'
    shader.vertexShader = declarations + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vPhotoLocal = position;
      vec4 photoOrigin = vec4(0.0, 0.0, 0.0, 1.0);
      #ifdef USE_INSTANCING
        photoOrigin = instanceMatrix * photoOrigin;
      #endif
      vPhotoOrigin = (modelMatrix * photoOrigin).xyz;`
    )
    shader.fragmentShader =
      declarations +
      'uniform vec3 photoLightColumn;\nuniform vec3 photoScatterColor;\nuniform float photoScatterStrength;\nuniform vec4 photoShellBounds;\nuniform vec2 photoEdgeFalloff;\n' +
      shader.fragmentShader
    const glass = surface === 'Frosted_Polymer'
    const spine = surface === 'Ivory_Edges'
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      float laneDistance = abs(vPhotoOrigin.x - photoLightColumn.x);
      float laneRadius = laneDistance / 3.2;
      float coreLight = exp(-laneRadius * laneRadius * laneRadius * laneRadius);
      float spillRadius = laneDistance / 7.2;
      float spillLight = exp(-spillRadius * spillRadius * spillRadius * spillRadius);
      float laneLight = 0.58 * coreLight + 0.42 * spillLight;
      float rowDistance = (vPhotoOrigin.z - photoLightColumn.z) / 5.5;
      float rowLight = exp(-rowDistance * rowDistance);
      float hotDistance = (vPhotoOrigin.z - photoLightColumn.z) / 1.1;
      float hotLight = exp(-hotDistance * hotDistance);
      float neighborDistance = (vPhotoOrigin.z - photoLightColumn.z) / 2.4;
      float neighborLight = exp(-neighborDistance * neighborDistance);
      float guidedLight = 0.58 * coreLight * mix(0.12, 1.0, rowLight)
                        + 0.42 * spillLight * neighborLight;
      outgoingLight *= mix(0.96, 1.04, guidedLight);
      ${glass || spine ? `
        float fromSpine = max(0.0, vPhotoLocal.x - photoShellBounds.x);
        float edgeTransport = exp(-fromSpine * photoEdgeFalloff.x);
        float panelHeight = clamp((vPhotoLocal.y - photoShellBounds.y) * photoShellBounds.w, 0.0, 1.0);
        float lowerLight = mix(1.0, 0.62, panelHeight);
        float topRim = exp(-max(0.0, photoShellBounds.z - vPhotoLocal.y) * photoEdgeFalloff.y);
        float grazing = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
        // 全玻璃化：脊面与玻璃同档的柔和散射（原 0.30 的强暖散射是"金属边框"观感来源）
        float edgeScatter = ${spine ? '0.16' : '0.12'} * edgeTransport + ${spine ? '0.006' : '0.003'};
        outgoingLight += photoScatterColor * photoScatterStrength * guidedLight * edgeScatter * lowerLight;
        float ribbon = topRim * (0.22 + 0.78 * edgeTransport) + ${spine ? '0.07' : '0.035'} * edgeTransport * grazing;
        outgoingLight += photoScatterColor * photoScatterStrength * laneLight * hotLight * ribbon * 0.8;
      ` : ''}
      #include <opaque_fragment>`
    )
  }

  private follow(value: THREE.Vector3, velocity: THREE.Vector3, target: THREE.Vector3, dt: number): void {
    const rate = 5.0
    const decay = Math.exp(-rate * dt)
    for (const axis of ['x', 'y', 'z'] as const) {
      const delta = value[axis] - target[axis]
      const impulse = velocity[axis] + rate * delta
      value[axis] = target[axis] + (delta + impulse * dt) * decay
      velocity[axis] = (velocity[axis] - rate * impulse * dt) * decay
    }
  }

  update(model: THREE.Object3D, camera: THREE.Camera, dt: number, visible: boolean, reduced: boolean): void {
    this.spot.visible = visible
    if (!visible) {
      this.initialized = false
      return
    }
    model.updateWorldMatrix(true, false)
    this.aim
      .set(CARD.centerX - CARD.width / 2 + 0.14, CARD.centerY + CARD.height * 0.12, CARD.centerZ)
      .applyMatrix4(model.matrixWorld)
    if (!this.initialized || reduced) {
      this.anchor.copy(this.aim)
      this.column.value.copy(model.position)
      this.anchorVelocity.set(0, 0, 0)
      this.columnVelocity.set(0, 0, 0)
    } else {
      this.follow(this.anchor, this.anchorVelocity, this.aim, dt)
      this.follow(this.column.value, this.columnVelocity, model.position, dt)
    }
    this.initialized = true
    this.spot.target.position.copy(this.anchor)
    // 相机局部 -X/-Y：光从画面左下入射掠过书脊，而不是从上方照亮卡面。
    this.offset.set(-6, -2.2, 4.5).multiplyScalar(8).applyQuaternion(camera.quaternion)
    this.spot.position.copy(this.anchor).add(this.offset)
  }
}
