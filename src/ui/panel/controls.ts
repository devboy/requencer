/**
 * Interactive HTML control elements — wires button clicks and encoder drags to ControlEvent emission.
 *
 * 30 buttons: 4 track, 4 subtrack, 4 feature, 16 step, 2 transport
 * 2 encoders: vertical drag = turn, click without drag = push
 */

import type { LEDState, SubtrackId, FeatureId, ControlEvent, HeldButtonTarget } from '../hw-types'
import { emit } from '../input'
import type { FaceplateElements } from './faceplate'

const SUBTRACK_IDS: SubtrackId[] = ['gate', 'pitch', 'velocity', 'mod']
const FEATURE_IDS: FeatureId[] = ['mute', 'route', 'rand', 'div']
const HOLD_THRESHOLD_MS = 200

interface PanelControls {
  stepBtns: HTMLButtonElement[]
  trackBtns: HTMLButtonElement[]
  playBtn: HTMLButtonElement
}

let controls: PanelControls | null = null

// --- Hold Detection ---
// Track/subtrack/feature buttons support hold combos.
// Press: start 200ms timer. Release <200ms: tap. Hold >200ms: hold-start → hold-end on release.

let holdTimer: ReturnType<typeof setTimeout> | null = null
let activeHold: { button: HeldButtonTarget; tapEvent: ControlEvent } | null = null
let holdActive = false // true once hold-start has been emitted

function startHold(button: HeldButtonTarget, tapEvent: ControlEvent): void {
  clearHold()
  activeHold = { button, tapEvent }
  holdActive = false
  holdTimer = setTimeout(() => {
    holdTimer = null
    holdActive = true
    emit({ type: 'hold-start', button })
  }, HOLD_THRESHOLD_MS)
}

function clearHold(): void {
  if (holdTimer !== null) {
    clearTimeout(holdTimer)
    holdTimer = null
  }
  activeHold = null
  holdActive = false
}

function endHold(): void {
  if (holdTimer !== null) {
    // Released before threshold — emit tap event
    clearTimeout(holdTimer)
    holdTimer = null
    if (activeHold) emit(activeHold.tapEvent)
  } else if (holdActive) {
    // Was in hold mode — emit hold-end
    emit({ type: 'hold-end' })
  }
  activeHold = null
  holdActive = false
}

