# Gate Modes Redesign — 2026-03-03

## What Changed

Replaced the 2-mode gate system (`random`/`euclidean`) + multi-bar phrase system (`smartBars`, `smartDensity`) with 4 single-bar gate modes:

| Mode | Internal | Algorithm |
|------|----------|-----------|
| RAND | `random` | Fisher-Yates shuffle of N hits (unchanged) |
| EUCL | `euclidean` | Bjorklund's algorithm with optional random offset (unchanged) |
| SYNC | `sync` | Weighted random biased to offbeat positions |
| CLST | `cluster` | Markov chain with configurable continuation probability |

## What Was Removed

- `smartBars: number` (1/2/4/8/16) — multi-bar phrase length
- `smartDensity: SmartGateDensity` (`build`/`decay`/`build-drop`/`variation`) — density curve across bars
- `SmartGateDensity` type
- `src/engine/smart-gate.ts` — phrase-aware gate generation
- `src/engine/__tests__/smart-gate.test.ts`

## Why Removed

All sequences in the prototype are 1 bar (16 steps) long. The phrase system was untestable in practice since `smartBars > 1` produced patterns longer than any track. The 4 single-bar modes produce more musically interesting variety for the actual use case.

## Reimplementation Notes

If multi-bar phrases return later:
- They should operate at a higher level than gate generation (e.g. a "phrase sequencer" that swaps between pre-generated bars)
- Consider bar-level muting/variation rather than density curves baked into gate generation
- The `smart-gate.ts` implementation is preserved in git history at commit `181f5c6` and earlier
