# Feature Roadmap

**Date:** 2026-03-01
**Status:** Active

Post-V1 feature priorities for Requencer. Each tier builds on the previous. See [feature ideas research](../research/feature-ideas.md) for detailed trade-offs and open questions.

---

## Tier 1 — Core Expression

Foundation features that make sequences musically expressive. Build in order.

### 1. Gate Length
Per-step note duration — how long each note stays "on" within its step window.
- **Depends on:** nothing (first new engine feature)
- **Complexity:** M — new step property, engine gateOn/gateOff pairs, I/O scheduling, UI editing

### 2. Ratchets
Per-step subdivisions (2x/3x/4x) for rolls and fills.
- **Depends on:** gate length (ratchet timing derives from gate duration)
- **Complexity:** M — subdivision logic in engine, multi-trigger scheduling in I/O

### 3. Slides
Per-step boolean on pitch track — TB-303 style portamento between notes.
- **Depends on:** nothing (but benefits from gate length being done first)
- **Complexity:** S — boolean flag per step, Tone.js portamento in I/O

---

## Tier 2 — Generative Identity

Features that define Requencer's character as a generative instrument.

### 4. Mutate
Turing machine-style per-loop evolution. Each loop, a percentage of steps get regenerated using the active random constraints. The module's signature feature.
- **Depends on:** nothing (architecturally independent)
- **Complexity:** M — mutation logic at loop boundaries, UI for mutation rate, visual feedback

### 5. Pitch Transposition
Per-track transpose offset + range scaling. Shift sequences by semitones or scale degrees.
- **Depends on:** nothing (overlay, independent of engine changes)
- **Complexity:** S — pure overlay function on pitch output

### 6. Pitch Arpeggio Generator
Chord-tone walking mode as an alternative to random pitch generation. Up/down/triangle/random directions.
- **Depends on:** nothing (extends existing random pitch generator)
- **Complexity:** M — new generator mode, chord definition UI, direction/octave params

---

## Tier 3 — Modulation & Advanced

Deeper features that expand modulation and pattern complexity.

### 7. MOD Subtrack UI
Wire existing MOD data structures to the LCD. Add step editing screen for MOD values.
- **Depends on:** nothing (closes a V1 gap)
- **Complexity:** S — UI-only, data structures already exist

### 8. Smart Gate Generation
Multi-bar aware gate patterns — sequences that evolve across 2/4/8/16-bar phrases instead of repeating every bar.
- **Depends on:** nothing (but benefits from mutate being done for comparison)
- **Complexity:** L — needs research on approach (bar-offset overlay vs. multi-bar generation)

### 9. MOD as LFO
Continuous waveforms (sine, triangle, saw, slewed random) as an alternative MOD source. Synced to track loop, global bars, or free-running.
- **Depends on:** MOD subtrack UI (need editing UI before adding LFO mode)
- **Complexity:** L — new generator type, continuous output scheduling, waveform preview UI

---

## Tier 4 — Connectivity

External integration, low priority while prototyping in-browser.

### 10. Web MIDI Output
Route engine output to external MIDI devices via Web MIDI API.
- **Depends on:** nothing
- **Complexity:** M — MIDI message translation, channel mapping, clock sync, latency compensation

---

### 11. Ties (Multi-Step Notes) ✅
Notes/gates that span longer than a single step. A tied step extends the previous note's gate rather than triggering a new attack.
- **Implemented:** tie flag on GateStep, retrigger/sustain in NoteEvent, look-ahead/look-back in routing, hold-step + press-step gesture in gate-edit, connecting bridge visual, tie probability/maxLength in RAND config
- **Note:** In a eurorack CV/gate context, pitch could change mid-tie without retrigger (pitch is a separate CV). Current MIDI model ignores pitch on tied steps. This is a future consideration for CV output mode.

---

## Future — Unscheduled

### Clock Divider Gate Scaling
When a gate track has a clock divider > 1, each step spans multiple ticks but the audible gate duration stays at the base 16th-note length. The gate window should scale proportionally with the effective step duration.
- **Current behavior:** `stepDuration` passed to I/O is always the base 16th-note duration. A track with `clockDivider: 2` fires steps half as often, but each note is the same length as an undivided track.
- **Desired behavior:** The I/O layer receives the effective step duration (base × combined track/subtrack divider) so gate length, ratchet subdivision, and release timing all scale naturally.
- **Impact:** I/O layer (`tone-output.ts`, `midi-output.ts`) needs per-event step duration. Either pass it through NoteEvent or compute it in `main.ts` from the gate source track's dividers.
- **Complexity:** S — plumbing change, no engine logic affected

### High-Resolution Internal Clock (24 PPQN)
The engine currently ticks at 1 tick per 16th note (effectively 4 PPQN). A higher resolution clock (24 PPQN, the MIDI standard) would give more precise timing for ratchets, gate lengths, swing, and future features like shuffle/groove templates.
- **Current model:** 1 tick = 1 step. Ratchets and gate length are handled in the I/O layer by subdividing `stepDuration` with floating-point math. This works but means the engine has no concept of sub-step timing.
- **Proposed model:** 6 ticks per 16th note (24 PPQN). The engine distinguishes "step boundaries" from "micro-ticks within a step." Gate length and ratchets become tick counts instead of float fractions. The I/O layer schedules events at tick-level precision.
- **Benefits:** Precise ratchet timing without float rounding, natural swing/groove (shift steps by ±ticks), accurate MIDI clock output, sub-step gate resolution.
- **Trade-offs:** Engine runs 6× more ticks per beat, step-based UI/routing needs to map between tick position and step index, all existing clock divider logic needs updating, significant refactor across engine/I/O/UI.
- **Complexity:** XL — architectural change touching every layer. Worth doing before hardware port.
