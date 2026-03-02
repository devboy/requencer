import { describe, it, expect } from 'vitest'
import { mutateTrack, isMutateActive } from '../mutator'
import { createSequencer, randomizeTrackPattern, tick } from '../sequencer'
import type { MutateConfig } from '../types'

/** Helper: create a MutateConfig with everything off */
function offConfig(): MutateConfig {
  return { trigger: 'loop', bars: 1, gate: 0, pitch: 0, velocity: 0, mod: 0 }
}

describe('mutateTrack', () => {
  it('rate 0 produces no changes', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    const track = state.tracks[0]
    const result = mutateTrack(track, state.randomConfigs[0], offConfig(), 99)
    expect(result.gate.steps).toEqual(track.gate.steps)
    expect(result.pitch.steps).toEqual(track.pitch.steps)
  })

  it('high rate changes steps for enabled subtrack', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    const track = state.tracks[0]
    const config: MutateConfig = { ...offConfig(), gate: 1 }
    const result = mutateTrack(track, state.randomConfigs[0], config, 99)
    const gateChanged = !result.gate.steps.every((s, i) => s.on === track.gate.steps[i].on)
    expect(gateChanged).toBe(true)
  })

  it('disabled subtrack (rate 0) is preserved', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    const track = state.tracks[0]
    const config: MutateConfig = { ...offConfig(), gate: 1, pitch: 0 }
    const result = mutateTrack(track, state.randomConfigs[0], config, 99)
    expect(result.pitch.steps).toEqual(track.pitch.steps)
  })

  it('gate mutation preserves length and ratchet fields', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    const track = state.tracks[0]
    const config: MutateConfig = { ...offConfig(), gate: 1 }
    const result = mutateTrack(track, state.randomConfigs[0], config, 99)
    // .on may have changed, but .length and .ratchet must be preserved
    for (let i = 0; i < result.gate.steps.length; i++) {
      expect(result.gate.steps[i].length).toBe(track.gate.steps[i].length)
      expect(result.gate.steps[i].ratchet).toBe(track.gate.steps[i].ratchet)
    }
  })

  it('pitch mutation preserves slide field', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    const track = state.tracks[0]
    const config: MutateConfig = { ...offConfig(), pitch: 1 }
    const result = mutateTrack(track, state.randomConfigs[0], config, 99)
    // .note may have changed, but .slide must be preserved
    for (let i = 0; i < result.pitch.steps.length; i++) {
      expect(result.pitch.steps[i].slide).toBe(track.pitch.steps[i].slide)
    }
  })

  it('returns immutable result (does not mutate input)', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    const track = state.tracks[0]
    const originalGate = track.gate.steps.map(s => ({ ...s }))
    const config: MutateConfig = { ...offConfig(), gate: 1 }
    mutateTrack(track, state.randomConfigs[0], config, 99)
    expect(track.gate.steps).toEqual(originalGate)
  })

  it('is deterministic with same seed', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    const track = state.tracks[0]
    const config: MutateConfig = { ...offConfig(), gate: 0.5, pitch: 0.5 }
    const a = mutateTrack(track, state.randomConfigs[0], config, 123)
    const b = mutateTrack(track, state.randomConfigs[0], config, 123)
    expect(a.gate.steps).toEqual(b.gate.steps)
    expect(a.pitch.steps).toEqual(b.pitch.steps)
  })

  it('different seeds produce different results', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    const track = state.tracks[0]
    const config: MutateConfig = { ...offConfig(), gate: 0.5 }
    const a = mutateTrack(track, state.randomConfigs[0], config, 1)
    const b = mutateTrack(track, state.randomConfigs[0], config, 2)
    const anyDiff = !a.gate.steps.every((s, i) => s.on === b.gate.steps[i].on)
    expect(anyDiff).toBe(true)
  })

  it('mutates subtracks independently', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    const track = state.tracks[0]
    const config: MutateConfig = { ...offConfig(), velocity: 1 }
    const result = mutateTrack(track, state.randomConfigs[0], config, 99)
    expect(result.gate.steps).toEqual(track.gate.steps)
    expect(result.pitch.steps).toEqual(track.pitch.steps)
    const velChanged = !result.velocity.steps.every((s, i) => s === track.velocity.steps[i])
    expect(velChanged).toBe(true)
  })

  it('respects RandomConfig constraints', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    const track = state.tracks[0]
    const config: MutateConfig = { ...offConfig(), pitch: 1 }
    const result = mutateTrack(track, state.randomConfigs[0], config, 99)
    const pitchConfig = state.randomConfigs[0].pitch
    for (const p of result.pitch.steps) {
      expect(p.note).toBeGreaterThanOrEqual(pitchConfig.low)
      expect(p.note).toBeLessThanOrEqual(pitchConfig.high)
    }
  })
})

