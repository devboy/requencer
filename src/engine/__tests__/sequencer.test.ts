import { describe, it, expect } from 'vitest'
import { createSequencer, tick, setStep, setGateOn, setPitchNote, setRouting, setMutePattern, randomizeTrackPattern, randomizeGatePattern, randomizePitchPattern, randomizeVelocityPattern, setSubtrackLength, setSubtrackClockDivider, setTrackClockDivider, setMuteLength, setMuteClockDivider, resetTrackPlayheads, resetSubtrackPlayhead, saveUserPreset, deleteUserPreset, setOutputSource } from '../sequencer'
import type { SequencerState, MuteTrack, GateStep, PitchStep } from '../types'

describe('createSequencer', () => {
  it('creates state with 4 tracks', () => {
    const state = createSequencer()
    expect(state.tracks).toHaveLength(4)
  })

  it('creates default routing (1:1)', () => {
    const state = createSequencer()
    expect(state.routing).toHaveLength(4)
  })

  it('creates 4 mute patterns', () => {
    const state = createSequencer()
    expect(state.mutePatterns).toHaveLength(4)
  })

  it('creates 4 random configs', () => {
    const state = createSequencer()
    expect(state.randomConfigs).toHaveLength(4)
  })

  it('initializes transport as stopped at tick 0', () => {
    const state = createSequencer()
    expect(state.transport.playing).toBe(false)
    expect(state.transport.masterTick).toBe(0)
    expect(state.transport.bpm).toBe(135)
  })

  it('each track has gate, pitch, velocity subtracks', () => {
    const state = createSequencer()
    for (const track of state.tracks) {
      expect(track.gate.steps.length).toBeGreaterThan(0)
      expect(track.pitch.steps.length).toBeGreaterThan(0)
      expect(track.velocity.steps.length).toBeGreaterThan(0)
    }
  })
})

describe('tick', () => {
  it('advances masterTick', () => {
    const state = createSequencer()
    const { state: next } = tick(state)
    expect(next.transport.masterTick).toBe(1)
  })

  it('returns note events for each output', () => {
    const state = createSequencer()
    const { events } = tick(state)
    expect(events).toHaveLength(4)
    for (let i = 0; i < 4; i++) {
      expect(events[i].output).toBe(i)
    }
  })

  it('does not mutate the original state', () => {
    const state = createSequencer()
    const originalTick = state.transport.masterTick
    tick(state)
    expect(state.transport.masterTick).toBe(originalTick)
  })

  it('advances subtrack currentStep on each tick with divider 1', () => {
    let state = createSequencer()
    const { state: after1 } = tick(state)
    expect(after1.tracks[0].gate.currentStep).toBe(1)
    const { state: after2 } = tick(after1)
    expect(after2.tracks[0].gate.currentStep).toBe(2)
  })

  it('respects track clock divider — subtracks advance slower', () => {
    let state = createSequencer()
    // Set track 0 clock divider to 2
    state = {
      ...state,
      tracks: state.tracks.map((t, i) =>
        i === 0 ? { ...t, clockDivider: 2 } : t
      ),
    }

    const { state: after1 } = tick(state)
    // Tick 0 → step 0 (divider 2: tick 0 fires), masterTick becomes 1
    // At tick 0: step = floor(0/2) % length = 0
    expect(after1.tracks[0].gate.currentStep).toBe(0) // tick 1, step = floor(1/2)=0

    const { state: after2 } = tick(after1)
    expect(after2.tracks[0].gate.currentStep).toBe(1) // tick 2, step = floor(2/2)=1
  })

  it('wraps subtrack steps at subtrack length (polyrhythm)', () => {
    let state = createSequencer()
    // Set track 0 pitch subtrack to length 3
    const pitchSteps: PitchStep[] = [
      { note: 60, slide: 0 },
      { note: 64, slide: 0 },
      { note: 67, slide: 0 },
    ]
    state = {
      ...state,
      tracks: state.tracks.map((t, i) =>
        i === 0
          ? {
              ...t,
              pitch: { ...t.pitch, steps: pitchSteps, length: 3 },
            }
          : t
      ),
    }

    // Advance 3 ticks — pitch should wrap back to step 0
    let current = state
    for (let i = 0; i < 3; i++) {
      const result = tick(current)
      current = result.state
    }
    expect(current.tracks[0].pitch.currentStep).toBe(0) // 3 % 3 = 0
  })

  it('muted steps produce gate=false in events', () => {
    let state = createSequencer()
    // Mute track 0 at step 0
    state = {
      ...state,
      mutePatterns: state.mutePatterns.map((m, i) =>
        i === 0 ? { ...m, steps: [true, false, false, false], length: 4 } : m
      ),
    }

    // First tick at step 0 — muted
    const { events } = tick(state)
    expect(events[0].gate).toBe(false)
  })
})

