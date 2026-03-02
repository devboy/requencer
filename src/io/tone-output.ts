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
    // All synths use high sustain so gate length controls audible note duration.
    // Short release for crisp cutoff when gate closes.

    // T1: Bass — triangle
    this.synths.push(new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.05, sustain: 0.9, release: 0.03 },
    }).toDestination())

    // T2: Bass 2 — square
    this.synths.push(new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.005, decay: 0.05, sustain: 0.85, release: 0.03 },
    }).toDestination())

    // T3: Lead — sawtooth
    this.synths.push(new Tone.Synth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.005, decay: 0.05, sustain: 0.9, release: 0.03 },
    }).toDestination())

    // T4: Lead 2 — square
    this.synths.push(new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.005, decay: 0.05, sustain: 0.85, release: 0.03 },
    }).toDestination())

    this.activeNotes = new Array(NUM_OUTPUTS).fill(null)
  }

  /**
   * Process note events at the given audio-context time.
   * stepDuration is the duration of one 16th note in seconds.
   */
  handleEvents(events: NoteEvent[], time: number, stepDuration: number): void {
    for (const event of events) {
      const synth = this.synths[event.output]
      if (!synth) continue

      if (event.gate) {
        const noteName = midiToNoteName(event.pitch)
        const db = velocityToDb(event.velocity)
        const outputIdx = event.output
        const gateWindow = stepDuration * event.gateLength
        const ratchetCount = event.ratchetCount || 1

        // Set portamento for slide (0 = off, value = glide time in seconds)
        synth.portamento = event.slide

        // Release previous note if different
        if (this.activeNotes[outputIdx] !== null && this.activeNotes[outputIdx] !== noteName) {
          synth.triggerRelease(time)
        }

        if (ratchetCount > 1) {
          // Ratchet: divide full step into N equal sub-steps,
          // each sub-note applies gate length within its subdivision
          const subStep = stepDuration / ratchetCount
          const subGate = subStep * event.gateLength

          for (let r = 0; r < ratchetCount; r++) {
            const subTime = time + r * subStep
            synth.volume.setValueAtTime(db, subTime)
            synth.triggerAttackRelease(noteName, subGate, subTime)
          }
          this.activeNotes[outputIdx] = noteName
          Tone.getTransport().scheduleOnce((t) => {
            if (this.activeNotes[outputIdx] === noteName) {
              this.activeNotes[outputIdx] = null
            }
          }, time + (ratchetCount - 1) * subStep + subGate)
        } else {
          // Single trigger with gate length
          synth.volume.setValueAtTime(db, time)
          synth.triggerAttack(noteName, time)
          this.activeNotes[outputIdx] = noteName

          Tone.getTransport().scheduleOnce((t) => {
            if (this.activeNotes[outputIdx] === noteName) {
              synth.triggerRelease(t)
              this.activeNotes[outputIdx] = null
            }
          }, time + gateWindow)
        }
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
