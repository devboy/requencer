# Eurorack Sequencer Competitive Research

Comparison of Requencer against leading eurorack/desktop sequencers, MIDI controllers, and DAW tools — with focus on live performance and generative features for repetitive techno.

**Sequencers researched:** Intellijel Metropolix, XOR Electronics NerdSEQ, Winter Modular Eloquencer, Westlicht PER|FORMER, OXI One MKII, Torso T-1, Noise Engineering Mimetic Digitalis
**Controllers & DAW tools:** Electra One (MIDI controller), Ableton Live MIDI Effects & MIDI Tools

---

## 1. Current Requencer Feature Summary

| Category | What We Have |
|---|---|
| **Tracks** | 4 independent tracks, each with 7 subtracks (gate, pitch, velocity, mod, gateLength, ratchet, slide) |
| **Steps** | 1–64 per subtrack, independently settable |
| **Clock** | Per-track divider (1–32) × per-subtrack divider (1–32) = native polyrhythm |
| **Scales** | 10 built-in (major, minor, dorian, phrygian, mixolydian, minor/major pentatonic, blues, chromatic, whole tone) |
| **Randomizer** | Seeded PRNG (mulberry32). Per-subtrack: gate (random/euclidean), pitch (scale-constrained, maxNotes), velocity, gateLength, ratchet (probability), slide (probability), mod |
| **Gate Modes** | 4 modes: random, euclidean, sync (syncopated weighting), cluster (Markov chain) |
| **Variations** | Deterministic transform overlays per bar (2/4/8/16 bar phrases). 11 transforms, per-subtrack overrides |
| **Arpeggiator** | Chord-tone extraction from scale. Modes: up, down, triangle, random. Octave range 1–4 |
| **LFO** | Mod subtrack generator. 6 waveforms (sine, triangle, saw, square, slew-random, S+H). Width parameter, synced or free-running |
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

### Electra One (MIDI Controller)

**Architecture:** Programmable MIDI controller with 480×272 touchscreen, 12 high-res rotary encoders, 6 buttons. USB + DIN MIDI. Not a sequencer — a performance control surface with scripting capabilities.

| Category | Detail |
|---|---|
| Snapshot morphing | Save parameter snapshots, morph (interpolate) between them in real-time. Crossfade between two complete parameter states |
| Snapshot randomization | Randomize all parameter values within a snapshot — instant "roll the dice" on any connected synth |
| Lua scripting | Full Lua runtime on-device: custom MIDI effects, LFOs, envelopes, sequencers, XY pads. Triggered by user actions, MIDI clock, or timed intervals |
| Preset library | 300+ community presets including custom sequencers, synth editors, DAW controllers |
| MIDI routing | Controls 5,000+ parameters across 32 MIDI devices. All MIDI message types including SysEx and NRPN |
| I/O | USB device + USB host (2 devices) + 2 DIN MIDI in/out |

**Relevant concepts for Requencer:** Snapshot morphing (interpolate between two sequencer states) and parameter randomization are the most transferable ideas. The "morph between two states" concept applied to RandomConfig or TransposeConfig could create smooth live transitions.

---

### Ableton Live — MIDI Effects & MIDI Tools

**Architecture:** DAW-based MIDI processing chain. Effects are stackable, scale-aware, and can be combined for generative systems.

| Category | Detail |
|---|---|
| Beat Repeat | Probability-triggered audio stutter/repeat. Grid size (1/32–4 bars), variation (randomized grid changes), pitch decay (each repeat pitched down), chance %. Output modes: Mix, Insert, Gate |
| Random (MIDI effect) | Randomizes incoming note pitch within adjustable range. Probability control for when randomization occurs. Modes: add random offset above/below/both |
| Velocity (MIDI effect) | Randomize velocity within range, apply velocity curves, compress/expand dynamic range. Single-knob "Random" adds instant humanization |
| Arpeggiator | Rate, gate %, retrigger modes (off/note/beat), repeats (1–∞), transposition steps + distance (semitones or scale degrees), velocity decay. "Random Once" mode: generate one random order, repeat until input changes |
| Scale (MIDI effect) | 12×13 note remapping grid. Force any input to a scale. All MIDI effects support scale-awareness |
| Chord (MIDI effect) | Add up to 6 intervals to each incoming note. Creates instant parallel harmony |
| Note Length | Override note durations, add release velocity, trigger on note-off |
| MIDI Tools (Live 12) | Transform panel: Ornament (grace notes/flams), Chop (slice notes with variation), Connect (fill gaps between notes), Retrigger (repeats with velocity/time shaping). Generate panel: create new MIDI from parameters |
| Stutter/Tremolo | Reimagined Auto Pan: sidechain-style pumping, trance gates, polyrhythmic amplitude patterns |

