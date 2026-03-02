import { describe, it, expect } from 'vitest'
import { createInitialUIState, dispatch, getLEDState } from '../mode-machine'
import { createSequencer } from '../../engine/sequencer'
import type { SequencerState } from '../../engine/types'
import type { UIState } from '../hw-types'
import { getVisibleRows } from '../rand-rows'

function makeState(): SequencerState {
  return createSequencer()
}

describe('createInitialUIState', () => {
  it('returns home mode with track 0 selected', () => {
    const ui = createInitialUIState()
    expect(ui.mode).toBe('home')
    expect(ui.selectedTrack).toBe(0)
    expect(ui.selectedStep).toBe(0)
    expect(ui.currentPage).toBe(0)
  })
})

describe('dispatch', () => {
  describe('play-stop', () => {
    it('toggles transport', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      expect(eng.transport.playing).toBe(false)
      const result = dispatch(ui, eng, { type: 'play-stop' })
      expect(result.engine.transport.playing).toBe(true)
    })

    it('works from any mode', () => {
      const ui = { ...createInitialUIState(), mode: 'gate-edit' as const }
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'play-stop' })
      expect(result.engine.transport.playing).toBe(true)
      expect(result.ui.mode).toBe('gate-edit')
    })
  })

  describe('reset', () => {
    it('resets all playheads', () => {
      const ui = createInitialUIState()
      let eng = makeState()
      // Advance some playheads
      eng = {
        ...eng,
        transport: { ...eng.transport, masterTick: 42 },
        tracks: eng.tracks.map(t => ({
          ...t,
          gate: { ...t.gate, currentStep: 5 },
          pitch: { ...t.pitch, currentStep: 3 },
        })),
      }
      const result = dispatch(ui, eng, { type: 'reset' })
      expect(result.engine.transport.masterTick).toBe(0)
      for (const track of result.engine.tracks) {
        expect(track.gate.currentStep).toBe(0)
        expect(track.pitch.currentStep).toBe(0)
        expect(track.velocity.currentStep).toBe(0)
      }
    })
  })

  describe('track-select (cross-modal)', () => {
    it('selects track from home', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'track-select', track: 2 })
      expect(result.ui.selectedTrack).toBe(2)
      expect(result.ui.mode).toBe('home')
    })

    it('switches track without leaving edit mode', () => {
      const ui = { ...createInitialUIState(), mode: 'gate-edit' as const }
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'track-select', track: 3 })
      expect(result.ui.selectedTrack).toBe(3)
      expect(result.ui.mode).toBe('gate-edit')
    })

    it('resets page and selected step on track switch', () => {
      const ui = { ...createInitialUIState(), mode: 'pitch-edit' as const, currentPage: 2, selectedStep: 5 }
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'track-select', track: 1 })
      expect(result.ui.currentPage).toBe(0)
      expect(result.ui.selectedStep).toBe(0)
    })
  })

  describe('subtrack-select', () => {
    it('gate button enters gate-edit', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'subtrack-select', subtrack: 'gate' })
      expect(result.ui.mode).toBe('gate-edit')
    })

    it('pitch button enters pitch-edit', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'subtrack-select', subtrack: 'pitch' })
      expect(result.ui.mode).toBe('pitch-edit')
    })

    it('velocity button enters vel-edit', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'subtrack-select', subtrack: 'velocity' })
      expect(result.ui.mode).toBe('vel-edit')
    })

    it('mod button enters mod-edit', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'subtrack-select', subtrack: 'mod' })
      expect(result.ui.mode).toBe('mod-edit')
    })

    it('works cross-modally (from another edit screen)', () => {
      const ui = { ...createInitialUIState(), mode: 'pitch-edit' as const }
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'subtrack-select', subtrack: 'gate' })
      expect(result.ui.mode).toBe('gate-edit')
    })
  })

  describe('feature-press', () => {
    it('mute button enters mute-edit', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'feature-press', feature: 'mute' })
      expect(result.ui.mode).toBe('mute-edit')
    })

    it('route button enters route', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'feature-press', feature: 'route' })
      expect(result.ui.mode).toBe('route')
    })

    it('rand button enters rand', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'feature-press', feature: 'rand' })
      expect(result.ui.mode).toBe('rand')
    })

  })

  describe('home mode', () => {
    it('encoder-a-turn down selects next track', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -1 })
      expect(result.ui.selectedTrack).toBe(1)
    })

    it('encoder-a-turn wraps around', () => {
      const ui = { ...createInitialUIState(), selectedTrack: 3 }
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -1 })
      expect(result.ui.selectedTrack).toBe(0)
    })

    it('encoder-a-push enters gate-edit', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-push' })
      expect(result.ui.mode).toBe('gate-edit')
    })

    it('encoder-b-turn is no-op', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.ui).toEqual(ui)
      expect(result.engine).toBe(eng)
    })

    it('encoder-b-push is no-op', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-push' })
      expect(result.ui).toEqual(ui)
    })
  })

  describe('gate-edit mode', () => {
    function gateUI(page = 0) {
      return { ...createInitialUIState(), mode: 'gate-edit' as const, currentPage: page }
    }

    it('step-press toggles gate step', () => {
      const ui = gateUI()
      let eng = makeState()
      // Set gate step 3 to off
      const steps = eng.tracks[0].gate.steps.map((s, i) => i === 3 ? { ...s, on: false } : s)
      eng = {
        ...eng,
        tracks: eng.tracks.map((t, i) =>
          i === 0 ? { ...t, gate: { ...t.gate, steps } } : t
        ),
      }
      const result = dispatch(ui, eng, { type: 'step-press', step: 3 })
      expect(result.engine.tracks[0].gate.steps[3].on).toBe(true)
    })

    it('step-press on ON step toggles it off immediately', () => {
      const ui = gateUI()
      let eng = makeState()
      const steps = eng.tracks[0].gate.steps.map((s, i) => i === 5 ? { ...s, on: true } : s)
      eng = {
        ...eng,
        tracks: eng.tracks.map((t, i) =>
          i === 0 ? { ...t, gate: { ...t.gate, steps } } : t
        ),
      }
      const result = dispatch(ui, eng, { type: 'step-press', step: 5 })
      expect(result.engine.tracks[0].gate.steps[5].on).toBe(false)
    })

    it('hold step selects it, encoder A adjusts gate length', () => {
      const ui = gateUI()
      let eng = makeState()
      const steps = eng.tracks[0].gate.steps.map((s, i) => i === 3 ? { ...s, on: true } : s)
      eng = {
        ...eng,
        tracks: eng.tracks.map((t, i) =>
          i === 0 ? { ...t, gate: { ...t.gate, steps } } : t
        ),
      }
      // Hold step 3
      const held = dispatch(ui, eng, { type: 'hold-start', button: { kind: 'step', step: 3 } })
      expect(held.ui.selectedStep).toBe(3)
      expect(held.ui.heldButton).toEqual({ kind: 'step', step: 3 })
      // Encoder A adjusts gate length
      const adjusted = dispatch(held.ui, held.engine, { type: 'encoder-a-turn', delta: 2 })
      expect(adjusted.engine.tracks[0].gate.steps[3].length).toBeCloseTo(0.6) // 0.5 + 2*0.05
    })

    it('hold step + encoder B adjusts ratchet count', () => {
      const ui = gateUI()
      let eng = makeState()
      const steps = eng.tracks[0].gate.steps.map((s, i) => i === 3 ? { ...s, on: true } : s)
      eng = {
        ...eng,
        tracks: eng.tracks.map((t, i) =>
          i === 0 ? { ...t, gate: { ...t.gate, steps } } : t
        ),
      }
      const held = dispatch(ui, eng, { type: 'hold-start', button: { kind: 'step', step: 3 } })
      const adjusted = dispatch(held.ui, held.engine, { type: 'encoder-b-turn', delta: 1 })
      expect(adjusted.engine.tracks[0].gate.steps[3].ratchet).toBe(2)
    })

    it('hold-end deselects step', () => {
      const ui = { ...gateUI(), selectedStep: 3, heldButton: { kind: 'step' as const, step: 3 } }
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'hold-end' })
      expect(result.ui.selectedStep).toBe(-1)
      expect(result.ui.heldButton).toBeNull()
    })

    it('encoder-b-turn pages forward when no step selected', () => {
      const ui = { ...gateUI(0), selectedStep: -1 }
      let eng = makeState()
      // Set gate length to 32 so there are 2 pages
      const steps = Array.from({ length: 32 }, () => ({ on: false, length: 0.5, ratchet: 1 }))
      eng = {
        ...eng,
        tracks: eng.tracks.map((t, i) =>
          i === 0 ? { ...t, gate: { ...t.gate, steps, length: 32 } } : t
        ),
      }
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.ui.currentPage).toBe(1)
    })

    it('back returns to home', () => {
      const ui = gateUI()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'back' })
      expect(result.ui.mode).toBe('home')
    })

    it('encoder-b-push is no-op', () => {
      const ui = gateUI()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-push' })
      expect(result.ui.mode).toBe('gate-edit')
    })
  })

  describe('pitch-edit mode', () => {
    function pitchUI(step = 0) {
      return { ...createInitialUIState(), mode: 'pitch-edit' as const, selectedStep: step }
    }

    it('step-press selects step', () => {
      const ui = pitchUI()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'step-press', step: 7 })
      expect(result.ui.selectedStep).toBe(7)
    })

    it('encoder-a-turn adjusts pitch of selected step', () => {
      const ui = pitchUI(3)
      const eng = makeState()
      const before = eng.tracks[0].pitch.steps[3].note
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 2 })
      expect(result.engine.tracks[0].pitch.steps[3].note).toBe(before + 2)
    })

    it('pitch clamps to 0-127', () => {
      const ui = pitchUI(0)
      let eng = makeState()
      const steps = eng.tracks[0].pitch.steps.map((s, i) => i === 0 ? { ...s, note: 127 } : s)
      eng = {
        ...eng,
        tracks: eng.tracks.map((t, i) =>
          i === 0 ? { ...t, pitch: { ...t.pitch, steps } } : t
        ),
      }
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 5 })
      expect(result.engine.tracks[0].pitch.steps[0].note).toBe(127)
    })

    it('encoder-b-turn adjusts slide for selected step', () => {
      const ui = pitchUI(2)
      const eng = makeState()
      expect(eng.tracks[0].pitch.steps[2].slide).toBe(0)
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.tracks[0].pitch.steps[2].slide).toBe(0.05)
    })

    it('slide clamps to 0-0.50', () => {
      const ui = pitchUI(0)
      const eng = makeState()
      // Test lower clamp
      const down = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -1 })
      expect(down.engine.tracks[0].pitch.steps[0].slide).toBe(0)
      // Set to max and test upper clamp
      let e = eng
      for (let i = 0; i < 12; i++) e = dispatch(ui, e, { type: 'encoder-b-turn', delta: 1 }).engine as any
      // After 12 increments of 0.05 = 0.60, should clamp to 0.50
      expect((e as any).tracks[0].pitch.steps[0].slide).toBeLessThanOrEqual(0.50)
    })

    it('encoder-a-push cycles page', () => {
      const ui = pitchUI()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-push' })
      // Default 16-step track has 1 page, so cycles back to 0
      expect(result.ui.currentPage).toBe(0)
    })

    it('back returns to home', () => {
      const ui = pitchUI()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'back' })
      expect(result.ui.mode).toBe('home')
    })

    it('encoder-b-push is no-op', () => {
      const ui = pitchUI()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-push' })
      expect(result.ui.mode).toBe('pitch-edit')
    })
  })

  describe('vel-edit mode', () => {
    it('encoder-a-turn adjusts velocity of selected step', () => {
      const ui = { ...createInitialUIState(), mode: 'vel-edit' as const, selectedStep: 2 }
      const eng = makeState()
      const before = eng.tracks[0].velocity.steps[2]
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 5 })
      expect(result.engine.tracks[0].velocity.steps[2]).toBe(before + 5)
    })
  })

  describe('mute-edit mode', () => {
    it('step-press toggles mute step', () => {
      const ui = { ...createInitialUIState(), mode: 'mute-edit' as const }
      const eng = makeState()
      expect(eng.mutePatterns[0].steps[4]).toBe(false)
      const result = dispatch(ui, eng, { type: 'step-press', step: 4 })
      expect(result.engine.mutePatterns[0].steps[4]).toBe(true)
    })
  })

  describe('stub modes (route, rand, div)', () => {
    it('back returns to home from route', () => {
      const ui = { ...createInitialUIState(), mode: 'route' as const }
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'back' })
      expect(result.ui.mode).toBe('home')
    })

    it('back returns to home from rand', () => {
      const ui = { ...createInitialUIState(), mode: 'rand' as const }
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'back' })
      expect(result.ui.mode).toBe('home')
    })

    it('encoder-b-push is no-op in route', () => {
      const ui = { ...createInitialUIState(), mode: 'route' as const }
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-push' })
      expect(result.ui.mode).toBe('route')
    })

    it('encoder-b-push is no-op in rand', () => {
      const ui = { ...createInitialUIState(), mode: 'rand' as const }
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-push' })
      expect(result.ui.mode).toBe('rand')
    })
  })
})

