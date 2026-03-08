# Variations Design

**Date:** 2026-03-03
**Status:** Approved

## Overview

A per-track overlay that applies deterministic transforms to the base sequence on specific bars of a repeating phrase. Adds compositional structure (e.g., "bar 4 plays reversed") without modifying stored step data. Everything loops — no randomness during playback.

### Design Principles

- **Deterministic and looping.** A variation phrase repeats identically every cycle. No per-step probability, no re-randomization during playback.
- **Overlay, not mutation.** Transforms are applied at read time. The stored sequence is never modified by variations. Disabling variations instantly returns to the base sequence.
- **Independent from drift.** Drift mutates stored steps. Variations transform at playback. Neither system knows about the other — they compose naturally.
- **Per-track with per-subtrack opt-in.** Default: one variation pattern applies to all subtracks. Individual subtracks can override with their own pattern or bypass variations entirely.

## Data Model

### Transform

```typescript
type TransformType =
  // Direction — change which step index is read
  | 'reverse'        // play steps backwards
  | 'ping-pong'      // forward then backward within one loop
  | 'rotate'         // shift pattern by N steps
  // Density — modify gate output
  | 'thin'           // deterministically mute a percentage of gates
  | 'fill'           // force all gates on
  | 'skip-even'      // mute even-numbered steps
  | 'skip-odd'       // mute odd-numbered steps
  // Pitch — modify pitch output
  | 'transpose'      // shift pitch by N semitones
  | 'invert'         // flip pitch around center note
  | 'octave-shift'   // shift by N octaves
  // Temporal — change playback speed/looping
  | 'double-time'    // play pattern at 2x speed (first half repeats)
  | 'stutter'        // repeat first N steps for the whole loop

interface Transform {
  type: TransformType
  param: number       // meaning depends on type (see catalog below)
}
```

### Variation Pattern

```typescript
interface VariationSlot {
  transforms: Transform[]  // empty array = play base unchanged
}

interface VariationPattern {
  enabled: boolean
  length: number           // phrase length in bars: 2, 4, 8, or 16
  slots: VariationSlot[]   // one per bar position
  currentBar: number       // playback position within phrase

  subtrackOverrides: {
    gate:     VariationPattern | 'bypass' | null
    pitch:    VariationPattern | 'bypass' | null
    velocity: VariationPattern | 'bypass' | null
    mod:      VariationPattern | 'bypass' | null
  }
}
```

On `SequencerState`:

```typescript
interface SequencerState {
  // ... existing fields ...
  variationPatterns: VariationPattern[]  // 4 patterns (one per track)
}
```

### Default State

```typescript
function createDefaultVariationPattern(): VariationPattern {
  return {
    enabled: false,
    length: 4,
    slots: Array.from({ length: 4 }, () => ({ transforms: [] })),
    currentBar: 0,
    subtrackOverrides: { gate: null, pitch: null, velocity: null, mod: null },
  }
}
```

## Transform Catalog

Transforms are split into two mechanical categories: **playhead transforms** (change which step index is read) and **value transforms** (modify the step data after reading).

### Playhead Transforms

Applied first. Each operates on the step index relative to the subtrack's own length.

| Transform | Param | Formula | Example (16-step) |
|---|---|---|---|
| `reverse` | — | `length - 1 - idx` | Step 0 reads from 15, 1 from 14, ... |
| `ping-pong` | — | Forward first half, backward second half | 0,1,...7,7,6,...0 |
| `rotate` | N (step count) | `(idx + N) % length` | rotate(4): step 0 reads from step 4 |
| `double-time` | — | `(idx * 2) % length` | Steps 0-7 play the full pattern, then repeat |
| `stutter` | N (step count) | `idx % N` | stutter(4): plays steps 0-3 four times |

### Value Transforms

Applied after playhead transforms. Each declares which subtrack type it affects.

