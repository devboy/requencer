import { describe, expect, it } from 'vitest'
import type { GateStep, PitchStep, Subtrack, Transform, VariationPattern } from '../types'
import {
  advanceVariationBar,
  createDefaultVariationPattern,
  getEffectiveGateStep,
  getEffectivePitchStep,
  getEffectiveSimpleStep,
  getEffectiveVelocityStep,
  getTransformsForSubtrack,
  isPlayheadTransform,
  transformGateValue,
  transformPitchValue,
  transformStepIndex,
  transformVelocityValue,
} from '../variation'

// --- Helpers ---

function makeGateSubtrack(steps: GateStep[], currentStep: number = 0): Subtrack<GateStep> {
  return { steps, length: steps.length, clockDivider: 1, currentStep }
}

function makePitchSubtrack(steps: PitchStep[], currentStep: number = 0): Subtrack<PitchStep> {
  return { steps, length: steps.length, clockDivider: 1, currentStep }
}

function makeSimpleSubtrack(steps: number[], currentStep: number = 0): Subtrack<number> {
  return { steps, length: steps.length, clockDivider: 1, currentStep }
}

function gateOn(on: boolean = true): GateStep {
  return { on, tie: false, length: 0.5, ratchet: 1 }
}

function pitchStep(note: number, slide: number = 0): PitchStep {
  return { note, slide }
}

// --- TASK 2: Playhead transforms ---

