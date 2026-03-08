# UI Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement three UI improvements: (1) redesign transpose screen as a per-track scrollable menu with note window and dynamics scaling, (2) update T1-T4 button labels to `T/O N`, (3) make subtrack hold overlay thin (header-height) on edit screens.

**Architecture:** The transpose screen redesign follows the established RAND screen pattern — a row-definition file (`xpose-rows.ts`) drives both the renderer and the mode-machine dispatch. TransposeConfig expands with new fields, and routing applies the transforms at output time. The button label and overlay changes are cosmetic/rendering-only.

**Tech Stack:** TypeScript, Canvas 2D rendering, Vitest

---

### Task 1: Expand TransposeConfig type

**Files:**
- Modify: `src/engine/types.ts:131-135`

**Step 1: Write the failing test**

Create `src/engine/__tests__/transpose.test.ts`:

```typescript
import { describe, test, expect } from 'vitest'
import type { TransposeConfig } from '../types'

describe('TransposeConfig type', () => {
  test('has all required fields with correct defaults', () => {
    const config: TransposeConfig = {
      semitones: 0,
      noteLow: 0,
      noteHigh: 127,
      glScale: 1.0,
      velScale: 1.0,
    }
    expect(config.semitones).toBe(0)
    expect(config.noteLow).toBe(0)
    expect(config.noteHigh).toBe(127)
    expect(config.glScale).toBe(1.0)
    expect(config.velScale).toBe(1.0)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/__tests__/transpose.test.ts`
Expected: FAIL — `noteLow`, `noteHigh`, `glScale`, `velScale` don't exist on TransposeConfig

**Step 3: Update the type**

In `src/engine/types.ts`, replace lines 131-135:

```typescript
// Pitch transposition config
export interface TransposeConfig {
  semitones: number           // -48 to +48
  noteLow: number             // 0-127, output note floor (octave-wrap)
  noteHigh: number            // 0-127, output note ceiling (octave-wrap)
  glScale: number             // 0.25-4.0 (1.0 = 100%, gate length multiplier)
  velScale: number             // 0.25-4.0 (1.0 = 100%, velocity multiplier)
}
```

**Step 4: Fix all compile errors from removed `quantize` field**

The old `quantize: boolean` field is removed. Search for all usages:
- `src/engine/sequencer.ts:130` — initialization: change `{ semitones: 0, quantize: false }` to `{ semitones: 0, noteLow: 0, noteHigh: 127, glScale: 1.0, velScale: 1.0 }`
- `src/ui/mode-machine.ts:526` — `quantize: !tc.quantize` in dispatchTransposeEdit: will be replaced in Task 5
- `src/ui/lcd/transpose-screen.ts:52` — `tc.quantize` render check: will be replaced in Task 6
- Any test files referencing `quantize` on TransposeConfig

**Step 5: Run tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All pass (existing transpose tests may need `quantize` removed)

---

### Task 2: Apply note window + scaling in routing

**Files:**
- Modify: `src/engine/routing.ts:34-38`
- Test: `src/engine/__tests__/transpose.test.ts` (extend)

**Step 1: Write the failing tests**

Add to `src/engine/__tests__/transpose.test.ts`:

```typescript
import { resolveOutputs, createDefaultRouting } from '../routing'
import type { SequenceTrack, MuteTrack, TransposeConfig, GateStep, PitchStep } from '../types'

function makeTrack(overrides: Partial<SequenceTrack> = {}): SequenceTrack {
  const defaultGateStep: GateStep = { on: true, tie: false, length: 0.5, ratchet: 1 }
  const defaultPitchStep: PitchStep = { note: 60, slide: 0 }
  return {
    id: 't1', name: 'Track 1', clockDivider: 1,
    gate: { steps: [defaultGateStep], length: 1, clockDivider: 1, currentStep: 0 },
    pitch: { steps: [defaultPitchStep], length: 1, clockDivider: 1, currentStep: 0 },
    velocity: { steps: [100], length: 1, clockDivider: 1, currentStep: 0 },
    mod: { steps: [0.5], length: 1, clockDivider: 1, currentStep: 0 },
    ...overrides,
  }
}

function makeMute(): MuteTrack {
  return { steps: [false], length: 1, clockDivider: 1, currentStep: 0 }
}

describe('routing — transpose note window', () => {
  test('octave-wraps pitch above noteHigh', () => {
    const tracks = [makeTrack({ pitch: { steps: [{ note: 84, slide: 0 }], length: 1, clockDivider: 1, currentStep: 0 } })]
    const routing = [{ gate: 0, pitch: 0, velocity: 0, mod: 0 }]
    const mutes = [makeMute()]
    const xpose: TransposeConfig[] = [{ semitones: 0, noteLow: 48, noteHigh: 72, glScale: 1.0, velScale: 1.0 }]
    const [ev] = resolveOutputs(tracks, routing, mutes, xpose)
    // 84 is above 72, wrap down: 84 - 12 = 72 (at boundary = OK)
    expect(ev.pitch).toBe(72)
  })

  test('octave-wraps pitch below noteLow', () => {
    const tracks = [makeTrack({ pitch: { steps: [{ note: 36, slide: 0 }], length: 1, clockDivider: 1, currentStep: 0 } })]
    const routing = [{ gate: 0, pitch: 0, velocity: 0, mod: 0 }]
    const mutes = [makeMute()]
    const xpose: TransposeConfig[] = [{ semitones: 0, noteLow: 48, noteHigh: 72, glScale: 1.0, velScale: 1.0 }]
    const [ev] = resolveOutputs(tracks, routing, mutes, xpose)
    // 36 is below 48, wrap up: 36 + 12 = 48
    expect(ev.pitch).toBe(48)
  })

  test('applies transpose + note window together', () => {
    const tracks = [makeTrack({ pitch: { steps: [{ note: 70, slide: 0 }], length: 1, clockDivider: 1, currentStep: 0 } })]
    const routing = [{ gate: 0, pitch: 0, velocity: 0, mod: 0 }]
    const mutes = [makeMute()]
    const xpose: TransposeConfig[] = [{ semitones: 7, noteLow: 48, noteHigh: 72, glScale: 1.0, velScale: 1.0 }]
    const [ev] = resolveOutputs(tracks, routing, mutes, xpose)
    // 70 + 7 = 77, above 72, wrap: 77 - 12 = 65
    expect(ev.pitch).toBe(65)
  })

  test('no wrapping when noteLow=0 noteHigh=127', () => {
    const tracks = [makeTrack({ pitch: { steps: [{ note: 100, slide: 0 }], length: 1, clockDivider: 1, currentStep: 0 } })]
    const routing = [{ gate: 0, pitch: 0, velocity: 0, mod: 0 }]
    const mutes = [makeMute()]
    const xpose: TransposeConfig[] = [{ semitones: 0, noteLow: 0, noteHigh: 127, glScale: 1.0, velScale: 1.0 }]
    const [ev] = resolveOutputs(tracks, routing, mutes, xpose)
    expect(ev.pitch).toBe(100)
  })
})

describe('routing — transpose GL/VEL scaling', () => {
  test('scales gate length by glScale', () => {
    const tracks = [makeTrack()]
    const routing = [{ gate: 0, pitch: 0, velocity: 0, mod: 0 }]
    const mutes = [makeMute()]
    const xpose: TransposeConfig[] = [{ semitones: 0, noteLow: 0, noteHigh: 127, glScale: 0.5, velScale: 1.0 }]
    const [ev] = resolveOutputs(tracks, routing, mutes, xpose)
    expect(ev.gateLength).toBe(0.25) // 0.5 * 0.5
  })

  test('clamps gate length to 1.0 max', () => {
    const tracks = [makeTrack()]
    tracks[0].gate.steps[0].length = 0.8
    const routing = [{ gate: 0, pitch: 0, velocity: 0, mod: 0 }]
    const mutes = [makeMute()]
    const xpose: TransposeConfig[] = [{ semitones: 0, noteLow: 0, noteHigh: 127, glScale: 2.0, velScale: 1.0 }]
    const [ev] = resolveOutputs(tracks, routing, mutes, xpose)
    expect(ev.gateLength).toBe(1.0) // 0.8 * 2.0 = 1.6 → clamped to 1.0
  })

  test('scales velocity by velScale', () => {
    const tracks = [makeTrack()]
    const routing = [{ gate: 0, pitch: 0, velocity: 0, mod: 0 }]
    const mutes = [makeMute()]
    const xpose: TransposeConfig[] = [{ semitones: 0, noteLow: 0, noteHigh: 127, glScale: 1.0, velScale: 0.5 }]
    const [ev] = resolveOutputs(tracks, routing, mutes, xpose)
    expect(ev.velocity).toBe(50) // 100 * 0.5
  })

  test('clamps velocity to 1-127', () => {
    const tracks = [makeTrack()]
    const routing = [{ gate: 0, pitch: 0, velocity: 0, mod: 0 }]
    const mutes = [makeMute()]
    const xpose: TransposeConfig[] = [{ semitones: 0, noteLow: 0, noteHigh: 127, glScale: 1.0, velScale: 3.0 }]
    const [ev] = resolveOutputs(tracks, routing, mutes, xpose)
    expect(ev.velocity).toBe(127) // 100 * 3.0 = 300 → clamped to 127
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/__tests__/transpose.test.ts`
Expected: FAIL — note window wrapping and scaling not implemented

