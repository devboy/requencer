# PinHeader1x3 — 1×3 Male Pin Header

## Overview
Generic 2.54mm pitch through-hole pin header. Used as the SWD debug connector on the back of the main board.

## Key Specifications
| Parameter | Value |
|-----------|-------|
| Package   | THT, 2.54mm pitch |
| Pins      | 3 (SWCLK, SWDIO, GND) |
| LCSC      | C49257 |

## Pin Assignment (SWD Debug)
| Pin | Signal | Connect to |
|-----|--------|-----------|
| 1   | SWCLK  | Debug probe CLK |
| 2   | SWDIO  | Debug probe DIO |
| 3   | GND    | Debug probe GND |

## Used In
- [`main.ato`](../../boards/main/main.ato) — SWD debug header
