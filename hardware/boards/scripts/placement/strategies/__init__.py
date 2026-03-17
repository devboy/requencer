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
    pad_sides: dict[str, list[str]] = field(default_factory=dict)
    edge_signal_count: dict[str, int] = field(default_factory=dict)


@dataclass
class Placement:
    """A component's placed position."""
    x: float              # center, mm
    y: float
    side: str             # "F" or "B"
    rotation: float = 0.0 # degrees


def rotated_info(comp: ComponentInfo, degrees: float) -> ComponentInfo:
    """Return a new ComponentInfo with dimensions/offsets/pad_sides rotated.

    KiCad convention: positive degrees = CCW viewed from front.
    Only supports 0/90/180/270 (mod 360).
    """
    from placement.helpers import rotate_pad_sides

    deg = int(degrees) % 360
    if deg == 0:
        return comp

    # Rotate dimensions
    if deg in (90, 270):
        w, h = comp.height, comp.width
    else:
        w, h = comp.width, comp.height

    # Rotate origin offset as 2D vector (CCW)
    cx, cy = comp.cx_offset, comp.cy_offset
    if deg == 90:
        cx, cy = cy, -cx
    elif deg == 180:
        cx, cy = -cx, -cy
    elif deg == 270:
        cx, cy = -cy, cx

    # Rotate pad sides and edge signal counts
    new_pad_sides = rotate_pad_sides(comp.pad_sides, deg) if comp.pad_sides else {}
    new_edge_count = rotate_pad_sides(comp.edge_signal_count, deg) if comp.edge_signal_count else {}

    return ComponentInfo(
        address=comp.address,
        width=w, height=h,
        is_tht=comp.is_tht,
        pin_count=comp.pin_count,
        nets=comp.nets,
        cx_offset=cx, cy_offset=cy,
        routing_pressure=comp.routing_pressure,
        group=comp.group,
        pad_sides=new_pad_sides,
        edge_signal_count=new_edge_count,
    )


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


