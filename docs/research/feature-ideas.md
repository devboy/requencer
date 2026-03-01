# Feature Ideas

Research notes for future Requencer features. Companion to the [feature roadmap](../plans/2026-03-01-feature-roadmap.md).

## Overlays (architectural context)

Overlays transform engine output before it reaches I/O — modifying playback without changing stored sequences. Mutes and routing are the existing overlays. Future overlays (transposition, probability masks, smart gate patterns) follow the same pure-function pattern: `(step, overlayState) => step | null`.

Stacking order matters (mute before transpose ≠ transpose before mute). Keep overlays composable and stateless.

---

## 1. Gate Length

Per-step gate duration — how long each note stays "on" within its step window.

**Layer:** Engine (new step property) + I/O (note duration scheduling)

**How it works:** Each step gets a gate-length value. The engine emits `(gateOn, gateOff)` event pairs; I/O translates to Tone.js note durations or CV envelope shapes.

**Open questions:**
- Store as part of gate subtrack (each step gets a length) or as a separate subtrack? Separate enables independent polyrhythmic gate-length patterns.
- Value range: percentage of step duration (0-100%) is simpler; absolute ms gives more control but couples to tempo.
- Interaction with ratchets: proportional subdivision or independent per-ratchet lengths?
- UI: bar graph view on LCD? Encoder + step-select?

**Status:** Roadmap Tier 1

---

## 2. Ratchets

Subdivide a single step into rapid repeated triggers (2x/3x/4x). Classic techno tool for rolls and fills.

**Layer:** Engine (step subdivision logic) + I/O (multi-trigger scheduling)

**How it works:** On a ratcheted step, the engine emits N evenly-spaced gate events within the step's time window. Pitch and velocity apply to all subdivisions.

**Open questions:**
- Per-step ratchet count vs. per-track global setting. Per-step is more expressive but needs more storage and UI.
- Gate length interaction: each ratchet gets `stepDuration / ratchetCount * gateLength%`? Minimum gate duration needed at fast tempos.
- Could ratchets have velocity curves (accent first hit, fade out)?
- UI: hold step + encoder? Dedicated edit mode?

**Status:** Roadmap Tier 1 (depends on gate length)

---

## 3. Slides

Per-step boolean on pitch track — marks steps where pitch glides smoothly into the next step's pitch. TB-303 style portamento.

**Layer:** Engine (slide flag per step) + I/O (Tone.js `portamento` / `rampTo`)

**How it works:** When the engine encounters a slide-flagged step, it signals I/O to glide pitch from current note to next note's pitch over the step duration. Slide only applies when current step has gate=on AND next step has gate=on.

**Open questions:**
- Fixed module-wide slide time vs. per-step slide duration? Boolean flag + global slide-time is a good middle ground.
- CV output: needs voltage slew — browser preview approximates with Tone.js portamento.
- Interaction with ratchets: slide is step-to-step, ratchets are within-step — probably independent.
- Randomization: should RAND generate slide flags? What density parameter?

**Status:** Roadmap Tier 1

---

## 4. Mutate

Turing machine-style sequence mutation — regenerates parts of the sequence every loop.

**Layer:** Engine (mutation logic per subtrack per loop boundary)

**How it works:** Per-subtrack mutation rate (0-100%) controls probability each step gets regenerated per loop. Uses the currently active random generator, so low mutation creates slow drift toward the current constraint set's characteristics.

**Parameters:**
- **Mutation rate:** 0-100% — probability each step gets regenerated per loop
- **Scope:** per-subtrack (gate/pitch/vel/mod independently) or whole track
- **Clock source:** mutate per internal loop cycle, per global clock/bars, or per external trigger

**Open questions:**
- Feature button function (one of the transport slots) or per-track config parameter?
- Visual feedback: flash changed steps on LCD?
- "Lock" function to snapshot current state and stop mutating?
- Overlay showing mutation rates per subtrack?

**Status:** Roadmap Tier 2 — signature feature of the module

---

## 5. Pitch Transposition

Per-track transpose offset + range scaling. Shift sequences up/down by semitones or scale degrees.

**Layer:** Overlay (pure transform on pitch output)

**How it works:** An overlay applies a transpose offset to each pitch value before I/O. Can be absolute (semitones) or scale-aware (shift by scale degrees within the active scale).

