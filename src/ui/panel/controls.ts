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
const FEATURE_IDS: FeatureId[] = ['mute', 'route', 'div']
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

// --- Sticky Hold (double-click detection) ---
const STICKY_THRESHOLD_MS = 300
let lastTapUp = 0 // timestamp of most recent pointerup from a holdable button tap
let stickyHold: { button: HeldButtonTarget; el: HTMLElement } | null = null

/** Returns true if a sticky hold is currently active (from any input source) */
export function isStickyHoldActive(): boolean {
  return stickyHold !== null
}

/** Returns the currently sticky-held button target, or null */
export function getStickyHoldButton(): HeldButtonTarget | null {
  return stickyHold?.button ?? null
}

/** End sticky hold — emits hold-end, removes CSS class. Safe to call when not sticky. */
export function endStickyHold(): void {
  if (!stickyHold) return
  stickyHold.el.classList.remove('sticky-hold')
  stickyHold = null
  emit({ type: 'hold-end' })
}

/**
 * Set sticky hold from an external source (keyboard input).
 * Only one sticky hold can be active at a time.
 */
export function setStickyHold(button: HeldButtonTarget, el: HTMLElement): void {
  if (stickyHold) endStickyHold()
  stickyHold = { button, el }
  el.classList.add('sticky-hold')
}

function sameButton(a: HeldButtonTarget, b: HeldButtonTarget): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'track') return a.track === (b as typeof a).track
  if (a.kind === 'subtrack') return a.subtrack === (b as { kind: 'subtrack'; subtrack: SubtrackId }).subtrack
  return a.feature === (b as { kind: 'feature'; feature: FeatureId }).feature
}

function startHold(button: HeldButtonTarget, tapEvent: ControlEvent, el: HTMLElement): void {
  if (stickyHold) {
    if (sameButton(stickyHold.button, button)) {
      // Clicking the same button → end sticky hold (the "release" gesture)
      endStickyHold()
      return
    }
    // Different button → emit tap while sticky hold stays active (this IS the combo)
    emit(tapEvent)
    return
  }

  // Check for double-click → sticky hold
  const now = performance.now()
  if (now - lastTapUp < STICKY_THRESHOLD_MS) {
    lastTapUp = 0 // reset to prevent triple-click
    stickyHold = { button, el }
    el.classList.add('sticky-hold')
    emit({ type: 'hold-start', button })
    return
  }

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
  // Sticky hold pointerup is a no-op — sticky persists until next click or Escape
  if (stickyHold) return

  if (holdTimer !== null) {
    // Released before threshold — emit tap event, record tap time for double-click detection
    clearTimeout(holdTimer)
    holdTimer = null
    lastTapUp = performance.now()
    if (activeHold) emit(activeHold.tapEvent)
  } else if (holdActive) {
    // Was in hold mode — emit hold-end
    emit({ type: 'hold-end' })
  }
  activeHold = null
  holdActive = false
}

// --- Multitouch: track active pointers on holdable buttons ---
const activePointers = new Map<number, { button: HeldButtonTarget; el: HTMLElement }>()

function holdablePointerDown(
  e: PointerEvent,
  button: HeldButtonTarget,
  tapEvent: ControlEvent,
  el: HTMLElement,
): void {
  e.preventDefault()

  // Check for true multitouch combo: another pointer is already down on a different holdable button
  if (activePointers.size > 0) {
    const existing = activePointers.values().next().value!
    if (!sameButton(existing.button, button)) {
      // First pointer's button becomes the hold, second is the tap (combo)
      if (!holdActive && !stickyHold) {
        emit({ type: 'hold-start', button: existing.button })
        holdActive = true
      }
      emit(tapEvent)
      activePointers.set(e.pointerId, { button, el })
      return
    }
  }

  activePointers.set(e.pointerId, { button, el })
  startHold(button, tapEvent, el)
}

function holdablePointerUp(e: PointerEvent): void {
  activePointers.delete(e.pointerId)
  // If all pointers are released and we had a multitouch hold, end it
  if (activePointers.size === 0 && holdActive && !stickyHold) {
    emit({ type: 'hold-end' })
    holdActive = false
    activeHold = null
    return
  }
  endHold()
}

