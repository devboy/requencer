/**
 * Mode state machine — pure function mapping (UIState, EngineState, ControlEvent) → new states.
 *
 * Modes: home, gate-edit, pitch-edit, vel-edit, mute-edit, route, rand
 *
 * Cross-modal behaviors:
 *   - Track select (T1-T4) works in ANY mode — switches displayed track
 *   - Subtrack buttons always enter/switch to their edit screen
 *   - Feature buttons always enter/switch to their screen
 *   - BACK returns to home from any mode (name-entry → rand)
 *   - RESET resets all playheads globally
 *
 * No DOM, no canvas, no side effects.
 */

import type { SequencerState, RandomConfig, ArpDirection, ClockSource, TransformType, Transform, VariationPattern } from '../engine/types'
import { randomizeTrackPattern, randomizeGatePattern, randomizePitchPattern, randomizeVelocityPattern, randomizeModPattern, regenerateLFO, setSubtrackLength, setSubtrackClockDivider, setTrackClockDivider, setMuteLength, setMuteClockDivider, resetTrackPlayheads, resetSubtrackPlayhead, saveUserPreset, setOutputSource, setStep, setGateOn, setGateLength, setGateRatchet, setPitchNote, setSlide, setTieRange, setGateTie } from '../engine/sequencer'
import type { ScreenMode, ControlEvent, UIState, LEDState, HeldButtonTarget, SubtrackId } from './hw-types'
import { createDefaultVariationPattern } from '../engine/variation'
import { PRESETS } from '../engine/presets'
import { SCALES } from '../engine/scales'
import { getVisibleRows, getAllPresets, SECTION_PARAMS } from './rand-rows'
import { getXposeVisibleRows } from './xpose-rows'
import { getSettingsRows, SETTINGS_SECTION_PARAMS } from './settings-rows'

export interface DispatchResult {
  ui: UIState
  engine: SequencerState
}

export function createInitialUIState(): UIState {
  return {
    mode: 'home',
    selectedTrack: 0,
    selectedStep: 0,
    currentPage: 0,
    heldButton: null,
    holdEncoderUsed: false,
    randParam: 0,
    xposeParam: 0,
    randPresetIndex: 0,
    nameChars: [],
    nameCursor: 0,
    mutateParam: 0,
    routeParam: 0,
    settingsParam: 0,
    varParam: 0,
    varSelectedBar: -1,
    varEditSubtrack: null,
    midiDevices: [],
    midiDeviceIndex: 0,
  }
}

export function dispatch(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  // --- Hold events ---

  if (event.type === 'hold-start') {
    // Step hold in gate-edit: select step for GL/ratchet editing
    if (event.button.kind === 'step' && ui.mode === 'gate-edit') {
      return { ui: { ...ui, heldButton: event.button, holdEncoderUsed: false, selectedStep: event.button.step }, engine }
    }
    // Only feature buttons with hold combos (mute, variation) get hold state
    if (event.button.kind === 'feature' && event.button.feature !== 'mute' && event.button.feature !== 'variation') {
      return { ui, engine }
    }
    return { ui: { ...ui, heldButton: event.button, holdEncoderUsed: false }, engine }
  }

  if (event.type === 'hold-end') {
    // Clear step selection when hold ends
    const clearStep = ui.heldButton?.kind === 'step'
    // In variation-edit: releasing subtrack hold enters subtrack override editing if set to OVERRIDE
    if (ui.mode === 'variation-edit' && ui.heldButton?.kind === 'subtrack') {
      const sub = ui.heldButton.subtrack
      const vp = engine.variationPatterns[ui.selectedTrack]
      const override = vp.subtrackOverrides[sub]
      if (override !== null && override !== 'bypass') {
        // Override is a VariationPattern — enter subtrack editing
        return { ui: { ...ui, heldButton: null, holdEncoderUsed: false, varEditSubtrack: sub, varSelectedBar: -1 }, engine }
      }
      return { ui: { ...ui, heldButton: null, holdEncoderUsed: false }, engine }
    }
    return { ui: { ...ui, heldButton: null, holdEncoderUsed: false, ...(clearStep ? { selectedStep: -1 } : {}) }, engine }
  }

  // --- Hold combo: step held in gate-edit + step press → tie range ---
  if (ui.heldButton?.kind === 'step' && ui.mode === 'gate-edit' && event.type === 'step-press') {
    return dispatchStepTie(ui, engine, event)
  }

  // --- Hold combo: step held in gate-edit → encoder A = gate length, encoder B = ratchet ---
  if (ui.heldButton?.kind === 'step' && ui.mode === 'gate-edit' && (event.type === 'encoder-a-turn' || event.type === 'encoder-b-turn')) {
    return dispatchStepHoldCombo(ui, engine, event)
  }

  // --- Hold combo: subtrack held in variation-edit + enc A push → cycle override state ---
  if (ui.heldButton?.kind === 'subtrack' && ui.mode === 'variation-edit' && event.type === 'encoder-a-push') {
    return dispatchVariationOverrideCycle(ui, engine)
  }

  // --- Hold combo: encoder turns while button held → length/division ---
  if (ui.heldButton && (event.type === 'encoder-a-turn' || event.type === 'encoder-b-turn')) {
    return dispatchHoldCombo(ui, engine, event)
  }

  // --- Hold combo: RESET while button held → targeted playhead reset ---
  if (ui.heldButton && event.type === 'reset') {
    return dispatchHoldReset(ui, engine)
  }

  // --- Hold combo: RAND while button held → targeted randomization ---
  if (ui.heldButton && event.type === 'feature-press' && event.feature === 'rand') {
    return dispatchHoldRand(ui, engine)
  }

  // --- Name entry mode: isolates all input ---
  if (ui.mode === 'name-entry') {
    return dispatchNameEntry(ui, engine, event)
  }

  // --- Global events (work in every mode) ---

  if (event.type === 'play-stop') {
    return {
      ui,
      engine: {
        ...engine,
        transport: { ...engine.transport, playing: !engine.transport.playing },
      },
    }
  }

  if (event.type === 'reset') {
    return { ui, engine: resetAllPlayheads(engine) }
  }

  // Track select — cross-modal
  if (event.type === 'track-select') {
    return { ui: { ...ui, selectedTrack: event.track, currentPage: 0, selectedStep: 0 }, engine }
  }

  // Subtrack buttons — in variation-edit: enter/exit subtrack override editing
  if (event.type === 'subtrack-select' && ui.mode === 'variation-edit') {
    if (ui.varEditSubtrack === event.subtrack) {
      // Already editing this subtrack → return to track-level
      return { ui: { ...ui, varEditSubtrack: null, varSelectedBar: -1 }, engine }
    }
    const trackVP = engine.variationPatterns[ui.selectedTrack]
    const override = trackVP.subtrackOverrides[event.subtrack]
    if (override !== null && override !== 'bypass') {
      // Override pattern exists → enter its editing
      return { ui: { ...ui, varEditSubtrack: event.subtrack, varSelectedBar: -1 }, engine }
    }
    // Not in override mode for this subtrack — no-op, stay in variation-edit
    return { ui, engine }
  }

  // Subtrack buttons — enter edit screen (or re-enter same screen to reset cursor)
  if (event.type === 'subtrack-select') {
    const modeMap: Record<string, ScreenMode> = {
      gate: 'gate-edit',
      pitch: 'pitch-edit',
      velocity: 'vel-edit',
      mod: 'mod-edit',
    }
    const newMode = modeMap[event.subtrack]
    if (newMode) {
      const step = newMode === 'gate-edit' ? -1 : 0
      return { ui: { ...ui, mode: newMode, selectedStep: step, currentPage: 0 }, engine }
    }
    return { ui, engine }
  }

  // Back — in variation-edit with subtrack editing: return to track-level first
  if (event.type === 'back' && ui.mode === 'variation-edit' && ui.varEditSubtrack) {
    return { ui: { ...ui, varEditSubtrack: null, varSelectedBar: -1 }, engine }
  }

  // Back — cross-modal navigation to home (name-entry handled above)
  if (event.type === 'back') {
    return { ui: { ...ui, mode: 'home', currentPage: 0 }, engine }
  }

  // Feature buttons — enter feature screen
  if (event.type === 'feature-press') {
    const modeMap: Record<string, ScreenMode> = {
      mute: 'mute-edit',
      route: 'route',
      rand: 'rand',
      mutate: 'mutate-edit',
      transpose: 'transpose-edit',
      variation: 'variation-edit',
    }
    return { ui: { ...ui, mode: modeMap[event.feature], selectedStep: 0, currentPage: 0, varSelectedBar: -1, varEditSubtrack: null }, engine }
  }

  if (event.type === 'settings-press') {
    return { ui: { ...ui, mode: 'settings', settingsParam: 0 }, engine }
  }

  // --- Mode-specific dispatch ---
  switch (ui.mode) {
    case 'home':
      return dispatchHome(ui, engine, event)
    case 'gate-edit':
      return dispatchGateEdit(ui, engine, event)
    case 'pitch-edit':
      return dispatchPitchEdit(ui, engine, event)
    case 'vel-edit':
      return dispatchVelEdit(ui, engine, event)
    case 'mute-edit':
      return dispatchMuteEdit(ui, engine, event)
    case 'rand':
      return dispatchRand(ui, engine, event)
    case 'route':
      return dispatchRoute(ui, engine, event)
    case 'mutate-edit':
      return dispatchMutateEdit(ui, engine, event)
    case 'mod-edit':
      return dispatchModEdit(ui, engine, event)
    case 'transpose-edit':
      return dispatchTransposeEdit(ui, engine, event)
    case 'variation-edit':
      return dispatchVariationEdit(ui, engine, event)
    case 'settings':
      return dispatchSettings(ui, engine, event)
  }
}

