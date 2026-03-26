"""PlacementContext — shared utilities provided to strategies.

Wraps collision grid + connectivity into a single interface.
Strategies receive this as their second argument.
"""

from __future__ import annotations

import math
from collections import defaultdict

from .dtypes import (
    AffinityRule, Board, BlockedZone, Cluster, Component, Net,
    PlacedComponent, Side, SidePadding,
)
from .collision import CollisionGrid, find_best_side
from .geometry import (
    center_of_rect, classify_pins_by_edge, edge_offset, effective_dims,
    effective_edge_map, effective_point, pin_world_position,
    rotated_dims, topleft_from_center, OPPOSITE_EDGE,
)
from .connectivity import (
    build_adjacency, build_circuits, build_clusters, build_net_graph,
    compute_wave_distances, connectivity_sort, estimate_hpwl,
    identify_bypass_caps,
)


class PlacementContext:
    """Precomputed helpers available to all strategies.

    Manages the collision grid, net graph, and provides high-level
    placement operations. All coordinates are bbox top-left.
    """

    def __init__(self, board: Board):
        self.board = board
        self._grid = CollisionGrid(
            board.width, board.height,
            clearance=board.clearance,
            tht_extra_clearance=board.tht_clearance,
        )

        # Index components
        self._comp_map: dict[str, Component] = {c.id: c for c in board.components}
        self._fixed_ids: set[str] = set()
        self._free_ids: set[str] = set()

        for comp in board.components:
            if comp.fixed:
                self._fixed_ids.add(comp.id)
            else:
                self._free_ids.add(comp.id)

        # Register zones
        for zone in board.zones:
            self._grid.register_zone(zone)

        # Register fixed components
        for comp in board.components:
            if comp.fixed:
                self._register_component(comp)

        # Build net graph (signal-only for placement ordering)
        self._net_graph = build_net_graph(board)
        # Build rotation net graph (includes power nets for rotation scoring)
        self._rotation_net_graph = build_net_graph(board, use_rotation_nets=True)

        # Lazy caches
        self._circuits: list[set[str]] | None = None
        self._wave_distances: tuple[dict[str, int], set[str]] | None = None
        self._clusters: list[Cluster] | None = None
        self._bypass_map: dict[str, str] | None = None
        self._bypass_config: dict[str, str] | None = None  # from board-config.json

    def _register_component(self, comp: Component,
                            x: float | None = None,
                            y: float | None = None,
                            rotation: float | None = None,
                            side: Side | None = None,
                            padding: SidePadding | None = None) -> None:
        """Register a component in the collision grid.

        Uses the component's original width/height plus per-side padding
        (pad_left/right/top/bottom) for the collision rect. Pin positions
        are always relative to the original dimensions (correct KiCad coords).
        """
        px = x if x is not None else comp.x
        py = y if y is not None else comp.y
        rot = rotation if rotation is not None else comp.rotation
        s = side if side is not None else comp.side
        is_tht = "tht" in comp.tags

        ew, eh = rotated_dims(comp.width, comp.height, rot)
        cx = px + ew / 2
        cy = py + eh / 2

        # Combine component's per-side escape padding with any extra
        # padding passed by the caller (e.g., from strategies).
        from .geometry import _rotate_padding
        total_t = comp.pad_top
        total_b = comp.pad_bottom
        total_l = comp.pad_left
        total_r = comp.pad_right

        extra = padding or comp.padding
        if extra.top or extra.bottom or extra.left or extra.right:
            total_t += extra.top
            total_b += extra.bottom
            total_l += extra.left
            total_r += extra.right

        # Rotate padding to match component rotation
        if total_t or total_b or total_l or total_r:
            pad_for_rot = SidePadding(top=total_t, bottom=total_b,
                                      left=total_l, right=total_r)
            rt, rr, rb, rl = _rotate_padding(pad_for_rot, rot)
            w = ew + rl + rr
            h = eh + rt + rb
            cx += (rr - rl) / 2
            cy += (rb - rt) / 2
            self._grid.register(cx, cy, w, h, s, is_tht, label=comp.id)
        else:
            self._grid.register(cx, cy, ew, eh, s, is_tht, label=comp.id)

    @staticmethod
    def _padded_dims(comp: Component, rotation: float
                     ) -> tuple[float, float, float, float]:
        """Return (cx_offset, cy_offset, padded_w, padded_h) for collision.

        cx_offset/cy_offset are added to the original bbox center
        to get the padded collision center.
        """
        from .geometry import _rotate_padding
        ew, eh = rotated_dims(comp.width, comp.height, rotation)
        pl, pr, pt, pb = comp.pad_left, comp.pad_right, comp.pad_top, comp.pad_bottom
        if pl or pr or pt or pb:
            pad = SidePadding(top=pt, bottom=pb, left=pl, right=pr)
            rt, rr, rb, rl = _rotate_padding(pad, rotation)
            return ((rr - rl) / 2, (rb - rt) / 2, ew + rl + rr, eh + rt + rb)
        return (0.0, 0.0, ew, eh)

    def collides(self, comp: Component, x: float, y: float,
                 side: Side, rotation: float = 0.0) -> bool:
        """Check if placing comp at (x, y) top-left would collide."""
        ew, eh = rotated_dims(comp.width, comp.height, rotation)
        dx, dy, pw, ph = self._padded_dims(comp, rotation)
        cx, cy = x + ew / 2 + dx, y + eh / 2 + dy
        is_tht = "tht" in comp.tags
        return self._grid.collides(cx, cy, pw, ph, side, is_tht)

    def in_bounds(self, comp: Component, x: float, y: float,
                  rotation: float = 0.0) -> bool:
        """Check if comp at (x, y) top-left fits within board."""
        ew, eh = rotated_dims(comp.width, comp.height, rotation)
        dx, dy, pw, ph = self._padded_dims(comp, rotation)
        cx, cy = x + ew / 2 + dx, y + eh / 2 + dy
        return self._grid.in_bounds(cx, cy, pw, ph)

    def find_free(self, comp: Component, x: float, y: float,
                  side: Side, rotation: float = 0.0,
                  bounds: tuple[float, float, float, float] | None = None,
                  step: float = 1.0) -> tuple[float, float] | None:
        """Find nearest free position for comp near (x, y) top-left.

        Returns (x, y) top-left of free position, or None.
        """
        ew, eh = rotated_dims(comp.width, comp.height, rotation)
        dx, dy, pw, ph = self._padded_dims(comp, rotation)
        cx, cy = x + ew / 2 + dx, y + eh / 2 + dy
        is_tht = "tht" in comp.tags
        result = self._grid.find_free(cx, cy, pw, ph, side, is_tht,
                                      bounds=bounds, step=step)
        if result is None:
            return None
        rcx, rcy = result
        # Convert padded center back to original bbox top-left
        return rcx - dx - ew / 2, rcy - dy - eh / 2

    def find_legal_position(self, comp: Component, x: float, y: float,
                            side: Side | None = None,
                            rotation: float = 0.0,
                            step: float = 0.5,
                            placed: dict[str, PlacedComponent] | None = None,
                            ) -> tuple[float, float, Side]:
        """Find nearest legal (collision + anti-affinity free) position.

        Returns (x, y, side) where x, y are bbox top-left.
        """
        ew, eh = rotated_dims(comp.width, comp.height, rotation)
        dx, dy, pw, ph = self._padded_dims(comp, rotation)
        cx, cy = x + ew / 2 + dx, y + eh / 2 + dy
        is_tht = "tht" in comp.tags

        smd_side = side.value if side else self.board.smd_side

        result = find_best_side(
            self._grid, cx, cy, pw, ph, is_tht,
            step=step, smd_side=smd_side)

        if result is None:
            import sys
            print(f"  WARNING: no collision-free position for {comp.id} at "
                  f"({x:.1f},{y:.1f}) dims={ew:.1f}x{eh:.1f}",
                  file=sys.stderr)
            found_side = side or Side.FRONT
            return x, y, found_side

        rcx, rcy, found_side = result
        # Convert padded center back to original bbox top-left
        fx, fy = rcx - dx - ew / 2, rcy - dy - eh / 2

        # Check anti-affinity
        if placed is not None and self.board.affinity_rules:
            aa_cost = self.anti_affinity_cost(comp.id, fx, fy, placed)
            if aa_cost > 0:
                # Expanding search for anti-affinity-free position
                max_radius = max(self.board.width, self.board.height)
                max_rings = int(max_radius / step) + 1
                best = None
                best_dist = float('inf')
                for ring in range(1, max_rings + 1):
                    d = ring * step
                    for i in range(-ring, ring + 1):
                        for cand_cx, cand_cy in [
                            (cx + d, cy + i * step),
                            (cx - d, cy + i * step),
                            (cx + i * step, cy + d),
                            (cx + i * step, cy - d),
                        ]:
                            if not self._grid.in_bounds(cand_cx, cand_cy, pw, ph):
                                continue
                            if self._grid.collides(cand_cx, cand_cy, pw, ph,
                                                   found_side, is_tht):
                                continue
                            cand_x = cand_cx - dx - ew / 2
                            cand_y = cand_cy - dy - eh / 2
                            if self.anti_affinity_cost(comp.id, cand_x, cand_y,
                                                      placed) > 0:
                                continue
                            dist = abs(cand_cx - cx) + abs(cand_cy - cy)
                            if dist < best_dist:
                                best = (cand_x, cand_y, found_side)
                                best_dist = dist
                    if best is not None:
                        return best
                # Fallback: return original (anti-affinity violated but collision-free)

        return fx, fy, found_side

    def register(self, comp: Component, x: float, y: float,
                 side: Side, rotation: float = 0.0,
                 padding: SidePadding | None = None) -> None:
        """Register a placed component in the collision grid."""
        self._register_component(comp, x=x, y=y, rotation=rotation,
                                 side=side, padding=padding)

    def unregister(self, component_id: str) -> None:
        """Remove a component from the collision grid."""
        self._grid.unregister(component_id)

    def place_component(self, comp: Component, x: float, y: float,
                        side: Side | None = None,
                        rotation: float = 0.0,
                        placed: dict[str, PlacedComponent] | None = None,
                        padding: SidePadding | None = None,
                        ) -> PlacedComponent:
        """Find legal position, register, and return PlacedComponent.

        x, y are bbox top-left coordinates.
        """
        fx, fy, found_side = self.find_legal_position(
            comp, x, y, side=side, rotation=rotation, placed=placed)
        self.register(comp, fx, fy, found_side, rotation=rotation,
                      padding=padding)
        return PlacedComponent(
            component_id=comp.id,
            x=fx, y=fy,
            rotation=rotation,
            side=found_side,
        )

    def place_component_at_center(self, comp: Component,
                                  cx: float, cy: float,
                                  side: Side | None = None,
                                  rotation: float = 0.0,
                                  placed: dict[str, PlacedComponent] | None = None,
                                  padding: SidePadding | None = None,
                                  ) -> PlacedComponent:
        """Place component with (cx, cy) as target center position.

        Grid points and connectivity targets are naturally center-based.
        This converts to top-left before delegating to place_component.
        """
        ew, eh = rotated_dims(comp.width, comp.height, rotation)
        tl_x = cx - ew / 2
        tl_y = cy - eh / 2
        return self.place_component(comp, tl_x, tl_y, side=side,
                                    rotation=rotation, placed=placed,
                                    padding=padding)

    def connectivity_target(self, comp_id: str,
                            placed: dict[str, PlacedComponent],
                            group_weight: float = 0.5,
                            ) -> tuple[float, float]:
        """Centroid of placed neighbors + same-group pull.

        Returns (cx, cy) — the target center position. Computes centroid
        of neighbor centers (not top-lefts) so targets are size-independent.
        """
        comp = self._comp_map.get(comp_id)
        group = comp.group if comp else None

        net_positions: list[tuple[float, float]] = []
        for net_id, net_addrs in self._net_graph.items():
            if comp_id not in net_addrs:
                continue
            for other in net_addrs:
                if other == comp_id:
                    continue
                pos = self._get_center(other, placed)
                if pos is not None:
                    net_positions.append(pos)

        group_positions: list[tuple[float, float]] = []
        if group:
            group_prefix = group + "."
            for other_id, p in placed.items():
                if other_id != comp_id and other_id.startswith(group_prefix):
                    other_comp = self._comp_map.get(other_id)
                    if other_comp:
                        ew, eh = rotated_dims(other_comp.width, other_comp.height, p.rotation)
                        group_positions.append((p.x + ew / 2, p.y + eh / 2))
            for other_id in self._fixed_ids:
                other_comp = self._comp_map.get(other_id)
                if (other_comp and other_id != comp_id and
                        other_id.startswith(group_prefix)):
                    ew, eh = rotated_dims(other_comp.width, other_comp.height,
                                          other_comp.rotation)
                    group_positions.append((other_comp.x + ew / 2,
                                           other_comp.y + eh / 2))

        if not net_positions and not group_positions:
            return self.board.width / 2, self.board.height / 2

        all_points: list[tuple[float, float, float]] = []
        for x, y in net_positions:
            all_points.append((x, y, 1.0))
        for x, y in group_positions:
            all_points.append((x, y, group_weight))

        total_w = sum(w for _, _, w in all_points)
        avg_x = sum(x * w for x, y, w in all_points) / total_w
        avg_y = sum(y * w for x, y, w in all_points) / total_w
        return avg_x, avg_y

    def _get_position(self, comp_id: str,
                      placed: dict[str, PlacedComponent]
                      ) -> tuple[float, float] | None:
        """Get top-left position of a component (from placed dict or fixed)."""
        p = placed.get(comp_id)
        if p is not None:
            return p.x, p.y
        comp = self._comp_map.get(comp_id)
        if comp is not None and comp.fixed:
            return comp.x, comp.y
        return None

    def _get_center(self, comp_id: str,
                    placed: dict[str, PlacedComponent]
                    ) -> tuple[float, float] | None:
        """Get center position of a component (from placed dict or fixed)."""
        comp = self._comp_map.get(comp_id)
        if comp is None:
            return None
        p = placed.get(comp_id)
        if p is not None:
            ew, eh = rotated_dims(comp.width, comp.height, p.rotation)
            return p.x + ew / 2, p.y + eh / 2
        if comp.fixed:
            ew, eh = rotated_dims(comp.width, comp.height, comp.rotation)
            return comp.x + ew / 2, comp.y + eh / 2
        return None

    def anti_affinity_cost(self, comp_id: str, x: float, y: float,
                           placed: dict[str, PlacedComponent]) -> float:
        """Sum of anti-affinity penalties for this position."""
        cost = 0.0
        for rule in self.board.affinity_rules:
            # Check against placed components
            for other_id, p in placed.items():
                if other_id == comp_id:
                    continue
                if not rule.matches(comp_id, other_id):
                    continue
                dist = math.hypot(x - p.x, y - p.y)
                if dist < rule.min_distance_mm:
                    shortfall = rule.min_distance_mm - dist
                    cost += shortfall * shortfall
            # Check against fixed components
            for other_id in self._fixed_ids:
                if other_id == comp_id:
                    continue
                if not rule.matches(comp_id, other_id):
                    continue
                other_comp = self._comp_map[other_id]
                dist = math.hypot(x - other_comp.x, y - other_comp.y)
                if dist < rule.min_distance_mm:
                    shortfall = rule.min_distance_mm - dist
                    cost += shortfall * shortfall
        return cost

    def net_graph(self) -> dict[str, list[str]]:
        """Return the net graph: net_id → [component_ids]."""
        return self._net_graph

    def rotation_net_graph(self) -> dict[str, list[str]]:
        """Return the rotation net graph (includes power nets)."""
        return self._rotation_net_graph

    def wave_distances(self) -> tuple[dict[str, int], set[str]]:
        """Return (wave_map, orphans) from BFS on fixed components."""
        if self._wave_distances is None:
            self._wave_distances = compute_wave_distances(
                self._net_graph, self._fixed_ids, self._free_ids)
        return self._wave_distances

    def circuits(self) -> list[set[str]]:
        """Return connected components in the net graph."""
        if self._circuits is None:
            all_ids = self._fixed_ids | self._free_ids
            self._circuits = build_circuits(self._net_graph, all_ids)
        return self._circuits

    def clusters(self) -> list[Cluster]:
        """Return hierarchical component clusters."""
        if self._clusters is None:
            free_comps = {cid: self._comp_map[cid] for cid in self._free_ids}
            self._clusters = build_clusters(free_comps, self._net_graph)
        return self._clusters

    def set_bypass_config(self, config_map: dict[str, str]) -> None:
        """Set explicit bypass cap mapping from board-config.json."""
        self._bypass_config = config_map
        self._bypass_map = None  # invalidate cache

    def bypass_map(self) -> dict[str, str]:
        """Return bypass cap → associated IC mapping."""
        if self._bypass_map is None:
            self._bypass_map = identify_bypass_caps(
                self.board, config_map=self._bypass_config)
        return self._bypass_map

    def largest_free_rects(self, side: Side,
                           count: int = 5
                           ) -> list[tuple[float, float, float, float]]:
        """Find largest empty rectangles on the given side."""
        return self._grid.find_largest_free_rects(side, count=count)

    def get_component(self, comp_id: str) -> Component | None:
        """Look up a component by ID."""
        return self._comp_map.get(comp_id)

    def free_components(self) -> list[Component]:
        """Return all non-fixed components."""
        return [self._comp_map[cid] for cid in self._free_ids
                if cid in self._comp_map]

    def fixed_components(self) -> list[Component]:
        """Return all fixed components."""
        return [self._comp_map[cid] for cid in self._fixed_ids
                if cid in self._comp_map]

    def legalize(self, positions: dict[str, tuple[float, float]],
                 rotations: dict[str, float] | None = None,
                 ) -> dict[str, PlacedComponent]:
        """Batch legalization: rough positions → legal placements.

        Places in connectivity-sorted order.
        """
        addrs = list(positions.keys())
        sorted_addrs = connectivity_sort(addrs, self._net_graph)
        rots = rotations or {}

        placements: dict[str, PlacedComponent] = {}
        for comp_id in sorted_addrs:
            if comp_id not in positions or comp_id not in self._comp_map:
                continue
            comp = self._comp_map[comp_id]
            rot = rots.get(comp_id, 0.0)
            ox, oy = positions[comp_id]
            p = self.place_component(comp, ox, oy, rotation=rot,
                                     placed=placements)
            placements[comp_id] = p

        return placements

    def copy(self) -> PlacementContext:
        """Create a fresh copy with re-registered fixed components."""
        return PlacementContext(self.board)

    def reset(self) -> None:
        """Reset to initial state (only fixed components registered)."""
        new_ctx = PlacementContext(self.board)
        self._grid = new_ctx._grid
        self._circuits = None
        self._wave_distances = None
        self._clusters = None
        self._bypass_map = None
