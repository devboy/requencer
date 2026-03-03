import * as Tone from 'tone'
import { PPQN } from '../engine/clock-divider'

export interface ClockCallbacks {
  onTick: (time: number, stepDuration: number, tickDuration: number) => void
}

/**
 * Connects Tone.js Transport to the sequencer engine.
 * Each scheduled repeat fires the onTick callback with audio-context time.
 */
export class ToneClock {
  private repeatId: number | null = null
  private callbacks: ClockCallbacks

  constructor(callbacks: ClockCallbacks) {
    this.callbacks = callbacks
  }

  get bpm(): number {
    return Tone.getTransport().bpm.value
  }

  set bpm(value: number) {
    Tone.getTransport().bpm.value = value
  }

  /**
   * Start the clock. Schedules 24 PPQN ticks (one tick per 96th note).
   * Must be called after a user gesture (Tone.start() requirement).
   */
  async start(): Promise<void> {
    await Tone.start()
    if (Tone.getContext().state !== 'running') {
      console.warn('[audio] Context not running after Tone.start():', Tone.getContext().state)
    }
    const transport = Tone.getTransport()

    // Schedule a repeating callback at 96th note intervals (= 1/PPQN of a quarter note)
    this.repeatId = transport.scheduleRepeat((time) => {
      const stepDuration = 60 / transport.bpm.value / 4 // 16th note duration in seconds
      const tickDuration = 60 / transport.bpm.value / PPQN // single PPQN tick duration
      this.callbacks.onTick(time, stepDuration, tickDuration)
    }, '96n')

    transport.start()
  }

  stop(): void {
    const transport = Tone.getTransport()
    transport.stop()

    if (this.repeatId !== null) {
      transport.clear(this.repeatId)
      this.repeatId = null
    }
  }

  get playing(): boolean {
    return Tone.getTransport().state === 'started'
  }
}
