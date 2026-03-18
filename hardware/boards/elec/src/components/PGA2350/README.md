# PGA2350 — RP2350B MCU Module (Pimoroni)

## Overview
Pimoroni PGA2350 (PIM722), a 25.4x25.4mm pin grid array module based on the RP2350B microcontroller. 64-pin PGA at 2.54mm pitch, 48 GPIO, 16MB flash, 8MB PSRAM, onboard 3.3V regulator (300mA). Dual Arm Cortex-M33 / dual RISC-V Hazard3 cores.

## Why This Part
The RP2350B provides 48 GPIO — enough for SPI DACs, I2C LED drivers, shift register scanning, UART MIDI, SD card, USB, and display without needing I/O expanders. The PGA module form factor is compact and socketable for prototyping. 8MB PSRAM enables large pattern storage. Pimoroni handles the critical flash/PSRAM routing.

## Key Specifications
| Parameter | Value |
|-----------|-------|
| Package   | 64-pin PGA (25.4x25.4mm, 2.54mm pitch) |
| MCU       | RP2350B (dual Cortex-M33 / RISC-V) |
| Flash     | 16MB |
| PSRAM     | 8MB |
| GPIO      | 48 (including 8 ADC channels) |
| Power in  | 3-5.5V (VB pin) |
| Regulator | Onboard 3.3V, 300mA |

## Datasheet
- [Pimoroni PGA2350 GitHub](https://github.com/pimoroni/pga)

## Sourcing
- **Pimoroni:** [PIM722](https://shop.pimoroni.com/products/pga2350)
- **JLCPCB/LCSC:** Not available (direct from Pimoroni)

## Used In
- [`mcu.ato`](../circuits/mcu/mcu.ato) — Central MCU module, drives all peripherals via SPI, I2C, UART, and GPIO

## Notes
GP47 is connected to PSRAM CS via a cuttable trace on the module. ADC_VREF (pin 63) should be decoupled for accurate analog readings. USB D+/D- are exposed directly — no USB connector on the module itself.