// --- Home Screen ---
// Encoder A turn: select track (0-3, wraps)
// Encoder A push: enter gate-edit for selected track (default deeper screen)

function dispatchHome(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  switch (event.type) {
    case 'encoder-a-turn': {
      const next = ((ui.selectedTrack - event.delta) % 4 + 4) % 4
      return { ui: { ...ui, selectedTrack: next }, engine }
    }
    case 'encoder-a-push': {
      return { ui: { ...ui, mode: 'gate-edit', selectedStep: 0, currentPage: 0 }, engine }
    }
    default:
      return { ui, engine }
  }
}

// --- Gate Edit ---
// Step buttons: toggle gate (if OFF) or select step (if ON, for gate length editing)
// Enc A: adjust gate length of selected step (0.05-1.0 in 0.05 increments)
// Enc B: page navigation

function dispatchGateEdit(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  const track = engine.tracks[ui.selectedTrack]
  const maxPage = Math.max(0, Math.ceil(track.gate.length / 16) - 1)

  switch (event.type) {
    case 'step-press': {
      // Always toggle gate on/off — hold step for GL/ratchet editing
      const stepIdx = ui.currentPage * 16 + event.step
      if (stepIdx >= track.gate.length) return { ui, engine }
      return {
        ui,
        engine: setGateOn(engine, ui.selectedTrack, stepIdx, !track.gate.steps[stepIdx].on),
      }
    }
    case 'encoder-b-turn': {
      // Page navigation
      const newPage = clamp(ui.currentPage + event.delta, 0, maxPage)
      return { ui: { ...ui, currentPage: newPage }, engine }
    }
    case 'encoder-b-push':
      return { ui, engine }  // no-op (context-sensitive TBD)
    default:
      return { ui, engine }
  }
}

// --- Pitch Edit ---
// Step buttons: select step (highlighted)
// Enc A: adjust selected step pitch
// Enc B: page navigation

function dispatchPitchEdit(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  const track = engine.tracks[ui.selectedTrack]
  const maxPage = Math.max(0, Math.ceil(track.pitch.length / 16) - 1)

  switch (event.type) {
    case 'step-press': {
      const stepIdx = ui.currentPage * 16 + event.step
      if (stepIdx >= track.pitch.length) return { ui, engine }
      return { ui: { ...ui, selectedStep: event.step }, engine }
    }
    case 'encoder-a-turn': {
      const stepIdx = ui.currentPage * 16 + ui.selectedStep
      if (stepIdx >= track.pitch.length) return { ui, engine }
      const curNote = track.pitch.steps[stepIdx].note
      return {
        ui,
        engine: setPitchNote(engine, ui.selectedTrack, stepIdx, clamp(curNote + event.delta, 0, 127)),
      }
    }
    case 'encoder-b-turn': {
      // Enc B = slide duration for selected step (0 = off, up to 0.50s)
      const stepIdx = ui.currentPage * 16 + ui.selectedStep
      if (stepIdx >= track.pitch.length) return { ui, engine }
      const cur = track.pitch.steps[stepIdx].slide
      const next = Math.round(clamp(cur + event.delta * 0.05, 0, 0.50) * 100) / 100
      return { ui, engine: setSlide(engine, ui.selectedTrack, stepIdx, next) }
    }
    case 'encoder-a-push': {
      // Page navigation (for multi-page pitch subtracks)
      const newPage = (ui.currentPage + 1) % (maxPage + 1)
      return { ui: { ...ui, currentPage: newPage }, engine }
    }
    case 'encoder-b-push':
      return { ui, engine }  // no-op (context-sensitive TBD)
    default:
      return { ui, engine }
  }
}

// --- Velocity Edit ---
// Step buttons: select step
// Enc A: adjust selected step velocity
// Enc B: page navigation

function dispatchVelEdit(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  const track = engine.tracks[ui.selectedTrack]
  const maxPage = Math.max(0, Math.ceil(track.velocity.length / 16) - 1)

  switch (event.type) {
    case 'step-press': {
      const stepIdx = ui.currentPage * 16 + event.step
      if (stepIdx >= track.velocity.length) return { ui, engine }
      return { ui: { ...ui, selectedStep: event.step }, engine }
    }
    case 'encoder-a-turn': {
      const stepIdx = ui.currentPage * 16 + ui.selectedStep
      if (stepIdx >= track.velocity.length) return { ui, engine }
      const newSteps = [...track.velocity.steps]
      newSteps[stepIdx] = clamp(newSteps[stepIdx] + event.delta, 0, 127)
      return {
        ui,
        engine: updateSubtrackSteps(engine, ui.selectedTrack, 'velocity', newSteps),
      }
    }
    case 'encoder-b-turn': {
      const newPage = clamp(ui.currentPage + event.delta, 0, maxPage)
      return { ui: { ...ui, currentPage: newPage }, engine }
    }
    case 'encoder-b-push':
      return { ui, engine }  // no-op (context-sensitive TBD)
    default:
      return { ui, engine }
  }
}

// --- Mute Edit ---
// Step buttons: toggle mute on/off
// Enc B: page navigation

function dispatchMuteEdit(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  const mute = engine.mutePatterns[ui.selectedTrack]
  const maxPage = Math.max(0, Math.ceil(mute.length / 16) - 1)

  switch (event.type) {
    case 'step-press': {
      const stepIdx = ui.currentPage * 16 + event.step
      if (stepIdx >= mute.length) return { ui, engine }
      const newSteps = [...mute.steps]
      newSteps[stepIdx] = !newSteps[stepIdx]
      return {
        ui,
        engine: {
          ...engine,
          mutePatterns: engine.mutePatterns.map((m, i) =>
            i === ui.selectedTrack ? { ...m, steps: newSteps } : m,
          ),
        },
      }
    }
    case 'encoder-b-turn': {
      const newPage = clamp(ui.currentPage + event.delta, 0, maxPage)
      return { ui: { ...ui, currentPage: newPage }, engine }
    }
    case 'encoder-b-push':
      return { ui, engine }  // no-op (context-sensitive TBD)
    default:
      return { ui, engine }
  }
}

// --- MOD Edit ---
// Step buttons: select step (step mode) or select waveform 1-4 (LFO mode)
// Enc A: adjust selected step mod value (step mode) or LFO rate (LFO mode)
// Enc A push: toggle LFO on/off (regenerates mod from LFO)
// Enc B: page navigation (step mode) or depth (LFO mode)
// Enc B push: return home

