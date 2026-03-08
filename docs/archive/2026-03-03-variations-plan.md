# Variations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a per-track variation overlay that applies deterministic transforms (reverse, transpose, thin, etc.) to the base sequence on specific bars of a repeating phrase.

**Architecture:** New `src/engine/variation.ts` module containing pure transform functions. Integrated into the `tick()` pipeline between step index computation and `resolveOutputs()`. Follows the same pattern as mutator.ts — pure functions, zero dependencies, immutable.

**Tech Stack:** TypeScript, Vitest

**Design doc:** `docs/plans/2026-03-03-variations-design.md`

---

### Task 1: Add Types

**Files:**
- Modify: `src/engine/types.ts`

**Step 1: Add Transform, VariationSlot, VariationPattern types to types.ts**

Add after the `MIDIOutputConfig` interface:

```typescript
// Variation transform types
export type TransformType =
  | 'reverse' | 'ping-pong' | 'rotate'
  | 'thin' | 'fill' | 'skip-even' | 'skip-odd'
  | 'transpose' | 'invert' | 'octave-shift'
  | 'double-time' | 'stutter'

export interface Transform {
  type: TransformType
  param: number
}

export interface VariationSlot {
  transforms: Transform[]
}

export interface VariationPattern {
  enabled: boolean
  length: number              // phrase length in bars: 2, 4, 8, or 16
  slots: VariationSlot[]      // one per bar position
  currentBar: number
  subtrackOverrides: {
    gate: VariationPattern | 'bypass' | null
    pitch: VariationPattern | 'bypass' | null
    velocity: VariationPattern | 'bypass' | null
    mod: VariationPattern | 'bypass' | null
  }
}
```

**Step 2: Add `variationPatterns` to SequencerState**

```typescript
export interface SequencerState {
  // ... existing fields ...
  variationPatterns: VariationPattern[]  // 4 patterns (one per track)
}
```

**Step 3: Run `npm run build` to verify types compile**

---

### Task 2: Playhead Transforms

**Files:**
- Create: `src/engine/variation.ts`
- Create: `src/engine/__tests__/variation.test.ts`

**Step 1: Write failing tests for all 5 playhead transforms**

```typescript
import { describe, it, expect } from 'vitest'
import { transformStepIndex } from '../variation'

describe('transformStepIndex', () => {
  describe('reverse', () => {
    it('reverses step index', () => {
      // 16-step: idx 0 → 15, idx 1 → 14, idx 15 → 0
      expect(transformStepIndex(0, 16, { type: 'reverse', param: 0 })).toBe(15)
      expect(transformStepIndex(1, 16, { type: 'reverse', param: 0 })).toBe(14)
      expect(transformStepIndex(15, 16, { type: 'reverse', param: 0 })).toBe(0)
    })

    it('works with odd-length subtracks', () => {
      expect(transformStepIndex(0, 7, { type: 'reverse', param: 0 })).toBe(6)
      expect(transformStepIndex(3, 7, { type: 'reverse', param: 0 })).toBe(3) // center
    })
  })

  describe('rotate', () => {
    it('shifts step index by param', () => {
      expect(transformStepIndex(0, 16, { type: 'rotate', param: 4 })).toBe(4)
      expect(transformStepIndex(14, 16, { type: 'rotate', param: 4 })).toBe(2) // wraps
    })

    it('works with odd-length subtracks', () => {
      expect(transformStepIndex(0, 7, { type: 'rotate', param: 4 })).toBe(4)
      expect(transformStepIndex(5, 7, { type: 'rotate', param: 4 })).toBe(2) // wraps
    })
  })

  describe('ping-pong', () => {
    it('plays forward for first half, backward for second half', () => {
      // 8-step: 0,1,2,3 forward then 3,2,1,0 backward
      expect(transformStepIndex(0, 8, { type: 'ping-pong', param: 0 })).toBe(0)
      expect(transformStepIndex(3, 8, { type: 'ping-pong', param: 0 })).toBe(3)
      expect(transformStepIndex(4, 8, { type: 'ping-pong', param: 0 })).toBe(3)
      expect(transformStepIndex(7, 8, { type: 'ping-pong', param: 0 })).toBe(0)
    })
  })

  describe('double-time', () => {
    it('doubles step index with wrap', () => {
      expect(transformStepIndex(0, 16, { type: 'double-time', param: 0 })).toBe(0)
      expect(transformStepIndex(4, 16, { type: 'double-time', param: 0 })).toBe(8)
      expect(transformStepIndex(8, 16, { type: 'double-time', param: 0 })).toBe(0) // wraps
    })
  })

  describe('stutter', () => {
    it('repeats first N steps', () => {
      expect(transformStepIndex(0, 16, { type: 'stutter', param: 4 })).toBe(0)
      expect(transformStepIndex(3, 16, { type: 'stutter', param: 4 })).toBe(3)
      expect(transformStepIndex(4, 16, { type: 'stutter', param: 4 })).toBe(0)
      expect(transformStepIndex(7, 16, { type: 'stutter', param: 4 })).toBe(3)
    })

    it('clamps to subtrack length', () => {
      // stutter(20) on 16-step = no-op
      expect(transformStepIndex(5, 16, { type: 'stutter', param: 20 })).toBe(5)
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/engine/__tests__/variation.test.ts`

