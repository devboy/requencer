import { describe, expect, it } from 'vitest'
import { computeLFOValue, createLFORuntime, waveformValue } from '../lfo'
import type { LFOConfig } from '../types'

const defaultConfig: LFOConfig = {
  waveform: 'sine',
  syncMode: 'track',
  rate: 16,
  freeRate: 1.0,
  depth: 1.0,
  offset: 0.5,
  width: 0.5,
  phase: 0.0,
}

describe('waveformValue', () => {
  describe('sine', () => {
    it('0.5 at phase 0', () => {
      expect(waveformValue('sine', 0, 0.5)).toBeCloseTo(0.5, 1)
    })

    it('1.0 at phase 0.25 with width=0.5', () => {
      expect(waveformValue('sine', 0.25, 0.5)).toBeCloseTo(1.0, 1)
    })

    it('0.5 at phase 0.5', () => {
      expect(waveformValue('sine', 0.5, 0.5)).toBeCloseTo(0.5, 1)
    })

    it('0.0 at phase 0.75', () => {
      expect(waveformValue('sine', 0.75, 0.5)).toBeCloseTo(0.0, 1)
    })
  })

  describe('triangle', () => {
    it('0 at phase 0', () => {
      expect(waveformValue('triangle', 0, 0.5)).toBeCloseTo(0, 1)
    })

    it('1 at phase 0.5 with width=0.5', () => {
      expect(waveformValue('triangle', 0.5, 0.5)).toBeCloseTo(1, 1)
    })

    it('0 at phase 1 (approaching 1.0)', () => {
      expect(waveformValue('triangle', 0.999, 0.5)).toBeCloseTo(0, 1)
    })

    it('width shifts peak position', () => {
      // With width=0.25, peak should be near phase 0.25
      expect(waveformValue('triangle', 0.25, 0.25)).toBeCloseTo(1, 1)
      // With width=0.75, peak should be near phase 0.75
      expect(waveformValue('triangle', 0.75, 0.75)).toBeCloseTo(1, 1)
    })
  })

  describe('saw', () => {
    it('0 at phase 0', () => {
      expect(waveformValue('saw', 0, 0.5)).toBeCloseTo(0, 1)
    })

    it('~1 near phase 1 with width=0.5', () => {
      // With width=0.5, saw rises from 0 to 1 over phase 0-0.5, then falls back
      // At phase just before width, should be near 1
      expect(waveformValue('saw', 0.49, 0.5)).toBeCloseTo(1, 1)
    })

    it('width controls rise time', () => {
      // With width=0.25, rise is compressed into first 25% of phase
      // So at phase=0.125 (halfway through rise), value should be ~0.5
      expect(waveformValue('saw', 0.125, 0.25)).toBeCloseTo(0.5, 1)
      // With width=0.75, rise takes 75% of the phase
      // At phase=0.375 (halfway through rise), value should be ~0.5
      expect(waveformValue('saw', 0.375, 0.75)).toBeCloseTo(0.5, 1)
    })
  })

  describe('square', () => {
    it('1 at phase 0 with width=0.5', () => {
      expect(waveformValue('square', 0, 0.5)).toBeCloseTo(1, 1)
    })

    it('0 at phase 0.6 with width=0.5', () => {
      expect(waveformValue('square', 0.6, 0.5)).toBeCloseTo(0, 1)
    })
  })

  describe('all waveforms return values in [0, 1]', () => {
    const waveforms: Array<'sine' | 'triangle' | 'saw' | 'square'> = ['sine', 'triangle', 'saw', 'square']
    const phases = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
    const widths = [0.1, 0.25, 0.5, 0.75, 0.9]

    for (const waveform of waveforms) {
      it(`${waveform} stays in [0, 1] for various phases and widths`, () => {
        for (const phase of phases) {
          for (const width of widths) {
            const v = waveformValue(waveform, phase, width)
            expect(v).toBeGreaterThanOrEqual(0)
            expect(v).toBeLessThanOrEqual(1)
          }
        }
      })
    }
  })
})

describe('createLFORuntime', () => {
  it('returns default runtime state', () => {
    const runtime = createLFORuntime()
    expect(runtime.currentPhase).toBe(0)
    expect(runtime.lastSHValue).toBe(0)
    expect(runtime.slewTarget).toBe(0)
    expect(runtime.slewCurrent).toBe(0)
  })
})

