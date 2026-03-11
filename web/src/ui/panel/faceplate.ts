/**
 * Module faceplate — 3U eurorack panel with absolute positioning.
 * All component positions come directly from panel-layout.json (mm coordinates).
 * Coordinates are scaled to pixels via SCALE (4.5 px/mm).
 *
 * Layout origin (0,0) = top-left of physical panel.
 * Every component is absolutely positioned at its JSON (x_mm, y_mm) center.
 */

// ── Panel layout from shared config (single source of truth) ──────
import panelLayout from '../../panel-layout.json'

const C = panelLayout.constants
const SCALE = 4.5 // px per mm — rendering concern, not in JSON

const HP_PX = 5.08 * SCALE
const MODULE_3U_H = panelLayout.panel.height_mm * SCALE
const MODULE_W = panelLayout.panel.width_mm * SCALE
const _RAIL_ZONE = C.rail_zone_mm * SCALE
const MOUNT_SLOT_W = C.mount_slot_w_mm * SCALE
const MOUNT_SLOT_H = C.mount_slot_h_mm * SCALE
const JACK_D = C.jack_diameter_mm * SCALE
const JACK_HOLE = C.jack_hole_mm * SCALE
const _JACK_SPACING = C.jack_spacing_mm * SCALE
const ENCODER_D = C.encoder_diameter_mm * SCALE
const BTN_D = C.btn_diameter_mm * SCALE
const BTN_CC = C.btn_cc_mm * SCALE
const STEP_BTN_D = C.step_btn_diameter_mm * SCALE

const USB_C_H = C.usb_c_h_mm * SCALE // used for border-radius

const SILK_TEXT = Math.round(C.silk_text_mm * SCALE)
const _COMPONENT_GAP = Math.round(BTN_CC / 2)

// Neighbor module images
const NEIGHBORS = {
  left: {
    src: 'https://modulargrid.net/img/modcache/9618.f.jpg',
    hp: 40,
    name: 'XOR Electronics NerdSEQ',
  },
  right: {
    src: 'https://modulargrid.net/img/modcache/31940.f.jpg',
    hp: 34,
    name: 'Intellijel Metropolix',
  },
}

export interface FaceplateElements {
  root: HTMLDivElement
  lcdCanvas: HTMLCanvasElement
  trackBtns: HTMLButtonElement[]
  subtrackBtns: HTMLButtonElement[]
  featureBtns: HTMLButtonElement[]
  stepBtns: HTMLButtonElement[]
  playBtn: HTMLButtonElement
  resetBtn: HTMLButtonElement
  randBtn: HTMLButtonElement
  backBtn: HTMLButtonElement
  clrBtn: HTMLButtonElement
  patBtn: HTMLButtonElement
  settingsBtn: HTMLButtonElement
  encoderA: HTMLDivElement
  encoderB: HTMLDivElement
}

/** Place an element at (x_mm, y_mm) center using absolute positioning */
function placeAt(el: HTMLElement, x_mm: number, y_mm: number): void {
  el.style.position = 'absolute'
  el.style.left = `${x_mm * SCALE}px`
  el.style.top = `${y_mm * SCALE}px`
  el.style.transform = 'translate(-50%, -50%)'
}

/** Create a circle button and place it at JSON coordinates */
function createCircleBtn(
  panel: HTMLElement,
  className: string,
  x_mm: number,
  y_mm: number,
  label?: string,
  labelPos: 'above' | 'below' = 'above',
): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.className = `circle-btn ${className}`
  if (label) {
    const lbl = document.createElement('span')
    lbl.className = `btn-label label-${labelPos}`
    lbl.textContent = label
    btn.appendChild(lbl)
  }
  placeAt(btn, x_mm, y_mm)
  panel.appendChild(btn)
  return btn
}

/** Create a jack element and place it at JSON coordinates */
function createJack(
  panel: HTMLElement,
  x_mm: number,
  y_mm: number,
  label?: string,
  labelPos: 'above' | 'below' = 'above',
): HTMLDivElement {
  const cell = document.createElement('div')
  cell.className = 'jack-cell'
  cell.innerHTML = `
    ${label ? `<span class="btn-label label-${labelPos}">${label}</span>` : ''}
    <div class="jack"><div class="jack-hole"></div></div>
  `
  placeAt(cell, x_mm, y_mm)
  panel.appendChild(cell)
  return cell
}

