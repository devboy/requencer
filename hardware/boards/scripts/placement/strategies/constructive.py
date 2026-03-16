"""Constructive placement strategy.

Places components one at a time, choosing position via expanding ring search
from a target position (centroid of connected placed components).

Parameterized by:
  - order: "connectivity" | "size" | "module_grouped"
  - padding: extra clearance (mm) added to collision checks
"""

import math
from collections import defaultdict

from ..helpers import (
    connectivity_sort_by_net_graph,
    size_sort_by_info,
)
from . import BoardState, ComponentInfo, Placement, register


def _module_grouped_sort(addrs, components, net_graph):
    """Group by module prefix (first dotted segment), then by connectivity."""
    groups = defaultdict(list)
    for addr in addrs:
        prefix = addr.split(".")[0] if "." in addr else "_root"
        groups[prefix].append(addr)

    # Sort groups by size (largest first), then sort within each group
    ordered = []
    for prefix in sorted(groups, key=lambda k: len(groups[k]), reverse=True):
        group = groups[prefix]
        ordered.extend(connectivity_sort_by_net_graph(group, net_graph))
    return ordered


@register("constructive")
class ConstructiveStrategy:
    """Greedy one-at-a-time placement with expanding ring search."""

    def place(self, components: list[ComponentInfo],
              board: BoardState, params: dict) -> dict[str, Placement]:
        order = params.get("order", "connectivity")

        comp_map = {c.address: c for c in components}
        free_addrs = list(comp_map.keys())
        if not free_addrs:
            return {}

        # Determine placement order
        if order == "connectivity":
            free_addrs = connectivity_sort_by_net_graph(free_addrs,
                                                        board.net_graph)
        elif order == "size":
            free_addrs = size_sort_by_info(free_addrs, comp_map)
        elif order == "module_grouped":
            free_addrs = _module_grouped_sort(free_addrs, comp_map,
                                              board.net_graph)

        placements = {}

        for addr in free_addrs:
            info = comp_map[addr]

            # Target: centroid of placed connected neighbors + same-group pull
            tx, ty = board.connectivity_target(addr, placements,
                                               group=info.group)

            # Push target away from anti-affinity violators
            if board.anti_affinity:
                aa_dx, aa_dy = 0.0, 0.0
                all_placed = {**placements, **board.fixed}
                for rule in board.anti_affinity:
                    for other_addr, other_p in all_placed.items():
                        if other_addr == addr:
                            continue
                        if not rule.matches(addr, other_addr):
                            continue
                        dx = tx - other_p.x
                        dy = ty - other_p.y
                        dist = math.hypot(dx, dy)
                        if dist >= rule.min_mm:
                            continue
                        if dist < 0.01:
                            # On top of partner — push toward board center
                            dx = board.width / 2 - other_p.x
                            dy = board.height / 2 - other_p.y
                            dist = math.hypot(dx, dy)
                            if dist < 0.01:
                                dx, dy, dist = 1.0, 0.0, 1.0
                        # Push away by full min_mm distance
                        aa_dx += (dx / dist) * rule.min_mm
                        aa_dy += (dy / dist) * rule.min_mm
                tx = max(0, min(board.width, tx + aa_dx))
                ty = max(0, min(board.height, ty + aa_dy))

            fp_x, fp_y, side = board.find_legal_position(tx, ty, info)
            placements[addr] = Placement(x=fp_x, y=fp_y, side=side)
            board.register_placement(addr, fp_x, fp_y, info, side)

        return placements
