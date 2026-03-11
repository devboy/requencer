# 3D Preview Rendering — Research & Implementation Plan

Interactive, studio-quality 3D rendering of the Requencer faceplate with all components, live display, patch cables, and encoder caps. Progression from beauty-shot preview to fully interactive 3D sequencer.

---

## Table of Contents

1. [Goals & Scope](#1-goals--scope)
2. [Architecture Overview](#2-architecture-overview)
3. [Faceplate Panel](#3-faceplate-panel)
4. [Silkscreen / Text Labels](#4-silkscreen--text-labels)
5. [Procedural Components (No Models)](#5-procedural-components-no-models)
6. [TFT Display (Live Content)](#6-tft-display-live-content)
7. [Encoder Caps](#7-encoder-caps)
8. [Patch Cables](#8-patch-cables)
9. [Buttons with LEDs](#9-buttons-with-leds)
10. [Lighting & Environment](#10-lighting--environment)
11. [Post-Processing](#11-post-processing)
12. [Interaction (Phase 3)](#12-interaction-phase-3)
13. [Performance](#13-performance)
14. [Implementation Phases](#14-implementation-phases)

---

## 1. Goals & Scope

### Phase 1 — Static Beauty Shot
- 3D faceplate (anodized aluminum) with all procedural components
- Silkscreen text/logos rendered as decals
- Jacks, buttons, encoders, mounting slots, connectors
- Studio lighting + post-processing
- OrbitControls for inspection

### Phase 2 — Live Elements
- TFT display showing live sequencer canvas (480x320)
- Encoder caps with rotation matching the 2D UI
- 1-2 decorative patch cables plugged into jacks
- LED glow on buttons (bloom pass)

### Phase 3 — Full Interactive 3D Sequencer
- Raycaster-based click/tap on buttons
- Encoder drag-to-rotate interaction
- LED state synced from WASM engine
- Display updates in real-time
- Complete replacement for the 2D DOM panel

---

## 2. Architecture Overview

### File Structure (New)
```
web/src/ui/
  preview-3d/
    preview-scene.ts      — Scene setup, camera, lighting, render loop
    faceplate-mesh.ts     — Panel geometry + silkscreen texture
    jack-geometry.ts      — Procedural Thonkiconn jack (reusable)
    button-geometry.ts    — Procedural tactile button with LED
    encoder-geometry.ts   — Procedural encoder + cap
    display-mesh.ts       — TFT display with CanvasTexture
    cable-mesh.ts         — Patch cable with catenary curve
    mounting-slot.ts      — Mounting slot geometry
    connector-geometry.ts — USB-C, SD card slot
    post-processing.ts    — Bloom, SSAO, tone mapping
    interaction.ts        — Raycaster, click/drag handlers (Phase 3)
    materials.ts          — Shared material definitions
    constants.ts          — Re-export panel-layout.json values
```

### Integration
- Launched from debug menu (like existing assembly viewer)
- Dynamically imported to avoid bundle impact
- Reads all positions from `panel-layout.json` (single source of truth)
- Phase 3: Can replace DOM panel entirely via a toggle

### Dependencies
Already in package.json:
- `three: ^0.183.2`
- `@types/three: ^0.183.1`

New imports needed (all from three/addons, no new npm deps):
- `OrbitControls` (already used in assembly-viewer)
- `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `OutputPass`, `SMAAPass`
- `RGBELoader` (for HDRI environment maps)

---

## 3. Faceplate Panel

### Geometry
```
PlaneGeometry(181.88, 127.5)  // Panel dimensions in mm
```
Or for slight depth realism:
```
BoxGeometry(181.88, 127.5, 1.6)  // 1.6mm aluminum thickness
```

The panel needs cutouts for:
- LCD display opening (82.5 x 52.0 mm)
- Mounting slots (4x oblong holes)
- USB-C / SD card ports

**Approach**: Use `THREE.Shape` + `THREE.ExtrudeGeometry` to create a panel with holes:
```typescript
const shape = new THREE.Shape()
// Outer rectangle
shape.moveTo(0, 0)
shape.lineTo(181.88, 0)
shape.lineTo(181.88, 127.5)
shape.lineTo(0, 127.5)
shape.closePath()

// LCD cutout hole
const lcdHole = new THREE.Path()
const lx = 54.78 - 82.5/2  // center_x - width/2
const ly = 39.89 - 52.0/2   // center_y - height/2
lcdHole.moveTo(lx, ly)
lcdHole.lineTo(lx + 82.5, ly)
lcdHole.lineTo(lx + 82.5, ly + 52.0)
lcdHole.lineTo(lx, ly + 52.0)
lcdHole.closePath()
shape.holes.push(lcdHole)

// Extrude to 1.6mm thickness
const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false })
```

### Material — Anodized Aluminum
```typescript
const faceplateMAterial = new THREE.MeshPhysicalMaterial({
  color: 0x2a2a2e,           // Dark anodized aluminum
  metalness: 0.85,
  roughness: 0.25,           // Slightly brushed, not mirror
  clearcoat: 0.3,            // Subtle lacquer layer
  clearcoatRoughness: 0.4,
  envMapIntensity: 1.0,
  side: THREE.DoubleSide,
})
```

For a **brushed aluminum** effect, use the built-in anisotropy property (Three.js r160+):
```typescript
const faceplateMAterial = new THREE.MeshPhysicalMaterial({
  color: 0x2a2a2e,
  metalness: 1.0,            // Full metal for anisotropy to work
  roughness: 0.3,
  anisotropy: 1.0,           // Maximum anisotropic stretching
  anisotropyRotation: 0,     // 0 = horizontal brush direction
  clearcoat: 0.3,
  clearcoatRoughness: 0.4,
  envMapIntensity: 1.0,
})
```
This creates the characteristic elongated reflections of brushed metal. An environment map is essential — metallic materials look flat/black without one. `RectAreaLight` produces the stretched rectangular highlights that read as "studio-lit brushed metal."

### Coordinate System
- Panel-layout.json uses **top-left origin, Y-down** (matching CSS/KiCad)
- Three.js is **center origin, Y-up**
- Conversion: `x_3d = x_mm - panel_w/2`, `y_3d = panel_h/2 - y_mm`
- Z-axis: panel front face at z=0, components protrude toward camera (positive Z)

---

## 4. Silkscreen / Text Labels

### Approach: Canvas Texture Overlay

Render all silkscreen text onto a 2D canvas at high resolution, then apply as a texture layer on the faceplate.

```typescript
// Create a hi-res canvas matching panel dimensions
const SILK_SCALE = 10  // 10 pixels per mm → 1819 x 1275 px
const silkCanvas = document.createElement('canvas')
silkCanvas.width = Math.ceil(181.88 * SILK_SCALE)
silkCanvas.height = Math.ceil(127.5 * SILK_SCALE)
const ctx = silkCanvas.getContext('2d')!

// Transparent background
ctx.clearRect(0, 0, silkCanvas.width, silkCanvas.height)

// Draw all labels from panel-layout.json
ctx.font = `bold ${2.2 * SILK_SCALE}px 'JetBrains Mono'`
ctx.fillStyle = '#888888'
ctx.textAlign = 'center'
ctx.textBaseline = 'middle'

// Track labels
for (const btn of panelLayout.buttons.track) {
  ctx.fillText(btn.label, btn.x_mm * SILK_SCALE, btn.y_mm * SILK_SCALE - 8 * SILK_SCALE)
}
// ... repeat for all component labels

// Title
ctx.font = `600 ${14/4.5 * SILK_SCALE}px 'JetBrains Mono'`
ctx.letterSpacing = '6px'
ctx.fillText('REQUENCER', 181.88/2 * SILK_SCALE, 8/4.5 * SILK_SCALE)

// Apply as texture
const silkTexture = new THREE.CanvasTexture(silkCanvas)
silkTexture.flipY = false  // Match coordinate system
```

### Applying to Faceplate

**Option A — Separate decal plane** (recommended):
```typescript
const silkPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(181.88, 127.5),
  new THREE.MeshBasicMaterial({
    map: silkTexture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,  // Render slightly in front
  })
)
silkPlane.position.z = 1.601  // Just above faceplate surface
```

**Option B — Multi-material with alphaMap**:
Use the silkscreen canvas as an alphaMap on a second material pass. More complex but avoids z-fighting.

### Logo / Branding
The "REQUENCER" title and "VILE TENSOR" branding can be rendered on the same silkscreen canvas. If you want embossed text, use `TextGeometry` with a font (loaded via `FontLoader`) extruded by 0.1mm.

---

## 5. Procedural Components (No Models)

All components are generated from code using Three.js primitives. No external .glb/.gltf files needed.

### 5.1 Thonkiconn Jack (PJ398SM)

The iconic eurorack 3.5mm jack with hexagonal nut.

**Geometry stack** (front to back along Z):
```
┌─────────────┐  z=2.0   Hex nut (0.8mm thick)
│  ⬡ hex nut  │
├─────────────┤  z=1.2   Washer ring
│   washer    │
├─────────────┤  z=0.0   Panel surface
│  ◯ bushing  │          Threaded bushing (through-panel)
├─────────────┤  z=-1.6  Behind panel
│   barrel    │          Jack barrel body
└─────────────┘  z=-8.8  Pin terminals
```

```typescript
function createJackGeometry(): THREE.Group {
  const group = new THREE.Group()

  // Hex nut — CylinderGeometry with 6 radial segments = hexagon
  const hexNut = new THREE.Mesh(
    new THREE.CylinderGeometry(5.0, 5.0, 0.8, 6),  // 10mm across flats
    metalMaterial
  )
  hexNut.rotation.x = Math.PI / 2  // Lay flat
  hexNut.rotation.z = Math.PI / 6  // Rotate for hex orientation
  hexNut.position.z = 2.0
  group.add(hexNut)

  // Washer
  const washer = new THREE.Mesh(
    new THREE.RingGeometry(3.0, 4.5, 32),
    metalMaterial
  )
  washer.position.z = 1.2
  group.add(washer)

  // Threaded bushing
  const bushing = new THREE.Mesh(
    new THREE.CylinderGeometry(3.0, 3.0, 1.6, 32),
    metalMaterial
  )
  bushing.rotation.x = Math.PI / 2
  bushing.position.z = 0.8
  group.add(bushing)

  // Jack hole (dark center)
  const hole = new THREE.Mesh(
    new THREE.CircleGeometry(1.75, 32),  // 3.5mm diameter
    new THREE.MeshBasicMaterial({ color: 0x050505 })
  )
  hole.position.z = 2.01
  group.add(hole)

  return group
}
```

**Material — Chrome/Nickel**:
```typescript
const metalMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xc8c8c8,
  metalness: 0.95,
  roughness: 0.15,
  clearcoat: 0.1,
})
```

**Instancing**: With 26 jacks total, use `THREE.InstancedMesh` for the hex nuts, washers, and bushings separately. Each gets a per-instance transform matrix.

### 5.2 Tactile Button (TC002-RGB)

Circular button with translucent cap for LED illumination.

```typescript
function createButtonGeometry(diameter_mm: number): THREE.Group {
  const group = new THREE.Group()
  const r = diameter_mm / 2

  // Button housing (dark plastic base, sits in panel hole)
  const housing = new THREE.Mesh(
    new THREE.CylinderGeometry(r + 0.5, r + 0.5, 1.0, 32),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8, metalness: 0.0 })
  )
  housing.rotation.x = Math.PI / 2
  housing.position.z = 0.5
  group.add(housing)

  // Button cap (translucent plastic — the pressable part)
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, 1.2, 32),
    new THREE.MeshPhysicalMaterial({
      color: 0x444444,
      roughness: 0.6,
      metalness: 0.0,
      transmission: 0.15,     // Slightly see-through for LED
      thickness: 1.0,
      opacity: 0.9,
      transparent: true,
    })
  )
  cap.rotation.x = Math.PI / 2
  cap.position.z = 1.5
  group.add(cap)

  // LED (emissive disc inside — controlled via material.emissive)
  const led = new THREE.Mesh(
    new THREE.CircleGeometry(r * 0.6, 16),
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0x000000,     // Updated dynamically
      emissiveIntensity: 0,
    })
  )
  led.position.z = 1.0
  group.add(led)

  return group
}
```

### 5.3 Mounting Slots

Oblong pill-shaped cutouts at corners.

```typescript
function createMountingSlot(w_mm: number, h_mm: number): THREE.Mesh {
  const shape = new THREE.Shape()
  const r = h_mm / 2
  // Pill shape: two semicircles connected by straight lines
  shape.moveTo(-w_mm/2 + r, -h_mm/2)
  shape.lineTo(w_mm/2 - r, -h_mm/2)
  shape.absarc(w_mm/2 - r, 0, r, -Math.PI/2, Math.PI/2, false)
  shape.lineTo(-w_mm/2 + r, h_mm/2)
  shape.absarc(-w_mm/2 + r, 0, r, Math.PI/2, -Math.PI/2, false)

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 2.0, bevelEnabled: false })
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0x111111, roughness: 0.9, metalness: 0.0,
  }))
}
```

### 5.4 Connectors (USB-C, SD Card)

Simple extruded shapes:
```typescript
// USB-C: rounded rectangle
// SD card: rectangle with chamfered corner
```

---

## 6. TFT Display (Live Content)

### Architecture
The sequencer already renders to a 480x320 canvas via `renderWasmLcd(ctx)`. We pipe that same canvas into a Three.js `CanvasTexture`.

### Implementation
```typescript
function createDisplay(
  lcdCanvas: HTMLCanvasElement,
  cutout: { center_x_mm: number, center_y_mm: number, width_mm: number, height_mm: number },
  active: { w_mm: number, h_mm: number },
): THREE.Group {
  const group = new THREE.Group()

  // Dark bezel frame (sits behind panel cutout)
  const bezelW = cutout.width_mm + 4  // 2mm padding each side
  const bezelH = cutout.height_mm + 4
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(bezelW, bezelH, 2.0),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8, metalness: 0.0 })
  )
  bezel.position.z = -1.0  // Behind panel
  group.add(bezel)

  // Active display area (shows live content)
  const displayTexture = new THREE.CanvasTexture(lcdCanvas)
  displayTexture.minFilter = THREE.NearestFilter   // Pixelated look
  displayTexture.magFilter = THREE.NearestFilter   // Authentic TFT
  displayTexture.generateMipmaps = false            // Performance
  displayTexture.colorSpace = THREE.SRGBColorSpace

  const displayPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(active.w_mm, active.h_mm),
    new THREE.MeshBasicMaterial({
      map: displayTexture,
      toneMapped: false,  // Don't tone-map the display content
    })
  )
  displayPlane.position.z = 0.1  // Slightly in front of bezel
  group.add(displayPlane)

  // Glass overlay (subtle reflection)
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(cutout.width_mm, cutout.height_mm),
    new THREE.MeshPhysicalMaterial({
      color: 0x000000,
      metalness: 0.0,
      roughness: 0.1,
      transmission: 0.95,     // Nearly transparent
      thickness: 0.5,
      opacity: 1.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMapIntensity: 0.3,   // Subtle reflections
    })
  )
  glass.position.z = 0.2  // In front of display content
  group.add(glass)

  return group
}
```

### Texture Update Loop
```typescript
// In the render loop:
function updateDisplay(displayTexture: THREE.CanvasTexture) {
  displayTexture.needsUpdate = true  // Mark for GPU upload
}
```

### Screen Brightness Control
Use `MeshStandardMaterial` with the canvas texture as both `map` and `emissiveMap`:
```typescript
const screenMaterial = new THREE.MeshStandardMaterial({
  map: displayTexture,
  emissiveMap: displayTexture,
  emissive: new THREE.Color(1, 1, 1),
  emissiveIntensity: 0.8,  // 0=off, 1=full backlit
  toneMapped: false,
})
```
This makes the screen self-lit (visible even in a dark scene), matching how real backlit TFTs behave.

### Backlight Bleed
Add a `RectAreaLight` behind the screen for realistic backlight bleeding onto the bezel:
```typescript
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
RectAreaLightUniformsLib.init()

