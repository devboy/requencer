# Requencer Manual

A 4-track eurorack-style step sequencer. Each track generates gate, pitch,
velocity and modulation for one synth voice. The design goal: replace a live
setup of four separate sequencers plus utility modules with a single,
hands-on module built around **polymetric randomization** — quick-generate
musical patterns at independent lengths, then sculpt them while they play.

This browser version is a faithful preview of the hardware: the on-screen
panel is the real faceplate layout, and every control works with the mouse or
a touch screen.

## Quick start (mouse & touch)

- **Click** any button to press it. Click a track button (T1–T4) to select a
  track, a subtrack button (GATE/PITCH/VEL/MOD) to pick what you're editing,
  and step buttons to toggle steps.
- **Hold combos:** many functions live behind "hold this + press that".
  Press and hold one button, then press another — e.g. hold **T1** and press
  **RAND** to randomize track 1. On a touch screen, just use two fingers.
- **Double-click for sticky hold:** double-click any holdable button to lock
  it down (it stays "held" so you can work one-handed). Click it again,
  click empty space, or press `Esc` to release.
- **Encoders:** drag up/down or use the scroll wheel to turn, click to push.
  Encoder A scrolls/edits values, encoder B changes pages/parameters.
- **Transport:** the play button starts and stops the clock; reset returns
  all playheads to step 1.

Press **PLAY**, then hold **T1** and press **RAND** — you have a pattern.
Repeat for the other tracks. Everything else is sculpting.

## Tracks & subtracks

4 tracks, each with 4 independent subtracks: **gate** (rhythm), **pitch**
(melody), **velocity** (dynamics), and **mod** (modulation). Every subtrack
has its own step length (1–64) and clock divider — a track can run a 7-step
gate pattern at ÷2 alongside a 12-step pitch sequence at ÷1, creating
evolving polymetric patterns.

Hold a track button + turn encoder A to set all its subtrack lengths at
once; hold a subtrack button instead to set just that layer's length and
divider.

## Randomizer

The core workflow. Press **RAND** to open the randomizer settings for the
selected track. Quick-generate patterns with hold combos:

- **Whole track** — hold a track button (T1–T4) + press RAND to regenerate
  all four of its layers at once.
- **Single layer** — hold a subtrack button (GATE/PITCH/VEL/MOD) + press
  RAND to regenerate only that layer, e.g. a new melody over the same
  rhythm.

Each track has its own randomizer config: musical scale & root, pitch range,
max distinct notes, fill density (min/max %), velocity range, and gate mode.
Four gate algorithms:

| Mode | Character |
|------|-----------|
| RAND | Shuffled random fills |
| EUCL | Euclidean (evenly spread) rhythms, with random offset |
| SYNC | Offbeat-biased weighted random |
| CLST | Clustered bursts (Markov chain), with continuation probability |

8 factory presets (Bassline, Hypnotic, Acid, Ambient, Percussive, Sparse,
Stab, Driving) shape the randomizer — apply one with the encoder A push, and
save your own from the RAND screen.

## Drift

Open with the **DRIFT** button. Per-track stochastic mutation: each
subtrack has an independent drift rate that controls how quickly steps
mutate over time. Small rates slowly evolve a pattern while it plays; high
rates churn it.

## Transpose

Open with the **TRNS** button. Per-track transposition with semitone offset,
note range (low/high), and scale quantization. Transpose applies to the
pitch output in real time.

## Variation

Open with the **VAR** button. Variation layers per-bar transforms over the
selected track — reverse, rotate, stutter, thin/densify, transpose, octave
shift, accent and more — without touching the underlying pattern. With no
bar selected, push encoder A to toggle variation on or off for the track.
Select a bar with a step button, browse the transform catalog by turning
encoder B, push encoder B to add the transform, and use CLR to remove one.

## Routing

Open the route screen with the **ROUTE** button. Each track's 4 subtrack
outputs (gate/pitch/vel/mod) can be freely routed to any of the 4 output
jacks (A–D), enabling multi-voice or layered configurations.

## Mute & patterns

The **MUTE** screen toggles per-track mute patterns (with their own length
and divider). The **PAT** button opens the pattern screen for storing and
switching patterns.

## Settings

The **SET** button (jack zone) opens global settings. Clock section: BPM and
clock source (INT / MIDI / EXT). MIDI section: global MIDI on/off, device
selection, and per-output MIDI channel assignment (1–16).

## Keyboard shortcuts

Every on-screen control also has a keyboard binding, so the whole sequencer
is playable without a mouse — track buttons on `1–4`, subtracks on
`Q/W/E/R`, steps on `Z–,`, encoders on the arrow keys. Press **`?`** in the
app for the complete keymap.
