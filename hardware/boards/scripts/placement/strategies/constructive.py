"""Constructive placement strategy.

Places components one at a time, choosing position via expanding ring search
from a target position (centroid of connected placed components).

Parameterized by:
  - order: "connectivity" | "size" | "module_grouped"
  - padding: extra clearance (mm) added to collision checks
"""

from collections import defaultdict

from ..helpers import (
    CollisionTracker,
    anti_affinity_repulsion,
    connectivity_sort_by_net_graph,
    estimate_hpwl,
    find_best_side,
    size_sort_by_info,
)
from . import BoardContext, Placement, register


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

    def place(self, ctx: BoardContext, params: dict) -> dict[str, Placement]:
        order = params.get("order", "connectivity")
        padding = params.get("padding", 1.0)

        tht_extra = ctx.config.get("tht_extra_clearance_mm", 0.0)
        tracker = CollisionTracker(
            ctx.width, ctx.height, clearance=0.5, extra_padding=padding,
            tht_extra_clearance=tht_extra,
        )

        # Register fixed components at their BBOX CENTER, not footprint origin.
        # For asymmetric parts (SIP-9, shrouded headers) the origin is pin 1,
        # not the geometric center — using origin directly causes mis-registration.
        for addr, p in ctx.fixed.items():
            if addr not in ctx.fixed_info:
                raise ValueError(
                    f"Fixed component '{addr}' missing from fixed_info"
                )
            info = ctx.fixed_info[addr]
            tracker.register(p.x + info.cx_offset, p.y + info.cy_offset,
                             info.width, info.height, p.side,
                             info.is_tht, label=addr)

        # Determine placement order
        free_addrs = list(ctx.free.keys())
        if order == "connectivity":
            free_addrs = connectivity_sort_by_net_graph(free_addrs,
                                                        ctx.net_graph)
        elif order == "size":
            free_addrs = size_sort_by_info(free_addrs, ctx.free)
        elif order == "module_grouped":
            free_addrs = _module_grouped_sort(free_addrs, ctx.free,
                                              ctx.net_graph)

        placements = {}

        for addr in free_addrs:
            info = ctx.free[addr]

            # Target: centroid of placed connected neighbors
            tx, ty = self._connectivity_target(
                addr, ctx, placements, tracker,
            )

            # Search at bbox center position (account for offset)
            search_cx = tx + info.cx_offset
            search_cy = ty + info.cy_offset

            result = find_best_side(
                tracker, search_cx, search_cy,
                info.width, info.height, info.is_tht,
            )
            if result is None:
                continue  # can't place — validation will catch it

            # Convert found bbox center back to footprint origin for placement
            bx, by, side = result
            fp_x = bx - info.cx_offset
            fp_y = by - info.cy_offset
            placements[addr] = Placement(x=fp_x, y=fp_y, side=side)
            tracker.register(bx, by, info.width, info.height, side,
                             info.is_tht, label=addr)

        return placements

    @staticmethod
    def _connectivity_target(addr, ctx, placements, tracker):
        """Compute target position as centroid of placed connected neighbors."""
        positions = []

        # Check fixed components
        for net, net_addrs in ctx.net_graph.items():
            if addr not in net_addrs:
                continue
            for other in net_addrs:
                if other == addr:
                    continue
                if other in ctx.fixed:
                    p = ctx.fixed[other]
                    positions.append((p.x, p.y))
                elif other in placements:
                    p = placements[other]
                    positions.append((p.x, p.y))

        if positions:
            cx = sum(p[0] for p in positions) / len(positions)
            cy = sum(p[1] for p in positions) / len(positions)
        else:
            cx, cy = ctx.width / 2, ctx.height / 2

        # Apply repulsion from nearby components
        rx, ry = tracker.repulsion_offset(cx, cy)
        tx = max(0, min(ctx.width, cx + rx))
        ty = max(0, min(ctx.height, cy + ry))

        # Apply anti-affinity repulsion
        if ctx.anti_affinity:
            placed_pos = {a: (p.x, p.y) for a, p in placements.items()}
            aax, aay = anti_affinity_repulsion(
                addr, tx, ty, placed_pos, ctx.fixed, ctx.anti_affinity,
                board_w=ctx.width, board_h=ctx.height,
            )
            tx = max(0, min(ctx.width, tx + aax))
            ty = max(0, min(ctx.height, ty + aay))

        return tx, ty
