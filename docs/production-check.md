# Pre-Production PCB Validation Checklist

Run this checklist before ordering PCBs or sourcing parts. Each section specifies what to read, what to check, and what constitutes PASS/WARN/FAIL.

## Output Format

For each section, produce a structured verdict:

```
## Section N: Title
**Verdict: PASS / WARN / FAIL**

| Check | Status | Detail |
|-------|--------|--------|
| ... | PASS/WARN/FAIL | ... |

**Issues found:**
- [Severity] Description — file:line — suggested fix
```

---

## Automated Checks (run first, do not duplicate)

Run these before starting the manual review. Record results for reference.

```bash
make hw-build          # Preflight + cross-board wiring (system build)
make hw-place          # Placement validation (bounds, overlaps, clearances)
make hw-route          # Routing + DRC (unrouted nets, design rule violations)
make check-parts BOARD_COUNT=5   # Parts availability + pricing
make test-hw           # Unit tests (BOM parser, placement, collision)
cargo test             # Firmware tests (DAC driver, button mapping, MIDI)
```

If any automated check fails, fix before proceeding. Record the output of each for the report.

---

## Section 1: RP2350 GPIO Function-Select Compliance

**Why:** The RP2350 has fixed hardware function-select — SPI and UART peripherals can only be assigned to specific GPIOs. This was the #1 class of errors in the 2026-03-10 report (C1-C4).

### Files to read
- `hardware/boards/elec/src/mcu.ato` — all `pga.GPxx ~ signal_name` lines
- `crates/firmware/src/main.rs` — pin assignments (search for `PIN_`)
- `crates/firmware/src/pins.rs` — type aliases for pins
- RP2350 datasheet GPIO function table (Section 1.4.3, Table 2)

### What to check

**SPI0 pins (display + SD card):**

| Function | Valid GPIOs (RP2350) | Check mcu.ato assigns to | Check firmware uses |
|----------|---------------------|--------------------------|---------------------|
| SPI0_RX (MISO) | GP0, GP4, GP16, GP20 | one of these | same pin |
| SPI0_TX (MOSI) | GP3, GP7, GP19, GP23 | one of these | same pin |
| SPI0_SCK | GP2, GP6, GP18, GP22 | one of these | same pin |
| SPI0_CSn | GP1, GP5, GP17, GP21 | one of these | same pin |

**SPI1 pins (DAC):**

| Function | Valid GPIOs (RP2350) | Check mcu.ato assigns to | Check firmware uses |
|----------|---------------------|--------------------------|---------------------|
| SPI1_RX (MISO) | GP8, GP12, GP24, GP28 | one of these (if used) | same pin |
| SPI1_TX (MOSI) | GP11, GP15, GP27, GP31 | one of these | same pin |
| SPI1_SCK | GP10, GP14, GP26, GP30 | one of these | same pin |
| SPI1_CSn | GP9, GP13, GP25, GP29 | one of these (if used) | same pin |

**UART1 pins (MIDI):**

| Function | Valid GPIOs (RP2350) | Check mcu.ato assigns to | Check firmware uses |
|----------|---------------------|--------------------------|---------------------|
| UART1_TX | GP4, GP8, GP12, GP16, GP20, GP24 | one of these | same pin |
| UART1_RX | GP5, GP9, GP13, GP17, GP21, GP25 | one of these | same pin |

**ADC pins (CV inputs):**

| Function | Valid GPIOs (RP2350) | Check mcu.ato assigns to |
|----------|---------------------|--------------------------|
| ADC4-7 | GP40-GP43 only | cv_a through cv_d |

### Pass criteria
- **PASS:** Every peripheral pin in mcu.ato is on a valid GPIO for that function AND matches firmware
- **WARN:** pins.rs type aliases don't match main.rs (cosmetic but confusing)
- **FAIL:** Any peripheral pin assigned to a GPIO that doesn't support that function, or mcu.ato/firmware mismatch

---

## Section 2: Board-to-Board Connector Pin Matching

**Why:** A single swapped pin on the 2x16 connector means rework or dead board.

### Files to read
- `hardware/boards/elec/src/board-connector.ato` — both `BoardConnectorInterface` and `BoardConnectorSocket`
- `hardware/boards/parts/ShroudedHeader2x16/ShroudedHeader2x16.ato` — header pinout
- `hardware/boards/parts/ShroudedSocket2x16/ShroudedSocket2x16.ato` — socket pinout

