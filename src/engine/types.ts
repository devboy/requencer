// Musical types
export type Note = number       // MIDI note 0-127
export type Velocity = number   // 0-127
export type CVValue = number    // 0.0 - 1.0 normalized
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
  length: number            // can differ per subtrack for polyrhythms
  clockDivider: number      // subtrack-level division
  currentStep: number       // playback position
}

// Compound step types — modifiers folded into their parent subtrack
export interface GateStep {
  on: boolean
  length: GateLength       // 0.0-1.0, fraction of step window
  ratchet: RatchetCount    // 1-4, sub-triggers per step
}

export interface PitchStep {
  note: Note
  slide: number            // 0 = off, 0.01-0.50 = portamento time in seconds
}

// A sequence track containing gate, pitch, velocity, mod subtracks
export interface SequenceTrack {
  id: string
  name: string
  clockDivider: number      // track-level division
  gate: Subtrack<GateStep>
  pitch: Subtrack<PitchStep>
  velocity: Subtrack<Velocity>
  mod: Subtrack<number>
}

// Random generation config per track
export interface RandomConfig {
  pitch: {
    low: Note
    high: Note
    scale: Scale
    root: Note               // root note of the scale
    maxNotes: number         // 0 = unlimited, else limit distinct pitches from scale
  }
  gate: {
    fillMin: number          // 0.0 - 1.0
    fillMax: number          // 0.0 - 1.0
    mode: 'random' | 'euclidean'
    randomOffset: boolean    // in euclidean mode: randomize rotation offset
    smartBars: number        // 1/2/4/8/16 — number of bars for smart gate
    smartDensity: SmartGateDensity
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
    probability: number       // 0.0-1.0, chance any step has ratchet > 1
  }
  slide: {
    probability: number       // 0.0-1.0, chance any step has slide on
  }
  mod: {
    low: number               // 0.0-1.0, min CV value
    high: number              // 0.0-1.0, max CV value
  }
}

// Routing: per-output mapping of which source track provides each param
export interface OutputRouting {
  gate: number      // source track index 0-3
  pitch: number
  velocity: number
  mod: number
}

// Mute pattern per track
export interface MuteTrack {
  steps: boolean[]           // true = muted
  length: number
  clockDivider: number
  currentStep: number
}

// Output events emitted by the engine
export interface NoteEvent {
  output: number             // output index 0-3
  gate: boolean
  pitch: Note
  velocity: Velocity
  mod: number                // 0-127
  gateLength: GateLength     // 0.0-1.0, fraction of step window
  ratchetCount: RatchetCount // 1-4, number of sub-triggers
  slide: number              // portamento time in seconds (0 = off)
}

// Transport state
export interface Transport {
  bpm: number
  playing: boolean
  masterTick: number
}

// A saved user preset
export interface UserPreset {
  name: string
  config: RandomConfig
}

// Pitch transposition config
export interface TransposeConfig {
  semitones: number           // -48 to +48
  quantize: boolean           // snap to scale after transpose
}

// Smart gate density mode
export type SmartGateDensity = 'build' | 'decay' | 'build-drop' | 'variation'

// Arpeggiator direction
export type ArpDirection = 'up' | 'down' | 'triangle' | 'random'

// Arpeggiator config per track
export interface ArpConfig {
  enabled: boolean
  direction: ArpDirection
  octaveRange: number            // 1-4
}

// LFO waveform type
export type LFOWaveform = 'sine' | 'triangle' | 'saw' | 'slew-random'

// LFO config per track
export interface LFOConfig {
  enabled: boolean
  waveform: LFOWaveform
  rate: number               // steps per cycle (1-64)
  depth: number              // 0.0-1.0
  offset: number             // 0.0-1.0 center value
}

// Turing Machine mutation config — per-track, per-subtrack rate
// Each subtrack rate: 0 = off, 0.01-1.0 = fraction of steps to regenerate
export type MutateTrigger = 'loop' | 'bars'

export interface MutateConfig {
  trigger: MutateTrigger     // 'loop' = per-subtrack boundary, 'bars' = every N bars
  bars: number               // 1, 2, 4, 8, 16 — used in 'bars' mode
  gate: number               // 0 = off, 0.01-1.0 = drift rate
  pitch: number
  velocity: number
  mod: number
}

// MIDI output config per output
export interface MIDIOutputConfig {
  enabled: boolean
  channel: number            // 1-16
}

// Top-level sequencer state
export interface SequencerState {
  tracks: SequenceTrack[]           // 4 sequence tracks
  routing: OutputRouting[]
  mutePatterns: MuteTrack[]         // 4 mute tracks (one per sequence)
  transport: Transport
  randomConfigs: RandomConfig[]     // 4 configs (one per track)
  transposeConfigs: TransposeConfig[] // 4 transpose configs (one per track)
  lfoConfigs: LFOConfig[]          // 4 LFO configs (one per track)
  arpConfigs: ArpConfig[]          // 4 arp configs (one per track)
  mutateConfigs: MutateConfig[]    // 4 mutate configs (one per track)
  midiConfigs: MIDIOutputConfig[]  // 4 MIDI configs (one per output)
  userPresets: UserPreset[]         // user-saved presets (unlimited)
}
