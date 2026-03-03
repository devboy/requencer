# LFO / MOD Redesign — 2026-03-03

## Summary

Redesign the MOD subtrack system so that each track has **two independent modulation sources** running in parallel:

1. **MOD SEQ** — a step sequencer with per-step slew, generation modes (RAND/RISE/FALL/VEE/HILL/SYNC/WALK), and gate-aware randomization from the RAND menu
1. **MOD LFO** — a continuous, rhythmically-synced waveform generator inspired by Pamela's New Workout, with an optional free-running mode

Both sources always run. The **routing layer** decides which source feeds each output's mod signal. This replaces the current model where LFO is a generator that overwrites the mod subtrack's steps.

The MOD SEQ side is also significantly upgraded from its current state (uniform random between low/high) to match the depth of the gate randomizer, with musically-aware generation algorithms and per-step slew for smooth transitions.

-----

## Motivation

The current LFO implementation (`lfo.ts`) pre-generates step values into the mod subtrack — it's a convenience wrapper around the randomizer, not a true LFO. This means:

- LFO and step-sequenced MOD are mutually exclusive (LFO overwrites steps)
- No continuous waveforms — only quantized-to-steps approximations
- No free-running mode
- No rhythmic sync options beyond "steps per cycle"

The redesign gives the user two fundamentally different modulation tools that coexist and can be swapped via routing, much like how Pamela's New Workout provides per-channel waveform selection alongside rhythmic clock division.

-----

## Architecture

### Current State

```
Track
  └── mod: Subtrack<number>     ← step sequencer OR LFO-generated steps (mutually exclusive)

LFOConfig
  └── enabled, waveform, rate, depth, offset  ← when enabled, overwrites mod steps

OutputRouting
  └── mod: number               ← source track index (0-3)

NoteEvent
  └── mod: number               ← 0-127, resolved from mod subtrack at current step
```

### Proposed State

```
Track
  └── mod: Subtrack<ModStep>    ← step sequencer with per-step value + slew

ModStep
  └── value: number             ← 0.0-1.0 CV value
  └── slew: number              ← 0.0-1.0, interpolation time as fraction of step

LFOState (per track)
  └── config: LFOConfig         ← waveform parameters
  └── phase: number             ← 0.0-1.0 current position in cycle (runtime state)

OutputRouting
  └── mod: number               ← source track index (0-3)
  └── modSource: 'seq' | 'lfo'  ← which source to read from that track

RandomConfig.mod
  └── low, high                 ← value range
  └── mode: 'random' | ...      ← generation algorithm
  └── slew: number              ← global slew default for generated patterns

NoteEvent
  └── mod: number               ← 0-127, resolved from EITHER seq or lfo based on routing
```

### Key Principle

Both MOD SEQ and MOD LFO always advance their state on every tick, regardless of whether they're routed to an output. This means:

- Switching `modSource` from `seq` to `lfo` mid-performance is seamless — the LFO has been running in the background
- Different outputs can route to the same track but pick different mod sources (e.g., Output A gets T1's MOD SEQ, Output B gets T1's MOD LFO)

-----

## Data Model Changes

### types.ts

```typescript
// --- MOD SEQ types ---

// Compound step type for mod subtrack (parallels PitchStep for pitch)
export interface ModStep {
  value: number              // 0.0-1.0, CV value
  slew: number               // 0.0 = instant, 0.01-1.0 = interpolation time as fraction of step
}

// MOD generation algorithm
export type ModMode = 'random' | 'rise' | 'fall' | 'vee' | 'hill' | 'sync' | 'walk'

// --- LFO types ---

// Replace existing LFOWaveform and LFOConfig

export type LFOWaveform = 'sine' | 'triangle' | 'saw' | 'square' | 'slew-random' | 's+h'

export type LFOSyncMode = 'track' | 'free'

export interface LFOConfig {
  waveform: LFOWaveform
  syncMode: LFOSyncMode
  // Synced mode: rate as clock division/multiplication relative to track clock
  //   Values: 1,2,3,4,6,8,12,16,24,32,48,64 (steps per cycle)
  //   The LFO completes one full cycle every N steps (after track+subtrack clock dividers)
  rate: number
  // Free mode: rate in Hz (0.05 - 20.0), not synced to clock
  freeRate: number
  depth: number              // 0.0-1.0, amplitude scaling
  offset: number             // 0.0-1.0, center value
  width: number              // 0.0-1.0, waveform skew/symmetry (0.5 = symmetric)
  phase: number              // 0.0-1.0, phase offset (shift start point)
}

// Runtime LFO state — tracks the current phase position
// This is NOT stored in engine state (it's computed from masterTick for synced,
// or accumulated for free-running)
export interface LFORuntime {
  currentPhase: number       // 0.0-1.0, current position in cycle
  lastSHValue: number        // for S+H waveform: holds value until next trigger
  slewTarget: number         // for slew-random: current interpolation target
  slewCurrent: number        // for slew-random: current interpolated value
}

// Updated OutputRouting
export interface OutputRouting {
  gate: number               // source track index 0-3
  pitch: number
  velocity: number
  mod: number                // source track index 0-3
  modSource: 'seq' | 'lfo'   // which mod source from the selected track
}
```

