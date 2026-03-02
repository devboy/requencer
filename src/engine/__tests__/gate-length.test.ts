import { describe, it, expect } from 'vitest'
import { createSequencer, tick, setGateOn, setGateLength, randomizeTrackPattern, setSubtrackLength } from '../sequencer'
import { resolveOutputs } from '../routing'
import { randomizeGateLength } from '../randomizer'

describe('gate length in compound GateStep', () => {
  it('createSequencer includes default gate length of 0.5 in GateStep', () => {
    const state = createSequencer()
    for (const track of state.tracks) {
      expect(track.gate.steps).toHaveLength(16)
      for (const step of track.gate.steps) {
        expect(step.length).toBe(0.5)
      }
    }
  })

  it('setGateLength updates length in compound GateStep', () => {
    const state = createSequencer()
    const next = setGateLength(state, 0, 3, 0.75)
    expect(next.tracks[0].gate.steps[3].length).toBe(0.75)
    // Original state unchanged
    expect(state.tracks[0].gate.steps[3].length).toBe(0.5)
  })

  it('setGateLength preserves other GateStep fields', () => {
    let state = createSequencer()
    state = setGateOn(state, 0, 3, true)
    const next = setGateLength(state, 0, 3, 0.8)
    expect(next.tracks[0].gate.steps[3].on).toBe(true)
    expect(next.tracks[0].gate.steps[3].ratchet).toBe(1)
    expect(next.tracks[0].gate.steps[3].length).toBe(0.8)
  })

  it('resolveOutputs reads gateLength from compound GateStep', () => {
    let state = createSequencer()
    state = setGateOn(state, 0, 0, true)
    state = setGateLength(state, 0, 0, 0.8)
    const events = resolveOutputs(state.tracks, state.routing, state.mutePatterns)
    expect(events[0].gateLength).toBe(0.8)
  })

  it('resolveOutputs reads gateLength from gate-routed track (cross-routing)', () => {
    let state = createSequencer()
    state = setGateLength(state, 1, 0, 0.3)
    state = setGateOn(state, 1, 0, true)
    // Route output 0 gate to track 1
    state = {
      ...state,
      routing: state.routing.map((r, i) =>
        i === 0 ? { ...r, gate: 1 } : r,
      ),
    }
    const events = resolveOutputs(state.tracks, state.routing, state.mutePatterns)
    expect(events[0].gateLength).toBe(0.3)
  })

  it('gateLength defaults to 0.5 in NoteEvent when gate is off', () => {
    const state = createSequencer()
    const events = resolveOutputs(state.tracks, state.routing, state.mutePatterns)
    expect(events[0].gateLength).toBe(0.5)
  })
})

describe('randomizeGateLength', () => {
  it('generates values within min/max range', () => {
    const values = randomizeGateLength({ min: 0.25, max: 0.75 }, 16, 42)
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0.25)
      expect(v).toBeLessThanOrEqual(0.75)
    }
  })

  it('generates deterministic values with same seed', () => {
    const a = randomizeGateLength({ min: 0.1, max: 0.9 }, 16, 123)
    const b = randomizeGateLength({ min: 0.1, max: 0.9 }, 16, 123)
    expect(a).toEqual(b)
  })

  it('generates different values with different seeds', () => {
    const a = randomizeGateLength({ min: 0.1, max: 0.9 }, 16, 100)
    const b = randomizeGateLength({ min: 0.1, max: 0.9 }, 16, 200)
    expect(a).not.toEqual(b)
  })

  it('respects length parameter', () => {
    const values = randomizeGateLength({ min: 0.2, max: 0.8 }, 8, 42)
    expect(values).toHaveLength(8)
  })

  it('clamps values to 0.05-1.0 range', () => {
    const values = randomizeGateLength({ min: 0.0, max: 1.0 }, 64, 42)
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0.05)
      expect(v).toBeLessThanOrEqual(1.0)
    }
  })
})

describe('randomizeTrackPattern with gateLength', () => {
  it('produces varied gate lengths in compound GateStep', () => {
    let state = createSequencer()
    // Set non-trivial GL range so randomization produces varied values
    state = {
      ...state,
      randomConfigs: state.randomConfigs.map((c, i) =>
        i === 0 ? { ...c, gateLength: { min: 0.2, max: 0.8 } } : c
      ),
    }
    const next = randomizeTrackPattern(state, 0, 42)
    // gate length values should be randomized (not all 0.5 default)
    const allDefault = next.tracks[0].gate.steps.every(s => s.length === 0.5)
    expect(allDefault).toBe(false)
  })
})

describe('RandomConfig gateLength', () => {
  it('createSequencer includes gateLength config', () => {
    const state = createSequencer()
    for (const config of state.randomConfigs) {
      expect(config.gateLength).toBeDefined()
      expect(config.gateLength.min).toBeGreaterThanOrEqual(0)
      expect(config.gateLength.max).toBeLessThanOrEqual(1)
    }
  })
})