**Relevant concepts for Requencer:** Beat Repeat's probability-based stutter is a powerful live performance tool. Velocity randomization as a simple humanizer. Ornament/flam for micro-timed ghost notes. The "Random Once" arpeggiator concept (generate once, repeat) aligns with our seeded-PRNG philosophy.

---

## 3. Feature Gap Analysis

### Comparison Table

| Feature | REQ | Metro | NerdSEQ | Eloquencer | PER\|FORMER | OXI One | T-1 | Mimetic D | Electra One | Ableton |
|---|---|---|---|---|---|---|---|---|---|---|
| **Core** | | | | | | | | | | |
| Tracks | 4 | 2 | 8 | 8 | 8 | 8–64 | 16 | 4 ch | — | ∞ |
| Max steps | 64 | 64 | 64 | 64 | 64 | 128 | 64×16 | 16 | — | ∞ |
| Independent subtrack lengths | Yes | — | Yes | Yes | Yes | Yes | — | — | — | — |
| Clock div per track | Yes | Yes | Yes | Yes | Yes | Yes | Yes | — | — | Yes |
| Clock div per subtrack | Yes | — | — | — | — | — | — | — | — | — |
| Scales | 10 | 149 | — | Global | 4 user + std | Yes | Yes | None | — | 12×13 grid |
| User-defined scales | No | 100 | — | No | 4 slots | Yes | Yes | — | — | Custom map |
| **Rhythm / Gate** | | | | | | | | | | |
| Euclidean | Yes | — | — | — | Yes | Yes | Yes | — | — | — |
| Per-step gate probability | No | Yes | Yes | Yes | Yes | Yes | Yes | — | — | — |
| Step conditions (N:M) | No | — | Via FX | Yes (v1.4) | Yes | Yes | — | — | — | — |
| Fill mode | No | — | — | Yes | Yes | Yes | — | — | — | — |
| Ratchet | 1–4 | Yes | Yes | 8 types | Yes | Yes | Yes | — | — | Retrigger |
| Beat repeat / Stutter | No | — | — | — | — | — | — | — | — | Yes |
| **Pitch** | | | | | | | | | | |
| Slide/portamento | Yes | Yes | Yes | — | Yes | Yes | — | — | — | — |
| Accumulator | No | Yes | — | — | — | Yes | — | — | — | — |
| Voice-leading | No | — | — | — | — | — | Yes | — | — | — |
| Arpeggiator | Yes | — | — | — | Yes* | — | — | — | — | Yes |
| Transpose | ±48 | Yes | — | — | Yes | Yes | Yes | — | — | — |
| Pitch randomize offset | No | — | — | — | — | — | — | — | — | Random FX |
| **Modulation** | | | | | | | | | | |
| LFO | Yes | Via mod | 8 auto | Stepped | Curve trk | 16 LFOs | Phrase | — | Via Lua | — |
| Mod lanes | 1 (mod sub) | 8 | MOD col | — | Curve trk | 64 | — | — | — | — |
| Internal mod routing | No | Yes | Yes | — | Yes | Yes | — | — | — | — |
| Mutator/drift | Yes | — | Via map | — | — | — | — | — | — | Transform |
| Variations / Cycles | Yes | — | — | — | — | — | Cycles | — | — | — |
| **Probability** | | | | | | | | | | |
| Gate probability | No | Yes | Yes | Yes | Yes | Yes | Yes | — | — | — |
| Pitch variation prob | No | — | — | Yes | Yes | — | — | — | — | — |
| Gate length var prob | No | — | — | Yes | Yes | — | — | — | — | — |
| Ratchet probability | Yes | — | — | Yes | Yes | — | — | — | — | — |
| Stochastic mode | No | — | — | — | Yes* | Yes | — | — | — | — |
| **Performance** | | | | | | | | | | |
| Snapshot/undo | No | — | — | Freeze | Snapshot | — | — | Undo | Snapshots | — |
| Snapshot morphing | No | — | — | — | — | — | — | — | Yes | — |
| Preset chains / song | No | 8 chains | 255 rows | 64 parts | 64 slots | Arranger | Cycles | — | — | Session |
| Swing/groove | No | 50–78% | Per-step | Global | 50–75% | 1ms micro | 8 templates | — | — | Per-clip |
| Pattern chaining | No | Yes | Yes | Yes | Yes | Yes | Via cycles | — | — | Launch |
| Keyboard/play mode | No | Stage player | — | Free play | — | — | — | Manual step | — | — |
| Control-all (multi-track) | No | — | — | — | — | — | — | — | Multi-dev | — |
| **Routing** | | | | | | | | | | |
| Output routing matrix | Yes | — | — | — | 16 routes | — | — | — | MIDI rte | — |
| Per-output mute patterns | Yes | — | — | — | — | — | — | — | — | — |
| Logic track operations | No | — | — | — | Yes* | — | — | — | — | — |
| **I/O** | | | | | | | | | | |
| CV outputs | — | 4+2 | 12 | 8 | 8 | 8 | 8 | 4 | — | — |
| MIDI | Web MIDI | USB+TRS | Via exp | — | TRS+USB | TRS+USB+BLE | TRS+USB | — | USB+DIN | USB |

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
**Who has it:** Metropolix (50–78%), PER|FORMER (50–75%), OXI One (per-step 1ms), NerdSEQ (per-step groove), T-1 (8 groove templates), Ableton (per-clip groove)
**What:** Per-track timing offset that delays even/odd steps by a percentage of the clock interval for rhythmic feel.