const backlight = new THREE.RectAreaLight(0x88aaff, 0.5, active.w_mm, active.h_mm)
backlight.position.z = -0.1  // Slightly behind screen plane
backlight.lookAt(0, 0, 1)
group.add(backlight)
```

### LCD Subpixel Effect (Bonus — Close Zoom Detail)
At close zoom, real TFTs show visible RGB subpixels. Implement via custom `ShaderMaterial`:
1. Snap UVs to pixel grid: `uv = round(uv * resolution) / resolution`
2. Generate RGB cell pattern using `fract(uv * resolution)` with circular masks for R, G, B
3. Multiply texture sample by per-channel masks
4. Distance-fade: lerp between LCD effect (close) and plain texture (far) based on camera distance

This is a nice-to-have polish detail — skip in Phase 2, consider for Phase 3.

### Display Layer Stack (front to back)
1. **Glass overlay** — `MeshPhysicalMaterial` transmission/clearcoat (z=0.2)
2. **Screen content** — `MeshStandardMaterial` emissiveMap=CanvasTexture (z=0.1)
3. **Bezel frame** — `ExtrudeGeometry` dark plastic (z=-1.0)
4. **RectAreaLight** — behind screen, casts backlight bleed onto bezel

### Performance Considerations
- 480x320 is very small (153,600 pixels) — negligible GPU upload cost
- `generateMipmaps = false` saves mipmap computation
- `NearestFilter` avoids expensive filtering (and gives authentic pixelated TFT look)
- Only set `needsUpdate` when content actually changed (check a dirty flag)
- At 60fps with a 480x320 texture, this is ~37 MB/s of texture data — well within budget
- Chrome is fastest for CanvasTexture uploads; Firefox/Safari slower but fine at this resolution
- `MeshPhysicalMaterial` glass overlay has higher per-pixel cost but for one small plane it's negligible

---

## 7. Encoder Caps

### Physical Reference — Eurorack Encoder Caps

Three dominant styles in the eurorack ecosystem, all available for EC11E (6mm D-shaft):

| Style | Diameter | Height | Material | Used By |
|-------|----------|--------|----------|---------|
| **Davies 1900H clone** | 13mm | 15.5mm | ABS plastic | Befaco, AI Synthesis, DIY |
| **Re'an/Sifam aluminum** | 12-17mm | 13-16mm | Machined aluminum | Doepfer, Intellijel |
| **Rogan PT-1PS** | 15mm | 18mm | Soft-touch rubber | Make Noise, Mutable |

For the Requencer, a **small aluminum knurled cap** (~14.5mm matching the existing CSS render) fits best. The Davies 1900H is the most classic DIY aesthetic alternative.

### Geometry: LatheGeometry Profiles

`LatheGeometry` revolves a `Vector2` profile around the Y-axis. 32-48 segments is adequate; 64 for smooth close-ups.

**Aluminum knurled cap (recommended for Requencer):**
```typescript
const points: THREE.Vector2[] = [
  new THREE.Vector2(0.0, 0.0),      // Center bottom
  new THREE.Vector2(6.5, 0.0),      // Base edge (13mm base diameter)
  new THREE.Vector2(7.0, 0.5),      // Skirt flare
  new THREE.Vector2(7.25, 1.0),     // Max diameter = 14.5mm
  new THREE.Vector2(7.25, 6.0),     // Cylindrical section (knurled)
  new THREE.Vector2(7.0, 6.5),      // Top chamfer start
  new THREE.Vector2(6.0, 7.0),      // Top edge
  new THREE.Vector2(5.5, 6.8),      // Slight dish
  new THREE.Vector2(0.0, 6.5),      // Center top (dished)
]
const geometry = new THREE.LatheGeometry(points, 48)
```

**Davies 1900H clone (straight cylinder with chamfer):**
```typescript
const points = [
  new THREE.Vector2(0, 0),
  new THREE.Vector2(6.5, 0),       // 13mm diameter
  new THREE.Vector2(6.5, 14.0),    // Straight wall
  new THREE.Vector2(6.0, 15.5),    // Top chamfer
  new THREE.Vector2(0, 15.5),      // Flat top
]
```

**Rogan PT-1PS (skirted, rounded top):**
```typescript
const points = [
  new THREE.Vector2(0, 0),
  new THREE.Vector2(8.5, 0),       // Skirt outer edge (17mm)
  new THREE.Vector2(8.5, 1.5),     // Skirt top
  new THREE.Vector2(7.5, 2.5),     // Concave transition
  new THREE.Vector2(7.0, 12.0),    // Grip cylinder
  new THREE.Vector2(6.5, 16.0),    // Slight taper
  new THREE.Vector2(5.0, 17.5),    // Rounded shoulder
  new THREE.Vector2(0, 18.0),      // Center top (domed)
]
```

For smoother curves on the Rogan top, use `QuadraticBezierCurve.getPoints(16)` for the shoulder section.
```