describe('setStep', () => {
  it('sets a gate step on value', () => {
    const state = createSequencer()
    const next = setGateOn(state, 0, 0, true)
    expect(next.tracks[0].gate.steps[0].on).toBe(true)
    // Original unchanged
    expect(state.tracks[0].gate.steps[0].on).not.toBe(next.tracks[0].gate.steps[0].on)
  })

  it('sets a pitch step note value', () => {
    const state = createSequencer()
    const next = setPitchNote(state, 0, 2, 72)
    expect(next.tracks[0].pitch.steps[2].note).toBe(72)
  })

  it('sets a velocity step value', () => {
    const state = createSequencer()
    const next = setStep(state, 1, 'velocity', 0, 127)
    expect(next.tracks[1].velocity.steps[0]).toBe(127)
  })
})

describe('setRouting', () => {
  it('replaces routing', () => {
    const state = createSequencer()
    const newRouting = [{ gate: 0, pitch: 0, velocity: 0, mod: 0 }]
    const next = setRouting(state, newRouting)
    expect(next.routing).toEqual(newRouting)
    expect(state.routing).toHaveLength(4)
  })
})

describe('setMutePattern', () => {
  it('sets a mute pattern for a track', () => {
    const state = createSequencer()
    const mute: MuteTrack = { steps: [true, true, false, false], length: 4, clockDivider: 1, currentStep: 0 }
    const next = setMutePattern(state, 0, mute)
    expect(next.mutePatterns[0]).toEqual(mute)
    // Original unchanged
    expect(state.mutePatterns[0]).not.toEqual(mute)
  })
})

describe('randomizeTrackPattern', () => {
  it('replaces track subtrack steps with random values', () => {
    const state = createSequencer()
    const next = randomizeTrackPattern(state, 0, 42)
    // Steps should be different from defaults (extremely likely with seed 42)
    expect(next.tracks[0].gate.steps).not.toEqual(state.tracks[0].gate.steps)
    // Lengths preserved
    expect(next.tracks[0].gate.steps.length).toBe(state.tracks[0].gate.length)
    expect(next.tracks[0].pitch.steps.length).toBe(state.tracks[0].pitch.length)
    expect(next.tracks[0].velocity.steps.length).toBe(state.tracks[0].velocity.length)
    // Steps are compound types
    const gateStep = next.tracks[0].gate.steps[0]
    expect(gateStep).toHaveProperty('on')
    expect(gateStep).toHaveProperty('length')
    expect(gateStep).toHaveProperty('ratchet')
    const pitchStep = next.tracks[0].pitch.steps[0]
    expect(pitchStep).toHaveProperty('note')
    expect(pitchStep).toHaveProperty('slide')
  })

  it('does not affect other tracks', () => {
    const state = createSequencer()
    const next = randomizeTrackPattern(state, 0, 42)
    expect(next.tracks[1]).toEqual(state.tracks[1])
    expect(next.tracks[2]).toEqual(state.tracks[2])
    expect(next.tracks[3]).toEqual(state.tracks[3])
  })
})

describe('randomizeGatePattern', () => {
  it('only changes gate subtrack', () => {
    const state = createSequencer()
    const next = randomizeGatePattern(state, 0, 42)
    // Gate steps changed — compare the .on values
    const origOns = state.tracks[0].gate.steps.map(s => s.on)
    const nextOns = next.tracks[0].gate.steps.map(s => s.on)
    expect(nextOns).not.toEqual(origOns)
    expect(next.tracks[0].pitch).toBe(state.tracks[0].pitch)
    expect(next.tracks[0].velocity).toBe(state.tracks[0].velocity)
  })

  it('does not affect other tracks', () => {
    const state = createSequencer()
    const next = randomizeGatePattern(state, 1, 42)
    expect(next.tracks[0]).toBe(state.tracks[0])
    expect(next.tracks[2]).toBe(state.tracks[2])
    expect(next.tracks[3]).toBe(state.tracks[3])
  })

  it('preserves gate length', () => {
    const state = createSequencer()
    const next = randomizeGatePattern(state, 0, 42)
    expect(next.tracks[0].gate.steps.length).toBe(state.tracks[0].gate.length)
  })
})