**Architectural fit:** Applied in the I/O layer (`tone-output.ts`), not the engine — engine ticks on-grid, I/O offsets the Tone.js `time` parameter. Keeps engine purity. Low-medium complexity.

---

#### Beat Repeat / Live Stutter — HIGH VALUE for techno
**Who has it:** Ableton (Beat Repeat), OXI One (FLOW system)
**What:** Probability-triggered real-time stutter effect. Captures a slice of recent playback and repeats it with controllable grid size, pitch decay, and volume decay. Chance parameter controls how often it activates.

**Why we want it:** This is *the* techno performance tool. A momentary stutter with pitch decay creates builds, breakdowns, and tension — the bread and butter of live techno. Unlike ratchets (which subdivide a single step), beat repeat grabs a *phrase fragment* and loops it, creating a fundamentally different effect.

**Possible implementation:** An overlay that, when active, overrides normal playback by repeating the last N steps. Parameters: grid size (1/2/4/8/16 steps), repeat count, pitch decay (each repeat shifted down), velocity decay, chance %. Could be momentary (hold button) or latched.

**Architectural fit:** Engine overlay — intercepts tick output and replays buffered events. Medium complexity. Needs a small event buffer (last N steps of output per track).

---

#### Snapshot Morphing — INTERESTING, extends existing snapshot concept
**Who has it:** Electra One (interpolate between saved snapshots), Elektron Octatrack (scene crossfader)
**What:** Instead of binary snapshot/revert, *interpolate* between two states. A crossfader or morph knob blends parameters between state A and state B.

**Why we want it:** Live transitions. Instead of jumping between two randomizer configs or transpose settings, smoothly morph between them. E.g., slowly morph gate fill from 30% to 80%, or crossfade between two pitch ranges. Creates gradual builds that feel intentional.

**Possible implementation:** Store two RandomConfig/TransposeConfig states. A morph parameter (0.0–1.0) linearly interpolates all numeric fields. Trigger re-randomize at crossfade positions to hear the blend.

**Architectural fit:** Pure math on config objects. Low engine complexity. UX is the challenge — needs a good control metaphor (encoder as crossfader? dedicated morph page?).

---

#### Control-All — USEFUL for live performance
**Who has it:** Elektron Digitakt/Syntakt (control-all mode), Electra One (multi-device control)
**What:** Adjust the same parameter across all tracks simultaneously with a single control. E.g., turn one knob to increase gate fill density on all 4 tracks at once, or shift all tracks' pitch ranges up.