**Step 3: Implement in routing.ts**

In `src/engine/routing.ts`, after the existing semitone transpose block (lines 34-38), add:

```typescript
// Note window: octave-wrap pitch into noteLow..noteHigh range
if (transpose && (transpose.noteLow > 0 || transpose.noteHigh < 127)) {
  const lo = transpose.noteLow
  const hi = transpose.noteHigh
  if (hi > lo) {
    const range = hi - lo
    while (pitch > hi) pitch -= Math.max(12, Math.ceil(range / 12) * 12)
    while (pitch < lo) pitch += Math.max(12, Math.ceil(range / 12) * 12)
    // Final clamp in case range < 12
    pitch = Math.max(lo, Math.min(hi, pitch))
  }
}
```

Then, after computing `gateLength` and `velocity`, before the mute check, apply scaling:

```typescript
// Apply GL/VEL scaling from transpose config
const glTranspose = transposeConfigs?.[r.gate]
let scaledGateLength = gateLength
if (glTranspose && glTranspose.glScale !== 1.0) {
  scaledGateLength = Math.max(0.05, Math.min(1.0, gateLength * glTranspose.glScale))
}

const velTranspose = transposeConfigs?.[r.velocity]
let scaledVelocity = velocity
if (velTranspose && velTranspose.velScale !== 1.0) {
  scaledVelocity = Math.max(1, Math.min(127, Math.round(velocity * velTranspose.velScale)))
}
```

Use `scaledGateLength` and `scaledVelocity` in the NoteEvent output.

**Step 4: Run tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All pass

---

### Task 3: XPOSE row definitions

**Files:**
- Create: `src/ui/xpose-rows.ts`

**Step 1: Write the failing test**

Create `src/ui/__tests__/xpose-rows.test.ts`:

