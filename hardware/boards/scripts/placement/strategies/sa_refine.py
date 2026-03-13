"""Simulated annealing refinement placement strategy.

Generates its own constructive starting placement, then refines by
iteratively perturbing the solution with Metropolis acceptance criterion.

Move types:
  - Displace: move a random free component to a nearby position
  - Swap: exchange positions of two similarly-sized components

Cost function: HPWL (estimated wirelength)

Parameterized by:
  - initial_temp: starting temperature (higher = more exploration)
  - cooling_rate: multiplier per step (0.90-0.99)
  - seed: random seed for reproducibility
"""

import math
import random

from ..helpers import (
    CollisionTracker,
    anti_affinity_penalty,
    connectivity_sort_by_net_graph,
    estimate_hpwl,
    find_best_side,
)
from . import BoardContext, Placement, register


def _initial_constructive(ctx, rng):
    """Quick constructive placement as starting point for SA."""
    tracker = CollisionTracker(ctx.width, ctx.height, clearance=0.5)

    # Register fixed at bbox center
    for addr, p in ctx.fixed.items():
        if addr not in ctx.fixed_info:
            raise ValueError(
                f"Fixed component '{addr}' missing from fixed_info"
            )
        info = ctx.fixed_info[addr]
        tracker.register(p.x + info.cx_offset, p.y + info.cy_offset,
                         info.width, info.height, p.side,
                         info.is_tht, label=addr)

    free_addrs = connectivity_sort_by_net_graph(
        list(ctx.free.keys()), ctx.net_graph,
    )

    placements = {}
    for addr in free_addrs:
        info = ctx.free[addr]
        # Target: board center with jitter
        tx = ctx.width / 2 + rng.uniform(-ctx.width * 0.3, ctx.width * 0.3)
        ty = ctx.height / 2 + rng.uniform(-ctx.height * 0.3, ctx.height * 0.3)
        tx = max(0, min(ctx.width, tx))
        ty = max(0, min(ctx.height, ty))

        # Find connected placed neighbors for better initial position
        positions = []
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
            tx = sum(p[0] for p in positions) / len(positions)
            ty = sum(p[1] for p in positions) / len(positions)

        # Search at bbox center
        search_cx = tx + info.cx_offset
        search_cy = ty + info.cy_offset

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


def _rebuild_tracker(ctx, placements, fixed_info):
    """Build a fresh collision tracker from current placements + fixed."""
    tracker = CollisionTracker(ctx.width, ctx.height, clearance=0.5)
    for addr, p in ctx.fixed.items():
        info = fixed_info[addr]
        tracker.register(p.x + info.cx_offset, p.y + info.cy_offset,
                         info.width, info.height, p.side,
                         info.is_tht, label=addr)
    for addr, p in placements.items():
        info = ctx.free[addr]
        tracker.register(p.x + info.cx_offset, p.y + info.cy_offset,
                         info.width, info.height, p.side,
                         info.is_tht, label=addr)
    return tracker


