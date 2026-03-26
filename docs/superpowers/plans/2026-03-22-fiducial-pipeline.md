# Fiducial Pipeline Step — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fiducial marks to both PCBs as an automated pipeline step after ground pours, before manufacturing export.

**Architecture:** New `add_fiducials.py` script using the pcbnew API (same pattern as `add_ground_pours.py`). Creates 3 fiducial footprints at asymmetric board corners, writes a new `-final.kicad_pcb` file. Makefile updated to insert this step and point downstream targets at the final files.

**Tech Stack:** Python 3.9 (KiCad-bundled), pcbnew API (KiCad 9)

**Spec:** `docs/superpowers/specs/2026-03-22-fiducial-pipeline-design.md`

---

### Task 1: Write the fiducial script

**Files:**
- Create: `hardware/boards/scripts/export/add_fiducials.py`

- [ ] **Step 1: Create the script**

```python
#!/usr/bin/env python3
"""Add fiducial marks at 3 board corners for pick-and-place alignment.

Places 3 fiducials asymmetrically (top-left, top-right, bottom-left) so the
machine can determine board orientation. Each fiducial is a 1mm exposed copper
circle with a 2mm solder mask opening.

Usage:
    python3 add_fiducials.py <input.kicad_pcb> <output.kicad_pcb>
"""

import os
import sys

import pcbnew

# Fiducial parameters
PAD_DIAMETER_MM = 1.0
MASK_MARGIN_MM = 0.5  # 1mm pad + 2x0.5mm margin = 2mm mask opening
CORNER_INSET_MM = 5.0
COLLISION_RADIUS_MM = 3.0
MAX_SHIFT_MM = 20.0
SHIFT_STEP_MM = 1.0


def get_footprint_positions(board):
    """Return list of (x_mm, y_mm, half_w, half_h) for all footprints."""
    positions = []
    for fp in board.GetFootprints():
        bbox = fp.GetBoundingBox(False, False)
        cx = pcbnew.ToMM(bbox.GetCenter().x)
        cy = pcbnew.ToMM(bbox.GetCenter().y)
        hw = pcbnew.ToMM(bbox.GetWidth()) / 2
        hh = pcbnew.ToMM(bbox.GetHeight()) / 2
        positions.append((cx, cy, hw, hh))
    return positions


def is_clear(x, y, footprints, radius_mm):
    """Check no footprint bounding box overlaps within radius of (x, y)."""
    for fx, fy, hw, hh in footprints:
        # Expand the footprint box by radius, check if point is inside
        if (fx - hw - radius_mm <= x <= fx + hw + radius_mm and
                fy - hh - radius_mm <= y <= fy + hh + radius_mm):
            return False
    return True


def find_clear_position(x, y, dx, dy, footprints, radius_mm):
    """Shift (x, y) along direction (dx, dy) until clear, or give up."""
    if is_clear(x, y, footprints, radius_mm):
        return x, y
    for step in range(1, int(MAX_SHIFT_MM / SHIFT_STEP_MM) + 1):
        nx = x + dx * step * SHIFT_STEP_MM
        ny = y + dy * step * SHIFT_STEP_MM
        if is_clear(nx, ny, footprints, radius_mm):
            print(f"  Shifted fiducial {step}mm from ({x:.1f}, {y:.1f}) to ({nx:.1f}, {ny:.1f})")
            return nx, ny
    print(f"  WARNING: Could not find clear position near ({x:.1f}, {y:.1f}), skipping")
    return None, None


def create_fiducial(board, x_mm, y_mm, ref_name):
    """Create a fiducial footprint at the given position."""
    fp = pcbnew.FOOTPRINT(board)
    fp.SetReference(ref_name)
    fp.SetValue("Fiducial")
    fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x_mm), pcbnew.FromMM(y_mm)))
    fp.SetLayer(pcbnew.F_Cu)

    # Attributes: SMD + exclude from BOM and position files
    fp.SetAttributes(
        pcbnew.FP_SMD |
        pcbnew.FP_EXCLUDE_FROM_BOM |
        pcbnew.FP_EXCLUDE_FROM_POS_FILES
    )

    # Create the pad: 1mm circle, F.Cu + F.Mask, no paste
    pad = pcbnew.PAD(fp)
    pad.SetNumber("1")
    pad.SetShape(pcbnew.PAD_SHAPE_CIRCLE)
    pad.SetAttribute(pcbnew.PAD_ATTRIB_SMD)
    pad.SetSize(pcbnew.VECTOR2I(pcbnew.FromMM(PAD_DIAMETER_MM), pcbnew.FromMM(PAD_DIAMETER_MM)))
    pad.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x_mm), pcbnew.FromMM(y_mm)))

    # Layers: F.Cu + F.Mask (mask opening), no paste
    layer_set = pcbnew.LSET()
    layer_set.AddLayer(pcbnew.F_Cu)
    layer_set.AddLayer(pcbnew.F_Mask)
    pad.SetLayerSet(layer_set)

    # Solder mask margin: 0.5mm on each side of 1mm pad = 2mm total opening
    pad.SetLocalSolderMaskMargin(pcbnew.FromMM(MASK_MARGIN_MM))

    fp.Add(pad)
    return fp


def main():
    if len(sys.argv) < 3:
        print("Usage: add_fiducials.py <input.kicad_pcb> <output.kicad_pcb>")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    board = pcbnew.LoadBoard(input_path)
    bbox = board.GetBoardEdgesBoundingBox()

    left = pcbnew.ToMM(bbox.GetLeft())
    top = pcbnew.ToMM(bbox.GetTop())
    right = pcbnew.ToMM(bbox.GetRight())
    bottom = pcbnew.ToMM(bbox.GetBottom())

    print(f"  Board bounds: ({left:.1f}, {top:.1f}) to ({right:.1f}, {bottom:.1f})")
    print(f"  Board size: {right - left:.1f} x {bottom - top:.1f} mm")

    # 3 corners (skip bottom-right for asymmetry)
    corners = [
        ("top-left",     left + CORNER_INSET_MM,  top + CORNER_INSET_MM,     1,  0),
        ("top-right",    right - CORNER_INSET_MM, top + CORNER_INSET_MM,    -1,  0),
        ("bottom-left",  left + CORNER_INSET_MM,  bottom - CORNER_INSET_MM,  1,  0),
    ]

    footprints = get_footprint_positions(board)
    placed = 0

    for i, (name, x, y, dx, dy) in enumerate(corners):
        fx, fy = find_clear_position(x, y, dx, dy, footprints, COLLISION_RADIUS_MM)
        if fx is None:
            continue
        ref = f"FID{i + 1}"
        fid = create_fiducial(board, fx, fy, ref)
        board.Add(fid)
        placed += 1
        print(f"  Placed {ref} at ({fx:.1f}, {fy:.1f}) [{name}]")

    if placed < 2:
        print("ERROR: Need at least 2 fiducials for pick-and-place alignment")
        sys.exit(1)

    board.Save(output_path)
    print(f"  Saved: {output_path} ({placed} fiducials)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify the script runs on the main board**

Run:
```bash
cd /Users/devboy/dev/devboy/requencer
KICAD_APP=/Applications/KiCad/KiCad.app
DYLD_FRAMEWORK_PATH=$KICAD_APP/Contents/Frameworks \
PYTHONPATH=$KICAD_APP/Contents/Frameworks/Python.framework/Versions/3.9/lib/python3.9/site-packages \
$KICAD_APP/Contents/Frameworks/Python.framework/Versions/3.9/bin/python3 \
  hardware/boards/scripts/export/add_fiducials.py \
  hardware/boards/build/main-poured.kicad_pcb \
  hardware/boards/build/main-final.kicad_pcb
