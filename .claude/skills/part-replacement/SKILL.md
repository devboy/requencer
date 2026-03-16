---
name: part-replacement
description: Research and recommend replacement parts for the requencer eurorack hardware project. Use when parts have stock issues (out of stock, low stock, not found on JLCPCB), when considering component upgrades for better specs or lower cost, or when `make check-parts` flags problems. Covers JLCPCB/LCSC availability, multi-supplier pricing, eurorack-specific constraints (1V/oct precision, bipolar voltage, panel density), footprint/pinout compatibility, and atopile schematic impact analysis.
---

# Part Replacement

Research problematic or upgradeable components and produce actionable replacement plans with specific file changes for the requencer eurorack sequencer project.

## Workflow

1. **Identify the problem** — parse `make check-parts` output or user request
2. **Research the current part** — read its `.ato` definition, schematic usage, datasheet constraints
3. **Find candidates** — search for replacements considering the criteria below
4. **Evaluate candidates** — score against eurorack requirements and project constraints
5. **Produce a replacement plan** — specific file changes, impact analysis, verification steps

## Step 1: Identify the Problem

Determine the issue category for each part:

| Category | Trigger | Typical Resolution |
|----------|---------|-------------------|
| **NOT FOUND** on JLCPCB | Wrong LCSC#, wrong packaging, or misclassified | Fix LCSC#, switch packaging variant, or fix BOM classification |
| **LOW STOCK** on JLCPCB | Stock < needed qty | Pre-order, consign from DigiKey/Mouser, or find alternate |
| **Cost optimization** | Part is expensive | Find newer/cheaper drop-in or pin-compatible replacement |
| **Spec upgrade** | Better part exists | Evaluate if improvement justifies schematic/firmware changes |
| **EOL/NRND** | Part being discontinued | Find active replacement before stock runs out |

Run `make check-parts BOARD_COUNT=N` to get current status. Parse the output for:
- SMD parts with FAIL/WARN status
- THT parts with no supplier offers
- Cost outliers (compare against typical eurorack BOM costs)

## Step 2: Research the Current Part

For each problematic part, gather:

1. **Read the .ato definition** in `hardware/boards/parts/<PartName>/<PartName>.ato` — get LCSC#, MPN, manufacturer, footprint, pinout
2. **Read schematic usage** in `hardware/boards/elec/src/*.ato` — find all `= new PartName` instantiations, trace signal connections
3. **Check project research docs** in `docs/research/` — prior analysis may exist (e.g., `hardware-strategy.md`, PCB validation reports)
4. **Understand the part's role** in the eurorack signal chain — see [references/eurorack-constraints.md](references/eurorack-constraints.md)

## Step 3: Find Candidates

Search strategy depends on issue type:

**Same part, different packaging** (easiest):
- Search LCSC for the same MPN with suffix variants (e.g., `R` for tape-and-reel, `T` for cut-tape)
- Check JLCPCB basic/preferred parts library (lower assembly fee)

**Drop-in replacement** (same footprint + pinout):
- Search by parametric specs on LCSC/DigiKey
- Look for pin-compatible parts from same manufacturer family
- Verify: same package, same pinout, compatible electrical specs

**Functional replacement** (different footprint or protocol):
- Search for newer-generation parts from same manufacturer
- Compare parametric specs against eurorack requirements
- Assess total cost including schematic/firmware rework

**Classification fix** (not a part change):
- Check if part belongs in `THT_PARTS` set in `bom_parser.py`
- Check if LCSC number is correct/current

## Step 4: Evaluate Candidates

Score each candidate against these criteria. See [references/eurorack-constraints.md](references/eurorack-constraints.md) for domain-specific requirements.

### Must-have criteria
- **Available**: In stock or orderable on JLCPCB/LCSC (for SMD) or major distributors (for THT)
- **Electrically compatible**: Voltage ranges, current capability, logic levels match the circuit
- **Footprint feasible**: Same footprint (drop-in) or acceptable footprint change (QFN vs TSSOP is ok if board space allows)

