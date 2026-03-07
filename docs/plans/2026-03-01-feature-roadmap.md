# Feature Roadmap

**Date:** 2026-03-01
**Updated:** 2026-03-04
**Status:** All tiers complete except MIDI clock sync

Post-V1 feature priorities for Requencer. Each tier built on the previous. See [feature ideas research](../research/feature-ideas.md) for detailed design notes.

---

## Tier 1 — Core Expression ✅

### 1. Gate Length ✅
Per-step note duration (0.05–1.0 fraction of step window).
- GateStep.length field, randomizer with min/max config, Tone.js/MIDI output scheduling
- UI: gate-edit screen shows GL% with visual bar; hold step + Encoder A to adjust (0.05 increments)
- Transpose glScale multiplier applied in routing

### 2. Ratchets ✅
Per-step subdivisions (1–4x) for rolls and fills.
- GateStep.ratchet field, randomizer with probability + maxRatchet config
- I/O subdivides step into N equal sub-triggers, each with proportional gate length
- UI: gate-edit shows tick marks + "R:Nx" label; hold step + Encoder B to adjust
- Tied steps force ratchet to 1

### 3. Slides ✅
Per-step portamento time (0–0.50s) on pitch track — TB-303 style glide.
- PitchStep.slide field, randomizer with probability config (0.1s default when active)
- Tone.js synth.portamento set per note; MIDI output carries slide value
- UI: pitch-edit shows orange bars + diagonal connector lines; hold step + Encoder B to adjust (0.05s increments)

---

## Tier 2 — Generative Identity ✅

### 4. Mutate ✅
Turing machine-style per-loop evolution. Configurable drift probability per track, triggering at loop boundaries.
- Dedicated MUTATE screen with probability and trigger mode settings

### 5. Pitch Transposition ✅
Per-track semitone offset + note window (lo/hi) + gate length and velocity scaling.
- Dedicated XPOSE screen with PITCH and DYNAMICS sections

### 6. Pitch Arpeggio Generator ✅
Chord-tone walking mode with up/down/triangle/random directions, configurable octave range.
- Integrated as arp mode in randomizer config

---

## Tier 3 — Modulation & Advanced ✅

### 7. MOD Subtrack UI ✅
Full MOD editing screen with two views: MOD SEQ (per-step value + slew bar graph) and MOD LFO (animated waveform preview with 7 editable parameters).

### 8. Smart Gate Generation — Removed
Multi-bar phrase patterns proved untestable in prototype context. Replaced by 4 single-bar gate modes (random, euclidean, sync, cluster) which are more musically useful. See [gate modes redesign](../archive/2026-03-03-gate-modes-redesign.md).

### 9. MOD as LFO ✅
6 waveforms (sine, triangle, saw, square, slew-random, S+H), synced or free-running.
- Dual modulation: MOD SEQ and MOD LFO run in parallel, switchable via output routing
- Width parameter for waveform skewing (pulse width, triangle skew, rise/fall ratio)

---

## Tier 4 — Connectivity ✅

### 10. Web MIDI Output ✅
Per-output MIDI channel selection, note/CC output, ratchet subdivision support.
- Global MIDI on/off toggle in settings
- **Not yet implemented:** MIDI clock input/sync (settings UI shows INT/MIDI/EXT source but only INT is functional)

### 11. Ties (Multi-Step Notes) ✅
Tie flag on GateStep, retrigger/sustain in NoteEvent, look-ahead/look-back in routing, hold-step + press-step gesture in gate-edit, connecting bridge visual, tie probability/maxLength in RAND config.

### 12. Variations ✅
Deterministic, non-destructive transform overlays applied per bar of a phrase (2/4/8/16 bars).
- 11 transforms: reverse, ping-pong, rotate, thin, fill, skip, transpose, invert, octave-shift, double-time, stutter
- Per-subtrack overrides (gate/pitch/velocity/mod can have independent variation patterns)
- Composable: playhead transforms first, then value transforms

### 13. Persistence ✅
localStorage save/load for user presets and track patterns across page reloads.

---

## Future — Unscheduled

