"""Core data types for the placer library.

All types are plain dataclasses with no external dependencies.
Positions use bbox top-left as reference point. No KiCad concepts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Side(Enum):
    """Board side for component placement."""
    FRONT = "front"
    BACK = "back"


class ZoneSide(Enum):
    """Which side(s) a blocked zone applies to."""
    FRONT = "front"
    BACK = "back"
    BOTH = "both"


@dataclass(frozen=True)
class SidePadding:
    """Per-side asymmetric padding for routing clearance (mm)."""
    top: float = 0.0
    bottom: float = 0.0
    left: float = 0.0
    right: float = 0.0


@dataclass(frozen=True)
class Pin:
    """A connection point on a component.

    Position is relative to the component's bbox top-left at rotation=0,
    front side.
    """
    id: str
    x: float  # mm, relative to bbox top-left
    y: float  # mm, relative to bbox top-left


@dataclass
class Component:
    """A rectangle to be placed on the board.

    Position (x, y) is the bbox top-left corner in board coordinates.
    Width/height are at rotation=0.
    """
    id: str
    width: float   # mm, at rotation=0 (original footprint, never modified)
    height: float  # mm, at rotation=0 (original footprint, never modified)
    pins: list[Pin] = field(default_factory=list)
    tags: set[str] = field(default_factory=set)
    padding: SidePadding = field(default_factory=SidePadding)
    fixed: bool = False
    x: float = 0.0
    y: float = 0.0
    rotation: float = 0.0  # degrees: 0, 90, 180, 270
    side: Side = Side.FRONT
    group: str | None = None
    # Per-side routing escape padding (mm). NOT baked into width/height.
    # Collision grid uses width+padding for spacing; pin positions and
    # targeting always use width/height directly.
    pad_left: float = 0.0
    pad_right: float = 0.0
    pad_top: float = 0.0
    pad_bottom: float = 0.0


@dataclass(frozen=True)
class Net:
    """A signal connecting pins across components."""
    id: str
    connections: tuple[tuple[str, str], ...]  # ((component_id, pin_id), ...)


@dataclass(frozen=True)
class BlockedZone:
    """A rectangular region where placement is restricted."""
    x: float       # mm, top-left
    y: float       # mm, top-left
    width: float   # mm
    height: float  # mm
    side: ZoneSide = ZoneSide.BOTH
    excluded_tags: frozenset[str] = field(default_factory=frozenset)
    allowed_tags: frozenset[str] = field(default_factory=frozenset)


@dataclass(frozen=True)
class AffinityRule:
    """Minimum distance constraint between component groups."""
    from_pattern: str
    to_pattern: str
    min_distance_mm: float
    reason: str = ""

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
class Board:
    """The complete placement problem definition."""
    width: float   # mm
    height: float  # mm
    components: list[Component] = field(default_factory=list)
    nets: list[Net] = field(default_factory=list)
    rotation_nets: list[Net] = field(default_factory=list)  # includes power nets
    zones: list[BlockedZone] = field(default_factory=list)
    affinity_rules: list[AffinityRule] = field(default_factory=list)
    clearance: float = 0.5      # mm, minimum gap between components
    tht_clearance: float = 0.0  # mm, extra clearance around THT parts
    smd_side: str = "both"      # "front", "back", or "both"
    power_nets: frozenset[str] = field(default_factory=frozenset)  # power/bus net names


@dataclass(frozen=True)
class PlacedComponent:
    """Output: where a free component ended up."""
    component_id: str
    x: float        # mm, bbox top-left
    y: float        # mm, bbox top-left
    rotation: float  # degrees
    side: Side = Side.FRONT


@dataclass
class Cluster:
    """A group of components placed as a unit around an anchor IC."""
    anchor: str
    satellites: dict[str, list[str]] = field(default_factory=dict)
    bypass: list[str] = field(default_factory=list)


class PlacementError(Exception):
    """Raised when a strategy fails to place all components."""
    pass
