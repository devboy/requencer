# TLC5947DAP — 24-Channel LED Driver (HTSSOP-32)

## Overview
Texas Instruments TLC5947DAP, a 24-channel constant-current LED driver in HTSSOP-32 with exposed PowerPAD. 12-bit PWM per channel, daisy-chainable SPI-like interface (SIN, SCLK, XLAT, BLANK, SOUT).

## Why This Part
12-bit PWM provides smoother LED dimming than the 8-bit IS31FL3216A. SPI interface allows fast updates and daisy-chaining. 24 channels per chip could cover many LEDs with fewer ICs. However, the current design uses IS31FL3216A (I2C) instead for simpler wiring in a distributed placement strategy.

## Key Specifications
| Parameter | Value |
|-----------|-------|
| Package   | HTSSOP-32 (PowerPAD) |
| Channels  | 24 (constant-current sink) |
| PWM       | 12-bit per channel |
| Interface | SPI-like (SIN, SCLK, XLAT, BLANK) |
| LCSC      | C2873022 |

## Datasheet
- [TI product page](https://www.ti.com/product/TLC5947)

## Sourcing
- **JLCPCB/LCSC:** C2873022

## Notes
Not currently used in circuit .ato files — the design switched to 3x IS31FL3216A (I2C, QFN-28) for distributed placement near the buttons. Kept in parts library as an alternative. The PowerPAD (pin 33) must be soldered to GND for thermal dissipation.
