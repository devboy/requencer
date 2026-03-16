"""Grid spread placement strategy.

Distributes components evenly across the board on a grid, then uses
connectivity scoring to assign components to cells. Gives the autorouter
maximum routing space at the cost of slightly longer traces.

Parameterized by:
  - margin: mm inset from board edges for grid generation
  - connectivity_weight: strength of pull toward connected neighbors
  - density_weight: strength of repulsion between large/dense components
  - density_threshold_mm2: area threshold above which components repel
  - seed: random seed for tie-breaking
"""

import math
import random

from ..helpers import connectivity_sort_by_net_graph
from . import BoardState, ComponentInfo, Placement, register


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
    """Repulsion penalty between dense/large components.

    Uses sqrt(area) as characteristic size. Two ICs closer than the sum
    of their characteristic sizes get a strong penalty that scales with
    the weight parameter and overwhelms connectivity pull.
    """
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

        rng = random.Random(seed)
        comp_map = {c.address: c for c in components}
        free_addrs = list(comp_map.keys())
        if not free_addrs:
            return {}

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

        # Generate cell centers, excluding those that overlap fixed components
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

        # --- 3. Greedy assignment (most-connected first) ---
        sorted_addrs = connectivity_sort_by_net_graph(free_addrs, board.net_graph)

        assigned: dict[str, tuple[float, float]] = {}
        used_cells: set[int] = set()
        board_cx, board_cy = board.width / 2, board.height / 2

        # Build fixed positions lookup for scoring
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

                # Connectivity pull: distance to placed neighbors
                for neighbor, weight in adjacency.get(addr, {}).items():
                    if neighbor in assigned:
                        nx, ny = assigned[neighbor]
                    elif neighbor in fixed_pos:
                        nx, ny = fixed_pos[neighbor]
                    else:
                        continue
                    dist = ((cx - nx) ** 2 + (cy - ny) ** 2) ** 0.5
                    score += connectivity_weight * weight * dist

                # Group cohesion: pull toward same-group components
                group = info.group
                if group:
                    group_prefix = group + "."
                    for other_addr, (ox, oy) in assigned.items():
                        if other_addr.startswith(group_prefix):
                            dist = ((cx - ox) ** 2 + (cy - oy) ** 2) ** 0.5
                            score += connectivity_weight * 0.5 * dist

                # Anti-affinity: hard constraint
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

                # Mild centering bias
                center_dist = ((cx - board_cx) ** 2 + (cy - board_cy) ** 2) ** 0.5
                score += 0.1 * center_dist

                # Small random jitter for tie-breaking
                score += rng.uniform(0, 0.01)

                if score < best_score:
                    best_score = score
                    best_idx = idx

            if best_idx >= 0:
                used_cells.add(best_idx)
                assigned[addr] = cells[best_idx]
            else:
                assigned[addr] = (board_cx, board_cy)

        # --- 4. Batch legalization via BoardState ---
        return board.legalize(assigned, comp_map)
