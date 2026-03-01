# Panel Layout Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three panel layout issues: rectangular transport buttons, aligned 4-row columns, step grid centered under LCD.

**Architecture:** All changes are in `src/ui/panel/faceplate.ts` (constants, DOM, CSS) with a small guard fix in `src/ui/panel/controls.ts`. No engine changes. No new files.

**Tech Stack:** TypeScript, DOM, CSS-in-JS (template literal in faceplate.ts)

---

### Task 1: Rectangular Transport Button Constants

**Files:**
- Modify: `src/ui/panel/faceplate.ts:35` (replace `LARGE_BTN_D`)

**Step 1: Replace the LARGE_BTN_D constant with rectangular dimensions**

In `src/ui/panel/faceplate.ts`, replace line 35:
```typescript
const LARGE_BTN_D = 14.0 * SCALE    // 63px — large tactile button (matches encoder height)
```
with:
```typescript
const RECT_BTN_W = 8.0 * SCALE      // 36px — rectangular button width
const RECT_BTN_H = 16.0 * SCALE     // 72px — rectangular button height
```

**Step 2: Update control strip gap reference**

In the same file, line 587 references `LARGE_BTN_D` for the gap calculation:
```typescript
gap: ${Math.round(LARGE_BTN_D * 0.3)}px;
```
Replace with:
```typescript
gap: ${Math.round(RECT_BTN_W * 0.4)}px;
```

**Step 3: Run dev server and verify no build errors**

Run: `npm run build`
Expected: Build succeeds (no references to deleted `LARGE_BTN_D` remain)

Note: If build fails with "LARGE_BTN_D is not defined", search for any remaining references and update them.

**Step 4: Commit**

```bash
git add src/ui/panel/faceplate.ts
git commit -m "refactor: replace LARGE_BTN_D with RECT_BTN dimensions"
```

---

### Task 2: Rectangular Button CSS

**Files:**
- Modify: `src/ui/panel/faceplate.ts` (CSS section, lines ~656-664)

**Step 1: Update `.large-btn` CSS from circle to rectangle**

Find the `.large-btn` CSS block:
```css
.large-btn {
    width: ${LARGE_BTN_D}px;
    height: ${LARGE_BTN_D}px;
}
```
Replace with:
```css
.large-btn {
    width: ${RECT_BTN_W}px;
    height: ${RECT_BTN_H}px;
    border-radius: ${2.0 * SCALE}px;
}
```

The `.circle-btn` base class sets `border-radius: 50%` — the `.large-btn` override to `2.0 * SCALE` (9px ≈ 2mm) makes it rectangular with rounded corners.

**Step 2: Run dev server and visually verify**

Run: `npm run dev`
Expected: RESET, PLAY, RAND now appear as tall rectangles in the control strip. Labels still visible below.

**Step 3: Commit**

```bash
git add src/ui/panel/faceplate.ts
git commit -m "feat: rectangular transport buttons (Bitbox-inspired)"
```

---

### Task 3: Add 4th Feature Button (TBD)

**Files:**
- Modify: `src/ui/panel/faceplate.ts:219-220` (feature labels and loop)
- Modify: `src/ui/panel/controls.ts:201` (guard loop against FEATURE_IDS length)
- Modify: `src/ui/panel/controls.ts:375` (guard mode indicator loop)

**Step 1: Update feature labels and loop count in faceplate.ts**

In `src/ui/panel/faceplate.ts`, find:
```typescript
const featureLabels = ['MUTE', 'ROUTE', 'DIV/LEN']
for (let i = 0; i < 3; i++) {
```
Replace with:
```typescript
const featureLabels = ['MUTE', 'ROUTE', 'DIV/LEN', 'TBD']
for (let i = 0; i < 4; i++) {
```

**Step 2: Guard the feature button event loop in controls.ts**

In `src/ui/panel/controls.ts`, the loop at line 201 iterates over all `panel.featureBtns` but indexes into `FEATURE_IDS` which only has 3 entries. The 4th button (TBD) has no feature ID yet.

Find:
```typescript
for (let i = 0; i < panel.featureBtns.length; i++) {
    const btn = panel.featureBtns[i]
```
Replace with:
```typescript
for (let i = 0; i < FEATURE_IDS.length; i++) {
    const btn = panel.featureBtns[i]
```

This ensures only the first 3 feature buttons get event handlers. The 4th (TBD) is inert.

**Step 3: Guard the mode indicator loop in controls.ts**

In `src/ui/panel/controls.ts`, the `updateModeIndicators` function at line 380:
```typescript
for (let i = 0; i < featureBtns.length; i++) {
    featureBtns[i].classList.toggle('active', mode === featureModes[i])
}
```
Replace with:
```typescript
for (let i = 0; i < featureModes.length; i++) {
    featureBtns[i].classList.toggle('active', mode === featureModes[i])
}
```

This ensures only the first 3 feature buttons get mode indicators. The 4th has no mode.

**Step 4: Run build and verify**

Run: `npm run build`
Expected: No errors. The TBD button renders but has no click behavior.

**Step 5: Run dev server and visually verify**

Run: `npm run dev`
Expected: Feature column now has 4 buttons (MUTE, ROUTE, DIV/LEN, TBD) aligned with the 4 subtrack buttons.

