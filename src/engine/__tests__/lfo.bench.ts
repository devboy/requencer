import { bench, describe } from 'vitest'
import { computeLFOValue, createLFORuntime, waveformValue } from '../lfo'
import type { LFOConfig } from '../types'

const baseConfig: LFOConfig = {
  waveform: 'sine',
  syncMode: 'track',
  rate: 16,
  freeRate: 1.0,
  depth: 1.0,
  offset: 0.5,
  width: 0.5,
  phase: 0.0,
}

describe('waveformValue() pure math', () => {
  bench('sine', () => {
    waveformValue('sine', 0.33, 0.5)
  })

  bench('triangle', () => {
    waveformValue('triangle', 0.33, 0.5)
  })

  bench('saw', () => {
    waveformValue('saw', 0.33, 0.5)
  })

  bench('square', () => {
    waveformValue('square', 0.33, 0.5)
  })
})

describe('computeLFOValue() per waveform', () => {
  bench('sine synced', () => {
    computeLFOValue(baseConfig, createLFORuntime(), 42, 1, 135)
  })

  bench('saw synced', () => {
    computeLFOValue({ ...baseConfig, waveform: 'saw' }, createLFORuntime(), 42, 1, 135)
  })

  bench('triangle synced', () => {
    computeLFOValue({ ...baseConfig, waveform: 'triangle' }, createLFORuntime(), 42, 1, 135)
  })

  bench('square synced', () => {
    computeLFOValue({ ...baseConfig, waveform: 'square' }, createLFORuntime(), 42, 1, 135)
  })

  bench('s+h synced', () => {
    computeLFOValue({ ...baseConfig, waveform: 's+h' }, createLFORuntime(), 42, 1, 135)
  })

  bench('slew-random synced', () => {
    computeLFOValue({ ...baseConfig, waveform: 'slew-random' }, createLFORuntime(), 42, 1, 135)
  })

  bench('sine free-running', () => {
    computeLFOValue({ ...baseConfig, syncMode: 'free', freeRate: 2.0 }, createLFORuntime(), 42, 1, 135)
  })
})
