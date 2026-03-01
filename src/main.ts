/**
 * Main entry point — wires engine, I/O, mode machine, LCD renderers, and panel controls.
 */

import { createSequencer, tick } from './engine/sequencer'
import { ToneClock } from './io/tone-clock'
import { ToneOutput } from './io/tone-output'
import type { SequencerState } from './engine/types'

// UI imports
import { createInitialUIState, dispatch, getLEDState } from './ui/mode-machine'
import type { UIState, ControlEvent, ScreenMode } from './ui/hw-types'
import { COLORS } from './ui/colors'
import { setupLCDCanvas, drawStatusBar, LCD_W, LCD_H } from './ui/renderer'
import { onControlEvent, setupKeyboardInput, emit } from './ui/input'
import { createFaceplate, injectPanelStyles, setupMobileViewport } from './ui/panel/faceplate'
import { createControls, updateLEDs, updateModeIndicators } from './ui/panel/controls'

// LCD screen renderers
import { renderHome } from './ui/lcd/home'
import { renderGateEdit } from './ui/lcd/gate-edit'
import { renderPitchEdit } from './ui/lcd/pitch-edit'
import { renderVelEdit } from './ui/lcd/vel-edit'
import { renderMuteEdit } from './ui/lcd/mute-edit'
import { renderRoute } from './ui/lcd/route-screen'
import { renderRand } from './ui/lcd/rand-screen'
import { renderNameEntry } from './ui/lcd/name-entry'
import { renderHoldOverlay } from './ui/lcd/hold-overlay'
import { createDebugMenu } from './ui/debug-menu'
import { DrumMachine } from './io/drum-machine'

console.log('requencer starting')

// --- Engine State (empty tracks — no initial randomization) ---
let engineState: SequencerState = createSequencer()

// --- UI State ---
let uiState: UIState = createInitialUIState()

// --- Audio I/O ---
const output = new ToneOutput()
const drums = new DrumMachine()
const clock = new ToneClock({
  onTick(time: number) {
    const step = engineState.transport.masterTick  // capture BEFORE tick advances it
    const result = tick(engineState)
    engineState = result.state
    output.handleEvents(result.events, time)
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
  togglePlay() { emit({ type: 'play-stop' }) },
  clearTrack() {
    const i = uiState.selectedTrack
    const t = engineState.tracks[i]
    const len = t.gate.steps.length
    engineState = {
      ...engineState,
      tracks: engineState.tracks.map((trk, idx) => idx !== i ? trk : {
        ...trk,
        gate: { ...trk.gate, steps: Array(len).fill(false) },
        velocity: { ...trk.velocity, steps: Array(len).fill(0) },
      }),
    }
  },
  drums,
})

// --- Control Event Handler ---
onControlEvent(async (event: ControlEvent) => {
  // Handle play-stop specially — needs async Tone.start()
  if (event.type === 'play-stop') {
    if (clock.playing) {
      clock.stop()
      output.releaseAll()
      engineState = {
        ...engineState,
        transport: { ...engineState.transport, playing: false },
      }
    } else {
      await clock.start()
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
  'home': renderHome,
  'gate-edit': renderGateEdit,
  'pitch-edit': renderPitchEdit,
  'vel-edit': renderVelEdit,
  'mute-edit': renderMuteEdit,
  'route': renderRoute,
  'rand': renderRand,
  'name-entry': renderNameEntry,
}

// Status bar text per mode
const MODE_STATUS: Record<ScreenMode, (ui: UIState) => string> = {
  'home': () => 'REQUENCER',
  'gate-edit': (ui) => `T${ui.selectedTrack + 1} GATE`,
  'pitch-edit': (ui) => `T${ui.selectedTrack + 1} PITCH`,
  'vel-edit': (ui) => `T${ui.selectedTrack + 1} VELOCITY`,
  'mute-edit': (ui) => `T${ui.selectedTrack + 1} MUTE`,
  'route': (ui) => `ROUTE — O${ui.selectedTrack + 1}`,
  'rand': (ui) => `T${ui.selectedTrack + 1} RANDOMIZER`,
  'name-entry': () => 'SAVE PRESET',
}

// --- Shortcut Hints (below module) ---
const SHORTCUT_HINTS: Record<ScreenMode, string> = {
  'home':      '1-4: track   Q/W/E: edit   Hold+↑↓: length   Hold+←→: div   Space: play',
  'gate-edit': 'Z-M: toggle steps   Shift+Z-M: 9-16   ←→: page   Hold Q+↑↓: len/div   Esc: back',
  'pitch-edit':'Z-M: select   ↑↓: pitch   ←→: page   Hold W+↑↓: len/div   Esc: back',
  'vel-edit':  'Z-M: select   ↑↓: velocity   ←→: page   Hold E+↑↓: len/div   Esc: back',
  'mute-edit': 'Z-M: toggle mutes   ←→: page   Hold A+↑↓: len/div   Esc: back',
  'route':     '1-4: output  \u2191\u2193: param  \u2190\u2192: source track  Esc: back',
  'rand':      '↑↓: scroll params   ←→: adjust value   Enter: apply preset   Hold+D: randomize   Esc: back',
  'name-entry': '↑↓: change letter   ←→: move cursor   Enter: save   Esc: cancel',
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
  if (uiState.heldButton) {
    renderHoldOverlay(lcdCtx, engineState, uiState)
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
