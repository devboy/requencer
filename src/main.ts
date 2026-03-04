/**
 * Main entry point — wires engine, I/O, mode machine, LCD renderers, and panel controls.
 */

import * as Tone from 'tone'
import { TICKS_PER_STEP } from './engine/clock-divider'
import { createSequencer, tick } from './engine/sequencer'
import type { ClockSource, NoteEvent, SequencerState } from './engine/types'
import { DrumMachine } from './io/drum-machine'
import { MIDIClockIn } from './io/midi-clock-in'
import { MIDIClockOut } from './io/midi-clock-out'
import { MIDIOutput } from './io/midi-output'
import { loadPatterns, loadPresets, savePatterns, savePresets } from './io/persistence'
import { ToneClock } from './io/tone-clock'
import { ToneOutput } from './io/tone-output'
import { COLORS } from './ui/colors'
import { createDebugMenu } from './ui/debug-menu'
import type { ControlEvent, ScreenMode, UIState } from './ui/hw-types'
import { emit, onControlEvent, setupKeyboardInput } from './ui/input'
import { renderClrConfirmOverlay } from './ui/lcd/clr-confirm-overlay'
import { renderFlashOverlay } from './ui/lcd/flash-overlay'
import { renderGateEdit } from './ui/lcd/gate-edit'
import { renderHoldOverlay } from './ui/lcd/hold-overlay'

// LCD screen renderers
import { renderHome } from './ui/lcd/home'
import { renderModEdit } from './ui/lcd/mod-edit'
import { renderMutateEdit } from './ui/lcd/mutate-screen'
import { renderMuteEdit } from './ui/lcd/mute-edit'
import { renderNameEntry } from './ui/lcd/name-entry'
import { renderPatternLoad } from './ui/lcd/pattern-load-screen'
import { renderPattern } from './ui/lcd/pattern-screen'
import { renderPitchEdit } from './ui/lcd/pitch-edit'
import { renderRand } from './ui/lcd/rand-screen'
import { renderRoute } from './ui/lcd/route-screen'
import { renderSettings } from './ui/lcd/settings-screen'
import { renderTransposeEdit } from './ui/lcd/transpose-screen'
import { renderVariationEdit } from './ui/lcd/variation-screen'
import { renderVelEdit } from './ui/lcd/vel-edit'
// UI imports
import { createInitialUIState, dispatch, getLEDState } from './ui/mode-machine'
import { createControls, updateLEDs, updateModeIndicators } from './ui/panel/controls'
import { createFaceplate, injectPanelStyles, setupMobileViewport } from './ui/panel/faceplate'
import { drawStatusBar, LCD_H, LCD_W, setupLCDCanvas } from './ui/renderer'

console.log('requencer starting')

// --- Engine State (empty tracks — no initial randomization) ---
let engineState: SequencerState = createSequencer()

// --- Load persisted data ---
engineState = { ...engineState, savedPatterns: loadPatterns(), userPresets: loadPresets() }

// --- UI State ---
let uiState: UIState = createInitialUIState()

// --- Audio I/O ---
const output = new ToneOutput()
const drums = new DrumMachine()
const midi = new MIDIOutput()
const midiClockOut = new MIDIClockOut()
const midiDeviceIds: string[] = ['', '', '', ''] // per-output device selection

/** Shared tick handler — called by both ToneClock and MIDIClockIn */
function handleEngineTick(time: number, stepDuration: number) {
  const mt = engineState.transport.masterTick // capture BEFORE tick advances it
  const result = tick(engineState)
  engineState = result.state

  // Filter to only non-null events (outputs at step boundaries)
  const events = result.events.filter((e): e is NoteEvent => e !== null)
  if (events.length > 0) {
    output.handleEvents(events, time, stepDuration)
    midi.handleEvents(events, engineState.midiConfigs, midiDeviceIds, stepDuration, engineState.midiEnabled)
  }

  // Drums: only trigger at base step boundaries
  if (mt === 0 || mt % TICKS_PER_STEP === 0) {
    const step = mt / TICKS_PER_STEP
    drums.triggerStep(step, time)
  }

  // Send MIDI clock out if enabled
  midiClockOut.tick(engineState.transport.playing, engineState.midiClockOut)
}