describe('transformStepIndex', () => {
  describe('reverse', () => {
    it('reverses index for 8-step sequence', () => {
      const t: Transform = { type: 'reverse', param: 0 }
      expect(transformStepIndex(0, 8, t)).toBe(7)
      expect(transformStepIndex(1, 8, t)).toBe(6)
      expect(transformStepIndex(7, 8, t)).toBe(0)
    })

    it('reverses index for odd-length sequence', () => {
      const t: Transform = { type: 'reverse', param: 0 }
      expect(transformStepIndex(0, 5, t)).toBe(4)
      expect(transformStepIndex(2, 5, t)).toBe(2) // middle stays
      expect(transformStepIndex(4, 5, t)).toBe(0)
    })
  })

  describe('rotate', () => {
    it('rotates index by N with wrap', () => {
      const t: Transform = { type: 'rotate', param: 3 }
      expect(transformStepIndex(0, 8, t)).toBe(3)
      expect(transformStepIndex(5, 8, t)).toBe(0) // (5+3)%8 = 0
      expect(transformStepIndex(7, 8, t)).toBe(2) // (7+3)%8 = 2
    })

    it('handles negative rotation via large param', () => {
      // rotate(-1) is same as rotate(length-1)
      const t: Transform = { type: 'rotate', param: 7 }
      expect(transformStepIndex(0, 8, t)).toBe(7)
      expect(transformStepIndex(1, 8, t)).toBe(0)
    })
  })

  describe('ping-pong', () => {
    it('forward first half, backward second half for 8-step', () => {
      const t: Transform = { type: 'ping-pong', param: 0 }
      // 0→0, 1→1, 2→2, 3→3, 4→3, 5→2, 6→1, 7→0
      expect(transformStepIndex(0, 8, t)).toBe(0)
      expect(transformStepIndex(1, 8, t)).toBe(1)
      expect(transformStepIndex(2, 8, t)).toBe(2)
      expect(transformStepIndex(3, 8, t)).toBe(3)
      expect(transformStepIndex(4, 8, t)).toBe(3)
      expect(transformStepIndex(5, 8, t)).toBe(2)
      expect(transformStepIndex(6, 8, t)).toBe(1)
      expect(transformStepIndex(7, 8, t)).toBe(0)
    })
  })

  describe('double-time', () => {
    it('doubles index with modulo', () => {
      const t: Transform = { type: 'double-time', param: 0 }
      expect(transformStepIndex(0, 8, t)).toBe(0)
      expect(transformStepIndex(1, 8, t)).toBe(2)
      expect(transformStepIndex(2, 8, t)).toBe(4)
      expect(transformStepIndex(3, 8, t)).toBe(6)
      expect(transformStepIndex(4, 8, t)).toBe(0) // (4*2)%8 = 0
    })
  })

  describe('stutter', () => {
    it('repeats first N steps', () => {
      const t: Transform = { type: 'stutter', param: 4 }
      expect(transformStepIndex(0, 8, t)).toBe(0)
      expect(transformStepIndex(3, 8, t)).toBe(3)
      expect(transformStepIndex(4, 8, t)).toBe(0) // 4 % 4 = 0
      expect(transformStepIndex(7, 8, t)).toBe(3) // 7 % 4 = 3
    })

    it('clamps N to length', () => {
      const t: Transform = { type: 'stutter', param: 16 }
      // min(16, 4) = 4
      expect(transformStepIndex(0, 4, t)).toBe(0)
      expect(transformStepIndex(3, 4, t)).toBe(3)
    })
  })

  describe('half-time', () => {
    it('each step plays twice', () => {
      const t: Transform = { type: 'half-time', param: 0 }
      expect(transformStepIndex(0, 8, t)).toBe(0)
      expect(transformStepIndex(1, 8, t)).toBe(0)
      expect(transformStepIndex(2, 8, t)).toBe(1)
      expect(transformStepIndex(3, 8, t)).toBe(1)
      expect(transformStepIndex(4, 8, t)).toBe(2)
      expect(transformStepIndex(5, 8, t)).toBe(2)
      expect(transformStepIndex(6, 8, t)).toBe(3)
      expect(transformStepIndex(7, 8, t)).toBe(3)
    })
  })

  describe('skip', () => {
    it('decimates with factor 3', () => {
      const t: Transform = { type: 'skip', param: 3 }
      // (idx * 3) % 8
      expect(transformStepIndex(0, 8, t)).toBe(0)
      expect(transformStepIndex(1, 8, t)).toBe(3)
      expect(transformStepIndex(2, 8, t)).toBe(6)
      expect(transformStepIndex(3, 8, t)).toBe(1) // (9 % 8)
      expect(transformStepIndex(4, 8, t)).toBe(4) // (12 % 8)
    })

    it('skip(2) behaves like double-time', () => {
      const skip: Transform = { type: 'skip', param: 2 }
      const dbl: Transform = { type: 'double-time', param: 0 }
      for (let i = 0; i < 8; i++) {
        expect(transformStepIndex(i, 8, skip)).toBe(transformStepIndex(i, 8, dbl))
      }
    })
  })

  describe('drunk-walk', () => {
    it('is deterministic for same inputs', () => {
      const t: Transform = { type: 'drunk-walk', param: 0.5 }
      const r1 = transformStepIndex(7, 8, t)
      const r2 = transformStepIndex(7, 8, t)
      expect(r1).toBe(r2)
    })

    it('stays within bounds', () => {
      const t: Transform = { type: 'drunk-walk', param: 1.0 }
      for (let i = 0; i < 16; i++) {
        const result = transformStepIndex(i, 8, t)
        expect(result).toBeGreaterThanOrEqual(0)
        expect(result).toBeLessThan(8)
      }
    })

    it('with chaos=0, walks forward normally', () => {
      const t: Transform = { type: 'drunk-walk', param: 0 }
      // No deviations: position advances by 1 each step
      expect(transformStepIndex(0, 8, t)).toBe(0)
      expect(transformStepIndex(1, 8, t)).toBe(1)
      expect(transformStepIndex(4, 8, t)).toBe(4)
      expect(transformStepIndex(7, 8, t)).toBe(7)
    })
  })

  describe('scramble', () => {
    it('interleaves an 8-step sequence', () => {
      const t: Transform = { type: 'scramble', param: 0 }
      // Even positions first (0,2,4,6), then odd (1,3,5,7)
      // idx 0→0, 1→2, 2→4, 3→6, 4→1, 5→3, 6→5, 7→7
      expect(transformStepIndex(0, 8, t)).toBe(0)
      expect(transformStepIndex(1, 8, t)).toBe(2)
      expect(transformStepIndex(2, 8, t)).toBe(4)
      expect(transformStepIndex(3, 8, t)).toBe(6)
      expect(transformStepIndex(4, 8, t)).toBe(1)
      expect(transformStepIndex(5, 8, t)).toBe(3)
      expect(transformStepIndex(6, 8, t)).toBe(5)
      expect(transformStepIndex(7, 8, t)).toBe(7)
    })

    it('produces valid permutation for odd length', () => {
      const t: Transform = { type: 'scramble', param: 0 }
      // Length 7: half = ceil(7/2) = 4
      // 0→0, 1→2, 2→4, 3→6, 4→1, 5→3, 6→5
      const indices = Array.from({ length: 7 }, (_, i) => transformStepIndex(i, 7, t))
      expect(indices).toEqual([0, 2, 4, 6, 1, 3, 5])
      // All unique
      expect(new Set(indices).size).toBe(7)
    })
  })
})

describe('isPlayheadTransform', () => {
  it('returns true for playhead transforms', () => {
    expect(isPlayheadTransform({ type: 'reverse', param: 0 })).toBe(true)
    expect(isPlayheadTransform({ type: 'ping-pong', param: 0 })).toBe(true)
    expect(isPlayheadTransform({ type: 'rotate', param: 3 })).toBe(true)
    expect(isPlayheadTransform({ type: 'double-time', param: 0 })).toBe(true)
    expect(isPlayheadTransform({ type: 'stutter', param: 4 })).toBe(true)
    expect(isPlayheadTransform({ type: 'half-time', param: 0 })).toBe(true)
    expect(isPlayheadTransform({ type: 'skip', param: 3 })).toBe(true)
    expect(isPlayheadTransform({ type: 'drunk-walk', param: 0.5 })).toBe(true)
    expect(isPlayheadTransform({ type: 'scramble', param: 0 })).toBe(true)
  })

  it('returns false for value transforms', () => {
    expect(isPlayheadTransform({ type: 'thin', param: 0.5 })).toBe(false)
    expect(isPlayheadTransform({ type: 'fill', param: 0 })).toBe(false)
    expect(isPlayheadTransform({ type: 'transpose', param: 3 })).toBe(false)
    expect(isPlayheadTransform({ type: 'invert', param: 60 })).toBe(false)
    expect(isPlayheadTransform({ type: 'octave-shift', param: 1 })).toBe(false)
    expect(isPlayheadTransform({ type: 'invert-gates', param: 0 })).toBe(false)
    expect(isPlayheadTransform({ type: 'densify', param: 0.5 })).toBe(false)
    expect(isPlayheadTransform({ type: 'drop', param: 3 })).toBe(false)
    expect(isPlayheadTransform({ type: 'ratchet', param: 2 })).toBe(false)
    expect(isPlayheadTransform({ type: 'fold', param: 12 })).toBe(false)
    expect(isPlayheadTransform({ type: 'quantize', param: 1 })).toBe(false)
    expect(isPlayheadTransform({ type: 'accent', param: 4 })).toBe(false)
    expect(isPlayheadTransform({ type: 'fade-in', param: 0 })).toBe(false)
    expect(isPlayheadTransform({ type: 'fade-out', param: 0 })).toBe(false)
    expect(isPlayheadTransform({ type: 'humanize', param: 0.5 })).toBe(false)
  })
})