function dispatchModEdit(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  const track = engine.tracks[ui.selectedTrack]
  const lfoConfig = engine.lfoConfigs[ui.selectedTrack]
  const maxPage = Math.max(0, Math.ceil(track.mod.length / 16) - 1)

  if (lfoConfig.enabled) {
    // LFO mode
    switch (event.type) {
      case 'step-press': {
        // Steps 0-3 select waveform
        const waveforms: import('../engine/types').LFOWaveform[] = ['sine', 'triangle', 'saw', 'slew-random']
        if (event.step < 4) {
          const newConfig = { ...lfoConfig, waveform: waveforms[event.step] }
          let next = updateLFOConfig(engine, ui.selectedTrack, newConfig)
          next = regenerateLFO(next, ui.selectedTrack)
          return { ui, engine: next }
        }
        return { ui, engine }
      }
      case 'encoder-a-turn': {
        // Adjust LFO rate (1-64)
        const newRate = clamp(lfoConfig.rate + event.delta, 1, 64)
        let next = updateLFOConfig(engine, ui.selectedTrack, { ...lfoConfig, rate: newRate })
        next = regenerateLFO(next, ui.selectedTrack)
        return { ui, engine: next }
      }
      case 'encoder-a-push': {
        // Toggle LFO off → switch to step mode
        return { ui, engine: updateLFOConfig(engine, ui.selectedTrack, { ...lfoConfig, enabled: false }) }
      }
      case 'encoder-b-turn': {
        // Adjust depth (0.05 steps)
        const newDepth = Math.round(clamp(lfoConfig.depth + event.delta * 0.05, 0, 1) * 100) / 100
        let next = updateLFOConfig(engine, ui.selectedTrack, { ...lfoConfig, depth: newDepth })
        next = regenerateLFO(next, ui.selectedTrack)
        return { ui, engine: next }
      }
      case 'encoder-b-push':
        return { ui, engine }  // no-op (context-sensitive TBD)
      default:
        return { ui, engine }
    }
  }

  // Step edit mode
  switch (event.type) {
    case 'step-press': {
      const stepIdx = ui.currentPage * 16 + event.step
      if (stepIdx >= track.mod.length) return { ui, engine }
      return { ui: { ...ui, selectedStep: event.step }, engine }
    }
    case 'encoder-a-turn': {
      const stepIdx = ui.currentPage * 16 + ui.selectedStep
      if (stepIdx >= track.mod.length) return { ui, engine }
      const cur = track.mod.steps[stepIdx]
      const next = Math.round(clamp(cur + event.delta * 0.01, 0, 1) * 100) / 100
      return {
        ui,
        engine: setStep(engine, ui.selectedTrack, 'mod', stepIdx, next),
      }
    }
    case 'encoder-a-push': {
      // Toggle LFO on → switch to LFO mode, regenerate
      let next = updateLFOConfig(engine, ui.selectedTrack, { ...lfoConfig, enabled: true })
      next = regenerateLFO(next, ui.selectedTrack)
      return { ui, engine: next }
    }
    case 'encoder-b-turn': {
      const newPage = clamp(ui.currentPage + event.delta, 0, maxPage)
      return { ui: { ...ui, currentPage: newPage }, engine }
    }
    case 'encoder-b-push':
      return { ui, engine }  // no-op (context-sensitive TBD)
    default:
      return { ui, engine }
  }
}

function updateLFOConfig(engine: SequencerState, trackIdx: number, config: import('../engine/types').LFOConfig): SequencerState {
  return {
    ...engine,
    lfoConfigs: engine.lfoConfigs.map((c, i) => (i === trackIdx ? config : c)),
  }
}

// --- Mutate (DRIFT) Edit ---
// Scrollable single-track detail: 7 subtrack rows + trigger + bars = 9 params
// T1-T4 (step buttons 0-3): switch track
// Enc A turn: adjust rate for selected subtrack row / toggle trigger / adjust bars
// Enc A push: toggle selected subtrack on/off
// Enc B turn: scroll params
// Enc B push: return home

const MUTATE_SUBTRACKS = ['gate', 'pitch', 'velocity', 'mod'] as const
const MUTATE_PARAM_COUNT = 6 // 4 subtracks + trigger + bars

function dispatchMutateEdit(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  const trackIdx = ui.selectedTrack
  const mc = engine.mutateConfigs[trackIdx]

  switch (event.type) {
    case 'step-press': {
      if (event.step < 4) {
        return { ui: { ...ui, selectedTrack: event.step, mutateParam: 0 }, engine }
      }
      return { ui, engine }
    }
    case 'encoder-a-turn': {
      // Scroll param list
      const newParam = clamp(ui.mutateParam + event.delta, 0, MUTATE_PARAM_COUNT - 1)
      return { ui: { ...ui, mutateParam: newParam }, engine }
    }
    case 'encoder-b-turn': {
      const row = ui.mutateParam
      if (row < 4) {
        // Subtrack rate: 0 = OFF, then 1%-100% in 1% steps
        const key = MUTATE_SUBTRACKS[row]
        const newRate = Math.round(clamp(mc[key] + event.delta * 0.01, 0, 1) * 100) / 100
        return { ui, engine: updateMutateConfig(engine, trackIdx, { ...mc, [key]: newRate }) }
      }
      if (row === 4) {
        // Toggle trigger mode (loop ↔ bars)
        const newTrigger = mc.trigger === 'loop' ? 'bars' : 'loop'
        return { ui, engine: updateMutateConfig(engine, trackIdx, { ...mc, trigger: newTrigger }) }
      }
      // row 5: bars (cycle 1, 2, 4, 8, 16)
      const barOptions = [1, 2, 4, 8, 16]
      const curIdx = barOptions.indexOf(mc.bars)
      const newIdx = clamp((curIdx >= 0 ? curIdx : 0) + event.delta, 0, barOptions.length - 1)
      return { ui, engine: updateMutateConfig(engine, trackIdx, { ...mc, bars: barOptions[newIdx] }) }
    }
    case 'encoder-a-push': {
      // Quick all-off: zero all subtrack rates for this track
      return { ui, engine: updateMutateConfig(engine, trackIdx, { ...mc, gate: 0, pitch: 0, velocity: 0, mod: 0 }) }
    }
    case 'encoder-b-push':
      return { ui, engine }  // no-op (context-sensitive TBD)
    default:
      return { ui, engine }
  }
}

function updateMutateConfig(engine: SequencerState, trackIdx: number, config: import('../engine/types').MutateConfig): SequencerState {
  return {
    ...engine,
    mutateConfigs: engine.mutateConfigs.map((c, i) => (i === trackIdx ? config : c)),
  }
}

// --- Variation Edit ---
// Step buttons: select bar (0 to phrase length - 1), deselect if already selected
// Enc A turn: browse transform catalog (when bar selected)
// Enc A push: toggle enabled (no bar selected), add transform (bar selected)
// Enc A hold: remove last transform from selected bar
// Enc B turn: adjust param of last transform in selected bar
// Hold VAR + Enc A: set phrase length (handled in dispatchHoldCombo)

/** Transform catalog — browse order matching the design doc */
export const TRANSFORM_CATALOG: Array<{ type: TransformType; label: string; defaultParam: number }> = [
  { type: 'reverse',      label: 'REVERSE',      defaultParam: 0 },
  { type: 'ping-pong',    label: 'PING-PONG',    defaultParam: 0 },
  { type: 'rotate',       label: 'ROTATE',       defaultParam: 1 },
  { type: 'thin',         label: 'THIN',          defaultParam: 0.5 },
  { type: 'fill',         label: 'FILL',          defaultParam: 0 },
  { type: 'skip-even',    label: 'SKIP-EVEN',     defaultParam: 0 },
  { type: 'skip-odd',     label: 'SKIP-ODD',      defaultParam: 0 },
  { type: 'transpose',    label: 'TRANSPOSE',     defaultParam: 7 },
  { type: 'invert',       label: 'INVERT',        defaultParam: 60 },
  { type: 'octave-shift', label: 'OCTAVE-SHIFT',  defaultParam: 1 },
  { type: 'double-time',  label: 'DOUBLE-TIME',   defaultParam: 0 },
  { type: 'stutter',      label: 'STUTTER',       defaultParam: 4 },
]

function dispatchVariationEdit(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  const vp = getEditingVariationPattern(engine, ui)

  switch (event.type) {
    case 'step-press': {
      // Steps 0 to phraseLength-1: select/deselect bar
      if (event.step >= vp.length) return { ui, engine }
      if (ui.varSelectedBar === event.step) {
        // Deselect
        return { ui: { ...ui, varSelectedBar: -1 }, engine }
      }
      return { ui: { ...ui, varSelectedBar: event.step }, engine }
    }

    case 'encoder-a-turn': {
      // Browse transform catalog
      const maxIdx = TRANSFORM_CATALOG.length - 1
      const next = clamp(ui.varParam + event.delta, 0, maxIdx)
      return { ui: { ...ui, varParam: next }, engine }
    }

    case 'encoder-a-push': {
      if (ui.varSelectedBar < 0) {
        // No bar selected → toggle variation enabled/disabled
        return { ui, engine: updateEditingVariationPattern(engine, ui, { ...vp, enabled: !vp.enabled }) }
      }
      // Bar selected → add browsed transform to bar's stack
      const catalogEntry = TRANSFORM_CATALOG[ui.varParam]
      const newTransform: Transform = { type: catalogEntry.type, param: catalogEntry.defaultParam }
      const bar = ui.varSelectedBar
      const slot = vp.slots[bar]
      const newSlots = vp.slots.map((s, i) =>
        i === bar ? { transforms: [...slot.transforms, newTransform] } : s,
      )
      return { ui, engine: updateEditingVariationPattern(engine, ui, { ...vp, slots: newSlots }) }
    }

    case 'encoder-a-hold': {
      if (ui.varSelectedBar < 0) return { ui, engine }
      // Remove last transform from selected bar's stack
      const bar = ui.varSelectedBar
      const slot = vp.slots[bar]
      if (slot.transforms.length === 0) return { ui, engine }
      const newSlots = vp.slots.map((s, i) =>
        i === bar ? { transforms: s.transforms.slice(0, -1) } : s,
      )
      return { ui, engine: updateEditingVariationPattern(engine, ui, { ...vp, slots: newSlots }) }
    }

    case 'encoder-b-turn': {
      if (ui.varSelectedBar < 0) return { ui, engine }
      // Adjust param of last transform in selected bar
      const bar = ui.varSelectedBar
      const slot = vp.slots[bar]
      if (slot.transforms.length === 0) return { ui, engine }
      const lastIdx = slot.transforms.length - 1
      const t = slot.transforms[lastIdx]
      const newParam = adjustTransformParam(t, event.delta)
      if (newParam === t.param) return { ui, engine }
      const newTransforms = slot.transforms.map((tr, i) =>
        i === lastIdx ? { ...tr, param: newParam } : tr,
      )
      const newSlots = vp.slots.map((s, i) =>
        i === bar ? { transforms: newTransforms } : s,
      )
      return { ui, engine: updateEditingVariationPattern(engine, ui, { ...vp, slots: newSlots }) }
    }

    default:
      return { ui, engine }
  }
}