### Knurled Surface

**Option A — Bump/normal map (recommended)**:

Vertical serrations (Davies 1900H style):
```typescript
function createSerrationBumpMap(stripeCount = 40): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, 256, 64)
  const sw = 256 / stripeCount
  for (let i = 0; i < stripeCount; i++) {
    const x = i * sw
    const grad = ctx.createLinearGradient(x, 0, x + sw, 0)
    grad.addColorStop(0, '#404040')
    grad.addColorStop(0.5, '#C0C0C0')
    grad.addColorStop(1, '#404040')
    ctx.fillStyle = grad
    ctx.fillRect(x, 0, sw, 64)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  return tex
}
```

Diamond knurling (aluminum knob style):
```typescript
function createDiamondKnurlingMap(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, 512, 512)
  ctx.strokeStyle = '#C0C0C0'
  ctx.lineWidth = 2
  const spacing = 12
  // Diagonal set 1 (↗)
  for (let i = -512; i < 1024; i += spacing) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 512, 512); ctx.stroke()
  }
  // Diagonal set 2 (↘)
  for (let i = -512; i < 1024; i += spacing) {
    ctx.beginPath(); ctx.moveTo(i, 512); ctx.lineTo(i + 512, 0); ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  return tex
}
```

**Option B — Geometry-based knurling** (high poly):
Modulate LatheGeometry vertices radially for physical ridges. Only for extreme close-up hero shots.

