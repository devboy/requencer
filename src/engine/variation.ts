/**
 * Variation engine — applies transform chains to subtracks per bar.
 *
 * Two categories of transforms:
 * - Playhead transforms: change WHICH step index is read
 * - Value transforms: modify the step value AFTER reading
 *
 * All functions are pure: receive state, return new values, never mutate.
 */

import { clamp } from './math'
import { SCALES, snapToScale } from './scales'
import type { GateStep, PitchStep, Subtrack, Transform, TransformType, VariationPattern, VariationSlot } from './types'

// --- Transform categorization ---

const PLAYHEAD_TRANSFORMS: Set<TransformType> = new Set([
  'reverse', 'ping-pong', 'rotate', 'double-time', 'stutter',
  'half-time', 'skip', 'drunk-walk', 'scramble',
])

const GATE_VALUE_TRANSFORMS: Set<TransformType> = new Set([
  'thin', 'fill', 'skip-even', 'skip-odd',
  'invert-gates', 'densify', 'drop', 'ratchet',
])

const PITCH_VALUE_TRANSFORMS: Set<TransformType> = new Set([
  'transpose', 'invert', 'octave-shift',
  'fold', 'quantize',
])

const VELOCITY_VALUE_TRANSFORMS: Set<TransformType> = new Set([
  'accent', 'fade-in', 'fade-out', 'humanize',
])

/**
 * Returns true if the transform modifies the playhead index.
 */
export function isPlayheadTransform(t: Transform): boolean {
  return PLAYHEAD_TRANSFORMS.has(t.type)
}

// --- TASK 2: Playhead transforms ---

/**
 * Apply a single playhead transform to a step index.
 */
export function transformStepIndex(idx: number, length: number, transform: Transform): number {
  switch (transform.type) {
    case 'reverse':
      return length - 1 - idx

    case 'ping-pong': {
      // Forward first half, backward second half
      // For 8-step: 0→0, 1→1, 2→2, 3→3, 4→3, 5→2, 6→1, 7→0
      const half = Math.floor(length / 2)
      if (idx < half) return idx
      return length - 1 - idx
    }

    case 'rotate':
      return (idx + transform.param) % length

    case 'double-time':
      return (idx * 2) % length

    case 'stutter': {
      const n = Math.min(transform.param, length)
      return idx % n
    }

    case 'half-time':
      return Math.floor(idx / 2)

    case 'skip':
      return (idx * transform.param) % length

    case 'drunk-walk': {
      // Deterministic "drunk" walk: simulate forward motion with hash-based deviations.
      // chaos param (0.0-1.0) controls probability of deviation per step.
      const chaos = transform.param
      let pos = 0
      for (let i = 0; i < idx; i++) {
        const h = deterministicHash(i, 0)
        if (h < chaos) {
          // Deviate: step backward or stay
          const dir = deterministicHash(i, 1) > 0.5 ? -1 : 0
          pos = ((pos + dir) % length + length) % length
        } else {
          pos = (pos + 1) % length
        }
      }
      return pos
    }

    case 'scramble': {
      // Interleave permutation: even positions first, then odd.
      // [A,B,C,D,E,F,G,H] → reads [A,C,E,G,B,D,F,H]
      const half = Math.ceil(length / 2)
      return idx < half ? idx * 2 : (idx - half) * 2 + 1
    }

    default:
      return idx
  }
}

// --- TASK 3: Gate value transforms ---

/**
 * Deterministic hash for thin transform.
 * Returns a value in [0, 1).
 */
function deterministicHash(stepIndex: number, barPosition: number): number {
  let h = (stepIndex * 2654435761 + barPosition * 340573321) | 0
  h = (((h >>> 16) ^ h) * 0x45d9f3b) | 0
  h = (((h >>> 16) ^ h) * 0x45d9f3b) | 0
  h = (h >>> 16) ^ h
  return (h >>> 0) / 4294967296
}

/**
 * Apply a gate value transform to a GateStep.
 * Returns a new GateStep (immutable). Only modifies .on.
 */
export function transformGateValue(
  step: GateStep,
  transform: Transform,
  stepIndex: number,
  barPosition: number,
): GateStep {
  switch (transform.type) {
    case 'thin': {
      const hash = deterministicHash(stepIndex, barPosition)
      return hash < transform.param ? { ...step, on: false } : step
    }

    case 'fill':
      return step.on ? step : { ...step, on: true }

    case 'skip-even':
      return stepIndex % 2 === 0 ? { ...step, on: false } : step

    case 'skip-odd':
      return stepIndex % 2 === 1 ? { ...step, on: false } : step

    case 'invert-gates':
      return { ...step, on: !step.on }

    case 'densify': {
      // Opposite of thin: deterministically turn OFF gates ON.
      if (step.on) return step
      const hash = deterministicHash(stepIndex, barPosition)
      return hash < transform.param ? { ...step, on: true } : step
    }

    case 'drop':
      // Mute every Nth step position (param = N, e.g. 3 → mute steps 2,5,8,11...)
      return step.on && (stepIndex + 1) % transform.param === 0 ? { ...step, on: false } : step

    case 'ratchet':
      // Set ratchet subdivision count on active gates
      return step.on ? { ...step, ratchet: transform.param } : step

    default:
      return step
  }
}