/** Adjust a transform's param by encoder delta, respecting valid ranges */
function adjustTransformParam(t: Transform, delta: number): number {
  switch (t.type) {
    case 'rotate':
      return clamp(t.param + delta, 1, 64)
    case 'thin':
      return Math.round(clamp(t.param + delta * 0.1, 0.1, 0.9) * 10) / 10
    case 'transpose':
      return clamp(t.param + delta, -24, 24)
    case 'invert':
      return clamp(t.param + delta, 0, 127)
    case 'octave-shift':
      return clamp(t.param + delta, -3, 3)
    case 'stutter':
      return clamp(t.param + delta, 1, 16)
    default:
      // No param for this transform type
      return t.param
  }
}

function updateVariationPattern(engine: SequencerState, trackIdx: number, pattern: VariationPattern): SequencerState {
  return {
    ...engine,
    variationPatterns: engine.variationPatterns.map((p, i) => (i === trackIdx ? pattern : p)),
  }
}

/** Cycle subtrack override: null (inherit) → 'bypass' → VariationPattern (override) → null */
function dispatchVariationOverrideCycle(ui: UIState, engine: SequencerState): DispatchResult {
  const sub = (ui.heldButton as { kind: 'subtrack'; subtrack: SubtrackId }).subtrack
  const trackIdx = ui.selectedTrack
  const vp = engine.variationPatterns[trackIdx]
  const current = vp.subtrackOverrides[sub]

  let next: VariationPattern | 'bypass' | null
  if (current === null) {
    next = 'bypass'
  } else if (current === 'bypass') {
    next = createDefaultVariationPattern()
  } else {
    next = null
  }

  const newVP: VariationPattern = {
    ...vp,
    subtrackOverrides: { ...vp.subtrackOverrides, [sub]: next },
  }
  return { ui: { ...ui, holdEncoderUsed: true }, engine: updateVariationPattern(engine, trackIdx, newVP) }
}

/** Get the effective VariationPattern for the current editing context (track-level or subtrack override) */
export function getEditingVariationPattern(engine: SequencerState, ui: UIState): VariationPattern {
  const vp = engine.variationPatterns[ui.selectedTrack]
  if (ui.varEditSubtrack) {
    const override = vp.subtrackOverrides[ui.varEditSubtrack]
    if (override !== null && override !== 'bypass') return override
  }
  return vp
}

/** Update the VariationPattern being currently edited (track-level or subtrack override) */
function updateEditingVariationPattern(engine: SequencerState, ui: UIState, updated: VariationPattern): SequencerState {
  const trackIdx = ui.selectedTrack
  const vp = engine.variationPatterns[trackIdx]
  if (ui.varEditSubtrack) {
    const newVP: VariationPattern = {
      ...vp,
      subtrackOverrides: { ...vp.subtrackOverrides, [ui.varEditSubtrack]: updated },
    }
    return updateVariationPattern(engine, trackIdx, newVP)
  }
  return updateVariationPattern(engine, trackIdx, updated)
}

// --- Transpose Edit (XPOSE) ---
// T1-T4: select track (cross-modal, handled globally)
// Enc A: scroll params, Enc A hold: reset param/section
// Enc B: adjust selected parameter value

function dispatchTransposeEdit(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  const rows = getXposeVisibleRows(engine, ui)
  const maxIdx = rows.length - 1

  switch (event.type) {
    case 'encoder-a-turn': {
      const next = clamp(ui.xposeParam + event.delta, 0, maxIdx)
      return { ui: { ...ui, xposeParam: next }, engine }
    }
    case 'encoder-a-hold':
      return dispatchXposeReset(ui, engine)
    case 'encoder-b-turn':
      return dispatchXposeParamAdjust(ui, engine, event.delta)
    case 'encoder-b-push':
      return { ui, engine }
    default:
      return { ui, engine }
  }
}

function dispatchXposeParamAdjust(ui: UIState, engine: SequencerState, delta: number): DispatchResult {
  const trackIdx = ui.selectedTrack
  const tc = engine.transposeConfigs[trackIdx]
  const rows = getXposeVisibleRows(engine, ui)
  const row = rows[ui.xposeParam]
  if (!row) return { ui, engine }

  switch (row.paramId) {
    case 'xpose.semi':
      return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, semitones: clamp(tc.semitones + delta, -48, 48) }) }
    case 'xpose.noteLow': {
      const newLow = clamp(tc.noteLow + delta, 0, 127)
      const newHigh = Math.max(newLow, tc.noteHigh)
      return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, noteLow: newLow, noteHigh: newHigh }) }
    }
    case 'xpose.noteHigh': {
      const newHigh = clamp(tc.noteHigh + delta, 0, 127)
      const newLow = Math.min(tc.noteLow, newHigh)
      return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, noteLow: newLow, noteHigh: newHigh }) }
    }
    case 'xpose.glScale': {
      const newVal = Math.round(clamp(tc.glScale + delta * 0.05, 0.25, 4.0) * 100) / 100
      return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, glScale: newVal }) }
    }
    case 'xpose.velScale': {
      const newVal = Math.round(clamp(tc.velScale + delta * 0.05, 0.25, 4.0) * 100) / 100
      return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, velScale: newVal }) }
    }
    default:
      return { ui, engine }
  }
}

function dispatchXposeReset(ui: UIState, engine: SequencerState): DispatchResult {
  const trackIdx = ui.selectedTrack
  const tc = engine.transposeConfigs[trackIdx]
  const rows = getXposeVisibleRows(engine, ui)
  const row = rows[ui.xposeParam]
  if (!row) return { ui, engine }

  if (row.type === 'header') {
    if (row.paramId === 'section.pitch') {
      return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, semitones: 0, noteLow: 0, noteHigh: 127 }) }
    }
    if (row.paramId === 'section.dynamics') {
      return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, glScale: 1.0, velScale: 1.0 }) }
    }
    return { ui, engine }
  }

  const defaults: Record<string, Partial<import('../engine/types').TransposeConfig>> = {
    'xpose.semi': { semitones: 0 },
    'xpose.noteLow': { noteLow: 0 },
    'xpose.noteHigh': { noteHigh: 127 },
    'xpose.glScale': { glScale: 1.0 },
    'xpose.velScale': { velScale: 1.0 },
  }
  const d = defaults[row.paramId]
  if (d) return { ui, engine: updateTransposeConfig(engine, trackIdx, { ...tc, ...d }) }
  return { ui, engine }
}

function updateTransposeConfig(engine: SequencerState, trackIdx: number, config: import('../engine/types').TransposeConfig): SequencerState {
  return {
    ...engine,
    transposeConfigs: engine.transposeConfigs.map((c, i) => (i === trackIdx ? config : c)),
  }
}

// --- RAND Screen ---
// Enc A: scroll parameter list (0-12)
// Enc B: adjust selected parameter value
// Enc A push: apply preset (row 0) or enter name-entry (row 12)
// Enc B push: return home

const NAME_MAX_LEN = 12
const SCALE_LIST = Object.values(SCALES)

function dispatchRand(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  const visibleRows = getVisibleRows(engine, ui)
  const maxIdx = visibleRows.length - 1

  switch (event.type) {
    case 'encoder-a-turn': {
      const next = clamp(ui.randParam + event.delta, 0, maxIdx)
      return { ui: { ...ui, randParam: next }, engine }
    }
    case 'encoder-a-push': {
      const row = visibleRows[ui.randParam]
      if (!row) return { ui, engine }
      // Apply preset when on preset row
      if (row.paramId === 'preset') {
        const allPresets = getAllPresets(engine)
        const preset = allPresets[ui.randPresetIndex]
        if (preset) {
          return {
            ui,
            engine: updateRandomConfig(engine, ui.selectedTrack, preset.config),
          }
        }
      }
      // Enter name-entry mode when on SAVE row
      if (row.paramId === 'save') {
        return {
          ui: {
            ...ui,
            mode: 'name-entry',
            nameChars: Array(NAME_MAX_LEN).fill(26), // all spaces
            nameCursor: 0,
          },
          engine,
        }
      }
      return { ui, engine }
    }
    case 'encoder-a-hold': {
      return dispatchRandReset(ui, engine)
    }
    case 'encoder-b-turn': {
      return dispatchRandParamAdjust(ui, engine, event.delta)
    }
    case 'encoder-b-push':
      return { ui, engine }  // no-op (context-sensitive TBD)
    default:
      return { ui, engine }
  }
}

