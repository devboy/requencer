# Eurorack Sequencer Competitive Research

Comparison of Requencer against seven leading eurorack/desktop sequencers, with focus on live performance and generative features.

**Sequencers researched:** Intellijel Metropolix, XOR Electronics NerdSEQ, Winter Modular Eloquencer, Westlicht PER|FORMER, OXI One MKII, Torso T-1, Noise Engineering Mimetic Digitalis

---

## 1. Current Requencer Feature Summary

| Category | What We Have |
|---|---|
| **Tracks** | 4 independent tracks, each with 7 subtracks (gate, pitch, velocity, mod, gateLength, ratchet, slide) |
| **Steps** | 1–64 per subtrack, independently settable |
| **Clock** | Per-track divider (1–32) × per-subtrack divider (1–32) = native polyrhythm |
| **Scales** | 10 built-in (major, minor, dorian, phrygian, mixolydian, minor/major pentatonic, blues, chromatic, whole tone) |
| **Randomizer** | Seeded PRNG (mulberry32). Per-subtrack: gate (random/euclidean), pitch (scale-constrained, maxNotes), velocity, gateLength, ratchet (probability), slide (probability), mod |
| **Smart Gate** | Multi-bar phrase generation (1/2/4/8/16 bars). Density modes: build, decay, build-drop, variation |
| **Arpeggiator** | Chord-tone extraction from scale. Modes: up, down, triangle, random. Octave range 1–4 |
| **LFO** | Mod subtrack generator. Waveforms: sine, triangle, saw, slew-random. Rate 1–64 steps, depth/offset |
| **Mutator** | Turing Machine drift engine. Per-subtrack rate (0–100%). Triggers: per-loop or every N bars |
| **Routing** | 4 outputs, each with independent source selection for gate/pitch/velocity/mod from any track |
| **Mute** | Per-output mute patterns (1–64 steps, own clock divider) |
| **Transpose** | Per-track, ±48 semitones, optional scale quantize |
| **Presets** | 6 factory + unlimited user presets with name entry |
| **Ratchet** | 1–4 sub-triggers per step |
| **Slide** | Per-step portamento (0–0.50s) |
| **MIDI** | Web MIDI output, per-output enable/channel, CC1 for mod, panic |
| **Audio** | 4 Tone.js synths (triangle, square, sawtooth, square), velocity-to-dB mapping |

---

## 2. Per-Sequencer Feature Profiles

### Intellijel Metropolix

**Architecture:** 2 tracks, 8 stages per track, up to 64 effective steps via pulse count (1–8 per stage). 34HP.

| Category | Detail |
|---|---|
| Pitch | 8 physical sliders, 49 factory + 100 user scales, per-track octave range (1–3), pitch inversion |
| Gate types | REST / SINGLE / MULTI / HOLD per stage (physical switch) |
| Ratchet | Per-stage ratchet count, 3 ratchet types (multiple/single/gated), gate stretch mode |
| Probability | Per-stage probability lane |
| Accumulator | Adds/subtracts pitch interval per pulse/stage/track cycle. Boundary: hold, wrap, ping-pong |
| Mod lanes | 8 lanes, each with own length/order/division. Route to outputs A/B or 30+ internal params |
| Playback orders | Forward, Reverse, Ping-Pong, Random, Brownian (each with -Fixed variant) = 9 modes |
| Swing | Per-track, 50–78% |
| Slide | Per-stage flag + per-track slide time |
| Loopy mode | Freeze and repeat sub-sequences; latched or momentary. Stage Player = keyboard mode when stopped |
| Preset chains | 8 chains × 32 links × 64 repeats. Per-link mute states for tracks + mod lanes |
| I/O | 2 pitch + 2 gate + 2 assignable CV out, 3 AUX CV in (±5V), USB MIDI, TRS MIDI |

**Standout:** Accumulator creates evolving melodies from static patterns. 8 mod lanes with internal routing make it a self-modulating system. Loopy mode is exceptional for live improvisation.

