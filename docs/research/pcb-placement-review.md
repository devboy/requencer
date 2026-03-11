# PCB Placement Review (2026-03-08)

Review of component placement on the routed PCB (`hardware/pcb/build/placed.kicad_pcb`).

## Issues Found

### 1. PGA2350 / USB-C / SD Card Overlap (Critical)

The PGA2350 module, USB-C connector, and MicroSD slot are all placed in the `mcu.` zone at ~(88.9, 40) on B.Cu. Their bounding boxes heavily overlap:

| Component    | Atopile Address | Position (PCB mm) | Bounding Box           | Size (mm)   |
|-------------|----------------|--------------------|------------------------|-------------|
| PGA2350     | `mcu.pga`      | (88.9, 40.0)       | (75.2, 24.2)-(102.7, 55.8) | 27.5 x 31.7 |
| USB-C       | `mcu.usb`      | (72.9, 40.0)       | (66.0, 33.2)-(79.9, 46.8) | 14.0 x 13.7 |
| MicroSD     | `mcu.sd_slot`  | (92.9, 44.0)       | (84.9, 35.7)-(101.0, 52.3) | 16.1 x 16.7 |

**Root cause:** `place_components.py` explicitly places `mcu.pga` at `(center_x, 40)`, but USB-C and SD card are **not** explicitly placed — they fall through to the generic grid layout in the `mcu.` zone (also centered at `(center_x, 40)`), ending up on top of the PGA2350.

**Fix:** Add explicit placement for USB-C and SD card. Per `component-map.json`, they should be near the bottom edge of the board:
- USB-C: faceplate (104.50, 108.39) → PCB (102.50, 97.89)
- SD card: faceplate (111.00, 108.39) → PCB (109.00, 97.89)

These are panel-accessible connectors that need to align with front-panel cutouts.

### 2. Display: Header Only, No Display on PCB (Not a bug)

The PCB has a **9-pin header** (`display.header`, PinHeader1x9) at (52.8, 58.9) on F.Cu. This connects to an external ST7796 3.5" SPI TFT module — the display itself is not mounted on the PCB. This is by design.

### 3. Jack Types (Correct)

| Jack Type | Part | Count | Signals |
|-----------|------|-------|---------|
| PJ398SM (mono) | Thonkiconn 3.5mm TS | 24 | All CV/gate/clock/reset jacks |
| PJ301M12 (stereo TRS) | Thonkiconn 3.5mm TRS | 2 | MIDI IN, MIDI OUT only |

This is correct. Eurorack CV/gate signals are mono; only MIDI TRS Type A requires stereo jacks.

## Component Summary

### Board Dimensions
- PCB: 177.88 x 106.5 mm (sits between eurorack rails)
- Faceplate: 181.88 x 127.5 mm (36 HP)
- PCB origin offset from faceplate: (2.0, 10.5) mm

### MCU: Pimoroni PGA2350 Module (PIM722)
- 25.4 x 25.4 mm Pin Grid Array module (RP2350B)
- 48 GPIO, 16MB flash, 8MB PSRAM, onboard 3.3V regulator
- Exposes USB DP/DM pins (no USB connector on module)

### Connectors
- **USB-C:** Korean Hroparts TYPE-C-31-M-12 (LCSC C165948). USB 2.0 device mode for firmware programming. ESD protection via PRTR5V0U2X.
- **MicroSD:** Molex 5031821852 push-push (LCSC C585353). SPI mode, shares SPI0 bus with display (separate CS pins).
- **Eurorack Power:** 2x5 shrouded header (LCSC C2685177). +12V, -12V, GND.

### Display
- External ST7796 3.5" SPI TFT (480x320) via 9-pin header
- SPI0: MOSI=GP0, SCK=GP2, CS=GP1, DC=GP3
- Backlight PWM on GP5 via 2N7002 MOSFET
- RC reset circuit (10k pull-up + 100nF cap)

## Recommended Placement Fixes

1. **Add explicit placement for `mcu.usb` and `mcu.sd_slot`** in `place_components.py`:
   - USB-C at PCB (102.5, 97.9) — bottom edge, accessible from front panel
   - SD card at PCB (109.0, 97.9) — next to USB-C
   - Both on B.Cu (back side, protruding through faceplate cutouts)

2. **Increase PGA2350 clearance zone** — ensure the `mcu.` zone grid starts below/around the module, not on top of it.

3. **Consider `mcu.sw_bootsel`** (boot select button) — currently at (80.9, 44.0), overlapping with USB-C bbox. Should be near USB-C for firmware flashing ergonomics.
