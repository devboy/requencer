/**
 * Drum machine — underground techno pattern (kick + hihats, no snare).
 * Passive instrument: does not schedule its own transport events.
 * Call triggerStep(step, time) from the sequencer tick callback.
 */

import * as Tone from 'tone'

const STEPS = 16

// Underground techno patterns (16th note grid)
//                    1 . . . 2 . . . 3 . . . 4 . . .
const KICK_PATTERN  = [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0]
const HH_PATTERN    = [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1]
const OH_PATTERN    = [0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0]

export class DrumMachine {
  private kick: Tone.MembraneSynth
  private hihat: Tone.MetalSynth
  private _enabled = false

  constructor() {
    // Kick — deep membrane hit
    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 6,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
    }).toDestination()
    this.kick.volume.value = -6

    // Hi-hat — metallic ping
    this.hihat = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000,
      octaves: 1.5,
    }).toDestination()
    this.hihat.frequency.value = 400
    this.hihat.volume.value = -18
  }

  get enabled(): boolean { return this._enabled }

  set enabled(on: boolean) {
    this._enabled = on
  }

  triggerStep(step: number, time: number): void {
    if (!this._enabled) return
    const s = step % STEPS

    if (KICK_PATTERN[s])  this.kick.triggerAttackRelease('C1', '8n', time)
    if (OH_PATTERN[s])    this.hihat.triggerAttackRelease(400, '8n', time, 0.5)
    else if (HH_PATTERN[s]) this.hihat.triggerAttackRelease(400, '32n', time, 0.3)
  }

  dispose(): void {
    this._enabled = false
    this.kick.dispose()
    this.hihat.dispose()
  }
}
