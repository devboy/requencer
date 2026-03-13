/**
 * 3D Assembly Viewer — Interactive Three.js viewer for the three-board sandwich stack.
 * Dynamically imported from debug menu to avoid impacting initial page load.
 *
 * Loads pre-converted glTF models (faceplate, control, main) and renders them
 * with orbit controls and an explode slider for assembly inspection.
 */

/// <reference types="vite/client" />

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/** Board stack-up Z positions from export_3d_assembly.py (mm) */
/** Stack-up: faceplate back (Z=0) rests on jack body shoulders.
 *  PJ398SM model: 16.4mm above origin, ~4.5mm bushing → shoulder at ~11.9mm.
 *  STEP export: board bottom at Z=0, F.Cu at Z=1.6 → shoulder at 1.6+11.9=13.5.
 *  Control→Main gap: 1.6mm PCB + 8.5mm 2x16 header pins. */
const BOARD_DEFS = [
  { name: 'Faceplate', file: 'faceplate.glb', z: 0, color: 0x1a1a1a, pcbColor: 0x111111 },
  { name: 'Control', file: 'control.glb', z: -11.7, color: 0x006633, pcbColor: 0x0a5c2a },
  { name: 'Main', file: 'main.glb', z: -21.8, color: 0x003366, pcbColor: 0x0a5c2a },
] as const

/** Materials for different part types (DoubleSide: STEP tessellation has inconsistent normals) */
const SIDE = THREE.DoubleSide
const MATERIALS = {
  // FR4 PCB substrate — green solder mask
  pcb: (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, side: SIDE }),
  // Faceplate — anodized aluminum
  faceplate: () => new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.3, metalness: 0.8, side: SIDE }),
  // IC packages, connectors — dark plastic
  component: () => new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6, metalness: 0.05, side: SIDE }),
  // Metal pins, pads, leads
  metal: () => new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.3, metalness: 0.9, side: SIDE }),
  // Copper traces / exposed copper
  copper: () => new THREE.MeshStandardMaterial({ color: 0xb87333, roughness: 0.4, metalness: 0.8, side: SIDE }),
}

/** PCB origin offset from faceplate (mm) */
const PCB_OFFSET = { x: 2.0, y: 9.5 }

/** Approximate board dimensions for fallback boxes (mm) */
const FACEPLATE_SIZE = { w: 181.88, h: 127.5, d: 1.6 }
const PCB_SIZE = { w: 177.88, h: 107.5, d: 1.6 }

const OVERLAY_CSS = `
  position: fixed; inset: 0; z-index: 10000;
  background: #0a0a0f; display: flex; flex-direction: column;
`

const TOOLBAR_CSS = `
  display: flex; align-items: center; gap: 12px;
  padding: 8px 16px; background: #1a1a2e;
  border-bottom: 1px solid #333; color: #ccc;
  font: 13px monospace; flex-shrink: 0;
`

const BTN_CSS = `
  padding: 4px 10px; background: #2a2a4e; border: 1px solid #555;
  color: #fff; font: 12px monospace; border-radius: 3px; cursor: pointer;
`

const ACTIVE_BTN_CSS = `
  padding: 4px 10px; background: #4a6a4a; border: 1px solid #6a6;
  color: #fff; font: 12px monospace; border-radius: 3px; cursor: pointer;
`

interface BoardGroup {
  name: string
  group: THREE.Group
  baseZ: number
  visible: boolean
}

let overlay: HTMLDivElement | null = null
let cleanupFn: (() => void) | null = null

export function isViewerOpen(): boolean {
  return overlay !== null
}

export function closeViewer(): void {
  if (cleanupFn) {
    cleanupFn()
    cleanupFn = null
  }
  if (overlay) {
    overlay.remove()
    overlay = null
  }
}

/** Classify a mesh by its bounding box shape */
function classifyMesh(size: THREE.Vector3): 'flat' | 'small-metal' | 'component' {
  if (size.z < 0.003 && size.x > 0.05 && size.y > 0.05) return 'flat'
  if (size.x < 0.005 && size.y < 0.005 && size.z < 0.01) return 'small-metal'
  return 'component'
}

