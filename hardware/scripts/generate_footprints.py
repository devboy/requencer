#!/usr/bin/env python3
"""Generate KiCad footprints (.kicad_mod) for through-hole components.

Uses KicadModTree to create parametric footprints from datasheet dimensions.
Output: hardware/elec/footprints/*.kicad_mod

Components:
  - PJ398SM (Thonkiconn 3.5mm mono jack)
  - TC002-N11AS1XT-RGB (Well Buying RGB tactile switch)
  - EC11E (Alps rotary encoder with push switch)
  - RPi Pico (castellated pad module)
  - 2x5 shrouded header (eurorack power)
"""

import os
import sys

try:
    from KicadModTree import (
        Footprint, Pad, Circle, Line, RectLine, Text,
        Model, ExposedPad
    )
except ImportError:
    print("KicadModTree not installed. Run: pip install KicadModTree")
    sys.exit(1)

FOOTPRINT_DIR = os.path.join(os.path.dirname(__file__), "..", "elec", "footprints")


def make_pj398sm():
    """Thonkiconn PJ398SM 3.5mm mono jack.

    Datasheet dimensions:
    - 3 pins: tip, sleeve (GND), switch (NC)
    - Mounting: 6mm panel drill hole
    - Pin spacing from datasheet
    """
    fp = Footprint("PJ398SM")
    fp.setDescription("Thonkiconn PJ398SM 3.5mm mono jack, through-hole")
    fp.setTags("jack audio 3.5mm thonkiconn eurorack")

    # Reference and value text
    fp.append(Text(type="reference", text="REF**", at=[0, -7], layer="F.SilkS",
                   size=[1, 1], thickness=0.15))
    fp.append(Text(type="value", text="PJ398SM", at=[0, 7], layer="F.Fab",
                   size=[1, 1], thickness=0.15))

    # Pin 1: Tip (signal) — center pin
    fp.append(Pad(number=1, type=Pad.TYPE_THT, shape=Pad.SHAPE_CIRCLE,
                  at=[0, 0], size=[2.0, 2.0], drill=1.0,
                  layers=["*.Cu", "*.Mask"]))

    # Pin 2: Sleeve (GND) — offset
    fp.append(Pad(number=2, type=Pad.TYPE_THT, shape=Pad.SHAPE_CIRCLE,
                  at=[0, -4.7], size=[2.0, 2.0], drill=1.0,
                  layers=["*.Cu", "*.Mask"]))

    # Pin 3: Switch (NC when plugged) — offset
    fp.append(Pad(number=3, type=Pad.TYPE_THT, shape=Pad.SHAPE_CIRCLE,
                  at=[4.7, -2.35], size=[2.0, 2.0], drill=1.0,
                  layers=["*.Cu", "*.Mask"]))

    # Mounting/alignment pins (NPTH)
    fp.append(Pad(type=Pad.TYPE_NPTH, shape=Pad.SHAPE_CIRCLE,
                  at=[-2.35, -4.7], size=[1.5, 1.5], drill=1.5,
                  layers=["*.Cu", "*.Mask"]))

    # Courtyard
    fp.append(RectLine(start=[-4, -7], end=[7, 3], layer="F.CrtYd", width=0.05))

    # Panel drill hole outline (6mm)
    fp.append(Circle(center=[0, 0], radius=3.0, layer="F.SilkS", width=0.12))

    # Hex nut outline (10mm across flats)
    hex_r = 5.0  # radius to vertex
    fp.append(Circle(center=[0, 0], radius=hex_r, layer="F.Fab", width=0.1))

    return fp


