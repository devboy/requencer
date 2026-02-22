// Musical types
export type Note = number       // MIDI note 0-127
export type Velocity = number   // 0-127
export type CVValue = number    // 0.0 - 1.0 normalized

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

// A sequence track containing gate, pitch, velocity, mod subtracks
export interface SequenceTrack {
  id: string
  name: string
  clockDivider: number      // track-level division
  gate: Subtrack<boolean>
  pitch: Subtrack<Note>
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
  }
  velocity: {
    low: Velocity
    high: Velocity
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

// Top-level sequencer state
export interface SequencerState {
  tracks: SequenceTrack[]           // 4 sequence tracks
  routing: OutputRouting[]
  mutePatterns: MuteTrack[]         // 4 mute tracks (one per sequence)
  transport: Transport
  randomConfigs: RandomConfig[]     // 4 configs (one per track)
  userPresets: UserPreset[]         // user-saved presets (unlimited)
}
