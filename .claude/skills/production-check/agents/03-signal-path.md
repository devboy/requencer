# Agent: Signal Path Integrity — Sections 3 & 5

## Purpose

Trace every signal path end-to-end through the schematic and verify component fitness for intended purpose. This is the largest and most comprehensive agent — it covers analog signal chains, digital buses, protection circuits, and power delivery.

## Inputs

- All `.ato` files under `hardware/boards/elec/src/circuits/` (each subdirectory is a circuit module)
- All `.ato` files under `hardware/boards/elec/src/boards/` (top-level board definitions)
- Part definitions under `hardware/boards/elec/src/components/` (pin definitions, datasheets)
- Component `README.md` files for datasheet URLs when values need verification

## Procedure

### Section 3: Signal Path Tracing

For each signal path below, read the relevant `.ato` circuit files, trace the signal from source to destination, and verify every component and value along the way.

---

#### 3a. Pitch CV (4 channels)

**Path:** DAC80508 OUT4-7 -> OPA4171 (gain stage) -> 470 ohm protection -> jack tip

**Files to read:**
- `hardware/boards/elec/src/circuits/dac-output/dac-output.ato`
- `hardware/boards/elec/src/circuits/io-jacks/io-jacks.ato` (or wherever output jacks are defined)

**Checks:**
- [ ] Gain resistors form gain = 2 (e.g., 10k feedback / 10k input, or equivalent ratio)
- [ ] Offset resistors provide -2V offset (e.g., 15k/10k from precision reference)
- [ ] Precision resistors are 0.1% tolerance on the pitch CV path (this is critical for 1V/oct tuning accuracy)
- [ ] Op-amp (OPA4171) powered from +/-12V rails (NOT 3.3V or 5V — needs negative voltage swing)
- [ ] 470 ohm series protection resistor on output
- [ ] Expected output range: -2V to +8V (10 octaves at 1V/oct)

---

#### 3b. Gate CV (4 channels)

**Path:** DAC80508 OUT0-3 -> OPA4171 (unity gain buffer) -> 470 ohm -> jack tip

**Checks:**
- [ ] Unity gain buffer (feedback = direct, no gain resistor network, or equal resistors)
- [ ] Expected output range: 0-5V
- [ ] Op-amp supply rails adequate for 0-5V output

---

#### 3c. Velocity CV (4 channels)

**Path:** DAC80508 OUT -> OPA4171 (gain ~1.6) -> protection -> jack tip

**Checks:**
- [ ] Gain approximately 1.6 (verify resistor ratio)
- [ ] Expected output range: 0-8V
- [ ] Op-amp supply rails adequate

---

#### 3d. Mod CV (4 channels)

**Path:** DAC80508 OUT -> OPA4171 (inverting gain = 2, offset = +5V) -> protection -> jack tip

**Checks:**
- [ ] Inverting configuration (signal enters non-inverting or inverting input as appropriate)
- [ ] Gain = 2 with offset producing bipolar output
- [ ] Op-amp on +/-12V rails (needs negative output swing)
- [ ] Expected output range: -5V to +5V

---

#### 3e. Button scan

**Path:** GPIO -> 74HC165D shift register chain: CLK (shared), LATCH (shared), DATA (daisy-chained QH -> SER)

**Files to read:**
- `hardware/boards/elec/src/circuits/button-scan/button-scan.ato`
- `hardware/boards/elec/src/components/74HC165D/74HC165D.ato`

**Checks:**
- [ ] First shift register in chain has SER (serial input) tied to GND
- [ ] Last shift register's QH (serial output) connects to MCU data input
- [ ] CLK_INH (clock inhibit) tied LOW on all shift registers
- [ ] CLK and SH/LD (latch) signals shared across all shift registers
- [ ] Pull-up resistors on all button inputs (via ResArray4x0603 or discrete resistors)
- [ ] Chain order matches firmware's expected bit ordering

---

#### 3f. LED drive

**Path:** MCU I2C -> IS31FL3216A chain (SDA/SCL shared, unique addresses via AD pin)

**Files to read:**
- `hardware/boards/elec/src/circuits/led-driver/led-driver.ato`
- `hardware/boards/elec/src/components/IS31FL3216A/IS31FL3216A.ato`

**Checks:**
- [ ] I2C addresses are unique per IC (AD pin wired differently on each)
- [ ] SDA and SCL have pull-up resistors (typically 4.7k to 3.3V, only one pair for the bus)
- [ ] VCC powered from 3.3V
- [ ] SDB (shutdown) pin tied high or controlled by MCU
- [ ] IREF / current-set resistor present and correctly valued for target LED current

---

#### 3g. MIDI

**Path OUT:** MCU UART TX -> 220 ohm -> TRS jack (Tip = data, Ring = VCC per Type A TRS MIDI)
**Path IN:** TRS jack -> 220 ohm -> H11L1S optocoupler LED -> MCU UART RX