describe('getLEDState', () => {
  it('selected track LED is on', () => {
    const ui = { ...createInitialUIState(), selectedTrack: 2 }
    const eng = makeState()
    const leds = getLEDState(ui, eng)
    expect(leds.tracks[2]).toBe('on')
    expect(leds.tracks[0]).toBe('off')
    expect(leds.tracks[1]).toBe('off')
    expect(leds.tracks[3]).toBe('off')
  })

  it('play LED reflects transport state', () => {
    const ui = createInitialUIState()
    const eng = makeState()
    expect(getLEDState(ui, eng).play).toBe('off')
    const playing = { ...eng, transport: { ...eng.transport, playing: true } }
    expect(getLEDState(ui, playing).play).toBe('pulse')
  })

  it('gate-edit shows gate pattern on step LEDs', () => {
    const ui = { ...createInitialUIState(), mode: 'gate-edit' as const }
    let eng = makeState()
    const steps = Array.from({ length: 16 }, (_, i) => ({
      on: i === 0 || i === 5,
      length: 0.5,
      ratchet: 1,
    }))
    eng = {
      ...eng,
      tracks: eng.tracks.map((t, i) =>
        i === 0 ? { ...t, gate: { ...t.gate, steps, length: 16, currentStep: 3 } } : t
      ),
    }
    const leds = getLEDState(ui, eng)
    expect(leds.steps[0]).toBe('on')   // gate on
    expect(leds.steps[5]).toBe('on')   // gate on
    expect(leds.steps[1]).toBe('dim')  // gate off
    expect(leds.steps[3]).toBe('flash') // playhead
  })

  it('pitch-edit highlights selected step', () => {
    const ui = { ...createInitialUIState(), mode: 'pitch-edit' as const, selectedStep: 4 }
    const eng = makeState()
    const leds = getLEDState(ui, eng)
    expect(leds.steps[4]).toBe('flash')
    expect(leds.steps[0]).toBe('dim')
  })
})

