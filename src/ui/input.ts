/**
 * Input handler — maps keyboard events to ControlEvent objects.
 * Also provides registration for panel control callbacks.
 *
 * Keyboard mapping:
 *   1-4         → T1-T4 track select
 *   Q/W/E/R     → GATE/PTCH/VEL/MOD subtrack buttons
 *   A/S/D/F     → MUTE/ROUTE/RAND/DIV feature buttons
 *   ArrowUp/Down    → Encoder A turn (delta ±1)
 *   ArrowLeft/Right → Encoder B turn (delta ±1)
 *   Enter       → Encoder A push
 *   Escape      → Encoder B push
 *   Space       → Play/Stop
 *   Backspace   → Reset
 *   Z/X/C/V/B/N/M/,  → Step buttons 1-8
 *   Shift + above     → Step buttons 9-16
 */

import type { ControlEvent, SubtrackId, FeatureId, HeldButtonTarget } from './hw-types'
import { toggleHelp, isHelpOpen } from './help-modal'

type ControlEventCallback = (event: ControlEvent) => void

const listeners: ControlEventCallback[] = []

export function onControlEvent(callback: ControlEventCallback): () => void {
  listeners.push(callback)
  return () => {
    const idx = listeners.indexOf(callback)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}

export function emit(event: ControlEvent): void {
  for (const cb of listeners) cb(event)
}

// Step button key row: Z X C V B N M ,
const STEP_KEYS = ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',']

const TRACK_KEYS: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3 }
const SUBTRACK_KEYS: Record<string, SubtrackId> = { q: 'gate', w: 'pitch', e: 'velocity', r: 'mod' }
const FEATURE_KEYS: Record<string, FeatureId> = { a: 'mute', s: 'route', d: 'rand', f: 'div' }

const HOLD_THRESHOLD_MS = 200

// --- Keyboard hold detection ---
// Holdable keys: track (1-4), subtrack (Q/W/E/R), feature (A/S/D/F)
// Non-holdable: step buttons, encoders, transport — fire immediately

interface KeyHoldState {
  key: string
  button: HeldButtonTarget
  tapEvent: ControlEvent
  timer: ReturnType<typeof setTimeout> | null
  holdActive: boolean
}

let keyHold: KeyHoldState | null = null

// Shift+Q/W/E/R → track select (alternative to 1-4)
const SHIFT_TRACK_KEYS: Record<string, number> = { q: 0, w: 1, e: 2, r: 3 }

function getHoldableButton(key: string, shiftKey: boolean): { button: HeldButtonTarget; tapEvent: ControlEvent } | null {
  if (key in TRACK_KEYS) {
    const track = TRACK_KEYS[key]
    return { button: { kind: 'track', track }, tapEvent: { type: 'track-select', track } }
  }
  // Shift+QWER = track select (before subtrack check)
  if (shiftKey && key in SHIFT_TRACK_KEYS) {
    const track = SHIFT_TRACK_KEYS[key]
    return { button: { kind: 'track', track }, tapEvent: { type: 'track-select', track } }
  }
  if (!shiftKey && key in SUBTRACK_KEYS) {
    const subtrack = SUBTRACK_KEYS[key]
    return { button: { kind: 'subtrack', subtrack }, tapEvent: { type: 'subtrack-select', subtrack } }
  }
  if (key in FEATURE_KEYS) {
    const feature = FEATURE_KEYS[key]
    return { button: { kind: 'feature', feature }, tapEvent: { type: 'feature-press', feature } }
  }
  return null
}

function keyToImmediateEvent(e: KeyboardEvent): ControlEvent | null {
  // Step buttons: Z-M row (+ shift for 9-16)
  const key = e.key.toLowerCase()
  const stepIdx = STEP_KEYS.indexOf(key)
  if (stepIdx >= 0) {
    const offset = e.shiftKey ? 8 : 0
    return { type: 'step-press', step: stepIdx + offset }
  }

  // Encoder A: ArrowUp/Down
  if (e.key === 'ArrowUp') return { type: 'encoder-a-turn', delta: 1 }
  if (e.key === 'ArrowDown') return { type: 'encoder-a-turn', delta: -1 }
  if (e.key === 'Enter') return { type: 'encoder-a-push' }

  // Encoder B: ArrowLeft/Right
  if (e.key === 'ArrowRight') return { type: 'encoder-b-turn', delta: 1 }
  if (e.key === 'ArrowLeft') return { type: 'encoder-b-turn', delta: -1 }
  if (e.key === 'Escape') return { type: 'encoder-b-push' }

  // Transport
  if (e.key === ' ') return { type: 'play-stop' }
  if (e.key === 'Backspace') return { type: 'reset' }

  return null
}

function clearKeyHold(): void {
  if (keyHold?.timer) clearTimeout(keyHold.timer)
  keyHold = null
}

export function setupKeyboardInput(): () => void {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return // ignore key repeat

    // "?" toggles help modal (Shift+/ on US layout)
    if (e.key === '?') { toggleHelp(); return }
    // Close help on any other key
    if (isHelpOpen()) { toggleHelp(); return }

    const key = e.key.toLowerCase()

    // Check if this is a holdable button
    const holdable = getHoldableButton(key, e.shiftKey)
    if (holdable) {
      e.preventDefault()
      // Start hold detection
      clearKeyHold()
      const state: KeyHoldState = {
        key,
        button: holdable.button,
        tapEvent: holdable.tapEvent,
        timer: null,
        holdActive: false,
      }
      state.timer = setTimeout(() => {
        state.timer = null
        state.holdActive = true
        emit({ type: 'hold-start', button: state.button })
      }, HOLD_THRESHOLD_MS)
      keyHold = state
      return
    }

    // Non-holdable keys emit immediately
    const event = keyToImmediateEvent(e)
    if (event) {
      e.preventDefault()
      emit(event)
    }
  }

  const handleKeyUp = (e: KeyboardEvent) => {
    if (!keyHold) return
    const key = e.key.toLowerCase()
    if (key !== keyHold.key) return

    if (keyHold.timer !== null) {
      // Released before threshold — emit tap
      clearTimeout(keyHold.timer)
      emit(keyHold.tapEvent)
    } else if (keyHold.holdActive) {
      // Was holding — emit hold-end
      emit({ type: 'hold-end' })
    }
    keyHold = null
  }

  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)

  return () => {
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('keyup', handleKeyUp)
    clearKeyHold()
  }
}
