# H11L1S — Schmitt Trigger Output Optocoupler

## Overview
Lite-On H11L1S(TA), an optocoupler with built-in Schmitt trigger output in SOP-6 (2.54mm pitch). The Schmitt trigger provides clean digital output directly — no base resistor or emitter pin needed. Open-collector output.

## Why This Part
Replaces the traditional 6N138 DIP-8 optocoupler for MIDI input isolation. The built-in Schmitt trigger eliminates the need for external biasing components, simplifies the circuit, and provides cleaner signal edges. SOP-6 is much smaller than DIP-8 and JLCPCB-assemblable. Cheap at $0.31 with 75K+ stock.

## Key Specifications
| Parameter | Value |
|-----------|-------|
| Package   | SOP-6 (2.54mm pitch) |
| Output    | Schmitt trigger, open collector |
| Supply    | 4.5-20V |
| LCSC      | C78589 |

## Datasheet
- [LCSC page](https://www.lcsc.com/product-detail/C78589.html)

## Sourcing
- **JLCPCB/LCSC:** C78589

## Used In
- [`midi.ato`](../circuits/midi/midi.ato) — MIDI input isolation (TRS jack -> 220 ohm -> H11L1S -> MCU UART RX)
