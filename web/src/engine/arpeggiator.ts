/**
 * Arpeggiator — generates pitch patterns by walking chord tones.
 * Pure functions, zero dependencies on DOM/audio.
 */

import { createRng } from './rng'
import type { Note, Scale } from './types'

export type ArpDirection = 'up' | 'down' | 'triangle' | 'random'

/**
 * Extract chord intervals from a scale (root, 3rd, 5th, 7th).
 * For scales with 7+ notes, picks every other interval (indices 0, 2, 4, 6).
 * For smaller scales, uses all available intervals.
 */
export function getChordNotes(_root: Note, scale: Scale): number[] {
  const intervals = scale.intervals
  if (intervals.length <= 4) {
    return [...intervals]
  }
  if (intervals.length < 7) {
    // 5-6 note scales: take first 4 intervals
    return intervals.slice(0, 4)
  }
  // 7+ note scales: tertial stacking (every other: indices 0, 2, 4, 6)
  const chord: number[] = []
  for (let i = 0; i < intervals.length && chord.length < 4; i += 2) {
    chord.push(intervals[i])
  }
  return chord
}

/**
 * Build the full set of MIDI notes for chord tones across octave range.
 */
function buildNoteSet(root: Note, chordIntervals: number[], octaveRange: number): Note[] {
  const notes: Note[] = []
  for (let oct = 0; oct < octaveRange; oct++) {
    for (const interval of chordIntervals) {
      const note = root + interval + oct * 12
      if (note >= 0 && note <= 127) {
        notes.push(note)
      }
    }
  }
  return notes
}

/**
 * Generate a pitch pattern by walking chord tones in a direction.
 *
 * @param root - Root note (MIDI)
 * @param scale - Scale to derive chord tones from
 * @param direction - Walking direction: up, down, triangle, random
 * @param octaveRange - Number of octaves to span (1 = single octave)
 * @param length - Number of steps to generate
 * @param seed - PRNG seed for random mode
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex arp pattern generation
export function generateArpPattern(
  root: Note,
  scale: Scale,
  direction: ArpDirection,
  octaveRange: number,
  length: number,
  seed: number = Date.now(),
): Note[] {
  const chordIntervals = getChordNotes(root, scale)
  const noteSet = buildNoteSet(root, chordIntervals, octaveRange)

  if (noteSet.length === 0) {
    return Array(length).fill(Math.max(0, Math.min(127, root)))
  }

  const pattern: Note[] = []

  switch (direction) {
    case 'up': {
      for (let i = 0; i < length; i++) {
        pattern.push(noteSet[i % noteSet.length])
      }
      break
    }
    case 'down': {
      const reversed = [...noteSet].reverse()
      for (let i = 0; i < length; i++) {
        pattern.push(reversed[i % reversed.length])
      }
      break
    }
    case 'triangle': {
      // Build ping-pong sequence: up then down excluding endpoints
      const cycle: Note[] = [...noteSet]
      if (noteSet.length > 2) {
        for (let i = noteSet.length - 2; i >= 1; i--) {
          cycle.push(noteSet[i])
        }
      } else if (noteSet.length === 2) {
        // 2 notes: just alternate
      }
      for (let i = 0; i < length; i++) {
        pattern.push(cycle[i % cycle.length])
      }
      break
    }
    case 'random': {
      const rng = createRng(seed)
      for (let i = 0; i < length; i++) {
        const idx = Math.floor(rng() * noteSet.length)
        pattern.push(noteSet[idx])
      }
      break
    }
  }

  return pattern
}