const clock = new ToneClock({
  onTick(time: number, stepDuration: number, _tickDuration: number) {
    handleEngineTick(time, stepDuration)
  },
})
clock.bpm = engineState.transport.bpm

// --- MIDI Clock Input ---
const midiClockIn = new MIDIClockIn({
  onTick(stepDuration: number, _tickDuration: number) {
    if (engineState.transport.clockSource !== 'midi') return
    if (!engineState.transport.playing) return
    // Use current audio context time for synth scheduling
    const time = Tone.getContext().currentTime
    handleEngineTick(time, stepDuration)
  },
  onStart() {
    if (engineState.transport.clockSource !== 'midi') return
    engineState = {
      ...engineState,
      transport: { ...engineState.transport, playing: true, masterTick: 0 },
    }
  },
  onStop() {
    if (engineState.transport.clockSource !== 'midi') return
    output.releaseAll()
    midi.panic()
    midiClockOut.sendStop()
    engineState = {
      ...engineState,
      transport: { ...engineState.transport, playing: false },
    }
  },
  onBpmChange(bpm: number) {
    if (engineState.transport.clockSource !== 'midi') return
    engineState = {
      ...engineState,
      transport: { ...engineState.transport, bpm },
    }
  },
})

/** Track current clock source and MIDI input device to detect changes */
let activeClockSource: ClockSource = engineState.transport.clockSource
let prevMidiInputDeviceIndex = 0

// --- Panel Setup ---
injectPanelStyles()
const panel = createFaceplate()
const lcdCtx = setupLCDCanvas(panel.lcdCanvas)

createControls(panel)
setupMobileViewport()

// --- Keyboard Input ---
setupKeyboardInput()

// --- Debug Menu (always visible) ---
createDebugMenu({
  getBpm: () => engineState.transport.bpm,
  setBpm(bpm: number) {
    engineState = { ...engineState, transport: { ...engineState.transport, bpm } }
    clock.bpm = bpm
  },
  togglePlay() {
    emit({ type: 'play-stop' })
  },
  clearTrack() {
    const i = uiState.selectedTrack
    const t = engineState.tracks[i]
    const len = t.gate.steps.length
    engineState = {
      ...engineState,
      tracks: engineState.tracks.map((trk, idx) =>
        idx !== i
          ? trk
          : {
              ...trk,
              gate: {
                ...trk.gate,
                steps: Array.from({ length: len }, () => ({ on: false, tie: false, length: 0.5, ratchet: 1 })),
              },
              velocity: { ...trk.velocity, steps: Array(len).fill(0) },
            },
      ),
    }
  },
  drums,
})

function refreshMIDIDevices() {
  const devices = midi.getDevices()
  const inputDevices = midiClockIn.getInputDevices()
  uiState = { ...uiState, midiDevices: devices, midiInputDevices: inputDevices }
  // Auto-assign first device to any output that doesn't have one
  if (devices.length > 0) {
    for (let i = 0; i < 4; i++) {
      if (!midiDeviceIds[i]) midiDeviceIds[i] = devices[0].id
    }
  }
}

/** Share MIDIAccess with clock modules after init */
function shareMIDIAccess() {
  const access = midi.getAccess()
  if (access) {
    midiClockOut.setAccess(access)
    midiClockIn.setAccess(access)
  }
}

/** Handle clock source changes — start/stop MIDI clock input listening */
function syncClockSource() {
  const source = engineState.transport.clockSource
  if (source === activeClockSource) return
  const prevSource = activeClockSource
  activeClockSource = source

  if (source === 'midi') {
    // Switching TO MIDI clock: stop internal clock, start listening
    if (clock.playing) clock.stop()
    const inputDevice = uiState.midiInputDevices[uiState.midiInputDeviceIndex]
    if (inputDevice) {
      midiClockIn.startListening(inputDevice.id)
    }
  } else if (prevSource === 'midi') {
    // Switching FROM MIDI clock: stop listening
    midiClockIn.stopListening()
  }
}

