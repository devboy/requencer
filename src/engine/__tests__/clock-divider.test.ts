import { describe, expect, it } from 'vitest'
import { getEffectiveStep, shouldTick, TICKS_PER_STEP } from '../clock-divider'

describe('shouldTick', () => {
  it('ticks at step boundaries with dividers of 1', () => {
    expect(shouldTick(0, 1, 1)).toBe(true)
    expect(shouldTick(TICKS_PER_STEP, 1, 1)).toBe(true)
    expect(shouldTick(99 * TICKS_PER_STEP, 1, 1)).toBe(true)
  })

  it('does not tick between step boundaries', () => {
    expect(shouldTick(1, 1, 1)).toBe(false)
    expect(shouldTick(TICKS_PER_STEP - 1, 1, 1)).toBe(false)
  })

  it('ticks every 2nd step with track divider 2', () => {
    expect(shouldTick(0, 2, 1)).toBe(true)
    expect(shouldTick(TICKS_PER_STEP, 2, 1)).toBe(false)
    expect(shouldTick(2 * TICKS_PER_STEP, 2, 1)).toBe(true)
    expect(shouldTick(3 * TICKS_PER_STEP, 2, 1)).toBe(false)
  })

  it('ticks every 4th step with combined dividers 2×2', () => {
    expect(shouldTick(0, 2, 2)).toBe(true)
    expect(shouldTick(1 * TICKS_PER_STEP, 2, 2)).toBe(false)
    expect(shouldTick(2 * TICKS_PER_STEP, 2, 2)).toBe(false)
    expect(shouldTick(3 * TICKS_PER_STEP, 2, 2)).toBe(false)
    expect(shouldTick(4 * TICKS_PER_STEP, 2, 2)).toBe(true)
  })

  it('ticks every 3rd step with track divider 3', () => {
    expect(shouldTick(0, 3, 1)).toBe(true)
    expect(shouldTick(1 * TICKS_PER_STEP, 3, 1)).toBe(false)
    expect(shouldTick(2 * TICKS_PER_STEP, 3, 1)).toBe(false)
    expect(shouldTick(3 * TICKS_PER_STEP, 3, 1)).toBe(true)
  })

  it('ticks every 6th step with combined dividers 2×3', () => {
    expect(shouldTick(0, 2, 3)).toBe(true)
    expect(shouldTick(5 * TICKS_PER_STEP, 2, 3)).toBe(false)
    expect(shouldTick(6 * TICKS_PER_STEP, 2, 3)).toBe(true)
    expect(shouldTick(12 * TICKS_PER_STEP, 2, 3)).toBe(true)
  })
})

describe('getEffectiveStep', () => {
  it('returns step directly when dividers are 1', () => {
    expect(getEffectiveStep(0, 1, 1, 16)).toBe(0)
    expect(getEffectiveStep(TICKS_PER_STEP, 1, 1, 16)).toBe(1)
    expect(getEffectiveStep(15 * TICKS_PER_STEP, 1, 1, 16)).toBe(15)
  })

  it('returns same step for sub-ticks within a step', () => {
    expect(getEffectiveStep(0, 1, 1, 16)).toBe(0)
    expect(getEffectiveStep(1, 1, 1, 16)).toBe(0)
    expect(getEffectiveStep(TICKS_PER_STEP - 1, 1, 1, 16)).toBe(0)
    expect(getEffectiveStep(TICKS_PER_STEP, 1, 1, 16)).toBe(1)
  })

  it('wraps around at subtrack length', () => {
    expect(getEffectiveStep(16 * TICKS_PER_STEP, 1, 1, 16)).toBe(0)
    expect(getEffectiveStep(17 * TICKS_PER_STEP, 1, 1, 16)).toBe(1)
  })

  it('divides by track divider before computing step', () => {
    // track div 2: step 0 at tick 0, step 1 at tick 2*TPS, step 2 at tick 4*TPS
    expect(getEffectiveStep(0, 2, 1, 4)).toBe(0)
    expect(getEffectiveStep(2 * TICKS_PER_STEP, 2, 1, 4)).toBe(1)
    expect(getEffectiveStep(4 * TICKS_PER_STEP, 2, 1, 4)).toBe(2)
    expect(getEffectiveStep(8 * TICKS_PER_STEP, 2, 1, 4)).toBe(0) // wraps: 8/2=4, 4%4=0
  })

  it('divides by combined divider with both levels', () => {
    // combined div 4 (2×2): step 0 at tick 0, step 1 at tick 4*TPS, step 2 at tick 8*TPS
    expect(getEffectiveStep(0, 2, 2, 4)).toBe(0)
    expect(getEffectiveStep(4 * TICKS_PER_STEP, 2, 2, 4)).toBe(1)
    expect(getEffectiveStep(8 * TICKS_PER_STEP, 2, 2, 4)).toBe(2)
    expect(getEffectiveStep(16 * TICKS_PER_STEP, 2, 2, 4)).toBe(0) // 16/4=4, 4%4=0
  })

  it('handles short subtrack lengths for polyrhythms', () => {
    // length 3 with divider 1: wraps at 3
    expect(getEffectiveStep(0, 1, 1, 3)).toBe(0)
    expect(getEffectiveStep(2 * TICKS_PER_STEP, 1, 1, 3)).toBe(2)
    expect(getEffectiveStep(3 * TICKS_PER_STEP, 1, 1, 3)).toBe(0)
    expect(getEffectiveStep(7 * TICKS_PER_STEP, 1, 1, 3)).toBe(1) // 7%3=1
  })
})
