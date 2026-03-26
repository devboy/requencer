"""Wavefront placement strategy with multi-region adaptive grid.

Places components in BFS waves from fixed anchor components. Wave 0 =
components directly connected to fixed parts, wave 1 = one hop further,
etc. Within each wave, circuits (connected components in the net graph)
are processed largest-first, and within each circuit, components are
sorted by connection count (most connections first).

Grid is built from the actual free rectangles between fixed components.
Each rectangle gets grid cells proportional to its area. Components are
assigned to the nearest grid cell across ALL regions, ensuring they
spread across the entire board instead of clustering in one gap.
"""

import math
from collections import defaultdict

from ..helpers import (
    best_rotation_at_position,
    build_circuits,
    compute_wave_distances,
    pin_alignment_padding,
)
from . import BoardState, ComponentInfo, Placement, register


def _build_multi_region_grid(board, n_free, margin=1.0, exclusions=None):
    """Build grid points across all free rectangular regions.

    Uses CollisionTracker.find_largest_free_rects to discover available
    regions, then creates a grid within each region with spacing
    proportional to the region's capacity.

    Returns (grid_points, grid_step) where grid_step is the average spacing.
    """
    # Find free rectangles on both sides (use B for SMD-heavy boards)
    rects = board._tracker.find_largest_free_rects(
        "B", resolution=2.0, count=20, edge_margin=2.0)

    if not rects:
        # Fallback: uniform grid
        board_area = board.width * board.height
        step = math.sqrt(board_area / max(n_free * 2, 1))
        step = max(step, 2.0)
        points = []
        x = step / 2
        while x < board.width:
            y = step / 2
            while y < board.height:
                points.append((x, y))
                y += step
            x += step
        return points, step

    # Total free area across all rectangles
    total_area = sum(w * h for _, _, w, h in rects)
    if total_area <= 0:
        return [], 5.0

    # Target: ~2 cells per component spread across all regions
    target_cells = n_free * 2
    # Average cell area = total_area / target_cells
    avg_cell_area = total_area / max(target_cells, 1)
    avg_step = math.sqrt(avg_cell_area)
    avg_step = max(avg_step, 2.0)

    points = []
    for rx, ry, rw, rh in rects:
        if rw < 3 or rh < 3:
            continue  # Skip tiny fragments

        # Cells for this region proportional to its area share
        region_area = rw * rh
        region_cells = max(1, int(target_cells * region_area / total_area))

        # Grid step for this region
        step = math.sqrt(region_area / max(region_cells, 1))
        step = max(step, 2.0)

        # Generate grid within this rectangle
        x = rx + step / 2
        while x < rx + rw:
            y = ry + step / 2
            while y < ry + rh:
                # Verify point is within board and not in an exclusion zone
                if 0 < x < board.width and 0 < y < board.height:
                    in_exclusion = False
                    if exclusions:
                        for ex in exclusions:
                            if (ex["x_min"] <= x <= ex["x_max"] and
                                    ex["y_min"] <= y <= ex["y_max"]):
                                in_exclusion = True
                                break
                    if not in_exclusion:
                        points.append((x, y))
                y += step
            x += step

    return points, avg_step


