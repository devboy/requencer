"""Constructive placement strategy.

Places components one at a time, choosing position via expanding ring search
from a target position (centroid of connected placed components).

When clusters are provided (via params["clusters"]), uses cluster-aware
ordering: anchors first, then satellites near the correct anchor edge,
then passives near their satellite. Each component tries all 4 rotations
and picks the one that minimizes wirelength.

Parameterized by:
  - order: "connectivity" | "size" | "module_grouped" | "cluster"
  - padding: extra clearance (mm) added to collision checks
  - clusters: list[Cluster] (optional, injected by orchestrator)
"""

import math
from collections import defaultdict

from ..helpers import (
    cluster_aware_sort,
    cluster_edge_affinity,
    connectivity_sort_by_net_graph,
    best_rotation_at_position,
    satellite_target_position,
    size_sort_by_info,
)
from . import BoardState, ComponentInfo, Placement, register, rotated_info


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
        clusters = params.get("clusters", [])

        comp_map = {c.address: c for c in components}
        free_addrs = list(comp_map.keys())
        if not free_addrs:
            return {}

        # Build lookup structures for cluster-aware placement
        anchor_of = {}    # satellite_addr → anchor_addr
        cluster_of = {}   # addr → Cluster
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

        # Determine placement order
        if clusters and order in ("connectivity", "cluster"):
            free_addrs = cluster_aware_sort(free_addrs, clusters,
                                            board.net_graph)
        elif order == "connectivity":
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

            # --- Determine target position ---
            tx, ty = board.connectivity_target(addr, placements,
                                               group=info.group)

            # Cluster-aware targeting: bias toward anchor edge
            if addr in anchor_of and anchor_of[addr] in placements:
                anchor_addr = anchor_of[addr]
                anchor_pos = placements[anchor_addr]
                anchor_comp = comp_map.get(anchor_addr)

                if anchor_comp and not _is_passive_addr(addr):
                    # Satellite IC: target the correct anchor edge
                    best_edge, _ = cluster_edge_affinity(anchor_comp, info)
                    if best_edge:
                        ex, ey, _ = satellite_target_position(
                            anchor_pos, anchor_comp, info, best_edge)
                        # Blend: 70% edge target, 30% connectivity target
                        tx = tx * 0.3 + ex * 0.7
                        ty = ty * 0.3 + ey * 0.7
                elif anchor_comp:
                    # Passive: target near its satellite or anchor
                    # Find the satellite this passive belongs to
                    cl = cluster_of.get(addr)
                    if cl:
                        for sat_addr, passives in cl.satellites.items():
                            if addr in passives and sat_addr in placements:
                                sat_pos = placements[sat_addr]
                                # Target between satellite and anchor,
                                # biased toward satellite
                                tx = sat_pos.x * 0.7 + anchor_pos.x * 0.3
                                ty = sat_pos.y * 0.7 + anchor_pos.y * 0.3
                                break
                        else:
                            # Bypass cap: near anchor
                            tx = anchor_pos.x + 2.0
                            ty = anchor_pos.y + 2.0

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
                            dx = board.width / 2 - other_p.x
                            dy = board.height / 2 - other_p.y
                            dist = math.hypot(dx, dy)
                            if dist < 0.01:
                                dx, dy, dist = 1.0, 0.0, 1.0
                        aa_dx += (dx / dist) * rule.min_mm
                        aa_dy += (dy / dist) * rule.min_mm
                tx = max(0, min(board.width, tx + aa_dx))
                ty = max(0, min(board.height, ty + aa_dy))

            # --- Choose rotation (disabled by default) ---
            rotation = 0.0
            if (params.get("auto_rotate", False)
                    and info.pad_sides and info.pin_count > 4
                    and not _is_passive_addr(addr)):
                all_positions = {**placements, **board.fixed}
                rotation = best_rotation_at_position(
                    info, tx, ty, board.net_graph, all_positions, addr)

            # --- Place with rotation-aware collision ---
            p = board.place_component(addr, tx, ty, info, side=None,
                                       rotation=rotation, placed=placements)
            placements[addr] = p

        return placements


def _is_passive_addr(addr):
    """Check if address looks like a passive component (R, C, L)."""
    parts = addr.rsplit(".", 1)
    leaf = parts[-1] if len(parts) > 1 else addr
    _PASSIVE_PREFIXES = ("r_", "c_", "l_", "r.", "c.", "l.")
    return any(leaf.lower().startswith(p) for p in _PASSIVE_PREFIXES)
