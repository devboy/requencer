import { describe, test, expect } from 'vitest'
import { resolveOutputs } from '../routing'
import type { SequenceTrack, MuteTrack, TransposeConfig, GateStep, PitchStep, ModStep } from '../types'

function makeTrack(overrides: Partial<SequenceTrack> = {}): SequenceTrack {
  const defaultGateStep: GateStep = { on: true, tie: false, length: 0.5, ratchet: 1 }
  const defaultPitchStep: PitchStep = { note: 60, slide: 0 }
  return {
    id: 't1', name: 'Track 1', clockDivider: 1,
    gate: { steps: [defaultGateStep], length: 1, clockDivider: 1, currentStep: 0 },
    pitch: { steps: [defaultPitchStep], length: 1, clockDivider: 1, currentStep: 0 },
    velocity: { steps: [100], length: 1, clockDivider: 1, currentStep: 0 },
    mod: { steps: [{ value: 0.5, slew: 0 }], length: 1, clockDivider: 1, currentStep: 0 },
    ...overrides,
  }
}

function makeMute(): MuteTrack {
  return { steps: [false], length: 1, clockDivider: 1, currentStep: 0 }
}

function defaultXpose(): TransposeConfig {
  return { semitones: 0, noteLow: 0, noteHigh: 127, glScale: 1.0, velScale: 1.0 }
}

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

describe('Note window octave-wrapping', () => {
  test('octave-wraps pitch above noteHigh', () => {
    const track = makeTrack({
      pitch: { steps: [{ note: 84, slide: 0 }], length: 1, clockDivider: 1, currentStep: 0 },
    })
    const xpose: TransposeConfig = { ...defaultXpose(), noteHigh: 72 }
    const events = resolveOutputs([track], [{ gate: 0, pitch: 0, velocity: 0, mod: 0, modSource: 'seq' }], [makeMute()], [xpose])
    expect(events[0].pitch).toBe(72)
  })

  test('octave-wraps pitch below noteLow', () => {
    const track = makeTrack({
      pitch: { steps: [{ note: 36, slide: 0 }], length: 1, clockDivider: 1, currentStep: 0 },
    })
    const xpose: TransposeConfig = { ...defaultXpose(), noteLow: 48 }
    const events = resolveOutputs([track], [{ gate: 0, pitch: 0, velocity: 0, mod: 0, modSource: 'seq' }], [makeMute()], [xpose])
    expect(events[0].pitch).toBe(48)
  })

  test('applies transpose + note window together', () => {
    // note 70 + semitones 7 = 77, noteHigh 72 -> wraps to 65
    const track = makeTrack({
      pitch: { steps: [{ note: 70, slide: 0 }], length: 1, clockDivider: 1, currentStep: 0 },
    })
    const xpose: TransposeConfig = { ...defaultXpose(), semitones: 7, noteHigh: 72 }
    const events = resolveOutputs([track], [{ gate: 0, pitch: 0, velocity: 0, mod: 0, modSource: 'seq' }], [makeMute()], [xpose])
    expect(events[0].pitch).toBe(65)
  })

  test('no wrapping when noteLow=0 noteHigh=127', () => {
    const track = makeTrack({
      pitch: { steps: [{ note: 100, slide: 0 }], length: 1, clockDivider: 1, currentStep: 0 },
    })
    const xpose: TransposeConfig = { ...defaultXpose() } // noteLow=0, noteHigh=127
    const events = resolveOutputs([track], [{ gate: 0, pitch: 0, velocity: 0, mod: 0, modSource: 'seq' }], [makeMute()], [xpose])
    expect(events[0].pitch).toBe(100)
  })

  test('wraps multiple octaves if needed', () => {
    // pitch 96, noteLow 48, noteHigh 60 -> 96-12=84, 84-12=72, 72-12=60
    const track = makeTrack({
      pitch: { steps: [{ note: 96, slide: 0 }], length: 1, clockDivider: 1, currentStep: 0 },
    })
    const xpose: TransposeConfig = { ...defaultXpose(), noteLow: 48, noteHigh: 60 }
    const events = resolveOutputs([track], [{ gate: 0, pitch: 0, velocity: 0, mod: 0, modSource: 'seq' }], [makeMute()], [xpose])
    expect(events[0].pitch).toBe(60)
  })
})

describe('GL/VEL scaling', () => {
  test('scales gate length by glScale', () => {
    // gateLength 0.5 * glScale 0.5 = 0.25
    const track = makeTrack()
    // default gate step has length 0.5
    const xpose: TransposeConfig = { ...defaultXpose(), glScale: 0.5 }
    const events = resolveOutputs([track], [{ gate: 0, pitch: 0, velocity: 0, mod: 0, modSource: 'seq' }], [makeMute()], [xpose])
    expect(events[0].gateLength).toBeCloseTo(0.25)
  })

  test('clamps gate length to 1.0 max', () => {
    // gateLength 0.8 * glScale 2.0 = 1.6 -> clamped to 1.0
    const gateStep: GateStep = { on: true, tie: false, length: 0.8, ratchet: 1 }
    const track = makeTrack({
      gate: { steps: [gateStep], length: 1, clockDivider: 1, currentStep: 0 },
    })
    const xpose: TransposeConfig = { ...defaultXpose(), glScale: 2.0 }
    const events = resolveOutputs([track], [{ gate: 0, pitch: 0, velocity: 0, mod: 0, modSource: 'seq' }], [makeMute()], [xpose])
    expect(events[0].gateLength).toBe(1.0)
  })

  test('scales velocity by velScale', () => {
    // velocity 100 * velScale 0.5 = 50
    const track = makeTrack()
    const xpose: TransposeConfig = { ...defaultXpose(), velScale: 0.5 }
    const events = resolveOutputs([track], [{ gate: 0, pitch: 0, velocity: 0, mod: 0, modSource: 'seq' }], [makeMute()], [xpose])
    expect(events[0].velocity).toBe(50)
  })

  test('clamps velocity to 1-127', () => {
    // velocity 100 * velScale 3.0 = 300 -> clamped to 127
    const track = makeTrack()
    const xpose: TransposeConfig = { ...defaultXpose(), velScale: 3.0 }
    const events = resolveOutputs([track], [{ gate: 0, pitch: 0, velocity: 0, mod: 0, modSource: 'seq' }], [makeMute()], [xpose])
    expect(events[0].velocity).toBe(127)
  })

  test('no scaling when glScale=1.0 velScale=1.0', () => {
    const track = makeTrack()
    const xpose: TransposeConfig = { ...defaultXpose() } // glScale=1.0, velScale=1.0
    const events = resolveOutputs([track], [{ gate: 0, pitch: 0, velocity: 0, mod: 0, modSource: 'seq' }], [makeMute()], [xpose])
    expect(events[0].gateLength).toBe(0.5)
    expect(events[0].velocity).toBe(100)
  })
})