---

### XOR Electronics NerdSEQ

**Architecture:** 8 tracks (6 CV/gate + 2 audio), tracker-style interface, 32HP. Up to 64 steps per pattern, 175+ patterns per project.

| Category | Detail |
|---|---|
| Interface | Vertical tracker grid (hex data entry), 3.5" color IPS display |
| Synthesis | 4 oscillators (sine/tri/saw/pulse/noise), 4-op FM, sample playback (8/16-bit WAV) |
| FX system | 4 FX columns per track: glide, retrigger, probability, CV precision, step skip/jump, pattern length change |
| Probability | Carry-forward probability (stays active until disabled) via FX column |
| Groove | Per-step groove column + global swing |
| Playback | Forward, Backward, Pingpong, Random, Even/Odd, Spiral, Crab, Drunk — switchable via FX |
| Song mode | 255 sequencer rows, per-track pattern independence, live launching |
| Automator | 8 LFO/automation slots targeting any internal parameter |
| Envelopes | 8 ADSR slots (one-shot, looping, chaining) |
| Mapping | 16 user variables + conditional scripting = algorithmic/generative behaviors |
| Expanders | More Triggers 16 (up to 64 extra gates), CV16 (16 extra CVs), Multi-IO (USB/MIDI/I2C), Dualchord (4-voice synthesis), Video Expander (GLSL shaders) |
| Controllers | Novation Launchpad, MIDI controllers, Sega gamepad, PC keyboard, faderboxes via I2C |

**Standout:** The only hardware tracker sequencer. Conditional scripting via Mapping screen enables building custom generative features. Massive expandability. FM synthesis and sample playback built in.

---

### Winter Modular Eloquencer

**Architecture:** 8 tracks, 16–64 steps, 38HP. Discontinued but firmware is open-source.

| Category | Detail |
|---|---|
| Probability | Per-step on EVERY parameter: gate prob, CV variation prob + range, gate length variation prob + range, ratchet prob + variation prob + range. Three-axis system: value × probability × range |
| Gate | Per-step toggle, tie (legato), 4 gate lengths |
| Fill mode | Momentary — activates all gates on selected tracks, overriding probability. Release = return to pattern |
| Ratchet | 8 ratchet types, each with probability + variation probability + variation range |
| Song mode | 64 song parts, each up to 16 patterns, chains up to 256 parts |
| Pattern chain | Devine Mode: press two patterns = instant chain. 5 chain playback modes (forward/backward/random/coin toss/drunken) |
| Freeze/Revert | Two-state snapshot: freeze, edit live, revert to frozen state |
| Scale | 1 global scale per project (not per-track) |
| Timing | Global shuffle/swing, per-track clock division, tap tempo, DJ Nudge |
| Live recording | Gates mode, CV mode, Free Play (step buttons as keyboard), mono/poly modes |
| Step conditions | Conditional step triggers (firmware 1.4) |
| I/O | 8 CV + 8 gate outputs, accent output, 2 assignable CV inputs, clock in/out, microSD |

**Standout:** The deepest probability system of any sequencer — every parameter has independent probability AND variation range per step. Fill mode is the gold standard for live builds. Freeze/Revert enables fearless editing.

---

### Westlicht PER|FORMER

**Architecture:** 8 tracks, 5 track types (3 official + 2 community), 64 steps, 34HP. Open-source (MIT), DIY only.

