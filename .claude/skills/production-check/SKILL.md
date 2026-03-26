---
name: production-check
description: Run a full pre-production validation of the requencer hardware design. Dispatches 13 parallel review agents across 17 checklist sections (GPIO compliance, signal paths, power supply, PCB layout, datasheet compliance, manufacturing files, etc.), aggregates PASS/WARN/FAIL results, writes a report, and lets you interactively fix issues. Use before ordering PCBs or when you want a comprehensive design review. Trigger phrases include "production check", "pre-fab review", "ready to order?", "validate hardware", "check the design".
---

# Production Check

Pre-production validation of the requencer hardware design. Dispatches 13 review agents in parallel, aggregates results, writes a report, and offers interactive fix mode.

## Constraints

- **No `.kicad_sch` files exist.** This is an atopile project — `.ato` files are the schematic source of truth. Do NOT use kicad skill schematic analysis tools (`analyze_schematic.py`). All connectivity/netlist analysis must parse `.ato` files directly.
- **KiCad PCB analysis IS applicable.** Atopile generates `.kicad_pcb` files. Use kicad skill's PCB analysis approach (`methodology_pcb.md`) for agents that analyze routed boards.
- **Agent prompts are self-contained.** Each agent prompt in `agents/` includes its full check list. Do NOT defer to `docs/production-check.md` — the reference checklist contains stale component names (TLC5947 → IS31FL3216A, DAC8568 → DAC80508, 6N138 → H11L1S).

## Step 1: Preflight

Before dispatching agents, verify these build artifacts exist. Use Glob to check each path.

| Artifact | Glob Pattern | Required By |
|----------|-------------|-------------|
| Routed control PCB | `hardware/boards/elec/layout/control/control.kicad_pcb` | Agents 6, 10 |
| Routed main PCB | `hardware/boards/elec/layout/main/main.kicad_pcb` | Agents 6, 10 |
| Parts report | `hardware/boards/build/parts-report.json` | Agent 7 |
| DRC results | `hardware/boards/build/*-routed-drc.json` | Agent 6 |
| 3D STEP files | `hardware/boards/build/3d/*.step` | Agent 2 |

**Staleness check:** For each artifact, check mtime. If any artifact is >24h old, WARN the user:
> "Build artifacts are >24h old. Consider running `make hardware` and `make check-parts` before proceeding. Continue anyway? (y/n)"

**Missing artifacts:** If any required artifact is missing entirely, FAIL:
> "Missing required artifact: [path]. Run `make hardware` first."

## Step 2: Dispatch Review Agents

Read each agent prompt file from `agents/` and dispatch via the Agent tool. **Dispatch agents 0-11 in parallel** (single message with 12 Agent tool calls). Each agent runs as `subagent_type: "general-purpose"`.

| Agent # | Prompt File | Sections | Name |
|---------|------------|----------|------|
| 0 | `agents/00-footprint-audit.md` | 0 | footprint-audit |
| 1 | `agents/01-gpio-pin-compat.md` | 1, 8 | gpio-pin-compat |
| 2 | `agents/02-connector-stacking.md` | 2, 16 | connector-stacking |
| 3 | `agents/03-signal-path.md` | 3, 5 | signal-path |
| 4 | `agents/04-power-supply.md` | 4 | power-supply |
| 5 | `agents/05-button-scan.md` | 6 | button-scan |
| 6 | `agents/06-pcb-layout.md` | 7, 14 | pcb-layout |
| 7 | `agents/07-parts-sourcing.md` | 9 | parts-sourcing |
| 8 | `agents/08-mechanical-fit.md` | 10 | mechanical-fit |
| 9 | `agents/09-datasheet-compliance.md` | 11 | datasheet-compliance |
| 10 | `agents/10-manufacturing-files.md` | 12, 13 | manufacturing-files |
| 11 | `agents/11-documentation-audit.md` | 17 | documentation-audit |