// --- TASK 4: Pitch value transforms ---

/**
 * Apply a pitch value transform to a PitchStep.
 * Returns a new PitchStep (immutable). Preserves .slide.
 */
export function transformPitchValue(step: PitchStep, transform: Transform): PitchStep {
  switch (transform.type) {
    case 'transpose':
      return { ...step, note: clamp(step.note + transform.param, 0, 127) }

    case 'octave-shift':
      return { ...step, note: clamp(step.note + transform.param * 12, 0, 127) }

    case 'invert': {
      const center = transform.param
      return { ...step, note: clamp(center + (center - step.note), 0, 127) }
    }

    case 'fold': {
      // Fold pitch into a range centered on middle C (60).
      // param = total range in semitones (e.g. 12 = one octave)
      const halfRange = Math.floor(transform.param / 2)
      const lo = Math.max(0, 60 - halfRange)
      const hi = Math.min(127, 60 + halfRange)
      const range = hi - lo
      if (range <= 0) return step
      let n = step.note - lo
      const period = range * 2
      n = ((n % period) + period) % period
      if (n > range) n = period - n
      return { ...step, note: clamp(Math.round(lo + n), 0, 127) }
    }

    case 'quantize': {
      // Snap to nearest scale degree. param = scale index.
      const scale = QUANTIZE_SCALES[Math.floor(transform.param)] ?? SCALES.chromatic
      return { ...step, note: snapToScale(step.note, 0, scale) }
    }

    default:
      return step
  }
}

// --- Quantize scale table ---

const QUANTIZE_SCALES = [
  SCALES.chromatic,        // 0 — no effect
  SCALES.major,            // 1
  SCALES.minor,            // 2
  SCALES.minorPentatonic,  // 3
  SCALES.majorPentatonic,  // 4
  SCALES.blues,            // 5
  SCALES.dorian,           // 6
  SCALES.wholeNote,        // 7
]

export const QUANTIZE_SCALE_NAMES = ['CHROM', 'MAJOR', 'MINOR', 'mPENT', 'MPENT', 'BLUES', 'DORIAN', 'WHOLE']

// --- Velocity value transforms ---

/**
 * Apply a velocity value transform.
 * Returns a new velocity value (0-127, immutable).
 */
export function transformVelocityValue(
  step: number,
  transform: Transform,
  stepIndex: number,
  barPosition: number,
  length: number,
): number {
  switch (transform.type) {
    case 'accent':
      // Boost every Nth step to max velocity
      return stepIndex % transform.param === 0 ? 127 : step

    case 'fade-in': {
      // Velocity ramps from 0 → full across the bar
      const t = length > 1 ? stepIndex / (length - 1) : 1
      return clamp(Math.round(step * t), 0, 127)
    }

    case 'fade-out': {
      // Velocity ramps from full → 0 across the bar
      const t = length > 1 ? (length - 1 - stepIndex) / (length - 1) : 1
      return clamp(Math.round(step * t), 0, 127)
    }

    case 'humanize': {
      // Deterministic micro-variation using hash. param = amount (0.0-1.0)
      const hash = deterministicHash(stepIndex, barPosition)
      const deviation = (hash - 0.5) * 2 * transform.param * 30 // ±30 at max
      return clamp(Math.round(step + deviation), 1, 127)
    }

    default:
      return step
  }
}

// --- TASK 5: Transform composition ---

/**
 * Apply all playhead transforms in sequence to get the effective step index.
 */
function applyPlayheadTransforms(currentStep: number, length: number, transforms: Transform[]): number {
  let idx = currentStep
  for (const t of transforms) {
    if (isPlayheadTransform(t)) {
      idx = transformStepIndex(idx, length, t)
    }
  }
  return idx
}

/**
 * Get effective gate step after applying all transforms.
 * Playhead transforms change which step is read, then gate value transforms modify it.
 */
export function getEffectiveGateStep(
  subtrack: Subtrack<GateStep>,
  transforms: Transform[],
  barPosition: number,
): GateStep {
  const idx = applyPlayheadTransforms(subtrack.currentStep, subtrack.length, transforms)
  let step = subtrack.steps[idx]

  for (const t of transforms) {
    if (GATE_VALUE_TRANSFORMS.has(t.type)) {
      step = transformGateValue(step, t, idx, barPosition)
    }
  }

  return step
}