| Category | Detail |
|---|---|
| Note track | Gate, gate prob, gate offset, slide, retrigger + retrig prob, length + length variation, note + note variation, step condition |
| Curve track | Per-step curve shapes (flat, rising, falling, exponential, sinusoidal, random-hold, etc.), min/max voltage, independent gate pattern |
| Stochastic track | 12 probability blocks (one per semitone), octave range, rest probability at 2/4/8 step intervals (mebitek fork) |
| Logic track | Boolean operations (AND, OR, XOR + negations) on gate + note data from two upstream tracks (mebitek fork) |
| Arp track | Mode (up/down/triangle/converge/diverge/random), octaves, hold, rate, gate length (mebitek fork) |
| Step conditions | Fill, !Fill, Pre, !Pre, First, !First, N:M, !N:M — analogous to Elektron conditional trigs |
| Fill mode | Per-track: None / Gates / Next Pattern / Condition / (Curve: Variation / Invert). Fill Amount = probabilistic fill density |
| Routing | 16 simultaneous routes. Sources: CV in 1–4, MIDI CC, pitch bend, CV out feedback. Targets: tempo, swing, mute, fill, pattern, slide, octave, transpose, rotate, probability biases, first/last step, run mode, divisor |
| Snapshot | Temporary runtime copy of all patterns. Edit freely, commit or revert |
| Song mode | 64 slots, each with per-track pattern + bar count + mute states |
| Run modes | Forward, Backward, Pendulum, Ping Pong, Random, Random Walk |
| Swing | Global, 50–75% |
| Clock | 192 PPQN internal, MIDI clock, analog clock I/O |

**Standout:** Step conditions are the most powerful iteration-aware trigger system. Curve tracks double as internal LFOs/envelopes routable to any parameter. Logic tracks enable boolean track combinations. The most architecturally flexible sequencer in this comparison.

---

### OXI One MKII

**Architecture:** 8 sequencers × 8 sub-tracks = up to 64 tracks, 6 sequencing modes, standalone + eurorack hybrid. 8-hour battery.

| Category | Detail |
|---|---|
| Modes | Mono, Poly (7 voices), Chord (progressions + arp), Multitrack (8 sub-tracks), Stochastic (probability-driven), Matriceal (4 tracks × 9 parameter lanes) |
| Mod lanes | 64 total (8 per sequencer), each with independent length/division, assignable to MIDI CC/pitch bend/aftertouch/CV |
| LFOs | 16 (2 per sequencer), always-running |
| Swing | Per-sequencer + per-step micro-timing (1ms resolution) + custom groove templates (importable/shareable) |
| Accumulator | Running pitch/parameter offset across cycles (evolving patterns) |
| FLOW system | Context-aware performance overlay: adds repeats/fills/variations based on track type |
| Arranger | 12 arrangements per project, pattern chaining, Launch Clip for live jumping |
| Logic conditions | Per-step if-then conditional triggers (e.g., "fire every 3rd cycle") |
| Connectivity | 8 CV + 8 gate out, 2 CV in, TRS MIDI, USB MIDI, Bluetooth MIDI, analog clock, OXI Split expander (6 MIDI ports, 96 channels) |

**Standout:** 6 sequencing modes in one unit. Matriceal mode with 9 independent parameter lanes creates emergent generative behaviors. FLOW system provides intelligent performance enhancement. Per-step micro-timing at 1ms resolution.

---

### Torso T-1

**Architecture:** 16 tracks, euclidean/algorithmic, desktop form factor. No display — all knobs + illuminated pads.

| Category | Detail |
|---|---|
| Euclidean | Steps (1–64), Pulses (Bjorklund distribution), Rotate (phase offset), Division (clock div/mult) |
| Voice-leading | Minimizes total voice movement between chords for smooth transitions. Scale-aware diatonic transposition |
| Cycles | Up to 16 per track. Each cycle = complete parameter snapshot. Cycles play sequentially. 64 steps × 16 cycles = 1024 effective steps per track |
| Note repeater | Repeats count + time interval + acceleration/deceleration ("bouncing ball" timing curves) + velocity ramp |
| Groove | Per-track swing/timing + 8 preset groove templates (timing + velocity embedded). Accent knob |
| Probability | Per-track global step probability |
| Harmony | Scale knob, Root knob, Harmony knob (diatonic transposition), Voicing (inversions) |
| Range/Phrase | Octave range + LFO-like modulation shape controlling pitch wander |
| Randomization | Per-parameter randomization with lockable scope. Randomized states capturable per-cycle |
| I/O | 8 CV + 8 gate (reconfigurable ratio via config tool), TRS MIDI in/out/thru, USB MIDI, clock in/out, WiFi (Ableton Link) |