**Files to read:**
- `hardware/boards/elec/src/circuits/midi/midi.ato`
- `hardware/boards/elec/src/components/H11L1S/H11L1S.ato`

**Checks:**
- [ ] MIDI OUT: 220 ohm resistors on both Tip and Ring lines (per MIDI electrical spec)
- [ ] MIDI OUT: TRS Type A pinout (Tip = sink/source current, Ring = +5V through 220 ohm)
- [ ] MIDI IN: Optocoupler LED anode/cathode polarity correct (current flows from Ring through LED to Tip)
- [ ] MIDI IN: Protection diode across optocoupler LED (reverse-biased, catches wrong polarity)
- [ ] MIDI IN: Optocoupler output pull-up to 3.3V (not 5V — MCU is 3.3V logic)
- [ ] MIDI IN: Output goes to UART RX, active low when MIDI data present

---

#### 3h. Clock/Reset I/O

**Path IN:** Jack tip -> board connector -> voltage divider (22k/10k) -> BAT54S clamp -> 100nF filter -> MCU GPIO
**Path OUT:** MCU GPIO -> 1k base resistor -> MMBT3904 NPN -> 1k collector to 5V -> jack tip

**Files to read:**
- `hardware/boards/elec/src/circuits/input-protection/input-protection.ato` (or equivalent)
- `hardware/boards/elec/src/circuits/io-jacks/io-jacks.ato`

**Checks:**
- [ ] Input divider ratio: 10k / (22k + 10k) = 0.3125, so 10V input -> 3.125V (under 3.3V ADC max)
- [ ] BAT54S clamp: connected between signal and both 3.3V and GND rails, correct polarity (anode to GND, cathode to 3.3V for upper clamp)
- [ ] 100nF filter cap to GND after clamp
- [ ] Output NPN: MMBT3904 base driven through 1k resistor from GPIO
- [ ] Output NPN: collector pulled to 5V through 1k resistor, jack tip at collector
- [ ] NPN inverts logic — firmware must output HIGH to pull jack LOW, and vice versa. Verify firmware accounts for this inversion.

---

#### 3i. Display

**Path:** MCU SPI0 (MOSI, SCK, CS) + DC + BL + RST -> FPC connector

**Files to read:**
- `hardware/boards/elec/src/circuits/display/display.ato`
- `hardware/boards/elec/src/components/FPC_32P_05MM/FPC_32P_05MM.ato`

**Checks:**
- [ ] SPI signals (MOSI, SCK, CS) routed to correct FPC pins
- [ ] RST has RC delay circuit: 10k resistor + 100nF cap giving >= 10 microsecond delay
- [ ] Backlight (BL) driven via 2N7002 N-channel MOSFET with gate pull-down resistor (ensures backlight OFF at power-on until MCU drives it)
- [ ] DC (data/command) signal routed to MCU GPIO
- [ ] FPC connector pin assignments match the target display's pinout

---

#### 3j. SD card

**Path:** MCU SPI0 (MOSI, MISO, SCK) + CS + CD -> PJS008U SD connector

**Files to read:**
- `hardware/boards/elec/src/circuits/` (find the SD-related circuit)
- `hardware/boards/elec/src/components/PJS008U/PJS008U.ato`

**Checks:**
- [ ] MISO connected (SPI0_RX pin) — this is the most commonly forgotten SD card signal
- [ ] MOSI, SCK, CS all connected
- [ ] Card detect (CD) signal routed to MCU GPIO
- [ ] Decoupling cap on SD card VCC (3.3V)
- [ ] Pull-up on CS line (some SD cards need this)

---

#### 3k. USB-C

**Path:** MCU USB DP/DM -> 27 ohm series resistors -> USB_C_Receptacle

**Files to read:**
- Find the USB-related circuit under `hardware/boards/elec/src/circuits/` or in the board-level `.ato`
- `hardware/boards/elec/src/components/USB_C_Receptacle/USB_C_Receptacle.ato`
- `hardware/boards/elec/src/components/PRTR5V0U2X/PRTR5V0U2X.ato`

**Checks:**
- [ ] 27 ohm series resistors on both D+ and D- lines
- [ ] 5.1k ohm pull-down resistors on CC1 and CC2 (required for USB-C device mode)
- [ ] PRTR5V0U2X ESD protection on data lines (connected between D+/D- and GND/VCC)
- [ ] USB shield connected to GND (preferably through a small capacitor or ferrite for EMI)
- [ ] VBUS connected to 5V rail (or through a regulator/switch)

---

#### 3l. Encoders

**Path:** EC11E A/B/SW -> pull-ups (10k to 3.3V) + debounce caps (100nF) -> board connector -> MCU GPIO

**Files to read:**
- `hardware/boards/elec/src/components/EC11E/EC11E.ato`
- Find encoder wiring in the control board `.ato` or a dedicated circuit

