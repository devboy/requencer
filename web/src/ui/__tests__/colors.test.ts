import { describe, expect, it } from 'vitest'
import { midiToNoteName } from '../colors'

describe('midiToNoteName', () => {
  it('converts middle C (60) to C4', () => {
    expect(midiToNoteName(60)).toBe('C4')
  })

  it('converts MIDI 0 to C-1', () => {
    expect(midiToNoteName(0)).toBe('C-1')
  })

  it('converts MIDI 127 to G9', () => {
    expect(midiToNoteName(127)).toBe('G9')
  })

  it('handles sharps correctly', () => {
    expect(midiToNoteName(61)).toBe('C#4')
    expect(midiToNoteName(63)).toBe('D#4')
    expect(midiToNoteName(66)).toBe('F#4')
  })

  it('converts A440 (69) to A4', () => {
    expect(midiToNoteName(69)).toBe('A4')
  })

  it('wraps octaves correctly', () => {
    // C in each octave: 0=C-1, 12=C0, 24=C1, 36=C2, 48=C3, 60=C4
    expect(midiToNoteName(12)).toBe('C0')
    expect(midiToNoteName(24)).toBe('C1')
    expect(midiToNoteName(36)).toBe('C2')
    expect(midiToNoteName(48)).toBe('C3')
  })
})
