# ResArray4x0603 — 4-Element Isolated Resistor Array

## Overview
UNI-ROYAL 4D03WGJ0103T5E, a 4-element isolated resistor array in 0603x4 package (3.2x1.6mm). Each resistor is 10k ohm, 5% tolerance. Convex pinout: R1=pin1-pin8, R2=pin2-pin7, R3=pin3-pin6, R4=pin4-pin5.

## Why This Part
Packs 4 pull-up/pull-down resistors into a single tiny footprint, dramatically reducing component count and board area for the button scanning matrix. JLCPCB Basic part with massive stock (1.5M+), so essentially free in assembly.

## Key Specifications
| Parameter | Value |
|-----------|-------|
| Package   | 0603x4 (3.2x1.6mm), 8-pin |
| Resistance| 4x 10k ohm, 5% |
| Pinout    | Convex (R1=1-8, R2=2-7, R3=3-6, R4=4-5) |
| LCSC      | C29718 |

## Sourcing
- **JLCPCB/LCSC:** C29718 (Basic part)

## Used In
- [`button-scan.ato`](../circuits/button-scan/button-scan.ato) — 9 instances as pull-up/pull-down resistors for the 32-button scanning matrix