### SequencerState changes

```typescript
export interface SequencerState {
  // ... existing fields ...
  tracks: SequenceTrack[]          // mod subtrack changes from Subtrack<number> to Subtrack<ModStep>
  lfoConfigs: LFOConfig[]          // 4 LFO configs (one per track) — UPDATED type
  lfoRuntimes: LFORuntime[]        // 4 LFO runtime states (one per track) — NEW
  // Remove: lfoConfigs no longer has 'enabled' flag — LFO always runs
}
```

### RandomConfig.mod changes

The mod section of `RandomConfig` expands from `{ low, high }` to support generation modes and slew:

```typescript
// In RandomConfig, replace existing mod field:
mod: {
  low: number                    // 0.0-1.0, min CV value
  high: number                   // 0.0-1.0, max CV value
  mode: ModMode                  // generation algorithm
  slew: number                   // 0.0-1.0, default slew for generated steps
  slewProbability: number        // 0.0-1.0, chance each step gets slew (rest get 0)
  walkStepSize: number           // 0.0-0.5, max delta per step in WALK mode
  syncBias: number               // 0.0-1.0, how strongly to weight offbeat positions in SYNC mode
}
```

### SequenceTrack.mod changes

```typescript
// SequenceTrack.mod changes from:
mod: Subtrack<number>
// to:
mod: Subtrack<ModStep>
```

This parallels how pitch went from `Subtrack<Note>` to `Subtrack<PitchStep>` when slide was added.

-----

## Engine Changes

### lfo.ts — Rewrite

The current `generateLFOPattern()` function is replaced with a tick-level LFO evaluator. The LFO no longer generates an array of step values — it computes a single value at any given tick.

```typescript
/**
 * Compute LFO value at a given tick.
 *
 * For synced mode: phase = (masterTick / rate) % 1.0
 *   where rate is in steps (after clock division)
 *
 * For free mode: phase accumulates based on freeRate and time-per-tick
 *   phase += freeRate * (60 / bpm / 4)  per tick  (each tick = 1 sixteenth note)
 *
 * Returns 0.0-1.0 normalized value.
 */
export function computeLFOValue(
  config: LFOConfig,
  runtime: LFORuntime,
  masterTick: number,
  trackClockDivider: number,
  bpm: number,
): { value: number; runtime: LFORuntime }
```

#### Waveform definitions

All waveforms take `phase` (0.0-1.0) and `width` (0.0-1.0) and return 0.0-1.0:

|Waveform     |Description                                                      |Width effect                                                                     |
|-------------|-----------------------------------------------------------------|---------------------------------------------------------------------------------|
|`sine`       |Standard sine, 0→1→0                                             |Skews the peak earlier (< 0.5) or later (> 0.5)                                  |
|`triangle`   |Linear ramp up then down                                         |Sets the peak position (0.5 = symmetric triangle, 0.0 = ramp down, 1.0 = ramp up)|
|`saw`        |Rising ramp 0→1 with reset                                       |Width controls rise vs. fall time (0.5 = pure saw, 0.0 = reverse saw)            |
|`square`     |On/off pulse                                                     |Width = pulse width / duty cycle                                                 |
|`slew-random`|Random target values with slew between them                      |Controls slew speed (0.0 = instant/S&H, 1.0 = very slow glide)                   |
|`s+h`        |Sample & hold — new random value at cycle start, holds until next|Width controls trigger point within cycle                                        |