| Transform | Param | Affects | Mechanic |
|---|---|---|---|
| `thin` | 0.0–1.0 | gate | Mute if `hash(barPosition, stepIndex) < param` |
| `fill` | — | gate | Force `gate.on = true` |
| `skip-even` | — | gate | Mute where `stepIndex % 2 === 0` |
| `skip-odd` | — | gate | Mute where `stepIndex % 2 === 1` |
| `transpose` | semitones (±) | pitch | `note + param`, clamped 0-127 |
| `invert` | — | pitch | `center + (center - note)`, center = midpoint of track pitch range |
| `octave-shift` | octaves (±) | pitch | `note + (param * 12)`, clamped 0-127 |

### Application Order

When a slot has multiple stacked transforms:

1. All playhead transforms compose left-to-right (first = innermost)
2. Step value is read at the resulting index
3. All value transforms apply sequentially

### Deterministic `thin`

Uses a hash of `(barPosition, stepIndex)` — not a PRNG. The same bar always mutes the same steps. Fully repeatable across loops.

## Polymetric Behavior

All playhead transforms take the subtrack's own length as input. When a track-level variation applies to subtracks with different lengths:

```
Track variation: rotate(4)
Gate  (16 steps): stepIndex = (idx + 4) % 16
Pitch  (7 steps): stepIndex = (idx + 4) % 7
```

Each subtrack resolves the transform against its own length independently. The polyrhythmic relationship between subtracks shifts — which is musically interesting and intentional.

## Per-Subtrack Opt-In

Three states per subtrack:

| State | Value | Behavior |
|---|---|---|
| **Inherit** | `null` | Uses track-level variation pattern |
| **Override** | `VariationPattern` | Independent pattern, length, and bar counter |
| **Bypass** | `'bypass'` | No variation, always plays base |

Resolution:

```typescript
function getTransformsForSubtrack(
  trackVariation: VariationPattern,
  subtrackKey: 'gate' | 'pitch' | 'velocity' | 'mod',
): Transform[] {
  const override = trackVariation.subtrackOverrides[subtrackKey]
  if (override === 'bypass') return []
  if (override !== null) {
    return override.slots[override.currentBar]?.transforms ?? []
  }
  return trackVariation.slots[trackVariation.currentBar]?.transforms ?? []
}
```

Override patterns track their own bar counter, advancing when that specific subtrack completes a loop. This creates additional polymetric layering — a 7-step pitch override with 4-bar variation has a different bar cycle than a 16-step gate.

## Engine Integration

### Pipeline

```
Current:  masterTick → compute step indices → resolveOutputs() → events
With var: masterTick → compute step indices → apply variations → resolveOutputs() → events
```

Variations intercept the step read between index computation and output resolution.

### Step Value Resolution

```typescript
function getEffectiveStepValue<T>(
  subtrack: Subtrack<T>,
  transforms: Transform[],
): T {
  let idx = subtrack.currentStep

  // 1. Remap step index via playhead transforms
  for (const t of playheadTransforms(transforms)) {
    idx = transformStepIndex(idx, subtrack.length, t)
  }

  // 2. Read base value at remapped index
  let value = subtrack.steps[idx]

  // 3. Apply value transforms
  for (const t of valueTransforms(transforms)) {
    value = applyValueTransform(value, t, subtrack)
  }

  return value
}
```

### Bar Counter Advancement

A "bar" = one complete cycle of the gate subtrack (gate.currentStep wraps from last step to 0). Detected the same way the mutator detects loop boundaries.

On gate subtrack loop boundary:
```
variationPattern.currentBar = (currentBar + 1) % variationPattern.length
```

For subtrack overrides: each override has its own bar counter, advancing when its own subtrack loops.

## Edge Cases

| Case | Behavior |
|---|---|
| All slots empty | No-op — equivalent to disabled |
| `stutter(N)` where N > length | Clamp to subtrack length (no-op) |
| `double-time` on odd-length subtrack | `(idx * 2) % 7` — non-uniform but deterministic |
| `reverse + reverse` stacked | Identity (cancels out) |
| Gate-only transform on pitch subtrack | Ignored — transform declares which subtracks it affects |
| Variation length > actual bars played | Only heard slots are used; resets on playback restart |

