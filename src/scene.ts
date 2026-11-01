import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { type Box, FRAME, type HaloModel, placement, type Transform } from "./halo"

const MODEL_BASE = "https://cdn.jsdelivr.net/gh/lihaohong6/BlueArchiveModels@main/"
/** Share of the frame's height the whole character fills right after loading. */
const MODEL_FIT = 0.85

const loader = new GLTFLoader()

/** Camera matching the 2D projection: the frame fills the view at z = 0, and `perspective` is the camera distance. */
const camera = (t: Transform, box: Box) => {
  const half = FRAME.width / 2
  const view =
    t.perspective > 0
      ? new THREE.PerspectiveCamera(2 * THREE.MathUtils.radToDeg(Math.atan(half / t.perspective)), 1, 0.05, 1000)
      : new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 1000)
  view.position.z = t.perspective > 0 ? t.perspective : 500
  view.setViewOffset(FRAME.width, FRAME.height, box.x - FRAME.x, box.y - FRAME.y, box.width, box.height)
  view.updateProjectionMatrix()
  view.updateMatrixWorld()
  return view
}

/** The part of the scene to draw, and the canvas size in pixels to draw it at. */
export type Viewport = { box: Box; width: number; height: number }

const renderer = (canvas: HTMLCanvasElement) =>
  new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })

/** Resizing a canvas clears it, even to the same size. */
const resize = (gl: THREE.WebGLRenderer, { width, height }: Viewport) => {
  if (gl.domElement.width !== width || gl.domElement.height !== height) gl.setSize(width, height, false)
}

const unlit = (material: THREE.Material | THREE.Material[]) => {
  const { map, transparent, alphaTest } = (
    Array.isArray(material) ? material[0] : material
  ) as THREE.MeshStandardMaterial
  return new THREE.MeshBasicMaterial({ map, transparent, alphaTest, side: THREE.DoubleSide })
}

const meshes = (root: THREE.Object3D) => {
  const found: THREE.Mesh[] = []
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) found.push(o)
  })
  return found
}

const place = (o: THREE.Object3D, matrix: THREE.Matrix4) => {
  o.matrixAutoUpdate = false
  o.matrix.copy(matrix)
  o.updateMatrixWorld(true)
}

const dispose = (root: THREE.Object3D) => {
  for (const m of meshes(root)) {
    m.geometry.dispose()
    ;(m.material as THREE.MeshBasicMaterial).map?.dispose()
  }
}

/** `textured` tints meshes with a texture; `plain` colors meshes without one. */
export type HaloColors = { textured: string; plain: string }

/** Halo drawn on its own canvas, so the page can filter it with a glow. */
export const createHaloView = (canvas: HTMLCanvasElement) => {
  const gl = renderer(canvas)
  const scene = new THREE.Scene()
  let halo: THREE.Object3D | undefined
  let vertices: number[] = []
  let loads = 0

  const draw = (t: Transform, colors: HaloColors, viewport: Viewport) => {
    if (!halo) return
    resize(gl, viewport)
    for (const m of meshes(halo)) {
      const material = m.material as THREE.MeshBasicMaterial
      material.color.set(material.map ? colors.textured : colors.plain)
    }
    place(halo, new THREE.Matrix4().fromArray(placement(t)))
    gl.render(scene, camera(t, viewport.box))
  }

  return {
    /** Loads a halo GLB and returns its vertices as a flat [x, y, z, ...] list; a newer load discards this one. */
    load: async (url: string) => {
      const id = ++loads
      const { scene: loaded } = await loader.loadAsync(url)
      if (id !== loads) return
      if (halo) {
        scene.remove(halo)
        dispose(halo)
      }
      halo = loaded
      scene.add(halo)
      for (const m of meshes(halo)) m.material = unlit(m.material)
      vertices = meshes(halo).flatMap((m) => [...m.geometry.attributes.position.array])
      return vertices
    },
    draw,
    /** The halo alone at `width` x `height` pixels, cropped to `box`, as a PNG data URL; draw again to restore. */
    capture: (o: Viewport & { t: Transform; colors: HaloColors }) => {
      draw(o.t, o.colors, o)
      return canvas.toDataURL("image/png")
    },
  }
}

export type Pose = { turn: number[]; shift: number[] }

