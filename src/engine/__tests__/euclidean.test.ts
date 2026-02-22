import { describe, it, expect } from 'vitest'
import { euclidean } from '../euclidean'

describe('euclidean', () => {
  it('distributes 4 hits evenly across 16 steps', () => {
    const pattern = euclidean(4, 16)
    expect(pattern.length).toBe(16)
    expect(pattern.filter(Boolean).length).toBe(4)
    // Every 4th step should be a hit
    expect(pattern).toEqual([
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
    ])
  })

  it('produces the tresillo rhythm for (3, 8)', () => {
    const pattern = euclidean(3, 8)
    expect(pattern.length).toBe(8)
    expect(pattern.filter(Boolean).length).toBe(3)
    // Tresillo: [x..x..x.]
    expect(pattern).toEqual([
      true, false, false, true, false, false, true, false,
    ])
  })

  it('produces the cinquillo rhythm for (5, 8)', () => {
    const pattern = euclidean(5, 8)
    expect(pattern.length).toBe(8)
    expect(pattern.filter(Boolean).length).toBe(5)
    // Cinquillo: [x.xx.xx.]
    expect(pattern).toEqual([
      true, false, true, true, false, true, true, false,
    ])
  })

  it('returns all false for 0 hits', () => {
    const pattern = euclidean(0, 16)
    expect(pattern.length).toBe(16)
    expect(pattern.every(s => s === false)).toBe(true)
  })

  it('returns all true when hits equals length', () => {
    const pattern = euclidean(16, 16)
    expect(pattern.length).toBe(16)
    expect(pattern.every(s => s === true)).toBe(true)
  })

  it('handles (1, 4) — single hit', () => {
    const pattern = euclidean(1, 4)
    expect(pattern).toEqual([true, false, false, false])
  })

  it('handles (7, 12) — west african bell pattern', () => {
    const pattern = euclidean(7, 12)
    expect(pattern.length).toBe(12)
    expect(pattern.filter(Boolean).length).toBe(7)
  })

  it('returns empty array for length 0', () => {
    const pattern = euclidean(0, 0)
    expect(pattern).toEqual([])
  })
})
