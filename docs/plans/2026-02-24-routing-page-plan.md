# Routing Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the flat `RoutingConnection[]` with a structured `OutputRouting[]`, add MOD subtrack, and implement the route LCD screen.

**Architecture:** Engine types change first (OutputRouting, mod subtrack, NoteEvent.mod), then routing logic, then sequencer, then UI dispatch, then LCD renderer. Each task is self-contained with TDD.

**Tech Stack:** TypeScript, Vitest, Canvas 2D rendering

---

### Task 1: Update types — OutputRouting, mod subtrack, NoteEvent.mod

**Files:**
- Modify: `src/engine/types.ts`

**Step 1: Replace RoutingConnection with OutputRouting**

In `src/engine/types.ts`, replace lines 51-56:

```ts
// Routing: which sequence subtracks connect to which outputs
export interface RoutingConnection {
  sourceTrack: number        // sequence track index 0-3
  sourceParam: 'gate' | 'pitch' | 'velocity'
  outputTrack: number        // output index 0-3
}
```

With:

```ts
// Per-output routing: which source track feeds each param
export interface OutputRouting {
  gate: number      // source track index 0-3
  pitch: number
  velocity: number
  mod: number
}
```

**Step 2: Add mod to SequenceTrack**

Change `SequenceTrack` (lines 21-28) to add `mod` after `velocity`:

```ts
export interface SequenceTrack {
  id: string
  name: string
  clockDivider: number      // track-level division
  gate: Subtrack<boolean>
  pitch: Subtrack<Note>
  velocity: Subtrack<Velocity>
  mod: Subtrack<number>     // 0-127, general purpose modulation
}
```

**Step 3: Add mod to NoteEvent**

Change `NoteEvent` (lines 67-72) to add `mod`:

```ts
export interface NoteEvent {
  output: number             // output index 0-3
  gate: boolean
  pitch: Note
  velocity: Velocity
  mod: number                // 0-127
}
```

**Step 4: Update SequencerState routing type**

Change line 90 from:

```ts
  routing: RoutingConnection[]
```

To:

```ts
  routing: OutputRouting[]
```

**Step 5: Verify the type changes compile**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: Many errors (downstream code not updated yet). Confirm the errors are in routing.ts, sequencer.ts, and test files — NOT in types.ts itself.

---

### Task 2: Rewrite routing.ts for OutputRouting model

**Files:**
- Modify: `src/engine/routing.ts`
- Modify: `src/engine/__tests__/routing.test.ts`

**Step 1: Write updated routing tests**

Replace `src/engine/__tests__/routing.test.ts` entirely:

```ts
import { describe, it, expect } from 'vitest'
import { resolveOutputs, createDefaultRouting } from '../routing'
import type { SequenceTrack, MuteTrack } from '../types'

function makeTrack(overrides: Partial<SequenceTrack> & { id: string; name: string }): SequenceTrack {
  return {
    clockDivider: 1,
    gate: { steps: [true, false, true, false], length: 4, clockDivider: 1, currentStep: 0 },
    pitch: { steps: [60, 62, 64, 65], length: 4, clockDivider: 1, currentStep: 0 },
    velocity: { steps: [100, 80, 90, 70], length: 4, clockDivider: 1, currentStep: 0 },
    mod: { steps: [50, 60, 70, 80], length: 4, clockDivider: 1, currentStep: 0 },
    ...overrides,
  }
}

function makeMute(steps: boolean[] = [false, false, false, false]): MuteTrack {
  return { steps, length: steps.length, clockDivider: 1, currentStep: 0 }
}

describe('createDefaultRouting', () => {
  it('creates 1:1 routing for 4 outputs', () => {
    const routing = createDefaultRouting()
    expect(routing).toHaveLength(4)
    expect(routing[0]).toEqual({ gate: 0, pitch: 0, velocity: 0, mod: 0 })
    expect(routing[1]).toEqual({ gate: 1, pitch: 1, velocity: 1, mod: 1 })
    expect(routing[2]).toEqual({ gate: 2, pitch: 2, velocity: 2, mod: 2 })
    expect(routing[3]).toEqual({ gate: 3, pitch: 3, velocity: 3, mod: 3 })
  })
})

describe('resolveOutputs', () => {
  const tracks = [
    makeTrack({ id: '0', name: 'Track 1' }),
    makeTrack({ id: '1', name: 'Track 2' }),
    makeTrack({ id: '2', name: 'Track 3' }),
    makeTrack({ id: '3', name: 'Track 4' }),
  ]
  const mutes = [makeMute(), makeMute(), makeMute(), makeMute()]

  it('resolves default 1:1 routing correctly', () => {
    const routing = createDefaultRouting()
    const events = resolveOutputs(tracks, routing, mutes)
    expect(events).toHaveLength(4)
    expect(events[0]).toEqual({ output: 0, gate: true, pitch: 60, velocity: 100, mod: 50 })
    expect(events[1]).toEqual({ output: 1, gate: true, pitch: 60, velocity: 100, mod: 50 })
  })

  it('resolves cross-routing — output 2 gate from track 0', () => {
    const routing = createDefaultRouting()
    routing[2] = { ...routing[2], gate: 0 } // output 2 gate from track 0
    const customTracks = [
      ...tracks.slice(0, 2),
      makeTrack({
        id: '2', name: 'Track 3',
        gate: { steps: [false, false, false, false], length: 4, clockDivider: 1, currentStep: 0 },
      }),
      tracks[3],
    ]
    const events = resolveOutputs(customTracks, routing, mutes)
    expect(events[2].gate).toBe(true) // from track 0, not track 2
  })

  it('applies mute patterns — muted step produces gate off', () => {
    const routing = createDefaultRouting()
    const mutedMutes = [
      makeMute([true, false, false, false]), // track 0 muted at step 0
      makeMute(), makeMute(), makeMute(),
    ]
    const events = resolveOutputs(tracks, routing, mutedMutes)
    expect(events[0].gate).toBe(false) // muted
    expect(events[1].gate).toBe(true)  // not muted
  })

  it('reads mod from source track', () => {
    const routing = createDefaultRouting()
    routing[0] = { ...routing[0], mod: 2 } // output 0 mod from track 2
    const events = resolveOutputs(tracks, routing, mutes)
    expect(events[0].mod).toBe(50) // track 2 mod step 0 = 50
  })

  it('cross-routes pitch from different track', () => {
    const routing = createDefaultRouting()
    routing[0] = { ...routing[0], pitch: 1 } // output 0 pitch from track 1
    const events = resolveOutputs(tracks, routing, mutes)
    expect(events[0].pitch).toBe(60) // track 1 pitch step 0
    expect(events[0].gate).toBe(true) // still from track 0
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/__tests__/routing.test.ts`

Expected: FAIL (routing.ts still uses old types)

**Step 3: Rewrite routing.ts**

Replace `src/engine/routing.ts` entirely:

```ts
import type { SequenceTrack, OutputRouting, MuteTrack, NoteEvent } from './types'

const NUM_OUTPUTS = 4

/**
 * Creates default 1:1 routing: track N → output N for all params.
 */
export function createDefaultRouting(): OutputRouting[] {
  return Array.from({ length: NUM_OUTPUTS }, (_, i) => ({
    gate: i,
    pitch: i,
    velocity: i,
    mod: i,
  }))
}

/**
 * Resolve routing into output events.
 * Each output reads gate/pitch/velocity/mod from its configured source tracks.
 * Mute patterns suppress gate from the gate source track.
 */
export function resolveOutputs(
  tracks: SequenceTrack[],
  routing: OutputRouting[],
  mutes: MuteTrack[],
): NoteEvent[] {
  const events: NoteEvent[] = []

  for (let i = 0; i < NUM_OUTPUTS; i++) {
    const r = routing[i]
    if (!r) {
      events.push({ output: i, gate: false, pitch: 0, velocity: 0, mod: 0 })
      continue
    }

    const gateTrack = tracks[r.gate]
    const pitchTrack = tracks[r.pitch]
    const velTrack = tracks[r.velocity]
    const modTrack = tracks[r.mod]

    let gate = gateTrack?.gate.steps[gateTrack.gate.currentStep] ?? false
    const pitch = pitchTrack?.pitch.steps[pitchTrack.pitch.currentStep] ?? 0
    const velocity = velTrack?.velocity.steps[velTrack.velocity.currentStep] ?? 0
    const mod = modTrack?.mod.steps[modTrack.mod.currentStep] ?? 0

    // Apply mute from the gate source track
    const mute = mutes[r.gate]
    if (mute && mute.steps[mute.currentStep]) {
      gate = false
    }

    events.push({ output: i, gate, pitch, velocity, mod })
  }

  return events
}
```

**Step 4: Run routing tests**

Run: `npx vitest run src/engine/__tests__/routing.test.ts`

Expected: PASS

---

### Task 3: Update sequencer.ts — mod subtrack, tick, setOutputSource

**Files:**
- Modify: `src/engine/sequencer.ts`
- Modify: `src/engine/__tests__/sequencer.test.ts`

**Step 1: Write failing tests for mod subtrack and setOutputSource**

Add these tests to the end of `src/engine/__tests__/sequencer.test.ts`:

```ts
describe('mod subtrack', () => {
  it('createSequencer includes mod subtrack on all tracks', () => {
    const state = createSequencer()
    for (const track of state.tracks) {
      expect(track.mod).toBeDefined()
      expect(track.mod.steps).toHaveLength(16)
      expect(track.mod.steps[0]).toBe(0)
      expect(track.mod.clockDivider).toBe(1)
    }
  })

  it('tick advances mod subtrack currentStep', () => {
    let state = createSequencer()
    state = { ...state, transport: { ...state.transport, playing: true } }
    const result = tick(state)
    // After one tick, mod step should have advanced
    expect(result.state.tracks[0].mod.currentStep).toBe(1)
  })
})

describe('setOutputSource', () => {
  it('changes a single param source on one output', () => {
    const state = createSequencer()
    const result = setOutputSource(state, 0, 'pitch', 2)
    expect(result.routing[0].pitch).toBe(2)
    // Other params unchanged
    expect(result.routing[0].gate).toBe(0)
    expect(result.routing[0].velocity).toBe(0)
    expect(result.routing[0].mod).toBe(0)
    // Other outputs unchanged
    expect(result.routing[1]).toEqual(state.routing[1])
  })

  it('clamps source track to 0-3', () => {
    const state = createSequencer()
    const result = setOutputSource(state, 0, 'gate', 5)
    expect(result.routing[0].gate).toBe(3)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/__tests__/sequencer.test.ts`

Expected: FAIL

**Step 3: Update sequencer.ts**

Changes needed:

1. Add `mod: 0` to `SUBTRACK_DEFAULTS` (line 15-19)
2. Add `mod` subtrack in `createTrack()` (line 34-47)
3. Add `mod` to `tick()` current/next track computation (lines 107-134)
4. Add `setOutputSource()` export function
5. Update imports: replace `RoutingConnection` with `OutputRouting` (if imported)
6. Add `mod` to `resetTrackPlayheads()` and update subtrack union types to include `'mod'`

Key code for `setOutputSource`:

```ts
export function setOutputSource(
  state: SequencerState,
  outputIndex: number,
  param: 'gate' | 'pitch' | 'velocity' | 'mod',
  sourceTrack: number,
): SequencerState {
  const clamped = clamp(sourceTrack, 0, NUM_TRACKS - 1)
  return {
    ...state,
    routing: state.routing.map((r, i) => {
      if (i !== outputIndex) return r
      return { ...r, [param]: clamped }
    }),
  }
}
```