/** Character model as a reference on its own canvas, excluded from exports. */
export const createModelView = (canvas: HTMLCanvasElement) => {
  const gl = renderer(canvas)
  const scene = new THREE.Scene()
  let root: THREE.Object3D | undefined
  let mixer: THREE.AnimationMixer | undefined
  let clips: THREE.AnimationClip[] = []
  let node: THREE.Object3D | undefined
  let fromHalo = new THREE.Matrix4()
  /** From halo units to model space in the current pose. */
  let haloPose = new THREE.Matrix4()
  let loads = 0

  const measure = () => {
    if (!root || !node) return haloPose
    place(root, new THREE.Matrix4())
    return new THREE.Matrix4().multiplyMatrices(node.matrixWorld, fromHalo)
  }

  const draw = (t: Transform, viewport: Viewport) => {
    if (!root) return gl.clear()
    resize(gl, viewport)
    const body = new THREE.Matrix4().fromArray(placement(t)).multiply(haloPose.clone().invert())
    place(root, body)
    gl.render(scene, camera(t, viewport.box))
  }

  const clear = () => {
    if (root) {
      scene.remove(root)
      dispose(root)
    }
    root = undefined
    mixer?.stopAllAction()
    gl.clear()
  }

  return {
    clear,
    draw,
    /**
     * Loads a model file and returns its animations and the transform that shows the whole upright character; a newer
     * load discards this one.
     */
    load: async (fit: HaloModel) => {
      const id = ++loads
      const gltf = await loader.loadAsync(MODEL_BASE + encodeURIComponent(fit.file))
      if (id !== loads) return
      clear()
      root = gltf.scene
      clips = gltf.animations
      mixer = new THREE.AnimationMixer(root)
      const all = meshes(root)
      node = all.find((m) => /halo/i.test(m.name))
      if (!node) throw new Error(`${fit.file}: no halo mesh`)
      const haloName = node.name.replace(/_\d+$/, "")
      const mouths = all.filter((m) => /^Mouth_/.test(m.name))
      for (const m of all) {
        m.frustumCulled = false
        m.material = unlit(m.material)
        m.visible = !mouths.includes(m) || m === mouths[0]
      }
      // Writes transparent pixels where the halo is in front, so the halo canvas below shows through.
      const hole = new THREE.MeshBasicMaterial({
        transparent: true,
        color: 0x000000,
        opacity: 0,
        blending: THREE.NoBlending,
        side: THREE.DoubleSide,
      })
      for (const m of all) {
        if (m.name.replace(/_\d+$/, "") === haloName) m.material = hole
      }
      scene.add(root)

      const b = fit.basis
      const [sx, sy, sz] = fit.scale
      fromHalo = new THREE.Matrix4()
        .makeScale(1 / sx, 1 / sy, 1 / sz)
        .multiply(new THREE.Matrix4().set(b[0], b[3], b[6], 0, b[1], b[4], b[7], 0, b[2], b[5], b[8], 0, 0, 0, 0, 1))
        .multiply(new THREE.Matrix4().makeTranslation(fit.center[0], fit.center[1], fit.center[2]))
        .multiply(new THREE.Matrix4().makeScale(1 / fit.unit, 1 / fit.unit, 1 / fit.unit))
      haloPose = measure()

      const size = new THREE.Box3().setFromObject(root, true)
      const scale = (MODEL_FIT * FRAME.height) / (size.max.y - size.min.y) / fit.unit
      // Upright body: the halo's rotation in the model is its rotation on screen.
      const turn = new THREE.Matrix4().extractRotation(haloPose).elements
      const haloY = new THREE.Vector3().setFromMatrixPosition(haloPose).y
      return {
        animations: clips.map((c) => ({ name: c.name, duration: c.duration })),
        turn: [turn[0], turn[4], turn[8], turn[1], turn[5], turn[9], turn[2], turn[6], turn[10]],
        scale,
        // Weapons widen the bounds, so only the height centers the body; the halo stays on the vertical axis.
        position: [0, (haloY - (size.min.y + size.max.y) / 2) * scale * fit.unit, 0],
      }
    },
    /**
     * Moves the character to a frame of the animation at index `clip`, or to its rest pose without one, and returns how
     * the halo moved in its own frame, so the body can stay put on screen while the halo follows the head.
     */
    pose: (index: number | undefined, time: number): Pose => {
      mixer?.stopAllAction()
      const clip = index === undefined ? undefined : clips[index]
      if (clip) {
        mixer?.clipAction(clip).play()
        mixer?.setTime(time)
      }
      const next = measure()
      const delta = haloPose.clone().invert().multiply(next)
      haloPose = next
      const r = new THREE.Matrix4().extractRotation(delta).elements
      return {
        turn: [r[0], r[4], r[8], r[1], r[5], r[9], r[2], r[6], r[10]],
        shift: [delta.elements[12], delta.elements[13], delta.elements[14]],
      }
    },
  }
}
