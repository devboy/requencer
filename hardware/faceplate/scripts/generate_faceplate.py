#!/usr/bin/env python3
"""Generate a JLCPCB-ready faceplate PCB from panel-layout.json.

Creates a KiCad PCB file (.kicad_pcb) with:
  - Board outline on Edge.Cuts
  - Drill holes at jack/button/encoder positions
  - LCD rectangular cutout (routed slot)
  - Mounting slots at rail positions
  - Silkscreen labels on F.SilkS

Usage:
    python generate_faceplate.py [panel-layout.json] [output.kicad_pcb]

Requires: KicadModTree (pip install KicadModTree)
"""

import json
import math
import os
import sys


def load_layout(path):
    with open(path) as f:
        return json.load(f)


def mm(v):
    """Format mm value for KiCad S-expression (3 decimal places)."""
    return f"{v:.3f}"


class KicadPcbWriter:
    """Minimal KiCad .kicad_pcb file writer for mechanical-only boards."""

    def __init__(self, width_mm, height_mm):
        self.width = width_mm
        self.height = height_mm
        self.items = []
        self._fp_count = 0

    def add_board_outline(self):
        """Add rectangular board outline on Edge.Cuts."""
        corners = [
            (0, 0), (self.width, 0),
            (self.width, self.height), (0, self.height),
        ]
        for i in range(4):
            x1, y1 = corners[i]
            x2, y2 = corners[(i + 1) % 4]
            self.items.append(
                f'  (gr_line (start {mm(x1)} {mm(y1)}) (end {mm(x2)} {mm(y2)}) '
                f'(layer "Edge.Cuts") (width 0.1))'
            )

    def add_drill_hole(self, x, y, diameter, label="", ref_prefix="H"):
        """Add a through-hole drill at (x, y) with given diameter."""
        self._fp_count += 1
        ref = f"{ref_prefix}{self._fp_count}"
        pad_section = (
            f'    (pad "1" thru_hole circle (at 0 0) (size {mm(diameter + 1)} {mm(diameter + 1)}) '
            f'(drill {mm(diameter)}) (layers "*.Cu" "*.Mask"))'
        )
        silk_label = ""
        if label:
            silk_label = (
                f'    (fp_text user "{label}" (at 0 {mm(diameter / 2 + 1.5)}) '
                f'(layer "F.SilkS") (effects (font (face "JetBrains Mono") (size 1.2 1.2) (thickness 0.15))))'
            )
        fp = (
            f'  (footprint "Faceplate:{ref}" (layer "F.Cu")\n'
            f'    (at {mm(x)} {mm(y)})\n'
            f'    (attr exclude_from_pos_files exclude_from_bom)\n'
            f'    (fp_text reference "{ref}" (at 0 {mm(-diameter / 2 - 1.5)}) '
            f'(layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))\n'
            f'{pad_section}\n'
            f'{silk_label}'
            f'  )'
        )
        self.items.append(fp)

    def add_oval_slot(self, x, y, w, h, label=""):
        """Add an oval mounting slot (plated)."""
        self._fp_count += 1
        ref = f"SLOT{self._fp_count}"
        pad_section = (
            f'    (pad "1" thru_hole oval (at 0 0) (size {mm(w + 1)} {mm(h + 1)}) '
            f'(drill oval {mm(w)} {mm(h)}) (layers "*.Cu" "*.Mask"))'
        )
        fp = (
            f'  (footprint "Faceplate:{ref}" (layer "F.Cu")\n'
            f'    (at {mm(x)} {mm(y)})\n'
            f'    (attr exclude_from_pos_files exclude_from_bom)\n'
            f'    (fp_text reference "{ref}" (at 0 {mm(-h / 2 - 2)}) '
            f'(layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))\n'
            f'{pad_section}\n'
            f'  )'
        )
        self.items.append(fp)

    def add_rectangular_cutout(self, cx, cy, w, h):
        """Add a rectangular milled cutout on Edge.Cuts."""
        x1, y1 = cx - w / 2, cy - h / 2
        x2, y2 = cx + w / 2, cy + h / 2
        corners = [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]
        for i in range(4):
            sx, sy = corners[i]
            ex, ey = corners[(i + 1) % 4]
            self.items.append(
                f'  (gr_line (start {mm(sx)} {mm(sy)}) (end {mm(ex)} {mm(ey)}) '
                f'(layer "Edge.Cuts") (width 0.1))'
            )

    def add_silkscreen_text(self, x, y, text, size=1.5, thickness=0.15,
                            justify="center", font_face=None):
        """Add silkscreen text on F.SilkS."""
        just = f' (justify {justify})' if justify != "center" else ""
        face = f' (face "{font_face}")' if font_face else ""
        self.items.append(
            f'  (gr_text "{text}" (at {mm(x)} {mm(y)}) (layer "F.SilkS") '
            f'(effects (font{face} (size {size} {size}) (thickness {thickness})){just}))'
        )

    def write(self, path):
        """Write complete .kicad_pcb file."""
        header = f"""(kicad_pcb (version 20221018) (generator "generate_faceplate.py")

  (general
    (thickness 1.6)
  )

  (paper "A4")

  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (36 "B.SilkS" user "B.Silkscreen")
    (37 "F.SilkS" user "F.Silkscreen")
    (38 "B.Mask" user "B.Mask")
    (39 "F.Mask" user "F.Mask")
    (44 "Edge.Cuts" user)
    (46 "B.Fab" user)
    (47 "F.Fab" user)
  )

  (setup
    (stackup
      (layer "F.SilkS" (type "Top Silk Screen") (color "White"))
      (layer "F.Mask" (type "Top Solder Mask") (color "Black"))
      (layer "F.Cu" (type "copper") (thickness 0.035))
      (layer "dielectric 1" (type "core") (thickness 1.51) (material "FR4"))
      (layer "B.Cu" (type "copper") (thickness 0.035))
      (layer "B.Mask" (type "Bottom Solder Mask") (color "Black"))
      (layer "B.SilkS" (type "Bottom Silk Screen") (color "White"))
    )
    (pad_to_mask_clearance 0)
    (grid_origin 0 0)
  )

  (net 0 "")

"""
        footer = "\n)\n"

        with open(path, "w") as f:
            f.write(header)
            for item in self.items:
                f.write(item + "\n\n")
            f.write(footer)

        print(f"  Written: {path}")