**Step 3: Implement `transformStepIndex` in variation.ts**

```typescript
import type { Transform, TransformType } from './types'

const PLAYHEAD_TRANSFORMS: Set<TransformType> = new Set([
  'reverse', 'ping-pong', 'rotate', 'double-time', 'stutter',
])

export function isPlayheadTransform(t: Transform): boolean {
  return PLAYHEAD_TRANSFORMS.has(t.type)
}

export function transformStepIndex(idx: number, length: number, transform: Transform): number {
  switch (transform.type) {
    case 'reverse':
      return length - 1 - idx
    case 'ping-pong': {
      const half = Math.ceil(length / 2)
      return idx < half ? idx : length - 1 - idx
    }
    case 'rotate':
      return (idx + transform.param) % length
    case 'double-time':
      return (idx * 2) % length
    case 'stutter': {
      const n = Math.min(transform.param, length)
      return n > 0 ? idx % n : idx
    }
    default:
      return idx
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/engine/__tests__/variation.test.ts`

---

### Task 3: Gate Value Transforms

**Files:**
- Modify: `src/engine/variation.ts`
- Modify: `src/engine/__tests__/variation.test.ts`

**Step 1: Write failing tests for gate transforms**

```typescript
import { transformGateValue } from '../variation'
import type { GateStep, Transform } from '../types'

describe('transformGateValue', () => {
  const onStep: GateStep = { on: true, tie: false, length: 0.5, ratchet: 1 }
  const offStep: GateStep = { on: false, tie: false, length: 0.5, ratchet: 1 }

  describe('thin', () => {
    it('deterministically mutes some gates based on hash', () => {
      // thin(0.5) should mute ~50% of steps, deterministically
      const results = Array.from({ length: 16 }, (_, i) =>
        transformGateValue(onStep, { type: 'thin', param: 0.5 }, i, 0)
      )
      const onCount = results.filter(s => s.on).length
      expect(onCount).toBeGreaterThan(0)
      expect(onCount).toBeLessThan(16)
    })

    it('is deterministic — same inputs produce same output', () => {
      const a = transformGateValue(onStep, { type: 'thin', param: 0.5 }, 3, 0)
      const b = transformGateValue(onStep, { type: 'thin', param: 0.5 }, 3, 0)
      expect(a.on).toBe(b.on)
    })

    it('thin(0) mutes nothing', () => {
      const result = transformGateValue(onStep, { type: 'thin', param: 0 }, 0, 0)
      expect(result.on).toBe(true)
    })

    it('thin(1) mutes everything', () => {
      const result = transformGateValue(onStep, { type: 'thin', param: 1 }, 0, 0)
      expect(result.on).toBe(false)
    })
  })

  describe('fill', () => {
    it('forces gate on', () => {
      const result = transformGateValue(offStep, { type: 'fill', param: 0 }, 0, 0)
      expect(result.on).toBe(true)
    })
  })

  describe('skip-even', () => {
    it('mutes even-indexed steps', () => {
      expect(transformGateValue(onStep, { type: 'skip-even', param: 0 }, 0, 0).on).toBe(false)
      expect(transformGateValue(onStep, { type: 'skip-even', param: 0 }, 1, 0).on).toBe(true)
      expect(transformGateValue(onStep, { type: 'skip-even', param: 0 }, 2, 0).on).toBe(false)
    })
  })

  describe('skip-odd', () => {
    it('mutes odd-indexed steps', () => {
      expect(transformGateValue(onStep, { type: 'skip-odd', param: 0 }, 0, 0).on).toBe(true)
      expect(transformGateValue(onStep, { type: 'skip-odd', param: 0 }, 1, 0).on).toBe(false)
      expect(transformGateValue(onStep, { type: 'skip-odd', param: 0 }, 2, 0).on).toBe(true)
    })
  })
})
```