/** Wire all interactive elements to emit ControlEvents */
export function createControls(panel: FaceplateElements): void {
  // --- Track buttons (T1-T4) — hold-aware ---
  for (let i = 0; i < panel.trackBtns.length; i++) {
    const btn = panel.trackBtns[i]
    btn.addEventListener('pointerdown', (e) => {
      holdablePointerDown(e, { kind: 'track', track: i }, { type: 'track-select', track: i }, btn)
    })
    btn.addEventListener('pointerup', (e) => holdablePointerUp(e))
    btn.addEventListener('pointerleave', (e) => holdablePointerUp(e))
  }

  // --- Subtrack buttons (GATE, PTCH, VEL, MOD) — hold-aware ---
  for (let i = 0; i < panel.subtrackBtns.length; i++) {
    const btn = panel.subtrackBtns[i]
    btn.addEventListener('pointerdown', (e) => {
      holdablePointerDown(
        e,
        { kind: 'subtrack', subtrack: SUBTRACK_IDS[i] },
        { type: 'subtrack-select', subtrack: SUBTRACK_IDS[i] },
        btn,
      )
    })
    btn.addEventListener('pointerup', (e) => holdablePointerUp(e))
    btn.addEventListener('pointerleave', (e) => holdablePointerUp(e))
  }

  // --- Feature buttons (MUTE, ROUTE, RAND, DIV) — hold-aware ---
  for (let i = 0; i < FEATURE_IDS.length; i++) {
    const btn = panel.featureBtns[i]
    btn.addEventListener('pointerdown', (e) => {
      holdablePointerDown(
        e,
        { kind: 'feature', feature: FEATURE_IDS[i] },
        { type: 'feature-press', feature: FEATURE_IDS[i] },
        btn,
      )
    })
    btn.addEventListener('pointerup', (e) => holdablePointerUp(e))
    btn.addEventListener('pointerleave', (e) => holdablePointerUp(e))
  }

  // --- Step buttons (1-16) — no hold, direct emit ---
  // Step presses pass through during sticky hold (they're part of hold combos)
  for (let i = 0; i < panel.stepBtns.length; i++) {
    panel.stepBtns[i].addEventListener('pointerdown', () => {
      emit({ type: 'step-press', step: i })
    })
  }

  // --- Transport — no hold ---
  // Use touchend for iOS audio unlock — pointerdown may not count as user gesture
  let playTouchHandled = false
  panel.playBtn.addEventListener('touchend', (e) => {
    e.preventDefault()
    playTouchHandled = true
    emit({ type: 'play-stop' })
  })
  panel.playBtn.addEventListener('pointerdown', () => {
    if (playTouchHandled) { playTouchHandled = false; return }
    emit({ type: 'play-stop' })
  })
  panel.resetBtn.addEventListener('pointerdown', () => emit({ type: 'reset' }))

  // --- RAND button (in control strip) — no hold, direct emit ---
  let randTouchHandled = false
  panel.randBtn.addEventListener('touchend', (e) => {
    e.preventDefault()
    randTouchHandled = true
    emit({ type: 'feature-press', feature: 'rand' })
  })
  panel.randBtn.addEventListener('pointerdown', () => {
    if (randTouchHandled) { randTouchHandled = false; return }
    emit({ type: 'feature-press', feature: 'rand' })
  })

  // --- Global click: end sticky hold on clicks outside interactive controls ---
  // Step buttons, encoders pass through during sticky (they're used with hold combos).
  // Holdable buttons already handle sticky exit in startHold().
  document.addEventListener('pointerdown', (e) => {
    if (!stickyHold) return
    const target = e.target as HTMLElement
    // Ignore clicks on interactive controls (these have their own handling)
    if (target.closest('.track-btn, .subtrack-btn, .feature-btn, .step-btn, .encoder, .transport-btn, .rand-btn')) return
    endStickyHold()
  })

  // --- Dual encoders ---
  interface EncState {
    el: HTMLDivElement
    dragging: boolean
    turned: boolean
    startY: number
    accum: number
    angle: number
    pointerId: number  // track which pointer started the drag
    prefix: 'encoder-a' | 'encoder-b'
  }

  const encStates: EncState[] = [
    { el: panel.encoderA, dragging: false, turned: false, startY: 0, accum: 0, angle: 0, pointerId: -1, prefix: 'encoder-a' },
    { el: panel.encoderB, dragging: false, turned: false, startY: 0, accum: 0, angle: 0, pointerId: -1, prefix: 'encoder-b' },
  ]

  for (const enc of encStates) {
    enc.el.addEventListener('pointerdown', (e) => {
      enc.dragging = true
      enc.turned = false
      enc.startY = e.clientY
      enc.accum = 0
      enc.pointerId = e.pointerId
      e.preventDefault()
    })
  }

  window.addEventListener('pointermove', (e) => {
    for (const enc of encStates) {
      if (!enc.dragging || enc.pointerId !== e.pointerId) continue
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

  window.addEventListener('pointerup', (e) => {
    for (const enc of encStates) {
      if (enc.dragging && enc.pointerId === e.pointerId) {
        enc.dragging = false
        enc.pointerId = -1
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

/** Update active state on subtrack/feature/rand buttons to show current mode */
export function updateModeIndicators(
  subtrackBtns: HTMLButtonElement[],
  featureBtns: HTMLButtonElement[],
  randBtn: HTMLButtonElement,
  mode: string,
): void {
  const subtrackModes = ['gate-edit', 'pitch-edit', 'vel-edit', '']
  const featureModes = ['mute-edit', 'route', 'div']

  for (let i = 0; i < subtrackBtns.length; i++) {
    subtrackBtns[i].classList.toggle('active', mode === subtrackModes[i])
  }
  for (let i = 0; i < featureModes.length; i++) {
    featureBtns[i].classList.toggle('active', mode === featureModes[i])
  }
  randBtn.classList.toggle('active', mode === 'rand')
}
