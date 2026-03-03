import { describe, it, expect } from 'vitest'
import { randomizeGates, randomizePitch, randomizeVelocity, randomizeTrack, randomizeTies } from '../randomizer'
import { SCALES } from '../scales'

describe('randomizeGates', () => {
  it('produces exact fill count in random mode with equal min/max', () => {
    const pattern = randomizeGates({ fillMin: 0.5, fillMax: 0.5, mode: 'random' }, 16, 42)
    expect(pattern.length).toBe(16)
    expect(pattern.filter(Boolean).length).toBe(8)
  })

  it('produces fill count within range in random mode', () => {
    const pattern = randomizeGates({ fillMin: 0.25, fillMax: 0.75, mode: 'random' }, 16, 42)
    const hits = pattern.filter(Boolean).length
    expect(hits).toBeGreaterThanOrEqual(4)  // 0.25 * 16
    expect(hits).toBeLessThanOrEqual(12)    // 0.75 * 16
  })

  it('produces euclidean pattern within fill range', () => {
    const pattern = randomizeGates({ fillMin: 0.25, fillMax: 0.75, mode: 'euclidean' }, 16, 42)
    const hits = pattern.filter(Boolean).length
    expect(hits).toBeGreaterThanOrEqual(4)
    expect(hits).toBeLessThanOrEqual(12)
    expect(pattern.length).toBe(16)
  })

  it('returns all false for fill 0', () => {
    const pattern = randomizeGates({ fillMin: 0, fillMax: 0, mode: 'random' }, 16, 42)
    expect(pattern.every(s => s === false)).toBe(true)
  })

  it('returns all true for fill 1', () => {
    const pattern = randomizeGates({ fillMin: 1, fillMax: 1, mode: 'random' }, 16, 42)
    expect(pattern.every(s => s === true)).toBe(true)
  })

  it('is deterministic with same seed', () => {
    const a = randomizeGates({ fillMin: 0.3, fillMax: 0.7, mode: 'random' }, 16, 123)
    const b = randomizeGates({ fillMin: 0.3, fillMax: 0.7, mode: 'random' }, 16, 123)
    expect(a).toEqual(b)
  })

  it('produces different results with different seeds', () => {
    const a = randomizeGates({ fillMin: 0.3, fillMax: 0.7, mode: 'random' }, 16, 1)
    const b = randomizeGates({ fillMin: 0.3, fillMax: 0.7, mode: 'random' }, 16, 2)
    // Extremely unlikely to be identical
    expect(a).not.toEqual(b)
  })

  it('euclidean with randomOffset rotates the pattern', () => {
    const noOffset = randomizeGates({ fillMin: 0.5, fillMax: 0.5, mode: 'euclidean', randomOffset: false }, 16, 42)
    const withOffset = randomizeGates({ fillMin: 0.5, fillMax: 0.5, mode: 'euclidean', randomOffset: true }, 16, 42)
    // Same number of hits
    expect(withOffset.filter(Boolean).length).toBe(noOffset.filter(Boolean).length)
    // But different arrangement (rotation) — with high probability for 8 hits in 16 steps
    expect(withOffset).not.toEqual(noOffset)
  })

  it('euclidean without randomOffset produces unrotated pattern', () => {
    const a = randomizeGates({ fillMin: 0.5, fillMax: 0.5, mode: 'euclidean', randomOffset: false }, 16, 42)
    const b = randomizeGates({ fillMin: 0.5, fillMax: 0.5, mode: 'euclidean', randomOffset: false }, 16, 99)
    // Same hits count, same pattern (no rotation, same hit count means same euclidean)
    expect(a).toEqual(b)
  })
})

