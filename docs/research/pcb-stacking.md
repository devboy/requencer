# PCB Stacking for Eurorack: Research & Design

Research on multi-board PCB stacking for the Requencer, a 36 HP 4-track eurorack sequencer.

## 1. Industry Context: The Eurorack Sandwich

The dominant approach in eurorack module design is a **two-board parallel stack** (sandwich):

- **Control board (top):** Mounts directly behind the faceplate. Carries jacks, pots, encoders, buttons, LEDs — everything the user touches. Held in place mechanically by panel-mount components (jack nuts, encoder nuts).
- **Main/circuit board (bottom):** Carries core electronics — MCU, DACs, ADCs, op-amps, power regulation. Connected to the control board via pin headers.

This split exists because panel component placement is dictated by ergonomics (where jacks and knobs go), while circuit layout is dictated by signal integrity and routing. Separating them lets each board be optimized independently.

### Mutable Instruments Reference

All Mutable Instruments modules (Plaits, Clouds, Stages, Rings, etc.) are open-source on [GitHub](https://github.com/pichenettes/eurorack) and use this two-board sandwich consistently:

- **11mm M3 standoffs** between control and main boards
- 4-layer PCBs on the main board for complex digital modules
- SMD components on both sides of the main board
- Signal mixing on the control board to reduce pin count (e.g., summing CV + pot before crossing to main board)
- Most modules use **≤20 pins** in the board-to-board header

### Three-Board Stacks

Three-board stacks are rare, used only for very complex or very narrow modules. They add depth and are generally avoided for skiff compatibility. Our design needs three boards (faceplate + control + main) due to component density.

---

## 2. Three-Board Architecture for the Requencer

| Board | Folder | Role | Key Components |
|-------|--------|------|----------------|
| **Faceplate** | `hardware/faceplate/` | Front panel (FR4 PCB) | Mounting holes, cutouts for jacks/buttons/encoders/display, silkscreen labels |
| **Control** | `hardware/control/` | Panel-mounted components + scanning ICs | 34× TC002-RGB buttons, 26× PJ398SM jacks, 2× PJ301M12 MIDI jacks, 2× EC11E encoders, USB-C, SD card, display connector, 5× 74HC165D shift registers, 5× TLC5947 LED drivers, 6N138 optocoupler, input protection circuits |
| **Main** | `hardware/main/` | Digital + analog core | PGA2350 MCU, 2× DAC8568, 5× OPA4172, 74HCT125D level shifter, power supply (regulators, protection), eurorack power header |

---

## 3. Vertical Mounting: How Components Sit Between Faceplate and Control Board

The gap between faceplate and control board is set by the tallest panel-mount component shaft. Each component falls into one of two categories:

- **Panel-mount:** Threads through faceplate, secured by nut on front. Body hangs behind faceplate, pins solder to control board.
- **PCB-mount:** Soldered to control board. Actuator/connector protrudes through a hole/cutout in the faceplate.

### 3.1 PJ398SM (Thonkiconn) — Panel-Mount Jack

The height-setting component for the entire stack.

| Parameter | Dimension |
|---|---|
| Total body height (PCB to top of bushing) | 10mm |
| Threaded bushing length (above panel) | 4.5mm |
| Body behind panel (bushing base to PCB) | ~5.5mm |
| Solder pin length below body | ~3.5mm |
| Panel hole | 6mm round |

The jack body sits on the panel surface. Pins extend ~3.5mm below, establishing a natural **~10mm PCB-to-panel distance**. This is the controlling dimension — all other components must work within this gap.

### 3.2 EC11E Rotary Encoder — Panel-Mount

| Parameter | Dimension |
|---|---|
| Threaded bushing diameter | M7 (7mm) |
| Threaded bushing length | ~4.5mm |
| Body depth (behind panel to PCB surface) | ~6.6mm |
| Panel hole | 7mm round |

**Height mismatch:** The encoder bushing-to-PCB distance is only ~6.6mm vs ~10mm for jacks. Solutions:
1. Add a nut/spacer underneath the panel so the encoder sits lower
2. Use a daughter board at a different height
3. Accept that the encoder will be recessed ~3.4mm below jack level (usually fine since the shaft extends well above the panel)

### 3.3 TC002-RGB Tactile Button — PCB-Mount

| Parameter | Dimension |
|---|---|
| Body footprint | 12 × 12mm |
| Body height above PCB | ~7.3mm (standard), ~17.6mm (with tall cap) |
| Button cap diameter | 4.0mm or 5.5mm (clear, for LED) |
| Panel hole | ~5-6mm round |

PCB-mount only — no panel thread. The button actuator and cap protrude through a hole in the faceplate. With a ~10mm PCB-to-panel gap, a 7.3mm body switch sits ~2.7mm below the panel surface. A taller cap or the Thonk "Low Profile LED Button" variant reaches through properly.

### 3.4 3.5" TFT Display (ST7796) — Custom Mount

This is the most complex mounting challenge. The display module is large (55.5 × 98mm carrier PCB) with a 73.44 × 48.96mm active area.

**Option A: Pin Header Mount (prototype-friendly)**

```
Faceplate (FR4)                  1.6mm    ─┐
  [cutout: ~75 × 51mm]                     │
Gap (set by jack shafts)         10.0mm    │  Faceplate-to-control gap
Control board PCB                1.6mm    ─┘
  [9-pin header to display]     8.5mm     ← display module sits here
Display carrier PCB              1.6mm
Display glass                    2.5mm    ← visible through faceplate cutout
```

- Display carrier PCB mounts on control board via 9-pin male/female header
- Faceplate has rectangular cutout (~50 × 75mm for active area, or ~56 × 85mm for full glass)
- Height adjusted by pin header length to align display glass with faceplate surface
- Display SPI signals (MOSI, SCK, CS, DC, RESET) stay on the control board — MCU's SPI0 lines route through the board-to-board connector from main board to control board
- **Pro:** Simple, easy to replace display, standard parts
- **Con:** Adds ~10-12mm to depth behind control board

**Option B: FPC/FFC Cable (production-quality)**

```
Faceplate (FR4)                  1.6mm    ─┐
  [cutout + bezel/pocket]                   │
Bare TFT glass in bezel          2.5mm     │  Display sits in/on faceplate
FPC ribbon cable                  ~5mm     │  Routes to control board
                                            │
Gap (set by jack shafts)         10.0mm    │
Control board PCB                1.6mm    ─┘
  [ZIF connector: ~1-2mm tall]
```

- Use a bare TFT panel with FPC tail (no carrier PCB)
- Mount display directly in faceplate cutout with adhesive, bezel, or pocket milled into the faceplate
- FPC cable routes to a ZIF connector on the control board
- ZIF connector height: ~1-2mm (vs 8.5mm for pin headers)
- **Pro:** Display sits flush in faceplate, minimal depth impact, very clean appearance
- **Con:** Requires matching ZIF connector to display FPC pitch (typically 0.5mm for ST7796 displays), limited mating cycles (50-100), harder to prototype, needs custom backlight driver
- **Specific parts:** Hirose FH12 series (0.5mm pitch ZIF), Molex Easy-On FFC/FPC connectors
- KiCad footprint library: `Connector_FFC-FPC` has ready-to-use 0.5mm pitch footprints

**Key optimization:** In both options, the display connects to the **control board**, not through the board-to-board connector to main. The MCU's SPI0 signals cross the board-to-board header once, then fan out on the control board to both the display and the SD card slot. This avoids routing high-speed SPI through additional connectors.

**Recommendation:** Start with Option A (pin header) for the prototype. Design the faceplate cutout to support either option. Migrate to FPC for production if desired.

### 3.5 USB-C Connector — PCB-Mount

| Parameter | Dimension |
|---|---|
| Right-angle receptacle height above PCB | 3.46mm |
| Body length (into PCB) | 9.17mm |
| Receptacle opening | 8.34 × 2.56mm |
| Panel cutout | ~9.5 × 3.5mm rectangular |

At 3.46mm above PCB, the USB-C opening sits well below the ~10mm PCB-to-panel gap. Options:
1. **Right-angle on control board edge:** USB plug inserts from the side/bottom of the module. Requires a slot in the faceplate edge.
2. **Vertical daughter board:** Small PCB perpendicular to control board, USB-C receptacle faces forward through a faceplate cutout.
3. **Panel-mount cable:** USB-C female bulkhead connector in faceplate, short cable to header on control board. Simplest but uses more panel space (~30mm diameter).

For the prototype, a **right-angle PCB-mount** with a faceplate slot is the most practical eurorack approach.

### 3.6 Micro SD Card Slot — PCB-Mount

| Parameter | Dimension |
|---|---|
| Connector height | 1.42-1.85mm |
| Footprint | ~11 × 11mm |
| Card insertion depth | ~12mm |
| Panel cutout (if edge-accessible) | ~13 × 2.5mm slot |

At ~1.4mm tall, the SD connector sits flat on the PCB. For panel access:
1. **Right-angle connector** on control board edge with a slot cutout in the faceplate
2. **FPC extender ribbon** from control board to a panel-mount SD slot
3. **Internal access only** (remove module from rack to insert/remove SD card) — simplest for prototype

### 3.7 PJ301M12 MIDI Jack — Panel-Mount

Same footprint as PJ398SM but TRS (stereo, 3 pins). Panel hole: 6mm. Same ~10mm PCB-to-panel distance.

---

## 4. Depth Budget

### Full Stack-Up (Target: ≤50mm)

```
Layer                                 Depth (mm)   Running Total
──────────────────────────────────    ──────────   ─────────────
Faceplate (FR4 PCB)                    1.6          1.6
Panel-to-control-board gap            10.0         11.6
  (set by PJ398SM shaft length)
Control board PCB                      1.6         13.2
Control-to-main standoff              11.0         24.2
  (M3 hex standoff, Mutable standard)
Main board PCB                         1.6         25.8
Tallest SMD component below main       2.0         27.8
Power header (shrouded 2×5)            8.5         36.3
IDC connector mated                    3.0         39.3
Ribbon cable bend                      5.0         44.3
```

**Total: ~44mm** — fits standard cases comfortably. Fits all cases except very shallow skiffs (25mm).

### Display Impact

With **Option A (pin header mount):** The display module hangs ~12mm below the control board. This eats into the 11mm standoff gap. The display carrier PCB may collide with components on the top side of the main board directly below.

**Mitigation:** Position the display over an area of the main board that has no tall components on its top face. Or increase the standoff to 15mm (adds 4mm to total depth → ~48mm).

With **Option B (FPC mount):** No depth impact below the control board. The display sits in the faceplate, and only a flat FPC cable runs down to the control board.

### Optimization Techniques

| Technique | Depth Saved |
|---|---|
| Right-angle power header (cable exits sideways) | ~5mm |
| 8mm standoffs instead of 11mm (if clearances allow) | 3mm |
| Power header on control board edge (faces sideways) | ~8mm |
| FPC display instead of pin header | ~10mm |
| Remove IDC connector, hard-wire ribbon cable | ~3mm |

### Eurorack Case Depth Reference

| Case Type | Available Depth | Fits Our Design? |
|---|---|---|
| Ultra-shallow skiff (Intellijel 4U) | 25-30mm | No |
| Skiff (Tip Top Mantis) | 32-35mm | Tight, needs optimization |
| Standard (Make Noise skiff) | 40-45mm | Yes |
| Deep (Doepfer A-100) | 50-65mm | Yes, plenty of room |

---

## 5. Board-to-Board Connector Design

### Connector Type

**2.54mm pitch pin headers** — the eurorack standard. Hand-solderable, 3A per pin, cheap, widely available. Male header on main board, female socket on control board (or vice versa).

### Signal Count: Control ↔ Main

| Signal Group | Pins | Direction | Notes |
|---|---|---|---|
| SPI0 (display + SD card) | 6 | main→control | MOSI, MISO, SCK, CS_LCD, CS_SD, DC |
| Display control | 2 | main→control | RESET, BACKLIGHT_PWM |
| Button shift registers (SPI-like) | 3 | main↔control | CLK (GP8), LATCH (GP9), DATA (GP10) |
| LED driver chain (SPI-like) | 4 | main→control | SIN (GP11), SCLK (GP12), XLAT (GP13), BLANK (GP14) |
| Encoder A | 3 | control→main | A (GP15), B (GP16), SW (GP17) |
| Encoder B | 3 | control→main | A (GP18), B (GP19), SW (GP20) |
| DAC CV outputs | 16 | main→control | Analog, 470Ω series resistors |
| CV inputs (after protection) | 4 | control→main | ADC inputs (GP40-43) |
| Clock/Reset I/O | 4 | control↔main | CLK_IN (GP26), RST_IN (GP27), CLK_OUT (GP28), RST_OUT (GP4) |
| MIDI UART | 2 | control↔main | TX (GP21), RX (GP22) |
| USB D+/D- | 2 | control→main | If USB-C is on control board |
| SD card detect | 1 | control→main | GP25 |
| Power rails | 6 | main→control | +12V, -12V, +5V, +3.3V, GND, GND |
| **Total** | **~56** | | |

### Connector Configuration Options

| Option | Connector | Pros | Cons |
|---|---|---|---|
| 2× 2×16 shrouded | 64 pins total | Standard, keyed, compact | Two connectors to align |
| 1× 2×30 shrouded | 60 pins total | Single connector | Large footprint |
| 2× 1×30 single-row | 60 pins total | Easy to solder, board edges | Not keyed, tall profile |
| 1× 2×20 + 1× 2×10 | 60 pins total | Separate digital/analog sections | Two connectors |

**Recommendation:** Two 2×16 shrouded headers — one for digital signals + power, one for analog (DAC outputs + CV inputs). The shroud prevents reverse insertion.

### Optimization: Move Op-Amps to Control Board

If the 5× OPA4172 quad op-amps move from the main board to the control board (closer to output jacks):
- **Eliminates 16 analog CV pins** from the connector (replaced by 4 SPI1 pins: MOSI, SCK, CS1, CS2)
- Reduces connector pin count from ~56 to ~44
- Improves analog signal quality (shorter traces to jacks, no header impedance on CV outputs)
- Requires routing SPI1 bus + level-shifted 5V logic across the connector instead
- Adds ~20 ICs to the control board (already has 10 ICs with shift registers + LED drivers)
- **Trade-off:** Simpler connector vs more complex control board routing

---

## 6. 3D Visualization and Verification Workflow

### Step-by-Step Process

1. **Build each board in atopile** → generates KiCad `.kicad_pcb` files
2. **Export STEP from KiCad** for each board: File → Export → STEP
3. **Import all STEP files into FreeCAD** (free, open-source) or Fusion 360
4. **Position boards** at correct standoff distances:
   - Faceplate at z = 0
   - Control board at z = 11.6mm (faceplate thickness + gap)
   - Main board at z = 24.2mm (control board + standoff)
5. **Add standoff/spacer 3D models** between boards (M3 × 11mm hex standoffs)
6. **Run interference detection** to check for collisions between components on facing board sides
7. **Verify total depth** fits target case (≤50mm from front of faceplate to back of power connector)

### Recommended Tools

| Tool | Use | Cost |
|---|---|---|
| **FreeCAD + KiCad StepUp** | Best free option. Bidirectional KiCad integration, interference checking, can push board outlines back to KiCad. | Free |
| **Fusion 360** | Better UI, import STEP, parametric modeling for enclosure/faceplate. | Free for hobbyists |
| **KiKit** | Multi-board panelization for manufacturing. | Free |

### Atopile → 3D Pipeline

Atopile doesn't have native multi-board assembly or 3D visualization. The pipeline is:

```
atopile project → ato build → KiCad .kicad_pcb → KiCad 3D viewer (single board)
                                                → File > Export > STEP
                                                → FreeCAD assembly (multi-board)
```

### Verification Checklist

1. **Rail clearance:** PCB height < 108mm (leave 1-2mm margin)
2. **Depth:** Total stack < 50mm (target), < 40mm (optimized)
3. **Power connector:** Shrouded header + mated IDC + cable bend < available depth behind main PCB
4. **Component interference:** No tall components on facing sides of the two boards within the standoff gap
5. **Display alignment:** Display center height matches faceplate cutout center height
6. **Connector alignment:** Board-to-board headers mate when boards are at correct standoff distance

---

## 7. Component Assignment: Full Table

Every component from the current design, assigned to a board.

### Control Board (`hardware/control/`)

| Component | Count | Type | Rationale |
|---|---|---|---|
| TC002-RGB buttons | 34 | PCB-mount tactile switch | User-facing, actuators poke through faceplate |
| PJ398SM jacks | 24 | Panel-mount 3.5mm mono | User-facing, thread through faceplate |
| PJ301M12 MIDI jacks | 2 | Panel-mount 3.5mm TRS | User-facing |
| EC11E encoders | 2 | Panel-mount rotary encoder | User-facing |
| 74HC165D shift registers | 5 | IC (SOIC-16) | Must be close to buttons (short traces to 34 button pins) |
| TLC5947 LED drivers | 5 | IC (TSSOP-32) | Must be close to button LEDs (short traces to 102 LED cathodes) |
| 6N138 optocoupler | 1 | DIP-8 | MIDI input — close to MIDI jack |
| B5819W (MIDI protection) | 1 | SOD-123 | Part of MIDI input circuit |
| InputProtection modules | 6 | Resistors + BAT54S + cap | Close to input jacks (clk_in, rst_in, cv_a-d) |
| 2N3904 output buffers | 2 | TO-92 or SOT-23 | Close to clock/reset output jacks |
| Display connector | 1 | 9-pin header or ZIF | Connects to display module/panel |
| 2N7002 backlight MOSFET | 1 | SOT-23 | Part of display circuit |
| USB-C receptacle | 1 | PCB-mount | User-facing, right-angle through faceplate slot |
| MicroSD slot | 1 | PCB-mount SMD | User-facing (if panel-accessible) or internal |
| PRTR5V0U2X ESD | 1 | SOT-363 | USB ESD protection — close to USB connector |
| Pull-up resistors (buttons) | 40 | 0402/0603 | Part of button scanning circuit |
| Pull-up resistors (encoders) | 6 | 0402/0603 | Part of encoder circuit |
| Debounce caps (encoders) | 6 | 0402/0603 | Part of encoder circuit |
| MIDI resistors | 5 | 0402/0603 | Part of MIDI circuit |
| Board-to-board connector | 1 | 2×16 female socket (×2) | Mates with main board headers |

### Main Board (`hardware/main/`)

| Component | Count | Type | Rationale |
|---|---|---|---|
| PGA2350 MCU module | 1 | Module (castellation) | Core processor, SPI master, ADC |
| DAC8568SPMR | 2 | TSSOP-16 | SPI1 peripherals — must be close to MCU |
| 74HCT125D level shifter | 1 | SOIC-14 | 3.3V→5V for DAC SPI1 bus |
| OPA4172ID quad op-amps | 5 | SOIC-14 | DAC output conditioning (or move to control board) |
| AZ1117-5.0 (5V reg) | 1 | SOT-223 | Power supply |
| AMS1117-3.3 (3.3V reg) | 1 | SOT-223 | Power supply |
| EurorackPowerHeader | 1 | 2×5 shrouded THT | 16-pin eurorack power |
| B5819W (power protection) | 2 | SOD-123 | Reverse polarity protection |
| B5819W (USB/Eurorack OR) | 2 | SOD-123 | Power source OR'ing to PGA2350 VB |
| BOOTSEL tactile switch | 1 | SMD tactile | Firmware update — internal access only |
| DAC output resistors | 16 | 0402/0603 (470Ω) | Protection for analog outputs |
| DAC feedback networks | ~28 | 0402/0603 (precision) | Gain/offset setting for op-amps |
| Reference divider resistors | 4 | 0402/0603 | Pitch and mod reference voltages |
| LED driver IREF resistors | 5 | 0402/0603 (2kΩ 1%) | Note: these could also go on control board with drivers |
| Bypass/decoupling caps | ~50 | 0402/0603 | Throughout all ICs |
| Board-to-board connector | 1 | 2×16 male header (×2) | Mates with control board sockets |

### Faceplate (`hardware/faceplate/`)

No electrical components. Mechanical only:
- Mounting holes (M3, 4 corners)
- Jack holes (6mm, 26 total)
- Encoder holes (7mm, 2 total)
- Button holes (~5-6mm, 34 total)
- Display cutout (~50 × 75mm or ~56 × 85mm)
- USB-C slot (~9.5 × 3.5mm)
- SD card slot (~13 × 2.5mm, if panel-accessible)
- Silkscreen labels

---

## 8. Multi-Board Electrical Verification

Per-board KiCad DRC (ERC + design rules) only verifies each board in isolation. It cannot detect cross-board errors like swapped connector pins, mismatched net names, or power rail conflicts. Additional verification is needed.

### The Problem

When two boards share a connector, errors at the interface are invisible to single-board DRC:
- **Pin swap:** Gate1 output on pin 15 of the main board, but pin 15 on the control board is routed to the Gate2 jack → wrong CV on wrong output
- **Power short:** +12V and -12V accidentally on adjacent pins with reversed connector → magic smoke
- **Missing connection:** A signal assigned to the connector on one board but left floating on the other
- **Impedance issues:** High-speed SPI signals degraded by long traces + header impedance, causing display glitches

### Strategy 1: Shared Connector Module in Atopile (Compile-Time Check)

Define the board-to-board connector pinout once in a shared `.ato` file. Both the control and main board projects import this same file, so they share a single source of truth for which signal connects to which pin.

#### How atopile imports work

atopile resolves imports in two ways:
1. **Relative to the source root** (`paths.src` in `ato.yaml`) — e.g., `from "power.ato" import PowerSupply`
2. **Relative file paths** — e.g., `from "../../parts/EC11E/EC11E.ato" import EC11E` (already used in the Requencer project)
3. **Installed packages** — via `ato add` (registry, git, or `file://./local/path`)

For sharing between two local projects, there are two approaches:

#### Approach A: Relative Import (simplest, no package overhead)

Place the shared connector definition at a path accessible to both projects via relative imports:

```
hardware/
  shared/
    board-connector.ato       # Shared pinout definition
  control/
    ato.yaml                  # paths.src: elec/src
    elec/src/
      control.ato             # from "../../../shared/board-connector.ato" import BoardConnectorControl
  main/
    ato.yaml                  # paths.src: elec/src
    elec/src/
      main.ato                # from "../../../shared/board-connector.ato" import BoardConnectorMain
```

The shared file defines the connector interface — pin-to-signal mapping — and each board imports its side. Example:

```ato
# hardware/shared/board-connector.ato
#
# Shared board-to-board connector pinout.
# Both control/ and main/ import from this file.
# Changing a pin assignment here affects both boards.

import ElectricSignal
import Electrical
import ElectricPower

# Interface for the connector — defines all signals that cross between boards.
# Each board instantiates this and wires its local signals to it.

module BoardConnectorInterface:
    # Power rails
    power_12v = new ElectricPower
    power_neg12v = new Electrical
    power_5v = new ElectricPower
    power_3v3 = new ElectricPower

    # SPI0: display + SD card
    spi0_mosi = new ElectricSignal
    spi0_miso = new ElectricSignal
    spi0_sck = new ElectricSignal
    cs_lcd = new ElectricSignal
    cs_sd = new ElectricSignal
    lcd_dc = new ElectricSignal
    lcd_reset = new ElectricSignal
    lcd_bl_pwm = new ElectricSignal
    sd_cd = new ElectricSignal

    # Button shift registers
    sr_clk = new ElectricSignal
    sr_latch = new ElectricSignal
    sr_data = new ElectricSignal

    # LED drivers
    led_sin = new ElectricSignal
    led_sclk = new ElectricSignal
    led_xlat = new ElectricSignal
    led_blank = new ElectricSignal

    # Encoders
    enc_a_a = new ElectricSignal
    enc_a_b = new ElectricSignal
    enc_a_sw = new ElectricSignal
    enc_b_a = new ElectricSignal
    enc_b_b = new ElectricSignal
    enc_b_sw = new ElectricSignal

    # Analog: DAC outputs (16 CV lines)
    gate1 = new ElectricSignal
    gate2 = new ElectricSignal
    gate3 = new ElectricSignal
    gate4 = new ElectricSignal
    pitch1 = new ElectricSignal
    pitch2 = new ElectricSignal
    pitch3 = new ElectricSignal
    pitch4 = new ElectricSignal
    vel1 = new ElectricSignal
    vel2 = new ElectricSignal
    vel3 = new ElectricSignal
    vel4 = new ElectricSignal
    mod1 = new ElectricSignal
    mod2 = new ElectricSignal
    mod3 = new ElectricSignal
    mod4 = new ElectricSignal

    # Analog: CV inputs (after protection)
    cv_a = new ElectricSignal
    cv_b = new ElectricSignal
    cv_c = new ElectricSignal
    cv_d = new ElectricSignal

    # Clock/Reset I/O
    clk_in = new ElectricSignal
    rst_in = new ElectricSignal
    clk_out = new ElectricSignal
    rst_out = new ElectricSignal

    # MIDI
    midi_tx = new ElectricSignal
    midi_rx = new ElectricSignal

    # USB
    usb_dp = new ElectricSignal
    usb_dm = new ElectricSignal
```

Each board imports this module and wires its local signals to the interface:

```ato
# hardware/main/elec/src/main.ato
from "../../../shared/board-connector.ato" import BoardConnectorInterface

module Main:
    connector = new BoardConnectorInterface

    # Wire MCU GPIO to connector interface
    mcu.gp0 ~ connector.spi0_mosi
    mcu.gp23 ~ connector.spi0_miso
    mcu.gp2 ~ connector.spi0_sck
    mcu.gp1 ~ connector.cs_lcd
    # ... etc
```

```ato
# hardware/control/elec/src/control.ato
from "../../../shared/board-connector.ato" import BoardConnectorInterface

module Control:
    connector = new BoardConnectorInterface

    # Wire display SPI to connector interface
    display.spi_mosi ~ connector.spi0_mosi
    display.spi_miso ~ connector.spi0_miso
    display.spi_sck ~ connector.spi0_sck
    display.cs ~ connector.cs_lcd
    # ... etc
```

**How this catches errors:** Both boards wire to the same named signals. If the main board wires `mcu.gp1` to `connector.cs_lcd` but the control board wires `display.cs` to `connector.cs_sd` (wrong pin), the mismatch is visible in code review because both files reference the same interface. This doesn't produce a compile error per se (each board compiles independently), but it makes the intent explicit and reviewable.

**Limitation:** Since each atopile project builds independently, the compiler cannot cross-check that `main/connector.cs_lcd` and `control/connector.cs_lcd` actually land on the same physical header pin. The shared module ensures consistent *naming*, but physical pin mapping still needs a separate check (see Strategy 2).

#### Approach B: Local Package Dependency (more formal)

Use atopile's package manager to declare the shared module as a local dependency:

```bash
# From hardware/control/:
ato add file://../shared

# From hardware/main/:
ato add file://../shared
```

This adds the shared module to each project's `ato.yaml` dependencies and installs it into `.ato/modules/`. The import then uses the package name instead of a relative path:

```ato
from "board-connector.ato" import BoardConnectorInterface
```

**Pro:** Cleaner imports, follows atopile conventions, dependency is tracked in `ato.yaml`.
**Con:** Requires the shared directory to have its own `ato.yaml` (making it a proper atopile package). Each project gets a copy in `.ato/modules/` — changes to `shared/` require re-running `ato sync` in each project.

#### Approach C: Single Project with Multiple Builds (tightest coupling)

atopile supports **multiple named build entries** in a single `ato.yaml`. Instead of separate projects for control and main boards, both live in one project:

```yaml
# hardware/boards/ato.yaml
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

```
hardware/
  boards/
    ato.yaml                    # Two build entries
    elec/src/
      board-connector.ato       # Shared — no import path gymnastics needed
      control.ato               # from "board-connector.ato" import BoardConnectorInterface
      main.ato                  # from "board-connector.ato" import BoardConnectorInterface
      button-scan.ato           # Used by control.ato
      led-driver.ato            # Used by control.ato
      mcu.ato                   # Used by main.ato
      dac-output.ato            # Used by main.ato
      power.ato                 # Used by main.ato
      # ... all other .ato files
    elec/layout/
      # KiCad layout files — one per build
```

Running `ato build` produces **two separate KiCad projects** — one for each build entry. Both builds share the same source tree, so imports are just `from "board-connector.ato" import BoardConnectorInterface` — no relative path escaping needed.

**Pro:** Simplest imports, no relative path fragility, single `ato build` command builds both boards, shared source files are directly available, and both boards are versioned together.
**Con:** Less separation of concerns — all source files in one directory. KiCad layout files for both boards share one `elec/layout/` directory (may need subdirectories). Harder to hand off one board to a different designer.

#### Recommendation

**Approach C (single project, multiple builds)** is the strongest option for this project. Both boards are tightly coupled — the connector interface, component assignments, and pin mappings all need to stay in sync. Having them in one project:
- Eliminates import path issues entirely
- Ensures `ato build` always builds both boards together
- Makes shared modules (connector interface, common parts) trivially importable
- Matches atopile's intended multi-build workflow

If the boards later need to be developed independently (different designers, different release cycles), split into separate projects using Approach A.

#### What the shared module does NOT do

- It does **not** define physical connector footprints. Each board has its own connector component (male header on main, female socket on control) with pins wired to the interface signals.
- It does **not** prevent each board from building in isolation. Each board compiles independently — there is no cross-board compilation step in atopile.
- It does **not** verify that the physical pin numbering matches. Pin 1 of the male header must connect to pin 1 of the female socket — this is a physical alignment constraint verified by the netlist comparison script (Strategy 2) or by visual inspection of the pinout table.

### Strategy 2: Netlist Comparison Script (Post-Build Check)

After building both boards, export KiCad netlists and run a Python script that:
1. Parses each board's `.kicad_sch` or `.kicad_pcb`
2. Finds all nets connected to connector header pins
3. Compares pin-by-pin across boards
4. Reports: mismatches, unconnected pins, power/ground errors

This catches errors that the shared module approach might miss (e.g., a pin correctly named but accidentally connected to the wrong trace during layout).

### Strategy 3: Unified System Schematic (Full Verification)

Create a top-level KiCad schematic that represents the complete system:
- Each board as a hierarchical sheet
- Board-to-board connectors shown as explicit symbol pairs
- Full-system ERC catches cross-board errors

Most thorough but requires maintaining a third schematic. Worth doing before ordering PCBs.

### Strategy 4: Signal Integrity Verification

For signals crossing the board-to-board connector:

| Signal Type | Concern | Mitigation |
|---|---|---|
| SPI0 (display, SD) | Clock integrity through headers at 20+ MHz | Add 33Ω series termination, keep ≤20MHz, or reduce speed |
| SPI1 (DACs, level-shifted) | 5V logic through headers | Already has 74HCT125D buffer |
| USB D+/D- | 90Ω differential impedance | Route as diff pair, verify impedance on both boards, may need series resistors |
| Analog CV outputs | Voltage drop, noise pickup | 470Ω series resistors already in design. Verify at expected load impedance (100kΩ+) |
| Power rails | Current capacity, voltage drop | Multiple GND pins, doubled power pins, verify total current per rail |

### Recommended Verification Flow

1. **Design time:** Shared connector module in atopile (catches pin assignment errors at build)
2. **Post-layout:** Netlist comparison script (catches routing errors)
3. **Pre-order:** Unified system schematic + ERC (catches everything)
4. **Post-manufacture:** Continuity test with multimeter on first assembled unit (pin 1 to pin 1, etc.)

---

## 9. Sources

- [Mutable Instruments GitHub (pichenettes/eurorack)](https://github.com/pichenettes/eurorack) — open-source two-board sandwich designs
- [Dual PCB Stack Design (ModWiggler)](https://www.modwiggler.com/forum/viewtopic.php?p=4215995)
- [Max PCB Height for Eurorack (ModWiggler)](https://modwiggler.com/forum/viewtopic.php?t=203897)
- [Define "Skiff Friendly" (ModWiggler)](https://modwiggler.com/forum/viewtopic.php?t=115249)
- [Eurorack Module Depths (ModWiggler)](https://modwiggler.com/forum/viewtopic.php?t=154441)
- [Eurorack Panel Components (Synth DIY Wiki)](https://sdiy.info/wiki/Eurorack_panel_components)
- [Eurorack Dimensions (Exploding Shed)](https://www.exploding-shed.com/synth-diy-guides/standards-of-eurorack/eurorack-dimensions/)
- [TOILmodular Plaits Clone](https://github.com/TOILmodular/Plaits) — detailed two-board build
- [11mm Standoffs for MI modules (Oddvolt)](https://oddvolt.com/products/hex-11mm-standoff-10pcs)
- [OLED PCB Bezel Mount (Bezels and Displays)](https://www.bezelsanddisplays.co.uk/how-to-mount-an-oled-directly-onto-a-pcb/)
- [KiCad StepUp Workbench (GitHub)](https://github.com/easyw/kicadStepUpMod)
- [KiCad Board Stacking STEP (KiCad Forum)](https://forum.kicad.info/t/use-kicad-pcb-file-as-3d-model-board-stacking/55869)
- [Multiboard Layout (HYPERGLITCH)](https://hyperglitch.com/articles/kicad-multiboard-layout)
- [Hirose FH12 FPC connectors](https://www.hirose.com/product/series/FH12)
- [Molex FFC/FPC connectors](https://www.molex.com/en-us/products/connectors/ffc-fpc-connectors)
- [Eurorack Power (Division 6)](https://division-6.com/learn/eurorack-power/)
- [Eurorack Power Connectors (David Haillant)](https://www.davidhaillant.com/eurorack-power-connectors-and-ribbon-cables/)
- [Atopile Project Structure](https://docs.atopile.io/atopile/essentials/5-project-structure)