| Approach | Extra Geometry | GPU Cost | Quality |
|----------|---------------|----------|---------|
| Bump map | None | 1 texture sample | Adequate at distance |
| Normal map | None | 1 texture sample | Good at all distances |
| Geometry | High vertex count | High | Best close-up |

### Material — Knob Style Reference

```typescript
// Brushed aluminum knob
const aluminumKnob = new THREE.MeshStandardMaterial({
  color: 0xC8C8CC, metalness: 1.0, roughness: 0.35,
  bumpMap: diamondKnurlingMap, bumpScale: 1.5,
})

// Soft-touch rubber (Rogan PT style)
const rubberKnob = new THREE.MeshStandardMaterial({
  color: 0x1A1A1A, metalness: 0.0, roughness: 0.9,
})

// Black ABS plastic (Davies 1900H clone)
const plasticKnob = new THREE.MeshStandardMaterial({
  color: 0x1C1C1C, metalness: 0.0, roughness: 0.6,
  bumpMap: serrationBumpMap, bumpScale: 1.0,
})

// Anodized aluminum (colored)
const anodizedKnob = new THREE.MeshPhysicalMaterial({
  color: 0x4488CC, metalness: 1.0, roughness: 0.25,
  clearcoat: 1.0, clearcoatRoughness: 0.1,  // Oxide layer
})
```

**Critical:** `metalness: 1.0` materials render black without an environment map. Always set `scene.environment` or `material.envMap`.

### Indicator Line
```typescript
// White pointer line — child mesh that rotates with knob
const indicator = new THREE.Mesh(
  new THREE.BoxGeometry(1.0, 0.3, 5.0),  // 1mm wide, 0.3mm deep, 5mm long
  new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.8 })
)
indicator.position.set(0, 7.15, 2.5)  // On top face, offset from center
indicator.material.polygonOffset = true
indicator.material.polygonOffsetFactor = -1  // Prevent z-fighting
```

### What to Model vs. Skip

| Feature | Model? | Reason |
|---------|--------|--------|
| Knob body profile | Yes | Primary visual element |
| Knurling/serrations | Yes, via bump map | Adds realism, minimal cost |
| Pointer indicator line | Yes, as child mesh | Functional, simple |
| Skirt (if present) | Yes, in LatheGeometry | Changes silhouette |
| D-shaft hole | No | Invisible from outside |
| Set screw | No | Too small to see |

### Rotation
```typescript
// Match encoder rotation from UI state
encoderCapGroup.rotation.y = currentAngleRadians
```

---

## 8. Patch Cables

### Catenary Curve Math

A hanging cable between two points follows a catenary curve:
```
y(x) = a · cosh((x - x₀) / a) + y₀
```

Where `a` is the catenary parameter (horizontal tension / weight per unit length).

