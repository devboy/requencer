# AMS1117-3.3 — 3.3V LDO Voltage Regulator

## Overview
AMS1117-3.3 fixed 3.3V LDO regulator in SOT-223 package. Up to 18V input, 3.3V output, 1A maximum output current. Widely used, cheap, and well-characterized.

## Why This Part
Provides the board-level 3.3V rail for peripheral ICs (LED drivers, shift registers, etc.) separate from the PGA2350's internal 3.3V regulator (which powers only the MCU core). SOT-223 handles the thermal load well. JLCPCB Basic part, always in stock.

## Key Specifications
| Parameter | Value |
|-----------|-------|
| Package   | SOT-223 |
| Output    | 3.3V fixed |
| Max input | 18V |
| Max current | 1A |
| LCSC      | C6186 |

## Sourcing
- **JLCPCB/LCSC:** C6186 (Basic part)

## Used In
- [`power.ato`](../circuits/power/power.ato) — Board 3.3V regulator for peripheral power

## Notes
Requires 10uF or larger capacitor on input for stability per datasheet.
