import { describe, it, expect } from 'vitest'
import { resolveOutputs, createDefaultRouting } from '../routing'
import type { SequenceTrack, MuteTrack } from '../types'

function makeTrack(overrides: Partial<SequenceTrack> & { id: string; name: string }): SequenceTrack {
  return {
    clockDivider: 1,
    gate: { steps: [
      { on: true, tie: false, length: 0.5, ratchet: 1 },
      { on: false, tie: false, length: 0.5, ratchet: 1 },
      { on: true, tie: false, length: 0.5, ratchet: 1 },
      { on: false, tie: false, length: 0.5, ratchet: 1 },
    ], length: 4, clockDivider: 1, currentStep: 0 },
    pitch: { steps: [
      { note: 60, slide: 0 },
      { note: 62, slide: 0 },
      { note: 64, slide: 0 },
      { note: 65, slide: 0 },
    ], length: 4, clockDivider: 1, currentStep: 0 },
    velocity: { steps: [100, 80, 90, 70], length: 4, clockDivider: 1, currentStep: 0 },
    mod: { steps: [{ value: 0.5, slew: 0 }, { value: 0.6, slew: 0 }, { value: 0.7, slew: 0 }, { value: 0.8, slew: 0 }], length: 4, clockDivider: 1, currentStep: 0 },
    ...overrides,
  }
}

function makeMute(steps: boolean[] = [false, false, false, false]): MuteTrack {
  return { steps, length: steps.length, clockDivider: 1, currentStep: 0 }
}

describe('createDefaultRouting', () => {
  it('creates 1:1 routing for 4 outputs', () => {
    const routing = createDefaultRouting()
    expect(routing).toHaveLength(4)
    expect(routing[0]).toEqual({ gate: 0, pitch: 0, velocity: 0, mod: 0, modSource: 'seq' })
    expect(routing[1]).toEqual({ gate: 1, pitch: 1, velocity: 1, mod: 1, modSource: 'seq' })
    expect(routing[2]).toEqual({ gate: 2, pitch: 2, velocity: 2, mod: 2, modSource: 'seq' })
    expect(routing[3]).toEqual({ gate: 3, pitch: 3, velocity: 3, mod: 3, modSource: 'seq' })
  })
})