**Step 2: Run tests to verify they fail**

**Step 3: Implement `transformGateValue`**

```typescript
/**
 * Simple hash for deterministic thin.
 * Returns 0.0-1.0 based on (barPosition, stepIndex).
 */
function thinHash(stepIndex: number, barPosition: number): number {
  let h = (stepIndex * 2654435761 + barPosition * 340573321) | 0
  h = ((h >>> 16) ^ h) * 0x45d9f3b | 0
  h = ((h >>> 16) ^ h) * 0x45d9f3b | 0
  h = (h >>> 16) ^ h
  return (h >>> 0) / 4294967296
}

export function transformGateValue(
  step: GateStep,
  transform: Transform,
  stepIndex: number,
  barPosition: number,
): GateStep {
  switch (transform.type) {
    case 'thin':
      if (transform.param >= 1) return { ...step, on: false }
      if (transform.param <= 0) return step
      return thinHash(stepIndex, barPosition) < transform.param
        ? { ...step, on: false }
        : step
    case 'fill':
      return step.on ? step : { ...step, on: true }
    case 'skip-even':
      return stepIndex % 2 === 0 ? { ...step, on: false } : step
    case 'skip-odd':
      return stepIndex % 2 === 1 ? { ...step, on: false } : step
    default:
      return step
  }
}
```

**Step 4: Run tests to verify they pass**

---

### Task 4: Pitch Value Transforms

**Files:**
- Modify: `src/engine/variation.ts`
- Modify: `src/engine/__tests__/variation.test.ts`

**Step 1: Write failing tests for pitch transforms**

```typescript
import { transformPitchValue } from '../variation'
import type { PitchStep } from '../types'

describe('transformPitchValue', () => {
  const step: PitchStep = { note: 60, slide: 0.1 }

  describe('transpose', () => {
    it('shifts pitch by param semitones', () => {
      expect(transformPitchValue(step, { type: 'transpose', param: 7 }).note).toBe(67)
      expect(transformPitchValue(step, { type: 'transpose', param: -12 }).note).toBe(48)
    })

    it('clamps to 0-127', () => {
      expect(transformPitchValue({ note: 120, slide: 0 }, { type: 'transpose', param: 20 }).note).toBe(127)
      expect(transformPitchValue({ note: 5, slide: 0 }, { type: 'transpose', param: -10 }).note).toBe(0)
    })

    it('preserves slide', () => {
      expect(transformPitchValue(step, { type: 'transpose', param: 7 }).slide).toBe(0.1)
    })
  })

  describe('octave-shift', () => {
    it('shifts by N octaves (N * 12 semitones)', () => {
      expect(transformPitchValue(step, { type: 'octave-shift', param: 1 }).note).toBe(72)
      expect(transformPitchValue(step, { type: 'octave-shift', param: -1 }).note).toBe(48)
    })

    it('clamps to 0-127', () => {
      expect(transformPitchValue({ note: 120, slide: 0 }, { type: 'octave-shift', param: 2 }).note).toBe(127)
    })
  })

  describe('invert', () => {
    it('flips pitch around center note', () => {
      // center=60: note 64 → 56 (60 + (60-64) = 56)
      const result = transformPitchValue({ note: 64, slide: 0 }, { type: 'invert', param: 60 })
      expect(result.note).toBe(56)
    })

    it('center note stays unchanged', () => {
      const result = transformPitchValue({ note: 60, slide: 0 }, { type: 'invert', param: 60 })
      expect(result.note).toBe(60)
    })

    it('clamps to 0-127', () => {
      const result = transformPitchValue({ note: 10, slide: 0 }, { type: 'invert', param: 120 })
      expect(result.note).toBe(127)
    })
  })
})
```

**Step 2: Run tests to verify they fail**

**Step 3: Implement `transformPitchValue`**

