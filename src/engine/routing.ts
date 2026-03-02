import type { SequenceTrack, OutputRouting, MuteTrack, NoteEvent, TransposeConfig } from './types'

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
  transposeConfigs?: TransposeConfig[],
): NoteEvent[] {
  const events: NoteEvent[] = []
  for (let i = 0; i < NUM_OUTPUTS; i++) {
    const r = routing[i]
    if (!r) {
      events.push({ output: i, gate: false, pitch: 0, velocity: 0, mod: 0, gateLength: 0.5, ratchetCount: 1, slide: 0 })
      continue
    }
    const gateTrack = tracks[r.gate]
    const pitchTrack = tracks[r.pitch]
    const velTrack = tracks[r.velocity]
    const modTrack = tracks[r.mod]

    const gateStep = gateTrack?.gate.steps[gateTrack.gate.currentStep]
    let gate = gateStep?.on ?? false
    const pitchStep = pitchTrack?.pitch.steps[pitchTrack.pitch.currentStep]
    let pitch = pitchStep?.note ?? 0
    // Apply transpose from pitch source track
    const transpose = transposeConfigs?.[r.pitch]
    if (transpose && transpose.semitones !== 0) {
      pitch = Math.max(0, Math.min(127, pitch + transpose.semitones))
    }
    const velocity = velTrack?.velocity.steps[velTrack.velocity.currentStep] ?? 0
    const mod = modTrack?.mod.steps[modTrack.mod.currentStep] ?? 0
    const gateLength = gateStep?.length ?? 0.5
    const ratchetCount = gateStep?.ratchet ?? 1
    const slide = pitchStep?.slide ?? 0

    // Mute is per-output: mutes[i] controls output i regardless of which track sources the gate
    const mute = mutes[i]
    if (mute && mute.steps[mute.currentStep]) gate = false

    events.push({ output: i, gate, pitch, velocity, mod, gateLength, ratchetCount, slide })
  }
  return events
}