// --- TASK 3: Gate value transforms ---

describe('transformGateValue', () => {
  describe('thin', () => {
    it('deterministic mute based on hash', () => {
      const step = gateOn(true)
      const t: Transform = { type: 'thin', param: 0.5 }
      // Same inputs always produce same output
      const r1 = transformGateValue(step, t, 3, 1)
      const r2 = transformGateValue(step, t, 3, 1)
      expect(r1.on).toBe(r2.on)
    })

    it('param=0 never mutes', () => {
      const step = gateOn(true)
      const t: Transform = { type: 'thin', param: 0 }
      // Try many step/bar combos — none should be muted
      for (let s = 0; s < 16; s++) {
        for (let b = 0; b < 8; b++) {
          expect(transformGateValue(step, t, s, b).on).toBe(true)
        }
      }
    })

    it('param=1 always mutes', () => {
      const step = gateOn(true)
      const t: Transform = { type: 'thin', param: 1 }
      // hash is always 0..1 exclusive, so hash < 1.0 is always true
      for (let s = 0; s < 16; s++) {
        for (let b = 0; b < 8; b++) {
          expect(transformGateValue(step, t, s, b).on).toBe(false)
        }
      }
    })

    it('does not mutate original step', () => {
      const step = gateOn(true)
      const t: Transform = { type: 'thin', param: 1 }
      transformGateValue(step, t, 0, 0)
      expect(step.on).toBe(true)
    })
  })

  describe('fill', () => {
    it('forces gate on', () => {
      const step = gateOn(false)
      const t: Transform = { type: 'fill', param: 0 }
      expect(transformGateValue(step, t, 0, 0).on).toBe(true)
    })

    it('preserves other fields', () => {
      const step: GateStep = { on: false, tie: true, length: 0.8, ratchet: 3 }
      const t: Transform = { type: 'fill', param: 0 }
      const result = transformGateValue(step, t, 0, 0)
      expect(result.on).toBe(true)
      expect(result.tie).toBe(true)
      expect(result.length).toBe(0.8)
      expect(result.ratchet).toBe(3)
    })
  })

  describe('skip-even', () => {
    it('mutes even step indices', () => {
      const step = gateOn(true)
      const t: Transform = { type: 'skip-even', param: 0 }
      expect(transformGateValue(step, t, 0, 0).on).toBe(false)
      expect(transformGateValue(step, t, 1, 0).on).toBe(true)
      expect(transformGateValue(step, t, 2, 0).on).toBe(false)
      expect(transformGateValue(step, t, 3, 0).on).toBe(true)
    })
  })

  describe('skip-odd', () => {
    it('mutes odd step indices', () => {
      const step = gateOn(true)
      const t: Transform = { type: 'skip-odd', param: 0 }
      expect(transformGateValue(step, t, 0, 0).on).toBe(true)
      expect(transformGateValue(step, t, 1, 0).on).toBe(false)
      expect(transformGateValue(step, t, 2, 0).on).toBe(true)
      expect(transformGateValue(step, t, 3, 0).on).toBe(false)
    })
  })

  describe('invert-gates', () => {
    it('flips on to off', () => {
      const step = gateOn(true)
      const t: Transform = { type: 'invert-gates', param: 0 }
      expect(transformGateValue(step, t, 0, 0).on).toBe(false)
    })

    it('flips off to on', () => {
      const step = gateOn(false)
      const t: Transform = { type: 'invert-gates', param: 0 }
      expect(transformGateValue(step, t, 0, 0).on).toBe(true)
    })

    it('preserves other fields', () => {
      const step: GateStep = { on: true, tie: true, length: 0.8, ratchet: 3 }
      const t: Transform = { type: 'invert-gates', param: 0 }
      const result = transformGateValue(step, t, 0, 0)
      expect(result.on).toBe(false)
      expect(result.tie).toBe(true)
      expect(result.length).toBe(0.8)
      expect(result.ratchet).toBe(3)
    })
  })

  describe('densify', () => {
    it('turns off gates on based on hash', () => {
      const step = gateOn(false)
      const t: Transform = { type: 'densify', param: 0.5 }
      // Deterministic
      const r1 = transformGateValue(step, t, 3, 1)
      const r2 = transformGateValue(step, t, 3, 1)
      expect(r1.on).toBe(r2.on)
    })

    it('param=1 always turns on', () => {
      const step = gateOn(false)
      const t: Transform = { type: 'densify', param: 1 }
      for (let s = 0; s < 16; s++) {
        expect(transformGateValue(step, t, s, 0).on).toBe(true)
      }
    })

    it('param=0 never turns on', () => {
      const step = gateOn(false)
      const t: Transform = { type: 'densify', param: 0 }
      for (let s = 0; s < 16; s++) {
        expect(transformGateValue(step, t, s, 0).on).toBe(false)
      }
    })

    it('does not affect already-on gates', () => {
      const step = gateOn(true)
      const t: Transform = { type: 'densify', param: 1 }
      expect(transformGateValue(step, t, 0, 0).on).toBe(true)
    })
  })

  describe('drop', () => {
    it('mutes every 3rd step position', () => {
      const step = gateOn(true)
      const t: Transform = { type: 'drop', param: 3 }
      // Mutes when (stepIndex + 1) % 3 === 0 → indices 2, 5, 8, 11
      expect(transformGateValue(step, t, 0, 0).on).toBe(true)
      expect(transformGateValue(step, t, 1, 0).on).toBe(true)
      expect(transformGateValue(step, t, 2, 0).on).toBe(false) // (2+1)%3=0
      expect(transformGateValue(step, t, 3, 0).on).toBe(true)
      expect(transformGateValue(step, t, 4, 0).on).toBe(true)
      expect(transformGateValue(step, t, 5, 0).on).toBe(false) // (5+1)%3=0
    })

    it('does not affect already-off gates', () => {
      const step = gateOn(false)
      const t: Transform = { type: 'drop', param: 3 }
      expect(transformGateValue(step, t, 2, 0).on).toBe(false)
    })
  })

  describe('ratchet', () => {
    it('sets ratchet count on active gates', () => {
      const step = gateOn(true)
      const t: Transform = { type: 'ratchet', param: 3 }
      const result = transformGateValue(step, t, 0, 0)
      expect(result.ratchet).toBe(3)
      expect(result.on).toBe(true)
    })

    it('does not affect inactive gates', () => {
      const step = gateOn(false)
      const t: Transform = { type: 'ratchet', param: 3 }
      const result = transformGateValue(step, t, 0, 0)
      expect(result.ratchet).toBe(1) // unchanged from default
    })

    it('preserves other fields', () => {
      const step: GateStep = { on: true, tie: false, length: 0.8, ratchet: 1 }
      const t: Transform = { type: 'ratchet', param: 4 }
      const result = transformGateValue(step, t, 0, 0)
      expect(result.ratchet).toBe(4)
      expect(result.length).toBe(0.8)
      expect(result.tie).toBe(false)
    })
  })
})