## UI/UX Design

### Physical Control

VAR button: 5th button in the feature column (below TRNS). Keyboard shortcut: `H`.

LED indicates whether variations are enabled for the selected track.

### VAR Edit Screen

```
┌──────────────────────────────────────────┐
│ VAR  T1  Phrase: 4 bars          [ON]    │
│ ─────────────────────────────────────────│
│ Bar 3 of 4                               │
│  1. REVERSE                              │
│  2. THIN(50%)                            │
│ ─────────────────────────────────────────│
│ > TRANSPOSE(+12)          [push to add]  │
└──────────────────────────────────────────┘
```

- Top line: mode name, track, phrase length, enabled state
- Middle: selected bar's transform stack (scrollable if >2)
- Bottom: transform catalog browser (current selection with param preview)

### Controls

| Input | Action |
|---|---|
| **Step 1-N press** | Select bar (N = phrase length) |
| **Step press (selected)** | Deselect bar (return to overview) |
| **Enc A turn** | Browse transform catalog |
| **Enc A push** (no bar selected) | Toggle variation enabled/disabled |
| **Enc A push** (bar selected) | Add browsed transform to bar's stack |
| **Enc A hold** (bar selected) | Remove last transform from bar's stack |
| **Enc B turn** | Adjust param of last-added transform |
| **Hold VAR + Enc A** | Set phrase length (2/4/8/16) |

### Step LED States

| State | LED |
|---|---|
| Bar has no transforms | dim |
| Bar has transforms | on |
| Selected bar | flash |
| Bar beyond phrase length | off |
| Current playback bar | pulse (during play) |

### Transform Catalog Browse Order

Grouped by category:

```
(none)
── Direction ──
REVERSE
PING-PONG
ROTATE
── Density ──
THIN
FILL
SKIP-EVEN
SKIP-ODD
── Pitch ──
TRANSPOSE
INVERT
OCTAVE-SHIFT
── Temporal ──
DOUBLE-TIME
STUTTER
```

### Enc B Parameter Ranges

| Transform | Enc B adjusts | Range | Default |
|---|---|---|---|
| REVERSE | — | — | — |
| PING-PONG | — | — | — |
| ROTATE | step offset | 1 to length-1 | 1 |
| THIN | percentage | 10%-90% (10% steps) | 50% |
| FILL | — | — | — |
| SKIP-EVEN | — | — | — |
| SKIP-ODD | — | — | — |
| TRANSPOSE | semitones | -24 to +24 | +7 |
| INVERT | center note | 0-127 | 60 |
| OCTAVE-SHIFT | octaves | -3 to +3 | +1 |
| DOUBLE-TIME | — | — | — |
| STUTTER | step count | 1 to 16 | 4 |

### Per-Subtrack Override UI

Accessed by holding a subtrack button (GATE/PITCH/VEL/MOD) while in VAR mode:

| Input | Action |
|---|---|
| **Hold subtrack btn** | Show override state for that subtrack |
| **Hold subtrack + Enc A push** | Cycle: inherit → bypass → override |
| **Release** (override active) | Edit that subtrack's independent variation pattern |

LCD when holding subtrack button:
```
┌──────────────────────────────────────────┐
│ VAR  T1  GATE override: INHERIT          │
│   [push Enc A to cycle]                  │
│   INHERIT → BYPASS → OVERRIDE            │
└──────────────────────────────────────────┘
```

When override is set to OVERRIDE, the subtrack gets its own independent phrase length, bar slots, and bar counter. An indicator on the LCD shows which subtrack is being edited.

## Scope Exclusions

- **No randomization of variation patterns.** Variations are manually configured. Randomizer extension is a future consideration.
- **No interaction with arp/LFO generators.** Those write to stored steps; variations read from them.