describe('computeLFOValue', () => {
  describe('synced mode', () => {
    it('phase derived from masterTick', () => {
      const config: LFOConfig = { ...defaultConfig, syncMode: 'track', rate: 16, waveform: 'saw' }
      const runtime = createLFORuntime()

      // At tick 0, phase should be 0 -> saw at 0 -> raw = 0
      const r0 = computeLFOValue(config, runtime, 0, 1, 120)
      // At tick 8, phase should be 0.5 -> saw at 0.5 (with width=0.5 -> peak)
      const r8 = computeLFOValue(config, runtime, 8, 1, 120)

      // Values at different ticks should differ
      expect(r0.value).not.toBeCloseTo(r8.value, 1)
    })

    it('rate controls cycle length', () => {
      const config: LFOConfig = { ...defaultConfig, syncMode: 'track', rate: 8, waveform: 'saw' }
      const runtime = createLFORuntime()

      // With rate=8, tick 0 and tick 8 should be at the same phase (start of cycle)
      const r0 = computeLFOValue(config, runtime, 0, 1, 120)
      const r8 = computeLFOValue(config, runtime, 8, 1, 120)
      expect(r0.value).toBeCloseTo(r8.value, 1)

      // Tick 4 should be at phase 0.5 (middle of cycle)
      const r4 = computeLFOValue(config, runtime, 4, 1, 120)
      expect(r4.value).not.toBeCloseTo(r0.value, 1)
    })
  })

  describe('free mode', () => {
    it('phase accumulates across ticks', () => {
      const config: LFOConfig = { ...defaultConfig, syncMode: 'free', freeRate: 1.0, waveform: 'sine' }
      let runtime = createLFORuntime()

      // Accumulate several ticks and check that phase advances
      const r0 = computeLFOValue(config, runtime, 0, 1, 120)
      runtime = r0.runtime
      const r1 = computeLFOValue(config, runtime, 1, 1, 120)
      runtime = r1.runtime
      const r2 = computeLFOValue(config, runtime, 2, 1, 120)

      // Phase should be increasing (runtime tracks it)
      expect(r1.runtime.currentPhase).toBeGreaterThan(0)
      expect(r2.runtime.currentPhase).toBeGreaterThan(r1.runtime.currentPhase)
    })
  })

  describe('depth and offset', () => {
    it('depth=0 gives flat output at offset', () => {
      const config: LFOConfig = { ...defaultConfig, depth: 0, offset: 0.7 }
      const runtime = createLFORuntime()

      // At various ticks, output should always be the offset value
      for (let tick = 0; tick < 16; tick++) {
        const result = computeLFOValue(config, runtime, tick, 1, 120)
        expect(result.value).toBeCloseTo(0.7, 1)
      }
    })

    it('depth=1 gives full range', () => {
      const config: LFOConfig = { ...defaultConfig, depth: 1.0, offset: 0.5, waveform: 'sine', rate: 16 }
      const runtime = createLFORuntime()

      // Collect values across a full cycle
      const values: number[] = []
      for (let tick = 0; tick < 16; tick++) {
        const result = computeLFOValue(config, runtime, tick, 1, 120)
        values.push(result.value)
      }

      const maxVal = Math.max(...values)
      const minVal = Math.min(...values)
      // Full depth with 0.5 offset: sine goes from 0.0 to 1.0
      expect(maxVal).toBeCloseTo(1.0, 1)
      expect(minVal).toBeCloseTo(0.0, 1)
    })

    it('offset shifts the center', () => {
      const runtime = createLFORuntime()

      const lowConfig: LFOConfig = { ...defaultConfig, depth: 0.2, offset: 0.2 }
      const highConfig: LFOConfig = { ...defaultConfig, depth: 0.2, offset: 0.8 }

      let sumLow = 0
      let sumHigh = 0
      for (let tick = 0; tick < 16; tick++) {
        sumLow += computeLFOValue(lowConfig, runtime, tick, 1, 120).value
        sumHigh += computeLFOValue(highConfig, runtime, tick, 1, 120).value
      }

      const avgLow = sumLow / 16
      const avgHigh = sumHigh / 16
      expect(avgHigh).toBeGreaterThan(avgLow)
    })
  })

  describe('clamping', () => {
    it('values always clamped to [0, 1]', () => {
      // High offset + full depth could exceed 1.0 without clamping
      const configHigh: LFOConfig = { ...defaultConfig, depth: 1.0, offset: 0.9 }
      // Low offset + full depth could go below 0.0 without clamping
      const configLow: LFOConfig = { ...defaultConfig, depth: 1.0, offset: 0.1 }
      const runtime = createLFORuntime()

      for (let tick = 0; tick < 32; tick++) {
        const rHigh = computeLFOValue(configHigh, runtime, tick, 1, 120)
        expect(rHigh.value).toBeGreaterThanOrEqual(0)
        expect(rHigh.value).toBeLessThanOrEqual(1)

        const rLow = computeLFOValue(configLow, runtime, tick, 1, 120)
        expect(rLow.value).toBeGreaterThanOrEqual(0)
        expect(rLow.value).toBeLessThanOrEqual(1)
      }
    })
  })

  describe('runtime immutability', () => {
    it('returns new runtime without mutating the original', () => {
      const config: LFOConfig = { ...defaultConfig, syncMode: 'free' }
      const runtime = createLFORuntime()
      const originalPhase = runtime.currentPhase

      const result = computeLFOValue(config, runtime, 0, 1, 120)

      // Original runtime should be unchanged
      expect(runtime.currentPhase).toBe(originalPhase)
      // Returned runtime should be different
      expect(result.runtime).not.toBe(runtime)
    })
  })
})
