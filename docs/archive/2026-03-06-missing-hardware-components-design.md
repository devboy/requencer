# Missing Hardware Components Design

Date: 2026-03-06

## Context

After upgrading to atopile 0.14 and running the full hardware build pipeline, three categories of missing components were identified:

1. Panel features defined in `panel-layout.json` but absent from the schematic (Settings button, RST OUT jack)
2. LCD display has no physical connector
3. Custom IC parts lack `is_atomic_part` traits required by atopile 0.14's picker

Board dimensions: 182.88mm x 128.5mm (36HP eurorack 3U).

## 1. Settings Button — Direct GPIO (GP23)

The settings button is wired directly to GP23 rather than through the shift register chain. All 32 bits of the 4x 74HC165D chain are already allocated.

- TC002-RGB physical button (same as all other panel buttons)
- GP23 with 10k pull-up to 3.3V + 100nF debounce cap to GND
- Switch pins: one to GP23, other to GND
- **No LED wiring** — all 96 TLC5947 channels (4x 24ch) are fully allocated

### LED limitation and future expansion

The 4x TLC5947 chain provides exactly 96 PWM channels, allocated as:

| Driver | Channels | Assignment |
|--------|----------|------------|
| TLC1 | 0-23 | Step buttons 1-8 (3 RGB channels each) |
| TLC2 | 0-23 | Step buttons 9-16 |
| TLC3 | 0-23 | Track T1-T4 + subtrack GATE/PITCH/VEL/MOD |
| TLC4 | 0-23 | PAT, MUTE, ROUTE, DRIFT, XPOSE, VAR, PLAY, RESET |

To add an LED to the settings button (or any future buttons), a **5th TLC5947** would be needed on the daisy chain. This is a straightforward addition — the TLC5947 supports arbitrary chain length via SIN/SOUT, and the existing SPI wiring (SIN, SCLK, XLAT, BLANK) extends to additional chips. A 5th chip would provide 24 more channels (enough for 8 RGB buttons).

## 2. RST OUT Jack — Buffered Output (GP24)

Same transistor buffer circuit as the existing CLK OUT:

- GP24 drives 2N3904 base through 1k resistor
- Collector pulled up to +5V through 1k resistor, connected to PJ398SM jack tip
- Emitter to GND
- Jack sleeve to GND

Panel position already defined in `panel-layout.json` at (170.55, 29.00).

## 3. LCD Connector — 9-pin 2.54mm Header

Generic 1x9 male pin header for ST7796 3.5" SPI TFT module.

| Pin | Signal | Source |
|-----|--------|--------|
| 1 | VCC | +3.3V rail |
| 2 | GND | Ground |
| 3 | CS | GP1 (lcd_cs) |
| 4 | RESET | GP4 (lcd_rst) |
| 5 | DC | GP3 (lcd_dc) |
| 6 | MOSI | GP0 (spi_mosi) |
| 7 | SCK | GP2 (spi_sck) |
| 8 | LED | Q_BL drain (backlight MOSFET) |
| 9 | MISO | Unconnected (not used by display) |

## 4. Fix Custom Part Footprints

Atopile 0.14 requires `is_atomic_part` traits on custom components for the picker to assign footprints. The following 9 parts need updating:

- 74HC165D (4 instances — shift registers)
- TLC5947DAP (4 instances — LED drivers)
- OPA4172ID (4 instances — op-amps)
- DAC8568SPMR (2 instances — DACs)
- 6N138 (1 instance — MIDI optocoupler)
- 2N3904 (1+1 instances — clock buffer + new RST OUT buffer)
- AMS1117-3.3 (1 instance — 3.3V regulator)
- AZ1117IH-5.0 (1 instance — 5V regulator)
- BAT54S (6 instances — input protection)

Each part needs the `is_atomic_part` trait with manufacturer, part number, and footprint references, following the pattern established by `RaspberryPiPico2.ato`.

## GPIO Allocation After Changes

| GPIO | Function | Notes |
|------|----------|-------|
| GP0-GP22 | Existing | SPI, LCD, DAC, buttons, LEDs, encoders, MIDI |
| GP23 | Settings button | New — direct GPIO with pull-up |
| GP24 | RST OUT | New — transistor buffer |
| GP25 | **Free** | Available for future use (e.g. external storage CS) |
| GP26-GP28 | Existing | CLK IN, RST IN, CLK OUT (ADC-capable) |

## Files to Modify

- `hardware/elec/src/mcu.ato` — add GP23, GP24 signals
- `hardware/elec/src/io-jacks.ato` — add RST OUT jack + buffer
- `hardware/elec/src/display.ato` — add 9-pin header, wire signals
- `hardware/elec/src/requencer.ato` — wire settings button + RST OUT
- `hardware/parts/PinHeader1x9/PinHeader1x9.ato` — new generic header part
- 9 existing part files in `hardware/parts/` — add `is_atomic_part` traits
