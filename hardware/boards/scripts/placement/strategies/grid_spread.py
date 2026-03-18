"""Grid spread placement strategy.

Distributes components evenly across the board on a grid, then uses
connectivity scoring to assign components to cells. Gives the autorouter
maximum routing space at the cost of slightly longer traces.

When clusters are provided, uses cluster-aware ordering: anchors are
assigned first, then satellites get a strong pull toward the correct
anchor edge, then passives toward their satellite.

Parameterized by:
  - margin: mm inset from board edges for grid generation
  - connectivity_weight: strength of pull toward connected neighbors
  - density_weight: strength of repulsion between large/dense components
  - density_threshold_mm2: area threshold above which components repel
  - seed: random seed for tie-breaking
  - clusters: list[Cluster] (optional, injected by orchestrator)
"""

import math
import random

from ..helpers import (
    cluster_aware_sort,
    cluster_edge_affinity,
    connectivity_sort_by_net_graph,
    satellite_target_position,
    best_rotation_at_position,
)
from . import BoardState, ComponentInfo, Placement, register, rotated_info


_PASSIVE_PREFIXES = ("r_", "c_", "l_", "r.", "c.", "l.")


def _is_passive_addr(addr):
    parts = addr.rsplit(".", 1)
    leaf = parts[-1] if len(parts) > 1 else addr
    return any(leaf.lower().startswith(p) for p in _PASSIVE_PREFIXES)


def _density_repulsion(
    addr: str,
    cx: float,
    cy: float,
    info: ComponentInfo,
    assigned: dict[str, tuple[float, float]],
    free_info: dict[str, ComponentInfo],
    fixed_pos: dict[str, tuple[float, float]],
    fixed_info: dict[str, ComponentInfo],
    threshold: float,
    weight: float,
) -> float:
    """Repulsion penalty between dense/large components."""
    size_a = info.routing_pressure if info.routing_pressure > 0 else info.width * info.height
    if size_a < threshold:
        return 0.0
    char_a = size_a ** 0.5

    penalty = 0.0

    def _check(other_info, ox, oy):
        nonlocal penalty
        if other_info is None:
            return
        size_b = other_info.routing_pressure if other_info.routing_pressure > 0 else other_info.width * other_info.height
        if size_b < threshold:
            return
        char_b = size_b ** 0.5
        dist = ((cx - ox) ** 2 + (cy - oy) ** 2) ** 0.5
        min_spacing = char_a + char_b
        if dist < min_spacing:
            shortfall = min_spacing - dist
            penalty += weight * shortfall * (char_a + char_b)

    for other_addr, (ox, oy) in assigned.items():
        _check(free_info.get(other_addr), ox, oy)

    for other_addr, (ox, oy) in fixed_pos.items():
        _check(fixed_info.get(other_addr), ox, oy)

    return penalty