### Snapshot / Undo — HIGH PRIORITY
Save a temporary copy of the current state before destructive edits (randomize, mutate, manual edits). Revert instantly. Single anchor point, not full undo history.
- **Inspiration:** PER|FORMER (snapshot), Eloquencer (freeze/revert), Mimetic Digitalis (single-level undo)
- **Architectural fit:** Deep copy of `SequencerState`. "Take snapshot" = clone, "Revert" = replace, "Commit" = discard. Pure state operation.
- **Open question:** UX — how to trigger snapshot/revert during live performance (button combo? dedicated button? hold gesture?)
- **Complexity:** S (engine) — needs UX design

### Swing / Groove
Per-track timing offset that delays even/odd steps by a percentage of the clock interval for rhythmic feel.
- **Inspiration:** Metropolix (50–78%), PER|FORMER (50–75%), OXI One (per-step 1ms), T-1 (8 groove templates)
- **Architectural fit:** Applied in I/O layer (`tone-output.ts`), not the engine — engine ticks on-grid, I/O offsets the Tone.js `time` parameter. Keeps engine purity.
- **Complexity:** S-M (I/O only)

### MIDI Clock Input/Sync
Settings UI shows clock source options (INT/MIDI/EXT) but only internal clock is functional. Needs a MIDI input handler to receive and process incoming MIDI clock messages.
- **Complexity:** M — MIDI input listener, clock recovery, jitter compensation

### Clock Divider Gate Scaling
When a gate track has a clock divider > 1, each step spans multiple ticks but the audible gate duration stays at the base 16th-note length. The gate window should scale proportionally with the effective step duration.
- **Current behavior:** `stepDuration` passed to I/O is always the base 16th-note duration. A track with `clockDivider: 2` fires steps half as often, but each note is the same length as an undivided track.
- **Desired behavior:** The I/O layer receives the effective step duration (base × combined track/subtrack divider) so gate length, ratchet subdivision, and release timing all scale naturally.
- **Impact:** I/O layer (`tone-output.ts`, `midi-output.ts`) needs per-event step duration. Either pass it through NoteEvent or compute it in `main.ts` from the gate source track's dividers.
- **Complexity:** S — plumbing change, no engine logic affected

### Full Project Snapshots
Currently track-level pattern save/load works (per-track snapshots with all subtracks + config). A full project snapshot (all 4 tracks + transport + routing + mutes) is not yet implemented.
- **Complexity:** S — extend persistence.ts with a project-level serializer

### High-Resolution Internal Clock (24 PPQN)
The engine currently ticks at 1 tick per 16th note (effectively 4 PPQN). A higher resolution clock (24 PPQN, the MIDI standard) would give more precise timing for ratchets, gate lengths, swing, and future features like shuffle/groove templates.
- **Current model:** 1 tick = 1 step. Ratchets and gate length are handled in the I/O layer by subdividing `stepDuration` with floating-point math. This works but means the engine has no concept of sub-step timing.
- **Proposed model:** 6 ticks per 16th note (24 PPQN). The engine distinguishes "step boundaries" from "micro-ticks within a step." Gate length and ratchets become tick counts instead of float fractions. The I/O layer schedules events at tick-level precision.
- **Benefits:** Precise ratchet timing without float rounding, natural swing/groove (shift steps by ±ticks), accurate MIDI clock output, sub-step gate resolution.
- **Trade-offs:** Engine runs 6× more ticks per beat, step-based UI/routing needs to map between tick position and step index, all existing clock divider logic needs updating, significant refactor across engine/I/O/UI.
- **Complexity:** XL — architectural change touching every layer. Worth doing before hardware port.

### Step Conditions + Accumulator — NEEDS RESEARCH
Deterministic pattern evolution across loop iterations. Steps trigger based on loop count (e.g., "play every 4th loop on 2nd pass"). Accumulator adds cumulative pitch transposition per cycle with hold/wrap/ping-pong boundaries.
- **Inspiration:** PER|FORMER, NerdSEQ, Eloquencer (step conditions); Metropolix, OXI One (accumulator)
- **Open questions:** editing UX, random generation of conditions, interaction with mutator
- **Complexity:** M — loop iteration counter per subtrack, evaluated in `tick()`

### Internal Mod Routing — NEEDS RESEARCH
Route LFO/mod subtrack to internal sequencer parameters (gate length, transpose, clock division) instead of only CV output.
- **Inspiration:** Metropolix (30+ internal targets), PER|FORMER (curve tracks), OXI One
- **Open questions:** which internal targets make musical sense, overlap with future CV input
- **Complexity:** M — depends on CV input design
