# Agent: GPIO Pin Compatibility — Sections 1 & 8

## Purpose

Verify all peripheral pins are assigned to valid RP2350 GPIOs (correct function-select bank) and that the firmware pin assignments match the hardware schematic exactly.

## Inputs

- `hardware/boards/elec/src/circuits/mcu/mcu.ato` — all `pga.GPxx ~ signal_name` lines
- `crates/firmware/src/main.rs` — pin assignments (search for `PIN_` or `Gpio`)
- `crates/firmware/src/pins.rs` — type aliases for pins (if it exists)
- `crates/firmware/src/dac.rs` — SPI peripheral usage (if it exists)
- Any other `crates/firmware/src/*.rs` files that reference GPIO pins

## RP2350 GPIO Function-Select Table

Use this as the authoritative reference for which GPIOs can serve which peripheral function.

### SPI0

| Function   | Valid GPIOs              |
|------------|--------------------------|
| SPI0_RX (MISO) | GP0, GP4, GP16, GP20  |
| SPI0_TX (MOSI) | GP3, GP7, GP19, GP23  |
| SPI0_SCK        | GP2, GP6, GP18, GP22  |
| SPI0_CSn         | GP1, GP5, GP17, GP21  |

### SPI1

| Function   | Valid GPIOs              |
|------------|--------------------------|
| SPI1_RX (MISO) | GP8, GP12, GP24, GP28 |
| SPI1_TX (MOSI) | GP11, GP15, GP27, GP31|
| SPI1_SCK        | GP10, GP14, GP26, GP30|
| SPI1_CSn         | GP9, GP13, GP25, GP29 |

### UART1

| Function   | Valid GPIOs                          |
|------------|--------------------------------------|
| UART1_TX   | GP4, GP8, GP12, GP16, GP20, GP24    |
| UART1_RX   | GP5, GP9, GP13, GP17, GP21, GP25    |

### ADC

| Function | Valid GPIOs     |
|----------|-----------------|
| ADC4-7   | GP40-GP43 only  |

### I2C0

| Function   | Valid GPIOs                                    |
|------------|------------------------------------------------|
| I2C0_SDA   | GP0, GP4, GP8, GP12, GP16, GP20, GP24, GP28   |
| I2C0_SCL   | GP1, GP5, GP9, GP13, GP17, GP21, GP25, GP29   |

## Procedure

### Step 1: Extract hardware GPIO assignments

Read `hardware/boards/elec/src/circuits/mcu/mcu.ato`. Extract every line matching `pga.GPxx ~ ...` and build a table:

| GPIO | Signal Name | Peripheral Function |

Determine the peripheral function from context (signal name, surrounding comments, or the circuit module that consumes the signal).

### Step 2: Validate GPIO function-select (Section 1)

For each GPIO assignment from Step 1:

1. **SPI0 pins** (display, SD card): Verify the assigned GPIO appears in the SPI0 valid set above.
2. **SPI1 pins** (DAC): Verify the assigned GPIO appears in the SPI1 valid set above.
3. **UART1 pins** (MIDI): Verify the assigned GPIO appears in the UART1 valid set above.
4. **ADC pins** (CV inputs): Verify the GPIO is in GP40-GP43.
5. **I2C0 pins** (LED drivers): Verify SDA GPIO is in the I2C0_SDA set and SCL GPIO is in the I2C0_SCL set.
6. **Plain GPIO** (buttons, encoders, gate outputs): Any GPIO is valid, just check for conflicts.

Flag any GPIO assigned to a peripheral function it cannot physically serve as **FAIL**.

### Step 3: Check for GPIO conflicts

Build the complete GPIO-to-signal mapping. Verify:

- No two different signals share the same GPIO number.
- No GPIO is left assigned to two peripherals simultaneously.

### Step 4: Extract firmware pin assignments (Section 8)

Read all relevant firmware source files:

- `crates/firmware/src/main.rs`
- `crates/firmware/src/pins.rs` (if exists)
- `crates/firmware/src/dac.rs` (if exists)
- Any other `.rs` files under `crates/firmware/src/` that contain `PIN_`, `Gpio`, or pin number references.

Build a firmware-side table:

| Signal | Firmware PIN/GPIO | Source file:line |

### Step 5: Cross-reference hardware vs firmware

Build a comparison table:

| Signal | mcu.ato GPIO | Firmware GPIO | Match? | Peripheral | Valid GPIO? |
|--------|-------------|---------------|--------|------------|-------------|

Check:

1. Every signal in mcu.ato has a corresponding firmware pin assignment.
2. Every firmware pin assignment has a corresponding mcu.ato wiring.
3. The GPIO numbers match between hardware and firmware for each signal.
4. Flag any GPIO assigned in firmware but not wired in the schematic.
5. Flag any GPIO wired in the schematic but not used in firmware (WARN, not FAIL — may be intentionally unused during development).

## Pass Criteria

- **PASS:** All pins are on valid GPIOs for their peripheral function, firmware matches schematic, no conflicts.
- **WARN:** A GPIO is wired in schematic but not yet used in firmware (development in progress), or `pins.rs` type aliases are inconsistent with `main.rs` (cosmetic).
- **FAIL:** Any pin assigned to an invalid GPIO for its peripheral function, firmware GPIO contradicts schematic, or two signals share the same GPIO.

## Output Format

```
## GPIO Pin Compatibility — Sections 1, 8
**Verdict: PASS / WARN / FAIL**

| Check | Status | Detail |
|-------|--------|--------|
| ... | PASS/WARN/FAIL | ... |

**Issues found:**
- [FAIL] Description — file:line — suggested fix
- [WARN] Description — file:line — suggested fix
```

Include the full GPIO comparison table (Step 5) in the output so the reader can see every pin at a glance.
