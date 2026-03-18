# B5819W — 1A 40V Schottky Barrier Diode

## Overview
General-purpose Schottky diode in SOD-123 package. Used for power OR-ing and reverse polarity protection across multiple circuits.

## Key Specifications
| Parameter | Value |
|-----------|-------|
| Package   | SOD-123 |
| Vrrm      | 40V |
| If        | 1A |
| LCSC      | C8598 |

## Datasheet
- [LCSC page](https://www.lcsc.com/product-detail/C8598.html)

## Used In
- [`control.ato`](../boards/control/control.ato) — power path protection
- [`mcu.ato`](../circuits/mcu/mcu.ato) — VBUS protection
- [`midi.ato`](../circuits/midi/midi.ato) — MIDI input protection
- [`power.ato`](../circuits/power/power.ato) — eurorack 5V / USB VBUS OR-ing
