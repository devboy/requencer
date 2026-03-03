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
      pitch: { low: 24, high: 36, scale: SCALES.minorPentatonic, root: 24, maxNotes: 3 },
      gate: { fillMin: 0.6, fillMax: 0.9, mode: 'euclidean', randomOffset: true, clusterContinuation: 0.7 },
      velocity: { low: 90, high: 120 },
      gateLength: { min: 0.4, max: 0.7 },
      ratchet: { maxRatchet: 2, probability: 0.05 },
      slide: { probability: 0 },
      mod: { low: 0, high: 0.5 },
      tie: { probability: 0.1, maxLength: 2 },
    },
  },
  {
    name: 'Hypnotic',
    config: {
      pitch: { low: 48, high: 60, scale: SCALES.minorPentatonic, root: 48, maxNotes: 3 },
      gate: { fillMin: 0.75, fillMax: 1.0, mode: 'cluster', randomOffset: true, clusterContinuation: 0.85 },
      velocity: { low: 90, high: 110 },
      gateLength: { min: 0.4, max: 0.6 },
      ratchet: { maxRatchet: 1, probability: 0 },
      slide: { probability: 0 },
      mod: { low: 0.2, high: 0.8 },
      tie: { probability: 0, maxLength: 2 },
    },
  },
  {
    name: 'Acid',
    config: {
      pitch: { low: 36, high: 60, scale: SCALES.blues, root: 36, maxNotes: 5 },
      gate: { fillMin: 0.5, fillMax: 0.85, mode: 'sync', randomOffset: false, clusterContinuation: 0.7 },
      velocity: { low: 64, high: 127 },
      gateLength: { min: 0.3, max: 0.8 },
      ratchet: { maxRatchet: 1, probability: 0 },
      slide: { probability: 0.25 },
      mod: { low: 0, high: 1 },
      tie: { probability: 0.15, maxLength: 3 },
    },
  },
  {
    name: 'Ambient',
    config: {
      pitch: { low: 48, high: 72, scale: SCALES.major, root: 48, maxNotes: 0 },
      gate: { fillMin: 0.1, fillMax: 0.3, mode: 'random', randomOffset: false, clusterContinuation: 0.7 },
      velocity: { low: 40, high: 80 },
      gateLength: { min: 0.6, max: 1.0 },
      ratchet: { maxRatchet: 1, probability: 0 },
      slide: { probability: 0 },
      mod: { low: 0.3, high: 0.7 },
      tie: { probability: 0.2, maxLength: 4 },
    },
  },
  {
    name: 'Percussive',
    config: {
      pitch: { low: 60, high: 72, scale: SCALES.chromatic, root: 60, maxNotes: 0 },
      gate: { fillMin: 0.6, fillMax: 0.9, mode: 'euclidean', randomOffset: true, clusterContinuation: 0.7 },
      velocity: { low: 100, high: 127 },
      gateLength: { min: 0.15, max: 0.3 },
      ratchet: { maxRatchet: 3, probability: 0.15 },
      slide: { probability: 0 },
      mod: { low: 0, high: 0.3 },
      tie: { probability: 0, maxLength: 2 },
    },
  },
  {
    name: 'Sparse',
    config: {
      pitch: { low: 48, high: 67, scale: SCALES.dorian, root: 48, maxNotes: 4 },
      gate: { fillMin: 0.15, fillMax: 0.35, mode: 'euclidean', randomOffset: true, clusterContinuation: 0.7 },
      velocity: { low: 50, high: 100 },
      gateLength: { min: 0.5, max: 0.8 },
      ratchet: { maxRatchet: 1, probability: 0 },
      slide: { probability: 0 },
      mod: { low: 0.1, high: 0.6 },
      tie: { probability: 0, maxLength: 2 },
    },
  },
  {
    name: 'Stab',
    config: {
      pitch: { low: 60, high: 72, scale: SCALES.minor, root: 60, maxNotes: 4 },
      gate: { fillMin: 0.3, fillMax: 0.6, mode: 'sync', randomOffset: false, clusterContinuation: 0.7 },
      velocity: { low: 90, high: 127 },
      gateLength: { min: 0.15, max: 0.35 },
      ratchet: { maxRatchet: 1, probability: 0 },
      slide: { probability: 0 },
      mod: { low: 0.4, high: 0.9 },
      tie: { probability: 0, maxLength: 2 },
    },
  },
  {
    name: 'Driving',
    config: {
      pitch: { low: 36, high: 48, scale: SCALES.minorPentatonic, root: 36, maxNotes: 3 },
      gate: { fillMin: 0.8, fillMax: 1.0, mode: 'euclidean', randomOffset: true, clusterContinuation: 0.7 },
      velocity: { low: 80, high: 110 },
      gateLength: { min: 0.3, max: 0.5 },
      ratchet: { maxRatchet: 2, probability: 0.1 },
      slide: { probability: 0 },
      mod: { low: 0.1, high: 0.5 },
      tie: { probability: 0.05, maxLength: 2 },
    },
  },
]

export function getPresetByName(name: string): Preset | undefined {
  return PRESETS.find(p => p.name === name)
}