```typescript
export function transformPitchValue(step: PitchStep, transform: Transform): PitchStep {
  switch (transform.type) {
    case 'transpose':
      return { ...step, note: Math.max(0, Math.min(127, step.note + transform.param)) }
    case 'octave-shift':
      return { ...step, note: Math.max(0, Math.min(127, step.note + transform.param * 12)) }
    case 'invert': {
      const center = transform.param
      const inverted = center + (center - step.note)
      return { ...step, note: Math.max(0, Math.min(127, inverted)) }
    }
    default:
      return step
  }
}
```

**Step 4: Run tests to verify they pass**

---

### Task 5: Transform Composition — getEffectiveStep

**Files:**
- Modify: `src/engine/variation.ts`
- Modify: `src/engine/__tests__/variation.test.ts`

Composes playhead + value transforms to produce the effective step value for a given subtrack.

**Step 1: Write failing tests**

```typescript
import { getEffectiveGateStep, getEffectivePitchStep } from '../variation'
import type { Subtrack, GateStep, PitchStep, Transform } from '../types'

describe('getEffectiveGateStep', () => {
  const gateSteps: GateStep[] = [
    { on: true, tie: false, length: 0.5, ratchet: 1 },
    { on: false, tie: false, length: 0.5, ratchet: 1 },
    { on: true, tie: false, length: 0.5, ratchet: 1 },
    { on: false, tie: false, length: 0.5, ratchet: 1 },
  ]
  const sub: Subtrack<GateStep> = { steps: gateSteps, length: 4, clockDivider: 1, currentStep: 0 }

  it('no transforms returns base step', () => {
    const result = getEffectiveGateStep(sub, [], 0)
    expect(result).toEqual(gateSteps[0])
  })

  it('reverse reads from end', () => {
    const result = getEffectiveGateStep(sub, [{ type: 'reverse', param: 0 }], 0)
    expect(result).toEqual(gateSteps[3]) // idx 0 → 3
  })

  it('reverse + fill composes: remaps index then forces gate on', () => {
    const transforms: Transform[] = [
      { type: 'reverse', param: 0 },
      { type: 'fill', param: 0 },
    ]
    const result = getEffectiveGateStep(sub, transforms, 0)
    expect(result.on).toBe(true) // step 3 was off, fill forces on
  })
})

describe('getEffectivePitchStep', () => {
  const pitchSteps: PitchStep[] = [
    { note: 60, slide: 0 },
    { note: 64, slide: 0 },
    { note: 67, slide: 0.1 },
    { note: 72, slide: 0 },
  ]
  const sub: Subtrack<PitchStep> = { steps: pitchSteps, length: 4, clockDivider: 1, currentStep: 0 }

  it('reverse + transpose composes', () => {
    const transforms: Transform[] = [
      { type: 'reverse', param: 0 },
      { type: 'transpose', param: 12 },
    ]
    const result = getEffectivePitchStep(sub, transforms)
    expect(result.note).toBe(84) // step 3 (72) + 12 = 84
  })
})
```

**Step 2: Run tests to verify they fail**

**Step 3: Implement composition functions**

```typescript
const GATE_VALUE_TRANSFORMS: Set<TransformType> = new Set([
  'thin', 'fill', 'skip-even', 'skip-odd',
])

const PITCH_VALUE_TRANSFORMS: Set<TransformType> = new Set([
  'transpose', 'invert', 'octave-shift',
])

export function getEffectiveGateStep(
  subtrack: Subtrack<GateStep>,
  transforms: Transform[],
  barPosition: number,
): GateStep {
  let idx = subtrack.currentStep
  for (const t of transforms) {
    if (isPlayheadTransform(t)) idx = transformStepIndex(idx, subtrack.length, t)
  }
  let step = subtrack.steps[idx]
  for (const t of transforms) {
    if (GATE_VALUE_TRANSFORMS.has(t.type)) {
      step = transformGateValue(step, t, idx, barPosition)
    }
  }
  return step
}

export function getEffectivePitchStep(
  subtrack: Subtrack<PitchStep>,
  transforms: Transform[],
): PitchStep {
  let idx = subtrack.currentStep
  for (const t of transforms) {
    if (isPlayheadTransform(t)) idx = transformStepIndex(idx, subtrack.length, t)
  }
  let step = subtrack.steps[idx]
  for (const t of transforms) {
    if (PITCH_VALUE_TRANSFORMS.has(t.type)) {
      step = transformPitchValue(step, t)
    }
  }
  return step
}

export function getEffectiveSimpleStep<T>(
  subtrack: Subtrack<T>,
  transforms: Transform[],
): T {
  let idx = subtrack.currentStep
  for (const t of transforms) {
    if (isPlayheadTransform(t)) idx = transformStepIndex(idx, subtrack.length, t)
  }
  return subtrack.steps[idx]
}
```

