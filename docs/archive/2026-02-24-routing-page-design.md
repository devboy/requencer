# Routing Page Design

## Summary

Replace the flat `RoutingConnection[]` with a structured per-output model. Add MOD as a 4th routable subtrack. Implement the route LCD screen with per-param source selection.

## Data Model

### OutputRouting (replaces RoutingConnection[])

```ts
interface OutputRouting {
  gate: number      // source track index 0-3
  pitch: number
  velocity: number
  mod: number
}
```

`SequencerState.routing` becomes `OutputRouting[]` (length 4). Default: 1:1 mapping — `routing[i] = { gate: i, pitch: i, velocity: i, mod: i }`.

### MOD Subtrack

Add `mod: Subtrack<number>` to `SequenceTrack`. Range 0-127, default value 0. Every track gets a mod lane that can be routed independently. Editor/randomizer for mod is future work — it just exists as routable data for now.

### NoteEvent

Add `mod: number` field. `resolveOutputs()` reads mod subtrack current step value and includes it in the output event.

## UI Interaction

- **T1-T4** selects output channel (cross-modal, same as other screens — `selectedTrack` repurposed as "selected output" in route mode)
- **Enc A** moves cursor between GATE/PTCH/VEL/MOD rows (0-3)
- **Enc B** cycles source track for highlighted param (T1→T2→T3→T4→T1)
- **Enc B push** returns to home
- No scrolling needed — only 4 rows

### UIState Addition

`routeParam: number` — 0-3, selecting which param row the cursor is on.

### LCD Screen Layout

```
ROUTE — OUT 1          ENC A:▲▼  ENC B:src
▸ GATE    ← T1
  PTCH    ← T3
  VEL     ← T1
  MOD     ← T2
```

Header shows selected output. Each row shows param label and source track name. Source label colored with the source track's color. Selected row highlighted with track color tint. Cursor indicator `▸` on selected row.

## Engine Changes

- Remove `RoutingConnection` type
- Add `OutputRouting` type
- Replace `createDefaultRouting()` to return `OutputRouting[]`
- Update `resolveOutputs()` to read from structured model
- Add `setOutputSource()` pure function for changing a single param's source
- Add `mod` subtrack to `createTrack()` and `SequenceTrack`
- Add `mod` to `NoteEvent`
- Update `tick()` to advance mod subtrack step
- Update `SUBTRACK_DEFAULTS` with mod default

## Files to Modify

| File | Change |
|------|--------|
| `src/engine/types.ts` | Replace `RoutingConnection` with `OutputRouting`, add `mod` to `SequenceTrack` and `NoteEvent` |
| `src/engine/routing.ts` | Rewrite `createDefaultRouting()` and `resolveOutputs()` for structured model |
| `src/engine/sequencer.ts` | Add `mod` subtrack to `createTrack()`, add `setOutputSource()`, update `tick()` |
| `src/ui/hw-types.ts` | Add `routeParam: number` to `UIState` |
| `src/ui/mode-machine.ts` | Replace route stub with `dispatchRoute()` |
| `src/ui/lcd/route-screen.ts` | New file — route LCD renderer |
| `src/main.ts` | Wire route renderer, update MODE_STATUS/SHORTCUT_HINTS |
| `src/engine/__tests__/routing.test.ts` | Update tests for new model |
| `src/engine/__tests__/sequencer.test.ts` | Update tests for mod subtrack |
| `src/ui/__tests__/mode-machine.test.ts` | Add route dispatch tests |