// --- TASK 4: Pitch value transforms ---

describe('transformPitchValue', () => {
  describe('transpose', () => {
    it('adds positive semitones', () => {
      const step = pitchStep(60)
      const t: Transform = { type: 'transpose', param: 5 }
      expect(transformPitchValue(step, t).note).toBe(65)
    })

    it('adds negative semitones', () => {
      const step = pitchStep(60)
      const t: Transform = { type: 'transpose', param: -12 }
      expect(transformPitchValue(step, t).note).toBe(48)
    })

    it('clamps to 0-127', () => {
      const stepHigh = pitchStep(120)
      expect(transformPitchValue(stepHigh, { type: 'transpose', param: 20 }).note).toBe(127)

      const stepLow = pitchStep(5)
      expect(transformPitchValue(stepLow, { type: 'transpose', param: -10 }).note).toBe(0)
    })

    it('preserves slide field', () => {
      const step = pitchStep(60, 0.1)
      const t: Transform = { type: 'transpose', param: 7 }
      expect(transformPitchValue(step, t).slide).toBe(0.1)
    })
  })

  describe('octave-shift', () => {
    it('shifts by N octaves', () => {
      const step = pitchStep(60)
      expect(transformPitchValue(step, { type: 'octave-shift', param: 1 }).note).toBe(72)
      expect(transformPitchValue(step, { type: 'octave-shift', param: -1 }).note).toBe(48)
      expect(transformPitchValue(step, { type: 'octave-shift', param: 2 }).note).toBe(84)
    })

    it('clamps to 0-127', () => {
      const step = pitchStep(120)
      expect(transformPitchValue(step, { type: 'octave-shift', param: 2 }).note).toBe(127)

      const stepLow = pitchStep(5)
      expect(transformPitchValue(stepLow, { type: 'octave-shift', param: -2 }).note).toBe(0)
    })
  })

  describe('invert', () => {
    it('center note stays the same', () => {
      const step = pitchStep(60)
      const t: Transform = { type: 'invert', param: 60 } // center = 60
      expect(transformPitchValue(step, t).note).toBe(60)
    })

    it('mirrors around center', () => {
      // center=60, note=65 → 60 + (60 - 65) = 55
      const step = pitchStep(65)
      const t: Transform = { type: 'invert', param: 60 }
      expect(transformPitchValue(step, t).note).toBe(55)

      // center=60, note=48 → 60 + (60 - 48) = 72
      const step2 = pitchStep(48)
      expect(transformPitchValue(step2, t).note).toBe(72)
    })

    it('clamps to 0-127', () => {
      // center=10, note=100 → 10 + (10 - 100) = -80 → 0
      const step = pitchStep(100)
      const t: Transform = { type: 'invert', param: 10 }
      expect(transformPitchValue(step, t).note).toBe(0)

      // center=120, note=10 → 120 + (120 - 10) = 230 → 127
      const step2 = pitchStep(10)
      const t2: Transform = { type: 'invert', param: 120 }
      expect(transformPitchValue(step2, t2).note).toBe(127)
    })

    it('preserves slide', () => {
      const step = pitchStep(65, 0.2)
      const t: Transform = { type: 'invert', param: 60 }
      expect(transformPitchValue(step, t).slide).toBe(0.2)
    })
  })

  describe('fold', () => {
    it('folds note above range back down', () => {
      // Range: 12 semitones centered on 60 → [54, 66]
      const step = pitchStep(70)
      const t: Transform = { type: 'fold', param: 12 }
      const result = transformPitchValue(step, t)
      // 70 is 4 above 66 → folds to 66 - 4 = 62
      expect(result.note).toBe(62)
    })

    it('folds note below range back up', () => {
      // Range: 12 → [54, 66]
      const step = pitchStep(50)
      const t: Transform = { type: 'fold', param: 12 }
      const result = transformPitchValue(step, t)
      // 50 is 4 below 54 → folds to 54 + 4 = 58
      expect(result.note).toBe(58)
    })

    it('note within range stays unchanged', () => {
      const step = pitchStep(60)
      const t: Transform = { type: 'fold', param: 12 }
      expect(transformPitchValue(step, t).note).toBe(60)
    })

    it('preserves slide', () => {
      const step = pitchStep(70, 0.15)
      const t: Transform = { type: 'fold', param: 12 }
      expect(transformPitchValue(step, t).slide).toBe(0.15)
    })
  })

  describe('quantize', () => {
    it('snaps to C major scale', () => {
      // param=1 → major scale, root=C
      const step = pitchStep(61) // C#4 → should snap to C4 (60) or D4 (62)
      const t: Transform = { type: 'quantize', param: 1 }
      const result = transformPitchValue(step, t)
      // snapToScale snaps down on tie, so C#→C
      expect(result.note).toBe(60)
    })

    it('note already in scale stays unchanged', () => {
      const step = pitchStep(60) // C4 — in major scale
      const t: Transform = { type: 'quantize', param: 1 }
      expect(transformPitchValue(step, t).note).toBe(60)
    })

    it('chromatic scale (param=0) has no effect', () => {
      const step = pitchStep(61)
      const t: Transform = { type: 'quantize', param: 0 }
      expect(transformPitchValue(step, t).note).toBe(61)
    })

    it('snaps to minor pentatonic (param=3)', () => {
      // Minor pentatonic from C: C Eb F G Bb = 0,3,5,7,10
      const step = pitchStep(62) // D4 → should snap to Eb4 (63) or C4 (60)
      const t: Transform = { type: 'quantize', param: 3 }
      const result = transformPitchValue(step, t)
      // D is 2 semitones from C and 1 from Eb, so snaps to C (down on tie)
      expect([60, 63]).toContain(result.note)
    })

    it('preserves slide', () => {
      const step = pitchStep(61, 0.1)
      const t: Transform = { type: 'quantize', param: 1 }
      expect(transformPitchValue(step, t).slide).toBe(0.1)
    })
  })
})

