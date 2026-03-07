import { describe, expect, it } from 'vitest'
import { createClockRecovery, processClockTick, resetClockRecovery } from '../clock-recovery'

describe('createClockRecovery', () => {
  it('returns initial state with no data', () => {
    const state = createClockRecovery()
    expect(state.intervals).toEqual([])
    expect(state.lastTickTime).toBe(-1)
    expect(state.bpm).toBe(0)
  })
})

describe('resetClockRecovery', () => {
  it('returns same shape as createClockRecovery', () => {
    expect(resetClockRecovery()).toEqual(createClockRecovery())
  })
})

describe('processClockTick', () => {
  it('records first tick without computing BPM', () => {
    const state = createClockRecovery()
    const next = processClockTick(state, 1.0)
    expect(next.lastTickTime).toBe(1.0)
    expect(next.bpm).toBe(0)
    expect(next.intervals).toEqual([])
  })

  it('does not compute BPM with fewer than 4 intervals', () => {
    let state = createClockRecovery()
    // Feed 4 ticks = 3 intervals (not enough)
    for (let i = 0; i < 4; i++) {
      state = processClockTick(state, i * 0.02)
    }
    expect(state.intervals).toHaveLength(3)
    expect(state.bpm).toBe(0)
  })

  it('computes BPM once 4 intervals are available', () => {
    let state = createClockRecovery()
    // 120 BPM = 0.5s per quarter note, 24 PPQN → interval = 0.5/24 ≈ 0.020833s
    const interval = 0.5 / 24
    for (let i = 0; i < 6; i++) {
      state = processClockTick(state, i * interval)
    }
    expect(state.intervals).toHaveLength(5)
    expect(state.bpm).toBe(120)
  })

  it('recovers 60 BPM correctly', () => {
    let state = createClockRecovery()
    // 60 BPM = 1.0s per quarter note, 24 PPQN → interval = 1/24 ≈ 0.041667s
    const interval = 1.0 / 24
    for (let i = 0; i < 6; i++) {
      state = processClockTick(state, i * interval)
    }
    expect(state.bpm).toBe(60)
  })

  it('recovers 200 BPM correctly', () => {
    let state = createClockRecovery()
    // 200 BPM = 0.3s per quarter note, 24 PPQN → interval = 0.3/24 = 0.0125s
    const interval = 0.3 / 24
    for (let i = 0; i < 6; i++) {
      state = processClockTick(state, i * interval)
    }
    expect(state.bpm).toBe(200)
  })

  it('rejects intervals shorter than 1ms', () => {
    let state = createClockRecovery()
    state = processClockTick(state, 1.0)
    state = processClockTick(state, 1.0005) // 0.5ms — too short
    expect(state.intervals).toEqual([])
    expect(state.lastTickTime).toBe(1.0005)
  })

  it('rejects intervals longer than 2s', () => {
    let state = createClockRecovery()
    state = processClockTick(state, 0)
    state = processClockTick(state, 3.0) // 3s — too long
    expect(state.intervals).toEqual([])
    expect(state.lastTickTime).toBe(3.0)
  })

  it('clamps BPM to minimum 20', () => {
    let state = createClockRecovery()
    // Very slow: interval near 2.0s → BPM ≈ 60/(2*24) ≈ 1.25 → clamped to 20
    const interval = 1.9
    for (let i = 0; i < 6; i++) {
      state = processClockTick(state, i * interval)
    }
    expect(state.bpm).toBe(20)
  })

  it('clamps BPM to maximum 300', () => {
    let state = createClockRecovery()
    // Very fast: interval = 0.001s → BPM = 60/(0.001*24) = 2500 → clamped to 300
    const interval = 0.001
    for (let i = 0; i < 6; i++) {
      state = processClockTick(state, i * interval)
    }
    expect(state.bpm).toBe(300)
  })

  it('keeps only WINDOW_SIZE (24) intervals', () => {
    let state = createClockRecovery()
    const interval = 0.5 / 24 // 120 BPM
    // Feed 30 ticks = 29 intervals, should keep only 24
    for (let i = 0; i < 30; i++) {
      state = processClockTick(state, i * interval)
    }
    expect(state.intervals).toHaveLength(24)
    expect(state.bpm).toBe(120)
  })

  it('does not mutate previous state', () => {
    const state = createClockRecovery()
    const next = processClockTick(state, 1.0)
    expect(state.lastTickTime).toBe(-1)
    expect(next.lastTickTime).toBe(1.0)
  })
})
