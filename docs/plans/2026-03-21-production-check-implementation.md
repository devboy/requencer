# Production Check Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `/production-check` Claude Code skill that dispatches 13 review agents against the requencer hardware design and produces a unified PASS/WARN/FAIL report.

**Architecture:** A single SKILL.md orchestrator dispatches 12 parallel agents (0-11) via the Agent tool, waits for results, dispatches agent 12 (bring-up plan), then aggregates into a report. Each agent gets a self-contained prompt template with its check list, input paths, and output contract.

**Tech Stack:** Claude Code skills (markdown), Agent tool for parallel dispatch

**Spec:** `docs/plans/2026-03-21-production-check-skill.md`

---

## File Structure

```
.claude/skills/production-check/
  SKILL.md                          # Orchestrator — preflight, dispatch, aggregate, report, fix mode
  agents/
    00-footprint-audit.md           # Section 0: Pin mapping, footprint, 3D model verification
    01-gpio-pin-compat.md           # Sections 1, 8: RP2350 GPIO + firmware pin matching
    02-connector-stacking.md        # Sections 2, 16: Board-to-board + sandwich stack
    03-signal-path.md               # Sections 3, 5: End-to-end signal tracing + component fitness
    04-power-supply.md              # Section 4: Rails, thermal, decoupling, current budget
    05-button-scan.md               # Section 6: Shift register chain + multi-button
    06-pcb-layout.md                # Sections 7, 14: Routing quality + EMC (uses kicad skill)
    07-parts-sourcing.md            # Section 9: Stock, availability, sourcing readiness
    08-mechanical-fit.md            # Section 10: Eurorack physical fit
    09-datasheet-compliance.md      # Section 11: IC-by-IC datasheet verification
    10-manufacturing-files.md       # Sections 12, 13: Gerber/CPL/BOM + silkscreen
    11-documentation-audit.md       # Section 17: README, footprint, symbol completeness
    12-bringup-plan.md              # Section 15: Bring-up test plan (runs last, uses other results)
docs/reports/                       # Created by skill at runtime (empty dir)
```

---

### Task 1: Create directory structure

**Files:**
- Create: `.claude/skills/production-check/agents/` (directory)
- Create: `docs/reports/` (directory)

- [ ] **Step 1: Create directories**

```bash
mkdir -p .claude/skills/production-check/agents
mkdir -p docs/reports
```

- [ ] **Step 2: Verify**

```bash
ls -la .claude/skills/production-check/
ls -la docs/reports/
```

---

### Task 2: Create SKILL.md orchestrator

**Files:**
- Create: `.claude/skills/production-check/SKILL.md`

This is the entry point. It defines the skill frontmatter, preflight checks, agent dispatch logic, aggregation, report writing, and fix mode interaction.

- [ ] **Step 1: Write SKILL.md**

Write the file with:
- Frontmatter: name `production-check`, description for triggering
- Constraints section (no .kicad_sch, .ato is schematic source, agent prompts are self-contained)
- Preflight checklist (artifact paths + staleness check)
- Agent dispatch table mapping agent numbers to prompt files
- Instructions to dispatch agents 0-11 in parallel via Agent tool, wait, then dispatch agent 12
- Aggregation rules: derive verdict per agent, overall verdict, issues list
- Report template with path `docs/reports/production-check-YYYY-MM-DD.md`
- Fix mode interaction (numbered items, user picks, implement, re-check)
- Output contract (the JSON structure agents must return)

Key content from spec:
- Preflight artifacts: routed PCBs, parts-report.json, DRC JSONs, 3D STEPs
- Verdict rules: PASS (zero WARN/FAIL), WARN (any WARN, zero FAIL), FAIL (any FAIL)
- Report written to `docs/reports/production-check-YYYY-MM-DD.md`

- [ ] **Step 2: Verify skill appears in skill list**

The skill should show up after creation. Verify the frontmatter is valid YAML.

---

### Task 3: Create Agent 0 — `footprint-audit`

**Files:**
- Create: `.claude/skills/production-check/agents/00-footprint-audit.md`

- [ ] **Step 1: Write agent prompt**

