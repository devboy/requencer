# Fiducial Mark Pipeline Step

**Date:** 2026-03-22
**Status:** Approved

## Problem

JLCPCB pick-and-place machines require fiducial marks for optical alignment. The production check found zero fiducials on either board, flagged as FAIL.

## Solution

New script `add_fiducials.py` in the export pipeline. Uses the pcbnew API (consistent with `add_ground_pours.py`) to load a poured `.kicad_pcb`, insert 3 fiducial footprints near board corners, and save a new `-final.kicad_pcb` file.

## Fiducial Specification

- **Pad:** 1mm round copper, SMD, no paste
- **Solder mask opening:** 2mm diameter (0.5mm clearance ring around pad)
- **Layers:** F.Cu + F.Mask only (front-side assembly for both boards)
- **No silkscreen** — machine-only reference point
- **Reference designator:** FID1, FID2, FID3
- **Attributes:** `exclude_from_bom` + `exclude_from_pos_files` (fiducials are bare copper, not placed components)

## Placement Rules

1. Get board bounding box via `board.GetBoardEdgesBoundingBox()` (handles arcs/rounded corners)
2. Place at 3 of 4 corners (skip bottom-right for asymmetry)
3. Inset 5mm from each corner (provides 3mm+ clearance from edge after accounting for the 2mm mask opening)
4. Check no existing footprint bounding box overlaps within 3mm of the candidate position
5. If a corner is blocked, shift along the nearest edge in 1mm increments (max 20mm) until clear
6. If no clear position found within 20mm, warn and skip that fiducial

## Pipeline Integration

**New files:**
- Script: `hardware/boards/scripts/export/add_fiducials.py`
- Outputs: `build/control-final.kicad_pcb`, `build/main-final.kicad_pcb`

**Makefile changes:**

New variables and targets:
```makefile
CONTROL_FINAL := $(BUILD)/control-final.kicad_pcb
MAIN_FINAL    := $(BUILD)/main-final.kicad_pcb

$(CONTROL_FINAL): $(CONTROL_POURED)
    $(KICAD_ENV) $(KICAD_PYTHON) $(SCRIPTS)/export/add_fiducials.py $< $@

$(MAIN_FINAL): $(MAIN_POURED)
    $(KICAD_ENV) $(KICAD_PYTHON) $(SCRIPTS)/export/add_fiducials.py $< $@

fiducials: $(CONTROL_FINAL) $(MAIN_FINAL)
```

Downstream dependency changes (poured → final):
- `export-control` (line 233): `$(CONTROL_POURED)` → `$(CONTROL_FINAL)`
- `export-main` (line 235): `$(MAIN_POURED)` → `$(MAIN_FINAL)`
- `$(CONTROL_3D)` (line 204): `$(CONTROL_POURED)` → `$(CONTROL_FINAL)`
- `$(MAIN_3D)` (line 207): `$(MAIN_POURED)` → `$(MAIN_FINAL)`
- `all` target (line 92): add `fiducials` dependency, update echo messages
- `.PHONY` (line 88): add `fiducials`

## Implementation Approach

Uses the pcbnew Python API (consistent with `add_ground_pours.py`):

1. `pcbnew.LoadBoard(input_path)` — load the poured PCB
2. `board.GetBoardEdgesBoundingBox()` — get board bounds
3. `board.GetFootprints()` — build collision set from existing footprint bounding boxes
4. Compute 3 fiducial positions (top-left, top-right, bottom-left, inset 5mm)
5. For each position, create a `pcbnew.FOOTPRINT`, add a single SMD pad (1mm circle, 0.5mm mask margin), set attributes (`FP_EXCLUDE_FROM_BOM | FP_EXCLUDE_FROM_POS_FILES`)
6. `board.Add(footprint)` for each fiducial
7. `board.Save(output_path)` — write the final PCB

The pcbnew API handles UUID generation, KiCad 9 format compliance, and structural validity automatically.