/** Create the full rack DOM structure and append to body */
export function createFaceplate(): FaceplateElements {
  const root = document.createElement('div')
  root.className = 'rack-wrapper'
  root.innerHTML = `
    <div class="rack-row">
      <div class="neighbor-module neighbor-left">
        <img src="${NEIGHBORS.left.src}" alt="${NEIGHBORS.left.name}" loading="lazy" />
      </div>

      <div class="module-column">
        <div id="module-panel">
          <div class="panel-title">REQUENCER</div>
          <div class="branding">VILE TENSOR</div>
        </div>
      </div>

      <div class="neighbor-module neighbor-right">
        <img src="${NEIGHBORS.right.src}" alt="${NEIGHBORS.right.name}" loading="lazy" />
      </div>
    </div>

    <div class="ruler ruler-bottom">
      <div class="ruler-track ruler-hp"></div>
      <div class="ruler-track ruler-cm"></div>
    </div>
  `

  document.body.appendChild(root)

  const modulePanel = root.querySelector('#module-panel') as HTMLDivElement

  // --- Mounting slots from JSON ---
  for (const slot of panelLayout.mounting_slots) {
    const screw = document.createElement('div')
    screw.className = 'screw'
    placeAt(screw, slot.x_mm, slot.y_mm)
    modulePanel.appendChild(screw)
  }

  // --- LCD bezel from lcd_cutout center ---
  const lcd = panelLayout.lcd_cutout
  const lcdBezel = document.createElement('div')
  lcdBezel.className = 'lcd-bezel'
  lcdBezel.innerHTML = `<div class="lcd-mask"><canvas id="lcd-canvas"></canvas></div>`
  // Position at top-left corner (no translate)
  const lcdPad = C.lcd_padding_mm * SCALE
  const bezelW = lcd.width_mm * SCALE + 2 * lcdPad + 4
  const bezelH = lcd.height_mm * SCALE + 2 * lcdPad + 4
  lcdBezel.style.position = 'absolute'
  lcdBezel.style.left = `${lcd.center_x_mm * SCALE - bezelW / 2}px`
  lcdBezel.style.top = `${lcd.center_y_mm * SCALE - bezelH / 2}px`
  lcdBezel.style.width = `${bezelW}px`
  lcdBezel.style.height = `${bezelH}px`
  modulePanel.appendChild(lcdBezel)

  // --- Track buttons (T1-T4) ---
  const trackBtns: HTMLButtonElement[] = []
  for (const entry of panelLayout.buttons.track) {
    const btn = createCircleBtn(modulePanel, 'track-btn', entry.x_mm, entry.y_mm, entry.label)
    btn.dataset.track = String(trackBtns.length)
    trackBtns.push(btn)
  }

  // --- Subtrack buttons (GATE, PITCH, VEL, MOD) ---
  const subtrackBtns: HTMLButtonElement[] = []
  for (const entry of panelLayout.buttons.subtrack) {
    const btn = createCircleBtn(modulePanel, 'subtrack-btn', entry.x_mm, entry.y_mm, entry.label)
    btn.dataset.index = String(subtrackBtns.length)
    subtrackBtns.push(btn)
  }

  // --- PAT button ---
  const pat = panelLayout.buttons.pat
  const patBtn = createCircleBtn(modulePanel, 'pat-btn', pat.x_mm, pat.y_mm, pat.label)

  // --- Feature buttons ---
  const featureBtns: HTMLButtonElement[] = []
  for (const entry of panelLayout.buttons.feature) {
    const btn = createCircleBtn(modulePanel, 'feature-btn', entry.x_mm, entry.y_mm, entry.label)
    btn.dataset.index = String(featureBtns.length)
    featureBtns.push(btn)
  }

  // --- Encoders ---
  const encAData = panelLayout.encoders[0]
  const encBData = panelLayout.encoders[1]

  function createEncoder(panel: HTMLElement, data: { x_mm: number; y_mm: number; label: string }): HTMLDivElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'encoder-cell'
    wrapper.innerHTML = `
      <span class="btn-label label-above">${data.label}</span>
      <div class="encoder" id="encoder-${data.label.toLowerCase()}">
        <div class="encoder-cap">
          <div class="encoder-indicator"></div>
        </div>
      </div>
    `
    placeAt(wrapper, data.x_mm, data.y_mm)
    panel.appendChild(wrapper)
    return wrapper.querySelector('.encoder') as HTMLDivElement
  }

  const encoderA = createEncoder(modulePanel, encAData)
  const encoderB = createEncoder(modulePanel, encBData)

  // --- Control strip buttons (BACK, RAND, CLR) ---
  const ctrlStrip = panelLayout.buttons.control_strip
  const backBtn = createCircleBtn(modulePanel, 'back-btn', ctrlStrip[0].x_mm, ctrlStrip[0].y_mm, 'BACK')
  const randBtn = createCircleBtn(modulePanel, 'rand-btn', ctrlStrip[1].x_mm, ctrlStrip[1].y_mm, 'RAND')
  const clrBtn = createCircleBtn(modulePanel, 'clr-btn', ctrlStrip[2].x_mm, ctrlStrip[2].y_mm, 'CLR')

  // --- Step buttons (2 rows of 8) ---
  const stepBtns: HTMLButtonElement[] = []
  for (const entry of panelLayout.buttons.step) {
    const btn = document.createElement('button')
    btn.className = 'circle-btn step-btn'
    btn.dataset.step = String(stepBtns.length)
    btn.dataset.track = '0'
    placeAt(btn, entry.x_mm, entry.y_mm)
    modulePanel.appendChild(btn)
    stepBtns.push(btn)
  }

  // --- Transport buttons (PLAY, RESET, SETTINGS) ---
  const transportData = panelLayout.buttons.transport
  const playBtn = createCircleBtn(
    modulePanel,
    'transport-btn play-btn jack-zone-btn',
    transportData[0].x_mm,
    transportData[0].y_mm,
    'PLAY',
  )
  const resetBtn = createCircleBtn(
    modulePanel,
    'transport-btn jack-zone-btn',
    transportData[1].x_mm,
    transportData[1].y_mm,
    'RESET',
  )
  const settingsBtn = createCircleBtn(
    modulePanel,
    'transport-btn jack-zone-btn',
    transportData[2].x_mm,
    transportData[2].y_mm,
    'SET',
  )

  // --- Utility jacks (CLK, RST, MIDI pairs) ---
  for (const jack of panelLayout.jacks.utility) {
    createJack(modulePanel, jack.x_mm, jack.y_mm, jack.label)
  }

  // --- Output jacks (4×4 grid: GATE/PITCH/VEL/MOD per track) ---
  const outColLabels = ['GATE', 'PITCH', 'VEL', 'MOD']
  for (const jack of panelLayout.jacks.output) {
    // Only show column label on first track
    const label = jack.track === 1 ? outColLabels[['gate', 'pitch', 'vel', 'mod'].indexOf(jack.row)] : undefined
    createJack(modulePanel, jack.x_mm, jack.y_mm, label)
  }

  // --- CV input jacks ---
  for (const jack of panelLayout.jacks.cv_input) {
    createJack(modulePanel, jack.x_mm, jack.y_mm, jack.label, 'below')
  }

  // --- Connectors (USB-C, SD) ---
  // Position the body at the coordinate; label floats above via CSS
  const connectors = panelLayout.connectors as { _note?: string; usb_c?: { x_mm: number; y_mm: number; width_mm: number; height_mm: number }; sd_card?: { x_mm: number; y_mm: number; width_mm: number; height_mm: number } } | undefined
  const usbData = connectors?.usb_c
  if (usbData) {
    const usbEl = document.createElement('div')
    usbEl.className = 'connector-body usb-c-body'
    usbEl.innerHTML = `<div class="usb-c-port"></div>`
    usbEl.style.width = `${usbData.width_mm * SCALE}px`
    usbEl.style.height = `${usbData.height_mm * SCALE}px`
    placeAt(usbEl, usbData.x_mm, usbData.y_mm)
    modulePanel.appendChild(usbEl)
    const usbLabel = document.createElement('span')
    usbLabel.className = 'btn-label label-above'
    usbLabel.textContent = 'USB'
    usbEl.appendChild(usbLabel)
  }

  const sdData = connectors?.sd_card
  if (sdData) {
    const sdEl = document.createElement('div')
    sdEl.className = 'connector-body sd-slot-body'
    sdEl.innerHTML = `<div class="sd-slot-opening"></div>`
    sdEl.style.width = `${sdData.width_mm * SCALE}px`
    sdEl.style.height = `${sdData.height_mm * SCALE}px`
    placeAt(sdEl, sdData.x_mm, sdData.y_mm)
    modulePanel.appendChild(sdEl)
    const sdLabel = document.createElement('span')
    sdLabel.className = 'btn-label label-above'
    sdLabel.textContent = 'SD'
    sdEl.appendChild(sdLabel)
  }

  // Ruler ticks
  requestAnimationFrame(() => generateRulerTicks(root))

  return {
    root,
    lcdCanvas: root.querySelector('#lcd-canvas') as HTMLCanvasElement,
    trackBtns,
    subtrackBtns,
    featureBtns,
    stepBtns,
    playBtn,
    resetBtn,
    randBtn,
    backBtn,
    clrBtn,
    patBtn,
    settingsBtn,
    encoderA,
    encoderB,
  }
}

