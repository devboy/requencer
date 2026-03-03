import { describe, expect, it } from 'vitest'
import { createRng } from '../rng'

describe('createRng', () => {
  it('returns a function', () => {
    const rng = createRng(42)
    expect(typeof rng).toBe('function')
  })

  it('produces values between 0 and 1', () => {
    const rng = createRng(42)
    for (let i = 0; i < 100; i++) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('is deterministic — same seed produces same sequence', () => {
    const rng1 = createRng(42)
    const rng2 = createRng(42)
    for (let i = 0; i < 20; i++) {
      expect(rng1()).toBe(rng2())
    }
  })

  it('different seeds produce different sequences', () => {
    const rng1 = createRng(42)
    const rng2 = createRng(99)
    const values1 = Array.from({ length: 5 }, () => rng1())
    const values2 = Array.from({ length: 5 }, () => rng2())
    expect(values1).not.toEqual(values2)
  })

  it('has reasonable distribution', () => {
    const rng = createRng(12345)
    let belowHalf = 0
    const n = 1000
    for (let i = 0; i < n; i++) {
      if (rng() < 0.5) belowHalf++
    }
    // Should be roughly 50% — allow ±10%
    expect(belowHalf / n).toBeGreaterThan(0.4)
    expect(belowHalf / n).toBeLessThan(0.6)
  })
})
