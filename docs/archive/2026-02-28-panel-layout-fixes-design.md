# Panel Layout Fixes Design

## Context

Three issues with the current panel layout need fixing:
1. RESET/PLAY/RAND buttons look too similar to small buttons — need Bitbox-inspired rectangular transport buttons
2. Subtrack column (4 buttons) and feature/overlay column (3 buttons) are misaligned
3. Step grid is centered in the main-area rather than under the LCD

## Changes

### 1. Rectangular Transport Buttons

Replace circular large buttons with taller rectangular ones inspired by 1010music Bitbox modules.

- New constants: `RECT_BTN_W = 8.0 * SCALE` (36px), `RECT_BTN_H = 16.0 * SCALE` (72px)
- Remove `LARGE_BTN_D` constant (no longer circular)
- `.large-btn` CSS: `border-radius: 2mm` instead of `50%`, width/height use new rect dimensions
- All three buttons (RESET, PLAY, RAND) use the rectangular style
- Existing color/state styles preserved (transport gray, RAND darker, play green glow)
- Control strip gap adjusted for rectangular button proportions

### 2. Feature Column: 4 Rows Aligned with Subtrack Column

Add a 4th feature button to match the subtrack column's 4-button layout.

- Feature labels: `['MUTE', 'ROUTE', 'DIV/LEN', 'TBD']`
- Loop count: 3 → 4
- Both right-side columns now have identical 4-row height, aligned row-by-row
- `FaceplateElements.featureBtns` array grows from 3 to 4 elements
- TBD button has no behavior wired yet — placeholder for future feature

### 3. Step Grid Centered Under LCD

Position the step grid so it's horizontally centered under the LCD display.

- Remove `align-self: center` from `.step-grid`
- Calculate left offset = track column width + gap, then center step grid relative to LCD width
- The LCD occupies a known CSS width (`73.44 * SCALE` px + bezel padding), so the offset can be computed from constants

## Files Modified

- `src/ui/panel/faceplate.ts` — all three changes (constants, DOM generation, CSS)
- `src/ui/panel/controls.ts` — may need update if feature button count is referenced
- Tests — verify feature button array length if tested