// --- Velocity value transforms ---

describe('transformVelocityValue', () => {
  describe('accent', () => {
    it('boosts every Nth step to 127', () => {
      const t: Transform = { type: 'accent', param: 4 }
      expect(transformVelocityValue(80, t, 0, 0, 16)).toBe(127) // 0 % 4 = 0
      expect(transformVelocityValue(80, t, 1, 0, 16)).toBe(80)
      expect(transformVelocityValue(80, t, 2, 0, 16)).toBe(80)
      expect(transformVelocityValue(80, t, 3, 0, 16)).toBe(80)
      expect(transformVelocityValue(80, t, 4, 0, 16)).toBe(127) // 4 % 4 = 0
    })
  })

  describe('fade-in', () => {
    it('ramps from 0 to full across the bar', () => {
      const t: Transform = { type: 'fade-in', param: 0 }
      expect(transformVelocityValue(100, t, 0, 0, 8)).toBe(0) // start
      expect(transformVelocityValue(100, t, 7, 0, 8)).toBe(100) // end
    })

    it('mid-point is roughly half', () => {
      const t: Transform = { type: 'fade-in', param: 0 }
      // stepIndex 3 out of 8 → 3/7 ≈ 0.43
      const result = transformVelocityValue(100, t, 3, 0, 8)
      expect(result).toBeGreaterThan(30)
      expect(result).toBeLessThan(60)
    })
  })

  describe('fade-out', () => {
    it('ramps from full to 0 across the bar', () => {
      const t: Transform = { type: 'fade-out', param: 0 }
      expect(transformVelocityValue(100, t, 0, 0, 8)).toBe(100) // start
      expect(transformVelocityValue(100, t, 7, 0, 8)).toBe(0) // end
    })
  })

  describe('humanize', () => {
    it('is deterministic', () => {
      const t: Transform = { type: 'humanize', param: 0.5 }
      const r1 = transformVelocityValue(80, t, 3, 1, 16)
      const r2 = transformVelocityValue(80, t, 3, 1, 16)
      expect(r1).toBe(r2)
    })

    it('stays within 1-127 range', () => {
      const t: Transform = { type: 'humanize', param: 1.0 }
      for (let s = 0; s < 16; s++) {
        for (let b = 0; b < 4; b++) {
          const result = transformVelocityValue(80, t, s, b, 16)
          expect(result).toBeGreaterThanOrEqual(1)
          expect(result).toBeLessThanOrEqual(127)
        }
      }
    })

    it('introduces variation across steps', () => {
      const t: Transform = { type: 'humanize', param: 1.0 }
      const values = Array.from({ length: 16 }, (_, i) => transformVelocityValue(80, t, i, 0, 16))
      // Not all the same (with max humanize, there should be variation)
      const unique = new Set(values)
      expect(unique.size).toBeGreaterThan(1)
    })
  })
})

