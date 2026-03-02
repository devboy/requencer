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

import type { SequencerState, RandomConfig, ArpDirection } from '../engine/types'
import { randomizeTrackPattern, randomizeGatePattern, randomizePitchPattern, randomizeVelocityPattern, randomizeModPattern, regenerateLFO, setSubtrackLength, setSubtrackClockDivider, setTrackClockDivider, setMuteLength, setMuteClockDivider, resetTrackPlayheads, resetSubtrackPlayhead, saveUserPreset, setOutputSource, setStep, setGateOn, setGateLength, setGateRatchet, setPitchNote, setSlide } from '../engine/sequencer'
import type { ScreenMode, ControlEvent, UIState, LEDState, HeldButtonTarget } from './hw-types'
import { PRESETS } from '../engine/presets'
import { SCALES } from '../engine/scales'
import { getVisibleRows, getAllPresets, SECTION_PARAMS } from './rand-rows'

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
    randPresetIndex: 0,
    nameChars: [],
    nameCursor: 0,
    mutateParam: 0,
    routeParam: 0,
    routePage: 0,
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
    return { ui: { ...ui, heldButton: event.button, holdEncoderUsed: false }, engine }
  }

  if (event.type === 'hold-end') {
    // Clear step selection when hold ends
    const clearStep = ui.heldButton?.kind === 'step'
    return { ui: { ...ui, heldButton: null, holdEncoderUsed: false, ...(clearStep ? { selectedStep: -1 } : {}) }, engine }
  }

  // --- Hold combo: step held in gate-edit → encoder A = gate length, encoder B = ratchet ---
  if (ui.heldButton?.kind === 'step' && ui.mode === 'gate-edit' && (event.type === 'encoder-a-turn' || event.type === 'encoder-b-turn')) {
    return dispatchStepHoldCombo(ui, engine, event)
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

  // Back — cross-modal navigation to home (name-entry handled above)
  if (event.type === 'back') {
    return { ui: { ...ui, mode: 'home', currentPage: 0, routePage: 0 }, engine }
  }

  // Feature buttons — enter feature screen
  if (event.type === 'feature-press') {
    const modeMap: Record<string, ScreenMode> = {
      mute: 'mute-edit',
      route: 'route',
      rand: 'rand',
      mutate: 'mutate-edit',
      transpose: 'transpose-edit',
    }
    return { ui: { ...ui, mode: modeMap[event.feature], selectedStep: 0, currentPage: 0 }, engine }
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

// --- Transpose Edit ---
// T1-T4: select track (cross-modal, handled globally)
// Enc A: adjust semitones (-48 to +48)
// Enc B turn: toggle quantize on/off
// Enc B push: return home
// Step buttons: quick-set common intervals (0=0, 1=+1, ... 7=+7, 8=-1, ... 15=-8)

function dispatchTransposeEdit(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  switch (event.type) {
    case 'step-press': {
      // Quick-set common intervals: steps 0-7 = 0..+7, steps 8-15 = -1..-8
      const semitones = event.step < 8 ? event.step : -(event.step - 7)
      return {
        ui,
        engine: updateTransposeConfig(engine, ui.selectedTrack, {
          ...engine.transposeConfigs[ui.selectedTrack],
          semitones,
        }),
      }
    }
    case 'encoder-a-turn': {
      const tc = engine.transposeConfigs[ui.selectedTrack]
      const newSemi = clamp(tc.semitones + event.delta, -48, 48)
      return {
        ui,
        engine: updateTransposeConfig(engine, ui.selectedTrack, { ...tc, semitones: newSemi }),
      }
    }
    case 'encoder-b-turn': {
      const tc = engine.transposeConfigs[ui.selectedTrack]
      return {
        ui,
        engine: updateTransposeConfig(engine, ui.selectedTrack, { ...tc, quantize: !tc.quantize }),
      }
    }
    case 'encoder-b-push':
      return { ui, engine }  // no-op (context-sensitive TBD)
    default:
      return { ui, engine }
  }
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
    case 'pitch.low':
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, pitch: { ...config.pitch, low: clamp(config.pitch.low + delta, 0, 127) } }) }
    case 'pitch.high':
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, pitch: { ...config.pitch, high: clamp(config.pitch.high + delta, 0, 127) } }) }
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
      const newVal = Math.round(clamp(config.gate.fillMin + delta * 0.05, 0, 1) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, fillMin: newVal } }) }
    }
    case 'gate.fillMax': {
      const newVal = Math.round(clamp(config.gate.fillMax + delta * 0.05, 0, 1) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, fillMax: newVal } }) }
    }
    case 'gate.mode': {
      const newMode = config.gate.mode === 'random' ? 'euclidean' : 'random'
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, mode: newMode } }) }
    }
    case 'gate.randomOffset':
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, randomOffset: !config.gate.randomOffset } }) }
    case 'gate.smartBars': {
      const barValues = [1, 2, 4, 8, 16]
      const curIdx = barValues.indexOf(config.gate.smartBars)
      const nextIdx = clamp((curIdx === -1 ? 0 : curIdx) + delta, 0, barValues.length - 1)
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, smartBars: barValues[nextIdx] } }) }
    }
    case 'gate.smartDensity': {
      const modes: import('../engine/types').SmartGateDensity[] = ['build', 'decay', 'build-drop', 'variation']
      const curIdx = modes.indexOf(config.gate.smartDensity)
      const nextIdx = ((curIdx + delta) % modes.length + modes.length) % modes.length
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, smartDensity: modes[nextIdx] } }) }
    }
    case 'gateLength.min': {
      const newVal = Math.round(clamp(config.gateLength.min + delta * 0.05, 0.05, 1) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, gateLength: { ...config.gateLength, min: newVal } }) }
    }
    case 'gateLength.max': {
      const newVal = Math.round(clamp(config.gateLength.max + delta * 0.05, 0.05, 1) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, gateLength: { ...config.gateLength, max: newVal } }) }
    }
    case 'ratchet.maxRatchet':
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, ratchet: { ...config.ratchet, maxRatchet: clamp(config.ratchet.maxRatchet + delta, 1, 4) } }) }
    case 'ratchet.probability': {
      const newVal = Math.round(clamp(config.ratchet.probability + delta * 0.05, 0, 1) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, ratchet: { ...config.ratchet, probability: newVal } }) }
    }
    case 'velocity.low':
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, velocity: { ...config.velocity, low: clamp(config.velocity.low + delta, 0, 127) } }) }
    case 'velocity.high':
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, velocity: { ...config.velocity, high: clamp(config.velocity.high + delta, 0, 127) } }) }
    case 'mod.low': {
      const newVal = Math.round(clamp(config.mod.low + delta * 0.05, 0, 1) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, mod: { ...config.mod, low: newVal } }) }
    }
    case 'mod.high': {
      const newVal = Math.round(clamp(config.mod.high + delta * 0.05, 0, 1) * 100) / 100
      return { ui, engine: updateRandomConfig(engine, trackIdx, { ...config, mod: { ...config.mod, high: newVal } }) }
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
  const defaultConfig = getDefaultRandomConfig()
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

function getDefaultRandomConfig(): RandomConfig {
  return {
    pitch: { low: 48, high: 72, scale: SCALES.minorPentatonic, root: 60, maxNotes: 4 },
    gate: { fillMin: 0.25, fillMax: 0.75, mode: 'euclidean', randomOffset: true, smartBars: 1, smartDensity: 'build' },
    velocity: { low: 64, high: 120 },
    gateLength: { min: 0.5, max: 0.5 },
    ratchet: { maxRatchet: 1, probability: 0 },
    slide: { probability: 0 },
    mod: { low: 0, high: 1 },
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
    case 'gate.smartBars': return updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, smartBars: dc.gate.smartBars } })
    case 'gate.smartDensity': return updateRandomConfig(engine, trackIdx, { ...config, gate: { ...config.gate, smartDensity: dc.gate.smartDensity } })
    case 'gateLength.min': return updateRandomConfig(engine, trackIdx, { ...config, gateLength: { ...config.gateLength, min: dc.gateLength.min } })
    case 'gateLength.max': return updateRandomConfig(engine, trackIdx, { ...config, gateLength: { ...config.gateLength, max: dc.gateLength.max } })
    case 'ratchet.maxRatchet': return updateRandomConfig(engine, trackIdx, { ...config, ratchet: { ...config.ratchet, maxRatchet: dc.ratchet.maxRatchet } })
    case 'ratchet.probability': return updateRandomConfig(engine, trackIdx, { ...config, ratchet: { ...config.ratchet, probability: dc.ratchet.probability } })
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
  // Page 0 = routing, Page 1 = MIDI
  if (ui.routePage === 1) return dispatchMIDIPage(ui, engine, event)

  switch (event.type) {
    case 'encoder-a-turn': {
      const newParam = clamp(ui.routeParam + event.delta, 0, 3)
      return { ui: { ...ui, routeParam: newParam }, engine }
    }
    case 'encoder-a-push':
      return { ui: { ...ui, routePage: 1, routeParam: 0 }, engine }
    case 'encoder-b-turn': {
      const param = ROUTE_PARAMS[ui.routeParam]
      const outputIdx = ui.selectedTrack
      const current = engine.routing[outputIdx][param]
      const next = ((current + event.delta) % 4 + 4) % 4
      return {
        ui,
        engine: setOutputSource(engine, outputIdx, param, next),
      }
    }
    case 'encoder-b-push':
      return { ui, engine }  // no-op (context-sensitive TBD)
    default:
      return { ui, engine }
  }
}