Update all subtrack union types from `'gate' | 'pitch' | 'velocity'` to `'gate' | 'pitch' | 'velocity' | 'mod'` in: `setStep`, `setSubtrackLength`, `setSubtrackClockDivider`, `resetSubtrackPlayhead`.

**Step 4: Run all tests**

Run: `npm test`

Expected: ALL PASS (routing tests + sequencer tests + mode-machine tests)

**Step 5: Commit**

```bash
git add src/engine/types.ts src/engine/routing.ts src/engine/sequencer.ts src/engine/__tests__/routing.test.ts src/engine/__tests__/sequencer.test.ts
git commit -m "Replace RoutingConnection with OutputRouting, add mod subtrack"
```

---

### Task 4: Add routeParam to UIState and route dispatch

**Files:**
- Modify: `src/ui/hw-types.ts`
- Modify: `src/ui/mode-machine.ts`
- Modify: `src/ui/__tests__/mode-machine.test.ts`

**Step 1: Add routeParam to UIState**

In `src/ui/hw-types.ts`, add after `nameCursor`:

```ts
  routeParam: number          // 0-3: selected param row in ROUTE screen (gate/pitch/vel/mod)
```

**Step 2: Initialize routeParam in createInitialUIState()**

In `src/ui/mode-machine.ts`, add `routeParam: 0` to the returned object in `createInitialUIState()`.

**Step 3: Write failing route dispatch tests**

Add to `src/ui/__tests__/mode-machine.test.ts`:

```ts
describe('route screen dispatch', () => {
  function routeUI(param = 0, track = 0) {
    return {
      ...createInitialUIState(),
      mode: 'route' as const,
      selectedTrack: track,
      routeParam: param,
    }
  }

  describe('navigation', () => {
    it('enc A scrolls param down', () => {
      const ui = routeUI(0)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 1 })
      expect(result.ui.routeParam).toBe(1)
    })

    it('enc A scrolls param up', () => {
      const ui = routeUI(1)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -1 })
      expect(result.ui.routeParam).toBe(0)
    })

    it('enc A clamps at top', () => {
      const ui = routeUI(0)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -1 })
      expect(result.ui.routeParam).toBe(0)
    })

    it('enc A clamps at bottom', () => {
      const ui = routeUI(3)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 1 })
      expect(result.ui.routeParam).toBe(3)
    })

    it('enc B push returns to home', () => {
      const ui = routeUI(2)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-push' })
      expect(result.ui.mode).toBe('home')
    })

    it('track buttons switch output (cross-modal)', () => {
      const ui = routeUI(1, 0)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'track-select', track: 2 })
      expect(result.ui.selectedTrack).toBe(2)
      expect(result.ui.mode).toBe('route') // stays in route mode
    })
  })

  describe('source editing', () => {
    it('enc B cycles gate source forward', () => {
      const ui = routeUI(0, 0) // param 0 = gate, output 0
      const eng = makeState()
      // Default: output 0 gate = track 0
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.routing[0].gate).toBe(1)
    })

    it('enc B cycles pitch source backward', () => {
      const ui = routeUI(1, 0) // param 1 = pitch, output 0
      let eng = makeState()
      // Set pitch source to track 2 first
      eng = { ...eng, routing: eng.routing.map((r, i) => i === 0 ? { ...r, pitch: 2 } : r) }
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -1 })
      expect(result.engine.routing[0].pitch).toBe(1)
    })

    it('enc B wraps source track forward', () => {
      const ui = routeUI(0, 0)
      let eng = makeState()
      eng = { ...eng, routing: eng.routing.map((r, i) => i === 0 ? { ...r, gate: 3 } : r) }
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.routing[0].gate).toBe(0) // wraps to 0
    })

    it('enc B wraps source track backward', () => {
      const ui = routeUI(0, 0)
      const eng = makeState()
      // Default gate source is 0, going backward should wrap to 3
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -1 })
      expect(result.engine.routing[0].gate).toBe(3)
    })

    it('enc B changes mod source', () => {
      const ui = routeUI(3, 1) // param 3 = mod, output 1
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.routing[1].mod).toBe(2)
    })

    it('only changes selected output routing', () => {
      const ui = routeUI(0, 1) // output 1
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.routing[0].gate).toBe(0) // output 0 unchanged
      expect(result.engine.routing[1].gate).toBe(2) // output 1 changed
    })
  })
})
```

