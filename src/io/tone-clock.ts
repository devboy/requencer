import * as Tone from 'tone'

export interface ClockCallbacks {
  onTick: (time: number) => void
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
   * Start the clock. Schedules 16th-note ticks (one tick per 16th note).
   * Must be called after a user gesture (Tone.start() requirement).
   */
  async start(): Promise<void> {
    await Tone.start()
    if (Tone.getContext().state !== 'running') {
      console.warn('[audio] Context not running after Tone.start():', Tone.getContext().state)
    }
    const transport = Tone.getTransport()

    // Schedule a repeating callback at 16th note intervals
    this.repeatId = transport.scheduleRepeat((time) => {
      this.callbacks.onTick(time)
    }, '16n')

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
