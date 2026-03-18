# 74HC165D — 8-Bit Parallel-In Serial-Out Shift Register

## Overview
Nexperia 74HC165D, an 8-bit parallel-in/serial-out shift register in SOIC-16. Reads 8 parallel inputs and shifts them out serially, daisy-chainable via SER input for reading large numbers of buttons with minimal GPIO.

## Why This Part
Enables reading 32+ buttons with only 3 MCU GPIO pins (clock, latch, data). 5 daisy-chained 74HC165s read 40 parallel inputs (32 buttons + 8 spare). SOIC-16 is easy to place and route. JLCPCB Basic part (C5613), extremely cheap and always in stock.

## Key Specifications
| Parameter | Value |
|-----------|-------|
| Package   | SOIC-16 |
| Function  | 8-bit PISO shift register |
| Supply    | 2-6V |
| Interface | Parallel in, serial out (daisy-chainable) |
| LCSC      | C5613 |

## Sourcing
- **JLCPCB/LCSC:** C5613 (Basic part)

## Used In
- [`button-scan.ato`](../circuits/button-scan/button-scan.ato) — 5 instances (sr1-sr5) daisy-chained to scan all 32 buttons
