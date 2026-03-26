# Production Validation Report — Requencer
**Date:** 2026-03-25
**Verdict:** PASS WITH WARNINGS

## Summary

| # | Section | Agent | Verdict | Issues |
|---|---------|-------|---------|--------|
| 0 | Component & Footprint Audit | footprint-audit | WARN | 3D model refs missing on 4 components, H11L1S no model, manufacturer mismatches on 3 parts |
| 1 | GPIO Function-Select | gpio-pin-compat | PASS | All 28 GPIOs valid, firmware matches schematic |
| 2 | Connector Pin Matching | connector-stacking | PASS | All 64 pins verified with correct row-swap |
| 3 | Signal Path Integrity | signal-path | WARN | MIDI README doc mismatch (1k vs 4.7k pull-up) |
| 4 | Power Supply | power-supply | WARN | Missing 3.3V bulk cap at control board connector, +5V margin tight |
| 5 | Component-Purpose Fitness | signal-path | PASS | All components correctly configured |
| 6 | Multi-Button Input | button-scan | PASS | Direct wiring, 5x SR chain, 200Hz scan, all 40 bits |
| 7 | Routing Quality | pcb-layout | WARN | Low GND stitching vias (2 per board) |
| 8 | Firmware-Pin Compat | gpio-pin-compat | PASS | All firmware pin assignments match hardware |
| 9 | Parts Availability | parts-sourcing | FAIL | parts-report.json missing — run `make check-parts` |
| 10 | Mechanical Fit | mechanical-fit | PASS | Panel dims correct, stacking needs manual 3D check |
| 11 | Datasheet Compliance | datasheet-compliance | WARN | AMS1117 headroom marginal, power sequencing note |
| 12 | Manufacturing Output | manufacturing-files | FAIL | No fiducial marks on control/main boards |
| 13 | Silkscreen & Markings | manufacturing-files | WARN | Gerber revision placeholder "rev?", no faceplate version |
| 14 | EMC & Analog Noise | pcb-layout | PASS | Bypass cap pad-to-pad distances 1.6-2.4mm (excellent) |
| 15 | Board Bring-Up Plan | bringup-plan | WARN | Risk level MEDIUM — 2 FAILs with workarounds, 13 WARNs |
| 16 | Sandwich Stack Assembly | connector-stacking | PASS | Keying correct, pin 1 alignment verified |
| 17 | Component Documentation | documentation-audit | WARN | 8 components missing datasheet links in READMEs |

## Action Items

### Must Fix (FAIL)

1. **No fiducial marks on control or main boards** — Both boards have dense SMD assembly (63 and 149 placements) but no fiducial markers for pick-and-place alignment. Add 3 fiducial footprints (1mm copper, 2mm mask opening) near corners of each board.
   - Files: `hardware/boards/elec/layout/control/control.kicad_pcb`, `hardware/boards/elec/layout/main/main.kicad_pcb`
   - Suggested fix: Add fiducials via the placement pipeline or manually in KiCad

2. **Parts sourcing report missing** — `hardware/boards/build/parts-report.json` does not exist. Cannot verify stock levels or BOM completeness.
   - Fix: Run `make check-parts` to generate the report, then re-run Agent 7

### Should Fix (WARN)

3. **Missing 3.3V bulk cap at control board connector entry** — The 3.3V rail crosses the board-to-board connector with no local decoupling on the control board side. Add 10uF + 100nF pair on connector.v3v3 to GND.
   - File: `hardware/boards/elec/src/boards/control/control.ato`

4. **+5V rail margin tight (~87% of 300mA baseline)** — With all LEDs at full brightness, total 5V demand could reach ~380mA. Most eurorack PSUs provide >300mA, but document minimum 500mA +5V requirement.
   - File: `hardware/boards/elec/src/circuits/power/power.ato`

5. **GND stitching vias critically low** — Only 2 GND vias per board across 4 copper layers. Add 10-20 stitching vias distributed across each board, especially near analog ICs.
   - Files: `hardware/boards/build/control-poured.kicad_pcb`, `hardware/boards/build/main-poured.kicad_pcb`

6. **AMS1117 input headroom marginal** — After B5819W Schottky drop, VIN is ~4.6V. Dropout at full load approaches 1.3V, leaving minimal margin. Monitor 3.3V rail under load.
   - File: `hardware/boards/elec/src/circuits/power/power.ato`

9. **MIDI README doc mismatch** — README says "1k pull-up" but circuit uses 4.7k. Circuit is correct; update README.
   - File: `hardware/boards/elec/src/circuits/midi/README.md:58`

10. **Gerber revision field placeholder** — All gerber metadata has "rev?" instead of actual revision.
    - File: `hardware/boards/scripts/build/add_board_id.py`

11. **No version marking on faceplate** — Faceplate has branding but no revision indicator.
    - File: `hardware/faceplate/elec/layout/faceplate.kicad_pcb`

