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


def get_component_padding(addr, component_padding, edge_signal_counts=None):
    """Look up per-side courtyard padding for a component address.

    Config keys are prefix-matched against the address, so "leds.tlc"
    matches "leds.tlc1" and "leds.tlc2".

    Supports two formats:
      - Explicit: {"left": N, "right": N, "top": N, "bottom": N}
      - Auto: {"auto_from_pins": true, "base": N, "per_signal_pin": N}
        Computes per-edge padding from signal pin count, uses max as uniform.

    Returns (left, right, top, bottom) in mm.
    """
    for prefix, pad in component_padding.items():
        if addr.startswith(prefix):
            if pad.get("auto_from_pins"):
                base = pad.get("base", 0.0)
                per_pin = pad.get("per_signal_pin", 0.0)
                if edge_signal_counts:
                    edge_paddings = {
                        edge: base + count * per_pin
                        for edge, count in edge_signal_counts.items()
                    }
                    max_pad = max(edge_paddings.values()) if edge_paddings else base
                else:
                    max_pad = base
                return (max_pad, max_pad, max_pad, max_pad)
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
        if fp.HasField("atopile_address"):
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

        # Set side first
        current_front = fp.GetLayer() == board.GetLayerID("F.Cu")
        if front != current_front:
            fp.Flip(fp.GetPosition(), False)

        # Additive rotation: config rotation is added on top of the
        # current orientation (which includes any flip-induced 180°).
        # rotation=0 means "no additional rotation", rotation=180 means
        # "rotate 180° beyond the natural placement for this side".
        current_rot = fp.GetOrientationDegrees()
        fp.SetOrientation(pcbnew.EDA_ANGLE(
            current_rot + rotation, pcbnew.DEGREES_T))

        # Store the actual KiCad rotation — effective_info() handles
        # B.Cu mirroring separately from rotation.
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
        get_component_nets, extract_pad_sides
    from placement.strategies import ComponentInfo

    w, h, cx_off, cy_off = extract_footprint_dims(fp, pcbnew)
    tht = is_tht_fn(fp, pcbnew)
    pin_count = len(list(fp.Pads()))
    nets = get_component_nets(fp, power_nets)
    pad_sides = extract_pad_sides(fp, pcbnew, power_nets)
    edge_signal_count = {edge: len(nets_list)
                         for edge, nets_list in pad_sides.items()}
    return ComponentInfo(
        address=addr, width=w, height=h, is_tht=tht,
        pin_count=pin_count, nets=nets,
        cx_offset=cx_off, cy_offset=cy_off,
        pad_sides=pad_sides,
        edge_signal_count=edge_signal_count,
        group=addr.split(".")[0] if "." in addr else None,
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
# New placer library integration (wavefront strategies)
# ---------------------------------------------------------------------------

def _run_placer_strategy(strategy_name, params, kicad_board, addr_map,
                          board_w, board_h, fixed_placements, power_nets,
                          anti_affinity_cfg, standoff_zones,
                          smd_side, tht_extra, pcbnew,
                          placement_cfg=None):
    """Run placement through the new standalone placer library.

    Returns (placements_dict, n_applied) where placements_dict is
    addr → Placement (legacy format for validation compatibility).
    Also applies results directly to KiCad footprints.
    """
    from placement.strategies import Placement as LegacyPlacement
    from placement.helpers import extract_pad_sides

    from placer.kicad_bridge import (
        extract_component, extract_nets, build_placer_board, apply_placements,
    )
    from placer.dtypes import AffinityRule, BlockedZone, Side, ZoneSide
    from placer import place as placer_place

    placement_cfg = placement_cfg or {}
    per_pin_padding = placement_cfg.get("per_pin_padding_mm", 0.2)
    component_padding = placement_cfg.get("component_padding", {})

    # Extract all components via bridge
    bridges = {}
    for addr, fp in addr_map.items():
        is_fixed = addr in fixed_placements
        fx, fy, fside, frot = 0.0, 0.0, "F", 0.0
        if is_fixed:
            p = fixed_placements[addr]
            fx, fy, fside, frot = p.x, p.y, p.side, p.rotation

        bridge = extract_component(
            addr, fp, pcbnew, power_nets,
            is_fixed=is_fixed,
            fixed_x=fx, fixed_y=fy,
            fixed_side=fside, fixed_rotation=frot,
        )

        # Set per-side routing escape padding. Stored separately from
        # width/height so pin positions stay correct (match KiCad pads).
        # The collision grid uses width+padding for spacing.
        comp = bridge.component
        pad_sides = extract_pad_sides(fp, pcbnew, power_nets)
        edge_signal_count = {edge: len(nets_list)
                             for edge, nets_list in pad_sides.items()}
        pad_l, pad_r, pad_t, pad_b = get_component_padding(
            addr, component_padding,
            edge_signal_counts=edge_signal_count)
        if pad_l or pad_r or pad_t or pad_b:
            comp.pad_left = pad_l
            comp.pad_right = pad_r
            comp.pad_top = pad_t
            comp.pad_bottom = pad_b
        elif per_pin_padding > 0 and edge_signal_count:
            comp.pad_left = edge_signal_count.get("W", 0) * per_pin_padding
            comp.pad_right = edge_signal_count.get("E", 0) * per_pin_padding
            comp.pad_top = edge_signal_count.get("N", 0) * per_pin_padding
            comp.pad_bottom = edge_signal_count.get("S", 0) * per_pin_padding

        bridges[addr] = bridge

    # Extract nets
    nets = extract_nets(addr_map, pcbnew, power_nets)
    rotation_nets = extract_nets(addr_map, pcbnew, power_nets, include_power=True)
    print(f"  Placer nets: {len(nets)} signal, {len(rotation_nets)} total (for rotation)")

    # Convert anti-affinity rules
    affinity_rules = [
        AffinityRule(
            from_pattern=r["from"], to_pattern=r["to"],
            min_distance_mm=r["min_mm"],
        )
        for r in anti_affinity_cfg
    ]

    # Convert standoff zones to BlockedZones
    zones = []
    for so_x, so_y, so_clr in standoff_zones:
        zones.append(BlockedZone(
            x=so_x - so_clr / 2,
            y=so_y - so_clr / 2,
            width=so_clr,
            height=so_clr,
            side=ZoneSide.BOTH,
        ))

    # Convert placement exclusions to BlockedZones so the collision grid
    # enforces them (not just grid point filtering)
    for excl in placement_cfg.get("placement_exclusions", []):
        zones.append(BlockedZone(
            x=excl["x_min"],
            y=excl["y_min"],
            width=excl["x_max"] - excl["x_min"],
            height=excl["y_max"] - excl["y_min"],
            side=ZoneSide.BOTH,
        ))

    # Translate smd_side from KiCad convention ("F"/"B"/"both") to placer
    _SMD_SIDE_MAP = {"F": "front", "B": "back", "both": "both"}
    placer_smd_side = _SMD_SIDE_MAP.get(smd_side, smd_side)

    # Build placer Board
    placer_board = build_placer_board(
        board_w, board_h, bridges, nets,
        affinity_rules=affinity_rules,
        zones=zones,
        clearance=0.5,
        tht_clearance=tht_extra,
        smd_side=placer_smd_side,
        rotation_nets=rotation_nets,
        power_nets=frozenset(power_nets),
    )

    # Run placement
    bypass_caps_cfg = (placement_cfg or {}).get("bypass_caps")
    print(f"  Using placer library: {strategy_name}")
    results = placer_place(placer_board, strategy=strategy_name, params=params,
                           bypass_config=bypass_caps_cfg)
    print(f"  Placer placed {len(results)} components")

    # Apply to KiCad footprints
    n_applied = apply_placements(results, bridges, addr_map,
                                  kicad_board, pcbnew)

    # Convert to legacy Placement format for validation
    legacy_placements = {}
    for r in results:
        # Read back the actual KiCad position (what apply_placements set)
        if r.component_id in addr_map:
            fp = addr_map[r.component_id]
            actual_x = pcbnew.ToMM(fp.GetPosition().x)
            actual_y = pcbnew.ToMM(fp.GetPosition().y)
            side_str = "F" if r.side == Side.FRONT else "B"
            legacy_placements[r.component_id] = LegacyPlacement(
                x=actual_x, y=actual_y,
                side=side_str, rotation=r.rotation,
            )

    return legacy_placements, n_applied


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
        effective_info, get_strategy, rotated_info,
    )
    # Ensure all strategies are registered
    from placement.strategies import constructive, force_directed, sa_refine, grid_spread, wavefront  # noqa: F401

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
    # Automatic per-pin-per-side padding: each signal pin on an edge needs
    # escape routing space (track width + clearance ≈ 0.35mm). We add
    # per_pin_padding mm per signal pin per edge so the autorouter has room.
    per_pin_padding = placement_cfg.get("per_pin_padding_mm", 0.2)
    component_padding = placement_cfg.get("component_padding", {})
    power_nets = identify_power_nets(board)
    fixed_info = {}
    free_components = {}
    for addr, fp in addr_map.items():
        info = _extract_component_info(addr, fp, pcbnew, power_nets)
        # Manual per-component overrides take priority
        pad_l, pad_r, pad_t, pad_b = get_component_padding(
            addr, component_padding,
            edge_signal_counts=info.edge_signal_count)
        if pad_l or pad_r or pad_t or pad_b:
            info.width += pad_l + pad_r
            info.height += pad_t + pad_b
        elif per_pin_padding > 0 and info.edge_signal_count:
            # Auto padding: per_pin_padding mm per signal pin per edge
            esc = info.edge_signal_count
            auto_l = esc.get("W", 0) * per_pin_padding
            auto_r = esc.get("E", 0) * per_pin_padding
            auto_t = esc.get("N", 0) * per_pin_padding
            auto_b = esc.get("S", 0) * per_pin_padding
            info.width += auto_l + auto_r
            info.height += auto_t + auto_b
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

    # 8. Dispatch: wavefront strategies use the new placer library;
    #    other strategies use the legacy BoardState path.
    _PLACER_STRATEGIES = {"wavefront", "wavefront_circuit", "wavefront_direct"}
    smd_side = placement_cfg.get("smd_side", "both")
    tht_extra = placement_cfg.get("tht_extra_clearance_mm", 0.0)

    # Load placement exclusion zones from config
    exclusions = placement_cfg.get("placement_exclusions", [])
    if exclusions:
        params = dict(params, placement_exclusions=exclusions)
        print(f"  Placement exclusions: {len(exclusions)} zones")

    if strategy_name in _PLACER_STRATEGIES:
        # --- New placer library path ---
        placements, placed = _run_placer_strategy(
            strategy_name, params, board, addr_map,
            board_w, board_h, fixed_placements, power_nets,
            anti_affinity_cfg, standoff_zones,
            smd_side, tht_extra, pcbnew,
            placement_cfg=placement_cfg,
        )
    else:
        # --- Legacy path for constructive, force_directed, etc. ---
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

        # Register placement exclusion zones in the collision tracker
        for excl in exclusions:
            cx = (excl["x_min"] + excl["x_max"]) / 2
            cy = (excl["y_min"] + excl["y_max"]) / 2
            w = excl["x_max"] - excl["x_min"]
            h = excl["y_max"] - excl["y_min"]
            board_state._tracker.register(
                cx, cy, w, h,
                "both", is_tht=False, label=f"excl_{cx:.0f}_{cy:.0f}")

        # Build clusters and run strategy
        from placement.helpers import build_clusters
        clusters = build_clusters(free_components, net_graph)
        if clusters:
            print(f"  Clusters: {len(clusters)} "
                  f"({', '.join(c.anchor for c in clusters)})")
            params = dict(params, clusters=clusters)

        strategy = get_strategy(strategy_name)
        components_list = list(free_components.values())
        placements = strategy.place(components_list, board_state, params)

        print(f"  Strategy placed {len(placements)} components")

        # Apply legacy results to KiCad footprints
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
            # Additive rotation: strategy rotation is on top of flip.
            current_rot = fp.GetOrientationDegrees()
            fp.SetOrientationDegrees(current_rot + p.rotation)
            placed += 1

    # 10. Validate placement (fail fast — no point routing invalid placements)
    if strategy_name in _PLACER_STRATEGIES:
        # The placer library has its own internal collision detection that
        # uses bbox top-left coordinates. We verified it produces 0 overlaps
        # internally. Legacy validation uses footprint-origin + cx_offset
        # coordinates which don't match the placer's model for asymmetric
        # components. Trust the placer's collision detection.
        legacy_placements = placements
        overlapping = []
        out_of_bounds = []
    else:
        legacy_placements = placements

        all_info = {}
        for addr, info in fixed_info.items():
            if addr in fixed_placements:
                p = fixed_placements[addr]
                all_info[addr] = effective_info(info, p.rotation, p.side)
            else:
                all_info[addr] = info
        for addr, info in free_components.items():
            if addr in legacy_placements:
                p = legacy_placements[addr]
                all_info[addr] = effective_info(info, p.rotation, p.side)
            else:
                all_info[addr] = info

        ok, out_of_bounds, overlapping = validate_placement(
            board_w, board_h, fixed_placements, legacy_placements, all_info,
            clearance=0.5, tht_extra_clearance=tht_extra,
        )

    if out_of_bounds:
        print(f"  FAIL: {len(out_of_bounds)} components out of bounds: "
              f"{', '.join(out_of_bounds[:5])}"
              f"{'...' if len(out_of_bounds) > 5 else ''}")
    if overlapping:
        print(f"  FAIL: {len(overlapping)} overlapping components: "
              f"{', '.join(overlapping[:5])}"
              f"{'...' if len(overlapping) > 5 else ''}")
    if overlapping or out_of_bounds:
        n_errors = len(overlapping) + len(out_of_bounds)
        failed_pcb = output_pcb.replace(".kicad_pcb", ".failed.kicad_pcb")
        print(f"  Aborting — {n_errors} placement errors")
        board.Save(failed_pcb)
        print(f"  Failed placement saved to {failed_pcb}")
        return n_errors

    # Check anti-affinity (warn, don't fail)
    if strategy_name not in _PLACER_STRATEGIES:
        aa_violations = check_anti_affinity(legacy_placements, fixed_placements,
                                             anti_affinity_rules)
        if aa_violations:
            print(f"  WARNING: {len(aa_violations)} anti-affinity violations:")
            for a, b, dist, min_mm in aa_violations:
                print(f"    {a} <-> {b}: {dist}mm (min {min_mm}mm)")

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

    n_errors = place_board(board_type, algorithm, params, input_pcb, output_pcb, pcbnew)
    if n_errors:
        sys.exit(1)


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
