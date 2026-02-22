import type { Scale, Note } from './types'

export const SCALES = {
  major:          { name: 'Major',            intervals: [0, 2, 4, 5, 7, 9, 11] },
  minor:          { name: 'Minor',            intervals: [0, 2, 3, 5, 7, 8, 10] },
  dorian:         { name: 'Dorian',           intervals: [0, 2, 3, 5, 7, 9, 10] },
  phrygian:       { name: 'Phrygian',         intervals: [0, 1, 3, 5, 7, 8, 10] },
  mixolydian:     { name: 'Mixolydian',       intervals: [0, 2, 4, 5, 7, 9, 10] },
  minorPentatonic:{ name: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10] },
  majorPentatonic:{ name: 'Major Pentatonic', intervals: [0, 2, 4, 7, 9] },
  blues:          { name: 'Blues',            intervals: [0, 3, 5, 6, 7, 10] },
  chromatic:      { name: 'Chromatic',        intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  wholeNote:      { name: 'Whole Tone',       intervals: [0, 2, 4, 6, 8, 10] },
} as const satisfies Record<string, Scale>

/**
 * Returns all MIDI notes within [low, high] that belong to the given scale and root.
 */
export function getScaleNotes(root: Note, scale: Scale, low: Note, high: Note): Note[] {
  const notes: Note[] = []

  for (let midi = low; midi <= high; midi++) {
    // Compute semitone distance from root, wrapped to 0-11
    const interval = ((midi - root) % 12 + 12) % 12
    if (scale.intervals.includes(interval)) {
      notes.push(midi)
    }
  }

  return notes
}

/**
 * Snap a MIDI note to the nearest note in the given scale.
 * On ties (equidistant), snaps down.
 */
export function snapToScale(note: Note, root: Note, scale: Scale): Note {
  const interval = ((note - root) % 12 + 12) % 12
  if (scale.intervals.includes(interval)) return note

  // Search outward from the note for the nearest scale tone
  for (let offset = 1; offset <= 6; offset++) {
    const below = note - offset
    const above = note + offset

    const belowInterval = ((below - root) % 12 + 12) % 12
    const aboveInterval = ((above - root) % 12 + 12) % 12

    const belowInScale = scale.intervals.includes(belowInterval)
    const aboveInScale = scale.intervals.includes(aboveInterval)

    // Snap down on tie
    if (belowInScale) return below
    if (aboveInScale) return above
  }

  return note
}