@register("grid_spread")
class GridSpreadStrategy:
    """Even grid distribution with connectivity-aware assignment."""

    def place(self, components: list[ComponentInfo],
              board: BoardState, params: dict) -> dict[str, Placement]:
        margin = params.get("margin", 3.0)
        connectivity_weight = params.get("connectivity_weight", 1.0)
        density_weight = params.get("density_weight", 0.1)
        density_threshold = params.get("density_threshold_mm2", 10.0)
        seed = params.get("seed", 42)
        clusters = params.get("clusters", [])

        rng = random.Random(seed)
        comp_map = {c.address: c for c in components}
        free_addrs = list(comp_map.keys())
        if not free_addrs:
            return {}

        # Build cluster lookup
        anchor_of = {}
        cluster_of = {}
        for cl in clusters:
            cluster_of[cl.anchor] = cl
            for sat_addr in cl.satellites:
                anchor_of[sat_addr] = cl.anchor
                cluster_of[sat_addr] = cl
                for passive_addr in cl.satellites[sat_addr]:
                    anchor_of[passive_addr] = cl.anchor
                    cluster_of[passive_addr] = cl
            for bypass_addr in cl.bypass:
                anchor_of[bypass_addr] = cl.anchor
                cluster_of[bypass_addr] = cl

        # --- 1. Build adjacency weights from net_graph ---
        adjacency: dict[str, dict[str, int]] = {addr: {} for addr in free_addrs}
        all_addrs = set(free_addrs) | set(board.fixed.keys())
        for net, net_addrs in board.net_graph.items():
            for i in range(len(net_addrs)):
                for j in range(i + 1, len(net_addrs)):
                    a, b = net_addrs[i], net_addrs[j]
                    if a in adjacency and b in all_addrs:
                        adjacency[a][b] = adjacency[a].get(b, 0) + 1
                    if b in adjacency and a in all_addrs:
                        adjacency[b][a] = adjacency[b].get(a, 0) + 1

        # --- 2. Generate grid cells ---
        usable_x0 = margin
        usable_y0 = margin
        usable_w = max(1.0, board.width - 2 * margin)
        usable_h = max(1.0, board.height - 2 * margin)

        n_free = len(free_addrs)
        n_cells_target = max(n_free + 1, int(n_free * 1.5))
        aspect = usable_w / usable_h if usable_h > 0 else 1.0
        cols = max(1, round(math.sqrt(n_cells_target * aspect)))
        rows = max(1, round(n_cells_target / cols))

        cell_w = usable_w / cols
        cell_h = usable_h / rows

        cells: list[tuple[float, float]] = []
        for r in range(rows):
            for c in range(cols):
                cx = usable_x0 + (c + 0.5) * cell_w
                cy = usable_y0 + (r + 0.5) * cell_h
                overlaps_fixed = False
                for addr, p in board.fixed.items():
                    if addr not in board.fixed_info:
                        continue
                    info = board.fixed_info[addr]
                    fx = p.x + info.cx_offset
                    fy = p.y + info.cy_offset
                    if (abs(cx - fx) < (info.width + cell_w) / 2 and
                            abs(cy - fy) < (info.height + cell_h) / 2):
                        overlaps_fixed = True
                        break
                if not overlaps_fixed:
                    cells.append((cx, cy))

        if not cells:
            for r in range(rows):
                for c in range(cols):
                    cx = usable_x0 + (c + 0.5) * cell_w
                    cy = usable_y0 + (r + 0.5) * cell_h
                    cells.append((cx, cy))

        # --- 3. Greedy assignment (cluster-aware order) ---
        if clusters:
            sorted_addrs = cluster_aware_sort(free_addrs, clusters,
                                               board.net_graph)
        else:
            sorted_addrs = connectivity_sort_by_net_graph(free_addrs,
                                                          board.net_graph)

        assigned: dict[str, tuple[float, float]] = {}
        used_cells: set[int] = set()

        fixed_pos: dict[str, tuple[float, float]] = {}
        for addr, p in board.fixed.items():
            fixed_pos[addr] = (p.x, p.y)

        for addr in sorted_addrs:
            info = comp_map[addr]
            best_score = float("inf")
            best_idx = -1

            for idx, (cx, cy) in enumerate(cells):
                if idx in used_cells:
                    continue

                score = 0.0

                # Connectivity pull
                for neighbor, weight in adjacency.get(addr, {}).items():
                    if neighbor in assigned:
                        nx, ny = assigned[neighbor]
                    elif neighbor in fixed_pos:
                        nx, ny = fixed_pos[neighbor]
                    else:
                        continue
                    dist = ((cx - nx) ** 2 + (cy - ny) ** 2) ** 0.5
                    score += connectivity_weight * weight * dist

                # Cluster edge affinity: strong pull toward correct anchor edge
                if addr in anchor_of and anchor_of[addr] in assigned:
                    anchor_addr = anchor_of[addr]
                    anchor_comp = comp_map.get(anchor_addr)
                    ax, ay = assigned[anchor_addr]

                    if anchor_comp and not _is_passive_addr(addr):
                        # Satellite IC: score by distance to ideal edge position
                        best_edge, _ = cluster_edge_affinity(anchor_comp, info)
                        if best_edge:
                            from placement.strategies import Placement as _P
                            ex, ey, _ = satellite_target_position(
                                _P(x=ax, y=ay, side="F"), anchor_comp,
                                info, best_edge)
                            edge_dist = ((cx - ex) ** 2 + (cy - ey) ** 2) ** 0.5
                            score += connectivity_weight * 3.0 * edge_dist
                    elif anchor_comp:
                        # Passive: pull toward satellite or anchor
                        cl = cluster_of.get(addr)
                        sat_target = None
                        if cl:
                            for sat_addr, passives in cl.satellites.items():
                                if addr in passives and sat_addr in assigned:
                                    sx, sy = assigned[sat_addr]
                                    sat_target = (sx, sy)
                                    break
                        if sat_target:
                            dist = ((cx - sat_target[0]) ** 2 +
                                    (cy - sat_target[1]) ** 2) ** 0.5
                            score += connectivity_weight * 2.0 * dist
                        else:
                            # Bypass cap: near anchor
                            dist = ((cx - ax) ** 2 + (cy - ay) ** 2) ** 0.5
                            score += connectivity_weight * 2.0 * dist

                # Group cohesion
                group = info.group
                if group:
                    group_prefix = group + "."
                    for other_addr, (ox, oy) in assigned.items():
                        if other_addr.startswith(group_prefix):
                            dist = ((cx - ox) ** 2 + (cy - oy) ** 2) ** 0.5
                            score += connectivity_weight * 0.5 * dist

                # Anti-affinity
                for rule in board.anti_affinity:
                    for other_addr, (ox, oy) in assigned.items():
                        if not rule.matches(addr, other_addr):
                            continue
                        dist = ((cx - ox) ** 2 + (cy - oy) ** 2) ** 0.5
                        if dist < rule.min_mm:
                            score += 1e6
                    for other_addr, (ox, oy) in fixed_pos.items():
                        if not rule.matches(addr, other_addr):
                            continue
                        dist = ((cx - ox) ** 2 + (cy - oy) ** 2) ** 0.5
                        if dist < rule.min_mm:
                            score += 1e6

                # Density repulsion
                if density_weight > 0:
                    dr_cost = _density_repulsion(
                        addr, cx, cy, info,
                        assigned, comp_map,
                        fixed_pos, board.fixed_info,
                        density_threshold, density_weight,
                    )
                    score += dr_cost

                # Spread force: penalize proximity to all placed components
                # Uses 1/dist so nearby components repel strongly, far ones weakly
                spread_weight = params.get("spread_weight", 2.0)
                if spread_weight > 0:
                    for ox, oy in assigned.values():
                        dist = ((cx - ox) ** 2 + (cy - oy) ** 2) ** 0.5
                        if dist < 1.0:
                            score += spread_weight * 50.0
                        else:
                            score += spread_weight / dist
                    for ox, oy in fixed_pos.values():
                        dist = ((cx - ox) ** 2 + (cy - oy) ** 2) ** 0.5
                        if dist < 1.0:
                            score += spread_weight * 50.0
                        else:
                            score += spread_weight / dist

                score += rng.uniform(0, 0.01)

                if score < best_score:
                    best_score = score
                    best_idx = idx

            if best_idx >= 0:
                used_cells.add(best_idx)
                assigned[addr] = cells[best_idx]
            else:
                assigned[addr] = (board.width / 2, board.height / 2)

        # --- 4. Choose rotations, then batch legalize ---
        rotations = {}
        all_positions = {a: Placement(x=x, y=y, side="F")
                         for a, (x, y) in assigned.items()}
        all_positions.update(board.fixed)

        if params.get("auto_rotate", False):
            for addr in sorted_addrs:
                info = comp_map[addr]
                if info.pad_sides and info.pin_count > 4 and not _is_passive_addr(addr):
                    x, y = assigned[addr]
                    rot = best_rotation_at_position(
                        info, x, y, board.net_graph, all_positions, addr)
                    if rot:
                        rotations[addr] = rot

        return board.legalize(assigned, comp_map, rotations=rotations)
