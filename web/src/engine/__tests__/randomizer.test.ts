import { describe, expect, it } from 'vitest'
import {
  randomizeGates,
  randomizeMod,
  randomizePitch,
  randomizeTies,
  randomizeTrack,
  randomizeVelocity,
} from '../randomizer'
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
    expect(hits).toBeGreaterThanOrEqual(4) // 0.25 * 16
    expect(hits).toBeLessThanOrEqual(12) // 0.75 * 16
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
    expect(pattern.every((s) => s === false)).toBe(true)
  })

  it('returns all true for fill 1', () => {
    const pattern = randomizeGates({ fillMin: 1, fillMax: 1, mode: 'random' }, 16, 42)
    expect(pattern.every((s) => s === true)).toBe(true)
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
      const pattern = randomizeGates(
        { fillMin: 0.5, fillMax: 0.5, mode: 'cluster', clusterContinuation: 0.9 },
        16,
        seed,
      )
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
      const pattern = randomizeGates(
        { fillMin: 0.5, fillMax: 0.5, mode: 'cluster', clusterContinuation: 0.1 },
        16,
        seed,
      )
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
      const interval = (((note - 60) % 12) + 12) % 12
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
      const interval = (((note - 69) % 12) + 12) % 12
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

describe('randomizePitch modes', () => {
  const baseConfig = { low: 60, high: 72, scale: SCALES.major, root: 60, maxNotes: 0 }

  it('ARP UP mode: cycles through scale notes ascending', () => {
    const notes = randomizePitch({ ...baseConfig, mode: 'arp', arpDirection: 'up' }, 16, 42)
    expect(notes.length).toBe(16)
    // Should cycle — notes[0] should equal notes[scaleNotes.length]
    // Major scale from 60-72: C4,D4,E4,F4,G4,A4,B4,C5 = 8 notes
    expect(notes[0]).toBe(notes[8]) // wraps around
    // First few should be ascending
    for (let i = 1; i < 8; i++) {
      expect(notes[i]).toBeGreaterThanOrEqual(notes[i - 1])
    }
  })

  it('ARP DOWN mode: cycles through scale notes descending', () => {
    const notes = randomizePitch({ ...baseConfig, mode: 'arp', arpDirection: 'down' }, 8, 42)
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i]).toBeLessThanOrEqual(notes[i - 1])
    }
  })

  it('ARP UPDOWN mode: bounces through scale', () => {
    const notes = randomizePitch({ ...baseConfig, mode: 'arp', arpDirection: 'updown' }, 16, 42)
    expect(notes.length).toBe(16)
    // First half-ish ascending, then descending
    expect(notes[0]).toBeLessThan(notes[7])
  })

  it('WALK mode: adjacent steps differ by at most 1 scale degree', () => {
    const scaleNotes = [60, 62, 64, 65, 67, 69, 71, 72] // C major 60-72
    const notes = randomizePitch({ ...baseConfig, mode: 'walk' }, 32, 42)
    for (let i = 1; i < notes.length; i++) {
      const prevIdx = scaleNotes.indexOf(notes[i - 1])
      const curIdx = scaleNotes.indexOf(notes[i])
      expect(prevIdx).toBeGreaterThanOrEqual(0)
      expect(curIdx).toBeGreaterThanOrEqual(0)
      expect(Math.abs(curIdx - prevIdx)).toBeLessThanOrEqual(1)
    }
  })

  it('RISE mode: produces non-decreasing sequence', () => {
    const notes = randomizePitch({ ...baseConfig, mode: 'rise' }, 16, 42)
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i]).toBeGreaterThanOrEqual(notes[i - 1])
    }
    expect(notes[0]).toBe(60) // starts at low
    expect(notes[15]).toBe(72) // ends at high
  })

  it('FALL mode: produces non-increasing sequence', () => {
    const notes = randomizePitch({ ...baseConfig, mode: 'fall' }, 16, 42)
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i]).toBeLessThanOrEqual(notes[i - 1])
    }
    expect(notes[0]).toBe(72) // starts at high
    expect(notes[15]).toBe(60) // ends at low
  })

  it('all pitch modes respect scale constraints', () => {
    const modes = ['random', 'arp', 'walk', 'rise', 'fall'] as const
    for (const mode of modes) {
      const notes = randomizePitch({ ...baseConfig, mode, arpDirection: 'up' }, 16, 42)
      for (const note of notes) {
        expect(note).toBeGreaterThanOrEqual(60)
        expect(note).toBeLessThanOrEqual(72)
        const interval = (((note - 60) % 12) + 12) % 12
        expect(SCALES.major.intervals).toContain(interval)
      }
    }
  })

  it('all pitch modes respect maxNotes', () => {
    const modes = ['random', 'arp', 'walk', 'rise', 'fall'] as const
    for (const mode of modes) {
      const notes = randomizePitch({ ...baseConfig, maxNotes: 3, mode, arpDirection: 'up' }, 32, 42)
      const distinct = new Set(notes)
      expect(distinct.size).toBeLessThanOrEqual(3)
    }
  })
})