**Standout:** Cycles system creates song-length evolution without an arranger. Voice-leading algorithm is rare in hardware. Bouncing-ball note repeater is musically expressive. The "no display" design forces a tactile, always-playing workflow.

---

### Noise Engineering Mimetic Digitalis

**Architecture:** 4 CV channels, 4×4 Cartesian grid (16 steps), 10HP. Extremely compact.

| Category | Detail |
|---|---|
| Navigation | 5 trigger inputs: N (next/linear), X (within row), Y (within column), R (random), O (origin). 3 CV inputs: CV N/X/Y for voltage-addressed positioning |
| Outputs | 4 independent 0–5V CV channels, 1 trigger output (~6V on every step advance) |
| Patterns | 16 saveable patterns (1–8 fast access, 9–16 via encoder) |
| Undo | Single-level revert to last saved pattern. Designed for: save anchor → improvise → revert |
| Shred | Per-step randomization, bulk randomization, octave-restricted randomization (Zero+Shred) |
| No quantization | Raw unquantized voltage output (requires external quantizer for pitched use) |
| No slew | Hard CV jumps between steps (successor MD2 adds per-lane slew) |

**Standout:** XY grid with simultaneous multi-axis clocking creates movement patterns impossible on linear sequencers. CV-addressed playhead turns it into a voltage-controlled lookup table. Extreme density at 10HP.

---

## 3. Feature Gap Analysis

### Comparison Table

| Feature | REQ | Metro | NerdSEQ | Eloquencer | PER\|FORMER | OXI One | T-1 | Mimetic D |
|---|---|---|---|---|---|---|---|---|
| **Core** | | | | | | | | |
| Tracks | 4 | 2 | 8 | 8 | 8 | 8–64 | 16 | 4 ch |
| Max steps | 64 | 64 | 64 | 64 | 64 | 128 | 64×16 | 16 |
| Independent subtrack lengths | Yes | — | Yes | Yes | Yes | Yes | — | — |
| Clock div per track | Yes | Yes | Yes | Yes | Yes | Yes | Yes | — |
| Clock div per subtrack | Yes | — | — | — | — | — | — | — |
| Scales | 10 | 149 | — | Global | 4 user + std | Yes | Yes | None |
| User-defined scales | No | 100 | — | No | 4 slots | Yes | Yes | — |
| **Rhythm / Gate** | | | | | | | | |
| Euclidean | Yes | — | — | — | Yes | Yes | Yes | — |
| Per-step gate probability | No | Yes | Yes | Yes | Yes | Yes | Yes | — |
| Step conditions (N:M) | No | — | Via FX | Yes (v1.4) | Yes | Yes | — | — |
| Fill mode | No | — | — | Yes | Yes | Yes | — | — |
| Ratchet | 1–4 | Yes | Yes | 8 types | Yes | Yes | Yes | — |
| **Pitch** | | | | | | | | |
| Slide/portamento | Yes | Yes | Yes | — | Yes | Yes | — | — |
| Accumulator | No | Yes | — | — | — | Yes | — | — |
| Voice-leading | No | — | — | — | — | — | Yes | — |
| Arpeggiator | Yes | — | — | — | Yes* | — | — | — |
| Transpose | ±48 | Yes | — | — | Yes | Yes | Yes | — |
| **Modulation** | | | | | | | | |
| LFO | Yes | Via mod | 8 auto | Stepped | Curve trk | 16 LFOs | Phrase | — |
| Mod lanes | 1 (mod sub) | 8 | MOD col | — | Curve trk | 64 | — | — |
| Internal mod routing | No | Yes | Yes | — | Yes | Yes | — | — |
| Mutator/drift | Yes | — | Via map | — | — | — | — | — |
| Smart gate / phrases | Yes | — | — | — | — | — | — | — |
| **Probability** | | | | | | | | |
| Gate probability | No | Yes | Yes | Yes | Yes | Yes | Yes | — |
| Pitch variation prob | No | — | — | Yes | Yes | — | — | — |
| Gate length var prob | No | — | — | Yes | Yes | — | — | — |
| Ratchet probability | Yes | — | — | Yes | Yes | — | — | — |
| Stochastic mode | No | — | — | — | Yes* | Yes | — | — |
| **Performance** | | | | | | | | |
| Snapshot/undo | No | — | — | Freeze | Snapshot | — | — | Undo |
| Preset chains / song | No | 8 chains | 255 rows | 64 parts | 64 slots | Arranger | Cycles | — |
| Swing/groove | No | 50–78% | Per-step | Global | 50–75% | 1ms micro | 8 templates | — |
| Pattern chaining | No | Yes | Yes | Yes | Yes | Yes | Via cycles | — |
| Keyboard/play mode | No | Stage player | — | Free play | — | — | — | Manual step |
| **Routing** | | | | | | | | |
| Output routing matrix | Yes | — | — | — | 16 routes | — | — | — |
| Per-output mute patterns | Yes | — | — | — | — | — | — | — |
| Logic track operations | No | — | — | — | Yes* | — | — | — |
| **I/O** | | | | | | | | |
| CV outputs | — | 4+2 | 12 | 8 | 8 | 8 | 8 | 4 |
| MIDI | Web MIDI | USB+TRS | Via exp | — | TRS+USB | TRS+USB+BLE | TRS+USB | — |

