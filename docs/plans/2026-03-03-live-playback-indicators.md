# Live Playback Indicators Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add live playback position to step LEDs on pitch-edit/vel-edit screens, and a variation-active indicator on the home screen.

**Architecture:** Pure UI changes — modify `getStepLEDs()` in mode-machine.ts (LED state computation) and `renderTrackBand()` in home.ts (canvas rendering). Both are pure functions that read engine state and produce output. TDD for LED logic; visual verification for the canvas indicator.

**Tech Stack:** TypeScript, Vitest, Canvas2D

---

### Task 1: Write failing tests for pitch-edit playback LED

**Files:**
- Modify: `src/ui/__tests__/mode-machine.test.ts:492-498` (existing `pitch-edit highlights selected step` test area)

**Step 1: Write failing tests**

Add two new tests after the existing `pitch-edit highlights selected step` test (line 498) inside the `getLEDState` describe block:

```typescript
it('pitch-edit shows playback position as flash', () => {
  const ui = { ...createInitialUIState(), mode: 'pitch-edit' as const, selectedStep: 4 }
  const eng = makeState()
  eng.tracks[0].pitch.currentStep = 7
  const leds = getLEDState(ui, eng)
  expect(leds.steps[7]).toBe('flash') // playback position
  expect(leds.steps[4]).toBe('on') // cursor (not flash)
  expect(leds.steps[0]).toBe('dim') // other step
})

it('pitch-edit playback flash wins when cursor and playhead overlap', () => {
  const ui = { ...createInitialUIState(), mode: 'pitch-edit' as const, selectedStep: 3 }
  const eng = makeState()
  eng.tracks[0].pitch.currentStep = 3
  const leds = getLEDState(ui, eng)
  expect(leds.steps[3]).toBe('flash') // playback wins over cursor
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/ui/__tests__/mode-machine.test.ts`

Expected: 2 FAIL — `steps[7]` is `'dim'` not `'flash'`, and `steps[4]` is `'flash'` not `'on'`.

---

### Task 2: Implement pitch-edit playback LED

**Files:**
- Modify: `src/ui/mode-machine.ts:1620-1632` (pitch-edit case in `getStepLEDs`)

**Step 1: Update the pitch-edit case**

Replace lines 1620-1632:

```typescript
case 'pitch-edit': {
  for (let i = 0; i < 16; i++) {
    const stepIdx = pageOffset + i
    if (stepIdx >= track.pitch.length) {
      leds[i] = 'off'
    } else if (stepIdx === track.pitch.currentStep) {
      leds[i] = 'flash'
    } else if (i === ui.selectedStep) {
      leds[i] = 'on'
    } else {
      leds[i] = 'dim'
    }
  }
  break
}
```

Key change: `currentStep` check (flash) comes before `selectedStep` check (now `'on'` instead of `'flash'`).

**Step 2: Run tests to verify they pass**

Run: `npm test -- --run src/ui/__tests__/mode-machine.test.ts`

Expected: ALL PASS (existing test `pitch-edit highlights selected step` will need updating — see Step 3).

**Step 3: Update existing test expectation**

The existing test at line 492-498 expects `selectedStep` to be `'flash'`. Update it to expect `'on'`:

```typescript
it('pitch-edit highlights selected step', () => {
  const ui = { ...createInitialUIState(), mode: 'pitch-edit' as const, selectedStep: 4 }
  const eng = makeState()
  const leds = getLEDState(ui, eng)
  expect(leds.steps[4]).toBe('on')
  expect(leds.steps[0]).toBe('dim')
})
```

**Step 4: Run tests again**

Run: `npm test -- --run src/ui/__tests__/mode-machine.test.ts`

Expected: ALL PASS

---

### Task 3: Write failing tests for vel-edit playback LED

**Files:**
- Modify: `src/ui/__tests__/mode-machine.test.ts` (after the pitch-edit tests, still inside `getLEDState` describe)

**Step 1: Write failing tests**

