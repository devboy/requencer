# Production Check Skill Design

**Date:** 2026-03-21
**Status:** Approved

## Overview

A Claude Code skill (`/production-check`) that dispatches 13 parallel review agents against the requencer hardware design, collects PASS/WARN/FAIL verdicts per section, presents a unified report, and lets the user interactively approve and apply fixes.

## Constraints

- **No `.kicad_sch` files exist.** This is an atopile project — `.ato` files are the schematic source. KiCad schematic analysis tools (e.g., kicad-happy's `analyze_schematic.py`) are not applicable. All connectivity/netlist analysis must parse `.ato` files directly.
- **kicad-happy PCB analysis IS applicable.** Atopile generates `.kicad_pcb` files, so `analyze_pcb.py` and `analyze_gerbers.py` work normally.
- **Agent prompts are self-contained.** Each agent prompt includes its full check list from this spec. Agents do NOT defer to `docs/production-check.md` (the reference checklist contains stale component names like TLC5947/DAC8568 that have been replaced by IS31FL3216A/DAC80508).

## Flow

```
User runs: /production-check

1. Preflight — verify build artifacts exist, warn if stale (>24h)
2. Dispatch 12 review agents in parallel (sections 0-14, 16-17)
3. Wait for all agents to complete
4. Dispatch agent 13 (bring-up plan) with findings from agents 1-12
5. Aggregate results into summary report
6. Write report to docs/reports/production-check-YYYY-MM-DD.md
7. Present summary table + prioritized action items
8. User picks items to fix → dispatch implementation agents
9. Re-check affected sections to verify fixes
```

## Preflight Checks

Before dispatching agents, verify these build artifacts exist:

| Artifact | Path | Required by |
|----------|------|-------------|
| Routed control PCB | `hardware/boards/elec/layout/control/control.kicad_pcb` | Agents 6, 10 |
| Routed main PCB | `hardware/boards/elec/layout/main/main.kicad_pcb` | Agents 6, 10 |
| Parts report | `hardware/boards/build/parts-report.json` | Agent 7 |
| DRC results | `hardware/boards/build/*-routed-drc.json` | Agent 6 |
| 3D STEP files | `hardware/boards/build/3d/*.step` | Agent 2, 8 |

Warn (don't block) if any artifact has mtime >24h old. Fail if any required artifact is missing entirely.

## Agent Design

### Output Contract

Each agent returns structured findings. The `checks` array is the primary output — the aggregator derives the issues list by filtering checks where `status != "PASS"`.

```json
{
  "agent": "gpio-pin-compat",
  "sections": [1, 8],
  "verdict": "WARN",
  "checks": [
    {
      "name": "SPI0 pin assignment",
      "section": 1,
      "status": "PASS",
      "detail": "SPI0_TX on GP19 — valid (GP3/7/19/23)"
    },
    {
      "name": "pins.rs alias mismatch",
      "section": 8,
      "status": "WARN",
      "detail": "pins.rs defines PIN_DAC_MOSI but main.rs uses PIN_15",
      "file": "crates/firmware/src/pins.rs",
      "line": 12,
      "suggested_fix": "Update alias to match main.rs usage"
    }
  ]
}
```

### Verdict Rules

- **PASS** — zero WARN or FAIL items
- **WARN** — one or more WARN items, zero FAIL items
- **FAIL** — one or more FAIL items

Overall report verdict: FAIL if any agent returns FAIL, WARN if any returns WARN, PASS otherwise.

## Agent-to-Section Mapping

### Agent 0: `footprint-audit` (Section 0)

**Purpose:** Datasheet-level verification of every component's pin mapping, footprint geometry, and 3D model. This is the highest-value check — it caught all 4 critical issues in the 2026-03-18 audit (wrong DAC pin mapping, swapped diode pins, wrong transistor pinout, I2C pin conflict).

**Inputs:**
- All `.ato` files under `hardware/boards/elec/src/components/` (skip `_archive/`)
- All `.kicad_mod` footprint files in each component directory
- All `.kicad_sym` symbol files in each component directory
- Component datasheets (fetch from LCSC URLs in README or .ato `supplier_partno`)

**Checks (per component):**
- Walk every `signal X ~ pin N` in the .ato against the datasheet pin table — verify correct signal-to-physical-pin mapping
- Verify KiCad symbol pin numbers match .ato pin assignments
- Verify footprint pad count matches .ato pin declaration count
- For QFN/BGA: verify exposed pad is declared and connected (usually GND)
- Spot-check footprint pad dimensions against datasheet recommended land pattern
- Verify 3D model exists for THT and QFN/BGA components
- Flag any component where LCSC manufacturer differs from .ato manufacturer (functional equivalents are WARN, not FAIL)

**Datasheet access:** For each component, read the README.md for datasheet URLs. Use `WebFetch` to retrieve the datasheet. If URL is missing, construct from LCSC product page: `https://www.lcsc.com/product-detail/{lcsc_number}.html`

---

### Agent 1: `gpio-pin-compat` (Sections 1, 8)

**Purpose:** Verify RP2350 GPIO function-select compliance and firmware↔schematic pin matching.

**Inputs:**
- `hardware/boards/elec/src/circuits/mcu/mcu.ato`
- `crates/firmware/src/main.rs`
- `crates/firmware/src/pins.rs`
- `crates/firmware/src/dac.rs`

**Checks:**
- SPI0 pins (display + SD) on valid GPIOs per RP2350 function-select table
- SPI1 pins (DAC) on valid GPIOs
- UART1 pins (MIDI) on valid GPIOs
- ADC pins (CV inputs) on GP40-43
- Every pin in mcu.ato matches the firmware pin assignment
- No two signals share the same GPIO
- No GPIO assigned in firmware but unwired in schematic

---

### Agent 2: `connector-stacking` (Sections 2, 16)

**Purpose:** Verify board-to-board connector pin matching and mechanical stacking.

**Inputs:**
- `hardware/boards/elec/src/circuits/board-connector/board-connector.ato`
- `hardware/boards/elec/src/components/ShroudedHeader2x16/ShroudedHeader2x16.ato`
- `hardware/boards/elec/src/components/ShroudedSocket2x16/ShroudedSocket2x16.ato`
- `hardware/boards/build/3d/*.step` (for visual reference only — dimensional checks use JSON data below)
- `hardware/boards/elec/src/components/ShroudedHeader2x16/README.md` (datasheet link)
- `hardware/boards/elec/src/components/ShroudedSocket2x16/README.md` (datasheet link)

**Checks:**
- Pin-for-pin signal matching (all 32 pins on both headers)
- Power pins doubled and at connector edges
- No signal-to-power shorts across boards
- Shroud key alignment for correct insertion
- Pin 1 alignment (not mirrored)
- Mated height vs standoff height
- THT pin clearance between boards
- Component height clearance between boards
- Assembly order feasibility

---

### Agent 3: `signal-path` (Sections 3, 5)

**Purpose:** End-to-end signal path tracing and component fitness verification.

**Inputs:**
- All `.ato` files under `hardware/boards/elec/src/circuits/`
- All `.ato` files under `hardware/boards/elec/src/boards/`
- Part definitions under `hardware/boards/elec/src/components/`

**Checks (signal paths):**
- Pitch CV: DAC → op-amp (gain=2, offset) → protection → jack. Verify gain resistors, 0.1% tolerance, ±12V supply.
- Gate CV: DAC → unity buffer → protection → jack. Verify 0-5V range.
- Velocity CV: DAC → op-amp (gain≈1.6) → protection → jack.
- Mod CV: DAC → inverting op-amp (gain=2, offset=+5V) → protection → jack. Verify bipolar output.
- Button scan: GPIO → 74HC165 chain (CLK, LATCH, DATA). Verify SER tied to GND, chain order.
- LED drive: MCU → IS31FL3216A chain. Verify I2C addresses, daisy chain.
- MIDI: UART TX/RX → optocoupler → TRS jack. Verify polarity, protection diode.
- Clock/Reset I/O: Input dividers, NPN output buffers. Verify gain, inversion.
- Display: SPI0 → FPC. Verify RST RC delay, backlight MOSFET.
- SD card: SPI0 → SD slot. Verify MISO connected, card detect.
- USB-C: DP/DM → 27Ω → connector. Verify CC pull-downs, ESD.
- Encoders: A/B/SW → pull-ups + debounce → connector → MCU.
- CV inputs: Jack → divider → clamp → ADC.

**Checks (component fitness):**
- All connectors have functional pins connected
- DAC VREF decoupled, control pins defined
- Op-amp unused channels configured
- Shift register chain integrity
- LED driver current-set resistors
- Optocoupler polarity and pull-ups
- Protection component orientation
- Transistor switch base/gate resistors

---

### Agent 4: `power-supply` (Section 4)

**Purpose:** Power rail validation — connectivity, thermal budget, decoupling, current budget.

**Inputs:**
- `hardware/boards/elec/src/circuits/power/power.ato`
- `hardware/boards/elec/src/boards/main/main.ato`
- `hardware/boards/elec/src/boards/control/control.ato`
- Regulator datasheets (AMS1117-3.3)

**Checks:**
- Every IC power pin traces back to correct rail
- Regulator thermal budget: Pdiss = (Vin-Vout) × Iload, Tj = Tambient(40°C) + Pdiss × θJA
- 100nF bypass cap per IC power pin, 10µF bulk where needed
- Special decoupling per datasheet (VREF, analog supply)
- Current budget per rail with >20% margin
- Cross-board supply isolation (bulk caps at connector entry)

---

### Agent 5: `button-scan` (Section 6)

**Purpose:** Multi-button simultaneous input validation.

**Inputs:**
- `hardware/boards/elec/src/boards/control/control.ato`
- `hardware/boards/elec/src/components/74HC165D/74HC165D.ato`
- `crates/firmware/src/main.rs` (button scan code)

**Checks:**
- Direct wiring (no matrix) — confirms no ghosting
- 5× 74HC165 = 40 bits, all mapped in firmware
- Scan rate ≥200 Hz
- Pull-ups on all button inputs
- Unused inputs tied to VCC

---

### Agent 6: `pcb-layout` (Sections 7, 14)

**Purpose:** Routing quality and EMC/analog noise analysis.

**Inputs:**
- `hardware/boards/elec/layout/control/control.kicad_pcb`
- `hardware/boards/elec/layout/main/main.kicad_pcb`
- `hardware/boards/board-config.json`
- `hardware/boards/design-rules.json`
- DRC result JSONs

**External tool:** kicad-happy `kicad` skill (PCB analysis scripts)

**Checks (routing):**
- DRC results — any violations beyond pipeline whitelist
- Unrouted nets = FAIL
- Analog-digital separation (pitch CV vs SPI clock, LED data)
- Ground pour connectivity — no isolated islands
- Ground stitching vias present
- Trace widths match netclass (power ≥0.3mm, analog ≥0.3mm, default ≥0.2mm)
- Thermal relief on power pads

**Checks (EMC):**
- Continuous ground pour under DAC and op-amp footprints
- No traces bisecting ground under analog ICs
- SPI1 clock routed away from pitch CV traces (≥1mm or guard trace)
- LED driver switching traces away from analog path
- Decoupling caps within 2mm of IC power pins
- Separate analog supply decoupling
- Bulk + ceramic on regulator outputs
- Cross-board power filtering at connector entry

---

### Agent 7: `parts-sourcing` (Section 9)

**Purpose:** Parts availability and sourcing readiness.

**Inputs:**
- `hardware/boards/build/parts-report.json`

**Checks:**
- All SMD parts in JLCPCB stock (qty ≥ board_count × qty_per_board)
- Count of extended parts (WARN if >5)
- All THT parts have ≥1 supplier with stock
- No EOL/NRND parts
- BOM completeness — every schematic component in BOM

---

### Agent 8: `mechanical-fit` (Section 10)

**Purpose:** Physical fit in eurorack rack.

**Inputs:**
- `hardware/faceplate/elec/src/faceplate.ato`
- `hardware/boards/component-map.json` (component physical dimensions)
- `web/src/panel-layout.json` (placed component positions)
- `hardware/boards/board-config.json` (board dimensions)

**Note:** STEP files are binary CAD format that agents cannot parse. Dimensional checks use the structured JSON data above. Stacking clearance and collision checks that require 3D inspection are flagged as "manual verification recommended".

**Checks:**
- Panel width = 36 HP = 181.88mm ±0.2mm
- Panel height = 128.5mm (3U standard)
- 4× mounting holes at eurorack positions
- Jack holes 6mm, encoder holes 7mm
- Board stacking clearance (from component-map heights + board-config spacing — flag for manual 3D verification)
- No components in top/bottom 10mm rail zone (from panel-layout.json positions)
- Tallest component <25mm behind panel (from component-map.json heights)

---

### Agent 9: `datasheet-compliance` (Section 11)

**Purpose:** IC-by-IC datasheet requirement verification.

**Inputs:**
- All component .ato files under `hardware/boards/elec/src/components/`
- All circuit .ato files under `hardware/boards/elec/src/circuits/`
- Component datasheets — for each IC, read the component's README.md for datasheet URLs, then `WebFetch` to retrieve. Fallback: construct LCSC URL from `supplier_partno` in .ato.

**Checks (per IC):**
- Absolute maximum ratings not exceeded (supply voltage, input voltage, ESD)
- Supply voltage within recommended operating range
- Decoupling values match datasheet recommendations
- Multiple power pins each have own cap
- AVDD/DVDD separation where required
- VREF cap type/value per datasheet
- Unused pins tied per datasheet
- Control/config pins (LDAC, CLR, BLANK, OE, CLK_INH) in correct state
- Enable/shutdown pins defined
- Reset pins have required pull-up/RC
- Logic level compatibility between ICs (VOH vs VIH, VOL vs VIL)
- Mixed-voltage interfaces handled
- SPI mode (CPOL/CPHA) agreement
- SPI clock frequency within slave max
- I2C address conflicts
- Power-on state of each IC (safe defaults?)
- Thermal pad connected with vias
- Current-set resistors correct

---

### Agent 10: `manufacturing-files` (Sections 12, 13)

**Purpose:** Manufacturing output file quality for all three boards.

**Inputs:**
- `hardware/boards/build/manufacturing/control/gerbers/` — control board Gerbers + drill files
- `hardware/boards/build/manufacturing/main/gerbers/` — main board Gerbers + drill files
- `hardware/boards/build/manufacturing/faceplate/gerbers/` — faceplate Gerbers + drill files
- `hardware/boards/build/manufacturing/*/jlcpcb-cpl.csv` — pick-and-place files
- `hardware/boards/build/manufacturing/*/jlcpcb-bom.csv` — BOM files
- `hardware/boards/elec/layout/control/control.kicad_pcb` — silkscreen layers
- `hardware/boards/elec/layout/main/main.kicad_pcb` — silkscreen layers

**External tool:** kicad-happy `kicad` skill

**Checks (manufacturing):**
- All Gerber layers present (F.Cu, B.Cu, F.Mask, B.Mask, F.SilkS, B.SilkS, Edge.Cuts)
- Board outline matches expected dimensions
- Drill file hole sizes match schematic
- No stale Gerbers (date matches latest route)
- All SMD components in CPL
- CPL rotation cross-referenced with JLCPCB known offsets
- Coordinate origin correct
- Polarized components orientation verified
- LCSC part numbers on all SMD parts
- BOM quantities correct
- No THT in SMD BOM
- Fiducial marks present (≥2, asymmetric)

**Checks (silkscreen):**
- Board version/date marking on each board
- Pin 1 markers on all ICs
- Connector polarity markings
- Eurorack power header polarity marked
- Reference designators readable and not overlapping
- Component outlines match footprints

---

### Agent 11: `documentation-audit` (Section 17)

**Purpose:** Component documentation completeness and accuracy.

**Inputs:**
- All directories under `hardware/boards/elec/src/components/` (skip `_archive/`)
- All directories under `hardware/boards/elec/src/circuits/`
- `hardware/boards/component-map.json`

**Checks:**
- Each component has datasheet reference (PDF or link in README)
- Datasheet matches the exact LCSC MPN
- Pin mapping in .ato matches datasheet
- .kicad_mod and .kicad_sym files exist and are referenced correctly
- Pad count matches pin declaration count
- 3D model present for THT/QFN/BGA components
- README exists for non-trivial custom components
- README describes current part (not a replaced alternative)
- No stale references to archived components
- component-map.json complete for all board components
- LCSC part numbers valid (spot-check)
- No orphan components (defined but never instantiated)

---

### Agent 12: `bringup-plan` (Section 15)

**Purpose:** Generate/validate board bring-up test plan incorporating findings from all other agents.

**Inputs:**
- Results from agents 0-11
- Current firmware state

**Runs after:** all other agents complete

**Output:**
- Validated bring-up sequence (phases 1-5 from production-check.md)
- Test points checklist — flags any missing from PCB
- Known risks from other agents flagged at relevant bring-up phase
- Phase-specific warnings (e.g., "power supply agent found marginal thermal budget — monitor regulator temperature in phase 2")

## Report Format

Written to `docs/reports/production-check-YYYY-MM-DD.md`:

```markdown
# Production Validation Report — Requencer
**Date:** YYYY-MM-DD
**Verdict:** PASS / DO NOT MANUFACTURE

## Summary
| # | Section | Agent | Verdict | Issues |
|---|---------|-------|---------|--------|
| 1 | GPIO Function-Select | gpio-pin-compat | PASS | — |
| 2 | Connector Pin Matching | connector-stacking | PASS | — |
| ... | ... | ... | ... | ... |

## Action Items

### Must Fix (FAIL)
1. [Section N] Description — file:line — suggested fix

### Should Fix (WARN)
1. [Section N] Description — file:line — suggested fix

### Informational
1. [Section N] Description

## Detailed Findings
(per-section breakdown with check tables)

## Bring-Up Plan
(from agent 12, incorporating findings)
```

## Fix Mode

After presenting the report:
1. List all WARN and FAIL items numbered
2. User can say:
   - "fix 1, 3, 7" — fix specific items
   - "fix all FAILs" — fix all FAIL-severity items
   - "fix all" — fix everything that has a suggested fix
3. For each approved fix, dispatch an implementation agent
4. After fixes, re-run only the affected section's agent to verify

## External Dependencies

- **kicad-happy `kicad` skill** — installed at `.claude/skills/kicad/`. Used by agents 6 and 10 for KiCad PCB file analysis. Pure Python scripts, no pip dependencies.

## File Structure

```
.claude/skills/
  production-check/
    SKILL.md              # Skill entry point
    agents/               # Agent prompt templates
      footprint-audit.md
      gpio-pin-compat.md
      connector-stacking.md
      signal-path.md
      power-supply.md
      button-scan.md
      pcb-layout.md
      parts-sourcing.md
      mechanical-fit.md
      datasheet-compliance.md
      manufacturing-files.md
      documentation-audit.md
      bringup-plan.md
  kicad/                  # kicad-happy (installed)
    SKILL.md
    scripts/
    references/

docs/
  production-check.md     # Existing checklist (reference, not modified)
  reports/                # Generated reports
    production-check-YYYY-MM-DD.md
```