**Solving for `a` given endpoints and cable length** (Newton-Raphson):
Given `d` = horizontal distance, `h` = vertical distance, `s` = cable length:
```typescript
function solveCatenary(d: number, h: number, s: number): number {
  // Transcendental equation: sqrt(s² - h²) = 2a·sinh(d/(2a))
  const target = Math.sqrt(s * s - h * h)
  let a = d  // Initial guess
  for (let i = 0; i < 20; i++) {
    const f = 2 * a * Math.sinh(d / (2 * a)) - target
    const fp = 2 * Math.sinh(d / (2 * a)) - (d / a) * Math.cosh(d / (2 * a))
    a -= f / fp
    if (Math.abs(f) < 0.001) break
  }
  return a
}
```

**Simplified fixed-point iteration** (from SketchPunk):
```typescript
let a = 100
const vecLenHalf = d / 2, maxLenHalf = s / 2
for (let i = 0; i < 100; i++) {
  const aTmp = vecLenHalf / Math.asinh(maxLenHalf / a)
  if (Math.abs((aTmp - a) / a) < 0.001) break
  a = aTmp
}
```

For eurorack cables: the cable exits perpendicular to the panel (along Z), then droops due to gravity (along -Y). The catenary lives in the vertical plane containing both jack positions.

### Implementation

```typescript
interface CableEndpoint {
  jackId: string
  x_mm: number  // From panel-layout.json
  y_mm: number
}

function createPatchCable(
  from: CableEndpoint,
  to: CableEndpoint,
  color: number,
  cableLength_mm: number = 300,
): THREE.Group {
  const group = new THREE.Group()

  // Convert to 3D coordinates
  const p1 = new THREE.Vector3(
    from.x_mm - 181.88/2,
    127.5/2 - from.y_mm,
    3.0  // Protrudes from panel
  )
  const p2 = new THREE.Vector3(
    to.x_mm - 181.88/2,
    127.5/2 - to.y_mm,
    3.0
  )

  // Generate catenary control points
  const midX = (p1.x + p2.x) / 2
  const midY = (p1.y + p2.y) / 2
  const dist = p1.distanceTo(p2)
  const slack = Math.max(cableLength_mm - dist, 20) // Extra cable length
  const droopY = -slack * 0.3  // Gravity droop
  const droopZ = slack * 0.4   // How far cable hangs out from panel

  // Cable path using CatmullRomCurve3
  const curve = new THREE.CatmullRomCurve3([
    p1,
    new THREE.Vector3(p1.x, p1.y, p1.z + 8),           // Exit straight from jack
    new THREE.Vector3(p1.x * 0.7 + p2.x * 0.3,
                      midY + droopY * 0.6,
                      droopZ),                             // Droop point 1
    new THREE.Vector3(midX, midY + droopY, droopZ + 5),  // Lowest point
    new THREE.Vector3(p1.x * 0.3 + p2.x * 0.7,
                      midY + droopY * 0.6,
                      droopZ),                             // Droop point 2
    new THREE.Vector3(p2.x, p2.y, p2.z + 8),             // Approach jack
    p2,
  ], false, 'catmullrom', 0.5)

  // Cable body
  const tubeGeo = new THREE.TubeGeometry(curve, 64, 1.5, 8, false)  // 3mm diameter cable
  const cableMat = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.7,    // Silicone/rubber
    metalness: 0.0,
  })
  group.add(new THREE.Mesh(tubeGeo, cableMat))

  // Plug tips (at each end)
  group.add(createPlugTip(p1, color))
  group.add(createPlugTip(p2, color))

  return group
}
```

### 3.5mm Mono Plug Geometry (EIA RS-453)

Physical dimensions of a 3.5mm TS plug:

| Part | Diameter | Length |
|------|----------|--------|
| Tip (exposed conductor) | 3.24 mm | ~4.8 mm |
| Insulating collar (groove) | < 3.24 mm | ~0.7 mm |
| Sleeve (barrel) | 3.5 mm | ~8.5 mm |
| Total insertion length | — | ~14 mm |
| Strain relief to cable | ~5 mm dia | ~4 mm |

**Best approach: LatheGeometry** — define a 2D profile and revolve:
```typescript
function createPlugGeometry(): THREE.LatheGeometry {
  const points = [
    new THREE.Vector2(0, 0),         // Tip point (rounded)
    new THREE.Vector2(1.62, 0.5),    // Tip radius at front
    new THREE.Vector2(1.62, 4.8),    // Tip cylinder end
    new THREE.Vector2(1.2, 4.8),     // Insulating groove start
    new THREE.Vector2(1.2, 5.5),     // Insulating groove end
    new THREE.Vector2(1.75, 5.5),    // Sleeve start
    new THREE.Vector2(1.75, 14.0),   // Sleeve end
    new THREE.Vector2(2.5, 14.5),    // Strain relief taper
    new THREE.Vector2(2.5, 18.0),    // Strain relief end (cable exit)
    new THREE.Vector2(1.5, 18.0),    // Cable diameter
  ]
  return new THREE.LatheGeometry(points, 12)  // 12 segments sufficient
}
```

Multi-material for the plug sections:
```typescript
// Nickel-plated tip+sleeve
const plugMetal = new THREE.MeshStandardMaterial({
  color: 0xc0c0c0, metalness: 0.95, roughness: 0.15,
})
// Black insulating collar
const plugInsulator = new THREE.MeshStandardMaterial({
  color: 0x111111, roughness: 0.8, metalness: 0.0,
})
// Colored strain relief (matches cable)
const plugGrip = new THREE.MeshStandardMaterial({
  color: cableColor, roughness: 0.6, metalness: 0.0,
})
```

### Cable Material — Silicone/Rubber
```typescript
const cableMaterial = new THREE.MeshStandardMaterial({
  color: 0xcc2222,     // Cable color
  roughness: 0.82,     // Matte rubber/silicone
  metalness: 0.0,
  envMapIntensity: 0.3, // Subtle ambient lighting even on matte surfaces
})
```

### Common Eurorack Cable Colors
```typescript
const CABLE_COLORS = {
  red:    0xcc2222,   // Most common — Tiptop/Hosa staple
  yellow: 0xddcc22,
  blue:   0x2244aa,
  green:  0x22aa44,
  orange: 0xdd6622,
  white:  0xe8e8e8,
  black:  0x222222,
  purple: 0x6622aa,
}
```

### Cable Routing Rules
1. **Stub out** — straight line from jack face along panel normal (~15mm, plug body length)
2. **Transition curve** — smooth blend from horizontal to hanging
3. **Catenary body** — main drooping section
4. **Transition curve** — mirror approach to destination
5. **Stub in** — straight into destination jack

