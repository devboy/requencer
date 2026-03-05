import { bench, describe } from 'vitest'
import type { GateStep, PitchStep, Subtrack, Transform } from '../types'
import {
  getEffectiveCompoundStep,
  getEffectiveGateStep,
  getEffectivePitchStep,
  getEffectiveSimpleStep,
  transformStepIndex,
} from '../variation'

const transforms: Record<string, Transform> = {
  reverse: { type: 'reverse', param: 0 },
  pingPong: { type: 'ping-pong', param: 0 },
  rotate: { type: 'rotate', param: 3 },
  doubleTime: { type: 'double-time', param: 0 },
  stutter: { type: 'stutter', param: 2 },
  thin: { type: 'thin', param: 2 },
  fill: { type: 'fill', param: 0 },
  transpose: { type: 'transpose', param: 5 },
  invert: { type: 'invert', param: 0 },
  octaveShift: { type: 'octave-shift', param: 1 },
}

const gateSubtrack: Subtrack<GateStep> = {
  steps: Array.from({ length: 16 }, (_, i) => ({
    on: i % 2 === 0,
    tie: false,
    length: 0.5,
    ratchet: 1,
  })),
  length: 16,
  clockDivider: 1,
  currentStep: 7,
}

const pitchSubtrack: Subtrack<PitchStep> = {
  steps: Array.from({ length: 16 }, (_, i) => ({
    note: 48 + (i % 12),
    slide: 0,
  })),
  length: 16,
  clockDivider: 1,
  currentStep: 7,
}

const velocitySubtrack: Subtrack<number> = {
  steps: Array.from({ length: 16 }, (_, i) => 64 + i * 4),
  length: 16,
  clockDivider: 1,
  currentStep: 7,
}

describe('transformStepIndex() per transform type', () => {
  for (const [name, transform] of Object.entries(transforms)) {
    bench(name, () => {
      transformStepIndex(7, 16, transform)
    })
  }
})

describe('full variation resolution', () => {
  bench('getEffectiveGateStep — 2 transforms', () => {
    getEffectiveGateStep(gateSubtrack, [transforms.reverse, transforms.thin], 0)
  })

  bench('getEffectivePitchStep — 2 transforms', () => {
    getEffectivePitchStep(pitchSubtrack, [transforms.reverse, transforms.transpose])
  })

  bench('getEffectiveSimpleStep — 1 transform', () => {
    getEffectiveSimpleStep(velocitySubtrack, [transforms.reverse])
  })

  bench('getEffectiveCompoundStep — no transforms', () => {
    getEffectiveCompoundStep(gateSubtrack, [])
  })
})
