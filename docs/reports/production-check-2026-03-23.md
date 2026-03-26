# Production Validation Report — Requencer
**Date:** 2026-03-23
**Verdict:** DO NOT MANUFACTURE

## Summary

| # | Section | Agent | Verdict | Issues |
|---|---------|-------|---------|--------|
| 0 | Component & Footprint Audit | footprint-audit | WARN | 0 FAIL, 10 WARN — missing 3D model refs, manufacturer mismatches |
| 1 | GPIO Function-Select | gpio-pin-compat | PASS | All 30 GPIOs valid, firmware matches schematic |
| 2 | Connector Pin Matching | connector-stacking | WARN | 0 FAIL, 3 WARN — +12V/-12V single pin, 3D check needed |
| 3 | Signal Path Integrity | signal-path | WARN | 0 FAIL, 7 WARN — MIDI CA-033, SD detect, encoder debounce |
| 4 | Power Supply | power-supply | PASS | All rails correct, Tj=66°C, current within budget |
| 5 | Component-Purpose Fitness | signal-path | WARN | Covered by signal-path agent above |
| 6 | Multi-Button Input | button-scan | PASS | Direct wiring, 200Hz scan, 40 bits mapped |
| 7 | Routing Quality | pcb-layout | FAIL | 4 FAIL, 6 WARN — decoupling placement, GND vias |
| 8 | Firmware-Pin Compat | gpio-pin-compat | PASS | Covered by gpio-pin-compat agent above |
| 9 | Parts Availability | parts-sourcing | WARN | 0 FAIL, 6 WARN — low stock DAC/OPA, extended parts fees |
| 10 | Mechanical Fit | mechanical-fit | WARN | 0 FAIL, 1 WARN — board stacking needs 3D check |
| 11 | Datasheet Compliance | datasheet-compliance | WARN | 0 FAIL, 4 WARN — I2C rise time, AMS1117 cap margin |
| 12 | Manufacturing Output | manufacturing-files | FAIL | 3 FAIL, 2 WARN — missing pin 1 markers on 11 ICs |
| 13 | Silkscreen & Markings | manufacturing-files | FAIL | Covered by manufacturing-files agent above |
| 14 | EMC & Analog Noise | pcb-layout | FAIL | Covered by pcb-layout agent above |
| 15 | Board Bring-Up Plan | bringup-plan | WARN | Risk level HIGH, workarounds identified |
| 16 | Sandwich Stack Assembly | connector-stacking | WARN | Covered by connector-stacking agent above |
| 17 | Component Documentation | documentation-audit | WARN | 0 FAIL, 6 WARN — stale READMEs, missing catalog entries |

## Action Items

### Must Fix (FAIL)

1. **Decoupling caps far from OPA4171 op-amps** — 4/5 OPA4171A ICs (X1, X4, X8, X15) have zero bypass caps within 10mm. 100nF on VCC and VEE should be within 2mm. — `hardware/boards/build/main-poured.kicad_pcb` — Fix: Re-place bypass caps adjacent to each OPA4171A IC.

2. **Decoupling caps far from PGA2350 MCU** — X28 (PGA2350) at (70,42) has zero caps within 10mm. MCU datasheet requires multiple 100nF close to power pins. — `hardware/boards/build/main-poured.kicad_pcb` — Fix: Place 4x 100nF within 2mm of PGA2350 power pins.

3. **Decoupling caps far from IS31FL3216A** — U8 and U6 on control board have zero caps within 10mm. — `hardware/boards/build/control-poured.kicad_pcb` — Fix: Place 100nF adjacent to each IS31FL3216A VCC pin.

4. **DAC80508 bypass caps 7-8mm away** — X13 and X22 have nearest bypass caps at 6.8-8.2mm. For a 16-bit DAC, caps must be within 1-2mm. — `hardware/boards/build/main-poured.kicad_pcb` — Fix: Place 100nF + 10uF within 2mm of each DAC power pin.

5. **OPA4171A TSSOP-14 missing pin 1 silkscreen** — 5 ICs (U3-U7) on main board have no pin 1 indicator, only body outline lines. — Fix: Add pin 1 dot (fp_circle ~0.3mm) near pad 1 on F.SilkS in the TSSOP-14 footprint.