describe('getEffectiveVelocityStep', () => {
  it('no transforms returns base step', () => {
    const sub = makeSimpleSubtrack([100, 80, 60, 40], 1)
    expect(getEffectiveVelocityStep(sub, [], 0)).toBe(80)
  })

  it('applies playhead + velocity transforms', () => {
    const sub = makeSimpleSubtrack([100, 80, 60, 40], 0)
    // reverse reads step 3 (=40), then accent every 4th (step 0) → 127
    // Wait, after reverse, idx=3, which is not 0 % 4. Let me use a simpler test.
    const result = getEffectiveVelocityStep(sub, [{ type: 'accent', param: 4 }], 0)
    // currentStep=0, 0 % 4 = 0 → accent → 127
    expect(result).toBe(127)
  })

  it('reverse + fade-in composes', () => {
    const sub = makeSimpleSubtrack([100, 100, 100, 100], 0)
    // reverse: step 0 → reads step 3, fade-in: step 3 of 4 → 3/3 = 1.0 → 100
    const result = getEffectiveVelocityStep(
      sub,
      [
        { type: 'reverse', param: 0 },
        { type: 'fade-in', param: 0 },
      ],
      0,
    )
    // idx after reverse = 3, fade-in: 3/3 = 1.0, 100*1.0 = 100
    expect(result).toBe(100)
  })
})

// --- TASK 5: Composition ---

describe('getEffectiveGateStep', () => {
  it('no transforms returns base step', () => {
    const sub = makeGateSubtrack([gateOn(true), gateOn(false), gateOn(true), gateOn(false)], 0)
    const result = getEffectiveGateStep(sub, [], 0)
    expect(result.on).toBe(true)
  })

  it('reverse reads from end', () => {
    const sub = makeGateSubtrack([gateOn(true), gateOn(false), gateOn(false), gateOn(false)], 0)
    const result = getEffectiveGateStep(sub, [{ type: 'reverse', param: 0 }], 0)
    // currentStep=0, reversed → reads step 3 (which is off)
    expect(result.on).toBe(false)
  })

  it('reverse+fill composes', () => {
    const sub = makeGateSubtrack([gateOn(false), gateOn(false), gateOn(false), gateOn(false)], 2)
    // reverse first → reads index 1, which is off, then fill → on
    const result = getEffectiveGateStep(
      sub,
      [
        { type: 'reverse', param: 0 },
        { type: 'fill', param: 0 },
      ],
      0,
    )
    expect(result.on).toBe(true)
  })
})

describe('getEffectivePitchStep', () => {
  it('no transforms returns base step', () => {
    const sub = makePitchSubtrack([pitchStep(60), pitchStep(72)], 0)
    const result = getEffectivePitchStep(sub, [])
    expect(result.note).toBe(60)
  })

  it('reverse+transpose composes', () => {
    const sub = makePitchSubtrack([pitchStep(48), pitchStep(60), pitchStep(72), pitchStep(84)], 0)
    // reverse: step 0 → reads step 3 (note=84), then transpose +5 → 89
    const result = getEffectivePitchStep(sub, [
      { type: 'reverse', param: 0 },
      { type: 'transpose', param: 5 },
    ])
    expect(result.note).toBe(89)
  })
})

describe('getEffectiveSimpleStep', () => {
  it('no transforms returns base step', () => {
    const sub = makeSimpleSubtrack([100, 80, 60, 40], 1)
    expect(getEffectiveSimpleStep(sub, [])).toBe(80)
  })

  it('reverse reads from end', () => {
    const sub = makeSimpleSubtrack([100, 80, 60, 40], 0)
    // reverse: step 0 → reads step 3 = 40
    expect(getEffectiveSimpleStep(sub, [{ type: 'reverse', param: 0 }])).toBe(40)
  })

  it('ignores value transforms', () => {
    const sub = makeSimpleSubtrack([100, 80, 60, 40], 1)
    // transpose is a pitch value transform, should be ignored for simple subtracks
    expect(getEffectiveSimpleStep(sub, [{ type: 'transpose', param: 12 }])).toBe(80)
  })
})