For each agent, Read the prompt file and pass its full content as the agent's prompt. Add this preamble to every agent prompt:

```
You are a hardware review agent for the requencer eurorack sequencer project.
Working directory: /Users/devboy/dev/devboy/requencer
Your task: perform the checks described below and return your findings.
Do NOT make any changes to files. Read-only review.
```

## Step 3: Wait and Collect Results

Wait for all 12 agents to complete. Collect each agent's textual output.

## Step 4: Dispatch Bring-Up Plan Agent

Read `agents/12-bringup-plan.md` and dispatch Agent 12. Include a summary of findings from agents 0-11 in its prompt so it can incorporate risks into the bring-up sequence.

## Step 5: Aggregate Results

For each agent's output, extract:
- Per-check verdicts (PASS/WARN/FAIL)
- Issues found (with severity, description, file, suggested fix)

Derive overall verdicts:
- **Agent verdict:** FAIL if any check is FAIL, WARN if any check is WARN, else PASS
- **Overall verdict:** FAIL if any agent is FAIL, WARN if any agent is WARN, else PASS
- **Manufacturing decision:** FAIL → "DO NOT MANUFACTURE", else "PASS" or "PASS WITH WARNINGS"

## Step 6: Write Report

Write the report to `docs/reports/production-check-YYYY-MM-DD.md` using today's date.

```markdown
# Production Validation Report — Requencer
**Date:** YYYY-MM-DD
**Verdict:** [PASS / PASS WITH WARNINGS / DO NOT MANUFACTURE]

## Summary

| # | Section | Agent | Verdict | Issues |
|---|---------|-------|---------|--------|
| 0 | Component & Footprint Audit | footprint-audit | | |
| 1 | GPIO Function-Select | gpio-pin-compat | | |
| 2 | Connector Pin Matching | connector-stacking | | |
| 3 | Signal Path Integrity | signal-path | | |
| 4 | Power Supply | power-supply | | |
| 5 | Component-Purpose Fitness | signal-path | | |
| 6 | Multi-Button Input | button-scan | | |
| 7 | Routing Quality | pcb-layout | | |
| 8 | Firmware-Pin Compat | gpio-pin-compat | | |
| 9 | Parts Availability | parts-sourcing | | |
| 10 | Mechanical Fit | mechanical-fit | | |
| 11 | Datasheet Compliance | datasheet-compliance | | |
| 12 | Manufacturing Output | manufacturing-files | | |
| 13 | Silkscreen & Markings | manufacturing-files | | |
| 14 | EMC & Analog Noise | pcb-layout | | |
| 15 | Board Bring-Up Plan | bringup-plan | | |
| 16 | Sandwich Stack Assembly | connector-stacking | | |
| 17 | Component Documentation | documentation-audit | | |

## Action Items

### Must Fix (FAIL)
(numbered list of all FAIL items with file:line and suggested fix)

### Should Fix (WARN)
(numbered list of all WARN items with file:line and suggested fix)

### Informational
(observations that don't require action)

## Detailed Findings
(full output from each agent, organized by section number)

## Bring-Up Plan
(output from agent 12)
```

## Step 7: Present Report

Show the user:
1. The summary table
2. The action items (Must Fix + Should Fix)
3. The path to the full report file

## Step 8: Fix Mode

After presenting the report, enter interactive fix mode:

> "Report written to `docs/reports/production-check-YYYY-MM-DD.md`.
>
> **[N] FAIL items, [M] WARN items found.**
>
> You can:
> - `fix 1, 3, 7` — fix specific items by number
> - `fix all FAILs` — fix all FAIL-severity items
> - `fix all` — fix everything with a suggested fix
> - `done` — exit without fixing"

For each approved fix:
1. Dispatch an implementation agent with the specific fix details
2. After the fix is applied, re-run ONLY the affected section's review agent to verify
3. Update the report with the new status

If the user says "done" or doesn't want to fix anything, end the skill.