**Step 4: Run tests to verify they pass**

---

### Task 6: Per-Subtrack Resolution + Defaults

**Files:**
- Modify: `src/engine/variation.ts`
- Modify: `src/engine/__tests__/variation.test.ts`

**Step 1: Write failing tests for getTransformsForSubtrack and createDefaultVariationPattern**

```typescript
import { getTransformsForSubtrack, createDefaultVariationPattern } from '../variation'
import type { VariationPattern, Transform } from '../types'

describe('getTransformsForSubtrack', () => {
  const reverse: Transform = { type: 'reverse', param: 0 }
  const transpose: Transform = { type: 'transpose', param: 7 }

  function makePattern(transforms: Transform[][]): VariationPattern {
    return {
      ...createDefaultVariationPattern(),
      enabled: true,
      length: transforms.length,
      slots: transforms.map(t => ({ transforms: t })),
      currentBar: 0,
    }
  }

  it('inherit (null) uses track-level transforms', () => {
    const pattern = makePattern([[reverse], [], [transpose], []])
    const result = getTransformsForSubtrack(pattern, 'gate')
    expect(result).toEqual([reverse]) // currentBar=0
  })

  it('bypass returns empty array', () => {
    const pattern = makePattern([[reverse], [], [], []])
    pattern.subtrackOverrides.gate = 'bypass'
    const result = getTransformsForSubtrack(pattern, 'gate')
    expect(result).toEqual([])
  })

  it('override uses its own pattern and bar counter', () => {
    const pattern = makePattern([[reverse], [], [], []])
    const override: VariationPattern = {
      ...makePattern([[], [transpose]]),
      currentBar: 1,
    }
    pattern.subtrackOverrides.pitch = override
    const result = getTransformsForSubtrack(pattern, 'pitch')
    expect(result).toEqual([transpose])
  })
})

describe('createDefaultVariationPattern', () => {
  it('returns disabled 4-bar pattern with empty slots', () => {
    const p = createDefaultVariationPattern()
    expect(p.enabled).toBe(false)
    expect(p.length).toBe(4)
    expect(p.slots).toHaveLength(4)
    expect(p.slots.every(s => s.transforms.length === 0)).toBe(true)
    expect(p.currentBar).toBe(0)
    expect(p.subtrackOverrides).toEqual({ gate: null, pitch: null, velocity: null, mod: null })
  })
})
```

**Step 2: Run tests to verify they fail**

**Step 3: Implement**

```typescript
export function createDefaultVariationPattern(): VariationPattern {
  return {
    enabled: false,
    length: 4,
    slots: Array.from({ length: 4 }, () => ({ transforms: [] })),
    currentBar: 0,
    subtrackOverrides: { gate: null, pitch: null, velocity: null, mod: null },
  }
}

export function getTransformsForSubtrack(
  pattern: VariationPattern,
  subtrackKey: 'gate' | 'pitch' | 'velocity' | 'mod',
): Transform[] {
  const override = pattern.subtrackOverrides[subtrackKey]
  if (override === 'bypass') return []
  if (override !== null && override !== 'bypass') {
    return override.slots[override.currentBar]?.transforms ?? []
  }
  return pattern.slots[pattern.currentBar]?.transforms ?? []
}
```

**Step 4: Run tests to verify they pass**

---

### Task 7: Bar Counter Advancement

**Files:**
- Modify: `src/engine/variation.ts`
- Modify: `src/engine/__tests__/variation.test.ts`

**Step 1: Write failing tests for advanceVariationBar**