def _claim_grid_point(grid_points, tx, ty, comp, grid_step,
                      per_pin_margin=0.3, exclusions=None, addr=""):
    """Pick nearest available grid point to target, claim surrounding area.

    exclusions: list of dicts with x_min/y_min/x_max/y_max/allowed_prefixes.
    Points inside an exclusion zone are skipped unless the component's
    address starts with one of the allowed prefixes.

    Returns (gx, gy, remaining_points).
    """
    def _is_excluded(x, y, addr, exclusions):
        """Check if position is in an exclusion zone for this component."""
        if not exclusions:
            return False
        for ex in exclusions:
            if (ex["x_min"] <= x <= ex["x_max"] and
                    ex["y_min"] <= y <= ex["y_max"]):
                prefixes = ex.get("allowed_prefixes", [])
                if not any(addr.startswith(p) for p in prefixes):
                    return True
        return False

    if not grid_points:
        # Grid exhausted — push target outside exclusion zone if needed
        if _is_excluded(tx, ty, addr, exclusions):
            # Move to nearest edge of exclusion zone
            for ex in exclusions:
                if (ex["x_min"] <= tx <= ex["x_max"] and
                        ex["y_min"] <= ty <= ex["y_max"]):
                    # Push to nearest boundary
                    distances = [
                        (abs(tx - ex["x_min"]), ex["x_min"] - 2, ty),
                        (abs(tx - ex["x_max"]), ex["x_max"] + 2, ty),
                        (abs(ty - ex["y_min"]), tx, ex["y_min"] - 2),
                        (abs(ty - ex["y_max"]), tx, ex["y_max"] + 2),
                    ]
                    distances.sort(key=lambda d: d[0])
                    _, tx, ty = distances[0]
                    break
        return tx, ty, []

    # Filter out excluded grid points for this component
    if exclusions:
        allowed_points = []
        for i, (gx, gy) in enumerate(grid_points):
            blocked = False
            for ex in exclusions:
                if (ex["x_min"] <= gx <= ex["x_max"] and
                        ex["y_min"] <= gy <= ex["y_max"]):
                    # Point is in exclusion zone — check if component is allowed
                    prefixes = ex.get("allowed_prefixes", [])
                    if not any(addr.startswith(p) for p in prefixes):
                        blocked = True
                        break
            if not blocked:
                allowed_points.append(i)
    else:
        allowed_points = list(range(len(grid_points)))

    if not allowed_points:
        return tx, ty, grid_points  # No valid points, return target

    # Find nearest allowed point to connectivity target
    best_idx = allowed_points[0]
    best_dist = float('inf')
    for i in allowed_points:
        gx, gy = grid_points[i]
        dist = abs(gx - tx) + abs(gy - ty)
        if dist < best_dist:
            best_dist = dist
            best_idx = i

    gx, gy = grid_points[best_idx]

    # Claim radius: footprint + pin-scaled routing margin
    pin_extra = comp.pin_count * per_pin_margin
    half_w = comp.width / 2 + pin_extra / 2 + grid_step * 0.25
    half_h = comp.height / 2 + pin_extra / 2 + grid_step * 0.25
    remaining = [
        (px, py) for px, py in grid_points
        if abs(px - gx) > half_w or abs(py - gy) > half_h
    ]

    return gx, gy, remaining


@register("wavefront")
class WavefrontStrategy:
    """BFS wavefront expansion from fixed anchors with multi-region grid."""

    def place(self, components: list[ComponentInfo],
              board: BoardState, params: dict) -> dict[str, Placement]:
        if not components:
            return {}

        comp_map = {c.address: c for c in components}
        free_addrs = set(comp_map.keys())
        fixed_addrs = set(board.fixed.keys())

        # 1. Build circuits (connected components in net graph)
        all_addrs = free_addrs | fixed_addrs
        circuits = build_circuits(board.net_graph, all_addrs)

        addr_to_circuit = {}
        for circuit in circuits:
            for addr in circuit:
                addr_to_circuit[addr] = circuit

        # 2. Compute wave distances from fixed components
        wave_map, orphans = compute_wave_distances(
            board.net_graph, fixed_addrs, free_addrs)

        max_wave = max(wave_map.values()) if wave_map else -1

        # 3. Compute circuit areas
        circuit_area = {}
        for circuit in circuits:
            area = sum(comp_map[a].width * comp_map[a].height
                       for a in circuit if a in comp_map)
            circuit_area[id(circuit)] = area

        def _comp_priority_key(addr):
            c = comp_map[addr]
            connections = len(c.nets)
            area = c.width * c.height
            return -(connections * 10 + area)

        # 4. Build multi-region grid from free rectangles
        n_free = len(comp_map)
        exclusions = params.get("placement_exclusions", [])
        grid_points, grid_step = _build_multi_region_grid(
            board, n_free, margin=1.0, exclusions=exclusions)

        # 5. Build wavefront order
        ordered_addrs = []
        for wave in range(max_wave + 1):
            wave_by_circuit = defaultdict(list)
            for addr, w in wave_map.items():
                if w == wave:
                    circuit = addr_to_circuit.get(addr)
                    if circuit is not None:
                        wave_by_circuit[id(circuit)].append(addr)

            sorted_circuit_ids = sorted(
                wave_by_circuit.keys(),
                key=lambda cid: -circuit_area.get(cid, 0))

            for cid in sorted_circuit_ids:
                addrs = sorted(wave_by_circuit[cid], key=_comp_priority_key)
                ordered_addrs.extend(addrs)

        ordered_addrs.extend(sorted(orphans, key=_comp_priority_key))

        # 6. Assign grid positions and place
        auto_rotate = params.get("auto_rotate", False)
        exclusions = params.get("placement_exclusions", [])
        placements = {}

        for addr in ordered_addrs:
            info = comp_map[addr]

            tx, ty = board.connectivity_target(
                addr, placements, group=info.group,
                comp_map=comp_map)

            gx, gy, grid_points = _claim_grid_point(
                grid_points, tx, ty, info, grid_step,
                exclusions=exclusions, addr=addr)

            rotation = 0.0
            if (auto_rotate and info.pad_sides
                    and info.pin_count >= 2):
                all_positions = {**placements, **board.fixed}
                rotation = best_rotation_at_position(
                    info, gx, gy, board.net_graph,
                    all_positions, addr)

            p = board.place_component(
                addr, gx, gy, info, side=None,
                rotation=rotation, placed=placements)
            placements[addr] = p

        return placements


