# Feature Ideas

Research notes for future Requencer features. Referenced from the [design doc](../plans/2026-02-22-requencer-design.md).

## Overlays (architectural concept)

Mutes and routing both modify playback without changing stored sequences. This is a recurring pattern worth naming: **overlays** — a layer that transforms engine output before it reaches I/O.

**How it fits the engine:** Overlays sit between sequence state and output events. The engine produces raw step data; an overlay pipeline transforms it (mute steps, reroute tracks, transpose pitches) before I/O consumes the result.

**Considerations:**
- Should overlays be composable/stackable? (e.g., mute → transpose → route)
- Does mute belong in the engine layer or the I/O layer? Mute is stateless and pure, so engine is natural — but it's not part of the sequence data itself.
- Stacking order matters: muting before transposition vs. after gives different results.
- Must preserve engine purity — overlays should be pure functions: `(step, overlayState) => step | null`.

**Future overlay types:** transposition, probability masks, bar-offset patterns, swing/humanize.

## Gate Length

Per-step gate duration — how long each note stays "on" within its step window.

**How it fits the engine:** Gate length is a property of each step, output alongside pitch and velocity when a gate fires. The engine emits `(gateOn, gateOff)` event pairs; I/O translates these to Tone.js note durations or CV envelope shapes.

**Considerations:**
- Storage: add to the existing gate subtrack (each step gets a length value) or create a separate gate-length subtrack? Separate subtrack enables independent length and polyrhythmic gate-length patterns.
- Interaction with ratchets: does each ratchet subdivision get proportional gate length, or its own?
- Value range: percentage of step duration (0-100%) is simpler; absolute ms gives more control but couples to tempo.
- Hardware CV output: gate length needs precise timing — slew/envelope shaping in the output stage.
- UI: editing 16 gate-length values on the small LCD. Could use encoder + step-select, or a bar graph view.

## Ratchets

Subdivide a single step into rapid repeated triggers (2x, 3x, 4x, etc.). Classic techno tool for adding rolls and fills.

**How it fits the engine:** On a ratcheted step, the engine emits N evenly-spaced gate events within the step's time window instead of one. Pitch and velocity apply to all subdivisions (or could vary — see considerations).

**Considerations:**
- Per-step ratchet count vs. per-track global setting. Per-step is more expressive but needs more storage and UI.
- Interaction with gate length: each ratchet gets `stepDuration / ratchetCount * gateLength%`? Or fixed minimum gate?
- Clock speed implications: high ratchet counts at fast tempos could produce very short gates — need minimum gate duration.
- UI: how to set per-step ratchet on the 2x8 grid? Hold step + encoder? Dedicated ratchet edit mode?
- Could ratchets have their own velocity curve (accent first hit, fade out, etc.)?

## Slides (portamento/glide)

Mark steps where pitch glides smoothly into the next step's pitch, TB-303 style. Turns staccato sequences into fluid acid lines.

**How it fits the engine:** A slide flag (or slide-time value) per step. When the engine encounters a slide-flagged step, it signals I/O to glide pitch from the current note to the next note's pitch over the step duration.

**Considerations:**
- Slide time: fixed module-wide value, or per-step slide duration? Fixed is simpler; per-step enables varied phrasing.
- Slide only applies when the current step has gate=on AND the next step has gate=on. Silent steps break the glide.
- Engine representation: boolean flag per step (simple) vs. slide-time value per step (flexible). Boolean + global slide-time is a good middle ground.
- CV output: needs actual voltage slew — browser preview can approximate with Tone.js `portamento` or `rampTo`.
- Interaction with ratchets: does slide apply across ratchet subdivisions? Probably not — slide is step-to-step, ratchets are within-step.

## Bar-Offset Overlay

Play the same gate pattern on bar 1, then shift it by N steps on bar 2 (and optionally keep shifting each bar). Creates evolving patterns from a single stored sequence without regenerating.

**How it fits the engine:** This is an overlay (see above) — it doesn't modify the stored sequence, just shifts the read position. The engine tracks bar count and applies `(currentStep + barNumber * offsetAmount) % trackLength` to compute the actual step index.

**Considerations:**
- Offset amount: fixed N steps, or progressive (bar 1: +0, bar 2: +1, bar 3: +2, etc.)?
- Per-track or global? Per-track enables different tracks to drift at different rates — more polyrhythmic complexity.
- Reset behavior: does the offset reset on pattern restart, or accumulate across loops?
- Interaction with polyrhythmic lengths: offset is modulo track-length, so short tracks cycle through offsets faster.
- Could apply to any subtrack independently (offset gate but not pitch = same notes, different rhythm).

## Pitch Arpeggio Generator

A generator mode that creates arpeggiated pitch patterns instead of random pitches. Define a chord or interval set, generate ordered pitch sequences.

**How it fits the engine:** Extends the existing random pitch generator. Instead of picking random scale degrees, the arpeggio generator walks through chord tones in a defined direction/pattern and fills the pitch subtrack with the result.

**Considerations:**
- Arpeggio direction modes: up, down, up-down (triangle), random order.
- Octave range: span 1-4 octaves before repeating the pattern.
- Interaction with scale constraint: arpeggiate within the currently selected scale? Or define chord intervals independently?
- Relationship to random pitch generator: add as a mode option (random vs. arpeggio) rather than replacing.
- Chord definition: preset chords (triad, 7th, sus4, etc.) vs. manual interval selection.
- Pattern length vs. track length: arpeggio pattern might not divide evenly into track length — creates its own polyrhythmic effect.