// --- Control Event Handler ---
let _playStopInProgress = false // re-entrancy guard for async play-stop

onControlEvent(async (event: ControlEvent) => {
  // Handle play-stop specially — needs async Tone.start()
  if (event.type === 'play-stop') {
    if (_playStopInProgress) return
    _playStopInProgress = true
    try {
      const isPlaying = clock.playing || engineState.transport.playing
      if (isPlaying) {
        if (clock.playing) clock.stop()
        midiClockIn.stopListening()
        output.releaseAll()
        midi.panic()
        midiClockOut.sendStop()
        engineState = {
          ...engineState,
          transport: { ...engineState.transport, playing: false },
        }
      } else {
        // Always start Tone.js audio context (needed for synths even in MIDI clock mode)
        await Tone.start()
        // Init MIDI on first play (user gesture requirement)
        await midi.init()
        shareMIDIAccess()
        refreshMIDIDevices()

        if (engineState.transport.clockSource === 'midi') {
          // MIDI clock mode: don't start ToneClock, just wait for incoming clock
          const inputDevice = uiState.midiInputDevices[uiState.midiInputDeviceIndex]
          if (inputDevice) {
            midiClockIn.startListening(inputDevice.id)
          }
          engineState = {
            ...engineState,
            transport: { ...engineState.transport, playing: true, masterTick: 0 },
          }
        } else {
          // Internal clock: use ToneClock as before
          await clock.start()
          engineState = {
            ...engineState,
            transport: { ...engineState.transport, playing: true },
          }
        }
      }
    } finally {
      _playStopInProgress = false
    }
    return
  }

  // All other events go through the mode machine
  const prevPatterns = engineState.savedPatterns
  const prevPresets = engineState.userPresets
  const result = dispatch(uiState, engineState, event)
  uiState = result.ui
  engineState = result.engine

  // Persist if changed
  if (engineState.savedPatterns !== prevPatterns) savePatterns(engineState.savedPatterns)
  if (engineState.userPresets !== prevPresets) savePresets(engineState.userPresets)

  // Sync BPM if it changed (only for internal clock)
  if (engineState.transport.clockSource === 'internal' && clock.bpm !== engineState.transport.bpm) {
    clock.bpm = engineState.transport.bpm
  }

  // Handle clock source changes
  syncClockSource()

  // Handle MIDI input device changes — re-listen on new device only if index changed
  if (engineState.transport.clockSource === 'midi' && midiClockIn.isListening) {
    if (uiState.midiInputDeviceIndex !== prevMidiInputDeviceIndex) {
      prevMidiInputDeviceIndex = uiState.midiInputDeviceIndex
      const inputDevice = uiState.midiInputDevices[uiState.midiInputDeviceIndex]
      if (inputDevice) {
        midiClockIn.startListening(inputDevice.id)
      }
    }
  }
})

// --- Screen Renderers ---
const RENDERERS: Record<ScreenMode, (ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState) => void> = {
  home: renderHome,
  'gate-edit': renderGateEdit,
  'pitch-edit': renderPitchEdit,
  'vel-edit': renderVelEdit,
  'mute-edit': renderMuteEdit,
  route: renderRoute,
  rand: renderRand,
  'name-entry': renderNameEntry,
  'mutate-edit': renderMutateEdit,
  'transpose-edit': renderTransposeEdit,
  'variation-edit': renderVariationEdit,
  'mod-edit': renderModEdit,
  settings: renderSettings,
  pattern: renderPattern,
  'pattern-load': renderPatternLoad,
}