@register("sa_refine")
class SARefineStrategy:
    """Simulated annealing with displace and swap moves."""

    def place(self, ctx: BoardContext, params: dict) -> dict[str, Placement]:
        initial_temp = params.get("initial_temp", 5.0)
        cooling_rate = params.get("cooling_rate", 0.95)
        seed = params.get("seed", 42)
        max_steps = params.get("max_steps", 2000)

        rng = random.Random(seed)
        free_addrs = list(ctx.free.keys())
        if not free_addrs:
            return {}

        # Generate initial constructive placement
        placements = _initial_constructive(ctx, rng)

        # Merge fixed + free placements for cost calculation
        all_placements = dict(ctx.fixed)
        all_placements.update(placements)
        current_cost = self._total_cost(all_placements, ctx)

        temperature = initial_temp

        for step in range(max_steps):
            if temperature < 0.01:
                break

            # Choose move type
            if len(free_addrs) >= 2 and rng.random() < 0.3:
                # Swap move
                result = self._try_swap(
                    ctx, placements, free_addrs, rng, temperature,
                )
            else:
                # Displace move
                result = self._try_displace(
                    ctx, placements, free_addrs, rng, temperature,
                )

            if result is not None:
                new_placements, new_cost = result
                delta = new_cost - current_cost

                # Metropolis criterion
                if delta < 0 or rng.random() < math.exp(-delta / temperature):
                    placements = new_placements
                    current_cost = new_cost

            temperature *= cooling_rate

        return placements

    @staticmethod
    def _total_cost(all_placements, ctx):
        """HPWL + anti-affinity penalty."""
        cost = estimate_hpwl(all_placements, ctx.net_graph)
        if ctx.anti_affinity:
            all_pos = {a: (p.x, p.y) for a, p in all_placements.items()}
            for addr, (x, y) in all_pos.items():
                cost += anti_affinity_penalty(addr, x, y, all_pos,
                                              ctx.anti_affinity)
        return cost

    def _try_displace(self, ctx, placements, free_addrs, rng, temperature):
        """Try moving a random component to a nearby position."""
        addr = rng.choice(free_addrs)
        info = ctx.free[addr]
        old_p = placements[addr]

        # Search radius scales with temperature
        radius = max(1.0, temperature * 5.0)
        new_x = old_p.x + rng.uniform(-radius, radius)
        new_y = old_p.y + rng.uniform(-radius, radius)
        new_x = max(info.width / 2, min(ctx.width - info.width / 2, new_x))
        new_y = max(info.height / 2, min(ctx.height - info.height / 2, new_y))

        # Check collision at bbox center (rebuild tracker without this component)
        new_placements = dict(placements)
        del new_placements[addr]
        tracker = _rebuild_tracker(ctx, new_placements, ctx.fixed_info)

        bcx = new_x + info.cx_offset
        bcy = new_y + info.cy_offset

        # Try both sides
        for side in [old_p.side, "F" if old_p.side == "B" else "B"]:
            if not tracker.collides(bcx, bcy, info.width, info.height,
                                    side, info.is_tht):
                new_p = Placement(x=new_x, y=new_y, side=side)
                new_placements[addr] = new_p
                all_p = dict(ctx.fixed)
                all_p.update(new_placements)
                new_cost = self._total_cost(all_p, ctx)
                return new_placements, new_cost

        return None

    def _try_swap(self, ctx, placements, free_addrs, rng, temperature):
        """Try swapping positions of two similarly-sized components."""
        addr_a = rng.choice(free_addrs)
        info_a = ctx.free[addr_a]
        area_a = info_a.width * info_a.height

        # Find candidates with similar footprint size (within 2x)
        candidates = [
            a for a in free_addrs
            if a != addr_a and 0.5 <= (ctx.free[a].width * ctx.free[a].height)
            / max(area_a, 0.1) <= 2.0
        ]
        if not candidates:
            return None

        addr_b = rng.choice(candidates)
        info_b = ctx.free[addr_b]
        p_a = placements[addr_a]
        p_b = placements[addr_b]

        # Check if swap is collision-free (using bbox centers)
        new_placements = dict(placements)
        del new_placements[addr_a]
        del new_placements[addr_b]
        tracker = _rebuild_tracker(ctx, new_placements, ctx.fixed_info)

        # Place A at B's position — collision at bbox center
        bcx_a = p_b.x + info_a.cx_offset
        bcy_a = p_b.y + info_a.cy_offset
        if tracker.collides(bcx_a, bcy_a, info_a.width, info_a.height,
                            p_b.side, info_a.is_tht):
            return None
        tracker.register(bcx_a, bcy_a, info_a.width, info_a.height,
                         p_b.side, info_a.is_tht, label=addr_a)

        # Place B at A's position — collision at bbox center
        bcx_b = p_a.x + info_b.cx_offset
        bcy_b = p_a.y + info_b.cy_offset
        if tracker.collides(bcx_b, bcy_b, info_b.width, info_b.height,
                            p_a.side, info_b.is_tht):
            return None

        new_placements[addr_a] = Placement(x=p_b.x, y=p_b.y, side=p_b.side)
        new_placements[addr_b] = Placement(x=p_a.x, y=p_a.y, side=p_a.side)

        all_p = dict(ctx.fixed)
        all_p.update(new_placements)
        new_cost = self._total_cost(all_p, ctx)
        return new_placements, new_cost