def make_tc002_rgb():
    """Well Buying TC002-N11AS1XT-RGB tactile switch with integrated RGB LED.

    Approximate dimensions from datasheet:
    - 2 switch pins (SPST momentary)
    - 4 LED pins (common anode + R/G/B cathodes)
    - ~6x6mm body
    """
    fp = Footprint("TC002-N11AS1XT-RGB")
    fp.setDescription("RGB tactile switch, through-hole, integrated LED")
    fp.setTags("switch tactile RGB LED button illuminated")

    fp.append(Text(type="reference", text="REF**", at=[0, -6], layer="F.SilkS",
                   size=[1, 1], thickness=0.15))
    fp.append(Text(type="value", text="TC002-RGB", at=[0, 6], layer="F.Fab",
                   size=[1, 1], thickness=0.15))

    # Switch pins (2.54mm pitch)
    fp.append(Pad(number=1, type=Pad.TYPE_THT, shape=Pad.SHAPE_CIRCLE,
                  at=[-3.25, -2.25], size=[1.6, 1.6], drill=0.9,
                  layers=["*.Cu", "*.Mask"]))
    fp.append(Pad(number=2, type=Pad.TYPE_THT, shape=Pad.SHAPE_CIRCLE,
                  at=[3.25, -2.25], size=[1.6, 1.6], drill=0.9,
                  layers=["*.Cu", "*.Mask"]))

    # LED pins (common anode + R/G/B)
    fp.append(Pad(number=3, type=Pad.TYPE_THT, shape=Pad.SHAPE_RECT,
                  at=[-2.0, 2.25], size=[1.6, 1.6], drill=0.9,
                  layers=["*.Cu", "*.Mask"]))  # Anode (square pad = pin 1 marker)
    fp.append(Pad(number=4, type=Pad.TYPE_THT, shape=Pad.SHAPE_CIRCLE,
                  at=[-0.5, 2.25], size=[1.6, 1.6], drill=0.9,
                  layers=["*.Cu", "*.Mask"]))  # Red
    fp.append(Pad(number=5, type=Pad.TYPE_THT, shape=Pad.SHAPE_CIRCLE,
                  at=[1.0, 2.25], size=[1.6, 1.6], drill=0.9,
                  layers=["*.Cu", "*.Mask"]))  # Green
    fp.append(Pad(number=6, type=Pad.TYPE_THT, shape=Pad.SHAPE_CIRCLE,
                  at=[2.5, 2.25], size=[1.6, 1.6], drill=0.9,
                  layers=["*.Cu", "*.Mask"]))  # Blue

    # Body outline
    fp.append(RectLine(start=[-3.5, -3.5], end=[3.5, 3.5],
                       layer="F.SilkS", width=0.12))

    # Courtyard
    fp.append(RectLine(start=[-4.5, -4.5], end=[4.5, 4.5],
                       layer="F.CrtYd", width=0.05))

    # Button cap circle (5mm diameter in panel)
    fp.append(Circle(center=[0, 0], radius=2.5, layer="F.Fab", width=0.1))

    return fp


def make_ec11e():
    """Alps EC11E rotary encoder with push switch.

    Standard footprint:
    - 5 electrical pins (A, GND, B, SW1, SW2)
    - 2 mounting tabs
    - 7mm shaft drill in panel
    """
    fp = Footprint("EC11E")
    fp.setDescription("Alps EC11E rotary encoder with push switch, through-hole")
    fp.setTags("encoder rotary alps EC11 push switch")

    fp.append(Text(type="reference", text="REF**", at=[0, -10], layer="F.SilkS",
                   size=[1, 1], thickness=0.15))
    fp.append(Text(type="value", text="EC11E", at=[0, 10], layer="F.Fab",
                   size=[1, 1], thickness=0.15))

    # Encoder pins (A, GND, B) — 2.5mm pitch
    fp.append(Pad(number=1, type=Pad.TYPE_THT, shape=Pad.SHAPE_CIRCLE,
                  at=[-2.5, 7.0], size=[1.8, 1.8], drill=1.0,
                  layers=["*.Cu", "*.Mask"]))  # A
    fp.append(Pad(number=2, type=Pad.TYPE_THT, shape=Pad.SHAPE_CIRCLE,
                  at=[0, 7.0], size=[1.8, 1.8], drill=1.0,
                  layers=["*.Cu", "*.Mask"]))  # GND
    fp.append(Pad(number=3, type=Pad.TYPE_THT, shape=Pad.SHAPE_CIRCLE,
                  at=[2.5, 7.0], size=[1.8, 1.8], drill=1.0,
                  layers=["*.Cu", "*.Mask"]))  # B

    # Switch pins (SW1, SW2) — offset
    fp.append(Pad(number=4, type=Pad.TYPE_THT, shape=Pad.SHAPE_CIRCLE,
                  at=[-2.5, -7.0], size=[1.8, 1.8], drill=1.0,
                  layers=["*.Cu", "*.Mask"]))  # SW1
    fp.append(Pad(number=5, type=Pad.TYPE_THT, shape=Pad.SHAPE_CIRCLE,
                  at=[2.5, -7.0], size=[1.8, 1.8], drill=1.0,
                  layers=["*.Cu", "*.Mask"]))  # SW2

    # Mounting tabs (larger holes, no electrical connection)
    fp.append(Pad(type=Pad.TYPE_NPTH, shape=Pad.SHAPE_CIRCLE,
                  at=[-5.5, 0], size=[2.0, 2.0], drill=2.0,
                  layers=["*.Cu", "*.Mask"]))
    fp.append(Pad(type=Pad.TYPE_NPTH, shape=Pad.SHAPE_CIRCLE,
                  at=[5.5, 0], size=[2.0, 2.0], drill=2.0,
                  layers=["*.Cu", "*.Mask"]))

    # Body outline
    fp.append(RectLine(start=[-6.5, -6.5], end=[6.5, 6.5],
                       layer="F.SilkS", width=0.12))

    # Shaft hole (7mm)
    fp.append(Circle(center=[0, 0], radius=3.5, layer="F.Fab", width=0.1))

    # Courtyard
    fp.append(RectLine(start=[-8, -9], end=[8, 9], layer="F.CrtYd", width=0.05))

    return fp


