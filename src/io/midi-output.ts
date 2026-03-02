/**
 * Web MIDI output — sends note events to external MIDI devices.
 * Wraps the Web MIDI API (navigator.requestMIDIAccess).
 * Uses MIDI timestamps (performance.now()) for precise scheduling.
 */

import type { NoteEvent, MIDIOutputConfig } from '../engine/types'

export interface MIDIDevice {
  id: string
  name: string
}

/**
 * Maps engine NoteEvents to MIDI messages on external devices.
 * Requires user gesture to init (Web MIDI API requirement).
 */
export class MIDIOutput {
  private access: MIDIAccess | null = null
  private activeNotes: Map<number, { note: number; channel: number }> = new Map()

  /** Request MIDI access — must be called from user gesture handler */
  async init(): Promise<boolean> {
    if (!navigator.requestMIDIAccess) return false
    try {
      this.access = await navigator.requestMIDIAccess()
      return true
    } catch {
      return false
    }
  }

  /** List available MIDI output devices */
  getDevices(): MIDIDevice[] {
    if (!this.access) return []
    const devices: MIDIDevice[] = []
    this.access.outputs.forEach((output) => {
      devices.push({ id: output.id, name: output.name || 'Unknown' })
    })
    return devices
  }

  /**
   * Process note events, sending MIDI messages for enabled outputs.
   * deviceIds maps output index to selected MIDI device ID.
   * stepDuration is the duration of one 16th note in seconds.
   */
  handleEvents(events: NoteEvent[], configs: MIDIOutputConfig[], deviceIds: string[], stepDuration: number): void {
    if (!this.access) return
    const now = performance.now()

    for (const event of events) {
      const config = configs[event.output]
      if (!config?.enabled) continue

      const deviceId = deviceIds[event.output]
      if (!deviceId) continue

      const port = this.access.outputs.get(deviceId)
      if (!port) continue

      const channel = Math.max(0, Math.min(15, config.channel - 1))

      if (event.gate) {
        // Release previous note on this output if different
        const prev = this.activeNotes.get(event.output)
        if (prev && prev.note !== event.pitch) {
          port.send([0x80 | prev.channel, prev.note, 0], now)
        }

        const velocity = Math.max(0, Math.min(127, event.velocity))
        const ratchetCount = event.ratchetCount || 1
        const stepMs = stepDuration * 1000

        if (ratchetCount > 1) {
          // Ratchet: divide full step into N sub-steps,
          // each sub-note applies gate length within its subdivision
          const subStepMs = stepMs / ratchetCount
          const subGateMs = subStepMs * event.gateLength

          for (let r = 0; r < ratchetCount; r++) {
            const onTime = now + r * subStepMs
            const offTime = onTime + subGateMs
            port.send([0x90 | channel, event.pitch, velocity], onTime)
            port.send([0x80 | channel, event.pitch, 0], offTime)
          }
        } else {
          // Single note with gate length
          const gateMs = stepMs * event.gateLength
          port.send([0x90 | channel, event.pitch, velocity], now)
          port.send([0x80 | channel, event.pitch, 0], now + gateMs)
        }

        this.activeNotes.set(event.output, { note: event.pitch, channel })

        // Send mod as CC1 (mod wheel)
        const modValue = Math.round(event.mod * 127)
        port.send([0xB0 | channel, 1, Math.max(0, Math.min(127, modValue))], now)
      } else {
        // Gate off — release note
        const prev = this.activeNotes.get(event.output)
        if (prev) {
          port.send([0x80 | prev.channel, prev.note, 0], now)
          this.activeNotes.delete(event.output)
        }
      }
    }
  }

  /** All notes off on all channels — panic button */
  panic(): void {
    if (!this.access) return
    this.access.outputs.forEach((port) => {
      for (let ch = 0; ch < 16; ch++) {
        port.send([0xB0 | ch, 123, 0])
      }
    })
    this.activeNotes.clear()
  }
}
