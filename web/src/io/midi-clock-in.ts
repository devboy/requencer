/**
 * MIDI Clock Input — receives MIDI clock and transport messages from an input port.
 * Slaves the sequencer tick rate to incoming MIDI clock.
 *
 * When active (clockSource === 'midi'), each incoming 0xF8 fires the onTick callback
 * instead of Tone.js Transport scheduling. BPM is recovered from clock timing.
 *
 * MIDI message reference:
 *   0xF8 — Timing Clock (24 PPQN)
 *   0xFA — Start
 *   0xFB — Continue
 *   0xFC — Stop
 */

import {
  type ClockRecoveryState,
  createClockRecovery,
  processClockTick,
  resetClockRecovery,
} from './clock-recovery'

export interface MIDIInputDevice {
  id: string
  name: string
}

export interface MIDIClockInCallbacks {
  /** Fired on each incoming 0xF8 clock tick */
  onTick: (stepDuration: number, tickDuration: number) => void
  /** Fired when incoming Start (0xFA) is received */
  onStart: () => void
  /** Fired when incoming Stop (0xFC) is received */
  onStop: () => void
  /** Fired when recovered BPM changes */
  onBpmChange: (bpm: number) => void
}

// MIDI status bytes
const TIMING_CLOCK = 0xf8
const START = 0xfa
const CONTINUE = 0xfb
const STOP = 0xfc

export class MIDIClockIn {
  private access: MIDIAccess | null = null
  private activePort: MIDIInput | null = null
  private callbacks: MIDIClockInCallbacks
  private clockState: ClockRecoveryState = createClockRecovery()
  private listening = false
  private messageHandler: ((e: MIDIMessageEvent) => void) | null = null

  constructor(callbacks: MIDIClockInCallbacks) {
    this.callbacks = callbacks
  }

  /** Attach to an existing MIDIAccess (shared with MIDIOutput) */
  setAccess(access: MIDIAccess): void {
    this.access = access
  }

  /** List available MIDI input devices */
  getInputDevices(): MIDIInputDevice[] {
    if (!this.access) return []
    const devices: MIDIInputDevice[] = []
    this.access.inputs.forEach((input) => {
      devices.push({ id: input.id, name: input.name || 'Unknown' })
    })
    return devices
  }

  /** Start listening on a specific MIDI input port */
  startListening(deviceId: string): void {
    this.stopListening()
    if (!this.access) return

    const port = this.access.inputs.get(deviceId)
    if (!port) return

    this.activePort = port
    this.clockState = resetClockRecovery()
    this.listening = true

    this.messageHandler = (e: MIDIMessageEvent) => this.handleMessage(e)
    port.addEventListener('midimessage', this.messageHandler as EventListener)
  }

  /** Stop listening and detach from current port */
  stopListening(): void {
    if (this.activePort && this.messageHandler) {
      this.activePort.removeEventListener('midimessage', this.messageHandler as EventListener)
    }
    this.activePort = null
    this.messageHandler = null
    this.listening = false
    this.clockState = resetClockRecovery()
  }

  get isListening(): boolean {
    return this.listening
  }

  private handleMessage(e: MIDIMessageEvent): void {
    if (!e.data || e.data.length === 0) return

    const status = e.data[0]

    switch (status) {
      case TIMING_CLOCK: {
        // Process clock recovery to update BPM
        const timeSeconds = performance.now() / 1000
        const prevBpm = this.clockState.bpm
        this.clockState = processClockTick(this.clockState, timeSeconds)

        if (this.clockState.bpm !== prevBpm && this.clockState.bpm > 0) {
          this.callbacks.onBpmChange(this.clockState.bpm)
        }

        // Compute step/tick durations from recovered BPM (or use fallback)
        const bpm = this.clockState.bpm > 0 ? this.clockState.bpm : 120
        const stepDuration = 60 / bpm / 4 // 16th note duration in seconds
        const tickDuration = 60 / bpm / 24 // single PPQN tick duration

        this.callbacks.onTick(stepDuration, tickDuration)
        break
      }

      case START:
        this.clockState = resetClockRecovery()
        this.callbacks.onStart()
        break

      case CONTINUE:
        // Continue resumes without resetting clock recovery (unlike Start)
        this.callbacks.onStart()
        break

      case STOP:
        this.callbacks.onStop()
        break
    }
  }
}
