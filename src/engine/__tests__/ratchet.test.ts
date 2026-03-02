import { describe, it, expect } from 'vitest'
import { createSequencer, tick, setGateOn, setGateRatchet, randomizeTrackPattern, setSubtrackLength } from '../sequencer'
import { resolveOutputs } from '../routing'
import { randomizeRatchets } from '../randomizer'

describe('ratchet in compound GateStep', () => {
  it('createSequencer includes default ratchet 1 in gate steps', () => {
    const state = createSequencer()
    for (const track of state.tracks) {
      expect(track.gate.steps).toHaveLength(16)
      for (const step of track.gate.steps) {
        expect(step.ratchet).toBe(1)
      }
    }
  })

  it('setGateRatchet updates ratchet on a compound gate step', () => {
    const state = createSequencer()
    const next = setGateRatchet(state, 0, 3, 3)
    expect(next.tracks[0].gate.steps[3].ratchet).toBe(3)
    // Original state is unchanged (immutability)
    expect(state.tracks[0].gate.steps[3].ratchet).toBe(1)
  })

  it('setGateRatchet preserves other GateStep fields', () => {
    let state = createSequencer()
    state = setGateOn(state, 0, 3, true)
    state = setGateRatchet(state, 0, 3, 4)
    const step = state.tracks[0].gate.steps[3]
    expect(step.on).toBe(true)
    expect(step.ratchet).toBe(4)
    expect(step.length).toBe(0.5)
  })

  it('resolveOutputs includes ratchetCount from compound gate step', () => {
    let state = createSequencer()
    state = setGateOn(state, 0, 0, true)
    state = setGateRatchet(state, 0, 0, 3)
    const events = resolveOutputs(state.tracks, state.routing, state.mutePatterns)
    expect(events[0].ratchetCount).toBe(3)
  })

  it('resolveOutputs reads ratchetCount from gate-routed track', () => {
    let state = createSequencer()
    state = setGateRatchet(state, 1, 0, 4)
    state = setGateOn(state, 1, 0, true)
    state = {
      ...state,
      routing: state.routing.map((r, i) =>
        i === 0 ? { ...r, gate: 1 } : r,
      ),
    }
    const events = resolveOutputs(state.tracks, state.routing, state.mutePatterns)
    expect(events[0].ratchetCount).toBe(4)
  })

  it('ratchetCount defaults to 1 in NoteEvent', () => {
    const state = createSequencer()
    const events = resolveOutputs(state.tracks, state.routing, state.mutePatterns)
    expect(events[0].ratchetCount).toBe(1)
  })
})

describe('randomizeRatchets', () => {
  it('generates values between 1 and maxRatchet', () => {
    const values = randomizeRatchets({ maxRatchet: 3, probability: 1.0 }, 16, 42)
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(3)
    }
  })

  it('probability 0 produces all 1s', () => {
    const values = randomizeRatchets({ maxRatchet: 4, probability: 0 }, 16, 42)
    for (const v of values) {
      expect(v).toBe(1)
    }
  })

  it('probability 1 gives some ratchets > 1', () => {
    const values = randomizeRatchets({ maxRatchet: 4, probability: 1.0 }, 64, 42)
    const hasRatchets = values.some(v => v > 1)
    expect(hasRatchets).toBe(true)
  })

  it('generates deterministic values with same seed', () => {
    const a = randomizeRatchets({ maxRatchet: 3, probability: 0.5 }, 16, 123)
    const b = randomizeRatchets({ maxRatchet: 3, probability: 0.5 }, 16, 123)
    expect(a).toEqual(b)
  })

  it('respects length parameter', () => {
    const values = randomizeRatchets({ maxRatchet: 2, probability: 0.5 }, 8, 42)
    expect(values).toHaveLength(8)
  })
})

describe('randomizeTrackPattern with ratchets', () => {
  it('includes ratchets in compound gate steps after full track randomization', () => {
    const state = createSequencer()
    const next = {
      ...state,
      randomConfigs: state.randomConfigs.map(c => ({
        ...c,
        ratchet: { maxRatchet: 4, probability: 0.5 },
      })),
    }
    const result = randomizeTrackPattern(next, 0, 42)
    // Ratchet values live inside gate steps now
    expect(result.tracks[0].gate.steps).toHaveLength(16)
    for (const step of result.tracks[0].gate.steps) {
      expect(step.ratchet).toBeGreaterThanOrEqual(1)
      expect(step.ratchet).toBeLessThanOrEqual(4)
    }
  })
})

describe('RandomConfig ratchet', () => {
  it('createSequencer includes ratchet config', () => {
    const state = createSequencer()
    for (const config of state.randomConfigs) {
      expect(config.ratchet).toBeDefined()
      expect(config.ratchet.maxRatchet).toBeGreaterThanOrEqual(1)
      expect(config.ratchet.maxRatchet).toBeLessThanOrEqual(4)
      expect(config.ratchet.probability).toBeGreaterThanOrEqual(0)
      expect(config.ratchet.probability).toBeLessThanOrEqual(1)
    }
  })
})
