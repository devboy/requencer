import { describe, expect, it } from 'vitest'
import { createClockRecovery, processClockTick, resetClockRecovery } from '../clock-recovery'

describe('clock-recovery', () => {
  it('initializes with zero BPM', () => {
    const state = createClockRecovery()
    expect(state.bpm).toBe(0)
    expect(state.intervals).toEqual([])
    expect(state.lastTickTime).toBe(-1)
  })

  it('recovers 120 BPM from steady clock', () => {
    // 120 BPM = 2 beats/sec = 48 ticks/sec at 24 PPQN
    // tick interval = 1/48 = 0.0208333... seconds
    const intervalSec = 60 / 120 / 24 // = 0.020833...
    let state = createClockRecovery()

    // Send enough ticks to fill the window
    for (let i = 0; i < 30; i++) {
      state = processClockTick(state, i * intervalSec)
    }

    expect(state.bpm).toBe(120)
  })

  it('recovers 135 BPM from steady clock', () => {
    const intervalSec = 60 / 135 / 24
    let state = createClockRecovery()

    for (let i = 0; i < 30; i++) {
      state = processClockTick(state, i * intervalSec)
    }

    expect(state.bpm).toBe(135)
  })

  it('recovers 60 BPM (slow tempo)', () => {
    const intervalSec = 60 / 60 / 24 // = 0.041666...
    let state = createClockRecovery()

    for (let i = 0; i < 30; i++) {
      state = processClockTick(state, i * intervalSec)
    }

    expect(state.bpm).toBe(60)
  })

  it('recovers 200 BPM (fast tempo)', () => {
    const intervalSec = 60 / 200 / 24
    let state = createClockRecovery()

    for (let i = 0; i < 30; i++) {
      state = processClockTick(state, i * intervalSec)
    }

    expect(state.bpm).toBe(200)
  })

  it('needs at least 4 intervals before reporting BPM', () => {
    const intervalSec = 60 / 120 / 24
    let state = createClockRecovery()

    // First tick: no interval yet
    state = processClockTick(state, 0)
    expect(state.bpm).toBe(0)

    // Second tick: 1 interval
    state = processClockTick(state, intervalSec)
    expect(state.bpm).toBe(0)

    // Third tick: 2 intervals
    state = processClockTick(state, 2 * intervalSec)
    expect(state.bpm).toBe(0)

    // Fourth tick: 3 intervals
    state = processClockTick(state, 3 * intervalSec)
    expect(state.bpm).toBe(0)

    // Fifth tick: 4 intervals — now we get BPM
    state = processClockTick(state, 4 * intervalSec)
    expect(state.bpm).toBe(120)
  })

  it('handles jittery clock with ±10% noise', () => {
    const baseBpm = 120
    const baseInterval = 60 / baseBpm / 24
    let state = createClockRecovery()
    let time = 0

    // Send 48 ticks with ±10% jitter (deterministic pattern)
    for (let i = 0; i < 48; i++) {
      state = processClockTick(state, time)
      // Alternate +5% and -5% jitter
      const jitter = i % 2 === 0 ? 1.05 : 0.95
      time += baseInterval * jitter
    }

    // Should recover close to 120 BPM despite jitter
    expect(state.bpm).toBeGreaterThanOrEqual(118)
    expect(state.bpm).toBeLessThanOrEqual(122)
  })

  it('rejects intervals < 1ms (glitches)', () => {
    const intervalSec = 60 / 120 / 24
    let state = createClockRecovery()

    // Build up some valid data
    for (let i = 0; i < 10; i++) {
      state = processClockTick(state, i * intervalSec)
    }
    const bpmBefore = state.bpm

    // Inject a glitch (0.5ms interval)
    const lastTime = state.lastTickTime
    state = processClockTick(state, lastTime + 0.0005)

    // BPM should not change from the glitch
    expect(state.bpm).toBe(bpmBefore)
  })

  it('rejects intervals > 2s (stalls)', () => {
    const intervalSec = 60 / 120 / 24
    let state = createClockRecovery()

    for (let i = 0; i < 10; i++) {
      state = processClockTick(state, i * intervalSec)
    }
    const bpmBefore = state.bpm

    // Inject a stall (3s gap)
    const lastTime = state.lastTickTime
    state = processClockTick(state, lastTime + 3.0)

    // BPM should not change from the stall
    expect(state.bpm).toBe(bpmBefore)
  })

  it('clamps BPM to 20-300 range', () => {
    // Very slow clock — would compute as < 20 BPM
    const slowInterval = 60 / 15 / 24 // 15 BPM worth
    let state = createClockRecovery()
    for (let i = 0; i < 10; i++) {
      state = processClockTick(state, i * slowInterval)
    }
    expect(state.bpm).toBe(20)
  })

  it('resetClockRecovery clears all state', () => {
    const intervalSec = 60 / 120 / 24
    let state = createClockRecovery()
    for (let i = 0; i < 10; i++) {
      state = processClockTick(state, i * intervalSec)
    }
    expect(state.bpm).toBeGreaterThan(0)

    state = resetClockRecovery()
    expect(state.bpm).toBe(0)
    expect(state.intervals).toEqual([])
    expect(state.lastTickTime).toBe(-1)
  })

  it('adapts when tempo changes', () => {
    let state = createClockRecovery()
    let time = 0

    // Start at 120 BPM
    const interval120 = 60 / 120 / 24
    for (let i = 0; i < 30; i++) {
      state = processClockTick(state, time)
      time += interval120
    }
    expect(state.bpm).toBe(120)

    // Switch to 140 BPM
    const interval140 = 60 / 140 / 24
    for (let i = 0; i < 48; i++) {
      state = processClockTick(state, time)
      time += interval140
    }
    expect(state.bpm).toBe(140)
  })

  it('window size limits old data influence', () => {
    let state = createClockRecovery()
    let time = 0

    // 100 ticks at 100 BPM
    const interval100 = 60 / 100 / 24
    for (let i = 0; i < 100; i++) {
      state = processClockTick(state, time)
      time += interval100
    }

    // Window is 24, so only the last 24 intervals are kept
    expect(state.intervals.length).toBe(24)
  })
})
