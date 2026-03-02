import { describe, it, expect } from 'vitest'
import { randomizeGates, randomizePitch, randomizeVelocity, randomizeTrack } from '../randomizer'
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

describe('randomizeTrack', () => {
  it('generates all subtracks with independent lengths', () => {
    const config = {
      pitch: { low: 60, high: 72, scale: SCALES.major, root: 60, maxNotes: 0 },
      gate: { fillMin: 0.25, fillMax: 0.75, mode: 'random' as const, randomOffset: false, smartBars: 1, smartDensity: 'build' as const },
      velocity: { low: 64, high: 127 },
      gateLength: { min: 0.25, max: 0.75 },
      ratchet: { maxRatchet: 3, probability: 0.2 },
      slide: { probability: 0.15 },
      mod: { low: 0, high: 1 },
    }
    const result = randomizeTrack(config, { gate: 16, pitch: 7, velocity: 12, mod: 14 }, 42)
    expect(result.gate.length).toBe(16)
    expect(result.pitch.length).toBe(7)
    expect(result.velocity.length).toBe(12)
    expect(result.gateLength.length).toBe(16) // matches gate length
    expect(result.ratchet.length).toBe(16) // matches gate length
    expect(result.slide.length).toBe(7) // matches pitch length
    expect(result.mod.length).toBe(14)
  })
})