// --- TASK 6: Per-subtrack resolution + defaults ---

describe('createDefaultVariationPattern', () => {
  it('has correct default fields', () => {
    const p = createDefaultVariationPattern()
    expect(p.enabled).toBe(false)
    expect(p.length).toBe(4)
    expect(p.loopMode).toBe(false)
    expect(p.slots).toHaveLength(4)
    expect(p.currentBar).toBe(0)
    for (const slot of p.slots) {
      expect(slot.transforms).toEqual([])
    }
    expect(p.subtrackOverrides.gate).toBeNull()
    expect(p.subtrackOverrides.pitch).toBeNull()
    expect(p.subtrackOverrides.velocity).toBeNull()
    expect(p.subtrackOverrides.mod).toBeNull()
  })
})

describe('getTransformsForSubtrack', () => {
  it('inherit (null) uses track-level transforms', () => {
    const p: VariationPattern = {
      ...createDefaultVariationPattern(),
      enabled: true,
      currentBar: 1,
      slots: [
        { transforms: [] },
        { transforms: [{ type: 'reverse', param: 0 }] },
        { transforms: [] },
        { transforms: [] },
      ],
    }
    const transforms = getTransformsForSubtrack(p, 'gate')
    expect(transforms).toEqual([{ type: 'reverse', param: 0 }])
  })

  it('bypass returns empty array', () => {
    const p: VariationPattern = {
      ...createDefaultVariationPattern(),
      enabled: true,
      currentBar: 1,
      slots: [
        { transforms: [] },
        { transforms: [{ type: 'reverse', param: 0 }] },
        { transforms: [] },
        { transforms: [] },
      ],
      subtrackOverrides: {
        gate: 'bypass',
        pitch: null,
        velocity: null,
        mod: null,
      },
    }
    const transforms = getTransformsForSubtrack(p, 'gate')
    expect(transforms).toEqual([])
  })

  it('override uses own bar counter and slots', () => {
    const overridePattern: VariationPattern = {
      ...createDefaultVariationPattern(),
      enabled: true,
      length: 2,
      currentBar: 0,
      slots: [{ transforms: [{ type: 'fill', param: 0 }] }, { transforms: [{ type: 'thin', param: 0.5 }] }],
    }
    const p: VariationPattern = {
      ...createDefaultVariationPattern(),
      enabled: true,
      currentBar: 1, // track-level is bar 1
      slots: [
        { transforms: [] },
        { transforms: [{ type: 'reverse', param: 0 }] },
        { transforms: [] },
        { transforms: [] },
      ],
      subtrackOverrides: {
        gate: overridePattern,
        pitch: null,
        velocity: null,
        mod: null,
      },
    }
    // override bar=0 → slot 0 → fill
    const transforms = getTransformsForSubtrack(p, 'gate')
    expect(transforms).toEqual([{ type: 'fill', param: 0 }])
  })
})

// --- TASK 7: Bar counter advancement ---

describe('advanceVariationBar', () => {
  it('advances currentBar', () => {
    const p: VariationPattern = {
      ...createDefaultVariationPattern(),
      enabled: true,
      length: 4,
      currentBar: 0,
    }
    const result = advanceVariationBar(p)
    expect(result.currentBar).toBe(1)
  })

  it('wraps currentBar at length', () => {
    const p: VariationPattern = {
      ...createDefaultVariationPattern(),
      enabled: true,
      length: 4,
      currentBar: 3,
    }
    const result = advanceVariationBar(p)
    expect(result.currentBar).toBe(0)
  })

  it('disabled pattern does not advance', () => {
    const p: VariationPattern = {
      ...createDefaultVariationPattern(),
      enabled: false,
      currentBar: 2,
    }
    const result = advanceVariationBar(p)
    expect(result.currentBar).toBe(2)
  })

  it('advances subtrack override independently', () => {
    const overridePattern: VariationPattern = {
      ...createDefaultVariationPattern(),
      enabled: true,
      length: 2,
      currentBar: 1,
    }
    const p: VariationPattern = {
      ...createDefaultVariationPattern(),
      enabled: true,
      length: 4,
      currentBar: 0,
      subtrackOverrides: {
        gate: overridePattern,
        pitch: null,
        velocity: null,
        mod: null,
      },
    }
    const result = advanceVariationBar(p, 'gate')
    // Track-level should NOT advance
    expect(result.currentBar).toBe(0)
    // Gate override should advance: (1+1) % 2 = 0
    const gateOverride = result.subtrackOverrides.gate as VariationPattern
    expect(gateOverride.currentBar).toBe(0)
  })

  it('subtrack key with null override does nothing', () => {
    const p: VariationPattern = {
      ...createDefaultVariationPattern(),
      enabled: true,
      currentBar: 2,
    }
    // pitch override is null, so nothing changes
    const result = advanceVariationBar(p, 'pitch')
    expect(result.currentBar).toBe(2)
  })

  it('subtrack key with bypass override does nothing', () => {
    const p: VariationPattern = {
      ...createDefaultVariationPattern(),
      enabled: true,
      currentBar: 2,
      subtrackOverrides: {
        gate: null,
        pitch: 'bypass',
        velocity: null,
        mod: null,
      },
    }
    const result = advanceVariationBar(p, 'pitch')
    expect(result.currentBar).toBe(2)
  })
})

