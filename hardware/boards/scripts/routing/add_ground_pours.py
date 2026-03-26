#!/usr/bin/env python3
"""Add GND copper pour zones to all copper layers of routed PCBs.

4-layer stackup: F.Cu / In1.Cu / In2.Cu / B.Cu

FreeRouting routes signals on all 4 layers but doesn't create copper fills.
This script adds full-board GND copper pour zones on all copper layers to:
  - Connect isolated GND track segments through the copper fill
  - Provide solid ground planes for signal integrity
  - Fill unused PCB area (reduces etching, improves EMI)

Usage:
    python3 add_ground_pours.py <input.kicad_pcb> [--gnd-net <name>]

    Modifies the PCB file in-place.
"""

import json
import os
import sys
import pcbnew

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BOARDS_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", ".."))
DESIGN_RULES_PATH = os.path.join(BOARDS_DIR, "design-rules.json")


def load_design_rules():
    """Load clearance and min thickness from design-rules.json."""
    with open(DESIGN_RULES_PATH) as f:
        rules = json.load(f)
    # Use the largest netclass clearance so the pour respects all nets
    netclasses = rules.get("netclasses", {})
    max_clearance = max(
        (nc.get("clearance", 0.127) for nc in netclasses.values()),
        default=0.127,
    )
    min_track = rules.get("board_minimums", {}).get("track_min_width", 0.15)
    return max_clearance, min_track


def find_gnd_net(board):
    """Find the GND net (largest net by pad count)."""
    best_name = None
    best_code = None
    best_count = 0

    for net_code in range(board.GetNetCount()):
        net = board.GetNetInfo().GetNetItem(net_code)
        name = net.GetNetname()
        if not name:
            continue
        count = sum(
            1 for fp in board.GetFootprints()
            for pad in fp.Pads()
            if pad.GetNetCode() == net_code
        )
        if count > best_count:
            best_count = count
            best_code = net_code
            best_name = name

    return best_name, best_code, best_count


def add_pour_zone(board, layer_id, net_code, net_name, clearance_mm=0.15, min_thickness_mm=0.15, margin_mm=0.0):
    """Add a copper fill zone covering the entire board on the given layer."""
    bbox = board.GetBoardEdgesBoundingBox()

    # Use board edges exactly (no expansion — avoids copper_edge_clearance errors)
    expand = pcbnew.FromMM(margin_mm)
    x1 = bbox.GetLeft() + expand
    y1 = bbox.GetTop() + expand
    x2 = bbox.GetRight() - expand
    y2 = bbox.GetBottom() - expand

    zone = pcbnew.ZONE(board)
    # KiCad 10: SetNetCode silently fails before zone is added to board.
    # Use SetNet with the NETINFO_ITEM instead.
    net_item = board.GetNetInfo().GetNetItem(net_code)
    zone.SetNet(net_item)
    zone.SetLayer(layer_id)
    zone.SetIsRuleArea(False)
    zone.SetDoNotAllowTracks(False)
    zone.SetDoNotAllowVias(False)
    zone.SetDoNotAllowPads(False)
    zone.SetDoNotAllowZoneFills(False)

    # Zone fill settings — solid connection to avoid starved thermal errors
    zone.SetFillMode(pcbnew.ZONE_FILL_MODE_POLYGONS)
    zone.SetPadConnection(pcbnew.ZONE_CONNECTION_FULL)
    zone.SetMinThickness(pcbnew.FromMM(min_thickness_mm))

    # Clearance from other nets' copper (from design-rules.json)
    zone.SetLocalClearance(pcbnew.FromMM(clearance_mm))

    # Low priority so signal traces take precedence
    zone.SetAssignedPriority(0)

    # Create rectangular outline
    outline = zone.Outline()
    outline.NewOutline()
    outline.Append(x1, y1)
    outline.Append(x2, y1)
    outline.Append(x2, y2)
    outline.Append(x1, y2)

    board.Add(zone)

    layer_name = board.GetLayerName(layer_id)
    print(f"  Added GND pour on {layer_name} (net \"{net_name}\", code {net_code})")

    return zone


def main():
    if len(sys.argv) < 2:
        print("Usage: add_ground_pours.py <input.kicad_pcb> [output.kicad_pcb] [--gnd-net <name>]")
        sys.exit(1)

    pcb_path = sys.argv[1]
    # Output path: second positional arg, or in-place if not given
    output_path = None
    gnd_net_override = None
    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == "--gnd-net":
            gnd_net_override = sys.argv[i + 1]
            i += 2
        elif output_path is None and not sys.argv[i].startswith("--"):
            output_path = sys.argv[i]
            i += 1
        else:
            i += 1
    if output_path is None:
        output_path = pcb_path

    board = pcbnew.LoadBoard(pcb_path)

    # Remove all existing zones (clean slate)
    zones_to_remove = []
    for i in range(board.GetAreaCount()):
        zones_to_remove.append(board.GetArea(i))

    for zone in zones_to_remove:
        layer_name = board.GetLayerName(zone.GetLayer())
        board.Remove(zone)
        print(f"  Removed existing zone on {layer_name}")

    # Find GND net
    if gnd_net_override:
        for net_code in range(board.GetNetCount()):
            net = board.GetNetInfo().GetNetItem(net_code)
            if net.GetNetname() == gnd_net_override:
                gnd_name = gnd_net_override
                gnd_code = net_code
                break
        else:
            print(f"ERROR: Net \"{gnd_net_override}\" not found")
            sys.exit(1)
    else:
        gnd_name, gnd_code, gnd_count = find_gnd_net(board)
        print(f"  GND net: \"{gnd_name}\" ({gnd_count} pads)")

    # Load clearance settings from design-rules.json
    clearance_mm, min_thickness_mm = load_design_rules()
    print(f"  Zone clearance: {clearance_mm}mm, min thickness: {min_thickness_mm}mm (from design-rules.json)")

    # Add GND pours on all 4 copper layers
    for layer_name in ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"]:
        layer_id = board.GetLayerID(layer_name)
        add_pour_zone(board, layer_id, gnd_code, gnd_name, clearance_mm, min_thickness_mm)

    # Fill all zones
    filler = pcbnew.ZONE_FILLER(board)
    zones = board.Zones()
    filler.Fill(zones)
    print(f"  Filled {len(zones)} zone(s)")

    # Save
    board.Save(output_path)
    print(f"  Saved: {output_path}")


if __name__ == "__main__":
    main()
