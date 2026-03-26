# PJS008U — Vertical MicroSD Card Socket

## Overview
Yamaichi PJS008U-3000-0 vertical MicroSD connector. Through-hole mount, 14.18mm above PCB, push-in/pull-out mechanism. Supports SPI mode. Note: PJS008U-3000-0 has no card detect switch — firmware uses SPI probe for detection.

## Why This Part
Vertical orientation is essential for eurorack faceplate mounting — the card inserts from the front panel. Yamaichi is a reliable connector manufacturer. THT pins provide mechanical strength for repeated card insertions.

## Key Specifications
| Parameter | Value |
|-----------|-------|
| Package   | THT vertical, 14.18mm height |
| Interface | SPI (CS, MOSI, MISO, SCK) |
| Features  | Shield pin (no card detect switch) |
| LCSC      | C3177022 |

## Datasheet
- [LCSC page](https://www.lcsc.com/product-detail/C3177022.html)

## Sourcing
- **JLCPCB/LCSC:** C3177022

## Used In
- [`control.ato`](../boards/control/control.ato) — SD card storage for patterns/presets