@dataclass
class Cluster:
    """A group of components placed as a unit around an anchor IC."""
    anchor: str                          # anchor component address
    satellites: dict[str, list[str]]     # satellite_addr → [passive_addrs]
    bypass: list[str]                    # passives near anchor (caps, by address)


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

        # Register all fixed components (with rotation-aware dimensions)
        for addr, p in self.fixed.items():
            if addr not in self.fixed_info:
                raise ValueError(
                    f"Fixed component '{addr}' missing from fixed_info"
                )
            info = self.fixed_info[addr]
            eff_rot = self._effective_rotation(p.rotation, p.side)
            r = rotated_info(info, eff_rot) if eff_rot else info
            bcx, bcy = self._to_bbox_center(p.x, p.y, r)
            self._tracker.register(
                bcx, bcy,
                r.width, r.height, p.side,
                r.is_tht, label=addr,
            )

    def _to_bbox_center(self, x: float, y: float, comp: ComponentInfo):
        return x + comp.cx_offset, y + comp.cy_offset

    def _to_fp_origin(self, bx: float, by: float, comp: ComponentInfo):
        return bx - comp.cx_offset, by - comp.cy_offset

    @staticmethod
    def _effective_rotation(rotation: float, side: str) -> float:
        """Get effective rotation for collision detection.

        On B.Cu, KiCad mirrors the component via Flip, which adds 180° to
        the effective rotation. B.Cu rot R physically equals F.Cu rot (R+180).
        """
        if side == "B":
            return rotation + 180.0
        return rotation

    def check_collision(self, addr: str, x: float, y: float,
                        comp: ComponentInfo, side: str,
                        rotation: float = 0.0) -> bool:
        """Check if position collides with anything already placed.

        Applies rotation (and B.Cu mirror correction) before checking.
        """
        eff_rot = self._effective_rotation(rotation, side)
        r = rotated_info(comp, eff_rot) if eff_rot else comp
        cx, cy = self._to_bbox_center(x, y, r)
        return self._tracker.collides(cx, cy, r.width, r.height,
                                      side, r.is_tht)

    def find_legal_position(self, x: float, y: float,
                            comp: ComponentInfo,
                            side: str | None = None,
                            step: float = 0.5,
                            addr: str | None = None,
                            placed: dict[str, "Placement"] | None = None,
                            ) -> tuple[float, float, str]:
        """Ring-search from (x,y), return nearest legal (fp_x, fp_y, side).

        When addr and placed are provided, also rejects positions that
        would violate anti-affinity rules.
        """
        smd_side = side if side else self.smd_side
        cx, cy = self._to_bbox_center(x, y, comp)

        # Build anti-affinity checker if we have context
        aa_check = None
        if addr and placed is not None and self.anti_affinity:
            all_pos = {**placed, **self.fixed}
            def aa_check(fp_x, fp_y):
                for rule in self.anti_affinity:
                    for other_addr, other_p in all_pos.items():
                        if other_addr == addr:
                            continue
                        if not rule.matches(addr, other_addr):
                            continue
                        dist = self._math.hypot(fp_x - other_p.x,
                                                fp_y - other_p.y)
                        if dist < rule.min_mm:
                            return False
                return True

        result = self._find_best_side(
            self._tracker, cx, cy,
            comp.width, comp.height, comp.is_tht,
            step=step, smd_side=smd_side,
        )
        if result is None:
            import sys
            print(f"  WARNING: no collision-free position for component at "
                  f"({x:.1f},{y:.1f}) dims={comp.width:.1f}x{comp.height:.1f}",
                  file=sys.stderr)
            return x, y, smd_side
        bx, by, found_side = result
        fp_x, fp_y = self._to_fp_origin(bx, by, comp)

        # If position violates anti-affinity, do an expanded search
        if aa_check and not aa_check(fp_x, fp_y):
            max_radius = max(self.width, self.height)
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
                        if not self._tracker.in_bounds(
                                cand_cx, cand_cy, comp.width, comp.height):
                            continue
                        if self._tracker.collides(
                                cand_cx, cand_cy, comp.width, comp.height,
                                smd_side, comp.is_tht):
                            continue
                        cand_fpx, cand_fpy = self._to_fp_origin(
                            cand_cx, cand_cy, comp)
                        if not aa_check(cand_fpx, cand_fpy):
                            continue
                        dist = abs(cand_cx - cx) + abs(cand_cy - cy)
                        if dist < best_dist:
                            best = (cand_fpx, cand_fpy, smd_side)
                            best_dist = dist
                if best is not None:
                    return best
            # Fallback: return original position (anti-affinity violated
            # but at least collision-free)
            return fp_x, fp_y, found_side

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
                           comp: ComponentInfo, side: str,
                           rotation: float = 0.0) -> None:
        """Register a placed component in the collision tracker.

        Applies effective rotation (B.Cu adds 180°) before registering.
        """
        eff_rot = self._effective_rotation(rotation, side)
        r = rotated_info(comp, eff_rot) if eff_rot else comp
        cx, cy = self._to_bbox_center(x, y, r)
        self._tracker.register(cx, cy, r.width, r.height,
                               side, r.is_tht, label=addr)

    def place_component(self, addr: str, x: float, y: float,
                        comp: ComponentInfo, side: str,
                        rotation: float = 0.0,
                        placed: dict[str, "Placement"] | None = None,
                        ) -> Placement:
        """Find legal position, register, and return Placement.

        All-in-one method that handles rotation correctly. Uses effective
        rotation (B.Cu adds 180°) for collision detection, but stores the
        original rotation in the Placement for KiCad.

        When side is None (undetermined), searches with unrotated offsets
        and corrects after find_best_side resolves the actual side. This
        avoids a ghost-shift bug where asymmetric THT components (e.g.
        SIP-9 with large cy_offset) get searched at B-side offsets but
        placed on F-side, causing a 2*cy_offset registration error.
        """
        if side is not None:
            # Side is known — apply rotation for that side during search
            eff_rot = self._effective_rotation(rotation, side)
            r = rotated_info(comp, eff_rot) if eff_rot else comp
            fp_x, fp_y, found_side = self.find_legal_position(
                x, y, r, side=side, addr=addr, placed=placed)
        else:
            # Side undetermined — search with unrotated (F-side) offsets,
            # then correct for the actual side returned by find_best_side
            fp_x, fp_y, found_side = self.find_legal_position(
                x, y, comp, side=None, addr=addr, placed=placed)
            eff_rot_found = self._effective_rotation(rotation, found_side)
            if eff_rot_found:
                r_found = rotated_info(comp, eff_rot_found)
                # Search found bbox center at (fp_x + comp offsets);
                # re-derive fp origin using found side's offsets
                bx = fp_x + comp.cx_offset
                by = fp_y + comp.cy_offset
                fp_x = bx - r_found.cx_offset
                fp_y = by - r_found.cy_offset
        self.register_placement(addr, fp_x, fp_y, comp, found_side, rotation)
        return Placement(x=fp_x, y=fp_y, side=found_side, rotation=rotation)

    def legalize(self, positions: dict[str, tuple[float, float]],
                 components: dict[str, ComponentInfo],
                 rotations: dict[str, float] | None = None,
                 ) -> dict[str, Placement]:
        """Batch legalization: rough positions -> legal placements.

        Args:
            positions: addr → (x, y) rough target positions
            components: addr → ComponentInfo (UNROTATED originals)
            rotations: addr → degrees (optional, for rotated components)
        """
        addrs = list(positions.keys())
        sorted_addrs = self._connectivity_sort(addrs, self.net_graph)
        rots = rotations or {}

        placements: dict[str, Placement] = {}
        for addr in sorted_addrs:
            if addr not in positions or addr not in components:
                continue
            comp = components[addr]
            rot = rots.get(addr, 0.0)
            ox, oy = positions[addr]
            # Use effective rotation for collision (B.Cu adds 180°)
            eff_rot = self._effective_rotation(rot, self.smd_side)
            r = rotated_info(comp, eff_rot) if eff_rot else comp
            fp_x, fp_y, side = self.find_legal_position(
                ox, oy, r, addr=addr, placed=placements)
            placements[addr] = Placement(x=fp_x, y=fp_y, side=side,
                                          rotation=rot)
            self.register_placement(addr, fp_x, fp_y, comp, side, rot)

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