function dispatchRandParamAdjust(ui: UIState, engine: SequencerState, delta: number): DispatchResult {
  const trackIdx = ui.selectedTrack
  const config = engine.randomConfigs[trackIdx]
  const visibleRows = getVisibleRows(engine, ui)
  const row = visibleRows[ui.randParam]
  if (!row) return { ui, engine }

  switch (row.paramId) {
    case 'preset': {
      const total = getAllPresets(engine).length
      const next = clamp(ui.randPresetIndex + delta, 0, total - 1)
      return { ui: { ...ui, randPresetIndex: next }, engine }
    }
    case 'pitch.scale': {
      const curIdx = SCALE_LIST.findIndex(s => s.name === config.pitch.scale.name)
      const nextIdx = clamp(curIdx + delta, 0, SCALE_LIST.length - 1)
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, pitch: { ...config.pitch, scale: SCALE_LIST[nextIdx] } }) }
    }
    case 'pitch.root':
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, pitch: { ...config.pitch, root: clamp(config.pitch.root + delta, 0, 127) } }) }
    case 'pitch.low': {
      const newLow = clamp(config.pitch.low + delta, 0, 127)
      const newHigh = Math.max(newLow, config.pitch.high)
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, pitch: { ...config.pitch, low: newLow, high: newHigh } }) }
    }
    case 'pitch.high': {
      const newHigh = clamp(config.pitch.high + delta, 0, 127)
      const newLow = Math.min(config.pitch.low, newHigh)
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, pitch: { ...config.pitch, low: newLow, high: newHigh } }) }
    }
    case 'pitch.maxNotes':
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, pitch: { ...config.pitch, maxNotes: clamp(config.pitch.maxNotes + delta, 0, 12) } }) }
    case 'slide.probability': {
      const newVal = Math.round(clamp(config.slide.probability + delta * 0.05, 0, 1) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, slide: { ...config.slide, probability: newVal } }) }
    }
    case 'arp.enabled': {
      const ac = engine.arpConfigs[trackIdx]
      return { ui, engine: updateArpConfig(engine, trackIdx, { ...ac, enabled: !ac.enabled }) }
    }
    case 'arp.direction': {
      const ac = engine.arpConfigs[trackIdx]
      const dirs: ArpDirection[] = ['up', 'down', 'triangle', 'random']
      const curIdx = dirs.indexOf(ac.direction)
      const nextIdx = ((curIdx + delta) % dirs.length + dirs.length) % dirs.length
      return { ui, engine: updateArpConfig(engine, trackIdx, { ...ac, direction: dirs[nextIdx] }) }
    }
    case 'arp.octaveRange': {
      const ac = engine.arpConfigs[trackIdx]
      return { ui, engine: updateArpConfig(engine, trackIdx, { ...ac, octaveRange: clamp(ac.octaveRange + delta, 1, 4) }) }
    }
    case 'gate.fillMin': {
      const newMin = Math.round(clamp(config.gate.fillMin + delta * 0.05, 0, 1) * 100) / 100
      const newMax = Math.round(Math.max(newMin, config.gate.fillMax) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, fillMin: newMin, fillMax: newMax } }) }
    }
    case 'gate.fillMax': {
      const newMax = Math.round(clamp(config.gate.fillMax + delta * 0.05, 0, 1) * 100) / 100
      const newMin = Math.round(Math.min(config.gate.fillMin, newMax) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, fillMin: newMin, fillMax: newMax } }) }
    }
    case 'gate.mode': {
      const modes: Array<'random' | 'euclidean' | 'sync' | 'cluster'> = ['random', 'euclidean', 'sync', 'cluster']
      const curIdx = modes.indexOf(config.gate.mode)
      const nextIdx = ((curIdx + delta) % modes.length + modes.length) % modes.length
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, mode: modes[nextIdx] } }) }
    }
    case 'gate.randomOffset':
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, randomOffset: !config.gate.randomOffset } }) }
    case 'gate.clusterContinuation': {
      const newVal = Math.round(clamp(config.gate.clusterContinuation + delta * 0.05, 0, 1) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, clusterContinuation: newVal } }) }
    }
    case 'gateLength.min': {
      const newMin = Math.round(clamp(config.gateLength.min + delta * 0.05, 0.05, 1) * 100) / 100
      const newMax = Math.round(Math.max(newMin, config.gateLength.max) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, gateLength: { min: newMin, max: newMax } }) }
    }
    case 'gateLength.max': {
      const newMax = Math.round(clamp(config.gateLength.max + delta * 0.05, 0.05, 1) * 100) / 100
      const newMin = Math.round(Math.min(config.gateLength.min, newMax) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, gateLength: { min: newMin, max: newMax } }) }
    }
    case 'ratchet.maxRatchet':
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, ratchet: { ...config.ratchet, maxRatchet: clamp(config.ratchet.maxRatchet + delta, 1, 4) } }) }
    case 'ratchet.probability': {
      const newVal = Math.round(clamp(config.ratchet.probability + delta * 0.05, 0, 1) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, ratchet: { ...config.ratchet, probability: newVal } }) }
    }
    case 'tie.probability': {
      const newVal = Math.round(clamp(config.tie.probability + delta * 0.05, 0, 1) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, tie: { ...config.tie, probability: newVal } }) }
    }
    case 'tie.maxLength':
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, tie: { ...config.tie, maxLength: clamp(config.tie.maxLength + delta, 1, 8) } }) }
    case 'velocity.low': {
      const newLow = clamp(config.velocity.low + delta, 0, 127)
      const newHigh = Math.max(newLow, config.velocity.high)
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, velocity: { low: newLow, high: newHigh } }) }
    }
    case 'velocity.high': {
      const newHigh = clamp(config.velocity.high + delta, 0, 127)
      const newLow = Math.min(config.velocity.low, newHigh)
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, velocity: { low: newLow, high: newHigh } }) }
    }
    case 'mod.low': {
      const newLow = Math.round(clamp(config.mod.low + delta * 0.05, 0, 1) * 100) / 100
      const newHigh = Math.round(Math.max(newLow, config.mod.high) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, mod: { low: newLow, high: newHigh } }) }
    }
    case 'mod.high': {
      const newHigh = Math.round(clamp(config.mod.high + delta * 0.05, 0, 1) * 100) / 100
      const newLow = Math.round(Math.min(config.mod.low, newHigh) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, mod: { low: newLow, high: newHigh } }) }
    }
    case 'lfo.enabled': {
      const lc = engine.lfoConfigs[trackIdx]
      return { ui, engine: updateLFOConfig(engine, trackIdx, { ...lc, enabled: !lc.enabled }) }
    }
    case 'lfo.waveform': {
      const lc = engine.lfoConfigs[trackIdx]
      const waves: import('../engine/types').LFOWaveform[] = ['sine', 'triangle', 'saw', 'slew-random']
      const curIdx = waves.indexOf(lc.waveform)
      const nextIdx = ((curIdx + delta) % waves.length + waves.length) % waves.length
      return { ui, engine: updateLFOConfig(engine, trackIdx, { ...lc, waveform: waves[nextIdx] }) }
    }
    case 'lfo.rate': {
      const lc = engine.lfoConfigs[trackIdx]
      return { ui, engine: updateLFOConfig(engine, trackIdx, { ...lc, rate: clamp(lc.rate + delta, 1, 64) }) }
    }
    case 'lfo.depth': {
      const lc = engine.lfoConfigs[trackIdx]
      const newVal = Math.round(clamp(lc.depth + delta * 0.05, 0, 1) * 100) / 100
      return { ui, engine: updateLFOConfig(engine, trackIdx, { ...lc, depth: newVal }) }
    }
    default:
      return { ui, engine }
  }
}

/**
 * Reset a single param to its default, or an entire section if on a header row.
 */
