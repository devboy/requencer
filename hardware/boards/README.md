# Requencer Hardware — Design Wiki

Multi-board eurorack sequencer module. Three-board sandwich stack: **faceplate** (front panel PCB) + **control board** (user-facing THT components) + **main board** (MCU, DACs, power).

## System Block Diagram

```
                    FACEPLATE (front panel PCB)
                    ┌─────────────────────────────────────┐
                    │  Display cutout    26× jack holes   │
                    │  36× button holes  2× encoder holes │
                    └──────────────┬──────────────────────┘
                                   │ mechanical mounting
                    CONTROL BOARD (user-facing THT)
                    ┌──────────────┴──────────────────────┐
                    │  FPC connector ──── ST7796 display   │
                    │  36× PB6149L buttons                 │
                    │  2× EC11E encoders                   │
                    │  26× WQP518MA jacks                  │
                    │  2× PJ366ST MIDI jacks               │
                    │  SD card (PJS008U)                    │
                    │  3× IS31FL3216A LED drivers (I2C)    │
                    │  5× 74HC165D shift registers         │
                    │  H11L1S MIDI optocoupler             │
                    └──────────────┬──────────────────────┘
                      2× ShroudedHeader2x16 (64 pins)
                    ┌──────────────┴──────────────────────┐
                    │  PGA2350 MCU (RP2350B, 48 GPIO)     │
                    │  2× DAC80508 (16-bit, 8-ch each)    │
                    │  5× OPA4171A quad op-amps            │
                    │  AMS1117-3.3 LDO                     │
                    │  USB-C (edge-mount)                   │
                    │  Eurorack power header               │
                    └─────────────────────────────────────┘
                    MAIN BOARD (MCU + analog + power)
```

## Documentation Index

### [Parts Catalog](elec/src/components/)

29 active components + [archived parts](elec/src/components/_archive/). Each part has a README with specs, sourcing info, and design rationale.

### Circuit Modules

Design documentation for each circuit block, including component value rationale and signal interfaces.

| Circuit | Board | Description |
|---------|-------|-------------|
| [dac-output](elec/src/circuits/dac-output/) | Main | 2× DAC80508 → 5× OPA4171A → 16 buffered CV/gate outputs |
| [power](elec/src/circuits/power/) | Main | Eurorack ±12V → +5V/+3.3V supply with protection |
| [mcu](elec/src/circuits/mcu/) | Main | PGA2350 (RP2350B) with SPI, I2C, GPIO routing |
| [input-protection](elec/src/circuits/input-protection/) | Main | Voltage divider + Schottky clamp for CV/clock inputs |
| [board-connector](elec/src/circuits/board-connector/) | Both | 2× 2×16 shrouded headers bridging control ↔ main |
| [led-driver](elec/src/circuits/led-driver/) | Control | 3× IS31FL3216A I2C constant-current LED drivers |
| [button-scan](elec/src/circuits/button-scan/) | Control | 5× 74HC165D shift register chain (34 buttons) |
| [midi](elec/src/circuits/midi/) | Control | TRS Type A MIDI IN/OUT (H11L1S optocoupler) |
| [io-jacks](elec/src/circuits/io-jacks/) | Control | 26× WQP518MA mono jacks |
| [display](elec/src/circuits/display/) | Control | ST7796 3.5" SPI TFT (32-pin FPC) — docs only |

### Board Top-Level Modules

| Board | Description |
|-------|-------------|
| [Control](elec/src/boards/control/) | User-facing board: buttons, LEDs, encoders, jacks, display, SD, MIDI |
| [Main](elec/src/boards/main/) | Processing board: MCU, DACs, op-amps, power supply, USB-C |

### Source Structure

See [elec/src/README.md](elec/src/) for the circuit dependency graph and import structure.

## Build System

The hardware pipeline is managed by `Makefile` targets:

| Target | Action |
|--------|--------|
| `make hw-build` | Full pipeline: place → route → ground pours → faceplate → 3D → export |
| `make hw-place` | Component placement + export panel layout |
| `make hw-route` | FreeRouting autorouter |
| `make hw-3d` | 3D model generation + STEP/GLB export |
| `make hw-clean` | Remove build artifacts |

## Layout Source of Truth

KiCad PCB files are the layout authority. The web preview reads from:
- `scripts/placement/export_layout.py` → `web/src/panel-layout.json` (positions from PCB)
- `component-map.json` (UI metadata: dimensions, categories)