#### Synced phase calculation

```
effectiveTick = floor(masterTick / trackClockDivider)
phase = ((effectiveTick + config.phase * config.rate) % config.rate) / config.rate
```

The LFO cycle length is `config.rate` steps (after track clock division). So if a track has `clockDivider: 2` and `lfo.rate: 8`, the LFO completes one cycle every 8 divided-clock steps = 16 master ticks.

#### Free-running phase calculation

```
tickDuration = 60 / bpm / 4    // seconds per sixteenth note
phaseIncrement = config.freeRate * tickDuration
newPhase = (runtime.currentPhase + phaseIncrement) % 1.0
```

The LFO runs at `freeRate` Hz regardless of tempo or clock division.

#### Output scaling

```
raw = waveformFunction(phase, width)           // 0.0-1.0
scaled = config.offset + (raw - 0.5) * config.depth
output = clamp(scaled, 0.0, 1.0)
```

### sequencer.ts — tick() changes

The `tick()` function needs to:

1. **Advance LFO runtimes** on every tick (regardless of routing)
1. **Pass LFO values to routing** so `resolveOutputs` can choose between seq and lfo

```typescript
export function tick(state: SequencerState): { state: SequencerState; events: NoteEvent[] } {
  // ... existing track step advancement ...

  // Compute LFO values for all 4 tracks at current tick
  const lfoValues: number[] = state.lfoConfigs.map((config, idx) => {
    const track = state.tracks[idx]
    const { value } = computeLFOValue(
      config,
      state.lfoRuntimes[idx],
      masterTick,
      track.clockDivider,
      state.transport.bpm,
    )
    return value
  })

  // Advance LFO runtimes for next tick
  const nextLFORuntimes = state.lfoConfigs.map((config, idx) => {
    const track = state.tracks[idx]
    const { runtime } = computeLFOValue(
      config,
      state.lfoRuntimes[idx],
      masterTick + 1,
      track.clockDivider,
      state.transport.bpm,
    )
    return runtime
  })

  // Pass lfoValues to resolveOutputs
  const events = resolveOutputs(
    currentTracks, state.routing, currentMutes,
    state.transposeConfigs, lfoValues  // NEW parameter
  )

  return {
    state: {
      ...state,
      // ... existing ...
      lfoRuntimes: nextLFORuntimes,
    },
    events,
  }
}
```

### routing.ts — resolveOutputs changes

```typescript
export function resolveOutputs(
  tracks: SequenceTrack[],
  routing: OutputRouting[],
  mutes: MuteTrack[],
  transposeConfigs?: TransposeConfig[],
  lfoValues?: number[],          // NEW: per-track LFO values (0.0-1.0)
): NoteEvent[] {
  // ...
  for (let i = 0; i < NUM_OUTPUTS; i++) {
    const r = routing[i]
    // ...

    // MOD resolution: choose source based on modSource
    let mod: number
    let modSlew: number = 0
    if (r.modSource === 'lfo' && lfoValues) {
      mod = lfoValues[r.mod]     // continuous LFO value from track r.mod
      modSlew = 0                // LFO output is already continuous, no step slew
    } else {
      const modTrack = tracks[r.mod]
      const modStep = modTrack?.mod.steps[modTrack.mod.currentStep]
      mod = modStep?.value ?? 0
      modSlew = modStep?.slew ?? 0
    }

    // ... rest of event construction, include modSlew in NoteEvent ...
  }
}
```

-----

## RAND Menu Changes

### Remove the LFO section from RAND

The current RAND screen has a `section.lfo` with `lfo.enabled`, `lfo.waveform`, `lfo.rate`, `lfo.depth`. This is removed because:

- LFO is no longer a "generate into steps" action — it's a live, always-running source
- LFO parameters belong on the MOD LFO edit screen (see UI below)

### Expand the MOD section

The MOD section grows from 2 rows (`mod.low`, `mod.high`) to a full section with generation modes and slew, matching the depth of the GATE section.

#### rand-rows.ts — new MOD section