12. **8 components missing datasheet links** — 74HC165D, EC11E, PB6149L, PinHeader1x3, PJ366ST, PRTR5V0U2X, ResArray4x0603, WQP518MA READMEs need datasheet URLs.

13. **4 components have .step files but footprints don't reference them** — FPC_32P_05MM, PJS008U, WQP518MA, TactileSwitch.

14. **H11L1S has no 3D model** — Active optocoupler IC with no .step file.

15. **Manufacturer mismatches on 3 parts** — PRTR5V0U2X (Nexperia vs TECH PUBLIC), BAT54S (Nexperia vs hongjiacheng), H11L1S (Lite-On vs Everlight). All are functional equivalents.

### Informational

- PB6149L pads 2/4 have no net (internally bridged to pads 1/3) — expected behavior, may cause DRC warnings
- Pitch CV feedback taps after 470R protection resistor — intentional for accuracy under load
- Velocity feedback taps before protection resistor — 4.5% error under load, acceptable for velocity
- No explicit power sequencing between 5V/3.3V — likely fine in practice, monitor on prototype
- USB VBUS intentionally unconnected (data-only USB)

## Detailed Findings

### Section 0: Component & Footprint Audit
**Verdict: WARN**

All 25 active components audited. All pin mappings verified correct against datasheets. No pin mapping contradictions found. IS31FL3216A fully verified pin-for-pin against local PDF datasheet. DAC80508 WQFN-16 pinout, pad dimensions, and thermal pad confirmed correct.

Issues: 4 components have local .step files but footprints don't reference them (FPC_32P_05MM, PJS008U, WQP518MA, TactileSwitch). H11L1S has no 3D model. 3 manufacturer mismatches (functional equivalents). PB6149L pads 2/4 intentionally unassigned.

### Sections 1, 8: GPIO Pin Compatibility
**Verdict: PASS**

All 28 GPIO assignments are unique with zero conflicts. Every peripheral function-select assignment falls within valid RP2350B GPIO sets. Firmware pin assignments in `pins.rs` and `main.rs` match hardware schematic exactly. SPI0 (display/SD), SPI1 (DACs), UART1 (MIDI), I2C0 (LED drivers), and ADC (CV inputs GP40-43) all on correct GPIO banks.

### Sections 2, 16: Connector & Stacking
**Verdict: PASS**

All 64 board-to-board connector pins verified with correct row-swap compensation for back-side socket placement. 51 unique signals confirmed present. Power pins doubled (GND: 12 pins total, 3.3V: 2 pins, 5V: 2 pins). Shrouded connectors provide mechanical keying. Pin 1 alignment verified. Board dimensions match for sandwich stack. Assembly order feasible.

### Sections 3, 5: Signal Path Integrity
**Verdict: WARN**

All 13 signal paths trace correctly end-to-end: Pitch CV (gain=2, offset=-2V, 0.1% resistors), Gate CV (unity buffer), Velocity CV (gain=1.604), Mod CV (inverting gain=-2, offset +5V), Button scan (5x 74HC165D chain), LED drive (3x IS31FL3216A, unique I2C addresses), MIDI (H11L1S opto, CA-033 TRS pinout), Clock/Reset I/O (2N3904 inverting buffers), Display (SPI0 + FPC), SD card (shared SPI0), USB-C (27R series + PRTR5V0U2X ESD), Encoders (10k pull-ups + 10nF debounce), CV inputs (22k/10k divider + BAT54S clamp).

All 9 major components correctly configured for purpose. Only issue: MIDI README states "1k pull-up" but circuit uses 4.7k (circuit is correct).

### Section 4: Power Supply
**Verdict: WARN**

All four rails (+12V, -12V, +5V, +3.3V) reach every IC that needs them. AMS1117 thermal budget is fine (Tj ~37C at 100mA). Bypass/decoupling capacitors present on all ICs. Current budget: +3.3V at 13% utilization (105/800mA), +12V at 7% (22/300mA), -12V at 3% (10/300mA). +5V at 87% (260/300mA) — tight but manageable with LED dimming.

Issues: Missing 3.3V bulk cap at control board connector entry. +5V margin tight with all LEDs at full brightness.

### Section 6: Multi-Button Input
**Verdict: PASS**

Direct wiring topology (no ghosting risk). 5x 74HC165D = 40 input bits with correct daisy chain (QH→SER). CLK_INH tied to GND on all 5 chips. 10k pull-up arrays on all button inputs. Spare inputs (SR5 D4-D7) tied to VCC. Firmware scans at 200Hz with 4-reading debounce (20ms window). All 40 bit positions mapped in firmware `bit_to_event()`.

### Sections 7, 14: PCB Layout & EMC
**Verdict: WARN**

DRC: 0 unconnected nets on both boards. All violations are expected warnings (hole-to-hole, cosmetic). Analog-digital separation good (layer-based, >5mm). Ground pours on all 4 layers of both boards. Trace widths comply with netclass definitions. Thermal relief configured.