### What to check

1. **Pin-for-pin signal matching:** For each pin position (1-32) on both header_a and header_b, verify that the signal name on the Interface (main board male) matches the signal name on the Socket (control board female). Build a comparison table:

   | Pin | Header A Interface (main) | Header A Socket (control) | Match? |
   |-----|--------------------------|--------------------------|--------|
   | 1   | ...                      | ...                      |        |

2. **Physical orientation:** When the main board is below the control board:
   - Male headers point UP from main board
   - Female sockets point DOWN from control board
   - Pin 1 orientation must be consistent (keyed by shroud)
   - Verify the shroud key slot faces the same direction on both boards

3. **Power pin placement:** Verify power pins (GND, 3.3V, 5V, +12V, -12V) are doubled for current capacity and placed at connector edges (not in the middle where signal integrity matters more).

4. **No signal-to-power shorts:** Verify no signal name on one side maps to a power pin on the other side.

### Pass criteria
- **PASS:** All pins match 1:1 between Interface and Socket, orientation is correct
- **FAIL:** Any signal mismatch between corresponding pins, or power pin in wrong position

---

## Section 3: Signal Path Integrity

**Why:** Catches wiring errors, wrong gain, missing protection, floating pins.

### Files to read
- `hardware/boards/elec/src/main.ato` — main board top-level
- `hardware/boards/elec/src/control.ato` — control board top-level
- `hardware/boards/elec/src/mcu.ato` — MCU connections
- `hardware/boards/elec/src/dac-output.ato` — DAC + op-amp + level shifter
- `hardware/boards/elec/src/io-jacks.ato` — jack connections
- `hardware/boards/elec/src/led-driver.ato` — LED driver chain
- `hardware/boards/elec/src/midi.ato` — MIDI I/O circuits
- `hardware/boards/elec/src/input-protection.ato` — CV/clock/reset input protection
- `hardware/boards/elec/src/power.ato` — power supply
- `hardware/boards/elec/src/display.ato` — display connection
- Relevant part .ato files in `hardware/boards/parts/`

### Trace each path end-to-end

For each functional block below, trace the complete signal path from source to destination. Verify correct component values, topology, and power rails at each stage.

#### 3a. Pitch CV (4 channels)
- DAC OUT4-7 → op-amp (gain=2, offset from precision reference) → 470Ω protection → jack tip
- Check: gain resistors (10k/10k for gain=2), offset resistors (15k/10k for -2V offset), 0.1% tolerance on precision path
- Check: op-amp powered from ±12V (not 5V — needs negative swing)
- Check: reference buffer present (no loading on precision divider)
- Expected range: -2V to +8V (10 octaves, 1V/oct)

#### 3b. Gate CV (4 channels)
- DAC OUT0-3 → op-amp (unity gain buffer) → 470Ω protection → jack tip
- Check: unity gain (feedback direct from output to inverting input)
- Expected range: 0-5V

#### 3c. Velocity CV (4 channels)
- DAC OUT → op-amp (gain ≈ 1.6) → protection → jack tip
- Expected range: 0-8V

#### 3d. Mod CV (4 channels)
- DAC OUT → op-amp (inverting gain=2, offset=+5V) → protection → jack tip
- Check: needs negative output, op-amp on ±12V
- Expected range: -5V to +5V

#### 3e. Button scan
- GPIO → 74HC165 chain: CLK (shared), LATCH (shared), DATA (series QH→SER)
- Check: first SR's SER tied to GND, last SR's QH goes to MCU
- Check: CLK_INH tied LOW on all
- Check: pull-ups on all button inputs (via SIP resistor networks)
- Check: unused inputs tied to VCC (no floating)

#### 3f. LED drive
- MCU GPIO → TLC5947 chain: SIN, SCLK, XLAT, BLANK (shared)
- Check: SIN daisy-chains through SOUT→SIN
- Check: BLANK active-high (HIGH = outputs off)
- Check: VCC from 3.3V, LED anodes from 5V
- Check: IREF resistor value → expected max current per channel

#### 3g. MIDI
- **OUT:** MCU UART TX → 220Ω → TRS jack (Tip=data, Ring=VCC per Type A)
- **IN:** TRS jack → 220Ω → optocoupler LED → MCU UART RX
- Check: optocoupler LED polarity (anode toward Ring/VCC source, cathode toward Tip/data)
- Check: protection diode across opto LED (anti-parallel, correct polarity)
- Check: opto output pull-up to 3.3V