```
section.mod                          (header)
mod.low           → MOD LO           always visible
mod.high          → MOD HI           always visible
mod.mode          → MODE             always visible — RAND / RISE / FALL / VEE / HILL / SYNC / WALK
mod.walkStepSize  → WALK Δ           visible when mode = walk
mod.syncBias      → BIAS             visible when mode = sync
mod.slew          → SLEW             always visible — 0-100%
mod.slewProb      → SLEW %           always visible — 0-100%
```

Remove these rows:

```
section.lfo
lfo.enabled
lfo.waveform
lfo.rate
lfo.depth
```

Remove the corresponding `SECTION_PARAMS['section.lfo']` entry. Update `SECTION_PARAMS['section.mod']` to include all new param IDs.

-----

## MOD SEQ Generation Modes

Four generation algorithms, paralleling the gate randomizer's RAND/EUCL/SYNC/CLST:

### RAND — Uniform Random (current behavior, upgraded)

Each step gets an independent random value between `low` and `high`. This is the existing `randomizeMod()` behavior, now upgraded to produce `ModStep[]` with slew values.

```
randomizeMod(config, length, seed):
  for each step:
    value = low + rng() * (high - low)
    slew = rng() < slewProbability ? config.slew : 0
  return ModStep[]
```

### RISE / FALL / VEE / HILL — Ramp Shapes

Generates deterministic ramp patterns with optional noise. These create predictable mod sweeps useful for filter opens, builds, and structural modulation.

|Mode  |Shape          |Description                             |
|------|---------------|----------------------------------------|
|`rise`|`low→high`     |Linear ascending ramp across the pattern|
|`fall`|`high→low`     |Linear descending ramp                  |
|`vee` |`high→low→high`|V-shape, dip in the middle              |
|`hill`|`low→high→low` |Inverted V, peak in the middle          |

```
randomizeModRamp(mode, config, length, seed):
  for each step i:
    t = i / (length - 1)                        // 0.0 → 1.0 across pattern

    // Base shape (all produce 0.0-1.0)
    if mode == 'rise':  base = t                 // ramp up
    if mode == 'fall':  base = 1 - t             // ramp down
    if mode == 'hill':  base = t < 0.5 ? t * 2 : (1 - t) * 2       // peak at center
    if mode == 'vee':   base = t < 0.5 ? 1 - t * 2 : (t - 0.5) * 2 // dip at center

    value = low + base * (high - low)
    slew = config.slew                           // ramps benefit from uniform slew
  return ModStep[]
```

With `slew > 0`, ramp patterns produce smooth sweeps even with coarse step resolution. With `slew = 0`, they produce staircase ramps that create more rhythmic, stepped modulation.

### SYNC — Syncopated Accents

High mod values on rhythmically interesting (offbeat/syncopated) positions, low values on strong beats. Mirrors the SYNC gate algorithm's positional weighting system, but instead of placing gates it places high CV values.

```
randomizeModSync(config, length, seed):
  for each step i:
    pos = i % 4
    // Position weights (same as gate SYNC)
    if pos == 0: weight = 0.15    // downbeats: low mod (steady)
    if pos == 3: weight = 0.6     // "a" positions: medium-high
    else:        weight = 1.0     // "e" and "and": highest

    // Bias controls how strongly the weighting applies
    // bias = 0.0: all positions equal (degrades to RAND)
    // bias = 1.0: full syncopated weighting
    effectiveWeight = lerp(0.5, weight, config.syncBias)

    // Scale into value range
    value = low + effectiveWeight * rng() * (high - low)
    slew = rng() < slewProbability ? config.slew : 0
  return ModStep[]
```

Musical use case: filter accent patterns where offbeats get brighter, downbeats stay subdued. Classic acid/techno modulation feel.

### WALK — Brownian Motion

Random walk where each step is the previous step ± a random delta. Creates coherent, evolving patterns because adjacent values are related.

```
randomizeModWalk(config, length, seed):
  current = (low + high) / 2                // start at midpoint
  for each step i:
    delta = (rng() * 2 - 1) * walkStepSize  // random ± step
    current = clamp(current + delta, low, high)
    value = current
    slew = rng() < slewProbability ? config.slew : 0
  return ModStep[]
```

`walkStepSize` controls volatility: small values (0.05) create gentle drifts, large values (0.3) create jagged jumps. Interacts well with the mutator — as steps drift via mutation, the walk character is preserved because each mutation is also a local change.

