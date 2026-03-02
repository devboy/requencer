import type { SequencerState, SequenceTrack, RandomConfig, MuteTrack, NoteEvent, Subtrack, MutateConfig, GateStep, PitchStep } from './types'
import { SCALES } from './scales'
import { getEffectiveStep } from './clock-divider'
import { resolveOutputs, createDefaultRouting } from './routing'
import { randomizeTrack, randomizeGates, randomizePitch, randomizeVelocity, randomizeGateLength, randomizeRatchets, randomizeSlides, randomizeMod } from './randomizer'
import { generateArpPattern } from './arpeggiator'
import { generateSmartGatePattern } from './smart-gate'
import { generateLFOPattern } from './lfo'
import { mutateTrack, isMutateActive } from './mutator'

const NUM_TRACKS = 4
const DEFAULT_LENGTH = 16
const DEFAULT_BPM = 135
const MIN_LENGTH = 1
const MAX_LENGTH = 64
const MIN_DIVIDER = 1
const MAX_DIVIDER = 32

const DEFAULT_GATE_STEP: GateStep = { on: false, length: 0.5, ratchet: 1 }
const DEFAULT_PITCH_STEP: PitchStep = { note: 60, slide: 0 }

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function createSubtrack<T>(defaultValue: T, length: number = DEFAULT_LENGTH): Subtrack<T> {
  return {
    steps: Array.from({ length }, () =>
      typeof defaultValue === 'object' && defaultValue !== null
        ? { ...defaultValue }
        : defaultValue
    ),
    length,
    clockDivider: 1,
    currentStep: 0,
  }
}

function createTrack(index: number): SequenceTrack {
  return {
    id: String(index),
    name: `Track ${index + 1}`,
    clockDivider: 1,
    gate: createSubtrack(DEFAULT_GATE_STEP),
    pitch: createSubtrack(DEFAULT_PITCH_STEP),
    velocity: createSubtrack(100 as number),
    mod: createSubtrack(0 as number),
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
      smartBars: 1,
      smartDensity: 'build',
    },
    velocity: {
      low: 64,
      high: 120,
    },
    gateLength: {
      min: 0.5,
      max: 0.5,
    },
    ratchet: {
      maxRatchet: 1,
      probability: 0,
    },
    slide: {
      probability: 0,
    },
    mod: {
      low: 0,
      high: 1,
    },
  }
}

function createDefaultMutateConfig(): MutateConfig {
  return {
    trigger: 'loop',
    bars: 1,
    gate: 0,
    pitch: 0,
    velocity: 0,
    mod: 0,
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
    lfoConfigs: Array.from({ length: NUM_TRACKS }, () => ({ enabled: false, waveform: 'sine' as const, rate: 16, depth: 1, offset: 0.5 })),
    arpConfigs: Array.from({ length: NUM_TRACKS }, () => ({ enabled: false, direction: 'up' as const, octaveRange: 1 })),
    transposeConfigs: Array.from({ length: NUM_TRACKS }, () => ({ semitones: 0, quantize: false })),
    mutateConfigs: Array.from({ length: NUM_TRACKS }, () => createDefaultMutateConfig()),
    midiConfigs: Array.from({ length: NUM_TRACKS }, (_, i) => ({ enabled: false, channel: i + 1 })),
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
  const events = resolveOutputs(currentTracks, state.routing, currentMutes, state.transposeConfigs)

  // --- Mutation (Turing Machine drift) ---
  // Apply before advancing to next tick so mutations take effect on the next loop.
  const mutatedTracks = state.tracks.map((track, idx) => {
    const mc = state.mutateConfigs[idx]
    if (!isMutateActive(mc)) return track
    const trackDiv = track.clockDivider

    if (mc.trigger === 'bars') {
      // Bars mode: mutate all enabled subtracks every N bars (N * 16 steps)
      const interval = mc.bars * 16
      if (interval > 0 && masterTick > 0 && masterTick % interval === 0) {
        return mutateTrack(track, state.randomConfigs[idx], mc, masterTick)
      }
      return track
    }

    // Loop mode: mutate each subtrack independently at its own Nth loop boundary.
    // A subtrack loops when its effective step wraps from end to 0.
    // Only mutate on every mc.bars-th loop (e.g., bars=2 → every 2nd loop).
    function loopedOnNth(sub: { clockDivider: number; length: number }): boolean {
      const cur = getEffectiveStep(masterTick, trackDiv, sub.clockDivider, sub.length)
      const nxt = getEffectiveStep(nextTick, trackDiv, sub.clockDivider, sub.length)
      if (!(cur > 0 && nxt === 0)) return false
      // Compute which loop number we're entering (0-based)
      const combined = trackDiv * sub.clockDivider
      const loopNum = Math.floor(nextTick / combined / sub.length)
      return mc.bars <= 1 || loopNum % mc.bars === 0
    }

    // Build a temporary config that zeros out rates for subtracks not at their loop boundary
    const loopConfig: MutateConfig = {
      ...mc,
      gate: loopedOnNth(track.gate) ? mc.gate : 0,
      pitch: loopedOnNth(track.pitch) ? mc.pitch : 0,
      velocity: loopedOnNth(track.velocity) ? mc.velocity : 0,
      mod: loopedOnNth(track.mod) ? mc.mod : 0,
    }

    if (!isMutateActive(loopConfig)) return track
    return mutateTrack(track, state.randomConfigs[idx], loopConfig, masterTick)
  })

  // Advance steps to the next tick for the returned state
  const nextTracks = mutatedTracks.map(track => {
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
 * Set a step value in a simple subtrack (velocity, mod). Returns new state.
 */
export function setStep(
  state: SequencerState,
  trackIndex: number,
  subtrack: 'velocity' | 'mod',
  stepIndex: number,
  value: number,
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
          steps: sub.steps.map((s, j) => (j === stepIndex ? value : s)),
        },
      }
    }),
  }
}

