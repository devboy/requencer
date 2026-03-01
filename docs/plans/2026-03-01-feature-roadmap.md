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
