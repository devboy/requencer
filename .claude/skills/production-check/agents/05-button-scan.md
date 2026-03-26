# Agent: Multi-Button / Simultaneous Input

You are a button scan chain review agent for a eurorack synthesizer module. Your job is to verify that the shift-register-based button scanning supports simultaneous key presses without ghosting or missed inputs.

## Section 6: Multi-Button / Simultaneous Input

## Inputs

Read these files thoroughly before beginning checks:

- `hardware/boards/elec/src/boards/control/control.ato` — control board top-level (button wiring, shift register chain)
- `hardware/boards/elec/src/components/74HC165D/74HC165D.ato` — shift register component definition
- `crates/firmware/src/main.rs` — firmware entry point (search for button scan code: `buttons`, `shift_register`, `scan`, `74HC165`, `latch`, `clock`)

Also read any files imported by these to trace the full button wiring and scan logic.

## Checks

### 1. Wiring Topology

Determine how buttons are connected to the shift registers:

- **Direct wiring** (one button per shift register input): No ghosting is possible regardless of how many buttons are pressed simultaneously. This is the preferred topology. Mark as PASS.
- **Matrix wiring** (rows x columns): Requires anti-ghosting diodes on every switch to prevent phantom key presses. Check that diodes are present on each button in the matrix. FAIL if matrix is used without diodes.

Read the control board `.ato` file and trace how each button's signal reaches a shift register input pin.

### 2. Shift Register Chain Integrity

Read `control.ato` for all 74HC165D instantiations and verify the daisy-chain:

- **Count**: There should be 5x 74HC165D = 40 input bits total. Report the actual count found.
- **Chain wiring**: For each shift register in the chain:
  - QH (serial output, pin 9) of SR[n] connects to SER (serial input, pin 10) of SR[n+1]
  - The first SR's SER input is tied to GND or VCC (not floating)
  - The last SR's QH connects to the MCU data input pin
- **Shared control signals**: All shift registers share:
  - CLK (clock, pin 2) — driven by MCU
  - SH/LD (shift/load, pin 1) — latch signal from MCU
  - CLK_INH (clock inhibit, pin 15) — tied LOW (active, not inhibited) on all SRs
- FAIL if chain is broken (any QH-to-SER link missing).
- FAIL if CLK_INH is floating or tied HIGH on any SR.
- WARN if first SR's SER is floating.

### 3. Pull-ups on Button Inputs

Every unused or button-connected input on the shift registers needs a defined logic level:

- Each button input should have a pull-up resistor (to VCC) so the input reads HIGH when the button is not pressed, and LOW when pressed (assuming buttons connect to GND).
- Alternatively, a resistor array (e.g., 10k x 8) can serve multiple inputs.
- Count the total pull-ups and compare against the total button input count.
- FAIL if any button input lacks a pull-up (or pull-down, depending on button wiring polarity).

### 4. Unused Inputs

Any shift register input pins not connected to a button must be tied to a defined logic level (VCC or GND through a resistor), not left floating.

- Count total SR inputs (8 per SR x number of SRs).
- Subtract button count.
- Verify remaining inputs are tied to VCC or GND.
- WARN if any input is floating.

### 5. Scan Rate

Search the firmware source for the button scan interval or timer configuration:

- Look for timer/interrupt setup, delay values, or loop timing related to shift register reads.
- Look for SPI clock configuration if SPI is used to read the chain.
- Calculate or estimate the effective scan rate in Hz.

| Scan Rate | Verdict |
|-----------|---------|
| >= 200 Hz | PASS — sufficient for hold-combo detection and responsive UI |
| 100-200 Hz | WARN — functional but may feel sluggish for simultaneous combos |
| < 100 Hz | FAIL — too slow for real-time button interaction |

If scan rate cannot be determined from the firmware code, report as WARN with explanation.

### 6. Bit Mapping

Verify the firmware maps all shift register bit positions to button events:

- Search for button mapping arrays, enums, or constants in the firmware.
- All 40 bit positions (or however many buttons exist) should be accounted for.
- Unused bit positions should be explicitly ignored (not silently dropped).
- WARN if bit mapping is incomplete or not yet implemented.

## Pass Criteria

- **PASS**: Direct wiring (no ghosting risk), pull-ups on all inputs, chain fully connected with correct control signals, scan rate >= 200 Hz, all bit positions mapped in firmware.
- **WARN**: Scan rate 100-200 Hz, or bit mapping not yet fully implemented, or minor unused input issues.
- **FAIL**: Matrix wiring without anti-ghosting diodes, floating inputs on any SR, broken chain (QH/SER disconnection), CLK_INH not tied LOW, scan rate < 100 Hz.

## Output Format

```
## Multi-Button / Simultaneous Input — Section 6
**Verdict: PASS / WARN / FAIL**

| Check | Status | Detail |
|-------|--------|--------|
| 1. Wiring topology | PASS/WARN/FAIL | Direct / Matrix (with/without diodes) |
| 2. SR chain integrity | PASS/WARN/FAIL | N SRs found, chain connected/broken |
| 3. Pull-ups | PASS/WARN/FAIL | N pull-ups for N button inputs |
| 4. Unused inputs | PASS/WARN/FAIL | N unused inputs, all tied / N floating |
| 5. Scan rate | PASS/WARN/FAIL | Estimated ___Hz |
| 6. Bit mapping | PASS/WARN/FAIL | N/40 positions mapped |

**Issues found:**
- [FAIL] Description — file:line — suggested fix
- [WARN] Description — file:line — suggested fix
```
