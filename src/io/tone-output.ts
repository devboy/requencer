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
  private synths: Tone.MonoSynth[] = []
  private activeNotes: (string | null)[] = []

  constructor() {
    // T1: Sub Bass — warm triangle with gentle filter sweep, sits low in the mix
    this.synths.push(new Tone.MonoSynth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.1 },
      filter: { type: 'lowpass', frequency: 800, Q: 1 },
      filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.1, baseFrequency: 200, octaves: 2 },
    }).toDestination())

    // T2: Acid — sawtooth with resonant filter, snappy envelope for squelchy 303 lines
    this.synths.push(new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.3, release: 0.05 },
      filter: { type: 'lowpass', frequency: 1200, Q: 6 },
      filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.1, release: 0.1, baseFrequency: 300, octaves: 3.5 },
    }).toDestination())

    // T3: Lead — square with moderate filter, bright and cutting for melodic loops
    this.synths.push(new Tone.MonoSynth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.08 },
      filter: { type: 'lowpass', frequency: 3000, Q: 2 },
      filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.1, baseFrequency: 800, octaves: 2 },
    }).toDestination())

    // T4: Stab — detuned sawtooth for thick chords and atmospheric textures
    this.synths.push(new Tone.MonoSynth({
      oscillator: { type: 'fatsawtooth', spread: 20, count: 3 },
      envelope: { attack: 0.01, decay: 0.4, sustain: 0.2, release: 0.3 },
      filter: { type: 'lowpass', frequency: 2000, Q: 1.5 },
      filterEnvelope: { attack: 0.01, decay: 0.5, sustain: 0.3, release: 0.2, baseFrequency: 400, octaves: 3 },
    }).toDestination())

    // Balance voice levels — bass louder, stab quieter to avoid mud
    this.synths[0].volume.value = -4
    this.synths[1].volume.value = -8
    this.synths[2].volume.value = -10
    this.synths[3].volume.value = -12

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

        if (event.retrigger) {
          // Normal trigger or tie-chain start
          // Release previous note if different
          if (this.activeNotes[outputIdx] !== null && this.activeNotes[outputIdx] !== noteName) {
            synth.triggerRelease(time)
          }

          if (ratchetCount > 1) {
            // Ratchet: divide full step into N equal sub-steps
            const subStep = stepDuration / ratchetCount
            const subGate = subStep * event.gateLength

            for (let r = 0; r < ratchetCount; r++) {
              const subTime = time + r * subStep
              synth.volume.setValueAtTime(db, subTime)
              synth.triggerAttackRelease(noteName, subGate, subTime)
            }
            this.activeNotes[outputIdx] = noteName
            Tone.getTransport().scheduleOnce(() => {
              if (this.activeNotes[outputIdx] === noteName) {
                this.activeNotes[outputIdx] = null
              }
            }, time + (ratchetCount - 1) * subStep + subGate)
          } else {
            // Single trigger
            synth.volume.setValueAtTime(db, time)
            synth.triggerAttack(noteName, time)
            this.activeNotes[outputIdx] = noteName

            if (!event.sustain) {
              // Normal note — schedule release
              Tone.getTransport().scheduleOnce((t) => {
                if (this.activeNotes[outputIdx] === noteName) {
                  synth.triggerRelease(t)
                  this.activeNotes[outputIdx] = null
                }
              }, time + gateWindow)
            }
            // else: tie start — don't schedule release, note sustains to next step
          }
        } else {
          // Continuation (tied step, retrigger=false) — note already sounding
          if (!event.sustain) {
            // Tie end — schedule release at this step's gate window
            Tone.getTransport().scheduleOnce((t) => {
              if (this.activeNotes[outputIdx] === noteName) {
                synth.triggerRelease(t)
                this.activeNotes[outputIdx] = null
              }
            }, time + gateWindow)
          }
          // else: tie middle — do nothing, note continues sustaining
        }
      } else {
        // Gate off or mute cut — release
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
