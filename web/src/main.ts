/**
 * Main entry point — WASM-only mode.
 * Rust owns engine, renderer, and mode machine via WASM.
 * TS handles I/O glue: Tone.js clock, audio output, MIDI, keyboard, panel.
 */

import * as Tone from 'tone'
import type { ClockSource, NoteEvent } from './engine/types'
import {
  checkWasmClrTimeout,
  exportWasmLibrary,
  exportWasmState,
  forwardEvent,
  getWasmBpm,
  getWasmClockSource,
  getWasmClrPending,
  getWasmLedState,
  getWasmMidiChannel,
  getWasmMidiClockOut,
  getWasmMidiEnabled,
  getWasmScreenMode,
  getWasmSequencer,
  importWasmLibrary,
  importWasmState,
  initWasm,
  resetWasmSequencer,
  isWasmReady,
  renderWasmLcd,
  syncPlayheadsFromWasm,
  wasmTick,
} from './engine/wasm-adapter'
import { clearLibrary, clearState, loadLibrary, loadState, saveLibrary, saveState } from './io/persistence'
import { DrumMachine } from './io/drum-machine'
import { MIDIClockIn } from './io/midi-clock-in'
import { MIDIClockOut } from './io/midi-clock-out'
import { MIDIOutput } from './io/midi-output'
import { ToneClock } from './io/tone-clock'
import { ToneOutput } from './io/tone-output'
import { createDebugMenu } from './ui/debug-menu'
import type { ControlEvent, ScreenMode } from './ui/hw-types'
import { emit, onControlEvent, setupKeyboardInput } from './ui/input'
import { createControls, updateLEDs, updateModeIndicators } from './ui/panel/controls'
import { createFaceplate, injectPanelStyles, setupMobileViewport } from './ui/panel/faceplate'
import { setupLCDCanvas } from './ui/renderer'

console.log('requencer starting')

// --- Initialize WASM (required — no TS fallback) ---
initWasm().then((ok) => {
  if (!ok) {
    console.error('[WASM] Failed to initialize — sequencer will not work')
    return
  }
  // Restore persisted state
  const stateBytes = loadState()
  if (stateBytes) {
    if (importWasmState(stateBytes)) {
      console.log('[Persistence] State restored')
    } else {
      console.warn('[Persistence] State data corrupt — clearing and resetting')
      clearState()
      resetWasmSequencer()
    }
  }
  const libBytes = loadLibrary()
  if (libBytes) {
    if (importWasmLibrary(libBytes)) {
      console.log('[Persistence] Library restored')
    } else {
      console.warn('[Persistence] Library data corrupt — clearing')
      clearLibrary()
      resetWasmSequencer()
    }
  }
})

// --- Thin transport state (read from WASM, used for I/O coordination) ---
const transport = { bpm: 120, playing: false, clockSource: 'internal' as ClockSource, masterTick: 0 }
let prevScreenMode = 0

// --- Audio I/O ---
const output = new ToneOutput()
const drums = new DrumMachine()
const midi = new MIDIOutput()
const midiClockOut = new MIDIClockOut()
const midiDeviceIds: string[] = ['', '', '', '']
const midiConfigs = [{ channel: 1 }, { channel: 2 }, { channel: 3 }, { channel: 4 }]
let midiEnabled = false
let midiClockOutEnabled = false

const TICKS_PER_STEP = 6

/** Shared tick handler — called by both ToneClock and MIDIClockIn */
function handleEngineTick(time: number, stepDuration: number) {
  if (!isWasmReady()) return
  const allEvents = wasmTick()
  const events = allEvents.filter((e): e is NoteEvent => e !== null)
  if (events.length > 0) {
    output.handleEvents(events, time, stepDuration)
    midi.handleEvents(events, midiConfigs, midiDeviceIds, stepDuration, midiEnabled)
  }
  syncPlayheadsFromWasm(transport)
  const mt = transport.masterTick ?? 0
  if (mt === 0 || mt % TICKS_PER_STEP === 0) {
    drums.triggerStep(mt / TICKS_PER_STEP, time)
  }
  midiClockOut.tick(transport.playing, midiClockOutEnabled)
}

const clock = new ToneClock({
  onTick(time: number, stepDuration: number, _tickDuration: number) {
    handleEngineTick(time, stepDuration)
  },
})
clock.bpm = transport.bpm

