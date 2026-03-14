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

/** Visual properties per board (Z positions loaded from stack-up.json at runtime) */
const BOARD_STYLE: Record<string, { file: string; color: number; pcbColor: number }> = {
  faceplate: { file: 'faceplate.glb', color: 0x1a1a1a, pcbColor: 0x111111 },
  control: { file: 'control.glb', color: 0x006633, pcbColor: 0x0a5c2a },
  main: { file: 'main.glb', color: 0x003366, pcbColor: 0x0a5c2a },
}

interface StackUpEntry {
  z: number
  thickness: number
}
interface StackUpData {
  stack_up: Record<string, StackUpEntry>
  pcb_origin: { x: number; y: number }
  boards: string[]
}

interface BoardDef {
  name: string
  file: string
  z: number
  color: number
  pcbColor: number
}

async function loadStackUp(): Promise<{ defs: BoardDef[]; pcbOrigin: { x: number; y: number } }> {
  const url = `${import.meta.env.BASE_URL}models/stack-up.json`
  const resp = await fetch(url)
  const data: StackUpData = await resp.json()

  const defs: BoardDef[] = data.boards.map((name) => {
    const style = BOARD_STYLE[name] ?? { file: `${name}.glb`, color: 0x006633, pcbColor: 0x0a5c2a }
    const entry = data.stack_up[name] ?? { z: 0, thickness: 1.6 }
    return {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      file: style.file,
      z: entry.z,
      color: style.color,
      pcbColor: style.pcbColor,
    }
  })

  return { defs, pcbOrigin: data.pcb_origin }
}

/** Materials for different part types (DoubleSide: STEP tessellation has inconsistent normals) */
const SIDE = THREE.DoubleSide
const mat = (props: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ side: SIDE, ...props })

/** polygonOffset prevents Z-fighting between coplanar PCB layers.
 *  Positive factor = pushed back in depth. Real PCB layer order (top to bottom):
 *  silkscreen > soldermask > pads > copper > substrate
 *  Soldermask covers copper traces; pads poke through the mask. */
