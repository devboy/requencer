# Production Validation Report — Requencer
**Date:** 2026-03-24
**Verdict:** DO NOT MANUFACTURE

## Summary

| # | Section | Agent | Verdict | Issues |
|---|---------|-------|---------|--------|
| 0 | Component & Footprint Audit | footprint-audit | WARN | 7 missing 3D model refs, 3 manufacturer mismatches |
| 1 | GPIO Function-Select | gpio-pin-compat | PASS | — |
| 2 | Connector Pin Matching | connector-stacking | PASS | — |
| 3 | Signal Path Integrity | signal-path | WARN | MIDI CA-033 resistors, SD card detect unconnected, encoder debounce 10nF, NPN no base-emitter R |
| 4 | Power Supply | power-supply | PASS | — |
| 5 | Component-Purpose Fitness | signal-path | WARN | (covered by signal-path agent above) |
| 6 | Multi-Button Input | button-scan | PASS | — |
| 7 | Routing Quality | pcb-layout | WARN | USB traces 0.1mm, GND stitching vias sparse, bypass caps too far from ICs |
| 8 | Firmware-Pin Compat | gpio-pin-compat | PASS | — |
| 9 | Parts Availability | parts-sourcing | WARN | DAC80508 137 units, OPA4171 370 units, 7 extended parts |
| 10 | Mechanical Fit | mechanical-fit | WARN | Board stacking needs 3D verification |
| 11 | Datasheet Compliance | datasheet-compliance | **FAIL** | **IS31FL3216A R_EXT = 3.3kohm → 509mA/ch (should be ~73kohm)** |
| 12 | Manufacturing Output | manufacturing-files | WARN | Missing pin 1 dots on QFN/TSSOP/SOIC footprints |
| 13 | Silkscreen & Markings | manufacturing-files | WARN | ShroudedHeader2x16 lacks "1" label |
| 14 | EMC & Analog Noise | pcb-layout | WARN | Signal traces under OPA4171, no bulk caps at B2B connectors |
| 15 | Board Bring-Up Plan | bringup-plan | WARN | R_EXT rework required before control board power-on |
| 16 | Sandwich Stack Assembly | connector-stacking | WARN | +12V/-12V single-pin, mating height vs gap needs verification |
| 17 | Component Documentation | documentation-audit | WARN | OPA4171 0 stock at LCSC, 6 missing 3D models |

## Action Items

### Must Fix (FAIL)

1. **IS31FL3216A R_EXT = 3.3kohm is critically wrong** — `hardware/boards/elec/src/circuits/led-driver/led-driver.ato` — Datasheet formula: I_LED = (1.2/R_EXT[kohm]) × 1400. With 3.3kohm: 509mA/ch, massively exceeding 21mA max. Value was carried over from IS31FL3236A (different formula). **Fix:** Change `r_ext_a/b/c.resistance` from `3.3kohm` to `82kohm` (gives ~20.5mA) or `73kohm` (gives ~23mA).

### Should Fix (WARN)

2. **USB traces at 0.1mm below JLCPCB 0.15mm floor** — `hardware/boards/build/main-poured.kicad_pcb` — 12 DP/DM segments near USB-C connector. Fix: widen to ≥0.15mm or add to expected DRC exceptions if impedance-matched.

3. **Bypass caps too far from critical ICs** — `hardware/boards/build/main-poured.kicad_pcb` — PGA2350 caps at 16mm (target <2mm), OPA4171 caps at 5.5mm, IS31FL3216A at 5.3mm. Fix: adjust placement constraints to force satellite caps closer.

4. **No GND stitching vias near analog ICs** — `hardware/boards/build/main-poured.kicad_pcb` — Only 3 GND vias on main board, 0 within 5mm of DAC80508 or OPA4171. Fix: add 3-5 stitching vias near each precision analog IC.

5. **Signal traces under OPA4171 on opposite layer** — `hardware/boards/build/main-poured.kicad_pcb` — 12 segments under U5, 3 under X19 (DAC). May create ground plane slots. Fix: re-route traces to avoid passing under analog ICs.

6. **No bulk caps near board-to-board connectors** — Both boards — Closest bulk cap 12.6mm away on main, 18.2mm on control. Fix: add 10uF bulk caps within 5mm of connector footprints.

7. **No thermal relief on zone connections** — Both boards — Solid zone connections make THT rework harder. Fix: enable thermal relief for THT pads in zone settings.

8. **IS31FL3216A QFN-28 lacks pin 1 silkscreen dot** — `hardware/boards/elec/src/components/IS31FL3216A/QFN-28-4x4.kicad_mod` — Add fp_circle near pad 1 on F.SilkS.