*PER|FORMER community fork (mebitek)

---

## 4. Feature Opportunities — Reviewed

Features reviewed against our project goals: **random generation + live performance**, not song creation.

### Accepted Features

#### Snapshot / Undo — HIGH PRIORITY, needs UX design
**Who has it:** PER|FORMER (snapshot), Eloquencer (freeze/revert), Mimetic Digitalis (single-level undo)
**What:** Save a temporary copy of the current state before destructive edits (randomize, mutate, manual edits). Revert instantly to the snapshot. Single anchor point, not full undo history.

**Why we want it:** With the randomizer and mutator being destructive, a safety net is essential for live performance. Edit fearlessly, revert instantly.

**Architectural fit:** Deep copy of `SequencerState`. "Take snapshot" = clone. "Revert" = replace. "Commit" = discard snapshot. Pure state operation, fits our immutable engine model. Very low engine complexity.

**Open question:** UX — how to trigger snapshot/revert during live performance (button combo? dedicated button? hold gesture?).

---

#### Swing / Groove — USEFUL, per-track
**Who has it:** Metropolix (50–78%), PER|FORMER (50–75%), OXI One (per-step 1ms), NerdSEQ (per-step groove), T-1 (8 groove templates)
**What:** Per-track timing offset that delays even/odd steps by a percentage of the clock interval for rhythmic feel.

**Architectural fit:** Applied in the I/O layer (`tone-output.ts`), not the engine — engine ticks on-grid, I/O offsets the Tone.js `time` parameter. Keeps engine purity. Low-medium complexity.

---

#### Ratchet Acceleration — LOW PRIORITY
**Who has it:** T-1
**What:** Extends our existing ratchets with timing acceleration/deceleration ("bouncing ball" — each sub-trigger faster or slower) and velocity ramp (fade in/out).

**Architectural fit:** Adds `ratchetAccel` and `ratchetVelRamp` to existing ratchet system. Applied in `tone-output.ts` during ratchet scheduling. Low complexity, builds on what we have.

---

### Needs More Research

#### Loop Evolution: Step Conditions + Accumulator
**Step conditions** (PER|FORMER, NerdSEQ, Eloquencer, OXI One) and **Accumulator** (Metropolix, OXI One) are grouped together — both create deterministic pattern evolution across loop iterations.