def generate_faceplate(layout, output_path):
    panel = layout["panel"]
    consts = layout["constants"]

    pcb = KicadPcbWriter(panel["width_mm"], panel["height_mm"])

    # 1. Board outline
    pcb.add_board_outline()
    print("  Board outline added")

    # 2. Mounting slots
    slot_w = consts["mount_slot_w_mm"]
    slot_h = consts["mount_slot_h_mm"]
    for slot in layout["mounting_slots"]:
        pcb.add_oval_slot(slot["x_mm"], slot["y_mm"], slot_w, slot_h)
    print(f"  {len(layout['mounting_slots'])} mounting slots added")

    # 3. Standoff drill holes (M3, 3.2mm)
    standoff_drill = 3.2
    standoffs = layout.get("standoffs", [])
    for so in standoffs:
        pcb.add_drill_hole(
            so["x_mm"], so["y_mm"],
            standoff_drill, ref_prefix="SO",
        )
    if standoffs:
        print(f"  {len(standoffs)} standoff holes added (3.2mm drill)")

    # 4. LCD cutout
    lcd = layout["lcd_cutout"]
    pcb.add_rectangular_cutout(
        lcd["center_x_mm"], lcd["center_y_mm"],
        lcd["width_mm"], lcd["height_mm"],
    )
    print("  LCD cutout added")

    # 5. Jack holes (6mm drill for PJ398SM / PJ366ST)
    jack_drill = 6.0
    jack_count = 0
    for group_name in ("utility", "clock", "output", "cv_input"):
        for jack in layout["jacks"].get(group_name, []):
            pcb.add_drill_hole(
                jack["x_mm"], jack["y_mm"],
                jack_drill, jack.get("label", ""),
                ref_prefix="J",
            )
            jack_count += 1
    print(f"  {jack_count} jack holes added (6.0mm drill)")

    # 6. Button holes — per TC002 datasheet mounting hole
    btn_drill = 3.2  # TC002 panel mount shaft
    btn_count = 0
    for group_name in ("track", "subtrack", "feature", "step", "transport", "control_strip"):
        items = layout["buttons"].get(group_name, [])
        if isinstance(items, dict):
            items = [items]
        for btn in items:
            pcb.add_drill_hole(
                btn["x_mm"], btn["y_mm"],
                btn_drill, btn.get("label", ""),
                ref_prefix="SW",
            )
            btn_count += 1
    # PAT button (single item, not in a list)
    pat = layout["buttons"].get("pat")
    if pat:
        pcb.add_drill_hole(
            pat["x_mm"], pat["y_mm"],
            btn_drill, pat.get("label", ""),
            ref_prefix="SW",
        )
        btn_count += 1
    print(f"  {btn_count} button holes added (3.2mm drill)")

    # 7. Encoder holes (7mm drill for EC11E shaft)
    enc_drill = 7.0
    for enc in layout["encoders"]:
        pcb.add_drill_hole(
            enc["x_mm"], enc["y_mm"],
            enc_drill, enc.get("label", ""),
            ref_prefix="ENC",
        )
    print(f"  {len(layout['encoders'])} encoder holes added (7.0mm drill)")

    # 8. SD card cutout (rectangular slot through faceplate)
    sd = layout.get("connectors", {}).get("sd_card", {})
    sd_x = sd.get("x_mm")
    sd_y = sd.get("y_mm")
    if sd_x is not None and sd_y is not None:
        pcb.add_rectangular_cutout(
            sd_x, sd_y,
            sd.get("width_mm", 13.0), sd.get("height_mm", 3.0),
        )
        print("  SD card cutout added")
    else:
        print("  SD card cutout skipped (no position in layout)")

    # 9. Silkscreen labels (JetBrains Mono for matching web UI aesthetic)
    font = "JetBrains Mono"

    # Module name at top center
    pcb.add_silkscreen_text(
        panel["width_mm"] / 2, 5.0,
        "REQUENCER", size=3.0, thickness=0.3, font_face=font,
    )

    # Brand at bottom center
    pcb.add_silkscreen_text(
        panel["width_mm"] / 2, panel["height_mm"] - 4.0,
        "VILE TENSOR", size=1.5, thickness=0.15, font_face=font,
    )

    # Section labels
    pcb.add_silkscreen_text(12.0, 10.0, "TRACK", size=1.2, thickness=0.15, font_face=font)
    pcb.add_silkscreen_text(101.72, 10.0, "SUB", size=1.2, thickness=0.15, font_face=font)
    pcb.add_silkscreen_text(112.05, 10.0, "FN", size=1.2, thickness=0.15, font_face=font)
    pcb.add_silkscreen_text(55.0, 85.0, "STEPS", size=1.2, thickness=0.15, font_face=font)

    # Output jack section label (between clock and cv rows)
    pcb.add_silkscreen_text(149.55, 52.4, "OUTPUT", size=1.5, thickness=0.2, font_face=font)

    # CV input section label (between vel and mod rows)
    pcb.add_silkscreen_text(149.55, 103.6, "CV IN", size=1.2, thickness=0.15, font_face=font)

    # Row labels for output jacks (uniform 12.8mm spacing from gate=71.6)
    pcb.add_silkscreen_text(122.0, 65.2, "G", size=1.2, thickness=0.15, font_face=font)
    pcb.add_silkscreen_text(122.0, 78.0, "P", size=1.2, thickness=0.15, font_face=font)
    pcb.add_silkscreen_text(122.0, 90.8, "V", size=1.2, thickness=0.15, font_face=font)
    pcb.add_silkscreen_text(122.0, 103.6, "M", size=1.2, thickness=0.15, font_face=font)

    print("  Silkscreen labels added")

    # Write output
    pcb.write(output_path)


