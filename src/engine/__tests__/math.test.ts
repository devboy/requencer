import { describe, expect, it } from 'vitest'
import { clamp } from '../math'

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('clamps to min when below range', () => {
    expect(clamp(-3, 0, 10)).toBe(0)
  })

  it('clamps to max when above range', () => {
    expect(clamp(15, 0, 10)).toBe(10)
  })

  it('returns min when value equals min', () => {
    expect(clamp(0, 0, 10)).toBe(0)
  })

  it('returns max when value equals max', () => {
    expect(clamp(10, 0, 10)).toBe(10)
  })

  it('works with negative ranges', () => {
    expect(clamp(-5, -10, -1)).toBe(-5)
    expect(clamp(0, -10, -1)).toBe(-1)
    expect(clamp(-20, -10, -1)).toBe(-10)
  })

  it('works with fractional values', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5)
    expect(clamp(-0.1, 0, 1)).toBe(0)
    expect(clamp(1.5, 0, 1)).toBe(1)
  })
})
