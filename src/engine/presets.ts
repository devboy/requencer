/**
 * Randomizer presets — named RandomConfig configurations for common musical patterns.
 * Pure data, no dependencies.
 */

import type { RandomConfig } from './types'
import { SCALES } from './scales'

export interface Preset {
  name: string
  config: RandomConfig
}

export const PRESETS: Preset[] = [
  {
    name: 'Bassline',
    config: {
      pitch: { low: 36, high: 48, scale: SCALES.minorPentatonic, root: 36, maxNotes: 4 },
      gate: { fillMin: 0.5, fillMax: 0.75, mode: 'euclidean', randomOffset: true, smartBars: 1, smartDensity: 'build' },
      velocity: { low: 80, high: 120 },
      gateLength: { min: 0.5, max: 0.5 },
      ratchet: { maxRatchet: 1, probability: 0 },
      slide: { probability: 0 },
      mod: { low: 0, high: 0.5 },
    },
  },
  {
    name: 'Hypnotic',
    config: {
      pitch: { low: 48, high: 60, scale: SCALES.minorPentatonic, root: 48, maxNotes: 3 },
      gate: { fillMin: 0.75, fillMax: 1.0, mode: 'euclidean', randomOffset: true, smartBars: 1, smartDensity: 'build' },
      velocity: { low: 90, high: 110 },
      gateLength: { min: 0.5, max: 0.5 },
      ratchet: { maxRatchet: 1, probability: 0 },
      slide: { probability: 0 },
      mod: { low: 0.2, high: 0.8 },
    },
  },
  {
    name: 'Acid',
    config: {
      pitch: { low: 36, high: 60, scale: SCALES.blues, root: 36, maxNotes: 5 },
      gate: { fillMin: 0.5, fillMax: 0.85, mode: 'random', randomOffset: false, smartBars: 1, smartDensity: 'build' },
      velocity: { low: 64, high: 127 },
      gateLength: { min: 0.5, max: 0.5 },
      ratchet: { maxRatchet: 1, probability: 0 },
      slide: { probability: 0.2 },
      mod: { low: 0, high: 1 },
    },
  },
  {
    name: 'Ambient',
    config: {
      pitch: { low: 48, high: 72, scale: SCALES.major, root: 48, maxNotes: 0 },
      gate: { fillMin: 0.1, fillMax: 0.3, mode: 'random', randomOffset: false, smartBars: 1, smartDensity: 'build' },
      velocity: { low: 40, high: 80 },
      gateLength: { min: 0.5, max: 0.5 },
      ratchet: { maxRatchet: 1, probability: 0 },
      slide: { probability: 0 },
      mod: { low: 0.3, high: 0.7 },
    },
  },
  {
    name: 'Percussive',
    config: {
      pitch: { low: 60, high: 72, scale: SCALES.chromatic, root: 60, maxNotes: 0 },
      gate: { fillMin: 0.6, fillMax: 0.9, mode: 'euclidean', randomOffset: true, smartBars: 1, smartDensity: 'build' },
      velocity: { low: 100, high: 127 },
      gateLength: { min: 0.5, max: 0.5 },
      ratchet: { maxRatchet: 1, probability: 0 },
      slide: { probability: 0 },
      mod: { low: 0, high: 0.3 },
    },
  },
  {
    name: 'Sparse',
    config: {
      pitch: { low: 48, high: 67, scale: SCALES.dorian, root: 48, maxNotes: 4 },
      gate: { fillMin: 0.15, fillMax: 0.35, mode: 'euclidean', randomOffset: true, smartBars: 1, smartDensity: 'build' },
      velocity: { low: 50, high: 100 },
      gateLength: { min: 0.5, max: 0.5 },
      ratchet: { maxRatchet: 1, probability: 0 },
      slide: { probability: 0 },
      mod: { low: 0.1, high: 0.6 },
    },
  },
]

export function getPresetByName(name: string): Preset | undefined {
  return PRESETS.find(p => p.name === name)
}
