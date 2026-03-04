import { describe, expect, it } from 'vitest'
import {
  createDefaultLayerFlags,
  createSavedPattern,
  deletePattern,
  restoreTrackSlot,
  savePattern,
  snapshotTrackSlot,
} from '../patterns'
import { createSequencer, randomizeTrackPattern } from '../sequencer'
import type { LayerFlags, VariationPattern } from '../types'

function seededState() {
  let state = createSequencer()
  // Randomize all tracks so they have non-default data
  for (let i = 0; i < 4; i++) {
    state = randomizeTrackPattern(state, i, 1000 + i)
  }
  // Set some runtime state that should be zeroed on snapshot
  state = {
    ...state,
    tracks: state.tracks.map((t, i) => ({
      ...t,
      gate: { ...t.gate, currentStep: 5 + i },
      pitch: { ...t.pitch, currentStep: 3 + i },
      velocity: { ...t.velocity, currentStep: 7 + i },
      mod: { ...t.mod, currentStep: 2 + i },
    })),
    variationPatterns: state.variationPatterns.map((vp, i) => ({
      ...vp,
      enabled: true,
      currentBar: 3 + i,
    })),
    transposeConfigs: state.transposeConfigs.map((tc, i) => ({
      ...tc,
      semitones: i * 2,
    })),
    mutateConfigs: state.mutateConfigs.map((mc) => ({
      ...mc,
      gate: 0.1,
      pitch: 0.2,
    })),
  }
  return state
}

describe('snapshotTrackSlot', () => {
  it('zeroes currentStep on all subtracks and currentBar on variations', () => {
    const state = seededState()
    const slot = snapshotTrackSlot(state, 0)

    expect(slot.track.gate.currentStep).toBe(0)
    expect(slot.track.pitch.currentStep).toBe(0)
    expect(slot.track.velocity.currentStep).toBe(0)
    expect(slot.track.mod.currentStep).toBe(0)
    expect(slot.variationPattern.currentBar).toBe(0)
  })

  it('zeroes currentBar in nested subtrackOverrides', () => {
    let state = seededState()
    // Add a nested variation override with its own currentBar
    const nestedVP: VariationPattern = {
      enabled: true,
      length: 4,
      loopMode: false,
      slots: [{ transforms: [] }, { transforms: [] }, { transforms: [] }, { transforms: [] }],
      currentBar: 7,
      subtrackOverrides: { gate: null, pitch: null, velocity: null, mod: null },
    }
    state = {
      ...state,
      variationPatterns: state.variationPatterns.map((vp, i) =>
        i === 0 ? { ...vp, subtrackOverrides: { ...vp.subtrackOverrides, gate: nestedVP } } : vp,
      ),
    }

    const slot = snapshotTrackSlot(state, 0)
    const gateOverride = slot.variationPattern.subtrackOverrides.gate as VariationPattern
    expect(gateOverride.currentBar).toBe(0)
  })

  it('preserves all step data and overlay configs', () => {
    const state = seededState()
    const slot = snapshotTrackSlot(state, 1)

    // Step data preserved
    expect(slot.track.gate.steps).toEqual(state.tracks[1].gate.steps)
    expect(slot.track.pitch.steps).toEqual(state.tracks[1].pitch.steps)
    expect(slot.track.velocity.steps).toEqual(state.tracks[1].velocity.steps)
    expect(slot.track.mod.steps).toEqual(state.tracks[1].mod.steps)

    // Overlay configs preserved
    expect(slot.transposeConfig).toEqual(state.transposeConfigs[1])
    expect(slot.mutateConfig).toEqual(state.mutateConfigs[1])
    expect(slot.lfoConfig).toEqual(state.lfoConfigs[1])
    expect(slot.randomConfig).toEqual(state.randomConfigs[1])
    expect(slot.arpConfig).toEqual(state.arpConfigs[1])
  })
})

describe('createSavedPattern', () => {
  it('wraps snapshot with name and sourceTrack', () => {
    const state = seededState()
    const pattern = createSavedPattern(state, 2, 'T3PAT')

    expect(pattern.name).toBe('T3PAT')
    expect(pattern.sourceTrack).toBe(2)
    expect(pattern.data.track.gate.steps).toEqual(state.tracks[2].gate.steps)
    expect(pattern.data.track.gate.currentStep).toBe(0)
  })
})

