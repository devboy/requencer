// Musical types
export type Note = number // MIDI note 0-127
export type Velocity = number // 0-127
export type CVValue = number // 0.0 - 1.0 normalized
export type GateLength = number // 0.0 - 1.0, fraction of step window
export type RatchetCount = number // 1-4, number of sub-triggers per step

// Scale definition
export interface Scale {
  name: string
  intervals: number[] // semitone intervals from root, e.g. [0,2,4,5,7,9,11] for major
}

// A single subtrack: a sequence of values with independent length and clock division
export interface Subtrack<T> {
  steps: T[]
  length: number // can differ per subtrack for polyrhythms
  clockDivider: number // subtrack-level division
  currentStep: number // playback position
}

// Compound step types — modifiers folded into their parent subtrack
export interface GateStep {
  on: boolean
  tie: boolean // continues previous note, don't retrigger
  length: GateLength // 0.0-1.0, fraction of step window
  ratchet: RatchetCount // 1-4, sub-triggers per step
}

export interface PitchStep {
  note: Note
  slide: number // 0 = off, 0.01-0.50 = portamento time in seconds
}

// Compound step type for mod subtrack (parallels PitchStep for pitch)
export interface ModStep {
  value: number // 0.0-1.0, CV value
  slew: number // 0.0 = instant, 0.01-1.0 = interpolation time as fraction of step
}

// MOD generation algorithm
export type ModMode = 'random' | 'rise' | 'fall' | 'vee' | 'hill' | 'sync' | 'walk'

// A sequence track containing gate, pitch, velocity, mod subtracks
export interface SequenceTrack {
  id: string
  name: string
  clockDivider: number // track-level division
  gate: Subtrack<GateStep>
  pitch: Subtrack<PitchStep>
  velocity: Subtrack<Velocity>
  mod: Subtrack<ModStep>
}

// Random generation config per track
export interface RandomConfig {
  pitch: {
    low: Note
    high: Note
    scale: Scale
    root: Note // root note of the scale
    maxNotes: number // 0 = unlimited, else limit distinct pitches from scale
  }
  gate: {
    fillMin: number // 0.0 - 1.0
    fillMax: number // 0.0 - 1.0
    mode: 'random' | 'euclidean' | 'sync' | 'cluster'
    randomOffset: boolean // in euclidean mode: randomize rotation offset
    clusterContinuation: number // 0.0-1.0, Markov continuation probability for cluster mode
  }
  velocity: {
    low: Velocity
    high: Velocity
  }
  gateLength: {
    min: GateLength
    max: GateLength
  }
  ratchet: {
    maxRatchet: RatchetCount
    probability: number // 0.0-1.0, chance any step has ratchet > 1
  }
  slide: {
    probability: number // 0.0-1.0, chance any step has slide on
  }
  mod: {
    low: number // 0.0-1.0, min CV value
    high: number // 0.0-1.0, max CV value
    mode: ModMode // generation algorithm
    slew: number // 0.0-1.0, default slew for generated steps
    slewProbability: number // 0.0-1.0, chance each step gets slew (rest get 0)
    walkStepSize: number // 0.0-0.5, max delta per step in WALK mode
    syncBias: number // 0.0-1.0, how strongly to weight offbeat positions in SYNC mode
  }
  tie: {
    probability: number // 0.0-1.0, chance a gate-on step starts a tie chain
    maxLength: number // 1-8, max consecutive tied steps
  }
}

// Routing: per-output mapping of which source track provides each param
export interface OutputRouting {
  gate: number // source track index 0-3
  pitch: number
  velocity: number
  mod: number
  modSource: 'seq' | 'lfo' // which mod source from the selected track
}

// Mute pattern per track
export interface MuteTrack {
  steps: boolean[] // true = muted
  length: number
  clockDivider: number
  currentStep: number
}

// Output events emitted by the engine
export interface NoteEvent {
  output: number // output index 0-3
  gate: boolean
  pitch: Note
  velocity: Velocity
  mod: number // 0-127
  modSlew: number // 0.0-1.0, interpolation time as fraction of step (0 = instant)
  gateLength: GateLength // 0.0-1.0, fraction of step window
  ratchetCount: RatchetCount // 1-4, number of sub-triggers
  slide: number // portamento time in seconds (0 = off)
  retrigger: boolean // false = continuation step (skip attack)
  sustain: boolean // true = don't schedule release (next step is tied)
}

// Transport state
export type ClockSource = 'internal' | 'midi' | 'external'

export interface Transport {
  bpm: number
  playing: boolean
  masterTick: number
  clockSource: ClockSource
}

// A saved user preset
export interface UserPreset {
  name: string
  config: RandomConfig
}

// Pitch transposition config
export interface TransposeConfig {
  semitones: number // -48 to +48
  noteLow: number // 0-127 (MIDI note floor, octave-wrap)
  noteHigh: number // 0-127 (MIDI note ceiling, octave-wrap)
  glScale: number // 0.25 to 4.0 (1.0 = 100%, gate length multiplier)
  velScale: number // 0.25 to 4.0 (1.0 = 100%, velocity multiplier)
}