describe('randomizeVelocity modes', () => {
  const baseConfig = { low: 40, high: 120 }

  it('ACCENT mode: downbeat positions have higher average velocity', () => {
    let downbeatSum = 0,
      offbeatSum = 0,
      downbeatN = 0,
      offbeatN = 0
    for (let seed = 0; seed < 50; seed++) {
      const vels = randomizeVelocity({ ...baseConfig, mode: 'accent' }, 16, seed)
      for (let i = 0; i < vels.length; i++) {
        if (i % 4 === 0 || i % 4 === 2) {
          downbeatSum += vels[i]
          downbeatN++
        } else {
          offbeatSum += vels[i]
          offbeatN++
        }
      }
    }
    expect(downbeatSum / downbeatN).toBeGreaterThan(offbeatSum / offbeatN)
  })

  it('SYNC mode: offbeat positions have higher average velocity', () => {
    let downbeatSum = 0,
      offbeatSum = 0,
      downbeatN = 0,
      offbeatN = 0
    for (let seed = 0; seed < 50; seed++) {
      const vels = randomizeVelocity({ ...baseConfig, mode: 'sync' }, 16, seed)
      for (let i = 0; i < vels.length; i++) {
        if (i % 4 === 0 || i % 4 === 2) {
          downbeatSum += vels[i]
          downbeatN++
        } else {
          offbeatSum += vels[i]
          offbeatN++
        }
      }
    }
    expect(offbeatSum / offbeatN).toBeGreaterThan(downbeatSum / downbeatN)
  })

  it('RISE mode: produces non-decreasing sequence', () => {
    const vels = randomizeVelocity({ ...baseConfig, mode: 'rise' }, 16, 42)
    expect(vels[0]).toBe(40)
    expect(vels[15]).toBe(120)
    for (let i = 1; i < vels.length; i++) {
      expect(vels[i]).toBeGreaterThanOrEqual(vels[i - 1])
    }
  })

  it('FALL mode: produces non-increasing sequence', () => {
    const vels = randomizeVelocity({ ...baseConfig, mode: 'fall' }, 16, 42)
    expect(vels[0]).toBe(120)
    expect(vels[15]).toBe(40)
    for (let i = 1; i < vels.length; i++) {
      expect(vels[i]).toBeLessThanOrEqual(vels[i - 1])
    }
  })

  it('WALK mode: adjacent values differ by bounded amount', () => {
    const vels = randomizeVelocity({ ...baseConfig, mode: 'walk' }, 32, 42)
    const range = 120 - 40
    const maxStep = Math.max(1, Math.round(range * 0.15))
    for (let i = 1; i < vels.length; i++) {
      expect(Math.abs(vels[i] - vels[i - 1])).toBeLessThanOrEqual(maxStep + 1)
    }
  })

  it('WALK mode: values stay within range', () => {
    const vels = randomizeVelocity({ ...baseConfig, mode: 'walk' }, 64, 42)
    for (const v of vels) {
      expect(v).toBeGreaterThanOrEqual(40)
      expect(v).toBeLessThanOrEqual(120)
    }
  })

  it('all velocity modes produce correct length', () => {
    const modes = ['random', 'accent', 'sync', 'rise', 'fall', 'walk'] as const
    for (const mode of modes) {
      const vels = randomizeVelocity({ ...baseConfig, mode }, 16, 42)
      expect(vels).toHaveLength(16)
    }
  })

  it('all velocity modes produce integer values within range', () => {
    const modes = ['random', 'accent', 'sync', 'rise', 'fall', 'walk'] as const
    for (const mode of modes) {
      const vels = randomizeVelocity({ ...baseConfig, mode }, 16, 42)
      for (const v of vels) {
        expect(v).toBe(Math.floor(v))
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(127)
      }
    }
  })
})

