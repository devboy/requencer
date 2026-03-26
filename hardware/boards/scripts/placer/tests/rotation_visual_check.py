"""Visual rotation diagnostic — generates PNGs and KiCad SVGs for human review.

Creates a synthetic board with a fixed 4-pin IC and 4 free resistors,
runs wavefront placement for 8 scenarios (Front/Back x 0/90/180/270),
and renders:
  - "algo view" PNGs showing bounding boxes and pins (PIL)
  - KiCad .kicad_pcb files with gr_rect/gr_circle primitives
  - KiCad SVG exports via kicad-cli for ground-truth comparison

Run:
    cd hardware/boards/scripts
    PYTHONPATH=. /opt/homebrew/bin/python3.11 -m placer.tests.rotation_visual_check
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from placer.dtypes import Component, Pin, Side, Net, Board
from placer.geometry import pin_world_position, rotated_dims
from placer.context import PlacementContext
from placer.strategies.wavefront import wavefront

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BOARD_W = 60.0  # mm
BOARD_H = 40.0  # mm
SCALE = 10  # px per mm

MARGIN_TOP = 30  # px for title text
IMG_W = int(BOARD_W * SCALE)
IMG_H = int(BOARD_H * SCALE) + MARGIN_TOP

OUT_DIR = Path(__file__).resolve().parent.parent.parent / "build" / "rotation_check"

# Colours
COL_BOARD_BG = (255, 255, 255)
COL_BOARD_OUTLINE = (0, 0, 0)
COL_FIXED_FILL = (200, 200, 200)
COL_FIXED_OUTLINE = (100, 100, 100)
COL_FREE_FRONT = (68, 136, 255)  # #4488ff
COL_FREE_BACK = (255, 68, 68)    # #ff4444
COL_PIN = (220, 40, 40)
COL_TITLE = (0, 0, 0)
COL_LABEL = (30, 30, 30)

PIN_RADIUS = 3


# ---------------------------------------------------------------------------
# Synthetic board builder
# ---------------------------------------------------------------------------

def _make_ic(side: Side, rotation: float) -> Component:
    """4-pin IC placed at a fixed position, variable side/rotation."""
    return Component(
        id="ic1",
        width=6.0,
        height=8.0,
        pins=[
            Pin("n1", 3.0, 0.0),   # North edge midpoint
            Pin("s1", 3.0, 8.0),   # South edge midpoint
            Pin("e1", 6.0, 4.0),   # East edge midpoint
            Pin("w1", 0.0, 4.0),   # West edge midpoint
        ],
        fixed=True,
        x=20.0,
        y=12.0,
        rotation=rotation,
        side=side,
    )


def _make_resistor(rid: str) -> Component:
    """Free 2-pin resistor (3x1.5 mm)."""
    return Component(
        id=rid,
        width=3.0,
        height=1.5,
        pins=[
            Pin("p1", 0.0, 0.75),   # West edge
            Pin("p2", 3.0, 0.75),   # East edge
        ],
        fixed=False,
    )


def _make_board(ic_side: Side, ic_rotation: float) -> Board:
    """Build a synthetic Board for one scenario."""
    ic = _make_ic(ic_side, ic_rotation)

    r_north = _make_resistor("r_north")
    r_south = _make_resistor("r_south")
    r_east = _make_resistor("r_east")
    r_west = _make_resistor("r_west")

    nets = [
        Net(id="n1", connections=(("ic1", "n1"), ("r_north", "p1"))),
        Net(id="s1", connections=(("ic1", "s1"), ("r_south", "p1"))),
        Net(id="e1", connections=(("ic1", "e1"), ("r_east", "p1"))),
        Net(id="w1", connections=(("ic1", "w1"), ("r_west", "p1"))),
    ]

    return Board(
        width=BOARD_W,
        height=BOARD_H,
        components=[ic, r_north, r_south, r_east, r_west],
        nets=nets,
        rotation_nets=nets,  # same as nets for this test
    )


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def _to_px(x_mm: float, y_mm: float) -> tuple[int, int]:
    """Convert mm coords to pixel coords (with top margin offset)."""
    return int(x_mm * SCALE), int(y_mm * SCALE) + MARGIN_TOP


def _render(board: Board, placements: dict[str, tuple[float, float, float, Side]],
            title: str) -> Image.Image:
    """Render one scenario to a PIL Image.

    placements: comp_id -> (x, y, rotation, side) for ALL components
    """
    img = Image.new("RGB", (IMG_W, IMG_H), COL_BOARD_BG)
    draw = ImageDraw.Draw(img)

    # Title
    draw.text((5, 5), title, fill=COL_TITLE)

    # Board outline
    bx0, by0 = _to_px(0, 0)
    bx1, by1 = _to_px(BOARD_W, BOARD_H)
    draw.rectangle([bx0, by0, bx1 - 1, by1 - 1], outline=COL_BOARD_OUTLINE, width=2)

    comp_map = {c.id: c for c in board.components}

    # Draw each component
    for cid, (cx, cy, rot, side) in placements.items():
        comp = comp_map[cid]
        ew, eh = rotated_dims(comp.width, comp.height, rot)

        px0, py0 = _to_px(cx, cy)
        px1, py1 = _to_px(cx + ew, cy + eh)

        # Choose fill colour
        if comp.fixed:
            fill = COL_FIXED_FILL
            outline = COL_FIXED_OUTLINE
        elif side == Side.FRONT:
            fill = COL_FREE_FRONT
            outline = (30, 80, 180)
        else:
            fill = COL_FREE_BACK
            outline = (180, 30, 30)

        draw.rectangle([px0, py0, px1, py1], fill=fill, outline=outline, width=2)

        # Component label
        side_char = "F" if side == Side.FRONT else "B"
        label = f"{cid} {side_char} {int(rot)}\u00b0"
        draw.text((px0 + 2, py0 + 2), label, fill=COL_LABEL)

        # Draw pins
        for pin in comp.pins:
            wx, wy = pin_world_position(comp, pin, cx, cy, rot, side)
            ppx, ppy = _to_px(wx, wy)
            draw.ellipse(
                [ppx - PIN_RADIUS, ppy - PIN_RADIUS,
                 ppx + PIN_RADIUS, ppy + PIN_RADIUS],
                fill=COL_PIN,
            )
            draw.text((ppx + PIN_RADIUS + 1, ppy - 5), pin.id, fill=COL_LABEL)

    return img


# ---------------------------------------------------------------------------
# KiCad PCB generation
# ---------------------------------------------------------------------------

def _generate_check_pcb(
    filename: str | Path,
    board_w: float,
    board_h: float,
    board: Board,
    placements: dict[str, tuple[float, float, float, Side]],
) -> None:
    """Generate a minimal .kicad_pcb with bounding box rects and pin circles."""
    comp_map = {c.id: c for c in board.components}

    lines = [
        '(kicad_pcb (version 20240108) (generator "rotation_check")',
        '  (general (thickness 1.6) (legacy_teardrops no))',
        '  (paper "A4")',
        '  (layers',
        '    (0 "F.Cu" signal)',
        '    (31 "B.Cu" signal)',
        '    (36 "B.SilkS" user "B.Silkscreen")',
        '    (37 "F.SilkS" user "F.Silkscreen")',
        '    (44 "Edge.Cuts" user)',
        '    (48 "B.Fab" user)',
        '    (49 "F.Fab" user)',
        '  )',
        '  (setup (pad_to_mask_clearance 0))',
        '  (net 0 "")',
    ]

    # Board outline (Edge.Cuts)
    for x1, y1, x2, y2 in [
        (0, 0, board_w, 0),
        (board_w, 0, board_w, board_h),
        (board_w, board_h, 0, board_h),
        (0, board_h, 0, 0),
    ]:
        lines.append(
            f'  (gr_line (start {x1} {y1}) (end {x2} {y2})'
            f' (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))'
        )

    # Components: bounding box rect + pin circles + label
    for cid, (cx, cy, rot, side) in placements.items():
        comp = comp_map[cid]
        ew, eh = rotated_dims(comp.width, comp.height, rot)

        # Fab layer for bounding box
        fab_layer = "F.Fab" if side == Side.FRONT else "B.Fab"
        lines.append(
            f'  (gr_rect (start {cx:.3f} {cy:.3f})'
            f' (end {cx + ew:.3f} {cy + eh:.3f})'
            f' (stroke (width 0.15) (type default))'
            f' (fill none) (layer "{fab_layer}"))'
        )

        # Label text at centre of bounding box
        side_char = "F" if side == Side.FRONT else "B"
        label = f"{cid} {side_char} {int(rot)}"
        text_layer = "F.SilkS" if side == Side.FRONT else "B.SilkS"
        lines.append(
            f'  (gr_text "{label}"'
            f' (at {cx + ew / 2:.3f} {cy + eh / 2:.3f})'
            f' (layer "{text_layer}")'
            f' (effects (font (size 0.8 0.8) (thickness 0.1))))'
        )

        # Pin circles on SilkS
        for pin in comp.pins:
            wx, wy = pin_world_position(comp, pin, cx, cy, rot, side)
            silk_layer = "F.SilkS" if side == Side.FRONT else "B.SilkS"
            lines.append(
                f'  (gr_circle (center {wx:.3f} {wy:.3f})'
                f' (end {wx + 0.3:.3f} {wy:.3f})'
                f' (stroke (width 0.1) (type default))'
                f' (fill none) (layer "{silk_layer}"))'
            )

    lines.append(")")

    with open(filename, "w") as f:
        f.write("\n".join(lines))
    print(f"  Saved {filename}")


def _export_check_svg(pcb_path: str | Path, svg_path: str | Path) -> None:
    """Export a .kicad_pcb to SVG via kicad-cli."""
    try:
        subprocess.run(
            [
                "kicad-cli", "pcb", "export", "svg",
                "--layers", "F.Fab,B.Fab,F.SilkS,B.SilkS,Edge.Cuts",
                "--mode-single", "--fit-page-to-board",
                "--exclude-drawing-sheet",
                "-o", str(svg_path),
                str(pcb_path),
            ],
            check=True,
            capture_output=True,
        )
        print(f"  Saved {svg_path}")
    except FileNotFoundError:
        print(f"  WARNING: kicad-cli not found, skipping SVG export")
    except subprocess.CalledProcessError as e:
        print(f"  WARNING: kicad-cli export failed: {e}")
        if e.stderr:
            print(f"           {e.stderr.decode(errors='replace').strip()}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

SCENARIOS = [
    ("Front 0\u00b0", Side.FRONT, 0.0),
    ("Front 90\u00b0", Side.FRONT, 90.0),
    ("Front 180\u00b0", Side.FRONT, 180.0),
    ("Front 270\u00b0", Side.FRONT, 270.0),
    ("Back 0\u00b0", Side.BACK, 0.0),
    ("Back 90\u00b0", Side.BACK, 90.0),
    ("Back 180\u00b0", Side.BACK, 180.0),
    ("Back 270\u00b0", Side.BACK, 270.0),
]


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for label, ic_side, ic_rot in SCENARIOS:
        board = _make_board(ic_side, ic_rot)
        ctx = PlacementContext(board)

        params = {"auto_rotate": True}
        results = wavefront(board, ctx, params)

        # Collect all placements (fixed + free)
        placements: dict[str, tuple[float, float, float, Side]] = {}

        # Fixed IC
        ic = [c for c in board.components if c.fixed][0]
        placements[ic.id] = (ic.x, ic.y, ic.rotation, ic.side)

        # Free resistors from wavefront results
        for p in results:
            placements[p.component_id] = (p.x, p.y, p.rotation, p.side)

        side_str = "Front" if ic_side == Side.FRONT else "Back"
        title = f"ALGO: IC on {side_str} {int(ic_rot)}\u00b0, resistors should surround it"

        img = _render(board, placements, title)

        tag = f"{side_str.lower()}_{int(ic_rot)}"

        # Algo-view PNG
        png_path = OUT_DIR / f"{tag}.png"
        img.save(str(png_path))
        print(f"  Saved {png_path}")

        # KiCad PCB + SVG
        pcb_path = OUT_DIR / f"kicad_{tag}.kicad_pcb"
        svg_path = OUT_DIR / f"kicad_{tag}.svg"
        _generate_check_pcb(pcb_path, BOARD_W, BOARD_H, board, placements)
        _export_check_svg(pcb_path, svg_path)

    print(f"\nAll {len(SCENARIOS)} scenarios saved to {OUT_DIR}")


if __name__ == "__main__":
    main()
