/**
 * Module faceplate — 3U eurorack panel with control strip layout.
 * True 3U height (128.5mm = 578px at 4.5px/mm).
 *
 * Layout (left to right):
 *   Track column (T1-T4) | LCD (480×320) | Right col 1 (GATE/PTCH/VEL/MOD) | Right col 2 (MUTE/ROUTE/DIV-LEN/TBD) | Jacks
 *   Control strip: RESET, PLAY, RAND (8×16mm rect) | Encoder A, Encoder B
 *   Below control strip: 2×8 step button grid (centered under LCD)
 *
 * Spacing rules:
 *   - Small buttons use BTN_CC (10.7mm) center-to-center spacing
 *   - Transport buttons (RESET/PLAY/RAND) are RECT_BTN_W×RECT_BTN_H (8×16mm)
 *   - Buttons need ≥ BTN_CC/2 clearance from LCD, encoders, jacks, panel edges
 *   - Labels are purely cosmetic: absolute-positioned, bold, zero layout impact
 *   - Step buttons use same BTN_CC (10.7mm) center-to-center as all panel buttons
 */

// ── Eurorack dimension constants (4.5 px/mm) ──────────────────────
const SCALE = 4.5
const HP_PX = 5.08 * SCALE          // 22.86px per HP
const MODULE_3U_H = 128.5 * SCALE   // 578px — standard 3U height
const RAIL_ZONE = 10.0 * SCALE      // 45px — rack rail clearance zone (top/bottom)
const MOUNT_SLOT_W = 7.0 * SCALE    // 32px — Intellijel oval slot width
const MOUNT_SLOT_H = 3.5 * SCALE    // 16px — Intellijel oval slot height
const MOUNT_X = 7.2 * SCALE         // 33px from panel edge
const MOUNT_Y = 3.4 * SCALE         // 15px from panel edge
const JACK_D = 10.0 * SCALE         // 45px — Thonkiconn hex nut
const JACK_HOLE = 3.5 * SCALE       // 16px — 3.5mm socket opening
const JACK_SPACING = 14.0 * SCALE   // 63px — cable clearance
const ENCODER_D = 14.5 * SCALE      // 65px — encoder knob
const BTN_D = 5.0 * SCALE           // 23px — tactile button cap
const BTN_CC = 10.7 * SCALE         // 48px — button center-to-center
const STEP_BTN_D = 4.5 * SCALE      // 20px — step button (slightly smaller)
const STEP_BTN_CC = 7.0 * SCALE     // 32px — step button center-to-center
const RECT_BTN_W = 8.0 * SCALE      // 36px — rectangular button width
const RECT_BTN_H = 16.0 * SCALE     // 72px — rectangular button height

const SILK_TEXT = 10                 // ~2.2mm silkscreen text
const LCD_CLEARANCE = 3.0 * SCALE   // 13.5px — PCB clearance

// Clearance: half a button center-to-center — minimum gap between buttons and other components
const COMPONENT_GAP = Math.round(BTN_CC / 2)  // 24px = ~5.3mm