describe('randomizePitchPattern', () => {
  it('only changes pitch subtrack', () => {
    const state = createSequencer()
    const next = randomizePitchPattern(state, 0, 42)
    // Pitch steps changed — compare the .note values
    const origNotes = state.tracks[0].pitch.steps.map(s => s.note)
    const nextNotes = next.tracks[0].pitch.steps.map(s => s.note)
    expect(nextNotes).not.toEqual(origNotes)
    expect(next.tracks[0].gate).toBe(state.tracks[0].gate)
    expect(next.tracks[0].velocity).toBe(state.tracks[0].velocity)
  })

  it('does not affect other tracks', () => {
    const state = createSequencer()
    const next = randomizePitchPattern(state, 2, 42)
    expect(next.tracks[0]).toBe(state.tracks[0])
    expect(next.tracks[1]).toBe(state.tracks[1])
    expect(next.tracks[3]).toBe(state.tracks[3])
  })
})

describe('randomizeVelocityPattern', () => {
  it('only changes velocity subtrack', () => {
    const state = createSequencer()
    const next = randomizeVelocityPattern(state, 0, 42)
    expect(next.tracks[0].velocity.steps).not.toEqual(state.tracks[0].velocity.steps)
    expect(next.tracks[0].gate).toBe(state.tracks[0].gate)
    expect(next.tracks[0].pitch).toBe(state.tracks[0].pitch)
  })

  it('does not affect other tracks', () => {
    const state = createSequencer()
    const next = randomizeVelocityPattern(state, 3, 42)
    expect(next.tracks[0]).toBe(state.tracks[0])
    expect(next.tracks[1]).toBe(state.tracks[1])
    expect(next.tracks[2]).toBe(state.tracks[2])
  })
})

describe('setSubtrackLength', () => {
  it('increases gate length by padding with default GateStep', () => {
    const state = createSequencer()
    const next = setSubtrackLength(state, 0, 'gate', 20)
    expect(next.tracks[0].gate.length).toBe(20)
    expect(next.tracks[0].gate.steps).toHaveLength(20)
    // New steps should have default GateStep values
    expect(next.tracks[0].gate.steps[16].on).toBe(false)
    expect(next.tracks[0].gate.steps[16].length).toBe(0.5)
    expect(next.tracks[0].gate.steps[16].ratchet).toBe(1)
    expect(next.tracks[0].gate.steps[19].on).toBe(false)
  })

  it('increases pitch length by padding with default PitchStep', () => {
    const state = createSequencer()
    const next = setSubtrackLength(state, 0, 'pitch', 20)
    expect(next.tracks[0].pitch.length).toBe(20)
    expect(next.tracks[0].pitch.steps).toHaveLength(20)
    expect(next.tracks[0].pitch.steps[16].note).toBe(60)
    expect(next.tracks[0].pitch.steps[16].slide).toBe(0)
  })

  it('increases velocity length by padding with 100', () => {
    const state = createSequencer()
    const next = setSubtrackLength(state, 0, 'velocity', 20)
    expect(next.tracks[0].velocity.length).toBe(20)
    expect(next.tracks[0].velocity.steps).toHaveLength(20)
    expect(next.tracks[0].velocity.steps[16]).toBe(100)
  })

  it('decreases length by truncating', () => {
    let state = createSequencer()
    state = setGateOn(state, 0, 5, true)
    const next = setSubtrackLength(state, 0, 'gate', 4)
    expect(next.tracks[0].gate.length).toBe(4)
    expect(next.tracks[0].gate.steps).toHaveLength(4)
    // Step 5 is gone
  })

  it('preserves existing step values on increase', () => {
    let state = createSequencer()
    state = setPitchNote(state, 0, 3, 72)
    const next = setSubtrackLength(state, 0, 'pitch', 32)
    expect(next.tracks[0].pitch.steps[3].note).toBe(72)
  })

  it('clamps to minimum length of 1', () => {
    const state = createSequencer()
    const next = setSubtrackLength(state, 0, 'gate', 0)
    expect(next.tracks[0].gate.length).toBe(1)
    expect(next.tracks[0].gate.steps).toHaveLength(1)
  })

  it('clamps to maximum length of 64', () => {
    const state = createSequencer()
    const next = setSubtrackLength(state, 0, 'gate', 100)
    expect(next.tracks[0].gate.length).toBe(64)
    expect(next.tracks[0].gate.steps).toHaveLength(64)
  })

  it('does not affect other tracks', () => {
    const state = createSequencer()
    const next = setSubtrackLength(state, 0, 'gate', 8)
    expect(next.tracks[1]).toBe(state.tracks[1])
  })

  it('does not affect other subtracks', () => {
    const state = createSequencer()
    const next = setSubtrackLength(state, 0, 'gate', 8)
    expect(next.tracks[0].pitch).toBe(state.tracks[0].pitch)
    expect(next.tracks[0].velocity).toBe(state.tracks[0].velocity)
  })

  it('does not mutate original state', () => {
    const state = createSequencer()
    setSubtrackLength(state, 0, 'gate', 8)
    expect(state.tracks[0].gate.length).toBe(16)
  })
})

