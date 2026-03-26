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

## Pin Grid Layout (Top View)

10x10 perimeter-only grid, 2.54mm pitch centered at origin. Interior positions are empty.

```
Col:       1       2       3       4       5       6       7       8       9      10
X:      -11.43  -8.89   -6.35   -3.81   -1.27   +1.27   +3.81   +6.35   +8.89  +11.43

Row 1  (Y=-11.43): GND1   GP1    VBUS   V3V3EN RUN    USBDP  USBDM  BOOTSEL GP46   GND2
Row 2  (Y= -8.89): GP2    GND3   GP0    V3V3   ADCVREF SWCLK SWDIO  GP47    GND4   GP45
Row 3  (Y= -6.35): GP4    GP3    --     --     --      --    --     --      GP43   GP44
Row 4  (Y= -3.81): GP6    GP5    --     --     --      --    --     --      GP41   GP42
Row 5  (Y= -1.27): GP8    GP7    --     --     --      --    --     --      GP39   GP40
Row 6  (Y= +1.27): GP10   GP9    --     --     --      --    --     --      GP37   GP38
Row 7  (Y= +3.81): GP12   GP11   --     --     --      --    --     --      GP35   GP36
Row 8  (Y= +6.35): GP14   GP13   --     --     --      --    --     --      GP33   GP34
Row 9  (Y= +8.89): GP16   GP15   GP19   GP21   GP23   GP25   GP27   GP29    GP31   GP32
Row 10 (Y=+11.43): GND5   GP17   GP18   GP20   GP22   GP24   GP26   GP28    GP30   GND6
```

## Pad Naming Convention

Pads use signal-name identifiers (not sequential numbers):
- **Power:** `VBUS`, `V3V3`
- **Ground:** `GND1` through `GND6` (4 corners + 2 inner-ring corners)
- **GPIO:** `GP0` through `GP47`
- **USB:** `USBDP`, `USBDM`
- **Control:** `BOOTSEL`, `RUN`, `V3V3EN`, `ADCVREF`
- **Debug:** `SWCLK`, `SWDIO`

The GP1 pad uses a rectangular shape as a pin 1 indicator.

## Special Pins

- **V3V3EN** — 3.3V regulator enable (active high). Previously labeled RSVD.
- **GP47** — Connected to PSRAM CS via a cuttable trace on the module.
- **ADCVREF** — Should be decoupled for accurate analog readings.
- **USB D+/D-** — Exposed directly; no USB connector on the module itself.

## Datasheet
- [Pimoroni PGA2350 GitHub](https://github.com/pimoroni/pga)

## Sourcing
- **Pimoroni:** [PIM722](https://shop.pimoroni.com/products/pga2350)
- **JLCPCB/LCSC:** Not available (direct from Pimoroni)

## Used In
- [`mcu.ato`](../../circuits/mcu/mcu.ato) — Central MCU module, drives all peripherals via SPI, I2C, UART, and GPIO
