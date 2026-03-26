#!/usr/bin/env python3
"""Visual diagnostic: compare placer output vs KiCad actual rendering.

Produces:
  - placer_view.png   — rectangles at placer's internal positions (the truth)
  - kicad_view.png    — rectangles at bridge-transformed KiCad positions
  - rotation_view.png — rectangles color-coded by rotation angle
  - diagnostic.kicad_pcb — minimal PCB with rectangles for opening in KiCad
  - kicad_fab_top.svg — actual KiCad SVG export (ground truth)

If placer_view and kicad_fab_top.svg differ, the bridge transform is broken.
If placer_view shows overlaps, the collision grid has a bug.

Usage:
    python -m placer.diagnostic <board_name> [strategy]
    # e.g.: python -m placer.diagnostic main wavefront
    #        python -m placer.diagnostic main wavefront_direct
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from collections import Counter

from PIL import Image, ImageDraw, ImageFont


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

# Rotation → color mapping
_ROT_COLORS = {
    0:   ("#4488ff", "#2266cc"),   # blue
    90:  ("#44cc44", "#228822"),   # green
    180: ("#ff8844", "#cc6622"),   # orange
    270: ("#cc44cc", "#882288"),   # purple
}


def mm_to_px(mm, scale=8.0):
    return int(mm * scale)


def render_board_png(filename, board_w, board_h, fixed_rects, free_rects,
                     title="", scale=8.0, color_by_rotation=False):
    """Render colored rectangles to a PNG.

    Each rect: (x, y, w, h, side, label, rotation) where x,y is top-left.
    If rotation field is missing (6 items), defaults to 0.

    color_by_rotation: Use rotation-based colors instead of side-based.
    """
    pw = mm_to_px(board_w, scale) + 40
    ph = mm_to_px(board_h, scale) + 60
    img = Image.new("RGB", (pw, ph), "white")
    draw = ImageDraw.Draw(img)
    ox, oy = 20, 40  # offset for margin

    # Title
    draw.text((10, 5), title, fill="black")

    # Board outline
    draw.rectangle([ox, oy, ox + mm_to_px(board_w, scale),
                    oy + mm_to_px(board_h, scale)],
                   outline="black", width=2)

    # Draw fixed components (gray)
    for rect in fixed_rects:
        x, y, w, h, side, label = rect[:6]
        px1 = ox + mm_to_px(x, scale)
        py1 = oy + mm_to_px(y, scale)
        px2 = px1 + mm_to_px(w, scale)
        py2 = py1 + mm_to_px(h, scale)
        color = "#cccccc" if side == "front" else "#aaaaaa"
        draw.rectangle([px1, py1, px2, py2], fill=color, outline="#888888")

    # Draw free components
    for rect in free_rects:
        x, y, w, h, side, label = rect[:6]
        rot = int(rect[6]) % 360 if len(rect) > 6 else 0
        px1 = ox + mm_to_px(x, scale)
        py1 = oy + mm_to_px(y, scale)
        px2 = px1 + mm_to_px(w, scale)
        py2 = py1 + mm_to_px(h, scale)

        if color_by_rotation:
            fill, outline = _ROT_COLORS.get(rot, ("#888888", "#666666"))
        else:
            if side == "front":
                fill = "#4488ff"
                outline = "#2266cc"
            else:
                fill = "#ff4444"
                outline = "#cc2222"

        draw.rectangle([px1, py1, px2, py2], fill=fill, outline=outline)

        # Label: component name + rotation
        short = label.split(".")[-1][:8]
        if rot != 0:
            short += f" {rot}°"
        draw.text((px1 + 1, py1 + 1), short, fill="white")

    img.save(filename)
    print(f"  Saved {filename} ({pw}x{ph})")


def render_overlap_png(filename, board_w, board_h, fixed_rects, free_rects,
                       overlaps, title="", scale=8.0):
    """Render board with overlapping components highlighted in red."""
    pw = mm_to_px(board_w, scale) + 40
    ph = mm_to_px(board_h, scale) + 60
    img = Image.new("RGB", (pw, ph), "white")
    draw = ImageDraw.Draw(img)
    ox, oy = 20, 40

    draw.text((10, 5), title, fill="black")
    draw.rectangle([ox, oy, ox + mm_to_px(board_w, scale),
                    oy + mm_to_px(board_h, scale)],
                   outline="black", width=2)

    overlap_ids = set()
    for item in overlaps:
        # overlap_report returns (label_a, label_b, side_a, side_b, area)
        overlap_ids.add(item[0])
        overlap_ids.add(item[1])

    # Draw fixed (gray)
    for rect in fixed_rects:
        x, y, w, h, side, label = rect[:6]
        px1 = ox + mm_to_px(x, scale)
        py1 = oy + mm_to_px(y, scale)
        px2 = px1 + mm_to_px(w, scale)
        py2 = py1 + mm_to_px(h, scale)
        draw.rectangle([px1, py1, px2, py2], fill="#cccccc", outline="#888888")

    # Draw free (red if overlapping, green if ok)
    for rect in free_rects:
        x, y, w, h, side, label = rect[:6]
        px1 = ox + mm_to_px(x, scale)
        py1 = oy + mm_to_px(y, scale)
        px2 = px1 + mm_to_px(w, scale)
        py2 = py1 + mm_to_px(h, scale)
        if label in overlap_ids:
            fill, outline = "#ff2222", "#cc0000"
        else:
            fill, outline = "#22cc22", "#118811"
        draw.rectangle([px1, py1, px2, py2], fill=fill, outline=outline)
        short = label.split(".")[-1][:8]
        draw.text((px1 + 1, py1 + 1), short, fill="white")

    img.save(filename)
    print(f"  Saved {filename} ({pw}x{ph})")


def generate_kicad_pcb(filename, board_w, board_h, rects):
    """Generate a minimal .kicad_pcb with rectangles on F.Fab / B.Fab.

    Each rect: (x, y, w, h, side, label, ...) where x,y is top-left.
    """
    lines = [
        '(kicad_pcb (version 20240108) (generator "placer_diagnostic")',
        '  (general (thickness 1.6) (legacy_teardrops no))',
        '  (paper "A4")',
        '  (layers',
        '    (0 "F.Cu" signal)',
        '    (31 "B.Cu" signal)',
        '    (36 "B.SilkS" user "B.Silkscreen")',
        '    (37 "F.SilkS" user "F.Silkscreen")',
        '    (38 "B.Mask" user)',
        '    (39 "F.Mask" user)',
        '    (44 "Edge.Cuts" user)',
        '    (46 "B.CrtYd" user "B.Courtyard")',
        '    (47 "F.CrtYd" user "F.Courtyard")',
        '    (48 "B.Fab" user)',
        '    (49 "F.Fab" user)',
        '  )',
        '  (setup (pad_to_mask_clearance 0))',
        '  (net 0 "")',
    ]

    # Board outline
    for x1, y1, x2, y2 in [
        (0, 0, board_w, 0), (board_w, 0, board_w, board_h),
        (board_w, board_h, 0, board_h), (0, board_h, 0, 0),
    ]:
        lines.append(
            f'  (gr_line (start {x1} {y1}) (end {x2} {y2})'
            f' (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))'
        )

    # Rectangles as gr_rect on Fab layers
    for rect in rects:
        x, y, w, h, side, label = rect[:6]
        layer = "F.Fab" if side == "front" else "B.Fab"
        lines.append(
            f'  (gr_rect (start {x:.3f} {y:.3f}) (end {x+w:.3f} {y+h:.3f})'
            f' (stroke (width 0.15) (type default)) (fill none) (layer "{layer}"))'
        )
        # Label text
        text_layer = "F.SilkS" if side == "front" else "B.SilkS"
        short = label.split(".")[-1][:10]
        lines.append(
            f'  (gr_text "{short}" (at {x + w/2:.3f} {y + h/2:.3f})'
            f' (layer "{text_layer}") (effects (font (size 0.8 0.8) (thickness 0.1))))'
        )

    lines.append(")")

    with open(filename, "w") as f:
        f.write("\n".join(lines))
    print(f"  Saved {filename}")


def export_kicad_svg(pcb_path, output_dir, board_name, suffix=""):
    """Export KiCad PCB to SVG using kicad-cli for visual comparison."""
    tag = f"-{suffix}" if suffix else ""
    top_svg = os.path.join(output_dir, f"kicad_fab_top{tag}.svg")
    try:
        subprocess.run([
            "kicad-cli", "pcb", "export", "svg",
            "--layers", "F.Cu,F.CrtYd,F.Fab,F.SilkS,Edge.Cuts",
            "--mode-single", "--fit-page-to-board",
            "--exclude-drawing-sheet",
            "-o", top_svg,
            pcb_path,
        ], check=True, capture_output=True)
        print(f"  Saved {top_svg}")
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"  WARNING: kicad-cli export failed: {e}")


# ---------------------------------------------------------------------------
# JSON dump for lightweight post-hoc visualization
# ---------------------------------------------------------------------------

def dump_placement_json(filename, board_w, board_h, fixed_rects, free_rects,
                        overlaps=None):
    """Dump placement data to JSON for visualization without pcbnew."""
    data = {
        "board_w": board_w,
        "board_h": board_h,
        "fixed": [
            {"x": r[0], "y": r[1], "w": r[2], "h": r[3],
             "side": r[4], "label": r[5],
             "rotation": int(r[6]) if len(r) > 6 else 0}
            for r in fixed_rects
        ],
        "free": [
            {"x": r[0], "y": r[1], "w": r[2], "h": r[3],
             "side": r[4], "label": r[5],
             "rotation": int(r[6]) if len(r) > 6 else 0}
            for r in free_rects
        ],
        "overlaps": [
            [item[0], item[1]] if len(item) >= 2 else list(item)
            for item in (overlaps or [])
        ],
    }
    with open(filename, "w") as f:
        json.dump(data, f, indent=2)
    print(f"  Saved {filename}")


# ---------------------------------------------------------------------------
# Lightweight mode: render from JSON (no pcbnew needed)
# ---------------------------------------------------------------------------

def render_from_json(json_path, out_dir=None):
    """Render diagnostic PNGs from a previously-dumped JSON file."""
    with open(json_path) as f:
        data = json.load(f)

    board_w = data["board_w"]
    board_h = data["board_h"]

    fixed_rects = [
        (r["x"], r["y"], r["w"], r["h"], r["side"], r["label"],
         r.get("rotation", 0))
        for r in data["fixed"]
    ]
    free_rects = [
        (r["x"], r["y"], r["w"], r["h"], r["side"], r["label"],
         r.get("rotation", 0))
        for r in data["free"]
    ]

    if out_dir is None:
        out_dir = os.path.dirname(json_path) or "."

    render_board_png(
        os.path.join(out_dir, "placer_view.png"),
        board_w, board_h, fixed_rects, free_rects,
        title="PLACER VIEW (from JSON)",
    )
    render_board_png(
        os.path.join(out_dir, "rotation_view.png"),
        board_w, board_h, fixed_rects, free_rects,
        title="ROTATION VIEW (from JSON)",
        color_by_rotation=True,
    )

    overlaps = data.get("overlaps", [])
    if overlaps:
        render_overlap_png(
            os.path.join(out_dir, "overlap_view.png"),
            board_w, board_h, fixed_rects, free_rects,
            overlaps, title="OVERLAP VIEW (from JSON)",
        )

    # Stats
    rots = Counter(int(r[6]) % 360 for r in free_rects)
    print(f"\nRotation distribution:")
    for angle in sorted(rots.keys()):
        print(f"  {angle:3d}°: {rots[angle]} components")

    # Stacking check
    positions = Counter(
        (f"{r[0]:.2f},{r[1]:.2f}") for r in free_rects
    )
    stacked = [(pos, n) for pos, n in positions.most_common() if n > 1]
    if stacked:
        print(f"\nSTACKED COMPONENTS ({sum(n for _, n in stacked)} at "
              f"{len(stacked)} positions):")
        for pos, n in stacked[:10]:
            print(f"  ({pos}): {n} components")


# ---------------------------------------------------------------------------
# Full diagnostic (requires pcbnew)
# ---------------------------------------------------------------------------

def run_diagnostic(board_name, strategy_name="wavefront"):
    """Run full diagnostic on a real board."""
    try:
        import pcbnew
    except ImportError:
        print("ERROR: Run with KiCad's Python (needs pcbnew module)")
        sys.exit(1)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, os.path.join(script_dir, ".."))

    from placement.helpers import identify_power_nets, extract_pad_sides
    from placement.place_components import (
        load_board_config, _get_board_dimensions, _build_addr_map,
        _place_fixed_components, _setup_board_outline, get_component_padding,
    )
    from placer.kicad_bridge import (
        extract_component, extract_nets, build_placer_board,
        apply_placements, _rotate_offset, ComponentBridge,
    )
    from placer.geometry import rotated_dims
    from placer.context import PlacementContext
    from placer.dtypes import Side

    # Import the requested strategy
    from placer.strategies import get_strategy, available_strategies
    import placer.strategies.wavefront  # noqa: register strategies
    try:
        strategy_fn = get_strategy(strategy_name)
    except ValueError:
        print(f"Unknown strategy '{strategy_name}'. "
              f"Available: {', '.join(available_strategies())}")
        sys.exit(1)

    config = load_board_config()
    board_w, board_h = _get_board_dimensions(board_name, config)
    placement_cfg = config["boards"][board_name]["placement"]

    # Get strategy params from board config variants
    strategy_params = {"placement_exclusions":
                       placement_cfg.get("placement_exclusions", [])}
    for variant in placement_cfg.get("variants", []):
        if variant.get("algorithm") == strategy_name:
            strategy_params.update(variant.get("params", {}))
            break

    print(f"Board: {board_name} ({board_w}x{board_h}mm)")
    print(f"Strategy: {strategy_name}")
    print(f"Params: {strategy_params}")

    # Load KiCad board
    boards_dir = os.path.join(script_dir, "..", "..")
    pcb_path = os.path.join(boards_dir, "elec", "layout", board_name,
                            f"{board_name}.kicad_pcb")
    kicad_board = pcbnew.LoadBoard(pcb_path)
    _setup_board_outline(kicad_board, board_w, board_h, pcbnew)
    addr_map = _build_addr_map(kicad_board)
    fixed_placements = _place_fixed_components(
        kicad_board, addr_map, board_name, config, pcbnew)
    power_nets = identify_power_nets(kicad_board)

    per_pin_padding = placement_cfg.get("per_pin_padding_mm", 0.2)
    component_padding = placement_cfg.get("component_padding", {})

    # Extract via bridge
    bridges = {}
    for addr, fp in addr_map.items():
        is_fixed = addr in fixed_placements
        fx, fy, fside, frot = 0.0, 0.0, "F", 0.0
        if is_fixed:
            p = fixed_placements[addr]
            fx, fy, fside, frot = p.x, p.y, p.side, p.rotation
        bridge = extract_component(
            addr, fp, pcbnew, power_nets, is_fixed=is_fixed,
            fixed_x=fx, fixed_y=fy, fixed_side=fside, fixed_rotation=frot)
        comp = bridge.component
        pad_sides = extract_pad_sides(fp, pcbnew, power_nets)
        esc = {e: len(n) for e, n in pad_sides.items()}
        pl, pr, pt, pb = get_component_padding(
            addr, component_padding, edge_signal_counts=esc)
        if pl or pr or pt or pb:
            comp.width += pl + pr
            comp.height += pt + pb
        elif per_pin_padding > 0 and esc:
            comp.width += (esc.get("W", 0) * per_pin_padding +
                           esc.get("E", 0) * per_pin_padding)
            comp.height += (esc.get("N", 0) * per_pin_padding +
                            esc.get("S", 0) * per_pin_padding)
        bridges[addr] = bridge

    nets = extract_nets(addr_map, pcbnew, power_nets)
    exclusions = placement_cfg.get("placement_exclusions", [])

    _SMD_SIDE_MAP = {"F": "front", "B": "back", "both": "both"}
    smd_side = _SMD_SIDE_MAP.get(
        placement_cfg.get("smd_side", "both"), "both")
    placer_board = build_placer_board(
        board_w, board_h, bridges, nets, clearance=0.5, smd_side=smd_side)
    ctx = PlacementContext(placer_board)
    results = strategy_fn(placer_board, ctx, strategy_params)

    print(f"\nPlacer: {len(results)} components placed")
    overlap_report = ctx._grid.overlap_report()
    print(f"Internal overlaps: {len(overlap_report)}")

    # --- Build rect lists (now with rotation field) ---

    fixed_rects = []
    for comp in placer_board.components:
        if not comp.fixed:
            continue
        ew, eh = rotated_dims(comp.width, comp.height, comp.rotation)
        fixed_rects.append((comp.x, comp.y, ew, eh,
                            comp.side.value, comp.id, comp.rotation))

    placer_free_rects = []
    for r in results:
        comp = bridges[r.component_id].component
        ew, eh = rotated_dims(comp.width, comp.height, r.rotation)
        placer_free_rects.append((r.x, r.y, ew, eh,
                                  r.side.value, r.component_id, r.rotation))

    # KiCad bridge roundtrip rects
    kicad_free_rects = []
    for r in results:
        bridge = bridges[r.component_id]
        comp = bridge.component
        ew, eh = rotated_dims(comp.width, comp.height, r.rotation)
        bcx = r.x + ew / 2
        bcy = r.y + eh / 2
        co_x, co_y = bridge.cx_off, bridge.cy_off
        if r.side == Side.BACK:
            co_x = -co_x
        rco_x, rco_y = _rotate_offset(co_x, co_y, r.rotation)
        fp_x = bcx - rco_x
        fp_y = bcy - rco_y
        kicad_bcx = fp_x + rco_x
        kicad_bcy = fp_y + rco_y
        kicad_tl_x = kicad_bcx - ew / 2
        kicad_tl_y = kicad_bcy - eh / 2
        kicad_free_rects.append((kicad_tl_x, kicad_tl_y, ew, eh,
                                  r.side.value, r.component_id, r.rotation))

    # --- Render ---
    out_dir = os.path.join(script_dir, "..", "build")
    os.makedirs(out_dir, exist_ok=True)

    render_board_png(
        os.path.join(out_dir, "placer_view.png"),
        board_w, board_h, fixed_rects, placer_free_rects,
        title=f"PLACER VIEW — {board_name} ({strategy_name})",
    )

    render_board_png(
        os.path.join(out_dir, "rotation_view.png"),
        board_w, board_h, fixed_rects, placer_free_rects,
        title=f"ROTATION — {board_name} ({strategy_name}) "
              f"[blue=0° green=90° orange=180° purple=270°]",
        color_by_rotation=True,
    )

    render_board_png(
        os.path.join(out_dir, "kicad_view.png"),
        board_w, board_h, fixed_rects, kicad_free_rects,
        title=f"KICAD VIEW — {board_name} (after bridge transform)",
    )

    if overlap_report:
        render_overlap_png(
            os.path.join(out_dir, "overlap_view.png"),
            board_w, board_h, fixed_rects, placer_free_rects,
            overlap_report,
            title=f"OVERLAPS — {board_name} ({strategy_name}) "
                  f"[red={len(overlap_report)} pairs]",
        )

    # KiCad PCB with bounding boxes
    all_rects = fixed_rects + placer_free_rects
    generate_kicad_pcb(
        os.path.join(out_dir, "diagnostic.kicad_pcb"),
        board_w, board_h, all_rects,
    )

    # JSON dump for later lightweight rendering
    dump_placement_json(
        os.path.join(out_dir, "placement_data.json"),
        board_w, board_h, fixed_rects, placer_free_rects,
        overlaps=overlap_report,
    )

    # Apply placements and export via kicad-cli
    applied = apply_placements(results, bridges, addr_map,
                               kicad_board, pcbnew)
    print(f"\nApplied {applied} placements to KiCad board")

    placed_pcb = os.path.join(out_dir, f"diagnostic-placed.kicad_pcb")
    kicad_board.Save(placed_pcb)
    print(f"  Saved {placed_pcb}")
    export_kicad_svg(placed_pcb, out_dir, board_name, suffix=strategy_name)

    # --- Stats ---
    rots = Counter(int(r.rotation) % 360 for r in results)
    print(f"\nRotation distribution:")
    for angle in sorted(rots.keys()):
        print(f"  {angle:3d}°: {rots[angle]} components")

    n_back = sum(1 for r in results if r.side == Side.BACK)
    n_front = sum(1 for r in results if r.side == Side.FRONT)
    print(f"Side distribution: {n_front} front, {n_back} back")

    # Stacking check
    positions = Counter(
        (f"{r.x:.2f},{r.y:.2f}") for r in results
    )
    stacked = [(pos, n) for pos, n in positions.most_common() if n > 1]
    if stacked:
        total_stacked = sum(n for _, n in stacked)
        print(f"\nSTACKED COMPONENTS ({total_stacked} at "
              f"{len(stacked)} positions):")
        for pos, n in stacked[:10]:
            # Find which components
            labels = [r.component_id for r in results
                      if f"{r.x:.2f},{r.y:.2f}" == pos]
            print(f"  ({pos}): {n} — {', '.join(labels[:5])}"
                  f"{'...' if len(labels) > 5 else ''}")

    # Out of bounds check
    oob = []
    for r in placer_free_rects:
        x, y, w, h = r[0], r[1], r[2], r[3]
        if x < -0.5 or y < -0.5 or x + w > board_w + 0.5 or y + h > board_h + 0.5:
            oob.append(f"  {r[5]}: ({x:.1f},{y:.1f}) {w:.1f}x{h:.1f}")
    if oob:
        print(f"\nOUT OF BOUNDS ({len(oob)}):")
        for s in oob[:10]:
            print(s)

    # Placer vs KiCad mismatch check
    mismatches = []
    for pr, kr in zip(placer_free_rects, kicad_free_rects):
        dx = abs(pr[0] - kr[0])
        dy = abs(pr[1] - kr[1])
        if dx > 0.01 or dy > 0.01:
            mismatches.append(
                f"  {pr[5]}: placer=({pr[0]:.2f},{pr[1]:.2f}) "
                f"kicad=({kr[0]:.2f},{kr[1]:.2f}) "
                f"delta=({dx:.2f},{dy:.2f})")
    if mismatches:
        print(f"\nTRANSFORM MISMATCHES ({len(mismatches)}):")
        for s in mismatches[:10]:
            print(s)
    else:
        print("\nTransform: PERFECT MATCH (placer == kicad roundtrip)")


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1].endswith(".json"):
        # Lightweight mode: render from JSON
        render_from_json(sys.argv[1],
                         sys.argv[2] if len(sys.argv) > 2 else None)
    else:
        board_name = sys.argv[1] if len(sys.argv) > 1 else "main"
        strategy = sys.argv[2] if len(sys.argv) > 2 else "wavefront"
        run_diagnostic(board_name, strategy)