const MATERIALS = {
  // FR4 PCB substrate (bottommost)
  pcb: (color: number) =>
    mat({ color, roughness: 0.7, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: 6, polygonOffsetUnits: 6 }),
  // Faceplate — anodized aluminum
  faceplate: () => mat({ color: 0x1a1a1e, roughness: 0.3, metalness: 0.8 }),
  // Copper traces / zones (under soldermask, visible as subtle pattern)
  copper: () =>
    mat({
      color: 0xb87333,
      roughness: 0.4,
      metalness: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: 4,
      polygonOffsetUnits: 4,
    }),
  // Soldermask — semi-transparent green coating over copper
  soldermask: (color: number) =>
    mat({
      color,
      roughness: 0.4,
      metalness: 0.05,
      transparent: true,
      opacity: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    }),
  // Pads — HASL tin finish (exposed through soldermask openings)
  pad: () =>
    mat({
      color: 0xc0c0c0,
      roughness: 0.3,
      metalness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  // Silkscreen — white ink (on top of everything)
  silkscreen: () => mat({ color: 0xf0f0f0, roughness: 0.8, metalness: 0.0 }),
  // Via barrels (vertical, no Z-fighting)
  via: () => mat({ color: 0xb87333, roughness: 0.35, metalness: 0.85 }),
  // IC packages, connectors — dark plastic
  component: () => mat({ color: 0x333333, roughness: 0.6, metalness: 0.05 }),
  // Metal pins, pads, leads
  metal: () => mat({ color: 0xbbbbbb, roughness: 0.3, metalness: 0.9 }),
}

/** PCB origin offset fallback (overridden by stack-up.json) */

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

/** Classify a mesh by its name (from STEP product names preserved in glTF).
 *  KiCad STEP export names PCB layers as: boardname_PCB, boardname_copper,
 *  boardname_pad, boardname_via, boardname_silkscreen, boardname_soldermask.
 *  Component meshes keep their STEP model names (e.g. "PJ398SM", "SOT-23"). */
type MeshKind = 'pcb' | 'copper' | 'pad' | 'via' | 'silkscreen' | 'soldermask' | 'component'

/** Known metal sub-parts of through-hole components (jack barrels, nuts, sleeves) */
const METAL_PARTS = new Set(['T', 'TN', 'S', 'Hole'])

function classifyByName(name: string): MeshKind {
  const lower = name.toLowerCase()
  if (lower.endsWith('_pcb')) return 'pcb'
  if (lower.endsWith('_copper')) return 'copper'
  if (lower.endsWith('_pad')) return 'pad'
  if (lower.endsWith('_via')) return 'via'
  if (lower.endsWith('_silkscreen') || lower.includes('silkscreen')) return 'silkscreen'
  if (lower.endsWith('_soldermask') || lower.includes('soldermask')) return 'soldermask'
  // Jack sub-parts: T (threaded barrel), TN (nut), S (sleeve), Hole — all metal
  const baseName = name.replace(/_\d+$/, '')
  if (METAL_PARTS.has(baseName)) return 'pad'
  return 'component'
}

/** Get the mesh geometry name (GLTFLoader puts node names on Object3D.name,
 *  but the meaningful names from STEP are on the glTF mesh object).
 *  Three.js stores the mesh name on geometry.name or we can access it
 *  via the mesh's userData. As a fallback, check the node name too. */
function getMeshName(mesh: THREE.Mesh): string {
  // GLTFLoader copies glTF mesh.name → geometry.name in recent versions
  // Also check the Object3D name (node name) as fallback
  return mesh.geometry?.name || mesh.name || ''
}

/** Apply materials: override PCB layer meshes with known-good colors,
 *  but preserve original STEP-derived materials for components (which
 *  already have correct colors for pins, plastic, metal, etc). */
function applyBoardMaterials(root: THREE.Object3D, boardName: string, pcbColor: number): void {
  const isFaceplate = boardName === 'Faceplate'
  const maskColor = isFaceplate ? 0x1a1a1e : pcbColor

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const name = getMeshName(child)
    const kind = classifyByName(name)

    // Only override PCB layer meshes — components keep their STEP colors
    switch (kind) {
      case 'pcb':
        child.material = isFaceplate ? MATERIALS.faceplate() : MATERIALS.pcb(pcbColor)
        break
      case 'soldermask':
        child.material = isFaceplate ? MATERIALS.faceplate() : MATERIALS.soldermask(maskColor)
        break
      case 'silkscreen':
        child.material = MATERIALS.silkscreen()
        break
      case 'copper':
        child.material = MATERIALS.copper()
        break
      case 'pad':
        child.material = MATERIALS.pad()
        break
      case 'via':
        child.material = MATERIALS.via()
        break
      case 'component': {
        // Keep original materials from GLB (PBR fixed in post-processing).
        // Just ensure double-sided rendering for STEP tessellation quirks.
        const setSide = (m: THREE.Material) => {
          m.side = SIDE
        }
        const orig = child.material
        if (Array.isArray(orig)) orig.forEach(setSide)
        else setSide(orig)
        break
      }
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
function createFallbackBoard(def: BoardDef, pcbOrigin: { x: number; y: number }, group: THREE.Group): void {
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
    mesh.position.x += pcbOrigin.x
    mesh.position.y += pcbOrigin.y
  }
  group.add(mesh)

  const offsetX = isFaceplate ? 0 : pcbOrigin.x
  const offsetY = isFaceplate ? 0 : pcbOrigin.y
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

  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
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

  // Load stack-up from hardware-generated metadata
  let boardDefs: BoardDef[]
  let pcbOrigin = { x: 2.0, y: 9.5 }
  try {
    const stackUp = await loadStackUp()
    boardDefs = stackUp.defs
    pcbOrigin = stackUp.pcbOrigin
  } catch {
    // Fallback if stack-up.json missing
    boardDefs = Object.entries(BOARD_STYLE).map(([name, style]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      file: style.file,
      z: 0,
      color: style.color,
      pcbColor: style.pcbColor,
    }))
  }

  const loader = new GLTFLoader()
  let loadedCount = 0
  let failedCount = 0
  const totalBoards = boardDefs.length

  for (const def of boardDefs) {
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
        gltf.scene.position.set(pcbOrigin.x, -pcbOrigin.y, 0)
      }
      group.add(gltf.scene)
      loadedCount++
      statusEl.textContent = `Loaded ${loadedCount}/${totalBoards} models...`
    } catch {
      failedCount++
      createFallbackBoard(def, pcbOrigin, group)
    }
  }

  if (failedCount === totalBoards) {
    statusEl.textContent = 'No glTF models found \u2014 showing placeholders. Run: make hw-export-gltf'
  } else if (failedCount > 0) {
    statusEl.textContent = `${loadedCount}/${totalBoards} models loaded (${failedCount} using placeholders)`
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
