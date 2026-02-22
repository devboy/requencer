import { describe, it, expect } from 'vitest'
import { PRESETS, getPresetByName } from '../presets'

describe('PRESETS', () => {
  it('contains at least 6 presets', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(6)
  })

  it('each preset has a name and valid RandomConfig', () => {
    for (const preset of PRESETS) {
      expect(preset.name).toBeTruthy()
      expect(preset.config.pitch.low).toBeGreaterThanOrEqual(0)
      expect(preset.config.pitch.high).toBeLessThanOrEqual(127)
      expect(preset.config.pitch.low).toBeLessThanOrEqual(preset.config.pitch.high)
      expect(preset.config.pitch.scale.intervals.length).toBeGreaterThan(0)
      expect(preset.config.gate.fillMin).toBeGreaterThanOrEqual(0)
      expect(preset.config.gate.fillMax).toBeLessThanOrEqual(1)
      expect(preset.config.gate.fillMin).toBeLessThanOrEqual(preset.config.gate.fillMax)
      expect(['random', 'euclidean']).toContain(preset.config.gate.mode)
      expect(preset.config.velocity.low).toBeGreaterThanOrEqual(0)
      expect(preset.config.velocity.high).toBeLessThanOrEqual(127)
    }
  })

  it('has unique names', () => {
    const names = PRESETS.map(p => p.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('getPresetByName', () => {
  it('finds a preset by name', () => {
    const preset = getPresetByName('Bassline')
    expect(preset).toBeDefined()
    expect(preset!.name).toBe('Bassline')
  })

  it('returns undefined for unknown name', () => {
    expect(getPresetByName('NonExistent')).toBeUndefined()
  })
})
