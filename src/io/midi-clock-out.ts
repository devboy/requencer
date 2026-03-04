/**
 * MIDI Clock Output — sends MIDI clock (0xF8) and transport messages to all output ports.
 * Shares the MIDIAccess instance from MIDIOutput.
 *
 * MIDI timing messages:
 *   0xF8 — Timing Clock (24 PPQN)
 *   0xFA — Start
 *   0xFC — Stop
 */

// MIDI status bytes for clock/transport
const TIMING_CLOCK = 0xf8
const START = 0xfa
const STOP = 0xfc

export class MIDIClockOut {
  private access: MIDIAccess | null = null
  private wasPlaying = false

  /** Attach to an existing MIDIAccess (shared with MIDIOutput) */
  setAccess(access: MIDIAccess): void {
    this.access = access
  }

  /** Send a single MIDI clock tick (0xF8) to all output ports */
  sendClock(): void {
    if (!this.access) return
    this.access.outputs.forEach((port) => {
      port.send([TIMING_CLOCK])
    })
  }

  /**
   * Called each tick to send clock + handle transport state transitions.
   * Sends Start on play, Stop on stop, and Clock every tick while playing.
   */
  tick(playing: boolean, enabled: boolean): void {
    if (!this.access || !enabled) {
      this.wasPlaying = playing
      return
    }

    // Transport transitions
    if (playing && !this.wasPlaying) {
      this.sendStart()
    } else if (!playing && this.wasPlaying) {
      this.sendStop()
    }
    this.wasPlaying = playing

    // Send clock tick while playing
    if (playing) {
      this.sendClock()
    }
  }

  /** Send MIDI Start (0xFA) to all output ports */
  sendStart(): void {
    if (!this.access) return
    this.access.outputs.forEach((port) => {
      port.send([START])
    })
  }

  /** Send MIDI Stop (0xFC) to all output ports */
  sendStop(): void {
    if (!this.access) return
    this.access.outputs.forEach((port) => {
      port.send([STOP])
    })
  }
}