**Step 4: Run tests to verify they fail**

Run: `npx vitest run src/ui/__tests__/mode-machine.test.ts`

Expected: FAIL

**Step 5: Implement dispatchRoute in mode-machine.ts**

Add import for `setOutputSource` from `../engine/sequencer`.

Replace the `'route':` case in the main dispatch switch (currently falls through to `dispatchStub`) with:

```ts
    case 'route':
      return dispatchRoute(ui, engine, event)
```

Add the dispatch function:

```ts
const ROUTE_PARAMS: Array<'gate' | 'pitch' | 'velocity' | 'mod'> = ['gate', 'pitch', 'velocity', 'mod']

function dispatchRoute(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  switch (event.type) {
    case 'encoder-a-turn': {
      const newParam = clamp(ui.routeParam + event.delta, 0, 3)
      return { ui: { ...ui, routeParam: newParam }, engine }
    }
    case 'encoder-b-turn': {
      const param = ROUTE_PARAMS[ui.routeParam]
      const outputIdx = ui.selectedTrack
      const current = engine.routing[outputIdx][param]
      const next = ((current + event.delta) % 4 + 4) % 4 // wrap 0-3
      return {
        ui,
        engine: setOutputSource(engine, outputIdx, param, next),
      }
    }
    case 'encoder-b-push':
      return { ui: { ...ui, mode: 'home' }, engine }
    default:
      return { ui, engine }
  }
}
```

**Step 6: Run all tests**

Run: `npm test`

Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/ui/hw-types.ts src/ui/mode-machine.ts src/ui/__tests__/mode-machine.test.ts
git commit -m "Add route screen dispatch with per-param source editing"
```

---

### Task 5: Route LCD renderer and wiring

**Files:**
- Create: `src/ui/lcd/route-screen.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/lcd/stub-screen.ts`

**Step 1: Create route-screen.ts**

```ts
/**
 * LCD Route screen — per-output param source mapping.
 * T1-T4 selects output. Enc A scrolls params. Enc B cycles source track.
 * 4 rows: GATE, PTCH, VEL, MOD — no scrolling needed.
 * All text ≥16px for readability.
 */

import type { SequencerState } from '../../engine/types'
import type { UIState } from '../hw-types'
import { COLORS } from '../colors'
import { fillRect, drawText, LCD_W, LCD_CONTENT_Y, LCD_CONTENT_H } from '../renderer'

const PAD = 8
const HEADER_H = 30
const ROW_H = Math.floor((LCD_CONTENT_H - HEADER_H - 8) / 4)
const LIST_TOP = LCD_CONTENT_Y + HEADER_H + 4
const LABEL_X = PAD + 18
const ARROW_X = LCD_W / 2 + 20
const SOURCE_X = ARROW_X + 30

const PARAM_LABELS = ['GATE', 'PTCH', 'VEL', 'MOD']
const PARAM_KEYS: Array<'gate' | 'pitch' | 'velocity' | 'mod'> = ['gate', 'pitch', 'velocity', 'mod']

