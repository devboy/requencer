#!/usr/bin/env python3
"""Board-agnostic component placement orchestrator for KiCad PCBs.

Reads board-config.json for fixed component positions and strategy parameters,
places fixed components, then delegates free components to a pluggable strategy.

Fixed positions are defined in board-config.json under each board's
placement.fixed section. Coordinates can be in faceplate space (coords: "faceplate")
or PCB space (coords: "pcb"). Faceplate coords are converted using the PCB origin
offset from component-map.json.

Usage:
    python place_components.py <board_name> <strategy_name> <input.kicad_pcb> [output.kicad_pcb]
    python place_components.py <board_name> <strategy_name> --params '{"seed": 42}' <input.kicad_pcb>

    # Legacy mode (auto-detects board from filename, uses default strategy):
    python place_components.py [--board control|main] <input.kicad_pcb> [output.kicad_pcb]

Requires: KiCad's pcbnew Python module.
"""

import argparse
import json
import os
import sys

LAYOUT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "web", "src", "panel-layout.json")
COMPONENT_MAP_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "component-map.json")
BOARD_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "board-config.json")


def load_board_config():
    with open(BOARD_CONFIG_PATH) as f:
        return json.load(f)


def get_component_padding(addr, component_padding):
    """Look up per-side courtyard padding for a component address.

    Config keys are prefix-matched against the address, so "leds.tlc"
    matches "leds.tlc1" and "leds.tlc2". Returns (left, right, top, bottom)
    in mm, defaulting to 0.0 for unspecified sides.
    """
    for prefix, pad in component_padding.items():
        if addr.startswith(prefix):
            return (pad.get("left", 0.0), pad.get("right", 0.0),
                    pad.get("top", 0.0), pad.get("bottom", 0.0))
    return (0.0, 0.0, 0.0, 0.0)


def load_layout():
    with open(LAYOUT_PATH) as f:
        return json.load(f)


def load_component_map():
    with open(COMPONENT_MAP_PATH) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Board dimensions
# ---------------------------------------------------------------------------

def _get_board_dimensions(board_name, config):
    """Get board width and height from config or component-map.json."""
    board_cfg = config["boards"][board_name]
    if "dimensions" in board_cfg:
        return board_cfg["dimensions"]["width_mm"], board_cfg["dimensions"]["height_mm"]
    if board_cfg.get("dimensions_from") == "component-map":
        comp_map = load_component_map()
        pcb_dims = comp_map["pcb"]
        return pcb_dims["width_mm"], pcb_dims["height_mm"]
    raise ValueError(f"Cannot determine dimensions for board '{board_name}'")


def _get_faceplate_origin(board_name, config):
    """Get faceplate-to-PCB origin offset. Returns (ox, oy) or (0, 0)."""
    board_cfg = config["boards"][board_name]
    fixed = board_cfg["placement"].get("fixed", {})
    # Only need offset if any entries use faceplate coords
    has_faceplate = any(
        isinstance(v, dict) and v.get("coords") == "faceplate"
        for v in fixed.values()
        if isinstance(v, dict) and "coords" in v
    )
    if not has_faceplate:
        return 0.0, 0.0
    comp_map = load_component_map()
    pcb_dims = comp_map["pcb"]
    return pcb_dims["origin_x_mm"], pcb_dims["origin_y_mm"]


# ---------------------------------------------------------------------------
# Board outline + standoffs
# ---------------------------------------------------------------------------

def _setup_board_outline(board, w_mm, h_mm, pcbnew):
    """Set board edge cuts and copper layer count.

    Clears any existing Edge.Cuts before adding new outline.
    """
    board.SetCopperLayerCount(4)
    edge_layer = board.GetLayerID("Edge.Cuts")
    # Remove existing edge cuts to avoid duplicates (e.g., when input is a
    # fixed PCB that already has an outline)
    to_remove = []
    for drawing in board.GetDrawings():
        if drawing.GetLayer() == edge_layer:
            to_remove.append(drawing)
    for d in to_remove:
        board.Remove(d)
    for x1, y1, x2, y2 in [
        (0, 0, w_mm, 0), (w_mm, 0, w_mm, h_mm),
        (w_mm, h_mm, 0, h_mm), (0, h_mm, 0, 0),
    ]:
        seg = pcbnew.PCB_SHAPE(board)
        seg.SetShape(pcbnew.SHAPE_T_SEGMENT)
        seg.SetStart(pcbnew.VECTOR2I(pcbnew.FromMM(x1), pcbnew.FromMM(y1)))
        seg.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(x2), pcbnew.FromMM(y2)))
        seg.SetLayer(edge_layer)
        seg.SetWidth(pcbnew.FromMM(0.1))
        board.Add(seg)