/** Toggle gate on/off for a step. */
export function setGateOn(state: SequencerState, trackIndex: number, stepIndex: number, value: boolean): SequencerState {
  return updateGateField(state, trackIndex, stepIndex, 'on', value)
}

/** Set gate length for a step (0.0-1.0). */
export function setGateLength(state: SequencerState, trackIndex: number, stepIndex: number, value: number): SequencerState {
  return updateGateField(state, trackIndex, stepIndex, 'length', value)
}

/** Set ratchet count for a step (1-4). */
export function setGateRatchet(state: SequencerState, trackIndex: number, stepIndex: number, value: number): SequencerState {
  return updateGateField(state, trackIndex, stepIndex, 'ratchet', value)
}

/** Set pitch note for a step. */
export function setPitchNote(state: SequencerState, trackIndex: number, stepIndex: number, value: number): SequencerState {
  return updatePitchField(state, trackIndex, stepIndex, 'note', value)
}

/** Set slide value for a step. */
export function setSlide(state: SequencerState, trackIndex: number, stepIndex: number, value: number): SequencerState {
  return updatePitchField(state, trackIndex, stepIndex, 'slide', value)
}

function updateGateField<K extends keyof GateStep>(
  state: SequencerState, trackIndex: number, stepIndex: number, field: K, value: GateStep[K],
): SequencerState {
  return {
    ...state,
    tracks: state.tracks.map((track, i) => {
      if (i !== trackIndex) return track
      return {
        ...track,
        gate: {
          ...track.gate,
          steps: track.gate.steps.map((s, j) => j === stepIndex ? { ...s, [field]: value } : s),
        },
      }
    }),
  }
}