describe('restoreTrackSlot', () => {
  it('restores everything with all layers true', () => {
    const state = seededState()
    const slot = snapshotTrackSlot(state, 0)

    // Apply slot 0 data to track 2
    const target = createSequencer()
    const result = restoreTrackSlot(target, 2, slot, createDefaultLayerFlags())

    expect(result.tracks[2].gate.steps).toEqual(slot.track.gate.steps)
    expect(result.tracks[2].pitch.steps).toEqual(slot.track.pitch.steps)
    expect(result.transposeConfigs[2]).toEqual(slot.transposeConfig)
    expect(result.mutateConfigs[2]).toEqual(slot.mutateConfig)
    expect(result.lfoConfigs[2]).toEqual(slot.lfoConfig)
    expect(result.randomConfigs[2]).toEqual(slot.randomConfig)
    expect(result.arpConfigs[2]).toEqual(slot.arpConfig)
  })

  it('restores only gate subtrack when only gate flag is true', () => {
    const state = seededState()
    const slot = snapshotTrackSlot(state, 0)

    const target = seededState()
    const flags: LayerFlags = {
      gate: true,
      pitch: false,
      velocity: false,
      mod: false,
      transpose: false,
      drift: false,
      variation: false,
    }

    const result = restoreTrackSlot(target, 2, slot, flags)

    // Gate replaced
    expect(result.tracks[2].gate.steps).toEqual(slot.track.gate.steps)
    // Other subtracks unchanged
    expect(result.tracks[2].pitch.steps).toEqual(target.tracks[2].pitch.steps)
    expect(result.tracks[2].velocity.steps).toEqual(target.tracks[2].velocity.steps)
    expect(result.tracks[2].mod.steps).toEqual(target.tracks[2].mod.steps)

    // Overlay configs unchanged (except always-restored ones)
    expect(result.transposeConfigs[2]).toEqual(target.transposeConfigs[2])
    expect(result.mutateConfigs[2]).toEqual(target.mutateConfigs[2])
    expect(result.variationPatterns[2]).toEqual(target.variationPatterns[2])
  })

  it('restores only pitch subtrack independently', () => {
    const state = seededState()
    const slot = snapshotTrackSlot(state, 0)

    const target = seededState()
    const flags: LayerFlags = {
      gate: false,
      pitch: true,
      velocity: false,
      mod: false,
      transpose: false,
      drift: false,
      variation: false,
    }

    const result = restoreTrackSlot(target, 1, slot, flags)

    // Pitch replaced
    expect(result.tracks[1].pitch.steps).toEqual(slot.track.pitch.steps)
    // Gate unchanged
    expect(result.tracks[1].gate.steps).toEqual(target.tracks[1].gate.steps)
  })

  it('always restores lfo, random, arp configs regardless of flags', () => {
    const state = seededState()
    const slot = snapshotTrackSlot(state, 0)

    const target = seededState()
    const flags: LayerFlags = {
      gate: false,
      pitch: false,
      velocity: false,
      mod: false,
      transpose: false,
      drift: false,
      variation: false,
    }

    const result = restoreTrackSlot(target, 2, slot, flags)

    // Always restored
    expect(result.lfoConfigs[2]).toEqual(slot.lfoConfig)
    expect(result.randomConfigs[2]).toEqual(slot.randomConfig)
    expect(result.arpConfigs[2]).toEqual(slot.arpConfig)

    // Not restored (flags off)
    expect(result.transposeConfigs[2]).toEqual(target.transposeConfigs[2])
    expect(result.mutateConfigs[2]).toEqual(target.mutateConfigs[2])
  })

  it('preserves target currentStep (playback state)', () => {
    const state = seededState()
    const slot = snapshotTrackSlot(state, 0)

    let target = createSequencer()
    target = {
      ...target,
      tracks: target.tracks.map((t) => ({
        ...t,
        gate: { ...t.gate, currentStep: 12 },
        pitch: { ...t.pitch, currentStep: 8 },
        velocity: { ...t.velocity, currentStep: 4 },
        mod: { ...t.mod, currentStep: 6 },
      })),
    }

    const result = restoreTrackSlot(target, 1, slot, createDefaultLayerFlags())

    expect(result.tracks[1].gate.currentStep).toBe(12)
    expect(result.tracks[1].pitch.currentStep).toBe(8)
    expect(result.tracks[1].velocity.currentStep).toBe(4)
    expect(result.tracks[1].mod.currentStep).toBe(6)
  })
})

describe('savePattern', () => {
  it('appends to savedPatterns array', () => {
    const state = seededState()
    const pattern = createSavedPattern(state, 0, 'TEST')

    const result = savePattern(state, pattern)
    expect(result.savedPatterns.length).toBe(state.savedPatterns.length + 1)
    expect(result.savedPatterns[result.savedPatterns.length - 1].name).toBe('TEST')
  })
})

describe('deletePattern', () => {
  it('removes by index', () => {
    let state = seededState()
    state = savePattern(state, createSavedPattern(state, 0, 'A'))
    state = savePattern(state, createSavedPattern(state, 1, 'B'))
    state = savePattern(state, createSavedPattern(state, 2, 'C'))

    const result = deletePattern(state, 1)
    expect(result.savedPatterns.length).toBe(2)
    expect(result.savedPatterns[0].name).toBe('A')
    expect(result.savedPatterns[1].name).toBe('C')
  })
})