#### 3h. Clock/Reset I/O
- **Input:** jack tip → board connector → voltage divider (22k/10k) → BAT54S clamp → 100nF filter → MCU GPIO
- **Output:** MCU GPIO → 1kΩ base resistor → NPN (2N3904) → 1kΩ collector to 5V → jack tip
- Check: divider ratio maps 10V input to < 3.3V
- Check: NPN inverts logic (firmware must account for this)

#### 3i. Display
- MCU SPI0 (MOSI, SCK, CS) + DC + BL + RST → FPC connector
- Check: RST has RC delay circuit (10kΩ × 100nF ≥ 10µs)
- Check: backlight via N-channel MOSFET with gate pull-down

#### 3j. SD card
- MCU SPI0 (MOSI, MISO, SCK) + CS + CD → SD connector
- Check: MISO actually connected (SPI0_RX pin)
- Check: card detect signal routed to MCU

#### 3k. USB-C
- MCU USB DP/DM → 27Ω series → USB-C connector
- Check: 5.1kΩ CC1/CC2 pull-downs present
- Check: ESD protection (PRTR5V0U2X or similar) on data lines
- Check: shield → GND

#### 3l. Encoders
- Encoder A/B/SW → pull-ups (10kΩ to 3.3V) + debounce caps (100nF) → board connector → MCU GPIO
- Check: RC time constant appropriate (10kΩ × 100nF = 1ms)
- Check: active-low push (connects to GND)

#### 3m. CV inputs (4 channels)
- Jack tip → board connector → input protection (22k/10k divider + BAT54S clamp + 100nF) → MCU ADC (GP40-43)
- Check: divider maps ±10V eurorack to 0-3.3V ADC range
- Check: clamp diodes to GND and 3.3V

### Pass criteria
- **PASS:** All signal paths trace correctly end-to-end with correct component values
- **WARN:** Minor issues (e.g., debounce on wrong board, unused MISO floating)
- **FAIL:** Any broken signal path, wrong polarity, missing protection, wrong gain/offset, floating critical pin

---

## Section 4: Power Supply Validation

**Why:** The 2026-03-10 report found the 5V LDO fed from 12V causing thermal overload (C6).

### Files to read
- `hardware/boards/elec/src/power.ato` — regulators, protection diodes
- `hardware/boards/elec/src/main.ato` — power rail connections
- `hardware/boards/elec/src/control.ato` — power distribution on control board
- Regulator datasheets for thermal specs

### What to check

#### 4a. Rail connectivity
For each power rail in the design, verify it reaches every IC that needs it:

| Rail | Source | Check connected to |
|------|--------|--------------------|

Fill in from the schematic. For each rail, list every IC power pin that should be connected. Cross-reference the BOM — every IC's supply pin(s) must trace back to the correct rail through the netlist.

#### 4b. Regulator thermal budget

For each regulator, calculate:
- Input voltage × dropout = power dissipation
- Package thermal resistance × dissipation = junction temperature rise
- Junction temp = ambient (40°C for eurorack) + rise

| Regulator | Vin | Vout | Max load (mA) | Dissipation (W) | Package | Max Tj | Verdict |
|-----------|-----|------|---------------|-----------------|---------|--------|---------|
| 5V reg    | ... | 5V   | ...           | ...             | ...     | ...    |         |
| 3.3V reg  | ... | 3.3V | ...           | ...             | ...     | ...    |         |

**FAIL if:** Junction temperature > rated max at worst-case load and 40°C ambient.

#### 4c. Bypass capacitors
For every IC in the BOM, verify presence of bypass caps per its datasheet:
- 100nF ceramic close to each power pin (HF decoupling)
- 10µF bulk where needed (MCU, DACs, power entry points)
- Special decoupling where datasheet specifies (e.g., VREF pins, analog supply pins)

Walk the BOM and check each IC — MCU, DACs, LED drivers, shift registers, op-amps, etc. Pay extra attention to:
- ICs with multiple power pins (each needs its own cap)
- Analog supply pins (often need both 100nF + bulk)
- Reference voltage pins (specific cap values/types per datasheet)

#### 4d. Current budget
Sum current per rail and compare to source capacity:

| Rail | Consumers | Total (mA) | Source capacity (mA) | Margin |
|------|-----------|------------|---------------------|--------|

Fill in one row per power rail in the design. Sum all consumers from the BOM (use datasheet typical/max current figures). Compare against source capacity (eurorack bus spec or regulator rating).

#### 4e. Cross-board supply isolation
- Check for bulk capacitors (≥10µF) on high-current switching rails (e.g., LED supply) on each board
- Verify high-current switching loads don't share decoupling with precision analog supply

### Pass criteria
- **PASS:** All rails connected, thermal budget OK (Tj < 100°C at 40°C ambient), all ICs decoupled, current budget has >20% margin
- **WARN:** Thermal budget marginal (100-120°C), missing bulk caps on non-critical rails
- **FAIL:** Thermal overload (Tj > max rated), missing bypass on MCU/DAC/ADC, current budget exceeded

---

## Section 5: Component-Purpose Fitness

**Why:** Catches "connected but not usable" errors — components that are wired into the schematic but missing critical connections for their intended function.

### Files to read
- All `.ato` source files under `hardware/boards/elec/src/`
- Part definitions under `hardware/boards/parts/`

### What to check

Walk through every component in the BOM and verify it can actually perform its intended function. Use the categories below as a guide — the specific components will come from the current schematic.

#### Connectors (USB, SD, MIDI, power headers)
- All functional pins connected (not just power)? e.g., USB needs D+/D-, SD needs MISO
- Required pull-ups/pull-downs present? e.g., USB-C CC lines, SD card detect
- ESD protection on external-facing data lines?

#### DACs
- All output channels wired to their intended loads?
- VREF decoupled per datasheet? Internal/external ref configured correctly?
- Control pins (LDAC, CLR, etc.) tied to defined states — not floating?
- Digital IO voltage matches MCU logic level?

#### Op-amps
- All channels in each package used, or unused channels configured as followers (not floating)?
- Supply rails correct for required output swing?

#### Shift registers / daisy-chain ICs
- Chain order correct (data out → data in of next)?
- First chip's serial input tied to defined level?
- Unused parallel inputs tied to VCC or GND?
- Control/inhibit pins in correct state for normal operation?

#### LED drivers
- Current-set resistor present and value matches LED spec?
- Daisy-chain order correct?
- Blank/enable pin has defined boot state (pull-up or pull-down)?

#### Optocouplers
- LED polarity correct (anode/cathode orientation)?
- Output has pull-up resistor?
- Protection diode across LED input?

#### Protection components (clamp diodes, TVS, fuses)
- Connected between signal and both protection rails (GND and VCC)?
- Correct polarity?

#### Transistor switches
- Base/gate resistor present?
- Collector/drain load resistor or connection correct?

#### Power entry
- Reverse-polarity protection on all external supply inputs?

### Pass criteria
- **PASS:** All components connected for intended purpose, no floating pins on active components
- **WARN:** Minor: non-critical feature incomplete (e.g., USB power-only without data during dev)
- **FAIL:** Any component missing critical connections that prevent it from functioning

---

## Section 6: Multi-Button / Simultaneous Input

**Why:** User needs hold-combos (e.g., shift+step) for the UI.

### Files to read
- `hardware/boards/elec/src/led-driver.ato` (shift register chain section)
- `hardware/boards/parts/SN74HC165D/` — part definition
- `crates/firmware/src/main.rs` — button scanning code (search for `buttons`, `shift_register`, `scan`)
- Button wiring in `control.ato`

### What to check

1. **Wiring topology:** Are buttons wired as direct inputs to shift registers (one button per SR input), or in a matrix?
   - Direct wiring: no ghosting possible, any combination works → PASS
   - Matrix wiring: need anti-ghosting diodes on every button → check diodes present

2. **Shift register chain integrity:** 5× 74HC165 = 40 bits. Verify all 40 button positions are accounted for in the firmware bit-to-event mapping.

3. **Scan rate:** Firmware should scan at ≥100 Hz for responsive feel, ≥200 Hz for hold-combo detection. Check the scan interval in firmware.

4. **Pull-ups:** Every button input needs a pull-up (SIP resistor network or discrete). Verify count matches button count.