function dispatchRandReset(ui: UIState, engine: SequencerState): DispatchResult {
  const visibleRows = getVisibleRows(engine, ui)
  const row = visibleRows[ui.randParam]
  if (!row) return { ui, engine }

  const trackIdx = ui.selectedTrack
  const defaultConfig = getDefaultRandomConfig(trackIdx)
  const defaultArp = { enabled: false, direction: 'up' as const, octaveRange: 1 }
  const defaultLfo = { enabled: false, waveform: 'sine' as const, rate: 16, depth: 1, offset: 0.5 }

  if (row.type === 'header') {
    // Reset all params in this section
    const paramIds = SECTION_PARAMS[row.paramId] ?? []
    let eng = engine
    for (const pid of paramIds) {
      eng = resetSingleParam(eng, trackIdx, pid, defaultConfig, defaultArp, defaultLfo)
    }
    return { ui, engine: eng }
  }

  // Reset single param
  return { ui, engine: resetSingleParam(engine, trackIdx, row.paramId, defaultConfig, defaultArp, defaultLfo) }
}

const DEFAULT_PRESET_NAMES = ['Bassline', 'Acid', 'Hypnotic', 'Stab']

function getDefaultRandomConfig(trackIdx: number): RandomConfig {
  const presetName = DEFAULT_PRESET_NAMES[trackIdx]
  const preset = PRESETS.find(p => p.name === presetName)
  if (preset) return structuredClone(preset.config)

  return {
    pitch: { low: 48, high: 72, scale: SCALES.minorPentatonic, root: 60, maxNotes: 4 },
    gate: { fillMin: 0.25, fillMax: 0.75, mode: 'euclidean', randomOffset: true, clusterContinuation: 0.7 },
    velocity: { low: 64, high: 120 },
    gateLength: { min: 0.5, max: 0.5 },
    ratchet: { maxRatchet: 1, probability: 0 },
    slide: { probability: 0 },
    mod: { low: 0, high: 1 },
    tie: { probability: 0, maxLength: 2 },
  }
}

function resetSingleParam(
  engine: SequencerState,
  trackIdx: number,
  paramId: string,
  dc: RandomConfig,
  da: { enabled: boolean; direction: ArpDirection; octaveRange: number },
  dl: { enabled: boolean; waveform: import('../engine/types').LFOWaveform; rate: number; depth: number; offset: number },
): SequencerState {
  const config = engine.randomConfigs[trackIdx]

  switch (paramId) {
    case 'pitch.scale': return updateRandomConfig(engine, trackIdx, { ...config, pitch: { ...config.pitch, scale: dc.pitch.scale } })
    case 'pitch.root': return updateRandomConfig(engine, trackIdx, { ...config, pitch: { ...config.pitch, root: dc.pitch.root } })
    case 'pitch.low': return updateRandomConfig(engine, trackIdx, { ...config, pitch: { ...config.pitch, low: dc.pitch.low } })
    case 'pitch.high': return updateRandomConfig(engine, trackIdx, { ...config, pitch: { ...config.pitch, high: dc.pitch.high } })
    case 'pitch.maxNotes': return updateRandomConfig(engine, trackIdx, { ...config, pitch: { ...config.pitch, maxNotes: dc.pitch.maxNotes } })
    case 'slide.probability': return updateRandomConfig(engine, trackIdx, { ...config, slide: dc.slide })
    case 'arp.enabled': return updateArpConfig(engine, trackIdx, { ...engine.arpConfigs[trackIdx], enabled: da.enabled })
    case 'arp.direction': return updateArpConfig(engine, trackIdx, { ...engine.arpConfigs[trackIdx], direction: da.direction })
    case 'arp.octaveRange': return updateArpConfig(engine, trackIdx, { ...engine.arpConfigs[trackIdx], octaveRange: da.octaveRange })
    case 'gate.fillMin': return updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, fillMin: dc.gate.fillMin } })
    case 'gate.fillMax': return updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, fillMax: dc.gate.fillMax } })
    case 'gate.mode': return updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, mode: dc.gate.mode } })
    case 'gate.randomOffset': return updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, randomOffset: dc.gate.randomOffset } })
    case 'gate.clusterContinuation': return updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, clusterContinuation: dc.gate.clusterContinuation } })
    case 'gateLength.min': return updateRandomConfig(engine, trackIdx, { ...config, gateLength: { ...config.gateLength, min: dc.gateLength.min } })
    case 'gateLength.max': return updateRandomConfig(engine, trackIdx, { ...config, gateLength: { ...config.gateLength, max: dc.gateLength.max } })
    case 'ratchet.maxRatchet': return updateRandomConfig(engine, trackIdx, { ...config, ratchet: { ...config.ratchet, maxRatchet: dc.ratchet.maxRatchet } })
    case 'ratchet.probability': return updateRandomConfig(engine, trackIdx, { ...config, ratchet: { ...config.ratchet, probability: dc.ratchet.probability } })
    case 'tie.probability': return updateRandomConfig(engine, trackIdx, { ...config, tie: { ...config.tie, probability: dc.tie.probability } })
    case 'tie.maxLength': return updateRandomConfig(engine, trackIdx, { ...config, tie: { ...config.tie, maxLength: dc.tie.maxLength } })
    case 'velocity.low': return updateRandomConfig(engine, trackIdx, { ...config, velocity: { ...config.velocity, low: dc.velocity.low } })
    case 'velocity.high': return updateRandomConfig(engine, trackIdx, { ...config, velocity: { ...config.velocity, high: dc.velocity.high } })
    case 'mod.low': return updateRandomConfig(engine, trackIdx, { ...config, mod: { ...config.mod, low: dc.mod.low } })
    case 'mod.high': return updateRandomConfig(engine, trackIdx, { ...config, mod: { ...config.mod, high: dc.mod.high } })
    case 'lfo.enabled': return updateLFOConfig(engine, trackIdx, { ...engine.lfoConfigs[trackIdx], enabled: dl.enabled })
    case 'lfo.waveform': return updateLFOConfig(engine, trackIdx, { ...engine.lfoConfigs[trackIdx], waveform: dl.waveform })
    case 'lfo.rate': return updateLFOConfig(engine, trackIdx, { ...engine.lfoConfigs[trackIdx], rate: dl.rate })
    case 'lfo.depth': return updateLFOConfig(engine, trackIdx, { ...engine.lfoConfigs[trackIdx], depth: dl.depth })
    default: return engine
  }
}

function updateArpConfig(engine: SequencerState, trackIdx: number, config: import('../engine/types').ArpConfig): SequencerState {
  return {
    ...engine,
    arpConfigs: engine.arpConfigs.map((c, i) => (i === trackIdx ? config : c)),
  }
}

function updateRandomConfig(engine: SequencerState, trackIdx: number, config: RandomConfig): SequencerState {
  return {
    ...engine,
    randomConfigs: engine.randomConfigs.map((c, i) => (i === trackIdx ? config : c)),
  }
}

// --- Route Screen ---
// Enc A: scroll param rows (gate/pitch/vel/mod, 0-3)
// Enc B: cycle source track for selected param (wraps 0-3)
// Enc B push: return home

const ROUTE_PARAMS: Array<'gate' | 'pitch' | 'velocity' | 'mod'> = ['gate', 'pitch', 'velocity', 'mod']

function dispatchRoute(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  switch (event.type) {
    case 'encoder-a-turn': {
      const newParam = clamp(ui.routeParam + event.delta, 0, 3)
      return { ui: { ...ui, routeParam: newParam }, engine }
    }
    case 'encoder-b-turn': {
      const param = ROUTE_PARAMS[ui.routeParam]
      const outputIdx = ui.selectedTrack
      const current = engine.routing[outputIdx][param]
      const next = ((current + event.delta) % 4 + 4) % 4
      return { ui, engine: setOutputSource(engine, outputIdx, param, next) }
    }
    default:
      return { ui, engine }
  }
}

function updateMIDIConfig(engine: SequencerState, outputIdx: number, patch: Partial<import('../engine/types').MIDIOutputConfig>): SequencerState {
  return {
    ...engine,
    midiConfigs: engine.midiConfigs.map((c, i) => i === outputIdx ? { ...c, ...patch } : c),
  }
}

// --- Settings Screen ---
// Enc A: scroll parameter list
// Enc A hold: reset param/section to default
// Enc B: adjust selected parameter value

const CLOCK_SOURCES: ClockSource[] = ['internal', 'midi', 'external']

function dispatchSettings(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  const rows = getSettingsRows(engine, ui)

  switch (event.type) {
    case 'encoder-a-turn': {
      const next = clamp(ui.settingsParam + event.delta, 0, rows.length - 1)
      return { ui: { ...ui, settingsParam: next }, engine }
    }
    case 'encoder-a-hold':
      return dispatchSettingsReset(ui, engine)
    case 'encoder-b-turn':
      return dispatchSettingsEncoderB(ui, engine, event.delta)
    default:
      return { ui, engine }
  }
}