6. **74HC165D SOIC-16 missing pin 1 silkscreen** — 5 ICs (U1-U5) on control board have no pin 1 indicator. Critical for debugging button scan chain. — Fix: Add pin 1 dot or notch on the SOIC-16 footprint's F.SilkS layer.

7. **AMS1117-3.3 SOT-223 no silkscreen at all** — U9 on main board has zero silkscreen elements. — Fix: Add body outline and tab indicator on F.SilkS for the SOT-223 footprint.

### Should Fix (WARN)

1. **Only 3 GND stitching vias on main board** — Zero near analog ICs. — Fix: Add GND stitching vias at ~5mm spacing, especially near OPA4171A and DAC80508.

2. **SPI clock 0.73mm from CV trace** — SPI1 SCK runs 0.73mm from dac-IN3_P on F.Cu, below 1mm target. — Fix: Route SCLK on inner layer or increase separation.

3. **Signal traces under DAC80508** — X22 has 3 signal segments on B.Cu under IC, slotting ground plane. — Fix: Reroute signals to avoid bisecting ground under DAC.

4. **Zones use solid pad connection** — No thermal relief on GND zones. Makes THT soldering difficult. — Fix: Change zone pad connection to thermal relief for THT pads.

5. **Power sub-net traces at 0.15mm** — Named power nets (c_op5_p-power-hv, etc.) routed at 0.15mm. — Fix: Assign to Power netclass or increase width.

6. **No bulk caps at board-to-board connectors** — Neither ShroudedHeader2x16 has bulk caps within 10mm. — Fix: Place 10-22uF on each power rail near connectors.

7. **I2C at 400kHz may have slow rise times** — 4.7k pull-ups + ~200pF bus capacitance = ~752ns rise time (max 300ns for Fast Mode). — Fix: Reduce pull-ups to 2.2k or lower I2C frequency to 100kHz.

8. **AMS1117 output cap exactly 22uF** — Zero margin above datasheet minimum. — Fix: Increase to 47uF for improved transient response.

9. **DAC80508 low stock (137 units at JLCPCB)** — Safety margin 0.27x. — Fix: Pre-order from TI distributors or identify backup supplier.

10. **OPA4171A low stock (370 units JLCPCB, 2 units LCSC)** — Safety margin 0.30x. — Fix: Order immediately; identify OPA4172/OPA4192 as pin-compatible alternatives.

11. **Missing 3D model references in footprints** — FPC_32P_05MM, PJS008U, WQP518MA, TactileSwitch have .step files but no `(model ...)` in .kicad_mod. — Fix: Add model references.

12. **H11L1S, ResArray4x0603, PinHeader1x3 missing .step files** — No 3D models exist for these components. — Fix: Source or create .step models.

13. **MIDI IN pull-up is 1k** — Wastes 3.3mA continuously. — Fix: Replace with 4.7k-10k.

14. **No pull-up on SD CS line** — During MCU boot delay, CS may float. — Fix: Add 10k pull-up at SD connector end.

15. **No base-emitter resistor on clock/reset NPN** — Output state undefined during MCU boot. — Fix: Add 100k B-E pull-down resistors.

16. **USB shield direct to GND** — No EMI filtering. — Fix: Add 1nF cap or ferrite between shield and GND.

17. **ShroudedHeader2x16 pin 1 subtle** — Only a short line segment. — Fix: Add "1" text label near pin 1 pad.

18. **PJS008U README says "card detect switch"** — Part has none. — Fix: Update README.

19. **button-scan.ato says "34 buttons"** — 36 are instantiated. — Fix: Update comments to 36.

20. **Components README lists TactileSwitch as THT** — Is SMD (TS-1187A). — Fix: Change to SMD.

21. **PinHeader1x3 missing from components catalog** — Used for SWD debug. — Fix: Add entry to README.

22. **Missing 3D models for DAC80508, IS31FL3216A, connectors** — Needed for assembly verification. — Fix: Source QFN models and connector models.

### Informational