### Pass criteria
- **PASS:** Direct wiring with pull-ups on all inputs, scan rate ≥200 Hz, all 40 bits mapped
- **WARN:** Scan rate 100-200 Hz (functional but slightly laggy for combos)
- **FAIL:** Matrix wiring without anti-ghosting diodes, floating button inputs, broken SR chain

---

## Section 7: Routing Quality Review

**Why:** DRC passes don't catch analog-digital crosstalk or thermal issues.

### Files to read
- `hardware/boards/elec/layout/control/control.kicad_pcb` — control board layout
- `hardware/boards/elec/layout/main/main.kicad_pcb` — main board layout
- `hardware/boards/board-config.json` — netclass assignments and DRC settings
- `hardware/boards/design-rules.json` — trace width and clearance rules
- Last routing log output (from `make hw-route`)

### What to check

1. **DRC results:** Any violations beyond whitelisted items in board-config.json?
   - Run: `make hw-route` and check DRC output
   - Any unrouted nets = **FAIL**

2. **Analog-digital separation:**
   - Pitch CV traces (DAC → op-amp → jack) should not run parallel to:
     - SPI clock lines (high-frequency switching)
     - LED data lines (TLC5947 SIN/SCLK)
     - Button scan clock
   - Minimum 0.5mm gap between analog and digital traces, or ground guard trace between them

3. **Ground pour connectivity:**
   - No isolated copper islands (disconnected from main ground)
   - Adequate ground pour on both sides of both boards
   - Ground stitching vias present (connects top and bottom ground planes)

4. **Trace widths match netclass:**

   | Netclass | Min width (mm) | Check |
   |----------|---------------|-------|
   | Power | 0.3 | +12V, -12V, +5V, +3.3V, GND |
   | Analog | 0.3 | DAC outputs, op-amp I/O, CV paths |
   | Default | 0.2 | Digital signals |

5. **Thermal relief:** Power pads connected to ground pour with thermal relief (not solid connection) to allow hand soldering of THT components.

### Pass criteria
- **PASS:** Zero DRC violations, no analog-digital parallel runs, connected ground pours, correct trace widths
- **WARN:** Minor: analog trace near digital but with ground between them, cosmetic DRC warnings
- **FAIL:** Unrouted nets, analog traces parallel to SPI clock, isolated ground islands, power traces undersized

---

## Section 8: Firmware-Hardware Pin Compatibility

**Why:** Firmware compiles but won't work if pins don't match the physical PCB.

### Files to read
- `crates/firmware/src/main.rs` — all pin assignments
- `crates/firmware/src/pins.rs` — type aliases
- `crates/firmware/src/dac.rs` — SPI peripheral usage
- `hardware/boards/elec/src/mcu.ato` — physical pin assignments

### What to check

Build a complete comparison table:

| Signal | mcu.ato GPIO | main.rs PIN | Match? | Special requirement | Met? |
|--------|-------------|-------------|--------|---------------------|------|
| SPI0 MOSI | GPx | PIN_x | | SPI0_TX capable | |
| SPI0 MISO | GPx | PIN_x | | SPI0_RX capable | |
| SPI0 SCK | GPx | PIN_x | | SPI0_SCK capable | |
| LCD CS | GPx | PIN_x | | SPI0_CSn capable | |
| LCD DC | GPx | PIN_x | | Any GPIO | |
| LCD BL | GPx | PIN_x | | PWM capable (nice to have) | |
| SPI1 MOSI | GPx | PIN_x | | SPI1_TX capable | |
| SPI1 SCK | GPx | PIN_x | | SPI1_SCK capable | |
| DAC1 CS | GPx | PIN_x | | Any GPIO | |
| DAC2 CS | GPx | PIN_x | | Any GPIO | |
| SD CS | GPx | PIN_x | | Any GPIO | |
| SD Detect | GPx | PIN_x | | Any GPIO | |
| Button CLK | GPx | PIN_x | | Any GPIO | |
| Button LATCH | GPx | PIN_x | | Any GPIO | |
| Button DATA | GPx | PIN_x | | Any GPIO | |
| LED SIN | GPx | PIN_x | | Any GPIO | |
| LED SCLK | GPx | PIN_x | | Any GPIO | |
| LED XLAT | GPx | PIN_x | | Any GPIO | |
| LED BLANK | GPx | PIN_x | | Any GPIO | |
| Enc A (A/B/SW) | GPx | PIN_x | | Any GPIO | |
| Enc B (A/B/SW) | GPx | PIN_x | | Any GPIO | |
| MIDI TX | GPx | PIN_x | | UART1_TX capable | |
| MIDI RX | GPx | PIN_x | | UART1_RX capable | |
| Clock IN | GPx | PIN_x | | ADC or interrupt capable | |
| Clock OUT | GPx | PIN_x | | Any GPIO | |
| Reset IN | GPx | PIN_x | | ADC or interrupt capable | |
| Reset OUT | GPx | PIN_x | | Any GPIO | |
| CV A-D | GP40-43 | PIN_40-43 | | ADC4-7 capable | |