function dispatchSettingsEncoderB(ui: UIState, engine: SequencerState, delta: number): DispatchResult {
  const rows = getSettingsRows(engine, ui)
  const row = rows[ui.settingsParam]
  if (!row || row.type === 'header') return { ui, engine }

  switch (row.paramId) {
    case 'clock.bpm': {
      const bpm = clamp(engine.transport.bpm + delta, 20, 300)
      return { ui, engine: { ...engine, transport: { ...engine.transport, bpm } } }
    }
    case 'clock.source': {
      const idx = CLOCK_SOURCES.indexOf(engine.transport.clockSource)
      const next = ((idx + delta) % CLOCK_SOURCES.length + CLOCK_SOURCES.length) % CLOCK_SOURCES.length
      return { ui, engine: { ...engine, transport: { ...engine.transport, clockSource: CLOCK_SOURCES[next] } } }
    }
    case 'midi.enabled': {
      if (delta > 0 && !engine.midiEnabled) return { ui, engine: { ...engine, midiEnabled: true } }
      if (delta < 0 && engine.midiEnabled) return { ui, engine: { ...engine, midiEnabled: false } }
      return { ui, engine }
    }
    case 'midi.device': {
      if (ui.midiDevices.length === 0) return { ui, engine }
      const next = ((ui.midiDeviceIndex + delta) % ui.midiDevices.length + ui.midiDevices.length) % ui.midiDevices.length
      return { ui: { ...ui, midiDeviceIndex: next }, engine }
    }
    default: {
      // midi.ch.0 through midi.ch.3
      const match = row.paramId.match(/^midi\.ch\.(\d)$/)
      if (match) {
        const outputIdx = parseInt(match[1], 10)
        const current = engine.midiConfigs[outputIdx].channel
        const next = clamp(current + delta, 1, 16)
        return {
          ui,
          engine: updateMIDIConfig(engine, outputIdx, { channel: next }),
        }
      }
      return { ui, engine }
    }
  }
}

function dispatchSettingsReset(ui: UIState, engine: SequencerState): DispatchResult {
  const rows = getSettingsRows(engine, ui)
  const row = rows[ui.settingsParam]
  if (!row) return { ui, engine }

  // If on a section header, reset all params in that section
  if (row.type === 'header') {
    const sectionParams = SETTINGS_SECTION_PARAMS[row.paramId]
    if (!sectionParams) return { ui, engine }
    let result: DispatchResult = { ui, engine }
    for (const paramId of sectionParams) {
      result = resetSettingsParam(result.ui, result.engine, paramId)
    }
    return result
  }

  // Single param reset
  return resetSettingsParam(ui, engine, row.paramId)
}

function resetSettingsParam(ui: UIState, engine: SequencerState, paramId: string): DispatchResult {
  switch (paramId) {
    case 'clock.bpm':
      return { ui, engine: { ...engine, transport: { ...engine.transport, bpm: 135 } } }
    case 'clock.source':
      return { ui, engine: { ...engine, transport: { ...engine.transport, clockSource: 'internal' } } }
    case 'midi.enabled':
      return { ui, engine: { ...engine, midiEnabled: false } }
    case 'midi.device':
      return { ui: { ...ui, midiDeviceIndex: 0 }, engine }
    default: {
      const match = paramId.match(/^midi\.ch\.(\d)$/)
      if (match) {
        const outputIdx = parseInt(match[1], 10)
        return { ui, engine: updateMIDIConfig(engine, outputIdx, { channel: outputIdx + 1 }) }
      }
      return { ui, engine }
    }
  }
}

// --- LED State ---

export function getLEDState(ui: UIState, engine: SequencerState): LEDState {
  const play: LEDState['play'] = engine.transport.playing ? 'pulse' : 'off'

  // Track LEDs: selected track is 'on'
  const tracks: LEDState['tracks'] = [0, 1, 2, 3].map(i =>
    i === ui.selectedTrack ? 'on' : 'off',
  ) as LEDState['tracks']

  // Step LEDs: depend on mode
  const steps = getStepLEDs(ui, engine)

  return { steps, tracks, play }
}

function getStepLEDs(ui: UIState, engine: SequencerState): LEDState['steps'] {
  const leds: LEDState['steps'] = new Array(16).fill('off') as LEDState['steps']
  const track = engine.tracks[ui.selectedTrack]
  const mute = engine.mutePatterns[ui.selectedTrack]
  const pageOffset = ui.currentPage * 16

  switch (ui.mode) {
    case 'gate-edit': {
      for (let i = 0; i < 16; i++) {
        const stepIdx = pageOffset + i
        if (stepIdx >= track.gate.length) {
          leds[i] = 'off'
        } else if (stepIdx === track.gate.currentStep) {
          leds[i] = 'flash'
        } else {
          leds[i] = (track.gate.steps[stepIdx].on || track.gate.steps[stepIdx].tie) ? 'on' : 'dim'
        }
      }
      break
    }
    case 'pitch-edit': {
      for (let i = 0; i < 16; i++) {
        const stepIdx = pageOffset + i
        if (stepIdx >= track.pitch.length) {
          leds[i] = 'off'
        } else if (i === ui.selectedStep) {
          leds[i] = 'flash'
        } else {
          leds[i] = 'dim'
        }
      }
      break
    }
    case 'vel-edit': {
      for (let i = 0; i < 16; i++) {
        const stepIdx = pageOffset + i
        if (stepIdx >= track.velocity.length) {
          leds[i] = 'off'
        } else if (i === ui.selectedStep) {
          leds[i] = 'flash'
        } else {
          leds[i] = 'dim'
        }
      }
      break
    }
    case 'mute-edit': {
      for (let i = 0; i < 16; i++) {
        const stepIdx = pageOffset + i
        if (stepIdx >= mute.length) {
          leds[i] = 'off'
        } else if (stepIdx === mute.currentStep) {
          leds[i] = 'flash'
        } else {
          leds[i] = mute.steps[stepIdx] ? 'on' : 'dim'
        }
      }
      break
    }
    case 'variation-edit': {
      const vp = getEditingVariationPattern(engine, ui)
      for (let i = 0; i < 16; i++) {
        if (i >= vp.length) {
          leds[i] = 'off'
        } else if (i === ui.varSelectedBar) {
          leds[i] = 'flash'  // selected bar
        } else if (vp.slots[i] && vp.slots[i].transforms.length > 0) {
          leds[i] = 'on'     // bar has transforms
        } else {
          leds[i] = 'dim'    // empty bar
        }
      }
      break
    }
    default: {
      // Home and stub modes: show gate pattern overview
      for (let i = 0; i < 16; i++) {
        if (i >= track.gate.length) {
          leds[i] = 'off'
        } else if (i === track.gate.currentStep) {
          leds[i] = 'flash'
        } else {
          leds[i] = (track.gate.steps[i].on || track.gate.steps[i].tie) ? 'on' : 'off'
        }
      }
      break
    }
  }

  return leds
}

// --- Hold Combo Dispatch ---
// Hold track + enc A = all subtrack lengths (synced)
// Hold track + enc B = track clock divider
// Hold subtrack + enc A = that subtrack's length
// Hold subtrack + enc B = that subtrack's clock divider
// Hold step in gate-edit: enc A = gate length, enc B = ratchet count
function dispatchStepHoldCombo(
  ui: UIState,
  engine: SequencerState,
  event: { type: 'encoder-a-turn'; delta: number } | { type: 'encoder-b-turn'; delta: number },
): DispatchResult {
  const step = (ui.heldButton as { kind: 'step'; step: number }).step
  const stepIdx = ui.currentPage * 16 + step
  const track = engine.tracks[ui.selectedTrack]

  // Enc A = gate length, Enc B = ratchet
  if (event.type === 'encoder-a-turn') {
    // Gate length (0.05 - 1.0 in 0.05 steps)
    if (stepIdx >= track.gate.length) return { ui, engine }
    const cur = track.gate.steps[stepIdx].length
    const next = Math.round(clamp(cur + event.delta * 0.05, 0.05, 1.0) * 100) / 100
    return { ui: { ...ui, holdEncoderUsed: true }, engine: setGateLength(engine, ui.selectedTrack, stepIdx, next) }
  } else {
    // Ratchet count (1-4)
    if (stepIdx >= track.gate.length) return { ui, engine }
    const cur = track.gate.steps[stepIdx].ratchet
    const next = clamp(cur + event.delta, 1, 4)
    return { ui: { ...ui, holdEncoderUsed: true }, engine: setGateRatchet(engine, ui.selectedTrack, stepIdx, next) }
  }
}

