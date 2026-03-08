# Global Settings Screen Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a global Settings screen with CLOCK (BPM, source) and MIDI (on/off, device, per-output channels) sections, moving MIDI config out of the routing page.

**Architecture:** New `settings` screen mode following the RAND screen pattern — row definitions in `settings-rows.ts`, scrollable param list renderer in `lcd/settings-screen.ts`, dispatch in `mode-machine.ts`. Engine gains `clockSource` on Transport and `midiEnabled` on SequencerState. MIDI sub-page removed from ROUTE.

**Tech Stack:** TypeScript, Canvas 2D, Vitest (TDD)

---

## Task 1: Update engine types

**Files:**
- Modify: `src/engine/types.ts:117-122` (Transport), `src/engine/types.ts:174-178` (MIDIOutputConfig), `src/engine/types.ts:180-193` (SequencerState)

**Step 1: Add clockSource to Transport**

```typescript
export interface Transport {
  bpm: number
  playing: boolean
  masterTick: number
  clockSource: 'internal' | 'midi' | 'external'
}
```

**Step 2: Remove enabled from MIDIOutputConfig**

```typescript
export interface MIDIOutputConfig {
  channel: number            // 1-16
}
```

**Step 3: Add midiEnabled to SequencerState**

Add after `midiConfigs` line:
```typescript
  midiEnabled: boolean                  // global MIDI output on/off
```

**Step 4: Add ClockSource type export**

```typescript
export type ClockSource = 'internal' | 'midi' | 'external'
```

---

## Task 2: Update sequencer defaults and fix compile errors

**Files:**
- Modify: `src/engine/sequencer.ts:120-123` (transport default), `src/engine/sequencer.ts:130` (midiConfigs default)

**Step 1: Add clockSource to default transport**

In `createSequencer()` transport object (line 120-123):
```typescript
    transport: {
      bpm: DEFAULT_BPM,
      playing: false,
      masterTick: 0,
      clockSource: 'internal',
    },
```

**Step 2: Remove enabled from midiConfigs default**

Line 130:
```typescript
    midiConfigs: Array.from({ length: NUM_TRACKS }, (_, i) => ({ channel: i + 1 })),
```

**Step 3: Add midiEnabled default**

After midiConfigs line:
```typescript
    midiEnabled: false,
```

**Step 4: Run `npm run build` to find remaining compile errors from `enabled` removal**

Fix any references to `config.enabled` or `MIDIOutputConfig.enabled` in:
- `src/io/midi-output.ts:54` — change from `config?.enabled` to check passed-in `midiEnabled` flag
- `src/ui/mode-machine.ts` — `dispatchMIDIPage` and `updateMIDIConfig` (will be removed in Task 5)

---

## Task 3: Update MIDI output to use global midiEnabled

**Files:**
- Modify: `src/io/midi-output.ts:48-56`

**Step 1: Change handleEvents signature**

```typescript
  handleEvents(events: NoteEvent[], configs: MIDIOutputConfig[], deviceIds: string[], stepDuration: number, midiEnabled: boolean): void {
    if (!this.access || !midiEnabled) return
```

Remove the per-config `if (!config?.enabled) continue` check (line 54).

**Step 2: Update call site in main.ts**

`src/main.ts:56`:
```typescript
    midi.handleEvents(result.events, engineState.midiConfigs, midiDeviceIds, stepDuration, engineState.midiEnabled)
```

---

## Task 4: Add settings UI types

**Files:**
- Modify: `src/ui/hw-types.ts:16-27` (ScreenMode), `src/ui/hw-types.ts:40-46` (FeatureId/ControlEvent), `src/ui/hw-types.ts:55-72` (UIState)

**Step 1: Add 'settings' to ScreenMode union**

```typescript
export type ScreenMode =
  | 'home'
  | 'gate-edit'
  | 'pitch-edit'
  | 'vel-edit'
  | 'mute-edit'
  | 'route'
  | 'rand'
  | 'name-entry'
  | 'mutate-edit'
  | 'mod-edit'
  | 'transpose-edit'
  | 'settings'
```

**Step 2: Add settings-press event type**