Content from spec — Section 0: Component & Footprint Audit. Include:
- Purpose: datasheet-level pin mapping verification (caught all 4 critical issues in last audit)
- Input paths: all `.ato` under `components/` (skip `_archive/`), `.kicad_mod`, `.kicad_sym`, READMEs for datasheet URLs
- Check list: pin-by-pin .ato vs datasheet, symbol pin numbers, footprint pad count, EP pad, pad dimensions, 3D model, LCSC manufacturer mismatch
- Datasheet access pattern: read README → WebFetch URL
- Output contract JSON structure
- Pass/WARN/FAIL criteria

---

### Task 4: Create Agent 1 — `gpio-pin-compat`

**Files:**
- Create: `.claude/skills/production-check/agents/01-gpio-pin-compat.md`

- [ ] **Step 1: Write agent prompt**

Sections 1, 8. Include:
- RP2350 GPIO function-select table (SPI0, SPI1, UART1, ADC valid GPIOs)
- Input paths: `mcu.ato`, `main.rs`, `pins.rs`, `dac.rs`
- Cross-reference table template (signal / mcu.ato GPIO / firmware PIN / match / special req)
- Check for GPIO conflicts (two signals on same pin)
- Check for firmware pins not wired in schematic

---

### Task 5: Create Agent 2 — `connector-stacking`

**Files:**
- Create: `.claude/skills/production-check/agents/02-connector-stacking.md`

- [ ] **Step 1: Write agent prompt**

Sections 2, 16. Include:
- Input paths: `board-connector.ato`, `ShroudedHeader2x16.ato`, `ShroudedSocket2x16.ato`, READMEs for datasheet links
- Pin-for-pin comparison table template (all 32 pins)
- Power pin placement check
- Signal-to-power short check
- Shroud key alignment, pin 1 alignment
- Mated height vs standoff height (from board-config.json)
- Assembly order feasibility

---

### Task 6: Create Agent 3 — `signal-path`

**Files:**
- Create: `.claude/skills/production-check/agents/03-signal-path.md`

- [ ] **Step 1: Write agent prompt**

Sections 3, 5. The largest agent — 13 signal paths + 8 component fitness categories. Include:
- Input paths: all `.ato` under `circuits/`, `boards/`, `components/`
- Each signal path trace (3a-3m) with expected topology, component values, voltage ranges
- Component fitness checks per category (connectors, DACs, op-amps, shift registers, LED drivers, optocouplers, protection, transistors)
- Use current component names (IS31FL3216A, DAC80508, H11L1S — NOT TLC5947, DAC8568, 6N138)

---

### Task 7: Create Agent 4 — `power-supply`

**Files:**
- Create: `.claude/skills/production-check/agents/04-power-supply.md`

- [ ] **Step 1: Write agent prompt**

Section 4. Include:
- Input paths: `power.ato`, `main.ato`, `control.ato`
- Rail connectivity check template (rail / source / connected ICs)
- Thermal budget formula: Pdiss = (Vin-Vout) × Iload, Tj = 40°C + Pdiss × θJA
- Bypass cap audit per IC
- Current budget table template (rail / consumers / total mA / source capacity / margin)
- Cross-board supply isolation check

---

### Task 8: Create Agent 5 — `button-scan`

**Files:**
- Create: `.claude/skills/production-check/agents/05-button-scan.md`

- [ ] **Step 1: Write agent prompt**

Section 6. Include:
- Input paths: `control.ato`, `74HC165D.ato`, `main.rs`
- Wiring topology check (direct vs matrix)
- Chain integrity: 5× 74HC165 = 40 bits
- Scan rate check (≥200 Hz)
- Pull-up and unused-input checks

---

### Task 9: Create Agent 6 — `pcb-layout`

**Files:**
- Create: `.claude/skills/production-check/agents/06-pcb-layout.md`

- [ ] **Step 1: Write agent prompt**

Sections 7, 14. Uses kicad-happy. Include:
- Input paths: both `.kicad_pcb` files, `board-config.json`, `design-rules.json`, DRC JSONs
- Instruction to use kicad skill's `analyze_pcb.py` methodology for PCB parsing
- Routing checks: DRC results, unrouted nets, analog-digital separation, ground pour, trace widths, thermal relief
- EMC checks: ground continuity under analog ICs, SPI clock isolation, decoupling placement proximity
- Reference to `.claude/skills/kicad/scripts/methodology_pcb.md` for parsing approach

---

### Task 10: Create Agent 7 — `parts-sourcing`

**Files:**
- Create: `.claude/skills/production-check/agents/07-parts-sourcing.md`

