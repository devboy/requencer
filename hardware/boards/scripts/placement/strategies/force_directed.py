"""Force-directed placement strategy.

Models nets as springs pulling connected components together. Iterates
force equilibrium, then legalizes by snapping to collision-free positions.

Parameterized by:
  - attraction: spring constant for net connectivity pull
  - repulsion: push strength for overlap prevention
  - iterations: simulation steps
"""

import random

from ..helpers import (
    CollisionTracker,
    connectivity_sort_by_net_graph,
    find_best_side,
)
from . import BoardContext, Placement, register


@register("force_directed")
class ForceDirectedStrategy:
    """Spring-based simultaneous optimization + legalization."""

    def place(self, ctx: BoardContext, params: dict) -> dict[str, Placement]:
        attraction = params.get("attraction", 1.0)
        repulsion_strength = params.get("repulsion", 0.5)
        iterations = params.get("iterations", 200)
        seed = params.get("seed", 42)

        rng = random.Random(seed)
        free_addrs = list(ctx.free.keys())
        if not free_addrs:
            return {}

        # Build adjacency from net_graph for force computation
        adjacency: dict[str, dict[str, int]] = {}
        for addr in free_addrs:
            adjacency[addr] = {}
        for addr in ctx.fixed:
            adjacency[addr] = {}
        for net, net_addrs in ctx.net_graph.items():
            for i in range(len(net_addrs)):
                for j in range(i + 1, len(net_addrs)):
                    a, b = net_addrs[i], net_addrs[j]
                    if a in adjacency:
                        adjacency[a][b] = adjacency[a].get(b, 0) + 1
                    if b in adjacency:
                        adjacency[b][a] = adjacency[b].get(a, 0) + 1

        # Initialize: place free components at centroid of fixed neighbors
        # with small random jitter to prevent clustering
        positions: dict[str, tuple[float, float]] = {}
        for addr in free_addrs:
            neighbors = adjacency.get(addr, {})
            fixed_positions = []
            for n in neighbors:
                if n in ctx.fixed:
                    p = ctx.fixed[n]
                    fixed_positions.append((p.x, p.y))
            if fixed_positions:
                cx = sum(p[0] for p in fixed_positions) / len(fixed_positions)
                cy = sum(p[1] for p in fixed_positions) / len(fixed_positions)
            else:
                cx, cy = ctx.width / 2, ctx.height / 2
            # Add jitter to prevent identical starting positions
            jx = rng.uniform(-2.0, 2.0)
            jy = rng.uniform(-2.0, 2.0)
            positions[addr] = (
                max(0, min(ctx.width, cx + jx)),
                max(0, min(ctx.height, cy + jy)),
            )

        # Force simulation
        for iteration in range(iterations):
            # Temperature decreases over time (large moves early, small late)
            temp = 1.0 - iteration / iterations
            max_displacement = max(0.5, 10.0 * temp)

            forces: dict[str, tuple[float, float]] = {
                addr: (0.0, 0.0) for addr in free_addrs
            }

            # Attraction: pull connected components together
            for addr in free_addrs:
                ax, ay = positions[addr]
                fx, fy = 0.0, 0.0

                for neighbor, weight in adjacency.get(addr, {}).items():
                    if neighbor in positions:
                        nx, ny = positions[neighbor]
                    elif neighbor in ctx.fixed:
                        p = ctx.fixed[neighbor]
                        nx, ny = p.x, p.y
                    else:
                        continue

                    dx = nx - ax
                    dy = ny - ay
                    dist = (dx * dx + dy * dy) ** 0.5
                    if dist > 0.1:
                        # Spring force proportional to distance and weight
                        f = attraction * weight * dist * 0.01
                        fx += (dx / dist) * f
                        fy += (dy / dist) * f

                forces[addr] = (fx, fy)

            # Repulsion: push apart overlapping components
            addr_list = free_addrs
            for i in range(len(addr_list)):
                ax, ay = positions[addr_list[i]]
                info_a = ctx.free[addr_list[i]]

                for j in range(i + 1, len(addr_list)):
                    bx, by = positions[addr_list[j]]
                    info_b = ctx.free[addr_list[j]]

                    dx = ax - bx
                    dy = ay - by
                    dist = (dx * dx + dy * dy) ** 0.5

                    # Overlap radius: sum of half-diagonals
                    min_dist = ((info_a.width + info_b.width) / 2 +
                                (info_a.height + info_b.height) / 2) * 0.5

                    if dist < min_dist and dist > 0.01:
                        f = repulsion_strength * (min_dist - dist) / min_dist
                        nx, ny = dx / dist, dy / dist
                        fa = forces[addr_list[i]]
                        fb = forces[addr_list[j]]
                        forces[addr_list[i]] = (fa[0] + nx * f, fa[1] + ny * f)
                        forces[addr_list[j]] = (fb[0] - nx * f, fb[1] - ny * f)

            # Anti-affinity: strong repulsion between constrained pairs
            for rule in ctx.anti_affinity:
                # Check free-free pairs
                for i in range(len(addr_list)):
                    for j in range(i + 1, len(addr_list)):
                        a, b = addr_list[i], addr_list[j]
                        if not rule.matches(a, b):
                            continue
                        ax, ay = positions[a]
                        bx, by = positions[b]
                        dx = ax - bx
                        dy = ay - by
                        dist = (dx * dx + dy * dy) ** 0.5
                        if dist < rule.min_mm and dist > 0.01:
                            f = repulsion_strength * 5.0 * (rule.min_mm - dist) / rule.min_mm
                            nx, ny = dx / dist, dy / dist
                            fa = forces[a]
                            fb = forces[b]
                            forces[a] = (fa[0] + nx * f, fa[1] + ny * f)
                            forces[b] = (fb[0] - nx * f, fb[1] - ny * f)
                # Check free-fixed pairs (only push the free component)
                for addr in free_addrs:
                    for faddr, fp in ctx.fixed.items():
                        if not rule.matches(addr, faddr):
                            continue
                        ax, ay = positions[addr]
                        dx = ax - fp.x
                        dy = ay - fp.y
                        dist = (dx * dx + dy * dy) ** 0.5
                        if dist < rule.min_mm and dist > 0.01:
                            f = repulsion_strength * 5.0 * (rule.min_mm - dist) / rule.min_mm
                            nx, ny = dx / dist, dy / dist
                            fa = forces[addr]
                            forces[addr] = (fa[0] + nx * f, fa[1] + ny * f)

            # Apply forces with displacement cap
            for addr in free_addrs:
                fx, fy = forces[addr]
                mag = (fx * fx + fy * fy) ** 0.5
                if mag > max_displacement:
                    fx = fx / mag * max_displacement
                    fy = fy / mag * max_displacement

                ox, oy = positions[addr]
                nx = max(0, min(ctx.width, ox + fx))
                ny = max(0, min(ctx.height, oy + fy))
                positions[addr] = (nx, ny)

        # Legalization: snap to collision-free positions
        tht_extra = ctx.config.get("tht_extra_clearance_mm", 0.0)
        tracker = CollisionTracker(ctx.width, ctx.height, clearance=0.5,
                                   tht_extra_clearance=tht_extra)

        # Register fixed components at bbox center
        for addr, p in ctx.fixed.items():
            if addr not in ctx.fixed_info:
                raise ValueError(
                    f"Fixed component '{addr}' missing from fixed_info"
                )
            info = ctx.fixed_info[addr]
            tracker.register(p.x + info.cx_offset, p.y + info.cy_offset,
                             info.width, info.height, p.side,
                             info.is_tht, label=addr)

        # Legalize in connectivity order (most connected first)
        legal_order = connectivity_sort_by_net_graph(free_addrs,
                                                      ctx.net_graph)

        placements = {}
        for addr in legal_order:
            info = ctx.free[addr]
            ox, oy = positions[addr]

            # Search at bbox center
            search_cx = ox + info.cx_offset
            search_cy = oy + info.cy_offset

            result = find_best_side(
                tracker, search_cx, search_cy,
                info.width, info.height, info.is_tht,
            )
            if result is None:
                continue  # can't place — validation will catch it

            # Convert back to footprint origin
            bx, by, side = result
            fp_x = bx - info.cx_offset
            fp_y = by - info.cy_offset
            placements[addr] = Placement(x=fp_x, y=fp_y, side=side)
            tracker.register(bx, by, info.width, info.height, side,
                             info.is_tht, label=addr)

        return placements
