#!/usr/bin/env python3
"""Generate KiCad footprints (.kicad_mod) for through-hole components.

Writes KiCad S-expression format directly — no external dependencies.
Output: hardware/elec/footprints/*.kicad_mod

Components:
  - PJ398SM (Thonkiconn 3.5mm mono jack)
  - TC002-N11AS1XT-RGB (Well Buying RGB tactile switch)
  - EC11E (Alps rotary encoder with push switch)
  - RPi Pico (castellated pad module)
  - 2x5 shrouded header (eurorack power)
"""

import json
import os
import sys


FOOTPRINT_DIR = os.path.join(os.path.dirname(__file__), "..", "elec", "footprints")
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LAYOUT_PATH = os.path.join(REPO_ROOT, "panel-layout.json")


def load_footprint_specs():
    """Load footprint specs from panel-layout.json."""
    with open(LAYOUT_PATH) as f:
        layout = json.load(f)
    return layout["footprints"]


def mm(v):
    """Format mm value for S-expression."""
    return f"{v:.3f}"


def tht_pad(number, x, y, size, drill, shape="circle", layers='"*.Cu" "*.Mask"'):
    """Generate a through-hole pad S-expression."""
    return (
        f'  (pad "{number}" thru_hole {shape} (at {mm(x)} {mm(y)}) '
        f'(size {mm(size)} {mm(size)}) (drill {mm(drill)}) (layers {layers}))'
    )


def npth_pad(x, y, drill):
    """Generate a non-plated through-hole pad."""
    return (
        f'  (pad "" np_thru_hole circle (at {mm(x)} {mm(y)}) '
        f'(size {mm(drill)} {mm(drill)}) (drill {mm(drill)}) (layers "*.Cu" "*.Mask"))'
    )


def smt_pad(number, x, y, w, h, layers='"F.Cu" "F.Paste" "F.Mask"'):
    """Generate an SMT pad S-expression."""
    return (
        f'  (pad "{number}" smd rect (at {mm(x)} {mm(y)}) '
        f'(size {mm(w)} {mm(h)}) (layers {layers}))'
    )


def fp_text(text_type, text, x, y, layer, size=1.0, thickness=0.15):
    """Generate footprint text."""
    return (
        f'  (fp_text {text_type} "{text}" (at {mm(x)} {mm(y)}) (layer "{layer}") '
        f'(effects (font (size {size} {size}) (thickness {thickness}))))'
    )


def fp_circle(cx, cy, radius, layer, width=0.12):
    """Generate a circle on a layer."""
    ex = cx + radius
    return (
        f'  (fp_circle (center {mm(cx)} {mm(cy)}) (end {mm(ex)} {mm(cy)}) '
        f'(layer "{layer}") (width {width}))'
    )


def fp_rect(x1, y1, x2, y2, layer, width=0.12):
    """Generate a rectangle as 4 lines."""
    lines = []
    corners = [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]
    for i in range(4):
        sx, sy = corners[i]
        ex, ey = corners[(i + 1) % 4]
        lines.append(
            f'  (fp_line (start {mm(sx)} {mm(sy)}) (end {mm(ex)} {mm(ey)}) '
            f'(layer "{layer}") (width {width}))'
        )
    return "\n".join(lines)


def write_footprint(name, description, tags, items):
    """Write a complete .kicad_mod file."""
    header = (
        f'(footprint "{name}" (version 20221018) (generator "generate_footprints.py")\n'
        f'  (layer "F.Cu")\n'
        f'  (descr "{description}")\n'
        f'  (tags "{tags}")\n'
        f'  (attr through_hole)\n'
    )
    return header + "\n".join(items) + "\n)\n"