function updatePitchField<K extends keyof PitchStep>(
  state: SequencerState, trackIndex: number, stepIndex: number, field: K, value: PitchStep[K],
): SequencerState {
  return {
    ...state,
    tracks: state.tracks.map((track, i) => {
      if (i !== trackIndex) return track
      return {
        ...track,
        pitch: {
          ...track.pitch,
          steps: track.pitch.steps.map((s, j) => j === stepIndex ? { ...s, [field]: value } : s),
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
    mod: track.mod.length,
  }, seed)

  // Compose compound GateStep[] from generated booleans + gateLength + ratchet
  const gateSteps: GateStep[] = generated.gate.map((on, i) => ({
    on,
    length: generated.gateLength[i],
    ratchet: generated.ratchet[i],
  }))

  // Compose compound PitchStep[] from generated notes + slide
  const pitchSteps: PitchStep[] = generated.pitch.map((note, i) => ({
    note,
    slide: generated.slide[i],
  }))

  return {
    ...state,
    tracks: state.tracks.map((t, i) => {
      if (i !== trackIndex) return t
      return {
        ...t,
        gate: { ...t.gate, steps: gateSteps },
        pitch: { ...t.pitch, steps: pitchSteps },
        velocity: { ...t.velocity, steps: generated.velocity },
        mod: { ...t.mod, steps: generated.mod },
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
  const s = seed ?? Date.now()

  let newGateBools: boolean[]
  if (config.gate.smartBars > 1) {
    newGateBools = generateSmartGatePattern({
      fillMin: config.gate.fillMin,
      fillMax: config.gate.fillMax,
      stepsPerBar: 16,
      bars: config.gate.smartBars,
      density: config.gate.smartDensity,
      seed: s,
    })
  } else {
    newGateBools = randomizeGates(config.gate, track.gate.length, s)
  }

  // Also regenerate gateLength and ratchet for the new gate pattern
  const newGateLengths = randomizeGateLength(config.gateLength, newGateBools.length, s + 3)
  const newRatchets = randomizeRatchets(config.ratchet, newGateBools.length, s + 4)

  const gateSteps: GateStep[] = newGateBools.map((on, i) => ({
    on,
    length: newGateLengths[i],
    ratchet: newRatchets[i],
  }))

  return {
    ...state,
    tracks: state.tracks.map((t, i) => {
      if (i !== trackIndex) return t
      return { ...t, gate: { ...t.gate, steps: gateSteps, length: gateSteps.length } }
    }),
  }
}

/**
 * Randomize only the pitch subtrack of a track. Returns new state.
 */
export function randomizePitchPattern(state: SequencerState, trackIndex: number, seed?: number): SequencerState {
  const track = state.tracks[trackIndex]
  const config = state.randomConfigs[trackIndex]
  const arpConfig = state.arpConfigs[trackIndex]
  const s = seed ?? Date.now()

  const newNotes = arpConfig.enabled
    ? generateArpPattern(config.pitch.root, config.pitch.scale, arpConfig.direction, arpConfig.octaveRange, track.pitch.length, s)
    : randomizePitch(config.pitch, track.pitch.length, s)

  const newSlides = randomizeSlides(config.slide.probability, track.pitch.length, s + 5)

  const pitchSteps: PitchStep[] = newNotes.map((note, i) => ({
    note,
    slide: newSlides[i],
  }))

  return {
    ...state,
    tracks: state.tracks.map((t, i) => {
      if (i !== trackIndex) return t
      return { ...t, pitch: { ...t.pitch, steps: pitchSteps } }
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

/**
 * Regenerate mod subtrack from LFO config. Returns new state.
 */
export function regenerateLFO(state: SequencerState, trackIndex: number): SequencerState {
  const track = state.tracks[trackIndex]
  const lfoConfig = state.lfoConfigs[trackIndex]
  const newMod = generateLFOPattern(
    { waveform: lfoConfig.waveform, rate: lfoConfig.rate, depth: lfoConfig.depth, offset: lfoConfig.offset },
    track.mod.length,
  )

  return {
    ...state,
    tracks: state.tracks.map((t, i) => {
      if (i !== trackIndex) return t
      return { ...t, mod: { ...t.mod, steps: newMod } }
    }),
  }
}

/**
 * Randomize only the mod subtrack of a track. Returns new state.
 */
export function randomizeModPattern(state: SequencerState, trackIndex: number, seed?: number): SequencerState {
  const track = state.tracks[trackIndex]
  const config = state.randomConfigs[trackIndex]
  const newMod = randomizeMod(config.mod, track.mod.length, seed)

  return {
    ...state,
    tracks: state.tracks.map((t, i) => {
      if (i !== trackIndex) return t
      return { ...t, mod: { ...t.mod, steps: newMod } }
    }),
  }
}

function resizeSteps<T>(steps: T[], newLength: number, defaultValue: T): T[] {
  if (newLength <= steps.length) return steps.slice(0, newLength)
  const padValue = typeof defaultValue === 'object' && defaultValue !== null
    ? () => ({ ...defaultValue })
    : () => defaultValue
  return [...steps, ...Array.from({ length: newLength - steps.length }, padValue)]
}

const SUBTRACK_DEFAULTS: Record<'gate' | 'pitch' | 'velocity' | 'mod', GateStep | PitchStep | number> = {
  gate: DEFAULT_GATE_STEP,
  pitch: DEFAULT_PITCH_STEP,
  velocity: 100,
  mod: 0,
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
          steps: resizeSteps(sub.steps, length, SUBTRACK_DEFAULTS[subtrack] as any),
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
