# Feature Ideas

Research notes for Requencer features. Companion to the [feature roadmap](../plans/2026-03-01-feature-roadmap.md).

**Updated:** 2026-03-04 — Most features below are now implemented. Status tags reflect current state.

## Overlays (architectural context)

Overlays transform engine output before it reaches I/O — modifying playback without changing stored sequences. Implemented overlays: mutes, routing, transposition (with gate length/velocity scaling), and variations (deterministic transform stacking per bar).

Stacking order matters (mute before transpose ≠ transpose before mute). Overlays are composable and stateless.

---

## 1. Gate Length ✅ Implemented

Per-step gate duration — how long each note stays "on" within its step window.

**Layer:** Engine (GateStep.length) + I/O (Tone.js triggerAttackRelease / MIDI note-off timing)

**Implementation decisions:**
- Stored as part of gate subtrack: `GateStep.length` (0.05–1.0 fraction of step window)
- Randomizer generates within configurable min/max range, quantized to 0.05 increments
- Transpose glScale multiplier applied in routing (clamped to [0.05, 1.0])
- Ratchets use proportional subdivision: `subGate = (stepDuration / ratchetCount) * gateLength`
- UI: gate-edit screen shows GL% with proportional bar height; hold step + Encoder A adjusts in 0.05 steps
- 8 factory presets include per-track gate length ranges

---

## 2. Ratchets ✅ Implemented

Subdivide a single step into rapid repeated triggers (1–4x). Classic techno tool for rolls and fills.

**Layer:** Engine (GateStep.ratchet) + I/O (multi-trigger scheduling in Tone.js and MIDI)

**Implementation decisions:**
- Per-step ratchet count (1–4) stored on GateStep
- Randomizer with configurable probability and maxRatchet (1–4)
- Each ratchet sub-note gets proportional gate length: `subGate = (stepDuration / ratchetCount) * gateLength`
- Tied steps force ratchet to 1 (no subdivision during sustained notes)
- All sub-triggers share same pitch and velocity
- UI: gate-edit shows tick marks dividing the bar + "R:Nx" label; hold step + Encoder B adjusts
- Velocity curves for ratchets remain a future consideration

---

## 3. Slides ✅ Implemented

Per-step portamento time on pitch track — TB-303 style glide between notes.

**Layer:** Engine (PitchStep.slide) + I/O (Tone.js `synth.portamento`)

**Implementation decisions:**
- Per-step slide time (0–0.50s) rather than boolean flag — more expressive
- Randomizer with probability config; when active, defaults to 0.1s
- Slide follows pitch routing (not gate routing) in cross-track routing scenarios
- Tone.js portamento set per note before trigger
- UI: pitch-edit shows orange bars + diagonal connector lines for active slides; hold step + Encoder B adjusts in 0.05s increments
- CV output will need voltage slew — future consideration for hardware port

---

## 4. Mutate ✅ Implemented

Turing machine-style sequence mutation — regenerates parts of the sequence every loop.

**Layer:** Engine (mutator.ts — per-loop drift generation)

**Implementation:** Per-track drift probability with configurable triggering mode. Dedicated MUTATE screen for editing parameters. Mutation and variation are orthogonal — both can be active simultaneously (mutation alters stored steps; variation overlays at playback).

---

## 5. Pitch Transposition ✅ Implemented

Per-track transpose offset + note window + gate length/velocity scaling.

**Layer:** Overlay (applied in routing.ts before I/O)

**Implementation:** Dedicated XPOSE screen with PITCH section (semitone offset, note lo/hi window) and DYNAMICS section (gate length scale, velocity scale). Applied as overlay — doesn't modify stored steps.

---

## 6. Pitch Arpeggio Generator ✅ Implemented

Chord-tone walking mode as an alternative to random pitch generation.

**Layer:** Engine (arpeggiator.ts)

**Implementation:** Up/down/triangle/random directions with configurable octave range. Integrated as arp mode in randomizer config. Arpeggiate within selected scale. Pattern length vs. track length mismatch creates polyrhythmic effect (by design).

---

## 7. MOD Subtrack UI ✅ Implemented

Full MOD editing screen with two views.

**Layer:** UI (lcd/mod-edit.ts — 300 lines)

**Implementation:** MOD SEQ view shows 2×8 step grid with bar visualization (per-step value 0–100% and slew). MOD LFO view shows animated waveform preview with 7 editable parameters. Dedicated MOD button on panel for direct access. MOD destination routing handled via output routing screen (modSource: 'seq' | 'lfo').

---

## 8. Smart Gate Generation — Removed

Multi-bar phrase patterns proved untestable in the prototype context. The approach was superseded by the variation system (deterministic transform overlays per bar) and 4 single-bar gate modes (random, euclidean, sync, cluster) which provide more musical utility with less complexity. See [gate modes redesign](../plans/2026-03-03-gate-modes-redesign.md).

---

## 9. MOD as LFO ✅ Implemented

Continuous modulation running in parallel with step-sequenced MOD.

**Layer:** Engine (lfo.ts — tick-level evaluator) + I/O (continuous output)

**Implementation:**
- 6 waveforms: sine, triangle, saw, square, slew-random, S+H
- Synced (track loop) or free-running modes
- Width parameter for waveform skewing (pulse width, triangle skew, rise/fall ratio)
- Both MOD SEQ and MOD LFO run simultaneously — switchable via output routing (modSource: 'seq' | 'lfo')
- Animated waveform preview in MOD edit screen LFO view
- Envelope follower remains a future consideration

---

## 10. Web MIDI Output ✅ Implemented (output only)

Route engine output to external MIDI devices via Web MIDI API.

**Layer:** I/O (midi-output.ts — alongside Tone.js audio)

**Implementation:**
- Per-output MIDI channel selection (user-configurable in settings)
- Note on/off, velocity, ratchet subdivision support
- Global MIDI on/off toggle
- **Not yet implemented:** MIDI clock input/sync — settings UI shows INT/MIDI/EXT clock source options but only INT is functional. Needs a MIDI input handler for clock reception.
