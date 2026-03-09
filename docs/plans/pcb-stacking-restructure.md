# PCB Stacking Restructure Plan

Plan for splitting the Requencer hardware into three boards: faceplate, control, and main.

See `docs/research/pcb-stacking.md` for detailed research behind these decisions.

## Folder Structure

atopile supports **multiple named builds in a single project**. Rather than separate projects for each board, we use one project with two build entries. This eliminates cross-project import issues and ensures both boards are always built together.

```
hardware/
  faceplate/          # Existing — front panel (FR4 PCB, mechanical only, separate ato project)
  boards/             # RENAME from hardware/pcb/ — single project, two builds
    ato.yaml          # Two build entries: control + main
    elec/
      src/
        control.ato           # Top-level control board module (build entry 1)
        main.ato              # Top-level main board module (build entry 2)
        board-connector.ato   # Shared connector interface (imported by both)
        button-scan.ato       # Used by control.ato
        led-driver.ato        # Used by control.ato
        io-jacks.ato          # Used by control.ato
        midi.ato              # Used by control.ato
        display.ato           # Used by control.ato
        input-protection.ato  # Used by control.ato
        mcu.ato               # Used by main.ato
        dac-output.ato        # Used by main.ato
        power.ato             # Used by main.ato
      layout/
        # KiCad layout files for both boards
    parts/              # Existing custom parts (EC11E, etc.)
    component-map.json  # UI metadata (panel-mount components → control board)
    scripts/
      export_layout.py  # KiCad PCB → panel-layout.json
  docker/             # Existing — build tools
```

### ato.yaml

```yaml
requires-atopile: "^0.14.0"
paths:
  src: elec/src
  layout: elec/layout
builds:
  control:
    entry: elec/src/control.ato:Control
  main:
    entry: elec/src/main.ato:Main
dependencies: []
```

Running `ato build` produces two separate KiCad projects. Both builds share the same source tree, so importing the shared connector module is just `from "board-connector.ato" import BoardConnectorInterface` — no relative path gymnastics.

See `docs/research/pcb-stacking.md` section 8 for the full analysis of sharing approaches (Approach C is recommended).

---

## Component-to-Board Assignments

### Control Board Components

Components that move from `hardware/pcb/` to `hardware/control/`:

| Subsystem | Components | Current .ato Source |
|---|---|---|
| **Buttons** | 34× TC002-RGB, 40× pull-up resistors | `button-scan.ato` (buttons only) |
| **Button scanning** | 5× 74HC165D shift registers | `button-scan.ato` (SR1-5) |
| **LED drivers** | 5× TLC5947, 5× IREF resistors | `led-driver.ato` (entire module) |
| **Jacks (output)** | 16× PJ398SM (gate/pitch/vel/mod) | `io-jacks.ato` (output jacks) |
| **Jacks (I/O)** | 8× PJ398SM (clk/rst in/out, cv_a-d) | `io-jacks.ato` (I/O jacks) |
| **Jack output buffers** | 2× 2N3904, 4× 1kΩ resistors | `io-jacks.ato` (clk/rst output) |
| **Input protection** | 6× InputProtection (BAT54S, dividers, caps) | `input-protection.ato` |
| **MIDI** | 2× PJ301M12, 6N138, B5819W, resistors | `midi.ato` (entire module) |
| **Encoders** | 2× EC11E, 6× pull-ups, 6× debounce caps | `requencer.ato` (encoder section) |
| **Display connector** | 1× PinHeader1x9, 2N7002 MOSFET, resistors | `display.ato` (header + backlight) |
| **USB** | USB_C_Receptacle, PRTR5V0U2X, 27Ω + 5.1kΩ resistors | `mcu.ato` (USB section) |
| **SD card** | MicroSD_Slot, pull-up resistor | `mcu.ato` (SD section) |
| **Board connector** | 2× 2×16 female socket (NEW) | New module |

### Main Board Components

Components that stay in `hardware/pcb/` (renamed to `hardware/main/`):