**Open questions:**
- Absolute semitone offset vs. scale-degree offset? Scale-degree keeps everything in-key.
- Range scaling: compress or expand the pitch range of a track (e.g., map 2 octaves → 1 octave)?
- Per-track or global? Per-track is more useful for creating harmonic movement.
- UI: encoder-controlled transpose value? Live transposition via external CV?

**Status:** Roadmap Tier 2

---

## 6. Pitch Arpeggio Generator

An alternative pitch generation mode that creates arpeggiated patterns instead of random pitches. Define a chord or interval set, walk through chord tones in order.

**Layer:** Engine (extends random pitch generator)

**How it works:** Instead of picking random scale degrees, walks through chord tones in a defined direction/pattern. Fills the pitch subtrack with the result. Added as a mode option alongside random.

**Open questions:**
- Arpeggio direction modes: up, down, up-down (triangle), random order.
- Octave range: span 1-4 octaves before repeating.
- Chord definition: preset chords (triad, 7th, sus4) vs. manual interval selection?
- Pattern length vs. track length mismatch creates polyrhythmic effect — feature or bug?
- Interaction with scale constraint: arpeggiate within selected scale, or define chord intervals independently?

**Status:** Roadmap Tier 2

---

## 7. MOD Subtrack UI

The MOD subtrack data structures exist in the engine but the step editing UI is not wired up. This is a V1 gap that needs closing.

**Layer:** UI (LCD screen for MOD step editing)

**How it works:** Add a MOD editing screen accessible from dashboard. Show per-step MOD values as a bar graph, allow encoder-based editing of individual step values.

**Open questions:**
- Does MOD editing get its own mode, or extend the existing track-config mode?
- Visual representation: bar graph (like velocity) or numeric display?
- MOD destination routing: how does the user assign what the MOD output controls?

**Status:** Roadmap Tier 3

---

## 8. Smart Gate Generation

Multi-bar aware gate patterns for techno-style sequences. Instead of the same pattern every bar, generate patterns that evolve across 2/4/8/16-bar phrases.

**Layer:** Engine (extended gate generator) or Overlay (bar-offset transform)

**How it works:** Two possible approaches:
1. **Bar-offset overlay:** Shift the gate read position by N steps each bar. Creates evolving patterns from a single stored sequence. `(currentStep + barNumber * offset) % trackLength`.
2. **Multi-bar generation:** Generate a longer gate pattern (e.g., 64 steps for a 4-bar phrase) with intentional structure — sparse bars, fill bars, drop bars.

**Open questions:**
- Overlay approach (simpler, works with existing patterns) vs. multi-bar generation (more control, more complex)?
- Per-track bar-offset rates enable different tracks drifting at different speeds.
- Reset behavior: offset resets on pattern restart, or accumulates?
- "Techno modes": preset gate distribution profiles (4-on-floor, breakbeat, syncopated)?

**Status:** Roadmap Tier 3 (needs research)

---

## 9. MOD as LFO

MOD output generates continuous modulation signals instead of step-sequenced values.

**Layer:** Engine (LFO generator) + I/O (continuous output scheduling)

**Possible waveforms:**
- **LFO:** sine, triangle, saw, square — adjustable rate and phase
- **Slewed random:** random values with adjustable slew rate (smoothed S&H)
- **Sample & hold:** stepped random at a configurable rate
- **Envelope follower:** triggered per step or per loop

**Timing options:**
- **Track loop:** LFO cycle = track loop length (stays in phase)
- **Own length:** independent cycle length (polymetric modulation)
- **Global bars:** syncs to master clock bar divisions
- **Free:** rate in Hz, not synced

**Open questions:**
- Does LFO mode replace step-sequenced MOD, or is it an alternative mode?
- How to edit LFO parameters on the LCD (waveform preview)?
- Multiple MOD lanes per track, or one configurable source?
- Per-step slew rate or global per track?

**Status:** Roadmap Tier 3 (phase 2 of MOD, after subtrack UI)

---

## 10. Web MIDI Output

Route engine output to external MIDI devices via Web MIDI API.

**Layer:** I/O (MIDI output alongside Tone.js audio)

**How it works:** Add a Web MIDI output module that translates engine events (gate on/off, pitch, velocity, MOD) to MIDI messages. Route per-output to a MIDI channel.

**Open questions:**
- MIDI channel mapping: one channel per output? User-configurable?
- Clock output: send MIDI clock for sync?
- Latency: Web MIDI API timing vs. Tone.js scheduling — may need compensation.

**Status:** Roadmap Tier 4 (low priority, Tone.js sufficient for prototyping)