// Status bar text per mode
const MODE_STATUS: Record<ScreenMode, (ui: UIState) => string> = {
  home: () => 'REQUENCER',
  'gate-edit': (ui) => `T${ui.selectedTrack + 1} GATE`,
  'pitch-edit': (ui) => `T${ui.selectedTrack + 1} PITCH`,
  'vel-edit': (ui) => `T${ui.selectedTrack + 1} VELOCITY`,
  'mute-edit': (ui) => `T${ui.selectedTrack + 1} MUTE`,
  route: (ui) => `ROUTE — O${ui.selectedTrack + 1}`,
  rand: (ui) => `T${ui.selectedTrack + 1} RANDOMIZER`,
  'name-entry': (ui) => (ui.nameEntryContext === 'preset' ? 'SAVE PRESET' : `SAVE T${ui.selectedTrack + 1} PATTERN`),
  'mutate-edit': (ui) => `DRIFT — T${ui.selectedTrack + 1}`,
  'transpose-edit': (ui) => `TRANSPOSE — T${ui.selectedTrack + 1}`,
  'variation-edit': (ui) => `VAR — T${ui.selectedTrack + 1}`,
  'mod-edit': (ui) => `T${ui.selectedTrack + 1} ${ui.modLfoView ? 'LFO' : 'MOD'}`,
  settings: () => 'SETTINGS',
  pattern: () => 'PATTERN',
  'pattern-load': () => 'LOAD PATTERN',
}

// --- Shortcut Hints (below module) ---
const SHORTCUT_HINTS: Record<ScreenMode, string> = {
  home: '1-4: track   Q/W/E/R: edit   A-G: features   Hold+↑↓: len   Hold+←→: div   Space: play',
  'gate-edit': 'Z-M: toggle steps   Shift+Z-M: 9-16   ←→: page   Hold Q+↑↓: len/div   Esc: back',
  'pitch-edit': 'Z-M: select   ↑↓: pitch   ←→: slide   Enter: page   Esc: back',
  'vel-edit': 'Z-M: select   ↑↓: velocity   ←→: page   Hold E+↑↓: len/div   Esc: back',
  'mute-edit': 'Z-M: toggle mutes   ←→: page   Hold A+↑↓: len/div   Esc: back',
  route: '1-4: output  \u2191\u2193: param  \u2190\u2192: source  Esc: back',
  rand: '↑↓: scroll params   ←→: adjust value   Enter: apply preset   Hold+D: randomize   Esc: back',
  'name-entry': '↑↓: change letter   ←→: move cursor   Enter: save   Esc: cancel',
  'mutate-edit': '1-4: track   ↑↓: scroll   ←→: rate   Enter: all off   Esc: back',
  'transpose-edit': '1-4: track   ↑↓: scroll   ←→: adjust   Hold ↑: reset   Esc: back',
  'mod-edit': 'Z-M: select   ↑↓: value   ←→: page/scroll   Enter: MOD/LFO   Esc: back',
  'variation-edit': 'Z-M: bar   ↑↓: browse   ←→: param   Enter: add/on   Hold ↑: remove   Hold H+↑: phrase   Esc: back',
  settings: '↑↓: scroll   ←→: adjust   Esc: back',
  pattern: '↑↓: scroll   ←→: browse   Enter: act   J: pattern   Esc: back',
  'pattern-load': 'Q/W/E/R: toggle layers   A/F/G: drift/trns/var   1-4: dest   Enter: apply   Esc: back',
}

// --- Hold-state hints (shown when a button is held, overriding mode hints) ---
const HOLD_HINTS: Record<string, string> = {
  track: '↑↓: all lengths   ←→: track divider   RST: reset   D: randomize',
  'subtrack:gate': '↑↓: gate length   ←→: gate divider   RST: reset   D: randomize',
  'subtrack:pitch': '↑↓: pitch length   ←→: pitch divider   RST: reset   D: randomize',
  'subtrack:velocity': '↑↓: vel length   ←→: vel divider   RST: reset   D: randomize',
  'subtrack:mod': '↑↓: mod length   ←→: mod divider   RST: reset   D: randomize',
  'feature:mute': '↑↓: mute length   ←→: mute divider',
  'feature:variation': '↑↓: phrase length   ←→: loop mode',
  'step:gate-edit': '↑↓: gate length   ←→: ratchet   Z-M: tie range',
}

