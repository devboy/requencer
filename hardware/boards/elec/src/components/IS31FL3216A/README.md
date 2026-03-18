# IS31FL3216A — 16-Channel I2C LED Driver (QFN-28)

## Overview
ISSI IS31FL3216A-QFLS3-TR, a 16-channel constant-current LED driver in QFN-28 (4x4mm). 8-bit PWM per channel, I2C interface with configurable address via AD pin. R_EXT sets global output current. 8 channels can alternatively function as GPIO.

## Why This Part
Smaller than the IS31FL3236A (QFN-28 vs QFN-44) while providing enough channels for distributed LED driving across the panel. Three chips with 16 channels each cover all 32 button LEDs plus function indicators. I2C keeps wiring simple with only 2 data lines shared across all drivers.

## Key Specifications
| Parameter | Value |
|-----------|-------|
| Package   | QFN-28 (4x4mm) |
| Channels  | 16 (constant-current sink) |
| PWM       | 8-bit per channel |
| Interface | I2C, configurable address (AD pin) |
| Supply    | 2.7-5.5V |
| LCSC      | C2678726 |

## Datasheet
- [LCSC page](https://www.lcsc.com/product-detail/C2678726.html)

## Sourcing
- **JLCPCB/LCSC:** C2678726

## Used In
- [`led-driver.ato`](../circuits/led-driver/led-driver.ato) — 3 instances (led_a, led_b, led_c) driving step button LEDs and function button LEDs

## Notes
CLK pin (pin 1) should be tied to GND when chip cascade is unused. IN pin (pin 2) is for audio input and can be left floating. SDB (pin 22) is active-low shutdown — must be pulled high to enable the driver.
