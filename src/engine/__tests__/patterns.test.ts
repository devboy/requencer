import { describe, expect, it } from 'vitest'
import {
  createDefaultLayerFlags,
  deletePattern,
  loadPattern,
  restoreTrackSlot,
  savePattern,
  snapshotAllTracks,
  snapshotSingleTrack,
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

describe('snapshotAllTracks', () => {
  it('fills all 4 slots', () => {
    const state = seededState()
    const pattern = snapshotAllTracks(state, 'ALL4')

    expect(pattern.name).toBe('ALL4')
    expect(pattern.slots[0]).not.toBeNull()
    expect(pattern.slots[1]).not.toBeNull()
    expect(pattern.slots[2]).not.toBeNull()
    expect(pattern.slots[3]).not.toBeNull()
  })
})

describe('snapshotSingleTrack', () => {
  it('fills only the target slot, others null', () => {
    const state = seededState()
    const pattern = snapshotSingleTrack(state, 2, 'T3ONLY')

    expect(pattern.name).toBe('T3ONLY')
    expect(pattern.slots[0]).toBeNull()
    expect(pattern.slots[1]).toBeNull()
    expect(pattern.slots[2]).not.toBeNull()
    expect(pattern.slots[3]).toBeNull()
    expect(pattern.slots[2]?.track.gate.steps).toEqual(state.tracks[2].gate.steps)
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
    expect(result.tracks[2].clockDivider).toEqual(slot.track.clockDivider)
    expect(result.transposeConfigs[2]).toEqual(slot.transposeConfig)
    expect(result.mutateConfigs[2]).toEqual(slot.mutateConfig)
    expect(result.lfoConfigs[2]).toEqual(slot.lfoConfig)
    expect(result.randomConfigs[2]).toEqual(slot.randomConfig)
    expect(result.arpConfigs[2]).toEqual(slot.arpConfig)
  })

  it('only touches subtracks when only subtracks flag is true', () => {
    const state = seededState()
    const slot = snapshotTrackSlot(state, 0)

    const target = seededState()
    const flags: LayerFlags = {
      subtracks: true,
      transpose: false,
      drift: false,
      variation: false,
      lfo: false,
      random: false,
      arp: false,
    }

    const result = restoreTrackSlot(target, 2, slot, flags)

    // Subtracks replaced
    expect(result.tracks[2].gate.steps).toEqual(slot.track.gate.steps)
    expect(result.tracks[2].pitch.steps).toEqual(slot.track.pitch.steps)

    // Other overlays unchanged
    expect(result.transposeConfigs[2]).toEqual(target.transposeConfigs[2])
    expect(result.mutateConfigs[2]).toEqual(target.mutateConfigs[2])
    expect(result.lfoConfigs[2]).toEqual(target.lfoConfigs[2])
    expect(result.randomConfigs[2]).toEqual(target.randomConfigs[2])
    expect(result.arpConfigs[2]).toEqual(target.arpConfigs[2])
    expect(result.variationPatterns[2]).toEqual(target.variationPatterns[2])
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
    const pattern = snapshotAllTracks(state, 'TEST')

    const result = savePattern(state, pattern)
    expect(result.savedPatterns.length).toBe(state.savedPatterns.length + 1)
    expect(result.savedPatterns[result.savedPatterns.length - 1].name).toBe('TEST')
  })
})

describe('deletePattern', () => {
  it('removes by index', () => {
    let state = seededState()
    state = savePattern(state, snapshotAllTracks(state, 'A'))
    state = savePattern(state, snapshotAllTracks(state, 'B'))
    state = savePattern(state, snapshotAllTracks(state, 'C'))

    const result = deletePattern(state, 1)
    expect(result.savedPatterns.length).toBe(2)
    expect(result.savedPatterns[0].name).toBe('A')
    expect(result.savedPatterns[1].name).toBe('C')
  })
})

describe('loadPattern', () => {
  it('applies with identity mapping', () => {
    const state = seededState()
    const pattern = snapshotAllTracks(state, 'FULL')

    const target = createSequencer()
    const mapping: [number, number, number, number] = [0, 1, 2, 3]
    const result = loadPattern(target, pattern, mapping, createDefaultLayerFlags())

    // All 4 tracks should have the snapshotted data
    for (let i = 0; i < 4; i++) {
      expect(result.tracks[i].gate.steps).toEqual(pattern.slots[i]?.track.gate.steps)
      expect(result.transposeConfigs[i]).toEqual(pattern.slots[i]?.transposeConfig)
    }
  })

  it('applies with remapped slots (slot 0 → track 3)', () => {
    const state = seededState()
    const pattern = snapshotAllTracks(state, 'REMAP')

    const target = createSequencer()
    const mapping: [number, number, number, number] = [3, 1, 2, 0]
    const result = loadPattern(target, pattern, mapping, createDefaultLayerFlags())

    // Slot 0 data should be on track 3
    expect(result.tracks[3].gate.steps).toEqual(pattern.slots[0]?.track.gate.steps)
    // Slot 3 data should be on track 0
    expect(result.tracks[0].gate.steps).toEqual(pattern.slots[3]?.track.gate.steps)
  })

  it('skips null slots', () => {
    const state = seededState()
    const pattern = snapshotSingleTrack(state, 1, 'SINGLE')

    const target = seededState()
    const mapping: [number, number, number, number] = [0, 1, 2, 3]
    const result = loadPattern(target, pattern, mapping, createDefaultLayerFlags())

    // Track 0 should be unchanged (slot 0 was null)
    expect(result.tracks[0].gate.steps).toEqual(target.tracks[0].gate.steps)
    // Track 1 should have the snapshotted data
    expect(result.tracks[1].gate.steps).toEqual(pattern.slots[1]?.track.gate.steps)
  })

  it('applies with partial layer flags', () => {
    const state = seededState()
    const pattern = snapshotAllTracks(state, 'PARTIAL')

    const target = seededState()
    const flags: LayerFlags = {
      subtracks: true,
      transpose: false,
      drift: false,
      variation: false,
      lfo: false,
      random: false,
      arp: false,
    }
    const mapping: [number, number, number, number] = [0, 1, 2, 3]
    const result = loadPattern(target, pattern, mapping, flags)

    // Subtracks replaced
    expect(result.tracks[0].gate.steps).toEqual(pattern.slots[0]?.track.gate.steps)
    // But transpose should be unchanged
    expect(result.transposeConfigs[0]).toEqual(target.transposeConfigs[0])
  })
})