- **+12V/-12V single pin on connector** — Acceptable since these rails are low-current on control board side (only op-amps on main board consume significant +/-12V).
- **MIDI OUT uses CA-033 3.3V resistor values** — Correct per spec for 3.3V transmitters. Compatible with most modern MIDI equipment.
- **Encoder debounce caps are 10nF** — By design; real debounce is in firmware PIO state machine.
- **SD card has no hardware detect** — PJS008U-3000-0 variant lacks detect switch. Firmware uses SPI probe as fallback.
- **DAC80508 WQFN-16 has no LDAC/CLR pins** — Package limitation; updates are immediate on SPI write. Acceptable for eurorack CV rates.
- **H11L1S output pull-up to 3.3V while VCC is 5V** — Valid mixed-voltage open-collector configuration. Logic levels compatible with PGA2350.
- **7 extended-library SMD parts** — $21/board in JLCPCB setup fees. Expected for a specialized design.
- **All THT parts are single-source** — Typical for eurorack-specific parts (Thonkiconn jacks, PB6149L buttons).
- **Board stacking clearance** — Requires manual 3D verification in CAD viewer. 10mm standoffs provide clearance.
- **Manufacturer mismatches on LCSC** — BAT54S (hongjiacheng vs Nexperia), H11L1S (Everlight vs Lite-On), PRTR5V0U2X (TECH PUBLIC vs Nexperia). Functional equivalents, acceptable.
- **Negative Y coordinates in CPL** — KiCad convention. JLCPCB handles this automatically during upload.

## Detailed Findings

### Section 0: Footprint Audit (Agent 0) — WARN

All pin mappings verified correct against datasheets for all 25 active components. No FAIL issues.

Key findings:
- All fine-pitch ICs (DAC80508 WQFN-16, IS31FL3216A QFN-28, OPA4171A TSSOP-14, PRTR5V0U2X SOT-143B) have correct pad dimensions within IPC ranges.
- All QFN/WQFN exposed/thermal pads are declared and connected to GND.
- Pin count matches between .ato, .kicad_sym, and .kicad_mod for every component.
- 4 footprints have .step files but missing `(model ...)` references.
- 3 components lack .step files entirely (H11L1S, ResArray4x0603, PinHeader1x3).
- 3 manufacturer mismatches on LCSC-sourced parts (functional equivalents).

### Sections 1, 8: GPIO Pin Compatibility (Agent 1) — PASS

All 30 GPIOs correctly assigned:
- SPI0: GP0 (RX), GP2 (SCK), GP3 (TX) — valid
- SPI1: GP30 (SCK), GP31 (TX) — valid
- UART1: GP20 (TX), GP21 (RX) — valid
- I2C0: GP12 (SDA), GP13 (SCL) — valid
- ADC: GP40-43 — valid (only ADC-capable pins)
- All plain GPIO assignments conflict-free
- Firmware (main.rs, pins.rs) matches mcu.ato exactly for all 33 pin assignments

### Sections 2, 16: Connector & Stacking (Agent 2) — WARN

All 64 board-to-board connector pins verified matching:
- Header A (32 pins): digital signals + power. B-side row-swap correctly compensates X-mirror.
- Header B (32 pins): analog signals + clock/reset. GND pins shield between analog groups.
- Power: GND (11 pins), 3V3 (2), 5V (2), +12V (1), -12V (1).
- All inter-board signals present: SPI, I2C, button scan, encoders, MIDI, clock/reset, CV, DAC outputs, SD card, USB (stays on main board).
- Connector keying: shrouded Amphenol polarized connectors prevent reverse insertion.
- Pin 1 alignment: row-swap logic verified for all 64 pins.

### Sections 3, 5: Signal Path Integrity (Agent 3) — WARN

All 13 signal paths trace correctly end-to-end. No broken paths or wrong polarities.

**Pitch CV:** DAC1 OUT4-7 → opamp2 (gain=2, offset=-2V) → 470Ω → jack. 0.1% resistors. Range: -2V to +8V. ✓
**Gate CV:** DAC1 OUT0-3 → opamp1 (unity buffer) → 470Ω → jack. Range: 0-5V. ✓
**Velocity CV:** DAC2 OUT0-3 → opamp3 (gain=1.604) → 470Ω → jack. Range: 0-8V. ✓
**Mod CV:** DAC2 OUT4-7 → opamp4 (inv gain=-2, offset=+5V) → 470Ω → jack. Range: -5V to +5V. ✓
**Button scan:** 5× 74HC165D daisy chain, direct wiring, all pull-ups present. ✓
**LED drive:** 3× IS31FL3216A at unique I2C addresses (0x68, 0x6A, 0x6B). ✓
**MIDI:** CA-033 3.3V spec OUT (10Ω/33Ω), H11L1S optocoupler IN with protection diode. ✓
**Clock/Reset:** Input protection (22k/10k + BAT54S + filter). NPN output with firmware inversion. ✓
**Display:** SPI0 → FPC 32-pin. RC reset, MOSFET backlight control, IM pins for SPI mode. ✓
**SD card:** SPI0 shared with display. MISO connected. No hardware card detect. ✓
**USB-C:** 27Ω series, 5.1k CC pull-downs, PRTR5V0U2X ESD. Data-only (no VBUS). ✓
**Encoders:** 10k pull-ups, 10nF RF filter caps. Firmware debounce via PIO. ✓
**CV inputs:** 22k/10k divider → BAT54S clamp → 100nF → ADC GP40-43. ✓