def load_faceplate_layout(layout_path, comp_map_path):
    """Load layout, overriding panel dims and mounting from component-map if available."""
    layout = load_layout(layout_path)
    if os.path.exists(comp_map_path):
        comp_map = load_layout(comp_map_path)
        # Override panel dimensions with corrected eurorack values
        layout["panel"] = comp_map["panel"]
        layout["constants"] = comp_map["constants"]
        layout["mounting_slots"] = comp_map["mounting_slots"]
        if "standoffs" in comp_map:
            layout["standoffs"] = comp_map["standoffs"]
        print(f"  Using dimensions from: {comp_map_path}")
    return layout


def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    layout_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(repo_root, "web", "src", "panel-layout.json")
    comp_map_path = os.path.join(repo_root, "hardware", "pcb", "component-map.json")
    output_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "elec", "layout", "faceplate.kicad_pcb",
    )

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    print(f"=== Generating faceplate PCB ===")
    print(f"  Layout: {layout_path}")
    print(f"  Output: {output_path}")

    layout = load_faceplate_layout(layout_path, comp_map_path)
    generate_faceplate(layout, output_path)

    print(f"\n=== Faceplate PCB ready: {output_path} ===")
    print("Specs: FR4 1.6mm, matte black soldermask, white silkscreen")


if __name__ == "__main__":
    main()
