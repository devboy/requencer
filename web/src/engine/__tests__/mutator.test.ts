import { describe, expect, it } from 'vitest'
import { TICKS_PER_STEP } from '../clock-divider'
import { isMutateActive, mutateTrack } from '../mutator'
import { createSequencer, randomizeTrackPattern, setSubtrackLength, tick } from '../sequencer'
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
    const originalGate = track.gate.steps.map((s) => ({ ...s }))
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

describe('mutation respects active length', () => {
  it('only mutates steps within active length, not hidden steps', () => {
    let state = createSequencer()
    state = randomizeTrackPattern(state, 0, 42)

    // Reduce length to 8 — steps 8-15 become hidden
    state = setSubtrackLength(state, 0, 'gate', 8)
    state = setSubtrackLength(state, 0, 'pitch', 8)
    state = setSubtrackLength(state, 0, 'velocity', 8)
    state = setSubtrackLength(state, 0, 'mod', 8)

    const track = state.tracks[0]
    // Snapshot hidden steps (indices 8-15)
    const hiddenGate = track.gate.steps.slice(8).map((s) => ({ ...s }))
    const hiddenPitch = track.pitch.steps.slice(8).map((s) => ({ ...s }))
    const hiddenVel = [...track.velocity.steps.slice(8)]
    const hiddenMod = track.mod.steps.slice(8).map((s) => ({ ...s }))

    // Mutate with rate=1 (all active steps mutated)
    const config: MutateConfig = { ...offConfig(), gate: 1, pitch: 1, velocity: 1, mod: 1 }
    const result = mutateTrack(track, state.randomConfigs[0], config, 99)

    // Hidden steps (8-15) must be unchanged
    for (let i = 0; i < hiddenGate.length; i++) {
      expect(result.gate.steps[8 + i]).toEqual(hiddenGate[i])
      expect(result.pitch.steps[8 + i]).toEqual(hiddenPitch[i])
      expect(result.velocity.steps[8 + i]).toBe(hiddenVel[i])
      expect(result.mod.steps[8 + i]).toEqual(hiddenMod[i])
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
      mutateConfigs: state.mutateConfigs.map((c, i) => (i === 0 ? config : c)),
      transport: { ...state.transport, playing: true },
    }
    const originalGate = state.tracks[0].gate.steps.map((s) => s.on)

    // Advance through first bar (16 steps × TICKS_PER_STEP) + 1 tick to cross the boundary
    const barTicks = 16 * TICKS_PER_STEP
    for (let i = 0; i < barTicks + 1; i++) {
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
      mutateConfigs: state.mutateConfigs.map((c, i) => (i === 0 ? config : c)),
      transport: { ...state.transport, playing: true },
    }
    const originalGate = state.tracks[0].gate.steps.map((s) => s.on)

    // Advance through first full loop (16 steps) + 1 tick — should NOT mutate yet
    // (loop 0→1 transition = loop #1, which is odd, so skip)
    const loopTicks = 16 * TICKS_PER_STEP
    for (let i = 0; i < loopTicks + 1; i++) {
      const result = tick(state)
      state = result.state
    }
    expect(state.tracks[0].gate.steps.map((s) => s.on)).toEqual(originalGate)

    // Advance through second loop (another 16 steps) — NOW should mutate
    // (loop 1→2 transition = loop #2, which is even, so trigger)
    for (let i = 0; i < loopTicks; i++) {
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
      mutateConfigs: state.mutateConfigs.map((c, i) => (i === 0 ? config : c)),
      transport: { ...state.transport, playing: true },
    }
    const originalGate = state.tracks[0].gate.steps.map((s) => s.on)

    // First loop boundary at 16 steps
    const loopTicks = 16 * TICKS_PER_STEP
    for (let i = 0; i < loopTicks + 1; i++) {
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
    const originalGate = state.tracks[0].gate.steps.map((s) => ({ ...s }))

    const loopTicks = 16 * TICKS_PER_STEP
    for (let i = 0; i < loopTicks + 1; i++) {
      const result = tick(state)
      state = result.state
    }

    expect(state.tracks[0].gate.steps).toEqual(originalGate)
  })
})