describe('resolveOutputs', () => {
  const tracks = [
    makeTrack({ id: '0', name: 'Track 1' }),
    makeTrack({ id: '1', name: 'Track 2' }),
    makeTrack({ id: '2', name: 'Track 3' }),
    makeTrack({ id: '3', name: 'Track 4' }),
  ]
  const mutes = [makeMute(), makeMute(), makeMute(), makeMute()]

  it('resolves default 1:1 routing correctly', () => {
    const routing = createDefaultRouting()
    const events = resolveOutputs(tracks, routing, mutes)
    expect(events).toHaveLength(4)
    expect(events[0]).toEqual({ output: 0, gate: true, pitch: 60, velocity: 100, mod: 0.5, modSlew: 0, gateLength: 0.5, ratchetCount: 1, slide: 0, retrigger: true, sustain: false })
    expect(events[1]).toEqual({ output: 1, gate: true, pitch: 60, velocity: 100, mod: 0.5, modSlew: 0, gateLength: 0.5, ratchetCount: 1, slide: 0, retrigger: true, sustain: false })
  })

  it('resolves cross-routing — output 2 gate from track 0', () => {
    const routing = createDefaultRouting()
    routing[2] = { ...routing[2], gate: 0 }
    const customTracks = [
      ...tracks.slice(0, 2),
      makeTrack({
        id: '2', name: 'Track 3',
        gate: { steps: [
          { on: false, tie: false, length: 0.5, ratchet: 1 },
          { on: false, tie: false, length: 0.5, ratchet: 1 },
          { on: false, tie: false, length: 0.5, ratchet: 1 },
          { on: false, tie: false, length: 0.5, ratchet: 1 },
        ], length: 4, clockDivider: 1, currentStep: 0 },
      }),
      tracks[3],
    ]
    const events = resolveOutputs(customTracks, routing, mutes)
    expect(events[2].gate).toBe(true)
  })

  it('applies mute patterns — muted step produces gate off', () => {
    const routing = createDefaultRouting()
    const mutedMutes = [
      makeMute([true, false, false, false]),
      makeMute(), makeMute(), makeMute(),
    ]
    const events = resolveOutputs(tracks, routing, mutedMutes)
    expect(events[0].gate).toBe(false)
    expect(events[1].gate).toBe(true)
  })

  it('mute is per-output, not per-source-track', () => {
    // Output 0 gates from track 2, but mute is on output 0 (not track 2)
    const routing = createDefaultRouting()
    routing[0] = { ...routing[0], gate: 2 }
    const mutedMutes = [
      makeMute([true, false, false, false]), // output 0 muted
      makeMute(),
      makeMute(), // track 2 NOT muted
      makeMute(),
    ]
    const events = resolveOutputs(tracks, routing, mutedMutes)
    expect(events[0].gate).toBe(false) // muted by output 0's mute, not track 2's
    expect(events[2].gate).toBe(true)  // output 2 not muted even though track 2 provides gate to output 0
  })

  it('reads mod from source track', () => {
    const routing = createDefaultRouting()
    routing[0] = { ...routing[0], mod: 2 }
    const customTracks = tracks.map((t, i) =>
      i === 2 ? { ...t, mod: { ...t.mod, steps: [{ value: 1.0, slew: 0 }, { value: 0.6, slew: 0 }, { value: 0.7, slew: 0 }, { value: 0.8, slew: 0 }] } } : t
    )
    const events = resolveOutputs(customTracks, routing, mutes)
    expect(events[0].mod).toBe(1.0) // from track 2, not track 0
  })

  it('cross-routes pitch from different track', () => {
    const routing = createDefaultRouting()
    routing[0] = { ...routing[0], pitch: 1 }
    const events = resolveOutputs(tracks, routing, mutes)
    expect(events[0].pitch).toBe(60)
    expect(events[0].gate).toBe(true)
  })

  // --- Tie behavior ---

  it('tied step produces gate: true, retrigger: false', () => {
    const routing = createDefaultRouting()
    const tieTracks = [
      makeTrack({
        id: '0', name: 'Track 1',
        gate: { steps: [
          { on: true, tie: false, length: 0.5, ratchet: 1 },   // step 0: trigger
          { on: false, tie: true, length: 0.5, ratchet: 1 },   // step 1: tied continuation
          { on: false, tie: false, length: 0.5, ratchet: 1 },  // step 2: normal off
          { on: true, tie: false, length: 0.5, ratchet: 1 },   // step 3: normal trigger
        ], length: 4, clockDivider: 1, currentStep: 1 }, // at tied step
      }),
      tracks[1], tracks[2], tracks[3],
    ]
    const events = resolveOutputs(tieTracks, routing, mutes)
    expect(events[0].gate).toBe(true)       // tied step is gate-active
    expect(events[0].retrigger).toBe(false)  // don't retrigger (continuation)
  })

  it('normal gate-on step has retrigger: true', () => {
    const routing = createDefaultRouting()
    const events = resolveOutputs(tracks, routing, mutes)
    expect(events[0].retrigger).toBe(true)
  })

  it('look-ahead: sustain: true when next step is tied', () => {
    const routing = createDefaultRouting()
    const tieTracks = [
      makeTrack({
        id: '0', name: 'Track 1',
        gate: { steps: [
          { on: true, tie: false, length: 0.5, ratchet: 1 },   // step 0: trigger
          { on: false, tie: true, length: 0.5, ratchet: 1 },   // step 1: tied
          { on: false, tie: false, length: 0.5, ratchet: 1 },
          { on: false, tie: false, length: 0.5, ratchet: 1 },
        ], length: 4, clockDivider: 1, currentStep: 0 }, // at trigger step
      }),
      tracks[1], tracks[2], tracks[3],
    ]
    const events = resolveOutputs(tieTracks, routing, mutes)
    expect(events[0].sustain).toBe(true)    // next step is tie → sustain
  })

  it('sustain: false when next step is not tied', () => {
    const routing = createDefaultRouting()
    const events = resolveOutputs(tracks, routing, mutes)
    expect(events[0].sustain).toBe(false)
  })

  it('tied step forces ratchetCount to 1', () => {
    const routing = createDefaultRouting()
    const tieTracks = [
      makeTrack({
        id: '0', name: 'Track 1',
        gate: { steps: [
          { on: true, tie: false, length: 0.5, ratchet: 1 },
          { on: false, tie: true, length: 0.5, ratchet: 3 },  // ratchet 3 but tied
          { on: false, tie: false, length: 0.5, ratchet: 1 },
          { on: false, tie: false, length: 0.5, ratchet: 1 },
        ], length: 4, clockDivider: 1, currentStep: 1 },
      }),
      tracks[1], tracks[2], tracks[3],
    ]
    const events = resolveOutputs(tieTracks, routing, mutes)
    expect(events[0].ratchetCount).toBe(1)  // forced to 1 on tied step
  })

  it('mute on tied step produces gate: false (cuts tie)', () => {
    const routing = createDefaultRouting()
    const tieTracks = [
      makeTrack({
        id: '0', name: 'Track 1',
        gate: { steps: [
          { on: true, tie: false, length: 0.5, ratchet: 1 },
          { on: false, tie: true, length: 0.5, ratchet: 1 },  // tied but muted
          { on: false, tie: false, length: 0.5, ratchet: 1 },
          { on: false, tie: false, length: 0.5, ratchet: 1 },
        ], length: 4, clockDivider: 1, currentStep: 1 },
      }),
      tracks[1], tracks[2], tracks[3],
    ]
    const mutedMutes = [
      { steps: [false, true, false, false], length: 4, clockDivider: 1, currentStep: 1 }, // mute on step 1
      makeMute(), makeMute(), makeMute(),
    ]
    const events = resolveOutputs(tieTracks, routing, mutedMutes)
    expect(events[0].gate).toBe(false)  // mute overrides tie
  })

  it('middle-of-chain tied step has gateLength 1.0 when next is also tied', () => {
    const routing = createDefaultRouting()
    const tieTracks = [
      makeTrack({
        id: '0', name: 'Track 1',
        gate: { steps: [
          { on: true, tie: false, length: 0.5, ratchet: 1 },
          { on: false, tie: true, length: 0.3, ratchet: 1 },  // middle, own GL=0.3
          { on: false, tie: true, length: 0.5, ratchet: 1 },  // still tied
          { on: false, tie: false, length: 0.5, ratchet: 1 },
        ], length: 4, clockDivider: 1, currentStep: 1 },
      }),
      tracks[1], tracks[2], tracks[3],
    ]
    const events = resolveOutputs(tieTracks, routing, mutes)
    expect(events[0].gateLength).toBe(1.0) // middle of chain → full gate
    expect(events[0].sustain).toBe(true)   // next step is also tied
  })

  // --- modSource routing ---

  it('modSource seq reads ModStep.value from track mod subtrack', () => {
    const routing = createDefaultRouting()
    // Default modSource is 'seq'
    const events = resolveOutputs(tracks, routing, mutes)
    expect(events[0].mod).toBe(0.5) // first ModStep value
    expect(events[0].modSlew).toBe(0) // first ModStep slew
  })

  it('modSource lfo reads from lfoValues parameter', () => {
    const routing = createDefaultRouting()
    routing[0] = { ...routing[0], modSource: 'lfo' }
    const lfoValues = [0.75, 0.5, 0.25, 0.1]
    const events = resolveOutputs(tracks, routing, mutes, undefined, undefined, lfoValues)
    expect(events[0].mod).toBeCloseTo(0.75, 2)
    expect(events[0].modSlew).toBe(0) // LFO has no step slew
  })

  it('different outputs can use different modSources from same track', () => {
    const routing = createDefaultRouting()
    routing[0] = { ...routing[0], mod: 0, modSource: 'seq' }
    routing[1] = { ...routing[1], mod: 0, modSource: 'lfo' }
    const lfoValues = [0.9, 0.5, 0.25, 0.1]
    const events = resolveOutputs(tracks, routing, mutes, undefined, undefined, lfoValues)
    expect(events[0].mod).toBe(0.5) // seq: reads from track 0 mod step
    expect(events[1].mod).toBeCloseTo(0.9, 2) // lfo: reads from lfoValues[0]
  })

  it('modSource defaults to seq when not specified', () => {
    // Create routing without modSource field explicitly
    const routing = createDefaultRouting()
    const events = resolveOutputs(tracks, routing, mutes)
    // Should use seq by default
    expect(events[0].mod).toBe(0.5)
  })
})
