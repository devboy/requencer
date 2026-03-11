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

For a **brushed aluminum** effect, add an anisotropic roughness normal map:
- Generate procedurally: horizontal lines canvas → CanvasTexture → normalMap
- Or use a single-direction noise texture

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

### Physical Reference: Re'an P670 / Davies 1900h Clone

Common eurorack encoder caps for EC11E (6mm D-shaft):
- **Davies 1900h clone**: ~19mm diameter, 14mm tall, knurled sides, pointer line
- **Re'an/Sifam collet knob**: ~12mm diameter, aluminum, knurled grip
- **Rogan series** (Make Noise style): ~15mm, soft-touch rubber, white indicator

For the Requencer, a **small aluminum knurled cap** (~14.5mm matching the existing CSS render) fits best.

### Geometry: LatheGeometry Profile

```typescript
function createEncoderCapGeometry(): THREE.BufferGeometry {
  // Cross-section profile (rotated around Y-axis)
  // Profile is right half: from center outward
  const points: THREE.Vector2[] = [
    // Bottom (base, sits on encoder shaft)
    new THREE.Vector2(0.0, 0.0),      // Center bottom
    new THREE.Vector2(6.5, 0.0),      // Base edge (13mm base diameter)
    // Skirt (slight flare at bottom)
    new THREE.Vector2(7.0, 0.5),      // Skirt flare
    new THREE.Vector2(7.25, 1.0),     // Max diameter = 14.5mm
    // Main body (knurled cylindrical section)
    new THREE.Vector2(7.25, 6.0),     // Cylindrical section
    // Top chamfer
    new THREE.Vector2(7.0, 6.5),      // Chamfer start
    new THREE.Vector2(6.0, 7.0),      // Top edge
    // Dished top
    new THREE.Vector2(5.5, 6.8),      // Slight dish
    new THREE.Vector2(0.0, 6.5),      // Center top (slightly dished)
  ]

  return new THREE.LatheGeometry(points, 64)  // 64 segments for smooth
}
```

### Knurled Surface

**Option A — Bump map (recommended for performance)**:
Generate a procedural knurling pattern as a canvas texture:
```typescript
function createKnurlingBumpMap(segments: number = 48): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = segments * 4  // Width wraps around circumference
  canvas.height = 128           // Height = vertical extent
  const ctx = canvas.getContext('2d')!

  // Diamond knurling pattern
  for (let i = 0; i < segments; i++) {
    const x = i * 4
    ctx.fillStyle = i % 2 === 0 ? '#888' : '#666'
    ctx.fillRect(x, 0, 2, 128)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  return tex
}
```

**Option B — Geometry-based knurling** (high poly):
Modulate the LatheGeometry vertices radially to create physical ridges. Expensive but looks great at close zoom.

### Material — Brushed Aluminum Knob
```typescript
const knobMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x2a2a2a,           // Dark aluminum
  metalness: 0.7,
  roughness: 0.35,
  bumpMap: knurlingBumpMap,
  bumpScale: 0.3,
  clearcoat: 0.1,
})
```

### Indicator Line
```typescript
// White line on top face — use a thin PlaneGeometry
const indicator = new THREE.Mesh(
  new THREE.PlaneGeometry(1.0, 5.0),  // 1mm wide, 5mm long
  new THREE.MeshBasicMaterial({ color: 0xdddddd })
)
indicator.position.set(0, 7.01, 2.5)  // On top face
indicator.rotation.x = -Math.PI / 2
```

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

Where:
- `a` = parameter controlling droop (related to cable weight/tension)
- `x₀` = horizontal midpoint
- `y₀` = vertical offset

For eurorack cables plugged into a vertical panel:
- Cable exits perpendicular to the panel (along Z), then droops due to gravity (along -Y)
- The curve lives in the YZ plane (from the jack's perspective)

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

### 3.5mm Plug Tip Geometry

```typescript
function createPlugTip(position: THREE.Vector3, cableColor: number): THREE.Group {
  const plug = new THREE.Group()

  // Metal tip (the actual 3.5mm connector)
  const tip = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 8, 16),  // 3mm diameter, 8mm long
    new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.9, roughness: 0.2 })
  )
  tip.rotation.x = Math.PI / 2

  // Insulation ring
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(2.0, 2.0, 1.5, 16),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 })
  )
  ring.rotation.x = Math.PI / 2
  ring.position.z = -5

  // Strain relief / grip (colored to match cable)
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.0, 10, 16),
    new THREE.MeshStandardMaterial({ color: cableColor, roughness: 0.6, metalness: 0.0 })
  )
  grip.rotation.x = Math.PI / 2
  grip.position.z = -12

  plug.add(tip, ring, grip)
  plug.position.copy(position)
  // Orient plug to face outward from panel
  plug.lookAt(position.x, position.y, position.z + 10)

  return plug
}
```

### Common Eurorack Cable Colors
```typescript
const CABLE_COLORS = {
  red:    0xe94560,
  yellow: 0xf5c623,
  blue:   0x4488cc,
  green:  0x50c878,
  white:  0xe0e0e0,
  black:  0x222222,
  orange: 0xf5a623,
  purple: 0x8855cc,
}
```

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

For bloom to work on LEDs, assign LED meshes to a bloom layer:
```typescript
ledMesh.layers.enable(1)  // Layer 1 = bloom layer
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

Good free HDRI options for product shots:
- Polyhaven: `studio_small_09_2k.hdr` (soft studio lighting)
- Polyhaven: `photo_studio_01_2k.hdr` (neutral lightbox)

Alternatively, skip external HDRIs and use a procedural gradient environment to avoid loading external files.

### Tone Mapping
```typescript
renderer.toneMapping = THREE.ACESFilmicToneMapping  // Good for high dynamic range
renderer.toneMappingExposure = 1.0
renderer.outputColorSpace = THREE.SRGBColorSpace
```

---

## 11. Post-Processing

### Pipeline Setup

```typescript
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

const composer = new EffectComposer(renderer)

// 1. Base render
composer.addPass(new RenderPass(scene, camera))

// 2. Bloom (LED glow)
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.5,   // strength (subtle — only LEDs should bloom)
  0.4,   // radius
  0.85,  // threshold (only bright emissive pixels bloom)
)
composer.addPass(bloom)

// 3. Antialiasing
const smaa = new SMAAPass(window.innerWidth, window.innerHeight)
composer.addPass(smaa)

// 4. Output (gamma correction)
composer.addPass(new OutputPass())
```

### Selective Bloom (Optional Enhancement)

If the bloom threshold approach isn't selective enough (e.g., the aluminum panel blooms too), use the **layers-based selective bloom** approach:

1. Assign LED meshes to layer 1
2. Render layer 1 with bloom composer
3. Render full scene with normal composer
4. Blend with a custom `ShaderPass`

This is the approach used in the official Three.js selective bloom example.

### SSAO (Optional)

Adds subtle contact shadows between components and the panel. Skip initially for performance; add later if the scene looks flat.

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
