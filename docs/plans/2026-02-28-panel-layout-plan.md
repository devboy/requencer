# Panel Layout Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure the panel layout with a control strip (RESET/PLAY/RAND + encoders), overlay-only right column (MUTE/ROUTE/DIV-LEN), and aligned step grid.

**Architecture:** DOM restructure in faceplate.ts, event rebinding in controls.ts, new hold-combo behavior for DIV/LEN in mode-machine.ts, updated overlay rendering in hold-overlay.ts. Types stay backward-compatible — FeatureId keeps 'rand' and 'div', only DOM positions and labels change.

**Tech Stack:** TypeScript, Vitest, HTML/CSS (no canvas changes except hold-overlay content)

---

### Task 1: Add DIV/LEN hold+encoder behavior (TDD)

When holding the DIV button and turning encoders, modify the selected track's length (enc A) and clock divider (enc B). Currently DIV hold+encoder is a no-op (falls through to the unhandled case in `dispatchHoldCombo`).

**Files:**
- Test: `src/ui/__tests__/mode-machine.test.ts`
- Modify: `src/ui/mode-machine.ts:675-689`

**Step 1: Write failing tests**

Add inside the existing `describe('hold combos')` block, after the `hold mute + encoder` describe:

```typescript
describe('hold div + encoder', () => {
  it('hold div + enc A changes all subtrack lengths', () => {
    const ui = holdUI({ kind: 'feature', feature: 'div' })
    const eng = makeState()
    const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 2 })
    expect(result.engine.tracks[0].gate.length).toBe(18)
    expect(result.engine.tracks[0].pitch.length).toBe(18)
    expect(result.engine.tracks[0].velocity.length).toBe(18)
    expect(result.engine.tracks[0].mod.length).toBe(18)
    expect(result.ui.holdEncoderUsed).toBe(true)
  })

  it('hold div + enc B changes track clock divider', () => {
    const ui = holdUI({ kind: 'feature', feature: 'div' })
    const eng = makeState()
    const result = dispatch(ui, eng, { type: 'encoder-b-turn', delta: 1 })
    expect(result.engine.tracks[0].clockDivider).toBe(2)
    expect(result.ui.holdEncoderUsed).toBe(true)
  })

  it('hold div uses selectedTrack', () => {
    const ui = { ...holdUI({ kind: 'feature', feature: 'div' }), selectedTrack: 2 }
    const eng = makeState()
    const result = dispatch(ui, eng, { type: 'encoder-a-turn', delta: 3 })
    expect(result.engine.tracks[2].gate.length).toBe(19)
    expect(result.engine.tracks[0].gate.length).toBe(16) // unchanged
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 3 FAIL — hold div + encoder combos return unchanged engine state (falls through to no-op)

**Step 3: Implement in mode-machine.ts**

In `dispatchHoldCombo()`, add a new block after the `held.feature === 'mute'` block (after line 686):

```typescript
if (held.kind === 'feature' && held.feature === 'div') {
  if (event.type === 'encoder-a-turn') {
    // Hold div + enc A = all subtrack lengths (synced)
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
    // Hold div + enc B = track clock divider
    const cur = engine.tracks[trackIdx].clockDivider
    return { ui: uiUsed, engine: setTrackClockDivider(engine, trackIdx, cur + event.delta) }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/ui/__tests__/mode-machine.test.ts src/ui/mode-machine.ts
git commit -m "feat: add hold DIV + encoder combo for length/divider"
```

---

### Task 2: Add DIV/LEN hold overlay rendering

Show all 4 tracks' lengths and dividers when holding the DIV/LEN button.

**Files:**
- Modify: `src/ui/lcd/hold-overlay.ts:55-65`

**Step 1: Add DIV/LEN overlay block**

After the `held.feature === 'mute'` block (line 64), add:

```typescript
if (held.kind === 'feature' && held.feature === 'div') {
  drawText(ctx, 'DIV / LEN', PAD, LCD_CONTENT_Y + 30, COLORS.textBright, 18)

  const rowH = 28
  const startY = LCD_CONTENT_Y + 60
  for (let t = 0; t < 4; t++) {
    const track = engine.tracks[t]
    const y = startY + t * rowH
    const color = t === trackIdx ? COLORS.track[t] : COLORS.textDim
    const marker = t === trackIdx ? '>' : ' '
    drawText(ctx, `${marker}T${t + 1}  LEN:${String(track.gate.length).padStart(2)}  DIV:÷${track.clockDivider}`, PAD, y, color, 16)
  }

  drawText(ctx, 'ENC A: length  ENC B: divider', PAD, LCD_CONTENT_Y + LCD_CONTENT_H - 20, COLORS.textDim, 16)
}
```

**Step 2: Verify visually**

Run: `npm run dev`
Hold F key (DIV button) — overlay should show all 4 tracks' length and divider values with the selected track highlighted.

**Step 3: Commit**

```bash
git add src/ui/lcd/hold-overlay.ts
git commit -m "feat: add DIV/LEN hold overlay showing all tracks"
```

---

### Task 3: Add LARGE_BTN_D constant and restructure panel DOM

Move RESET/PLAY/RAND into a control strip row with encoders. Remove RAND from feature column. Rename DIV to DIV/LEN. Reduce feature column from 4 to 3 buttons.

**Files:**
- Modify: `src/ui/panel/faceplate.ts` (constants, HTML template, button generation, CSS, FaceplateElements)

**Step 1: Add large button constant**

After `STEP_BTN_CC` (line 34), add:

```typescript
const LARGE_BTN_D = 14.0 * SCALE    // 63px — large tactile button (matches encoder height)
```

**Step 2: Add `randBtn` to FaceplateElements**

Update the `FaceplateElements` interface to include:

```typescript
export interface FaceplateElements {
  root: HTMLDivElement
  lcdCanvas: HTMLCanvasElement
  trackBtns: HTMLButtonElement[]
  subtrackBtns: HTMLButtonElement[]
  featureBtns: HTMLButtonElement[]
  stepBtns: HTMLButtonElement[]
  playBtn: HTMLButtonElement
  resetBtn: HTMLButtonElement
  randBtn: HTMLButtonElement          // NEW
  encoderA: HTMLDivElement
  encoderB: HTMLDivElement
}
```

**Step 3: Restructure HTML template**

Replace the encoder row, step grid, and transport sections in the HTML template:

Old (lines 111-135):
```html
<!-- ENCODER ROW -->
<div class="encoder-row">...</div>

<!-- STEP GRID 2×8 -->
<div class="step-grid" id="step-grid"></div>

<!-- TRANSPORT -->
<div class="transport-row" id="transport-row"></div>
```

New:
```html
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
```

**Step 4: Update feature button generation**

Change feature labels from `['MUTE', 'ROUTE', 'RAND', 'DIV']` to `['MUTE', 'ROUTE', 'DIV/LEN']` and generate only 3 buttons.

**Step 5: Generate control strip buttons**

Replace the transport button generation (old `#transport-row` code) with control strip button generation:

```typescript
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
```

**Step 6: Update return object**

Add `randBtn` to the return object:

```typescript
return {
  root,
  lcdCanvas: root.querySelector('#lcd-canvas') as HTMLCanvasElement,
  trackBtns,
  subtrackBtns,
  featureBtns,
  stepBtns,
  playBtn,
  resetBtn,
  randBtn,            // NEW
  encoderA: root.querySelector('#encoder-a') as HTMLDivElement,
  encoderB: root.querySelector('#encoder-b') as HTMLDivElement,
}
```

**Step 7: Add CSS for control strip and large buttons**

Replace `.encoder-row` and `.transport-row` CSS with:

```css
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
  gap: ${Math.round(LARGE_BTN_D * 0.3)}px;
  align-items: center;
}

.control-strip-right {
  display: flex;
  gap: ${Math.round(COMPONENT_GAP * 0.8)}px;
  align-items: center;
}

/* ── Large buttons (RESET, PLAY, RAND) ── */
.large-btn {
  width: ${LARGE_BTN_D}px;
  height: ${LARGE_BTN_D}px;
}

.rand-btn {
  background: #555;
}
.rand-btn:active {
  background: #777;
}
.rand-btn.active {
  background: #888;
  box-shadow: 0 0 4px rgba(255,255,255,0.15);
}
```

Update step grid CSS: remove `align-self: center`, align to LCD width using a max-width or match the LCD bezel width.

**Step 8: Run dev server and verify layout**

Run: `npm run dev`
Expected: Control strip between LCD area and step grid. RAND visible in strip. Feature column has 3 buttons.

**Step 9: Run build check**

Run: `npm run build`
Expected: Clean, no type errors

**Step 10: Commit**

```bash
git add src/ui/panel/faceplate.ts
git commit -m "feat: restructure panel with control strip layout"
```

---

### Task 4: Update controls.ts for new DOM structure

RAND moves from feature column to control strip. Feature column drops to 3 buttons. RAND in the control strip is NOT holdable (tap-only, like transport buttons). Update mode indicators.

**Files:**
- Modify: `src/ui/panel/controls.ts`

**Step 1: Update FEATURE_IDS**

```typescript
const FEATURE_IDS: FeatureId[] = ['mute', 'route', 'div']
```

**Step 2: Add RAND button binding**

After the transport button bindings, add RAND handler. RAND emits the same `feature-press` event but is NOT holdable:

```typescript
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
```

**Step 3: Update updateModeIndicators**

Change the `featureModes` array from 4 to 3 entries:

```typescript
const featureModes = ['mute-edit', 'route', 'div']
```

Add RAND mode indicator on the control strip `randBtn`. This requires passing `randBtn` or handling it separately. Simplest approach: add a `randBtn` parameter:

```typescript
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
  for (let i = 0; i < featureBtns.length; i++) {
    featureBtns[i].classList.toggle('active', mode === featureModes[i])
  }
  randBtn.classList.toggle('active', mode === 'rand')
}
```

**Step 4: Update global click handler**

Add `.rand-btn` and `.large-btn` to the interactive controls selector so clicks on them don't dismiss sticky hold:

```typescript
if (target.closest('.track-btn, .subtrack-btn, .feature-btn, .step-btn, .encoder, .transport-btn, .rand-btn, .large-btn')) return
```

**Step 5: Update PanelControls interface and stored reference**

Add `randBtn` to PanelControls if needed for LED updates. Currently only step, track, and play buttons are stored.

**Step 6: Commit**

```bash
git add src/ui/panel/controls.ts
git commit -m "feat: rebind RAND to control strip, update feature column"
```

---

### Task 5: Update main.ts for new API

The `updateModeIndicators` call gains a `randBtn` parameter. The SHORTCUT_HINTS for 'div' mode updates.

**Files:**
- Modify: `src/main.ts:145-158,204`

**Step 1: Update updateModeIndicators call**

```typescript
updateModeIndicators(panel.subtrackBtns, panel.featureBtns, panel.randBtn, uiState.mode)
```

**Step 2: Update MODE_STATUS for 'div'**

```typescript
'div': (ui) => `T${ui.selectedTrack + 1} DIV / LEN`,
```

**Step 3: Update SHORTCUT_HINTS for 'div'**

```typescript
'div': '↑↓: length  ←→: divider  Esc: back',
```

**Step 4: Run build**

Run: `npm run build`
Expected: Clean

**Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: update main.ts for control strip API"
```

---

### Task 6: Update keyboard bindings and help modal

RAND moves from D key to its own dedicated key. Since RAND is now in the control strip (not a feature button), we need to decide: keep D → RAND? Or remap?

Simplest: keep the same key bindings (D → RAND, F → DIV/LEN). The keyboard still emits `feature-press` events with the same feature IDs. No functional change needed in `input.ts` — the `FEATURE_KEYS` map still works because the mode machine handles `feature-press` events regardless of which DOM element originated them.

But `findPanelButton` in input.ts needs updating: it currently looks up feature buttons by index in `['mute', 'route', 'rand', 'div']`. With RAND removed from the feature column, index lookup breaks.

**Files:**
- Modify: `src/ui/input.ts:133-146`
- Modify: `src/ui/help-modal.ts:30-37`

**Step 1: Update findPanelButton**

The `'feature'` case currently maps feature name → index in the old 4-button array. With the new 3-button column, 'rand' doesn't have an index. Handle it specially:

```typescript
case 'feature': {
  if (button.feature === 'rand') {
    return document.querySelector('.rand-btn')
  }
  const idx = (['mute', 'route', 'div'] as const).indexOf(button.feature as 'mute' | 'route' | 'div')
  return document.querySelector(`.feature-btn[data-index="${idx}"]`)
}
```

**Step 2: Update help modal**

Change the FEATURES section:

```typescript
{
  title: 'FEATURES',
  keys: [
    ['A', 'Mute patterns'],
    ['S', 'Route outputs'],
    ['D', 'Randomizer'],
    ['F', 'Dividers / Length'],
  ],
},
```

Update HOLD COMBOS section — add DIV/LEN hold combo:

```typescript
{
  title: 'HOLD COMBOS',
  keys: [
    ['Hold 1–4 + ↑↓', 'All subtrack lengths / track divider'],
    ['Hold Q/W/E/R + ↑↓', 'Individual subtrack length / divider'],
    ['Hold A + ↑↓', 'Mute length / divider'],
    ['Hold F + ↑↓', 'Track length / divider (all tracks visible)'],
    ['Hold 1–4 + D', 'Randomize entire track'],
    ['Hold Q/W/E + D', 'Randomize gate / pitch / velocity only'],
    ['Hold 1–4 + Backspace', 'Reset track playheads'],
    ['Hold Q/W/E/R + ⌫', 'Reset subtrack playhead'],
    ['Double-tap key', 'Sticky hold (tap again to release)'],
  ],
},
```

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 4: Run build**

Run: `npm run build`
Expected: Clean

**Step 5: Commit**

```bash
git add src/ui/input.ts src/ui/help-modal.ts
git commit -m "feat: update keyboard bindings and help for new layout"
```

---

### Task 7: Update faceplate comment header

Update the file-level comment in `faceplate.ts` to reflect the new layout.

**Files:**
- Modify: `src/ui/panel/faceplate.ts:1-16`

**Step 1: Update comment**

```typescript
/**
 * Module faceplate — 3U eurorack panel with control strip layout.
 * True 3U height (128.5mm = 578px at 4.5px/mm).
 *
 * Layout (left to right):
 *   Track column (T1-T4) | LCD (480×320) | Right col 1 (GATE/PTCH/VEL/MOD) | Right col 2 (MUTE/ROUTE/DIV-LEN) | Jacks
 *   Control strip: RESET, PLAY, RAND (~14mm) | Encoder A, Encoder B
 *   Below control strip: 2×8 step button grid (aligned to LCD width)
 *
 * Spacing rules:
 *   - Small buttons use BTN_CC (10.7mm) center-to-center spacing
 *   - Large buttons (RESET/PLAY/RAND) are LARGE_BTN_D (14mm) — matches encoder height
 *   - Buttons need ≥ BTN_CC/2 clearance from LCD, encoders, jacks, panel edges
 *   - Labels are purely cosmetic: absolute-positioned, bold, zero layout impact
 *   - Step buttons use same BTN_CC (10.7mm) center-to-center as all panel buttons
 */
```

**Step 2: Commit**

```bash
git add src/ui/panel/faceplate.ts
git commit -m "docs: update faceplate header for new layout"
```

---

### Task 8: Final verification

**Step 1: Full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Type check + build**

Run: `npm run build`
Expected: Clean

**Step 3: Visual verification**

Run: `npm run dev`
Verify:
- Control strip shows RESET, PLAY, RAND (large) + Enc A, Enc B in one row
- Feature column shows 3 buttons: MUTE, ROUTE, DIV/LEN
- Step grid aligned to LCD width
- Hold F key → DIV/LEN overlay shows all 4 tracks' length and divider
- Turn ↑↓ while holding F → selected track's length changes
- Turn ←→ while holding F → selected track's divider changes
- D key enters RAND mode, hold 1 + D randomizes track
- ? key shows updated help modal

**Step 4: Commit summary (if any final fixes)**

```bash
git add -A
git commit -m "fix: final layout adjustments"
```
