/**
 * Clock recovery — pure logic for deriving BPM from MIDI clock timestamps.
 * No DOM/audio dependencies. Designed for testability and future Rust port.
 *
 * Uses a moving-average filter over recent clock intervals to smooth jitter.
 * MIDI clock = 24 PPQN (pulses per quarter note), so:
 *   BPM = 60 / (avgInterval * 24)
 *   where avgInterval is the average time between 0xF8 messages in seconds.
 */

import { PPQN } from './clock-divider'

export interface ClockRecoveryState {
  /** Recent inter-tick intervals in seconds */
  intervals: number[]
  /** Timestamp (seconds) of last received clock tick, -1 if no tick received yet */
  lastTickTime: number
  /** Recovered BPM (0 if not enough data yet) */
  bpm: number
}

/** Number of intervals to average for BPM recovery */
const WINDOW_SIZE = 24 // 1 quarter note of data at 24 PPQN

export function createClockRecovery(): ClockRecoveryState {
  return {
    intervals: [],
    lastTickTime: -1,
    bpm: 0,
  }
}

/**
 * Process an incoming MIDI clock tick. Returns updated state with recovered BPM.
 * @param state Current clock recovery state
 * @param timeSeconds Timestamp of this tick in seconds (e.g. performance.now()/1000)
 */
export function processClockTick(state: ClockRecoveryState, timeSeconds: number): ClockRecoveryState {
  if (state.lastTickTime < 0) {
    // First tick — just record the time, can't compute interval yet
    return { ...state, lastTickTime: timeSeconds }
  }

  const interval = timeSeconds - state.lastTickTime

  // Reject obviously invalid intervals (< 1ms or > 2s)
  if (interval < 0.001 || interval > 2.0) {
    return { ...state, lastTickTime: timeSeconds }
  }

  // Add to window, keep only WINDOW_SIZE recent intervals
  const all = [...state.intervals, interval]
  const intervals = all.length > WINDOW_SIZE ? all.slice(all.length - WINDOW_SIZE) : all

  // Need at least 4 intervals for a reasonable BPM estimate
  let bpm = state.bpm
  if (intervals.length >= 4) {
    const sum = intervals.reduce((a, b) => a + b, 0)
    const avg = sum / intervals.length
    // BPM = 60s / (avgTickInterval * PPQN ticks per quarter note)
    bpm = Math.round(60 / (avg * PPQN))
    // Clamp to reasonable range
    bpm = Math.max(20, Math.min(300, bpm))
  }

  return { intervals, lastTickTime: timeSeconds, bpm }
}

/**
 * Reset clock recovery state (e.g. on Stop or source change).
 */
export function resetClockRecovery(): ClockRecoveryState {
  return createClockRecovery()
}
