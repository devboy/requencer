import { bench, describe } from 'vitest'
import {
  randomizeGateLength,
  randomizeGates,
  randomizeMod,
  randomizePitch,
  randomizeRatchets,
  randomizeSlides,
  randomizeTies,
  randomizeTrack,
  randomizeVelocity,
} from '../randomizer'
import { SCALES } from '../scales'

const defaultConfig = {
  pitch: { low: 36, high: 72, scale: SCALES.major, root: 48, maxNotes: 6 },
  gate: {
    fillMin: 0.3,
    fillMax: 0.7,
    mode: 'random' as const,
    randomOffset: false,
    clusterContinuation: 0.5,
  },
  velocity: { low: 40, high: 127 },
  gateLength: { min: 0.25, max: 0.75 },
  ratchet: { maxRatchet: 3, probability: 0.2 },
  slide: { probability: 0.15 },
  mod: {
    low: 0,
    high: 1,
    mode: 'random' as const,
    slew: 0.3,
    slewProbability: 0.5,
    walkStepSize: 0.1,
    syncBias: 0.5,
  },
  tie: { probability: 0.2, maxLength: 4 },
}

describe('randomizeTrack()', () => {
  bench('16 steps', () => {
    randomizeTrack(defaultConfig, { gate: 16, pitch: 16, velocity: 16, mod: 16 }, 42)
  })

  bench('64 steps', () => {
    randomizeTrack(defaultConfig, { gate: 64, pitch: 64, velocity: 64, mod: 64 }, 42)
  })
})

describe('individual randomizers (16 steps)', () => {
  bench('randomizeGates', () => {
    randomizeGates(defaultConfig.gate, 16, 42)
  })

  bench('randomizePitch', () => {
    randomizePitch(defaultConfig.pitch, 16, 42)
  })

  bench('randomizeVelocity', () => {
    randomizeVelocity(defaultConfig.velocity, 16, 42)
  })

  bench('randomizeGateLength', () => {
    randomizeGateLength(defaultConfig.gateLength, 16, 42)
  })

  bench('randomizeRatchets', () => {
    randomizeRatchets(defaultConfig.ratchet, 16, 42)
  })

  bench('randomizeSlides', () => {
    randomizeSlides(defaultConfig.slide.probability, 16, 42)
  })

  bench('randomizeMod', () => {
    randomizeMod(defaultConfig.mod, 16, 42)
  })

  bench('randomizeTies', () => {
    const gates = randomizeGates(defaultConfig.gate, 16, 42)
    randomizeTies(defaultConfig.tie.probability, defaultConfig.tie.maxLength, gates, 16, 42)
  })
})
