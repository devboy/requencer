# OPA4171AIPWR — Quad Precision Rail-to-Rail Op-Amp

## Overview
Texas Instruments OPA4171AIPWR, a quad rail-to-rail output op-amp in TSSOP-14. Supports up to +/-18V supply, 2 uV/C offset drift, no output phase reversal. Four independent op-amp channels per package.

## Why This Part
Rail-to-rail output is needed to reach the full 0-5V (or bipolar) CV range from a single-supply design. The 2 uV/C offset drift is excellent for 1V/oct pitch accuracy across temperature. Quad package minimizes part count — 5 chips provide 20 op-amp channels for all DAC outputs plus reference buffers.

## Key Specifications
| Parameter | Value |
|-----------|-------|
| Package   | TSSOP-14 |
| Channels  | 4 (quad) |
| Supply    | up to +/-18V |
| Output    | Rail-to-rail |
| Offset drift | 2 uV/C |
| LCSC      | C529553 |

## Datasheet
- [TI product page](https://www.ti.com/product/OPA4171)

## Sourcing
- **JLCPCB/LCSC:** C529553

## Used In
- [`dac-output.ato`](../circuits/dac-output/dac-output.ato) — 5 instances buffering DAC outputs: gates (unity), pitch (gain=2, offset), velocity (gain=1.6), mod (inv gain=-2, offset), and reference buffers