Add to ControlEvent union:
```typescript
  | { type: 'settings-press' }
```

**Step 3: Update UIState — add settingsParam, remove routePage**

Remove `routePage: number` line. Add:
```typescript
  settingsParam: number          // 0-N: selected row in SETTINGS screen
```

---

## Task 5: Simplify ROUTE dispatch — remove MIDI sub-page

**Files:**
- Modify: `src/ui/mode-machine.ts:897-961`

**Step 1: Remove routePage check and MIDI dispatch**

Replace `dispatchRoute` with simplified version:
```typescript
function dispatchRoute(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  switch (event.type) {
    case 'encoder-a-turn': {
      const newParam = clamp(ui.routeParam + event.delta, 0, 3)
      return { ui: { ...ui, routeParam: newParam }, engine }
    }
    case 'encoder-b-turn': {
      const param = ROUTE_PARAMS[ui.routeParam]
      const outputIdx = ui.selectedTrack
      const current = engine.routing[outputIdx][param]
      const next = ((current + event.delta) % 4 + 4) % 4
      return { ui, engine: setOutputSource(engine, outputIdx, param, next) }
    }
    default:
      return { ui, engine }
  }
}
```

**Step 2: Delete `dispatchMIDIPage` function** (lines 928-954)

**Step 3: Update `updateMIDIConfig` to not patch `enabled`**

Keep the helper but it now only patches `channel`:
```typescript
function updateMIDIConfig(engine: SequencerState, outputIdx: number, patch: Partial<import('../engine/types').MIDIOutputConfig>): SequencerState {
  return {
    ...engine,
    midiConfigs: engine.midiConfigs.map((c, i) => i === outputIdx ? { ...c, ...patch } : c),
  }
}
```

**Step 4: Remove routePage from createInitialUIState**

Remove `routePage: 0` line. Add `settingsParam: 0`.

**Step 5: Remove routePage from back handler**

Line 140: remove `routePage: 0` from the back handler object.

**Step 6: Fix all remaining `routePage` references**

Search for `routePage` and remove/replace.

---

## Task 6: Create settings-rows.ts

**Files:**
- Create: `src/ui/settings-rows.ts`

Model after `rand-rows.ts`. Row definitions for the settings screen:

```typescript
import type { SequencerState } from '../engine/types'
import type { UIState } from './hw-types'

export type SettingsRowType = 'header' | 'param'

export interface SettingsRow {
  type: SettingsRowType
  paramId: string
  label: string
  getValue: (engine: SequencerState, ui: UIState) => string
  visible: (engine: SequencerState, ui: UIState) => boolean
}

function buildSettingsRowDefs(): SettingsRow[] {
  const always = () => true
  const clockSourceMap: Record<string, string> = { internal: 'INT', midi: 'MIDI', external: 'EXT' }

  return [
    // --- CLOCK section ---
    {
      type: 'header', paramId: 'section.clock', label: 'CLOCK',
      getValue: () => '', visible: always,
    },
    {
      type: 'param', paramId: 'clock.bpm', label: 'BPM',
      getValue: (e) => String(e.transport.bpm),
      visible: always,
    },
    {
      type: 'param', paramId: 'clock.source', label: 'SOURCE',
      getValue: (e) => clockSourceMap[e.transport.clockSource] ?? 'INT',
      visible: always,
    },

    // --- MIDI section ---
    {
      type: 'header', paramId: 'section.midi', label: 'MIDI',
      getValue: () => '', visible: always,
    },
    {
      type: 'param', paramId: 'midi.enabled', label: 'MIDI',
      getValue: (e) => e.midiEnabled ? 'ON' : 'OFF',
      visible: always,
    },
    {
      type: 'param', paramId: 'midi.device', label: 'DEVICE',
      getValue: (e, ui) => ui.midiDevices[ui.midiDeviceIndex]?.name ?? 'None',
      visible: always,
    },
    {
      type: 'param', paramId: 'midi.ch.0', label: 'OUT 1 CH',
      getValue: (e) => String(e.midiConfigs[0].channel),
      visible: always,
    },
    {
      type: 'param', paramId: 'midi.ch.1', label: 'OUT 2 CH',
      getValue: (e) => String(e.midiConfigs[1].channel),
      visible: always,
    },
    {
      type: 'param', paramId: 'midi.ch.2', label: 'OUT 3 CH',
      getValue: (e) => String(e.midiConfigs[2].channel),
      visible: always,
    },
    {
      type: 'param', paramId: 'midi.ch.3', label: 'OUT 4 CH',
      getValue: (e) => String(e.midiConfigs[3].channel),
      visible: always,
    },
  ]
}

const SETTINGS_ROW_DEFS = buildSettingsRowDefs()

export function getSettingsRows(engine: SequencerState, ui: UIState): SettingsRow[] {
  return SETTINGS_ROW_DEFS.filter(row => row.visible(engine, ui))
}

export const SETTINGS_SECTION_PARAMS: Record<string, string[]> = {
  'section.clock': ['clock.bpm', 'clock.source'],
  'section.midi': ['midi.enabled', 'midi.device', 'midi.ch.0', 'midi.ch.1', 'midi.ch.2', 'midi.ch.3'],
}
```