/** Apply realistic materials to loaded board meshes based on geometry heuristics */
function applyBoardMaterials(root: THREE.Object3D, boardName: string, pcbColor: number): void {
  const isFaceplate = boardName === 'Faceplate'
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.computeBoundingBox()
    const box = child.geometry.boundingBox
    if (!box) return

    const size = new THREE.Vector3()
    box.getSize(size)
    const kind = classifyMesh(size)

    if (isFaceplate) {
      child.material = kind === 'flat' ? MATERIALS.faceplate() : MATERIALS.metal()
    } else if (kind === 'flat') {
      child.material = MATERIALS.pcb(pcbColor)
    } else if (kind === 'small-metal') {
      child.material = MATERIALS.metal()
    } else {
      child.material = MATERIALS.component()
    }
  })
}

/** Create a text sprite for board labels (used in fallback mode) */
function createTextSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, 256, 64)
    ctx.font = 'bold 32px monospace'
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 128, 32)
  }

  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(40, 10, 1)
  return sprite
}

/** Create a fallback box mesh for a board when glTF isn't available */
function createFallbackBoard(def: (typeof BOARD_DEFS)[number], group: THREE.Group): void {
  const isFaceplate = def.name === 'Faceplate'
  const size = isFaceplate ? FACEPLATE_SIZE : PCB_SIZE
  const geometry = new THREE.BoxGeometry(size.w, size.h, size.d)
  const material = new THREE.MeshStandardMaterial({
    color: def.color,
    roughness: 0.6,
    metalness: 0.1,
    transparent: isFaceplate,
    opacity: isFaceplate ? 0.7 : 1.0,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(size.w / 2, size.h / 2, 0)
  if (!isFaceplate) {
    mesh.position.x += PCB_OFFSET.x
    mesh.position.y += PCB_OFFSET.y
  }
  group.add(mesh)

  const offsetX = isFaceplate ? 0 : PCB_OFFSET.x
  const offsetY = isFaceplate ? 0 : PCB_OFFSET.y
  const label = createTextSprite(def.name)
  label.position.set(size.w / 2 + offsetX, size.h / 2 + offsetY, 2)
  group.add(label)
}

/** Set up Three.js scene with lighting, camera, controls */
function createScene(container: HTMLElement) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1a24)

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000)
  camera.position.set(0, -150, 120)
  camera.up.set(0, 0, 1) // Z-up to match KiCad coordinate system

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.6
  container.appendChild(renderer.domElement)

  const orbitControls = new OrbitControls(camera, renderer.domElement)
  orbitControls.enableDamping = true
  orbitControls.dampingFactor = 0.1
  orbitControls.target.set(0, 0, -6)

  // Lighting — strong enough to illuminate the dark anodized faceplate
  scene.add(new THREE.AmbientLight(0xffffff, 1.0))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.0)
  keyLight.position.set(100, -100, 200)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.8)
  fillLight.position.set(-80, 80, 100)
  scene.add(fillLight)
  const rimLight = new THREE.DirectionalLight(0xccddff, 0.6)
  rimLight.position.set(0, 150, 50)
  scene.add(rimLight)

  // Resize handler
  function resize() {
    const w = container.clientWidth
    const h = container.clientHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }
  resize()
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)

  return { scene, camera, renderer, orbitControls, resizeObserver }
}

/** Load board models (glTF with fallback to boxes) */
async function loadBoards(scene: THREE.Scene, statusEl: HTMLElement): Promise<BoardGroup[]> {
  const boards: BoardGroup[] = []
  const boardParent = new THREE.Group()
  // Models span X: 0→182, Y: -127→0 (KiCad Y+ is down). Center at origin.
  boardParent.position.set(-FACEPLATE_SIZE.w / 2, FACEPLATE_SIZE.h / 2, 0)
  scene.add(boardParent)

  const loader = new GLTFLoader()
  let loadedCount = 0
  let failedCount = 0

  for (const def of BOARD_DEFS) {
    const group = new THREE.Group()
    group.position.z = def.z
    boardParent.add(group)

    const boardEntry: BoardGroup = {
      name: def.name,
      group,
      baseZ: def.z,
      visible: true,
    }
    boards.push(boardEntry)

    const modelPath = `${import.meta.env.BASE_URL}models/${def.file}`
    try {
      const gltf = await loader.loadAsync(modelPath)
      // glTF uses meters (STEP/OCCT convention), viewer uses mm
      gltf.scene.scale.set(1000, 1000, 1000)
      // Apply realistic materials based on geometry heuristics
      applyBoardMaterials(gltf.scene, def.name, def.pcbColor)
      if (def.name !== 'Faceplate') {
        gltf.scene.position.set(PCB_OFFSET.x, -PCB_OFFSET.y, 0)
      }
      group.add(gltf.scene)
      loadedCount++
      statusEl.textContent = `Loaded ${loadedCount}/3 models...`
    } catch {
      failedCount++
      createFallbackBoard(def, group)
    }
  }

  if (failedCount === 3) {
    statusEl.textContent = 'No glTF models found \u2014 showing placeholders. Run: make hw-export-gltf'
  } else if (failedCount > 0) {
    statusEl.textContent = `${loadedCount}/3 models loaded (${failedCount} using placeholders)`
  } else {
    statusEl.textContent = 'All models loaded'
  }

  return boards
}

