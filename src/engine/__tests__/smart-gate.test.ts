import { describe, it, expect } from 'vitest'
import { generateSmartGatePattern } from '../smart-gate'

describe('generateSmartGatePattern', () => {
  it('returns pattern of correct total length', () => {
    const pattern = generateSmartGatePattern({
      fillMin: 0.25,
      fillMax: 0.75,
      stepsPerBar: 16,
      bars: 4,
      density: 'build',
      seed: 42,
    })
    expect(pattern.length).toBe(64) // 16 * 4
  })

  it('build mode: later bars have more gates than earlier', () => {
    const pattern = generateSmartGatePattern({
      fillMin: 0.1,
      fillMax: 0.9,
      stepsPerBar: 16,
      bars: 4,
      density: 'build',
      seed: 42,
    })
    // Count gates per bar
    const counts = []
    for (let b = 0; b < 4; b++) {
      const barSlice = pattern.slice(b * 16, (b + 1) * 16)
      counts.push(barSlice.filter(Boolean).length)
    }
    // Build: each bar should have >= previous bar density
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1])
    }
  })

  it('decay mode: earlier bars have more gates than later', () => {
    const pattern = generateSmartGatePattern({
      fillMin: 0.1,
      fillMax: 0.9,
      stepsPerBar: 16,
      bars: 4,
      density: 'decay',
      seed: 42,
    })
    const counts = []
    for (let b = 0; b < 4; b++) {
      const barSlice = pattern.slice(b * 16, (b + 1) * 16)
      counts.push(barSlice.filter(Boolean).length)
    }
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1])
    }
  })

  it('build-drop mode: last bar has fewer gates than penultimate', () => {
    const pattern = generateSmartGatePattern({
      fillMin: 0.2,
      fillMax: 0.9,
      stepsPerBar: 16,
      bars: 4,
      density: 'build-drop',
      seed: 42,
    })
    const counts = []
    for (let b = 0; b < 4; b++) {
      const barSlice = pattern.slice(b * 16, (b + 1) * 16)
      counts.push(barSlice.filter(Boolean).length)
    }
    // Last bar drops
    expect(counts[3]).toBeLessThan(counts[2])
  })

  it('variation mode: all bars have similar density', () => {
    const pattern = generateSmartGatePattern({
      fillMin: 0.4,
      fillMax: 0.6,
      stepsPerBar: 16,
      bars: 4,
      density: 'variation',
      seed: 42,
    })
    const counts = []
    for (let b = 0; b < 4; b++) {
      const barSlice = pattern.slice(b * 16, (b + 1) * 16)
      counts.push(barSlice.filter(Boolean).length)
    }
    // All bars should be within a reasonable range (within 4 steps of each other)
    const minCount = Math.min(...counts)
    const maxCount = Math.max(...counts)
    expect(maxCount - minCount).toBeLessThanOrEqual(4)
  })

  it('1-bar pattern is just regular random gates', () => {
    const pattern = generateSmartGatePattern({
      fillMin: 0.5,
      fillMax: 0.5,
      stepsPerBar: 16,
      bars: 1,
      density: 'build',
      seed: 42,
    })
    expect(pattern.length).toBe(16)
    expect(pattern.filter(Boolean).length).toBe(8)
  })

  it('is seeded/deterministic', () => {
    const p1 = generateSmartGatePattern({ fillMin: 0.3, fillMax: 0.7, stepsPerBar: 16, bars: 2, density: 'build', seed: 42 })
    const p2 = generateSmartGatePattern({ fillMin: 0.3, fillMax: 0.7, stepsPerBar: 16, bars: 2, density: 'build', seed: 42 })
    expect(p1).toEqual(p2)
  })
})