| Subsystem | Components | Current .ato Source |
|---|---|---|
| **MCU** | PGA2350 module, BOOTSEL switch, pull-ups | `mcu.ato` (core only) |
| **DAC + output stage** | 2× DAC8568, 5× OPA4172, 74HCT125D, all feedback/protection resistors | `dac-output.ato` (entire module) |
| **Power supply** | AZ1117-5.0, AMS1117-3.3, 2× B5819W, caps | `power.ato` (entire module) |
| **Power OR diodes** | 2× B5819W (USB/eurorack VBUS OR) | `mcu.ato` (power section) |
| **Eurorack power header** | 2×5 shrouded header | `power.ato` |
| **Board connector** | 2× 2×16 male header (NEW) | New module |

---

## Board-to-Board Connector Pinout

Two 2×16 shrouded headers. Header A carries digital signals + power. Header B carries analog signals + remaining digital.

### Header A: Digital + Power (2×16, 32 pins)

| Pin | Row 1 | Row 2 |
|-----|-------|-------|
| 1-2 | GND | GND |
| 3-4 | +3.3V | +3.3V |
| 5-6 | +5V | +5V |
| 7-8 | +12V | -12V |
| 9-10 | SPI0_MOSI (GP0) | SPI0_MISO (GP23) |
| 11-12 | SPI0_SCK (GP2) | CS_LCD (GP1) |
| 13-14 | CS_SD (GP24) | LCD_DC (GP3) |
| 15-16 | LCD_RESET | LCD_BL_PWM (GP5) |
| 17-18 | SD_CD (GP25) | MIDI_TX (GP21) |
| 19-20 | MIDI_RX (GP22) | USB_DP |
| 21-22 | USB_DM | SR_CLK (GP8) |
| 23-24 | SR_LATCH (GP9) | SR_DATA (GP10) |
| 25-26 | LED_SIN (GP11) | LED_SCLK (GP12) |
| 27-28 | LED_XLAT (GP13) | LED_BLANK (GP14) |
| 29-30 | ENC_A_A (GP15) | ENC_A_B (GP16) |
| 31-32 | ENC_A_SW (GP17) | GND |

### Header B: Analog + Remaining Digital (2×16, 32 pins)

| Pin | Row 1 | Row 2 |
|-----|-------|-------|
| 1-2 | GND | GND |
| 3-4 | ENC_B_A (GP18) | ENC_B_B (GP19) |
| 5-6 | ENC_B_SW (GP20) | CLK_IN (GP26) |
| 7-8 | RST_IN (GP27) | CLK_OUT (GP28) |
| 9-10 | RST_OUT (GP4) | CV_A (GP40) |
| 11-12 | CV_B (GP41) | CV_C (GP42) |
| 13-14 | CV_D (GP43) | GATE1_OUT |
| 15-16 | GATE2_OUT | GATE3_OUT |
| 17-18 | GATE4_OUT | PITCH1_OUT |
| 19-20 | PITCH2_OUT | PITCH3_OUT |
| 21-22 | PITCH4_OUT | VEL1_OUT |
| 23-24 | VEL2_OUT | VEL3_OUT |
| 25-26 | VEL4_OUT | MOD1_OUT |
| 27-28 | MOD2_OUT | MOD3_OUT |
| 29-30 | MOD4_OUT | +5V |
| 31-32 | GND | GND |

### Pinout Design Notes

- Power pins are distributed: GND on corners/edges of both headers for good return path
- +3.3V doubled for current capacity (MCU + shift registers + LED drivers + display)
- +5V doubled (LED anodes, encoder pull-ups, output buffers)
- Analog signals (DAC outputs, CV inputs) grouped on Header B to minimize crosstalk with digital
- Header A is digital-only: SPI, shift register, LED driver, encoder, MIDI, USB
- USB D+/D- should be routed as a differential pair with 90Ω impedance

---

## Multi-Board Verification Strategy

Each board gets its own KiCad DRC (ERC + design rules), but the full system also needs cross-board verification:

### Per-Board Checks (Standard KiCad DRC)

- **ERC:** Electrical rules check within each board's schematic
- **DRC:** Design rules check on each board's PCB layout (clearances, trace widths, via sizes)
- **Netlist consistency:** KiCad's built-in netlist vs schematic check

### Cross-Board Verification

The board-to-board connector is the interface contract. Errors here cause shorts, open circuits, or swapped signals across boards.

#### 1. Shared Connector Module in Atopile

Since both boards live in the same atopile project (single `ato.yaml`, two build entries), sharing the connector interface is trivial — it's just another `.ato` file in the same `elec/src/` directory.

`board-connector.ato` defines a `BoardConnectorInterface` module with named signals for every connection crossing between boards. Both `control.ato` and `main.ato` import it with a simple same-directory import:

```ato
from "board-connector.ato" import BoardConnectorInterface
```

Each board instantiates the interface and wires its local signals to it:

```ato
# main.ato
from "board-connector.ato" import BoardConnectorInterface

module Main:
    connector = new BoardConnectorInterface
    mcu = new PGA2350_MCU
    dac = new DACOutputStage

    # Wire MCU GPIO to connector
    mcu.gp0 ~ connector.spi0_mosi
    mcu.gp23 ~ connector.spi0_miso
    mcu.gp2 ~ connector.spi0_sck
    mcu.gp1 ~ connector.cs_lcd
    mcu.gp24 ~ connector.cs_sd
    # ... etc
```

```ato
# control.ato
from "board-connector.ato" import BoardConnectorInterface

module Control:
    connector = new BoardConnectorInterface
    display = new DisplayConnector
    buttons = new ButtonScanner

    # Wire display to connector
    display.spi_mosi ~ connector.spi0_mosi
    display.spi_sck ~ connector.spi0_sck
    display.cs ~ connector.cs_lcd
    # ... etc
```

**What this guarantees:** Both boards use the same signal names from the same source file. Any rename or restructuring of the interface affects both boards simultaneously. Running `ato build` builds both boards in one step, and any breaking change to `board-connector.ato` surfaces immediately.

**What this does NOT guarantee:** Physical pin numbering. The `BoardConnectorInterface` defines logical signals, not physical header pins. Each board still has its own physical connector component (2×16 male header on main, 2×16 female socket on control) whose pin-to-signal mapping must match. This physical mapping is verified by the netlist comparison script (Strategy 2) and the pinout table above.

See `docs/research/pcb-stacking.md` section 8.1 for the full `BoardConnectorInterface` module definition and analysis of alternative sharing approaches (relative imports, local package dependency).

#### 2. Generated Validation Build (System-Level Check)

A third build entry (`system`) wires both boards together through the connector interface, giving atopile the full circuit for end-to-end constraint checking. The module is **auto-generated** from `board-connector.ato` to stay in sync automatically.

**Script:** `scripts/gen_validation.py` — parses `BoardConnectorInterface` signal names and emits `system.ato` that wires `control.connector.<sig> ~ main.connector.<sig>` for every signal.

**Build entry in ato.yaml:**

```yaml
builds:
  control:
    entry: elec/src/control.ato:Control
  main:
    entry: elec/src/main.ato:Main
  system:
    entry: elec/src/system.ato:System   # validation only, never fabricated
```

**Makefile integration:**

```makefile
hw-gen-validation:
	python hardware/boards/scripts/gen_validation.py

hw-build: hw-gen-validation
	cd hardware/boards && ato build
```

`system.ato` is a build artifact — either `.gitignore` it or check it in with a "do not edit" header. Adding/removing signals in `BoardConnectorInterface` automatically updates the validation build on next `make hw-build`.

**What this catches that per-board builds miss:**
- Voltage/current constraint inconsistencies across boards
- Signals wired to the wrong internal net on one board (constraint conflict visible when atopile sees both sides)
- Potentially unconnected signals (if atopile reports floating nets)