@register("wavefront_circuit")
class WavefrontCircuitStrategy:
    """Circuit-first variant: place all components of one circuit before
    moving to the next. Circuits sorted by total connection count (most
    connected first). Within each circuit, wavefront order applies.

    This keeps each circuit physically grouped — the DAC circuit lands
    as a unit, the power circuit as a unit, etc.
    """

    def place(self, components: list[ComponentInfo],
              board: BoardState, params: dict) -> dict[str, Placement]:
        if not components:
            return {}

        comp_map = {c.address: c for c in components}
        free_addrs = set(comp_map.keys())
        fixed_addrs = set(board.fixed.keys())

        # 1. Build circuits
        all_addrs = free_addrs | fixed_addrs
        circuits = build_circuits(board.net_graph, all_addrs)

        addr_to_circuit = {}
        for circuit in circuits:
            for addr in circuit:
                addr_to_circuit[addr] = circuit

        # 2. Wave distances
        wave_map, orphans = compute_wave_distances(
            board.net_graph, fixed_addrs, free_addrs)

        # 3. Group by module prefix (first dotted segment of atopile address)
        # This splits the giant net-connected blob into logical subcircuits:
        # dac.*, mcu.*, buttons.*, leds.*, power.*, etc.
        module_groups = defaultdict(list)
        for addr in comp_map:
            prefix = addr.split(".")[0] if "." in addr else "_root"
            module_groups[prefix].append(addr)

        # Sort modules by total connections (most connected first)
        module_conns = {}
        for prefix, addrs in module_groups.items():
            total = sum(len(comp_map[a].nets) for a in addrs)
            module_conns[prefix] = total

        sorted_modules = sorted(
            module_groups.keys(),
            key=lambda p: -module_conns.get(p, 0))

        def _comp_priority_key(addr):
            c = comp_map[addr]
            # Within a circuit: wave distance first, then connections
            wave = wave_map.get(addr, 999)
            connections = len(c.nets)
            area = c.width * c.height
            return (wave, -(connections * 10 + area))

        # 4. Build grid
        n_free = len(comp_map)
        exclusions = params.get("placement_exclusions", [])
        grid_points, grid_step = _build_multi_region_grid(
            board, n_free, margin=1.0, exclusions=exclusions)

        # 5. Place module by module (most connected modules first)
        auto_rotate = params.get("auto_rotate", False)
        exclusions = params.get("placement_exclusions", [])
        placements = {}

        for prefix in sorted_modules:
            module_addrs = [a for a in module_groups[prefix]
                            if a in comp_map]
            if not module_addrs:
                continue

            # Sort: wave 0 first, then by connections
            module_addrs.sort(key=_comp_priority_key)

            for addr in module_addrs:
                info = comp_map[addr]

                tx, ty = board.connectivity_target(
                    addr, placements, group=info.group,
                    comp_map=comp_map)

                gx, gy, grid_points = _claim_grid_point(
                    grid_points, tx, ty, info, grid_step,
                    exclusions=exclusions, addr=addr)

                rotation = 0.0
                if (auto_rotate and info.pad_sides
                        and info.pin_count >= 2):
                    all_positions = {**placements, **board.fixed}
                    rotation = best_rotation_at_position(
                        info, gx, gy, board.net_graph,
                        all_positions, addr)

                p = board.place_component(
                    addr, gx, gy, info, side=None,
                    rotation=rotation, placed=placements)
                placements[addr] = p

        # Orphans last
        orphan_addrs = sorted(orphans,
                              key=lambda a: -(len(comp_map[a].nets) * 10 +
                                              comp_map[a].width * comp_map[a].height))
        for addr in orphan_addrs:
            info = comp_map[addr]
            tx, ty = board.connectivity_target(
                addr, placements, group=info.group)
            gx, gy, grid_points = _claim_grid_point(
                grid_points, tx, ty, info, grid_step,
                exclusions=exclusions, addr=addr)
            p = board.place_component(
                addr, gx, gy, info, side=None,
                rotation=0.0, placed=placements)
            placements[addr] = p

        return placements