describe('hold combos', () => {
  function holdUI(button: import('../../ui/hw-types').HeldButtonTarget) {
    return { ...createInitialUIState(), heldButton: button, holdEncoderUsed: false }
  }

  describe('hold-start / hold-end events', () => {
    it('hold-start sets heldButton on UIState', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'hold-start', button: { kind: 'track', track: 0 } })
      expect(result.ui.heldButton).toEqual({ kind: 'track', track: 0 })
      expect(result.ui.holdEncoderUsed).toBe(false)
    })

    it('hold-end clears heldButton', () => {
      const ui = holdUI({ kind: 'track', track: 0 })
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'hold-end' })
      expect(result.ui.heldButton).toBeNull()
    })
  })

  describe('hold track + encoder', () => {
    it('hold track + enc A changes all subtrack lengths', () => {
      const ui = holdUI({ kind: 'track', track: 0 })
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 2 })
      expect(result.engine.tracks[0].gate.length).toBe(18) // 16 + 2
      expect(result.engine.tracks[0].pitch.length).toBe(18)
      expect(result.engine.tracks[0].velocity.length).toBe(18)
      expect(result.ui.holdEncoderUsed).toBe(true)
    })

    it('hold track + enc B changes track clock divider', () => {
      const ui = holdUI({ kind: 'track', track: 0 })
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.tracks[0].clockDivider).toBe(2) // 1 + 1
      expect(result.ui.holdEncoderUsed).toBe(true)
    })

    it('hold track + enc A respects length clamping', () => {
      const ui = holdUI({ kind: 'track', track: 0 })
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -20 })
      expect(result.engine.tracks[0].gate.length).toBe(1) // clamped to min
    })

    it('hold track targets held track, not selectedTrack', () => {
      // selectedTrack is 0, but we hold track 3 — encoder should modify track 3
      const ui = { ...holdUI({ kind: 'track', track: 3 }), selectedTrack: 0 }
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 2 })
      expect(result.engine.tracks[3].gate.length).toBe(18) // held track changed
      expect(result.engine.tracks[0].gate.length).toBe(16) // selected track unchanged
    })
  })

  describe('hold subtrack + encoder', () => {
    it('hold gate + enc A changes gate length only', () => {
      const ui = holdUI({ kind: 'subtrack', subtrack: 'gate' })
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 4 })
      expect(result.engine.tracks[0].gate.length).toBe(20) // 16 + 4
      expect(result.engine.tracks[0].pitch.length).toBe(16) // unchanged
    })

    it('hold pitch + enc B changes pitch clock divider', () => {
      const ui = holdUI({ kind: 'subtrack', subtrack: 'pitch' })
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 3 })
      expect(result.engine.tracks[0].pitch.clockDivider).toBe(4) // 1 + 3
    })

    it('hold velocity + enc A changes velocity length', () => {
      const ui = holdUI({ kind: 'subtrack', subtrack: 'velocity' })
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -8 })
      expect(result.engine.tracks[0].velocity.length).toBe(8) // 16 - 8
    })
  })

  describe('hold mute + encoder', () => {
    it('hold mute + enc A changes mute length', () => {
      const ui = holdUI({ kind: 'feature', feature: 'mute' })
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 8 })
      expect(result.engine.mutePatterns[0].length).toBe(24) // 16 + 8
    })

    it('hold mute + enc B changes mute clock divider', () => {
      const ui = holdUI({ kind: 'feature', feature: 'mute' })
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 2 })
      expect(result.engine.mutePatterns[0].clockDivider).toBe(3) // 1 + 2
    })
  })

  describe('hold + RESET (targeted playhead reset)', () => {
    it('hold track + RESET resets that track playheads', () => {
      const ui = holdUI({ kind: 'track', track: 1 })
      let eng = makeState()
      eng = {
        ...eng,
        tracks: eng.tracks.map((t, i) => ({
          ...t,
          gate: { ...t.gate, currentStep: 5 },
          pitch: { ...t.pitch, currentStep: 3 },
          velocity: { ...t.velocity, currentStep: 7 },
        })),
      }
      const result = dispatch(ui, eng, { type: 'reset' })
      // Track 1 reset
      expect(result.engine.tracks[1].gate.currentStep).toBe(0)
      expect(result.engine.tracks[1].pitch.currentStep).toBe(0)
      expect(result.engine.tracks[1].velocity.currentStep).toBe(0)
      // Track 0 unchanged
      expect(result.engine.tracks[0].gate.currentStep).toBe(5)
    })

    it('hold subtrack + RESET resets only that subtrack', () => {
      const ui = holdUI({ kind: 'subtrack', subtrack: 'pitch' })
      let eng = makeState()
      eng = {
        ...eng,
        tracks: eng.tracks.map(t => ({
          ...t,
          gate: { ...t.gate, currentStep: 5 },
          pitch: { ...t.pitch, currentStep: 3 },
        })),
      }
      const result = dispatch(ui, eng, { type: 'reset' })
      // Pitch reset on selected track (0)
      expect(result.engine.tracks[0].pitch.currentStep).toBe(0)
      // Gate unchanged on selected track
      expect(result.engine.tracks[0].gate.currentStep).toBe(5)
    })
  })

  describe('hold + RAND (targeted randomization)', () => {
    it('hold track + RAND randomizes all subtracks', () => {
      const ui = holdUI({ kind: 'track', track: 0 })
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'feature-press', feature: 'rand' })
      // Gate steps should have changed (all false by default, randomizer adds some trues)
      expect(result.engine.tracks[0].gate.steps).not.toEqual(eng.tracks[0].gate.steps)
      expect(result.ui.holdEncoderUsed).toBe(true)
    })

    it('hold gate subtrack + RAND randomizes only gates', () => {
      const ui = holdUI({ kind: 'subtrack', subtrack: 'gate' })
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'feature-press', feature: 'rand' })
      expect(result.engine.tracks[0].gate.steps).not.toEqual(eng.tracks[0].gate.steps)
      // Pitch unchanged
      expect(result.engine.tracks[0].pitch.steps).toEqual(eng.tracks[0].pitch.steps)
    })

    it('hold pitch subtrack + RAND randomizes only pitch', () => {
      const ui = holdUI({ kind: 'subtrack', subtrack: 'pitch' })
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'feature-press', feature: 'rand' })
      expect(result.engine.tracks[0].pitch.steps).not.toEqual(eng.tracks[0].pitch.steps)
      expect(result.engine.tracks[0].gate.steps).toEqual(eng.tracks[0].gate.steps)
    })

    it('RAND without hold enters rand screen normally', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'feature-press', feature: 'rand' })
      expect(result.ui.mode).toBe('rand')
    })
  })

  describe('hold velocity subtrack + RAND randomizes only velocity', () => {
    it('randomizes velocity only', () => {
      const ui = holdUI({ kind: 'subtrack', subtrack: 'velocity' })
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'feature-press', feature: 'rand' })
      expect(result.engine.tracks[0].velocity.steps).not.toEqual(eng.tracks[0].velocity.steps)
      expect(result.engine.tracks[0].gate.steps).toEqual(eng.tracks[0].gate.steps)
    })
  })

  describe('encoder events route normally when no hold', () => {
    it('encoder-a-turn in home without hold selects track', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -1 })
      expect(result.ui.selectedTrack).toBe(1) // normal home behavior
    })
  })
})

