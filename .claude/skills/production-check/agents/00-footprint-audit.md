# Agent: Footprint Audit — Section 0

## Purpose

Datasheet-level verification of every component's pin mapping, footprint geometry, and 3D model. This is the highest-value check — it caught all 4 critical issues in the 2026-03-18 audit (wrong DAC pin mapping, swapped diode pins, wrong transistor pinout, I2C pin conflict).

## Inputs

- All `.ato` files under `hardware/boards/elec/src/components/` (skip `_archive/`)
- All `.kicad_mod` footprint files in each component directory
- All `.kicad_sym` symbol files in each component directory
- Component `README.md` files for datasheet URLs

## Procedure

### Step 1: Enumerate components

List all directories under `hardware/boards/elec/src/components/` excluding `_archive/`. For each component directory, read:

1. The `.ato` file (component definition with `signal X ~ pin N` mappings)
2. The `.kicad_mod` footprint file (pad definitions)
3. The `.kicad_sym` symbol file (pin number declarations)
4. The `README.md` (datasheet URL)

### Step 2: Per-component checks

For **each** component, perform all of the following:

#### 2a. Pin mapping vs datasheet

- Extract every `signal X ~ pin N` line from the `.ato` file.
- Read the component's `README.md` to find the datasheet URL. If the URL is missing, construct it from the LCSC number: `https://www.lcsc.com/product-detail/{lcsc_number}.html`
- Use WebFetch to retrieve the datasheet page if needed for pin verification.
- Cross-reference each signal-to-physical-pin mapping against the datasheet pin table. Every pin must match.

#### 2b. Symbol pin numbers vs .ato

- Read the `.kicad_sym` file and find all `(pin ... (number "N") ...)` declarations.
- Verify that every pin number in the `.kicad_sym` has a corresponding `pin N` in the `.ato` file, and vice versa.

#### 2c. Footprint pad count

- Read the `.kicad_mod` file and count all `(pad N ...)` entries.
- Verify the pad count matches the number of pins declared in the `.ato` file.
- For QFN/BGA packages: verify an exposed/thermal pad is declared and connected (usually to GND).

#### 2d. Footprint pad dimensions (spot check)

- For fine-pitch ICs (QFN, TSSOP, SOT-143B), read the pad dimensions from the `.kicad_mod` file.
- Compare against the datasheet's recommended land pattern.
- Flag pads that deviate by more than 0.1mm from the recommended dimensions.

#### 2e. 3D model reference

- Check the `.kicad_mod` file for a `(model ...)` entry referencing a `.step` file.
- Verify the referenced `.step` file exists in the component directory.
- For passives (resistors, capacitors), a missing 3D model is WARN, not FAIL.

#### 2f. Manufacturer cross-check

- Extract the manufacturer from the `.ato` file (`manufacturer` field or comments).
- If an LCSC part number is present, note if the LCSC listing shows a different manufacturer.
- Flag as WARN (not FAIL) — functional equivalents from different manufacturers are acceptable.

### Step 3: Priority ordering

Check components in this order (highest risk first):

1. **Fine-pitch ICs:** DAC80508ZRTER, PGA2350, IS31FL3216A, OPA4171AIPWR, PRTR5V0U2X
2. **Semiconductors with polarity:** BAT54S, H11L1S, 2N3904, 2N7002, B5819W
3. **Connectors:** ShroudedHeader2x16, ShroudedSocket2x16, USB_C_Receptacle, FPC_32P_05MM, PJS008U
4. **Electromechanical:** PB6149L, EC11E, WQP518MA, PJ366ST, TactileSwitch
5. **Passives and simple parts:** ResArray4x0603, AMS1117-3.3, EurorackPowerHeader16

## Pass Criteria

- **PASS:** All pin mappings verified correct against datasheets, pad counts match, footprints have 3D models.
- **WARN:** Minor issues only — LCSC manufacturer mismatch, missing 3D model on a passive, pad dimension within 0.2mm of recommended.
- **FAIL:** Any pin mapping contradicts the datasheet, pad count mismatch between `.ato` and `.kicad_mod`, missing footprint file for an active component.

## Output Format

```
## Footprint Audit — Section 0
**Verdict: PASS / WARN / FAIL**

| Check | Status | Detail |
|-------|--------|--------|
| ... | PASS/WARN/FAIL | ... |

**Issues found:**
- [FAIL] Description — file:line — suggested fix
- [WARN] Description — file:line — suggested fix
```

Report one row per component in the table. Group issues by severity (FAIL first, then WARN).