When multiple cables overlap, add slight random Z offsets (1-3mm) to prevent z-fighting.

### Cable Performance
Each cable has a unique curve, so `InstancedMesh` doesn't apply. Options by count:

| Cables | Approach | Draw Calls |
|--------|----------|------------|
| 1-20 | Individual `TubeGeometry` | 1 per cable |
| 20-100 | `mergeGeometries()` | 1 total |
| 100+ | `BatchedMesh` (Three.js r156+) | 1 total |

With 8 radial + 48 tubular segments, each cable is ~768 triangles. 100 cables = ~77K tris — trivial for any GPU.

Share materials by color (one material per color, reused across all cables of that color). Only rebuild geometry when cables are added/removed, not every frame.

### Decorative Cable Suggestions
For the beauty shot, place 1-2 cables:
- Red cable: CLK OUT → a hypothetical offscreen module (exits frame)
- Blue cable: PITCH1 → offscreen (drooping down, exits bottom of view)

---

## 9. Buttons with LEDs

### LED Glow System

Each button has an internal LED mesh with emissive material. LED state comes from the WASM engine.

```typescript
// LED state mapping
function setButtonLED(
  ledMesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>,
  state: 'off' | 'on' | 'dim' | 'flash',
  color: number = 0xe94560,
) {
  const mat = ledMesh.material
  switch (state) {
    case 'off':
      mat.emissive.setHex(0x000000)
      mat.emissiveIntensity = 0
      break
    case 'dim':
      mat.emissive.setHex(color)
      mat.emissiveIntensity = 0.2
      break
    case 'on':
      mat.emissive.setHex(color)
      mat.emissiveIntensity = 1.0
      break
    case 'flash':
      mat.emissive.setHex(0x44ff66)
      mat.emissiveIntensity = 1.5  // Overdrive for bloom
      break
  }
}
```

For threshold-based bloom, set LED `emissiveIntensity` high enough to exceed the bloom threshold:
```typescript
// 'on' state: emissiveIntensity 2-5 → exceeds bloom threshold of 0.8
// 'dim' state: emissiveIntensity 0.3 → below threshold, no bloom
// 'flash' state: emissiveIntensity 5 → strong bloom
```

---

## 10. Lighting & Environment

### Studio Lighting Setup

```typescript
// Ambient fill
scene.add(new THREE.AmbientLight(0xffffff, 0.3))

// Key light — soft directional from upper-right
const keyLight = new THREE.DirectionalLight(0xfff8f0, 1.2)
keyLight.position.set(100, 50, 150)
keyLight.castShadow = false  // Shadows optional for front-facing panel
scene.add(keyLight)

// Fill light — dimmer, from left
const fillLight = new THREE.DirectionalLight(0xf0f0ff, 0.4)
fillLight.position.set(-80, 30, 100)
scene.add(fillLight)

// Rim light — from behind for edge highlighting
const rimLight = new THREE.DirectionalLight(0xffffff, 0.6)
rimLight.position.set(0, -50, -100)
scene.add(rimLight)

// Soft panel light (RectAreaLight — great for product shots)
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
RectAreaLightUniformsLib.init()

const softbox = new THREE.RectAreaLight(0xffffff, 2.0, 200, 200)
softbox.position.set(0, 0, 200)
softbox.lookAt(0, 0, 0)
scene.add(softbox)
```

### HDRI Environment Map

For realistic metallic reflections, use an HDRI environment map:

```typescript
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'

const pmrem = new THREE.PMREMGenerator(renderer)

// Option 1: Load an HDRI file
new RGBELoader().load('studio_small.hdr', (texture) => {
  const envMap = pmrem.fromEquirectangular(texture).texture
  scene.environment = envMap  // All PBR materials use this
  texture.dispose()
  pmrem.dispose()
})

// Option 2: Procedural environment (no external file)
// Use scene.environment = pmrem.fromScene(roomEnvironment).texture
```