Also check:
- `pins.rs` type aliases match `main.rs` actual usage
- No two signals share the same GPIO
- No GPIO is assigned in firmware but not wired in schematic

### Pass criteria
- **PASS:** All pins match between schematic and firmware, all special requirements met, no conflicts
- **WARN:** pins.rs aliases don't match (cosmetic)
- **FAIL:** Any pin mismatch between schematic and firmware, or special requirement not met

---

## Section 9: Parts Availability & Sourcing Readiness

**Why:** Finding out a part is unavailable after ordering PCBs means wasted boards.

### How to check

```bash
make check-parts BOARD_COUNT=5
```

### What to verify from output

| Check | Criteria | Verdict |
|-------|----------|---------|
| All SMD parts in JLCPCB stock | Quantity available ≥ BOARD_COUNT × qty per board | FAIL if any shows "Out of Stock" |
| JLCPCB library type | Basic/preferred = cheap, extended = $3+ fee per unique part | WARN if >5 extended parts |
| All THT parts have ≥1 supplier | DigiKey, Mouser, TME, or LCSC with stock | FAIL if any THT part has zero suppliers |
| No EOL/NRND parts | Check lifecycle status for all major ICs | FAIL if any active IC is EOL |
| BOM completeness | Every component in schematic appears in BOM | FAIL if any missing |

### Manual spot-checks
For every IC and non-commodity component, manually verify on supplier websites:
- [ ] MCU — availability and lead time
- [ ] DACs — check for NRND/EOL status, verify package matches footprint
- [ ] LED drivers — check package matches footprint
- [ ] Optocouplers — check JLCPCB has exact MPN
- [ ] Display module — verify FPC pinout matches schematic
- [ ] Any connectors with specific mating requirements

### Pass criteria
- **PASS:** All parts in stock, BOM complete, no EOL parts, ≤3 extended JLCPCB parts
- **WARN:** 4-8 extended parts (cost impact), or long lead times (>2 weeks) on any part
- **FAIL:** Any critical part out of stock with no alternative, EOL IC, incomplete BOM

---

## Section 10: Mechanical Fit

**Why:** Board that works electrically but doesn't physically fit in the rack is useless.

### Files to read
- `hardware/faceplate/elec/src/faceplate.ato` — panel dimensions
- `hardware/boards/component-map.json` — component physical dimensions
- `web/src/panel-layout.json` — placed component positions
- `hardware/boards/board-config.json` — board dimensions

### What to check

| Check | Expected | How to verify |
|-------|----------|---------------|
| Panel width | 36 HP = 181.88mm ± 0.2mm | Read faceplate.ato board dimensions |
| Panel height | 128.5mm (3U eurorack standard) | Read faceplate.ato board dimensions |
| Mounting holes | 4× at eurorack standard positions (HP 1 and HP 36, 3mm from top/bottom edges) | Check faceplate.ato mounting hole positions |
| Jack holes | 6mm diameter (WQP518MA / PJ366ST barrel fit) | Check faceplate.ato hole sizes |
| Encoder holes | 7mm diameter (EC11E shaft fit) | Check faceplate.ato hole sizes |
| Board stacking clearance | Faceplate → control → main with correct standoff heights | Check 3D assembly (STEP files) |
| THT pin clearance | THT pins from control board don't hit main board components | Visual check in 3D model or calculate from component heights |
| Component height | No component exceeds ~25mm behind panel (rack depth) | Check tallest components (jacks, encoders, electrolytic caps) |
| Rail clearance | No physical components in top/bottom 10mm (rail zone) | Check panel-layout.json positions vs panel edges |

### Pass criteria
- **PASS:** All dimensions match eurorack spec, clearances verified, no collisions in 3D model
- **WARN:** Tight clearances (<1mm) on stacking or THT pins
- **FAIL:** Wrong panel dimensions, component collision, jack/encoder hole size mismatch, components in rail zone

