import type { Note, Velocity, GateLength, RatchetCount, Scale, RandomConfig, ModStep, ModMode } from './types'
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
  mode: 'random' | 'euclidean' | 'sync' | 'cluster'
  randomOffset?: boolean     // euclidean mode: randomize rotation
  clusterContinuation?: number  // cluster mode: Markov continuation probability
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

  if (config.mode === 'cluster') {
    const continuation = config.clusterContinuation ?? 0.5
    const baseProb = length > 0 ? hits / length : 0
    const pattern = Array(length).fill(false)

    // Markov chain walk
    for (let i = 0; i < length; i++) {
      const prob = (i > 0 && pattern[i - 1]) ? continuation : baseProb
      pattern[i] = rng() < prob
    }

    // Adjust to exact hit count
    let currentHits = pattern.filter(Boolean).length
    const indices = Array.from({ length }, (_, i) => i)
    // Shuffle indices for random adjustment
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = indices[i]
      indices[i] = indices[j]
      indices[j] = tmp
    }

    if (currentHits < hits) {
      for (const idx of indices) {
        if (!pattern[idx]) {
          pattern[idx] = true
          currentHits++
          if (currentHits >= hits) break
        }
      }
    } else if (currentHits > hits) {
      for (const idx of indices) {
        if (pattern[idx]) {
          pattern[idx] = false
          currentHits--
          if (currentHits <= hits) break
        }
      }
    }

    return pattern
  }

  if (config.mode === 'sync') {
    // Weighted random placement biased away from strong beats
    const weights = Array.from({ length }, (_, i) => {
      const pos = i % 4
      if (pos === 0) return 1   // downbeats: low weight
      if (pos === 3) return 2   // upbeats ("a"): medium-low
      return 4                  // "e" and "and" positions: high
    })
    const pattern = Array(length).fill(false)
    const indices = Array.from({ length }, (_, i) => i)
    for (let placed = 0; placed < hits; placed++) {
      // Cumulative weight selection from remaining candidates
      let totalWeight = 0
      for (const idx of indices) {
        if (!pattern[idx]) totalWeight += weights[idx]
      }
      if (totalWeight === 0) break
      let pick = rng() * totalWeight
      for (const idx of indices) {
        if (pattern[idx]) continue
        pick -= weights[idx]
        if (pick <= 0) {
          pattern[idx] = true
          break
        }
      }
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

interface ModConfig {
  low: number
  high: number
  mode: ModMode
  slew: number
  slewProbability: number
  walkStepSize: number
  syncBias: number
}

/**
 * Backward-compat wrapper: accepts either the old { low, high } shape or the full ModConfig.
 * Returns ModStep[] with per-step value and slew.
 */
export function randomizeMod(config: { low: number; high: number; mode?: ModMode; slew?: number; slewProbability?: number; walkStepSize?: number; syncBias?: number }, length: number, seed: number = Date.now()): ModStep[] {
  const full: ModConfig = {
    low: config.low,
    high: config.high,
    mode: config.mode ?? 'random',
    slew: config.slew ?? 0,
    slewProbability: config.slewProbability ?? 0,
    walkStepSize: config.walkStepSize ?? 0.15,
    syncBias: config.syncBias ?? 0.7,
  }
  switch (full.mode) {
    case 'rise':
    case 'fall':
    case 'vee':
    case 'hill':
      return randomizeModRamp(full.mode, full, length)
    case 'sync':
      return randomizeModSync(full, length, seed)
    case 'walk':
      return randomizeModWalk(full, length, seed)
    default:
      return randomizeModRandom(full, length, seed)
  }
}

function randomizeModRandom(config: ModConfig, length: number, seed: number): ModStep[] {
  const rng = createRng(seed)
  const range = config.high - config.low
  const steps: ModStep[] = []
  for (let i = 0; i < length; i++) {
    const raw = config.low + rng() * range
    const value = Math.round(raw * 100) / 100
    const slew = config.slewProbability > 0 && rng() < config.slewProbability ? config.slew : 0
    steps.push({ value, slew })
  }
  return steps
}

function randomizeModRamp(mode: 'rise' | 'fall' | 'vee' | 'hill', config: ModConfig, length: number): ModStep[] {
  const steps: ModStep[] = []
  for (let i = 0; i < length; i++) {
    const t = length > 1 ? i / (length - 1) : 0
    let base: number
    switch (mode) {
      case 'rise': base = t; break
      case 'fall': base = 1 - t; break
      case 'hill': base = t < 0.5 ? t * 2 : (1 - t) * 2; break
      case 'vee':  base = t < 0.5 ? 1 - t * 2 : (t - 0.5) * 2; break
    }
    const value = Math.round((config.low + base * (config.high - config.low)) * 100) / 100
    steps.push({ value, slew: config.slew })
  }
  return steps
}

function randomizeModSync(config: ModConfig, length: number, seed: number): ModStep[] {
  const rng = createRng(seed)
  const range = config.high - config.low
  const steps: ModStep[] = []
  for (let i = 0; i < length; i++) {
    const pos = i % 4
    let weight: number
    if (pos === 0) weight = 0.15       // downbeats: low mod
    else if (pos === 3) weight = 0.6   // "a" positions: medium-high
    else weight = 1.0                  // "e" and "and": highest

    // Bias controls how strongly the weighting applies
    const effectiveWeight = 0.5 + (weight - 0.5) * config.syncBias

    const value = Math.round((config.low + effectiveWeight * rng() * range) * 100) / 100
    const slew = config.slewProbability > 0 && rng() < config.slewProbability ? config.slew : 0
    steps.push({ value, slew })
  }
  return steps
}

function randomizeModWalk(config: ModConfig, length: number, seed: number): ModStep[] {
  const rng = createRng(seed)
  const steps: ModStep[] = []
  let current = (config.low + config.high) / 2
  for (let i = 0; i < length; i++) {
    const delta = (rng() * 2 - 1) * config.walkStepSize
    current = Math.max(config.low, Math.min(config.high, current + delta))
    const value = Math.round(current * 100) / 100
    const slew = config.slewProbability > 0 && rng() < config.slewProbability ? config.slew : 0
    steps.push({ value, slew })
  }
  return steps
}

/**
 * Generate random tie pattern. Ties mark steps that continue the previous note.
 * A tie can only follow a gate-on step or another tie. Step 0 is never a tie.
 */
export function randomizeTies(
  probability: number,
  maxLength: number,
  gatePattern: boolean[],
  length: number,
  seed: number,
): boolean[] {
  if (probability <= 0) return Array(length).fill(false)

  const rng = createRng(seed)
  const ties = Array(length).fill(false)

  for (let i = 0; i < length; i++) {
    if (!gatePattern[i]) continue // only gate-on steps can start a tie chain

    // Decide whether this gate-on step starts a tie chain
    if (rng() >= probability) continue

    // Create a chain of 1..maxLength tied steps after this gate-on
    const chainLen = 1 + Math.floor(rng() * maxLength)
    for (let j = 1; j <= chainLen && i + j < length; j++) {
      ties[i + j] = true
    }

    // Skip past the chain so we don't start a new chain mid-chain
    i += chainLen
  }

  return ties
}

/**
 * Generate all subtracks for a track using its random config.
 * Returns raw arrays — caller composes into compound GateStep[]/PitchStep[].
 */
export function randomizeTrack(
  config: RandomConfig,
  lengths: { gate: number; pitch: number; velocity: number; mod: number },
  seed: number = Date.now(),
): { gate: boolean[]; pitch: Note[]; velocity: Velocity[]; gateLength: GateLength[]; ratchet: RatchetCount[]; slide: number[]; mod: ModStep[]; tie: boolean[] } {
  // Use different derived seeds for each subtrack so they're independent
  const gate = randomizeGates(config.gate, lengths.gate, seed)
  return {
    gate,
    pitch: randomizePitch(config.pitch, lengths.pitch, seed + 1),
    velocity: randomizeVelocity(config.velocity, lengths.velocity, seed + 2),
    gateLength: randomizeGateLength(config.gateLength, lengths.gate, seed + 3),
    ratchet: randomizeRatchets(config.ratchet, lengths.gate, seed + 4),
    slide: randomizeSlides(config.slide.probability, lengths.pitch, seed + 5),
    mod: randomizeMod(config.mod, lengths.mod, seed + 6),
    tie: randomizeTies(config.tie.probability, config.tie.maxLength, gate, lengths.gate, seed + 7),
  }
}