// --- MIDI Clock Input ---
const midiClockIn = new MIDIClockIn({
  onTick(stepDuration: number, _tickDuration: number) {
    if (transport.clockSource !== 'midi') return
    if (!transport.playing) return
    const time = Tone.getContext().currentTime
    handleEngineTick(time, stepDuration)
  },
  onStart() {
    if (transport.clockSource !== 'midi') return
    transport.playing = true
    if (isWasmReady()) {
      const seq = getWasmSequencer()
      seq.set_playing(true)
      seq.reset_playheads()
    }
  },
  onStop() {
    if (transport.clockSource !== 'midi') return
    output.releaseAll()
    midi.panic()
    midiClockOut.sendStop()
    transport.playing = false
    if (isWasmReady()) {
      getWasmSequencer().set_playing(false)
    }
  },
  onBpmChange(bpm: number) {
    if (transport.clockSource !== 'midi') return
    transport.bpm = bpm
    if (isWasmReady()) {
      getWasmSequencer().set_bpm(bpm)
    }
  },
})

/** Track current clock source to detect changes */
let activeClockSource: ClockSource = transport.clockSource
let midiInputDeviceIndex = 0
// biome-ignore lint/suspicious/noExplicitAny: MIDI device list
let midiInputDevices: any[] = []

// --- Panel Setup ---
injectPanelStyles()
const panel = createFaceplate()
const lcdCtx = setupLCDCanvas(panel.lcdCanvas)

createControls(panel)
setupMobileViewport()

// --- Keyboard Input ---
setupKeyboardInput()

// --- Debug Menu ---
createDebugMenu({
  getBpm: () => transport.bpm,
  setBpm(bpm: number) {
    transport.bpm = bpm
    clock.bpm = bpm
    if (isWasmReady()) getWasmSequencer().set_bpm(bpm)
  },
  togglePlay() {
    emit({ type: 'play-stop' })
  },
  clearTrack() {
    // CLR is handled by Rust mode machine via forwardEvent
    forwardEvent({ type: 'clr-press' })
  },
  drums,
  isWasmReady: () => isWasmReady(),
})

function refreshMIDIDevices() {
  const inputDevices = midiClockIn.getInputDevices()
  midiInputDevices = inputDevices
  const devices = midi.getDevices()
  if (devices.length > 0) {
    for (let i = 0; i < 4; i++) {
      if (!midiDeviceIds[i]) midiDeviceIds[i] = devices[0].id
    }
  }
}

function shareMIDIAccess() {
  const access = midi.getAccess()
  if (access) {
    midiClockOut.setAccess(access)
    midiClockIn.setAccess(access)
  }
}

function syncClockSource() {
  const source = transport.clockSource
  if (source === activeClockSource) return
  const prevSource = activeClockSource
  activeClockSource = source

  if (source === 'midi') {
    if (clock.playing) clock.stop()
    const inputDevice = midiInputDevices[midiInputDeviceIndex]
    if (inputDevice) midiClockIn.startListening(inputDevice.id)
  } else if (prevSource === 'midi') {
    midiClockIn.stopListening()
  }
}

// --- Control Event Handler ---
let _playStopInProgress = false

onControlEvent(async (event: ControlEvent) => {
  if (event.type === 'play-stop') {
    if (_playStopInProgress) return
    _playStopInProgress = true
    try {
      const isPlaying = clock.playing || transport.playing
      if (isPlaying) {
        if (clock.playing) clock.stop()
        midiClockIn.stopListening()
        output.releaseAll()
        midi.panic()
        midiClockOut.sendStop()
        transport.playing = false
        if (isWasmReady()) {
          getWasmSequencer().set_playing(false)
        }
      } else {
        await Tone.start()
        await midi.init()
        shareMIDIAccess()
        refreshMIDIDevices()

        if (transport.clockSource === 'midi') {
          const inputDevice = midiInputDevices[midiInputDeviceIndex]
          if (inputDevice) midiClockIn.startListening(inputDevice.id)
          transport.playing = true
        } else {
          await clock.start()
          transport.playing = true
        }
        if (isWasmReady()) {
          const seq = getWasmSequencer()
          seq.set_bpm(transport.bpm)
          seq.set_playing(true)
          seq.reset_playheads()
        }
      }
    } finally {
      _playStopInProgress = false
    }
    // Also forward to Rust so it knows play state
    forwardEvent(event)
    return
  }

  forwardEvent(event)

  // Check if clock source changed (settings screen)
  if (isWasmReady()) {
    const newSource = getWasmClockSource()
    if (newSource !== transport.clockSource) {
      transport.clockSource = newSource
      syncClockSource()
    }
  }
})