---

## Task 7: Create settings-screen.ts renderer

**Files:**
- Create: `src/ui/lcd/settings-screen.ts`

Copy the `renderRand` pattern from `lcd/rand-screen.ts` but use `getSettingsRows` instead of `getVisibleRows`. Header: `SETTINGS`. No track color — use a neutral accent (e.g., `COLORS.text`).

---

## Task 8: Add settings dispatch to mode-machine

**Files:**
- Modify: `src/ui/mode-machine.ts`

**Step 1: Add settings-press handler in cross-modal section**

After the `feature-press` handler (line ~153):
```typescript
  if (event.type === 'settings-press') {
    return { ui: { ...ui, mode: 'settings', settingsParam: 0 }, engine }
  }
```

**Step 2: Add settings case to mode-specific switch**

```typescript
    case 'settings':
      return dispatchSettings(ui, engine, event)
```

**Step 3: Create dispatchSettings function**

```typescript
function dispatchSettings(ui: UIState, engine: SequencerState, event: ControlEvent): DispatchResult {
  const rows = getSettingsRows(engine, ui)

  switch (event.type) {
    case 'encoder-a-turn': {
      const next = clamp(ui.settingsParam + event.delta, 0, rows.length - 1)
      return { ui: { ...ui, settingsParam: next }, engine }
    }
    case 'encoder-a-hold':
      return dispatchSettingsReset(ui, engine)
    case 'encoder-b-turn':
      return dispatchSettingsEncoderB(ui, engine, event.delta)
    default:
      return { ui, engine }
  }
}
```

**Step 4: Create dispatchSettingsEncoderB**

Handles each paramId:
- `clock.bpm`: `clamp(bpm + delta, 20, 300)`
- `clock.source`: cycle `['internal', 'midi', 'external']` with modular index
- `midi.enabled`: toggle `engine.midiEnabled`
- `midi.device`: cycle `ui.midiDeviceIndex` through `ui.midiDevices`
- `midi.ch.0` through `midi.ch.3`: `clamp(channel + delta, 1, 16)`

**Step 5: Create dispatchSettingsReset**

Reset to defaults — same pattern as `dispatchRandReset`.

---

## Task 9: Wire SETTINGS button in faceplate + controls

**Files:**
- Modify: `src/ui/panel/faceplate.ts:156` (add button to util-row-midi)
- Modify: `src/ui/panel/faceplate.ts:67-81` (FaceplateElements interface)
- Modify: `src/ui/panel/faceplate.ts:306+` (return object)
- Modify: `src/ui/panel/controls.ts` (add click handler)

**Step 1: Add settingsBtn to FaceplateElements**

```typescript
  settingsBtn: HTMLButtonElement
```

**Step 2: Create SETTINGS button in faceplate**

Add after resetBtn creation (line ~266), inserting into `util-row-midi`:
```typescript
  const utilRowMidi = root.querySelector('#util-row-midi') as HTMLDivElement
  const settingsBtn = document.createElement('button')
  settingsBtn.className = 'large-btn transport-btn jack-zone-btn'
  settingsBtn.innerHTML = '<span class="btn-icon">⚙</span><span class="btn-text">SET</span>'
  // Replace the spacer with the button
  const spacer = utilRowMidi.querySelector('.jack-row-3-spacer')
  if (spacer) utilRowMidi.replaceChild(settingsBtn, spacer)
```