9. **OPA4171AIPWR shows 0 stock at LCSC (C529553)** — `hardware/boards/build/parts-report.json` — Source from DigiKey/Mouser or find alternate LCSC listing.

10. **DAC80508ZRTER critically low stock (95-137 units at LCSC)** — `hardware/boards/build/parts-report.json` — Pre-order or source from alternate suppliers.

11. **Missing 3D model references in footprints** — FPC_32P_05MM, PJS008U, WQP518MA, TactileSwitch have .step files but no `(model ...)` ref. H11L1S and ResArray4x0603 lack .step files entirely.

12. **+12V/-12V use single pins through board connector** — `hardware/boards/elec/src/circuits/board-connector/board-connector.ato` — Adequate current but no redundancy. Consider doubling in next revision.

13. **No base-emitter pull-down on NPN clock/reset outputs** — `hardware/boards/elec/src/boards/main/main.ato` — GPIO tristate during boot could cause spurious output. Add 100kohm base-emitter resistors.

14. **7 extended-library SMD parts on JLCPCB** — $21 extra per assembly run. Consider finding basic/preferred alternatives.

15. **All 9 THT parts are single-source** — Add alternative suppliers for supply chain resilience.

### Informational

- MIDI OUT uses CA-033 reduced resistors (10R/33R) — correct per 3.3V spec, test with multiple receivers.
- SD card detect physically unconnected — firmware uses SPI probe, which is functional.
- Encoder debounce caps are 10nF — intentional, PIO gray-code state machine handles debounce.
- USB shield direct to GND without ferrite — acceptable for data-only connection.
- Connector mating height vs 13.5mm board gap — verify with physical assembly.
- Board stacking clearance — verify in CAD with STEP assembly.
- H11L1S output pull-up to 3.3V (not 5V VCC) — intentional level translation, correct.
- BAT54S, H11L1S, PRTR5V0U2X manufacturer mismatches — functional equivalents, acceptable.

## Detailed Findings

### Section 0: Component & Footprint Audit

**Verdict: WARN**

All 25 active components audited. Every pin mapping verified correct against datasheets. Pad counts match between .ato, .kicad_sym, and .kicad_mod for all components.

| Component | Pin Map | Pad Count | 3D Model | Status |
|-----------|---------|-----------|----------|--------|
| DAC80508ZRTER | PASS | 17 (16+EP) | KiCad lib | PASS |
| PGA2350 | PASS | 64 | Custom .step | PASS |
| IS31FL3216A | PASS | 29 (28+EP) | KiCad lib | PASS |
| OPA4171AIPWR | PASS | 14 | KiCad lib | PASS |
| PRTR5V0U2X | PASS | 4 | KiCad lib | PASS |
| BAT54S | PASS | 3 | KiCad lib | PASS |
| H11L1S | PASS | 6 | **Missing** | WARN |
| 2N3904 | PASS | 3 | KiCad lib | PASS |
| 2N7002 | PASS | 3 | KiCad lib | PASS |
| B5819W | PASS | 2 | KiCad lib | PASS |
| 74HC165D | PASS | 16 | KiCad lib | PASS |
| ShroudedHeader2x16 | PASS | 32 | KiCad lib | PASS |
| ShroudedSocket2x16 | PASS | 32 | KiCad lib | PASS |
| USB_C_Receptacle | PASS | 17 | Custom .step | PASS |
| FPC_32P_05MM | PASS | 34 | .step no ref | WARN |
| PJS008U | PASS | 10 | .step no ref | WARN |
| PB6149L | PASS | 6 | Custom .step | PASS |
| EC11E | PASS | 7 | Custom .step | PASS |
| WQP518MA | PASS | 3 | .step no ref | WARN |
| PJ366ST | PASS | 3 | Custom .step | PASS |
| TactileSwitch | PASS | 4 | .step no ref | WARN |
| ResArray4x0603 | PASS | 8 | **Missing** | WARN |
| AMS1117-3.3 | PASS | 4 | KiCad lib | PASS |
| EurorackPowerHeader16 | PASS | 16 | KiCad lib | PASS |
| PinHeader1x3 | PASS | 3 | **Missing** | WARN |

### Section 1 & 8: GPIO Pin Compatibility & Firmware Match

**Verdict: PASS**

All 28 GPIO assignments verified correct. Every peripheral pin on valid RP2350 function-select bank. No conflicts. Firmware matches schematic exactly. Spare GPIOs: GP11, GP14, GP23, GP29, GP34-39, GP44-47.

### Section 2 & 16: Connector Pin Matching & Sandwich Stack

**Verdict: WARN**

