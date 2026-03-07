# Global Settings Screen — Design

## Problem

- MIDI config is hidden inside the ROUTE page as a sub-page (enc A push to toggle)
- BPM is only editable via the debug HTML menu, not from the hardware UI
- No clock source concept — hardcoded to internal Tone.js Transport
- No MIDI device selection UI

## Solution

New SETTINGS button in jack zone (under RESET). Opens a scrollable param list screen (same pattern as RAND). Two sections: CLOCK and MIDI.

## Screen Layout

```
SETTINGS — enc A:scroll  enc B:adjust
─────────────────────────────────────────
CLOCK
  BPM           135         enc B: ±1
  SOURCE        INT         enc B cycles: INT / MIDI / EXT

MIDI
  MIDI          ON          enc B toggles global on/off
  DEVICE        IAC Drv 1   enc B cycles available devices
  OUT 1 CH      1           enc B: 1-16
  OUT 2 CH      2
  OUT 3 CH      3
  OUT 4 CH      4
```

Enc A hold on a section header resets that section to defaults. Enc A hold on a param resets that param.

## Navigation

- SETTINGS button (jack zone, under RESET) enters `settings` mode
- BACK returns to home
- Track select buttons (1-4) still work cross-modally

## Engine State Changes

### Transport — add clockSource

```typescript
interface Transport {
  bpm: number
  playing: boolean
  masterTick: number
  clockSource: 'internal' | 'midi' | 'external'  // NEW
}
```

### SequencerState — add midiEnabled

```typescript
interface SequencerState {
  // ... existing fields ...
  midiEnabled: boolean  // NEW — global MIDI on/off
}
```

### MIDIOutputConfig — remove enabled

```typescript
interface MIDIOutputConfig {
  channel: number  // 1-16 (enabled removed, replaced by global midiEnabled)
}
```

## What Changes

### Removed
- MIDI sub-page from ROUTE screen (enc A push no longer toggles pages)
- `routePage` from UIState (no longer needed)
- Per-output MIDI enabled toggle
- MIDI screen renderer (`lcd/midi-screen.ts`)

### Added
- SETTINGS button on faceplate (jack zone, under RESET)
- `settings` screen mode
- Settings screen renderer
- Settings row definitions (similar to rand-rows.ts)
- Settings dispatch in mode-machine
- `settingsParam` in UIState (scroll position)
- `midiEnabled` on SequencerState
- `clockSource` on Transport
- BPM adjustment from settings screen

### Modified
- ROUTE dispatch — simplified, routing only (remove page toggle, remove MIDI dispatch)
- Route screen renderer — remove "PUSH:midi" hint
- Faceplate — add SETTINGS button
- Main.ts — sync BPM from engine state to Tone.js clock after dispatch
- MIDI output — check `state.midiEnabled` instead of per-output `config.enabled`

## Clock Source Behavior

- **INT** — Internal Tone.js clock at configured BPM (current behavior)
- **MIDI** — Sync to incoming MIDI clock messages (future: requires Web MIDI clock listener)
- **EXT** — Placeholder for hardware analog clock input (non-functional in browser prototype)

For now, only INT is fully functional. MIDI and EXT are visible in the UI to document the hardware interface but don't change behavior.

## Defaults

- BPM: 135
- Clock source: internal
- MIDI enabled: false
- MIDI device: first available (or none)
- Output channels: 1, 2, 3, 4
