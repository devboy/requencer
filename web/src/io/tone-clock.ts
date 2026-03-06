import * as Tone from 'tone'

const PPQN = 24
const TICKS_PER_STEP = PPQN / 4 // = 6

export interface ClockCallbacks {
  onTick: (time: number, stepDuration: number, tickDuration: number) => void
}

/**
 * Connects Tone.js Transport to the sequencer engine.
 *
 * Schedules at '16n' (16th-note) intervals and emits TICKS_PER_STEP (6)
 * sub-tick callbacks per step to achieve 24 PPQN resolution.
 * Each sub-tick callback receives a time offset so audio events are
 * scheduled at the correct sub-tick positions.
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
   * Start the clock. Schedules 16th-note callbacks, each emitting
   * TICKS_PER_STEP sub-ticks for 24 PPQN resolution.
   * Must be called after a user gesture (Tone.start() requirement).
   */
  async start(): Promise<void> {
    await Tone.start()
    if (Tone.getContext().state !== 'running') {
      console.warn('[audio] Context not running after Tone.start():', Tone.getContext().state)
    }
    const transport = Tone.getTransport()

    // Safety: clear any existing repeat to prevent double-scheduling
    if (this.repeatId !== null) {
      transport.clear(this.repeatId)
      this.repeatId = null
    }

    this.repeatId = transport.scheduleRepeat((time) => {
      const bpm = transport.bpm.value
      const stepDuration = 60 / bpm / 4 // 16th note in seconds
      const tickDuration = 60 / bpm / PPQN // single PPQN tick in seconds

      // Emit TICKS_PER_STEP sub-ticks with precise audio-time offsets
      for (let i = 0; i < TICKS_PER_STEP; i++) {
        this.callbacks.onTick(time + i * tickDuration, stepDuration, tickDuration)
      }
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
