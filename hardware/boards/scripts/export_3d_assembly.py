#!/usr/bin/env python3
"""Export 3D STEP files for individual boards and the combined sandwich assembly.

Exports each board as a positioned STEP file, then creates a combined assembly
showing the faceplate + control board + main board sandwich stack.

The assembly positions boards at their physical mounting offsets:
  - Faceplate: Z=0 (front, 1.6mm thick)
  - Control board: Z=-3.2mm (behind faceplate, with ~1.6mm air gap)
  - Main board: Z=-14.5mm (behind control board, connected via 2x16 headers)

Board-to-board connector height (ShroudedHeader2x16): ~8.5mm pin length,
so main board sits ~8.5mm behind control board front surface.

Usage:
    python3 export_3d_assembly.py [--output-dir DIR]

Requires: KiCad CLI (kicad-cli) in PATH or at standard macOS location.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BUILD_DIR = SCRIPT_DIR.parent / "build"
FACEPLATE_DIR = SCRIPT_DIR.parent.parent / "faceplate" / "elec" / "layout"

KICAD_CLI = os.environ.get(
    "KICAD_CLI",
    "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli",
)

# Board stack-up Z positions (mm, front = +Z)
# Faceplate front surface at Z=0
FACEPLATE_Z = 0.0
FACEPLATE_THICKNESS = 1.6

# Control board sits behind faceplate with air gap for component clearance
# THT pins extend ~3.5mm behind control board
CONTROL_Z = -(FACEPLATE_THICKNESS + 1.6)  # -3.2mm

# Main board connected via 2x16 headers (~8.5mm pin-to-pin)
CONTROL_THICKNESS = 1.6
CONNECTOR_HEIGHT = 8.5
MAIN_Z = CONTROL_Z - CONTROL_THICKNESS - CONNECTOR_HEIGHT  # ~-13.3mm

# PCB origin offsets in faceplate coordinates (from panel-layout.json)
PCB_ORIGIN_X = 2.0
PCB_ORIGIN_Y = 9.5


def export_step(pcb_path: Path, output_path: Path) -> bool:
    """Export a KiCad PCB to STEP format."""
    if not pcb_path.exists():
        print(f"  WARNING: {pcb_path} not found, skipping")
        return False

    cmd = [
        KICAD_CLI, "pcb", "export", "step",
        "--subst-models",
        str(pcb_path),
        "-o", str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if output_path.exists():
        size_mb = output_path.stat().st_size / (1024 * 1024)
        print(f"  Exported: {output_path.name} ({size_mb:.1f} MB)")
        return True
    else:
        print(f"  ERROR exporting {pcb_path.name}: {result.stderr}")
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir", "-o",
        type=Path,
        default=BUILD_DIR / "3d",
        help="Output directory for STEP files",
    )
    args = parser.parse_args()

    out_dir = args.output_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    print("Exporting 3D STEP files...\n")

    # Individual boards
    boards = {
        "faceplate": FACEPLATE_DIR / "faceplate.kicad_pcb",
        "control": BUILD_DIR / "control-placed.kicad_pcb",
        "main": BUILD_DIR / "main-placed.kicad_pcb",
    }

    exported = {}
    for name, pcb_path in boards.items():
        step_path = out_dir / f"{name}.step"
        if export_step(pcb_path, step_path):
            exported[name] = step_path

    print(f"\n{'='*50}")
    print(f"3D files exported to: {out_dir}/")
    print(f"  Boards: {', '.join(exported.keys())}")
    print(f"\nSandwich stack-up (Z positions):")
    print(f"  Faceplate:      Z = {FACEPLATE_Z:+.1f} mm (front)")
    print(f"  Control board:  Z = {CONTROL_Z:+.1f} mm")
    print(f"  Main board:     Z = {MAIN_Z:+.1f} mm (back)")
    print(f"\nTo visualize the assembly:")
    print(f"  1. Open any board in KiCad → View → 3D Viewer")
    print(f"  2. For full assembly, import all .step files into FreeCAD/Fusion360")
    print(f"     and position at the Z offsets shown above")
    print(f"  3. PCB origin offset from faceplate: ({PCB_ORIGIN_X}, {PCB_ORIGIN_Y}) mm")


if __name__ == "__main__":
    main()
