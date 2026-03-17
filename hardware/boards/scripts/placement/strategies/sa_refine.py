"""Simulated annealing refinement placement strategy.

Generates its own constructive starting placement (cluster-aware if clusters
are provided), then refines by iteratively perturbing the solution with
Metropolis acceptance criterion.

The cost function includes HPWL, anti-affinity penalty, and cluster cohesion
(satellites near their anchor edges).

Move types:
  - Displace: move a random free component to a nearby position
  - Swap: exchange positions of two similarly-sized components

Parameterized by:
  - initial_temp: starting temperature (higher = more exploration)
  - cooling_rate: multiplier per step (0.90-0.99)
  - seed: random seed for reproducibility
  - clusters: list[Cluster] (optional, injected by orchestrator)
"""

import math
import random

from ..helpers import (
    cluster_edge_affinity,
    estimate_hpwl,
    satellite_target_position,
)
from . import BoardState, ComponentInfo, Placement, register
from .constructive import ConstructiveStrategy


def _initial_constructive(board, comp_map, params):
    """Quick constructive placement as starting point for SA.

    Passes clusters through so the initial placement is cluster-aware.
    Uses a copy of the board so registrations don't pollute the main state.
    """
    board_copy = board.copy()
    strategy = ConstructiveStrategy()
    components = list(comp_map.values())
    init_params = {"order": "connectivity"}
    if "clusters" in params:
        init_params["clusters"] = params["clusters"]
    return strategy.place(components, board_copy, init_params)


@register("sa_refine")
class SARefineStrategy:
    """Simulated annealing with displace and swap moves."""

    def place(self, components: list[ComponentInfo],
              board: BoardState, params: dict) -> dict[str, Placement]:
        initial_temp = params.get("initial_temp", 5.0)
        cooling_rate = params.get("cooling_rate", 0.95)
        seed = params.get("seed", 42)
        max_steps = params.get("max_steps", 2000)
        clusters = params.get("clusters", [])

        rng = random.Random(seed)
        comp_map = {c.address: c for c in components}
        free_addrs = list(comp_map.keys())
        if not free_addrs:
            return {}

        # Build cluster lookup for cost function
        self._anchor_of = {}
        self._cluster_of = {}
        self._clusters = clusters
        for cl in clusters:
            self._cluster_of[cl.anchor] = cl
            for sat_addr in cl.satellites:
                self._anchor_of[sat_addr] = cl.anchor
                self._cluster_of[sat_addr] = cl
                for passive_addr in cl.satellites[sat_addr]:
                    self._anchor_of[passive_addr] = cl.anchor
                    self._cluster_of[passive_addr] = cl
            for bypass_addr in cl.bypass:
                self._anchor_of[bypass_addr] = cl.anchor
                self._cluster_of[bypass_addr] = cl

        # Generate initial constructive placement (cluster-aware)
        placements = _initial_constructive(board, comp_map, params)

        all_placements = dict(board.fixed)
        all_placements.update(placements)
        current_cost = self._total_cost(all_placements, board, comp_map)

        temperature = initial_temp

        for step in range(max_steps):
            if temperature < 0.01:
                break

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

                if delta < 0 or rng.random() < math.exp(-delta / temperature):
                    placements = new_placements
                    current_cost = new_cost

            temperature *= cooling_rate

        return placements

    def _total_cost(self, all_placements, board, comp_map):
        """HPWL + anti-affinity penalty + cluster cohesion cost."""
        cost = estimate_hpwl(all_placements, board.net_graph)

        # Anti-affinity penalty
        if board.anti_affinity:
            for addr, p in all_placements.items():
                cost += board.anti_affinity_cost(addr, p.x, p.y,
                                                 all_placements)

        # Cluster cohesion: penalize satellites far from their anchor edge
        for cl in self._clusters:
            if cl.anchor not in all_placements:
                continue
            anchor_pos = all_placements[cl.anchor]
            anchor_comp = comp_map.get(cl.anchor)
            if not anchor_comp:
                continue

            for sat_addr in cl.satellites:
                if sat_addr not in all_placements:
                    continue
                sat_comp = comp_map.get(sat_addr)
                if not sat_comp:
                    continue
                sat_pos = all_placements[sat_addr]

                best_edge, _ = cluster_edge_affinity(anchor_comp, sat_comp)
                if best_edge:
                    tx, ty, _ = satellite_target_position(
                        anchor_pos, anchor_comp, sat_comp, best_edge)
                    dist = math.hypot(sat_pos.x - tx, sat_pos.y - ty)
                    cost += dist * 0.5  # cluster cohesion weight

        return cost

    def _try_displace(self, board, comp_map, placements, free_addrs,
                      rng, temperature):
        """Try moving a random component to a nearby position."""
        addr = rng.choice(free_addrs)
        info = comp_map[addr]
        old_p = placements[addr]

        radius = max(1.0, temperature * 5.0)
        new_x = old_p.x + rng.uniform(-radius, radius)
        new_y = old_p.y + rng.uniform(-radius, radius)
        new_x = max(info.width / 2, min(board.width - info.width / 2, new_x))
        new_y = max(info.height / 2, min(board.height - info.height / 2, new_y))

        temp_board = board.copy()
        new_placements = dict(placements)
        del new_placements[addr]
        for a, p in new_placements.items():
            c = comp_map[a]
            temp_board.register_placement(a, p.x, p.y, c, p.side)

        allowed = [old_p.side]
        other = "F" if old_p.side == "B" else "B"
        if board.smd_side == "both" or board.smd_side == other:
            allowed.append(other)
        for side in allowed:
            if not temp_board.check_collision(addr, new_x, new_y, info, side):
                new_p = Placement(x=new_x, y=new_y, side=side,
                                   rotation=old_p.rotation)
                new_placements[addr] = new_p
                all_p = dict(board.fixed)
                all_p.update(new_placements)
                new_cost = self._total_cost(all_p, board, comp_map)
                return new_placements, new_cost

        return None

    def _try_swap(self, board, comp_map, placements, free_addrs,
                  rng, temperature):
        """Try swapping positions of two similarly-sized components."""
        addr_a = rng.choice(free_addrs)
        info_a = comp_map[addr_a]
        area_a = info_a.width * info_a.height

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

        temp_board = board.copy()
        new_placements = dict(placements)
        del new_placements[addr_a]
        del new_placements[addr_b]
        for a, p in new_placements.items():
            c = comp_map[a]
            temp_board.register_placement(a, p.x, p.y, c, p.side)

        if temp_board.check_collision(addr_a, p_b.x, p_b.y, info_a, p_b.side):
            return None
        temp_board.register_placement(addr_a, p_b.x, p_b.y, info_a, p_b.side)

        if temp_board.check_collision(addr_b, p_a.x, p_a.y, info_b, p_a.side):
            return None

        new_placements[addr_a] = Placement(x=p_b.x, y=p_b.y, side=p_b.side,
                                            rotation=p_a.rotation)
        new_placements[addr_b] = Placement(x=p_a.x, y=p_a.y, side=p_a.side,
                                            rotation=p_b.rotation)

        all_p = dict(board.fixed)
        all_p.update(new_placements)
        new_cost = self._total_cost(all_p, board, comp_map)
        return new_placements, new_cost