**Why we want it:** During live performance, reaching into individual tracks is slow. Being able to sweep a single parameter across all tracks creates dramatic whole-mix changes — essential for builds and drops.

**Possible implementation:** A modifier key/mode that makes encoder changes apply to all tracks instead of just the active track. Works with any existing per-track parameter (fill, gate length range, velocity range, mutate rate, transpose).

**Architectural fit:** Pure UI/action layer. When control-all is active, dispatch the same action to all 4 tracks. Very low complexity.

---

### Needs More Research

#### Loop Evolution: Step Conditions + Accumulator
**Step conditions** (PER|FORMER, NerdSEQ, Eloquencer, OXI One, Elektron) and **Accumulator** (Metropolix, OXI One) are grouped together — both create deterministic pattern evolution across loop iterations.

- **Step conditions:** Steps trigger based on loop iteration count (e.g., "play every 4th loop on the 2nd pass"). Elektron's A:B system (e.g., 1:2 = fire on odd loops, 2:4 = fire on 2nd of every 4 loops) is the clearest model. Unlike probability, these are deterministic and repeating.
- **Elektron PRE/NEI conditions:** Chain trigger logic — a step fires based on whether the *previous* conditional step fired (PRE) or whether a step on the *neighbor track* fired (NEI). Creates if/then relationships between steps and across tracks.
- **Accumulator:** Cumulative pitch transposition per loop cycle. Boundary behaviors: hold, wrap, ping-pong.

**Open questions:**
- How complicated is step condition editing per-step? Does it make sense without pattern save/load?
- Could step conditions be randomly generated instead of manually edited? (E.g., randomizer assigns A:B conditions to some steps automatically)
- PRE/NEI conditions are powerful but add inter-step/inter-track dependencies — complex for a random-generation workflow
- Should these be a single "loop evolution" feature or separate?

---

#### Internal Mod Routing — NEEDS MORE THINKING, depends on CV input design
**Who has it:** Metropolix (mod lanes → 30+ internal params), PER|FORMER (curve tracks → any param), NerdSEQ (automator), OXI One
**What:** Route LFO/mod subtrack to internal sequencer parameters (gate length, transpose, clock division) instead of only CV output.

**Open questions:**
- With CV inputs planned, external modulation could cover some of this. What parameters actually benefit from internal modulation vs. external?
- Which internal targets make musical sense for our workflow?

---

#### Velocity Humanization — SIMPLE, high musical value
**Who has it:** Ableton (Velocity MIDI effect with Random knob), T-1 (accent knob)
**What:** Add a small random offset to velocity values at playback time. Not stored — applied as an overlay. Single parameter: humanize amount (0–100%).

**Why interesting:** Our velocity generation modes (random, accent, sync, etc.) produce fixed patterns. Adding a light random offset at playback gives the mechanical loops a more organic, breathing feel — critical for long techno sets where static velocities become fatiguing.

