"""Placement strategy protocol, data classes, and registry.

Strategies implement PlacementStrategy.place() and receive a list of
ComponentInfo + a BoardState toolkit. They return a dict of address → Placement.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class ComponentInfo:
    """Pre-extracted component information for strategies."""
    address: str          # atopile address (stable identifier)
    width: float          # footprint bounding box mm (includes padding)
    height: float
    is_tht: bool
    pin_count: int
    nets: list[str]       # connected net names (non-power)
    cx_offset: float = 0.0  # bbox center X offset from footprint origin (mm)
    cy_offset: float = 0.0  # bbox center Y offset from footprint origin (mm)
    routing_pressure: float = 0.0  # width * height (area-based density metric)
    group: str | None = None       # first segment of atopile address


@dataclass
class Placement:
    """A component's placed position."""
    x: float              # center, mm
    y: float
    side: str             # "F" or "B"
    rotation: float = 0.0 # degrees


@dataclass
class AntiAffinityRule:
    """Keep two component groups at minimum distance from each other."""
    from_pattern: str   # address or prefix (ending with "." for prefix match)
    to_pattern: str
    min_mm: float

    def matches(self, addr_a: str, addr_b: str) -> bool:
        """True if this rule applies to the pair (a, b) in either direction."""
        return ((self._match(self.from_pattern, addr_a) and
                 self._match(self.to_pattern, addr_b)) or
                (self._match(self.from_pattern, addr_b) and
                 self._match(self.to_pattern, addr_a)))

    @staticmethod
    def _match(pattern: str, addr: str) -> bool:
        if pattern.endswith("."):
            return addr.startswith(pattern)
        if pattern.endswith("*"):
            return addr.startswith(pattern[:-1])
        return addr == pattern