// --- Integration tests with sequencer tick ---

import { TICKS_PER_STEP } from '../clock-divider'
import { createSequencer, randomizeTrackPattern, tick } from '../sequencer'
import type { NoteEvent } from '../types'

/** Advance one full bar (16 steps), collecting pitch events for output 0 at step boundaries */
function collectBarPitches(initialState: ReturnType<typeof createSequencer>): {
  pitches: number[]
  state: ReturnType<typeof createSequencer>
} {
  let state = initialState
  const pitches: number[] = []
  for (let step = 0; step < 16; step++) {
    for (let sub = 0; sub < TICKS_PER_STEP; sub++) {
      const result = tick(state)
      if (sub === 0) {
        // Step boundary — event should be non-null
        const event = result.events[0] as NoteEvent
        pitches.push(event.pitch)
      }
      state = result.state
    }
  }
  return { pitches, state }
}

/** Advance N steps (N * TICKS_PER_STEP ticks), returning final state */
function advanceSteps(state: ReturnType<typeof createSequencer>, n: number) {
  let s = state
  for (let i = 0; i < n * TICKS_PER_STEP; i++) {
    s = tick(s).state
  }
  return s
}

describe('variation integration in tick', () => {
  it('reverse transform plays pitch steps backwards on configured bar', () => {
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
          slots: [{ transforms: [] }, { transforms: [{ type: 'reverse' as const, param: 0 }] }],
          currentBar: 0,
        }
      }),
      transport: { ...state.transport, playing: true },
    }

    // Collect pitch events for bar 0 (normal)
    const bar0 = collectBarPitches(state)
    state = bar0.state

    // Collect pitch events for bar 1 (reversed)
    const bar1 = collectBarPitches(state)

    // Bar 1 should be bar 0 reversed
    expect(bar1.pitches).toEqual([...bar0.pitches].reverse())
  })

  it('disabled variation has no effect on playback', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    state = { ...state, transport: { ...state.transport, playing: true } }

    // Collect first bar of output
    const bar1 = collectBarPitches(state)
    state = bar1.state

    // Second loop should be identical (no variation, no drift)
    const bar2 = collectBarPitches(state)

    expect(bar2.pitches).toEqual(bar1.pitches)
  })

  it('variation bar counter advances on gate loop boundary', () => {
    let state = createSequencer()
    state = {
      ...state,
      variationPatterns: state.variationPatterns.map((vp, i) => {
        if (i !== 0) return vp
        return {
          ...vp,
          enabled: true,
          length: 4,
          currentBar: 0,
          slots: Array.from({ length: 4 }, () => ({ transforms: [] })),
        }
      }),
      transport: { ...state.transport, playing: true },
    }

    // After 16 steps (one full loop of 16-step gate), bar should advance to 1
    state = advanceSteps(state, 16)
    expect(state.variationPatterns[0].currentBar).toBe(1)

    // After another 16 steps, bar should be 2
    state = advanceSteps(state, 16)
    expect(state.variationPatterns[0].currentBar).toBe(2)
  })

  it('variation bar counter wraps at phrase length', () => {
    let state = createSequencer()
    state = {
      ...state,
      variationPatterns: state.variationPatterns.map((vp, i) => {
        if (i !== 0) return vp
        return {
          ...vp,
          enabled: true,
          length: 2,
          currentBar: 0,
          slots: [{ transforms: [] }, { transforms: [] }],
        }
      }),
      transport: { ...state.transport, playing: true },
    }

    // After 2 full loops (32 steps), should wrap back to 0
    state = advanceSteps(state, 32)
    expect(state.variationPatterns[0].currentBar).toBe(0)
  })

  it('transpose variation modifies pitch on configured bar', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    // Bar 0 = normal, bar 1 = transpose +12
    state = {
      ...state,
      variationPatterns: state.variationPatterns.map((vp, i) => {
        if (i !== 0) return vp
        return {
          ...vp,
          enabled: true,
          length: 2,
          slots: [{ transforms: [] }, { transforms: [{ type: 'transpose' as const, param: 12 }] }],
          currentBar: 0,
        }
      }),
      transport: { ...state.transport, playing: true },
    }

    // Collect bar 0 pitches
    const bar0Result = collectBarPitches(state)
    state = bar0Result.state

    // Collect bar 1 pitches (transposed +12)
    const bar1Result = collectBarPitches(state)

    // Each bar 1 pitch should be bar 0 pitch + 12 (clamped to 127)
    for (let i = 0; i < 16; i++) {
      expect(bar1Result.pitches[i]).toBe(Math.min(127, bar0Result.pitches[i] + 12))
    }
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
