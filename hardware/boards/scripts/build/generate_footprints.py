#!/usr/bin/env python3
"""Generate KiCad footprints (.kicad_mod) for through-hole components.

Writes KiCad S-expression format directly — no external dependencies.
Output: hardware/boards/parts/<PartName>/<footprint>.kicad_mod

Components:
  - PJ398SM (Thonkiconn 3.5mm mono jack)
  - TC002-N11AS1XT-RGB (Well Buying RGB tactile switch)
  - EC11E (Alps rotary encoder with push switch)
  - RPi Pico (castellated pad module)
  - 2x5 shrouded header (eurorack power)
  - PGA2350 (Pimoroni PGA2350, 64-pin perimeter PGA module)
"""

import os
import sys


PARTS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "parts")


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


def make_pj398sm():
    """Thonkiconn PJ398SM 3.5mm mono jack.

    3 pins: tip, sleeve (GND), switch (NC)
    Mounting: 6mm panel drill hole
    """
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
        # Courtyard (top trimmed from -7 to -5.8 to avoid courtyard overlap
        # with PJ366ST MIDI jacks above; pad 2 copper extends to y=-5.7)
        fp_rect(-4, -5.8, 7, 3, "F.CrtYd", 0.05),
        # Panel drill hole outline (6mm)
        fp_circle(0, 0, 3.0, "F.SilkS"),
        # Hex nut outline (10mm)
        fp_circle(0, 0, 5.0, "F.Fab", 0.1),
    ]
    return write_footprint(
        "PJ398SM",
        "Thonkiconn PJ398SM 3.5mm mono jack, through-hole",
        "jack audio 3.5mm thonkiconn eurorack",
        items,
    )


def make_tc002_rgb():
    """Well Buying TC002-N11AS1XT-RGB tactile switch with RGB LED.

    2 switch pins (SPST momentary) + 4 LED pins (anode + R/G/B)
    ~6x6mm body
    """
    items = [
        fp_text("reference", "REF**", 0, -6, "F.SilkS"),
        fp_text("value", "TC002-RGB", 0, 6, "F.Fab"),
        # Switch pins
        tht_pad(1, -3.25, -2.25, 1.6, 0.9),
        tht_pad(2, 3.25, -2.25, 1.6, 0.9),
        # LED pins: Anode (square pad = pin 1 marker), R, G, B
        # 1.5mm pitch — 1.3mm pads give 0.2mm clearance (0.9mm drill + 0.2mm annular ring)
        tht_pad(3, -2.0, 2.25, 1.3, 0.9, shape="rect"),
        tht_pad(4, -0.5, 2.25, 1.3, 0.9),
        tht_pad(5, 1.0, 2.25, 1.3, 0.9),
        tht_pad(6, 2.5, 2.25, 1.3, 0.9),
        # Body outline
        fp_rect(-3.5, -3.5, 3.5, 3.5, "F.SilkS"),
        # Courtyard
        fp_rect(-4.5, -4.5, 4.5, 4.5, "F.CrtYd", 0.05),
        # Button cap (5mm)
        fp_circle(0, 0, 2.5, "F.Fab", 0.1),
    ]
    return write_footprint(
        "TC002-N11AS1XT-RGB",
        "RGB tactile switch, through-hole, integrated LED",
        "switch tactile RGB LED button illuminated",
        items,
    )


def make_ec11e():
    """Alps EC11E rotary encoder with push switch.

    5 electrical pins (A, GND, B, SW1, SW2) + 2 mounting tabs
    7mm shaft drill in panel
    """
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
        fp_rect(-6.5, -6.5, 6.5, 6.5, "F.SilkS"),
        # Shaft hole (7mm)
        fp_circle(0, 0, 3.5, "F.Fab", 0.1),
        # Courtyard
        fp_rect(-8, -9, 8, 9, "F.CrtYd", 0.05),
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