- [ ] **Step 1: Write agent prompt**

Section 9. Include:
- Input path: `hardware/boards/build/parts-report.json`
- Parse JSON for: stock levels, library type (basic/preferred/extended), supplier availability
- Check: all SMD in stock, extended count (WARN if >5), THT sourced, no EOL, BOM complete

---

### Task 11: Create Agent 8 — `mechanical-fit`

**Files:**
- Create: `.claude/skills/production-check/agents/08-mechanical-fit.md`

- [ ] **Step 1: Write agent prompt**

Section 10. Include:
- Input paths: `faceplate.ato`, `component-map.json`, `panel-layout.json`, `board-config.json`
- Note that STEP files are binary/unparseable — use JSON data for dimensional checks
- Checks: panel dims, mounting holes, jack/encoder hole sizes, rail zone clearance, component heights
- Flag stacking clearance as "manual 3D verification recommended"

---

### Task 12: Create Agent 9 — `datasheet-compliance`

**Files:**
- Create: `.claude/skills/production-check/agents/09-datasheet-compliance.md`

- [ ] **Step 1: Write agent prompt**

Section 11. The most thorough per-IC check. Include:
- Input paths: all component `.ato` files, all circuit `.ato` files
- Datasheet access: README URLs → WebFetch
- Check categories (11a-11g): absolute max ratings, power/decoupling, pin config, signal levels, protocol compliance, timing/startup, thermal/layout
- Per-IC checklist template
- List the specific ICs to check: DAC80508ZRTER, IS31FL3216A, OPA4171AIPWR, 74HC165D, H11L1S, AMS1117-3.3, PRTR5V0U2X, PGA2350, 2N7002, MMBT3904, BAT54S, B5819W

---

### Task 13: Create Agent 10 — `manufacturing-files`

**Files:**
- Create: `.claude/skills/production-check/agents/10-manufacturing-files.md`

- [ ] **Step 1: Write agent prompt**

Sections 12, 13. Uses kicad-happy. Include:
- Input paths: `manufacturing/control/gerbers/`, `manufacturing/main/gerbers/`, `manufacturing/faceplate/gerbers/`, `*jlcpcb-cpl.csv`, `*jlcpcb-bom.csv`, both `.kicad_pcb` files
- Gerber layer checks, drill file, board outline
- CPL rotation, coordinate origin, polarized components
- BOM format: LCSC numbers, quantities, no THT in SMD BOM
- Fiducial marks
- Silkscreen: version marking, pin 1 markers, connector polarity, ref designators
- Reference to kicad skill for Gerber analysis approach

---

### Task 14: Create Agent 11 — `documentation-audit`

**Files:**
- Create: `.claude/skills/production-check/agents/11-documentation-audit.md`

- [ ] **Step 1: Write agent prompt**

Section 17. Include:
- Input paths: all dirs under `components/` (skip `_archive/`), all dirs under `circuits/`, `component-map.json`
- Checks: datasheet presence, MPN match, pin mapping match, footprint/symbol exist, pad count, 3D model, README accuracy, stale references, component-map completeness, orphan components

---

### Task 15: Create Agent 12 — `bringup-plan`

**Files:**
- Create: `.claude/skills/production-check/agents/12-bringup-plan.md`

- [ ] **Step 1: Write agent prompt**

Section 15. Runs AFTER all other agents. Include:
- Input: results from agents 0-11
- Validated bring-up sequence (phases 1-5)
- Test points checklist
- Risk integration: incorporate findings from other agents at relevant bring-up phases
- Equipment checklist

---

### Task 16: Smoke test

- [ ] **Step 1: Verify all files exist**

```bash
find .claude/skills/production-check/ -type f | sort
```

Expected: 14 files (1 SKILL.md + 13 agent prompts)

- [ ] **Step 2: Verify skill frontmatter**

Check that SKILL.md has valid `---` frontmatter with `name: production-check` and a description.

- [ ] **Step 3: Verify agent prompts reference correct paths**

Spot-check 3 agent prompts to confirm file paths match actual project structure:
- Agent 1: verify `hardware/boards/elec/src/circuits/mcu/mcu.ato` exists
- Agent 6: verify `hardware/boards/elec/layout/main/main.kicad_pcb` exists
- Agent 7: verify `hardware/boards/build/parts-report.json` exists
