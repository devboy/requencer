/**
 * Mode state machine — pure function mapping (UIState, EngineState, ControlEvent) → new states.
 *
 * Modes: home, gate-edit, pitch-edit, vel-edit, mute-edit, route, rand, div
 *
 * Cross-modal behaviors:
 *   - Track select (T1-T4) works in ANY mode — switches displayed track
 *   - Subtrack buttons always enter/switch to their edit screen
 *   - Feature buttons always enter/switch to their screen
 *   - RESET resets all playheads globally
 *
 * No DOM, no canvas, no side effects.
 */

import type { SequencerState, RandomConfig } from '../engine/types'
import { randomizeTrackPattern, randomizeGatePattern, randomizePitchPattern, randomizeVelocityPattern, setSubtrackLength, setSubtrackClockDivider, setTrackClockDivider, setMuteLength, setMuteClockDivider, resetTrackPlayheads, resetSubtrackPlayhead, saveUserPreset, setOutputSource } from '../engine/sequencer'
import type { ScreenMode, ControlEvent, UIState, LEDState, HeldButtonTarget } from './hw-types'
import { PRESETS } from '../engine/presets'
import { SCALES } from '../engine/scales'

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
    routeParam: 0,
  }
}

export function dispatch(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  // --- Hold events ---

  if (event.type === 'hold-start') {
    return { ui: { ...ui, heldButton: event.button, holdEncoderUsed: false }, engine }
  }

  if (event.type === 'hold-end') {
    return { ui: { ...ui, heldButton: null, holdEncoderUsed: false }, engine }
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
    }
    const newMode = modeMap[event.subtrack]
    if (newMode) {
      return { ui: { ...ui, mode: newMode, selectedStep: 0, currentPage: 0 }, engine }
    }
    // MOD is a placeholder — no-op for now
    return { ui, engine }
  }

  // Feature buttons — enter feature screen
  if (event.type === 'feature-press') {
    const modeMap: Record<string, ScreenMode> = {
      mute: 'mute-edit',
      route: 'route',
      rand: 'rand',
      div: 'div',
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
    case 'div':
      return dispatchStub(ui, engine, event)
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
// Step buttons: toggle gate on/off
// Enc B: page navigation

function dispatchGateEdit(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  const track = engine.tracks[ui.selectedTrack]
  const maxPage = Math.max(0, Math.ceil(track.gate.length / 16) - 1)

  switch (event.type) {
    case 'step-press': {
      const stepIdx = ui.currentPage * 16 + event.step
      if (stepIdx >= track.gate.length) return { ui, engine }
      const newSteps = [...track.gate.steps]
      newSteps[stepIdx] = !newSteps[stepIdx]
      return {
        ui,
        engine: updateSubtrackSteps(engine, ui.selectedTrack, 'gate', newSteps),
      }
    }
    case 'encoder-b-turn': {
      const newPage = clamp(ui.currentPage + event.delta, 0, maxPage)
      return { ui: { ...ui, currentPage: newPage }, engine }
    }
    case 'encoder-b-push': {
      return { ui: { ...ui, mode: 'home', currentPage: 0 }, engine }
    }
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
      const newSteps = [...track.pitch.steps]
      newSteps[stepIdx] = clamp(newSteps[stepIdx] + event.delta, 0, 127)
      return {
        ui,
        engine: updateSubtrackSteps(engine, ui.selectedTrack, 'pitch', newSteps),
      }
    }
    case 'encoder-b-turn': {
      const newPage = clamp(ui.currentPage + event.delta, 0, maxPage)
      return { ui: { ...ui, currentPage: newPage }, engine }
    }
    case 'encoder-b-push': {
      return { ui: { ...ui, mode: 'home', currentPage: 0 }, engine }
    }
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
    case 'encoder-b-push': {
      return { ui: { ...ui, mode: 'home', currentPage: 0 }, engine }
    }
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
    case 'encoder-b-push': {
      return { ui: { ...ui, mode: 'home', currentPage: 0 }, engine }
    }
    default:
      return { ui, engine }
  }
}

// --- RAND Screen ---
// Enc A: scroll parameter list (0-12)
// Enc B: adjust selected parameter value
// Enc A push: apply preset (row 0) or enter name-entry (row 12)
// Enc B push: return home

const RAND_PARAM_COUNT = 13
const NAME_MAX_LEN = 12
const SCALE_LIST = Object.values(SCALES)

function dispatchRand(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  switch (event.type) {
    case 'encoder-a-turn': {
      const next = clamp(ui.randParam + event.delta, 0, RAND_PARAM_COUNT - 1)
      return { ui: { ...ui, randParam: next }, engine }
    }
    case 'encoder-a-push': {
      // Apply preset when on preset row (param 0)
      if (ui.randParam === 0) {
        const allPresets = getAllPresets(engine)
        const preset = allPresets[ui.randPresetIndex]
        if (preset) {
          return {
            ui,
            engine: updateRandomConfig(engine, ui.selectedTrack, preset.config),
          }
        }
      }
      // Enter name-entry mode when on SAVE row (param 12)
      if (ui.randParam === 12) {
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
    case 'encoder-b-turn': {
      return dispatchRandParamAdjust(ui, engine, event.delta)
    }
    case 'encoder-b-push': {
      return { ui: { ...ui, mode: 'home', currentPage: 0 }, engine }
    }
    default:
      return { ui, engine }
  }
}

function dispatchRandParamAdjust(ui: UIState, engine: SequencerState, delta: number): DispatchResult {
  const trackIdx = ui.selectedTrack
  const config = engine.randomConfigs[trackIdx]

  switch (ui.randParam) {
    case 0: {
      // Preset row: cycle through factory + user presets
      const total = getAllPresets(engine).length
      const next = clamp(ui.randPresetIndex + delta, 0, total - 1)
      return { ui: { ...ui, randPresetIndex: next }, engine }
    }
    case 1: {
      // Scale: cycle through scale list
      const curIdx = SCALE_LIST.findIndex(s => s.name === config.pitch.scale.name)
      const nextIdx = clamp(curIdx + delta, 0, SCALE_LIST.length - 1)
      return {
        ui,
        engine: updateRandomConfig(engine, trackIdx, {
          ...config,
          pitch: { ...config.pitch, scale: SCALE_LIST[nextIdx] },
        }),
      }
    }
    case 2: {
      // Root note
      return {
        ui,
        engine: updateRandomConfig(engine, trackIdx, {
          ...config,
          pitch: { ...config.pitch, root: clamp(config.pitch.root + delta, 0, 127) },
        }),
      }
    }
    case 3: {
      // Pitch low
      return {
        ui,
        engine: updateRandomConfig(engine, trackIdx, {
          ...config,
          pitch: { ...config.pitch, low: clamp(config.pitch.low + delta, 0, 127) },
        }),
      }
    }
    case 4: {
      // Pitch high
      return {
        ui,
        engine: updateRandomConfig(engine, trackIdx, {
          ...config,
          pitch: { ...config.pitch, high: clamp(config.pitch.high + delta, 0, 127) },
        }),
      }
    }
    case 5: {
      // Max distinct notes (0 = unlimited, 1-12)
      const newMax = clamp(config.pitch.maxNotes + delta, 0, 12)
      return {
        ui,
        engine: updateRandomConfig(engine, trackIdx, {
          ...config,
          pitch: { ...config.pitch, maxNotes: newMax },
        }),
      }
    }
    case 6: {
      // Fill min (step 0.05)
      const newVal = Math.round(clamp(config.gate.fillMin + delta * 0.05, 0, 1) * 100) / 100
      return {
        ui,
        engine: updateRandomConfig(engine, trackIdx, {
          ...config,
          gate: { ...config.gate, fillMin: newVal },
        }),
      }
    }
    case 7: {
      // Fill max (step 0.05)
      const newVal = Math.round(clamp(config.gate.fillMax + delta * 0.05, 0, 1) * 100) / 100
      return {
        ui,
        engine: updateRandomConfig(engine, trackIdx, {
          ...config,
          gate: { ...config.gate, fillMax: newVal },
        }),
      }
    }
    case 8: {
      // Gate mode toggle
      const newMode = config.gate.mode === 'random' ? 'euclidean' : 'random'
      return {
        ui,
        engine: updateRandomConfig(engine, trackIdx, {
          ...config,
          gate: { ...config.gate, mode: newMode },
        }),
      }
    }
    case 9: {
      // Euclidean random offset toggle
      return {
        ui,
        engine: updateRandomConfig(engine, trackIdx, {
          ...config,
          gate: { ...config.gate, randomOffset: !config.gate.randomOffset },
        }),
      }
    }
    case 10: {
      // Velocity low
      return {
        ui,
        engine: updateRandomConfig(engine, trackIdx, {
          ...config,
          velocity: { ...config.velocity, low: clamp(config.velocity.low + delta, 0, 127) },
        }),
      }
    }
    case 11: {
      // Velocity high
      return {
        ui,
        engine: updateRandomConfig(engine, trackIdx, {
          ...config,
          velocity: { ...config.velocity, high: clamp(config.velocity.high + delta, 0, 127) },
        }),
      }
    }
    default:
      return { ui, engine }
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
      return {
        ui,
        engine: setOutputSource(engine, outputIdx, param, next),
      }
    }
    case 'encoder-b-push':
      return { ui: { ...ui, mode: 'home' }, engine }
    default:
      return { ui, engine }
  }
}

// --- Stub dispatcher for modes not yet implemented ---
function dispatchStub(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  if (event.type === 'encoder-b-push') {
    return { ui: { ...ui, mode: 'home', currentPage: 0 }, engine }
  }
  return { ui, engine }
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
          leds[i] = track.gate.steps[stepIdx] ? 'on' : 'dim'
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
          leds[i] = track.gate.steps[i] ? 'on' : 'off'
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
// Hold mute + enc A = mute length
// Hold mute + enc B = mute clock divider

function dispatchHoldCombo(
  ui: UIState,
  engine: SequencerState,
  event: { type: 'encoder-a-turn'; delta: number } | { type: 'encoder-b-turn'; delta: number },
): DispatchResult {
  const held = ui.heldButton!
  const trackIdx = ui.selectedTrack
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
    case 'encoder-b-push': {
      // Cancel — return to rand without saving
      return { ui: { ...ui, mode: 'rand' }, engine }
    }
    default:
      return { ui, engine }
  }
}

// --- Preset Helpers ---

/** Factory + user presets combined */
export function getAllPresets(engine: SequencerState): Array<{ name: string; config: RandomConfig }> {
  return [...PRESETS, ...engine.userPresets]
}

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
  sub: 'gate' | 'pitch' | 'velocity',
  steps: boolean[] | number[],
): SequencerState {
  return {
    ...engine,
    tracks: engine.tracks.map((t, i) => {
      if (i !== trackIdx) return t
      return { ...t, [sub]: { ...t[sub], steps } }
    }),
  }
}