```typescript
it('vel-edit shows playback position as flash', () => {
  const ui = { ...createInitialUIState(), mode: 'vel-edit' as const, selectedStep: 2 }
  const eng = makeState()
  eng.tracks[0].velocity.currentStep = 10
  const leds = getLEDState(ui, eng)
  expect(leds.steps[10]).toBe('flash') // playback position
  expect(leds.steps[2]).toBe('on') // cursor
  expect(leds.steps[0]).toBe('dim') // other step
})

it('vel-edit playback flash wins when cursor and playhead overlap', () => {
  const ui = { ...createInitialUIState(), mode: 'vel-edit' as const, selectedStep: 5 }
  const eng = makeState()
  eng.tracks[0].velocity.currentStep = 5
  const leds = getLEDState(ui, eng)
  expect(leds.steps[5]).toBe('flash')
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/ui/__tests__/mode-machine.test.ts`

Expected: 2 FAIL

---

### Task 4: Implement vel-edit playback LED

**Files:**
- Modify: `src/ui/mode-machine.ts:1633-1645` (vel-edit case in `getStepLEDs`)

**Step 1: Update the vel-edit case**

Replace lines 1633-1645:

```typescript
case 'vel-edit': {
  for (let i = 0; i < 16; i++) {
    const stepIdx = pageOffset + i
    if (stepIdx >= track.velocity.length) {
      leds[i] = 'off'
    } else if (stepIdx === track.velocity.currentStep) {
      leds[i] = 'flash'
    } else if (i === ui.selectedStep) {
      leds[i] = 'on'
    } else {
      leds[i] = 'dim'
    }
  }
  break
}
```

**Step 2: Run tests to verify they pass**

Run: `npm test -- --run src/ui/__tests__/mode-machine.test.ts`

Expected: ALL PASS

---

### Task 5: Add variation indicator to home screen

**Files:**
- Modify: `src/ui/lcd/home.ts:29-36` (`renderHome` function)
- Modify: `src/ui/lcd/home.ts:59-66` (`renderTrackBand` signature)
- Modify: `src/ui/lcd/home.ts:79-80` (track label drawing)

**Step 1: Pass variation enabled flag to renderTrackBand**

In `renderHome` (line 35), add the variation enabled boolean:

```typescript
renderTrackBand(ctx, track, i, y, isSelected, engine.randomConfigs[i], engine.variationPatterns[i].enabled)
```

**Step 2: Add parameter to renderTrackBand signature**

Update the function signature (lines 59-66):

```typescript
function renderTrackBand(
  ctx: CanvasRenderingContext2D,
  track: SequenceTrack,
  trackIdx: number,
  y: number,
  isSelected: boolean,
  config: RandomConfig,
  variationEnabled: boolean,
): void {
```

**Step 3: Draw the variation indicator**

After the track label draw call (line 80), add the `~` indicator:

```typescript
// Track label — centered vertically in band
drawText(ctx, `T${trackIdx + 1}`, PAD, y + BAND_H / 2, isSelected ? trackColor : COLORS.textDim, 18)

// Variation active indicator
if (variationEnabled) {
  drawText(ctx, '~', PAD + 24, y + BAND_H / 2, '#44ff66', 18)
}
```

The x offset `PAD + 24` places the `~` right after the "T1" label (which is ~22px wide at size 18).

**Step 4: Run all tests**

Run: `npm test -- --run`

Expected: ALL PASS (no engine logic changed, rendering is visual-only)

**Step 5: Visual verification**

Run: `npm run dev`

Verify:
- On home screen, tracks without variations show "T1" / "T2" / etc. as before
- Enable a variation pattern for a track → green `~` appears after the track label
- Disable → `~` disappears

---

### Task 6: Run full verification

**Step 1: All tests**

Run: `npm test -- --run`

Expected: ALL PASS

**Step 2: Type check**

Run: `npx tsc --noEmit`

Expected: No errors

**Step 3: Lint check**

Run: `npm run check`

Expected: No errors (warnings OK)
