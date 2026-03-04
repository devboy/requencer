import type { LayerFlags, SavedPattern, SequencerState, TrackSlotData, VariationPattern } from './types'

function zeroVariationBar(vp: VariationPattern): VariationPattern {
  const overrides = { ...vp.subtrackOverrides }
  for (const key of ['gate', 'pitch', 'velocity', 'mod'] as const) {
    const val = overrides[key]
    if (val !== null && val !== 'bypass') {
      overrides[key] = zeroVariationBar(val)
    }
  }
  return { ...vp, currentBar: 0, subtrackOverrides: overrides }
}

export function snapshotTrackSlot(state: SequencerState, trackIndex: number): TrackSlotData {
  const track = state.tracks[trackIndex]
  return {
    track: {
      ...track,
      gate: { ...track.gate, currentStep: 0 },
      pitch: { ...track.pitch, currentStep: 0 },
      velocity: { ...track.velocity, currentStep: 0 },
      mod: { ...track.mod, currentStep: 0 },
    },
    transposeConfig: structuredClone(state.transposeConfigs[trackIndex]),
    mutateConfig: structuredClone(state.mutateConfigs[trackIndex]),
    variationPattern: zeroVariationBar(structuredClone(state.variationPatterns[trackIndex])),
    lfoConfig: structuredClone(state.lfoConfigs[trackIndex]),
    randomConfig: structuredClone(state.randomConfigs[trackIndex]),
    arpConfig: structuredClone(state.arpConfigs[trackIndex]),
  }
}

export function createSavedPattern(state: SequencerState, trackIndex: number, name: string): SavedPattern {
  return {
    name,
    data: snapshotTrackSlot(state, trackIndex),
    sourceTrack: trackIndex,
  }
}

export function restoreTrackSlot(
  state: SequencerState,
  targetTrack: number,
  slot: TrackSlotData,
  layers: LayerFlags,
): SequencerState {
  let result = state
  const existing = result.tracks[targetTrack]

  // Per-subtrack restore: only replace the subtracks whose flags are on
  const anySubtrack = layers.gate || layers.pitch || layers.velocity || layers.mod
  if (anySubtrack) {
    result = {
      ...result,
      tracks: result.tracks.map((t, i) => {
        if (i !== targetTrack) return t
        return {
          ...t,
          gate: layers.gate
            ? { ...slot.track.gate, currentStep: existing.gate.currentStep }
            : t.gate,
          pitch: layers.pitch
            ? { ...slot.track.pitch, currentStep: existing.pitch.currentStep }
            : t.pitch,
          velocity: layers.velocity
            ? { ...slot.track.velocity, currentStep: existing.velocity.currentStep }
            : t.velocity,
          mod: layers.mod
            ? { ...slot.track.mod, currentStep: existing.mod.currentStep }
            : t.mod,
        }
      }),
    }
  }

  if (layers.transpose) {
    result = {
      ...result,
      transposeConfigs: result.transposeConfigs.map((tc, i) =>
        i === targetTrack ? structuredClone(slot.transposeConfig) : tc,
      ),
    }
  }

  if (layers.drift) {
    result = {
      ...result,
      mutateConfigs: result.mutateConfigs.map((mc, i) => (i === targetTrack ? structuredClone(slot.mutateConfig) : mc)),
    }
  }

  if (layers.variation) {
    result = {
      ...result,
      variationPatterns: result.variationPatterns.map((vp, i) =>
        i === targetTrack ? structuredClone(slot.variationPattern) : vp,
      ),
    }
  }

  // Always restore: lfo, random, arp configs
  result = {
    ...result,
    lfoConfigs: result.lfoConfigs.map((lc, i) => (i === targetTrack ? structuredClone(slot.lfoConfig) : lc)),
    randomConfigs: result.randomConfigs.map((rc, i) => (i === targetTrack ? structuredClone(slot.randomConfig) : rc)),
    arpConfigs: result.arpConfigs.map((ac, i) => (i === targetTrack ? structuredClone(slot.arpConfig) : ac)),
  }

  return result
}

export function savePattern(state: SequencerState, pattern: SavedPattern): SequencerState {
  return { ...state, savedPatterns: [...state.savedPatterns, pattern] }
}

export function deletePattern(state: SequencerState, index: number): SequencerState {
  if (index < 0 || index >= state.savedPatterns.length) return state
  return { ...state, savedPatterns: state.savedPatterns.filter((_, i) => i !== index) }
}

export function createDefaultLayerFlags(): LayerFlags {
  return {
    gate: true,
    pitch: true,
    velocity: true,
    mod: true,
    transpose: true,
    drift: true,
    variation: true,
  }
}