/** Wire all interactive elements to emit ControlEvents */
export function createControls(panel: FaceplateElements): void {
  // --- Track buttons (T1-T4) — hold-aware ---
  for (let i = 0; i < panel.trackBtns.length; i++) {
    panel.trackBtns[i].addEventListener('mousedown', (e) => {
      e.preventDefault()
      startHold({ kind: 'track', track: i }, { type: 'track-select', track: i })
    })
    panel.trackBtns[i].addEventListener('mouseup', () => endHold())
    panel.trackBtns[i].addEventListener('mouseleave', () => endHold())
  }

  // --- Subtrack buttons (GATE, PTCH, VEL, MOD) — hold-aware ---
  for (let i = 0; i < panel.subtrackBtns.length; i++) {
    panel.subtrackBtns[i].addEventListener('mousedown', (e) => {
      e.preventDefault()
      startHold(
        { kind: 'subtrack', subtrack: SUBTRACK_IDS[i] },
        { type: 'subtrack-select', subtrack: SUBTRACK_IDS[i] },
      )
    })
    panel.subtrackBtns[i].addEventListener('mouseup', () => endHold())
    panel.subtrackBtns[i].addEventListener('mouseleave', () => endHold())
  }

  // --- Feature buttons (MUTE, ROUTE, RAND, DIV) — hold-aware ---
  for (let i = 0; i < panel.featureBtns.length; i++) {
    panel.featureBtns[i].addEventListener('mousedown', (e) => {
      e.preventDefault()
      startHold(
        { kind: 'feature', feature: FEATURE_IDS[i] },
        { type: 'feature-press', feature: FEATURE_IDS[i] },
      )
    })
    panel.featureBtns[i].addEventListener('mouseup', () => endHold())
    panel.featureBtns[i].addEventListener('mouseleave', () => endHold())
  }

  // --- Step buttons (1-16) — no hold, direct emit ---
  for (let i = 0; i < panel.stepBtns.length; i++) {
    panel.stepBtns[i].addEventListener('mousedown', () => {
      emit({ type: 'step-press', step: i })
    })
  }

  // --- Transport — no hold ---
  panel.playBtn.addEventListener('mousedown', () => emit({ type: 'play-stop' }))
  panel.resetBtn.addEventListener('mousedown', () => emit({ type: 'reset' }))

  // --- Dual encoders ---
  interface EncState {
    el: HTMLDivElement
    dragging: boolean
    turned: boolean
    startY: number
    accum: number
    angle: number
    prefix: 'encoder-a' | 'encoder-b'
  }

  const encStates: EncState[] = [
    { el: panel.encoderA, dragging: false, turned: false, startY: 0, accum: 0, angle: 0, prefix: 'encoder-a' },
    { el: panel.encoderB, dragging: false, turned: false, startY: 0, accum: 0, angle: 0, prefix: 'encoder-b' },
  ]

  for (const enc of encStates) {
    enc.el.addEventListener('mousedown', (e) => {
      enc.dragging = true
      enc.turned = false
      enc.startY = e.clientY
      enc.accum = 0
      e.preventDefault()
    })
  }

  window.addEventListener('mousemove', (e) => {
    for (const enc of encStates) {
      if (!enc.dragging) continue
      const dy = enc.startY - e.clientY
      enc.accum += dy
      enc.startY = e.clientY

      while (enc.accum >= 8) {
        emit({ type: `${enc.prefix}-turn`, delta: 1 })
        enc.accum -= 8
        enc.angle += 15
        enc.turned = true
      }
      while (enc.accum <= -8) {
        emit({ type: `${enc.prefix}-turn`, delta: -1 })
        enc.accum += 8
        enc.angle -= 15
        enc.turned = true
      }

      const indicator = enc.el.querySelector('.encoder-indicator') as HTMLElement
      if (indicator) {
        indicator.style.transform = `rotate(${enc.angle}deg)`
      }
    }
  })

  window.addEventListener('mouseup', () => {
    for (const enc of encStates) {
      if (enc.dragging) {
        enc.dragging = false
        if (!enc.turned) {
          emit({ type: `${enc.prefix}-push` })
        }
      }
    }
  })

  controls = {
    stepBtns: panel.stepBtns,
    trackBtns: panel.trackBtns,
    playBtn: panel.playBtn,
  }
}

/** Update LED visual state on step buttons, track buttons, and play indicator */
export function updateLEDs(ledState: LEDState): void {
  if (!controls) return

  // Step LEDs
  for (let i = 0; i < 16; i++) {
    const btn = controls.stepBtns[i]
    btn.classList.remove('led-on', 'led-dim', 'led-flash')
    switch (ledState.steps[i]) {
      case 'on': btn.classList.add('led-on'); break
      case 'dim': btn.classList.add('led-dim'); break
      case 'flash': btn.classList.add('led-flash'); break
    }
  }

  // Track LEDs
  for (let i = 0; i < 4; i++) {
    const btn = controls.trackBtns[i]
    btn.classList.remove('led-on')
    if (ledState.tracks[i] === 'on') {
      btn.classList.add('led-on')
    }
  }

  // Play button state
  const playBtn = controls.playBtn
  playBtn.classList.remove('play-on', 'play-pulse')
  switch (ledState.play) {
    case 'on': playBtn.classList.add('play-on'); break
    case 'pulse': playBtn.classList.add('play-pulse'); break
  }
}

/** Update active state on subtrack/feature buttons to show current mode */
export function updateModeIndicators(
  subtrackBtns: HTMLButtonElement[],
  featureBtns: HTMLButtonElement[],
  mode: string,
): void {
  const subtrackModes = ['gate-edit', 'pitch-edit', 'vel-edit', '']
  const featureModes = ['mute-edit', 'route', 'rand', 'div']

  for (let i = 0; i < subtrackBtns.length; i++) {
    subtrackBtns[i].classList.toggle('active', mode === subtrackModes[i])
  }
  for (let i = 0; i < featureBtns.length; i++) {
    featureBtns[i].classList.toggle('active', mode === featureModes[i])
  }
}
