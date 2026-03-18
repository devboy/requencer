# DAC80508ZRTER — 16-Bit 8-Channel DAC

## Overview
Texas Instruments DAC80508ZRTER, a 16-bit 8-channel voltage-output DAC in WQFN-16 (3x3mm). Internal 2.5V reference, SPI register-mapped interface with per-channel gain control. VIO pin allows direct 3.3V logic — no level shifter needed between MCU and DAC.

## Why This Part
16-bit resolution is critical for accurate 1V/oct pitch CV in a eurorack sequencer. 8 channels per chip means 2 chips cover all 16 outputs (4 tracks x 4 output types). The VIO pin eliminates level shifting, and the internal reference simplifies the power design. WQFN-16 is tiny (3x3mm).

## Key Specifications
| Parameter | Value |
|-----------|-------|
| Package   | WQFN-16 (3x3mm) |
| Resolution| 16-bit |
| Channels  | 8 voltage outputs |
| Reference | Internal 2.5V |
| Interface | SPI (3.3V via VIO pin) |
| LCSC      | C2679499 |

## Datasheet
- [TI product page](https://www.ti.com/product/DAC80508)

## Sourcing
- **JLCPCB/LCSC:** C2679499

## Used In
- [`dac-output.ato`](../circuits/dac-output/dac-output.ato) — 2 instances (dac1, dac2) providing 16 total CV outputs for gate, pitch, velocity, and mod