def make_pj398sm(specs):
    """Thonkiconn PJ398SM 3.5mm mono jack.

    3 pins: tip, sleeve (GND), switch (NC)
    Mounting: panel drill hole per specs
    """
    fp = specs["pj398sm"]
    body = fp["body"]
    crtyd = fp["courtyard"]
    drill = fp["drill_mm"]
    items = [
        fp_text("reference", "REF**", 0, -7, "F.SilkS"),
        fp_text("value", "PJ398SM", 0, 7, "F.Fab"),
        # Pin 1: Tip (signal)
        tht_pad(1, 0, 0, 2.0, 1.0),
        # Pin 2: Sleeve (GND)
        tht_pad(2, 0, -4.7, 2.0, 1.0),
        # Pin 3: Switch (NC when plugged)
        tht_pad(3, 4.7, -2.35, 2.0, 1.0),
        # Mounting pin (NPTH)
        npth_pad(-2.35, -4.7, 1.5),
        # Courtyard
        fp_rect(crtyd["x1"], crtyd["y1"], crtyd["x2"], crtyd["y2"], "F.CrtYd", 0.05),
        # Panel drill hole outline
        fp_circle(0, 0, drill / 2, "F.SilkS"),
        # Hex nut outline (10mm)
        fp_circle(0, 0, 5.0, "F.Fab", 0.1),
    ]
    return write_footprint(
        "PJ398SM",
        "Thonkiconn PJ398SM 3.5mm mono jack, through-hole",
        "jack audio 3.5mm thonkiconn eurorack",
        items,
    )


def make_tc002_rgb(specs):
    """Well Buying TC002-N11AS1XT-RGB tactile switch with RGB LED.

    2 switch pins (SPST momentary) + 4 LED pins (anode + R/G/B)
    """
    fp = specs["tc002_rgb"]
    body = fp["body"]
    crtyd = fp["courtyard"]
    items = [
        fp_text("reference", "REF**", 0, -6, "F.SilkS"),
        fp_text("value", "TC002-RGB", 0, 6, "F.Fab"),
        # Switch pins
        tht_pad(1, -3.25, -2.25, 1.6, 0.9),
        tht_pad(2, 3.25, -2.25, 1.6, 0.9),
        # LED pins: Anode (square pad = pin 1 marker), R, G, B
        tht_pad(3, -2.0, 2.25, 1.6, 0.9, shape="rect"),
        tht_pad(4, -0.5, 2.25, 1.6, 0.9),
        tht_pad(5, 1.0, 2.25, 1.6, 0.9),
        tht_pad(6, 2.5, 2.25, 1.6, 0.9),
        # Body outline
        fp_rect(body["x1"], body["y1"], body["x2"], body["y2"], "F.SilkS"),
        # Courtyard
        fp_rect(crtyd["x1"], crtyd["y1"], crtyd["x2"], crtyd["y2"], "F.CrtYd", 0.05),
        # Button cap (5mm)
        fp_circle(0, 0, 2.5, "F.Fab", 0.1),
    ]
    return write_footprint(
        "TC002-N11AS1XT-RGB",
        "RGB tactile switch, through-hole, integrated LED",
        "switch tactile RGB LED button illuminated",
        items,
    )


def make_ec11e(specs):
    """Alps EC11E rotary encoder with push switch.

    5 electrical pins (A, GND, B, SW1, SW2) + 2 mounting tabs
    """
    fp = specs["ec11e"]
    body = fp["body"]
    crtyd = fp["courtyard"]
    drill = fp["drill_mm"]
    items = [
        fp_text("reference", "REF**", 0, -10, "F.SilkS"),
        fp_text("value", "EC11E", 0, 10, "F.Fab"),
        # Encoder pins: A, GND, B (2.5mm pitch)
        tht_pad(1, -2.5, 7.0, 1.8, 1.0),
        tht_pad(2, 0, 7.0, 1.8, 1.0),
        tht_pad(3, 2.5, 7.0, 1.8, 1.0),
        # Switch pins: SW1, SW2
        tht_pad(4, -2.5, -7.0, 1.8, 1.0),
        tht_pad(5, 2.5, -7.0, 1.8, 1.0),
        # Mounting tabs (NPTH)
        npth_pad(-5.5, 0, 2.0),
        npth_pad(5.5, 0, 2.0),
        # Body outline
        fp_rect(body["x1"], body["y1"], body["x2"], body["y2"], "F.SilkS"),
        # Shaft hole
        fp_circle(0, 0, drill / 2, "F.Fab", 0.1),
        # Courtyard
        fp_rect(crtyd["x1"], crtyd["y1"], crtyd["x2"], crtyd["y2"], "F.CrtYd", 0.05),
    ]
    return write_footprint(
        "EC11E",
        "Alps EC11E rotary encoder with push switch, through-hole",
        "encoder rotary alps EC11 push switch",
        items,
    )