function getActiveHint(ui: UIState): string {
  const held = ui.heldButton
  if (held) {
    let key: string | null = null
    if (held.kind === 'track') key = 'track'
    else if (held.kind === 'subtrack') key = `subtrack:${held.subtrack}`
    else if (held.kind === 'feature') key = `feature:${held.feature}`
    else if (held.kind === 'step' && ui.mode === 'gate-edit') key = 'step:gate-edit'
    if (key && HOLD_HINTS[key]) return HOLD_HINTS[key]
  }
  return SHORTCUT_HINTS[ui.mode]
}

const hintEl = document.createElement('div')
hintEl.id = 'shortcut-hints'
hintEl.style.cssText = `
  text-align: center; padding: 6px 12px; margin-top: 4px;
  font: 11px 'JetBrains Mono', monospace; color: #555; letter-spacing: 0.5px;
`
// Insert between rack-row and ruler (outside rack-row so it doesn't stretch neighbors)
const ruler = panel.root.querySelector('.ruler')
panel.root.insertBefore(hintEl, ruler)

// --- Render Loop ---
function render(): void {
  // Sync transport state from clock — only in internal mode.
  // In MIDI clock mode, transport is controlled by incoming MIDI messages, not ToneClock.
  if (engineState.transport.clockSource === 'internal') {
    const clockPlaying = clock.playing
    if (engineState.transport.playing !== clockPlaying) {
      engineState = {
        ...engineState,
        transport: { ...engineState.transport, playing: clockPlaying },
      }
    }
  }
  const isPlaying = engineState.transport.playing

  // Clear LCD
  lcdCtx.fillStyle = COLORS.lcdBg
  lcdCtx.fillRect(0, 0, LCD_W, LCD_H)

  // Status bar
  const statusText = MODE_STATUS[uiState.mode](uiState)
  drawStatusBar(lcdCtx, statusText, engineState.transport.bpm, isPlaying)

  // Mode-specific content
  const renderer = RENDERERS[uiState.mode]
  if (renderer) renderer(lcdCtx, engineState, uiState)

  // Hold overlay — always thin (42px strip) for compact display
  // Step holds stay in the normal screen (gate-edit shows GL/ratchet inline)
  if (uiState.heldButton && uiState.heldButton.kind !== 'step') {
    renderHoldOverlay(lcdCtx, engineState, uiState, true)
  }

  // CLR confirm overlay + auto-expire
  if (uiState.clrPending) {
    const now = Date.now()
    if (now - uiState.clrPendingAt >= 2000) {
      uiState = { ...uiState, clrPending: false, clrPendingAt: 0 }
    } else {
      renderClrConfirmOverlay(lcdCtx, uiState)
    }
  }
  panel.clrBtn.classList.toggle('clr-pending', uiState.clrPending)

  // Flash message overlay (SAVED, LOADED, DELETED)
  if (uiState.flashMessage && performance.now() < uiState.flashUntil) {
    renderFlashOverlay(lcdCtx, uiState.flashMessage)
  } else if (uiState.flashMessage) {
    uiState = { ...uiState, flashMessage: '', flashUntil: 0 }
  }

  // Update panel LEDs
  const ledState = getLEDState(uiState, engineState)
  updateLEDs(ledState)

  // Update mode indicators on subtrack/feature buttons
  updateModeIndicators(panel.subtrackBtns, panel.featureBtns, panel.randBtn, panel.patBtn, uiState)

  // Update shortcut hints (hold-state aware)
  hintEl.textContent = getActiveHint(uiState)

  requestAnimationFrame(render)
}

requestAnimationFrame(render)
