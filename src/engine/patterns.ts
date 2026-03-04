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

export function snapshotAllTracks(state: SequencerState, name: string): SavedPattern {
  return {
    name,
    slots: [
      snapshotTrackSlot(state, 0),
      snapshotTrackSlot(state, 1),
      snapshotTrackSlot(state, 2),
      snapshotTrackSlot(state, 3),
    ],
  }
}

export function snapshotSingleTrack(state: SequencerState, trackIndex: number, name: string): SavedPattern {
  const slots: SavedPattern['slots'] = [null, null, null, null]
  slots[trackIndex] = snapshotTrackSlot(state, trackIndex)
  return { name, slots }
}

export function restoreTrackSlot(
  state: SequencerState,
  targetTrack: number,
  slot: TrackSlotData,
  layers: LayerFlags,
): SequencerState {
  let result = state

  if (layers.subtracks) {
    const existing = result.tracks[targetTrack]
    result = {
      ...result,
      tracks: result.tracks.map((t, i) => {
        if (i !== targetTrack) return t
        return {
          ...slot.track,
          // Preserve runtime playback position
          gate: { ...slot.track.gate, currentStep: existing.gate.currentStep },
          pitch: { ...slot.track.pitch, currentStep: existing.pitch.currentStep },
          velocity: { ...slot.track.velocity, currentStep: existing.velocity.currentStep },
          mod: { ...slot.track.mod, currentStep: existing.mod.currentStep },
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

  if (layers.lfo) {
    result = {
      ...result,
      lfoConfigs: result.lfoConfigs.map((lc, i) => (i === targetTrack ? structuredClone(slot.lfoConfig) : lc)),
    }
  }

  if (layers.random) {
    result = {
      ...result,
      randomConfigs: result.randomConfigs.map((rc, i) => (i === targetTrack ? structuredClone(slot.randomConfig) : rc)),
    }
  }

  if (layers.arp) {
    result = {
      ...result,
      arpConfigs: result.arpConfigs.map((ac, i) => (i === targetTrack ? structuredClone(slot.arpConfig) : ac)),
    }
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

export function loadPattern(
  state: SequencerState,
  pattern: SavedPattern,
  slotMapping: [number, number, number, number],
  layers: LayerFlags,
): SequencerState {
  let result = state
  for (let slotIdx = 0; slotIdx < 4; slotIdx++) {
    const slot = pattern.slots[slotIdx]
    if (slot === null) continue
    const targetTrack = slotMapping[slotIdx]
    result = restoreTrackSlot(result, targetTrack, slot, layers)
  }
  return result
}

export function createDefaultLayerFlags(): LayerFlags {
  return {
    subtracks: true,
    transpose: true,
    drift: true,
    variation: true,
    lfo: true,
    random: true,
    arp: true,
  }
}
