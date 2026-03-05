/**
 * LFO engine — tick-level waveform evaluator.
 * Computes a single value at any given tick, not an array of step values.
 * Pure functions, zero dependencies on DOM/audio.
 */

import { PPQN, TICKS_PER_STEP } from './clock-divider'
import { clamp } from './math'
import { createRng } from './rng'
import type { LFOConfig, LFORuntime, LFOWaveform } from './types'

/**
 * Compute raw waveform value at a given phase (0.0-1.0) with width/skew.
 * Returns 0.0-1.0.
 */
export function waveformValue(waveform: LFOWaveform, phase: number, width: number): number {
  switch (waveform) {
    case 'sine': {
      // Width skews the peak position
      let adjustedPhase: number
      if (width === 0.5) {
        adjustedPhase = phase
      } else if (phase < width) {
        adjustedPhase = (phase / width) * 0.5
      } else {
        adjustedPhase = 0.5 + ((phase - width) / (1 - width)) * 0.5
      }
      return 0.5 + 0.5 * Math.sin(adjustedPhase * 2 * Math.PI)
    }
    case 'triangle': {
      // Width sets the peak position (0.5 = symmetric, 0.0 = ramp down, 1.0 = ramp up)
      const peak = Math.max(0.001, Math.min(0.999, width))
      if (phase < peak) return phase / peak
      return 1 - (phase - peak) / (1 - peak)
    }
    case 'saw': {
      // Width controls rise vs. fall time (0.5 = pure saw, 0.0 = reverse saw)
      const rise = Math.max(0.001, Math.min(0.999, width))
      if (phase < rise) return phase / rise
      return 1 - (phase - rise) / (1 - rise)
    }
    case 'square': {
      // Width = pulse width / duty cycle
      return phase < width ? 1.0 : 0.0
    }
    case 'slew-random':
      // Handled by runtime state, returns 0 as fallback
      return 0
    case 's+h':
      // Handled by runtime state, returns 0 as fallback
      return 0
  }
}

/**
 * Create a default LFO runtime state.
 */
export function createLFORuntime(): LFORuntime {
  return {
    currentPhase: 0,
    lastSHValue: 0,
    slewTarget: 0,
    slewCurrent: 0,
  }
}

/**
 * Compute LFO value at a given tick.
 *
 * For synced mode: phase derived from masterTick and track clock divider.
 * For free mode: phase accumulates based on freeRate and time-per-tick.
 *
 * Returns the output value (0.0-1.0) and updated runtime state.
 */
export function computeLFOValue(
  config: LFOConfig,
  runtime: LFORuntime,
  masterTick: number,
  trackClockDivider: number,
  bpm: number,
): { value: number; runtime: LFORuntime } {
  let phase: number
  const newRuntime = { ...runtime }

  if (config.syncMode === 'free') {
    // Free-running: accumulate phase based on Hz rate and tick duration
    const tickDuration = 60 / bpm / PPQN // seconds per PPQN tick
    const phaseIncrement = config.freeRate * tickDuration
    phase = (runtime.currentPhase + phaseIncrement) % 1.0
    newRuntime.currentPhase = phase
  } else {
    // Synced: phase derived deterministically from tick position
    // Fractional effective tick gives smooth inter-step phase progression
    const effectiveTick = masterTick / (TICKS_PER_STEP * trackClockDivider)
    const rate = Math.max(1, config.rate)
    phase = ((effectiveTick + config.phase * rate) % rate) / rate
    // Wrap phase to [0, 1)
    phase = ((phase % 1) + 1) % 1
    newRuntime.currentPhase = phase
  }

  // Compute raw waveform value
  let raw: number

  if (config.waveform === 's+h') {
    // Sample & Hold: new random value at the start of each cycle
    const triggerPoint = config.width
    // Detect if we just crossed the trigger point
    const prevPhase = runtime.currentPhase
    const crossed = phase < prevPhase || (prevPhase < triggerPoint && phase >= triggerPoint)
    if (crossed || (runtime.lastSHValue === 0 && runtime.currentPhase === 0)) {
      // Generate new random value based on tick for determinism
      const rng = createRng(masterTick * 7919 + 31)
      newRuntime.lastSHValue = rng()
    }
    raw = newRuntime.lastSHValue
  } else if (config.waveform === 'slew-random') {
    // Random target values with slew between them
    const prevPhase = runtime.currentPhase
    const crossed = phase < prevPhase
    if (crossed || (runtime.slewTarget === 0 && runtime.slewCurrent === 0 && masterTick === 0)) {
      // New random target at cycle start
      const rng = createRng(masterTick * 7919 + 37)
      newRuntime.slewTarget = rng()
    }
    // Interpolate towards target based on width (0 = instant, 1 = very slow)
    const slewRate = 1 - config.width * 0.95 // never fully 0 to avoid stuck values
    newRuntime.slewCurrent = runtime.slewCurrent + (newRuntime.slewTarget - runtime.slewCurrent) * slewRate
    raw = newRuntime.slewCurrent
  } else {
    raw = waveformValue(config.waveform, phase, config.width)
  }

  // Apply depth and offset scaling
  const scaled = config.offset + (raw - 0.5) * config.depth
  const value = clamp(scaled, 0, 1)

  return { value, runtime: newRuntime }
}