All 64 pins verified matching between boards after B-side row-swap compensation. Power distribution: GND 12 pins, 3.3V 2 pins, 5V 2 pins, +12V 1 pin, -12V 1 pin. All required inter-board signals present (SPI, I2C, button scan, encoders, MIDI, clock/reset, CV, DAC outputs).

### Section 3 & 5: Signal Path Integrity & Component Fitness

**Verdict: WARN**

All 13 signal paths verified end-to-end. Gain/offset calculations confirmed:
- Pitch CV: gain=2, offset=-2V, 0.1% resistors → -2V to +8V ✓
- Gate CV: unity buffer → 0-5V ✓
- Velocity: gain=1.604 → 0-8V ✓
- Mod CV: inverting gain=-2, offset=+5V → -5V to +5V ✓
- All digital buses correctly wired (SPI, I2C, UART, shift register chain)
- All protection circuits verified (BAT54S clamps, PRTR5V0U2X ESD, NPN buffers)

### Section 4: Power Supply

**Verdict: PASS**

| Rail | Load | Capacity | Margin | Tj |
|------|------|----------|--------|----|
| +12V | 20mA | 300mA | 93% | — |
| -12V | 20mA | 300mA | 93% | — |
| +5V | 179mA | 300mA | 40% | — |
| +3.3V | 100mA | 800mA | 88% | 55.3°C |

All ICs properly decoupled. DAC AVDD filtered through 10R + 10µF. Cross-board isolation adequate.

### Section 6: Multi-Button Input

**Verdict: PASS**

Direct wiring, 5× 74HC165D, 36 buttons + 4 spare, 200Hz scan, all positions mapped.

### Section 7 & 14: PCB Layout & EMC

**Verdict: WARN**

DRC clean (all violations expected). 4-layer stackup with ground fills on all layers. Issues: USB trace width, missing stitching vias, bypass cap distances, signal traces under analog ICs, no bulk caps at connectors, no thermal relief.

### Section 9: Parts Sourcing

**Verdict: WARN**

15/15 SMD parts found. 7 extended-library ($21/run). Critical: DAC80508 137 units, OPA4171 370 units (0 at LCSC). All THT single-source.

### Section 10: Mechanical Fit

**Verdict: WARN**

182.60mm × 128.5mm panel correct. All holes correct diameter. All components clear of rail zones. Stacking needs 3D verification.

### Section 11: Datasheet Compliance

**Verdict: FAIL**

IS31FL3216A R_EXT = 3.3kohm → I_LED = (1.2/3.3) × 1400 = 509mA/ch. Max rated: 21mA. Recommended min R_EXT: 100kohm. Target 23mA requires 73kohm. All other ICs pass.

### Section 12 & 13: Manufacturing & Silkscreen

**Verdict: WARN**

All files present and fresh. CPL/BOM complete. Missing pin 1 dots on IS31FL3216A QFN-28, OPA4171A TSSOP-14, 74HC165D SOIC-16. Board IDs present ("requencer control/main proto001").

### Section 17: Documentation

**Verdict: WARN**

All 25 components documented. No stale references. No orphans. Missing 3D models for 6 components. OPA4171 0 stock at LCSC.

## Bring-Up Plan

**Risk Level: HIGH (single FAIL with bench-rework workaround → effective MEDIUM)**

### Execution Order

1. Visual inspection + continuity checks
2. **R_EXT REWORK: Replace 3× 3.3kohm with 82kohm on control board**
3. Power main board only → verify rails
4. Flash firmware via SWD → verify MCU + USB
5. Connect control board → re-verify rails
6. Test: Display → Buttons → LEDs → Encoders → DAC → MIDI → Clock/Reset → CV → SD

### Equipment Required

- Current-limited bench supply, multimeter, oscilloscope (≥50MHz)
- SWD debugger (Picoprobe), USB-C cable, MIDI TRS cable
- 3× 82kohm 0402 resistors for R_EXT rework
- Solder station + tweezers for 0402 rework

### Known Issues & Workarounds

| # | Issue | Workaround | Permanent Fix |
|---|-------|------------|---------------|
| 1 | R_EXT 3.3kohm → 509mA/ch | Replace with 82kohm before power-on | Change in led-driver.ato |
| 2 | Bypass caps far from ICs | Bodge 100nF if noise observed | Adjust placement |
| 3 | USB traces 0.1mm | Use SWD instead | Re-route ≥0.15mm |
| 4 | No thermal relief | Higher iron temp + flux | Enable in zone settings |
| 5 | NPN no base-emitter R | Accept brief boot glitch | Add 100kohm |
| 6 | OPA4171 0 stock LCSC | Source DigiKey/Mouser | Find alt listing |