-----

## Step Slew — Interpolation Between Steps

### Concept

Per-step slew on the mod subtrack, conceptually identical to per-step slide on the pitch subtrack. When a step has `slew > 0`, the mod output interpolates from the previous step's value to the current step's value over the step's duration.

```
step N-1: value=0.2, slew=0
step N:   value=0.8, slew=0.5
step N+1: value=0.4, slew=0

Timeline:
  N-1:    |---0.2---|  (instant jump to 0.2)
  N:      |0.2~~>0.8|  (glides from 0.2 to 0.8 over first 50% of step, holds 0.8)
  N+1:    |---0.4---|  (instant jump to 0.4)
```

### Implementation

**Engine layer**: No change to `tick()` — the engine emits `ModStep` (value + slew) per step. The slew is metadata for the I/O layer, same as pitch slide.

**I/O layer** (`tone-output.ts`, `midi-output.ts`): When emitting a mod value for a step with `slew > 0`, schedule a ramp from the previous mod value to the current mod value over `slew * stepDuration` seconds.

For MIDI CC output, this means interpolating CC values over time (sending multiple CC messages during the slew window). For Tone.js / CV output, it maps to a `linearRampToValueAtTime` call.

**NoteEvent**: Add `modSlew` field alongside existing `mod`:

```typescript
export interface NoteEvent {
  // ... existing fields ...
  mod: number                // 0-127, target value
  modSlew: number            // 0.0-1.0, interpolation time as fraction of step (0 = instant)
}
```

### Slew in RAND config

Two parameters control slew during randomization:

- **`slew`** (0.0-1.0): The slew time value applied to steps that get slew
- **`slewProbability`** (0.0-1.0): Chance each step gets slew (vs. instant jump)

This gives the user control over both the character (how smooth) and density (how many steps) of slew. For ramp modes (RISE/FALL/VEE/HILL), all steps get the configured slew value since continuous smoothness is the point.

### Randomize actions

- **Hold R + D** (randomize mod subtrack): generates `ModStep[]` using the selected mode, range, and slew settings
- **Hold D** (randomize all): randomizes mod steps for all tracks using each track's mod config
- **Existing mod randomization in `randomizeTrack()`**: updated to use selected mode and produce `ModStep[]` instead of `number[]`

-----

## UI Changes

### Route Screen (S button)

Add `modSource` selector to the routing UI. Each output's MOD routing now shows two things:

1. **Source track** (T1-T4) — which track's mod to use
1. **Source type** (SEQ / LFO) — which modulation source from that track

Display format: `MOD: T1 SEQ` or `MOD: T2 LFO`

The source type toggles with the encoder when the MOD routing row is selected.

### MOD Edit Screen (R button → MOD)

The MOD edit screen currently shows step bars when LFO is off, and LFO info when LFO is on. With the redesign:

**MOD SEQ mode** (default when pressing R to enter MOD edit):

- Shows step bars as today, with slew visualized as a curved connector between bars
- Header: `MOD SEQ — T1`
- Step editing with encoder: Up/Down adjusts value, Left/Right adjusts slew for selected step
- Hold step button to see value + slew readout in header area
- Indicator showing whether any output is routing this track's MOD SEQ

**MOD LFO mode** (toggle via a button or encoder action from MOD edit):

- Header: `MOD LFO — T1`
- Shows a waveform preview (rendered as a curve across the LCD)
- Parameter list below the preview:
  - `WAVE`: sine / tri / saw / sqr / slew / s+h
  - `SYNC`: TRACK / FREE
  - `RATE`: 1-64 (synced) or 0.05-20.0 Hz (free)
  - `DEPTH`: 0-100%
  - `OFFSET`: 0-100%
  - `WIDTH`: 0-100%
  - `PHASE`: 0-100%
- Animated waveform during playback (cursor shows current phase position)
- Indicator showing whether any output is routing this track's MOD LFO

**Toggling between MOD SEQ and MOD LFO views:**

- Use a dedicated gesture (suggestion: double-tap R while in MOD edit, or press a combo)
- Both views show their respective content — switching views doesn't change routing
- The view toggle is per-track and part of UIState, not engine state