### Section 4: Power Supply (Agent 4) — PASS

All rails verified connected to every consumer. No missing connections.

| Rail | Total | Capacity | Margin | Status |
|------|-------|----------|--------|--------|
| +12V | 17.5mA | 300mA | 94% | PASS |
| -12V | 17.5mA | 300mA | 94% | PASS |
| +5V | 190mA | 300mA | 37% | PASS |
| +3.3V | 154.5mA | 800mA | 81% | PASS |

AMS1117 thermal: Pdiss=0.263W, Tj=66°C (well under 100°C limit).
DAC AVDD isolated via 10Ω + 10µF LC filter from LED switching noise.
All ICs have proper bypass caps (in schematic — placement distance is the issue flagged by Agent 6).

### Section 6: Button Scan (Agent 5) — PASS

- Direct wiring topology — no ghosting possible at any combination of simultaneous presses.
- 5× 74HC165D = 40 bits. 36 buttons + 4 spare tied to VCC.
- Chain fully connected: SR1→SR2→SR3→SR4→SR5→MCU GP10.
- CLK_INH tied LOW on all SRs. First SR SER tied to GND.
- 9 resistor arrays (36 pull-ups) for all button inputs.
- Firmware scans at 200Hz with 4-sample debounce (20ms).
- All 40 bit positions mapped in `buttons.rs` (36 events + 4 spare → None).

### Sections 7, 14: PCB Layout & EMC (Agent 6) — FAIL

**DRC:** All violations are expected and documented in board-config.json (IS31FL3216A thermal vias, cosmetic silkscreen/courtyard). Zero unrouted nets.

**Critical placement issues:**
- OPA4171A bypass caps are 19-43mm from the ICs (clustered at bottom of board while ICs are at top).
- PGA2350 has zero caps within 10mm.
- DAC80508 caps are 6.8-8.2mm away.
- IS31FL3216A (2 of 3) have zero caps within 10mm.

**Routing quality:**
- Ground pours on all 4 layers (F.Cu, In1.Cu, In2.Cu, B.Cu) on both boards.
- Only 3 GND stitching vias on main board (all near one DAC).
- Power traces at 0.2mm (below 0.3mm target but acceptable with 4-layer pour). Sub-nets at 0.15mm.
- Zones use solid pad connections (no thermal relief).
- SPI1 SCK 0.73mm from CV trace (below 1mm target).
- Signal traces under DAC80508 X22 (3 segments on B.Cu).

### Section 9: Parts Sourcing (Agent 7) — WARN

All 15 SMD parts found at JLCPCB. All 10 THT parts have at least one supplier.

Low-stock critical parts:
| Part | Stock | Safety (50x) | Risk |
|------|-------|-------------|------|
| DAC80508ZRTER | 137 | 0.27 | HIGH |
| OPA4171AIPWR | 370 | 0.30 | HIGH |
| IS31FL3216A | 3,047 | 4.06 | MEDIUM |

7 extended-library SMD parts = $21/board JLCPCB setup fees.

### Section 10: Mechanical Fit (Agent 8) — WARN

- Panel: 182.60mm × 128.5mm (36HP × 3U) — correct.
- 4 mounting slots: 7.0 × 3.5mm oval at correct positions.
- Jack holes: 6.0mm (WQP518MA/PJ366ST). Encoder holes: 7.0mm (EC11E). Both correct.
- Rail zone clearance: all components clear. Closest: MIDI OUT jack at 3.0mm from bottom zone.
- Tallest component behind panel: SD card at 14.18mm (well under 25mm skiff limit).
- Board stacking: 10mm standoffs. Manual 3D verification recommended.

