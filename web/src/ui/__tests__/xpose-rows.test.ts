import { describe, expect, test } from 'vitest'
import { createSequencer } from '../../engine/sequencer'
import { createInitialUIState } from '../mode-machine'
import { getXposeVisibleRows } from '../xpose-rows'

describe('xpose-rows', () => {
  test('returns 7 rows (2 headers + 5 params)', () => {
    const engine = createSequencer()
    const ui = createInitialUIState()
    const rows = getXposeVisibleRows(engine, ui)
    expect(rows.length).toBe(7)
  })

  test('has PITCH and DYNAMICS section headers', () => {
    const engine = createSequencer()
    const ui = createInitialUIState()
    const rows = getXposeVisibleRows(engine, ui)
    const headers = rows.filter((r) => r.type === 'header')
    expect(headers.map((h) => h.label)).toEqual(['PITCH', 'DYNAMICS'])
  })

  test('SEMI getValue shows sign prefix for non-zero', () => {
    const engine = createSequencer()
    engine.transposeConfigs[0] = { semitones: 7, noteLow: 0, noteHigh: 127, glScale: 1.0, velScale: 1.0 }
    const ui = createInitialUIState()
    const rows = getXposeVisibleRows(engine, ui)
    const semi = rows.find((r) => r.paramId === 'xpose.semi')
    expect(semi?.getValue(engine, ui)).toBe('+7')
  })

  test('SEMI getValue shows 0 without sign', () => {
    const engine = createSequencer()
    const ui = createInitialUIState()
    const rows = getXposeVisibleRows(engine, ui)
    const semi = rows.find((r) => r.paramId === 'xpose.semi')
    expect(semi?.getValue(engine, ui)).toBe('0')
  })

  test('NOTE LO/HI getValue shows note names', () => {
    const engine = createSequencer()
    engine.transposeConfigs[0] = { semitones: 0, noteLow: 48, noteHigh: 72, glScale: 1.0, velScale: 1.0 }
    const ui = createInitialUIState()
    const rows = getXposeVisibleRows(engine, ui)
    const lo = rows.find((r) => r.paramId === 'xpose.noteLow')
    const hi = rows.find((r) => r.paramId === 'xpose.noteHigh')
    expect(lo?.getValue(engine, ui)).toBe('C3')
    expect(hi?.getValue(engine, ui)).toBe('C5')
  })

  test('GL/VEL SCALE getValue shows percentage', () => {
    const engine = createSequencer()
    engine.transposeConfigs[0] = { semitones: 0, noteLow: 0, noteHigh: 127, glScale: 2.0, velScale: 0.5 }
    const ui = createInitialUIState()
    const rows = getXposeVisibleRows(engine, ui)
    const gl = rows.find((r) => r.paramId === 'xpose.glScale')
    const vel = rows.find((r) => r.paramId === 'xpose.velScale')
    expect(gl?.getValue(engine, ui)).toBe('200%')
    expect(vel?.getValue(engine, ui)).toBe('50%')
  })

  test('uses selectedTrack from UIState', () => {
    const engine = createSequencer()
    engine.transposeConfigs[2] = { semitones: -5, noteLow: 0, noteHigh: 127, glScale: 1.0, velScale: 1.0 }
    const ui = { ...createInitialUIState(), selectedTrack: 2 }
    const rows = getXposeVisibleRows(engine, ui)
    const semi = rows.find((r) => r.paramId === 'xpose.semi')
    expect(semi?.getValue(engine, ui)).toBe('-5')
  })
})