export function renderRoute(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const outputIdx = ui.selectedTrack
  const outputRouting = engine.routing[outputIdx]

  // Header
  drawText(ctx, `ROUTE — OUT ${outputIdx + 1}`, PAD, LCD_CONTENT_Y + 18, COLORS.track[outputIdx], 18)
  drawText(ctx, 'ENC A:▲▼  ENC B:source', LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textDim, 12, 'right')

  // 4 param rows
  for (let i = 0; i < 4; i++) {
    const y = LIST_TOP + i * ROW_H
    const isSelected = i === ui.routeParam
    const sourceTrack = outputRouting[PARAM_KEYS[i]]
    const sourceColor = COLORS.track[sourceTrack]

    // Highlight row background
    if (isSelected) {
      fillRect(ctx, { x: PAD, y, w: LCD_W - PAD * 2, h: ROW_H - 4 }, `${COLORS.track[outputIdx]}22`)
    }

    // Cursor indicator
    const cursorColor = isSelected ? COLORS.track[outputIdx] : 'transparent'
    drawText(ctx, '\u25B8', PAD, y + ROW_H / 2 - 4, cursorColor, 16)

    // Param label
    const labelColor = isSelected ? COLORS.text : COLORS.textDim
    drawText(ctx, PARAM_LABELS[i], LABEL_X, y + ROW_H / 2 - 4, labelColor, 18)

    // Arrow
    drawText(ctx, '\u2190', ARROW_X, y + ROW_H / 2 - 4, COLORS.textDim, 16)

    // Source track label (colored)
    drawText(ctx, `T${sourceTrack + 1}`, SOURCE_X, y + ROW_H / 2 - 4, sourceColor, 18)
  }
}
```

**Step 2: Wire into main.ts**

Add import:

```ts
import { renderRoute } from './ui/lcd/route-screen'
```

Update RENDERERS — replace `'route': renderStub` with `'route': renderRoute`.

Update MODE_STATUS — replace `'route': () => 'ROUTING'` with `'route': (ui) => \`ROUTE — OUT \${ui.selectedTrack + 1}\``.

Update SHORTCUT_HINTS — replace `'route': 'Esc: back'` with `'route': '1-4: output  ↑↓: param  ←→: source track  Esc: back'`.

**Step 3: Run build + tests**

Run: `npm run build && npm test`

Expected: Build clean, all tests pass.

**Step 4: Commit**

```bash
git add src/ui/lcd/route-screen.ts src/main.ts
git commit -m "Add route LCD screen with per-param source display"
```

---

### Task 6: Fix downstream breakage — hold combos, home screen, existing subtrack refs

**Files:**
- Modify: `src/ui/mode-machine.ts` (hold combo handlers for mod subtrack)
- Modify: `src/ui/lcd/home.ts` (add mod row to home overview if needed)
- Modify: `src/ui/lcd/hold-overlay.ts` (add mod to overlay display if referenced)

**Step 1: Audit all places that enumerate subtracks**

Search for `'gate' | 'pitch' | 'velocity'` patterns and hold combo dispatch code. Update any subtrack unions to include `'mod'`. The hold combos for `mod` subtrack should work like the others (hold MOD + enc A = length, hold MOD + enc B = divider).

**Step 2: Run full test suite + build**

Run: `npm run build && npm test`

Expected: ALL PASS, build clean.

**Step 3: Visual check in browser**

Run: `npm run dev`

1. Press S for route screen — verify 4 rows with track sources
2. Press 1-4 to switch outputs — header updates
3. Use ↑↓ to scroll params, ←→ to change sources
4. Press Esc to return home
5. Verify home screen still renders correctly with 4 tracks

**Step 4: Commit**

```bash
git add -u
git commit -m "Fix downstream subtrack references for mod addition"
```

---

### Task 7: Final verification and cleanup

**Step 1: Run full test suite**

Run: `npm test`

Expected: ALL PASS

**Step 2: Run build**

Run: `npm run build`

Expected: Clean build, no errors

**Step 3: Visual regression check**

Verify in browser:
- Home screen: 4 tracks render correctly
- Gate/Pitch/Vel edit: still work
- RAND screen: still works
- Route screen: full functionality
- Hold combos: mod subtrack hold works
- Name entry: still works
