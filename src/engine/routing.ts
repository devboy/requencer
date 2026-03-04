import type {
  ModStep,
  MuteTrack,
  NoteEvent,
  OutputRouting,
  SequenceTrack,
  TransposeConfig,
  VariationPattern,
} from './types'
import {
  getEffectiveCompoundStep,
  getEffectiveGateStep,
  getEffectivePitchStep,
  getEffectiveVelocityStep,
  getTransformsForSubtrack,
} from './variation'

const NUM_OUTPUTS = 4

export function createDefaultRouting(): OutputRouting[] {
  return Array.from({ length: NUM_OUTPUTS }, (_, i) => ({
    gate: i,
    pitch: i,
    velocity: i,
    mod: i,
    modSource: 'seq' as const,
  }))
}

export function resolveOutputs(
  tracks: SequenceTrack[],
  routing: OutputRouting[],
  mutes: MuteTrack[],
  transposeConfigs?: TransposeConfig[],
  variationPatterns?: VariationPattern[],
  lfoValues?: number[],
): NoteEvent[] {
  const events: NoteEvent[] = []
  for (let i = 0; i < NUM_OUTPUTS; i++) {
    const r = routing[i]
    if (!r) {
      events.push({
        output: i,
        gate: false,
        pitch: 0,
        velocity: 0,
        mod: 0,
        modSlew: 0,
        gateLength: 0.5,
        ratchetCount: 1,
        slide: 0,
        retrigger: true,
        sustain: false,
      })
      continue
    }
    const gateTrack = tracks[r.gate]
    const pitchTrack = tracks[r.pitch]
    const velTrack = tracks[r.velocity]
    const modTrack = tracks[r.mod]

    // Read steps — through variation overlay if active
    const gateVP = variationPatterns?.[r.gate]
    const gateTransforms = gateVP?.enabled ? getTransformsForSubtrack(gateVP, 'gate') : []
    const gateStep = gateTrack
      ? gateTransforms.length > 0
        ? getEffectiveGateStep(gateTrack.gate, gateTransforms, gateVP?.currentBar ?? 0)
        : gateTrack.gate.steps[gateTrack.gate.currentStep]
      : undefined

    // Tied steps are gate-active (they continue the previous note)
    let gate = (gateStep?.on || gateStep?.tie) ?? false

    const pitchVP = variationPatterns?.[r.pitch]
    const pitchTransforms = pitchVP?.enabled ? getTransformsForSubtrack(pitchVP, 'pitch') : []
    const pitchStep = pitchTrack
      ? pitchTransforms.length > 0
        ? getEffectivePitchStep(pitchTrack.pitch, pitchTransforms)
        : pitchTrack.pitch.steps[pitchTrack.pitch.currentStep]
      : undefined
    let pitch = pitchStep?.note ?? 0
    // Apply transpose from pitch source track
    const transpose = transposeConfigs?.[r.pitch]
    if (transpose && transpose.semitones !== 0) {
      pitch = Math.max(0, Math.min(127, pitch + transpose.semitones))
    }
    // Note window octave-wrapping
    if (transpose) {
      const lo = transpose.noteLow
      const hi = transpose.noteHigh
      // Skip wrapping for full range or invalid range (avoid infinite loop)
      if (!(lo === 0 && hi === 127) && hi > lo) {
        while (pitch > hi) pitch -= 12
        while (pitch < lo) pitch += 12
      }
    }
    const velVP = variationPatterns?.[r.velocity]
    const velTransforms = velVP?.enabled ? getTransformsForSubtrack(velVP, 'velocity') : []
    let velocity = velTrack
      ? velTransforms.length > 0
        ? getEffectiveVelocityStep(velTrack.velocity, velTransforms, velVP?.currentBar ?? 0)
        : velTrack.velocity.steps[velTrack.velocity.currentStep]
      : 0

    const slide = pitchStep?.slide ?? 0

    // MOD resolution: choose source based on modSource
    let mod: number
    let modSlew: number = 0
    const modSource = r.modSource ?? 'seq'
    if (modSource === 'lfo' && lfoValues) {
      mod = lfoValues[r.mod] ?? 0
      modSlew = 0 // LFO output is already continuous
    } else {
      // Seq mod — apply variation overlay if active
      const modVP = variationPatterns?.[r.mod]
      const modTransforms = modVP?.enabled ? getTransformsForSubtrack(modVP, 'mod') : []
      const modStep: ModStep | undefined = modTrack
        ? modTransforms.length > 0
          ? getEffectiveCompoundStep<ModStep>(modTrack.mod, modTransforms)
          : modTrack.mod.steps[modTrack.mod.currentStep]
        : undefined
      mod = modStep?.value ?? 0
      modSlew = modStep?.slew ?? 0
    }

    // Look-back: is this a continuation? (this step has tie flag)
    const retrigger = gate && !gateStep?.tie

    // Look-ahead: should we sustain? (next step is a tie)
    const nextIdx = ((gateTrack?.gate.currentStep ?? 0) + 1) % (gateTrack?.gate.length ?? 1)
    const nextGateStep = gateTrack?.gate.steps[nextIdx]
    const sustain = gate && (nextGateStep?.tie ?? false)

    // Tied steps force ratchet to 1 and full gate length when sustaining
    const ratchetCount = gateStep?.tie ? 1 : (gateStep?.ratchet ?? 1)
    let gateLength = gateStep?.tie && sustain ? 1.0 : (gateStep?.length ?? 0.5)

    // GL/VEL scaling: look up per source track
    const gateXpose = transposeConfigs?.[r.gate]
    if (gateXpose && gateXpose.glScale !== 1.0) {
      gateLength = Math.max(0.05, Math.min(1.0, gateLength * gateXpose.glScale))
    }
    const velXpose = transposeConfigs?.[r.velocity]
    if (velXpose && velXpose.velScale !== 1.0) {
      velocity = Math.max(1, Math.min(127, Math.round(velocity * velXpose.velScale)))
    }

    // Mute is per-output: mutes[i] controls output i regardless of which track sources the gate
    const mute = mutes[i]
    if (mute?.steps[mute.currentStep]) gate = false

    events.push({ output: i, gate, pitch, velocity, mod, modSlew, gateLength, ratchetCount, slide, retrigger, sustain })
  }
  return events
}