**Checks:**
- [ ] 10k pull-up resistors to 3.3V on A, B, and SW pins
- [ ] 100nF debounce capacitors to GND on A, B, and SW pins
- [ ] RC time constant: 10k x 100nF = 1ms (appropriate for mechanical encoder debounce)
- [ ] Push switch (SW) is active-low (connects to GND when pressed)
- [ ] All encoder signals routed through board connector to MCU GPIOs

---

#### 3m. CV inputs (4 channels)

**Path:** Jack tip -> board connector -> input protection (22k/10k divider + BAT54S clamp + 100nF) -> MCU ADC (GP40-43)

**Files to read:**
- `hardware/boards/elec/src/circuits/input-protection/input-protection.ato`
- MCU circuit for ADC pin assignments

**Checks:**
- [ ] Voltage divider: 10k / (22k + 10k) maps +/-10V eurorack range to approximately 0-3.3V ADC range
- [ ] BAT54S clamp diodes between signal and both GND and 3.3V rails
- [ ] 100nF filter capacitor after clamp, before ADC input
- [ ] ADC inputs on GP40-GP43 (the only valid ADC pins on RP2350)
- [ ] No other signal sharing the ADC GPIO pins

---

### Section 5: Component-Purpose Fitness

After tracing all signal paths, verify each major component is correctly configured for its role.

#### DAC80508ZRTER
- [ ] All 8 output channels wired to signal paths
- [ ] VREF pin decoupled with appropriate capacitor
- [ ] LDAC pin tied to defined state (LOW for immediate update, or connected to GPIO for synchronized update)
- [ ] CLR pin tied HIGH (or connected to GPIO for reset capability)
- [ ] SPI connections: SDI (MOSI), SCLK, SYNC (CS) all connected

#### OPA4171AIPWR
- [ ] All 4 op-amp channels used, or unused channels configured as voltage followers (output tied to inverting input)
- [ ] V+ connected to +12V, V- connected to -12V (for circuits requiring bipolar output)
- [ ] Decoupling caps on supply pins (100nF minimum, close to IC)
- [ ] No channel left with floating inputs

#### 74HC165D
- [ ] Chain order: first SR's SER tied to GND, subsequent SR's SER connected to previous QH
- [ ] CLK_INH tied LOW on all ICs
- [ ] SH/LD and CLK shared across chain
- [ ] Unused parallel inputs tied to defined state (HIGH via pull-up or LOW via pull-down)
- [ ] VCC decoupled

#### IS31FL3216A
- [ ] Each IC has a unique I2C address (different AD pin configuration)
- [ ] Current-set resistor (REXT/IREF) present and correctly valued
- [ ] SDB (shutdown bar) pin pulled HIGH for normal operation or controlled by MCU
- [ ] Unused output channels: acceptable to leave unconnected (open-drain outputs)

#### H11L1S (optocoupler)
- [ ] LED anode connects to MIDI Ring (through resistor), cathode to MIDI Tip
- [ ] Protection diode across LED (cathode to anode, reverse-biased during normal operation)
- [ ] Output transistor collector pulled up to 3.3V through resistor
- [ ] Output emitter to GND

#### BAT54S / PRTR5V0U2X (protection)
- [ ] BAT54S: connected between signal line and both supply rails for bidirectional clamping
- [ ] PRTR5V0U2X: connected to USB data lines with correct pin orientation
- [ ] Both have correct polarity (verify against component `.ato` pin definitions)

#### MMBT3904 (NPN for clock/reset output)
- [ ] Base driven through current-limiting resistor (1k typical)
- [ ] Collector has pull-up load resistor to appropriate voltage (5V for eurorack)
- [ ] Emitter connected to GND
- [ ] Base-emitter resistor (optional, prevents floating when GPIO is tristate)

## Pass Criteria

- **PASS:** All signal paths are correct end-to-end with correct component values, all components are properly configured for their intended purpose.
- **WARN:** Minor issues that do not break functionality — debounce on wrong board (still works, just harder to change), unused op-amp output floating (noise risk but not destructive), MISO line unused in current firmware but wired correctly.
- **FAIL:** Broken signal path (disconnected net), wrong polarity on any semiconductor, missing protection component, wrong gain/offset resistor values, floating critical pin (e.g., SPI MISO not connected to SD card), op-amp powered from wrong rails.

## Output Format

```
## Signal Path Integrity — Sections 3, 5
**Verdict: PASS / WARN / FAIL**

| Check | Status | Detail |
|-------|--------|--------|
| ... | PASS/WARN/FAIL | ... |

**Issues found:**
- [FAIL] Description — file:line — suggested fix
- [WARN] Description — file:line — suggested fix
```

Organize the table by signal path (3a through 3m), then component fitness (Section 5). For each signal path, include a one-line summary of the traced path to confirm it was fully followed.