**Step 3: Add to return object**

**Step 4: Wire click handler in controls.ts**

```typescript
  panel.settingsBtn.addEventListener('pointerdown', () => emit({ type: 'settings-press' }))
```

---

## Task 10: Wire settings screen in main.ts

**Files:**
- Modify: `src/main.ts:144-172` (RENDERERS, MODE_STATUS, SHORTCUT_HINTS)

**Step 1: Import and add renderer**

```typescript
import { renderSettings } from './ui/lcd/settings-screen'
```

Add to RENDERERS:
```typescript
  'settings': renderSettings,
```

**Step 2: Add status and hints**

```typescript
  'settings': () => 'SETTINGS',
```

```typescript
  'settings': '↑↓: scroll   ←→: adjust   Esc: back',
```

---

## Task 11: Remove midi-screen.ts and clean up route-screen.ts

**Files:**
- Delete: `src/ui/lcd/midi-screen.ts`
- Modify: `src/ui/lcd/route-screen.ts:12,26,33`

**Step 1: Remove midi-screen import from route-screen**

Remove: `import { renderMIDI } from './midi-screen'`

**Step 2: Remove routePage check**

Remove line 26: `if (ui.routePage === 1) return renderMIDI(ctx, engine, ui)`

**Step 3: Update header hint**

Change `'PUSH:midi  ENC B:source'` to `'ENC B:source'`

**Step 4: Delete midi-screen.ts**

---

## Task 12: Update mode-machine tests

**Files:**
- Modify: `src/ui/__tests__/mode-machine.test.ts`

**Step 1: Add settings-press test**

```typescript
  describe('settings-press', () => {
    it('enters settings mode', () => {
      const ui = createInitialUIState()
      const eng = makeState()
      const result = dispatch(ui, eng, { type: 'settings-press' })
      expect(result.ui.mode).toBe('settings')
      expect(result.ui.settingsParam).toBe(0)
    })
  })
```

**Step 2: Add settings enc B tests**

Test BPM adjustment, clock source cycling, MIDI toggle, channel adjustment.

**Step 3: Remove or update any routePage-dependent tests**

Search for `routePage` in test file and remove/update.

---

## Task 13: Update presets test for MIDIOutputConfig

**Files:**
- Modify: `src/engine/__tests__/presets.test.ts` (if it validates MIDIOutputConfig)

Check if any test references `config.enabled` on MIDI — if so, remove.

---

## Task 14: Run full test suite and build

**Step 1:** `npm test` — all tests pass
**Step 2:** `npm run build` — no type errors
**Step 3:** `npm run dev` — verify in browser:
- SETTINGS button visible under RESET
- Click enters settings screen with CLOCK and MIDI sections
- BPM adjustable with enc B
- SOURCE cycles INT / MIDI / EXT
- MIDI toggle works
- Per-output channel adjustable
- ROUTE screen no longer has MIDI sub-page
- BACK returns to home

---

## Implementation Order

| # | Task | Files |
|---|------|-------|
| 1 | Engine types | types.ts |
| 2 | Sequencer defaults + fix compile | sequencer.ts |
| 3 | MIDI output global flag | midi-output.ts, main.ts |
| 4 | UI types (ScreenMode, UIState) | hw-types.ts |
| 5 | Simplify ROUTE dispatch | mode-machine.ts |
| 6 | Settings row definitions | settings-rows.ts (new) |
| 7 | Settings screen renderer | lcd/settings-screen.ts (new) |
| 8 | Settings dispatch | mode-machine.ts |
| 9 | Wire SETTINGS button | faceplate.ts, controls.ts |
| 10 | Wire in main.ts | main.ts |
| 11 | Delete midi-screen, clean route | midi-screen.ts, route-screen.ts |
| 12 | Tests | mode-machine.test.ts |
| 13 | Preset test check | presets.test.ts |
| 14 | Full verify | npm test, npm run build |
