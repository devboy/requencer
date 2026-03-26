# Eurorack Physical Dimensions Reference

Research notes for building a physically-accurate eurorack panel simulator.

## Standard Dimensions

| Spec | Value |
|------|-------|
| 1 HP (Horizontal Pitch) | 5.08 mm (0.2") |
| 1 U (Rack Unit) | 44.45 mm (1.75") |
| 3U panel height | 128.5 mm (5.059") |
| Rail-to-rail (usable height) | ~108.5 mm |
| Top/bottom rail | ~10 mm each |

Source: Doepfer A-100 mechanical spec, Eurorack standard (derived from 19" rack standards).

## Mounting

| Spec | Value |
|------|-------|
| Screw type | M3 (3mm thread) |
| Mounting hole diameter | 3.2 mm |
| M3 screw head diameter | ~6.0 mm (pan head) |
| Screw X from panel edge | 7.5 mm |
| Screw Y from panel edge | 3.0 mm |
| Horizontal screw spacing | (W - 15) mm, where W = module width |

Modules typically have 2 screws (narrow) or 4 screws (wide modules). Our 55+ HP module uses 4 corner screws.

## Connectors

### 3.5mm Jacks (Thonkiconn PJ398SM)
| Spec | Value |
|------|-------|
| Panel hole diameter | 6.0 mm |
| Thread | M6 × 0.5mm (metric fine) |
| Hex nut across flats | 10.0 mm (visible size on panel) |
| Hex nut across corners | ~11.5 mm |
| Minimum center-to-center spacing | 12.0 mm (only 2mm gap between nuts) |
| Recommended spacing | 12.7–14.0 mm (for cable clearance) |
| Patch cable plug barrel diameter | ~9 mm |

The Thonkiconn is the de facto standard eurorack jack. The hex nut is what you
see on the panel — 10mm across flats. Cable plugs are ~9mm diameter, so jacks
need at least 12mm c-c for cables to physically fit, 14mm for comfort.

### TRS MIDI (Type A)
Larger than 3.5mm mono jacks. Panel hole ~6.5 mm, nut ~12mm. Used for MIDI via 3.5mm TRS.

### Panel Component Clearance
- Leave 10mm from top/bottom edges for rail clearance
- Potentiometers: typically 18-20mm center-to-center vertically
- Jacks: 12mm minimum c-c, 14mm for comfortable cable access
- PCB to panel gap: 9-12mm depending on jack type

## Displays in Eurorack

| Display | Active Area | Fits 3U? |
|---------|-------------|----------|
| 2.4" TFT | 48.96 × 36.72 mm | Yes, easily |
| 3.5" TFT | 73.44 × 48.96 mm | Yes |
| 5.0" TFT | 108.0 × 64.8 mm | Yes (tight, needs careful layout) |
| 7.0" TFT | 154.08 × 86.58 mm | No — exceeds 3U height |

Our module uses a 3.5" TFT (73.44 × 48.96 mm active area, 480×320 native resolution). At 3U this leaves ~70mm for controls and jacks — plenty of room for a 4×4 button grid, soft buttons, encoder, and a full jack section. CSS display: 330×220px (at 4.5 px/mm scale).

### 3.5" TFT Readability

Pixel pitch at 480×320 over 73.44×48.96mm: **0.153 mm/pixel**.

| Canvas font size | Physical height | Readability |
|-----------------|----------------|-------------|
| 10px | 1.53mm | Unreadable |
| 12px | 1.84mm | Bare minimum for dim labels |
| 14px | 2.14mm | Minimum body text |
| 18px | 2.75mm | Comfortable reading |
| 22px | 3.37mm | Headers |
| 28px | 4.28mm | Large titles |

**Rule of thumb:** minimum 12px for labels, 14px for body text, 18px+ for headers.
Content area at 480×274px (after status bar + soft labels) fits ~14 lines at 18px.

## Reference Modules

| Module | HP | Features |
|--------|-----|----------|
| XOR Electronics NerdSEQ | 40 HP | 4-track sequencer, 2.4" LCD, many jacks |
| Westlicht PER\|FORMER | 26 HP | 8-track sequencer, OLED display |
| Ornament & Crime | 8 HP | Multi-app, 1.3" OLED |
| Intellijel Atlantis | 34 HP | Full synth voice, many knobs/jacks |
| Mutable Instruments Clouds | 18 HP | Granular processor, knobs + LEDs |
| Eowave Quadrantid Swarm | 41 HP | Touch keys, digital synth + analog filter |

## Our Prototype Spec

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Browser scale | 4.5 px/mm | Readable at 100% zoom on 1080p+ displays |
| Module width | Content-flexible | LCD (330px CSS) + controls + jack zone |
| Module height | 578 px (128.5mm × 4.5) | True 3U standard |
| Display | 3.5" TFT, 480×320 canvas, 330×220 CSS | Fits comfortably in 3U |
| Jack visual (nut) | 45 px (10mm × 4.5) | M6 hex nut across flats |
| Jack hole (center) | 16 px (3.5mm × 4.5) | Actual socket opening |
| Jack spacing | 63 px (14mm × 4.5) | Comfortable cable clearance |
| Regen button | 36 px (8mm × 4.5) | Round LED button |
| TRS MIDI jack | 54 px (12mm × 4.5) | Slightly larger than mono |
| Screw diameter | 27 px (6mm × 4.5) | M3 pan head |
| Screw inset | 33.75px × 13.5px from edges | Doepfer standard |
| LCD min font | 12px canvas = 1.84mm physical | Bare minimum labels |
| LCD body font | 14-18px canvas = 2.1-2.8mm | Readable text |

### Pixel Conversion Table (4.5 px/mm)

| mm | px | Component |
|----|-----|-----------|
| 1 | 4.5 | — |
| 3.5 | 16 | Jack hole opening |
| 5.08 (1HP) | 22.86 | Horizontal pitch |
| 6.0 | 27 | Panel hole / M3 screw head |
| 8.0 | 36 | Tactile button |
| 10.0 | 45 | Thonkiconn hex nut |
| 12.0 | 54 | TRS jack nut / min spacing |
| 14.0 | 63 | Comfortable jack spacing |
| 128.5 (3U) | 578 | Panel height |