// MIDI page params: 0=MIDI ON/OFF, 1=CHANNEL
const MIDI_PARAM_COUNT = 2

function dispatchMIDIPage(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  const outputIdx = ui.selectedTrack
  const config = engine.midiConfigs[outputIdx]

  switch (event.type) {
    case 'encoder-a-turn': {
      const newParam = clamp(ui.routeParam + event.delta, 0, MIDI_PARAM_COUNT - 1)
      return { ui: { ...ui, routeParam: newParam }, engine }
    }
    case 'encoder-a-push':
      return { ui: { ...ui, routePage: 0, routeParam: 0 }, engine }
    case 'encoder-b-turn': {
      if (ui.routeParam === 0) {
        // Toggle MIDI enabled
        return { ui, engine: updateMIDIConfig(engine, outputIdx, { enabled: !config.enabled }) }
      } else {
        // Adjust channel 1-16
        const next = clamp(config.channel + event.delta, 1, 16)
        return { ui, engine: updateMIDIConfig(engine, outputIdx, { channel: next }) }
      }
    }
    case 'encoder-b-push':
      return { ui, engine }  // no-op (context-sensitive TBD)
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
          leds[i] = track.gate.steps[stepIdx].on ? 'on' : 'dim'
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
    default: {
      // Home and stub modes: show gate pattern overview
      for (let i = 0; i < 16; i++) {
        if (i >= track.gate.length) {
          leds[i] = 'off'
        } else if (i === track.gate.currentStep) {
          leds[i] = 'flash'
        } else {
          leds[i] = track.gate.steps[i].on ? 'on' : 'off'
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
