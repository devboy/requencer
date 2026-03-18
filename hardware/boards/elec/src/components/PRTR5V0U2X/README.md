# PRTR5V0U2X — USB ESD Protection

## Overview
Nexperia PRTR5V0U2X (TECH PUBLIC equivalent), a dual-channel USB ESD protection device in SOT-143B. Ultra-low capacitance TVS diodes protect USB D+ and D- data lines against electrostatic discharge.

## Key Specifications
| Parameter | Value |
|-----------|-------|
| Package   | SOT-143B |
| Channels  | 2 (USB D+, D-) |
| Clamping  | 5V ESD protection |
| LCSC      | C2827688 |

## Why This Part
Required for USB-C compliance — protects the MCU's USB data lines from ESD events during cable insertion. SOT-143B is tiny and places easily near the USB connector. Standard part used across countless USB designs.

## Sourcing
- **JLCPCB/LCSC:** C2827688

## Used In
- [`main.ato`](../boards/main/main.ato) — ESD protection on USB data lines between USB-C connector and PGA2350