// Derived
const JACK_GAP = JACK_SPACING - JACK_D
const OUTPUT_JACK_SPACING = 12.4 * SCALE
const BTN_GAP = BTN_CC - BTN_D              // 25px — gap between button edges at BTN_CC spacing
const STEP_GAP = STEP_BTN_CC - STEP_BTN_D   // 12px — gap between step button edges
const LCD_BEZEL_W = Math.round(73.44 * SCALE) + 2 * Math.round(2.0 * SCALE) + 4
const STEP_ROW_W = 8 * STEP_BTN_D + 7 * BTN_GAP
const STEP_GRID_LEFT = BTN_D + COMPONENT_GAP + Math.round((LCD_BEZEL_W - STEP_ROW_W) / 2)

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
  encoderA: HTMLDivElement
  encoderB: HTMLDivElement
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
          <div class="screw screw-tl"></div>
          <div class="screw screw-tr"></div>
          <div class="screw screw-bl"></div>
          <div class="screw screw-br"></div>

          <div class="panel-title">REQUENCER</div>

          <div class="module-content">
            <!-- MAIN AREA: everything except jacks -->
            <div class="main-area">
              <!-- TOP SECTION: track col | LCD | right cols -->
              <div class="top-section">
                <div class="track-col" id="track-btn-group"></div>

                <div class="lcd-bezel">
                  <div class="lcd-mask">
                    <canvas id="lcd-canvas"></canvas>
                  </div>
                </div>

                <div class="right-col" id="subtrack-col"></div>
                <div class="right-col" id="feature-col"></div>
              </div>

              <!-- CONTROL STRIP: transport + RAND + encoders -->
              <div class="control-strip">
                <div class="control-strip-left" id="control-strip-btns"></div>
                <div class="control-strip-right">
                  <div class="encoder-cell">
                    <span class="btn-label label-above">A</span>
                    <div class="encoder" id="encoder-a">
                      <div class="encoder-cap">
                        <div class="encoder-indicator"></div>
                      </div>
                    </div>
                  </div>
                  <div class="encoder-cell">
                    <span class="btn-label label-above">B</span>
                    <div class="encoder" id="encoder-b">
                      <div class="encoder-cap">
                        <div class="encoder-indicator"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- STEP GRID 2×8 -->
              <div class="step-grid" id="step-grid"></div>
            </div>

            <!-- JACK ZONE: right side, spans full height -->
            <div class="zone-divider"></div>
            <div class="jack-zone">
              <div class="utility-jacks">
                <div class="jack-row-2">
                  <div class="jack-cell"><span class="btn-label label-above">CLK IN</span><div class="jack"><div class="jack-hole"></div></div></div>
                  <div class="jack-cell"><span class="btn-label label-above">CLK OUT</span><div class="jack"><div class="jack-hole"></div></div></div>
                </div>
                <div class="jack-row-2">
                  <div class="jack-cell"><span class="btn-label label-above">RST IN</span><div class="jack"><div class="jack-hole"></div></div></div>
                  <div class="jack-cell"><span class="btn-label label-above">RST OUT</span><div class="jack"><div class="jack-hole"></div></div></div>
                </div>
                <div class="jack-row-2">
                  <div class="jack-cell"><span class="btn-label label-above">MIDI IN</span><div class="jack"><div class="jack-hole"></div></div></div>
                  <div class="jack-cell"><span class="btn-label label-above">MIDI OUT</span><div class="jack"><div class="jack-hole"></div></div></div>
                </div>
              </div>
              <div class="jack-grid" id="jack-grid">
                <div class="jack-grid-row cv-row">
                  <div class="jack-cell"><div class="jack"><div class="jack-hole"></div></div><span class="btn-label label-below">A</span></div>
                  <div class="jack-cell"><div class="jack"><div class="jack-hole"></div></div><span class="btn-label label-below">B</span></div>
                  <div class="jack-cell"><div class="jack"><div class="jack-hole"></div></div><span class="btn-label label-below">C</span></div>
                  <div class="jack-cell"><div class="jack"><div class="jack-hole"></div></div><span class="btn-label label-below">D</span></div>
                </div>
              </div>
            </div>
          </div>

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

  // --- Generate track buttons (T1-T4) ---
  const trackBtnGroup = root.querySelector('#track-btn-group') as HTMLDivElement
  const trackBtns: HTMLButtonElement[] = []
  for (let i = 0; i < 4; i++) {
    const btn = document.createElement('button')
    btn.className = 'circle-btn track-btn'
    btn.dataset.track = String(i)
    const label = document.createElement('span')
    label.className = 'btn-label label-above'
    label.textContent = `T${i + 1}`
    btn.appendChild(label)
    trackBtnGroup.appendChild(btn)
    trackBtns.push(btn)
  }

  // --- Generate subtrack buttons (GATE, PTCH, VEL, MOD) ---
  const subtrackCol = root.querySelector('#subtrack-col') as HTMLDivElement
  const subtrackBtns: HTMLButtonElement[] = []
  const subtrackLabels = ['GATE', 'PTCH', 'VEL', 'MOD']
  for (let i = 0; i < 4; i++) {
    const btn = document.createElement('button')
    btn.className = 'circle-btn subtrack-btn'
    btn.dataset.index = String(i)
    const label = document.createElement('span')
    label.className = 'btn-label label-above'
    label.textContent = subtrackLabels[i]
    btn.appendChild(label)
    subtrackCol.appendChild(btn)
    subtrackBtns.push(btn)
  }

  // --- Generate feature buttons (MUTE, ROUTE, DIV/LEN) — overlay-only column ---
  const featureCol = root.querySelector('#feature-col') as HTMLDivElement
  const featureBtns: HTMLButtonElement[] = []
  const featureLabels = ['MUTE', 'ROUTE', 'DIV/LEN', 'TBD']
  for (let i = 0; i < 4; i++) {
    const btn = document.createElement('button')
    btn.className = 'circle-btn feature-btn'
    btn.dataset.index = String(i)
    const label = document.createElement('span')
    label.className = 'btn-label label-above'
    label.textContent = featureLabels[i]
    btn.appendChild(label)
    featureCol.appendChild(btn)
    featureBtns.push(btn)
  }

  // --- Generate step grid (2 rows of 8) ---
  const stepGrid = root.querySelector('#step-grid') as HTMLDivElement
  const stepBtns: HTMLButtonElement[] = []
  for (let row = 0; row < 2; row++) {
    const rowEl = document.createElement('div')
    rowEl.className = 'step-row'
    for (let col = 0; col < 8; col++) {
      const idx = row * 8 + col
      const btn = document.createElement('button')
      btn.className = 'circle-btn step-btn'
      btn.dataset.step = String(idx)
      btn.dataset.track = '0'  // default, updated by LED state
      rowEl.appendChild(btn)
      stepBtns.push(btn)
    }
    stepGrid.appendChild(rowEl)
  }

  // --- Generate control strip buttons (RESET, PLAY, RAND) ---
  const controlStripBtns = root.querySelector('#control-strip-btns') as HTMLDivElement

  const resetBtn = document.createElement('button')
  resetBtn.className = 'circle-btn large-btn transport-btn'
  const resetLabel = document.createElement('span')
  resetLabel.className = 'btn-label label-below'
  resetLabel.textContent = 'RESET'
  resetBtn.appendChild(resetLabel)
  controlStripBtns.appendChild(resetBtn)

  const playBtn = document.createElement('button')
  playBtn.className = 'circle-btn large-btn transport-btn play-btn'
  const playLabel = document.createElement('span')
  playLabel.className = 'btn-label label-below'
  playLabel.textContent = 'PLAY'
  playBtn.appendChild(playLabel)
  controlStripBtns.appendChild(playBtn)

  const randBtn = document.createElement('button')
  randBtn.className = 'circle-btn large-btn rand-btn'
  const randLabel = document.createElement('span')
  randLabel.className = 'btn-label label-below'
  randLabel.textContent = 'RAND'
  randBtn.appendChild(randLabel)
  controlStripBtns.appendChild(randBtn)

  // --- Generate output jack rows (OUT 1-4) ---
  const jackGrid = root.querySelector('#jack-grid') as HTMLDivElement
  const cvRow = jackGrid.querySelector('.cv-row') as HTMLDivElement
  const outColLabels = ['GATE', 'PTCH', 'VEL', 'MOD']

  for (let t = 0; t < 4; t++) {
    const row = document.createElement('div')
    row.className = 'jack-grid-row out-row'
    row.innerHTML = [0, 1, 2, 3].map(c => `
      <div class="jack-cell">
        ${t === 0 ? `<span class="btn-label label-above">${outColLabels[c]}</span>` : ''}
        <div class="jack"><div class="jack-hole"></div></div>
      </div>
    `).join('')
    jackGrid.insertBefore(row, cvRow)
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
    encoderA: root.querySelector('#encoder-a') as HTMLDivElement,
    encoderB: root.querySelector('#encoder-b') as HTMLDivElement,
  }
}