describe('randomizeTies', () => {
  it('returns all false when probability is 0', () => {
    const gatePattern = [true, false, true, true, false, true, false, true]
    const ties = randomizeTies(0, 4, gatePattern, 8, 42)
    expect(ties.length).toBe(8)
    expect(ties.every((t) => t === false)).toBe(true)
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
      pitch: {
        low: 60,
        high: 72,
        scale: SCALES.major,
        root: 60,
        maxNotes: 0,
        mode: 'random' as const,
        arpDirection: 'up' as const,
      },
      gate: { fillMin: 0.25, fillMax: 0.75, mode: 'random' as const, randomOffset: false, clusterContinuation: 0.7 },
      velocity: { low: 64, high: 127, mode: 'random' as const },
      gateLength: { min: 0.25, max: 0.75 },
      ratchet: { maxRatchet: 3, probability: 0.2 },
      slide: { probability: 0.15 },
      mod: { low: 0, high: 1, mode: 'random' as const, slew: 0, slewProbability: 0, walkStepSize: 0.15, syncBias: 0.7 },
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
    // mod steps should be ModStep objects with value and slew
    for (const step of result.mod) {
      expect(step).toHaveProperty('value')
      expect(step).toHaveProperty('slew')
      expect(step.value).toBeGreaterThanOrEqual(0)
      expect(step.value).toBeLessThanOrEqual(1)
    }
    expect(result.tie.length).toBe(16) // matches gate length
  })
})

describe('randomizeMod', () => {
  it('produces ModStep objects with value and slew', () => {
    const config = {
      low: 0,
      high: 1,
      mode: 'random' as const,
      slew: 0,
      slewProbability: 0,
      walkStepSize: 0.15,
      syncBias: 0.7,
    }
    const steps = randomizeMod(config, 16, 42)
    expect(steps.length).toBe(16)
    for (const step of steps) {
      expect(step).toHaveProperty('value')
      expect(step).toHaveProperty('slew')
      expect(step.value).toBeGreaterThanOrEqual(0)
      expect(step.value).toBeLessThanOrEqual(1)
      expect(typeof step.slew).toBe('number')
    }
  })

  it('values fall within configured range', () => {
    const config = {
      low: 0.2,
      high: 0.8,
      mode: 'random' as const,
      slew: 0,
      slewProbability: 0,
      walkStepSize: 0.15,
      syncBias: 0.7,
    }
    const steps = randomizeMod(config, 32, 99)
    for (const step of steps) {
      expect(step.value).toBeGreaterThanOrEqual(0.2)
      expect(step.value).toBeLessThanOrEqual(0.8)
    }
  })

  it('is deterministic with same seed', () => {
    const config = {
      low: 0,
      high: 1,
      mode: 'random' as const,
      slew: 0,
      slewProbability: 0,
      walkStepSize: 0.15,
      syncBias: 0.7,
    }
    const a = randomizeMod(config, 16, 42)
    const b = randomizeMod(config, 16, 42)
    expect(a).toEqual(b)
  })
})

