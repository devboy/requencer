import { describe, it, expect } from 'vitest'
import { lfoValue, generateLFOPattern } from '../lfo'

describe('lfoValue', () => {
  it('sine: 0 at phase 0, peaks at 0.25, returns to 0 at 0.5', () => {
    expect(lfoValue('sine', 0)).toBeCloseTo(0.5, 2)
    expect(lfoValue('sine', 0.25)).toBeCloseTo(1.0, 2)
    expect(lfoValue('sine', 0.5)).toBeCloseTo(0.5, 2)
    expect(lfoValue('sine', 0.75)).toBeCloseTo(0.0, 2)
  })

  it('triangle: ramps up then down', () => {
    expect(lfoValue('triangle', 0)).toBeCloseTo(0.0, 2)
    expect(lfoValue('triangle', 0.25)).toBeCloseTo(0.5, 2)
    expect(lfoValue('triangle', 0.5)).toBeCloseTo(1.0, 2)
    expect(lfoValue('triangle', 0.75)).toBeCloseTo(0.5, 2)
  })

  it('saw: ramps from 0 to 1', () => {
    expect(lfoValue('saw', 0)).toBeCloseTo(0.0, 2)
    expect(lfoValue('saw', 0.5)).toBeCloseTo(0.5, 2)
    expect(lfoValue('saw', 0.99)).toBeCloseTo(0.99, 1)
  })

  it('slew-random: returns values between 0 and 1', () => {
    // Slew-random is seed-dependent, just check range
    for (let phase = 0; phase < 1; phase += 0.1) {
      const v = lfoValue('slew-random', phase, 42)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('generateLFOPattern', () => {
  it('generates correct length', () => {
    const pattern = generateLFOPattern({ waveform: 'sine', rate: 16, depth: 1, offset: 0.5 }, 16)
    expect(pattern.length).toBe(16)
  })

  it('sine pattern values are in 0-1 range', () => {
    const pattern = generateLFOPattern({ waveform: 'sine', rate: 16, depth: 1, offset: 0.5 }, 16)
    for (const v of pattern) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('depth scales the amplitude', () => {
    const full = generateLFOPattern({ waveform: 'sine', rate: 16, depth: 1, offset: 0.5 }, 16)
    const half = generateLFOPattern({ waveform: 'sine', rate: 16, depth: 0.5, offset: 0.5 }, 16)
    // Half depth should have smaller range
    const fullRange = Math.max(...full) - Math.min(...full)
    const halfRange = Math.max(...half) - Math.min(...half)
    expect(halfRange).toBeLessThan(fullRange)
  })

  it('offset shifts the center', () => {
    const low = generateLFOPattern({ waveform: 'sine', rate: 16, depth: 0.2, offset: 0.2 }, 16)
    const high = generateLFOPattern({ waveform: 'sine', rate: 16, depth: 0.2, offset: 0.8 }, 16)
    const avgLow = low.reduce((a, b) => a + b) / low.length
    const avgHigh = high.reduce((a, b) => a + b) / high.length
    expect(avgHigh).toBeGreaterThan(avgLow)
  })

  it('rate controls the cycle length', () => {
    // rate=16 means one full cycle in 16 steps → with 32 steps we get 2 cycles
    const pattern = generateLFOPattern({ waveform: 'saw', rate: 16, depth: 1, offset: 0.5 }, 32)
    expect(pattern.length).toBe(32)
    // Step 0 and step 16 should be similar (start of new cycle)
    expect(pattern[0]).toBeCloseTo(pattern[16], 1)
  })

  it('clamps output to 0-1', () => {
    // Large depth + high offset could exceed 1.0 without clamping
    const pattern = generateLFOPattern({ waveform: 'sine', rate: 8, depth: 1, offset: 0.9 }, 16)
    for (const v of pattern) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})