```typescript
import { describe, test, expect } from 'vitest'
import { getXposeVisibleRows } from '../xpose-rows'
import type { SequencerState } from '../../engine/types'
import type { UIState } from '../hw-types'
import { createInitialEngineState } from '../../engine/sequencer'
import { createInitialUIState } from '../mode-machine'

describe('xpose-rows', () => {
  test('returns all rows (no conditional visibility)', () => {
    const engine = createInitialEngineState()
    const ui = createInitialUIState()
    const rows = getXposeVisibleRows(engine, ui)
    // 2 headers + 5 params = 7 rows
    expect(rows.length).toBe(7)
  })

  test('has PITCH and DYNAMICS section headers', () => {
    const engine = createInitialEngineState()
    const ui = createInitialUIState()
    const rows = getXposeVisibleRows(engine, ui)
    const headers = rows.filter(r => r.type === 'header')
    expect(headers.map(h => h.label)).toEqual(['PITCH', 'DYNAMICS'])
  })

  test('SEMI getValue shows semitone value with sign', () => {
    const engine = createInitialEngineState()
    engine.transposeConfigs[0] = { semitones: 7, noteLow: 0, noteHigh: 127, glScale: 1.0, velScale: 1.0 }
    const ui = createInitialUIState()
    const rows = getXposeVisibleRows(engine, ui)
    const semi = rows.find(r => r.paramId === 'xpose.semi')!
    expect(semi.getValue(engine, ui)).toBe('+7')
  })

  test('NOTE LO/HI getValue shows note names', () => {
    const engine = createInitialEngineState()
    engine.transposeConfigs[0] = { semitones: 0, noteLow: 48, noteHigh: 72, glScale: 1.0, velScale: 1.0 }
    const ui = createInitialUIState()
    const rows = getXposeVisibleRows(engine, ui)
    const lo = rows.find(r => r.paramId === 'xpose.noteLow')!
    const hi = rows.find(r => r.paramId === 'xpose.noteHigh')!
    expect(lo.getValue(engine, ui)).toBe('C3')
    expect(hi.getValue(engine, ui)).toBe('C5')
  })

  test('GL SCALE getValue shows percentage', () => {
    const engine = createInitialEngineState()
    engine.transposeConfigs[0] = { semitones: 0, noteLow: 0, noteHigh: 127, glScale: 2.0, velScale: 0.5 }
    const ui = createInitialUIState()
    const rows = getXposeVisibleRows(engine, ui)
    const gl = rows.find(r => r.paramId === 'xpose.glScale')!
    const vel = rows.find(r => r.paramId === 'xpose.velScale')!
    expect(gl.getValue(engine, ui)).toBe('200%')
    expect(vel.getValue(engine, ui)).toBe('50%')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/__tests__/xpose-rows.test.ts`
Expected: FAIL — module not found

**Step 3: Create xpose-rows.ts**

Create `src/ui/xpose-rows.ts` following the `rand-rows.ts` pattern:

```typescript
/**
 * XPOSE screen row definitions — shared between renderer and mode-machine dispatch.
 * Defines the scrollable parameter list for per-track transpose/scaling.
 */

import type { SequencerState } from '../engine/types'
import type { UIState } from './hw-types'
import { midiToNoteName } from './colors'

export type XposeRowType = 'header' | 'param'

export interface XposeRow {
  type: XposeRowType
  paramId: string
  label: string
  getValue: (engine: SequencerState, ui: UIState) => string
}

function buildRowDefs(): XposeRow[] {
  const cfg = (e: SequencerState, ui: UIState) => e.transposeConfigs[ui.selectedTrack]

  return [
    // --- PITCH section ---
    { type: 'header', paramId: 'section.pitch', label: 'PITCH', getValue: () => '' },
    {
      type: 'param', paramId: 'xpose.semi', label: 'SEMI',
      getValue: (e, ui) => {
        const s = cfg(e, ui).semitones
        return s > 0 ? `+${s}` : String(s)
      },
    },
    {
      type: 'param', paramId: 'xpose.noteLow', label: 'NOTE LO',
      getValue: (e, ui) => midiToNoteName(cfg(e, ui).noteLow),
    },
    {
      type: 'param', paramId: 'xpose.noteHigh', label: 'NOTE HI',
      getValue: (e, ui) => midiToNoteName(cfg(e, ui).noteHigh),
    },

    // --- DYNAMICS section ---
    { type: 'header', paramId: 'section.dynamics', label: 'DYNAMICS', getValue: () => '' },
    {
      type: 'param', paramId: 'xpose.glScale', label: 'GL SCALE',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).glScale * 100)}%`,
    },
    {
      type: 'param', paramId: 'xpose.velScale', label: 'VEL SCALE',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).velScale * 100)}%`,
    },
  ]
}

const ROW_DEFS = buildRowDefs()

/** All rows are always visible (no conditional params in XPOSE) */
export function getXposeVisibleRows(engine: SequencerState, ui: UIState): XposeRow[] {
  return ROW_DEFS
}
```

**Step 4: Run tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All pass

---

### Task 4: XPOSE screen renderer

**Files:**
- Modify: `src/ui/lcd/transpose-screen.ts` (replace contents)

**Step 1: No new test needed** — the renderer is a pure Canvas drawing function. Verify visually via `npm run dev`.