Good free HDRI options for product shots (all CC0 from [Poly Haven](https://polyhaven.com/hdris/studio)):
- `studio_small_08` — most popular (571k downloads), soft low-contrast softbox, neutral tone
- `pav_studio_03` — soft mixed natural+artificial, 20K resolution
- `white_home_studio` — white studio with softbox/umbrella

Download at 1K resolution for env lighting (PMREMGenerator outputs 256x256 cubemap). Use 2K-4K only if also using as visible background.

**Procedural alternative — `RoomEnvironment`:**
```typescript
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
const envMap = pmrem.fromScene(new RoomEnvironment()).texture
scene.environment = envMap
```
Generates a simple studio-like environment procedurally — no HDRI file needed. Quick and decent for product shots. Avoids external file loading entirely.

### Tone Mapping
```typescript
// When using EffectComposer, set NoToneMapping on renderer — OutputPass handles it
renderer.toneMapping = THREE.NoToneMapping
renderer.outputColorSpace = THREE.SRGBColorSpace
```

**AgXToneMapping** (recommended over ACES):
- Better color preservation across full dynamic range
- Handles bright emissive LEDs + dark panel without washing out darks
- Available since Three.js r160+, default in Blender 4.0
- ACES tends to desaturate dark areas, making the panel look washed out

Tone mapping and exposure are configured on the `OutputPass` (last pass in the chain).

---

## 11. Post-Processing

### Pipeline Setup

```typescript
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

// Use HalfFloatType framebuffer to avoid color banding
const renderTarget = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType })
const composer = new EffectComposer(renderer, renderTarget)

// 1. Base render
composer.addPass(new RenderPass(scene, camera))

// 2. Bloom (LED glow) — threshold-based selective bloom
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.4,   // strength — keep low for subtlety
  0.2,   // radius — small = tight glow around LEDs
  0.8,   // threshold — only bright emissive pixels bloom
)
composer.addPass(bloom)

// 3. Antialiasing (hardware AA doesn't work with post-processing)
const smaa = new SMAAPass(window.innerWidth, window.innerHeight)
composer.addPass(smaa)

// 4. Output — handles sRGB conversion AND tone mapping
// Set renderer.toneMapping to AgXToneMapping for best results
const output = new OutputPass()
composer.addPass(output)
```

**Important:** `OutputPass` replaces the legacy `GammaCorrectionShader`. It handles both sRGB color space conversion and tone mapping. Set `renderer.toneMapping = THREE.NoToneMapping` when using EffectComposer to avoid double tone mapping — OutputPass reads the renderer's settings.

### Selective Bloom Strategy

**Threshold-based (recommended — simplest):**
- Set LED `emissiveIntensity` to 2-5 so they exceed the bloom threshold (0.8)
- The dark panel stays well below threshold → no unwanted glow
- Any specular highlights on metal that accidentally bloom are usually acceptable

**Layer-based (fallback if threshold isn't selective enough):**
1. Assign LED meshes to layer 1
2. Render layer 1 with bloom composer
3. Render full scene with normal composer
4. Blend with a custom `ShaderPass`
5. Requires material save/restore logic — more boilerplate

**WebGPU MRT approach (future):**
Three.js r160+ supports Multiple Render Targets with `BloomNode` on the emissive buffer only. Cleanest solution but requires WebGPU renderer.

### Ambient Occlusion

**N8AOPass** (recommended over SSAOPass):
- `npm install n8ao`
- Replaces `RenderPass` (renders internally)
- Key params: `aoRadius` (world units), `distanceFalloff`, `intensity` (2=soft, 5=heavy)
- Has quality presets and half-resolution mode for performance
- Adds subtle contact shadows between components and panel

For the initial implementation, skip AO and add it later if the scene looks flat. The environment map reflections and bloom provide most of the visual depth.

### Shadows

**Not needed for a front-facing eurorack panel.** The panel faces the camera directly, so there are minimal self-shadowing opportunities. Depth and realism come from:
- Ambient occlusion (N8AOPass) for contact shadows and crevice darkening
- Environment map reflections on the metal surface
- Subtle bloom on LEDs

If angled camera shots are added later, a single directional light with `PCFSoftShadowMap` works:
```typescript
light.shadow.bias = -0.0001
light.shadow.normalBias = 0.02
light.shadow.mapSize.set(1024, 1024)
```

---

## 12. Interaction (Phase 3)

### Raycaster Hit Detection

```typescript
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()

function onPointerDown(event: PointerEvent) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1

  raycaster.setFromCamera(pointer, camera)
  const intersects = raycaster.intersectObjects(interactiveObjects, true)

  if (intersects.length > 0) {
    const hit = intersects[0].object
    const componentId = hit.userData.componentId
    // Emit the same ControlEvent as the 2D panel
    handleComponentClick(componentId)
  }
}
```

### Encoder Drag-to-Rotate

```typescript
let dragEncoder: THREE.Group | null = null
let dragStartY = 0

function onPointerMove(event: PointerEvent) {
  if (!dragEncoder) return
  const deltaY = event.clientY - dragStartY
  const deltaTurns = deltaY / 50  // 50px per encoder tick
  emit({ type: `encoder-${dragEncoder.userData.id}-turn`, delta: Math.sign(deltaTurns) })
  dragStartY = event.clientY
}
```

### Button Press Animation

```typescript
function animateButtonPress(buttonGroup: THREE.Group) {
  const cap = buttonGroup.children.find(c => c.userData.role === 'cap')
  if (!cap) return
  // Depress 0.5mm
  cap.position.z = 1.0  // From normal 1.5
  setTimeout(() => { cap.position.z = 1.5 }, 100)
}
```

### Sync with WASM Engine

Phase 3 reuses the exact same `ControlEvent` system. The 3D viewer emits events through `onControlEvent()` just like the 2D panel. The WASM engine doesn't care where events come from.

### Camera Setup

```typescript
// Low FOV (telephoto) for minimal perspective distortion — product-shot look
const camera = new THREE.PerspectiveCamera(30, w/h, 0.1, 2000)
camera.position.set(0, 0, 300)  // Front-facing, ~300mm from panel

const controls = new OrbitControls(camera, renderer.domElement)
controls.minDistance = 100       // Don't zoom too close (distortion)
controls.maxDistance = 500       // Don't zoom too far out
controls.minPolarAngle = Math.PI * 0.3   // Limit vertical angle
controls.maxPolarAngle = Math.PI * 0.7   // Keep mostly front-facing
controls.enableDamping = true
controls.dampingFactor = 0.05
controls.target.set(0, 0, 0)    // Look at panel center

// Optional: auto-rotate for showcase mode
controls.autoRotate = false      // Enable via UI toggle
controls.autoRotateSpeed = 1.0   // Slow rotation (30s per orbit at 60fps)
```

**FOV tip:** 25-35 degrees mimics a telephoto lens — less barrel distortion, more flattering product shot. Place camera farther back with low FOV rather than close up with wide FOV.

---

## 13. Performance

### Budget
- Target: 60 FPS on mid-range GPU (integrated graphics)
- Geometry budget: ~50K triangles total
- Texture budget: <10 MB VRAM

### Optimizations

**InstancedMesh for repeated components:**
```typescript
// 26 jacks × 3 parts = 78 meshes → 3 InstancedMesh calls
const hexNutInstanced = new THREE.InstancedMesh(hexNutGeo, metalMat, 26)
const washerInstanced = new THREE.InstancedMesh(washerGeo, metalMat, 26)

// Set per-instance transforms
const matrix = new THREE.Matrix4()
jacks.forEach((jack, i) => {
  matrix.makeTranslation(jack.x_3d, jack.y_3d, 2.0)
  hexNutInstanced.setMatrixAt(i, matrix)
})
```

**Geometry merge for static elements:**
```typescript
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
// Merge all mounting slots into one draw call
```

**LOD (optional):**
- At zoom level > 2x: show full detail + knurling
- At zoom level 1x: simplified geometry, no bump maps
- At zoom level < 0.5x: flat colored discs for buttons/jacks

**CanvasTexture throttling:**
```typescript
let frameCount = 0
function render() {
  frameCount++
  // Update display texture every 2nd frame (still 30 FPS display update)
  if (frameCount % 2 === 0) {
    displayTexture.needsUpdate = true
  }
}
```

### Triangle Estimates
| Component | Per-unit | Count | Total |
|-----------|---------|-------|-------|
| Faceplate panel | ~200 | 1 | 200 |
| Jack (hex+washer+bushing+hole) | ~300 | 26 | 7,800 |
| Button (housing+cap+LED) | ~200 | ~30 | 6,000 |
| Encoder cap (LatheGeometry 64seg) | ~2,000 | 2 | 4,000 |
| Display (bezel+plane+glass) | ~50 | 1 | 50 |
| Patch cable (TubeGeometry 64seg) | ~2,000 | 2 | 4,000 |
| Cable plugs | ~200 | 4 | 800 |
| Silkscreen plane | ~2 | 1 | 2 |
| Mounting slots | ~100 | 4 | 400 |
| Connectors | ~50 | 2 | 100 |
| **Total** | | | **~23,000** |

Well within budget. Could go 10x higher without issues.

### Recommended Complete Pipeline Summary

```
Renderer:
  toneMapping: NoToneMapping (OutputPass handles it)
  shadowMap: disabled (use AO instead for front-facing panel)
  outputColorSpace: SRGBColorSpace

EffectComposer (HalfFloatType framebuffer):
  1. RenderPass (or N8AOPass for AO — replaces RenderPass)
  2. UnrealBloomPass (threshold: 0.8, strength: 0.4, radius: 0.2)
  3. SMAAPass
  4. OutputPass (AgXToneMapping, exposure ~1.0)

Scene:
  environment: studio_small_08.hdr via PMREMGenerator (or RoomEnvironment)
  background: dark gradient (0x0a0a0f) or null

Lighting:
  HDRI environment (primary — drives metallic reflections)
  1 RectAreaLight softbox for accent highlights on brushed aluminum
  1 DirectionalLight key light (warm white, 1.0 intensity)
  1 DirectionalLight fill light (cool white, 0.3 intensity)
  AmbientLight (0.2 intensity, minimal)

Materials:
  Panel: MeshPhysicalMaterial, metalness: 1, roughness: 0.3, anisotropy: 1
  Chrome jacks: MeshPhysicalMaterial, metalness: 0.95, roughness: 0.15
  Buttons: MeshPhysicalMaterial, roughness: 0.6, slight transmission
  LEDs: MeshStandardMaterial, emissive with emissiveIntensity: 2-5
  Display: MeshStandardMaterial, emissiveMap = CanvasTexture
  Knobs: MeshPhysicalMaterial, metalness: 0.7, roughness: 0.35, bumpMap
  Cables: MeshStandardMaterial, roughness: 0.7, metalness: 0

Camera:
  PerspectiveCamera, FOV: 30, telephoto framing
  OrbitControls with damping, constrained angles, optional auto-rotate
```

---

## 14. Implementation Phases

### Phase 1: Static Beauty Shot
**Estimated scope: ~600 LOC**

1. Create `preview-scene.ts` — Scene, camera, renderer, OrbitControls
2. Create `materials.ts` — Shared material definitions (aluminum, metal, plastic)
3. Create `faceplate-mesh.ts` — Extruded panel with LCD cutout + mounting slot holes
4. Create silkscreen canvas texture with all labels + "REQUENCER" title
5. Create `jack-geometry.ts` — Procedural Thonkiconn with InstancedMesh
6. Create `button-geometry.ts` — Procedural tactile button
7. Create `encoder-geometry.ts` — LatheGeometry cap with bump-mapped knurling
8. Create `mounting-slot.ts` — Pill-shaped slot geometry
9. Create `connector-geometry.ts` — USB-C and SD card
10. Set up three-point studio lighting
11. Configure tone mapping and basic post-processing (SMAA + OutputPass)
12. Wire into debug menu as "3D Preview" button
13. Place all components from `panel-layout.json` coordinates

### Phase 2: Live Elements
**Estimated scope: ~300 LOC additional**

1. Create `display-mesh.ts` — CanvasTexture from LCD canvas, glass overlay
2. Wire display texture update into render loop
3. Create `cable-mesh.ts` — CatmullRomCurve3 catenary + TubeGeometry + plug tips
4. Add 2 decorative cables (CLK OUT → offscreen, PITCH1 → offscreen)
5. Add `UnrealBloomPass` for LED glow
6. Sync encoder cap rotation from UI state
7. Sync button LED states from WASM engine

### Phase 3: Full Interactive 3D Sequencer
**Estimated scope: ~400 LOC additional**

1. Create `interaction.ts` — Raycaster, pointer events
2. Add button click detection → emit ControlEvent
3. Add encoder drag-to-rotate → emit encoder turn events
4. Add button press animation (depress/release)
5. Full LED state sync (step buttons, track buttons, play button)
6. Add toggle in debug menu: "2D Panel / 3D Panel"
7. When in 3D mode, hide DOM panel, show Three.js canvas
8. Route all ControlEvents through the same handler

### Future Ideas
- HDRI environment map for photo-real reflections
- SSAO for contact shadows
- Animated cables (physics-based with Verlet integration)
- Multiple camera presets (front, angled, close-up on display)
- Auto-rotate showcase mode
- Export high-res screenshot
- Dark/light panel color options
- Rack context (render neighboring modules in 3D too)

---

## References

### Three.js Official
- [MeshPhysicalMaterial docs](https://threejs.org/docs/api/en/materials/MeshPhysicalMaterial.html)
- [LatheGeometry docs](https://threejs.org/docs/pages/LatheGeometry.html)
- [TubeGeometry docs](https://threejs.org/docs/api/en/geometries/TubeGeometry.html)
- [UnrealBloomPass docs](https://threejs.org/docs/pages/UnrealBloomPass.html)
- [Selective bloom example](https://threejs.org/examples/webgl_postprocessing_unreal_bloom_selective.html)
- [CanvasTexture manual](https://threejs.org/manual/en/canvas-textures.html)

### Tutorials & Examples
- [Codrops: Glass/plastic in Three.js](https://tympanus.net/codrops/2021/10/27/creating-the-effect-of-transparent-glass-and-plastic-in-three-js/)
- [Selective bloom tutorial (Wael Yasmina)](https://waelyasmina.net/articles/unreal-bloom-selective-threejs-post-processing/)
- [DecalGeometry (GitHub)](https://github.com/spite/THREE.DecalGeometry)
- [THREE.Interactive library](https://github.com/markuslerner/THREE.Interactive)
- [Dustin Pfister: LatheGeometry guide](https://dustinpfister.github.io/2023/06/07/threejs-lathe-geometry/)

### Component References
- [Thonkiconn PJ398SM (Thonk)](https://www.thonk.co.uk/shop/thonkiconn/)
- [AudioJacks KiCad library (GitHub)](https://github.com/clacktronics/AudioJacks/blob/main/DATA.md)
- [Thonkiconn 3D model (TurboSquid)](https://www.turbosquid.com/3d-models/3d-thonkiconn-jack-socket-1774435)

### HDRI Environments
- [Polyhaven free HDRIs](https://polyhaven.com/hdris)