describe('rand screen dispatch', () => {
  // Helper: find the visible row index for a paramId in the current state
  function findRowIdx(paramId: string, eng: SequencerState, ui: UIState): number {

    const rows = getVisibleRows(eng, ui)
    const idx = rows.findIndex((r: { paramId: string }) => r.paramId === paramId)
    if (idx === -1) throw new Error(`paramId '${paramId}' not visible`)
    return idx
  }

  function randUI(paramId: string, eng: SequencerState, presetIdx = 0) {
    const base = { ...createInitialUIState(), mode: 'rand' as const, randPresetIndex: presetIdx }
    const idx = findRowIdx(paramId, eng, base)
    return { ...base, randParam: idx }
  }

  function randUIRaw(param = 0, presetIdx = 0) {
    return { ...createInitialUIState(), mode: 'rand' as const, randParam: param, randPresetIndex: presetIdx }
  }

  describe('navigation', () => {
    it('enc A scrolls param list down', () => {
      const ui = randUIRaw(0)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 1 })
      expect(result.ui.randParam).toBe(1)
    })

    it('enc A scrolls param list up', () => {
      const ui = randUIRaw(3)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -1 })
      expect(result.ui.randParam).toBe(2)
    })

    it('enc A clamps at top', () => {
      const ui = randUIRaw(0)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -1 })
      expect(result.ui.randParam).toBe(0)
    })

    it('enc A clamps at bottom', () => {
      const eng = makeState()
      const ui = randUIRaw(0)

      const maxIdx = getVisibleRows(eng, ui).length - 1
      const bottomUI = randUIRaw(maxIdx)
      const result = dispatch(bottomUI, eng, { type: 'encoder-a-turn', delta: 1 })
      expect(result.ui.randParam).toBe(maxIdx)
    })

    it('back returns to home', () => {
      const ui = randUIRaw(5)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'back' })
      expect(result.ui.mode).toBe('home')
    })

    it('encoder-b-push is no-op', () => {
      const ui = randUIRaw(5)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-push' })
      expect(result.ui.mode).toBe('rand')
    })

    it('track buttons cross-modal', () => {
      const ui = randUIRaw(3)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'track-select', track: 2 })
      expect(result.ui.selectedTrack).toBe(2)
      expect(result.ui.mode).toBe('rand')
    })
  })

  describe('preset row', () => {
    it('enc B cycles preset index forward', () => {
      const eng = makeState()
      const ui = randUI('preset', eng, 0)
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.ui.randPresetIndex).toBe(1)
    })

    it('enc B cycles preset index backward', () => {
      const eng = makeState()
      const ui = randUI('preset', eng, 2)
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -1 })
      expect(result.ui.randPresetIndex).toBe(1)
    })

    it('enc B clamps preset index at bounds', () => {
      const eng = makeState()
      const ui = randUI('preset', eng, 0)
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -1 })
      expect(result.ui.randPresetIndex).toBe(0)
    })

    it('enc A push applies preset to track randomConfig', () => {
      const eng = makeState()
      const ui = randUI('preset', eng, 0) // Bassline preset
      const result = dispatch(ui, eng, { type: 'encoder-a-push' })
      // Bassline: pitch low=36, high=48
      expect(result.engine.randomConfigs[0].pitch.low).toBe(36)
      expect(result.engine.randomConfigs[0].pitch.high).toBe(48)
      // Other tracks unchanged
      expect(result.engine.randomConfigs[1]).toEqual(eng.randomConfigs[1])
    })
  })

  describe('scale row', () => {
    it('enc B cycles scale forward', () => {
      const eng = makeState()
      const ui = randUI('pitch.scale', eng)
      const initialScale = eng.randomConfigs[0].pitch.scale.name
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.randomConfigs[0].pitch.scale.name).not.toBe(initialScale)
    })
  })

  describe('root row', () => {
    it('enc B adjusts root note', () => {
      const eng = makeState()
      const ui = randUI('pitch.root', eng)
      const before = eng.randomConfigs[0].pitch.root
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.randomConfigs[0].pitch.root).toBe(before + 1)
    })

    it('root clamps to 0-127', () => {
      let eng = makeState()
      eng = {
        ...eng,
        randomConfigs: eng.randomConfigs.map((c, i) =>
          i === 0 ? { ...c, pitch: { ...c.pitch, root: 127 } } : c
        ),
      }
      const ui = randUI('pitch.root', eng)
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.randomConfigs[0].pitch.root).toBe(127)
    })
  })

  describe('pitch low row', () => {
    it('enc B adjusts pitch low', () => {
      const eng = makeState()
      const ui = randUI('pitch.low', eng)
      const before = eng.randomConfigs[0].pitch.low
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.randomConfigs[0].pitch.low).toBe(before + 1)
    })
  })

  describe('pitch high row', () => {
    it('enc B adjusts pitch high', () => {
      const eng = makeState()
      const ui = randUI('pitch.high', eng)
      const before = eng.randomConfigs[0].pitch.high
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -1 })
      expect(result.engine.randomConfigs[0].pitch.high).toBe(before - 1)
    })
  })

  describe('max notes row', () => {
    it('enc B adjusts max notes', () => {
      const eng = makeState()
      const ui = randUI('pitch.maxNotes', eng)
      const before = eng.randomConfigs[0].pitch.maxNotes
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.randomConfigs[0].pitch.maxNotes).toBe(before + 1)
    })

    it('max notes clamps to 0-12', () => {
      let eng = makeState()
      eng = {
        ...eng,
        randomConfigs: eng.randomConfigs.map((c, i) =>
          i === 0 ? { ...c, pitch: { ...c.pitch, maxNotes: 0 } } : c
        ),
      }
      const ui = randUI('pitch.maxNotes', eng)
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -1 })
      expect(result.engine.randomConfigs[0].pitch.maxNotes).toBe(0)
    })
  })

  describe('fill min row', () => {
    it('enc B adjusts fill min by 0.05', () => {
      const eng = makeState()
      const ui = randUI('gate.fillMin', eng)
      const before = eng.randomConfigs[0].gate.fillMin
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.randomConfigs[0].gate.fillMin).toBeCloseTo(before + 0.05)
    })

    it('fill min clamps to 0-1', () => {
      let eng = makeState()
      eng = {
        ...eng,
        randomConfigs: eng.randomConfigs.map((c, i) =>
          i === 0 ? { ...c, gate: { ...c.gate, fillMin: 0 } } : c
        ),
      }
      const ui = randUI('gate.fillMin', eng)
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -1 })
      expect(result.engine.randomConfigs[0].gate.fillMin).toBe(0)
    })
  })

  describe('fill max row', () => {
    it('enc B adjusts fill max by 0.05', () => {
      const eng = makeState()
      const ui = randUI('gate.fillMax', eng)
      const before = eng.randomConfigs[0].gate.fillMax
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.randomConfigs[0].gate.fillMax).toBeCloseTo(before + 0.05)
    })
  })

  describe('gate mode row', () => {
    it('enc B toggles gate mode', () => {
      const eng = makeState()
      const ui = randUI('gate.mode', eng)
      const before = eng.randomConfigs[0].gate.mode
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.randomConfigs[0].gate.mode).toBe(before === 'random' ? 'euclidean' : 'random')
    })
  })

  describe('offset row', () => {
    it('enc B toggles random offset', () => {
      const eng = makeState()
      const ui = randUI('gate.randomOffset', eng)
      const before = eng.randomConfigs[0].gate.randomOffset
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.randomConfigs[0].gate.randomOffset).toBe(!before)
    })
  })

  describe('vel low row', () => {
    it('enc B adjusts vel low', () => {
      const eng = makeState()
      const ui = randUI('velocity.low', eng)
      const before = eng.randomConfigs[0].velocity.low
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 5 })
      expect(result.engine.randomConfigs[0].velocity.low).toBe(before + 5)
    })
  })

  describe('vel high row', () => {
    it('enc B adjusts vel high', () => {
      const eng = makeState()
      const ui = randUI('velocity.high', eng)
      const before = eng.randomConfigs[0].velocity.high
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -3 })
      expect(result.engine.randomConfigs[0].velocity.high).toBe(before - 3)
    })
  })

  describe('track isolation', () => {
    it('adjustments only affect selected track config', () => {
      const eng = makeState()
      const base = { ...createInitialUIState(), mode: 'rand' as const, selectedTrack: 1, randPresetIndex: 0 }
      const idx = findRowIdx('pitch.low', eng, base)
      const ui = { ...base, randParam: idx }
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 5 })
      // Track 1 changed
      expect(result.engine.randomConfigs[1].pitch.low).toBe(eng.randomConfigs[1].pitch.low + 5)
      // Track 0 unchanged
      expect(result.engine.randomConfigs[0]).toEqual(eng.randomConfigs[0])
    })
  })

  describe('save row', () => {
    it('enc A push on save row enters name-entry mode', () => {
      const eng = makeState()
      const ui = randUI('save', eng)
      const result = dispatch(ui, eng, { type: 'encoder-a-push' })
      expect(result.ui.mode).toBe('name-entry')
      expect(result.ui.nameChars).toHaveLength(12)
      expect(result.ui.nameCursor).toBe(0)
    })
  })

  describe('conditional visibility', () => {
    it('ARP sub-params hidden when ARP is off', () => {
      const eng = makeState()
      const ui = randUIRaw(0)

      const rows = getVisibleRows(eng, ui)
      const paramIds = rows.map((r: { paramId: string }) => r.paramId)
      expect(paramIds).toContain('arp.enabled')
      expect(paramIds).not.toContain('arp.direction')
      expect(paramIds).not.toContain('arp.octaveRange')
    })

    it('ARP sub-params shown when ARP is on', () => {
      let eng = makeState()
      eng = { ...eng, arpConfigs: eng.arpConfigs.map((c, i) => i === 0 ? { ...c, enabled: true } : c) }
      const ui = randUIRaw(0)

      const rows = getVisibleRows(eng, ui)
      const paramIds = rows.map((r: { paramId: string }) => r.paramId)
      expect(paramIds).toContain('arp.direction')
      expect(paramIds).toContain('arp.octaveRange')
    })

    it('OFFSET hidden when gate mode is random', () => {
      let eng = makeState()
      eng = {
        ...eng,
        randomConfigs: eng.randomConfigs.map((c, i) =>
          i === 0 ? { ...c, gate: { ...c.gate, mode: 'random' as const } } : c
        ),
      }
      const ui = randUIRaw(0)

      const rows = getVisibleRows(eng, ui)
      const paramIds = rows.map((r: { paramId: string }) => r.paramId)
      expect(paramIds).not.toContain('gate.randomOffset')
    })

    it('LFO sub-params hidden when LFO is off', () => {
      const eng = makeState()
      const ui = randUIRaw(0)

      const rows = getVisibleRows(eng, ui)
      const paramIds = rows.map((r: { paramId: string }) => r.paramId)
      expect(paramIds).toContain('lfo.enabled')
      expect(paramIds).not.toContain('lfo.waveform')
      expect(paramIds).not.toContain('lfo.rate')
      expect(paramIds).not.toContain('lfo.depth')
    })

    it('LFO sub-params shown when LFO is on', () => {
      let eng = makeState()
      eng = { ...eng, lfoConfigs: eng.lfoConfigs.map((c, i) => i === 0 ? { ...c, enabled: true } : c) }
      const ui = randUIRaw(0)

      const rows = getVisibleRows(eng, ui)
      const paramIds = rows.map((r: { paramId: string }) => r.paramId)
      expect(paramIds).toContain('lfo.waveform')
      expect(paramIds).toContain('lfo.rate')
      expect(paramIds).toContain('lfo.depth')
    })
  })

  describe('section headers', () => {
    it('visible rows include section headers', () => {
      const eng = makeState()
      const ui = randUIRaw(0)

      const rows = getVisibleRows(eng, ui)
      const headers = rows.filter((r: { type: string }) => r.type === 'header')
      const headerIds = headers.map((r: { paramId: string }) => r.paramId)
      expect(headerIds).toContain('section.pitch')
      expect(headerIds).toContain('section.arp')
      expect(headerIds).toContain('section.gate')
      expect(headerIds).toContain('section.vel')
      expect(headerIds).toContain('section.mod')
      expect(headerIds).toContain('section.lfo')
    })
  })

  describe('preset browser includes user presets', () => {
    it('enc B cycles through factory + user presets', () => {
      let eng = makeState()
      const ui = randUI('preset', eng, 0)
      // Add a user preset
      eng = { ...eng, userPresets: [{ name: 'MY BASS', config: eng.randomConfigs[0] }] }
      // Scroll past all factory presets (6) to hit the user preset
      let result: { ui: UIState; engine: SequencerState } = { ui, engine: eng }
      for (let i = 0; i < 6; i++) {
        result = dispatch(result.ui, result.engine, { type: 'encoder-b-turn', delta: 1 })
      }
      expect(result.ui.randPresetIndex).toBe(6) // first user preset
    })
  })
})