/** Build the overlay DOM (toolbar + container + bottom controls) */
function createOverlayDOM() {
  const root = document.createElement('div')
  root.style.cssText = OVERLAY_CSS

  const toolbar = document.createElement('div')
  toolbar.style.cssText = TOOLBAR_CSS

  const closeBtn = document.createElement('button')
  closeBtn.textContent = '\u2715 Close'
  closeBtn.style.cssText = BTN_CSS
  closeBtn.addEventListener('click', closeViewer)

  const title = document.createElement('span')
  title.textContent = '3D Assembly'
  title.style.cssText = 'flex: 1; text-align: center; font-weight: bold;'

  const statusEl = document.createElement('span')
  statusEl.textContent = 'Loading...'
  statusEl.style.cssText = 'color: #888; font-size: 11px;'

  toolbar.append(closeBtn, title, statusEl)

  const container = document.createElement('div')
  container.style.cssText = 'flex: 1; position: relative;'

  const controls = document.createElement('div')
  controls.style.cssText = `
    display: flex; align-items: center; gap: 12px;
    padding: 8px 16px; background: #1a1a2e;
    border-top: 1px solid #333; color: #ccc;
    font: 12px monospace; flex-shrink: 0;
  `

  const assembledLabel = document.createElement('span')
  assembledLabel.textContent = 'Assembled'

  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = '0'
  slider.max = '1'
  slider.step = '0.01'
  slider.value = '0'
  slider.style.cssText = 'flex: 1; max-width: 300px; accent-color: #6a6;'

  const explodedLabel = document.createElement('span')
  explodedLabel.textContent = 'Exploded'

  const separator = document.createElement('span')
  separator.style.cssText = 'border-left: 1px solid #444; height: 20px;'

  controls.append(assembledLabel, slider, explodedLabel, separator)
  root.append(toolbar, container, controls)

  return { root, container, controls, slider, statusEl }
}

export async function openViewer(): Promise<void> {
  if (overlay) return

  const dom = createOverlayDOM()
  overlay = dom.root
  document.body.appendChild(overlay)

  const { scene, renderer, orbitControls, resizeObserver } = createScene(dom.container)
  const boards = await loadBoards(scene, dom.statusEl)

  // Board toggle buttons
  for (const board of boards) {
    const btn = document.createElement('button')
    btn.textContent = board.name
    btn.style.cssText = ACTIVE_BTN_CSS
    btn.addEventListener('click', () => {
      board.visible = !board.visible
      board.group.visible = board.visible
      btn.style.cssText = board.visible ? ACTIVE_BTN_CSS : BTN_CSS
    })
    dom.controls.appendChild(btn)
  }

  // Explode slider — control board stays anchored, faceplate lifts up, main drops down
  const controlZ = boards.find((b) => b.name === 'Control')?.baseZ ?? -11.7
  const explodeRange = 25 // mm of travel at full explode
  dom.slider.addEventListener('input', () => {
    const t = parseFloat(dom.slider.value) // 0 = assembled, 1 = exploded
    for (const board of boards) {
      if (board.name === 'Control') {
        board.group.position.z = board.baseZ
      } else if (board.name === 'Faceplate') {
        board.group.position.z = board.baseZ + t * explodeRange
      } else {
        // Main board moves down
        board.group.position.z = board.baseZ - t * explodeRange
      }
    }
  })

  // Keyboard: Escape to close
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      closeViewer()
    }
  }
  document.addEventListener('keydown', onKeyDown)

  // Render loop
  let animating = true
  function animate() {
    if (!animating || !overlay) return
    requestAnimationFrame(animate)
    orbitControls.update()
    renderer.render(scene, orbitControls.object as THREE.Camera)
  }
  animate()

  // Register cleanup for when closeViewer() is called
  cleanupFn = () => {
    animating = false
    document.removeEventListener('keydown', onKeyDown)
    resizeObserver.disconnect()
    renderer.dispose()
  }
}