describe('setSubtrackClockDivider', () => {
  it('sets clock divider on a subtrack', () => {
    const state = createSequencer()
    const next = setSubtrackClockDivider(state, 0, 'gate', 4)
    expect(next.tracks[0].gate.clockDivider).toBe(4)
  })

  it('clamps to minimum of 1', () => {
    const state = createSequencer()
    const next = setSubtrackClockDivider(state, 0, 'pitch', 0)
    expect(next.tracks[0].pitch.clockDivider).toBe(1)
  })

  it('clamps to maximum of 32', () => {
    const state = createSequencer()
    const next = setSubtrackClockDivider(state, 0, 'velocity', 100)
    expect(next.tracks[0].velocity.clockDivider).toBe(32)
  })

  it('does not affect other tracks', () => {
    const state = createSequencer()
    const next = setSubtrackClockDivider(state, 0, 'gate', 4)
    expect(next.tracks[1]).toBe(state.tracks[1])
  })

  it('does not affect other subtracks', () => {
    const state = createSequencer()
    const next = setSubtrackClockDivider(state, 0, 'gate', 4)
    expect(next.tracks[0].pitch).toBe(state.tracks[0].pitch)
  })

  it('does not mutate original state', () => {
    const state = createSequencer()
    setSubtrackClockDivider(state, 0, 'gate', 4)
    expect(state.tracks[0].gate.clockDivider).toBe(1)
  })
})

describe('setTrackClockDivider', () => {
  it('sets track-level clock divider', () => {
    const state = createSequencer()
    const next = setTrackClockDivider(state, 0, 3)
    expect(next.tracks[0].clockDivider).toBe(3)
  })

  it('clamps to minimum of 1', () => {
    const state = createSequencer()
    const next = setTrackClockDivider(state, 0, 0)
    expect(next.tracks[0].clockDivider).toBe(1)
  })

  it('clamps to maximum of 32', () => {
    const state = createSequencer()
    const next = setTrackClockDivider(state, 0, 99)
    expect(next.tracks[0].clockDivider).toBe(32)
  })

  it('does not affect other tracks', () => {
    const state = createSequencer()
    const next = setTrackClockDivider(state, 1, 4)
    expect(next.tracks[0]).toBe(state.tracks[0])
    expect(next.tracks[2]).toBe(state.tracks[2])
  })

  it('does not mutate original state', () => {
    const state = createSequencer()
    setTrackClockDivider(state, 0, 4)
    expect(state.tracks[0].clockDivider).toBe(1)
  })
})

describe('setMuteLength', () => {
  it('sets mute pattern length with step resize', () => {
    const state = createSequencer()
    const next = setMuteLength(state, 0, 8)
    expect(next.mutePatterns[0].length).toBe(8)
    expect(next.mutePatterns[0].steps).toHaveLength(8)
  })

  it('pads new steps with false (unmuted)', () => {
    const state = createSequencer()
    const next = setMuteLength(state, 0, 20)
    expect(next.mutePatterns[0].steps[16]).toBe(false)
  })

  it('clamps to 1-64', () => {
    const state = createSequencer()
    expect(setMuteLength(state, 0, 0).mutePatterns[0].length).toBe(1)
    expect(setMuteLength(state, 0, 100).mutePatterns[0].length).toBe(64)
  })

  it('does not affect other mute patterns', () => {
    const state = createSequencer()
    const next = setMuteLength(state, 0, 8)
    expect(next.mutePatterns[1]).toBe(state.mutePatterns[1])
  })
})