```

Expected: 3 fiducials placed, output file written.

- [ ] **Step 3: Verify the script runs on the control board**

Run same command with `control-poured.kicad_pcb` → `control-final.kicad_pcb`.

Expected: 3 fiducials placed, output file written.

---

### Task 2: Update the Makefile

**Files:**
- Modify: `hardware/Makefile`

- [ ] **Step 1: Add final PCB variables and targets**

After the `MAIN_POURED` variable (line 53), add:
```makefile
CONTROL_FINAL  := $(BUILD)/control-final.kicad_pcb
MAIN_FINAL     := $(BUILD)/main-final.kicad_pcb
```

Add `fiducials` to `.PHONY` list (line 88).

Add fiducial targets after the gnd-pours section (~line 200):
```makefile
# --- Fiducial marks (for pick-and-place alignment) ---
$(CONTROL_FINAL): $(CONTROL_POURED)
	$(KICAD_ENV) $(KICAD_PYTHON) $(SCRIPTS)/export/add_fiducials.py $< $@

$(MAIN_FINAL): $(MAIN_POURED)
	$(KICAD_ENV) $(KICAD_PYTHON) $(SCRIPTS)/export/add_fiducials.py $< $@

fiducials: $(CONTROL_FINAL) $(MAIN_FINAL)
```

- [ ] **Step 2: Update downstream dependencies**

Change export targets to depend on `*-final` instead of `*-poured`:
- `export-control`: `$(CONTROL_POURED)` → `$(CONTROL_FINAL)`
- `export-main`: `$(MAIN_POURED)` → `$(MAIN_FINAL)`

Change 3D targets:
- `$(CONTROL_3D)`: `$(CONTROL_POURED)` → `$(CONTROL_FINAL)`
- `$(MAIN_3D)`: `$(MAIN_POURED)` → `$(MAIN_FINAL)`

Update `all` target: add `fiducials` as dependency, update echo to show final files.

- [ ] **Step 3: Verify pipeline runs end-to-end**

Run:
```bash
cd /Users/devboy/dev/devboy/requencer/hardware
make fiducials
```

Expected: Both `*-final.kicad_pcb` files created with fiducials.

Then verify export still works:
```bash
make export-control export-main
```

Expected: Manufacturing files generated from the final (fiducial-containing) PCBs.
