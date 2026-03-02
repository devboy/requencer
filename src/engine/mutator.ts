/**
 * Turing Machine mutation engine — selects random steps and regenerates them
 * using the track's RandomConfig constraints (from RAND page).
 *
 * Only mutates the 4 core subtracks: gate, pitch, velocity, mod.
 * Secondary subtracks (gateLength, ratchet, slide) are properties of the
 * RAND config and regenerated naturally when randomizing.
 *
 * Each subtrack rate: 0 = off, >0 = fraction of steps to regenerate per cycle.
 */

import type { SequenceTrack, RandomConfig, MutateConfig, GateStep, PitchStep } from './types'
import { randomizeGates, randomizePitch, randomizeVelocity, randomizeMod } from './randomizer'

/**
 * Simple seeded PRNG (mulberry32).
 */
function createRng(seed: number): () => number {
  let t = seed | 0
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Pick random step indices to mutate based on rate (0.0-1.0).
 */
function pickMutationIndices(length: number, rate: number, rng: () => number): number[] {
  const indices: number[] = []
  for (let i = 0; i < length; i++) {
    if (rng() < rate) indices.push(i)
  }
  return indices
}

/**
 * Apply mutation: replace values at specified indices with new values.
 */
function applyMutation<T>(original: T[], replacement: T[], indices: number[]): T[] {
  if (indices.length === 0) return original
  const result = [...original]
  for (const idx of indices) {
    result[idx] = replacement[idx]
  }
  return result
}

/**
 * Mutate a single subtrack's steps at the given rate.
 * Returns the original steps array reference if rate is 0 or nothing changed.
 */
function mutateSubtrack<T>(
  steps: T[],
  rate: number,
  generateReplacement: (length: number, seed: number) => T[],
  rng: () => number,
  seed: number,
): T[] {
  if (rate <= 0) return steps
  const indices = pickMutationIndices(steps.length, rate, rng)
  if (indices.length === 0) return steps
  const replacement = generateReplacement(steps.length, seed)
  return applyMutation(steps, replacement, indices)
}

/**
 * Mutate a track's core subtracks (gate, pitch, velocity, mod).
 * Each subtrack uses its own rate from MutateConfig.
 * Regeneration constraints come from the track's RandomConfig.
 * Returns a new track (does not mutate input).
 */
export function mutateTrack(
  track: SequenceTrack,
  randomConfig: RandomConfig,
  mutateConfig: MutateConfig,
  seed: number = Date.now(),
): SequenceTrack {
  const rng = createRng(seed)

  // Gate mutation: only mutate .on, preserve .length and .ratchet
  let newGateSteps = track.gate.steps
  if (mutateConfig.gate > 0) {
    const indices = pickMutationIndices(track.gate.steps.length, mutateConfig.gate, rng)
    if (indices.length > 0) {
      const replacementBools = randomizeGates(randomConfig.gate, track.gate.steps.length, seed + 10)
      newGateSteps = [...track.gate.steps]
      for (const idx of indices) {
        newGateSteps[idx] = { ...newGateSteps[idx], on: replacementBools[idx] }
      }
    }
  }

  // Pitch mutation: only mutate .note, preserve .slide
  let newPitchSteps = track.pitch.steps
  if (mutateConfig.pitch > 0) {
    const indices = pickMutationIndices(track.pitch.steps.length, mutateConfig.pitch, rng)
    if (indices.length > 0) {
      const replacementNotes = randomizePitch(randomConfig.pitch, track.pitch.steps.length, seed + 11)
      newPitchSteps = [...track.pitch.steps]
      for (const idx of indices) {
        newPitchSteps[idx] = { ...newPitchSteps[idx], note: replacementNotes[idx] }
      }
    }
  }

  const newVel = mutateSubtrack(
    track.velocity.steps, mutateConfig.velocity,
    (len, s) => randomizeVelocity(randomConfig.velocity, len, s), rng, seed + 12,
  )
  const newMod = mutateSubtrack(
    track.mod.steps, mutateConfig.mod,
    (len, s) => randomizeMod(randomConfig.mod, len, s), rng, seed + 13,
  )

  // Only create new track if something changed
  if (
    newGateSteps === track.gate.steps && newPitchSteps === track.pitch.steps &&
    newVel === track.velocity.steps && newMod === track.mod.steps
  ) {
    return track
  }

  return {
    ...track,
    gate: newGateSteps !== track.gate.steps ? { ...track.gate, steps: newGateSteps } : track.gate,
    pitch: newPitchSteps !== track.pitch.steps ? { ...track.pitch, steps: newPitchSteps } : track.pitch,
    velocity: newVel !== track.velocity.steps ? { ...track.velocity, steps: newVel } : track.velocity,
    mod: newMod !== track.mod.steps ? { ...track.mod, steps: newMod } : track.mod,
  }
}

/**
 * Check if any subtrack in a MutateConfig has drift enabled (rate > 0).
 */
export function isMutateActive(config: MutateConfig): boolean {
  return config.gate > 0 || config.pitch > 0 || config.velocity > 0 || config.mod > 0
}