/** Scale the panel on mobile so the main-area fills the viewport width */
export function setupMobileViewport(): void {
  const mq = window.matchMedia('(max-width: 600px)')

  function applyMobileScale(isMobile: boolean): void {
    const panel = document.getElementById('module-panel')
    if (!panel) return

    if (isMobile) {
      // Scale to fit the main area (everything left of jack zone)
      // Rightmost main-area component: encoder B center + half diameter
      const mainAreaRightMM = panelLayout.encoders[1].x_mm + C.encoder_diameter_mm / 2 + C.component_gap_mm
      const mainAreaWidth = mainAreaRightMM * SCALE
      const scale = window.innerWidth / mainAreaWidth
      const scaledH = MODULE_3U_H * scale
      const topMargin = Math.max(0, (window.innerHeight - scaledH) / 2)
      panel.style.transform = `scale(${scale})`
      panel.style.marginLeft = '0'
      panel.style.marginTop = `${topMargin}px`
      // Compensate for transform not affecting document flow
      panel.style.marginBottom = `${MODULE_3U_H * (scale - 1)}px`
    } else {
      panel.style.transform = ''
      panel.style.marginLeft = ''
      panel.style.marginTop = ''
      panel.style.marginBottom = ''
    }
  }

  // Apply on load + orientation/resize changes
  applyMobileScale(mq.matches)
  mq.addEventListener('change', (e) => applyMobileScale(e.matches))
  window.addEventListener('resize', () => {
    if (mq.matches) applyMobileScale(true)
  })
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex render logic
function generateRulerTicks(root: HTMLElement): void {
  const panel = root.querySelector('#module-panel') as HTMLElement
  const hpTrack = root.querySelector('.ruler-hp') as HTMLElement
  const cmTrack = root.querySelector('.ruler-cm') as HTMLElement
  const panelW = panel.offsetWidth

  const panelRect = panel.getBoundingClientRect()
  const hpRect = hpTrack.getBoundingClientRect()
  const cmRect = cmTrack.getBoundingClientRect()

  const panelMM = panelW / SCALE
  const panelHP = Math.round(panelMM / 5.08)
  const panelCM = (panelMM / 10).toFixed(1)

  // HP ruler
  const hpOffset = panelRect.left - hpRect.left
  const hpTrackW = hpTrack.offsetWidth

  let hpHTML = '<span class="ruler-label">HP</span>'
  hpHTML += `<div class="ruler-bracket" style="left:${hpOffset}px; width:${panelW}px;"></div>`
  hpHTML += `<span class="ruler-module-label" style="left:${hpOffset + panelW / 2}px;">${panelHP} HP</span>`

  const hpLeftExtent = Math.ceil(hpOffset / HP_PX / 5) * 5
  const hpRightExtent = panelHP + Math.ceil((hpTrackW - hpOffset - panelW) / HP_PX / 5) * 5
  for (let hp = -hpLeftExtent; hp <= hpRightExtent; hp += 5) {
    const x = hpOffset + hp * HP_PX
    if (x < -1 || x > hpTrackW + 1) continue
    const isMajor = hp % 10 === 0
    const inModule = hp >= 0 && hp <= panelHP
    const cls = isMajor ? 'major' : 'minor'
    const dimCls = inModule ? '' : ' dim-tick'
    hpHTML += `<div class="ruler-tick ${cls}${dimCls}" style="left:${x}px">
      ${isMajor && hp >= 0 ? `<span class="tick-label">${hp}</span>` : ''}
    </div>`
  }
  hpTrack.innerHTML = hpHTML

  // cm ruler
  const cmOffset = panelRect.left - cmRect.left
  const cmTrackW = cmTrack.offsetWidth
  const pxPerCm = 10 * SCALE

  let cmHTML = '<span class="ruler-label">cm</span>'
  cmHTML += `<div class="ruler-bracket" style="left:${cmOffset}px; width:${panelW}px;"></div>`
  cmHTML += `<span class="ruler-module-label" style="left:${cmOffset + panelW / 2}px;">${panelCM} cm</span>`

  const cmLeftExtent = Math.ceil(cmOffset / pxPerCm / 5) * 5
  const cmRightExtent = Math.ceil(panelMM / 10) + Math.ceil((cmTrackW - cmOffset - panelW) / pxPerCm / 5) * 5
  for (let cm = -cmLeftExtent; cm <= cmRightExtent; cm++) {
    const x = cmOffset + cm * pxPerCm
    if (x < -1 || x > cmTrackW + 1) continue
    const isMajor = cm % 5 === 0
    const inModule = cm >= 0 && cm <= Math.ceil(panelMM / 10)
    const cls = isMajor ? 'major' : 'minor'
    const dimCls = inModule ? '' : ' dim-tick'
    cmHTML += `<div class="ruler-tick ${cls}${dimCls}" style="left:${x}px">
      ${isMajor && cm >= 0 ? `<span class="tick-label">${cm}</span>` : ''}
    </div>`
  }
  cmTrack.innerHTML = cmHTML
}

/** Inject the panel CSS styles */
export function injectPanelStyles(): void {
  const style = document.createElement('style')
  style.textContent = PANEL_CSS
  document.head.appendChild(style)
}

const PANEL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: #111;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    font-family: 'JetBrains Mono', monospace;
    overflow: hidden;
  }

  /* ── Rack wrapper ── */
  .rack-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .rack-row { position: relative; }

  /* ── Neighbor modules ── */
  .neighbor-module {
    position: absolute;
    top: 0;
    bottom: 0;
    opacity: 0.25;
    filter: saturate(0.4) brightness(0.8);
    border-top: 2px solid #333;
    border-bottom: 2px solid #333;
    background: #1a1a1e;
    pointer-events: none;
  }
  .neighbor-left { right: 100%; border-left: 2px solid #333; }
  .neighbor-right { left: 100%; border-right: 2px solid #333; }
  .neighbor-module img { display: block; height: 100%; width: auto; }

  /* ── Module column ── */
  .module-column {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }

  /* ── Module panel — true 3U, absolute positioning container ── */
  #module-panel {
    width: ${MODULE_W}px;
    height: ${MODULE_3U_H}px;
    background: linear-gradient(180deg, #2a2a2e 0%, #252528 50%, #222226 100%);
    border: 2px solid #3a3a3e;
    position: relative;
    user-select: none;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
  }

  .panel-title {
    position: absolute;
    top: 8px;
    left: 0; right: 0;
    text-align: center;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 6px;
    color: #aaa;
    pointer-events: none;
    z-index: 5;
  }

  .branding {
    position: absolute;
    bottom: 6px;
    left: 0; right: 0;
    text-align: center;
    font-size: 7px;
    letter-spacing: 3px;
    color: #555;
    pointer-events: none;
    z-index: 5;
  }

  /* ══════════════════════════════════════════
     BUTTON STYLES
     ══════════════════════════════════════════ */

  /* ── Circle buttons (shared base) — plastic tactile cap ── */
  .circle-btn {
    width: ${BTN_D}px;
    height: ${BTN_D}px;
    border-radius: 50%;
    border: 1px solid rgba(0,0,0,0.5);
    cursor: pointer;
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0;
    flex-shrink: 0;
    box-shadow:
      0 1px 2px rgba(0,0,0,0.5),
      0 0.5px 0 rgba(255,255,255,0.06) inset;
    transition: background 0.1s, box-shadow 0.1s, transform 0.05s;
  }
  .circle-btn:active { transform: translate(-50%, -50%) scale(0.92); box-shadow: 0 0.5px 1px rgba(0,0,0,0.3); }
  .circle-btn:active > .btn-label { transform: translateX(-50%) scale(${(1 / 0.92).toFixed(4)}); }
  .circle-btn:focus { outline: none; }

  /* Step buttons use smaller diameter */
  .step-btn {
    width: ${STEP_BTN_D}px;
    height: ${STEP_BTN_D}px;
  }

  /* ── Transport & control strip buttons — same circle style as others ── */
  .transport-btn, .back-btn, .rand-btn, .clr-btn { background: #555; }
  .transport-btn:active, .back-btn:active, .rand-btn:active, .clr-btn:active { background: #777; }
  .rand-btn.active { background: #888; box-shadow: 0 0 4px rgba(255,255,255,0.15); }

  @keyframes clr-pulse {
    0%, 100% { box-shadow: 0 0 6px 1px rgba(233,69,96,0.4); }
    50% { box-shadow: 0 0 14px 4px rgba(233,69,96,0.8); }
  }
  .clr-btn.clr-pending {
    animation: clr-pulse 0.8s ease-in-out infinite;
    border-color: rgba(233,69,96,0.5);
  }

  /* Step buttons — LED glow states */
  .step-btn { background: #444; }
  .step-btn.led-on { background: #e94560; box-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 0 8px rgba(233,69,96,0.5), 0 0 16px rgba(233,69,96,0.2); }
  .step-btn.led-dim { background: #2a2a4a; box-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 0 3px rgba(42,42,74,0.3); }
  .step-btn.led-flash { background: #44ff66; box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 0 10px rgba(68,255,102,0.6), 0 0 20px rgba(68,255,102,0.25); }

  /* Track buttons */
  .track-btn { background: #444; }
  .track-btn.led-on[data-track="0"] { background: #c8566e; box-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 0 8px rgba(200,86,110,0.5), 0 0 16px rgba(200,86,110,0.2); }
  .track-btn.led-on[data-track="1"] { background: #c89040; box-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 0 8px rgba(200,144,64,0.5), 0 0 16px rgba(200,144,64,0.2); }
  .track-btn.led-on[data-track="2"] { background: #5aaa6e; box-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 0 8px rgba(90,170,110,0.5), 0 0 16px rgba(90,170,110,0.2); }
  .track-btn.led-on[data-track="3"] { background: #5aabb4; box-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 0 8px rgba(90,171,180,0.5), 0 0 16px rgba(90,171,180,0.2); }

  /* Subtrack/feature/pat/tbd buttons */
  .subtrack-btn, .feature-btn, .pat-btn { background: #555; }
  .subtrack-btn:active, .feature-btn:active, .pat-btn:active { background: #777; }
  .subtrack-btn.active, .feature-btn.active, .pat-btn.active { background: #888; box-shadow: 0 0 4px rgba(255,255,255,0.15); }

  /* ══════════════════════════════════════════
     LABELS — purely cosmetic, zero layout impact
     ══════════════════════════════════════════ */

  .btn-label {
    position: absolute;
    font-size: ${SILK_TEXT}px;
    font-weight: 600;
    color: #777;
    letter-spacing: 0.5px;
    white-space: nowrap;
    pointer-events: none;
    left: 50%;
    transform: translateX(-50%);
  }

  .label-above {
    bottom: 100%;
    margin-bottom: 2px;
  }

  .label-below {
    top: 100%;
    margin-top: 2px;
  }

  /* ══════════════════════════════════════════
     LED INDICATORS
     ══════════════════════════════════════════ */

  /* Play button states — green LED glow */
  .play-btn.play-on {
    background: #44ff66;
    box-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 0 10px rgba(68,255,102,0.6), 0 0 20px rgba(68,255,102,0.25);
  }
  .play-btn.play-pulse {
    background: #44ff66;
    box-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 0 10px rgba(68,255,102,0.6), 0 0 20px rgba(68,255,102,0.25);
    animation: pulse 0.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* ── Sticky hold pulsing glow ── */
  @keyframes sticky-pulse {
    0%, 100% { box-shadow: 0 0 4px 1px rgba(232,160,191,0.4); }
    50% { box-shadow: 0 0 10px 3px rgba(232,160,191,0.8); }
  }
  .sticky-hold {
    animation: sticky-pulse 1s ease-in-out infinite;
  }

  /* ══════════════════════════════════════════
     MOUNTING SLOTS
     ══════════════════════════════════════════ */

  .screw {
    position: absolute;
    width: ${MOUNT_SLOT_W}px;
    height: ${MOUNT_SLOT_H}px;
    border-radius: ${MOUNT_SLOT_H / 2}px;
    background: #111;
    border: 1px solid #333;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.8), 0 0 1px rgba(255,255,255,0.05);
    z-index: 10;
    transform: translate(-50%, -50%);
  }

  /* ══════════════════════════════════════════
     LCD BEZEL
     ══════════════════════════════════════════ */

  .lcd-bezel {
    background: #1a1a1a;
    border-radius: 2px;
    padding: 2px;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.8);
  }

  .lcd-mask {
    background: #000;
    padding: ${2.0 * SCALE}px;
    border-radius: 1px;
  }

  #lcd-canvas {
    display: block;
    width: ${73.44 * SCALE}px;
    height: ${48.96 * SCALE}px;
    border-radius: 1px;
    image-rendering: pixelated;
  }

  /* ══════════════════════════════════════════
     JACKS
     ══════════════════════════════════════════ */

  .jack-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: absolute;
    transform: translate(-50%, -50%);
  }

  .jack {
    width: ${JACK_D}px;
    height: ${JACK_D}px;
    position: relative;
    cursor: default;
    clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
    background: linear-gradient(155deg, #d8d8d8 0%, #a0a0a0 30%, #c8c8c8 48%, #909090 70%, #b0b0b0 100%);
    box-shadow: 0 1px 3px rgba(0,0,0,0.4);
  }
  .jack::before {
    content: '';
    position: absolute;
    top: 8%; left: 8%;
    width: 84%; height: 84%;
    clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
    background: linear-gradient(155deg, #bbb 0%, #888 40%, #aaa 55%, #777 80%, #999 100%);
  }
  .jack-hole {
    position: absolute;
    top: 50%; left: 50%;
    width: ${JACK_HOLE}px;
    height: ${JACK_HOLE}px;
    border-radius: 50%;
    background: radial-gradient(circle, #050505, #111);
    transform: translate(-50%, -50%);
    box-shadow: inset 0 2px 4px rgba(0,0,0,0.95);
    z-index: 1;
  }

  /* ══════════════════════════════════════════
     ENCODERS
     ══════════════════════════════════════════ */

  .encoder-cell {
    position: absolute;
    transform: translate(-50%, -50%);
  }

  .encoder {
    width: ${ENCODER_D}px;
    height: ${ENCODER_D}px;
    border-radius: 50%;
    position: relative;
    cursor: grab;
    flex-shrink: 0;
    background: conic-gradient(
      from 0deg,
      #3a3a3a 0%, #2e2e2e 8%, #3c3c3c 16%, #2a2a2a 24%,
      #383838 32%, #2c2c2c 40%, #3a3a3a 48%, #2e2e2e 56%,
      #3c3c3c 64%, #2a2a2a 72%, #383838 80%, #2c2c2c 88%, #3a3a3a 100%
    );
    border: 1px solid #1a1a1a;
    box-shadow:
      0 3px 8px rgba(0,0,0,0.6),
      0 1px 2px rgba(0,0,0,0.4),
      inset 0 0.5px 0 rgba(255,255,255,0.08);
  }
  .encoder:active { cursor: grabbing; }

  .encoder-cap {
    position: absolute;
    top: 6%; left: 6%;
    width: 88%; height: 88%;
    border-radius: 50%;
    background: linear-gradient(165deg, #2a2a2a 0%, #1a1a1a 60%, #222 100%);
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.6), 0 -0.5px 0 rgba(255,255,255,0.05);
  }

  .encoder-indicator {
    position: absolute;
    top: 4%; left: calc(50% - 1px);
    width: 2px; height: 40%;
    background: #ddd;
    border-radius: 1px;
    transform-origin: center bottom;
  }

  /* ══════════════════════════════════════════
     CONNECTORS (USB-C, SD card)
     ══════════════════════════════════════════ */

  /* Connector bodies — sized via inline style from JSON dimensions */
  .usb-c-body, .sd-slot-body {
    position: relative;
    background: linear-gradient(90deg, #888 0%, #666 50%, #777 100%);
    border: 1px solid #555;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 1px 2px rgba(0,0,0,0.4), inset 0 0.5px 0 rgba(255,255,255,0.15);
  }

  .usb-c-body {
    border-radius: ${USB_C_H * 0.4}px;
  }

  .sd-slot-body {
    border-radius: 2px;
  }

  .usb-c-port {
    width: 45%;
    height: 65%;
    background: #1a1a1a;
    border-radius: ${USB_C_H * 0.18}px;
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.8);
  }

  .sd-slot-opening {
    width: 50%;
    height: 75%;
    background: #1a1a1a;
    border-radius: 1px;
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.8);
  }

  /* ══════════════════════════════════════════
     RULER
     ══════════════════════════════════════════ */

  .ruler {
    position: relative;
    height: 40px;
    overflow: visible;
    width: 100vw;
    margin-top: 22px;
  }
  .ruler-track { position: relative; height: 16px; margin-left: 28px; }
  .ruler-label {
    position: absolute; left: -28px; top: 0;
    font-size: 7px; color: #555; letter-spacing: 1px; line-height: 16px;
  }
  .ruler-bracket {
    position: absolute; top: 0; height: 2px;
    background: #555; border-left: 1px solid #777; border-right: 1px solid #777;
  }
  .ruler-bracket::before, .ruler-bracket::after {
    content: ''; position: absolute; top: -2px; width: 1px; height: 6px; background: #777;
  }
  .ruler-bracket::before { left: 0; }
  .ruler-bracket::after { right: 0; }
  .ruler-module-label {
    position: absolute; top: -14px; transform: translateX(-50%);
    font-size: 9px; font-weight: 600; color: #888; letter-spacing: 1px; white-space: nowrap;
  }
  .ruler-tick { position: absolute; top: 4px; width: 1px; background: #3a3a3e; }
  .ruler-tick.major { height: 10px; background: #555; }
  .ruler-tick.minor { height: 6px; background: #3a3a3e; }
  .ruler-tick.dim-tick { opacity: 0.4; }
  .tick-label {
    position: absolute; top: -1px; left: 3px;
    font-size: 7px; color: #555; white-space: nowrap; line-height: 10px;
  }
  .dim-tick .tick-label { opacity: 0.5; }

  /* ══════════════════════════════════════════
     TOUCH / MOBILE
     ══════════════════════════════════════════ */

  .circle-btn, .encoder {
    touch-action: none;
  }

  #module-panel {
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }

  @media (max-width: 600px) {
    body {
      display: block;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: none;
      height: auto;
    }

    .neighbor-module,
    .ruler {
      display: none !important;
    }

    #shortcut-hints {
      display: none;
    }

    #module-panel {
      transform-origin: top left;
    }

    .rack-wrapper,
    .rack-row,
    .module-column {
      display: block;
    }
  }
`