def _place_standoffs(board, board_name, config, pcbnew):
    """Add standoff mounting holes from board-config.json.

    Returns list of (pcb_x, pcb_y, clearance_mm) for exclusion zones.
    Only places standoffs if the board's placement config has a "standoffs" key.
    """
    board_cfg = config["boards"][board_name]
    standoffs = board_cfg.get("placement", {}).get("standoffs", [])
    if not standoffs:
        return []

    # Get faceplate-to-PCB offset for coordinate transform
    ox, oy = _get_faceplate_origin(board_name, config)

    result = []
    for so in standoffs:
        x = so["x"]
        y = so["y"]
        if so.get("coords") == "faceplate":
            x -= ox
            y -= oy
        drill = so.get("drill_mm", 3.2)
        clearance = so.get("clearance_mm", 6.0)

        fp = pcbnew.FOOTPRINT(board)
        fp.SetReference(f"SO_{so['id'].upper()}")
        fp.SetValue("M3_Standoff")
        fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y)))
        fp.SetAttributes(pcbnew.FP_EXCLUDE_FROM_POS_FILES |
                         pcbnew.FP_EXCLUDE_FROM_BOM)
        pad = pcbnew.PAD(fp)
        pad.SetShape(pcbnew.PAD_SHAPE_CIRCLE)
        pad.SetAttribute(pcbnew.PAD_ATTRIB_NPTH)
        pad.SetDrillSize(pcbnew.VECTOR2I(pcbnew.FromMM(drill),
                                          pcbnew.FromMM(drill)))
        pad.SetSize(pcbnew.VECTOR2I(pcbnew.FromMM(drill),
                                     pcbnew.FromMM(drill)))
        fp.Add(pad)
        board.Add(fp)
        result.append((x, y, clearance))

    print(f"  {len(standoffs)} standoff mounting holes placed")
    return result


# ---------------------------------------------------------------------------
# Address map
# ---------------------------------------------------------------------------

def _build_addr_map(board):
    """Build lookup from atopile_address to footprint."""
    addr_map = {}
    for fp in board.GetFootprints():
        if fp.HasFieldByName("atopile_address"):
            addr = fp.GetFieldText("atopile_address")
            addr_map[addr] = fp
    return addr_map


# ---------------------------------------------------------------------------
# Fixed component placement
# ---------------------------------------------------------------------------

def _place_fixed_components(board, addr_map, board_name, config, pcbnew):
    """Place all fixed components from board-config.json.

    Returns dict of address -> Placement for components that were found
    in the PCB.
    """
    from placement.strategies import Placement

    board_cfg = config["boards"][board_name]
    fixed_entries = board_cfg["placement"].get("fixed", {})
    ox, oy = _get_faceplate_origin(board_name, config)

    fixed_placements = {}
    warnings = []

    for addr, entry in fixed_entries.items():
        if not isinstance(entry, dict) or "x" not in entry:
            continue  # skip _comment entries

        if addr not in addr_map:
            warnings.append(addr)
            continue

        fp = addr_map[addr]
        x_raw, y_raw = entry["x"], entry["y"]
        coords = entry.get("coords", "pcb")
        side = entry.get("side", "F")
        rotation = entry.get("rotation", 0)
        front = side == "F"

        # Convert faceplate coords to PCB coords
        if coords == "faceplate":
            px = x_raw - ox
            py = y_raw - oy
        else:
            px = x_raw
            py = y_raw

        fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(px), pcbnew.FromMM(py)))

        # Set side
        current_front = fp.GetLayer() == board.GetLayerID("F.Cu")
        if front != current_front:
            fp.Flip(fp.GetPosition(), False)

        # Set rotation
        if rotation:
            fp.SetOrientationDegrees(rotation)

        fixed_placements[addr] = Placement(
            x=px, y=py, side=side, rotation=rotation,
        )

    if warnings:
        print(f"  Fixed position warnings: {len(warnings)} addresses not found in PCB:")
        for w in warnings[:10]:
            print(f"    - {w}")

    return fixed_placements


