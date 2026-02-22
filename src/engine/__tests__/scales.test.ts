import { describe, it, expect } from 'vitest'
import { SCALES, getScaleNotes, snapToScale } from '../scales'

describe('SCALES', () => {
  it('defines major scale with 7 intervals', () => {
    expect(SCALES.major.intervals).toEqual([0, 2, 4, 5, 7, 9, 11])
  })

  it('defines minor pentatonic with 5 intervals', () => {
    expect(SCALES.minorPentatonic.intervals).toEqual([0, 3, 5, 7, 10])
  })
})

describe('getScaleNotes', () => {
  it('returns C major notes between C3 (48) and C5 (72)', () => {
    const notes = getScaleNotes(60, SCALES.major, 48, 72)
    // C3=48, D3=50, E3=52, F3=53, G3=55, A3=57, B3=59
    // C4=60, D4=62, E4=64, F4=65, G4=67, A4=69, B4=71, C5=72
    expect(notes).toEqual([48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72])
  })

  it('returns A minor pentatonic notes in range A3 (57) to A5 (81)', () => {
    // A minor pentatonic: A, C, D, E, G — intervals [0,3,5,7,10] from A
    // root=69 (A4), but intervals repeat in all octaves
    // A3=57, C4=60, D4=62, E4=64, G4=67, A4=69, C5=72, D5=74, E5=76, G5=79, A5=81
    const notes = getScaleNotes(69, SCALES.minorPentatonic, 57, 81)
    expect(notes).toEqual([57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81])
  })

  it('returns empty array when no scale notes in range', () => {
    // C major between C#4 (61) and D#4 (63) — only D4 (62) is in scale
    const notes = getScaleNotes(60, SCALES.major, 61, 61)
    expect(notes).toEqual([])
  })

  it('includes boundary notes if they are in scale', () => {
    const notes = getScaleNotes(60, SCALES.major, 60, 62)
    expect(notes).toEqual([60, 62])
  })
})

describe('snapToScale', () => {
  it('snaps C#4 (61) to nearest C major tone', () => {
    // C4=60, D4=62 — C#4 is equidistant, snap down to C4
    const snapped = snapToScale(61, 60, SCALES.major)
    expect(snapped).toBe(60)
  })

  it('returns the note unchanged if already in scale', () => {
    expect(snapToScale(60, 60, SCALES.major)).toBe(60) // C4 is in C major
    expect(snapToScale(64, 60, SCALES.major)).toBe(64) // E4 is in C major
  })

  it('snaps Bb4 (70) in C major to either A4 (69) or B4 (71)', () => {
    // Bb is equidistant from A and B — snap down
    const snapped = snapToScale(70, 60, SCALES.major)
    expect(snapped).toBe(69)
  })

  it('snaps F#4 (66) in C major to F4 (65) or G4 (67)', () => {
    // F#4 is equidistant — snap down
    const snapped = snapToScale(66, 60, SCALES.major)
    expect(snapped).toBe(65)
  })

  it('works with non-C roots', () => {
    // D major: D E F# G A B C# — intervals [0,2,4,5,7,9,11] from D(62)
    // Snap C4 (60) → should go to C#4 (61) which is in D major? No...
    // D major notes around 60: B3=59 (in scale, 59=62-3, 62+11-12=61? Let me think...
    // root=62 (D4). Scale notes: ...B3=59(62-3=59, interval 9 from D gives 62+9=71=B4,
    // so 71-12=59=B3), C#4=61(interval 11), D4=62(interval 0)
    // C4=60 is between B3=59 and C#4=61 — equidistant, snap down to 59
    const snapped = snapToScale(60, 62, SCALES.major)
    expect(snapped).toBe(59)
  })
})
