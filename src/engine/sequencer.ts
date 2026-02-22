import type { SequencerState, SequenceTrack, RandomConfig, MuteTrack, NoteEvent, Subtrack } from './types'
import { SCALES } from './scales'
import { getEffectiveStep } from './clock-divider'
import { resolveOutputs, createDefaultRouting } from './routing'
import { randomizeTrack, randomizeGates, randomizePitch, randomizeVelocity } from './randomizer'

const NUM_TRACKS = 4
const DEFAULT_LENGTH = 16
const DEFAULT_BPM = 135
const MIN_LENGTH = 1
const MAX_LENGTH = 64
const MIN_DIVIDER = 1
const MAX_DIVIDER = 32

const SUBTRACK_DEFAULTS: Record<'gate' | 'pitch' | 'velocity' | 'mod', boolean | number> = {
  gate: false,
  pitch: 60,
  velocity: 100,
  mod: 0,
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function createSubtrack<T>(defaultValue: T, length: number = DEFAULT_LENGTH): Subtrack<T> {
  return {
    steps: Array(length).fill(defaultValue),
    length,
    clockDivider: 1,
    currentStep: 0,
  }
}

function createTrack(index: number): SequenceTrack {
  const gate = createSubtrack(false)       // all gates off — empty pattern
  const pitch = createSubtrack(60)          // all pitches at C4
  const velocity = createSubtrack(0)        // all velocities at 0
  const mod = createSubtrack(0)             // all mod values at 0

  return {
    id: String(index),
    name: `Track ${index + 1}`,
    clockDivider: 1,
    gate,
    pitch,
    velocity,
    mod,
  }
}

function createDefaultRandomConfig(index: number): RandomConfig {
  return {
    pitch: {
      low: 48,
      high: 72,
      scale: SCALES.minorPentatonic,
      root: 60,
      maxNotes: 4,
    },
    gate: {
      fillMin: 0.25,
      fillMax: 0.75,
      mode: 'euclidean',
      randomOffset: true,
    },
    velocity: {
      low: 64,
      high: 120,
    },
  }
}

function createDefaultMute(): MuteTrack {
  return {
    steps: Array(DEFAULT_LENGTH).fill(false),
    length: DEFAULT_LENGTH,
    clockDivider: 1,
    currentStep: 0,
  }
}

/**
 * Create a new sequencer with default state.
 */
export function createSequencer(): SequencerState {
  return {
    tracks: Array.from({ length: NUM_TRACKS }, (_, i) => createTrack(i)),
    routing: createDefaultRouting(),
    mutePatterns: Array.from({ length: NUM_TRACKS }, () => createDefaultMute()),
    transport: {
      bpm: DEFAULT_BPM,
      playing: false,
      masterTick: 0,
    },
    randomConfigs: Array.from({ length: NUM_TRACKS }, (_, i) => createDefaultRandomConfig(i)),
    userPresets: [],
  }
}

/**
 * Advance the sequencer by one tick. Returns new state and output events.
 * Pure function — does not mutate input state.
 */
export function tick(state: SequencerState): { state: SequencerState; events: NoteEvent[] } {
  const masterTick = state.transport.masterTick
  const nextTick = masterTick + 1

  // Compute current steps (at masterTick) for event resolution
  const currentTracks = state.tracks.map(track => {
    const trackDiv = track.clockDivider
    return {
      ...track,
      gate: updateSubtrackStep(track.gate, masterTick, trackDiv),
      pitch: updateSubtrackStep(track.pitch, masterTick, trackDiv),
      velocity: updateSubtrackStep(track.velocity, masterTick, trackDiv),
      mod: updateSubtrackStep(track.mod, masterTick, trackDiv),
    }
  })

  const currentMutes = state.mutePatterns.map(mute => ({
    ...mute,
    currentStep: getEffectiveStep(masterTick, 1, mute.clockDivider, mute.length),
  }))

  // Resolve routing to produce output events at the current tick
  const events = resolveOutputs(currentTracks, state.routing, currentMutes)

  // Advance steps to the next tick for the returned state
  const nextTracks = state.tracks.map(track => {
    const trackDiv = track.clockDivider
    return {
      ...track,
      gate: updateSubtrackStep(track.gate, nextTick, trackDiv),
      pitch: updateSubtrackStep(track.pitch, nextTick, trackDiv),
      velocity: updateSubtrackStep(track.velocity, nextTick, trackDiv),
      mod: updateSubtrackStep(track.mod, nextTick, trackDiv),
    }
  })

  const nextMutes = state.mutePatterns.map(mute => ({
    ...mute,
    currentStep: getEffectiveStep(nextTick, 1, mute.clockDivider, mute.length),
  }))

  return {
    state: {
      ...state,
      tracks: nextTracks,
      mutePatterns: nextMutes,
      transport: {
        ...state.transport,
        masterTick: nextTick,
      },
    },
    events,
  }
}

function updateSubtrackStep<T>(subtrack: Subtrack<T>, masterTick: number, trackDivider: number): Subtrack<T> {
  return {
    ...subtrack,
    currentStep: getEffectiveStep(masterTick, trackDivider, subtrack.clockDivider, subtrack.length),
  }
}

/**
 * Set a step value in a subtrack. Returns new state.
 */
export function setStep<T extends boolean | number>(
  state: SequencerState,
  trackIndex: number,
  subtrack: 'gate' | 'pitch' | 'velocity' | 'mod',
  stepIndex: number,
  value: T,
): SequencerState {
  return {
    ...state,
    tracks: state.tracks.map((track, i) => {
      if (i !== trackIndex) return track
      const sub = track[subtrack]
      return {
        ...track,
        [subtrack]: {
          ...sub,
          steps: sub.steps.map((s: boolean | number, j: number) => (j === stepIndex ? value : s)),
        },
      }
    }),
  }
}

/**
 * Replace the routing connections. Returns new state.
 */
export function setRouting(state: SequencerState, routing: SequencerState['routing']): SequencerState {
  return { ...state, routing }
}

/**
 * Change the source track for a single param on one output. Returns new state.
 */
export function setOutputSource(
  state: SequencerState,
  outputIndex: number,
  param: 'gate' | 'pitch' | 'velocity' | 'mod',
  sourceTrack: number,
): SequencerState {
  const clamped = clamp(sourceTrack, 0, NUM_TRACKS - 1)
  return {
    ...state,
    routing: state.routing.map((r, i) => {
      if (i !== outputIndex) return r
      return { ...r, [param]: clamped }
    }),
  }
}

/**
 * Set a mute pattern for a track. Returns new state.
 */
export function setMutePattern(state: SequencerState, trackIndex: number, mute: MuteTrack): SequencerState {
  return {
    ...state,
    mutePatterns: state.mutePatterns.map((m, i) => (i === trackIndex ? mute : m)),
  }
}

/**
 * Randomize a track's subtrack patterns using its random config. Returns new state.
 */
export function randomizeTrackPattern(state: SequencerState, trackIndex: number, seed?: number): SequencerState {
  const track = state.tracks[trackIndex]
  const config = state.randomConfigs[trackIndex]

  const generated = randomizeTrack(config, {
    gate: track.gate.length,
    pitch: track.pitch.length,
    velocity: track.velocity.length,
  }, seed)

  return {
    ...state,
    tracks: state.tracks.map((t, i) => {
      if (i !== trackIndex) return t
      return {
        ...t,
        gate: { ...t.gate, steps: generated.gate },
        pitch: { ...t.pitch, steps: generated.pitch },
        velocity: { ...t.velocity, steps: generated.velocity },
      }
    }),
  }
}

/**
 * Randomize only the gate subtrack of a track. Returns new state.
 */
export function randomizeGatePattern(state: SequencerState, trackIndex: number, seed?: number): SequencerState {
  const track = state.tracks[trackIndex]
  const config = state.randomConfigs[trackIndex]
  const newGates = randomizeGates(config.gate, track.gate.length, seed)

  return {
    ...state,
    tracks: state.tracks.map((t, i) => {
      if (i !== trackIndex) return t
      return { ...t, gate: { ...t.gate, steps: newGates } }
    }),
  }
}

/**
 * Randomize only the pitch subtrack of a track. Returns new state.
 */
export function randomizePitchPattern(state: SequencerState, trackIndex: number, seed?: number): SequencerState {
  const track = state.tracks[trackIndex]
  const config = state.randomConfigs[trackIndex]
  const newPitch = randomizePitch(config.pitch, track.pitch.length, seed)

  return {
    ...state,
    tracks: state.tracks.map((t, i) => {
      if (i !== trackIndex) return t
      return { ...t, pitch: { ...t.pitch, steps: newPitch } }
    }),
  }
}

/**
 * Randomize only the velocity subtrack of a track. Returns new state.
 */
export function randomizeVelocityPattern(state: SequencerState, trackIndex: number, seed?: number): SequencerState {
  const track = state.tracks[trackIndex]
  const config = state.randomConfigs[trackIndex]
  const newVel = randomizeVelocity(config.velocity, track.velocity.length, seed)

  return {
    ...state,
    tracks: state.tracks.map((t, i) => {
      if (i !== trackIndex) return t
      return { ...t, velocity: { ...t.velocity, steps: newVel } }
    }),
  }
}

function resizeSteps<T>(steps: T[], newLength: number, defaultValue: T): T[] {
  if (newLength <= steps.length) return steps.slice(0, newLength)
  return [...steps, ...Array(newLength - steps.length).fill(defaultValue)]
}

/**
 * Set the length of a subtrack. Truncates or pads steps as needed. Returns new state.
 */
export function setSubtrackLength(
  state: SequencerState,
  trackIndex: number,
  subtrack: 'gate' | 'pitch' | 'velocity' | 'mod',
  newLength: number,
): SequencerState {
  const length = clamp(newLength, MIN_LENGTH, MAX_LENGTH)
  return {
    ...state,
    tracks: state.tracks.map((track, i) => {
      if (i !== trackIndex) return track
      const sub = track[subtrack]
      return {
        ...track,
        [subtrack]: {
          ...sub,
          length,
          steps: resizeSteps(sub.steps, length, SUBTRACK_DEFAULTS[subtrack]),
        },
      }
    }),
  }
}

/**
 * Set the clock divider of a subtrack. Returns new state.
 */
export function setSubtrackClockDivider(
  state: SequencerState,
  trackIndex: number,
  subtrack: 'gate' | 'pitch' | 'velocity' | 'mod',
  divider: number,
): SequencerState {
  const clockDivider = clamp(divider, MIN_DIVIDER, MAX_DIVIDER)
  return {
    ...state,
    tracks: state.tracks.map((track, i) => {
      if (i !== trackIndex) return track
      return {
        ...track,
        [subtrack]: { ...track[subtrack], clockDivider },
      }
    }),
  }
}

/**
 * Set the track-level clock divider. Returns new state.
 */
export function setTrackClockDivider(
  state: SequencerState,
  trackIndex: number,
  divider: number,
): SequencerState {
  const clockDivider = clamp(divider, MIN_DIVIDER, MAX_DIVIDER)
  return {
    ...state,
    tracks: state.tracks.map((track, i) => {
      if (i !== trackIndex) return track
      return { ...track, clockDivider }
    }),
  }
}

/**
 * Set the mute pattern length. Truncates or pads steps. Returns new state.
 */
export function setMuteLength(state: SequencerState, trackIndex: number, newLength: number): SequencerState {
  const length = clamp(newLength, MIN_LENGTH, MAX_LENGTH)
  return {
    ...state,
    mutePatterns: state.mutePatterns.map((mute, i) => {
      if (i !== trackIndex) return mute
      return { ...mute, length, steps: resizeSteps(mute.steps, length, false) }
    }),
  }
}

/**
 * Set the mute pattern clock divider. Returns new state.
 */
export function setMuteClockDivider(state: SequencerState, trackIndex: number, divider: number): SequencerState {
  const clockDivider = clamp(divider, MIN_DIVIDER, MAX_DIVIDER)
  return {
    ...state,
    mutePatterns: state.mutePatterns.map((mute, i) => {
      if (i !== trackIndex) return mute
      return { ...mute, clockDivider }
    }),
  }
}

/**
 * Reset all subtrack playheads of a track to 0. Returns new state.
 */
export function resetTrackPlayheads(state: SequencerState, trackIndex: number): SequencerState {
  return {
    ...state,
    tracks: state.tracks.map((track, i) => {
      if (i !== trackIndex) return track
      return {
        ...track,
        gate: { ...track.gate, currentStep: 0 },
        pitch: { ...track.pitch, currentStep: 0 },
        velocity: { ...track.velocity, currentStep: 0 },
        mod: { ...track.mod, currentStep: 0 },
      }
    }),
  }
}

/**
 * Reset a single subtrack's playhead to 0. Returns new state.
 */
export function resetSubtrackPlayhead(
  state: SequencerState,
  trackIndex: number,
  subtrack: 'gate' | 'pitch' | 'velocity' | 'mod',
): SequencerState {
  return {
    ...state,
    tracks: state.tracks.map((track, i) => {
      if (i !== trackIndex) return track
      return {
        ...track,
        [subtrack]: { ...track[subtrack], currentStep: 0 },
      }
    }),
  }
}

/**
 * Save a user preset. Returns new state with preset appended.
 */
export function saveUserPreset(
  state: SequencerState,
  name: string,
  config: RandomConfig,
): SequencerState {
  return {
    ...state,
    userPresets: [...state.userPresets, { name, config }],
  }
}

/**
 * Delete a user preset by index. Returns new state.
 */
export function deleteUserPreset(state: SequencerState, index: number): SequencerState {
  if (index < 0 || index >= state.userPresets.length) return state
  return {
    ...state,
    userPresets: state.userPresets.filter((_, i) => i !== index),
  }
}