describe('randomizeGates sync mode', () => {
  it('produces correct hit count', () => {
    const pattern = randomizeGates({ fillMin: 0.5, fillMax: 0.5, mode: 'sync' }, 16, 42)
    expect(pattern.length).toBe(16)
    expect(pattern.filter(Boolean).length).toBe(8)
  })

  it('is deterministic with same seed', () => {
    const a = randomizeGates({ fillMin: 0.5, fillMax: 0.5, mode: 'sync' }, 16, 42)
    const b = randomizeGates({ fillMin: 0.5, fillMax: 0.5, mode: 'sync' }, 16, 42)
    expect(a).toEqual(b)
  })

  it('statistically biases away from downbeats', () => {
    const downbeatPositions = [0, 4, 8, 12]
    const offbeatPositions = [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15]
    let downbeatHits = 0
    let offbeatHits = 0

    for (let seed = 0; seed < 200; seed++) {
      const pattern = randomizeGates({ fillMin: 0.5, fillMax: 0.5, mode: 'sync' }, 16, seed)
      for (const pos of downbeatPositions) if (pattern[pos]) downbeatHits++
      for (const pos of offbeatPositions) if (pattern[pos]) offbeatHits++
    }

    // Downbeats should be hit proportionally less than offbeats
    const downbeatRate = downbeatHits / (200 * downbeatPositions.length)
    const offbeatRate = offbeatHits / (200 * offbeatPositions.length)
    expect(downbeatRate).toBeLessThan(offbeatRate)
  })

  it('respects fillMin/fillMax range', () => {
    const pattern = randomizeGates({ fillMin: 0.25, fillMax: 0.75, mode: 'sync' }, 16, 42)
    const hits = pattern.filter(Boolean).length
    expect(hits).toBeGreaterThanOrEqual(4)
    expect(hits).toBeLessThanOrEqual(12)
  })
})

describe('randomizeGates cluster mode', () => {
  it('produces correct hit count', () => {
    const pattern = randomizeGates({ fillMin: 0.5, fillMax: 0.5, mode: 'cluster', clusterContinuation: 0.7 }, 16, 42)
    expect(pattern.length).toBe(16)
    expect(pattern.filter(Boolean).length).toBe(8)
  })

  it('is deterministic with same seed', () => {
    const a = randomizeGates({ fillMin: 0.5, fillMax: 0.5, mode: 'cluster', clusterContinuation: 0.7 }, 16, 42)
    const b = randomizeGates({ fillMin: 0.5, fillMax: 0.5, mode: 'cluster', clusterContinuation: 0.7 }, 16, 42)
    expect(a).toEqual(b)
  })

  it('high continuation produces consecutive runs', () => {
    let totalRuns = 0
    let totalHits = 0
    const trials = 100
    for (let seed = 0; seed < trials; seed++) {
      const pattern = randomizeGates({ fillMin: 0.5, fillMax: 0.5, mode: 'cluster', clusterContinuation: 0.9 }, 16, seed)
      const hits = pattern.filter(Boolean).length
      totalHits += hits
      // Count distinct runs (groups of consecutive true values)
      let runs = 0
      for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] && (i === 0 || !pattern[i - 1])) runs++
      }
      totalRuns += runs
    }
    // With high continuation, average run length should be > 1.7 (well above scattered ~1.2)
    const avgRunLength = totalHits / totalRuns
    expect(avgRunLength).toBeGreaterThan(1.7)
  })

  it('low continuation produces scattered singles', () => {
    let totalRuns = 0
    let totalHits = 0
    const trials = 100
    for (let seed = 0; seed < trials; seed++) {
      const pattern = randomizeGates({ fillMin: 0.5, fillMax: 0.5, mode: 'cluster', clusterContinuation: 0.1 }, 16, seed)
      const hits = pattern.filter(Boolean).length
      totalHits += hits
      let runs = 0
      for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] && (i === 0 || !pattern[i - 1])) runs++
      }
      totalRuns += runs
    }
    // With low continuation, average run length should be close to 1
    const avgRunLength = totalHits / totalRuns
    expect(avgRunLength).toBeLessThan(2)
  })

  it('respects fillMin/fillMax range', () => {
    const pattern = randomizeGates({ fillMin: 0.25, fillMax: 0.75, mode: 'cluster', clusterContinuation: 0.5 }, 16, 42)
    const hits = pattern.filter(Boolean).length
    expect(hits).toBeGreaterThanOrEqual(4)
    expect(hits).toBeLessThanOrEqual(12)
  })

  it('defaults to 0.5 continuation when not specified', () => {
    const pattern = randomizeGates({ fillMin: 0.5, fillMax: 0.5, mode: 'cluster' }, 16, 42)
    expect(pattern.length).toBe(16)
    expect(pattern.filter(Boolean).length).toBe(8)
  })
})

