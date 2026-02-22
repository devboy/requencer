import { describe, it, expect } from 'vitest'
import { shouldTick, getEffectiveStep } from '../clock-divider'

describe('shouldTick', () => {
  it('ticks every time with dividers of 1', () => {
    expect(shouldTick(0, 1, 1)).toBe(true)
    expect(shouldTick(1, 1, 1)).toBe(true)
    expect(shouldTick(99, 1, 1)).toBe(true)
  })

  it('ticks every 2nd master tick with track divider 2', () => {
    expect(shouldTick(0, 2, 1)).toBe(true)
    expect(shouldTick(1, 2, 1)).toBe(false)
    expect(shouldTick(2, 2, 1)).toBe(true)
    expect(shouldTick(3, 2, 1)).toBe(false)
  })

  it('ticks every 4th master tick with combined dividers 2×2', () => {
    expect(shouldTick(0, 2, 2)).toBe(true)
    expect(shouldTick(1, 2, 2)).toBe(false)
    expect(shouldTick(2, 2, 2)).toBe(false)
    expect(shouldTick(3, 2, 2)).toBe(false)
    expect(shouldTick(4, 2, 2)).toBe(true)
  })

  it('ticks every 3rd master tick with track divider 3', () => {
    expect(shouldTick(0, 3, 1)).toBe(true)
    expect(shouldTick(1, 3, 1)).toBe(false)
    expect(shouldTick(2, 3, 1)).toBe(false)
    expect(shouldTick(3, 3, 1)).toBe(true)
  })

  it('ticks every 6th master tick with combined dividers 2×3', () => {
    expect(shouldTick(0, 2, 3)).toBe(true)
    expect(shouldTick(5, 2, 3)).toBe(false)
    expect(shouldTick(6, 2, 3)).toBe(true)
    expect(shouldTick(12, 2, 3)).toBe(true)
  })
})

describe('getEffectiveStep', () => {
  it('returns step directly when dividers are 1', () => {
    expect(getEffectiveStep(0, 1, 1, 16)).toBe(0)
    expect(getEffectiveStep(1, 1, 1, 16)).toBe(1)
    expect(getEffectiveStep(15, 1, 1, 16)).toBe(15)
  })

  it('wraps around at subtrack length', () => {
    expect(getEffectiveStep(16, 1, 1, 16)).toBe(0)
    expect(getEffectiveStep(17, 1, 1, 16)).toBe(1)
  })

  it('divides by track divider before computing step', () => {
    // track div 2: tick 0→step 0, tick 2→step 1, tick 4→step 2
    expect(getEffectiveStep(0, 2, 1, 4)).toBe(0)
    expect(getEffectiveStep(2, 2, 1, 4)).toBe(1)
    expect(getEffectiveStep(4, 2, 1, 4)).toBe(2)
    expect(getEffectiveStep(8, 2, 1, 4)).toBe(0) // wraps: 8/2=4, 4%4=0
  })

  it('divides by combined divider with both levels', () => {
    // combined div 4 (2×2): tick 0→step 0, tick 4→step 1, tick 8→step 2
    expect(getEffectiveStep(0, 2, 2, 4)).toBe(0)
    expect(getEffectiveStep(4, 2, 2, 4)).toBe(1)
    expect(getEffectiveStep(8, 2, 2, 4)).toBe(2)
    expect(getEffectiveStep(16, 2, 2, 4)).toBe(0) // 16/4=4, 4%4=0
  })

  it('handles short subtrack lengths for polyrhythms', () => {
    // length 3 with divider 1: wraps at 3
    expect(getEffectiveStep(0, 1, 1, 3)).toBe(0)
    expect(getEffectiveStep(2, 1, 1, 3)).toBe(2)
    expect(getEffectiveStep(3, 1, 1, 3)).toBe(0)
    expect(getEffectiveStep(7, 1, 1, 3)).toBe(1) // 7%3=1
  })
})
