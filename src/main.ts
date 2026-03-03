/**
 * Main entry point — wires engine, I/O, mode machine, LCD renderers, and panel controls.
 */

import { createSequencer, tick } from './engine/sequencer'
import type { SequencerState } from './engine/types'
import { DrumMachine } from './io/drum-machine'
import { MIDIOutput } from './io/midi-output'
import { ToneClock } from './io/tone-clock'
import { ToneOutput } from './io/tone-output'
import { COLORS } from './ui/colors'
import { createDebugMenu } from './ui/debug-menu'
import type { ControlEvent, ScreenMode, UIState } from './ui/hw-types'
import { emit, onControlEvent, setupKeyboardInput } from './ui/input'
import { renderGateEdit } from './ui/lcd/gate-edit'
import { renderHoldOverlay } from './ui/lcd/hold-overlay'

// LCD screen renderers
import { renderHome } from './ui/lcd/home'
import { renderModEdit } from './ui/lcd/mod-edit'
import { renderMutateEdit } from './ui/lcd/mutate-screen'
import { renderMuteEdit } from './ui/lcd/mute-edit'
import { renderNameEntry } from './ui/lcd/name-entry'
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

// --- UI State ---
let uiState: UIState = createInitialUIState()

// --- Audio I/O ---
const output = new ToneOutput()
const drums = new DrumMachine()
const midi = new MIDIOutput()
const midiDeviceIds: string[] = ['', '', '', ''] // per-output device selection

const clock = new ToneClock({
  onTick(time: number, stepDuration: number) {
    const step = engineState.transport.masterTick // capture BEFORE tick advances it
    const result = tick(engineState)
    engineState = result.state
    output.handleEvents(result.events, time, stepDuration)
    midi.handleEvents(result.events, engineState.midiConfigs, midiDeviceIds, stepDuration, engineState.midiEnabled)
    drums.triggerStep(step, time)
  },
})
clock.bpm = engineState.transport.bpm

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
  uiState = { ...uiState, midiDevices: devices }
  // Auto-assign first device to any output that doesn't have one
  if (devices.length > 0) {
    for (let i = 0; i < 4; i++) {
      if (!midiDeviceIds[i]) midiDeviceIds[i] = devices[0].id
    }
  }
}

// --- Control Event Handler ---
onControlEvent(async (event: ControlEvent) => {
  // Handle play-stop specially — needs async Tone.start()
  if (event.type === 'play-stop') {
    if (clock.playing) {
      clock.stop()
      output.releaseAll()
      midi.panic()
      engineState = {
        ...engineState,
        transport: { ...engineState.transport, playing: false },
      }
    } else {
      await clock.start()
      // Init MIDI on first play (user gesture requirement)
      await midi.init()
      refreshMIDIDevices()
      engineState = {
        ...engineState,
        transport: { ...engineState.transport, playing: true },
      }
    }
    return
  }

  // All other events go through the mode machine
  const result = dispatch(uiState, engineState, event)
  uiState = result.ui
  engineState = result.engine

  // Sync BPM if it changed
  if (clock.bpm !== engineState.transport.bpm) {
    clock.bpm = engineState.transport.bpm
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
  'name-entry': () => 'SAVE PRESET',
  'mutate-edit': (ui) => `DRIFT — T${ui.selectedTrack + 1}`,
  'transpose-edit': (ui) => `TRANSPOSE — T${ui.selectedTrack + 1}`,
  'variation-edit': (ui) => `VAR — T${ui.selectedTrack + 1}`,
  'mod-edit': (ui) => `T${ui.selectedTrack + 1} ${ui.modLfoView ? 'LFO' : 'MOD'}`,
  settings: () => 'SETTINGS',
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
  // Sync transport state from clock (authoritative source)
  const isPlaying = clock.playing
  if (engineState.transport.playing !== isPlaying) {
    engineState = {
      ...engineState,
      transport: { ...engineState.transport, playing: isPlaying },
    }
  }

  // Clear LCD
  lcdCtx.fillStyle = COLORS.lcdBg
  lcdCtx.fillRect(0, 0, LCD_W, LCD_H)

  // Status bar
  const statusText = MODE_STATUS[uiState.mode](uiState)
  drawStatusBar(lcdCtx, statusText, engineState.transport.bpm, isPlaying)

  // Mode-specific content
  const renderer = RENDERERS[uiState.mode]
  if (renderer) renderer(lcdCtx, engineState, uiState)

  // Hold overlay (semi-transparent over content when a button is held)
  // Step holds stay in the normal screen (gate-edit shows GL/ratchet inline)
  if (uiState.heldButton && uiState.heldButton.kind !== 'step') {
    const editScreens: Set<string> = new Set(['gate-edit', 'pitch-edit', 'vel-edit', 'mod-edit'])
    const thin = editScreens.has(uiState.mode)
    renderHoldOverlay(lcdCtx, engineState, uiState, thin)
  }

  // Update panel LEDs
  const ledState = getLEDState(uiState, engineState)
  updateLEDs(ledState)

  // Update mode indicators on subtrack/feature buttons
  updateModeIndicators(panel.subtrackBtns, panel.featureBtns, panel.randBtn, uiState.mode)

  // Update shortcut hints
  hintEl.textContent = SHORTCUT_HINTS[uiState.mode]

  requestAnimationFrame(render)
}

requestAnimationFrame(render)