describe('name-entry dispatch', () => {
  function nameUI(chars?: number[], cursor = 0) {
    return {
      ...createInitialUIState(),
      mode: 'name-entry' as const,
      nameChars: chars ?? Array(12).fill(0),
      nameCursor: cursor,
    }
  }

  it('enc A cycles character at cursor position', () => {
    const ui = nameUI()
    const eng = makeState()
    const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 1 })
    expect(result.ui.nameChars[0]).toBe(1) // B
  })

  it('enc A wraps characters', () => {
    const ui = nameUI([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0)
    const eng = makeState()
    // Wrap backward from A (index 0) should go to end of charset
    const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -1 })
    expect(result.ui.nameChars[0]).toBeGreaterThan(0) // wrapped to last char
  })

  it('enc B moves cursor right', () => {
    const ui = nameUI(undefined, 0)
    const eng = makeState()
    const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
    expect(result.ui.nameCursor).toBe(1)
  })

  it('enc B moves cursor left', () => {
    const ui = nameUI(undefined, 5)
    const eng = makeState()
    const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -1 })
    expect(result.ui.nameCursor).toBe(4)
  })

  it('enc B clamps cursor at bounds', () => {
    const ui = nameUI(undefined, 0)
    const eng = makeState()
    const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -1 })
    expect(result.ui.nameCursor).toBe(0)
  })

  it('enc B clamps cursor at max', () => {
    const ui = nameUI(undefined, 11)
    const eng = makeState()
    const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
    expect(result.ui.nameCursor).toBe(11)
  })

  it('enc A push saves preset and returns to rand', () => {
    // Spell "AB" then blanks
    const chars = [0, 1, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26] // A, B, spaces...
    const ui = nameUI(chars)
    const eng = makeState()
    const result = dispatch(ui, eng, { type: 'encoder-a-push' })
    expect(result.ui.mode).toBe('rand')
    expect(result.engine.userPresets).toHaveLength(1)
    expect(result.engine.userPresets[0].name).toBe('AB')
  })

  it('back cancels and returns to rand', () => {
    const ui = nameUI()
    const eng = makeState()
    const result = dispatch(ui, eng, { type: 'back' })
    expect(result.ui.mode).toBe('rand')
    expect(result.engine.userPresets).toHaveLength(0) // nothing saved
  })

  it('encoder-b-push is no-op in name-entry', () => {
    const ui = nameUI()
    const eng = makeState()
    const result = dispatch(ui, eng, { type: 'encoder-b-push' })
    expect(result.ui.mode).toBe('name-entry')
  })

  it('track buttons are ignored during name entry', () => {
    const ui = nameUI()
    const eng = makeState()
    const result = dispatch(ui, eng, { type: 'track-select', track: 2 })
    expect(result.ui.mode).toBe('name-entry') // stays in name-entry
    expect(result.ui.selectedTrack).toBe(0)   // doesn't change
  })
})

