import { describe, it, expect } from 'vitest'
import { generateArpPattern, getChordNotes } from '../arpeggiator'
import { SCALES } from '../scales'

describe('getChordNotes', () => {
  it('extracts root, 3rd, 5th, 7th from minor pentatonic', () => {
    // Minor pentatonic: [0, 3, 5, 7, 10] → chord tones at indices 0, 1, 2, 3
    // Root C4=60: 60, 63, 65, 67
    const notes = getChordNotes(60, SCALES.minorPentatonic)
    expect(notes).toEqual([0, 3, 5, 7]) // intervals relative to root
  })

  it('extracts root, 3rd, 5th, 7th from major scale', () => {
    // Major: [0, 2, 4, 5, 7, 9, 11] → chord at indices 0, 2, 4, 6
    const notes = getChordNotes(60, SCALES.major)
    expect(notes).toEqual([0, 4, 7, 11])
  })

  it('handles scale with fewer than 4 intervals', () => {
    const twoNote = { name: 'Two', intervals: [0, 7] }
    const notes = getChordNotes(60, twoNote)
    // Should use what's available
    expect(notes).toEqual([0, 7])
  })
})

describe('generateArpPattern', () => {
  const root = 60
  const scale = SCALES.minor // [0, 2, 3, 5, 7, 8, 10] → chord: 0, 3, 7, 10

  it('generates ascending pattern', () => {
    const pattern = generateArpPattern(root, scale, 'up', 1, 8, 42)
    // Should cycle through chord tones ascending: root, 3rd, 5th, 7th, root, 3rd, 5th, 7th
    // With root=60, minor chord: 60, 63, 67, 70
    expect(pattern).toEqual([60, 63, 67, 70, 60, 63, 67, 70])
  })

  it('generates descending pattern', () => {
    const pattern = generateArpPattern(root, scale, 'down', 1, 8, 42)
    // Descending: 7th, 5th, 3rd, root, 7th, 5th, 3rd, root
    expect(pattern).toEqual([70, 67, 63, 60, 70, 67, 63, 60])
  })

  it('generates triangle (ping-pong) pattern', () => {
    const pattern = generateArpPattern(root, scale, 'triangle', 1, 8, 42)
    // Up then down (excluding endpoints on reversal): root, 3rd, 5th, 7th, 5th, 3rd, root, 3rd
    expect(pattern).toEqual([60, 63, 67, 70, 67, 63, 60, 63])
  })

  it('generates seeded random pattern', () => {
    const pattern1 = generateArpPattern(root, scale, 'random', 1, 8, 42)
    const pattern2 = generateArpPattern(root, scale, 'random', 1, 8, 42)
    const pattern3 = generateArpPattern(root, scale, 'random', 1, 8, 99)
    // Same seed = same result
    expect(pattern1).toEqual(pattern2)
    // Different seed = different result
    expect(pattern1).not.toEqual(pattern3)
    // All notes should be from the chord set
    const chordNotes = [60, 63, 67, 70]
    for (const note of pattern1) {
      expect(chordNotes).toContain(note)
    }
  })

  it('expands across octave range', () => {
    const pattern = generateArpPattern(root, scale, 'up', 2, 8, 42)
    // With octaveRange=2: chord notes in octave 0 + octave 1
    // 60, 63, 67, 70, 72, 75, 79, 82
    expect(pattern.length).toBe(8)
    // All notes should be in range [60, 60+24)
    for (const note of pattern) {
      expect(note).toBeGreaterThanOrEqual(60)
      expect(note).toBeLessThanOrEqual(82) // 70 + 12
    }
  })

  it('clamps notes to valid MIDI range 0-127', () => {
    // High root near MIDI limit
    const pattern = generateArpPattern(120, scale, 'up', 2, 8, 42)
    for (const note of pattern) {
      expect(note).toBeGreaterThanOrEqual(0)
      expect(note).toBeLessThanOrEqual(127)
    }
  })

  it('returns array of requested length', () => {
    expect(generateArpPattern(root, scale, 'up', 1, 4, 42).length).toBe(4)
    expect(generateArpPattern(root, scale, 'up', 1, 16, 42).length).toBe(16)
    expect(generateArpPattern(root, scale, 'up', 1, 32, 42).length).toBe(32)
  })
})