**Step 2: Replace `src/ui/lcd/transpose-screen.ts`**

Rewrite to use the scrollable menu pattern from `rand-screen.ts`:

```typescript
/**
 * LCD XPOSE screen — per-track scrollable parameter menu.
 * Same layout pattern as RAND screen: section headers, cursor, values right-aligned.
 * Enc A scrolls rows, Enc B adjusts values.
 * All text ≥16px for readability on 3.5" TFT at 50cm.
 */

import type { SequencerState } from '../../engine/types'
import type { UIState } from '../hw-types'
import { COLORS } from '../colors'
import { fillRect, drawText, LCD_W, LCD_CONTENT_Y, LCD_CONTENT_H } from '../renderer'
import { getXposeVisibleRows } from '../xpose-rows'

const PAD = 8
const HEADER_H = 30
const ROW_H = 24
const LIST_TOP = LCD_CONTENT_Y + HEADER_H + 2
const LABEL_X = PAD + 18
const VALUE_X = LCD_W - PAD

export function renderTransposeEdit(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const trackColor = COLORS.track[ui.selectedTrack]
  const rows = getXposeVisibleRows(engine, ui)

  // Header
  drawText(ctx, `XPOSE — T${ui.selectedTrack + 1}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)
  drawText(ctx, 'ENC A:▲▼  ENC B:val', LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textDim, 12, 'right')

  // Visible rows
  const maxVisible = Math.floor((LCD_CONTENT_H - HEADER_H - 4) / ROW_H)
  const scrollOffset = Math.max(0, Math.min(ui.xposeParam - Math.floor(maxVisible / 2), rows.length - maxVisible))

  for (let vi = 0; vi < maxVisible && scrollOffset + vi < rows.length; vi++) {
    const paramIdx = scrollOffset + vi
    const row = rows[paramIdx]
    const y = LIST_TOP + vi * ROW_H
    const isSelected = paramIdx === ui.xposeParam

    if (row.type === 'header') {
      const lineY = y + ROW_H / 2
      const headerText = ` ${row.label} `
      ctx.strokeStyle = COLORS.textDim
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD, lineY)
      ctx.lineTo(LCD_W - PAD, lineY)
      ctx.stroke()
      const labelColor = isSelected ? trackColor : COLORS.textDim
      const labelW = row.label.length * 10 + 16
      fillRect(ctx, { x: PAD, y: lineY - 10, w: labelW, h: 20 }, COLORS.bg)
      drawText(ctx, headerText, PAD + 4, lineY + 5, labelColor, 16)
      if (isSelected) {
        drawText(ctx, '▸', PAD, lineY + 5, trackColor, 16)
      }
    } else {
      if (isSelected) {
        fillRect(ctx, { x: PAD, y: y - 2, w: LCD_W - PAD * 2, h: ROW_H - 2 }, `${trackColor}22`)
      }
      const cursorColor = isSelected ? trackColor : 'transparent'
      drawText(ctx, '▸', PAD, y + ROW_H / 2 - 2, cursorColor, 16)
      drawText(ctx, row.label, LABEL_X, y + ROW_H / 2 - 2, isSelected ? COLORS.text : COLORS.textDim, 16)
      const value = row.getValue(engine, ui)
      drawText(ctx, value, VALUE_X, y + ROW_H / 2 - 2, isSelected ? '#ffffff' : COLORS.textDim, 16, 'right')
    }
  }

  // Scroll indicator
  if (rows.length > maxVisible) {
    const barH = LCD_CONTENT_H - HEADER_H - 8
    const thumbH = Math.max(12, (maxVisible / rows.length) * barH)
    const thumbY = LIST_TOP + (scrollOffset / (rows.length - maxVisible)) * (barH - thumbH)
    fillRect(ctx, { x: LCD_W - 3, y: thumbY, w: 2, h: thumbH }, `${trackColor}44`)
  }
}
```

**Step 3: Add `xposeParam` to UIState**

In `src/ui/hw-types.ts`, add to UIState (after `randParam`):
```typescript
xposeParam: number          // 0-N: selected parameter row in XPOSE screen
```

In `src/ui/mode-machine.ts`, add to `createInitialUIState()`:
```typescript
xposeParam: 0,
```

**Step 4: Run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All pass

---

### Task 5: XPOSE mode-machine dispatch

**Files:**
- Modify: `src/ui/mode-machine.ts:501-541`
- Test: `src/ui/__tests__/mode-machine.test.ts` (extend)

**Step 1: Write failing tests**

Add to `src/ui/__tests__/mode-machine.test.ts`:

```typescript
describe('transpose-edit (XPOSE)', () => {
  test('encoder A scrolls xposeParam', () => {
    const ui = { ...createInitialUIState(), mode: 'transpose-edit' as const, xposeParam: 0 }
    const engine = createInitialEngineState()
    const result = dispatch(ui, engine, { type: 'encoder-a-turn', delta: 1 })
    expect(result.ui.xposeParam).toBe(1)
  })

  test('encoder B adjusts semitones on SEMI param', () => {
    const ui = { ...createInitialUIState(), mode: 'transpose-edit' as const, xposeParam: 1 } // SEMI is row 1 (after header)
    const engine = createInitialEngineState()
    const result = dispatch(ui, engine, { type: 'encoder-b-turn', delta: 3 })
    expect(result.engine.transposeConfigs[0].semitones).toBe(3)
  })

  test('encoder B adjusts noteLow on NOTE LO param', () => {
    const ui = { ...createInitialUIState(), mode: 'transpose-edit' as const, xposeParam: 2 } // NOTE LO is row 2
    const engine = createInitialEngineState()
    const result = dispatch(ui, engine, { type: 'encoder-b-turn', delta: 5 })
    expect(result.engine.transposeConfigs[0].noteLow).toBe(5)
  })

  test('encoder B adjusts glScale on GL SCALE param', () => {
    const ui = { ...createInitialUIState(), mode: 'transpose-edit' as const, xposeParam: 5 } // GL SCALE is row 5
    const engine = createInitialEngineState()
    const result = dispatch(ui, engine, { type: 'encoder-b-turn', delta: 1 })
    expect(result.engine.transposeConfigs[0].glScale).toBe(1.05)
  })

  test('encoder A hold resets param to default', () => {
    const ui = { ...createInitialUIState(), mode: 'transpose-edit' as const, xposeParam: 1 } // SEMI
    const engine = createInitialEngineState()
    engine.transposeConfigs[0] = { semitones: 7, noteLow: 48, noteHigh: 72, glScale: 2.0, velScale: 0.5 }
    const result = dispatch(ui, engine, { type: 'encoder-a-hold' })
    expect(result.engine.transposeConfigs[0].semitones).toBe(0)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/__tests__/mode-machine.test.ts`
Expected: FAIL — existing dispatchTransposeEdit doesn't handle scrollable params

**Step 3: Replace dispatchTransposeEdit**

In `src/ui/mode-machine.ts`, replace the existing `dispatchTransposeEdit` function (lines 501-534) with:

```typescript
function dispatchTransposeEdit(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  const rows = getXposeVisibleRows(engine, ui)
  const maxIdx = rows.length - 1

  switch (event.type) {
    case 'encoder-a-turn': {
      const next = clamp(ui.xposeParam + event.delta, 0, maxIdx)
      return { ui: { ...ui, xposeParam: next }, engine }
    }
    case 'encoder-a-hold':
      return dispatchXposeReset(ui, engine)
    case 'encoder-b-turn':
      return dispatchXposeParamAdjust(ui, engine, event.delta)
    case 'encoder-b-push':
      return { ui, engine }
    default:
      return { ui, engine }
  }
}
```

Add new helper functions:

```typescript
function dispatchXposeParamAdjust(ui: UIState, engine: SequencerState, delta: number): DispatchResult {
  const trackIdx = ui.selectedTrack
  const tc = engine.transposeConfigs[trackIdx]
  const rows = getXposeVisibleRows(engine, ui)
  const row = rows[ui.xposeParam]
  if (!row) return { ui, engine }

  switch (row.paramId) {
    case 'xpose.semi':
      return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, semitones: clamp(tc.semitones + delta, -48, 48) }) }
    case 'xpose.noteLow':
      return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, noteLow: clamp(tc.noteLow + delta, 0, 127) }) }
    case 'xpose.noteHigh':
      return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, noteHigh: clamp(tc.noteHigh + delta, 0, 127) }) }
    case 'xpose.glScale': {
      const newVal = Math.round(clamp(tc.glScale + delta * 0.05, 0.25, 4.0) * 100) / 100
      return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, glScale: newVal }) }
    }
    case 'xpose.velScale': {
      const newVal = Math.round(clamp(tc.velScale + delta * 0.05, 0.25, 4.0) * 100) / 100
      return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, velScale: newVal }) }
    }
    default:
      return { ui, engine }
  }
}

