#!/usr/bin/env python3
"""Export JLCPCB-ready manufacturing files from a routed KiCad PCB.

Generates:
  - Gerber files (all layers) + drill files → ZIP
  - BOM CSV with LCSC part numbers
  - CPL (component placement list) CSV

Usage:
    python export_manufacturing.py <board.kicad_pcb> [output_dir]

Requires: kicad-cli (set PATH to include KiCad.app/Contents/MacOS)
"""

import csv
import json
import os
import subprocess
import sys
import zipfile


def run(cmd, **kwargs):
    print(f"  $ {' '.join(cmd)}")
    subprocess.run(cmd, check=True, **kwargs)


def export_gerbers(pcb_path, output_dir):
    """Export Gerber files + drill files."""
    gerber_dir = os.path.join(output_dir, "gerbers")
    os.makedirs(gerber_dir, exist_ok=True)

    # Gerber layers
    run(["kicad-cli", "pcb", "export", "gerbers", pcb_path,
         "-o", gerber_dir + "/",
         "--no-protel-ext"])

    # Drill files
    run(["kicad-cli", "pcb", "export", "drill", pcb_path,
         "-o", gerber_dir + "/",
         "--format", "excellon",
         "--drill-origin", "absolute",
         "--excellon-units", "mm"])

    # Package into ZIP
    zip_path = os.path.join(output_dir, "requencer-gerbers.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(gerber_dir):
            for f in files:
                filepath = os.path.join(root, f)
                zf.write(filepath, os.path.relpath(filepath, gerber_dir))

    print(f"  Gerbers packaged: {zip_path}")
    return zip_path


def export_bom(pcb_path, output_dir):
    """Export BOM CSV with LCSC part numbers.

    JLCPCB BOM format:
    Comment, Designator, Footprint, LCSC Part Number

    Sources (in priority order):
    1. Atopile BOM at hardware/pcb/build/builds/default/default.bom.csv
    2. KiCad schematic adjacent to PCB (kicad-cli sch export bom)
    """
    bom_path = os.path.join(output_dir, "jlcpcb-bom.csv")

    # Try atopile BOM first (has LCSC part numbers from EasyEDA picker)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    ato_bom = os.path.join(script_dir, "..", "build", "builds", "default", "default.bom.csv")
    ato_bom = os.path.normpath(ato_bom)

    if os.path.exists(ato_bom):
        print(f"  Using atopile BOM: {ato_bom}")
        with open(ato_bom) as fin, open(bom_path, "w", newline="") as fout:
            reader = csv.DictReader(fin)
            writer = csv.writer(fout)
            writer.writerow(["Comment", "Designator", "Footprint", "LCSC Part Number"])
            for row in reader:
                writer.writerow([
                    row.get("Value", ""),
                    row.get("Designator", ""),
                    row.get("Footprint", ""),
                    row.get("LCSC Part #", ""),
                ])
        print(f"  BOM: {bom_path}")
        return bom_path

    # Fallback: kicad-cli from schematic
    raw_bom = os.path.join(output_dir, "raw-bom.csv")
    schematic = pcb_path.replace(".kicad_pcb", ".kicad_sch")

    if os.path.exists(schematic):
        run(["kicad-cli", "sch", "export", "bom", schematic,
             "-o", raw_bom,
             "--fields", "Reference,Value,Footprint,LCSC"])
        if os.path.exists(raw_bom):
            with open(raw_bom) as fin, open(bom_path, "w", newline="") as fout:
                reader = csv.DictReader(fin)
                writer = csv.writer(fout)
                writer.writerow(["Comment", "Designator", "Footprint", "LCSC Part Number"])
                for row in reader:
                    writer.writerow([
                        row.get("Value", ""),
                        row.get("Reference", ""),
                        row.get("Footprint", ""),
                        row.get("LCSC", ""),
                    ])
            os.remove(raw_bom)
    else:
        print(f"  WARNING: No BOM source found (no atopile BOM, no schematic)")
        with open(bom_path, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["Comment", "Designator", "Footprint", "LCSC Part Number"])

    print(f"  BOM: {bom_path}")
    return bom_path


def export_cpl(pcb_path, output_dir):
    """Export component placement list (pick-and-place).

    JLCPCB CPL format:
    Designator, Val, Package, Mid X, Mid Y, Rotation, Layer
    """
    cpl_path = os.path.join(output_dir, "jlcpcb-cpl.csv")

    run(["kicad-cli", "pcb", "export", "pos", pcb_path,
         "-o", cpl_path,
         "--format", "csv",
         "--units", "mm",
         "--side", "both",
         "--use-drill-file-origin"])

    print(f"  CPL: {cpl_path}")
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
    export_bom(pcb_path, output_dir)
    export_cpl(pcb_path, output_dir)
    print(f"\n=== Manufacturing files ready in {output_dir} ===")
    print("Upload to JLCPCB:")
    print(f"  Gerbers: {output_dir}/requencer-gerbers.zip")
    print(f"  BOM:     {output_dir}/jlcpcb-bom.csv")
    print(f"  CPL:     {output_dir}/jlcpcb-cpl.csv")


if __name__ == "__main__":
    main()
