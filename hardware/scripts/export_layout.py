#!/usr/bin/env python3
"""Export panel layout JSON from a placed KiCad PCB + component-map.json.

Reads a KiCad PCB file (placed or routed), extracts component positions
by atopile_address, and merges with UI metadata from component-map.json
to produce a panel-layout.json consumable by the web renderer.

Usage:
    python export_layout.py <input.kicad_pcb> <component-map.json> <output.json>

Requires: KiCad's pcbnew Python module (available in KiCad installation or Docker).
"""

import json
import sys


def export_layout(pcb_path, map_path, output_path):
    try:
        import pcbnew
    except ImportError:
        print("pcbnew not available. Run with KiCad's Python (see Makefile hw-export-layout).")
        sys.exit(1)

    with open(map_path) as f:
        comp_map = json.load(f)

    board = pcbnew.LoadBoard(pcb_path)

    # Build lookup from atopile_address to (x_mm, y_mm)
    positions = {}
    for fp in board.GetFootprints():
        if fp.HasFieldByName("atopile_address"):
            addr = fp.GetFieldText("atopile_address")
            pos = fp.GetPosition()
            positions[addr] = (
                pcbnew.ToMM(pos.x),
                pcbnew.ToMM(pos.y),
            )

    components = comp_map["components"]

    # PCB origin offset — convert PCB coords back to faceplate coords
    pcb_dims = comp_map["pcb"]
    ox = pcb_dims.get("origin_x_mm", 0)
    oy = pcb_dims.get("origin_y_mm", 0)

    # Track which addresses were found/missing
    found = 0
    missing = []

    def get_pos(addr):
        nonlocal found
        if addr in positions:
            found += 1
            x, y = positions[addr]
            return round(x + ox, 2), round(y + oy, 2)
        missing.append(addr)
        return None, None

    # --- Build grouped output matching panel-layout.json structure ---

    # Helper: collect components for a group, sorted by id
    def collect_group(group_name):
        items = []
        for addr, meta in components.items():
            if meta["group"] == group_name:
                x, y = get_pos(addr)
                if x is None:
                    continue
                entry = {"id": meta["id"], "x_mm": x, "y_mm": y}
                if "label" in meta:
                    entry["label"] = meta["label"]
                if "row" in meta:
                    entry["row"] = meta["row"]
                if "track" in meta:
                    entry["track"] = meta["track"]
                items.append(entry)
        return items

    # Jacks
    jacks_utility = collect_group("jacks.utility")
    jacks_output = collect_group("jacks.output")
    jacks_cv_input = collect_group("jacks.cv_input")

    # Buttons
    buttons_track = collect_group("buttons.track")
    buttons_subtrack = collect_group("buttons.subtrack")
    buttons_feature = collect_group("buttons.feature")
    buttons_step = collect_group("buttons.step")
    buttons_transport = collect_group("buttons.transport")

    # Single-item groups — TBD from non_pcb_components until placed in KiCad
    tbd_list = collect_group("buttons.tbd")
    tbd_fallback = comp_map.get("non_pcb_components", {}).get("buttons.tbd", {"id": "tbd", "label": "TBD", "x_mm": 0, "y_mm": 0})
    tbd = tbd_list[0] if tbd_list else tbd_fallback

    pat_list = collect_group("buttons.pat")
    pat = pat_list[0] if pat_list else {"id": "pat", "label": "PAT", "x_mm": 0, "y_mm": 0}

    # Encoders
    encoders = collect_group("encoders")

    # Non-PCB components (control strip) — positions from component-map directly
    control_strip = comp_map.get("non_pcb_components", {}).get("buttons.control_strip", [])

    # Assemble output
    output = {
        "panel": comp_map["panel"],
        "pcb": comp_map["pcb"],
        "constants": comp_map["constants"],
        "lcd_cutout": comp_map["lcd_cutout"],
        "mounting_slots": comp_map["mounting_slots"],
        "buttons": {
            "track": buttons_track,
            "tbd": tbd,
            "subtrack": buttons_subtrack,
            "pat": pat,
            "feature": buttons_feature,
            "step": buttons_step,
            "transport": buttons_transport,
            "control_strip": control_strip,
        },
        "encoders": encoders,
        "jacks": {
            "utility": jacks_utility,
            "output": jacks_output,
            "cv_input": jacks_cv_input,
        },
        "connectors": comp_map["connectors"],
        "footprints": comp_map["footprints"],
    }

    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)
        f.write("\n")

    print(f"  Exported {found}/{len(components)} component positions")
    if missing:
        print(f"  {len(missing)} addresses not found in PCB:")
        for m in missing:
            print(f"    - {m}")
    print(f"  Written: {output_path}")


def main():
    if len(sys.argv) != 4:
        print(f"Usage: {sys.argv[0]} <input.kicad_pcb> <component-map.json> <output.json>")
        sys.exit(1)

    export_layout(sys.argv[1], sys.argv[2], sys.argv[3])


if __name__ == "__main__":
    main()
