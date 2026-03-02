import { describe, it, expect } from 'vitest'
import { createSequencer, setSlide, setGateOn } from '../sequencer'
import { resolveOutputs, createDefaultRouting } from '../routing'
import { randomizeSlides } from '../randomizer'
import type { SequenceTrack, MuteTrack, GateStep, PitchStep } from '../types'

function makeTrack(overrides: Partial<SequenceTrack> & { id: string; name: string }): SequenceTrack {
  return {
    clockDivider: 1,
    gate: {
      steps: [
        { on: true, length: 0.5, ratchet: 1 },
        { on: false, length: 0.5, ratchet: 1 },
        { on: true, length: 0.5, ratchet: 1 },
        { on: false, length: 0.5, ratchet: 1 },
      ],
      length: 4,
      clockDivider: 1,
      currentStep: 0,
    },
    pitch: {
      steps: [
        { note: 60, slide: 0 },
        { note: 62, slide: 0 },
        { note: 64, slide: 0 },
        { note: 65, slide: 0 },
      ],
      length: 4,
      clockDivider: 1,
      currentStep: 0,
    },
    velocity: { steps: [100, 80, 90, 70], length: 4, clockDivider: 1, currentStep: 0 },
    mod: { steps: [50, 60, 70, 80], length: 4, clockDivider: 1, currentStep: 0 },
    ...overrides,
  }
}

function makeMute(steps: boolean[] = [false, false, false, false]): MuteTrack {
  return { steps, length: steps.length, clockDivider: 1, currentStep: 0 }
}

describe('slide in compound PitchStep', () => {
  it('default slide values are 0', () => {
    const state = createSequencer()
    for (const track of state.tracks) {
      expect(track.pitch.steps.every((s: PitchStep) => s.slide === 0)).toBe(true)
    }
  })

  it('setSlide sets slide value on a pitch step', () => {
    let state = createSequencer()
    state = setSlide(state, 0, 3, 0.15)
    expect(state.tracks[0].pitch.steps[3].slide).toBe(0.15)
    expect(state.tracks[0].pitch.steps[0].slide).toBe(0) // others unchanged
  })

  it('setSlide does not alter the note value', () => {
    let state = createSequencer()
    const noteBefore = state.tracks[0].pitch.steps[2].note
    state = setSlide(state, 0, 2, 0.10)
    expect(state.tracks[0].pitch.steps[2].note).toBe(noteBefore)
    expect(state.tracks[0].pitch.steps[2].slide).toBe(0.10)
  })
})

describe('slide in routing', () => {
  it('resolveOutputs includes slide from pitch source track', () => {
    const tracks = [
      makeTrack({
        id: '0', name: 'T1',
        pitch: {
          steps: [
            { note: 60, slide: 0.15 },
            { note: 62, slide: 0 },
            { note: 64, slide: 0 },
            { note: 65, slide: 0 },
          ],
          length: 4, clockDivider: 1, currentStep: 0,
        },
      }),
      makeTrack({ id: '1', name: 'T2' }),
      makeTrack({ id: '2', name: 'T3' }),
      makeTrack({ id: '3', name: 'T4' }),
    ]
    const mutes = [makeMute(), makeMute(), makeMute(), makeMute()]
    const routing = createDefaultRouting()
    const events = resolveOutputs(tracks, routing, mutes)
    expect(events[0].slide).toBe(0.15)
    expect(events[1].slide).toBe(0)
  })

  it('slide follows pitch routing, not gate routing', () => {
    const tracks = [
      makeTrack({ id: '0', name: 'T1' }),
      makeTrack({
        id: '1', name: 'T2',
        pitch: {
          steps: [
            { note: 60, slide: 0.20 },
            { note: 62, slide: 0.20 },
            { note: 64, slide: 0.20 },
            { note: 65, slide: 0.20 },
          ],
          length: 4, clockDivider: 1, currentStep: 0,
        },
      }),
      makeTrack({ id: '2', name: 'T3' }),
      makeTrack({ id: '3', name: 'T4' }),
    ]
    const mutes = [makeMute(), makeMute(), makeMute(), makeMute()]
    const routing = createDefaultRouting()
    // Output 0: gate from track 0, pitch from track 1
    routing[0] = { ...routing[0], pitch: 1 }
    const events = resolveOutputs(tracks, routing, mutes)
    // Slide should come from pitch source (track 1), not gate source (track 0)
    expect(events[0].slide).toBe(0.20)
  })
})

describe('randomizeSlides', () => {
  it('probability 0 produces all zeros', () => {
    const slides = randomizeSlides(0, 16, 42)
    expect(slides.every(s => s === 0)).toBe(true)
  })

  it('probability 1 produces all non-zero', () => {
    const slides = randomizeSlides(1, 16, 42)
    expect(slides.every(s => s > 0)).toBe(true)
  })

  it('probability 0.5 produces mix of zero and non-zero', () => {
    const slides = randomizeSlides(0.5, 64, 42)
    const activeCount = slides.filter(s => s > 0).length
    expect(activeCount).toBeGreaterThan(10)
    expect(activeCount).toBeLessThan(54)
  })

  it('non-zero values are 0.10 (default portamento time)', () => {
    const slides = randomizeSlides(1, 8, 42)
    for (const s of slides) {
      expect(s).toBe(0.10)
    }
  })

  it('is deterministic with same seed', () => {
    const a = randomizeSlides(0.3, 16, 123)
    const b = randomizeSlides(0.3, 16, 123)
    expect(a).toEqual(b)
  })

  it('produces different results with different seeds', () => {
    const a = randomizeSlides(0.5, 32, 1)
    const b = randomizeSlides(0.5, 32, 2)
    expect(a).not.toEqual(b)
  })
})

describe('slide in RandomConfig', () => {
  it('randomizeTrack includes slide in config', () => {
    const state = createSequencer()
    expect(state.randomConfigs[0].slide).toBeDefined()
    expect(state.randomConfigs[0].slide.probability).toBeGreaterThanOrEqual(0)
    expect(state.randomConfigs[0].slide.probability).toBeLessThanOrEqual(1)
  })
})
