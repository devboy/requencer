"""Placement strategy protocol, data classes, and registry.

Strategies implement PlacementStrategy.place() and receive a BoardContext
with all the information they need. They return a dict of address → Placement.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class ComponentInfo:
    """Pre-extracted component information for strategies."""
    address: str          # atopile address (stable identifier)
    width: float          # footprint bounding box mm
    height: float
    is_tht: bool
    pin_count: int
    nets: list[str]       # connected net names (non-power)
    cx_offset: float = 0.0  # bbox center X offset from footprint origin (mm)
    cy_offset: float = 0.0  # bbox center Y offset from footprint origin (mm)


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
        return addr == pattern


@dataclass
class BoardContext:
    """Everything a strategy needs to produce a placement."""
    width: float
    height: float
    fixed: dict[str, Placement]       # address → locked position
    free: dict[str, ComponentInfo]    # address → needs placing
    net_graph: dict[str, list[str]]   # net → list of component addresses
    config: dict = field(default_factory=dict)  # board-config.json placement section
    fixed_info: dict[str, ComponentInfo] = field(default_factory=dict)  # dimensions for fixed components
    anti_affinity: list[AntiAffinityRule] = field(default_factory=list)


class PlacementStrategy(Protocol):
    """Protocol for pluggable placement algorithms."""

    def place(self, ctx: BoardContext, params: dict) -> dict[str, Placement]:
        """Return address → Placement for all free components."""
        ...


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