**Open questions:**
- Should this be per-track or global?
- Should it apply to velocity only, or also gate length? (Ableton's approach is velocity-only; others bundle it)
- We already have a "humanize" variation transform — is a dedicated always-on humanize distinct enough?

---

### Covered by Existing Features

| Feature | Covered by |
|---|---|
| Cycles / Macro Patterns (T-1) | **Variations** — deterministic transform overlays per bar (2/4/8/16 bars), per-subtrack overrides. Different mechanism (transforms vs. snapshots) but same musical goal: deterministic evolution across loop repetitions |
| Ableton Random MIDI (pitch offset) | **Mutator** — our drift engine already applies random pitch changes per loop. Different trigger model (per-loop vs. per-note) but same musical goal: keep patterns evolving |
| Ableton Arpeggiator | **Arpeggiator** — we have up/down/triangle/random with octave range. Ableton's velocity decay and step transposition are nice-to-haves but not critical |
| Ableton Scale MIDI effect | **Scale quantization** — built into our randomizer and transpose system |
| Ornament / Grace notes (Live 12) | **Ratchets** — our 1–4 ratchet system covers rapid re-triggers. True micro-timed grace notes (flams) would need sub-step timing resolution (see high-res clock in roadmap) |
| Ableton Chord MIDI effect | Not applicable — we're monophonic per track. Our routing matrix can combine tracks for pseudo-polyphony |
| Elektron parameter locks | **Per-step values** — our subtracks already store per-step pitch, velocity, gate length, ratchet, slide, mod. P-locks are Elektron's name for what we do natively via independent subtracks |
| Elektron retrigs | **Ratchets** — same concept (1–4 sub-triggers per step). Elektron adds velocity curves to retrigs which we don't have |

### Rejected Features

| Feature | Reason |
|---|---|
| Per-step gate probability | Too random — never creates repeating patterns, doesn't fit our generative approach |
| Fill mode | More useful for drum sequencers, not our voice sequencer |
| Pattern chaining / Song mode | We focus on random generation and live performance, not song creation |
| Pulse count / Stage expansion | Metropolix-specific paradigm — people can get the Metropolix for that |
| Logic track operations | Our mute patterns already provide per-output gate control |
| Ratchet acceleration (T-1) | "Bouncing ball" timing curves — not needed for our use case |
| Lua scripting (Electra One) | We're a standalone sequencer, not a scripting platform. Custom behavior comes from our randomizer/variation/mutator system |
| Elektron sound locks | Not applicable — we don't have a built-in sound engine to switch per step (Tone.js synths are fixed per output) |
| Ableton Note Length effect | Already covered — our per-step gate length (0.05–1.0) does this natively |

### Lower Priority / Future Consideration

- **Voice-leading algorithm** (T-1) — niche, requires polyphonic output
- **Cartesian XY navigation** (Mimetic Digitalis) — incompatible with linear step model
- **Tracker-style editing** (NerdSEQ) — UI paradigm change, not incremental
- **Launchpad integration** (NerdSEQ, PER|FORMER) — depends on MIDI input support
- **Stochastic track type** (PER|FORMER, OXI One) — different compositional model
- **Ratchet velocity curves** (Elektron retrigs) — velocity ramp across sub-triggers (accent first hit, decay rest). Nice expressiveness but low priority
- **Ableton-style stacked arpeggiators** — running multiple arp instances in parallel with different rates. Interesting for generative but adds complexity
- **Elektron 1ST condition** — "only on first loop" trigger. Simple to implement but niche use case for our random-generation workflow

---

## 5. Architectural Fit Notes

### Engine Layer (`src/engine/`)
- **Snapshot** — deep clone of `SequencerState`. Trivially immutable.
- **Snapshot morphing** — linear interpolation between two config objects. Pure math on numeric fields.
- **Beat repeat** — event buffer + replay logic. Buffers last N NoteEvents, replays with pitch/velocity decay. Medium complexity.
- **Step conditions / Accumulator** — loop iteration counter per subtrack, evaluated in `tick()`. Pure math.

### I/O Layer (`src/io/`)
- **Swing/groove** — timing offsets applied to Tone.js scheduling in `tone-output.ts`. Engine stays on-grid.
- **Velocity humanization** — random offset applied to velocity in output scheduling. Trivial.

### UI Layer (`src/ui/`)
- **Snapshot** — needs UX design for trigger mechanism (button combo or overlay).
- **Snapshot morphing** — encoder-as-crossfader or dedicated morph page.
- **Beat repeat** — momentary button hold or latch toggle. Grid size / pitch decay parameters in overlay.
- **Control-all** — modifier key that broadcasts encoder changes to all tracks. Very simple.
- **Swing** — per-track parameter, editable in hold-overlay or new section.
- **Step conditions / Accumulator** — may need new screen section or subtrack editing mode.

### Priority Summary

| Feature | Priority | Engine Complexity | Status |
|---|---|---|---|
| Snapshot / Undo | High | Very low | Needs UX design |
| Beat Repeat / Live Stutter | High | Medium | New — needs design |
| Control-All | High | Very low (UI only) | New — ready to implement |
| Swing / Groove | Useful | Low (I/O only) | Ready to implement |
| Snapshot Morphing | Useful | Low | New — extends snapshot concept |
| Velocity Humanization | Useful | Very low (I/O only) | New — needs research |
| Step conditions + Accumulator | TBD | Medium | Needs more research |
| Internal mod routing | TBD | Medium | Depends on CV input design |
