import { describe, expect, it } from 'vitest'
import { createSequencer, randomizeTrackPattern, setGateOn } from '../../engine/sequencer'
import type { SequencerState } from '../../engine/types'
import type { UIState } from '../hw-types'
import { createInitialUIState, dispatch, getLEDState } from '../mode-machine'
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
        tracks: eng.tracks.map((t) => ({
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
      const steps = eng.tracks[0].gate.steps.map((s, i) => (i === 3 ? { ...s, on: false } : s))
      eng = {
        ...eng,
        tracks: eng.tracks.map((t, i) => (i === 0 ? { ...t, gate: { ...t.gate, steps } } : t)),
      }
      const result = dispatch(ui, eng, { type: 'step-press', step: 3 })
      expect(result.engine.tracks[0].gate.steps[3].on).toBe(true)
    })

    it('step-press on ON step toggles it off immediately', () => {
      const ui = gateUI()
      let eng = makeState()
      const steps = eng.tracks[0].gate.steps.map((s, i) => (i === 5 ? { ...s, on: true } : s))
      eng = {
        ...eng,
        tracks: eng.tracks.map((t, i) => (i === 0 ? { ...t, gate: { ...t.gate, steps } } : t)),
      }
      const result = dispatch(ui, eng, { type: 'step-press', step: 5 })
      expect(result.engine.tracks[0].gate.steps[5].on).toBe(false)
    })

    it('hold step selects it, encoder A adjusts gate length', () => {
      const ui = gateUI()
      let eng = makeState()
      const steps = eng.tracks[0].gate.steps.map((s, i) => (i === 3 ? { ...s, on: true } : s))
      eng = {
        ...eng,
        tracks: eng.tracks.map((t, i) => (i === 0 ? { ...t, gate: { ...t.gate, steps } } : t)),
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
      const steps = eng.tracks[0].gate.steps.map((s, i) => (i === 3 ? { ...s, on: true } : s))
      eng = {
        ...eng,
        tracks: eng.tracks.map((t, i) => (i === 0 ? { ...t, gate: { ...t.gate, steps } } : t)),
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
      const steps = Array.from({ length: 32 }, () => ({ on: false, tie: false, length: 0.5, ratchet: 1 }))
      eng = {
        ...eng,
        tracks: eng.tracks.map((t, i) => (i === 0 ? { ...t, gate: { ...t.gate, steps, length: 32 } } : t)),
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

    it('hold step A + press step B creates tie range', () => {
      // Hold step 2, press step 5 → steps 3, 4, 5 become ties
      let eng = makeState()
      // Ensure step 2 is gate on (trigger point)
      const steps = eng.tracks[0].gate.steps.map((s, i) => (i === 2 ? { ...s, on: true } : s))
      eng = {
        ...eng,
        tracks: eng.tracks.map((t, i) => (i === 0 ? { ...t, gate: { ...t.gate, steps } } : t)),
      }
      const ui: UIState = {
        ...gateUI(),
        heldButton: { kind: 'step', step: 2 },
        holdEncoderUsed: false,
      }
      const result = dispatch(ui, eng, { type: 'step-press', step: 5 })
      // Steps 3, 4, 5 should be tied
      expect(result.engine.tracks[0].gate.steps[3].tie).toBe(true)
      expect(result.engine.tracks[0].gate.steps[4].tie).toBe(true)
      expect(result.engine.tracks[0].gate.steps[5].tie).toBe(true)
      // Step 2 should be on (trigger)
      expect(result.engine.tracks[0].gate.steps[2].on).toBe(true)
      // holdEncoderUsed should be true to prevent gate toggle on hold-end
      expect(result.ui.holdEncoderUsed).toBe(true)
    })

    it('hold step + press same step does not create tie', () => {
      const eng = makeState()
      const ui: UIState = {
        ...gateUI(),
        heldButton: { kind: 'step', step: 3 },
        holdEncoderUsed: false,
      }
      const result = dispatch(ui, eng, { type: 'step-press', step: 3 })
      // No ties should be created
      for (const step of result.engine.tracks[0].gate.steps) {
        expect(step.tie).toBe(false)
      }
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
      const steps = eng.tracks[0].pitch.steps.map((s, i) => (i === 0 ? { ...s, note: 127 } : s))
      eng = {
        ...eng,
        tracks: eng.tracks.map((t, i) => (i === 0 ? { ...t, pitch: { ...t.pitch, steps } } : t)),
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
      expect((e as any).tracks[0].pitch.steps[0].slide).toBeLessThanOrEqual(0.5)
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
      tie: false,
      length: 0.5,
      ratchet: 1,
    }))
    eng = {
      ...eng,
      tracks: eng.tracks.map((t, i) =>
        i === 0 ? { ...t, gate: { ...t.gate, steps, length: 16, currentStep: 3 } } : t,
      ),
    }
    const leds = getLEDState(ui, eng)
    expect(leds.steps[0]).toBe('on') // gate on
    expect(leds.steps[5]).toBe('on') // gate on
    expect(leds.steps[1]).toBe('dim') // gate off
    expect(leds.steps[3]).toBe('flash') // playhead
  })

  it('pitch-edit highlights selected step', () => {
    const ui = { ...createInitialUIState(), mode: 'pitch-edit' as const, selectedStep: 4 }
    const eng = makeState()
    const leds = getLEDState(ui, eng)
    expect(leds.steps[4]).toBe('on')
    expect(leds.steps[1]).toBe('dim')
  })

  it('pitch-edit shows playback position as flash', () => {
    const ui = { ...createInitialUIState(), mode: 'pitch-edit' as const, selectedStep: 4 }
    const eng = makeState()
    eng.tracks[0].pitch.currentStep = 7
    const leds = getLEDState(ui, eng)
    expect(leds.steps[7]).toBe('flash') // playback position
    expect(leds.steps[4]).toBe('on') // cursor (not flash)
    expect(leds.steps[0]).toBe('dim') // other step
  })

  it('pitch-edit playback flash wins when cursor and playhead overlap', () => {
    const ui = { ...createInitialUIState(), mode: 'pitch-edit' as const, selectedStep: 3 }
    const eng = makeState()
    eng.tracks[0].pitch.currentStep = 3
    const leds = getLEDState(ui, eng)
    expect(leds.steps[3]).toBe('flash') // playback wins over cursor
  })

  it('vel-edit shows playback position as flash', () => {
    const ui = { ...createInitialUIState(), mode: 'vel-edit' as const, selectedStep: 2 }
    const eng = makeState()
    eng.tracks[0].velocity.currentStep = 10
    const leds = getLEDState(ui, eng)
    expect(leds.steps[10]).toBe('flash') // playback position
    expect(leds.steps[2]).toBe('on') // cursor
    expect(leds.steps[1]).toBe('dim') // other step (not 0, since currentStep defaults to 0)
  })

  it('vel-edit playback flash wins when cursor and playhead overlap', () => {
    const ui = { ...createInitialUIState(), mode: 'vel-edit' as const, selectedStep: 5 }
    const eng = makeState()
    eng.tracks[0].velocity.currentStep = 5
    const leds = getLEDState(ui, eng)
    expect(leds.steps[5]).toBe('flash')
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
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -2 })
      expect(result.engine.tracks[0].gate.length).toBe(14) // 16 - 2
      expect(result.engine.tracks[0].pitch.length).toBe(14)
      expect(result.engine.tracks[0].velocity.length).toBe(14)
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
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -2 })
      expect(result.engine.tracks[3].gate.length).toBe(14) // held track changed
      expect(result.engine.tracks[0].gate.length).toBe(16) // selected track unchanged
    })
  })

  describe('hold subtrack + encoder', () => {
    it('hold gate + enc A changes gate length only', () => {
      const ui = holdUI({ kind: 'subtrack', subtrack: 'gate' })
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -4 })
      expect(result.engine.tracks[0].gate.length).toBe(12) // 16 - 4
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
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -8 })
      expect(result.engine.mutePatterns[0].length).toBe(8) // 16 - 8
    })

    it('hold mute + enc B changes mute clock divider', () => {
      const ui = holdUI({ kind: 'feature', feature: 'mute' })
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 2 })
      expect(result.engine.mutePatterns[0].clockDivider).toBe(6) // 4 + 2
    })
  })

  describe('hold + RESET (targeted playhead reset)', () => {
    it('hold track + RESET resets that track playheads', () => {
      const ui = holdUI({ kind: 'track', track: 1 })
      let eng = makeState()
      eng = {
        ...eng,
        tracks: eng.tracks.map((t, _i) => ({
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
        tracks: eng.tracks.map((t) => ({
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
      // Bassline: pitch low=24, high=36
      expect(result.engine.randomConfigs[0].pitch.low).toBe(24)
      expect(result.engine.randomConfigs[0].pitch.high).toBe(36)
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
        randomConfigs: eng.randomConfigs.map((c, i) => (i === 0 ? { ...c, pitch: { ...c.pitch, root: 127 } } : c)),
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
        randomConfigs: eng.randomConfigs.map((c, i) => (i === 0 ? { ...c, pitch: { ...c.pitch, maxNotes: 0 } } : c)),
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
        randomConfigs: eng.randomConfigs.map((c, i) => (i === 0 ? { ...c, gate: { ...c.gate, fillMin: 0 } } : c)),
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
    it('enc B cycles through 4 gate modes', () => {
      const eng = makeState()
      const ui = randUI('gate.mode', eng)
      // Default is euclidean, cycling forward: euclidean → sync → cluster → random → euclidean
      const r1 = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(r1.engine.randomConfigs[0].gate.mode).toBe('sync')
      const r2 = dispatch(ui, r1.engine, { type: 'encoder-b-turn', delta: 1 })
      expect(r2.engine.randomConfigs[0].gate.mode).toBe('cluster')
      const r3 = dispatch(ui, r2.engine, { type: 'encoder-b-turn', delta: 1 })
      expect(r3.engine.randomConfigs[0].gate.mode).toBe('random')
      const r4 = dispatch(ui, r3.engine, { type: 'encoder-b-turn', delta: 1 })
      expect(r4.engine.randomConfigs[0].gate.mode).toBe('euclidean')
    })

    it('enc B cycles backwards', () => {
      const eng = makeState()
      const ui = randUI('gate.mode', eng)
      const r1 = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -1 })
      expect(r1.engine.randomConfigs[0].gate.mode).toBe('random')
    })
  })

  describe('cluster continuation row', () => {
    it('enc B adjusts cluster continuation by 0.05', () => {
      let eng = makeState()
      eng = {
        ...eng,
        randomConfigs: eng.randomConfigs.map((c) => ({ ...c, gate: { ...c.gate, mode: 'cluster' as const } })),
      }
      const ui = randUI('gate.clusterContinuation', eng)
      const before = eng.randomConfigs[0].gate.clusterContinuation
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.randomConfigs[0].gate.clusterContinuation).toBeCloseTo(before + 0.05)
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
      eng = { ...eng, arpConfigs: eng.arpConfigs.map((c, i) => (i === 0 ? { ...c, enabled: true } : c)) }
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
          i === 0 ? { ...c, gate: { ...c.gate, mode: 'random' as const } } : c,
        ),
      }
      const ui = randUIRaw(0)

      const rows = getVisibleRows(eng, ui)
      const paramIds = rows.map((r: { paramId: string }) => r.paramId)
      expect(paramIds).not.toContain('gate.randomOffset')
    })

    it('MOD sub-params hidden when mod.mode is not walk or sync', () => {
      let eng = makeState()
      // Force mod.mode to 'random' to test visibility
      eng = {
        ...eng,
        randomConfigs: eng.randomConfigs.map((c, i) =>
          i === 0 ? { ...c, mod: { ...c.mod, mode: 'random' as const } } : c,
        ),
      }
      const ui = randUIRaw(0)

      const rows = getVisibleRows(eng, ui)
      const paramIds = rows.map((r: { paramId: string }) => r.paramId)
      expect(paramIds).not.toContain('mod.walkStepSize')
      expect(paramIds).not.toContain('mod.syncBias')
    })

    it('MOD sub-params shown when mod.mode is walk or sync', () => {
      let eng = makeState()
      // Set track 0 mod.mode to 'walk'
      eng = {
        ...eng,
        randomConfigs: eng.randomConfigs.map((c, i) =>
          i === 0 ? { ...c, mod: { ...c.mod, mode: 'walk' as const } } : c,
        ),
      }
      const ui = randUIRaw(0)

      let rows = getVisibleRows(eng, ui)
      let paramIds = rows.map((r: { paramId: string }) => r.paramId)
      expect(paramIds).toContain('mod.walkStepSize')
      expect(paramIds).not.toContain('mod.syncBias')

      // Now set track 0 mod.mode to 'sync'
      eng = {
        ...eng,
        randomConfigs: eng.randomConfigs.map((c, i) =>
          i === 0 ? { ...c, mod: { ...c.mod, mode: 'sync' as const } } : c,
        ),
      }

      rows = getVisibleRows(eng, ui)
      paramIds = rows.map((r: { paramId: string }) => r.paramId)
      expect(paramIds).toContain('mod.syncBias')
      expect(paramIds).not.toContain('mod.walkStepSize')
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
    expect(result.ui.selectedTrack).toBe(0) // doesn't change
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
      eng = { ...eng, routing: eng.routing.map((r, i) => (i === 0 ? { ...r, pitch: 2 } : r)) }
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -1 })
      expect(result.engine.routing[0].pitch).toBe(1)
    })

    it('enc B wraps source track forward', () => {
      const ui = routeUI(0, 0)
      let eng = makeState()
      eng = { ...eng, routing: eng.routing.map((r, i) => (i === 0 ? { ...r, gate: 3 } : r)) }
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

  describe('settings-press', () => {
    it('enters settings mode', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'settings-press' })
      expect(result.ui.mode).toBe('settings')
      expect(result.ui.settingsParam).toBe(0)
    })
  })

  describe('settings mode', () => {
    function settingsUI(param = 0) {
      return { ...createInitialUIState(), mode: 'settings' as const, settingsParam: param }
    }

    it('enc A scrolls settingsParam', () => {
      const ui = settingsUI(0)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 1 })
      expect(result.ui.settingsParam).toBe(1)
    })

    it('enc A clamps to 0', () => {
      const ui = settingsUI(0)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: -1 })
      expect(result.ui.settingsParam).toBe(0)
    })

    it('enc B adjusts BPM on clock.bpm row', () => {
      // Row 1 is clock.bpm (row 0 is CLOCK header)
      const ui = settingsUI(1)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 5 })
      expect(result.engine.transport.bpm).toBe(eng.transport.bpm + 5)
    })

    it('BPM clamps 20-300', () => {
      const ui = settingsUI(1)
      const eng = makeState()
      const up = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 999 })
      expect(up.engine.transport.bpm).toBe(300)
      const down = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -999 })
      expect(down.engine.transport.bpm).toBe(20)
    })

    it('enc B cycles clock source', () => {
      // Row 2 is clock.source
      const ui = settingsUI(2)
      const eng = makeState()
      expect(eng.transport.clockSource).toBe('internal')
      const r1 = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(r1.engine.transport.clockSource).toBe('midi')
      const r2 = dispatch(ui, r1.engine, { type: 'encoder-b-turn', delta: 1 })
      expect(r2.engine.transport.clockSource).toBe('external')
      const r3 = dispatch(ui, r2.engine, { type: 'encoder-b-turn', delta: 1 })
      expect(r3.engine.transport.clockSource).toBe('internal')
    })

    it('enc B toggles MIDI enabled directionally', () => {
      // Row 4 is midi.enabled (row 3 is MIDI header)
      const ui = settingsUI(4)
      const eng = makeState()
      expect(eng.midiEnabled).toBe(false)
      // Turn right → ON
      const r1 = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(r1.engine.midiEnabled).toBe(true)
      // Turn right again → stays ON
      const r2 = dispatch(ui, r1.engine, { type: 'encoder-b-turn', delta: 1 })
      expect(r2.engine.midiEnabled).toBe(true)
      // Turn left → OFF
      const r3 = dispatch(ui, r1.engine, { type: 'encoder-b-turn', delta: -1 })
      expect(r3.engine.midiEnabled).toBe(false)
    })

    it('enc B adjusts MIDI channel', () => {
      // Row 6 is midi.ch.0
      const ui = settingsUI(6)
      const eng = makeState()
      expect(eng.midiConfigs[0].channel).toBe(1)
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 3 })
      expect(result.engine.midiConfigs[0].channel).toBe(4)
    })

    it('MIDI channel clamps 1-16', () => {
      const ui = settingsUI(6)
      const eng = makeState()
      const down = dispatch(ui, eng, { type: 'encoder-b-turn', delta: -5 })
      expect(down.engine.midiConfigs[0].channel).toBe(1)
      const up = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 50 })
      expect(up.engine.midiConfigs[0].channel).toBe(16)
    })

    it('enc B is no-op on header rows', () => {
      // Row 0 is CLOCK header
      const ui = settingsUI(0)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine).toBe(eng)
    })

    it('back returns to home', () => {
      const ui = settingsUI(3)
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'back' })
      expect(result.ui.mode).toBe('home')
    })
  })

  describe('transpose-edit (XPOSE)', () => {
    it('encoder A scrolls xposeParam', () => {
      const ui = { ...createInitialUIState(), mode: 'transpose-edit' as const, xposeParam: 0 }
      const engine = createSequencer()
      const result = dispatch(ui, engine, { type: 'encoder-a-turn', delta: 1 })
      expect(result.ui.xposeParam).toBe(1)
    })

    it('encoder A clamps to max row', () => {
      const ui = { ...createInitialUIState(), mode: 'transpose-edit' as const, xposeParam: 6 }
      const engine = createSequencer()
      const result = dispatch(ui, engine, { type: 'encoder-a-turn', delta: 1 })
      expect(result.ui.xposeParam).toBe(6) // 7 rows, max index = 6
    })

    it('encoder B adjusts semitones on SEMI param', () => {
      const ui = { ...createInitialUIState(), mode: 'transpose-edit' as const, xposeParam: 1 }
      const engine = createSequencer()
      const result = dispatch(ui, engine, { type: 'encoder-b-turn', delta: 3 })
      expect(result.engine.transposeConfigs[0].semitones).toBe(3)
    })

    it('encoder B adjusts noteLow on NOTE LO param', () => {
      const ui = { ...createInitialUIState(), mode: 'transpose-edit' as const, xposeParam: 2 }
      const engine = createSequencer()
      const result = dispatch(ui, engine, { type: 'encoder-b-turn', delta: 5 })
      expect(result.engine.transposeConfigs[0].noteLow).toBe(5)
    })

    it('encoder B adjusts noteHigh on NOTE HI param', () => {
      const ui = { ...createInitialUIState(), mode: 'transpose-edit' as const, xposeParam: 3 }
      const engine = createSequencer()
      const result = dispatch(ui, engine, { type: 'encoder-b-turn', delta: -10 })
      expect(result.engine.transposeConfigs[0].noteHigh).toBe(117) // 127 - 10
    })

    it('encoder B adjusts glScale in 5% steps', () => {
      const ui = { ...createInitialUIState(), mode: 'transpose-edit' as const, xposeParam: 5 }
      const engine = createSequencer()
      const result = dispatch(ui, engine, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.transposeConfigs[0].glScale).toBe(1.05)
    })

    it('encoder B adjusts velScale in 5% steps', () => {
      const ui = { ...createInitialUIState(), mode: 'transpose-edit' as const, xposeParam: 6 }
      const engine = createSequencer()
      const result = dispatch(ui, engine, { type: 'encoder-b-turn', delta: -2 })
      expect(result.engine.transposeConfigs[0].velScale).toBe(0.9) // 1.0 - 0.10
    })

    it('CLR resets single param on transpose screen', () => {
      const ui: UIState = {
        ...createInitialUIState(),
        mode: 'transpose-edit' as const,
        xposeParam: 1,
        clrPending: true,
        clrPendingAt: Date.now(),
      }
      const engine = createSequencer()
      engine.transposeConfigs[0] = { semitones: 7, noteLow: 48, noteHigh: 72, glScale: 2.0, velScale: 0.5 }
      const result = dispatch(ui, engine, { type: 'clr-press' })
      expect(result.engine.transposeConfigs[0].semitones).toBe(0)
      expect(result.engine.transposeConfigs[0].noteLow).toBe(48) // unchanged
    })

    it('CLR on section header resets entire section', () => {
      const ui: UIState = {
        ...createInitialUIState(),
        mode: 'transpose-edit' as const,
        xposeParam: 4,
        clrPending: true,
        clrPendingAt: Date.now(),
      } // DYNAMICS header
      const engine = createSequencer()
      engine.transposeConfigs[0] = { semitones: 7, noteLow: 48, noteHigh: 72, glScale: 2.0, velScale: 0.5 }
      const result = dispatch(ui, engine, { type: 'clr-press' })
      expect(result.engine.transposeConfigs[0].glScale).toBe(1.0)
      expect(result.engine.transposeConfigs[0].velScale).toBe(1.0)
      expect(result.engine.transposeConfigs[0].semitones).toBe(7) // pitch section unchanged
    })
  })

  // === Variation Edit ===

  describe('variation-edit', () => {
    function varUI(overrides: Partial<UIState> = {}): UIState {
      return {
        ...createInitialUIState(),
        mode: 'variation-edit' as const,
        varSelectedBar: -1,
        varParam: 0,
        varCursor: 0,
        ...overrides,
      }
    }

    it('feature-press variation enters variation-edit mode', () => {
      const ui = createInitialUIState()
      const result = dispatch(ui, makeState(), { type: 'feature-press', feature: 'variation' })
      expect(result.ui.mode).toBe('variation-edit')
      expect(result.ui.varSelectedBar).toBe(-1)
    })

    it('step-press selects bar within phrase length', () => {
      const ui = varUI()
      const result = dispatch(ui, makeState(), { type: 'step-press', step: 2 })
      expect(result.ui.varSelectedBar).toBe(2)
      expect(result.ui.varCursor).toBe(0)
    })

    it('step-press on already selected bar deselects it', () => {
      const ui = varUI({ varSelectedBar: 2 })
      const result = dispatch(ui, makeState(), { type: 'step-press', step: 2 })
      expect(result.ui.varSelectedBar).toBe(-1)
    })

    it('step-press beyond phrase length is no-op', () => {
      const ui = varUI()
      const engine = makeState()
      const result = dispatch(ui, engine, { type: 'step-press', step: 5 })
      expect(result.ui.varSelectedBar).toBe(-1)
    })

    describe('overview (no bar selected)', () => {
      it('encoder A turn is no-op in overview (phrase length via hold combo)', () => {
        const ui = varUI()
        const engine = makeState()
        const result = dispatch(ui, engine, { type: 'encoder-a-turn', delta: 1 })
        // Phrase length unchanged — length is now changed via hold VAR + enc A
        expect(result.engine.variationPatterns[0].length).toBe(4)
        expect(result.engine).toBe(engine)
      })

      it('encoder A push toggles enabled', () => {
        const ui = varUI()
        const engine = makeState()
        expect(engine.variationPatterns[0].enabled).toBe(false)
        const result = dispatch(ui, engine, { type: 'encoder-a-push' })
        expect(result.engine.variationPatterns[0].enabled).toBe(true)
      })
    })

    describe('bar detail (bar selected)', () => {
      it('encoder A turn moves cursor through transform stack', () => {
        const ui = varUI({ varSelectedBar: 0, varCursor: 0 })
        const engine = makeState()
        engine.variationPatterns[0].slots[0] = {
          transforms: [
            { type: 'reverse', param: 0 },
            { type: 'transpose', param: 7 },
          ],
        }
        // Move cursor from 0 to 1
        const r1 = dispatch(ui, engine, { type: 'encoder-a-turn', delta: 1 })
        expect(r1.ui.varCursor).toBe(1)
        // Move cursor to 2 (the "add" slot)
        const r2 = dispatch(r1.ui, engine, { type: 'encoder-a-turn', delta: 1 })
        expect(r2.ui.varCursor).toBe(2)
        // Clamp at max
        const r3 = dispatch(r2.ui, engine, { type: 'encoder-a-turn', delta: 1 })
        expect(r3.ui.varCursor).toBe(2)
      })

      it('encoder A turn clamps cursor at 0', () => {
        const ui = varUI({ varSelectedBar: 0, varCursor: 0 })
        const result = dispatch(ui, makeState(), { type: 'encoder-a-turn', delta: -1 })
        expect(result.ui.varCursor).toBe(0)
      })

      it('encoder B turn on existing transform adjusts param', () => {
        const ui = varUI({ varSelectedBar: 0, varCursor: 0 })
        const engine = makeState()
        engine.variationPatterns[0].slots[0] = {
          transforms: [{ type: 'transpose', param: 7 }],
        }
        const result = dispatch(ui, engine, { type: 'encoder-b-turn', delta: 1 })
        expect(result.engine.variationPatterns[0].slots[0].transforms[0].param).toBe(8)
      })

      it('encoder B turn on "add" slot browses catalog', () => {
        const ui = varUI({ varSelectedBar: 0, varCursor: 0, varParam: 0 }) // cursor on "add" (empty bar)
        const engine = makeState()
        const result = dispatch(ui, engine, { type: 'encoder-b-turn', delta: 1 })
        expect(result.ui.varParam).toBe(1)
      })

      it('encoder B push on "add" slot adds transform', () => {
        const ui = varUI({ varSelectedBar: 1, varCursor: 0, varParam: 0 }) // REVERSE
        const engine = makeState()
        const result = dispatch(ui, engine, { type: 'encoder-b-push' })
        const slot = result.engine.variationPatterns[0].slots[1]
        expect(slot.transforms.length).toBe(1)
        expect(slot.transforms[0].type).toBe('reverse')
        // Cursor moves to the newly added transform
        expect(result.ui.varCursor).toBe(0)
      })

      it('encoder B push on existing transform is no-op', () => {
        const ui = varUI({ varSelectedBar: 0, varCursor: 0 })
        const engine = makeState()
        engine.variationPatterns[0].slots[0] = {
          transforms: [{ type: 'reverse', param: 0 }],
        }
        const result = dispatch(ui, engine, { type: 'encoder-b-push' })
        expect(result.engine).toBe(engine) // unchanged
      })

      it('CLR single-press deletes transform at cursor', () => {
        const ui = varUI({ varSelectedBar: 0, varCursor: 0 })
        const engine = makeState()
        engine.variationPatterns[0].slots[0] = {
          transforms: [
            { type: 'reverse', param: 0 },
            { type: 'transpose', param: 7 },
          ],
        }
        const result = dispatch(ui, engine, { type: 'clr-press' })
        const slot = result.engine.variationPatterns[0].slots[0]
        expect(slot.transforms.length).toBe(1)
        expect(slot.transforms[0].type).toBe('transpose') // first was deleted, second remains
      })

      it('CLR on "add" slot enters pending (no transform to delete)', () => {
        const ui = varUI({ varSelectedBar: 0, varCursor: 0 }) // cursor 0 on empty bar = "add" slot
        const engine = makeState()
        const result = dispatch(ui, engine, { type: 'clr-press' })
        expect(result.ui.clrPending).toBe(true) // enters pending, not single-press
      })

      it('CLR single-press adjusts cursor when deleting last item', () => {
        const ui = varUI({ varSelectedBar: 0, varCursor: 1 })
        const engine = makeState()
        engine.variationPatterns[0].slots[0] = {
          transforms: [
            { type: 'reverse', param: 0 },
            { type: 'transpose', param: 7 },
          ],
        }
        const result = dispatch(ui, engine, { type: 'clr-press' })
        expect(result.ui.varCursor).toBe(1) // now points to "add" slot
        expect(result.engine.variationPatterns[0].slots[0].transforms.length).toBe(1)
      })
    })

    it('encoder B turn with no bar selected is no-op', () => {
      const ui = varUI()
      const engine = makeState()
      const result = dispatch(ui, engine, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine).toBe(engine)
    })

    it('hold VAR + encoder A changes phrase length linearly (1-16)', () => {
      const ui = {
        ...varUI({ varSelectedBar: 0 }),
        heldButton: { kind: 'feature' as const, feature: 'variation' as const },
      }
      const engine = makeState()
      // Default length is 4, delta +1 → 5
      const result = dispatch(ui, engine, { type: 'encoder-a-turn', delta: 1 })
      expect(result.engine.variationPatterns[0].length).toBe(5)
      expect(result.engine.variationPatterns[0].slots.length).toBe(5)
    })

    it('hold VAR + encoder A clamps at 1 and 16', () => {
      const ui = {
        ...varUI(),
        heldButton: { kind: 'feature' as const, feature: 'variation' as const },
      }
      const engine = makeState()
      // Delta -10 → clamp at 1
      const r1 = dispatch(ui, engine, { type: 'encoder-a-turn', delta: -10 })
      expect(r1.engine.variationPatterns[0].length).toBe(1)
      // Delta +20 → clamp at 16
      const r2 = dispatch(ui, engine, { type: 'encoder-a-turn', delta: 20 })
      expect(r2.engine.variationPatterns[0].length).toBe(16)
    })

    it('hold VAR + encoder A disables loop mode', () => {
      const ui = {
        ...varUI(),
        heldButton: { kind: 'feature' as const, feature: 'variation' as const },
      }
      const engine = makeState()
      engine.variationPatterns[0].loopMode = true
      const result = dispatch(ui, engine, { type: 'encoder-a-turn', delta: 1 })
      expect(result.engine.variationPatterns[0].loopMode).toBe(false)
    })

    it('hold VAR + encoder B right enables loop mode', () => {
      const ui = {
        ...varUI(),
        heldButton: { kind: 'feature' as const, feature: 'variation' as const },
      }
      const engine = makeState()
      const result = dispatch(ui, engine, { type: 'encoder-b-turn', delta: 1 })
      expect(result.engine.variationPatterns[0].loopMode).toBe(true)
      // Length should match gate subtrack length (default 16)
      expect(result.engine.variationPatterns[0].length).toBe(engine.tracks[0].gate.length)
      expect(result.engine.variationPatterns[0].slots.length).toBe(engine.tracks[0].gate.length)
    })

    it('hold VAR + encoder B left disables loop mode', () => {
      const ui = {
        ...varUI(),
        heldButton: { kind: 'feature' as const, feature: 'variation' as const },
      }
      const engine = makeState()
      engine.variationPatterns[0].loopMode = true
      const result = dispatch(ui, engine, { type: 'encoder-b-turn', delta: -1 })
      expect(result.engine.variationPatterns[0].loopMode).toBe(false)
    })

    it('hold VAR + encoder A clamps varSelectedBar when shrinking', () => {
      const ui = {
        ...varUI({ varSelectedBar: 3 }),
        heldButton: { kind: 'feature' as const, feature: 'variation' as const },
      }
      const engine = makeState()
      // Shrink from 4 to 2 → bar 3 is out of range
      const result = dispatch(ui, engine, { type: 'encoder-a-turn', delta: -2 })
      expect(result.engine.variationPatterns[0].length).toBe(2)
      expect(result.ui.varSelectedBar).toBe(-1) // deselected
    })

    it('LEDs show bar state in variation-edit', () => {
      const ui = varUI({ varSelectedBar: 1 })
      const engine = makeState()
      engine.variationPatterns[0].slots[2] = { transforms: [{ type: 'reverse', param: 0 }] }
      const leds = getLEDState(ui, engine)
      expect(leds.steps[0]).toBe('dim') // empty bar
      expect(leds.steps[1]).toBe('flash') // selected bar
      expect(leds.steps[2]).toBe('on') // bar with transforms
      expect(leds.steps[3]).toBe('dim') // empty bar
      expect(leds.steps[4]).toBe('off') // beyond phrase length
    })

    it('back returns to home', () => {
      const ui = varUI()
      const result = dispatch(ui, makeState(), { type: 'back' })
      expect(result.ui.mode).toBe('home')
    })

    it('track select works cross-modally', () => {
      const ui = varUI()
      const result = dispatch(ui, makeState(), { type: 'track-select', track: 2 })
      expect(result.ui.selectedTrack).toBe(2)
      expect(result.ui.mode).toBe('variation-edit')
    })

    describe('per-subtrack overrides', () => {
      it('subtrack-select always enters sub-screen (even when inherit)', () => {
        const ui = varUI()
        const engine = makeState()
        const result = dispatch(ui, engine, { type: 'subtrack-select', subtrack: 'gate' })
        expect(result.ui.varEditSubtrack).toBe('gate')
        expect(result.ui.mode).toBe('variation-edit')
      })

      it('subtrack-select enters sub-screen when bypass', () => {
        const ui = varUI()
        const engine = makeState()
        engine.variationPatterns[0].subtrackOverrides.gate = 'bypass'
        const result = dispatch(ui, engine, { type: 'subtrack-select', subtrack: 'gate' })
        expect(result.ui.varEditSubtrack).toBe('gate')
      })

      it('subtrack-select enters sub-screen when override pattern exists', () => {
        const engine = makeState()
        engine.variationPatterns[0].subtrackOverrides.pitch = {
          enabled: false,
          length: 4,
          loopMode: false,
          currentBar: 0,
          slots: Array.from({ length: 4 }, () => ({ transforms: [] })),
          subtrackOverrides: { gate: null, pitch: null, velocity: null, mod: null },
        }
        const ui = varUI()
        const result = dispatch(ui, engine, { type: 'subtrack-select', subtrack: 'pitch' })
        expect(result.ui.varEditSubtrack).toBe('pitch')
      })

      it('subtrack-select toggles off when already editing that subtrack', () => {
        const ui = varUI({ varEditSubtrack: 'pitch' })
        const result = dispatch(ui, makeState(), { type: 'subtrack-select', subtrack: 'pitch' })
        expect(result.ui.varEditSubtrack).toBe(null)
      })

      it('enc A push cycles override: null → bypass (in sub-screen)', () => {
        const ui = varUI({ varEditSubtrack: 'gate' })
        const engine = makeState()
        expect(engine.variationPatterns[0].subtrackOverrides.gate).toBe(null)
        const result = dispatch(ui, engine, { type: 'encoder-a-push' })
        expect(result.engine.variationPatterns[0].subtrackOverrides.gate).toBe('bypass')
      })

      it('enc A push cycles override: bypass → override pattern (in sub-screen)', () => {
        const ui = varUI({ varEditSubtrack: 'gate' })
        const engine = makeState()
        engine.variationPatterns[0].subtrackOverrides.gate = 'bypass'
        const result = dispatch(ui, engine, { type: 'encoder-a-push' })
        const override = result.engine.variationPatterns[0].subtrackOverrides.gate
        expect(override).not.toBe(null)
        expect(override).not.toBe('bypass')
        expect((override as any).enabled).toBe(false)
        expect((override as any).length).toBe(4)
        expect((override as any).slots).toHaveLength(4)
      })

      it('enc A push cycles override: override pattern → null (in sub-screen with no bar)', () => {
        const engine = makeState()
        engine.variationPatterns[0].subtrackOverrides.pitch = {
          enabled: true,
          length: 4,
          loopMode: false,
          currentBar: 0,
          slots: [{ transforms: [] }, { transforms: [] }, { transforms: [] }, { transforms: [] }],
          subtrackOverrides: { gate: null, pitch: null, velocity: null, mod: null },
        }
        // varSelectedBar: -1 → enc A push cycles override state
        const ui = varUI({ varEditSubtrack: 'pitch', varSelectedBar: -1 })
        const result = dispatch(ui, engine, { type: 'encoder-a-push' })
        expect(result.engine.variationPatterns[0].subtrackOverrides.pitch).toBe(null)
      })

      it('non-override sub-screen: only enc A push works (other events are no-op)', () => {
        const ui = varUI({ varEditSubtrack: 'gate' }) // gate is INHERIT
        const engine = makeState()
        // encoder-a-turn should be no-op
        const r1 = dispatch(ui, engine, { type: 'encoder-a-turn', delta: 1 })
        expect(r1.engine).toBe(engine)
        // encoder-b-turn should be no-op
        const r2 = dispatch(ui, engine, { type: 'encoder-b-turn', delta: 1 })
        expect(r2.engine).toBe(engine)
        // step-press should be no-op
        const r3 = dispatch(ui, engine, { type: 'step-press', step: 0 })
        expect(r3.ui.varSelectedBar).toBe(-1)
      })

      it('back exits subtrack editing before exiting variation-edit', () => {
        const ui = varUI({ varEditSubtrack: 'gate' })
        const engine = makeState()
        const result = dispatch(ui, engine, { type: 'back' })
        expect(result.ui.varEditSubtrack).toBe(null)
        expect(result.ui.mode).toBe('variation-edit')
      })

      it('back from track-level editing exits to home', () => {
        const ui = varUI()
        const engine = makeState()
        const result = dispatch(ui, engine, { type: 'back' })
        expect(result.ui.mode).toBe('home')
      })

      it('editing (enc B push) applies to subtrack override pattern', () => {
        const engine = makeState()
        engine.variationPatterns[0].subtrackOverrides.gate = {
          enabled: false,
          length: 4,
          loopMode: false,
          currentBar: 0,
          slots: Array.from({ length: 4 }, () => ({ transforms: [] })),
          subtrackOverrides: { gate: null, pitch: null, velocity: null, mod: null },
        }
        // Select bar 1, cursor on "add" slot, add REVERSE
        const ui = varUI({ varEditSubtrack: 'gate', varSelectedBar: 1, varCursor: 0, varParam: 0 })
        const result = dispatch(ui, engine, { type: 'encoder-b-push' })
        const override = result.engine.variationPatterns[0].subtrackOverrides.gate as any
        expect(override.slots[1].transforms.length).toBe(1)
        expect(override.slots[1].transforms[0].type).toBe('reverse')
        // Track-level should be unchanged
        expect(result.engine.variationPatterns[0].slots[1].transforms.length).toBe(0)
      })

      it('enc A push in override sub-screen with no bar cycles state (not toggle enabled)', () => {
        const engine = makeState()
        engine.variationPatterns[0].subtrackOverrides.gate = {
          enabled: false,
          length: 4,
          loopMode: false,
          currentBar: 0,
          slots: Array.from({ length: 4 }, () => ({ transforms: [] })),
          subtrackOverrides: { gate: null, pitch: null, velocity: null, mod: null },
        }
        // No bar selected + override pattern → enc A push cycles override to null
        const ui = varUI({ varEditSubtrack: 'gate', varSelectedBar: -1 })
        const result = dispatch(ui, engine, { type: 'encoder-a-push' })
        expect(result.engine.variationPatterns[0].subtrackOverrides.gate).toBe(null)
      })

      it('hold VAR + enc A changes phrase length for subtrack override (linear)', () => {
        const engine = makeState()
        engine.variationPatterns[0].subtrackOverrides.gate = {
          enabled: true,
          length: 4,
          loopMode: false,
          currentBar: 0,
          slots: Array.from({ length: 4 }, () => ({ transforms: [] })),
          subtrackOverrides: { gate: null, pitch: null, velocity: null, mod: null },
        }
        const ui = varUI({
          varEditSubtrack: 'gate',
          heldButton: { kind: 'feature' as const, feature: 'variation' as const },
        })
        const result = dispatch(ui, engine, { type: 'encoder-a-turn', delta: 1 })
        const override = result.engine.variationPatterns[0].subtrackOverrides.gate as any
        expect(override.length).toBe(5)
        expect(override.slots.length).toBe(5)
        expect(result.engine.variationPatterns[0].length).toBe(4)
      })

      it('LEDs show subtrack override bars when editing subtrack', () => {
        const engine = makeState()
        engine.variationPatterns[0].subtrackOverrides.pitch = {
          enabled: true,
          length: 2,
          loopMode: false,
          currentBar: 0,
          slots: [{ transforms: [{ type: 'reverse', param: 0 }] }, { transforms: [] }],
          subtrackOverrides: { gate: null, pitch: null, velocity: null, mod: null },
        }
        const ui = varUI({ varEditSubtrack: 'pitch' })
        const leds = getLEDState(ui, engine)
        expect(leds.steps[0]).toBe('on') // bar with transforms
        expect(leds.steps[1]).toBe('dim') // empty bar
        expect(leds.steps[2]).toBe('off') // beyond override phrase length (2 bars)
      })

      it('encoder B hold deletes transform from subtrack override bar', () => {
        const engine = makeState()
        engine.variationPatterns[0].subtrackOverrides.gate = {
          enabled: true,
          length: 4,
          loopMode: false,
          currentBar: 0,
          slots: [
            {
              transforms: [
                { type: 'reverse', param: 0 },
                { type: 'transpose', param: 7 },
              ],
            },
            { transforms: [] },
            { transforms: [] },
            { transforms: [] },
          ],
          subtrackOverrides: { gate: null, pitch: null, velocity: null, mod: null },
        }
        const ui = varUI({ varEditSubtrack: 'gate', varSelectedBar: 0, varCursor: 0 })
        const result = dispatch(ui, engine, { type: 'clr-press' })
        const override = result.engine.variationPatterns[0].subtrackOverrides.gate as any
        expect(override.slots[0].transforms.length).toBe(1)
        expect(override.slots[0].transforms[0].type).toBe('transpose') // first deleted
      })

      it('encoder B turn adjusts param in subtrack override bar', () => {
        const engine = makeState()
        engine.variationPatterns[0].subtrackOverrides.gate = {
          enabled: true,
          length: 4,
          loopMode: false,
          currentBar: 0,
          slots: [
            { transforms: [{ type: 'transpose', param: 7 }] },
            { transforms: [] },
            { transforms: [] },
            { transforms: [] },
          ],
          subtrackOverrides: { gate: null, pitch: null, velocity: null, mod: null },
        }
        const ui = varUI({ varEditSubtrack: 'gate', varSelectedBar: 0, varCursor: 0 })
        const result = dispatch(ui, engine, { type: 'encoder-b-turn', delta: 1 })
        const override = result.engine.variationPatterns[0].subtrackOverrides.gate as any
        expect(override.slots[0].transforms[0].param).toBe(8)
      })
    })
  })
})