describe('isMutateActive', () => {
  it('returns false when all rates are 0', () => {
    expect(isMutateActive(offConfig())).toBe(false)
  })

  it('returns true when any rate > 0', () => {
    expect(isMutateActive({ ...offConfig(), mod: 0.1 })).toBe(true)
  })
})

describe('MutateConfig in SequencerState', () => {
  it('createSequencer includes per-subtrack rate configs', () => {
    const state = createSequencer()
    expect(state.mutateConfigs).toHaveLength(4)
    for (const mc of state.mutateConfigs) {
      expect(mc.trigger).toBe('loop')
      expect(mc.bars).toBe(1)
      expect(mc.gate).toBe(0)
      expect(mc.pitch).toBe(0)
      expect(mc.velocity).toBe(0)
      expect(mc.mod).toBe(0)
    }
  })
})

describe('tick mutation integration', () => {
  it('bars mode triggers mutation at bar boundary', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    const config: MutateConfig = { ...offConfig(), gate: 1, trigger: 'bars', bars: 1 }
    state = {
      ...state,
      mutateConfigs: state.mutateConfigs.map((c, i) => i === 0 ? config : c),
      transport: { ...state.transport, playing: true },
    }
    const originalGate = state.tracks[0].gate.steps.map(s => s.on)

    // Advance 17 ticks: ticks 0-15 play the first bar,
    // tick 16 is when masterTick=16 hits the bars boundary check
    for (let i = 0; i < 17; i++) {
      const result = tick(state)
      state = result.state
    }

    const gateChanged = !state.tracks[0].gate.steps.every((s, i) => s.on === originalGate[i])
    expect(gateChanged).toBe(true)
  })

  it('loop mode with bars=2 skips first loop, mutates on second', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    // Loop mode, mutate gate every 2nd loop (bars=2)
    const config: MutateConfig = { ...offConfig(), gate: 1, trigger: 'loop', bars: 2 }
    state = {
      ...state,
      mutateConfigs: state.mutateConfigs.map((c, i) => i === 0 ? config : c),
      transport: { ...state.transport, playing: true },
    }
    const originalGate = state.tracks[0].gate.steps.map(s => s.on)

    // Advance through first full loop (16 ticks) + 1 — should NOT mutate yet
    // (loop 0→1 transition = loop #1, which is odd, so skip)
    for (let i = 0; i < 17; i++) {
      const result = tick(state)
      state = result.state
    }
    expect(state.tracks[0].gate.steps.map(s => s.on)).toEqual(originalGate)

    // Advance through second loop (another 16 ticks) — NOW should mutate
    // (loop 1→2 transition = loop #2, which is even, so trigger)
    for (let i = 0; i < 16; i++) {
      const result = tick(state)
      state = result.state
    }
    const gateChanged = !state.tracks[0].gate.steps.every((s, i) => s.on === originalGate[i])
    expect(gateChanged).toBe(true)
  })

  it('loop mode with bars=1 mutates every loop', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    const config: MutateConfig = { ...offConfig(), gate: 1, trigger: 'loop', bars: 1 }
    state = {
      ...state,
      mutateConfigs: state.mutateConfigs.map((c, i) => i === 0 ? config : c),
      transport: { ...state.transport, playing: true },
    }
    const originalGate = state.tracks[0].gate.steps.map(s => s.on)

    // First loop boundary at tick 16
    for (let i = 0; i < 17; i++) {
      const result = tick(state)
      state = result.state
    }
    const gateChanged = !state.tracks[0].gate.steps.every((s, i) => s.on === originalGate[i])
    expect(gateChanged).toBe(true)
  })

  it('inactive config does not mutate', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)
    state = {
      ...state,
      transport: { ...state.transport, playing: true },
    }
    const originalGate = state.tracks[0].gate.steps.map(s => ({ ...s }))

    for (let i = 0; i < 17; i++) {
      const result = tick(state)
      state = result.state
    }

    expect(state.tracks[0].gate.steps).toEqual(originalGate)
  })
})