describe('setMuteClockDivider', () => {
  it('sets mute clock divider', () => {
    const state = createSequencer()
    const next = setMuteClockDivider(state, 0, 4)
    expect(next.mutePatterns[0].clockDivider).toBe(4)
  })

  it('clamps to 1-32', () => {
    const state = createSequencer()
    expect(setMuteClockDivider(state, 0, 0).mutePatterns[0].clockDivider).toBe(1)
    expect(setMuteClockDivider(state, 0, 99).mutePatterns[0].clockDivider).toBe(32)
  })
})

describe('resetTrackPlayheads', () => {
  it('resets all subtrack playheads to 0', () => {
    let state = createSequencer()
    // Advance a few ticks so playheads move
    for (let i = 0; i < 5; i++) state = tick(state).state
    expect(state.tracks[0].gate.currentStep).toBeGreaterThan(0)

    const next = resetTrackPlayheads(state, 0)
    expect(next.tracks[0].gate.currentStep).toBe(0)
    expect(next.tracks[0].pitch.currentStep).toBe(0)
    expect(next.tracks[0].velocity.currentStep).toBe(0)
    expect(next.tracks[0].mod.currentStep).toBe(0)
  })

  it('does not affect other tracks', () => {
    let state = createSequencer()
    for (let i = 0; i < 5; i++) state = tick(state).state
    const next = resetTrackPlayheads(state, 0)
    expect(next.tracks[1].gate.currentStep).toBe(state.tracks[1].gate.currentStep)
  })
})

describe('resetSubtrackPlayhead', () => {
  it('resets only the specified subtrack playhead', () => {
    let state = createSequencer()
    for (let i = 0; i < 5; i++) state = tick(state).state
    const next = resetSubtrackPlayhead(state, 0, 'gate')
    expect(next.tracks[0].gate.currentStep).toBe(0)
    expect(next.tracks[0].pitch.currentStep).toBe(state.tracks[0].pitch.currentStep)
  })
})

describe('saveUserPreset', () => {
  it('appends a new user preset', () => {
    const state = createSequencer()
    const config = state.randomConfigs[0]
    const next = saveUserPreset(state, 'MY BASS', config)
    expect(next.userPresets).toHaveLength(1)
    expect(next.userPresets[0].name).toBe('MY BASS')
    expect(next.userPresets[0].config).toBe(config)
  })

  it('does not mutate original state', () => {
    const state = createSequencer()
    saveUserPreset(state, 'TEST', state.randomConfigs[0])
    expect(state.userPresets).toHaveLength(0)
  })

  it('appends multiple presets', () => {
    let state = createSequencer()
    state = saveUserPreset(state, 'A', state.randomConfigs[0])
    state = saveUserPreset(state, 'B', state.randomConfigs[1])
    expect(state.userPresets).toHaveLength(2)
    expect(state.userPresets[0].name).toBe('A')
    expect(state.userPresets[1].name).toBe('B')
  })
})

describe('deleteUserPreset', () => {
  it('removes preset by index', () => {
    let state = createSequencer()
    state = saveUserPreset(state, 'A', state.randomConfigs[0])
    state = saveUserPreset(state, 'B', state.randomConfigs[1])
    const next = deleteUserPreset(state, 0)
    expect(next.userPresets).toHaveLength(1)
    expect(next.userPresets[0].name).toBe('B')
  })

  it('returns same state for out-of-bounds index', () => {
    const state = createSequencer()
    expect(deleteUserPreset(state, 0)).toBe(state)
    expect(deleteUserPreset(state, -1)).toBe(state)
  })

  it('does not mutate original state', () => {
    let state = createSequencer()
    state = saveUserPreset(state, 'A', state.randomConfigs[0])
    deleteUserPreset(state, 0)
    expect(state.userPresets).toHaveLength(1)
  })
})

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
    expect(result.state.tracks[0].mod.currentStep).toBe(1)
  })
})

describe('setOutputSource', () => {
  it('changes a single param source on one output', () => {
    const state = createSequencer()
    const result = setOutputSource(state, 0, 'pitch', 2)
    expect(result.routing[0].pitch).toBe(2)
    expect(result.routing[0].gate).toBe(0)
    expect(result.routing[0].velocity).toBe(0)
    expect(result.routing[0].mod).toBe(0)
    expect(result.routing[1]).toEqual(state.routing[1])
  })

  it('clamps source track to 0-3', () => {
    const state = createSequencer()
    const result = setOutputSource(state, 0, 'gate', 5)
    expect(result.routing[0].gate).toBe(3)
  })
})