# ---------------------------------------------------------------------------
# ComponentInfo extraction
# ---------------------------------------------------------------------------

def _extract_component_info(addr, fp, pcbnew, power_nets):
    """Extract ComponentInfo from a pcbnew footprint."""
    from placement.helpers import extract_footprint_dims, is_tht as is_tht_fn, \
        get_component_nets
    from placement.strategies import ComponentInfo

    w, h, cx_off, cy_off = extract_footprint_dims(fp, pcbnew)
    tht = is_tht_fn(fp, pcbnew)
    pin_count = len(list(fp.Pads()))
    nets = get_component_nets(fp, power_nets)
    return ComponentInfo(
        address=addr, width=w, height=h, is_tht=tht,
        pin_count=pin_count, nets=nets,
        cx_offset=cx_off, cy_offset=cy_off,
    )


# ---------------------------------------------------------------------------
# Fixed-only placement (inspectable intermediate artifact)
# ---------------------------------------------------------------------------

def place_fixed_only(board_name, input_pcb, output_pcb, pcbnew):
    """Place only fixed components from config. No strategy, no free components.

    Produces an inspectable PCB artifact with just fixed parts placed.
    Use as input for variant placement in a two-step pipeline.
    """
    from placement.helpers import (
        validate_placement as _vp,
        extract_footprint_dims as _efd,
        is_tht as _is_tht,
        regenerate_duplicate_uuids,
    )
    from placement.strategies import ComponentInfo

    config = load_board_config()
    board_w, board_h = _get_board_dimensions(board_name, config)

    board = pcbnew.LoadBoard(input_pcb)
    _setup_board_outline(board, board_w, board_h, pcbnew)
    addr_map = _build_addr_map(board)

    if not addr_map:
        print("  No components with atopile_address found.")
        board.Save(output_pcb)
        return

    # Place fixed components
    fixed_placements = _place_fixed_components(
        board, addr_map, board_name, config, pcbnew)
    print(f"  Fixed: {len(fixed_placements)} components placed")

    # Validate overlaps between fixed components
    _fixed_info = {}
    for addr in fixed_placements:
        if addr in addr_map:
            fp = addr_map[addr]
            w, h, cx_off, cy_off = _efd(fp, pcbnew)
            _fixed_info[addr] = ComponentInfo(
                address=addr, width=w, height=h,
                is_tht=_is_tht(fp, pcbnew),
                pin_count=len(list(fp.Pads())),
                nets=[], cx_offset=cx_off, cy_offset=cy_off,
            )
    _ok, _oob, overlaps = _vp(
        9999.0, 9999.0, {}, fixed_placements, _fixed_info,
    )
    if overlaps:
        print(f"  FAIL: {len(overlaps)} fixed components overlapping: "
              f"{', '.join(overlaps)}")

    # Place standoffs
    _place_standoffs(board, board_name, config, pcbnew)

    # Count free (unplaced) components
    n_free = sum(1 for addr in addr_map if addr not in fixed_placements)
    print(f"  Free: {n_free} components (not placed — use --variant to place)")

    board.Save(output_pcb)
    n_fixed = regenerate_duplicate_uuids(output_pcb)
    if n_fixed:
        print(f"  Fixed {n_fixed} duplicate pad UUIDs")
    print(f"  Saved to {output_pcb}")

    if overlaps:
        sys.exit(1)


# ---------------------------------------------------------------------------
# Generic board placement
# ---------------------------------------------------------------------------

