"""Force-directed placement strategy.

Models nets as springs pulling connected components together. Iterates
force equilibrium, then legalizes by snapping to collision-free positions.

Parameterized by:
  - attraction: spring constant for net connectivity pull
  - repulsion: push strength for overlap prevention
  - iterations: simulation steps
"""

import random

from . import BoardState, ComponentInfo, Placement, register


@register("force_directed")
class ForceDirectedStrategy:
    """Spring-based simultaneous optimization + legalization."""

    def place(self, components: list[ComponentInfo],
              board: BoardState, params: dict) -> dict[str, Placement]:
        attraction = params.get("attraction", 1.0)
        repulsion_strength = params.get("repulsion", 0.5)
        iterations = params.get("iterations", 200)
        seed = params.get("seed", 42)

        rng = random.Random(seed)
        comp_map = {c.address: c for c in components}
        free_addrs = list(comp_map.keys())
        if not free_addrs:
            return {}

        # Build adjacency from net_graph for force computation
        adjacency: dict[str, dict[str, int]] = {}
        for addr in free_addrs:
            adjacency[addr] = {}
        for addr in board.fixed:
            adjacency[addr] = {}
        for net, net_addrs in board.net_graph.items():
            for i in range(len(net_addrs)):
                for j in range(i + 1, len(net_addrs)):
                    a, b = net_addrs[i], net_addrs[j]
                    if a in adjacency:
                        adjacency[a][b] = adjacency[a].get(b, 0) + 1
                    if b in adjacency:
                        adjacency[b][a] = adjacency[b].get(a, 0) + 1

        # Initialize: use connectivity_target for initial positions with jitter
        positions: dict[str, tuple[float, float]] = {}
        placed_so_far: dict[str, Placement] = {}
        for addr in free_addrs:
            cx, cy = board.connectivity_target(addr, placed_so_far,
                                                  group=comp_map[addr].group)
            jx = rng.uniform(-2.0, 2.0)
            jy = rng.uniform(-2.0, 2.0)
            positions[addr] = (
                max(0, min(board.width, cx + jx)),
                max(0, min(board.height, cy + jy)),
            )

        # Force simulation
        for iteration in range(iterations):
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
                    elif neighbor in board.fixed:
                        p = board.fixed[neighbor]
                        nx, ny = p.x, p.y
                    else:
                        continue

                    dx = nx - ax
                    dy = ny - ay
                    dist = (dx * dx + dy * dy) ** 0.5
                    if dist > 0.1:
                        f = attraction * weight * dist * 0.01
                        fx += (dx / dist) * f
                        fy += (dy / dist) * f

                # Group cohesion: pull toward same-group components
                group = comp_map[addr].group
                if group:
                    group_prefix = group + "."
                    for other_addr, (ox, oy) in positions.items():
                        if other_addr == addr:
                            continue
                        if not other_addr.startswith(group_prefix):
                            continue
                        dx = ox - ax
                        dy = oy - ay
                        dist = (dx * dx + dy * dy) ** 0.5
                        if dist > 0.1:
                            f = attraction * 0.5 * dist * 0.01
                            fx += (dx / dist) * f
                            fy += (dy / dist) * f

                forces[addr] = (fx, fy)

            # Repulsion: push apart overlapping components
            addr_list = free_addrs
            for i in range(len(addr_list)):
                ax, ay = positions[addr_list[i]]
                info_a = comp_map[addr_list[i]]

                for j in range(i + 1, len(addr_list)):
                    bx, by = positions[addr_list[j]]
                    info_b = comp_map[addr_list[j]]

                    dx = ax - bx
                    dy = ay - by
                    dist = (dx * dx + dy * dy) ** 0.5

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
            for rule in board.anti_affinity:
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
                    for faddr, fp in board.fixed.items():
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
                nx = max(0, min(board.width, ox + fx))
                ny = max(0, min(board.height, oy + fy))
                positions[addr] = (nx, ny)

        # Batch legalization via BoardState
        return board.legalize(positions, comp_map)