def make_pga2350():
    """Pimoroni PGA2350 — 64-pin PGA module, perimeter-only layout.

    25.4mm x 25.4mm module. Pins on outer 2 rings of 10x10 grid at 2.54mm pitch.
    Center 6x6 positions are empty (RP2350B chip mounted there).
    Pin positions from vurdalakov/kicad8-symbols-and-footprints, cross-referenced
    with Pimoroni official pinout diagram.
    """
    # Pin number → (x, y) position in mm, derived from community KiCad library
    # fmt: off
    PIN_POSITIONS = {
        1:  (-6.350, -11.430),   # VB (rect pad)
        2:  (-3.810,  -8.890),   # V3V3
        3:  (-11.430, -11.430),  # GND1
        4:  (-8.890,  -8.890),   # GND2
        5:  (-11.430,  11.430),  # GND3
        6:  ( 11.430,  11.430),  # GND4
        7:  ( 11.430, -11.430),  # GND5
        8:  ( 8.890,  -8.890),   # GND6
        9:  ( 1.270, -11.430),   # USB_DP
        10: ( 3.810, -11.430),   # USB_DM
        11: ( 6.350, -11.430),   # BS (BOOTSEL)
        12: (-6.350,  -8.890),   # GP0
        13: (-8.890, -11.430),   # GP1
        14: (-11.430, -8.890),   # GP2
        15: (-8.890,  -6.350),   # GP3
        16: (-11.430, -6.350),   # GP4
        17: (-8.890,  -3.810),   # GP5
        18: (-11.430, -3.810),   # GP6
        19: (-8.890,  -1.270),   # GP7
        20: (-11.430, -1.270),   # GP8
        21: (-8.890,   1.270),   # GP9
        22: (-11.430,  1.270),   # GP10
        23: (-8.890,   3.810),   # GP11
        24: (-11.430,  3.810),   # GP12
        25: (-8.890,   6.350),   # GP13
        26: (-11.430,  6.350),   # GP14
        27: (-8.890,   8.890),   # GP15
        28: (-11.430,  8.890),   # GP16
        29: (-8.890,  11.430),   # GP17
        30: (-6.350,  11.430),   # GP18
        31: (-6.350,   8.890),   # GP19
        32: (-3.810,  11.430),   # GP20
        33: (-3.810,   8.890),   # GP21
        34: (-1.270,  11.430),   # GP22
        35: (-1.270,   8.890),   # GP23
        36: ( 1.270,  11.430),   # GP24
        37: ( 1.270,   8.890),   # GP25
        38: ( 3.810,  11.430),   # GP26_ADC0
        39: ( 3.810,   8.890),   # GP27_ADC1
        40: ( 6.350,  11.430),   # GP28_ADC2
        41: ( 6.350,   8.890),   # GP29_ADC3
        42: ( 8.890,  11.430),   # GP30
        43: ( 8.890,   8.890),   # GP31
        44: ( 11.430,  8.890),   # GP32
        45: ( 8.890,   6.350),   # GP33
        46: ( 11.430,  6.350),   # GP34
        47: ( 8.890,   3.810),   # GP35
        48: ( 11.430,  3.810),   # GP36
        49: ( 8.890,   1.270),   # GP37
        50: ( 11.430,  1.270),   # GP38
        51: ( 8.890,  -1.270),   # GP39
        52: ( 11.430, -1.270),   # GP40_ADC4
        53: ( 8.890,  -3.810),   # GP41_ADC5
        54: ( 11.430, -3.810),   # GP42_ADC6
        55: ( 8.890,  -6.350),   # GP43_ADC7
        56: ( 11.430, -6.350),   # GP44
        57: ( 11.430, -8.890),   # GP45
        58: ( 8.890, -11.430),   # GP46
        59: ( 6.350,  -8.890),   # GP47
        60: ( 1.270,  -8.890),   # SWCLK
        61: ( 3.810,  -8.890),   # SWDIO
        62: (-1.270, -11.430),   # RUN
        63: (-1.270,  -8.890),   # ADC_VREF
        64: (-3.810, -11.430),   # RSVD
    }
    # fmt: on

    items = [
        fp_text("reference", "REF**", 0, -15, "F.SilkS"),
        fp_text("value", "PGA2350", 0, 15, "F.Fab"),
    ]

    for pin_num in range(1, 65):
        x, y = PIN_POSITIONS[pin_num]
        shape = "rect" if pin_num == 1 else "circle"
        items.append(tht_pad(pin_num, x, y, 1.7, 1.0, shape=shape))

    items.extend([
        # Module body outline (25.4mm x 25.4mm)
        fp_rect(-12.7, -12.7, 12.7, 12.7, "F.SilkS"),
        # Pin 1 marker
        fp_circle(-7.85, -11.43, 0.3, "F.SilkS"),
        # Courtyard
        fp_rect(-13.7, -13.7, 13.7, 13.7, "F.CrtYd", 0.05),
    ])

    return write_footprint(
        "PGA2350",
        "Pimoroni PGA2350 RP2350B module, 64-pin PGA, 2.54mm pitch, perimeter-only layout",
        "PGA2350 RP2350 Pimoroni module PGA",
        items,
    )


def main():
    # Map: (footprint_filename, part_directory, factory_function)
    footprints = [
        # PJ398SM: uses KiCad standard footprint (manually adapted), not auto-generated
        ("TC002-N11AS1XT-RGB.kicad_mod", "TC002-RGB", make_tc002_rgb),
        ("EC11E.kicad_mod", "EC11E", make_ec11e),
        ("RaspberryPiPico.kicad_mod", "RaspberryPiPico", make_rpi_pico),
        ("EurorackPowerHeader_2x5.kicad_mod", "EurorackPowerHeader", make_eurorack_header),
        ("PGA2350.kicad_mod", "PGA2350", make_pga2350),
    ]

    for filename, part_dir, factory in footprints:
        content = factory()
        out_dir = os.path.join(PARTS_DIR, part_dir)
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, filename)
        with open(path, "w") as f:
            f.write(content)
        print(f"  Generated {path}")

    print(f"\n{len(footprints)} footprints generated in {PARTS_DIR}/<PartName>/")


if __name__ == "__main__":
    main()