def place_board(board_name, strategy_name, params, input_pcb, output_pcb,
                pcbnew):
    """Board-agnostic placement: load config -> place fixed -> run strategy -> save.

    Args:
        board_name: Key in board-config.json ("control", "main").
        strategy_name: Algorithm name ("constructive", "grid_spread", etc.).
        params: Strategy parameters dict.
        input_pcb: Path to input .kicad_pcb file.
        output_pcb: Path to output .kicad_pcb file.
        pcbnew: KiCad pcbnew module.

    Returns:
        Number of overlaps (0 = success).
    """
    from placement.helpers import (
        identify_power_nets, build_net_graph, regenerate_duplicate_uuids,
        validate_placement, check_anti_affinity,
    )
    from placement.strategies import (
        AntiAffinityRule, BoardState, ComponentInfo, Placement,
        get_strategy,
    )
    # Ensure all strategies are registered
    from placement.strategies import constructive, force_directed, sa_refine, grid_spread  # noqa: F401

    config = load_board_config()
    board_cfg = config["boards"][board_name]
    placement_cfg = board_cfg["placement"]

    # 1. Load board dimensions
    board_w, board_h = _get_board_dimensions(board_name, config)

    # 2. Load and prepare KiCad PCB
    board = pcbnew.LoadBoard(input_pcb)
    _setup_board_outline(board, board_w, board_h, pcbnew)
    addr_map = _build_addr_map(board)

    if not addr_map:
        print("  No components with atopile_address found.")
        board.Save(output_pcb)
        return 0

    # 3. Place fixed components from config
    fixed_placements = _place_fixed_components(
        board, addr_map, board_name, config, pcbnew)
    print(f"  Fixed: {len(fixed_placements)} components")

    # 3b. Validate fixed positions (check overlaps only — fixed components
    #     define the board layout, so bounds checking is not applicable)
    if fixed_placements:
        from placement.helpers import (
            validate_placement as _vp,
            extract_footprint_dims as _efd,
            is_tht as _is_tht,
        )
        _fixed_info_tmp = {}
        for addr in fixed_placements:
            if addr in addr_map:
                fp = addr_map[addr]
                w, h, cx_off, cy_off = _efd(fp, pcbnew)
                _fixed_info_tmp[addr] = ComponentInfo(
                    address=addr, width=w, height=h,
                    is_tht=_is_tht(fp, pcbnew),
                    pin_count=len(list(fp.Pads())),
                    nets=[], cx_offset=cx_off, cy_offset=cy_off,
                )
        # Use large bounds so only overlaps are checked, not OOB
        _ok, _oob, overlaps = _vp(
            9999.0, 9999.0, {}, fixed_placements, _fixed_info_tmp,
        )
        if overlaps:
            print(f"  FAIL: {len(overlaps)} fixed components overlapping: "
                  f"{', '.join(overlaps)}")
            sys.exit(1)

    # 4. Place standoffs (control board has M3 mounting holes)
    standoff_zones = _place_standoffs(board, board_name, config, pcbnew)

    # 5. Extract ComponentInfo for ALL components
    component_padding = placement_cfg.get("component_padding", {})
    power_nets = identify_power_nets(board)
    fixed_info = {}
    free_components = {}
    for addr, fp in addr_map.items():
        info = _extract_component_info(addr, fp, pcbnew, power_nets)
        pad_l, pad_r, pad_t, pad_b = get_component_padding(
            addr, component_padding)
        if pad_l or pad_r or pad_t or pad_b:
            info.width += pad_l + pad_r
            info.height += pad_t + pad_b
        if addr in fixed_placements:
            fixed_info[addr] = info
        else:
            free_components[addr] = info

    print(f"  Free: {len(free_components)} components")

    # 6. Build net graph
    net_graph = build_net_graph(board, addr_map, power_nets)
    print(f"  Nets: {len(net_graph)} (non-power, 2+ connections)")

    # 7. Parse anti-affinity rules
    anti_affinity_cfg = placement_cfg.get("anti_affinity", [])
    anti_affinity_rules = [
        AntiAffinityRule(
            from_pattern=r["from"], to_pattern=r["to"], min_mm=r["min_mm"],
        )
        for r in anti_affinity_cfg
    ]
    if anti_affinity_rules:
        print(f"  Anti-affinity: {len(anti_affinity_rules)} rules")

    # 8. Build BoardState with fixed components + standoff exclusion zones
    smd_side = placement_cfg.get("smd_side", "both")
    tht_extra = placement_cfg.get("tht_extra_clearance_mm", 0.0)

    board_state = BoardState(
        width=board_w,
        height=board_h,
        fixed=fixed_placements,
        fixed_info=fixed_info,
        net_graph=net_graph,
        anti_affinity=anti_affinity_rules,
        smd_side=smd_side,
        tht_extra_clearance=tht_extra,
        clearance=0.5,
    )

    # Register standoff exclusion zones in the collision tracker
    for so_x, so_y, so_clr in standoff_zones:
        board_state._tracker.register(
            so_x, so_y, so_clr, so_clr,
            "both", is_tht=False, label="standoff")

    # 9. Run strategy
    strategy = get_strategy(strategy_name)
    components_list = list(free_components.values())
    placements = strategy.place(components_list, board_state, params)

    print(f"  Strategy placed {len(placements)} components")

    # 10. Validate placement (fail fast — no point routing invalid placements)
    all_info = {**fixed_info, **free_components}
    ok, out_of_bounds, overlapping = validate_placement(
        board_w, board_h, fixed_placements, placements, all_info,
        tht_extra_clearance=tht_extra,
    )
    if out_of_bounds:
        print(f"  FAIL: {len(out_of_bounds)} components out of bounds: "
              f"{', '.join(out_of_bounds[:5])}"
              f"{'...' if len(out_of_bounds) > 5 else ''}")
    if overlapping:
        print(f"  FAIL: {len(overlapping)} overlapping components: "
              f"{', '.join(overlapping[:5])}"
              f"{'...' if len(overlapping) > 5 else ''}")

    # Check anti-affinity (warn, don't fail)
    aa_violations = check_anti_affinity(placements, fixed_placements,
                                         anti_affinity_rules)
    if aa_violations:
        print(f"  WARNING: {len(aa_violations)} anti-affinity violations:")
        for a, b, dist, min_mm in aa_violations:
            print(f"    {a} <-> {b}: {dist}mm (min {min_mm}mm)")

    # 11. Apply strategy results to KiCad footprints
    placed = 0
    for addr, p in placements.items():
        if addr not in addr_map:
            continue
        fp = addr_map[addr]
        fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(p.x), pcbnew.FromMM(p.y)))
        target_front = p.side == "F"
        current_front = fp.GetLayer() == board.GetLayerID("F.Cu")
        if target_front != current_front:
            fp.Flip(fp.GetPosition(), False)
        if p.rotation:
            fp.SetOrientationDegrees(p.rotation)
        placed += 1

    print(f"  Applied {placed} placements to PCB")

    # 12. Save and fix UUIDs
    board.Save(output_pcb)
    n_fixed = regenerate_duplicate_uuids(output_pcb)
    if n_fixed:
        print(f"  Fixed {n_fixed} duplicate pad UUIDs")
    print(f"  Saved to {output_pcb}")

    n_errors = len(overlapping) + len(out_of_bounds)
    return n_errors