describe('route screen dispatch', () => {
  function routeUI(param = 0, track = 0) {
    return {
      ...createInitialUIState(),
      mode: 'route' as const,
      selectedTrack: track,
      routeParam: param,
    }
  }

  describe('navigation', () => {
    it('enc A scrolls param down', () => {
      const ui = routeUI(0)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 1 })
      expect(result.ui.routeParam).toBe(1)
    })

    it('enc A scrolls param up', () => {
      const ui = routeUI(1)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -1 })
      expect(result.ui.routeParam).toBe(0)
    })

    it('enc A clamps at top', () => {
      const ui = routeUI(0)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -1 })
      expect(result.ui.routeParam).toBe(0)
    })

    it('enc A clamps at bottom', () => {
      const ui = routeUI(3)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 1 })
      expect(result.ui.routeParam).toBe(3)
    })

    it('back returns to home', () => {
      const ui = routeUI(2)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'back' })
      expect(result.ui.mode).toBe('home')
    })

    it('encoder-b-push is no-op', () => {
      const ui = routeUI(2)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-push' })
      expect(result.ui.mode).toBe('route')
    })

    it('track buttons switch output (cross-modal)', () => {
      const ui = routeUI(1, 0)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'track-select', track: 2 })
      expect(result.ui.selectedTrack).toBe(2)
      expect(result.ui.mode).toBe('route')
    })
  })

  describe('source editing', () => {
    it('enc B cycles gate source forward', () => {
      const ui = routeUI(0, 0)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.routing[0].gate).toBe(1)
    })

    it('enc B cycles pitch source backward', () => {
      const ui = routeUI(1, 0)
      let eng = makeState()
      eng = { ...eng, routing: eng.routing.map((r, i) => i === 0 ? { ...r, pitch: 2 } : r) }
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -1 })
      expect(result.engine.routing[0].pitch).toBe(1)
    })

    it('enc B wraps source track forward', () => {
      const ui = routeUI(0, 0)
      let eng = makeState()
      eng = { ...eng, routing: eng.routing.map((r, i) => i === 0 ? { ...r, gate: 3 } : r) }
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.routing[0].gate).toBe(0)
    })

    it('enc B wraps source track backward', () => {
      const ui = routeUI(0, 0)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -1 })
      expect(result.engine.routing[0].gate).toBe(3)
    })

    it('enc B changes mod source', () => {
      const ui = routeUI(3, 1)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.routing[1].mod).toBe(2)
    })

    it('only changes selected output routing', () => {
      const ui = routeUI(0, 1)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.routing[0].gate).toBe(0)
      expect(result.engine.routing[1].gate).toBe(2)
    })
  })

  describe('MIDI page', () => {
    it('enc A push toggles to MIDI page', () => {
      const ui = routeUI(0)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-push' })
      expect(result.ui.routePage).toBe(1)
      expect(result.ui.routeParam).toBe(0)
    })

    it('enc A push on MIDI page returns to route page', () => {
      const ui = { ...routeUI(0), routePage: 1 }
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-push' })
      expect(result.ui.routePage).toBe(0)
    })

    it('enc B toggles MIDI enabled', () => {
      const ui = { ...routeUI(0), routePage: 1 }
      const eng = makeState()
      expect(eng.midiConfigs[0].enabled).toBe(false)
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.midiConfigs[0].enabled).toBe(true)
    })

    it('enc B adjusts MIDI channel on param 1', () => {
      const ui = { ...routeUI(1), routePage: 1 }
      const eng = makeState()
      expect(eng.midiConfigs[0].channel).toBe(1)
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 3 })
      expect(result.engine.midiConfigs[0].channel).toBe(4)
    })

    it('MIDI channel clamps at 1-16', () => {
      const ui = { ...routeUI(1), routePage: 1 }
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -5 })
      expect(result.engine.midiConfigs[0].channel).toBe(1)
    })

    it('back from MIDI page returns home and resets page', () => {
      const ui = { ...routeUI(0), routePage: 1 }
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'back' })
      expect(result.ui.mode).toBe('home')
      expect(result.ui.routePage).toBe(0)
    })

    it('encoder-b-push is no-op on MIDI page', () => {
      const ui = { ...routeUI(0), routePage: 1 }
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-push' })
      expect(result.ui.mode).toBe('route')
      expect(result.ui.routePage).toBe(1)
    })
  })
})
