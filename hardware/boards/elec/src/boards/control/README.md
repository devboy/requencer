# Control Board

**Source:** [`control.ato`](./control.ato)
**Board:** Control (top board in the sandwich stack, user-facing)

## Purpose

The control board holds all user-facing components: 22 illuminated buttons, 24 mono jacks, 2 rotary encoders, a 3.5" TFT display, a MicroSD card slot, and MIDI I/O jacks. It has no MCU or analog processing -- all intelligence lives on the main board. Every signal routes through two 2x16 board-to-board connectors (female sockets mating with male headers on the main board).

## Sub-Module Interconnection

```
                    Board Connector (2x16 socket, Header A + Header C)
                         |
         +---------------+------------------+------------------+
         |               |                  |                  |
    ButtonScanner    LEDDriverChain      IOJacks          MIDIInterface
    (74HC165 x3)    (IS31FL3216A x3)   (WQP518MA x24)    (TRS jacks)
         |               |
    22x PB6149L     LED cathode wiring
    (LED buttons)   grouped by physical
                    location on PCB

    Encoder A (EC11E)    Encoder B (EC11E)
         |                    |
    direct to connector  direct to connector

    FPC Connector ──── Display (ST7796 3.5" TFT)
    PJS008U ────────── MicroSD card slot
```

## Power Distribution

All power comes from the main board through the board connector. No regulators or power generation on this board.

| Rail | Source | Consumers | Decoupling |
|------|--------|-----------|------------|
| +3.3V | Main board AMS1117 regulator | Shift registers (ButtonScanner VCC), MIDI interface, LCD VDDA/VDDI, SD card VCC, IM pull-ups, reset RC | Per-consumer bypass caps |
| +5V | Eurorack bus via main board | LED driver anodes (led_vcc), LCD backlight (via 82 ohm) | 10uF bulk + 100nF HF near LED drivers |
| +12V / -12V | Eurorack bus via main board | Passed through connector but not directly consumed on control board | - |

## Physical Layout Notes

### THT Placement Constraints

All user-facing components are through-hole (THT), which constrains placement to a grid and requires clearance for:
- **WQP518MA jacks:** 9mm diameter body, need ~2mm clearance between adjacent jacks
- **PB6149L buttons:** 6.5mm square body with integral LED
- **EC11E encoders:** 12mm diameter body with 6mm shaft
- **FPC connector:** Bottom-mount, ribbon exits toward display cutout in faceplate
- **PJS008U MicroSD:** Vertical mount, protrudes ~2.6mm above panel surface through faceplate slot

### Component Grouping

Components are physically grouped for shortest trace routing:

- **LED driver A** (left side): drives step1-4, step9-12, t1-t4 (12 LEDs nearest to it)
- **LED driver B** (center): drives step5-8, step13-16, clr (9 LEDs)
- **LED driver C** (right): drives play (1 LED, 15 channels spare for future expansion)

### CV Input Filtering

100nF HF filter caps are placed on the control board side of each CV input (cv_a through cv_d) at the connector. These reduce crosstalk from adjacent digital signals on the board-to-board connector before the signals reach the main board's input protection circuits.

## Circuits on This Board

| Circuit | Instance | Role |
|---------|----------|------|
| `BoardConnectorSocket` | `connector` | Female 2x16 sockets (mates with main board headers) |
| `ButtonScanner` | `buttons` | 3x 74HC165 shift registers + 22x PB6149L illuminated buttons |
| `LEDDriverChain` | `leds` | 3x IS31FL3216A I2C LED drivers (16 channels each) |
| `IOJacks` | `jacks` | 24x WQP518MA mono jacks (pure breakout, no conditioning) |
| `MIDIInterface` | `midi` | MIDI IN/OUT/THRU TRS jacks with optocoupler |
| `EC11E` | `enc_a`, `enc_b` | Rotary encoders with push switch |
| `FPC_32P_05MM` | `lcd_fpc` | 32-pin FPC connector for display |
| `PJS008U` | `sd` | Vertical MicroSD card slot |
| Backlight driver | inline | 2N7002 MOSFET + gate resistors for LCD backlight PWM |
| LCD reset RC | inline | 10k + 100nF power-on reset circuit |
| LCD IM pull-ups | inline | 3x 10k pull-ups for 4-wire SPI mode |