### Dashboard / Home Screen

When a track's MOD is routed to LFO, the dashboard could optionally show a small LFO indicator instead of the mod step pattern. This is a nice-to-have, not essential for V1.

-----

## Migration from Current LFO

### What gets removed

- `LFOConfig.enabled` field — LFO always exists, routing decides usage
- `regenerateLFO()` in sequencer.ts — no longer needed (LFO doesn't write to steps)
- The concept of "LFO mode overwrites mod steps" — steps and LFO are independent
- `randomizeMod()` in its current form — replaced by mode-aware generation

### What gets added

- `ModStep` compound type (value + slew), replacing `number` in mod subtrack
- `ModMode` type and generation algorithms (RAND, RISE/FALL/VEE/HILL, SYNC, WALK) in randomizer
- `LFORuntime` per track in `SequencerState`
- `modSource` field in `OutputRouting`
- `computeLFOValue()` tick-level function
- New LFO waveforms: `square`, `s+h`
- New LFO params: `syncMode`, `freeRate`, `width`, `phase`
- Expanded `RandomConfig.mod` with `mode`, `slew`, `slewProbability`, `walkStepSize`, `syncBias`
- `modSlew` field in `NoteEvent`
- I/O layer slew interpolation for mod output
- UI for LFO parameter editing on the MOD screen
- UI for per-step slew editing on the MOD SEQ screen

### Default state for new sequencers

```typescript
// Default ModStep
{ value: 0, slew: 0 }

// Default RandomConfig.mod (expanded)
{
  low: 0,
  high: 1,
  mode: 'random',
  slew: 0,
  slewProbability: 0,
  walkStepSize: 0.15,
  syncBias: 0.7,
}

// Default LFO config (matches a useful starting point)
{
  waveform: 'sine',
  syncMode: 'track',
  rate: 16,            // one full cycle per 16 steps (= 1 bar at base clock)
  freeRate: 1.0,       // 1 Hz when in free mode
  depth: 1.0,
  offset: 0.5,
  width: 0.5,          // symmetric
  phase: 0.0,          // no offset
}

// Default routing (unchanged behavior — uses SEQ by default)
{
  gate: i, pitch: i, velocity: i, mod: i,
  modSource: 'seq',    // step sequencer by default
}
```

-----

## Implementation Plan

Ordered by dependency. Each step should be a testable unit.

### Phase 1: MOD SEQ Data Model + Generation

1. **Update types.ts — MOD SEQ types**
- Add `ModStep` interface (`value`, `slew`)
- Add `ModMode` type
- Change `SequenceTrack.mod` from `Subtrack<number>` to `Subtrack<ModStep>`
- Expand `RandomConfig.mod` with `mode`, `slew`, `slewProbability`, `walkStepSize`, `syncBias`
- Add `modSlew` to `NoteEvent`
1. **Update randomizer.ts — MOD generation modes**
- Rewrite `randomizeMod()` to dispatch on `ModMode` and return `ModStep[]`
- Implement `randomizeModRandom()` — uniform random with slew
- Implement `randomizeModRamp()` — RISE/FALL/VEE/HILL shapes
- Implement `randomizeModSync()` — syncopated accent weighting
- Implement `randomizeModWalk()` — brownian random walk
- Update `randomizeTrack()` to use new `randomizeMod()` signature
- Write tests for all 7 modes (RAND, RISE, FALL, VEE, HILL, SYNC, WALK)
1. **Update routing.ts — ModStep resolution**
- Update `resolveOutputs()` to read `ModStep.value` instead of raw number
- Pass `ModStep.slew` through to `NoteEvent.modSlew`
- Write routing tests for ModStep extraction
1. **Update sequencer.ts — ModStep plumbing**
- Update `createTrack()` default mod steps to `{ value: 0, slew: 0 }`
- Update `setStep()` for mod to accept `ModStep`
- Update `resizeSteps()` default for mod
- Update all randomize pattern functions that touch mod

### Phase 2: LFO Engine

1. **Update types.ts — LFO types**
- Add `LFOSyncMode`, update `LFOWaveform` (add `square`, `s+h`)
- Update `LFOConfig` (add `syncMode`, `freeRate`, `width`, `phase`; remove `enabled`)
- Add `LFORuntime`
- Add `modSource` to `OutputRouting`
- Add `lfoRuntimes` to `SequencerState`
1. **Rewrite lfo.ts**
- Implement `computeLFOValue()` with all waveforms
- Implement synced and free-running phase calculation
- Implement width/skew for each waveform
- Write tests for each waveform at various phases, widths, sync modes
1. **Update routing.ts — LFO source selection**
- Add `lfoValues` parameter to `resolveOutputs()`
- Implement `modSource` switching logic (seq reads ModStep, lfo reads lfoValues)
- Update `createDefaultRouting()` to include `modSource: 'seq'`
- Write routing tests for seq vs lfo source selection
1. **Update sequencer.ts — LFO tick integration**
- Add LFO computation to `tick()`
- Add LFO runtime advancement
- Update `createSequencer()` defaults
- Remove `regenerateLFO()` function
- Write integration tests: tick with LFO routed, tick with SEQ routed

### Phase 3: RAND Screen

1. **Update rand-rows.ts**
- Remove `section.lfo` and all `lfo.*` rows
- Expand `section.mod` with MODE, WALK Δ, BIAS, SLEW, SLEW % rows
- Update `SECTION_PARAMS`
- Add conditional visibility (WALK Δ visible when mode=walk, BIAS visible when mode=sync)
1. **Update mode-machine.ts — RAND dispatch**
- Remove LFO-related dispatch cases
- Add dispatch for new mod params: mode cycling, walkStepSize, syncBias, slew, slewProbability
- Ensure randomize actions produce `ModStep[]`

### Phase 4: UI

1. **Update mod-edit.ts — MOD SEQ view**
- Render `ModStep` bars with slew visualization (curved connectors between bars)
- Encoder A = value, Encoder B = slew for selected step
- Header shows value% and slew% for selected step
1. **Add MOD LFO view to mod-edit.ts**
- Waveform preview rendered as a curve
- Parameter list: WAVE, SYNC, RATE, DEPTH, OFFSET, WIDTH, PHASE
- Animated cursor during playback
1. **Update route screen**
- Add `modSource` display and editing to the MOD routing row
- Show `SEQ` / `LFO` label next to track selector
1. **Update mode-machine.ts — MOD screens**
- Add MOD LFO parameter editing
- Add MOD SEQ / MOD LFO view toggle
- Add route screen modSource toggling

### Phase 5: I/O + Polish

1. **Update tone-output.ts — mod slew scheduling**
- When `modSlew > 0`, schedule `linearRampToValueAtTime` for mod output
- Interpolate from previous step's mod value to current over `slew * stepDuration`
1. **Update midi-output.ts — mod slew as CC interpolation**
- When `modSlew > 0`, send intermediate CC values over the slew window
- Quantize interpolation to ~10ms intervals for smooth MIDI CC
1. **Waveform preview animation**
- Animate the LFO waveform preview during playback
1. **Dashboard indicator**
- Optional: show LFO indicator on dashboard when MOD is routed to LFO

-----

## Testing Strategy

Following project convention: TDD, write failing tests first.

### randomizer.test.ts — MOD generation tests

- **RAND mode**: values between low/high, slew applied per slewProbability
- **RISE mode**: values monotonically increase from low to high
- **FALL mode**: values monotonically decrease from high to low
- **VEE mode**: values decrease to midpoint then increase (V-shape)
- **HILL mode**: values increase to midpoint then decrease (peak in middle)
- **SYNC mode**: offbeat positions get higher average values than downbeats
- **SYNC mode with bias=0**: degrades to roughly uniform distribution
- **WALK mode**: adjacent step values differ by at most walkStepSize
- **WALK mode**: values stay within low/high bounds
- **All modes**: slew values respect slewProbability (count steps with slew > 0)
- **All modes**: output length matches requested length
- **Deterministic**: same seed produces same output

### lfo.test.ts — Unit tests

- Each waveform returns values in [0, 1] for all phases
- Width parameter correctly skews each waveform
- Phase offset shifts waveform start point
- Synced mode: phase wraps correctly at rate boundary
- Free mode: phase accumulates correctly across ticks
- S+H: value holds constant within a cycle, changes at cycle boundary
- Slew-random: value interpolates between random targets
- Square: width controls duty cycle
- Depth scaling works correctly
- Offset shifts output range correctly
- Edge cases: rate=1 (fastest), rate=64 (slowest), depth=0 (flat), width=0 and width=1

### routing.test.ts — Integration tests

- `modSource: 'seq'` reads `ModStep.value` from `track.mod.steps[currentStep]`
- `modSource: 'seq'` passes `ModStep.slew` through to `NoteEvent.modSlew`
- `modSource: 'lfo'` reads from `lfoValues[trackIndex]` and sets `modSlew: 0`
- Different outputs can use different modSources from the same track
- Backward compat: routing without modSource defaults to 'seq'

### sequencer.test.ts — Tick integration

- LFO runtime advances on every tick regardless of routing
- LFO value appears in NoteEvent.mod when modSource='lfo'
- MOD SEQ value + slew appear in NoteEvent when modSource='seq'
- Free-running LFO phase accumulates correctly across many ticks
- Transport stop/start: LFO phase behavior (synced resets, free continues)
- Mutator with mod drift: only affects ModStep values, not LFO config

-----

## Design Decisions

Resolved during design review. These are final and should not be reopened during implementation.

1. **Reset behavior**: Synced LFO phase resets to 0 when transport resets. Free-running LFO phase is unaffected by transport — it keeps accumulating. This matches standard eurorack behavior (clock-synced resets with clock, free doesn't).
1. **Mutator interaction**: The mutator drifts `ModStep.value` only — `slew` is a structural choice and is preserved during mutation. LFO parameters (depth, rate, etc.) are NOT driftable by the mutator. LFO drift is a potential future feature but out of scope.
1. **MIDI CC mapping**: Mod output maps to CC1. Not configurable per-output for now. The `modSlew` field triggers CC interpolation in the I/O layer (multiple CC messages sent over the slew window).
1. **Preset save/load**: The expanded `RandomConfig.mod` (mode, slew, slewProbability, walkStepSize, syncBias) IS part of RAND presets. `LFOConfig` is NOT — it's track configuration, saved/loaded with full sequencer state (future snapshot feature).
1. **LFO ownership**: Per-track. Each track owns one LFO. Routing selects both the source track and the source type (SEQ/LFO). If you want 4 different LFOs on 4 outputs, route each output to a different track's LFO.
1. **WAVE generation mode**: Skipped. Sine/tri/square shapes baked into steps are fully covered by the LFO side. RISE/FALL/VEE/HILL cover linear ramp shapes for the SEQ side. No overlap needed.
1. **Factory preset mod configs**: Rough defaults per preset to showcase different modes. Since the mod destination is user-defined (filter, oscillator, VCA — whatever they patch), presets can't optimize for a specific target. Suggested starting points:

   |Preset    |Mode  |Key params               |
   |----------|------|-------------------------|
   |Bassline  |walk  |stepSize: 0.1, slew: 0.5 |
   |Acid      |sync  |bias: 0.8, slew: 0.3     |
   |Hypnotic  |rise  |slew: 0.8                |
   |Ambient   |walk  |stepSize: 0.05, slew: 0.9|
   |Percussive|random|slew: 0, slewProb: 0     |
   |Sparse    |fall  |slew: 0.6                |
   |Stab      |sync  |bias: 0.5, slew: 0       |
   |Driving   |random|slew: 0.2, slewProb: 0.5 |

   These are rough — tweak during implementation based on how they sound.
1. **ModStep mutator compat**: `mutateTrack()` updated to produce `ModStep[]`. Drifted steps get new random `value` (using active RandomConfig.mod), `slew` is copied from the existing step unchanged. Follows from decision #2.

-----

## Reference: Pamela's New Workout LFO Model

Pamela's approach that influenced this design:

- Each of 8 outputs is a clock-synced source that can output gates, LFO waveforms, envelopes, or random voltages
- Rate is set as a clock multiplier/divider relative to global BPM
- Waveforms are shapeable via width (morphs triangle↔saw, adjusts pulse width)
- Phase offset allows creating related but shifted waveforms across outputs
- Everything stays rhythmically locked to the master clock

Our adaptation differs in that we have a dedicated step sequencer running in parallel, giving the user both a manually-editable/randomizable pattern AND a continuous waveform, switchable per output via routing.