/** Scale the panel on mobile so the main-area fills the viewport width */
export function setupMobileViewport(): void {
  const mq = window.matchMedia('(max-width: 600px)')

  function applyMobileScale(isMobile: boolean): void {
    const panel = document.getElementById('module-panel')
    if (!panel) return

    if (isMobile) {
      const mainArea = panel.querySelector('.main-area') as HTMLElement
      if (!mainArea) return
      // Reset transform to measure natural width
      panel.style.transform = ''
      const visibleWidth = mainArea.offsetLeft + mainArea.offsetWidth + mainArea.offsetLeft
      const scale = window.innerWidth / visibleWidth
      const scaledH = panel.offsetHeight * scale
      const topMargin = Math.max(0, (window.innerHeight - scaledH) / 2)
      panel.style.transform = `scale(${scale})`
      panel.style.marginLeft = '0'
      panel.style.marginTop = `${topMargin}px`
      // Compensate for transform not affecting document flow
      panel.style.marginBottom = `${panel.offsetHeight * (scale - 1)}px`
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

  /* ── Module panel — true 3U with rail clearance ── */
  #module-panel {
    height: ${MODULE_3U_H}px;
    background: linear-gradient(180deg, #2a2a2e 0%, #252528 50%, #222226 100%);
    border: 2px solid #3a3a3e;
    padding: ${RAIL_ZONE}px ${COMPONENT_GAP}px;
    position: relative;
    user-select: none;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
    display: flex;
    flex-direction: column;
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

  /* ── Module content: main area + jacks ── */
  .module-content {
    display: flex;
    gap: 0;
    flex: 1;
    min-height: 0;
  }

  /* ── Main area: all controls except jacks ── */
  .main-area {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  /* ── Top section: track col | LCD | right button cols ── */
  .top-section {
    display: flex;
    align-items: center;    /* vertically center buttons alongside LCD */
    gap: ${COMPONENT_GAP}px;   /* clearance between columns and LCD */
  }

  /* ── Button columns (track, subtrack, feature) ── */
  .track-col,
  .right-col {
    display: flex;
    flex-direction: column;
    gap: ${BTN_GAP}px;         /* BTN_CC - BTN_D = proper center-to-center */
    flex-shrink: 0;
  }

  /* ── Zone divider ── */
  .zone-divider {
    width: 1px;
    background: linear-gradient(180deg, transparent 5%, #444 50%, transparent 95%);
    margin: 0 ${Math.round(COMPONENT_GAP * 0.6)}px;
    align-self: stretch;
  }

  /* ── Jack zone: spans full panel height ── */
  .jack-zone {
    display: flex;
    flex-direction: column;
    gap: ${JACK_GAP}px;
    flex-shrink: 0;
    width: ${4 * JACK_SPACING}px;
  }

  /* ── LCD bezel ── */
  .lcd-bezel {
    background: #1a1a1a;
    border-radius: 2px;
    padding: 2px;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.8);
    flex-shrink: 0;
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

  /* ── Control strip: transport + RAND + encoders ── */
  .control-strip {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: ${COMPONENT_GAP}px;
    margin-top: ${COMPONENT_GAP}px;
  }

  .control-strip-left {
    display: flex;
    gap: ${Math.round(RECT_BTN_W * 0.4)}px;
    align-items: center;
  }

  .control-strip-right {
    display: flex;
    gap: ${Math.round(COMPONENT_GAP * 0.8)}px;
    align-items: center;
  }

  .encoder-cell {
    position: relative;          /* for absolute label */
    flex-shrink: 0;
  }

  /* ── Encoder knob ── */
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

  /* ── Step button grid (2×8) ── */
  .step-grid {
    display: flex;
    flex-direction: column;
    gap: ${BTN_GAP}px;
    margin-top: ${COMPONENT_GAP}px;
    margin-left: ${STEP_GRID_LEFT}px;
  }

  .step-row {
    display: flex;
    gap: ${BTN_GAP}px;
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
    position: relative;      /* anchor for absolute labels */
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
  .circle-btn:active { transform: scale(0.92); box-shadow: 0 0.5px 1px rgba(0,0,0,0.3); }
  .circle-btn:active > .btn-label { transform: translateX(-50%) scale(${(1 / 0.92).toFixed(4)}); }
  .circle-btn:focus { outline: none; }

  /* ── Large buttons (RESET, PLAY, RAND in control strip) — must come after circle-btn ── */
  .large-btn {
    width: ${RECT_BTN_W}px;
    height: ${RECT_BTN_H}px;
    border-radius: ${2.0 * SCALE}px;
  }

  .rand-btn { background: #555; }
  .rand-btn:active { background: #777; }
  .rand-btn.active { background: #888; box-shadow: 0 0 4px rgba(255,255,255,0.15); }

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

  /* Subtrack/feature buttons */
  .subtrack-btn, .feature-btn { background: #555; }
  .subtrack-btn:active, .feature-btn:active { background: #777; }
  .subtrack-btn.active, .feature-btn.active { background: #888; box-shadow: 0 0 4px rgba(255,255,255,0.15); }

  /* Transport buttons */
  .transport-btn { background: #aaa; }
  .transport-btn:active { background: #ccc; }

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

  /* Play button states — whole button lights up */
  .play-btn.play-on {
    background: #44ff66;
    box-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 0 10px rgba(68,255,102,0.5), 0 0 20px rgba(68,255,102,0.2);
  }
  .play-btn.play-pulse {
    background: #44ff66;
    box-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 0 10px rgba(68,255,102,0.5), 0 0 20px rgba(68,255,102,0.2);
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
  }
  .screw-tl { top: ${MOUNT_Y}px; left: ${MOUNT_X}px; transform: translate(-50%, -50%); }
  .screw-tr { top: ${MOUNT_Y}px; right: ${MOUNT_X}px; transform: translate(50%, -50%); }
  .screw-bl { bottom: ${MOUNT_Y}px; left: ${MOUNT_X}px; transform: translate(-50%, 50%); }
  .screw-br { bottom: ${MOUNT_Y}px; right: ${MOUNT_X}px; transform: translate(50%, 50%); }

  /* ══════════════════════════════════════════
     JACKS
     ══════════════════════════════════════════ */

  .utility-jacks {
    display: flex;
    flex-direction: column;
    gap: ${JACK_GAP}px;
  }

  .jack-row-2 {
    display: grid;
    grid-template-columns: repeat(2, ${JACK_SPACING}px);
    align-items: center;
    justify-items: center;
  }

  .jack-grid {
    display: flex;
    flex-direction: column;
    gap: ${OUTPUT_JACK_SPACING - JACK_D}px;
  }

  .jack-grid-row {
    display: grid;
    grid-template-columns: repeat(4, ${JACK_SPACING}px);
    align-items: center;
    justify-items: center;
    position: relative;
  }

  .jack-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;        /* anchor for absolute labels */
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
      width: max-content;
    }

    .rack-wrapper,
    .rack-row,
    .module-column {
      display: block;
    }
  }
`