// Arpeggiator direction
export type ArpDirection = 'up' | 'down' | 'triangle' | 'random'

// Arpeggiator config per track
export interface ArpConfig {
  enabled: boolean
  direction: ArpDirection
  octaveRange: number // 1-4
}

// LFO waveform type
export type LFOWaveform = 'sine' | 'triangle' | 'saw' | 'square' | 'slew-random' | 's+h'

// LFO sync mode
export type LFOSyncMode = 'track' | 'free'

// LFO config per track
export interface LFOConfig {
  waveform: LFOWaveform
  syncMode: LFOSyncMode
  rate: number // steps per cycle (1-64) in synced mode
  freeRate: number // Hz (0.05-20.0) in free mode
  depth: number // 0.0-1.0, amplitude scaling
  offset: number // 0.0-1.0, center value
  width: number // 0.0-1.0, waveform skew/symmetry (0.5 = symmetric)
  phase: number // 0.0-1.0, phase offset
}

// Runtime LFO state — tracks the current phase position
export interface LFORuntime {
  currentPhase: number // 0.0-1.0, current position in cycle
  lastSHValue: number // for S+H waveform: holds value until next trigger
  slewTarget: number // for slew-random: current interpolation target
  slewCurrent: number // for slew-random: current interpolated value
}

// Turing Machine mutation config — per-track, per-subtrack rate
// Each subtrack rate: 0 = off, 0.01-1.0 = fraction of steps to regenerate
export type MutateTrigger = 'loop' | 'bars'

export interface MutateConfig {
  trigger: MutateTrigger // 'loop' = per-subtrack boundary, 'bars' = every N bars
  bars: number // 1, 2, 4, 8, 16 — used in 'bars' mode
  gate: number // 0 = off, 0.01-1.0 = drift rate
  pitch: number
  velocity: number
  mod: number
}

// MIDI output config per output
export interface MIDIOutputConfig {
  channel: number // 1-16
}

// Variation transform types
export type TransformType =
  // Playhead transforms (change which step index is read)
  | 'reverse'
  | 'ping-pong'
  | 'rotate'
  | 'double-time'
  | 'stutter'
  | 'half-time'
  | 'skip'
  | 'drunk-walk'
  | 'scramble'
  // Gate value transforms (modify gate output)
  | 'thin'
  | 'fill'
  | 'skip-even'
  | 'skip-odd'
  | 'invert-gates'
  | 'densify'
  | 'drop'
  | 'ratchet'
  // Pitch value transforms (modify pitch output)
  | 'transpose'
  | 'invert'
  | 'octave-shift'
  | 'fold'
  | 'quantize'
  // Velocity value transforms (modify velocity output)
  | 'accent'
  | 'fade-in'
  | 'fade-out'
  | 'humanize'

export interface Transform {
  type: TransformType
  param: number
}

export interface VariationSlot {
  transforms: Transform[]
}

export interface VariationPattern {
  enabled: boolean
  length: number
  loopMode: boolean
  slots: VariationSlot[]
  currentBar: number
  subtrackOverrides: {
    gate: VariationPattern | 'bypass' | null
    pitch: VariationPattern | 'bypass' | null
    velocity: VariationPattern | 'bypass' | null
    mod: VariationPattern | 'bypass' | null
  }
}

// Pattern storage: snapshot of one track + all its overlays
export interface TrackSlotData {
  track: SequenceTrack
  transposeConfig: TransposeConfig
  mutateConfig: MutateConfig
  variationPattern: VariationPattern
  lfoConfig: LFOConfig
  randomConfig: RandomConfig
  arpConfig: ArpConfig
}

export interface LayerFlags {
  gate: boolean
  pitch: boolean
  velocity: boolean
  mod: boolean
  transpose: boolean
  drift: boolean
  variation: boolean
}

export interface SavedPattern {
  name: string
  data: TrackSlotData
  sourceTrack: number // 0-3, which track was saved from
}

// Top-level sequencer state
export interface SequencerState {
  tracks: SequenceTrack[] // 4 sequence tracks
  routing: OutputRouting[]
  mutePatterns: MuteTrack[] // 4 mute tracks (one per sequence)
  transport: Transport
  randomConfigs: RandomConfig[] // 4 configs (one per track)
  transposeConfigs: TransposeConfig[] // 4 transpose configs (one per track)
  lfoConfigs: LFOConfig[] // 4 LFO configs (one per track)
  lfoRuntimes: LFORuntime[] // 4 LFO runtime states (one per track)
  arpConfigs: ArpConfig[] // 4 arp configs (one per track)
  mutateConfigs: MutateConfig[] // 4 mutate configs (one per track)
  midiConfigs: MIDIOutputConfig[] // 4 MIDI configs (one per output)
  midiEnabled: boolean // global MIDI output on/off
  midiClockOut: boolean // send MIDI clock (0xF8) + transport to output devices
  userPresets: UserPreset[] // user-saved presets (unlimited)
  variationPatterns: VariationPattern[] // 4 variation patterns (one per track)
  savedPatterns: SavedPattern[] // user-saved patterns (unlimited)
}
