// Output events emitted by the engine
export interface NoteEvent {
  output: number // output index 0-3
  gate: boolean
  pitch: number // MIDI note 0-127
  velocity: number // 0-127
  mod: number // 0-127
  modSlew: number // 0.0-1.0, interpolation time as fraction of step (0 = instant)
  gateLength: number // 0.0-1.0, fraction of step window
  ratchetCount: number // 1-4, number of sub-triggers
  slide: number // portamento time in seconds (0 = off)
  retrigger: boolean // false = continuation step (skip attack)
  sustain: boolean // true = don't schedule release (next step is tied)
}

// Transport state
export type ClockSource = 'internal' | 'midi' | 'external'

// MIDI output config per output
export interface MIDIOutputConfig {
  channel: number // 1-16
}