```typescript
import { advanceVariationBar } from '../variation'

describe('advanceVariationBar', () => {
  it('advances currentBar and wraps at length', () => {
    const p = { ...createDefaultVariationPattern(), enabled: true, length: 4, currentBar: 0 }
    expect(advanceVariationBar(p).currentBar).toBe(1)
  })

  it('wraps from last bar to 0', () => {
    const p = { ...createDefaultVariationPattern(), enabled: true, length: 4, currentBar: 3 }
    expect(advanceVariationBar(p).currentBar).toBe(0)
  })

  it('disabled pattern does not advance', () => {
    const p = { ...createDefaultVariationPattern(), enabled: false, currentBar: 2 }
    expect(advanceVariationBar(p).currentBar).toBe(2)
  })

  it('advances subtrack override bar counters independently', () => {
    const p = { ...createDefaultVariationPattern(), enabled: true, length: 4, currentBar: 0 }
    const override = { ...createDefaultVariationPattern(), enabled: true, length: 2, currentBar: 1 }
    p.subtrackOverrides.pitch = override
    const advanced = advanceVariationBar(p, 'pitch')
    // Track bar does not advance (different subtrack triggered)
    expect(advanced.currentBar).toBe(0)
    // Pitch override wraps from 1 → 0
    const pitchOverride = advanced.subtrackOverrides.pitch as VariationPattern
    expect(pitchOverride.currentBar).toBe(0)
  })
})
```

**Step 2: Run tests to verify they fail**

**Step 3: Implement advanceVariationBar**

```typescript
/**
 * Advance the variation bar counter when a loop boundary is detected.
 * If subtrackKey is provided, only advances that subtrack's override (if present).
 * If subtrackKey is omitted, advances the track-level bar counter.
 */
export function advanceVariationBar(
  pattern: VariationPattern,
  subtrackKey?: 'gate' | 'pitch' | 'velocity' | 'mod',
): VariationPattern {
  if (!pattern.enabled) return pattern

  if (subtrackKey) {
    const override = pattern.subtrackOverrides[subtrackKey]
    if (override === null || override === 'bypass') return pattern
    return {
      ...pattern,
      subtrackOverrides: {
        ...pattern.subtrackOverrides,
        [subtrackKey]: {
          ...override,
          currentBar: (override.currentBar + 1) % override.length,
        },
      },
    }
  }

  return {
    ...pattern,
    currentBar: (pattern.currentBar + 1) % pattern.length,
  }
}
```

**Step 4: Run tests to verify they pass**

---

### Task 8: Integration into sequencer.ts

**Files:**
- Modify: `src/engine/sequencer.ts`
- Modify: `src/engine/routing.ts`
- Modify: `src/engine/__tests__/variation.test.ts`

This is the largest task — wiring variations into `tick()` and `resolveOutputs()`.

**Step 1: Add variationPatterns to createSequencer**

In `sequencer.ts`, import `createDefaultVariationPattern` and add to `createSequencer()`:

```typescript
import { createDefaultVariationPattern } from './variation'

// In createSequencer():
variationPatterns: Array.from({ length: NUM_TRACKS }, () => createDefaultVariationPattern()),
```

**Step 2: Write a failing integration test**