function dispatchXposeReset(ui: UIState, engine: SequencerState): DispatchResult {
  const trackIdx = ui.selectedTrack
  const tc = engine.transposeConfigs[trackIdx]
  const rows = getXposeVisibleRows(engine, ui)
  const row = rows[ui.xposeParam]
  if (!row) return { ui, engine }

  const defaults = { semitones: 0, noteLow: 0, noteHigh: 127, glScale: 1.0, velScale: 1.0 }

  if (row.type === 'header') {
    // Reset entire section
    if (row.paramId === 'section.pitch') {
      return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, semitones: 0, noteLow: 0, noteHigh: 127 }) }
    }
    if (row.paramId === 'section.dynamics') {
      return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, glScale: 1.0, velScale: 1.0 }) }
    }
    return { ui, engine }
  }

  switch (row.paramId) {
    case 'xpose.semi': return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, semitones: defaults.semitones }) }
    case 'xpose.noteLow': return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, noteLow: defaults.noteLow }) }
    case 'xpose.noteHigh': return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, noteHigh: defaults.noteHigh }) }
    case 'xpose.glScale': return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, glScale: defaults.glScale }) }
    case 'xpose.velScale': return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, velScale: defaults.velScale }) }
    default: return { ui, engine }
  }
}
```

Add import for `getXposeVisibleRows`:
```typescript
import { getXposeVisibleRows } from './xpose-rows'
```

**Step 4: Update shortcut hints**

In `main.ts`, update the `transpose-edit` hint:
```typescript
'transpose-edit': '1-4: track   ↑↓: scroll   ←→: adjust   Hold ↑: reset   Esc: back',
```

**Step 5: Run tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All pass

---

### Task 6: T1-T4 button labels

**Files:**
- Modify: `src/ui/panel/faceplate.ts:199`

**Step 1: No test needed** — purely cosmetic DOM change.

**Step 2: Change button label text**

In `src/ui/panel/faceplate.ts`, line 199, change:
```typescript
label.textContent = `T${i + 1}`
```
to:
```typescript
label.textContent = `T/O ${i + 1}`
```

**Step 3: Run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All pass

---

### Task 7: Thin subtrack overlay on edit screens

**Files:**
- Modify: `src/ui/lcd/hold-overlay.ts`
- Modify: `src/main.ts:224-226`

**Step 1: No test needed** — purely visual rendering change.

**Step 2: Add `thinMode` parameter to renderHoldOverlay**

In `src/ui/lcd/hold-overlay.ts`, change the function signature:

```typescript
export function renderHoldOverlay(
  ctx: CanvasRenderingContext2D,
  engine: SequencerState,
  ui: UIState,
  thinMode: boolean = false,
): void {
```

Add thin overlay path at the top of the function body, after the `if (!held) return`:

```typescript
const HEADER_H = 42  // matches gate-edit header height

if (thinMode) {
  // Thin overlay — only covers header area, step grid stays visible
  fillRect(ctx, { x: 0, y: LCD_CONTENT_Y, w: LCD_W, h: HEADER_H }, 'rgba(8,8,20,0.92)')
  const trackIdx = held.kind === 'track' ? held.track : ui.selectedTrack
  const trackColor = COLORS.track[trackIdx]

  if (held.kind === 'subtrack') {
    const sub = held.subtrack
    if (sub === 'gate' || sub === 'pitch' || sub === 'velocity' || sub === 'mod') {
      const subtrack = engine.tracks[trackIdx][sub]
      drawText(ctx, `LEN ${subtrack.length}`, PAD, LCD_CONTENT_Y + 20, COLORS.textBright, 24)
      drawText(ctx, `÷${subtrack.clockDivider}`, PAD + 140, LCD_CONTENT_Y + 20, COLORS.textBright, 24)
      drawText(ctx, 'A:len  B:div', LCD_W - PAD, LCD_CONTENT_Y + 20, COLORS.textDim, 12, 'right')
    }
  } else if (held.kind === 'track') {
    const track = engine.tracks[trackIdx]
    drawText(ctx, `LEN G:${track.gate.length} P:${track.pitch.length} V:${track.velocity.length}`, PAD, LCD_CONTENT_Y + 20, COLORS.textBright, 18)
    drawText(ctx, `÷${track.clockDivider}`, LCD_W - PAD - 60, LCD_CONTENT_Y + 20, COLORS.textBright, 18)
    drawText(ctx, 'A:len B:div', LCD_W - PAD, LCD_CONTENT_Y + 20, COLORS.textDim, 12, 'right')
  } else if (held.kind === 'feature' && held.feature === 'mute') {
    const mute = engine.mutePatterns[trackIdx]
    drawText(ctx, `MUTE LEN ${mute.length}`, PAD, LCD_CONTENT_Y + 20, COLORS.textBright, 24)
    drawText(ctx, `÷${mute.clockDivider}`, PAD + 200, LCD_CONTENT_Y + 20, COLORS.textBright, 24)
  }
  return  // skip full overlay
}
```

**Step 3: Pass thinMode from main.ts**

In `src/main.ts`, change the overlay call (line 224-226):

```typescript
if (uiState.heldButton && uiState.heldButton.kind !== 'step') {
  const editScreens: ScreenMode[] = ['gate-edit', 'pitch-edit', 'vel-edit', 'mod-edit']
  const thin = editScreens.includes(uiState.mode)
  renderHoldOverlay(lcdCtx, engineState, uiState, thin)
}
```

Add `ScreenMode` to the import if not already imported.

**Step 4: Run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All pass

---

### Task 8: Fix existing test references to old TransposeConfig

**Files:**
- Modify: Any test files referencing `{ semitones: ..., quantize: ... }`

**Step 1: Search and fix**

Run: `grep -rn 'quantize' src/` to find remaining references to the old `quantize` field.

Update all TransposeConfig constructions from:
```typescript
{ semitones: 0, quantize: false }
```
to:
```typescript
{ semitones: 0, noteLow: 0, noteHigh: 127, glScale: 1.0, velScale: 1.0 }
```

This likely affects:
- `src/engine/__tests__/routing.test.ts` — if tests construct TransposeConfig
- `src/ui/__tests__/mode-machine.test.ts` — if tests construct engine state with transpose

**Step 2: Run full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All pass

---

### Task 9: Visual verification

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Verify XPOSE screen**

- Press TRNS button (or its keyboard shortcut)
- Confirm header shows `XPOSE — T1`
- Scroll with enc A through PITCH section (SEMI, NOTE LO, NOTE HI) and DYNAMICS section (GL SCALE, VEL SCALE)
- Adjust values with enc B
- Switch tracks with T1-T4
- Hold enc A to reset a param

**Step 3: Verify button labels**

- Confirm T1-T4 buttons show `T/O 1`, `T/O 2`, `T/O 3`, `T/O 4`

**Step 4: Verify thin overlay**

- Enter gate-edit (press GATE button)
- Hold the GATE subtrack button
- Confirm overlay only covers the header area (~42px)
- Step grid remains visible underneath
- Adjust length/divider with encoders while holding — grid should reflow in real time
- Go to home screen, hold a track button — confirm full overlay still appears

---

## Execution order

1. Task 1 — TransposeConfig type expansion (foundation)
2. Task 8 — Fix existing test references (prevent cascade failures)
3. Task 2 — Routing: note window + GL/VEL scaling
4. Task 3 — XPOSE row definitions
5. Task 4 — XPOSE renderer + xposeParam UIState
6. Task 5 — XPOSE mode-machine dispatch
7. Task 6 — T1-T4 button labels
8. Task 7 — Thin subtrack overlay
9. Task 9 — Visual verification