def make_rpi_pico():
    """Raspberry Pi Pico castellated pad module.

    40 pins in 2x20 grid, 2.54mm pitch.
    Module dimensions: ~51mm x 21mm
    """
    fp = Footprint("RaspberryPiPico")
    fp.setDescription("Raspberry Pi Pico RP2040 module, castellated pads")
    fp.setTags("RPi Pico RP2040 castellated module")

    fp.append(Text(type="reference", text="REF**", at=[0, -13], layer="F.SilkS",
                   size=[1, 1], thickness=0.15))
    fp.append(Text(type="value", text="RPi_Pico", at=[0, 13], layer="F.Fab",
                   size=[1, 1], thickness=0.15))

    pitch = 2.54
    rows = 20
    col_offset = 7.62  # half of 15.24mm (distance between pin columns)

    # Left column (pins 1-20, top to bottom)
    for i in range(rows):
        pin_num = i + 1
        y = (i - (rows - 1) / 2) * pitch
        fp.append(Pad(number=pin_num, type=Pad.TYPE_SMT, shape=Pad.SHAPE_RECT,
                      at=[-col_offset, y], size=[2.0, 1.5],
                      layers=["F.Cu", "F.Paste", "F.Mask"]))

    # Right column (pins 21-40, bottom to top)
    for i in range(rows):
        pin_num = 21 + i
        y = ((rows - 1) / 2 - i) * pitch
        fp.append(Pad(number=pin_num, type=Pad.TYPE_SMT, shape=Pad.SHAPE_RECT,
                      at=[col_offset, y], size=[2.0, 1.5],
                      layers=["F.Cu", "F.Paste", "F.Mask"]))

    # Module body outline
    fp.append(RectLine(start=[-10.5, -25.5], end=[10.5, 25.5],
                       layer="F.SilkS", width=0.12))

    # USB connector end marker
    fp.append(RectLine(start=[-4, -25.5], end=[4, -23],
                       layer="F.SilkS", width=0.12))

    # Pin 1 marker
    fp.append(Circle(center=[-col_offset, -(rows - 1) / 2 * pitch - 1.5],
                     radius=0.3, layer="F.SilkS", width=0.12))

    # Courtyard
    fp.append(RectLine(start=[-11.5, -26.5], end=[11.5, 26.5],
                       layer="F.CrtYd", width=0.05))

    return fp


def make_eurorack_header():
    """2x5 shrouded pin header for eurorack power (2.54mm pitch).

    Standard eurorack power connector with key notch.
    """
    fp = Footprint("EurorackPowerHeader_2x5")
    fp.setDescription("Shrouded 2x5 pin header, 2.54mm pitch, eurorack power")
    fp.setTags("header shrouded 2x5 eurorack power IDC")

    fp.append(Text(type="reference", text="REF**", at=[0, -8], layer="F.SilkS",
                   size=[1, 1], thickness=0.15))
    fp.append(Text(type="value", text="Eurorack_2x5", at=[0, 8], layer="F.Fab",
                   size=[1, 1], thickness=0.15))

    pitch = 2.54
    rows = 5
    cols = 2

    for col in range(cols):
        for row in range(rows):
            pin_num = col * rows + row + 1
            x = (col - 0.5) * pitch
            y = (row - 2) * pitch
            shape = Pad.SHAPE_RECT if pin_num == 1 else Pad.SHAPE_CIRCLE
            fp.append(Pad(number=pin_num, type=Pad.TYPE_THT, shape=shape,
                          at=[x, y], size=[1.7, 1.7], drill=1.0,
                          layers=["*.Cu", "*.Mask"]))

    # Shroud outline
    fp.append(RectLine(start=[-4.5, -6.5], end=[4.5, 6.5],
                       layer="F.SilkS", width=0.12))

    # Key notch
    fp.append(RectLine(start=[-1.5, -6.5], end=[1.5, -5.5],
                       layer="F.SilkS", width=0.12))

    # Pin 1 marker
    fp.append(Circle(center=[-pitch / 2, -2 * pitch - 1.5],
                     radius=0.3, layer="F.SilkS", width=0.12))

    # Courtyard
    fp.append(RectLine(start=[-5.5, -7.5], end=[5.5, 7.5],
                       layer="F.CrtYd", width=0.05))

    return fp


def main():
    os.makedirs(FOOTPRINT_DIR, exist_ok=True)

    footprints = [
        ("PJ398SM", make_pj398sm),
        ("TC002-N11AS1XT-RGB", make_tc002_rgb),
        ("EC11E", make_ec11e),
        ("RaspberryPiPico", make_rpi_pico),
        ("EurorackPowerHeader_2x5", make_eurorack_header),
    ]

    for name, factory in footprints:
        fp = factory()
        path = os.path.join(FOOTPRINT_DIR, f"{name}.kicad_mod")
        with open(path, "w") as f:
            f.write(str(fp))
        print(f"  Generated {path}")

    print(f"\n{len(footprints)} footprints generated in {FOOTPRINT_DIR}")


if __name__ == "__main__":
    main()