**Step 6: Commit**

```bash
git add src/ui/panel/faceplate.ts src/ui/panel/controls.ts
git commit -m "feat: add 4th feature button (TBD) for column alignment"
```

---

### Task 4: Center Step Grid Under LCD

**Files:**
- Modify: `src/ui/panel/faceplate.ts` (CSS for `.step-grid`)

**Step 1: Calculate the LCD offset**

The step grid needs to be centered under the LCD. The LCD is positioned after:
- Track column: `BTN_D` (23px) wide
- Gap: `COMPONENT_GAP` (24px)

So the LCD's left edge is at `BTN_D + COMPONENT_GAP = 47px` from the main-area left edge.

The LCD CSS width is `73.44 * SCALE` (330px) plus bezel padding (2px + `2.0 * SCALE` = 11px each side = 22px total), giving a bezel width of ~352px. The LCD center from the main-area left edge is at `47 + 352/2 = 223px`.

The step grid width is `8 * STEP_BTN_CC - STEP_GAP = 8 * 32 - 12 = 244px` (8 buttons at 32px c-c, minus one gap since we measure edge-to-edge).

Actually the flex gap layout makes the total width = `7 * BTN_GAP + 8 * STEP_BTN_D = 7 * 25 + 8 * 20 = 175 + 160 = 335px`. Hmm, that's wider than the LCD.

Let's use a simpler approach: use CSS to offset the step grid so its center aligns with the LCD center.

**Step 2: Update step grid CSS**

Find the `.step-grid` CSS:
```css
.step-grid {
    display: flex;
    flex-direction: column;
    gap: ${BTN_GAP}px;
    align-self: center;
    margin-top: ${COMPONENT_GAP}px;
}
```

Replace with:
```css
.step-grid {
    display: flex;
    flex-direction: column;
    gap: ${BTN_GAP}px;
    margin-top: ${COMPONENT_GAP}px;
    margin-left: ${BTN_D + COMPONENT_GAP}px;
}
```

This left-aligns the step grid with the LCD's left edge. Since the step grid (using `BTN_GAP` spacing) may be wider or narrower than the LCD, left-alignment with the LCD edge is cleaner than trying to center precisely. If the step grid is wider than the LCD, centering would push it too far right.

Actually, let's compute this properly. The step row uses `gap: ${BTN_GAP}px` (25px) with `STEP_BTN_D` (20px) buttons. Total step row width = 8 × 20 + 7 × 25 = 335px. The LCD bezel width ≈ 352px. They're close enough that centering under the LCD works well.

To center: `margin-left = BTN_D + COMPONENT_GAP + (LCD_bezel_width - step_row_width) / 2`

Let's compute the LCD bezel width from constants:
- LCD canvas CSS width: `73.44 * SCALE` = 330.48px → round to 330px
- lcd-mask padding: `2.0 * SCALE` each side = 9px × 2 = 18px → mask inner = 348px
- lcd-bezel padding: 2px each side → bezel outer = 352px

Step row width = `8 * STEP_BTN_D + 7 * BTN_GAP` = 160 + 175 = 335px

Center offset = `BTN_D + COMPONENT_GAP + (352 - 335) / 2` ≈ `23 + 24 + 8.5` = 55.5px

Rather than hardcode, use the constants:

```typescript
const LCD_BEZEL_W = Math.round(73.44 * SCALE) + 2 * Math.round(2.0 * SCALE) + 4  // canvas + mask padding + bezel padding
const STEP_ROW_W = 8 * STEP_BTN_D + 7 * BTN_GAP
const STEP_GRID_LEFT = BTN_D + COMPONENT_GAP + Math.round((LCD_BEZEL_W - STEP_ROW_W) / 2)
```

Replace the `.step-grid` CSS with:
```css
.step-grid {
    display: flex;
    flex-direction: column;
    gap: ${BTN_GAP}px;
    margin-top: ${COMPONENT_GAP}px;
    margin-left: ${STEP_GRID_LEFT}px;
}
```

**Step 3: Add derived constants**

After the existing derived constants section (line ~47), add:
```typescript
const LCD_BEZEL_W = Math.round(73.44 * SCALE) + 2 * Math.round(2.0 * SCALE) + 4
const STEP_ROW_W = 8 * STEP_BTN_D + 7 * BTN_GAP
const STEP_GRID_LEFT = BTN_D + COMPONENT_GAP + Math.round((LCD_BEZEL_W - STEP_ROW_W) / 2)
```

**Step 4: Run dev server and visually verify**

Run: `npm run dev`
Expected: Step grid is horizontally centered under the LCD display.

**Step 5: Commit**

```bash
git add src/ui/panel/faceplate.ts
git commit -m "feat: center step grid under LCD display"
```

---

### Task 5: Final Verification

**Step 1: Run full build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: Visual check in browser**

Run: `npm run dev`

Verify:
- RESET, PLAY, RAND are tall rectangular buttons in the control strip
- Feature column has 4 buttons (MUTE, ROUTE, DIV/LEN, TBD) aligned with subtrack column
- TBD button renders but does nothing when clicked
- Step grid is centered under the LCD, not the full main-area
- Existing functionality (play, hold overlays, encoders) still works
