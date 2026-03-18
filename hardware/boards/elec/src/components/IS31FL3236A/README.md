# IS31FL3236A — 36-Channel I2C LED Driver (QFN-44)

## Overview
ISSI IS31FL3236A-QFLS2-TR, a 36-channel constant-current LED driver in QFN-44 (5x5mm). 8-bit PWM per channel, I2C interface with 4 selectable addresses via AD pin. R_EXT (3.3k ohm) sets global output current (~23mA max per channel).

## Why This Part
Provides 36 LED channels in a single chip for designs that need high channel density. Replaced in the current design by 3x IS31FL3216A (smaller QFN-28) for better distributed placement near the buttons they drive.

## Key Specifications
| Parameter | Value |
|-----------|-------|
| Package   | QFN-44 (5x5mm) |
| Channels  | 36 (constant-current sink) |
| PWM       | 8-bit per channel |
| Interface | I2C, 4 addresses (AD pin) |
| Supply    | 2.7-5.5V |
| LCSC      | C246443 |

## Datasheet
- [LCSC page](https://www.lcsc.com/product-detail/C246443.html)

## Sourcing
- **JLCPCB/LCSC:** C246443

## Notes
Not currently used in any circuit .ato file. Superseded by IS31FL3216A for this project's distributed placement strategy. Kept as an alternative if a single high-channel-count driver is needed.