- **Step conditions:** Steps trigger based on loop iteration count (e.g., "play every 4th loop on the 2nd pass"). Unlike probability, these are deterministic and repeating.
- **Accumulator:** Cumulative pitch transposition per loop cycle. Boundary behaviors: hold, wrap, ping-pong.

**Open questions:**
- How complicated is step condition editing per-step? Does it make sense without pattern save/load?
- Could step conditions be randomly generated instead of manually edited?
- Should these be a single "loop evolution" feature or separate?

---

#### Cycles / Macro Patterns — HIGH POTENTIAL, needs careful design
**Who has it:** T-1 (16 cycles per track)
**What:** Per-track parameter snapshots that play sequentially across loop repetitions. Independent cycle counts per track create emergent evolution. Deterministic counterpart to our mutator.

**Open questions:**
- How does this interact with the mutator? One drifts randomly, the other evolves through designed stages — could be very powerful together.
- What's the right cycle count? How are cycles created — manually, via randomizer, via mutator snapshots?
- UI for cycle management on our constrained panel.

---

#### Internal Mod Routing — NEEDS MORE THINKING, depends on CV input design
**Who has it:** Metropolix (mod lanes → 30+ internal params), PER|FORMER (curve tracks → any param), NerdSEQ (automator), OXI One
**What:** Route LFO/mod subtrack to internal sequencer parameters (gate length, transpose, clock division) instead of only CV output.

**Open questions:**
- With CV inputs planned, external modulation could cover some of this. What parameters actually benefit from internal modulation vs. external?
- Which internal targets make musical sense for our workflow?

---

### Rejected Features

| Feature | Reason |
|---|---|
| Per-step gate probability | Too random — never creates repeating patterns, doesn't fit our generative approach |
| Fill mode | More useful for drum sequencers, not our voice sequencer |
| Pattern chaining / Song mode | We focus on random generation and live performance, not song creation |
| Pulse count / Stage expansion | Metropolix-specific paradigm — people can get the Metropolix for that |
| Logic track operations | Our mute patterns already provide per-output gate control |

### Lower Priority / Future Consideration (unchanged)

- **Voice-leading algorithm** (T-1) — niche, requires polyphonic output
- **Cartesian XY navigation** (Mimetic Digitalis) — incompatible with linear step model
- **Tracker-style editing** (NerdSEQ) — UI paradigm change, not incremental
- **Launchpad integration** (NerdSEQ, PER|FORMER) — depends on MIDI input support
- **Stochastic track type** (PER|FORMER, OXI One) — different compositional model

---

## 5. Architectural Fit Notes

### Engine Layer (`src/engine/`)
- **Snapshot** — deep clone of `SequencerState`. Trivially immutable.
- **Step conditions / Accumulator** — loop iteration counter per subtrack, evaluated in `tick()`. Pure math.
- **Cycles** — `Cycle[]` per track, cycle-advance on loop boundary.

### I/O Layer (`src/io/`)
- **Swing/groove** — timing offsets applied to Tone.js scheduling in `tone-output.ts`. Engine stays on-grid.
- **Ratchet acceleration** — extends ratchet scheduling math in `tone-output.ts`.

### UI Layer (`src/ui/`)
- **Snapshot** — needs UX design for trigger mechanism (button combo or overlay).
- **Swing** — per-track parameter, editable in hold-overlay or new section.
- **Step conditions / Accumulator** — may need new screen section or subtrack editing mode.
- **Cycles** — would need dedicated management UI.

### Priority Summary

| Feature | Priority | Engine Complexity | Status |
|---|---|---|---|
| Snapshot / Undo | High | Very low | Needs UX design |
| Swing / Groove | Useful | Low (I/O only) | Ready to implement |
| Ratchet acceleration | Low | Low | Ready to implement |
| Step conditions + Accumulator | TBD | Medium | Needs more research |
| Cycles / Macro patterns | High potential | Medium-high | Needs careful design |
| Internal mod routing | TBD | Medium | Depends on CV input design |
