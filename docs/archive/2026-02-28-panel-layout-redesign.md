# Panel Layout Redesign

## Goal

Improve workflow efficiency and logical grouping of panel controls. Prototype-stage exploration — optimize for usability, not final HP count.

## Layout Overview

```
[T1]  ┌──────────────────┐  [GATE]  [MUTE]
[T2]  │                  │  [PTCH]  [ROUTE]
[T3]  │      LCD         │  [VEL]   [DIV/LEN]
[T4]  │                  │  [MOD]
      └──────────────────┘

[RESET] [PLAY]  [RAND]  (Enc A)  (Enc B)
 ~14mm   ~14mm   ~14mm   14.5mm   14.5mm

       [o][o][o][o][o][o][o][o]
       [o][o][o][o][o][o][o][o]
       ← aligned to LCD width →
```

Jacks zone unchanged (right side of panel).

## Changes from Previous Layout

### 1. Control Strip (new)

Single horizontal row between LCD and step grid:

- **RESET, PLAY, RAND** — larger buttons (~14mm), matching encoder height
- **Encoder A, Encoder B** — unchanged 14.5mm knobs
- All five controls in one row, uniform height

RAND moves from the right button column to center-of-strip. It is the hero action — randomization is core to the sequencer identity.

Buttons may use ~14mm illuminated tactile or arcade-style caps. Exact part TBD (research needed for PCB-mountable options that match encoder height).

### 2. Overlay Column (simplified)

Right column becomes overlays-only (hold-to-view, release-to-dismiss):

| Button | Overlay |
|--------|---------|
| MUTE | Mute states per track |
| ROUTE | Routing assignments |
| DIV/LEN | Clock dividers + sequence lengths |

Small buttons (5mm), same as track/subtrack buttons.

### 3. DIV/LEN Combined Button

Single button, dual function via encoders:

- **Hold DIV/LEN** — overlay shows both divider and length values for all 4 tracks
- **Encoder A** (while held) — adjusts sequence length for selected track
- **Encoder B** (while held) — adjusts clock divider for selected track

No mode toggle needed. Both parameters visible simultaneously on the overlay.

### 4. Step Grid Alignment

Step grid (2x8) aligns horizontally with the LCD width. Creates a clean vertical column: LCD → control strip → step grid.

## Zone Map

| Zone | Components | Purpose |
|------|-----------|---------|
| Left column | T1-T4 (5mm) | Track selection |
| Center | LCD (3.5" TFT) | Display |
| Right of LCD | GATE/PTCH/VEL/MOD (5mm) | Subtrack selection |
| Far right | MUTE/ROUTE/DIV-LEN (5mm) | Overlay triggers |
| Control strip | RESET/PLAY/RAND (~14mm) + Enc A/B | Transport, randomize, value editing |
| Bottom | 2x8 step grid (4.5mm) | Step editing |
| Right panel | Jacks | I/O (unchanged) |

## Trade-offs

- Larger transport/RAND buttons cost more HP width (~70mm for the strip)
- DIV/LEN dual function needs clear silkscreen labeling
- Right column drops from 4 to 3 buttons — cleaner but less direct access

## Future Ideas (Shelved)

- **4 encoders (1 per track)** — direct manipulation without selecting track first. Would add significant HP and physical complexity. Revisit if 2-encoder workflow proves limiting.

## Open Questions

- Exact large button part number (~14mm, PCB-mount, encoder-height match)
- Whether buttons in control strip should be illuminated (LED-equipped)
- Silkscreen treatment for DIV/LEN dual label