// --- Screen mode → ScreenMode string mapping ---
const SCREEN_MODES: ScreenMode[] = [
  'home', 'gate-edit', 'pitch-edit', 'vel-edit', 'mod-edit',
  'mute-edit', 'route', 'rand', 'mutate-edit', 'transpose-edit',
  'variation-edit', 'settings', 'pattern', 'pattern-load', 'name-entry',
]

// --- Shortcut Hints ---
const SHORTCUT_HINTS: Record<string, string> = {
  home: '1-4: track   Q/W/E/R: edit   A-G: features   Hold+↑↓: len   Hold+←→: div   Space: play',
  'gate-edit': 'Z-M: toggle steps   Shift+Z-M: 9-16   ←→: page   Hold Q+↑↓: len/div   Esc: back',
  'pitch-edit': 'Z-M: select   ↑↓: pitch   ←→: slide   Enter: page   Esc: back',
  'vel-edit': 'Z-M: select   ↑↓: velocity   ←→: page   Hold E+↑↓: len/div   Esc: back',
  'mute-edit': 'Z-M: toggle mutes   ←→: page   Hold A+↑↓: len/div   Esc: back',
  route: '1-4: output  ↑↓: param  ←→: source  Esc: back',
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

const hintEl = document.createElement('div')
hintEl.id = 'shortcut-hints'
hintEl.style.cssText = `
  text-align: center; padding: 6px 12px; margin-top: 4px;
  font: 11px 'JetBrains Mono', monospace; color: #555; letter-spacing: 0.5px;
`
const ruler = panel.root.querySelector('.ruler')
panel.root.insertBefore(hintEl, ruler)

// --- Render Loop ---
function render(): void {
  if (!isWasmReady()) {
    requestAnimationFrame(render)
    return
  }

  // Read BPM from Rust (encoder may have changed it)
  const wasmBpm = getWasmBpm()
  if (wasmBpm !== clock.bpm) {
    clock.bpm = wasmBpm
    transport.bpm = wasmBpm
  }

  // Sync playing state from clock (internal mode)
  if (transport.clockSource === 'internal') {
    transport.playing = clock.playing
  }

  // Sync MIDI config from Rust (settings screen may have changed it)
  midiEnabled = getWasmMidiEnabled()
  midiClockOutEnabled = getWasmMidiClockOut()
  for (let i = 0; i < 4; i++) {
    midiConfigs[i].channel = getWasmMidiChannel(i)
  }

  // Render LCD via Rust
  renderWasmLcd(lcdCtx)
  checkWasmClrTimeout()

  // CLR pending visual on panel button
  panel.clrBtn.classList.toggle('clr-pending', getWasmClrPending())

  // Update panel LEDs from Rust mode machine
  const wasmLeds = getWasmLedState()
  if (wasmLeds) {
    const ledState = {
      steps: wasmLeds.steps as Array<'off' | 'on' | 'dim' | 'flash'>,
      tracks: wasmLeds.tracks,
      play: wasmLeds.play === 'flash' ? 'pulse' as const : wasmLeds.play === 'on' ? 'on' as const : 'off' as const,
    }
    updateLEDs(ledState)
  }

  // Update mode indicators on subtrack/feature buttons
  const modeIndex = getWasmScreenMode()
  // Auto-save when navigating to home screen
  if (modeIndex === 0 && prevScreenMode !== 0) {
    const stateBytes = exportWasmState()
    if (stateBytes.length > 0) saveState(stateBytes)
    const libBytes = exportWasmLibrary()
    if (libBytes.length > 0) saveLibrary(libBytes)
    console.log('[Persistence] Auto-saved (returned to home)')
  }
  prevScreenMode = modeIndex
  const modeName = SCREEN_MODES[modeIndex] ?? 'home'
  // Construct minimal UIState for updateModeIndicators
  const minimalUi = { mode: modeName } as import('./ui/hw-types').UIState
  updateModeIndicators(panel.subtrackBtns, panel.featureBtns, panel.randBtn, panel.patBtn, minimalUi)

  // Update shortcut hints
  hintEl.textContent = SHORTCUT_HINTS[modeName] ?? ''

  requestAnimationFrame(render)
}

requestAnimationFrame(render)
