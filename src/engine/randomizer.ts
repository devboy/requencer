import type { Note, Velocity, GateLength, RatchetCount, Scale, RandomConfig } from './types'
import { euclidean } from './euclidean'
import { getScaleNotes } from './scales'

/**
 * Simple seeded PRNG (mulberry32). Returns a function that produces
 * deterministic values in [0, 1) for a given seed.
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

interface GateConfig {
  fillMin: number
  fillMax: number
  mode: 'random' | 'euclidean'
  randomOffset?: boolean     // euclidean mode: randomize rotation
}

interface PitchConfig {
  low: Note
  high: Note
  scale: Scale
  root: Note
  maxNotes?: number          // 0 or undefined = unlimited distinct pitches
}

interface VelocityConfig {
  low: Velocity
  high: Velocity
}

/**
 * Generate a random gate pattern.
 * In 'random' mode: randomly places `hits` gates.
 * In 'euclidean' mode: uses euclidean distribution for `hits` gates.
 */
export function randomizeGates(config: GateConfig, length: number, seed: number = Date.now()): boolean[] {
  const rng = createRng(seed)
  const fillMin = Math.round(config.fillMin * length)
  const fillMax = Math.round(config.fillMax * length)
  const hits = fillMin + Math.floor(rng() * (fillMax - fillMin + 1))

  if (config.mode === 'euclidean') {
    const pattern = euclidean(hits, length)
    if (config.randomOffset && length > 0) {
      const offset = Math.floor(rng() * length)
      return [...pattern.slice(offset), ...pattern.slice(0, offset)]
    }
    return pattern
  }

  // Random mode: Fisher-Yates shuffle of a pattern with exactly `hits` gates
  const pattern = Array(length).fill(false)
  for (let i = 0; i < hits; i++) {
    pattern[i] = true
  }

  // Shuffle
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = pattern[i]
    pattern[i] = pattern[j]
    pattern[j] = tmp
  }

  return pattern
}

/**
 * Generate random pitch values constrained to a scale and range.
 */
export function randomizePitch(config: PitchConfig, length: number, seed: number = Date.now()): Note[] {
  const rng = createRng(seed)
  let scaleNotes = getScaleNotes(config.root, config.scale, config.low, config.high)

  if (scaleNotes.length === 0) {
    return Array(length).fill(config.low)
  }

  // Limit to N distinct notes by picking a random subset
  if (config.maxNotes && config.maxNotes > 0 && scaleNotes.length > config.maxNotes) {
    // Fisher-Yates shuffle then take first maxNotes
    const shuffled = [...scaleNotes]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = shuffled[i]
      shuffled[i] = shuffled[j]
      shuffled[j] = tmp
    }
    scaleNotes = shuffled.slice(0, config.maxNotes).sort((a, b) => a - b)
  }

  const notes: Note[] = []
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(rng() * scaleNotes.length)
    notes.push(scaleNotes[idx])
  }

  return notes
}

/**
 * Generate random velocity values within a range.
 */
export function randomizeVelocity(config: VelocityConfig, length: number, seed: number = Date.now()): Velocity[] {
  const rng = createRng(seed)
  const range = config.high - config.low

  const velocities: Velocity[] = []
  for (let i = 0; i < length; i++) {
    velocities.push(Math.floor(config.low + rng() * (range + 1)))
  }

  return velocities
}

interface GateLengthConfig {
  min: GateLength
  max: GateLength
}

/**
 * Generate random gate length values within a range.
 * Values are clamped to 0.05-1.0 and quantized to 0.05 increments.
 */
export function randomizeGateLength(config: GateLengthConfig, length: number, seed: number = Date.now()): GateLength[] {
  const rng = createRng(seed)
  const min = Math.max(0.05, config.min)
  const max = Math.min(1.0, config.max)
  const range = max - min

  const values: GateLength[] = []
  for (let i = 0; i < length; i++) {
    const raw = min + rng() * range
    values.push(Math.round(raw * 20) / 20) // quantize to 0.05
  }

  return values
}

interface RatchetConfig {
  maxRatchet: RatchetCount
  probability: number       // 0.0-1.0
}

/**
 * Generate random ratchet values. Each step has `probability` chance of being > 1.
 * When ratcheted, value is random 2..maxRatchet.
 */
export function randomizeRatchets(config: RatchetConfig, length: number, seed: number = Date.now()): RatchetCount[] {
  const rng = createRng(seed)
  const values: RatchetCount[] = []
  for (let i = 0; i < length; i++) {
    if (config.probability > 0 && rng() < config.probability && config.maxRatchet > 1) {
      values.push(2 + Math.floor(rng() * (config.maxRatchet - 1))) // 2..maxRatchet
    } else {
      values.push(1)
    }
  }
  return values
}

/**
 * Generate random slide values. Each step has `probability` chance of getting
 * a portamento time (0.10s default). Returns 0 for no slide.
 */
export function randomizeSlides(probability: number, length: number, seed: number = Date.now()): number[] {
  const rng = createRng(seed)
  const values: number[] = []
  for (let i = 0; i < length; i++) {
    values.push(probability > 0 && rng() < probability ? 0.10 : 0)
  }
  return values
}

/**
 * Generate random mod CV values within a range.
 * Values are quantized to 0.01 increments.
 */
export function randomizeMod(config: { low: number; high: number }, length: number, seed: number = Date.now()): number[] {
  const rng = createRng(seed)
  const range = config.high - config.low
  const values: number[] = []
  for (let i = 0; i < length; i++) {
    const raw = config.low + rng() * range
    values.push(Math.round(raw * 100) / 100)
  }
  return values
}

/**
 * Generate all subtracks for a track using its random config.
 * Returns raw arrays — caller composes into compound GateStep[]/PitchStep[].
 */
export function randomizeTrack(
  config: RandomConfig,
  lengths: { gate: number; pitch: number; velocity: number; mod: number },
  seed: number = Date.now(),
): { gate: boolean[]; pitch: Note[]; velocity: Velocity[]; gateLength: GateLength[]; ratchet: RatchetCount[]; slide: number[]; mod: number[] } {
  // Use different derived seeds for each subtrack so they're independent
  return {
    gate: randomizeGates(config.gate, lengths.gate, seed),
    pitch: randomizePitch(config.pitch, lengths.pitch, seed + 1),
    velocity: randomizeVelocity(config.velocity, lengths.velocity, seed + 2),
    gateLength: randomizeGateLength(config.gateLength, lengths.gate, seed + 3),
    ratchet: randomizeRatchets(config.ratchet, lengths.gate, seed + 4),
    slide: randomizeSlides(config.slide.probability, lengths.pitch, seed + 5),
    mod: randomizeMod(config.mod, lengths.mod, seed + 6),
  }
}
