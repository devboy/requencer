#!/usr/bin/env python3
"""Export JLCPCB-ready manufacturing files from a routed KiCad PCB.

Generates:
  - Gerber files (all layers) + drill files → ZIP
  - BOM CSV with LCSC part numbers
  - CPL (component placement list) CSV

Usage:
    python export_manufacturing.py <board.kicad_pcb> [output_dir]

Must be run with KiCad's Python (KICAD_PYTHON) for pcbnew access.
"""

import csv
import os
import subprocess
import sys
import zipfile

# Add parent dirs to path for common imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from common.kicad_env import setup_kicad_env, get_kicad_cli

setup_kicad_env()
import pcbnew


def run(cmd, **kwargs):
    print(f"  $ {' '.join(cmd)}")
    subprocess.run(cmd, check=True, **kwargs)


def sanitize_value(value):
    """Replace special characters that cause JLCPCB CSV parse issues."""
    replacements = {
        "±": "+-",
        "Ω": "Ohm",
        "µ": "u",
        "°": "deg",
    }
    for char, repl in replacements.items():
        value = value.replace(char, repl)
    return value


def export_gerbers(pcb_path, output_dir):
    """Export Gerber files + drill files."""
    gerber_dir = os.path.join(output_dir, "gerbers")
    os.makedirs(gerber_dir, exist_ok=True)
    cli = get_kicad_cli()

    run([cli, "pcb", "export", "gerbers", pcb_path,
         "-o", gerber_dir + "/",
         "--no-protel-ext"])

    run([cli, "pcb", "export", "drill", pcb_path,
         "-o", gerber_dir + "/",
         "--format", "excellon",
         "--drill-origin", "absolute",
         "--excellon-units", "mm"])

    zip_path = os.path.join(output_dir, "requencer-gerbers.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(gerber_dir):
            for f in files:
                filepath = os.path.join(root, f)
                zf.write(filepath, os.path.relpath(filepath, gerber_dir))

    print(f"  Gerbers packaged: {zip_path}")
    return zip_path


def _get_components(board):
    """Extract SMD component data from a pcbnew Board object.

    Returns list of dicts with reference, value, footprint, lcsc.
    Skips components excluded from BOM or position files.
    """
    # Use auxiliary origin (drill origin) so CPL coordinates match gerbers/drills.
    # JLCPCB expects positions relative to this origin.
    aux_origin = board.GetDesignSettings().GetAuxOrigin()
    ox = pcbnew.ToMM(aux_origin.x)
    oy = pcbnew.ToMM(aux_origin.y)

    components = []
    for fp in board.GetFootprints():
        attrs = fp.GetAttributes()
        if attrs & pcbnew.FP_EXCLUDE_FROM_BOM:
            continue
        if attrs & pcbnew.FP_EXCLUDE_FROM_POS_FILES:
            continue
        if not (attrs & pcbnew.FP_SMD):
            continue

        ref = fp.GetReference()
        if not ref or ref == "REF**":
            continue

        fp_name = fp.GetFPID().GetUniStringLibItemName()
        lcsc = fp.GetFieldText("LCSC") if fp.HasField("LCSC") else ""

        pos = fp.GetPosition()
        layer = fp.GetLayer()

        components.append({
            "reference": ref,
            "value": fp.GetValue(),
            "footprint": fp_name,
            "lcsc": lcsc,
            "x": pcbnew.ToMM(pos.x) - ox,
            "y": -(pcbnew.ToMM(pos.y) - oy),
            "rotation": fp.GetOrientationDegrees(),
            "layer": "Top" if layer == pcbnew.F_Cu else "Bottom",
        })

    return components


def export_bom(components, output_dir):
    """Export BOM CSV matching the Bouni/kicad-jlcpcb-tools format.

    Header: Comment, Designator, Footprint, LCSC
    Groups identical components into one row.
    """
    bom_path = os.path.join(output_dir, "jlcpcb-bom.csv")

    groups = {}
    for c in components:
        key = (c["value"], c["footprint"], c["lcsc"])
        groups.setdefault(key, []).append(c["reference"])

    with open(bom_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Comment", "Designator", "Footprint", "LCSC"])
        for (value, footprint, lcsc), refs in sorted(groups.items()):
            writer.writerow([
                sanitize_value(value),
                ", ".join(sorted(refs)),
                footprint,
                lcsc,
            ])

    print(f"  BOM: {bom_path} ({len(groups)} unique parts, {len(components)} placements)")
    return bom_path


def export_cpl(components, output_dir):
    """Export CPL CSV matching JLCPCB format.

    Header: Designator, Val, Package, Mid X, Mid Y, Rotation, Layer
    """
    cpl_path = os.path.join(output_dir, "jlcpcb-cpl.csv")

    with open(cpl_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Designator", "Val", "Package", "Mid X", "Mid Y", "Rotation", "Layer"])
        for c in sorted(components, key=lambda c: c["reference"]):
            writer.writerow([
                c["reference"],
                sanitize_value(c["value"]),
                c["footprint"],
                f"{c['x']:.6f}",
                f"{c['y']:.6f}",
                f"{c['rotation']:.6f}",
                c["layer"],
            ])

    print(f"  CPL: {cpl_path} ({len(components)} placements)")
    return cpl_path


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <board.kicad_pcb> [output_dir]")
        sys.exit(1)

    pcb_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(pcb_path), "manufacturing"
    )
    os.makedirs(output_dir, exist_ok=True)

    print(f"=== Exporting manufacturing files from {pcb_path} ===")
    export_gerbers(pcb_path, output_dir)

    board = pcbnew.LoadBoard(pcb_path)
    components = _get_components(board)
    print(f"  {len(components)} SMD components for assembly")

    bom_path = export_bom(components, output_dir)
    cpl_path = export_cpl(components, output_dir)

    # Cross-check: BOM and CPL should have identical designator sets
    bom_desigs = set()
    with open(bom_path) as f:
        for row in csv.DictReader(f):
            for d in row.get("Designator", "").split(","):
                d = d.strip()
                if d:
                    bom_desigs.add(d)
    cpl_desigs = set()
    with open(cpl_path) as f:
        for row in csv.DictReader(f):
            cpl_desigs.add(row.get("Designator", "").strip())

    if bom_desigs != cpl_desigs:
        bom_only = bom_desigs - cpl_desigs
        cpl_only = cpl_desigs - bom_desigs
        if bom_only:
            print(f"  WARNING: {len(bom_only)} BOM-only: {', '.join(sorted(bom_only)[:10])}")
        if cpl_only:
            print(f"  WARNING: {len(cpl_only)} CPL-only: {', '.join(sorted(cpl_only)[:10])}")
    else:
        print(f"  BOM/CPL match: {len(bom_desigs)} designators")

    print(f"\n=== Manufacturing files ready in {output_dir} ===")
    print("Upload to JLCPCB:")
    print(f"  Gerbers: {output_dir}/requencer-gerbers.zip")
    print(f"  BOM:     {output_dir}/jlcpcb-bom.csv")
    print(f"  CPL:     {output_dir}/jlcpcb-cpl.csv")


if __name__ == "__main__":
    main()