def place_board_with_padding(board_name, strategy_name, params, input_pcb,
                              output_pcb, pcbnew):
    """Place with iterative padding: try decreasing padding until 0 overlaps.

    Uses padding_sequence from board-config.json. Each padding value is passed
    to the strategy via params["extra_padding"].
    """
    config = load_board_config()
    board_cfg = config["boards"][board_name]
    padding_seq = board_cfg["placement"].get("padding_sequence", [0.0])

    dir_name = os.path.dirname(output_pcb)
    fname = os.path.basename(output_pcb)
    staging_pcb = os.path.join(dir_name,
                                fname.replace("-placed", "-staging-placed", 1))
    if staging_pcb == output_pcb:
        staging_pcb = output_pcb + ".staging"

    for padding in padding_seq:
        padded_params = dict(params, extra_padding=padding)
        n_overlaps = place_board(board_name, strategy_name, padded_params,
                                  input_pcb, staging_pcb, pcbnew)
        if n_overlaps == 0:
            print(f"  Padding: {padding:.1f}mm per side (0 overlaps)")
            os.rename(staging_pcb, output_pcb)
            print(f"  Promoted to {output_pcb}")
            return
        print(f"  Padding {padding:.1f}mm: {n_overlaps} overlaps — retrying")

    print(f"  FAIL: {n_overlaps} overlaps remain at lowest padding")
    print(f"  Staging file for inspection: {staging_pcb}")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Variant placement (multi-variant exploration)
# ---------------------------------------------------------------------------

