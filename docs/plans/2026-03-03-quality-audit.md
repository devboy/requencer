# Code Quality Audit — 2026-03-03

Baseline measurements and refactoring opportunities after professionalizing the codebase tooling.

## Benchmark Baselines

Measured on Apple Silicon (M-series), Node 20, vitest 4.0.18.

| Benchmark | Mean | Hz | Notes |
|-----------|------|-----|-------|
| `tick()` — empty sequencer | 44μs | 22,500 | Baseline overhead |
| `tick()` — all features active | 54μs | 18,494 | LFOs + variations + mutation |
| 1000 sequential ticks (~4 bars) | 2.2ms | 449 | Sustained throughput |
| `createSequencer()` init | 41μs | 24,323 | One-time cost |
| `computeLFOValue()` sine synced | 0.12μs | 8.3M | Called 8x per tick |
| `waveformValue()` triangle | 0.04μs | 24.9M | Pure math hot path |
| `randomizeTrack()` 16 steps | ~20μs | ~50K | User action latency |
| `randomizeTrack()` 64 steps | ~80μs | ~12K | User action latency |
| `transformStepIndex()` | <0.05μs | ~24M | Per-step per-transform |

**Performance target:** tick() must complete well under 75ms (200 BPM at 16th notes). Current headroom: **1400x**.

## Coverage Summary

| Layer | Statements | Branches | Functions | Lines |
|-------|-----------|----------|-----------|-------|
| Engine (12 files) | 92.89% | 84.38% | 94.15% | 92.83% |
| UI (24 files) | 60.54% | 57.99% | 54.16% | 61.33% |
| **Overall** | **76.04%** | **69.99%** | **74.83%** | **75.92%** |

### Coverage Gap Priorities

1. **lfo.ts** (58.9% lines) — S+H and slew-random waveform paths untested at engine level
2. **rand-rows.ts** (24.5% lines) — UI row generation, low priority
3. **settings-rows.ts** (37.5% lines) — UI row generation, low priority
4. **mode-machine.ts** (63.8% lines) — Large but well-tested for core paths; remaining gaps are in less-exercised mode transitions

## Refactoring Opportunities

### mode-machine.ts (1,984 lines) — HIGH PRIORITY

The largest file in the codebase. Currently a single function with a mode switch at the top and per-mode handlers inline. Mechanical extraction opportunity:

**Proposed:** Split into `src/ui/mode-machine/` directory:
- `index.ts` — dispatch function, shared state helpers
- `home.ts` — home screen handler
- `gate-edit.ts` — gate edit mode handler
- `pitch-edit.ts` — pitch edit mode handler
- `vel-edit.ts` — velocity edit mode handler
- `mute-edit.ts` — mute edit mode handler
- `mod-edit.ts` — mod edit mode handler
- `rand.ts` — randomizer config mode handler
- `settings.ts` — settings mode handler
- `xpose.ts` — transpose mode handler
- `variation.ts` — variation mode handler

Each handler has the same signature: `(ui, engine, event) => DispatchResult`. The extraction is mechanical — no logic changes needed.

### faceplate.ts (1,054 lines) — LOW PRIORITY

~600 lines are CSS template literals for the panel layout. Could extract to `faceplate-styles.ts` but cognitive complexity is low since CSS is declarative. Not blocking anything.

### sequencer.ts (844 lines) — NO ACTION

25 setter functions follow an identical pattern (`setX → clamp → return {...state}`). `tick()` at ~148 lines is the most complex function but is well-tested. Leave as-is.

## Unused Exports (knip findings)

These are intentionally exported types/functions that form the module's public API but aren't currently imported internally. They may be used by external consumers or reserved for future features:

**Functions (8):** `isInstructionsOpen`, `getAllPresets`, `fillRoundRect`, `hitTest`, `setupCanvas`, `getCanvasPoint`, `LCD_STATUS_H`, `LCD_SOFT_H`

**Types (14):** `ArpDirection`, `Preset`, `CVValue`, `MIDIDevice`, `ClockCallbacks`, `DebugActions`, `DispatchResult`, `RandRowType`, `RandRow`, `Rect`, `SettingsRowType`, `SettingsRow`, `XposeRowType`, `XposeRow`

Review these during next major refactor — remove exports that aren't part of the intended public API.

## Biome Warnings (53)

All `noExcessiveCognitiveComplexity` warnings. Top offenders:
- `routing.ts:resolveOutputs` — complexity 79
- `randomizer.ts:randomizeGates` — complexity 70
- `ui/lcd/gate-edit.ts:renderGateEdit` — complexity 53
- `io/midi-output.ts:handleEvents` — complexity 41
- `io/tone-output.ts:handleEvents` — complexity 35

These are flagged as warnings (won't block CI). Address during the mode-machine split or when touching these files for features.
