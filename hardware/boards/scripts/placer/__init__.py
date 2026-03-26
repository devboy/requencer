"""Standalone placement library — pure rectangles, no KiCad.

Usage:
    from placer import Board, Component, Net, place

    board = Board(width=100, height=50, components=[...], nets=[...])
    results = place(board, strategy="wavefront")
"""

from __future__ import annotations

from .dtypes import (
    AffinityRule,
    BlockedZone,
    Board,
    Cluster,
    Component,
    Net,
    Pin,
    PlacedComponent,
    PlacementError,
    Side,
    SidePadding,
    ZoneSide,
)
from .context import PlacementContext
from .strategies import StrategyFn, get_strategy, available_strategies


def register_strategy(name: str, fn: StrategyFn) -> None:
    """Register a custom placement strategy by name."""
    from .strategies import _REGISTRY
    _REGISTRY[name] = fn


def place(board: Board,
          strategy: str = "wavefront",
          params: dict | None = None,
          seed: int | None = None,
          bypass_config: dict[str, str] | None = None,
          ) -> list[PlacedComponent]:
    """Place all non-fixed components on the board.

    Args:
        board: Complete problem definition
        strategy: Registered strategy name
        params: Strategy-specific parameters
        seed: Random seed for reproducibility
        bypass_config: Explicit bypass cap → IC mapping from board-config.json

    Returns:
        Positions for every non-fixed component.

    Raises:
        ValueError: Unknown strategy or invalid board
        PlacementError: Strategy failed to place all components
    """
    if params is None:
        params = {}
    if seed is not None:
        params["seed"] = seed

    # Import strategies to trigger registration
    from .strategies import wavefront as _  # noqa: F401

    fn = get_strategy(strategy)
    ctx = PlacementContext(board)
    if bypass_config:
        ctx.set_bypass_config(bypass_config)
    return fn(board, ctx, params)


__all__ = [
    "AffinityRule",
    "BlockedZone",
    "Board",
    "Cluster",
    "Component",
    "Net",
    "Pin",
    "PlacedComponent",
    "PlacementContext",
    "PlacementError",
    "Side",
    "SidePadding",
    "StrategyFn",
    "ZoneSide",
    "available_strategies",
    "place",
    "register_strategy",
]
