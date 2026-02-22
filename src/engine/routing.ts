import type { SequenceTrack, OutputRouting, MuteTrack, NoteEvent } from './types'

const NUM_OUTPUTS = 4

export function createDefaultRouting(): OutputRouting[] {
  return Array.from({ length: NUM_OUTPUTS }, (_, i) => ({
    gate: i, pitch: i, velocity: i, mod: i,
  }))
}

export function resolveOutputs(
  tracks: SequenceTrack[],
  routing: OutputRouting[],
  mutes: MuteTrack[],
): NoteEvent[] {
  const events: NoteEvent[] = []
  for (let i = 0; i < NUM_OUTPUTS; i++) {
    const r = routing[i]
    if (!r) {
      events.push({ output: i, gate: false, pitch: 0, velocity: 0, mod: 0 })
      continue
    }
    const gateTrack = tracks[r.gate]
    const pitchTrack = tracks[r.pitch]
    const velTrack = tracks[r.velocity]
    const modTrack = tracks[r.mod]

    let gate = gateTrack?.gate.steps[gateTrack.gate.currentStep] ?? false
    const pitch = pitchTrack?.pitch.steps[pitchTrack.pitch.currentStep] ?? 0
    const velocity = velTrack?.velocity.steps[velTrack.velocity.currentStep] ?? 0
    const mod = modTrack?.mod.steps[modTrack.mod.currentStep] ?? 0

    // Mute is per-output: mutes[i] controls output i regardless of which track sources the gate
    const mute = mutes[i]
    if (mute && mute.steps[mute.currentStep]) gate = false

    events.push({ output: i, gate, pitch, velocity, mod })
  }
  return events
}