def make_rpi_pico():
    """Raspberry Pi Pico castellated pad module.

    40 pins in 2x20 grid, 2.54mm pitch. Module: ~51mm x 21mm
    """
    pitch = 2.54
    rows = 20
    col_offset = 7.62  # half of 15.24mm pin column distance

    items = [
        fp_text("reference", "REF**", 0, -13, "F.SilkS"),
        fp_text("value", "RPi_Pico", 0, 13, "F.Fab"),
    ]

    # Left column (pins 1-20, top to bottom)
    for i in range(rows):
        pin_num = i + 1
        y = (i - (rows - 1) / 2) * pitch
        items.append(smt_pad(pin_num, -col_offset, y, 2.0, 1.5))

    # Right column (pins 21-40, bottom to top)
    for i in range(rows):
        pin_num = 21 + i
        y = ((rows - 1) / 2 - i) * pitch
        items.append(smt_pad(pin_num, col_offset, y, 2.0, 1.5))

    items.extend([
        # Module body outline
        fp_rect(-10.5, -25.5, 10.5, 25.5, "F.SilkS"),
        # USB connector end marker
        fp_rect(-4, -25.5, 4, -23, "F.SilkS"),
        # Pin 1 marker
        fp_circle(-col_offset, -(rows - 1) / 2 * pitch - 1.5, 0.3, "F.SilkS"),
        # Courtyard
        fp_rect(-11.5, -26.5, 11.5, 26.5, "F.CrtYd", 0.05),
    ])

    return write_footprint(
        "RaspberryPiPico",
        "Raspberry Pi Pico RP2040 module, castellated pads",
        "RPi Pico RP2040 castellated module",
        items,
    )


def make_eurorack_header():
    """2x5 shrouded pin header for eurorack power (2.54mm pitch)."""
    pitch = 2.54
    rows = 5

    items = [
        fp_text("reference", "REF**", 0, -8, "F.SilkS"),
        fp_text("value", "Eurorack_2x5", 0, 8, "F.Fab"),
    ]

    for col in range(2):
        for row in range(rows):
            pin_num = col * rows + row + 1
            x = (col - 0.5) * pitch
            y = (row - 2) * pitch
            shape = "rect" if pin_num == 1 else "circle"
            items.append(tht_pad(pin_num, x, y, 1.7, 1.0, shape=shape))

    items.extend([
        # Shroud outline
        fp_rect(-4.5, -6.5, 4.5, 6.5, "F.SilkS"),
        # Key notch
        fp_rect(-1.5, -6.5, 1.5, -5.5, "F.SilkS"),
        # Pin 1 marker
        fp_circle(-pitch / 2, -2 * pitch - 1.5, 0.3, "F.SilkS"),
        # Courtyard
        fp_rect(-5.5, -7.5, 5.5, 7.5, "F.CrtYd", 0.05),
    ])

    return write_footprint(
        "EurorackPowerHeader_2x5",
        "Shrouded 2x5 pin header, 2.54mm pitch, eurorack power",
        "header shrouded 2x5 eurorack power IDC",
        items,
    )


def main():
    os.makedirs(FOOTPRINT_DIR, exist_ok=True)

    specs = load_footprint_specs()
    print(f"  Loaded footprint specs from {LAYOUT_PATH}")

    footprints = [
        ("PJ398SM", lambda: make_pj398sm(specs)),
        ("TC002-N11AS1XT-RGB", lambda: make_tc002_rgb(specs)),
        ("EC11E", lambda: make_ec11e(specs)),
        ("RaspberryPiPico", make_rpi_pico),
        ("EurorackPowerHeader_2x5", make_eurorack_header),
    ]

    for name, factory in footprints:
        content = factory()
        path = os.path.join(FOOTPRINT_DIR, f"{name}.kicad_mod")
        with open(path, "w") as f:
            f.write(content)
        print(f"  Generated {path}")

    print(f"\n{len(footprints)} footprints generated in {FOOTPRINT_DIR}")


if __name__ == "__main__":
    main()