**What it does NOT catch:** Physical pin numbering mismatches — still needs the netlist comparison script (Strategy 3).

See `docs/research/pcb-stacking.md` Strategy 1b for the full generator script and detailed analysis.

#### 3. Pin-by-Pin Netlist Comparison Script

After building both boards, export netlists and run a script that:
1. Extracts every net connected to each connector pin on both boards
2. Compares net names across boards (pin 1 on control must match pin 1 on main)
3. Flags mismatches, unconnected pins, and power/ground errors

This can be a Python script that parses KiCad `.kicad_sch` or `.kicad_pcb` files.

#### 4. Unified System Schematic (Optional)

Create a top-level KiCad schematic that represents the full system:
- Control board as a hierarchical sheet with connector interface
- Main board as a hierarchical sheet with connector interface
- Board-to-board connectors shown explicitly
- Run ERC on this unified schematic to catch cross-board errors

This is extra work but provides the most complete electrical verification.

#### 5. Signal Integrity Checks

For critical signals crossing the board-to-board connector:
- **SPI buses (SPI0, SPI1):** Keep clock speed reasonable (≤20MHz through headers). Add 33Ω series termination if needed.
- **USB D+/D-:** 90Ω differential impedance. Consider a USB hub IC or buffer if signal quality degrades through headers.
- **Analog CV outputs:** 470Ω series resistors already in design. Verify no significant voltage drop at expected load impedance (typically 100kΩ input impedance on eurorack modules).

#### 6. Physical/Mechanical Verification

Done in FreeCAD/Fusion 360 after STEP export:
- Connector alignment between boards
- Component clearance within standoff gap
- Total depth within target
- No component collisions on facing board surfaces

---

## Migration Steps

### Phase 1: Project Restructure

1. Rename `hardware/pcb/` → `hardware/boards/`
2. Update `ato.yaml` to have three build entries (`control`, `main`, `system`) instead of one (`default`)
3. Create `board-connector.ato` in `elec/src/` with the `BoardConnectorInterface` module
4. Create `scripts/gen_validation.py` to auto-generate `system.ato` from the connector interface
5. Rename `requencer.ato` → keep as reference, create `control.ato` and `main.ato` as new top-level modules
6. Update `Makefile` targets for new folder name (`hw-build`, `hw-all`, etc.) and add `hw-gen-validation` pre-step
7. Update `scripts/export_layout.py` path references
8. Update `component-map.json` paths if needed

### Phase 2: Split Components

1. Create `control.ato` — imports and wires: buttons, LED drivers, jacks, encoders, display, USB, SD, MIDI, input protection, output buffers
2. Create `main.ato` — imports and wires: MCU, DACs, op-amps, level shifter, power supply
3. Both import `BoardConnectorInterface` from `board-connector.ato` and wire their signals to it
4. Each board adds its physical connector component (male header on main, female socket on control) and wires interface signals to header pins
5. Verify both boards compile: `ato build` (builds both entries)

### Phase 3: Place & Route

1. Place components on each board in KiCad (after atopile layout)
2. Route each board independently
3. Run per-board DRC
4. Run cross-board pin verification script

### Phase 4: 3D Verify

1. Export STEP from both boards
2. Import into FreeCAD, position at correct standoff distances
3. Check interference, total depth, connector alignment
4. Iterate on component placement if collisions found

---

## Open Questions

1. **Op-amp placement:** Keep on main board (simpler wiring, 16 analog pins cross connector) or move to control board (better analog quality, 4 SPI pins cross instead)? → Start with main board for prototype.

2. **Display mounting:** Pin header (simple) or FPC (thin)? → Pin header for prototype, FPC for production.

3. **USB-C accessibility:** Right-angle on control board edge, or panel-mount cable? → Right-angle for prototype.

4. **SD card accessibility:** Panel-accessible slot, or internal? → Internal for prototype (reduce faceplate complexity).

5. **LED driver IREF resistors:** These set LED current. Should they be on control board (with drivers) or main board? → Control board (next to the TLC5947 IREF pin).