@register("wavefront_direct")
class WavefrontDirectStrategy:
    """Two-pass BFS wavefront with direct pin-aware placement (no grid).

    Pass 1: Place each component directly at its pin-edge connectivity
    target. No grid quantization — collision resolution handled by
    board.place_component()'s ring-search.

    Pass 2: Evaluate pin alignment quality for each placed component.
    Components with well-aligned pins (facing each other) keep tight
    spacing. Components with misaligned pins get extra padding so traces
    can route around them. Reset the collision tracker and re-place
    everything with alignment-aware padding.
    """

    def place(self, components: list[ComponentInfo],
              board: BoardState, params: dict) -> dict[str, Placement]:
        if not components:
            return {}

        comp_map = {c.address: c for c in components}
        free_addrs = set(comp_map.keys())
        fixed_addrs = set(board.fixed.keys())

        # 1. Build circuits
        all_addrs = free_addrs | fixed_addrs
        circuits = build_circuits(board.net_graph, all_addrs)

        addr_to_circuit = {}
        for circuit in circuits:
            for addr in circuit:
                addr_to_circuit[addr] = circuit

        # 2. Compute wave distances from fixed components
        wave_map, orphans = compute_wave_distances(
            board.net_graph, fixed_addrs, free_addrs)

        max_wave = max(wave_map.values()) if wave_map else -1

        # 3. Compute circuit areas for ordering
        circuit_area = {}
        for circuit in circuits:
            area = sum(comp_map[a].width * comp_map[a].height
                       for a in circuit if a in comp_map)
            circuit_area[id(circuit)] = area

        def _comp_priority_key(addr):
            c = comp_map[addr]
            connections = len(c.nets)
            area = c.width * c.height
            return -(connections * 10 + area)

        # 4. Build wavefront order (same as WavefrontStrategy)
        ordered_addrs = []
        for wave in range(max_wave + 1):
            wave_by_circuit = defaultdict(list)
            for addr, w in wave_map.items():
                if w == wave:
                    circuit = addr_to_circuit.get(addr)
                    if circuit is not None:
                        wave_by_circuit[id(circuit)].append(addr)

            sorted_circuit_ids = sorted(
                wave_by_circuit.keys(),
                key=lambda cid: -circuit_area.get(cid, 0))

            for cid in sorted_circuit_ids:
                addrs = sorted(wave_by_circuit[cid], key=_comp_priority_key)
                ordered_addrs.extend(addrs)

        ordered_addrs.extend(sorted(orphans, key=_comp_priority_key))

        auto_rotate = params.get("auto_rotate", False)
        full_comp_map = {**comp_map, **board.fixed_info}

        # --- Pass 1: Place at pin-edge targets, minimal padding ---
        placements = {}
        for addr in ordered_addrs:
            info = comp_map[addr]
            tx, ty = board.connectivity_target(
                addr, placements, group=info.group,
                comp_map=comp_map)

            rotation = 0.0
            if (auto_rotate and info.pad_sides
                    and info.pin_count >= 2):
                all_positions = {**placements, **board.fixed}
                rotation = best_rotation_at_position(
                    info, tx, ty, board.net_graph,
                    all_positions, addr, side=board.smd_side,
                    comp_map=full_comp_map)

            p = board.place_component(
                addr, tx, ty, info, side=None,
                rotation=rotation, placed=placements)
            placements[addr] = p

        # --- Pass 2: Compute alignment padding, re-place with spacing ---
        all_positions = {**placements, **board.fixed}
        padding_map = {}
        for addr in ordered_addrs:
            info = comp_map[addr]
            p = placements[addr]
            pad = pin_alignment_padding(
                info, p, board.net_graph, all_positions,
                full_comp_map)
            if any(v > 0 for v in pad.values()):
                padding_map[addr] = pad

        if not padding_map:
            return placements

        # Reset tracker and re-place everything with padding
        board.reset_tracker()
        placements2 = {}
        for addr in ordered_addrs:
            info = comp_map[addr]
            tx, ty = board.connectivity_target(
                addr, placements2, group=info.group,
                comp_map=comp_map)

            rotation = 0.0
            if (auto_rotate and info.pad_sides
                    and info.pin_count >= 2):
                all_positions2 = {**placements2, **board.fixed}
                rotation = best_rotation_at_position(
                    info, tx, ty, board.net_graph,
                    all_positions2, addr, side=board.smd_side,
                    comp_map=full_comp_map)

            p = board.place_component(
                addr, tx, ty, info, side=None,
                rotation=rotation, placed=placements2,
                side_padding=padding_map.get(addr))
            placements2[addr] = p

        return placements2