// Hold step A in gate-edit + press step B → create/clear tie range
function dispatchStepTie(
  ui: UIState,
  engine: SequencerState,
  event: { type: 'step-press'; step: number },
): DispatchResult {
  const fromStep = ui.currentPage * 16 + (ui.heldButton as { kind: 'step'; step: number }).step
  const toStep = ui.currentPage * 16 + event.step
  if (fromStep === toStep) {
    // Same step — fall through to normal gate toggle behavior
    return dispatchGateEdit(ui, engine, event)
  }
  if (fromStep < toStep) {
    // Create tie range from fromStep+1 to toStep
    return { ui: { ...ui, holdEncoderUsed: true }, engine: setTieRange(engine, ui.selectedTrack, fromStep, toStep) }
  }
  // fromStep > toStep: clear ties from toStep to fromStep
  let eng = engine
  for (let i = toStep; i <= fromStep; i++) {
    eng = setGateTie(eng, ui.selectedTrack, i, false)
  }
  return { ui: { ...ui, holdEncoderUsed: true }, engine: eng }
}

// Hold mute + enc A = mute length
// Hold mute + enc B = mute clock divider

function dispatchHoldCombo(
  ui: UIState,
  engine: SequencerState,
  event: { type: 'encoder-a-turn'; delta: number } | { type: 'encoder-b-turn'; delta: number },
): DispatchResult {
  const held = ui.heldButton!
  const trackIdx = held.kind === 'track' ? held.track : ui.selectedTrack
  const uiUsed = { ...ui, holdEncoderUsed: true }

  if (held.kind === 'track') {
    if (event.type === 'encoder-a-turn') {
      // Hold track + enc A = change all subtrack lengths together
      const track = engine.tracks[trackIdx]
      const baseLength = track.gate.length
      const newLen = baseLength + event.delta
      let next = setSubtrackLength(engine, trackIdx, 'gate', newLen)
      next = setSubtrackLength(next, trackIdx, 'pitch', newLen)
      next = setSubtrackLength(next, trackIdx, 'velocity', newLen)
      next = setSubtrackLength(next, trackIdx, 'mod', newLen)
      return { ui: uiUsed, engine: next }
    }
    if (event.type === 'encoder-b-turn') {
      // Hold track + enc B = track clock divider
      const cur = engine.tracks[trackIdx].clockDivider
      return { ui: uiUsed, engine: setTrackClockDivider(engine, trackIdx, cur + event.delta) }
    }
  }

  if (held.kind === 'subtrack') {
    const sub = held.subtrack
    if (sub === 'gate' || sub === 'pitch' || sub === 'velocity' || sub === 'mod') {
      if (event.type === 'encoder-a-turn') {
        // Hold subtrack + enc A = subtrack length
        const cur = engine.tracks[trackIdx][sub].length
        return { ui: uiUsed, engine: setSubtrackLength(engine, trackIdx, sub, cur + event.delta) }
      }
      if (event.type === 'encoder-b-turn') {
        // Hold subtrack + enc B = subtrack clock divider
        const cur = engine.tracks[trackIdx][sub].clockDivider
        return { ui: uiUsed, engine: setSubtrackClockDivider(engine, trackIdx, sub, cur + event.delta) }
      }
    }
  }

  if (held.kind === 'feature' && held.feature === 'mute') {
    if (event.type === 'encoder-a-turn') {
      // Hold mute + enc A = mute length
      const cur = engine.mutePatterns[trackIdx].length
      return { ui: uiUsed, engine: setMuteLength(engine, trackIdx, cur + event.delta) }
    }
    if (event.type === 'encoder-b-turn') {
      // Hold mute + enc B = mute clock divider
      const cur = engine.mutePatterns[trackIdx].clockDivider
      return { ui: uiUsed, engine: setMuteClockDivider(engine, trackIdx, cur + event.delta) }
    }
  }

  if (held.kind === 'feature' && held.feature === 'variation') {
    if (event.type === 'encoder-a-turn') {
      // Hold VAR + enc A = variation phrase length (cycle 2, 4, 8, 16)
      // Works on whichever pattern is being edited (track-level or subtrack override)
      const vp = getEditingVariationPattern(engine, ui)
      const lengthOptions = [2, 4, 8, 16]
      const curIdx = lengthOptions.indexOf(vp.length)
      const newIdx = clamp((curIdx >= 0 ? curIdx : 1) + event.delta, 0, lengthOptions.length - 1)
      const newLength = lengthOptions[newIdx]
      // Resize slots array to match new length
      const newSlots = Array.from({ length: newLength }, (_, i) =>
        vp.slots[i] ?? { transforms: [] },
      )
      return {
        ui: uiUsed,
        engine: updateEditingVariationPattern(engine, ui, {
          ...vp,
          length: newLength,
          slots: newSlots,
          currentBar: vp.currentBar % newLength,
        }),
      }
    }
  }

  // Unhandled hold combo — no-op
  return { ui: uiUsed, engine }
}

// Hold + RESET → targeted playhead reset
function dispatchHoldReset(ui: UIState, engine: SequencerState): DispatchResult {
  const held = ui.heldButton!
  const trackIdx = ui.selectedTrack

  if (held.kind === 'track') {
    return { ui: { ...ui, holdEncoderUsed: true }, engine: resetTrackPlayheads(engine, held.track) }
  }

  if (held.kind === 'subtrack') {
    const sub = held.subtrack
    if (sub === 'gate' || sub === 'pitch' || sub === 'velocity' || sub === 'mod') {
      return { ui: { ...ui, holdEncoderUsed: true }, engine: resetSubtrackPlayhead(engine, trackIdx, sub) }
    }
  }

  return { ui, engine }
}

// Hold + RAND → targeted randomization
function dispatchHoldRand(ui: UIState, engine: SequencerState): DispatchResult {
  const held = ui.heldButton!
  const trackIdx = held.kind === 'track' ? held.track : ui.selectedTrack

  if (held.kind === 'track') {
    return { ui: { ...ui, holdEncoderUsed: true }, engine: randomizeTrackPattern(engine, trackIdx) }
  }

  if (held.kind === 'subtrack') {
    const sub = held.subtrack
    if (sub === 'gate') return { ui: { ...ui, holdEncoderUsed: true }, engine: randomizeGatePattern(engine, trackIdx) }
    if (sub === 'pitch') return { ui: { ...ui, holdEncoderUsed: true }, engine: randomizePitchPattern(engine, trackIdx) }
    if (sub === 'velocity') return { ui: { ...ui, holdEncoderUsed: true }, engine: randomizeVelocityPattern(engine, trackIdx) }
    if (sub === 'mod') return { ui: { ...ui, holdEncoderUsed: true }, engine: randomizeModPattern(engine, trackIdx) }
  }

  return { ui, engine }
}

// --- Name Entry ---
// Enc A: cycle character at cursor
// Enc B: move cursor left/right
// Enc A push: confirm and save preset
// Enc B push: cancel

export const NAME_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789-'

function dispatchNameEntry(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  switch (event.type) {
    case 'encoder-a-turn': {
      const chars = [...ui.nameChars]
      chars[ui.nameCursor] = ((chars[ui.nameCursor] + event.delta) % NAME_CHARSET.length + NAME_CHARSET.length) % NAME_CHARSET.length
      return { ui: { ...ui, nameChars: chars }, engine }
    }
    case 'encoder-b-turn': {
      const next = clamp(ui.nameCursor + event.delta, 0, NAME_MAX_LEN - 1)
      return { ui: { ...ui, nameCursor: next }, engine }
    }
    case 'encoder-a-push': {
      // Save: convert chars to string, trim trailing spaces, save preset
      const name = ui.nameChars.map(i => NAME_CHARSET[i]).join('').trimEnd()
      const config = engine.randomConfigs[ui.selectedTrack]
      return {
        ui: { ...ui, mode: 'rand' },
        engine: saveUserPreset(engine, name, config),
      }
    }
    case 'back': {
      // Cancel — return to rand without saving
      return { ui: { ...ui, mode: 'rand' }, engine }
    }
    case 'encoder-b-push':
      return { ui, engine }  // no-op (context-sensitive TBD)
    default:
      return { ui, engine }
  }
}

// --- Preset Helpers ---

/** Factory + user presets combined */
// getAllPresets re-exported from rand-rows.ts
export { getAllPresets } from './rand-rows'

// --- Helpers ---

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function resetAllPlayheads(engine: SequencerState): SequencerState {
  return {
    ...engine,
    transport: { ...engine.transport, masterTick: 0 },
    tracks: engine.tracks.map(t => ({
      ...t,
      gate: { ...t.gate, currentStep: 0 },
      pitch: { ...t.pitch, currentStep: 0 },
      velocity: { ...t.velocity, currentStep: 0 },
      mod: { ...t.mod, currentStep: 0 },
    })),
    mutePatterns: engine.mutePatterns.map(m => ({ ...m, currentStep: 0 })),
  }
}

function updateSubtrackSteps(
  engine: SequencerState,
  trackIdx: number,
  sub: 'velocity',
  steps: number[],
): SequencerState {
  return {
    ...engine,
    tracks: engine.tracks.map((t, i) => {
      if (i !== trackIdx) return t
      return { ...t, [sub]: { ...t[sub], steps } }
    }),
  }
}