### Scoring criteria (weigh trade-offs)

| Criterion | Weight | Notes |
|-----------|--------|-------|
| JLCPCB stock & library type | High | Basic/preferred = $0.50 setup vs extended = $3+ |
| Unit price at target qty | High | Compare at actual board count (typically 5-10) |
| Spec improvement | Medium | Better INL/DNL, lower drift, wider voltage range |
| Schematic impact | Medium | Drop-in (none) vs rewire (moderate) vs protocol change (high) |
| Firmware impact | Medium | No change vs register tweaks vs full driver rewrite |
| Second-source availability | Low | Multiple manufacturers = supply chain resilience |
| Package size | Low | Smaller is usually better for eurorack density |

### When to recommend an upgrade vs a simple fix

Recommend an **upgrade** (different part) only when:
- Cost savings > $5/board AND total savings > $25 for the batch, OR
- Spec improvement directly benefits eurorack performance (e.g., better pitch accuracy), OR
- Current part is EOL/NRND

Otherwise prefer the **simplest fix** (same part, different LCSC#, packaging variant, or classification fix).

## Step 5: Produce a Replacement Plan

Structure the plan with these sections for each part:

```markdown
## PartName — [Summary of change]

**Problem:** [What's wrong — stock, cost, EOL, etc.]
**Solution:** [What to do — new LCSC#, new part, classification fix]
**Impact:** [None / Low / Medium / High] — [brief explanation]

### Files to modify
- `hardware/boards/parts/X/X.ato` — [change description]
- `hardware/boards/elec/src/Y.ato` — [change description]
- `crates/firmware/src/Z.rs` — [change description]

### Verification
- `make check-parts BOARD_COUNT=N` — [expected result]
- `make hw-build` — [if schematic changed]
- `cargo test` — [if firmware changed]
```

### Impact levels

- **None**: LCSC# change only, or BOM classification fix
- **Low**: Same footprint, minor pin name changes in `.ato`
- **Medium**: New footprint, schematic rewiring, no firmware change
- **High**: Different protocol/interface requiring firmware driver rewrite

For **High** impact changes, the plan must include:
- Detailed pin mapping (old → new)
- Protocol differences (old vs new SPI/I2C frame format)
- Firmware test plan (TDD: write failing tests first)
- Cost/benefit justification (savings must be significant)

## Project-Specific Context

### File locations
- **Part definitions**: `hardware/boards/parts/<PartName>/<PartName>.ato` (+ `.kicad_sym`, `.kicad_mod`)
- **Schematics**: `hardware/boards/elec/src/*.ato`
- **BOM parser**: `hardware/boards/scripts/procurement/bom_parser.py` (THT_PARTS, MANUAL_SOURCE_PARTS)
- **Stock checker**: `hardware/boards/scripts/procurement/check_parts.py`
- **Firmware drivers**: `crates/firmware/src/` (dac.rs, leds.rs, buttons.rs, etc.)
- **Research docs**: `docs/research/` (hardware-strategy.md, pcb-design-validation-report, etc.)

### Procurement pipeline
- `make check-parts` runs the full pipeline: BOM parse → JLCPCB stock check → multi-supplier pricing
- SMD parts → JLCPCB assembly (check LCSC stock via community SQLite DB)
- THT parts → manual order from TME/DigiKey/Mouser (API queries)
- Parts classified by `bom_parser.py`: `THT_PARTS` set, `MANUAL_SOURCE_PARTS` dict

### Atopile conventions
- Parts live in `hardware/boards/parts/<PartName>/` with three files: `.ato`, `.kicad_sym`, `.kicad_mod`
- Schematics use `from "../../parts/X/X.ato" import X` and `x = new X`
- Pin connections: `component.PIN ~ signal_name`
- Bypass caps: 100nF per power pin (HF), 10µF bulk per IC, 1µF for references