### Section 11: Datasheet Compliance (Agent 9) — WARN

All absolute maximum ratings safe across all 12 ICs. All supply voltages within recommended operating ranges.

Key findings:
- I2C bus at 400kHz with 4.7k pull-ups: rise time ~752ns (max 300ns for Fast Mode). Risk of communication errors.
- AMS1117 output cap 22µF = exactly minimum spec. Zero margin.
- DAC80508 SPI Mode 1 verified correct. 37.5MHz clock within 50MHz max.
- All op-amp channels properly configured (no floating inputs).
- IS31FL3216A R_EXT=3.3kΩ sets ~5.7mA LED current (conservative, within 40mA max).
- H11L1S mixed-voltage operation valid (open-collector to 3.3V with 5V VCC).

### Sections 12, 13: Manufacturing Files (Agent 10) — FAIL

**Gerbers:** All present and fresh for control (4-layer), main (4-layer), faceplate (2-layer). Dimensions match board-config.json.

**BOM/CPL:** 62 SMD components on control, 149 on main. All LCSC numbers valid. Designators match between BOM and CPL. Rotations verified for all IC packages.

**Silkscreen failures:**
- OPA4171A TSSOP-14 (5 ICs): no pin 1 marker, only body outline.
- 74HC165D SOIC-16 (5 ICs): no pin 1 marker, only body outline.
- AMS1117-3.3 SOT-223 (1 IC): no silkscreen at all.
- Total: 11 ICs without pin 1 orientation markers.

Board identification present: "requencer control proto001" and "requencer main proto001" on B.SilkS.
Eurorack power header fully labeled (-12V/GND/+12V/+5V).

### Section 15: Bring-Up Plan (Agent 12) — WARN

**Risk Level: HIGH** — Multiple FAILs from Agent 6 (decoupling placement) and Agent 10 (missing pin 1 markers).

5-phase bring-up sequence defined with all agent findings incorporated as RISK items at relevant phases. Key workarounds:
- Prepare 100nF 0402/0603 caps for tack-soldering near ICs if noise issues arise.
- Verify all 11 unmarked IC orientations under microscope before power-on.
- If I2C fails, reduce to 100kHz or replace 4.7k pull-ups with 2.2k.

SWD debug header present and accessible. BOOTSEL button provides secondary programming path. No dedicated power rail test points (prototype acceptable).

### Section 17: Documentation (Agent 11) — WARN

All 25 active components have READMEs with datasheet links. All footprints and symbols present. No orphan components.

Stale documentation:
- PJS008U README claims card detect switch (part has none).
- button-scan.ato comments say 34 buttons (36 instantiated).
- Components README lists TactileSwitch as THT (is SMD).
- PinHeader1x3 missing from catalog.

LCSC spot-check: 8/8 parts resolved correctly. OPA4171AIPWR stock critically low (2 units).

## Bring-Up Plan

**Risk Level: HIGH**

### Equipment Checklist
- Current-limited dual-rail bench supply
- Multimeter (V, Ω, diode mode)
- Oscilloscope (≥50MHz, 2ch)
- SWD debugger (RP2350-compatible)
- Pre-built firmware (blinky + full)
- Eurorack 16-pin power cable
- USB-C data cable
- MIDI TRS Type A cable + source
- 3.5mm patch cables (×6)
- USB microscope (≥10x)
- MicroSD card (FAT32)
- IR thermometer

### Phase Sequence
1. Visual inspection — verify all 11 unmarked ICs, continuity checks
2. Power supply — main board only, measure all rails, check thermals
3. MCU alive — SWD flash, blinky test, USB enumeration
4. Board-to-board — connect control board, re-verify rails
5. Peripherals — display → buttons → LEDs → encoders → DAC → MIDI → clock/reset → CV → SD

### Critical Workarounds
- **Decoupling:** Have 10+ 100nF 0402 caps ready. Tack-solder near PGA2350, DAC80508, OPA4171A if noise/instability observed.
- **IC orientation:** Verify all OPA4171A, 74HC165D, AMS1117 orientations against datasheet before power-on. Reversed ICs will short power rails.
- **I2C:** If LED drivers fail to communicate, reduce to 100kHz or swap 4.7k pull-ups for 2.2k.
- **Parts:** Order OPA4171AIPWR and DAC80508ZRTER immediately — stock critically low.
