# 6N138 — High-Speed Optocoupler

## Overview
Vishay 6N138, a high-speed optocoupler in DIP-8 with darlington output stage. Traditionally used for MIDI input isolation per the original MIDI 1.0 hardware specification.

## Why This Part
Classic MIDI input optocoupler. However, in the current design this part has been superseded by the H11L1S Schmitt trigger optocoupler, which is smaller (SOP-6 vs DIP-8), simpler to wire (no base resistor needed), and provides cleaner digital output.

## Key Specifications
| Parameter | Value |
|-----------|-------|
| Package   | DIP-8 |
| Output    | Darlington phototransistor |
| Speed     | High-speed (MIDI-compatible) |
| LCSC      | C571211 |

## Sourcing
- **JLCPCB/LCSC:** C571211

## Notes
Superseded by H11L1S in the current MIDI circuit. The 6N138 requires an external base resistor and more careful biasing. Kept in parts library as a fallback if H11L1S sourcing becomes difficult.
