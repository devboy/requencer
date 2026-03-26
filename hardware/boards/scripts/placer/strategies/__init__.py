"""Strategy registry and StrategyFn type.

Strategies are callables: (Board, PlacementContext, dict) → list[PlacedComponent].
"""

from __future__ import annotations

from typing import Callable

from ..dtypes import Board, PlacedComponent
from ..context import PlacementContext


StrategyFn = Callable[[Board, PlacementContext, dict], list[PlacedComponent]]

_REGISTRY: dict[str, StrategyFn] = {}


def register(name: str):
    """Decorator to register a strategy function by name."""
    def decorator(fn: StrategyFn) -> StrategyFn:
        _REGISTRY[name] = fn
        return fn
    return decorator


def get_strategy(name: str) -> StrategyFn:
    """Look up a strategy by name."""
    if name not in _REGISTRY:
        available = ", ".join(sorted(_REGISTRY.keys()))
        raise ValueError(
            f"Unknown strategy '{name}'. Available: {available}")
    return _REGISTRY[name]


def available_strategies() -> list[str]:
    """Return sorted list of registered strategy names."""
    return sorted(_REGISTRY.keys())
