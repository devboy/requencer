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
)
from . import BoardState, ComponentInfo, Placement, register


def _build_multi_region_grid(board, n_free, margin=1.0):
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
                # Verify point is actually within board and not blocked
                if 0 < x < board.width and 0 < y < board.height:
                    points.append((x, y))
                y += step
            x += step

    return points, avg_step


def _claim_grid_point(grid_points, tx, ty, comp, grid_step,
                      per_pin_margin=0.3):
    """Pick nearest available grid point to target, claim surrounding area.

    Returns (gx, gy, remaining_points).
    """
    if not grid_points:
        return tx, ty, []

    # Find nearest available point to connectivity target
    best_idx = 0
    best_dist = float('inf')
    for i, (gx, gy) in enumerate(grid_points):
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


def _pin_aware_offset(comp, placed_comps, placements, comp_map):
    """Compute a target offset based on which IC pin the component connects to.

    For a passive (2-4 pins) connected to an already-placed IC, finds the
    shared net, looks up which edge of the IC that net's pad is on, and
    returns an offset vector pointing away from that edge. This places the
    passive on the correct side of its parent IC for shortest trace.

    Returns (dx, dy) offset from the IC's position, or (0, 0) if no
    pin-aware placement applies.
    """
    if comp.pin_count > 6:
        return 0.0, 0.0  # Only for passives

    comp_nets = set(comp.nets)
    if not comp_nets:
        return 0.0, 0.0

    # Find the most-connected already-placed IC
    best_ic_addr = None
    best_shared = 0
    best_ic_pos = None

    for other_addr, other_p in placements.items():
        other = comp_map.get(other_addr)
        if not other or other.pin_count <= 6:
            continue  # Only match against ICs
        shared = len(comp_nets & set(other.nets))
        if shared > best_shared:
            best_shared = shared
            best_ic_addr = other_addr
            best_ic_pos = other_p

    if not best_ic_addr or not best_ic_pos:
        return 0.0, 0.0

    ic = comp_map[best_ic_addr]
    if not ic.pad_sides:
        return 0.0, 0.0

    # Find which edge the shared net is on
    shared_nets = comp_nets & set(ic.nets)
    edge_scores = {"N": 0, "S": 0, "E": 0, "W": 0}
    for edge, edge_nets in ic.pad_sides.items():
        for net in edge_nets:
            if net in shared_nets:
                edge_scores[edge] += 1

    if not any(edge_scores.values()):
        return 0.0, 0.0

    # Pick the dominant edge
    best_edge = max(edge_scores, key=edge_scores.get)

    # Offset: place passive on that side of the IC
    # Use IC dimensions + margin for offset distance
    offset_dist = max(ic.width, ic.height) / 2 + 5.0
    offsets = {
        "N": (0, -offset_dist),
        "S": (0, offset_dist),
        "E": (offset_dist, 0),
        "W": (-offset_dist, 0),
    }
    dx, dy = offsets[best_edge]
    return best_ic_pos.x + dx, best_ic_pos.y + dy


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
        grid_points, grid_step = _build_multi_region_grid(
            board, n_free, margin=1.0)

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
        placements = {}

        for addr in ordered_addrs:
            info = comp_map[addr]

            tx, ty = board.connectivity_target(
                addr, placements, group=info.group)

            # For passives: use pin-aware targeting to place on the
            # correct side of the parent IC (near the connecting pin)
            if info.pin_count <= 6 and placements:
                pa_x, pa_y = _pin_aware_offset(
                    info, set(), placements, comp_map)
                if pa_x != 0 or pa_y != 0:
                    # Blend: 70% pin-aware, 30% connectivity
                    tx = pa_x * 0.7 + tx * 0.3
                    ty = pa_y * 0.7 + ty * 0.3

            gx, gy, grid_points = _claim_grid_point(
                grid_points, tx, ty, info, grid_step)

            rotation = 0.0
            if (auto_rotate and info.pad_sides
                    and info.pin_count > 4):
                all_positions = {**placements, **board.fixed}
                rotation = best_rotation_at_position(
                    info, gx, gy, board.net_graph,
                    all_positions, addr)

            p = board.place_component(
                addr, gx, gy, info, side=None,
                rotation=rotation, placed=placements)
            placements[addr] = p

        return placements