---

## Section 11: Datasheet Compliance Audit

**Why:** Other sections check that signals are connected and components are used for their intended purpose, but don't systematically verify that each IC's datasheet requirements are met. This section catches "wired correctly but violates the datasheet" errors — wrong capacitor type on a reference pin, input voltage above absolute maximum, missing required external components, or boot pin misconfiguration.

### Method

1. List every IC in the BOM (from `.ato` source files and `hardware/boards/parts/`)
2. Download the manufacturer datasheet for each
3. For each IC, work through every check category below
4. Record the specific datasheet section/table that confirms compliance or flags a violation

### 11a. Absolute Maximum Ratings

For every IC, open the "Absolute Maximum Ratings" table in the datasheet and verify:

| Check | How to verify | FAIL if |
|-------|---------------|---------|
| Supply voltage | Compare schematic supply rail to rated Vmax | Rail voltage exceeds abs max (even transiently) |
| Input voltage on any pin | Check signal levels at every input pin against rated Vin range | Any input can exceed VCC+0.5V or go below GND-0.5V (unless clamped) |
| Output short-circuit | If outputs can be shorted (user-facing jacks), check for series protection resistors | Unprotected output directly to connector |
| ESD rating | External-facing pins (jacks, USB, MIDI) should have ESD protection | No TVS/ESD diode on connector pins with <2kV HBM rating |
| Junction temperature | Cross-reference with thermal analysis in Section 4b | Operating conditions push Tj above rated max |

### 11b. Power Supply & Decoupling Requirements

For every IC, find the "Recommended Operating Conditions" and "Application Information" sections:

| Check | How to verify | FAIL if |
|-------|---------------|---------|
| Supply voltage range | Verify actual rail voltage is within recommended (not just abs max) range | Rail outside recommended operating range |
| Decoupling capacitor values | Compare schematic caps to datasheet "typical application" or "recommended" values | Wrong value, wrong type (e.g., electrolytic where ceramic required), or missing |
| Multiple power pins | Each power pin needs its own decoupling cap, placed close to the pin | Single shared cap for multiple power pins |
| Analog vs digital supply separation | If IC has separate AVDD/DVDD, verify they have independent decoupling paths | Analog and digital supply pins sharing a single cap |
| Reference voltage pins | Check for specific cap type/value requirements (datasheets often specify low-ESR ceramic) | Wrong cap type on VREF (causes noise or instability) |
| Power sequencing | If datasheet specifies power-on sequence (e.g., DVDD before AVDD), verify circuit complies | Incorrect power sequencing possible |

### 11c. Pin Configuration & Control Pins

For every IC, review the pin description table and application circuit:

| Check | How to verify | FAIL if |
|-------|---------------|---------|
| Unused pins | Datasheet specifies how to tie unused inputs/outputs | Any pin left floating that should be tied to a defined level |
| Control/config pins | Pins like LDAC, CLR, BLANK, OE, CLK_INH, etc. — verify tied to correct state for intended operation | Control pin floating or in wrong state (IC won't function as expected) |
| Enable/shutdown pins | Check EN, SHDN, PD pins are in the correct state (tied or driven) | Floating enable pin (IC may not start or may randomly shut down) |
| Boot/mode pins | MCU boot mode pins, IC configuration pins — verify match intended boot/config | Wrong mode selected (device boots into wrong state) |
| Reset pins | Check for required pull-up/RC delay per datasheet | Floating or under-specified reset (unreliable startup) |
| Open-drain/collector outputs | Must have external pull-up resistor to appropriate voltage | Missing pull-up (output stuck low or floating) |
| Bidirectional/tristate pins | Verify direction control is correct and default state is safe | Bus contention at startup |

### 11d. Signal Level Compatibility

For every connection between two ICs, verify voltage levels are compatible:

| Check | How to verify | FAIL if |
|-------|---------------|---------|
| Logic level thresholds | Compare driver VOH/VOL to receiver VIH/VIL at actual supply voltages | VOH < VIH (logic HIGH not recognized) or VOL > VIL (logic LOW not recognized) |
| Mixed-voltage interfaces | If ICs run on different supply rails (e.g., 3.3V MCU driving 5V logic) | 3.3V output driving HC-family at 5V VCC (VIH = 3.5V, not met by 3.3V driver) |
| Analog signal range | DAC output range vs op-amp input common-mode range; ADC input vs reference voltage | Signal exceeds input common-mode range (clipping, phase inversion) |
| Drive strength vs load | Check source can drive the load (fan-out for digital, impedance for analog) | Source overloaded (voltage droop, signal degradation) |
| Output swing vs required range | Op-amp output swing at actual load vs required signal range | Required output voltage exceeds swing capability at operating supply |

### 11e. Communication Protocol Compliance

For every serial bus (SPI, I2C, UART), verify both ends agree:

| Check | How to verify | FAIL if |
|-------|---------------|---------|
| SPI mode (CPOL/CPHA) | Compare MCU firmware SPI config to each slave's datasheet requirement | Mode mismatch (garbled data) |
| SPI clock frequency | Check firmware clock rate against every slave's max SCLK spec | Exceeds any slave's maximum (unreliable at best, damage at worst) |
| Chip select polarity | Active-high vs active-low — verify firmware matches IC requirement | Wrong CS polarity (IC never selected or always selected) |
| I2C address conflicts | If using I2C, verify no two devices share the same address | Address collision (bus errors) |
| UART baud/format | TX/RX baud rate, stop bits, parity match between both ends | Mismatched serial config |
| Daisy-chain order | For chained ICs (shift registers, LED drivers), verify DOUT→DIN wiring order matches firmware bit ordering | Data shifted to wrong device in chain |

### 11f. Timing & Startup Behavior

| Check | How to verify | FAIL if |
|-------|---------------|---------|
| Power-on state | What does each IC output at power-on before firmware initializes it? | Unsafe startup state (e.g., DAC outputs full-scale voltage into connected gear, all LEDs on at max current) |
| Reset timing | MCU and peripherals — verify reset pulse width meets datasheet minimum | Reset too short (unreliable initialization) |
| Startup sequencing | If peripherals need to be initialized in a specific order, verify firmware handles this | IC accessed before it's ready (e.g., SPI transfer before power stable) |
| Watchdog/timeout | If IC has internal watchdog or communication timeout, verify firmware services it | Timeout causes unexpected reset or shutdown |

### 11g. Thermal & Layout Requirements

| Check | How to verify | FAIL if |
|-------|---------------|---------|
| Thermal pad | If IC has exposed pad, verify PCB footprint connects it correctly (usually to GND with vias) | Thermal pad floating or insufficient vias (overheating) |
| Power dissipation | Calculate worst-case dissipation and check against package thermal rating | Package cannot dissipate heat at max load in enclosed eurorack case |
| Recommended layout | Check datasheet "PCB Layout" section for specific guidance (e.g., keep analog traces short, ground plane under IC) | Critical layout guidance ignored |
| Current-set resistors | For ICs with programmable current (LED drivers, regulators), verify resistor value and tolerance | Wrong current (dim LEDs, wrong voltage, or component damage) |

### Pass criteria
- **PASS:** Every datasheet requirement verified and met for all ICs
- **WARN:** Minor deviations within tolerance (e.g., bypass cap is 220nF instead of 100nF, still functional)
- **FAIL:** Any absolute maximum rating exceeded, missing required external component, wrong pin configuration, or signal level outside rated input range

---

## Final Report Template

```markdown
# Production Validation Report — Requencer
**Date:** YYYY-MM-DD
**Verdict:** PASS / DO NOT MANUFACTURE

## Summary
| Section | Verdict | Critical Issues |
|---------|---------|-----------------|
| 1. GPIO Function-Select | | |
| 2. Connector Pin Matching | | |
| 3. Signal Path Integrity | | |
| 4. Power Supply | | |
| 5. Component Fitness | | |
| 6. Multi-Button Input | | |
| 7. Routing Quality | | |
| 8. Firmware-Pin Compat | | |
| 9. Parts Availability | | |
| 10. Mechanical Fit | | |
| 11. Datasheet Compliance | | |

## Automated Check Results
(paste output of make hw-build, hw-place, hw-route, check-parts, test-hw, cargo test)

## Detailed Findings
(one sub-section per check section, using the format specified above)

## Action Items
### Must Fix (FAIL items)
1. ...

### Should Fix (WARN items)
1. ...

## Comparison with Previous Reports
- 2026-03-10 report: 6 critical issues (C1-C6) — status of each fix
```