/**
 * Get effective pitch step after applying all transforms.
 * Playhead transforms change which step is read, then pitch value transforms modify it.
 */
export function getEffectivePitchStep(subtrack: Subtrack<PitchStep>, transforms: Transform[]): PitchStep {
  const idx = applyPlayheadTransforms(subtrack.currentStep, subtrack.length, transforms)
  let step = subtrack.steps[idx]

  for (const t of transforms) {
    if (PITCH_VALUE_TRANSFORMS.has(t.type)) {
      step = transformPitchValue(step, t)
    }
  }

  return step
}

/**
 * Get effective simple step (velocity/mod) after applying playhead transforms only.
 * Value transforms are not applied to velocity/mod subtracks.
 */
export function getEffectiveSimpleStep(subtrack: Subtrack<number>, transforms: Transform[]): number {
  const idx = applyPlayheadTransforms(subtrack.currentStep, subtrack.length, transforms)
  return subtrack.steps[idx]
}

/**
 * Get effective velocity step after applying playhead + velocity value transforms.
 * Like getEffectiveSimpleStep but also applies velocity-specific transforms.
 */
export function getEffectiveVelocityStep(
  subtrack: Subtrack<number>,
  transforms: Transform[],
  barPosition: number,
): number {
  const idx = applyPlayheadTransforms(subtrack.currentStep, subtrack.length, transforms)
  let step = subtrack.steps[idx]

  for (const t of transforms) {
    if (VELOCITY_VALUE_TRANSFORMS.has(t.type)) {
      step = transformVelocityValue(step, t, idx, barPosition, subtrack.length)
    }
  }

  return step
}

/**
 * Get effective compound step (e.g. ModStep) after applying playhead transforms only.
 * Generic version of getEffectiveSimpleStep for non-numeric step types.
 */
export function getEffectiveCompoundStep<T>(subtrack: Subtrack<T>, transforms: Transform[]): T {
  const idx = applyPlayheadTransforms(subtrack.currentStep, subtrack.length, transforms)
  return subtrack.steps[idx]
}

// --- TASK 6: Per-subtrack resolution + defaults ---

/**
 * Create a default (disabled) variation pattern.
 */
export function createDefaultVariationPattern(): VariationPattern {
  const slots: VariationSlot[] = Array.from({ length: 4 }, () => ({ transforms: [] }))
  return {
    enabled: false,
    length: 4,
    loopMode: false,
    slots,
    currentBar: 0,
    subtrackOverrides: {
      gate: null,
      pitch: null,
      velocity: null,
      mod: null,
    },
  }
}

type SubtrackKey = 'gate' | 'pitch' | 'velocity' | 'mod'

/**
 * Resolve which transforms apply to a specific subtrack.
 *
 * Resolution:
 * - If override is 'bypass' → return []
 * - If override is a VariationPattern → use override's own slots and currentBar
 * - If override is null → use track-level pattern's slots and currentBar
 */
export function getTransformsForSubtrack(pattern: VariationPattern, subtrackKey: SubtrackKey): Transform[] {
  const override = pattern.subtrackOverrides[subtrackKey]

  if (override === 'bypass') {
    return []
  }

  if (override !== null && typeof override === 'object') {
    // Use override's own bar counter and slots
    const bar = override.currentBar % override.slots.length
    return override.slots[bar]?.transforms ?? []
  }

  // null → inherit from track-level
  const bar = pattern.currentBar % pattern.slots.length
  return pattern.slots[bar]?.transforms ?? []
}

// --- TASK 7: Bar counter advancement ---

/**
 * Advance the variation bar counter.
 *
 * - If pattern is disabled, return unchanged.
 * - If subtrackKey provided and that override is a VariationPattern → advance only that override.
 * - If no subtrackKey → advance track-level currentBar.
 * - Wraps: (currentBar + 1) % length
 */
export function advanceVariationBar(pattern: VariationPattern, subtrackKey?: SubtrackKey): VariationPattern {
  if (!pattern.enabled) return pattern

  if (subtrackKey !== undefined) {
    const override = pattern.subtrackOverrides[subtrackKey]
    // Only advance if the override is a VariationPattern
    if (override === null || override === 'bypass') return pattern
    const advancedOverride: VariationPattern = {
      ...override,
      currentBar: (override.currentBar + 1) % override.length,
    }
    return {
      ...pattern,
      subtrackOverrides: {
        ...pattern.subtrackOverrides,
        [subtrackKey]: advancedOverride,
      },
    }
  }

  // Advance track-level
  return {
    ...pattern,
    currentBar: (pattern.currentBar + 1) % pattern.length,
  }
}