describe('CLR dispatch', () => {
  it('first CLR press sets clrPending true', () => {
    const ui = createInitialUIState()
    const eng = makeState()
    const result = dispatch(ui, eng, { type: 'clr-press' })
    expect(result.ui.clrPending).toBe(true)
    expect(result.ui.clrPendingAt).toBeGreaterThan(0)
  })

  it('second CLR press within 2s executes clear and resets pending', () => {
    const ui: UIState = { ...createInitialUIState(), mode: 'gate-edit', clrPending: true, clrPendingAt: Date.now() }
    let eng = makeState()
    eng = setGateOn(eng, 0, 0, true)
    const result = dispatch(ui, eng, { type: 'clr-press' })
    expect(result.ui.clrPending).toBe(false)
    // Gate step 0 should be reset to default
    expect(result.engine.tracks[0].gate.steps[0].on).toBe(false)
  })

  it('non-CLR event cancels pending state', () => {
    const ui: UIState = { ...createInitialUIState(), clrPending: true, clrPendingAt: Date.now() }
    const eng = makeState()
    const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 1 })
    expect(result.ui.clrPending).toBe(false)
  })

  it('gate-edit: clears current page gates to defaults', () => {
    const ui: UIState = { ...createInitialUIState(), mode: 'gate-edit', clrPending: true, clrPendingAt: Date.now() }
    let eng = makeState()
    eng = setGateOn(eng, 0, 0, true)
    eng = setGateOn(eng, 0, 5, true)
    const result = dispatch(ui, eng, { type: 'clr-press' })
    for (let i = 0; i < 16; i++) {
      expect(result.engine.tracks[0].gate.steps[i]).toEqual({ on: false, tie: false, length: 0.5, ratchet: 1 })
    }
  })

  it('pitch-edit: clears current page pitches to defaults', () => {
    const ui: UIState = {
      ...createInitialUIState(),
      mode: 'pitch-edit',
      clrPending: true,
      clrPendingAt: Date.now(),
    }
    let eng = makeState()
    // Randomize so pitches differ from default
    eng = randomizeTrackPattern(eng, 0, 42)
    const result = dispatch(ui, eng, { type: 'clr-press' })
    for (let i = 0; i < 16; i++) {
      expect(result.engine.tracks[0].pitch.steps[i]).toEqual({ note: 60, slide: 0 })
    }
  })

  it('home: resets selected track to defaults', () => {
    const ui: UIState = { ...createInitialUIState(), mode: 'home', clrPending: true, clrPendingAt: Date.now() }
    let eng = makeState()
    eng = randomizeTrackPattern(eng, 0, 42)
    const result = dispatch(ui, eng, { type: 'clr-press' })
    // All gates should be default
    for (const step of result.engine.tracks[0].gate.steps) {
      expect(step).toEqual({ on: false, tie: false, length: 0.5, ratchet: 1 })
    }
    // Track 1 should be untouched
    expect(result.engine.tracks[1]).toBe(eng.tracks[1])
  })

  it('variation-edit with transform selected: single press deletes transform', () => {
    let eng = makeState()
    // Add a transform to bar 0
    eng = {
      ...eng,
      variationPatterns: eng.variationPatterns.map((vp, i) =>
        i === 0
          ? { ...vp, slots: vp.slots.map((s, j) => (j === 0 ? { transforms: [{ type: 'rotate' as const, param: 4 }] } : s)) }
          : vp,
      ),
    }
    // Cursor on the transform (cursor 0), bar 0 selected
    const ui: UIState = {
      ...createInitialUIState(),
      mode: 'variation-edit',
      varSelectedBar: 0,
      varCursor: 0,
    }
    // Single press should delete without double-press
    const result = dispatch(ui, eng, { type: 'clr-press' })
    expect(result.engine.variationPatterns[0].slots[0].transforms).toHaveLength(0)
    expect(result.ui.clrPending).toBe(false) // no pending state for single-press
  })

  it('settings: resets settings to defaults', () => {
    const ui: UIState = {
      ...createInitialUIState(),
      mode: 'settings',
      settingsParam: 0,
      clrPending: true,
      clrPendingAt: Date.now(),
    }
    let eng = makeState()
    eng = { ...eng, transport: { ...eng.transport, bpm: 200 } }
    const result = dispatch(ui, eng, { type: 'clr-press' })
    expect(result.ui.clrPending).toBe(false)
  })

  it('name-entry: no-op', () => {
    const ui: UIState = { ...createInitialUIState(), mode: 'name-entry' }
    const eng = makeState()
    const result = dispatch(ui, eng, { type: 'clr-press' })
    // name-entry dispatch isolates all input, CLR should not crash
    expect(result.ui.mode).toBe('name-entry')
  })
})