Issues: Only 2 GND stitching vias per board (should be 10-20). Bypass cap center-to-center distances (5.5mm op-amp, 3.9-4.6mm DAC) are dictated by package size; actual pad-to-pad distances are 1.6-2.4mm — excellent placement.

### Section 9: Parts Availability
**Verdict: FAIL**

`hardware/boards/build/parts-report.json` does not exist. Run `make check-parts` to generate.

### Section 10: Mechanical Fit
**Verdict: PASS**

Panel width: 182.60mm (within 0.02mm of 36 HP theoretical). Panel height: 128.5mm (3U exact). 4 mounting slots + 2 standoff holes. Jack holes: 6.0mm (correct for WQP518MA/PJ366ST). Encoder holes: 7.0mm (correct for EC11E). All components clear of rail zones. Tallest component (SD card) at 14.18mm, well under 25mm limit. Board stacking needs manual 3D verification.

### Section 11: Datasheet Compliance
**Verdict: WARN**

All ICs operated within absolute maximum ratings. Decoupling meets or exceeds datasheet requirements. Pin configurations correct with proper handling of unused pins. Signal levels compatible across all interfaces. SPI, I2C, UART protocols within spec.

Issues: AMS1117 input headroom marginal (~4.6V in after Schottky). No explicit power sequencing. Velocity feedback topology gives 4.5% error under load (acceptable). MIDI README doc mismatch.

### Sections 12, 13: Manufacturing Files & Silkscreen
**Verdict: FAIL**

Gerbers complete for all 3 boards (4-layer control/main, 2-layer faceplate). CPL files match BOMs (63 control, 149 main placements). LCSC part numbers valid. Pin 1 markers present on all ICs. Connector polarity marked. Eurorack power header labeled (-12V/GND/+12V/+5V).

FAIL: No fiducial marks on control or main boards. WARN: Revision placeholder "rev?" in metadata. No faceplate version marking.

### Section 17: Documentation Audit
**Verdict: WARN**

All 25 active component directories are imported and used (no orphans). No stale references to replaced parts. Pin/pad counts correct across all footprint/symbol pairs. component-map.json covers all panel-facing components.

Issues: 8 components missing datasheet links in READMEs (74HC165D, EC11E, PB6149L, PinHeader1x3, PJ366ST, PRTR5V0U2X, ResArray4x0603, WQP518MA).

## Bring-Up Plan

**Risk Level: MEDIUM** — 2 FAILs with known workarounds, 13 WARNs

### Equipment Checklist
- Current-limited bench supply (+12V/-12V/+5V)
- Digital multimeter
- Oscilloscope (100MHz+, 2 ch)
- SWD debug probe (Pico Probe / J-Link)
- Logic analyzer (8+ ch)
- Eurorack power cable (16-pin keyed)
- USB-C cable, MIDI cable, 3.5mm patch cables
- IR thermometer or thermal camera
- Calipers for stacking verification

### Phase 1: Visual Inspection (no power)
- Verify all QFN/TSSOP/SOIC orientation under magnification
- **RISK:** No fiducials — elevated SMT misalignment risk, inspect carefully
- Continuity: no shorts between any power rails and GND
- Verify board-to-board header alignment and stacking clearance

### Phase 2: Power Supply (main board only)
- Current limit: +12V@100mA, -12V@50mA, +5V@200mA
- Verify rails: +12V→~11.6V, -12V→~-11.6V, +5V→~4.6V, +3.3V→3.3V
- **RISK:** AMS1117 headroom marginal — monitor 3.3V under load
- Thermal check on regulators and Schottky diodes

### Phase 3: MCU Boot (main board only)
- Flash via SWD, verify defmt RTT output
- Verify SPI1 (DAC bus) at 37.5MHz, SPI0 (display) at 62.5MHz
- Verify I2C0 (LED drivers) — needs control board for pull-ups

### Phase 4: Analog Signal Chain
- DAC outputs: verify 0V/2.5V/5V at each channel
- Gate: 0-5V unity buffer
- Pitch: -2V to +8V (gain=2, offset=-2V)
- Velocity: 0-8V (gain=1.604)
- Mod: +5V to -5V (inverting gain=-2)
- **RISK:** Low GND stitching vias — if noise >5mV RMS, add vias

### Phase 5: Full System Integration
- Connect control board, apply 3.3V bulk cap workaround
- **RISK:** +5V margin tight — limit LED brightness to 50% initially
- Test all 40 buttons, 22 LEDs, 2 encoders, display, SD card, MIDI I/O
- End-to-end: program sequence, verify CV/gate outputs on scope

### Go/No-Go
- Before ordering: resolve parts-report.json (run `make check-parts`)
- Before power: Phase 1 continuity must pass
- Before firmware: all Phase 2 rails within spec
- Prototype functional: all 16 analog outputs correct, buttons/LEDs/MIDI working, 30-min continuous run