```typescript
describe('variation integration in tick', () => {
  it('reverse transform plays steps backwards on configured bar', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    // Enable variation: bar 0 = normal, bar 1 = reverse
    state = {
      ...state,
      variationPatterns: state.variationPatterns.map((vp, i) => {
        if (i !== 0) return vp
        return {
          ...vp,
          enabled: true,
          length: 2,
          slots: [
            { transforms: [] },
            { transforms: [{ type: 'reverse' as const, param: 0 }] },
          ],
          currentBar: 0,
        }
      }),
      transport: { ...state.transport, playing: true },
    }

    // Collect events for first 16 ticks (bar 0 — normal)
    const bar0Events: number[] = []
    for (let i = 0; i < 16; i++) {
      const result = tick(state)
      bar0Events.push(result.events[0].pitch)
      state = result.state
    }

    // Collect events for next 16 ticks (bar 1 — reversed)
    const bar1Events: number[] = []
    for (let i = 0; i < 16; i++) {
      const result = tick(state)
      bar1Events.push(result.events[0].pitch)
      state = result.state
    }

    // Bar 1 should be bar 0 reversed
    expect(bar1Events).toEqual([...bar0Events].reverse())
  })

  it('disabled variation has no effect', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    state = { ...state, transport: { ...state.transport, playing: true } }

    // Collect baseline
    const baseline: number[] = []
    for (let i = 0; i < 16; i++) {
      const result = tick(state)
      baseline.push(result.events[0].pitch)
      state = result.state
    }

    // Reset and replay — should be identical (variation disabled)
    state = { ...state, transport: { ...state.transport, masterTick: 0 } }
    // Reset track playheads
    state = {
      ...state,
      tracks: state.tracks.map(t => ({
        ...t,
        gate: { ...t.gate, currentStep: 0 },
        pitch: { ...t.pitch, currentStep: 0 },
        velocity: { ...t.velocity, currentStep: 0 },
        mod: { ...t.mod, currentStep: 0 },
      })),
    }
    const replay: number[] = []
    for (let i = 0; i < 16; i++) {
      const result = tick(state)
      replay.push(result.events[0].pitch)
      state = result.state
    }

    expect(replay).toEqual(baseline)
  })

  it('variation bar counter advances on gate loop boundary', () => {
    let state = createSequencer()
    state = {
      ...state,
      variationPatterns: state.variationPatterns.map((vp, i) => {
        if (i !== 0) return vp
        return { ...vp, enabled: true, length: 4, currentBar: 0,
          slots: Array.from({ length: 4 }, () => ({ transforms: [] })) }
      }),
      transport: { ...state.transport, playing: true },
    }

    // After 16 ticks (one full loop of default 16-step gate), bar should advance to 1
    for (let i = 0; i < 16; i++) {
      const result = tick(state)
      state = result.state
    }
    expect(state.variationPatterns[0].currentBar).toBe(1)
  })

  it('createSequencer includes default variation patterns', () => {
    const state = createSequencer()
    expect(state.variationPatterns).toHaveLength(4)
    for (const vp of state.variationPatterns) {
      expect(vp.enabled).toBe(false)
      expect(vp.length).toBe(4)
    }
  })
})
```

**Step 3: Modify resolveOutputs to accept and apply variation transforms**

In `routing.ts`, update `resolveOutputs` signature to accept variation patterns and use the `getEffective*Step` functions to read step values when variations are active.

The key change: instead of `track.gate.steps[track.gate.currentStep]`, call through the variation layer when a variation pattern is enabled.

Import from variation.ts:
```typescript
import { getTransformsForSubtrack, getEffectiveGateStep, getEffectivePitchStep, getEffectiveSimpleStep } from './variation'
import type { VariationPattern } from './types'
```

Add `variationPatterns?: VariationPattern[]` parameter to `resolveOutputs`.

Replace direct step reads:
```typescript
// Before:
const gateStep = gateTrack?.gate.steps[gateTrack.gate.currentStep]

// After:
const gateVP = variationPatterns?.[r.gate]
const gateTransforms = gateVP?.enabled ? getTransformsForSubtrack(gateVP, 'gate') : []
const gateStep = gateTrack
  ? (gateTransforms.length > 0
    ? getEffectiveGateStep(gateTrack.gate, gateTransforms, gateVP!.currentBar)
    : gateTrack.gate.steps[gateTrack.gate.currentStep])
  : undefined
```

Apply similar pattern for pitch, velocity, mod reads.

**Step 4: Update tick() to pass variation patterns and advance bar counters**

In `sequencer.ts`, pass `state.variationPatterns` to `resolveOutputs()`.

Add bar counter advancement after mutation, detecting gate subtrack loop boundaries (same detection as mutator):

```typescript
// Advance variation bar counters at gate loop boundary
const advancedVariations = state.variationPatterns.map((vp, idx) => {
  if (!vp.enabled) return vp
  const track = state.tracks[idx]
  const trackDiv = track.clockDivider
  const curGate = getEffectiveStep(masterTick, trackDiv, track.gate.clockDivider, track.gate.length)
  const nxtGate = getEffectiveStep(nextTick, trackDiv, track.gate.clockDivider, track.gate.length)
  if (curGate > 0 && nxtGate === 0) {
    return advanceVariationBar(vp)
  }
  return vp
})
```

Include `variationPatterns: advancedVariations` in the returned state.

**Step 5: Run all tests**

Run: `npm test`

---

### Task 9: Final Verification

**Files:**
- All variation-related files

**Step 1: Run the full test suite**

Run: `npm test`

**Step 2: Run the build**

Run: `npm run build`

**Step 3: Manual verification in browser**

Run: `npm run dev`

Verify that the sequencer starts and plays normally with variations disabled (no regressions).
