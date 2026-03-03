# Live Playback Indicators Design

## Problem

1. **Step LEDs don't track playback on all screens.** `pitch-edit` and `vel-edit` use the step button LEDs for cursor selection only — no visual feedback of where the sequencer is currently playing.
2. **No variation indicator on home screen.** When variation patterns are enabled and actively transforming a track's sequence, the home screen shows the stored pattern with no hint that what's actually playing differs.

## Design

### Feature 1: Live Playback LEDs on pitch-edit and vel-edit

In `getStepLEDs()` (`mode-machine.ts`), update the `pitch-edit` and `vel-edit` cases to show both cursor and playback:

- Step beyond subtrack length → `'off'`
- Step is `currentStep` (playback) → `'flash'`
- Step is `selectedStep` (cursor) → `'on'`
- Otherwise → `'dim'`

Priority: playback `'flash'` wins when cursor and playhead overlap.

Screens already correct: `gate-edit`, `mute-edit`, `home` (default case), `mod-edit` (falls through to default). `variation-edit` shows bars, not steps — unchanged.

### Feature 2: Variation Active Indicator on Home Screen

In `renderTrackBand()` (`home.ts`), draw a `~` character after the track label ("T1~") in variation green (`#44ff66`) when `variationPatterns[trackIdx].enabled` is true.

Requires threading the `enabled` boolean from `renderHome` down to `renderTrackBand`.

### Testing

- LED changes: add test cases in `mode-machine.test.ts` for `pitch-edit` and `vel-edit` verifying `currentStep → 'flash'` and `selectedStep → 'on'`.
- Variation indicator: pure rendering, visual verification only.

### Files Changed

- `src/ui/mode-machine.ts` — `getStepLEDs()` pitch-edit and vel-edit cases
- `src/ui/lcd/home.ts` — `renderHome` and `renderTrackBand` for variation indicator
- `src/ui/mode-machine.test.ts` — new LED test cases