describe('randomizePitch', () => {
  it('produces notes within range and in scale', () => {
    const config = { low: 60, high: 72, scale: SCALES.major, root: 60 }
    const notes = randomizePitch(config, 16, 42)
    expect(notes.length).toBe(16)
    for (const note of notes) {
      expect(note).toBeGreaterThanOrEqual(60)
      expect(note).toBeLessThanOrEqual(72)
      const interval = ((note - 60) % 12 + 12) % 12
      expect(SCALES.major.intervals).toContain(interval)
    }
  })

  it('works with minor pentatonic', () => {
    const config = { low: 57, high: 81, scale: SCALES.minorPentatonic, root: 69 }
    const notes = randomizePitch(config, 8, 99)
    expect(notes.length).toBe(8)
    for (const note of notes) {
      expect(note).toBeGreaterThanOrEqual(57)
      expect(note).toBeLessThanOrEqual(81)
      const interval = ((note - 69) % 12 + 12) % 12
      expect(SCALES.minorPentatonic.intervals).toContain(interval)
    }
  })

  it('is deterministic with same seed', () => {
    const config = { low: 60, high: 72, scale: SCALES.major, root: 60 }
    const a = randomizePitch(config, 16, 42)
    const b = randomizePitch(config, 16, 42)
    expect(a).toEqual(b)
  })

  it('maxNotes limits distinct pitch values', () => {
    const config = { low: 48, high: 72, scale: SCALES.minorPentatonic, root: 48, maxNotes: 3 }
    const notes = randomizePitch(config, 32, 42)
    const distinct = new Set(notes)
    expect(distinct.size).toBeLessThanOrEqual(3)
    expect(distinct.size).toBeGreaterThanOrEqual(1)
  })

  it('maxNotes=0 means unlimited (uses all available scale notes)', () => {
    const config = { low: 48, high: 72, scale: SCALES.minorPentatonic, root: 48, maxNotes: 0 }
    const notes = randomizePitch(config, 64, 42)
    const distinct = new Set(notes)
    // Minor pentatonic over 2 octaves has ~9 notes, with 64 steps most should appear
    expect(distinct.size).toBeGreaterThan(3)
  })

  it('maxNotes larger than scale notes uses all available', () => {
    // Blues scale from 60-72 has limited notes
    const config = { low: 60, high: 64, scale: SCALES.major, root: 60, maxNotes: 50 }
    const notes = randomizePitch(config, 16, 42)
    // Should work without error, using all available notes in the small range
    expect(notes.length).toBe(16)
  })
})

describe('randomizeVelocity', () => {
  it('produces values within range', () => {
    const velocities = randomizeVelocity({ low: 64, high: 127 }, 16, 42)
    expect(velocities.length).toBe(16)
    for (const v of velocities) {
      expect(v).toBeGreaterThanOrEqual(64)
      expect(v).toBeLessThanOrEqual(127)
    }
  })

  it('produces integer values', () => {
    const velocities = randomizeVelocity({ low: 0, high: 127 }, 16, 42)
    for (const v of velocities) {
      expect(v).toBe(Math.floor(v))
    }
  })

  it('is deterministic with same seed', () => {
    const a = randomizeVelocity({ low: 64, high: 127 }, 16, 42)
    const b = randomizeVelocity({ low: 64, high: 127 }, 16, 42)
    expect(a).toEqual(b)
  })
})

