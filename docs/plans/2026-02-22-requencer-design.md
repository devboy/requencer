# Requencer Design Document

**Date:** 2026-02-22
**Status:** Validated — implementing v2 (random techno machine redesign)

## Overview

Browser-based 4-track sequencer prototype. A **random techno machine** — define constraints per track, generate and regenerate sequences on the fly. Not a step editor. Validates the design in software before hardware (future Rust port).

## Identity

Requencer is a **generation-focused** module:
- Define constraints (scale, density, pitch range, velocity range)
- Hit a button to generate a new pattern within those constraints
- Regenerate individual subtracks (gate, pitch, velocity) or all at once
- Quick preset save/load for storing good constraint sets

## Physical Spec

| Parameter | Value |
|-----------|-------|
| Module height | 3U = 128.5mm = 578px |
| Display | 3.5" TFT (73.44 × 48.96mm active area, 480×320 native, ~330×220px CSS) |
| Module width | Content-flexible |
| Scale | 4.5 px/mm |
| Jack (hex nut) | 10.0mm = 45px (Thonkiconn M6 across flats) |
| Jack hole | 3.5mm = 16px (socket opening) |
| Jack spacing | 14.0mm = 63px (comfortable cable clearance) |
| LCD rendering | Native 480×320, no DPR scaling (pixelated CSS upscale) |
| LCD mask border | 2mm black non-illuminated glass around active area |
| LCD clearance | 3mm from display cutout to nearest component |

## Core Concepts

### Independent Subtracks
Each sequence track has 3 subtracks (gate, pitch, velocity) that can have:
- **Different lengths** — enables polyrhythmic patterns (e.g., 16-step gate, 7-step pitch)
- **Independent clock dividers** — subtracks can run at different speeds

### Constrained Randomization (Primary UX)
- Per-track random config with pitch range, scale, gate fill, velocity range
- Two gate modes: pure random fill, or euclidean distribution
- 4×4 regen grid: row = track, column = subtype (gate/pitch/vel/all)
- Press any button to regenerate that track's subtrack instantly

### Flexible Routing
- 4 sequence tracks → 4 outputs
- Each output selects a same-type source track
- Labels: "OUT 1-4" (routing determines which track feeds each output)

### Polyrhythm
- Independent track and subtrack lengths
- Hierarchical clock: master → track divider → subtrack divider

### Overlays
Transforms applied to engine output before it reaches I/O — modifying playback without changing stored sequences. Mutes and routing are the first overlays; future ones include transposition, probability masks, and bar-offset patterns. See [feature ideas research](../../docs/research/feature-ideas.md) for details.

## Modes

| Mode | LCD Content | S1 | S2 | S3 | S4 |
|------|-------------|----|----|----|----|
| **dashboard** | 4-track overview + selected track detail | CONFIG | ROUTE | PRESET | --- |
| **track-config** | Randomization constraints for selected track | SCALE | RANGE | LENGTH | BACK |
| **routing** | Output→track source mapping | OUT- | OUT+ | SRC | BACK |
| **preset** | Save/load generation presets | SAVE | LOAD | --- | BACK |

Track selection: press any button in a row of the 4×4 grid.
Regen: short press on a grid button regenerates that track×subtype.

## Physical Layout

```
┌─(●)───────────────────────────────────────(●)─┐
│                   REQUENCER                     │
│                                  MIDI MIDI      │
│ ┌── 3.5" LCD ──────────┐  │      IN  OUT       │
│ │ TRK1: ████░░████░░██ │  │  CLK CLK RST RST   │
│ │ TRK2: ██░░██░░████░░ │  │   IN OUT  IN OUT    │
│ │ TRK3: ░░████░░██░░██ │  │                     │
│ │ TRK4: ████████░░░░██ │  │ GATE PTCH VEL MOD C1 C2│
│ │ ───────────────────── │  │  ○    ○    ○   ○  ○  ○ │ OUT 1
│ │ [selected track info] │  │  ○    ○    ○   ○  ○  ○ │ OUT 2
│ └───────────────────────┘  │  ○    ○    ○   ○  ○  ○ │ OUT 3
│                            │  ○    ○    ○   ○  ○  ○ │ OUT 4
│ (S1) (S2) (S3) (S4) [ENC] │                     │
│        GATE PTCH VEL  ALL  │                     │
│  TRK1:  ○    ○    ○    ○   │                     │
│  TRK2:  ○    ○    ○    ○   │                     │
│  TRK3:  ○    ○    ○    ○   │                     │
│  TRK4:  ○    ○    ○    ○   │                     │
│                    [▶] [SH]│                     │
└─(●)───────────────────────────────────────(●)─┘
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Tone.js    │────▶│   Engine     │────▶│  Tone.js    │
│  Clock      │tick │  (pure TS)   │event│  Synths     │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │  Canvas UI  │
                    └─────────────┘
```

## V1 Scope (Current)

1. 4 sequence tracks with independent gate/pitch/velocity subtracks
2. Polyrhythmic lengths per subtrack
3. Hierarchical clock division (track + subtrack level)
4. Constrained random pattern generation (random + euclidean modes)
5. 4×4 regen grid (track × subtype)
6. Routing: output→track source mapping
7. Tone.js audio preview
8. Canvas LCD with dashboard + config views
9. Transport controls + keyboard shortcuts
10. Preset save/load

## Future (Post-V1)

- Sample/Hold mode for pitch and velocity
- Gate length per step
- Ratchets (per-step subdivisions for rolls/fills)
- Slides / portamento (TB-303 style pitch glide between steps)
- Bar-offset overlay (shift patterns by N steps each bar for evolving sequences)
- Pitch arpeggio generator (ordered chord-tone patterns as alternative to random pitch)
- Web MIDI output
- Pattern chaining
- Probability per step
- CV output curves
- Rust port for embedded hardware

See [feature ideas research](../../docs/research/feature-ideas.md) for detailed writeups and trade-offs.
