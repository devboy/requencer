import * as Tone from 'tone'
import type { NoteEvent } from '../engine/types'

const NUM_OUTPUTS = 4

/** Convert MIDI note number to note name (e.g., 60 → "C4") */
function midiToNoteName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const octave = Math.floor(midi / 12) - 1
  const note = names[midi % 12]
  return `${note}${octave}`
}

/** Convert MIDI velocity (0-127) to decibels */
function velocityToDb(velocity: number): number {
  if (velocity === 0) return -Infinity
  return -40 + (velocity / 127) * 40
}

/**
 * Maps engine NoteEvents to Tone.js synth triggers.
 * Creates 4 synth instances with distinct voices (one per output).
 */
export class ToneOutput {
  private synths: Tone.Synth[] = []
  private activeNotes: (string | null)[] = []

  constructor() {
    // T1: Bass — triangle, slow attack
    this.synths.push(new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.01, decay: 0.15, sustain: 0.4, release: 0.15 },
    }).toDestination())

    // T2: Bass 2 — square, punchy
    this.synths.push(new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.2, release: 0.1 },
    }).toDestination())

    // T3: Lead — sawtooth, bright
    this.synths.push(new Tone.Synth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
    }).toDestination())

    // T4: Lead 2 — square, mid-high
    this.synths.push(new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.005, decay: 0.08, sustain: 0.25, release: 0.08 },
    }).toDestination())

    this.activeNotes = new Array(NUM_OUTPUTS).fill(null)
  }

  /**
   * Process note events at the given audio-context time.
   */
  handleEvents(events: NoteEvent[], time: number): void {
    for (const event of events) {
      const synth = this.synths[event.output]
      if (!synth) continue

      if (event.gate) {
        const noteName = midiToNoteName(event.pitch)
        const db = velocityToDb(event.velocity)
        synth.volume.setValueAtTime(db, time)

        // Release previous note if different
        if (this.activeNotes[event.output] !== null && this.activeNotes[event.output] !== noteName) {
          synth.triggerRelease(time)
        }

        synth.triggerAttack(noteName, time)
        this.activeNotes[event.output] = noteName
      } else {
        if (this.activeNotes[event.output] !== null) {
          synth.triggerRelease(time)
          this.activeNotes[event.output] = null
        }
      }
    }
  }

  /** Release all active notes — call on transport stop to prevent stuck notes */
  releaseAll(): void {
    for (let i = 0; i < this.synths.length; i++) {
      if (this.activeNotes[i] !== null) {
        this.synths[i].triggerRelease()
        this.activeNotes[i] = null
      }
    }
  }

  dispose(): void {
    for (const synth of this.synths) {
      synth.dispose()
    }
    this.synths = []
    this.activeNotes = []
  }
}