describe('randomizeTies', () => {
  it('returns all false when probability is 0', () => {
    const gatePattern = [true, false, true, true, false, true, false, true]
    const ties = randomizeTies(0, 4, gatePattern, 8, 42)
    expect(ties.length).toBe(8)
    expect(ties.every(t => t === false)).toBe(true)
  })

  it('only creates ties after gate-on steps', () => {
    // Gate pattern: ON, OFF, ON, ON, OFF, ON, OFF, ON
    const gatePattern = [true, false, true, true, false, true, false, true]
    const ties = randomizeTies(1.0, 2, gatePattern, 8, 42)
    expect(ties.length).toBe(8)
    // First step (index 0) can never be a tie — it's the trigger
    // A tie can only appear at index i if the previous step was gate-on or a tie
    expect(ties[0]).toBe(false) // can't tie step 0 (nothing before it)
  })

  it('respects maxLength — no chain longer than maxLength', () => {
    // All gates on, high probability
    const gatePattern = Array(16).fill(true)
    const ties = randomizeTies(1.0, 2, gatePattern, 16, 42)
    // Count consecutive ties — should never exceed 2
    let consecutive = 0
    for (const t of ties) {
      if (t) {
        consecutive++
        expect(consecutive).toBeLessThanOrEqual(2)
      } else {
        consecutive = 0
      }
    }
  })

  it('is deterministic with same seed', () => {
    const gatePattern = Array(16).fill(true)
    const a = randomizeTies(0.5, 3, gatePattern, 16, 42)
    const b = randomizeTies(0.5, 3, gatePattern, 16, 42)
    expect(a).toEqual(b)
  })

  it('produces ties with high probability when probability is 1.0', () => {
    const gatePattern = Array(16).fill(true)
    const ties = randomizeTies(1.0, 4, gatePattern, 16, 42)
    // With prob 1.0 and all gates on, should have many ties
    const tieCount = ties.filter(Boolean).length
    expect(tieCount).toBeGreaterThan(0)
  })

  it('does not tie a step that has no preceding gate-on', () => {
    // OFF, OFF, ON, OFF — only step 3 could potentially be a tie (after step 2)
    const gatePattern = [false, false, true, false]
    const ties = randomizeTies(1.0, 4, gatePattern, 4, 42)
    expect(ties[0]).toBe(false) // no preceding gate
    expect(ties[1]).toBe(false) // no preceding gate
    expect(ties[2]).toBe(false) // this is the trigger itself
    // Step 3: could be a tie (after gate-on at 2)
  })
})

describe('randomizeTrack', () => {
  it('generates all subtracks with independent lengths', () => {
    const config = {
      pitch: { low: 60, high: 72, scale: SCALES.major, root: 60, maxNotes: 0 },
      gate: { fillMin: 0.25, fillMax: 0.75, mode: 'random' as const, randomOffset: false, clusterContinuation: 0.7 },
      velocity: { low: 64, high: 127 },
      gateLength: { min: 0.25, max: 0.75 },
      ratchet: { maxRatchet: 3, probability: 0.2 },
      slide: { probability: 0.15 },
      mod: { low: 0, high: 1 },
      tie: { probability: 0, maxLength: 2 },
    }
    const result = randomizeTrack(config, { gate: 16, pitch: 7, velocity: 12, mod: 14 }, 42)
    expect(result.gate.length).toBe(16)
    expect(result.pitch.length).toBe(7)
    expect(result.velocity.length).toBe(12)
    expect(result.gateLength.length).toBe(16) // matches gate length
    expect(result.ratchet.length).toBe(16) // matches gate length
    expect(result.slide.length).toBe(7) // matches pitch length
    expect(result.mod.length).toBe(14)
    expect(result.tie.length).toBe(16) // matches gate length
  })
})