class BoardState:
    """Shared mutable placement state with controlled API.

    All public methods accept/return footprint-origin coordinates.
    Bbox-center offset conversion is handled internally.
    """

    def __init__(
        self,
        width: float,
        height: float,
        fixed: dict[str, Placement],
        fixed_info: dict[str, ComponentInfo],
        net_graph: dict[str, list[str]],
        anti_affinity: list[AntiAffinityRule],
        smd_side: str = "both",
        tht_extra_clearance: float = 0.0,
        clearance: float = 0.5,
        extra_padding: float = 0.0,
    ):
        import math as _math
        self._math = _math

        from placement.helpers import CollisionTracker, find_best_side, \
            connectivity_sort_by_net_graph
        self._find_best_side = find_best_side
        self._connectivity_sort = connectivity_sort_by_net_graph

        self.width = width
        self.height = height
        self.fixed = dict(fixed)
        self.fixed_info = dict(fixed_info)
        self.net_graph = dict(net_graph)
        self.anti_affinity = list(anti_affinity)
        self.smd_side = smd_side
        self._tht_extra_clearance = tht_extra_clearance
        self._clearance = clearance
        self._extra_padding = extra_padding

        # Private collision tracker
        self._tracker = CollisionTracker(
            width, height,
            clearance=clearance,
            extra_padding=extra_padding,
            tht_extra_clearance=tht_extra_clearance,
        )

        # Register all fixed components
        for addr, p in self.fixed.items():
            if addr not in self.fixed_info:
                raise ValueError(
                    f"Fixed component '{addr}' missing from fixed_info"
                )
            info = self.fixed_info[addr]
            self._tracker.register(
                p.x + info.cx_offset, p.y + info.cy_offset,
                info.width, info.height, p.side,
                info.is_tht, label=addr,
            )

    def _to_bbox_center(self, x: float, y: float, comp: ComponentInfo):
        return x + comp.cx_offset, y + comp.cy_offset

    def _to_fp_origin(self, bx: float, by: float, comp: ComponentInfo):
        return bx - comp.cx_offset, by - comp.cy_offset

    def check_collision(self, addr: str, x: float, y: float,
                        comp: ComponentInfo, side: str) -> bool:
        """Check if position collides with anything already placed."""
        cx, cy = self._to_bbox_center(x, y, comp)
        return self._tracker.collides(cx, cy, comp.width, comp.height,
                                      side, comp.is_tht)

    def find_legal_position(self, x: float, y: float,
                            comp: ComponentInfo,
                            side: str | None = None,
                            step: float = 0.5,
                            ) -> tuple[float, float, str]:
        """Ring-search from (x,y), return nearest legal (fp_x, fp_y, side)."""
        cx, cy = self._to_bbox_center(x, y, comp)
        smd_side = side if side else self.smd_side
        result = self._find_best_side(
            self._tracker, cx, cy,
            comp.width, comp.height, comp.is_tht,
            step=step, smd_side=smd_side,
        )
        if result is None:
            return x, y, side or "F"
        bx, by, found_side = result
        fp_x, fp_y = self._to_fp_origin(bx, by, comp)
        return fp_x, fp_y, found_side

    def connectivity_target(self, addr: str,
                            placed: dict[str, Placement],
                            group: str | None = None,
                            group_weight: float = 0.5,
                            ) -> tuple[float, float]:
        """Centroid of already-placed neighbors in net_graph + same-group pull.

        When group is provided, already-placed components with the same group
        prefix are included as additional pull targets. This keeps components
        from the same atopile module physically close (e.g., DAC + its opamps
        + feedback resistors).
        """
        net_positions: list[tuple[float, float]] = []
        for _net, net_addrs in self.net_graph.items():
            if addr not in net_addrs:
                continue
            for other in net_addrs:
                if other == addr:
                    continue
                if other in placed:
                    p = placed[other]
                    net_positions.append((p.x, p.y))
                elif other in self.fixed:
                    p = self.fixed[other]
                    net_positions.append((p.x, p.y))

        group_positions: list[tuple[float, float]] = []
        if group:
            group_prefix = group + "."
            for other_addr, p in placed.items():
                if other_addr != addr and other_addr.startswith(group_prefix):
                    group_positions.append((p.x, p.y))
            for other_addr, p in self.fixed.items():
                if other_addr != addr and other_addr.startswith(group_prefix):
                    group_positions.append((p.x, p.y))

        if not net_positions and not group_positions:
            return self.width / 2, self.height / 2

        # Weighted average: net connections + group cohesion
        all_points: list[tuple[float, float, float]] = []
        for x, y in net_positions:
            all_points.append((x, y, 1.0))
        for x, y in group_positions:
            all_points.append((x, y, group_weight))

        total_w = sum(w for _, _, w in all_points)
        avg_x = sum(x * w for x, y, w in all_points) / total_w
        avg_y = sum(y * w for x, y, w in all_points) / total_w
        return avg_x, avg_y

    def anti_affinity_cost(self, addr: str, x: float, y: float,
                           placed: dict[str, Placement]) -> float:
        """Sum of anti-affinity penalties for this position."""
        cost = 0.0
        all_positions = {**placed, **self.fixed}
        for rule in self.anti_affinity:
            for other_addr, other_p in all_positions.items():
                if other_addr == addr:
                    continue
                if not rule.matches(addr, other_addr):
                    continue
                dist = self._math.hypot(x - other_p.x, y - other_p.y)
                if dist < rule.min_mm:
                    shortfall = rule.min_mm - dist
                    cost += shortfall * shortfall
        return cost

    def register_placement(self, addr: str, x: float, y: float,
                           comp: ComponentInfo, side: str) -> None:
        """Register a placed component in the collision tracker."""
        cx, cy = self._to_bbox_center(x, y, comp)
        self._tracker.register(cx, cy, comp.width, comp.height,
                               side, comp.is_tht, label=addr)

    def legalize(self, positions: dict[str, tuple[float, float]],
                 components: dict[str, ComponentInfo],
                 ) -> dict[str, Placement]:
        """Batch legalization: rough positions -> legal placements."""
        addrs = list(positions.keys())
        sorted_addrs = self._connectivity_sort(addrs, self.net_graph)

        placements: dict[str, Placement] = {}
        for addr in sorted_addrs:
            if addr not in positions or addr not in components:
                continue
            comp = components[addr]
            ox, oy = positions[addr]
            fp_x, fp_y, side = self.find_legal_position(ox, oy, comp)
            placements[addr] = Placement(x=fp_x, y=fp_y, side=side)
            self.register_placement(addr, fp_x, fp_y, comp, side)

        return placements

    def copy(self) -> "BoardState":
        """Create a copy with fresh collision tracker (fixed re-registered)."""
        return BoardState(
            width=self.width, height=self.height,
            fixed=self.fixed, fixed_info=self.fixed_info,
            net_graph=self.net_graph, anti_affinity=self.anti_affinity,
            smd_side=self.smd_side,
            tht_extra_clearance=self._tht_extra_clearance,
            clearance=self._clearance,
            extra_padding=self._extra_padding,
        )


class PlacementStrategy(Protocol):
    """Protocol for pluggable placement algorithms."""

    def place(self, components: list[ComponentInfo],
              board: BoardState, params: dict) -> dict[str, Placement]:
        """Return address → Placement for all free components."""
        ...


# DEPRECATED: Use BoardState instead. Will be removed after all strategies migrate.


# ---------------------------------------------------------------------------
# Strategy registry
# ---------------------------------------------------------------------------

_REGISTRY: dict[str, type] = {}


def register(name: str):
    """Decorator to register a strategy class by algorithm name."""
    def decorator(cls):
        _REGISTRY[name] = cls
        return cls
    return decorator


def get_strategy(name: str) -> PlacementStrategy:
    """Look up and instantiate a strategy by algorithm name."""
    if name not in _REGISTRY:
        available = ", ".join(sorted(_REGISTRY.keys()))
        raise ValueError(
            f"Unknown placement algorithm '{name}'. "
            f"Available: {available}"
        )
    return _REGISTRY[name]()


def available_strategies() -> list[str]:
    """Return sorted list of registered algorithm names."""
    return sorted(_REGISTRY.keys())
