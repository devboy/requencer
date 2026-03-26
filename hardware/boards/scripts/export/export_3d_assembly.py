#!/usr/bin/env python3
"""Export 3D STEP files for individual boards and the sandwich assembly.

Exports each board as a STEP file and writes a stack-up metadata JSON
consumed by the web 3D assembly viewer.

Input PCBs: *-3d.kicad_pcb (routed boards with 3D model references added).
Faceplate uses its source PCB directly (no routing step).

Usage:
    python3 export_3d_assembly.py <control.kicad_pcb> <main.kicad_pcb> <faceplate.kicad_pcb> [--output-dir DIR]

Requires: KiCad CLI (kicad-cli) in PATH or at standard macOS location.
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BOARDS_DIR = SCRIPT_DIR.parent.parent
BUILD_DIR = BOARDS_DIR / "build"

KICAD_CLI = os.environ.get(
    "KICAD_CLI",
    "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli",
)

# Board stack-up Z positions (mm, front = +Z)
# Faceplate front surface at Z=0
FACEPLATE_Z = 0.0
FACEPLATE_THICKNESS = 1.6

# Control board sits behind faceplate, spaced by jack plastic housing height.
# WQP518MA: plastic housing top ~8.9mm above footprint origin.
# STEP export: board bottom at Z=0, F.Cu at Z=1.6.
# Housing top in export coords = 1.6 + 8.9 = 10.5mm.
# Faceplate back at Z=0 → control at Z=-10.5.
JACK_SHOULDER_Z = 10.5  # mm from export Z=0 to jack housing top
CONTROL_Z = -JACK_SHOULDER_Z  # -13.5mm

# Main board connected via 2x16 shrouded headers
# 8.5mm pin-to-pin mating height + 5.0mm male header plastic body
CONTROL_THICKNESS = 1.6
CONNECTOR_HEIGHT = 13.5
MAIN_Z = CONTROL_Z - CONTROL_THICKNESS - CONNECTOR_HEIGHT  # ~-28.6mm

# PCB origin offsets in faceplate coordinates (from component-map.json)
PCB_ORIGIN_X = 2.36
PCB_ORIGIN_Y = 10.5

STACK_UP = {
    "faceplate": {"z": FACEPLATE_Z, "thickness": FACEPLATE_THICKNESS},
    "control": {"z": CONTROL_Z, "thickness": CONTROL_THICKNESS},
    "main": {"z": MAIN_Z, "thickness": CONTROL_THICKNESS},
}


def export_step(pcb_path: Path, output_path: Path) -> bool:
    """Export a KiCad PCB to STEP format."""
    if not pcb_path.exists():
        print(f"  WARNING: {pcb_path} not found, skipping")
        return False

    output_path.parent.mkdir(parents=True, exist_ok=True)
    # kicad-cli doesn't auto-resolve ${KIPRJMOD} from the .kicad_pro file,
    # so we must pass it explicitly for local model paths to resolve.
    kiprjmod = str(pcb_path.resolve().parent)
    cmd = [
        KICAD_CLI, "pcb", "export", "step",
        "--subst-models",
        "--include-pads",
        "--include-zones",
        "--include-silkscreen",
        "--include-soldermask",
        "-D", f"KIPRJMOD={kiprjmod}",
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
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("control_pcb", type=Path, help="Control board PCB (e.g. control-3d.kicad_pcb)")
    parser.add_argument("main_pcb", type=Path, help="Main board PCB (e.g. main-3d.kicad_pcb)")
    parser.add_argument("faceplate_pcb", type=Path, help="Faceplate PCB")
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

    boards = {
        "control": args.control_pcb,
        "main": args.main_pcb,
        "faceplate": args.faceplate_pcb,
    }

    exported = {}
    for name, pcb_path in boards.items():
        step_path = out_dir / f"{name}.step"
        if export_step(pcb_path, step_path):
            exported[name] = step_path

    # Write stack-up metadata for the web assembly viewer
    metadata = {
        "stack_up": STACK_UP,
        "pcb_origin": {"x": PCB_ORIGIN_X, "y": PCB_ORIGIN_Y},
        "boards": list(exported.keys()),
    }
    metadata_path = out_dir / "stack-up.json"
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"\n{'='*50}")
    print(f"3D files exported to: {out_dir}/")
    print(f"  Boards: {', '.join(exported.keys())}")
    print(f"  Metadata: {metadata_path.name}")
    print(f"\nSandwich stack-up (Z positions):")
    print(f"  Faceplate:      Z = {FACEPLATE_Z:+.1f} mm (front)")
    print(f"  Control board:  Z = {CONTROL_Z:+.1f} mm")
    print(f"  Main board:     Z = {MAIN_Z:+.1f} mm (back)")


if __name__ == "__main__":
    main()
