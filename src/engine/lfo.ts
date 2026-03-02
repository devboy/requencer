/**
 * LFO waveform generation for MOD subtrack.
 * Pure functions, zero dependencies on DOM/audio.
 */

export type LFOWaveform = 'sine' | 'triangle' | 'saw' | 'slew-random'

export interface LFOParams {
  waveform: LFOWaveform
  rate: number        // steps per cycle (1-64)
  depth: number       // 0.0-1.0, amplitude scaling
  offset: number      // 0.0-1.0, center value
}

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
 * Compute a single LFO waveform value at a given phase (0.0-1.0).
 * Returns a value in [0, 1].
 */
export function lfoValue(waveform: LFOWaveform, phase: number, seed: number = 0): number {
  switch (waveform) {
    case 'sine':
      return 0.5 + 0.5 * Math.sin(phase * 2 * Math.PI)
    case 'triangle': {
      // 0→1 in first half, 1→0 in second half
      if (phase < 0.5) return phase * 2
      return 2 - phase * 2
    }
    case 'saw':
      return phase
    case 'slew-random': {
      // Generate random anchor points and interpolate
      const rng = createRng(seed)
      const numAnchors = 8
      const anchors: number[] = []
      for (let i = 0; i <= numAnchors; i++) {
        anchors.push(rng())
      }
      // Linear interpolation between anchor points
      const pos = phase * numAnchors
      const idx = Math.floor(pos)
      const frac = pos - idx
      const a = anchors[Math.min(idx, numAnchors)]
      const b = anchors[Math.min(idx + 1, numAnchors)]
      return a + (b - a) * frac
    }
  }
}

/**
 * Generate a MOD pattern from LFO parameters.
 * Each step gets a value based on the waveform at that step's phase.
 */
export function generateLFOPattern(params: LFOParams, length: number, seed: number = 0): number[] {
  const pattern: number[] = []
  for (let i = 0; i < length; i++) {
    const phase = (i % params.rate) / params.rate
    const raw = lfoValue(params.waveform, phase, seed)
    // Scale by depth around offset
    const scaled = params.offset + (raw - 0.5) * params.depth
    pattern.push(Math.max(0, Math.min(1, Math.round(scaled * 100) / 100)))
  }
  return pattern
}
