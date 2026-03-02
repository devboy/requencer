/**
 * Smart gate generation — multi-bar phrase-aware gate patterns.
 * Pure functions, zero dependencies on DOM/audio.
 */

import type { SmartGateDensity } from './types'

interface SmartGateConfig {
  fillMin: number       // 0.0-1.0
  fillMax: number       // 0.0-1.0
  stepsPerBar: number   // typically 16
  bars: number          // 1/2/4/8/16
  density: SmartGateDensity
  seed: number
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

/** Generate a random gate bar with a specific fill count. */
function generateBar(steps: number, hits: number, rng: () => number): boolean[] {
  const pattern = Array(steps).fill(false)
  for (let i = 0; i < Math.min(hits, steps); i++) {
    pattern[i] = true
  }
  // Fisher-Yates shuffle
  for (let i = steps - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = pattern[i]
    pattern[i] = pattern[j]
    pattern[j] = tmp
  }
  return pattern
}

/**
 * Compute fill amounts per bar based on density mode.
 */
function computeBarFills(
  bars: number,
  stepsPerBar: number,
  fillMin: number,
  fillMax: number,
  density: SmartGateDensity,
  rng: () => number,
): number[] {
  const minHits = Math.round(fillMin * stepsPerBar)
  const maxHits = Math.round(fillMax * stepsPerBar)

  if (bars === 1) {
    const hits = minHits + Math.floor(rng() * (maxHits - minHits + 1))
    return [hits]
  }

  const fills: number[] = []

  switch (density) {
    case 'build': {
      // Linearly increasing density from min to max
      for (let b = 0; b < bars; b++) {
        const t = bars > 1 ? b / (bars - 1) : 0
        fills.push(Math.round(minHits + t * (maxHits - minHits)))
      }
      break
    }
    case 'decay': {
      // Linearly decreasing density from max to min
      for (let b = 0; b < bars; b++) {
        const t = bars > 1 ? b / (bars - 1) : 0
        fills.push(Math.round(maxHits - t * (maxHits - minHits)))
      }
      break
    }
    case 'build-drop': {
      // Build up to penultimate bar, drop on last
      for (let b = 0; b < bars - 1; b++) {
        const t = bars > 2 ? b / (bars - 2) : 1
        fills.push(Math.round(minHits + t * (maxHits - minHits)))
      }
      fills.push(minHits) // drop
      break
    }
    case 'variation': {
      // Each bar gets a random fill within a narrow band
      const midHits = Math.round((minHits + maxHits) / 2)
      const variance = Math.max(1, Math.round((maxHits - minHits) * 0.2))
      for (let b = 0; b < bars; b++) {
        const v = midHits + Math.floor(rng() * (variance * 2 + 1)) - variance
        fills.push(Math.max(minHits, Math.min(maxHits, v)))
      }
      break
    }
  }

  return fills
}

/**
 * Generate a multi-bar gate pattern with phrase-aware density.
 */
export function generateSmartGatePattern(config: SmartGateConfig): boolean[] {
  const rng = createRng(config.seed)
  const fills = computeBarFills(
    config.bars,
    config.stepsPerBar,
    config.fillMin,
    config.fillMax,
    config.density,
    rng,
  )

  const pattern: boolean[] = []
  for (let b = 0; b < config.bars; b++) {
    pattern.push(...generateBar(config.stepsPerBar, fills[b], rng))
  }

  return pattern
}