def place_variant(input_pcb, output_pcb, board_type, variant_name):
    """Place components using a named variant from board-config.json.

    Looks up the variant by name in the placement.variants list, then
    delegates to place_board().
    """
    try:
        import pcbnew
    except ImportError:
        print("pcbnew not available. Run with KiCad's Python.")
        sys.exit(1)

    config = load_board_config()

    # Look up variant config
    placement_cfg = config.get("placement", {})
    board_placement = config["boards"][board_type]["placement"]
    variants = board_placement.get("variants", placement_cfg.get("variants", []))
    variant_cfg = None
    for v in variants:
        if v["name"] == variant_name:
            variant_cfg = v
            break
    if variant_cfg is None:
        print(f"  ERROR: variant '{variant_name}' not found in config")
        sys.exit(1)

    algorithm = variant_cfg["algorithm"]
    params = variant_cfg.get("params", {})

    print(f"  Variant: {variant_name} (algorithm={algorithm})")
    print(f"  Params: {params}")

    place_board(board_type, algorithm, params, input_pcb, output_pcb, pcbnew)


# ---------------------------------------------------------------------------
# Legacy entry points (backward compatibility)
# ---------------------------------------------------------------------------

def place_main_board(input_pcb, output_pcb=None):
    """Legacy: place main board with iterative padding."""
    try:
        import pcbnew
    except ImportError:
        print("pcbnew not available. Run with KiCad's Python.")
        sys.exit(1)

    if output_pcb is None:
        output_pcb = input_pcb

    place_board_with_padding("main", "constructive", {}, input_pcb,
                              output_pcb, pcbnew)


def place_components(input_pcb, output_pcb=None):
    """Legacy: place control board with iterative padding."""
    try:
        import pcbnew
    except ImportError:
        print("pcbnew not available. Run with KiCad's Python.")
        sys.exit(1)

    if output_pcb is None:
        output_pcb = input_pcb

    place_board_with_padding("control", "constructive", {}, input_pcb,
                              output_pcb, pcbnew)


def detect_board_type(input_pcb):
    """Detect board type from PCB filename. Returns 'main' or 'control'."""
    basename = os.path.basename(input_pcb).lower()
    if "main" in basename:
        return "main"
    return "control"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Place components on KiCad PCB."
    )
    parser.add_argument(
        "--board",
        choices=["control", "main"],
        default=None,
        help="Board type. Auto-detected from filename if not specified.",
    )
    parser.add_argument(
        "--strategy",
        default=None,
        help="Strategy algorithm name (constructive, grid_spread, etc.).",
    )
    parser.add_argument(
        "--variant",
        default=None,
        help="Variant name from board-config.json (overrides --strategy).",
    )
    parser.add_argument(
        "--fixed-only",
        action="store_true",
        help="Place only fixed components (no strategy). Produces inspectable artifact.",
    )
    parser.add_argument(
        "--params",
        default="{}",
        help="JSON string of strategy parameters.",
    )
    parser.add_argument("input_pcb", help="Input .kicad_pcb file")
    parser.add_argument("output_pcb", nargs="?", default=None,
                        help="Output .kicad_pcb file")
    args = parser.parse_args()

    board_type = args.board or detect_board_type(args.input_pcb)
    print(f"  Board type: {board_type}")

    try:
        import pcbnew
    except ImportError:
        print("pcbnew not available. Run with KiCad's Python.")
        sys.exit(1)

    output = args.output_pcb or args.input_pcb

    if args.fixed_only:
        place_fixed_only(board_type, args.input_pcb, output, pcbnew)
        return

    if args.variant:
        place_variant(args.input_pcb, output, board_type, args.variant)
    elif args.strategy:
        params = json.loads(args.params)
        place_board(board_type, args.strategy, params,
                    args.input_pcb, output, pcbnew)
    else:
        # Legacy mode: iterative padding with constructive strategy
        if board_type == "main":
            place_main_board(args.input_pcb, args.output_pcb)
        else:
            place_components(args.input_pcb, args.output_pcb)


if __name__ == "__main__":
    # Add scripts/ to sys.path so absolute imports (placement.helpers, etc.) work
    # when this file is run directly as a script.
    _scripts_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if _scripts_dir not in sys.path:
        sys.path.insert(0, _scripts_dir)
    main()
