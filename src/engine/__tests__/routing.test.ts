import { describe, it, expect } from 'vitest'
import { resolveOutputs, createDefaultRouting } from '../routing'
import type { SequenceTrack, MuteTrack } from '../types'

function makeTrack(overrides: Partial<SequenceTrack> & { id: string; name: string }): SequenceTrack {
  return {
    clockDivider: 1,
    gate: { steps: [
      { on: true, length: 0.5, ratchet: 1 },
      { on: false, length: 0.5, ratchet: 1 },
      { on: true, length: 0.5, ratchet: 1 },
      { on: false, length: 0.5, ratchet: 1 },
    ], length: 4, clockDivider: 1, currentStep: 0 },
    pitch: { steps: [
      { note: 60, slide: 0 },
      { note: 62, slide: 0 },
      { note: 64, slide: 0 },
      { note: 65, slide: 0 },
    ], length: 4, clockDivider: 1, currentStep: 0 },
    velocity: { steps: [100, 80, 90, 70], length: 4, clockDivider: 1, currentStep: 0 },
    mod: { steps: [50, 60, 70, 80], length: 4, clockDivider: 1, currentStep: 0 },
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
    expect(routing[0]).toEqual({ gate: 0, pitch: 0, velocity: 0, mod: 0 })
    expect(routing[1]).toEqual({ gate: 1, pitch: 1, velocity: 1, mod: 1 })
    expect(routing[2]).toEqual({ gate: 2, pitch: 2, velocity: 2, mod: 2 })
    expect(routing[3]).toEqual({ gate: 3, pitch: 3, velocity: 3, mod: 3 })
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
    expect(events[0]).toEqual({ output: 0, gate: true, pitch: 60, velocity: 100, mod: 50, gateLength: 0.5, ratchetCount: 1, slide: 0 })
    expect(events[1]).toEqual({ output: 1, gate: true, pitch: 60, velocity: 100, mod: 50, gateLength: 0.5, ratchetCount: 1, slide: 0 })
  })

  it('resolves cross-routing — output 2 gate from track 0', () => {
    const routing = createDefaultRouting()
    routing[2] = { ...routing[2], gate: 0 }
    const customTracks = [
      ...tracks.slice(0, 2),
      makeTrack({
        id: '2', name: 'Track 3',
        gate: { steps: [
          { on: false, length: 0.5, ratchet: 1 },
          { on: false, length: 0.5, ratchet: 1 },
          { on: false, length: 0.5, ratchet: 1 },
          { on: false, length: 0.5, ratchet: 1 },
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
      i === 2 ? { ...t, mod: { ...t.mod, steps: [127, 60, 70, 80] } } : t
    )
    const events = resolveOutputs(customTracks, routing, mutes)
    expect(events[0].mod).toBe(127) // from track 2, not track 0
  })

  it('cross-routes pitch from different track', () => {
    const routing = createDefaultRouting()
    routing[0] = { ...routing[0], pitch: 1 }
    const events = resolveOutputs(tracks, routing, mutes)
    expect(events[0].pitch).toBe(60)
    expect(events[0].gate).toBe(true)
  })
})