describe('randomizeMod modes', () => {
  // Test all 7 modes: random, rise, fall, vee, hill, sync, walk

  const baseConfig = {
    low: 0.2,
    high: 0.8,
    mode: 'random' as const,
    slew: 0.5,
    slewProbability: 0.5,
    walkStepSize: 0.15,
    syncBias: 0.7,
  }

  it('RISE mode: values monotonically increase from low to high', () => {
    const steps = randomizeMod({ ...baseConfig, mode: 'rise' }, 16, 42)
    expect(steps).toHaveLength(16)
    expect(steps[0].value).toBeCloseTo(0.2, 1)
    expect(steps[15].value).toBeCloseTo(0.8, 1)
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].value).toBeGreaterThanOrEqual(steps[i - 1].value - 0.001)
    }
  })

  it('FALL mode: values monotonically decrease from high to low', () => {
    const steps = randomizeMod({ ...baseConfig, mode: 'fall' }, 16, 42)
    expect(steps[0].value).toBeCloseTo(0.8, 1)
    expect(steps[15].value).toBeCloseTo(0.2, 1)
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].value).toBeLessThanOrEqual(steps[i - 1].value + 0.001)
    }
  })

  it('HILL mode: values increase to midpoint then decrease', () => {
    const steps = randomizeMod({ ...baseConfig, mode: 'hill' }, 16, 42)
    expect(steps[0].value).toBeCloseTo(0.2, 1)
    // Middle should be near high
    const mid = Math.floor(steps.length / 2)
    expect(steps[mid].value).toBeGreaterThan(0.6)
    expect(steps[15].value).toBeCloseTo(0.2, 1)
  })

  it('VEE mode: values decrease to midpoint then increase', () => {
    const steps = randomizeMod({ ...baseConfig, mode: 'vee' }, 16, 42)
    expect(steps[0].value).toBeCloseTo(0.8, 1)
    const mid = Math.floor(steps.length / 2)
    expect(steps[mid].value).toBeLessThan(0.4)
    expect(steps[15].value).toBeCloseTo(0.8, 1)
  })

  it('WALK mode: adjacent values differ by at most walkStepSize', () => {
    const cfg = { ...baseConfig, mode: 'walk' as const, walkStepSize: 0.1 }
    const steps = randomizeMod(cfg, 32, 42)
    for (let i = 1; i < steps.length; i++) {
      expect(Math.abs(steps[i].value - steps[i - 1].value)).toBeLessThanOrEqual(0.1 + 0.01)
    }
  })

  it('WALK mode: values stay within low/high bounds', () => {
    const cfg = { ...baseConfig, mode: 'walk' as const }
    const steps = randomizeMod(cfg, 64, 42)
    for (const step of steps) {
      expect(step.value).toBeGreaterThanOrEqual(baseConfig.low - 0.01)
      expect(step.value).toBeLessThanOrEqual(baseConfig.high + 0.01)
    }
  })

  it('SYNC mode: offbeat positions get higher average values than downbeats', () => {
    const cfg = { ...baseConfig, mode: 'sync' as const, syncBias: 1.0, slewProbability: 0 }
    // Run many iterations to get statistical average
    let downbeatSum = 0,
      offbeatSum = 0,
      downbeatN = 0,
      offbeatN = 0
    for (let seed = 0; seed < 50; seed++) {
      const steps = randomizeMod(cfg, 16, seed)
      for (let i = 0; i < steps.length; i++) {
        if (i % 4 === 0) {
          downbeatSum += steps[i].value
          downbeatN++
        } else {
          offbeatSum += steps[i].value
          offbeatN++
        }
      }
    }
    expect(offbeatSum / offbeatN).toBeGreaterThan(downbeatSum / downbeatN)
  })

  it('all modes produce correct length', () => {
    const modes = ['random', 'rise', 'fall', 'vee', 'hill', 'sync', 'walk'] as const
    for (const mode of modes) {
      const steps = randomizeMod({ ...baseConfig, mode }, 8, 42)
      expect(steps).toHaveLength(8)
    }
  })

  it('ramp modes apply uniform slew', () => {
    const cfg = { ...baseConfig, mode: 'rise' as const, slew: 0.7 }
    const steps = randomizeMod(cfg, 8, 42)
    for (const step of steps) {
      expect(step.slew).toBe(0.7)
    }
  })

  it('random mode respects slewProbability', () => {
    const cfg = { ...baseConfig, mode: 'random' as const, slew: 0.5, slewProbability: 1.0 }
    const steps = randomizeMod(cfg, 16, 42)
    // All steps should have slew when probability is 1.0
    for (const step of steps) {
      expect(step.slew).toBe(0.5)
    }
  })

  it('deterministic: same seed produces same output', () => {
    const a = randomizeMod(baseConfig, 16, 99)
    const b = randomizeMod(baseConfig, 16, 99)
    expect(a).toEqual(b)
  })
})
