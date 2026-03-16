"""Simulated annealing refinement placement strategy.

Generates its own constructive starting placement, then refines by
iteratively perturbing the solution with Metropolis acceptance criterion.

Move types:
  - Displace: move a random free component to a nearby position
  - Swap: exchange positions of two similarly-sized components

Cost function: HPWL (estimated wirelength) + anti-affinity penalty

Parameterized by:
  - initial_temp: starting temperature (higher = more exploration)
  - cooling_rate: multiplier per step (0.90-0.99)
  - seed: random seed for reproducibility
"""

import math
import random

from ..helpers import (
    estimate_hpwl,
)
from . import BoardState, ComponentInfo, Placement, register
from .constructive import ConstructiveStrategy


def _initial_constructive(board, comp_map, rng):
    """Quick constructive placement as starting point for SA.

    Uses a copy of the board so registrations don't pollute the main state.
    """
    board_copy = board.copy()
    strategy = ConstructiveStrategy()
    components = list(comp_map.values())
    return strategy.place(components, board_copy, {"order": "connectivity"})


@register("sa_refine")
class SARefineStrategy:
    """Simulated annealing with displace and swap moves."""

    def place(self, components: list[ComponentInfo],
              board: BoardState, params: dict) -> dict[str, Placement]:
        initial_temp = params.get("initial_temp", 5.0)
        cooling_rate = params.get("cooling_rate", 0.95)
        seed = params.get("seed", 42)
        max_steps = params.get("max_steps", 2000)

        rng = random.Random(seed)
        comp_map = {c.address: c for c in components}
        free_addrs = list(comp_map.keys())
        if not free_addrs:
            return {}

        # Generate initial constructive placement
        placements = _initial_constructive(board, comp_map, rng)

        # Merge fixed + free placements for cost calculation
        all_placements = dict(board.fixed)
        all_placements.update(placements)
        current_cost = self._total_cost(all_placements, board)

        temperature = initial_temp

        for step in range(max_steps):
            if temperature < 0.01:
                break

            # Choose move type
            if len(free_addrs) >= 2 and rng.random() < 0.3:
                result = self._try_swap(
                    board, comp_map, placements, free_addrs, rng, temperature,
                )
            else:
                result = self._try_displace(
                    board, comp_map, placements, free_addrs, rng, temperature,
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
    def _total_cost(all_placements, board):
        """HPWL + anti-affinity penalty."""
        cost = estimate_hpwl(all_placements, board.net_graph)
        if board.anti_affinity:
            for addr, p in all_placements.items():
                cost += board.anti_affinity_cost(addr, p.x, p.y,
                                                 all_placements)
        return cost

    def _try_displace(self, board, comp_map, placements, free_addrs,
                      rng, temperature):
        """Try moving a random component to a nearby position."""
        addr = rng.choice(free_addrs)
        info = comp_map[addr]
        old_p = placements[addr]

        # Search radius scales with temperature
        radius = max(1.0, temperature * 5.0)
        new_x = old_p.x + rng.uniform(-radius, radius)
        new_y = old_p.y + rng.uniform(-radius, radius)
        new_x = max(info.width / 2, min(board.width - info.width / 2, new_x))
        new_y = max(info.height / 2, min(board.height - info.height / 2, new_y))

        # Check collision using a temporary board (without this component)
        # We need to rebuild a tracker without this component, so use board.copy()
        temp_board = board.copy()
        # Register all other placements
        new_placements = dict(placements)
        del new_placements[addr]
        for a, p in new_placements.items():
            c = comp_map[a]
            temp_board.register_placement(a, p.x, p.y, c, p.side)

        # Try allowed sides
        allowed = [old_p.side]
        other = "F" if old_p.side == "B" else "B"
        if board.smd_side == "both" or board.smd_side == other:
            allowed.append(other)
        for side in allowed:
            if not temp_board.check_collision(addr, new_x, new_y, info, side):
                new_p = Placement(x=new_x, y=new_y, side=side)
                new_placements[addr] = new_p
                all_p = dict(board.fixed)
                all_p.update(new_placements)
                new_cost = self._total_cost(all_p, board)
                return new_placements, new_cost

        return None

    def _try_swap(self, board, comp_map, placements, free_addrs,
                  rng, temperature):
        """Try swapping positions of two similarly-sized components."""
        addr_a = rng.choice(free_addrs)
        info_a = comp_map[addr_a]
        area_a = info_a.width * info_a.height

        # Find candidates with similar footprint size (within 2x)
        candidates = [
            a for a in free_addrs
            if a != addr_a and 0.5 <= (comp_map[a].width * comp_map[a].height)
            / max(area_a, 0.1) <= 2.0
        ]
        if not candidates:
            return None

        addr_b = rng.choice(candidates)
        info_b = comp_map[addr_b]
        p_a = placements[addr_a]
        p_b = placements[addr_b]

        # Check if swap is collision-free using a temporary board
        temp_board = board.copy()
        new_placements = dict(placements)
        del new_placements[addr_a]
        del new_placements[addr_b]
        for a, p in new_placements.items():
            c = comp_map[a]
            temp_board.register_placement(a, p.x, p.y, c, p.side)

        # Place A at B's position
        if temp_board.check_collision(addr_a, p_b.x, p_b.y, info_a, p_b.side):
            return None
        temp_board.register_placement(addr_a, p_b.x, p_b.y, info_a, p_b.side)

        # Place B at A's position
        if temp_board.check_collision(addr_b, p_a.x, p_a.y, info_b, p_a.side):
            return None

        new_placements[addr_a] = Placement(x=p_b.x, y=p_b.y, side=p_b.side)
        new_placements[addr_b] = Placement(x=p_a.x, y=p_a.y, side=p_a.side)

        all_p = dict(board.fixed)
        all_p.update(new_placements)
        new_cost = self._total_cost(all_p, board)
        return new_placements, new_cost
